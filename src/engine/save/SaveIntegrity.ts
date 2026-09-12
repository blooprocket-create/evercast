/**
 * A checksum over a save's contents, and an honest account of what it is worth.
 *
 * ## What this does
 *
 * It detects change. A save that was truncated by a full disk, mangled by a
 * text editor, half-written by a browser that was killed mid-`setItem`, or
 * hand-edited to add a few zeroes to a wallet, no longer matches its own
 * digest, and the game says so instead of loading it as though nothing
 * happened.
 *
 * ## What this does not do
 *
 * It does not stop cheating, and nothing in a game with no server can. The
 * algorithm below ships in the same JavaScript bundle as the game, so anyone
 * willing to open the console can recompute a digest for whatever state they
 * like - or skip the file entirely and set the numbers on the live simulation
 * object. A signature would not change that either: verifying a signature
 * requires a key, a key that ships to the client is not a secret, and the only
 * place a real secret can live is a server this game deliberately does not
 * have.
 *
 * So the digest is deliberately not the thing protecting the game. That job
 * belongs to `SaveGuards.ts` and the validating decode in `SaveCodec.ts`, whose
 * guarantee holds no matter who wrote the blob or how: nothing a save can say
 * puts the simulation into a state it could not have reached by playing. A
 * cheated save stays inside the rules, stays on the machine that made it, and
 * costs its owner the game they were playing - which, with no accounts, no
 * leaderboards and no multiplayer, is the whole of the blast radius.
 */

/**
 * Domain separation, so the digest is specific to Evercast saves rather than a
 * bare hash of some JSON that anything else could have produced. Changing it
 * invalidates every existing digest, which is why it carries a version.
 */
const DIGEST_DOMAIN = 'evercast.save.integrity.v1';

/** FNV-1a offset bases, one per 32-bit lane of the digest. */
const LANE_SEEDS = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b] as const;
const FNV_PRIME = 0x01000193;

/**
 * Four FNV-1a lanes over the same bytes, concatenated to 32 hex characters.
 *
 * FNV-1a rather than a hash from `crypto`: `src/engine` may not reach for
 * browser APIs (`architecture.test.ts` enforces it), `crypto.subtle` is async
 * and would make encoding a promise, and a non-cryptographic hash is the right
 * tool for the job this one actually has. It only has to notice change.
 */
function digestOf(text: string): string {
  const lanes = new Uint32Array(LANE_SEEDS);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    for (let lane = 0; lane < lanes.length; lane += 1) {
      // The lane index enters the mix so identical bytes do not move every lane
      // in step, which is what would make four lanes worth no more than one.
      lanes[lane] = Math.imul((lanes[lane] ^ (code + lane)) >>> 0, FNV_PRIME) >>> 0;
    }
  }
  return Array.from(lanes, (lane) => lane.toString(16).padStart(8, '0')).join('');
}

/**
 * Key order has to be stable or the digest is not a function of the contents.
 *
 * `JSON.stringify` walks an object in its own insertion order, and a save that
 * makes a round trip through a parse and a re-encode can come back with its
 * keys in a different order than they went in. Sorting them makes the digest
 * depend on what the save says rather than on how it was assembled.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`;
}

/** The digest for a save's `state` and `savedAt`, which is everything that matters. */
export function saveDigest(payload: unknown): string {
  return digestOf(`${DIGEST_DOMAIN}|${canonicalize(payload)}`);
}

export type IntegrityVerdict = 'ok' | 'missing' | 'mismatch';

/**
 * `missing` rather than `mismatch` for a save written before digests existed,
 * so an old save is read as unverified rather than accused of being edited.
 */
export function verifySaveDigest(payload: unknown, claimed: unknown): IntegrityVerdict {
  if (typeof claimed !== 'string' || claimed.length === 0) return 'missing';
  return claimed === saveDigest(payload) ? 'ok' : 'mismatch';
}
