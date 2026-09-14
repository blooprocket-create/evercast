import { useEffect, useRef, useState } from 'react';
import { useSnapshotSelector } from '../state/snapshot';

/**
 * The moment the mage falls, as a value the interface can react to.
 *
 * Read from the snapshot rather than from the event stream because the
 * interface is built on snapshots and the engine already counts deaths. The
 * enemy that did it has to be captured a tick early: the encounter resets with
 * the defeat, so by the time `deaths` has moved, `enemyName` is whatever comes
 * next.
 */
export interface Defeat {
  /** The death's ordinal, which is also what makes each one distinct. */
  serial: number;
  stage: number;
  farmStage: number;
  enemy: string;
}

export function useDefeat(): Defeat | null {
  const deaths = useSnapshotSelector((s) => s.deaths);
  const stage = useSnapshotSelector((s) => s.stage);
  const farmStage = useSnapshotSelector((s) => s.farmStage);
  const enemyName = useSnapshotSelector((s) => s.enemyName);

  // One tick behind, on purpose: see above.
  const previousEnemy = useRef(enemyName);
  const seen = useRef(deaths);
  const [defeat, setDefeat] = useState<Defeat | null>(null);

  useEffect(() => {
    if (deaths > seen.current) {
      setDefeat({ serial: deaths, stage, farmStage, enemy: previousEnemy.current });
    }
    seen.current = deaths;
  }, [deaths, stage, farmStage]);

  useEffect(() => {
    previousEnemy.current = enemyName;
  }, [enemyName]);

  return defeat;
}
