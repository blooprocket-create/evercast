/**
 * Icon identity lives here, apart from the SVG that draws it, so the
 * destination registry stays free of React and testable under the default
 * node environment.
 */
export const ICON_NAMES = [
  'character',
  'spellTree',
  'gear',
  'gearTree',
  'rebirth',
  'automation',
  'map',
  'bestiary',
  'story',
  'achievements',
  'statistics',
  'collection',
  'settings',
  'about',
  'more',
  'slotHelm',
  'slotStaff',
  'slotSpellbook',
  'slotRobe',
  'slotBoots',
  'slotNecklace',
  'slotRing',
  'companions',
  'party',
  'summon',
  'classVanguard',
  'classBruiser',
  'classTrickster',
  'classRanger',
  'classArcanist',
  'classSupport',
] as const;

export type IconName = (typeof ICON_NAMES)[number];
