import type Decimal from 'break_eternity.js';
import type { EngineConfig } from '../config';
import type { ContentCatalog } from '../../content/types';
import { requireEnemy } from '../../content/catalog';
import { GEAR_SLOT_ORDER } from '../gear/GearCatalog';
import { compileGearStats, gearDisplayData } from '../gear/GearSystem';
import type { GameState } from '../model';
import { big, quantity } from '../numbers';
import { compileSpell } from '../spell/SpellCompiler';
import { spellPointCost } from '../spellTree/SpellTreeCatalog';
import {
  maxAllocatableSpellPoints,
  totalSpellPoints,
  unspentSpellPoints,
} from '../spellTree/SpellTreeSystem';
import type { LastSummonSnapshot, ResourceKind, SimulationSnapshot } from '../types';
import type { ChronicleLine } from '../events/Chronicle';
import { buildCompanionSnapshots } from './CompanionSnapshotBuilder';
import { wizardPerHit } from '../companions/CompanionCombat';
import { masteryMultiplier, previewMastery } from '../prestige/Mastery';
// prettier-ignore
import { effectiveCastInterval, hasArrived, livingByDistance } from '../combat/SpellCombatState';

export interface SimulationSnapshotBuildContext {
  state: GameState;
  config: EngineConfig;
  catalog: ContentCatalog;
  canRebirth: boolean;
  rebirthKnowledgeGain: Decimal;
  nextKnowledgeStage: number;
  lastSummon: LastSummonSnapshot | null;
  chronicle: readonly ChronicleLine[];
  income: Readonly<Record<ResourceKind, Decimal | null>>;
  stagesPerSecond: Decimal | null;
}

