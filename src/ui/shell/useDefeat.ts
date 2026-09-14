import { useSnapshotSelector } from '../state/snapshot';

/**
 * The moment the mage falls, as a value the interface can react to.
 *
 * This used to derive it: watch the death counter, and name whichever enemy
 * was on screen the tick before it moved. That is wrong wherever the
 * simulation runs faster than it publishes - and it always does at the one
 * moment that matters most. A catch-up settles the whole absence in a single
 * call before publishing one snapshot, so the enemy held from the previous
 * tick is the one from *before* the absence, and a defeat that happened while
 * nobody was watching had no enemy on screen at all. The toast would then name
 * something that had nothing to do with it.
 *
 * The engine carries the killer on `mage_defeated` now and the snapshot
 * reports the last one, so this reads a fact instead of reconstructing one.
 * `farmStage` is deliberately still live: it is where the run has dropped back
 * to, which is a statement about now rather than about the defeat.
 */
export interface Defeat {
  /** The death's ordinal in this session, which is what makes each distinct. */
  serial: number;
  stage: number;
  farmStage: number;
  enemy: string;
}

export function useDefeat(): Defeat | null {
  const lastDefeat = useSnapshotSelector((s) => s.lastDefeat);
  const farmStage = useSnapshotSelector((s) => s.farmStage);

  if (lastDefeat === null) return null;
  return {
    serial: lastDefeat.serial,
    stage: lastDefeat.stage,
    farmStage,
    enemy: lastDefeat.enemyName,
  };
}
