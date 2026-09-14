import type { GearDefinition, GearSlot } from '../engine/gear/types';

/**
 * PLAYTEST defaults, not final balance. Centralized here for the same reason
 * `spellTreeTuning.ts` and `companionTuning.ts` are.
 *
 * Enemy health compounds with the stage and always did; player power used to be
 * a straight `statPerLevel x paidLevels`, which is a line losing to a curve. A
 * level now multiplies rather than adds, so both sides of the fight grow in the
 * same shape.
 *
 * `statPerLevel` keeps its meaning at the bottom of the curve: the geometric sum
 * is anchored so level 1 still contributes nothing and level 2 still contributes
 * exactly `statPerLevel`. Only the far end changes.
 */
export const GEAR_POWER_GROWTH = 1.07;

/**
 * Price per level, compounding slightly faster than power on purpose.
 *
 * If price grew slower the player would outrun enemy health and the game would
 * trivialize instead of ending. The half-point gap means damage-per-gold decays
 * slowly, so a run finishes in a soft stall rather than against a wall - and
 * that stall is what a Rebirth is for. This gap is the most load-bearing number
 * in the file: it sets how long a session lasts.
 */
export const GEAR_COST_GROWTH = 1.075;

/**
 * Gold per kill, as a fraction of the dead enemy's maximum health.
 *
 * Income used to be `stage x 1` - linear, against health that compounds - so
 * farming could never catch up with the wall it was farming below. Paying out of
 * the enemy's own health coupled income to difficulty by construction, and means
 * the boss and world-tier multipliers are inherited for free instead of needing
 * income rules of their own.
 *
 * Tuned against the cost curve above rather than independently: moving one
 * without the other changes how many kills a level costs.
 */
export const GOLD_HP_FRACTION = 0.06;

/** What a boss pays on top of the larger health pool it already carries. */
export const GOLD_BOSS_MULTIPLIER = 3;

export const GEAR_DEFINITIONS: Record<GearSlot, GearDefinition> = {
  helm: {
    slot: 'helm',
    slotLabel: 'Helm',
    baseName: 'Standard Helm',
    description: 'Basic head protection for a mage beginning the long road.',
    primaryStat: 'maxHp',
    primaryStatLabel: 'Max HP',
    statPerLevel: 1,
    baseLevelCost: 10,
    costGrowth: 3,
    evolutionNames: ['Standard Helm', 'Runed Helm', 'Arcanist Helm', 'Astral Helm', 'Mythic Helm', 'Evercast Crown'],
  },
  staff: {
    slot: 'staff',
    slotLabel: 'Staff',
    baseName: 'Standard Staff',
    description: 'A simple magical focus that strengthens the base force of the Evercast.',
    primaryStat: 'baseDamage',
    primaryStatLabel: 'Base Damage',
    statPerLevel: 1,
    baseLevelCost: 12,
    costGrowth: 4,
    evolutionNames: ['Standard Staff', 'Runed Staff', 'Arcanist Staff', 'Astral Staff', 'Mythic Staff', 'Evercast Staff'],
  },
  spellbook: {
    slot: 'spellbook',
    slotLabel: 'Spellbook',
    baseName: 'Standard Spellbook',
    description: 'A record of the Evercast and the principles that shape how it behaves.',
    primaryStat: 'baseDamage',
    primaryStatLabel: 'Base Damage',
    statPerLevel: 0.5,
    baseLevelCost: 11,
    costGrowth: 3.5,
    evolutionNames: ['Standard Spellbook', 'Runed Spellbook', 'Arcanist Grimoire', 'Astral Grimoire', 'Mythic Codex', 'Evercast Codex'],
  },
  robe: {
    slot: 'robe',
    slotLabel: 'Robe',
    baseName: 'Standard Robe',
    description: 'Simple traveling robes reinforced over time with increasingly powerful magic.',
    primaryStat: 'maxHp',
    primaryStatLabel: 'Max HP',
    statPerLevel: 2,
    baseLevelCost: 12,
    costGrowth: 4,
    evolutionNames: ['Standard Robe', 'Runed Robe', 'Arcanist Robe', 'Astral Vestments', 'Mythic Vestments', 'Evercast Regalia'],
  },
  boots: {
    slot: 'boots',
    slotLabel: 'Boots',
    baseName: 'Standard Boots',
    description: 'Reliable road-worn boots that keep the mage standing through harder fights.',
    primaryStat: 'maxHp',
    primaryStatLabel: 'Max HP',
    statPerLevel: 1,
    baseLevelCost: 9,
    costGrowth: 2.75,
    evolutionNames: ['Standard Boots', 'Runed Boots', 'Arcanist Boots', 'Astral Treads', 'Mythic Treads', 'Evercast Steps'],
  },
  necklace: {
    slot: 'necklace',
    slotLabel: 'Necklace',
    baseName: 'Standard Necklace',
    description: 'A small magical focus worn close to the heart.',
    primaryStat: 'baseDamage',
    primaryStatLabel: 'Base Damage',
    statPerLevel: 0.25,
    baseLevelCost: 9,
    costGrowth: 3,
    evolutionNames: ['Standard Necklace', 'Runed Necklace', 'Arcanist Pendant', 'Astral Pendant', 'Mythic Amulet', 'Evercast Amulet'],
  },
  ringLeft: {
    slot: 'ringLeft',
    slotLabel: 'Ring I',
    baseName: 'Standard Ring',
    description: 'A flexible magical focus. Its tree can eventually specialize independently from the other ring.',
    primaryStat: 'baseDamage',
    primaryStatLabel: 'Base Damage',
    statPerLevel: 0.25,
    baseLevelCost: 8,
    costGrowth: 2.5,
    evolutionNames: ['Standard Ring', 'Runed Ring', 'Arcanist Ring', 'Astral Ring', 'Mythic Ring', 'Evercast Signet'],
  },
  ringRight: {
    slot: 'ringRight',
    slotLabel: 'Ring II',
    baseName: 'Standard Ring',
    description: 'A second independent ring slot for a separate gear-tree specialization.',
    primaryStat: 'baseDamage',
    primaryStatLabel: 'Base Damage',
    statPerLevel: 0.25,
    baseLevelCost: 8,
    costGrowth: 2.5,
    evolutionNames: ['Standard Ring', 'Runed Ring', 'Arcanist Ring', 'Astral Ring', 'Mythic Ring', 'Evercast Signet'],
  },
};
