import { ZONES } from '../../content/zones';

/**
 * Which accent the interface wears, keyed off the zone the snapshot reports -
 * the same thing the player reads in the corner of the HUD.
 *
 * The renderer used to cycle its biomes by travel distance over a list of
 * three, against the content's four zones, so the accent and the terrain drifted
 * apart within a single run. They are the same list now; see
 * `WorldGenerator`'s `BIOMES` and `WORLD_UNITS_PER_ZONE`.
 */
export type BiomeAccent =
  | 'greenfields'
  | 'whispering-woods'
  | 'gravehollow'
  | 'ashen-road';

const BY_ZONE_ID: Record<string, BiomeAccent> = {
  greenfields: 'greenfields',
  whispering_woods: 'whispering-woods',
  gravehollow: 'gravehollow',
  ashen_road: 'ashen-road',
};

export const DEFAULT_ACCENT: BiomeAccent = 'greenfields';

/** `zoneNumber` is 1-based, as the snapshot reports it. */
export function accentForZone(zoneNumber: number): BiomeAccent {
  const zone = ZONES[Math.max(0, Math.floor(zoneNumber) - 1) % ZONES.length];
  return (zone && BY_ZONE_ID[zone.id]) ?? DEFAULT_ACCENT;
}

/** The CSS custom property to assign to `--accent` on the shell root. */
export function accentVariable(accent: BiomeAccent): string {
  return `var(--accent-${accent})`;
}

/**
 * The same accent at a lightness that can carry text.
 *
 * Chrome reads `--accent` and owes 3:1 under WCAG 1.4.11; text reads this and
 * owes 4.5:1 under 1.4.3. Gravehollow's authored purple clears the first and
 * not the second, so the two properties are set together and differ only where
 * legibility requires it. See the `--accent-ink-*` block in `tokens.css`.
 */
export function accentInkVariable(accent: BiomeAccent): string {
  return `var(--accent-ink-${accent})`;
}
