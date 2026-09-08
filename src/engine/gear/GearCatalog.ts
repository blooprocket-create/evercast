import { GEAR_DEFINITIONS } from '../../content/gear';
import type { GearSlot } from './types';

export { GEAR_DEFINITIONS };

export const GEAR_EVOLUTION_MILESTONES = [1, 50, 100, 200, 500, 1000] as const;

export const GEAR_SLOT_ORDER: readonly GearSlot[] = [
  'helm',
  'staff',
  'spellbook',
  'robe',
  'boots',
  'necklace',
  'ringLeft',
  'ringRight',
] as const;

export function evolutionTierForLevel(level: number): number {
  let tier = 0;
  for (let index = 0; index < GEAR_EVOLUTION_MILESTONES.length; index += 1) {
    if (level >= GEAR_EVOLUTION_MILESTONES[index]) tier = index;
  }
  return tier;
}

export function nextEvolutionLevel(level: number): number | null {
  return GEAR_EVOLUTION_MILESTONES.find((milestone) => milestone > level) ?? null;
}
