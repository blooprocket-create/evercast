export interface SpellTreeNodeLayout {
  x: number;
  y: number;
}

export const SPELL_TREE_VIEWBOX = { width: 1000, height: 760 } as const;

export const SPELL_TREE_LAYOUT: Readonly<Record<string, SpellTreeNodeLayout>> = {
  evercast_root: { x: 500, y: 400 },

  power_1: { x: 500, y: 320 },
  power_2: { x: 500, y: 245 },
  power_notable: { x: 500, y: 165 },

  speed_1: { x: 580, y: 400 },
  speed_2: { x: 655, y: 400 },
  speed_notable: { x: 735, y: 400 },

  projectile_1: { x: 420, y: 400 },
  projectile_2: { x: 345, y: 400 },
  projectile_notable: { x: 265, y: 400 },

  crit_1: { x: 500, y: 480 },
  crit_2: { x: 500, y: 555 },
  crit_notable: { x: 500, y: 635 },

  arcane_entry: { x: 385, y: 205 },
  arcane_pierce: { x: 320, y: 145 },
  arcane_precision: { x: 390, y: 90 },
  arcane_echo: { x: 475, y: 78 },
  arcane_mutation: { x: 555, y: 105 },

  fire_entry: { x: 650, y: 195 },
  fire_splash: { x: 730, y: 145 },
  fire_heat: { x: 805, y: 180 },
  fire_combustion: { x: 850, y: 250 },
  fire_mutation: { x: 865, y: 330 },

  frost_entry: { x: 805, y: 470 },
  frost_shards: { x: 850, y: 535 },
  frost_chill: { x: 830, y: 610 },
  frost_lock: { x: 755, y: 650 },
  frost_mutation: { x: 675, y: 640 },

  storm_entry: { x: 190, y: 315 },
  storm_current: { x: 145, y: 245 },
  storm_chain: { x: 130, y: 170 },
  storm_tempest: { x: 175, y: 105 },
  storm_mutation: { x: 255, y: 80 },

  blood_entry: { x: 355, y: 650 },
  blood_force: { x: 285, y: 690 },
  blood_hunger: { x: 210, y: 665 },
  blood_rite: { x: 160, y: 600 },
  blood_mutation: { x: 155, y: 520 },
};

export function layoutForSpellNode(nodeId: string): SpellTreeNodeLayout {
  const layout = SPELL_TREE_LAYOUT[nodeId];
  if (!layout) throw new Error(`Missing spell tree layout for ${nodeId}.`);
  return layout;
}
