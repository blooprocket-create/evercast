// prettier-ignore
import type { CompanionClass, CompanionRarity, FormationRow } from '../../engine/companions/types';
import type { IconName } from '../icons/names';

/**
 * Rarity colours, drawn entirely from the existing palette.
 *
 * `theme/tokens.css` says the meaning set is closed and that a feature may not
 * add to it, so this maps the five tiers onto colours the game already owns
 * rather than minting five more. It lands on the ramp players already read -
 * grey, green, purple, gold, hot - and leaves `--route` free, which is what the
 * Starlight wallet takes.
 */
export const RARITY_TOKEN: Readonly<Record<CompanionRarity, string>> = {
  common: 'var(--ink-low)',
  rare: 'var(--hp-you)',
  epic: 'var(--essence)',
  legendary: 'var(--gold)',
  mythical: 'var(--crit)',
};

export const RARITY_LABEL: Readonly<Record<CompanionRarity, string>> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mythical: 'Mythical',
};

export const CLASS_LABEL: Readonly<Record<CompanionClass, string>> = {
  vanguard: 'Vanguard',
  bruiser: 'Bruiser',
  trickster: 'Trickster',
  ranger: 'Ranger',
  arcanist: 'Arcanist',
  support: 'Support',
};

export const CLASS_ICON: Readonly<Record<CompanionClass, IconName>> = {
  vanguard: 'classVanguard',
  bruiser: 'classBruiser',
  trickster: 'classTrickster',
  ranger: 'classRanger',
  arcanist: 'classArcanist',
  support: 'classSupport',
};

export const ROW_LABEL: Readonly<Record<FormationRow, string>> = {
  front: 'Front',
  flank: 'Flank',
  back: 'Back',
};

/** What each row is for, in the one line a tooltip has room for. */
export const ROW_NOTE: Readonly<Record<FormationRow, string>> = {
  front: 'Stands between the wave and the mage.',
  flank: 'Fights at the mage’s side.',
  back: 'Works from behind the line.',
};

export const ABILITY_LABEL: Readonly<Record<string, string>> = {
  strike: 'Heavy blow',
  volley: 'Volley',
  guard: 'Guard',
  bulwark: 'Bulwark',
  mend: 'Mend',
  rally: 'Rally',
  hex: 'Hex',
  wither: 'Wither',
  echo: 'Echo',
  revive: 'Last rite',
};

export const ABILITY_NOTE: Readonly<Record<string, string>> = {
  strike: 'A heavier hit on the nearest enemy, on a cooldown.',
  volley: 'Hits the three nearest enemies at once.',
  guard: 'Always on: turns aside a share of every blow the party takes.',
  bulwark: 'Shields the worst-hurt companion; absorbed before health.',
  mend: 'Heals whoever is in the most trouble, the mage included.',
  rally: 'Raises the whole party’s damage for a while.',
  hex: 'Blunts an enemy’s swings, stacking up to three times.',
  wither: 'Marks an enemy so everything hurts it more.',
  echo: 'Throws back a copy of the Evercast on a short cycle.',
  revive: 'Puts one fallen companion back on its feet, once per encounter.',
};

/** Sets `--rarity` for a subtree, so stylesheets never name a colour. */
export function rarityStyle(rarity: CompanionRarity): React.CSSProperties {
  return { '--rarity': RARITY_TOKEN[rarity] } as React.CSSProperties;
}

/** `★★★☆☆` at a glance, with the empty pips still occupying their width. */
export function starText(stars: number, max = 5): string {
  return '★'.repeat(Math.max(0, stars)) + '☆'.repeat(Math.max(0, max - stars));
}
