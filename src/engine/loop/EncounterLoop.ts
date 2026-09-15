import type { CombatSystem } from '../combat/CombatSystem';
// prettier-ignore
import { advanceApproach, anyInRange, effectiveCastInterval, soonestRangeChange } from '../combat/SpellCombatState';
import { nextEnemyBeat, resolveEnemyBeats, tickEnemyCooldowns } from '../combat/EnemyTurns';
// prettier-ignore
import { nextCompanionBeat, resolveCompanionBeats, tickCompanionCooldowns } from '../companions/CompanionCombat';
import { masteryMultiplier } from '../prestige/Mastery';
import { partyThresholds } from '../companions/Formation';
import type { EngineConfig } from '../config';
import type { EncounterSystem } from '../encounters/EncounterSystem';
import type { GameEvent } from '../events/GameEvent';
import type { GameState } from '../model';
import type { ProgressionSystem } from '../progression/ProgressionSystem';
import { compileSpell } from '../spell/SpellCompiler';
import { tickCounterspell } from '../combat/Surge';

/**
 * The tolerance that makes landing exactly on an event mean landing on it.
 * Shared with `EvercastSimulation`, which drains time against the same scale.
 */
export const EPSILON = 1e-9;

export interface EncounterLoopSystems {
  encounters: EncounterSystem;
  combat: CombatSystem;
  progression: ProgressionSystem;
  /**
   * One automation pass. A closure rather than the system itself, so the loop
   * never learns what automation depends on - which is most of the other
   * systems in the engine.
   */
  automate: (state: GameState) => void;
}

/**
 * One step of the event-driven world clock.
 *
 * Extracted from `EvercastSimulation` so the coordinator stays a coordinator:
 * travel, spawning, casting and enemy beats are one cohesive concern, and they
 * are where every new combat event source has to be threaded in. The rule the
 * whole determinism story rests on lives here - `step` consumes time only up to
 * the next event, never past it, so a run advanced in one pass, in chunks, or
 * resumed from a save lands on identical state.
 */
export class EncounterLoop {
  constructor(
    private readonly config: EngineConfig,
    private readonly systems: EncounterLoopSystems,
    private readonly emit: (event: GameEvent) => void,
  ) {}

  /** Advances at most `available` seconds and returns how many it consumed. */
  step(state: GameState, available: number): number {
    return state.run.phase === 'travel'
      ? this.advanceTravel(state, available)
      : this.advanceCombat(state, available);
  }

  private advanceTravel(state: GameState, available: number): number {
    const run = state.run;
    const timeToEncounter = Math.max(0, this.config.travelSeconds - run.travelElapsed);
    const consumed = Math.min(available, timeToEncounter);
    run.travelElapsed += consumed;
    run.elapsedSeconds += consumed;
    tickCounterspell(run, consumed);

    if (run.travelElapsed + EPSILON >= this.config.travelSeconds) {
      /*
       * Automation runs here and nowhere else, and the call site is the whole
       * determinism story: buying gear changes the mage's damage, which changes
       * when the next enemy dies - so it must not fire at a moment that depends
       * on how `advance` was chunked. Arriving at an encounter is already an
       * event the loop stops on, and both the cleared path and the defeated one
       * route through travel to get here, so one hook covers every way a fight
       * can end. It is also when a player would have done it: you kit up
       * between fights, not mid-swing.
       */
      this.systems.automate(state);
      const descriptor = this.systems.encounters.createForRun(run);
      run.encounter = descriptor.encounter;
      run.enemies = [];
      run.encounterStage = descriptor.encounter.stage;
      run.zoneNumber = descriptor.zoneNumber;
      run.zoneName = descriptor.zoneName;
      run.phase = 'combat';
      run.travelElapsed = 0;
      run.castCooldown = Math.min(0.15, compileSpell(run.spell).castInterval);
      this.emit({
        type: 'encounter_started',
        time: run.elapsedSeconds,
        stage: descriptor.encounter.stage,
        totalEnemies: descriptor.encounter.totalEnemies,
        boss: descriptor.encounter.bossStage,
      });
      this.spawnNextEnemy(state);
    }

    return consumed || Math.min(available, EPSILON);
  }

