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
  'audio',
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
  /*
   * The three wallets. Added because the sub-560px header had no room for the
   * labels and fell back to a coloured dot - three numbers a colour-blind
   * player could not tell apart, with no text alternative either. A glyph is
   * shape as well as colour, and carries its own accessible name.
   */
  'gold',
  'essence',
  'starlight',
] as const;

export type IconName = (typeof ICON_NAMES)[number];
