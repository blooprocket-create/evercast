import { createDefaultCatalog, validateCatalog } from '../content/catalog';
import type { ContentCatalog } from '../content/types';
import { CombatSystem } from './combat/CombatSystem';
import { clearSpellCombat, ensurePositions } from './combat/SpellCombatState';
import { clearTelegraphs } from './combat/EnemyTurns';
import type { EngineConfig } from './config';
import { DEFAULT_ENGINE_CONFIG } from './config';
import { EncounterSystem } from './encounters/EncounterSystem';
import { EventBus } from './events/EventBus';
import type { GameEvent } from './events/GameEvent';
import { describeGameEvent } from './events/describeGameEvent';
import { GearSystem } from './gear/GearSystem';
import { EPSILON, EncounterLoop } from './loop/EncounterLoop';
import type { GameState } from './model';
import { ProgressionSystem } from './progression/ProgressionSystem';
import { RebirthSystem } from './prestige/RebirthSystem';
import { compileSpell } from './spell/SpellCompiler';
import { SpellTreeSystem } from './spellTree/SpellTreeSystem';
import { buildSimulationSnapshot } from './snapshot/SimulationSnapshotBuilder';
import { createInitialGameState } from './state';
import type { EngineCommand, SimulationSnapshot } from './types';

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
  private readonly loop: EncounterLoop;
  private readonly progressionSystem: ProgressionSystem;
  private readonly rebirthSystem: RebirthSystem;
  private readonly gearSystem: GearSystem;
  private readonly spellTreeSystem: SpellTreeSystem;
  private recordPresentationEvents = true;
  private lastEvent: GameEvent | null = null;

  constructor(options: SimulationOptions = {}) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...options.config };
    this.catalog = options.catalog ?? createDefaultCatalog();
    const contentErrors = validateCatalog(this.catalog);
    if (contentErrors.length > 0) throw new Error(contentErrors.join('\n'));
    this.state = options.initialState ?? createInitialGameState(this.config);
    this.eventBus = new EventBus<GameEvent>(this.config.maxEventsPerAdvance);
    this.eventBus.subscribe((event) => this.captureEvent(event));
    const emit = (event: GameEvent) => this.eventBus.emit(event);
    this.progressionSystem = new ProgressionSystem(this.config, emit);
    this.rebirthSystem = new RebirthSystem(this.config, emit);
    this.gearSystem = new GearSystem(this.config, emit);
    this.spellTreeSystem = new SpellTreeSystem(emit);
    this.loop = new EncounterLoop(
      this.config,
      {
        encounters: new EncounterSystem(this.catalog, this.config),
        combat: new CombatSystem(this.config, emit),
        progression: this.progressionSystem,
      },
      emit,
    );
    this.gearSystem.syncMageStats(this.state);
    this.spellTreeSystem.syncSpell(this.state);
    ensurePositions(this.state.run, this.config.enemyAttackRange);
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
        remaining -= this.loop.step(this.state, remaining);
      }
    } finally {
      if (!this.recordPresentationEvents) clearTelegraphs(this.state.run);
      this.recordPresentationEvents = previousRecording;
    }
  }

  execute(command: EngineCommand): boolean {
    switch (command.type) {
      case 'retry_frontier':
        this.progressionSystem.retryFrontier(this.state);
        return true;
      case 'set_spell_build':
        clearSpellCombat(this.state.run);
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
      rebirthKnowledgeGain: this.rebirthSystem.previewKnowledgeGain(this.state),
      lastEvent: this.lastEvent ? describeGameEvent(this.lastEvent) : 'The Evercast stirs.',
    });
  }

  getState(): GameState {
    return this.state;
  }

  drainPresentationEvents(): GameEvent[] {
    return this.presentationEvents.splice(0, this.presentationEvents.length);
  }

  private captureEvent(event: GameEvent): void {
    // A telegraph is something for the renderer to animate, not a line of
    // narration - it would otherwise displace the blow it precedes.
    if (event.type !== 'enemy_windup') this.lastEvent = event;
    if (this.recordPresentationEvents) this.presentationEvents.push(event);
  }
}
