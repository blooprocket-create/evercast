import type { ContentCatalog } from '../content/types';
import { createDefaultCatalog, validateCatalog } from '../content/catalog';
import { CombatSystem } from './combat/CombatSystem';
import type { EngineConfig } from './config';
import { DEFAULT_ENGINE_CONFIG } from './config';
import { EncounterSystem } from './encounters/EncounterSystem';
import { EventBus } from './events/EventBus';
import type { GameEvent } from './events/GameEvent';
import type { GameState } from './model';
import { big, quantity } from './numbers';
import { ProgressionSystem } from './progression/ProgressionSystem';
import { RebirthSystem } from './prestige/RebirthSystem';
import { compileSpell } from './spell/SpellCompiler';
import { createInitialGameState } from './state';
import type { EngineCommand, SimulationSnapshot } from './types';

const EPSILON = 1e-9;

export interface SimulationOptions {
  config?: Partial<EngineConfig>;
  catalog?: ContentCatalog;
  initialState?: GameState;
}

export class EvercastSimulation {
  readonly config: EngineConfig;
  private state: GameState;
  private readonly catalog: ContentCatalog;
  private readonly eventBus: EventBus<GameEvent>;
  private readonly presentationEvents: GameEvent[] = [];
  private readonly encounterSystem: EncounterSystem;
  private readonly combatSystem: CombatSystem;
  private readonly progressionSystem: ProgressionSystem;
  private readonly rebirthSystem: RebirthSystem;
  private recordPresentationEvents = true;
  private lastEvent = 'The Evercast stirs.';

