import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { GEAR_DEFINITIONS, GEAR_SLOT_ORDER } from '../gear/GearCatalog';
import { compileGearStats, createInitialEquipmentState, equivalentGearLevel } from '../gear/GearSystem';
import { createInitialGameState } from '../state';
import { CURRENT_SAVE_VERSION, SaveCodec } from './SaveCodec';

/**
 * v9 made a gear level multiply rather than add, which means a level saved under
 * the old rule describes a different amount of power than the same number does
 * now. Reading one through the other does not rebalance it, it detonates it: a
 * level-201 staff was worth 200 damage and the same level on the new curve is
 * worth about ten million.
 *
 * So the migration converts the level, and what it has to conserve is the power
 * the player actually had. These are the tests for that - not for the level,
 * which is expected to move a long way.
 */
const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);

/** What a level was worth under the additive curve v9 replaced. */
function oldAdditivePower(statPerLevel: number, level: number): number {
  return statPerLevel * Math.max(0, level - 1);
}

function decodeAsVersion(levels: Partial<Record<(typeof GEAR_SLOT_ORDER)[number], number>>, version: number) {
  const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
  for (const [slot, level] of Object.entries(levels)) {
    state.equipment.pieces[slot as (typeof GEAR_SLOT_ORDER)[number]].level = level as number;
  }
  const envelope = JSON.parse(JSON.stringify(codec.encode(state))) as { version: number };
  envelope.version = version;
  return codec.decode(envelope).state;
}

describe('v9 gear level migration', () => {
  it('converts the documented reference save to the documented levels', () => {
    // The stage-56 save the design was validated against: 201s and 151s.
    expect(equivalentGearLevel(201)).toBe(41);
    expect(equivalentGearLevel(151)).toBe(37);
    expect(equivalentGearLevel(1000)).toBe(64);
    expect(equivalentGearLevel(500)).toBe(54);
  });

  it('leaves an unlevelled piece alone', () => {
    // Level 1 is worth nothing on either curve, so there is nothing to convert
    // and a fresh save must not drift.
    expect(equivalentGearLevel(1)).toBe(1);
    expect(equivalentGearLevel(0)).toBe(1);
    expect(equivalentGearLevel(-5)).toBe(1);
  });

  it('leaves the anchor level alone, because both curves agree there', () => {
    // Level 2 is worth exactly statPerLevel under either rule.
    expect(equivalentGearLevel(2)).toBe(2);
  });

  it('preserves what every slot was actually contributing', () => {
    const levels = Object.fromEntries(GEAR_SLOT_ORDER.map((slot) => [slot, 201]));
    const migrated = decodeAsVersion(levels, 8);

    for (const slot of GEAR_SLOT_ORDER) {
      const equipment = createInitialEquipmentState();
      equipment.pieces[slot].level = migrated.equipment.pieces[slot].level;
      const stats = compileGearStats(equipment);
      const definition = GEAR_DEFINITIONS[slot];
      const now =
        definition.primaryStat === 'baseDamage' ? stats.baseDamageBonus : stats.maxHpBonus;

      expect(migrated.equipment.pieces[slot].level).toBe(41);
      expect(now.toNumber() / oldAdditivePower(definition.statPerLevel, 201)).toBeCloseTo(1, 2);
    }
  });

  /**
   * The converted level has to be a whole number while the curve it lands on
   * moves in seven-percent steps, so conversion cannot be exact and several old
   * levels can share one new one. The error is therefore bounded by about half a
   * step, and this pins that rather than pretending it is zero.
   *
   * Measured: 11.2% worst overall, at level 6, where the whole quantity is five
   * damage and the absolute error is half a point. Above level 50 - anywhere a
   * real save lives - it is 4.1% at worst, and the reference save's own levels
   * land at 0.18% and 0.72%.
   *
   * `statPerLevel` cancels out of the conversion, so this holds for every slot.
   */
  it('keeps the rounding error bounded, and small where real saves live', () => {
    let worstOverall = 0;
    let worstAboveFifty = 0;

    for (let level = 2; level <= 1000; level += 1) {
      const converted = equivalentGearLevel(level);
      const paid = converted - 1;
      const nowPerUnit = (Math.pow(1.07, paid) - 1) / 0.07;
      const drift = Math.abs(nowPerUnit / oldAdditivePower(1, level) - 1);
      worstOverall = Math.max(worstOverall, drift);
      if (level >= 50) worstAboveFifty = Math.max(worstAboveFifty, drift);
    }

    expect(worstOverall).toBeLessThan(0.12);
    expect(worstAboveFifty).toBeLessThan(0.05);
  });

  it('does not convert a save that has already been converted', () => {
    const once = decodeAsVersion({ staff: 201 }, 8);
    expect(once.equipment.pieces.staff.level).toBe(41);

    // Re-encoding stamps the current version, so decoding it again must be a
    // no-op. Converting twice would quietly halve a player's gear on every load.
    const twice = codec.decode(JSON.parse(JSON.stringify(codec.encode(once)))).state;
    expect(twice.equipment.pieces.staff.level).toBe(41);

    const thrice = codec.decode(JSON.parse(JSON.stringify(codec.encode(twice)))).state;
    expect(thrice.equipment.pieces.staff.level).toBe(41);
  });

  it('leaves a current-version save untouched', () => {
    const current = decodeAsVersion({ staff: 201, robe: 77 }, CURRENT_SAVE_VERSION);
    expect(current.equipment.pieces.staff.level).toBe(201);
    expect(current.equipment.pieces.robe.level).toBe(77);
  });
});
