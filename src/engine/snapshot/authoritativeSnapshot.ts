import type { SimulationSnapshot } from '../types';

/**
 * The snapshot minus the parts that describe this session rather than this
 * state.
 *
 * Two simulations that hold identical state can legitimately disagree about
 * the chronicle, the income rates and the last defeat: all three are session
 * measurements rather than state, none is saved, and a run resumed from a save
 * therefore starts them cold while the run that never stopped carries what came
 * before. Comparing full snapshots to prove a save round-trip lost nothing
 * would be asserting that it *did* carry them - which is the opposite of the
 * design.
 *
 * Lives here rather than in a test file because it is a fact about the read
 * model, and the next ephemeral field added to it needs one obvious place to
 * be declared rather than two test files to be remembered in.
 */
// prettier-ignore
export type AuthoritativeSnapshot =
  Omit<SimulationSnapshot, 'chronicle' | 'income' | 'stagesPerHour' | 'lastDefeat'>;

export function authoritativeSnapshot(snapshot: SimulationSnapshot): AuthoritativeSnapshot {
  const { chronicle: _log, income: _rates, stagesPerHour: _pace, lastDefeat: _fall, ...authoritative } =
    snapshot;
  return authoritative;
}
