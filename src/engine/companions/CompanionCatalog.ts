import type Decimal from 'break_eternity.js';
import { COMPANIONS } from '../../content/companions';
// prettier-ignore
import { CLASS_PROFILES, RARITY_POWER, STAR_POWER, THREAT_PER_STAR } from '../../content/companionTuning';
import { big } from '../numbers';
// prettier-ignore
import { COMPANION_ABILITIES, COMPANION_CLASSES, COMPANION_MODELS, COMPANION_RARITIES, MAX_COMPANION_STARS } from './types';
// prettier-ignore
import type { CompanionDefinition, CompanionRarity, FormationRow } from './types';

export { COMPANIONS };

export const COMPANION_BY_ID: ReadonlyMap<string, CompanionDefinition> = new Map(
  COMPANIONS.map((companion) => [companion.id, companion]),
);

export function requireCompanion(id: string): CompanionDefinition {
  const definition = COMPANION_BY_ID.get(id);
  if (!definition) throw new Error(`Unknown companion: ${id}`);
  return definition;
}

/** Draw pools, built once. Order is the authored order, so draws are stable. */
export const COMPANIONS_BY_RARITY: ReadonlyMap<CompanionRarity, readonly CompanionDefinition[]> =
  new Map(
    COMPANION_RARITIES.map((rarity) => [
      rarity,
      COMPANIONS.filter((companion) => companion.rarity === rarity),
    ]),
  );

export function rowOf(definition: CompanionDefinition): FormationRow {
  return CLASS_PROFILES[definition.companionClass].row;
}

export function clampStars(stars: number): number {
  return Math.min(MAX_COMPANION_STARS, Math.max(1, Math.floor(stars)));
}

/**
 * The one place rarity and star level turn into power. Everything downstream -
 * health, damage, ability magnitude - multiplies through this, so a balance
 * pass moves two tables rather than thirty entries.
 */
export function powerMultiplier(definition: CompanionDefinition, stars: number): number {
  return RARITY_POWER[definition.rarity] * (STAR_POWER[clampStars(stars) - 1] ?? 1);
}

/**
 * Companion stats are shares of the mage's own numbers rather than authored
 * absolutes. Enemy health grows exponentially; an authored figure would be
 * worthless within an hour, and a second scaling economy would need tuning
 * forever. A share is worth what it says at every stage.
 */
export function companionMaxHp(
  definition: CompanionDefinition,
  stars: number,
  mageMaxHp: Decimal,
): Decimal {
  const share = CLASS_PROFILES[definition.companionClass].hpShare;
  return mageMaxHp.mul(share * powerMultiplier(definition, stars));
}

export function companionDamage(
  definition: CompanionDefinition,
  stars: number,
  wizardPerHit: Decimal,
): Decimal {
  const share = CLASS_PROFILES[definition.companionClass].dpsShare;
  return wizardPerHit.mul(share * powerMultiplier(definition, stars));
}

/** How hard enemies want to hit this companion. The mage's threat is 1. */
export function companionThreat(definition: CompanionDefinition, stars: number): number {
  const base = CLASS_PROFILES[definition.companionClass].threat;
  return base * (1 + THREAT_PER_STAR * (clampStars(stars) - 1));
}

/** An ability's real magnitude at this star level. */
export function abilityMagnitude(definition: CompanionDefinition, stars: number): number {
  return definition.ability.magnitude * powerMultiplier(definition, stars);
}

/** Guard-rails the content has to satisfy, mirroring `validateCatalog`. */
export function validateCompanions(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const companion of COMPANIONS) {
    if (seen.has(companion.id)) problems.push(`duplicate companion id "${companion.id}"`);
    seen.add(companion.id);
    if (!COMPANION_RARITIES.includes(companion.rarity))
      problems.push(`"${companion.id}" has unknown rarity "${companion.rarity}"`);
    if (!COMPANION_CLASSES.includes(companion.companionClass))
      problems.push(`"${companion.id}" has unknown class "${companion.companionClass}"`);
    if (!COMPANION_MODELS.includes(companion.modelKey))
      problems.push(`"${companion.id}" has unknown model "${companion.modelKey}"`);
    if (!COMPANION_ABILITIES.includes(companion.ability.id))
      problems.push(`"${companion.id}" has unknown ability "${companion.ability.id}"`);
    if (companion.attackInterval <= 0)
      problems.push(`"${companion.id}" has a non-positive attack interval`);
    if (companion.range <= 0) problems.push(`"${companion.id}" has a non-positive range`);
  }
  // Every rarity needs at least one entry or its slice of the draw table is
  // unreachable, which would silently skew the published rates.
  for (const rarity of COMPANION_RARITIES) {
    if ((COMPANIONS_BY_RARITY.get(rarity) ?? []).length === 0)
      problems.push(`no companions of rarity "${rarity}"`);
  }
  return problems;
}

/** Zero when nothing is equipped, so callers never special-case an empty party. */
export const NO_POWER = big(0);
