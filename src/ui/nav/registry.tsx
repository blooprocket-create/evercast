import type { Destination } from './destinations';
import { OverviewSurface } from '../surfaces/OverviewSurface';
import { SpellTreeSurface } from '../surfaces/SpellTreeSurface';
import { GearSurface } from '../surfaces/GearSurface';

/**
 * Adding a feature is one entry here plus its data. No shelf change, no new
 * layout, no new colour: `archetype` decides which surface draws it, and the
 * rail and shelf render whatever this array contains.
 */
export interface RegisteredDestination extends Destination {
  Component: () => React.ReactNode;
}

export const DESTINATIONS: RegisteredDestination[] = [
  {
    id: 'character',
    group: 'power',
    label: 'Character',
    icon: 'character',
    archetype: 'dashboard',
    Component: OverviewSurface,
  },
  {
    id: 'spell-tree',
    group: 'power',
    label: 'Spell Tree',
    icon: 'spellTree',
    archetype: 'graph',
    badge: (snapshot) => snapshot.spellTreeUnspentPoints || null,
    Component: SpellTreeSurface,
  },
  {
    id: 'gear',
    group: 'power',
    label: 'Gear',
    icon: 'gear',
    archetype: 'detail',
    Component: GearSurface,
  },
];

export const DEFAULT_PINNED = ['character', 'spell-tree', 'gear'];

/**
 * Development only. `?nav=stress` loads the registry the deferred list implies,
 * so the shelf and rail can be seen holding fourteen destinations rather than
 * three. The surfaces are deliberately empty: this proves navigation, not
 * content.
 */
const STRESS: RegisteredDestination[] = [
  { id: 'gear-trees', group: 'power', label: 'Gear Trees', icon: 'gearTree', archetype: 'graph', Component: Placeholder },
  { id: 'rebirth', group: 'power', label: 'Rebirth', icon: 'rebirth', archetype: 'moment', available: (s) => s.canRebirth, badge: () => 'dot', Component: Placeholder },
  { id: 'automation', group: 'power', label: 'Automation', icon: 'automation', archetype: 'ledger', Component: Placeholder },
  { id: 'map', group: 'world', label: 'Map', icon: 'map', archetype: 'dashboard', Component: Placeholder },
  { id: 'bestiary', group: 'world', label: 'Bestiary', icon: 'bestiary', archetype: 'ledger', badge: () => 7, Component: Placeholder },
  { id: 'story', group: 'world', label: 'Story', icon: 'story', archetype: 'ledger', Component: Placeholder },
  { id: 'achievements', group: 'record', label: 'Achievements', icon: 'achievements', archetype: 'ledger', badge: () => 3, Component: Placeholder },
  { id: 'statistics', group: 'record', label: 'Statistics', icon: 'statistics', archetype: 'dashboard', Component: Placeholder },
  { id: 'collection', group: 'record', label: 'Collection', icon: 'collection', archetype: 'detail', Component: Placeholder },
  { id: 'settings', group: 'record', label: 'Settings', icon: 'settings', archetype: 'ledger', Component: Placeholder },
  { id: 'about', group: 'record', label: 'About', icon: 'about', archetype: 'moment', Component: Placeholder },
];

function Placeholder() {
  return null;
}

export function loadRegistry(): RegisteredDestination[] {
  if (!import.meta.env.DEV) return DESTINATIONS;
  const stressed =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('nav') === 'stress';
  return stressed ? [...DESTINATIONS, ...STRESS] : DESTINATIONS;
}
