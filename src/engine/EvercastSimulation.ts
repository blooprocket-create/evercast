import { createDefaultCatalog, validateCatalog } from '../content/catalog';
import type { ContentCatalog } from '../content/types';
import { CombatSystem } from './combat/CombatSystem';
import type { EngineConfig } from './config';
import { DEFAULT_ENGINE_CONFIG } from './config';
import { EncounterSystem } from './encounters/EncounterSystem';
import { EventBus } from './events/EventBus';
import type { GameEvent } from './events/GameEvent';
import { describeGameEvent } from './events/describeGameEvent';
import { GearSystem } from './gear/GearSystem';
import type { GameState } from './model';
import { ProgressionSystem } from './progression/ProgressionSystem';
import { RebirthSystem } from './prestige/RebirthSystem';
import { compileSpell } from './spell/SpellCompiler';
import { SpellTreeSystem } from './spellTree/SpellTreeSystem';
import { buildSimulationSnapshot } from './snapshot/SimulationSnapshotBuilder';
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
  private readonly gearSystem: GearSystem;
  private readonly spellTreeSystem: SpellTreeSystem;
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
    this.gearSystem = new GearSystem(this.config, emit);
    this.spellTreeSystem = new SpellTreeSystem(emit);
    this.gearSystem.syncMageStats(this.state);
    this.spellTreeSystem.syncSpell(this.state);
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

        const consumed = this.state.run.phase === 'travel'
          ? this.advanceTravel(remaining)
          : this.advanceCombat(remaining);
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
      case 'level_gear':
        return this.gearSystem.levelUp(this.state, command.slot);
      case 'buy_spell_point':
        return this.spellTreeSystem.buyPoint(this.state);
      case 'activate_spell_node': {
        const activated = this.spellTreeSystem.activateNode(this.state, command.nodeId);
        if (activated) {
          this.state.run.castCooldown = Math.min(
            this.state.run.castCooldown,
            compileSpell(this.state.run.spell).castInterval,
          );
        }
        return activated;
      }
      case 'respec_spell_tree':
        return this.spellTreeSystem.respec(this.state);
      case 'rebirth': {
        const performed = this.rebirthSystem.perform(this.state);
        if (performed) this.spellTreeSystem.syncSpell(this.state);
        return performed;
      }
    }
  }

  getSnapshot(): SimulationSnapshot {
    return buildSimulationSnapshot({
      state: this.state,
      config: this.config,
      catalog: this.catalog,
      canRebirth: this.rebirthSystem.canRebirth(this.state),
      lastEvent: this.lastEvent,
    });
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
      run.encounter = descriptor.encounter;
      run.enemies = [];
      run.encounterStage = descriptor.encounter.stage;
      run.zoneNumber = descriptor.zoneNumber;
      run.zoneName = descriptor.zoneName;
      run.phase = 'combat';
      run.travelElapsed = 0;
      run.castCooldown = Math.min(0.15, compileSpell(run.spell).castInterval);
      this.eventBus.emit({
        type: 'encounter_started',
        time: run.elapsedSeconds,
        stage: descriptor.encounter.stage,
        totalEnemies: descriptor.encounter.totalEnemies,
        boss: descriptor.encounter.bossStage,
      });
      this.spawnNextEnemy();
    }

    return consumed || Math.min(available, EPSILON);
  }

  private advanceCombat(available: number): number {
    const run = this.state.run;
    const encounter = run.encounter;
    if (!encounter) {
      run.phase = 'travel';
      return Math.min(available, EPSILON);
    }

    if (encounter.spawnedEnemies >= encounter.totalEnemies && run.enemies.length === 0) {
      this.progressionSystem.handleEncounterCleared(this.state);
      return Math.min(available, EPSILON);
    }

    const canSpawn = encounter.spawnedEnemies < encounter.totalEnemies && run.enemies.length < encounter.maxAlive;
    const nextSpawn = canSpawn ? Math.max(0, encounter.spawnCooldown) : Number.POSITIVE_INFINITY;
    const nextCast = run.enemies.length > 0 ? Math.max(0, run.castCooldown) : Number.POSITIVE_INFINITY;
    const nextAttack = run.enemies.reduce(
      (soonest, enemy) => Math.min(soonest, Math.max(0, enemy.attackCooldown)),
      Number.POSITIVE_INFINITY,
    );
    const nextAction = Math.min(nextSpawn, nextCast, nextAttack);

    if (!Number.isFinite(nextAction)) {
      throw new Error('Combat has no reachable next event.');
    }

    const consumed = Math.min(available, nextAction);
    run.elapsedSeconds += consumed;
    if (run.enemies.length > 0) run.castCooldown -= consumed;
    for (const enemy of run.enemies) enemy.attackCooldown -= consumed;
    if (canSpawn) encounter.spawnCooldown -= consumed;

    if (consumed + EPSILON < nextAction) return consumed;

    if (canSpawn && encounter.spawnCooldown <= EPSILON) this.spawnNextEnemy();

    // Player wins ties. A cast can kill the first target and subsequent projectiles retarget.
    if (run.enemies.length > 0 && run.castCooldown <= EPSILON) {
      const result = this.combatSystem.cast(run, this.state.equipment);
      run.castCooldown += compileSpell(run.spell).castInterval;
      this.collectDeadEnemies(result.killedEnemyIds);
    }

    if (run.encounter && run.encounter.spawnedEnemies >= run.encounter.totalEnemies && run.enemies.length === 0) {
      this.progressionSystem.handleEncounterCleared(this.state);
      return consumed || Math.min(available, EPSILON);
    }

    for (const enemy of [...run.enemies]) {
      if (enemy.attackCooldown > EPSILON) continue;
      const result = this.combatSystem.enemyAttack(run, enemy);
      enemy.attackCooldown += enemy.attackInterval;
      if (result.mageDefeated) {
        this.progressionSystem.handleDefeat(this.state);
        break;
      }
    }

    return consumed || Math.min(available, EPSILON);
  }

  private spawnNextEnemy(): void {
    const run = this.state.run;
    const enemy = this.encounterSystem.spawnEnemy(run);
    if (!enemy || !run.encounter) return;
    this.eventBus.emit({
      type: 'enemy_spawned',
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

  private collectDeadEnemies(candidateIds: readonly number[]): void {
    const run = this.state.run;
    const candidates = new Set(candidateIds);
    for (const enemy of [...run.enemies]) {
      if (enemy.hp.cmp(0) > 0 || (!candidates.has(enemy.instanceId) && candidateIds.length > 0)) continue;
      this.progressionSystem.handleEnemyKilled(this.state, enemy);
      run.enemies = run.enemies.filter((entry) => entry.instanceId !== enemy.instanceId);
    }
  }

  private captureEvent(event: GameEvent): void {
    this.lastEvent = describeGameEvent(event);
    if (this.recordPresentationEvents) this.presentationEvents.push(event);
  }
}
