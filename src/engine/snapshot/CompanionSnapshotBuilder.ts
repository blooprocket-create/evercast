import type Decimal from 'break_eternity.js';
import { PITY_HARD } from '../../content/companionTuning';
// prettier-ignore
import { abilityMagnitude, companionDamage, companionMaxHp, companionThreat, requireCompanion, rowOf } from '../companions/CompanionCatalog';
import { canAscend, starUpCost } from '../companions/CompanionSystem';
import { companionIndices, formationPosition } from '../companions/Formation';
import { summonCost } from '../companions/GachaSystem';
import { COMPANION_RARITIES, PARTY_SIZE } from '../companions/types';
import type { CompanionCombatant } from '../companions/types';
import type { GameState } from '../model';
import { big, quantity } from '../numbers';
import type { CompanionSnapshot } from '../types';

/**
 * The companion read model, kept out of `SimulationSnapshotBuilder` for the
 * reason the architecture doc gives for keeping that file honest: a snapshot
 * builder that absorbs every system's derived view is the next god file.
 */
export interface CompanionSnapshotSet {
  starlight: ReturnType<typeof quantity>;
  summonCost: ReturnType<typeof quantity>;
  summonCostTen: ReturnType<typeof quantity>;
  canSummon: boolean;
  canSummonTen: boolean;
  pityCounter: number;
  pityHard: number;
  companions: CompanionSnapshot[];
  party: (CompanionSnapshot | null)[];
  ascendableCompanions: number;
}

export function buildCompanionSnapshots(
  state: GameState,
  wizardPerHit: Decimal,
): CompanionSnapshotSet {
  const { companions, run } = state;
  const live = new Map<string, CompanionCombatant>(
    run.companions.map((companion) => [companion.definitionId, companion]),
  );
  const indices = companionIndices(run);

  const roster = Object.values(companions.owned)
    .map((owned) => {
      const definition = requireCompanion(owned.definitionId);
      const slot = companions.party.indexOf(owned.definitionId);
      const combatant = live.get(owned.definitionId);
      const maxHp = companionMaxHp(definition, owned.stars, run.mage.maxHp);
      const hp = combatant?.hp;

      const snapshot: CompanionSnapshot = {
        definitionId: definition.id,
        name: definition.name,
        description: definition.description,
        rarity: definition.rarity,
        companionClass: definition.companionClass,
        row: rowOf(definition),
        kind: definition.kind,
        modelKey: definition.modelKey,
        stars: owned.stars,
        shards: owned.shards,
        shardsForNextStar: starUpCost(owned.stars),
        canAscend: canAscend(owned),
        ability: { ...definition.ability },
        abilityMagnitude: abilityMagnitude(definition, owned.stars),
        attackInterval: definition.attackInterval,
        threat: companionThreat(definition, owned.stars),
        maxHp: quantity(maxHp),
        damage: quantity(companionDamage(definition, owned.stars, wizardPerHit)),
        slot: slot === -1 ? null : slot,
      };

      if (combatant && hp) {
        snapshot.hp = quantity(hp);
        snapshot.hpPercent =
          combatant.maxHp.cmp(0) > 0
            ? Math.max(0, Math.min(100, hp.div(combatant.maxHp).toNumber() * 100))
            : 0;
        snapshot.downed = combatant.downed;
        snapshot.position = formationPosition(
          rowOf(definition),
          indices.get(combatant.slot) ?? 0,
        );
      }
      return snapshot;
    })
    // Rarest first, then most ascended, then by name - so a new legendary
    // surfaces at the top of the ledger rather than wherever it was drawn.
    .sort(
      (a, b) =>
        COMPANION_RARITIES.indexOf(b.rarity) - COMPANION_RARITIES.indexOf(a.rarity) ||
        b.stars - a.stars ||
        a.name.localeCompare(b.name),
    );

  const byId = new Map(roster.map((companion) => [companion.definitionId, companion]));
  const party = companions.party
    .slice(0, PARTY_SIZE)
    .map((definitionId) => (definitionId ? (byId.get(definitionId) ?? null) : null));

  const oneCost = big(summonCost(1));
  const tenCost = big(summonCost(10));

  return {
    starlight: quantity(companions.starlight),
    summonCost: quantity(oneCost),
    summonCostTen: quantity(tenCost),
    canSummon: companions.starlight.cmp(oneCost) >= 0,
    canSummonTen: companions.starlight.cmp(tenCost) >= 0,
    pityCounter: companions.pityCounter,
    pityHard: PITY_HARD,
    companions: roster,
    party,
    ascendableCompanions: roster.filter((companion) => companion.canAscend).length,
  };
}
