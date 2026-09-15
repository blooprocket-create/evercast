import type Decimal from 'break_eternity.js';
import { GEAR_DEFINITIONS, GEAR_SLOT_ORDER } from '../gear/GearCatalog';
import { compileGearStats, createInitialEquipmentState, gearLevelCost } from '../gear/GearSystem';
import type { EquipmentState, GearPrimaryStat, GearSlot } from '../gear/types';
import type { GameState } from '../model';
import { big } from '../numbers';

/**
 * The hands the premise promised.
 *
 * Evercast's opening line is "Nothing here needs your hands", and until this
 * module that was not true past the first hour: the whole of the gold economy
 * was a button, tapped a few hundred times a stage. Automation in an idle game
 * is not a reward to be unlocked - it is the genre's baseline, and its absence
 * is what turns hour three into work.
 *
 * The rule that decides what belongs here, and the one to hold when adding to
 * it:
 *
 * **Automate what has one right answer. Never automate what has a build
 * behind it.**
 *
 * So gold, Spell Points and shards are here - in each case there is a single
 * best move and the player was only being asked to perform it. Activating a
 * spell node is NOT here, and must not be: the routes are exclusive, a
 * capstone is a choice, and a game that picked the tree for you would have
 * automated away the only thing Evercast is about. Party slots are out for
 * the same reason.
 */

export type AutomationKey = 'gear' | 'spellPoints' | 'summon' | 'ascend';

export type AutomationSettings = Record<AutomationKey, boolean>;

/**
 * What a new save starts with, and why each one.
 *
 * Gold, points and shards default on because handing them over costs the
 * player no decision they were making. Summoning defaults *off* on the
 * opposite reasoning: the reveal is content, not friction, and a player who
 * would rather keep opening them by hand should not have to notice a setting
 * to keep doing so. Turning it on is them saying they would rather the
 * Starlight were simply spent.
 */
export const DEFAULT_AUTOMATION: AutomationSettings = {
  gear: true,
  spellPoints: true,
  summon: false,
  ascend: true,
};

export const AUTOMATION_KEYS = Object.keys(DEFAULT_AUTOMATION) as AutomationKey[];

/**
 * How many gear levels one pass may buy.
 *
 * The geometric cost curve does most of the bounding by itself - gold buys
 * levels in `log(gold)`, so even an absurd pile converges in tens of
 * iterations, not millions. This is the backstop for the case the curve does
 * not cover, and it is generous: automation runs before every encounter, so
 * anything left over is bought a few seconds later.
 */
export const AUTOMATION_BUY_LIMIT = 400;

/**
 * The best level to buy right now, as marginal stat per gold.
 *
 * Exported because `tools/balance/` buys the same way: the harness used to
 * carry its own copy of this, which meant the curve was measured against a
 * player the game did not actually have. One definition means a balance run
 * now measures what automation really does.
 */
