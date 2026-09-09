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
import { totalSpellPoints, unspentSpellPoints } from '../spellTree/SpellTreeSystem';
import type { SimulationSnapshot } from '../types';
import { effectiveCastInterval, inAttackRange } from '../combat/SpellCombatState';

export interface SimulationSnapshotBuildContext {
  state: GameState;
  config: EngineConfig;
  catalog: ContentCatalog;
  canRebirth: boolean;
  rebirthKnowledgeGain: Decimal;
  lastEvent: string;
}

export function buildSimulationSnapshot({
  state,
  config,
  catalog,
  canRebirth,
  rebirthKnowledgeGain,
  lastEvent,
}: SimulationSnapshotBuildContext): SimulationSnapshot {
  const run = state.run;
  const target = run.enemies[0];
  const compiledSpell = compileSpell(run.spell);
  const gearStats = compileGearStats(state.equipment);
  const finalDamage = big(compiledSpell.damage)
    .add(gearStats.baseDamageBonus)
    .mul(compiledSpell.mechanics?.route === 'charged' ? compiledSpell.mechanics.chargedDamage : 1);
  const enemyHpPercent =
    target && target.maxHp.cmp(0) > 0 ? percent(target.hp.div(target.maxHp).toNumber()) : 0;
  const mageHpPercent = run.mage.maxHp.cmp(0) > 0 ? percent(run.mage.hp.div(run.mage.maxHp).toNumber()) : 0;

  return {
    spellMechanics: compiledSpell.mechanics ? { ...compiledSpell.mechanics } : undefined,
    combatState: run.combatState ? structuredClone(run.combatState) : undefined,
    elapsedSeconds: run.elapsedSeconds,
    stage: run.frontierStage,
    encounterStage: run.encounterStage,
    zone: run.zoneNumber,
    zoneName: run.zoneName,
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
      approaching: !inAttackRange(enemy, config.enemyAttackRange),
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
    activeSpellNodeIds: [...state.spellTree.activatedNodeIds],
    progressToNextEncounter:
      run.phase === 'travel' ? Math.min(1, run.travelElapsed / config.travelSeconds) : 1,
    highestStageEver: state.meta.highestStageEver,
    rebirths: state.meta.rebirths,
    canRebirth,
    rebirthKnowledgeGain: quantity(rebirthKnowledgeGain),
    gear: GEAR_SLOT_ORDER.map((slot) => {
      const data = gearDisplayData(state.equipment, slot);
      return {
        ...data,
        contribution: quantity(data.contribution),
        nextLevelCost: quantity(data.nextLevelCost),
      };
    }),
    lastEvent,
  };
}

function percent(ratio: number): number {
  return Math.max(0, Math.min(1, ratio)) * 100;
}