  private advanceCombat(state: GameState, available: number): number {
    const run = state.run;
    const encounter = run.encounter;
    if (!encounter) {
      run.phase = 'travel';
      return Math.min(available, EPSILON);
    }

    if (encounter.spawnedEnemies >= encounter.totalEnemies && run.enemies.length === 0) {
      this.systems.progression.handleEncounterCleared(state);
      return Math.min(available, EPSILON);
    }

    const canSpawn =
      encounter.spawnedEnemies < encounter.totalEnemies && run.enemies.length < encounter.maxAlive;
    const nextSpawn = canSpawn ? Math.max(0, encounter.spawnCooldown) : Number.POSITIVE_INFINITY;
    const reach = this.config.enemyAttackRange;
    const nextCast = anyInRange(run, this.config.spellRange)
      ? Math.max(0, run.castCooldown)
      : Number.POSITIVE_INFINITY;
    // Every companion reach is another gate that changes behaviour, so each one
    // has to be a moment the loop can stop on. Miss one and a companion opens
    // fire at a different instant in a chunked run than in a single pass.
    const thresholds = [this.config.spellRange, ...partyThresholds(run)];
    const nextAction = Math.min(
      nextSpawn,
      nextCast,
      nextEnemyBeat(run, this.config),
      nextCompanionBeat(run),
      soonestRangeChange(run, thresholds, reach, this.config.enemyApproachSpeed),
      this.systems.combat.evolving.effects.nextDelay(run),
    );

    if (!Number.isFinite(nextAction)) {
      throw new Error('Combat has no reachable next event.');
    }

    const consumed = Math.min(available, nextAction);
    run.elapsedSeconds += consumed;
    // Deliberately not one of the gates above: see `tickCounterspell`.
    tickCounterspell(run, consumed);
    // Gates read positions as they were at the START of this step. Arrival is
    // itself an event, so an enemy is either out of range for the whole step or
    // in range for the whole step - which is what keeps a chunked run, a single
    // pass and a save-and-resume in agreement.
    if (anyInRange(run, this.config.spellRange)) run.castCooldown -= consumed;
    // An enemy still closing is not winding up a swing, and a companion with
    // nothing in reach is not drawing back for one.
    tickEnemyCooldowns(run, this.config, consumed);
    tickCompanionCooldowns(run, consumed);
    if (canSpawn) encounter.spawnCooldown -= consumed;
    advanceApproach(run, reach, this.config.enemyApproachSpeed);

    if (consumed + EPSILON < nextAction) return consumed;

    if (canSpawn && encounter.spawnCooldown <= EPSILON) this.spawnNextEnemy(state);
    this.collectDeadEnemies(state, this.systems.combat.evolving.effects.advance(run));

    // Player wins ties. A cast can kill the first target and subsequent projectiles retarget.
    if (anyInRange(run, this.config.spellRange) && run.castCooldown <= EPSILON) {
      const result = this.systems.combat.cast(run, state.equipment, masteryMultiplier(state.meta));
      run.castCooldown += effectiveCastInterval(run);
      this.collectDeadEnemies(state, result.killedEnemyIds);
    }

    // Companions swing after the mage, so a cast that clears the front rank
    // lets them retarget in the same instant her own projectiles already do.
    this.collectDeadEnemies(
      state,
      resolveCompanionBeats({
        run,
        equipment: state.equipment,
        mastery: masteryMultiplier(state.meta),
        emit: this.emit,
      }),
    );

    if (
      run.encounter &&
      run.encounter.spawnedEnemies >= run.encounter.totalEnemies &&
      run.enemies.length === 0
    ) {
      this.systems.progression.handleEncounterCleared(state);
      return consumed || Math.min(available, EPSILON);
    }

    for (const enemy of resolveEnemyBeats(run, this.config, this.emit)) {
      const result = this.systems.combat.enemyAttack(run, enemy);
      enemy.attackCooldown += enemy.attackInterval;
      // Counted after the blow lands, so `isSurgeSwing` is always asking about
      // the *next* swing. A Surge broken by the player advances the same count
      // from `breakSurge`, which is what stops a countered boss from simply
      // winding another Surge straight back up.
      enemy.swings = (enemy.swings ?? 0) + 1;
      enemy.telegraphed = false;
      if (result.mageDefeated) {
        this.systems.progression.handleDefeat(state, enemy);
        break;
      }
    }

    return consumed || Math.min(available, EPSILON);
  }

  private spawnNextEnemy(state: GameState): void {
    const run = state.run;
    const enemy = this.systems.encounters.spawnEnemy(run);
    if (!enemy || !run.encounter) return;
    this.emit({
      type: 'enemy_spawned',
      position: enemy.position ? { ...enemy.position } : undefined,
      time: run.elapsedSeconds,
      stage: enemy.stage,
      instanceId: enemy.instanceId,
      enemyId: enemy.definitionId,
      enemyName: enemy.name,
      boss: enemy.boss,
      spawned: run.encounter.spawnedEnemies,
      total: run.encounter.totalEnemies,
    });
  }

  /**
   * Where a corpse becomes an engine fact, whoever made it - so it is also
   * where the spell gets to answer the death, before the body is cleared away.
   */
  private collectDeadEnemies(state: GameState, candidateIds: readonly number[]): void {
    const run = state.run;
    const candidates = new Set(candidateIds);
    const everyCorpse = candidateIds.length === 0;
    // A death the spell answers can kill again, and a fresh victim standing
    // earlier in the list than the body that took it has already been passed
    // over. So sweep until a pass collects nothing; each pass that collects
    // removes an enemy, which is what ends it.
    for (let collected = true; collected; ) {
      collected = false;
      for (const enemy of [...run.enemies]) {
        if (enemy.hp.cmp(0) > 0 || (!everyCorpse && !candidates.has(enemy.instanceId))) continue;
        this.systems.progression.handleEnemyKilled(state, enemy);
        for (const id of this.systems.combat.evolving.effects.resolveKill(run, enemy)) candidates.add(id);
        run.enemies = run.enemies.filter((entry) => entry.instanceId !== enemy.instanceId);
        collected = true;
      }
    }
  }
}