  constructor(options: SimulationOptions = {}) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...options.config };
    this.catalog = options.catalog ?? createDefaultCatalog();
    const contentErrors = validateCatalog(this.catalog);
    if (contentErrors.length > 0) throw new Error(contentErrors.join('\n'));
    this.state = options.initialState ?? createInitialGameState(this.config);
    this.eventBus = new EventBus<GameEvent>(this.config.maxEventsPerAdvance);
    this.eventBus.subscribe((event) => this.captureEvent(event));
    const emit = (event: GameEvent) => this.eventBus.emit(event);
    this.encounterSystem = new EncounterSystem(this.catalog, this.config);
    this.combatSystem = new CombatSystem(this.config, emit);
    this.progressionSystem = new ProgressionSystem(this.config, emit);
    this.rebirthSystem = new RebirthSystem(this.config, emit);
  }

  update(deltaSeconds: number): void {
    this.advance(Math.min(Math.max(deltaSeconds, 0), 1));
  }

  advance(seconds: number, options: { presentationEvents?: boolean } = {}): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const previousRecording = this.recordPresentationEvents;
    this.recordPresentationEvents = options.presentationEvents ?? true;
    let remaining = seconds;
    let eventCount = 0;

    try {
      while (remaining > EPSILON) {
        eventCount += 1;
        if (eventCount > this.config.maxEventsPerAdvance) {
          throw new Error(`Simulation safety limit exceeded while advancing ${seconds}s.`);
        }

        if (this.state.run.phase === 'travel') {
          const consumed = this.advanceTravel(remaining);
          remaining -= consumed;
          continue;
        }

        const consumed = this.advanceCombat(remaining);
        remaining -= consumed;
      }
    } finally {
      this.recordPresentationEvents = previousRecording;
    }
  }

  execute(command: EngineCommand): boolean {
    switch (command.type) {
      case 'retry_frontier':
        this.progressionSystem.retryFrontier(this.state);
        return true;
      case 'set_spell_build':
        this.state.run.spell = structuredClone(command.build);
        this.state.run.castCooldown = Math.min(
          this.state.run.castCooldown,
          compileSpell(this.state.run.spell).castInterval,
        );
        return true;
      case 'rebirth':
        return this.rebirthSystem.perform(this.state);
    }
  }

  getSnapshot(): SimulationSnapshot {
    const run = this.state.run;
    const enemy = run.enemy;
    const compiledSpell = compileSpell(run.spell);
    const enemyHpPercent = enemy && enemy.maxHp.cmp(0) > 0
      ? Math.max(0, Math.min(1, enemy.hp.div(enemy.maxHp).toNumber())) * 100
      : 0;
    const mageHpPercent = run.mage.maxHp.cmp(0) > 0
      ? Math.max(0, Math.min(1, run.mage.hp.div(run.mage.maxHp).toNumber())) * 100
      : 0;

    return {
      elapsedSeconds: run.elapsedSeconds,
      stage: run.frontierStage,
      encounterStage: run.encounterStage,
      zone: run.zoneNumber,
      zoneName: run.zoneName,
      mode: run.mode,
      farmStage: run.farmStage,
      farmKillsSinceFailure: run.farmKillsSinceFailure,
      essence: quantity(run.essence),
      knowledge: quantity(this.state.meta.knowledge),
      mageHp: quantity(run.mage.hp),
      mageMaxHp: quantity(run.mage.maxHp),
      mageHpPercent,
      enemyHp: quantity(enemy?.hp ?? big(0)),
      enemyMaxHp: quantity(enemy?.maxHp ?? big(0)),
      enemyHpPercent,
      enemyName: enemy?.name ?? 'Road ahead',
      phase: run.phase,
      boss: enemy?.boss ?? false,
      casts: run.stats.casts,
      kills: run.stats.kills,
      deaths: run.stats.deaths,
      projectileCount: compiledSpell.projectileCount,
      damagePerProjectile: quantity(big(compiledSpell.damage)),
      castInterval: compiledSpell.castInterval,
      progressToNextEncounter: run.phase === 'travel'
        ? Math.min(1, run.travelElapsed / this.config.travelSeconds)
        : 1,
      highestStageEver: this.state.meta.highestStageEver,
      rebirths: this.state.meta.rebirths,
      canRebirth: this.rebirthSystem.canRebirth(this.state),
      lastEvent: this.lastEvent,
    };
  }

  getState(): GameState {
    return this.state;
  }

  drainPresentationEvents(): GameEvent[] {
    return this.presentationEvents.splice(0, this.presentationEvents.length);
  }

  private advanceTravel(available: number): number {
    const run = this.state.run;
    const timeToEncounter = Math.max(0, this.config.travelSeconds - run.travelElapsed);
    const consumed = Math.min(available, timeToEncounter);
    run.travelElapsed += consumed;
    run.elapsedSeconds += consumed;

    if (run.travelElapsed + EPSILON >= this.config.travelSeconds) {
      const descriptor = this.encounterSystem.createForRun(run);
      run.enemy = descriptor.enemy;
      run.encounterStage = descriptor.enemy.stage;
      run.zoneNumber = descriptor.zoneNumber;
      run.zoneName = descriptor.zoneName;
      run.phase = 'combat';
      run.travelElapsed = 0;
      run.castCooldown = Math.min(0.15, compileSpell(run.spell).castInterval);
      this.eventBus.emit({
        type: 'encounter_started',
        time: run.elapsedSeconds,
        stage: descriptor.enemy.stage,
        enemyId: descriptor.enemy.definitionId,
        enemyName: descriptor.enemy.name,
        boss: descriptor.enemy.boss,
      });
    }

    return consumed || Math.min(available, EPSILON);
  }

  private advanceCombat(available: number): number {
    const run = this.state.run;
    const enemy = run.enemy;
    if (!enemy) {
      run.phase = 'travel';
      return Math.min(available, EPSILON);
    }

    const nextAction = Math.max(0, Math.min(run.castCooldown, enemy.attackCooldown));
    const consumed = Math.min(available, nextAction);
    run.elapsedSeconds += consumed;
    run.castCooldown -= consumed;
    enemy.attackCooldown -= consumed;

    if (consumed + EPSILON < nextAction) return consumed;

    // Player wins ties; it feels better and keeps the ordering deterministic.
    if (run.castCooldown <= EPSILON) {
      const result = this.combatSystem.cast(run);
      run.castCooldown += compileSpell(run.spell).castInterval;
      if (result.enemyKilled) {
        this.progressionSystem.handleVictory(this.state);
        return consumed || Math.min(available, EPSILON);
      }
    }

    if (run.phase === 'combat' && run.enemy && run.enemy.attackCooldown <= EPSILON) {
      const result = this.combatSystem.enemyAttack(run);
      if (run.enemy) run.enemy.attackCooldown += run.enemy.attackInterval;
      if (result.mageDefeated) {
        this.progressionSystem.handleDefeat(this.state);
      }
    }

    return consumed || Math.min(available, EPSILON);
  }

  private captureEvent(event: GameEvent): void {
    this.lastEvent = describeEvent(event);
    if (this.recordPresentationEvents) this.presentationEvents.push(event);
  }
}

function describeEvent(event: GameEvent): string {
  switch (event.type) {
    case 'encounter_started':
      return `${event.enemyName} approaches.`;
    case 'spell_cast':
      return `Arcane Bolt cast (${event.projectiles} projectile${event.projectiles === 1 ? '' : 's'}).`;
    case 'projectile_hit':
      return `${event.critical ? 'Critical! ' : ''}Arcane Bolt hits for ${event.damage}.`;
    case 'enemy_attack':
      return `The enemy hits for ${event.damage}.`;
    case 'enemy_killed':
      return `Enemy falls. +${event.reward} Essence.`;
    case 'mage_defeated':
      return `The mage falls at stage ${event.stage}.`;
    case 'resource_gained':
      return `+${event.amount} ${event.resource}.`;
    case 'stage_advanced':
      return `Frontier advanced to stage ${event.stage}.`;
    case 'mode_changed':
      return `${event.mode === 'farm' ? 'Farming' : 'Pushing'}: ${event.reason}.`;
    case 'rebirth_performed':
      return `Rebirth ${event.rebirths}: +${event.knowledgeGained} Knowledge.`;
  }
}