export function buildSimulationSnapshot({
  state,
  config,
  catalog,
  canRebirth,
  rebirthKnowledgeGain,
  nextKnowledgeStage,
  lastSummon,
  chronicle,
  income,
  stagesPerSecond,
}: SimulationSnapshotBuildContext): SimulationSnapshot {
  const run = state.run;
  // The same enemy the spell is aimed at, or the readout names one thing while
  // the mage shoots another.
  const target = livingByDistance(run)[0];
  const compiledSpell = compileSpell(run.spell);
  const gearStats = compileGearStats(state.equipment);
  // One definition, shared with combat, so what a companion hits for and what
  // this surface reports cannot drift apart again.
  const finalDamage = wizardPerHit(run, state.equipment, masteryMultiplier(state.meta));
  const enemyHpPercent =
    target && target.maxHp.cmp(0) > 0 ? percent(target.hp.div(target.maxHp).toNumber()) : 0;
  const mageHpPercent = run.mage.maxHp.cmp(0) > 0 ? percent(run.mage.hp.div(run.mage.maxHp).toNumber()) : 0;
  // Companion power is a share of what the mage actually hits for, so the
  // read model is derived from the same figure the HUD shows.
  const companionSnapshots = buildCompanionSnapshots(state, finalDamage);

  return {
    ...companionSnapshots,
    lastSummon,
    spellMechanics: compiledSpell.mechanics ? { ...compiledSpell.mechanics } : undefined,
    combatState: run.combatState ? structuredClone(run.combatState) : undefined,
    elapsedSeconds: run.elapsedSeconds,
    stage: run.frontierStage,
    encounterStage: run.encounterStage,
    zone: run.zoneNumber,
    zoneName: run.zoneName,
    /*
     * How far into the zone the run is. The same arithmetic `resolveZone` does
     * for the name, on the same stage it does it for, so the two can never
     * disagree about which zone they are describing.
     */
    zoneStage: ((Math.max(1, run.mode === 'push' ? run.frontierStage : run.farmStage) - 1) % config.zoneLength) + 1,
    zoneLength: config.zoneLength,
    mode: run.mode,
    farmStage: run.farmStage,
    farmKillsSinceFailure: run.farmKillsSinceFailure,
    essence: quantity(run.essence),
    knowledge: quantity(state.meta.knowledge),
    gold: quantity(state.equipment.gold),
    mageHp: quantity(run.mage.hp),
    mageMaxHp: quantity(run.mage.maxHp),
    mageHpPercent,
    enemyHp: quantity(target?.hp ?? big(0)),
    enemyMaxHp: quantity(target?.maxHp ?? big(0)),
    enemyHpPercent,
    enemyName: target?.name ?? (run.phase === 'combat' ? 'Incoming…' : 'Road ahead'),
    enemies: run.enemies.map((enemy) => ({
      position: enemy.position ? { ...enemy.position } : undefined,
      statuses: enemy.statuses ? structuredClone(enemy.statuses) : undefined,
      instanceId: enemy.instanceId,
      modelKey: requireEnemy(catalog, enemy.definitionId).modelKey,
      name: enemy.name,
      boss: enemy.boss,
      hp: quantity(enemy.hp),
      maxHp: quantity(enemy.maxHp),
      hpPercent: enemy.maxHp.cmp(0) > 0 ? percent(enemy.hp.div(enemy.maxHp).toNumber()) : 0,
      approaching: !hasArrived(enemy, config.enemyAttackRange),
    })),
    encounterTotalEnemies: run.encounter?.totalEnemies ?? 0,
    encounterSpawnedEnemies: run.encounter?.spawnedEnemies ?? 0,
    encounterAliveEnemies: run.enemies.length,
    spawnInterval: run.encounter?.spawnInterval ?? config.enemySpawnInterval,
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
    castInterval: effectiveCastInterval(run, compiledSpell),
    critChance: compiledSpell.critChance,
    critMultiplier: compiledSpell.critMultiplier,
    pierceTargets: compiledSpell.pierceTargets,
    splashTargets: compiledSpell.splashTargets,
    splashDamageMultiplier: compiledSpell.splashDamageMultiplier,
    chainTargets: compiledSpell.chainTargets,
    chainDamageMultiplier: compiledSpell.chainDamageMultiplier,
    controlDelaySeconds: compiledSpell.controlDelaySeconds,
    leechFraction: compiledSpell.leechFraction,
    spellTreePurchasedPoints: state.spellTree.purchasedPoints,
    spellTreeTotalPoints: totalSpellPoints(state.spellTree),
    spellTreeUnspentPoints: unspentSpellPoints(state.spellTree),
    nextSpellPointCost: quantity(big(spellPointCost(state.spellTree.purchasedPoints))),
    spellTreeMaxPoints: maxAllocatableSpellPoints(state.spellTree.attunements),
    ownedAttunementIds: [...state.spellTree.attunements],
    activeSpellNodeIds: [...state.spellTree.activatedNodeIds],
    progressToNextEncounter:
      run.phase === 'travel' ? Math.min(1, run.travelElapsed / config.travelSeconds) : 1,
    highestStageEver: state.meta.highestStageEver,
    rebirths: state.meta.rebirths,
    storyFlags: [...state.meta.storyFlags],
    canRebirth,
    rebirthKnowledgeGain: quantity(rebirthKnowledgeGain),
    lifetimeKnowledge: quantity(state.meta.lifetimeKnowledge),
    mastery: quantity(masteryMultiplier(state.meta)),
    masteryAfterRebirth: quantity(previewMastery(state.meta, rebirthKnowledgeGain)),
    nextKnowledgeStage,
    gear: GEAR_SLOT_ORDER.map((slot) => {
      const data = gearDisplayData(state.equipment, slot);
      return {
        ...data,
        contribution: quantity(data.contribution),
        nextLevelGain: quantity(data.nextLevelGain),
        nextLevelCost: quantity(data.nextLevelCost),
      };
    }),
    chronicle,
    income: {
      gold: income.gold && quantity(income.gold),
      essence: income.essence && quantity(income.essence),
      knowledge: income.knowledge && quantity(income.knowledge),
      starlight: income.starlight && quantity(income.starlight),
    },
    /*
     * An hour rather than a second, because a stage takes minutes: 0.004 a
     * second is a number nobody can hold, and 14 an hour is a pace.
     */
    stagesPerHour: stagesPerSecond === null ? null : stagesPerSecond.mul(3600).toNumber(),
  };
}

function percent(ratio: number): number {
  return Math.max(0, Math.min(1, ratio)) * 100;
}
