import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EvercastSimulation } from '../../engine/EvercastSimulation';
import type { SimulationSnapshot } from '../../engine/types';
import { NavRail } from './NavRail';
import { Shelf } from './Shelf';
import {
  type Destination,
  SHELF_SLOTS,
  badgeFor,
  groupDestinations,
  shelfLayout,
  visibleDestinations,
} from './destinations';

/**
 * Structural assertions with no DOM and no new dependencies: react-dom already
 * ships a server renderer, and both components are pure and prop-driven.
 *
 * The claim under test is the whole point of the shell — the shelf costs the
 * same at three destinations as at fourteen.
 */
const snapshot: SimulationSnapshot = new EvercastSimulation().getSnapshot();

const make = (
  id: string,
  group: Destination['group'],
  extra: Partial<Destination> = {},
): Destination => ({
  id,
  group,
  label: id,
  icon: 'character',
  archetype: 'dashboard',
  ...extra,
});

const TODAY: Destination[] = [
  make('character', 'power'),
  make('spell-tree', 'power', { badge: (s) => s.spellTreeUnspentPoints || null }),
  make('gear', 'power'),
];

const LATER: Destination[] = [
  ...TODAY,
  make('gear-trees', 'power'),
  make('rebirth', 'power', { available: (s) => s.canRebirth, badge: () => 'dot' }),
  make('automation', 'power'),
  make('map', 'world'),
  make('bestiary', 'world', { badge: () => 7 }),
  make('story', 'world'),
  make('achievements', 'record', { badge: () => 3 }),
  make('statistics', 'record'),
  make('collection', 'record'),
  make('settings', 'record'),
  make('about', 'record'),
];

const PINNED = ['character', 'spell-tree', 'gear'];

function renderShelf(registry: Destination[]): string {
  const layout = shelfLayout(registry, snapshot, PINNED);
  return renderToStaticMarkup(
    <Shelf
      pinned={layout.pinned}
      overflowBadge={layout.overflowBadge}
      badgeFor={(destination) => badgeFor(destination, snapshot)}
      activeId={null}
      onOpen={() => {}}
      onOpenMore={() => {}}
    />,
  );
}

const countButtons = (markup: string) => markup.split('<button').length - 1;

describe('Shelf', () => {
  it('renders three slots plus More at three destinations and at fourteen', () => {
    expect(LATER).toHaveLength(14);
    for (const registry of [TODAY, LATER]) {
      expect(countButtons(renderShelf(registry))).toBe(SHELF_SLOTS + 1);
    }
  });

  it('shows the same three labels either way', () => {
    for (const registry of [TODAY, LATER]) {
      const markup = renderShelf(registry);
      for (const label of PINNED) expect(markup).toContain(label);
      expect(markup).toContain('More');
    }
  });

  it('surfaces overflow badges on More rather than losing them', () => {
    expect(renderShelf(TODAY)).not.toMatch(/More.*?10/s);
    // bestiary 7 + achievements 3, bubbled up from behind More.
    expect(renderShelf(LATER)).toContain('10');
  });

  it('paints no colour of its own', () => {
    // Everything resolves through a token; see src/ui/architecture.test.ts.
    expect(renderShelf(LATER)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/);
  });
});

describe('NavRail', () => {
  it('grows with the registry while the shelf does not', () => {
    const render = (registry: Destination[]) => {
      const visible = visibleDestinations(registry, snapshot);
      return renderToStaticMarkup(
        <NavRail
          groups={groupDestinations(visible)}
          activeId={null}
          badgeFor={() => null}
          onSelect={() => {}}
        />,
      );
    };

    expect(countButtons(render(TODAY))).toBe(3);
    // Fourteen registered, but Rebirth is gated off at a fresh start.
    expect(snapshot.canRebirth).toBe(false);
    expect(countButtons(render(LATER))).toBe(13);

    const markup = render(LATER);
    expect(markup).toContain('Power');
    expect(markup).toContain('World');
    expect(markup).toContain('Record');
    expect(markup).not.toContain('rebirth');
  });
});
