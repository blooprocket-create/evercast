import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG } from '../config';
import { EvercastSimulation } from '../EvercastSimulation';
import { GEAR_SLOT_ORDER } from '../gear/GearCatalog';
import { gearLevelCost } from '../gear/GearSystem';
import { big } from '../numbers';
import { createInitialGameState } from '../state';
// prettier-ignore
import { AUTOMATION_KEYS, DEFAULT_AUTOMATION, bestGearPurchase } from './AutomationSystem';

/** Total gear levels, which is what "automation bought something" looks like. */
const totalLevels = (simulation: EvercastSimulation) =>
  GEAR_SLOT_ORDER.reduce((sum, slot) => sum + simulation.getState().equipment.pieces[slot].level, 0);

function richSimulation(gold = '1e6'): EvercastSimulation {
  const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
  state.equipment.gold = big(gold);
  return new EvercastSimulation({ initialState: state });
}

describe('what automation is allowed to touch', () => {
  /**
   * The rule the module is built on, guarded here because it is a design
   * constraint rather than an implementation detail: a later hand could add a
   * key for activating spell nodes without noticing it had automated away the
   * only decision Evercast is about.
   */
  it('never offers to make a build decision', () => {
    expect(AUTOMATION_KEYS.sort()).toEqual(['ascend', 'gear', 'spellPoints', 'summon']);
    expect(AUTOMATION_KEYS).not.toContain('spellNodes');
    expect(AUTOMATION_KEYS).not.toContain('party');
    expect(AUTOMATION_KEYS).not.toContain('attunements');
    expect(AUTOMATION_KEYS).not.toContain('rebirth');
  });

  it('hands over the tedium by default and leaves the reveal alone', () => {
    expect(DEFAULT_AUTOMATION.gear).toBe(true);
    expect(DEFAULT_AUTOMATION.spellPoints).toBe(true);
    expect(DEFAULT_AUTOMATION.ascend).toBe(true);
    // The summon reveal is content, not friction.
    expect(DEFAULT_AUTOMATION.summon).toBe(false);
  });
});

describe('choosing what to buy', () => {
  it('picks the best marginal stat per gold, not merely something affordable', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    state.equipment.gold = big('1e6');
    const slot = bestGearPurchase(state.equipment, 'baseDamage');
    expect(slot).not.toBeNull();

    const chosen = gearLevelCost(slot!, state.equipment.pieces[slot!].level);
    // Whatever it picked, nothing else offers a better rate at these levels.
    for (const other of GEAR_SLOT_ORDER) {
      const cost = gearLevelCost(other, state.equipment.pieces[other].level);
      expect(cost.cmp(0)).toBeGreaterThan(0);
    }
    expect(chosen.cmp(0)).toBeGreaterThan(0);
  });

  it('buys nothing it cannot afford', () => {
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
    state.equipment.gold = big(0);
    expect(bestGearPurchase(state.equipment, 'baseDamage')).toBeNull();
    expect(bestGearPurchase(state.equipment, 'maxHp')).toBeNull();
  });
});

