import type { BiomeId } from './WorldGenerator';

export interface PropChoice {
  id: string;
  weight: number;
  scale: number;
  /** Tall silhouettes belong behind the fight, never between camera and characters. */
  background: boolean;
}

function variants(prefix: string, count: number, weight: number, scale: number, background = false): PropChoice[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}_${String.fromCharCode(97 + i)}`, weight: weight / count, scale, background,
  }));
}

export const BIOME_PROP_POOLS: Record<BiomeId, readonly PropChoice[]> = {
  greenfields: [
    ...variants('healthy_tree', 3, 25, 0.9, true),
    ...variants('rock', 3, 18, 0.6),
    ...variants('grass_clump', 2, 22, 0.85),
    ...variants('flower_patch', 2, 20, 0.85),
    { id: 'fallen_log', weight: 9, scale: 0.8, background: false },
    { id: 'small_ruin_stone', weight: 6, scale: 0.7, background: false },
    { id: 'meadow_waystone', weight: 7, scale: 0.9, background: true },
  ],
  whispering_woods: [
    ...variants('dark_tree', 3, 46, 1, true),
    ...variants('mossy_rock', 2, 12, 0.65),
    { id: 'bush_clump', weight: 16, scale: 0.85, background: false },
    { id: 'mushroom_patch', weight: 14, scale: 0.9, background: false },
    { id: 'root_cluster', weight: 12, scale: 0.8, background: false },
    { id: 'forest_fern', weight: 14, scale: 0.8, background: false },
    { id: 'ancient_fir', weight: 18, scale: 0.95, background: true },
  ],
  gravehollow: [
    ...variants('dead_tree', 3, 24, 1, true),
    ...variants('gravestone', 3, 32, 0.8, true),
    { id: 'broken_fence_segment', weight: 14, scale: 0.85, background: true },
    { id: 'ruined_arch', weight: 8, scale: 0.95, background: true },
    { id: 'mausoleum', weight: 6, scale: 0.95, background: true },
    { id: 'bone_pile_rubble', weight: 16, scale: 0.9, background: false },
    { id: 'vigil_lantern', weight: 8, scale: 0.95, background: true },
  ],
  /*
   * Everything here already exists; the place is new. Ashen Road is the road
   * after the fire, so it borrows the dead trees and broken fences from
   * Gravehollow and the bare rock and fallen timber from Greenfields, and
   * leaves out anything that is still growing. It reads as its own zone
   * because the ground, the fog and the light under it are - see `ashen_road`
   * in WorldGenerator.
   */
  ashen_road: [
    ...variants('dead_tree', 3, 30, 0.95, true),
    ...variants('rock', 3, 20, 0.6),
    { id: 'fallen_log', weight: 16, scale: 0.85, background: false },
    { id: 'bone_pile_rubble', weight: 13, scale: 0.85, background: false },
    { id: 'broken_fence_segment', weight: 11, scale: 0.85, background: true },
    { id: 'small_ruin_stone', weight: 10, scale: 0.75, background: false },
    { id: 'ruined_arch', weight: 6, scale: 0.9, background: true },
    { id: 'vigil_lantern', weight: 6, scale: 0.9, background: true },
  ],
};

export const LANDMARK_ASSETS = [
  'forest_shrine_arch', 'graveyard_gate', 'cathedral_nave', 'cathedral_tower', 'cathedral_buttress',
] as const;

/** Receives the world's seeded roll so async load order cannot affect placement. */
export function chooseEnvironmentProp(biome: BiomeId, roll: number): PropChoice {
  const pool = BIOME_PROP_POOLS[biome];
  let remaining = Math.max(0, Math.min(1, roll)) * pool.reduce((total, entry) => total + entry.weight, 0);
  for (const entry of pool) {
    remaining -= entry.weight;
    if (remaining < 0) return entry;
  }
  return pool[pool.length - 1];
}
