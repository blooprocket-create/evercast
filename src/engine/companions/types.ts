import type Decimal from 'break_eternity.js';

/** Ordered weakest to strongest; the order is load-bearing for draw tables. */
export const COMPANION_RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythical'] as const;
export type CompanionRarity = (typeof COMPANION_RARITIES)[number];

export const COMPANION_CLASSES = [
  'vanguard',
  'bruiser',
  'trickster',
  'ranger',
  'arcanist',
  'support',
] as const;
export type CompanionClass = (typeof COMPANION_CLASSES)[number];

/**
 * Where a class stands relative to the mage. The row decides both the world
 * position and who enemies reach first, so it is gameplay rather than layout
 * and belongs in the engine.
 */
export const FORMATION_ROWS = ['front', 'flank', 'back'] as const;
export type FormationRow = (typeof FORMATION_ROWS)[number];

/**
 * The closed set of things a companion can do. Thirty companions share ten
 * behaviours with different magnitudes rather than carrying thirty bespoke
 * implementations - the same reason the spell tree compiles to `SpellMechanics`
 * flags instead of per-node code.
 */
export const COMPANION_ABILITIES = [
  'strike',
  'volley',
  'guard',
  'bulwark',
  'mend',
  'rally',
  'hex',
  'wither',
  'echo',
  'revive',
] as const;
export type CompanionAbilityId = (typeof COMPANION_ABILITIES)[number];

/** Silhouette recipes the renderer builds from primitives. */
export const COMPANION_MODELS = [
  'humanoid_heavy',
  'humanoid_light',
  'humanoid_robed',
  'beast_quadruped',
  'floating_orb',
  'winged_creature',
] as const;
export type CompanionModelKey = (typeof COMPANION_MODELS)[number];

export const MAX_COMPANION_STARS = 5;
export const PARTY_SIZE = 5;

export interface CompanionAbility {
  id: CompanionAbilityId;
  /** Meaning depends on the ability: a damage share, a heal share, a fraction. */
  magnitude: number;
  cooldown: number;
}

export interface CompanionDefinition {
  id: string;
  name: string;
  description: string;
  rarity: CompanionRarity;
  /** The row is derived from the class, so it is never authored twice. */
  companionClass: CompanionClass;
  kind: 'humanoid' | 'creature';
  modelKey: CompanionModelKey;
  attackInterval: number;
  /** World units from the companion's own slot, not from the mage. */
  range: number;
  ability: CompanionAbility;
  tags: string[];
}

/**
 * Persistent ownership. One entry per companion ever obtained - never one per
 * copy. Storing individual duplicates is the inventory bloat that idle RPGs
 * spent years undoing; a duplicate is shards, and shards are a number.
 */
export interface OwnedCompanion {
  definitionId: string;
  stars: number;
  shards: number;
}

export interface CompanionsState {
  starlight: Decimal;
  owned: Record<string, OwnedCompanion>;
  /** Exactly PARTY_SIZE entries; null is an empty slot. */
  party: (string | null)[];
  /** Every draw ever made. Makes each roll unique, replayable and testable. */
  drawSerial: number;
  /** Draws since the last legendary or better. */
  pityCounter: number;
}

/**
 * Volatile per-encounter combat state, the companion twin of `EnemyState`. It
 * lives in `RunState` and is rebuilt from the party whenever that changes.
 */
export interface CompanionCombatant {
  slot: number;
  definitionId: string;
  hp: Decimal;
  maxHp: Decimal;
  attackCooldown: number;
  abilityCooldown: number;
  downed: boolean;
  /** A support may pull one ally back up per encounter. */
  revivedThisEncounter?: boolean;
  /** Whether the renderer has already been told about this swing. */
  telegraphed?: boolean;
}
