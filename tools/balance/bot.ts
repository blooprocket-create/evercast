/**
 * The greedy bot the balance harnesses share.
 *
 * Extracted from `sweep.test.ts` when a second harness needed the same player:
 * any question about how the game *feels* at a given depth has to be asked of a
 * run whose power matches the curve at that depth, and the only honest source
 * of that is a bot that bought its way there. Hand-picked gear levels are not a
 * substitute - the first attempt at measuring Surge frequency used them, and
 * every figure it produced was wrong by an order of magnitude.
 *
 * Measurement only. Nothing in `src/` may import from here.
 */
import type Decimal from 'break_eternity.js';
import { EvercastSimulation } from '../../src/engine/EvercastSimulation';
// prettier-ignore
import { compileGearStats, createInitialEquipmentState, gearLevelCost } from '../../src/engine/gear/GearSystem';
import { GEAR_DEFINITIONS, GEAR_SLOT_ORDER } from '../../src/engine/gear/GearCatalog';
import type { GearSlot } from '../../src/engine/gear/types';
import { SPELL_ATTUNEMENTS, SPELL_TREE_NODES } from '../../src/content/spellTree';
import { big } from '../../src/engine/numbers';

export const TICK_SECONDS = 0.25;

/** The bot's one piece of memory: whether the next purchase leans defensive. */
export interface BotState {
  wantHp: boolean;
}

export function createBot(): BotState {
  return { wantHp: false };
}

/**
 * What one more level of a slot is worth, read out of the engine rather than
 * recomputed. A linear curve makes this a constant and a geometric one makes it
 * grow; the bot does not need to know which. Memoized because the same
 * (slot, level) is asked on every tick until it becomes affordable.
 */
const marginalCache = new Map<string, Decimal>();

export function contributionOf(slot: GearSlot, level: number): Decimal {
  // Every other slot sits at level 1 and contributes nothing, so the compiled
  // stat is this slot's contribution alone.
  const equipment = createInitialEquipmentState();
  equipment.pieces[slot].level = level;
  const stats = compileGearStats(equipment);
  return GEAR_DEFINITIONS[slot].primaryStat === 'baseDamage' ? stats.baseDamageBonus : stats.maxHpBonus;
}

export function marginalGain(slot: GearSlot, level: number): Decimal {
  const key = `${slot}:${level}`;
  const cached = marginalCache.get(key);
  if (cached) return cached;
  const value = contributionOf(slot, level + 1).sub(contributionOf(slot, level));
  marginalCache.set(key, value);
  return value;
}

export function bestBuy(simulation: EvercastSimulation, want: 'baseDamage' | 'maxHp'): GearSlot | null {
  const { equipment } = simulation.getState();
  let best: GearSlot | null = null;
  let bestEfficiency: Decimal = big(0);
  for (const slot of GEAR_SLOT_ORDER) {
    if (GEAR_DEFINITIONS[slot].primaryStat !== want) continue;
    const level = equipment.pieces[slot].level;
    const cost = gearLevelCost(slot, level);
    if (equipment.gold.cmp(cost) < 0) continue;
    const efficiency = marginalGain(slot, level).div(cost);
    if (efficiency.cmp(bestEfficiency) > 0) {
      bestEfficiency = efficiency;
      best = slot;
    }
  }
  return best;
}

/** Spend everything affordable, alternating offence and defence. */
export function spendGold(simulation: EvercastSimulation, state: BotState): void {
  for (let guard = 0; guard < 500; guard += 1) {
    const first = state.wantHp ? 'maxHp' : 'baseDamage';
    const second = state.wantHp ? 'baseDamage' : 'maxHp';
    const slot = bestBuy(simulation, first) ?? bestBuy(simulation, second);
    if (!slot) return;
    simulation.execute({ type: 'level_gear', slot });
    state.wantHp = !state.wantHp;
  }
}

/** Essence into the tree, Knowledge into attunements, Starlight into the party. */
export function developBuild(simulation: EvercastSimulation): void {
  while (simulation.execute({ type: 'buy_spell_point' }));
  for (let pass = 0; pass < 3; pass += 1) {
    let progressed = false;
    for (const node of SPELL_TREE_NODES) {
      if (simulation.execute({ type: 'activate_spell_node', nodeId: node.id })) progressed = true;
    }
    if (!progressed) break;
  }
  for (const attunement of SPELL_ATTUNEMENTS) {
    simulation.execute({ type: 'buy_attunement', attunementId: attunement.id });
  }
  while (simulation.execute({ type: 'summon_draw', count: 10 }));

  const owned = Object.keys(simulation.getState().companions.owned);
  for (const definitionId of owned) simulation.execute({ type: 'ascend_companion', definitionId });
  const { party } = simulation.getState().companions;
  for (let slot = 0; slot < 5; slot += 1) {
    if (party[slot]) continue;
    for (const definitionId of owned) {
      if (party.includes(definitionId)) continue;
      if (simulation.execute({ type: 'equip_companion', definitionId, slot })) break;
    }
  }
}

export function play(simulation: EvercastSimulation, state: BotState): void {
  simulation.advance(TICK_SECONDS, { presentationEvents: false });
  spendGold(simulation, state);
  developBuild(simulation);
}
