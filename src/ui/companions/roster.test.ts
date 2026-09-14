import { describe, expect, it } from 'vitest';
import { COMPANION_RARITIES } from '../../engine/companions/types';
import type { CompanionSnapshot } from '../../engine/types';
import { ROSTER_FILTERS, ROSTER_SORTS, countFor, viewRoster } from './roster';

function companion(partial: Partial<CompanionSnapshot> & { name: string }): CompanionSnapshot {
  return {
    definitionId: partial.name.toLowerCase().replace(/\s+/g, '_'),
    description: '',
    rarity: 'common',
    companionClass: 'vanguard',
    row: 'front',
    kind: 'humanoid',
    modelKey: 'humanoid_a' as CompanionSnapshot['modelKey'],
    stars: 1,
    shards: 0,
    shardsForNextStar: 10,
    canAscend: false,
    ability: { id: 'strike', cooldown: 5 } as CompanionSnapshot['ability'],
    abilityMagnitude: 1,
    attackInterval: 2,
    threat: 1,
    maxHp: { raw: '100', display: '100' },
    damage: { raw: '10', display: '10' },
    slot: null,
    ...partial,
  };
}

const ROSTER: CompanionSnapshot[] = [
  companion({ name: 'Ash Warden', rarity: 'common', stars: 4, damage: { raw: '900', display: '900' } }),
  companion({ name: 'Bell Ringer', rarity: 'mythical', stars: 1, slot: 2, damage: { raw: '5e40', display: '5e40' } }),
  companion({ name: 'Cinder Maid', rarity: 'epic', stars: 5, canAscend: false, damage: { raw: '3e12', display: '3e12' } }),
  companion({ name: 'Dust Herald', rarity: 'epic', stars: 2, canAscend: true, slot: 0, damage: { raw: '2e12', display: '2e12' } }),
];

const view = { sort: 'rarity' as const, filter: 'all' as const, query: '' };

describe('the roster as the player asked for it', () => {
  it('ranks rarity by the engine’s own order, not alphabetically', () => {
    // 'mythical' sorts before 'common' as a word only by accident; this is the
    // comparator that looks right and puts Mythical at the bottom.
    expect(viewRoster(ROSTER, view).map((c) => c.name)).toEqual([
      'Bell Ringer',
      'Cinder Maid',
      'Dust Herald',
      'Ash Warden',
    ]);
    expect([...COMPANION_RARITIES]).toEqual(['common', 'rare', 'epic', 'legendary', 'mythical']);
  });

  it('breaks a tie on something the player can see', () => {
    const byStars = viewRoster(ROSTER, { ...view, sort: 'stars' });
    expect(byStars.map((c) => c.stars)).toEqual([5, 4, 2, 1]);
    const byName = viewRoster(ROSTER, { ...view, sort: 'name' });
    expect(byName.map((c) => c.name)).toEqual(['Ash Warden', 'Bell Ringer', 'Cinder Maid', 'Dust Herald']);
  });

  it('compares damage as a number, not as a string', () => {
    // '900' is longer than '5e40' and larger as text; it is 37 orders of
    // magnitude smaller as a number.
    expect(viewRoster(ROSTER, { ...view, sort: 'power' }).map((c) => c.name)).toEqual([
      'Bell Ringer',
      'Cinder Maid',
      'Dust Herald',
      'Ash Warden',
    ]);
  });

  it('filters to the four questions a roster is asked', () => {
    expect(viewRoster(ROSTER, { ...view, filter: 'deployed' }).map((c) => c.name)).toEqual([
      'Bell Ringer',
      'Dust Herald',
    ]);
    expect(viewRoster(ROSTER, { ...view, filter: 'bench' }).map((c) => c.name)).toEqual([
      'Cinder Maid',
      'Ash Warden',
    ]);
    expect(viewRoster(ROSTER, { ...view, filter: 'ascendable' }).map((c) => c.name)).toEqual(['Dust Herald']);
  });

  it('searches by name, case and spacing forgiven', () => {
    expect(viewRoster(ROSTER, { ...view, query: '  CINDER ' }).map((c) => c.name)).toEqual(['Cinder Maid']);
    expect(viewRoster(ROSTER, { ...view, query: 'nobody' })).toEqual([]);
  });

  it('never reorders the snapshot’s own array', () => {
    const original = [...ROSTER];
    viewRoster(ROSTER, { ...view, sort: 'name' });
    expect(ROSTER).toEqual(original);
  });

  it('counts what a filter would show before it is pressed', () => {
    expect(countFor(ROSTER, 'all')).toBe(4);
    expect(countFor(ROSTER, 'deployed')).toBe(2);
    expect(countFor(ROSTER, 'ascendable')).toBe(1);
  });

  it('handles every sort and filter without a gap', () => {
    for (const sort of ROSTER_SORTS) {
      for (const filter of ROSTER_FILTERS) {
        expect(() => viewRoster(ROSTER, { sort, filter, query: '' })).not.toThrow();
      }
    }
  });
});
