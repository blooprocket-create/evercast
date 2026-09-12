import { big } from '../../engine/numbers';
import type { SimulationSnapshot } from '../../engine/types';
import { PREMISE_FLAG } from './flags';

/**
 * Onboarding, derived rather than scripted.
 *
 * The obvious build is a tutorial carousel on first run, and for this game it
 * would be the wrong one. There are no controls to teach - the mage fights
 * unattended, and every command in the engine is a purchase. What a new player
 * actually does not know is which wallet buys what, and none of that is worth
 * saying until the wallet has something in it.
 *
 * So every mark below is a pure question about live state, and every one of
 * them stops being true because the player did the thing it asked for. Gold
 * buys gear levels is false the moment a level is bought. Essence buys Spell
 * Points is false once a point exists. Nothing is stored, nothing is sequenced,
 * nothing needs a flag to retire it - and a mark that is still true a week
 * later is still worth showing, because it is still something the player has
 * not got to yet.
 *
 * The rule this keeps: a mark may only be retired by the state it describes. A
 * condition that needs a "seen" flag to go away is a condition that is being
 * used to say something at the player rather than about the game, and it
 * belongs in the premise moment instead.
 */
export interface CoachMark {
  /** The destination it is about; the mark opens that surface when pressed. */
  destinationId: string;
  text: string;
}

const affords = (wallet: { raw: string }, price: { raw: string }): boolean =>
  big(wallet.raw).cmp(big(price.raw)) >= 0;

/**
 * First true wins, and the order is the order the game actually opens up in:
 * the granted Spell Point is live before any wallet is, gold fills before
 * Essence, and a frontier worth resetting is hours behind both. At most one
 * mark is ever live, which is what keeps this from becoming a wall of tooltips
 * at the moment a player is least equipped to read one.
 */
const MARKS: readonly ((snapshot: SimulationSnapshot) => CoachMark | null)[] = [
  /**
   * First, because it is true first: a new save is handed one Spell Point and
   * no way to know it. Nothing else in the game is free, already affordable and
   * waiting the moment the world loads.
   *
   * `spellTreePurchasedPoints === 0` is what keeps it to that granted point.
   * Without it a respec - which empties the activated nodes and hands the
   * points back - would put a beginner's hint in front of a player forty hours
   * in.
   */
  (snapshot) => {
    if (snapshot.spellTreePurchasedPoints > 0) return null;
    if (snapshot.spellTreeUnspentPoints < 1 || snapshot.activeSpellNodeIds.length > 0) return null;
    return {
      destinationId: 'spell-tree',
      text: 'You have a Spell Point. The route you spend it on is the run you get.',
    };
  },

  // Gear opens at level 1 across all eight slots, so "nothing bought yet" is
  // every piece still sitting on the level it was given.
  (snapshot) => {
    const untouched = snapshot.gear.every((piece) => piece.level === 1);
    const cheapest = snapshot.gear.reduce<{ raw: string } | null>(
      (best, piece) =>
        best === null || big(piece.nextLevelCost.raw).cmp(big(best.raw)) < 0
          ? piece.nextLevelCost
          : best,
      null,
    );
    if (!untouched || !cheapest || !affords(snapshot.gold, cheapest)) return null;
    return { destinationId: 'gear', text: 'Gold buys gear levels, and gear levels never reset.' };
  },

  (snapshot) => {
    if (snapshot.spellTreePurchasedPoints > 0) return null;
    if (!affords(snapshot.essence, snapshot.nextSpellPointCost)) return null;
    return { destinationId: 'spell-tree', text: 'Essence buys Spell Points. Points grow the spell itself.' };
  },

  (snapshot) => {
    if (!snapshot.canSummon || snapshot.companions.length > 0) return null;
    return { destinationId: 'summon', text: 'Starlight summons companions, and they fight beside you.' };
  },

  // Last, and only ever once: the first Rebirth is the one that has to be
  // explained, because it is the only purchase in the game that costs progress.
  (snapshot) => {
    if (!snapshot.canRebirth || snapshot.rebirths > 0) return null;
    return { destinationId: 'rebirth', text: 'Rebirth trades this frontier for Knowledge, and Knowledge is permanent.' };
  },
];

export function coachMark(snapshot: SimulationSnapshot): CoachMark | null {
  // Nothing speaks over the premise. It is the one screen that explains what
  // the wallets are for, and a hint about one of them underneath it is a hint
  // arriving before its own vocabulary does.
  if (!snapshot.storyFlags.includes(PREMISE_FLAG)) return null;

  for (const mark of MARKS) {
    const found = mark(snapshot);
    if (found) return found;
  }
  return null;
}
