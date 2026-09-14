import type Decimal from 'break_eternity.js';
import { createDefaultCatalog, validateCatalog } from '../content/catalog';
import type { ContentCatalog } from '../content/types';
import { CombatSystem } from './combat/CombatSystem';
import { clearSpellCombat, ensurePositions } from './combat/SpellCombatState';
import { clearTelegraphs } from './combat/EnemyTurns';
import { CompanionSystem } from './companions/CompanionSystem';
import { GachaSystem } from './companions/GachaSystem';
import { requireCompanion } from './companions/CompanionCatalog';
import type { EngineConfig } from './config';
import { DEFAULT_ENGINE_CONFIG } from './config';
import { EncounterSystem } from './encounters/EncounterSystem';
import { EventBus } from './events/EventBus';
import type { GameEvent } from './events/GameEvent';
import { Chronicle } from './events/Chronicle';
import { GearSystem } from './gear/GearSystem';
import { EPSILON, EncounterLoop } from './loop/EncounterLoop';
import type { GameState } from './model';
import { ProgressionSystem } from './progression/ProgressionSystem';
import { RebirthSystem } from './prestige/RebirthSystem';
import { compileSpell } from './spell/SpellCompiler';
import { SpellTreeSystem } from './spellTree/SpellTreeSystem';
import { buildSimulationSnapshot } from './snapshot/SimulationSnapshotBuilder';
import { createInitialGameState } from './state';
import type { EngineCommand, LastSummonSnapshot, SimulationSnapshot } from './types';

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
  private readonly companionSystem: CompanionSystem;
  private readonly gachaSystem: GachaSystem;
  private recordPresentationEvents = true;
  private readonly chronicle = new Chronicle();
  private lastSummon: LastSummonSnapshot | null = null;

  constructor(options: SimulationOptions = {}) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...options.config };
    this.catalog = options.catalog ?? createDefaultCatalog();
    const contentErrors = validateCatalog(this.catalog);
    if (contentErrors.length > 0) throw new Error(contentErrors.join('\n'));
    this.state = options.initialState ?? createInitialGameState(this.config);
    this.eventBus = new EventBus<GameEvent>(this.config.maxEventsPerFlush);
    this.eventBus.subscribe((event) => this.captureEvent(event));
    const emit = (event: GameEvent) => this.eventBus.emit(event);
    this.progressionSystem = new ProgressionSystem(this.config, emit);
    this.rebirthSystem = new RebirthSystem(this.config, emit);
    this.gearSystem = new GearSystem(this.config, emit);
    this.spellTreeSystem = new SpellTreeSystem(emit);
    this.companionSystem = new CompanionSystem(emit);
    this.gachaSystem = new GachaSystem(this.config, emit);
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
    this.companionSystem.sync(this.state);
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
    let steps = 0;
    // One step per world event, so the budget tracks the span being advanced.
    // A day of offline catch-up is hundreds of thousands of legitimate steps;
    // only a loop that has stopped consuming time can outrun this.
    const budget =
      this.config.maxAdvanceSteps + this.config.maxAdvanceStepsPerSecond * seconds;

    try {
      while (remaining > EPSILON) {
        steps += 1;
        if (steps > budget) {
          throw new Error(
            `Simulation safety limit exceeded while advancing ${seconds}s (${steps} steps).`,
          );
        }
        remaining -= this.loop.step(this.state, remaining);
      }
    } finally {
      if (!this.recordPresentationEvents) clearTelegraphs(this.state.run);
      this.recordPresentationEvents = previousRecording;
    }
  }

  /**
   * Adds yield the player is owed for time nobody simulated.
   *
   * Offline progress samples a window at full fidelity and credits the rest from
   * the rate it measured, so this is the one way currency enters the world
   * without a kill behind it. It is deliberately narrow: Gold and Starlight are
   * repeatable kill rewards, so a measured rate holds across the sample.
   *
   * Gold is the one to watch. It used to scale with nothing but the stage; it is
   * now a fraction of enemy health, which compounds and carries the world-tier
   * and boss multipliers with it. A flat rate still holds inside a ten-minute
   * sample, but a long absence extrapolated from one taken just below a
   * world-tier boundary will under-credit more sharply than it used to. That is
   * a conservative error rather than a wrong one, and it is why the progressor
   * measures the rate instead of deriving it.
   *
   * Essence and stage are not here on purpose - Essence is
   * a first-clear reward and the stage is the record of where the run actually
   * reached, and inventing either would put the save at odds with
   * `totalFirstClearEssenceEarned`, which treats the highest stage as the
   * authority on Essence ever earned.
   */
  creditOfflineYield(yields: { gold: Decimal; starlight: Decimal; kills: number }): void {
    if (yields.gold.cmp(0) > 0) {
      this.state.equipment.gold = this.state.equipment.gold.add(yields.gold);
    }
    if (yields.starlight.cmp(0) > 0) {
      this.state.companions.starlight = this.state.companions.starlight.add(yields.starlight);
    }
    if (yields.kills > 0) this.state.run.stats.kills += Math.floor(yields.kills);
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
      case 'level_gear': {
        const levelled = this.gearSystem.levelUp(this.state, command.slot);
        // Companion health is a share of the mage's, so a gear level that
        // raises her maximum raises theirs in the same breath.
        if (levelled) this.companionSystem.sync(this.state);
        return levelled;
      }
      case 'buy_spell_point':
        return this.spellTreeSystem.buyPoint(this.state);
      case 'buy_attunement':
        return this.spellTreeSystem.buyAttunement(this.state, command.attunementId);
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
      /**
       * The one piece of onboarding that cannot be derived. A hint about gold
       * stops being true the moment gold is spent, so nothing needs recording;
       * a premise the player has read leaves no mark on the state it described,
       * so it does. Refusing a flag already held keeps it idempotent, and keeps
       * a re-dismissal from spending a publish and a save on nothing.
       */
      case 'mark_story_flag': {
        if (this.state.meta.storyFlags.includes(command.flag)) return false;
        this.state.meta.storyFlags.push(command.flag);
        return true;
      }
      case 'respec_spell_tree':
        return this.spellTreeSystem.respec(this.state);
      case 'rebirth': {
        const performed = this.rebirthSystem.perform(this.state);
        if (performed) {
          this.spellTreeSystem.syncSpell(this.state);
          // The roster survives a rebirth alongside gear and the spell tree; a
          // prestige that wiped a collection would make the gacha worthless.
          this.companionSystem.sync(this.state);
        }
        return performed;
      }
      case 'summon_draw': {
        const results = this.gachaSystem.draw(this.state, command.count);
        if (!results) return false;
        this.companionSystem.sync(this.state);
        this.lastSummon = {
          serial: this.state.companions.drawSerial,
          results: results.map((result) => ({
            ...result,
            name: requireCompanion(result.definitionId).name,
          })),
        };
        return true;
      }
      case 'ascend_companion':
        return this.companionSystem.ascend(this.state, command.definitionId);
      case 'equip_companion':
        return this.companionSystem.equip(this.state, command.definitionId, command.slot);
      case 'unequip_companion':
        return this.companionSystem.unequip(this.state, command.slot);
    }
  }

  getSnapshot(): SimulationSnapshot {
    return buildSimulationSnapshot({
      state: this.state,
      config: this.config,
      catalog: this.catalog,
      canRebirth: this.rebirthSystem.canRebirth(this.state),
      rebirthKnowledgeGain: this.rebirthSystem.previewKnowledgeGain(this.state),
      nextKnowledgeStage: this.rebirthSystem.nextKnowledgeStage(this.state),
      lastSummon: this.lastSummon,
      chronicle: this.chronicle.read(),
    });
  }

  getState(): GameState {
    return this.state;
  }

  drainPresentationEvents(): GameEvent[] {
    return this.presentationEvents.splice(0, this.presentationEvents.length);
  }

  private captureEvent(event: GameEvent): void {
    // What is worth a line, and what is a telegraph for the renderer to
    // animate, is `logWeight`'s decision rather than one taken twice.
    this.chronicle.record(event);
    if (this.recordPresentationEvents) this.presentationEvents.push(event);
  }
}
