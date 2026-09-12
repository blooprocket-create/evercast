import type { Destination } from './destinations';
import { OverviewSurface } from '../surfaces/OverviewSurface';
import { SpellTreeSurface } from '../surfaces/SpellTreeSurface';
import { GearSurface } from '../surfaces/GearSurface';
import { CompanionsSurface } from '../surfaces/CompanionsSurface';
import { PartySurface } from '../surfaces/PartySurface';
import { SummonSurface } from '../surfaces/SummonSurface';
import { RebirthSurface } from '../surfaces/RebirthSurface';
import { AttunementsSurface } from '../surfaces/AttunementsSurface';
import { SettingsSurface } from '../surfaces/SettingsSurface';

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
  {
    id: 'companions',
    group: 'companion',
    label: 'Companions',
    icon: 'companions',
    archetype: 'detail',
    // Shards nobody has spent are the one thing worth interrupting for.
    badge: (snapshot) => snapshot.ascendableCompanions || null,
    Component: CompanionsSurface,
  },
  {
    id: 'party',
    group: 'companion',
    label: 'Party',
    icon: 'party',
    archetype: 'detail',
    // An empty slot while companions sit on the bench is wasted power.
    badge: (snapshot) =>
      snapshot.party.some((member) => member === null) &&
      snapshot.companions.some((companion) => companion.slot === null)
        ? 'dot'
        : null,
    Component: PartySurface,
  },
  {
    id: 'summon',
    group: 'companion',
    label: 'Summon',
    icon: 'summon',
    // A dashboard, not a detail: one banner never justified a list pane, and
    // on a phone that pane pushed both draw buttons below the fold.
    archetype: 'dashboard',
    badge: (snapshot) => (snapshot.canSummon ? 'dot' : null),
    Component: SummonSurface,
  },
  {
    id: 'attunements',
    group: 'power',
    label: 'Attunements',
    icon: 'gearTree',
    archetype: 'detail',
    // Knowledge only exists after a Rebirth, so the rail stays quiet until the
    // currency does. An already-attuned save keeps it visible.
    available: (snapshot) =>
      snapshot.canRebirth || snapshot.rebirths > 0 || snapshot.ownedAttunementIds.length > 0,
    Component: AttunementsSurface,
  },
  {
    id: 'rebirth',
    group: 'power',
    label: 'Rebirth',
    icon: 'rebirth',
    archetype: 'moment',
    // Hidden until the engine says it is possible; the rail never has to know.
    available: (snapshot) => snapshot.canRebirth,
    badge: () => 'dot',
    Component: RebirthSurface,
  },
  {
    id: 'settings',
    group: 'record',
    label: 'Settings',
    icon: 'settings',
    archetype: 'detail',
    Component: SettingsSurface,
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
  { id: 'automation', group: 'power', label: 'Automation', icon: 'automation', archetype: 'ledger', Component: Placeholder },
  { id: 'map', group: 'world', label: 'Map', icon: 'map', archetype: 'dashboard', Component: Placeholder },
  { id: 'bestiary', group: 'world', label: 'Bestiary', icon: 'bestiary', archetype: 'ledger', badge: () => 7, Component: Placeholder },
  { id: 'story', group: 'world', label: 'Story', icon: 'story', archetype: 'ledger', Component: Placeholder },
  { id: 'achievements', group: 'record', label: 'Achievements', icon: 'achievements', archetype: 'ledger', badge: () => 3, Component: Placeholder },
  { id: 'statistics', group: 'record', label: 'Statistics', icon: 'statistics', archetype: 'dashboard', Component: Placeholder },
  { id: 'collection', group: 'record', label: 'Collection', icon: 'collection', archetype: 'detail', Component: Placeholder },
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
