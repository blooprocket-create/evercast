import type { CombatPosition } from '../combat/SpellCombatState';
import type { RunState } from '../model';
import { requireCompanion, rowOf } from './CompanionCatalog';
import type { CompanionCombatant, FormationRow } from './types';
import { PARTY_SIZE } from './types';

/**
 * Where each row stands, mage at x = 0 and enemies arriving from +x.
 *
 * This is gameplay geometry, not layout: the row decides who enemies reach
 * first and how far a companion can strike, so it lives in the engine the way
 * `CONTACT_SLOTS` does rather than in the renderer.
 *
 * Positions are a pure function of (row, index within row) and never of how
 * many companions share the row. If they shifted when a slot was filled, every
 * companion's reach threshold would move with it - and those thresholds are
 * events the combat loop has to stop on.
 *
 * Rows rake backwards as they widen, so five of one class read as an arc
 * around the mage rather than a wall across the road.
 */
const FORMATION: Readonly<Record<FormationRow, readonly CombatPosition[]>> = {
  front: [
    { x: 1.55, z: -0.62 },
    { x: 1.55, z: 0.62 },
    { x: 1.32, z: -1.58 },
    { x: 1.32, z: 1.58 },
    { x: 1.1, z: -2.5 },
  ],
  flank: [
    { x: 0.35, z: -1.25 },
    { x: 0.35, z: 1.25 },
    { x: 0.05, z: -2.05 },
    { x: 0.05, z: 2.05 },
    { x: -0.25, z: -2.85 },
  ],
  back: [
    { x: -1.15, z: 0 },
    { x: -1.3, z: -0.95 },
    { x: -1.3, z: 0.95 },
    { x: -1.5, z: -1.9 },
    { x: -1.5, z: 1.9 },
  ],
};

/**
 * The party in slot order, with each companion's index within its own row.
 * Party slots are deliberately untyped - collect freely, build freely - and a
 * companion's class alone decides whether it stands in front or behind.
 */
export function formationIndices(party: readonly (string | null)[]): Map<number, number> {
  const nextInRow = new Map<FormationRow, number>();
  const indices = new Map<number, number>();
  party.slice(0, PARTY_SIZE).forEach((definitionId, slot) => {
    if (!definitionId) return;
    const row = rowOf(requireCompanion(definitionId));
    const index = nextInRow.get(row) ?? 0;
    nextInRow.set(row, index + 1);
    indices.set(slot, index);
  });
  return indices;
}

export function formationPosition(row: FormationRow, indexInRow: number): CombatPosition {
  const slots = FORMATION[row];
  const position = slots[Math.min(Math.max(0, indexInRow), slots.length - 1)];
  // `FORMATION` is authored with PARTY_SIZE entries per row, so this cannot be
  // missed in practice; the fallback keeps the return type honest.
  return position ?? { x: 0, z: 0 };
}

/** Where a live combatant is standing, derived from the party it came from. */
export function positionOfCompanion(
  run: RunState,
  companion: CompanionCombatant,
  indices: Map<number, number>,
): CombatPosition {
  const row = rowOf(requireCompanion(companion.definitionId));
  return formationPosition(row, indices.get(companion.slot) ?? 0);
}

/**
 * How far along the road this companion can strike, expressed as an enemy x.
 *
 * Reach is authored from the companion's own slot, so a front-row guard with a
 * short weapon still covers the whole contact arc while a back-row caster needs
 * its long range just to reach the same enemies.
 */
export function reachThreshold(definitionId: string, indexInRow: number): number {
  const definition = requireCompanion(definitionId);
  return formationPosition(rowOf(definition), indexInRow).x + definition.range;
}

/** The live party laid back out in slot order, with gaps as nulls. */
export function partyLayout(run: RunState): (string | null)[] {
  const party: (string | null)[] = new Array(PARTY_SIZE).fill(null);
  for (const companion of run.companions) party[companion.slot] = companion.definitionId;
  return party;
}

/** Each live companion's index within its own row, keyed by party slot. */
export function companionIndices(run: RunState): Map<number, number> {
  return formationIndices(partyLayout(run));
}

/** Every distinct threshold the party introduces, for the combat loop's gates. */
export function partyThresholds(run: RunState): number[] {
  const indices = companionIndices(run);
  const thresholds = new Set<number>();
  for (const companion of run.companions) {
    if (companion.downed) continue;
    thresholds.add(reachThreshold(companion.definitionId, indices.get(companion.slot) ?? 0));
  }
  return [...thresholds];
}

/** Whether anything is holding the line, which decides how close a wave comes. */
export function hasLivingFrontline(run: RunState): boolean {
  return run.companions.some(
    (companion) => !companion.downed && rowOf(requireCompanion(companion.definitionId)) === 'front',
  );
}
