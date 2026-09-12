import { describe, expect, it } from 'vitest';
import { EvercastSimulation } from '../../engine/EvercastSimulation';
import type { SimulationSnapshot } from '../../engine/types';
import { coachMark } from './coachMarks';
import { PREMISE_FLAG } from './flags';

const fresh = (): SimulationSnapshot => new EvercastSimulation().getSnapshot();

/**
 * Snapshots are read-only to the UI, so a case is a fresh one plus a patch.
 * The premise flag is on by default because every case below is about what a
 * player sees *after* it; the gate itself is tested on its own.
 */
const withPatch = (patch: Partial<SimulationSnapshot>): SimulationSnapshot => ({
  ...fresh(),
  storyFlags: [PREMISE_FLAG],
  ...patch,
});

const quantityOf = (raw: string) => ({ raw, display: raw });

const cheapestGear = (snapshot: SimulationSnapshot) =>
  snapshot.gear.reduce((best, piece) =>
    Number(piece.nextLevelCost.raw) < Number(best.nextLevelCost.raw) ? piece : best,
  );

/** A player who has spent the granted point, so the opening mark is retired. */
const started = (patch: Partial<SimulationSnapshot> = {}) =>
  withPatch({ spellTreeUnspentPoints: 0, activeSpellNodeIds: ['twin'], ...patch });

describe('coach marks', () => {
  it('says nothing until the premise has been read', () => {
    // A fresh save qualifies for the opening mark on every count except this
    // one, so an empty flag list is the only thing holding it back.
    expect(coachMark({ ...fresh(), storyFlags: [] })).toBeNull();
    expect(coachMark(withPatch({}))).not.toBeNull();
  });

  it('opens on the Spell Point a new save is handed', () => {
    // The one thing that is free, affordable and waiting the moment the world
    // loads. Nothing else is true yet: both wallets are empty.
    const mark = coachMark(withPatch({}));
    expect(mark?.destinationId).toBe('spell-tree');
    expect(mark?.text).toMatch(/Spell Point/);
  });

  it('retires the opening mark once the point is spent', () => {
    expect(coachMark(started())).toBeNull();
  });

  /**
   * The property the whole design rests on: a mark is retired by the state it
   * describes, never by a flag. Doing the thing it asked for is what makes it
   * false, which is also why nothing has to remember it was ever shown.
   */
  it('points at gear once gold can actually buy a level, and stops when it does', () => {
    const snapshot = fresh();
    const cheapest = cheapestGear(snapshot);

    const afford = started({ gold: quantityOf(cheapest.nextLevelCost.raw) });
    expect(coachMark(afford)?.destinationId).toBe('gear');

    const bought = started({
      gold: quantityOf(cheapest.nextLevelCost.raw),
      gear: snapshot.gear.map((piece) =>
        piece.slot === cheapest.slot ? { ...piece, level: 2 } : piece,
      ),
    });
    expect(coachMark(bought)?.destinationId).not.toBe('gear');
  });

  it('stays quiet while gold is short of the cheapest level', () => {
    expect(coachMark(started({ gold: quantityOf('1') }))).toBeNull();
  });

  it('explains Spell Points once Essence covers one, and stops once one is bought', () => {
    const cost = fresh().nextSpellPointCost.raw;

    const mark = coachMark(started({ essence: quantityOf(cost) }));
    expect(mark?.destinationId).toBe('spell-tree');
    expect(mark?.text).toMatch(/Essence/);

    expect(
      coachMark(started({ essence: quantityOf(cost), spellTreePurchasedPoints: 1 })),
    ).toBeNull();
  });

  it('explains the first Rebirth and never a later one', () => {
    expect(coachMark(started({ canRebirth: true, rebirths: 0 }))?.destinationId).toBe('rebirth');
    expect(coachMark(started({ canRebirth: true, rebirths: 1 }))).toBeNull();
  });

  it('shows one mark at a time, however many conditions are true at once', () => {
    const everything = withPatch({
      gold: quantityOf('1e9'),
      essence: quantityOf('1e9'),
      canRebirth: true,
      canSummon: true,
    });
    // Earliest in the game's own order wins, and that is the granted point:
    // this save has still never spent anything.
    expect(coachMark(everything)?.destinationId).toBe('spell-tree');
    expect(coachMark(everything)?.text).toMatch(/You have a Spell Point/);
  });

  it('does not hand a beginner hint to a veteran mid-respec', () => {
    // A respec empties the activated nodes and hands the points back, which
    // looks exactly like a fresh save but for the points already purchased.
    const respecced = withPatch({
      spellTreePurchasedPoints: 40,
      spellTreeUnspentPoints: 41,
      activeSpellNodeIds: [],
      rebirths: 3,
    });
    expect(coachMark(respecced)).toBeNull();
  });

  it('only ever points somewhere the rail can actually go', () => {
    const destinations = new Set(['character', 'spell-tree', 'gear', 'summon', 'rebirth']);
    const cases = [
      withPatch({}),
      started({ gold: quantityOf('1e9') }),
      started({ essence: quantityOf('1e9') }),
      started({ canSummon: true }),
      started({ canRebirth: true }),
    ];
    for (const snapshot of cases) {
      const mark = coachMark(snapshot);
      if (mark) expect(destinations).toContain(mark.destinationId);
    }
  });
});
