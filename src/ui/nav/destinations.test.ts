import { describe, expect, it } from 'vitest';
import { EvercastSimulation } from '../../engine/EvercastSimulation';
import type { SimulationSnapshot } from '../../engine/types';
import {
  type Destination,
  SHELF_SLOTS,
  groupDestinations,
  mergeBadges,
  registryProblems,
  shelfLayout,
  visibleDestinations,
} from './destinations';

// The engine is headless, so tests build real snapshots instead of fixtures.
const snapshot: SimulationSnapshot = new EvercastSimulation().getSnapshot();

const make = (
  id: string,
  group: Destination['group'],
  archetype: Destination['archetype'],
  extra: Partial<Destination> = {},
): Destination => ({ id, group, label: id, icon: 'character', archetype, ...extra });

/** What ships today. */
const TODAY: Destination[] = [
  make('character', 'power', 'dashboard'),
  make('spell-tree', 'power', 'graph', { badge: (s) => s.spellTreeUnspentPoints || null }),
  make('gear', 'power', 'detail'),
];

/** What the registry plausibly looks like once the deferred list lands. */
const LATER: Destination[] = [
  ...TODAY,
  make('gear-trees', 'power', 'graph'),
  make('rebirth', 'power', 'moment', { available: (s) => s.canRebirth, badge: () => 'dot' }),
  make('automation', 'power', 'ledger'),
  make('map', 'world', 'dashboard'),
  make('bestiary', 'world', 'ledger', { badge: () => 7 }),
  make('story', 'world', 'ledger'),
  make('achievements', 'record', 'ledger', { badge: () => 3 }),
  make('statistics', 'record', 'dashboard'),
  make('collection', 'record', 'detail'),
  make('settings', 'record', 'ledger'),
  make('about', 'record', 'moment'),
];

describe('destination registry', () => {
  it('holds its invariants at both sizes', () => {
    expect(registryProblems(TODAY)).toEqual([]);
    expect(registryProblems(LATER)).toEqual([]);
    expect(LATER).toHaveLength(14);
  });

  it('catches the mistakes that would break the rail', () => {
    expect(registryProblems([make('a', 'power', 'dashboard'), make('a', 'world', 'ledger')]))
      .toContain('duplicate id "a"');
    expect(
      registryProblems([make('a', 'power', 'wormhole' as Destination['archetype'])]).join(' '),
    ).toContain('unknown archetype');
  });

  it('keeps the shelf at exactly three slots however big the registry gets', () => {
    for (const registry of [TODAY, LATER]) {
      const layout = shelfLayout(registry, snapshot, ['character', 'spell-tree', 'gear']);
      expect(layout.pinned).toHaveLength(SHELF_SLOTS);
      expect(layout.pinned.map((d) => d.id)).toEqual(['character', 'spell-tree', 'gear']);
    }
  });

  it('sends everything past the third slot to overflow', () => {
    const layout = shelfLayout(LATER, snapshot, ['character', 'spell-tree', 'gear']);
    // Rebirth is gated off at a fresh start, so 14 registered - 1 hidden - 3 pinned.
    expect(snapshot.canRebirth).toBe(false);
    expect(layout.overflow).toHaveLength(10);
    expect(layout.overflow.map((d) => d.id)).not.toContain('rebirth');
  });

  it('never leaves the shelf short when preferences are stale', () => {
    const layout = shelfLayout(LATER, snapshot, ['does-not-exist', 'rebirth']);
    expect(layout.pinned).toHaveLength(SHELF_SLOTS);
    expect(layout.pinned.map((d) => d.id)).toEqual(['character', 'spell-tree', 'gear']);
  });

  it('honours a reordered pin preference', () => {
    const layout = shelfLayout(LATER, snapshot, ['bestiary', 'gear']);
    expect(layout.pinned.map((d) => d.id)).toEqual(['bestiary', 'gear', 'character']);
  });

  it('bubbles overflow badges up to More so nothing hides back there', () => {
    const layout = shelfLayout(LATER, snapshot, ['character', 'spell-tree', 'gear']);
    expect(layout.overflowBadge).toBe(10); // bestiary 7 + achievements 3
  });

  it('merges badges without letting a dot outrank a count', () => {
    expect(mergeBadges([])).toBeNull();
    expect(mergeBadges([null, null])).toBeNull();
    expect(mergeBadges(['dot', null])).toBe('dot');
    expect(mergeBadges([2, 'dot', 3])).toBe(5);
    expect(mergeBadges([0, 'dot'])).toBe('dot');
  });

  it('hides gated destinations until the engine allows them', () => {
    expect(visibleDestinations(LATER, snapshot).map((d) => d.id)).not.toContain('rebirth');
    const ready = { ...snapshot, canRebirth: true };
    expect(visibleDestinations(LATER, ready).map((d) => d.id)).toContain('rebirth');
  });

  it('groups in a fixed order and drops empty sections', () => {
    expect(groupDestinations(TODAY).map((s) => s.group)).toEqual(['power']);
    expect(groupDestinations(LATER).map((s) => s.group)).toEqual(['power', 'world', 'record']);
    expect(groupDestinations(LATER)[1].entries.map((d) => d.id)).toEqual([
      'map',
      'bestiary',
      'story',
    ]);
  });

  it('reads a live badge off a real snapshot', () => {
    const treeBadge = TODAY[1].badge?.(snapshot) ?? null;
    expect(treeBadge).toBe(snapshot.spellTreeUnspentPoints || null);
  });
});
