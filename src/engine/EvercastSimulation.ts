import type { ContentCatalog } from '../content/types';
import { createDefaultCatalog, validateCatalog } from '../content/catalog';
import { CombatSystem } from './combat/CombatSystem';
import type { EngineConfig } from './config';
import { DEFAULT_ENGINE_CONFIG } from './config';
import { EncounterSystem } from './encounters/EncounterSystem';
import { EventBus } from './events/EventBus';
import type { GameEvent } from './events/GameEvent';
import { GearSystem, compileGearStats, gearDisplayData } from './gear/GearSystem';
import { GEAR_SLOT_ORDER } from './gear/GearCatalog';
import type { EnemyState, GameState } from './model';
import { big, quantity } from './numbers';
import { ProgressionSystem } from './progression/ProgressionSystem';
import { RebirthSystem } from './prestige/RebirthSystem';
import { compileSpell } from './spell/SpellCompiler';
import { spellPointCost } from './spellTree/SpellTreeCatalog';
import { SpellTreeSystem, totalSpellPoints, unspentSpellPoints } from './spellTree/SpellTreeSystem';
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
    const run = this.state.run;
    const target = run.enemies[0];
    const compiledSpell = compileSpell(run.spell);
    const gearStats = compileGearStats(this.state.equipment);
    const finalDamage = big(compiledSpell.damage).add(gearStats.baseDamageBonus);
    const enemyHpPercent = target && target.maxHp.cmp(0) > 0
      ? Math.max(0, Math.min(1, target.hp.div(target.maxHp).toNumber())) * 100
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
      gold: quantity(this.state.equipment.gold),
      mageHp: quantity(run.mage.hp),
      mageMaxHp: quantity(run.mage.maxHp),
      mageHpPercent,
      enemyHp: quantity(target?.hp ?? big(0)),
      enemyMaxHp: quantity(target?.maxHp ?? big(0)),
      enemyHpPercent,
      enemyName: target?.name ?? (run.phase === 'combat' ? 'Incoming…' : 'Road ahead'),
      enemies: run.enemies.map((enemy) => ({
        instanceId: enemy.instanceId,
        name: enemy.name,
        boss: enemy.boss,
        hp: quantity(enemy.hp),
        maxHp: quantity(enemy.maxHp),
        hpPercent: enemy.maxHp.cmp(0) > 0
          ? Math.max(0, Math.min(1, enemy.hp.div(enemy.maxHp).toNumber())) * 100
          : 0,
      })),
      encounterTotalEnemies: run.encounter?.totalEnemies ?? 0,
      encounterSpawnedEnemies: run.encounter?.spawnedEnemies ?? 0,
      encounterAliveEnemies: run.enemies.length,
      spawnInterval: run.encounter?.spawnInterval ?? this.config.enemySpawnInterval,
      phase: run.phase,
      boss: run.encounter?.bossStage ?? false,
      casts: run.stats.casts,
      kills: run.stats.kills,
      deaths: run.stats.deaths,
      projectileCount: compiledSpell.projectileCount,
      damagePerProjectile: quantity(finalDamage),
      spellBaseDamage: quantity(big(compiledSpell.damage)),
      gearDamageBonus: quantity(gearStats.baseDamageBonus),
      gearHealthBonus: quantity(gearStats.maxHpBonus),
      castInterval: compiledSpell.castInterval,
      critChance: compiledSpell.critChance,
      critMultiplier: compiledSpell.critMultiplier,
      pierceTargets: compiledSpell.pierceTargets,
      splashTargets: compiledSpell.splashTargets,
      splashDamageMultiplier: compiledSpell.splashDamageMultiplier,
      chainTargets: compiledSpell.chainTargets,
      chainDamageMultiplier: compiledSpell.chainDamageMultiplier,
      controlDelaySeconds: compiledSpell.controlDelaySeconds,
      leechFraction: compiledSpell.leechFraction,
      spellTreePurchasedPoints: this.state.spellTree.purchasedPoints,
      spellTreeTotalPoints: totalSpellPoints(this.state.spellTree),
      spellTreeUnspentPoints: unspentSpellPoints(this.state.spellTree),
      nextSpellPointCost: quantity(big(spellPointCost(this.state.spellTree.purchasedPoints))),
      activeSpellNodeIds: [...this.state.spellTree.activatedNodeIds],
      progressToNextEncounter: run.phase === 'travel'
        ? Math.min(1, run.travelElapsed / this.config.travelSeconds)
        : 1,
      highestStageEver: this.state.meta.highestStageEver,
      rebirths: this.state.meta.rebirths,
      canRebirth: this.rebirthSystem.canRebirth(this.state),
      gear: GEAR_SLOT_ORDER.map((slot) => {
        const data = gearDisplayData(this.state.equipment, slot);
        return {
          ...data,
          contribution: quantity(data.contribution),
          nextLevelCost: quantity(data.nextLevelCost),
        };
      }),
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
    this.lastEvent = describeEvent(event);
    if (this.recordPresentationEvents) this.presentationEvents.push(event);
  }
}

function describeEvent(event: GameEvent): string {
  switch (event.type) {
    case 'encounter_started':
      return `Stage ${event.stage}: ${event.totalEnemies} incoming.`;
    case 'enemy_spawned':
      return `${event.enemyName} enters (${event.spawned}/${event.total}).`;
    case 'spell_cast':
      return `Arcane Bolt cast (${event.projectiles} projectile${event.projectiles === 1 ? '' : 's'}).`;
    case 'projectile_hit':
      return `${event.critical ? 'Critical! ' : ''}Arcane Bolt hits for ${event.damage}.`;
    case 'enemy_attack':
      return `An enemy hits for ${event.damage}.`;
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
    case 'gear_leveled':
      return `${event.slot} reached gear level ${event.level}.`;
    case 'gear_evolved':
      return `${event.name} evolved at gear level ${event.level}.`;
    case 'spell_point_purchased':
      return `Evercast absorbs ${event.cost} Essence. +1 Spell Point.`;
    case 'spell_node_activated':
      return `${event.nodeName} awakened.`;
    case 'spell_tree_respecced':
      return `Evercast reshaped. ${event.refundedPoints} point${event.refundedPoints === 1 ? '' : 's'} returned.`;
    case 'rebirth_performed':
      return `Rebirth ${event.rebirths}: +${event.knowledgeGained} Knowledge.`;
  }
}