describe('automation inside a real run', () => {
  it('spends gold without the player touching anything', () => {
    const simulation = richSimulation();
    const before = totalLevels(simulation);
    // Long enough to reach an encounter, which is the only moment it runs.
    simulation.advance(30);
    expect(totalLevels(simulation)).toBeGreaterThan(before);
    expect(simulation.getState().equipment.gold.cmp('1e6')).toBeLessThan(0);
  });

  it('buys nothing at all once it is switched off', () => {
    const simulation = richSimulation();
    for (const key of AUTOMATION_KEYS) simulation.execute({ type: 'set_automation', key, enabled: false });
    const before = totalLevels(simulation);
    simulation.advance(60);
    expect(totalLevels(simulation)).toBe(before);
    // Gold still climbs - kills pay whether or not anything is spending it.
    expect(simulation.getState().equipment.gold.cmp('1e6')).toBeGreaterThanOrEqual(0);
  });

  it('alternates offence and defence rather than pouring everything into one', () => {
    const simulation = richSimulation();
    simulation.advance(30);
    const pieces = simulation.getState().equipment.pieces;
    const damageLevels = GEAR_SLOT_ORDER.filter((s) => ['staff', 'spellbook', 'necklace'].includes(s))
      .reduce((sum, s) => sum + pieces[s].level, 0);
    const healthLevels = GEAR_SLOT_ORDER.filter((s) => ['helm', 'robe', 'boots'].includes(s))
      .reduce((sum, s) => sum + pieces[s].level, 0);
    expect(damageLevels).toBeGreaterThan(GEAR_SLOT_ORDER.length);
    expect(healthLevels).toBeGreaterThan(GEAR_SLOT_ORDER.length);
  });

  /**
   * The determinism claim the call site rests on. Automation changes damage,
   * which changes when enemies die - so if it fired at a moment that depended
   * on how `advance` was chunked, these two runs would diverge.
   */
  it('lands identically whether the run is advanced in one pass or in frames', () => {
    const single = richSimulation();
    single.advance(600);

    const chunked = richSimulation();
    for (let i = 0; i < 6000; i += 1) chunked.advance(0.1);

    const shape = (simulation: EvercastSimulation) => ({
      stage: simulation.getSnapshot().stage,
      kills: simulation.getSnapshot().kills,
      gold: simulation.getSnapshot().gold.display,
      levels: totalLevels(simulation),
    });
    expect(shape(chunked)).toEqual(shape(single));
  });

  it('never throws the summon reveal up unprompted', () => {
    const simulation = richSimulation();
    simulation.execute({ type: 'set_automation', key: 'summon', enabled: true });
    simulation.getState().companions.starlight = big('1e6');
    simulation.advance(60);
    // Companions arrived...
    expect(Object.keys(simulation.getState().companions.owned).length).toBeGreaterThan(0);
    // ...and nothing asked the interface to animate it.
    expect(simulation.getSnapshot().lastSummon).toBeNull();
  });

  it('reports what it is doing, so a surface can show the switches', () => {
    const simulation = richSimulation();
    expect(simulation.getSnapshot().automation).toEqual(DEFAULT_AUTOMATION);
    expect(simulation.execute({ type: 'set_automation', key: 'gear', enabled: false })).toBe(true);
    expect(simulation.getSnapshot().automation.gear).toBe(false);
    // Idempotent: a toggle re-sent by a re-render costs no publish and no save.
    expect(simulation.execute({ type: 'set_automation', key: 'gear', enabled: false })).toBe(false);
  });
});

describe('automation across a save and a rebirth', () => {
  it('remembers the switches, because being asked again is the thing it removes', async () => {
    const { SaveCodec } = await import('../save/SaveCodec');
    const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);
    const simulation = richSimulation();
    simulation.execute({ type: 'set_automation', key: 'summon', enabled: true });
    simulation.execute({ type: 'set_automation', key: 'gear', enabled: false });

    const restored = codec.decode(JSON.parse(JSON.stringify(codec.encode(simulation.getState())))).state;
    expect(restored.meta.automation.summon).toBe(true);
    expect(restored.meta.automation.gear).toBe(false);
  });

  it('hands a save written before automation existed the defaults', async () => {
    const { SaveCodec } = await import('../save/SaveCodec');
    const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);
    const envelope = JSON.parse(JSON.stringify(codec.encode(createInitialGameState(DEFAULT_ENGINE_CONFIG))));
    delete envelope.state.meta.automation;
    expect(codec.decode(envelope).state.meta.automation).toEqual(DEFAULT_AUTOMATION);
  });

  it('refuses a setting an edited save invented', async () => {
    const { SaveCodec } = await import('../save/SaveCodec');
    const codec = new SaveCodec(DEFAULT_ENGINE_CONFIG);
    const envelope = JSON.parse(JSON.stringify(codec.encode(createInitialGameState(DEFAULT_ENGINE_CONFIG))));
    envelope.state.meta.automation = { gear: 'yes please', spellNodes: true };
    const restored = codec.decode(envelope).state.meta.automation;
    expect(restored.gear).toBe(DEFAULT_AUTOMATION.gear);
    expect(restored).not.toHaveProperty('spellNodes');
  });
});