export function bestGearPurchase(
  equipment: EquipmentState,
  want: GearPrimaryStat,
): GearSlot | null {
  let best: GearSlot | null = null;
  let bestEfficiency = big(0);
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

/**
 * What one more level of a slot is worth, read out of the engine rather than
 * recomputed. A linear curve makes this a constant and a geometric one makes
 * it grow; nothing here needs to know which. Memoized because the same
 * (slot, level) is asked on every pass until it becomes affordable.
 */
const marginalCache = new Map<string, Decimal>();

function contributionOf(slot: GearSlot, level: number): Decimal {
  // Every other slot sits at level 1 and contributes nothing, so the compiled
  // stat is this slot's contribution alone.
  const equipment = createInitialEquipmentState();
  equipment.pieces[slot].level = level;
  const stats = compileGearStats(equipment);
  return GEAR_DEFINITIONS[slot].primaryStat === 'baseDamage'
    ? stats.baseDamageBonus
    : stats.maxHpBonus;
}

function marginalGain(slot: GearSlot, level: number): Decimal {
  const key = `${slot}:${level}`;
  const cached = marginalCache.get(key);
  if (cached) return cached;
  const value = contributionOf(slot, level + 1).sub(contributionOf(slot, level));
  marginalCache.set(key, value);
  return value;
}

/** What the coordinator hands over, so this module needs none of those systems. */
export interface AutomationHooks {
  levelGear(state: GameState, slot: GearSlot): boolean;
  buySpellPoint(state: GameState): boolean;
  /** Draws without touching the reveal overlay - see `run`. */
  drawSummon(state: GameState, count: number): boolean;
  ascendCompanion(state: GameState, definitionId: string): boolean;
  syncCompanions(state: GameState): void;
}

export class AutomationSystem {
  constructor(private readonly hooks: AutomationHooks) {}

  /**
   * One pass, run as an encounter is created.
   *
   * That call site is the whole determinism story. Automation changes the
   * mage's damage, which changes when the next enemy dies - so it cannot fire
   * at a moment that depends on how `advance` was chunked, or a run simulated
   * in one pass and the same run simulated in frames would diverge. An
   * encounter being created is already an event the loop stops on, and both
   * the cleared path and the defeated path route through travel to reach it,
   * so one hook covers every way a fight can end.
   *
   * It is also when a player would have done this anyway: you kit up between
   * fights, not mid-swing.
   */
  run(state: GameState): void {
    const settings = state.meta.automation;
    if (settings.gear) this.spendGold(state);
    if (settings.spellPoints) this.buyPoints(state);
    if (settings.summon) this.summon(state);
    if (settings.ascend) this.ascend(state);
  }

  /**
   * Spends what is affordable, alternating offence and defence.
   *
   * The alternation is deliberately the same policy the balance harness has
   * always used, because the shipping curve in `PROGRESSION_CURVE_V1.md` was
   * measured against it - a different spending rule here would quietly
   * invalidate every figure printed there.
   *
   * `wantHp` persists on the run rather than resetting each pass: a pass that
   * can afford exactly one level would otherwise buy damage every time and
   * never a point of health.
   */
  private spendGold(state: GameState): void {
    for (let bought = 0; bought < AUTOMATION_BUY_LIMIT; bought += 1) {
      const wantHp = state.run.automationWantHp ?? false;
      const first: GearPrimaryStat = wantHp ? 'maxHp' : 'baseDamage';
      const second: GearPrimaryStat = wantHp ? 'baseDamage' : 'maxHp';
      const slot =
        bestGearPurchase(state.equipment, first) ?? bestGearPurchase(state.equipment, second);
      if (!slot || !this.hooks.levelGear(state, slot)) return;
      state.run.automationWantHp = !wantHp;
    }
  }

  /** Essence into points. Never into nodes - see the note at the top. */
  private buyPoints(state: GameState): void {
    for (let bought = 0; bought < AUTOMATION_BUY_LIMIT; bought += 1) {
      if (!this.hooks.buySpellPoint(state)) return;
    }
  }

  /**
   * Ten at a time, and never through `execute`.
   *
   * Ten pulls cost nine, so a single draw is never the better move. Routing
   * around the command seam is the point rather than an oversight: `execute`
   * records the draw for the reveal overlay, and an overlay that threw itself
   * across the screen every few seconds unprompted would be the worst thing in
   * the game. The Chronicle still records what arrived.
   */
  private summon(state: GameState): void {
    for (let drawn = 0; drawn < AUTOMATION_BUY_LIMIT; drawn += 1) {
      if (!this.hooks.drawSummon(state, 10)) return;
    }
    this.hooks.syncCompanions(state);
  }

  /** Shards on a companion you already own buy a star. There is no other use. */
  private ascend(state: GameState): void {
    let ascended = false;
    for (const definitionId of Object.keys(state.companions.owned)) {
      // Repeats until the companion refuses, so banked shards worth several
      // stars are not paid out one encounter at a time.
      while (this.hooks.ascendCompanion(state, definitionId)) ascended = true;
    }
    if (ascended) this.hooks.syncCompanions(state);
  }
}

/**
 * Wires the system to the engine it drives.
 *
 * Here rather than in `EvercastSimulation` so the coordinator stays a
 * coordinator - the architecture suite enforces that with a line count, and it
 * is right to: this is four systems' worth of knowledge and none of it is
 * about coordinating anything.
 *
 * Note what `drawSummon` does *not* do. Every other caller reaches the gacha
 * through `execute`, which also records the draw for the reveal overlay.
 * Automation goes around that on purpose: an overlay thrown across the screen
 * every few seconds unprompted would be the worst thing in the game. The
 * Chronicle still records what arrived.
 */
export function createAutomationSystem(systems: {
  gear: { levelUp(state: GameState, slot: GearSlot): boolean };
  spellTree: { buyPoint(state: GameState): boolean };
  gacha: { draw(state: GameState, count: number): unknown };
  companions: {
    ascend(state: GameState, definitionId: string): boolean;
    sync(state: GameState): void;
  };
}): AutomationSystem {
  return new AutomationSystem({
    levelGear: (state, slot) => {
      const levelled = systems.gear.levelUp(state, slot);
      // Companion health is a share of the mage's, so a gear level that raises
      // her maximum raises theirs in the same breath.
      if (levelled) systems.companions.sync(state);
      return levelled;
    },
    buySpellPoint: (state) => systems.spellTree.buyPoint(state),
    drawSummon: (state, count) => systems.gacha.draw(state, count) !== null,
    ascendCompanion: (state, definitionId) => systems.companions.ascend(state, definitionId),
    syncCompanions: (state) => systems.companions.sync(state),
  });
}
