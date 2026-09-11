import { companionThreat, requireCompanion } from '../companions/CompanionCatalog';
import type { CompanionCombatant } from '../companions/types';
import type { EnemyState, RunState } from '../model';

export type CombatTarget =
  | { kind: 'mage' }
  | { kind: 'companion'; companion: CompanionCombatant };

/** The mage's own threat. Every companion is ranked against this. */
export const MAGE_THREAT = 1;

/**
 * Enemies that go around the line rather than through it.
 *
 * Content already carries `tags`, so this is a pure authoring hook rather than
 * new enemy plumbing - `hollow_crow` has been tagged `flying` since long before
 * companions existed. It is what stops a wall of vanguards making the back row
 * permanently safe and turning healers into free stats.
 */
export const BYPASS_TAGS: readonly string[] = ['flying', 'ambush'];

export function bypassesFrontline(enemy: EnemyState): boolean {
  return (enemy.tags ?? []).some((tag) => BYPASS_TAGS.includes(tag));
}

export function threatOf(companion: CompanionCombatant): number {
  return companionThreat(requireCompanion(companion.definitionId), companion.stars);
}

/**
 * Who this enemy swings at.
 *
 * A pure function of state with no randomness, so a chunked run, a single pass
 * and a resumed save always agree on who took the blow. Highest threat wins and
 * the mage is the last resort rather than the default - which is the entire
 * point of standing a vanguard in front of her. `run.companions` is built in
 * party-slot order and ties are decided by first-seen, so a tie breaks on the
 * lower slot without needing a second sort key.
 */
export function chooseTarget(run: RunState, enemy: EnemyState): CombatTarget {
  const standing = run.companions.filter((companion) => !companion.downed);
  if (standing.length === 0) return { kind: 'mage' };

  const bypass = bypassesFrontline(enemy);
  let best: CompanionCombatant | undefined;
  let bestThreat = 0;

  for (const companion of standing) {
    const threat = threatOf(companion);
    if (!best || (bypass ? threat < bestThreat : threat > bestThreat)) {
      best = companion;
      bestThreat = threat;
    }
  }
  if (!best) return { kind: 'mage' };

  // A flyer takes the softest thing on the field, and the mage is softer than
  // anything that outranks her. A ground enemy goes for whatever is drawing
  // more attention than she is, and hits her when nothing does.
  const preferMage = bypass ? bestThreat >= MAGE_THREAT : bestThreat <= MAGE_THREAT;
  return preferMage ? { kind: 'mage' } : { kind: 'companion', companion: best };
}
