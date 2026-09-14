import type { SimulationSnapshot } from '../types';

/**
 * The snapshot minus the parts that describe this session rather than this
 * state.
 *
 * Two simulations that hold identical state can legitimately disagree about
 * the chronicle: it is a session log with its own monotonic counter, it is
 * deliberately not saved, and a run resumed from a save therefore starts it
 * empty while the run that never stopped carries what came before. Comparing
 * full snapshots to prove a save round-trip lost nothing would be asserting
 * that it *did* carry that - which is the opposite of the design.
 *
 * Lives here rather than in a test file because it is a fact about the read
 * model, and the next ephemeral field added to it needs one obvious place to
 * be declared rather than two test files to be remembered in.
 */
export type AuthoritativeSnapshot = Omit<SimulationSnapshot, 'chronicle'>;

export function authoritativeSnapshot(snapshot: SimulationSnapshot): AuthoritativeSnapshot {
  const { chronicle: _sessionLog, ...authoritative } = snapshot;
  return authoritative;
}
