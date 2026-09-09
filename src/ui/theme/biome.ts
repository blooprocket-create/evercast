import { ZONES } from '../../content/zones';

/**
 * Which accent the interface wears. The renderer cycles biomes by travel
 * distance rather than by zone, so the UI keys off the zone the snapshot
 * reports — the same thing the player reads in the corner of the HUD.
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
