import type Decimal from 'break_eternity.js';
import { STAR_UP_SHARDS } from '../../content/companionTuning';
import type { GameEvent } from '../events/GameEvent';
import type { GameState, RunState } from '../model';
import { big } from '../numbers';
import { companionMaxHp, requireCompanion } from './CompanionCatalog';
import type { CompanionCombatant, CompanionsState, OwnedCompanion } from './types';
import { MAX_COMPANION_STARS, PARTY_SIZE } from './types';

export function createInitialCompanionsState(): CompanionsState {
  return {
    starlight: big(0),
    owned: {},
    party: new Array<string | null>(PARTY_SIZE).fill(null),
    drawSerial: 0,
    pityCounter: 0,
  };
}

/**
 * Shards for the next star, or null when a companion is already at five.
 *
 * Priced by rarity rather than by how many stars are already on it: a
 * duplicate is worth one shard whatever it was, so the rarer a companion is to
 * see again, the fewer sightings it asks for.
 */
export function starUpCost(definitionId: string, stars: number): number | null {
  if (stars >= MAX_COMPANION_STARS) return null;
  return STAR_UP_SHARDS[requireCompanion(definitionId).rarity];
}

export function canAscend(owned: OwnedCompanion): boolean {
  const cost = starUpCost(owned.definitionId, owned.stars);
  return cost !== null && owned.shards >= cost;
}

/**
 * Brings the whole party back between encounters, alongside the mage's own
 * health. A knockout costs the rest of the fight, not the run.
 *
 * A free function rather than a method so `ProgressionSystem` can call it where
 * it already resets the run, the same way it calls `clearSpellCombat`.
 */
export function restoreCompanions(run: RunState): void {
  for (const companion of run.companions) {
    const definition = requireCompanion(companion.definitionId);
    companion.hp = big(companion.maxHp);
    companion.downed = false;
    companion.revivedThisEncounter = false;
    // A bulwark is a combat effect, and combat state is encounter-scoped.
    companion.shield = undefined;
    companion.attackCooldown = definition.attackInterval;
    companion.abilityCooldown = definition.ability.cooldown;
  }
  // The bench only exists to remember wounds within an encounter.
  run.benchedCompanions = [];
}

export class CompanionSystem {
  constructor(private readonly emit: (event: GameEvent) => void) {}

  /**
   * Rebuilds the live party from the persistent roster.
   *
   * Called whenever ownership, the party or the mage's max health changes, the
   * same way `GearSystem.syncMageStats` is. A companion that keeps its slot
   * keeps its wounds: resyncing because a ring was levelled must not heal the
   * front line mid-fight, so health carries across as a fraction of maximum.
   */
  sync(state: GameState): void {
    const { run, companions } = state;
    // Keyed by identity, never by slot. Keyed by slot, any party edit that
    // moved a companion built it again from scratch at full health - which
    // made a knockout, meant to cost the rest of the encounter, cost nothing.
    const known = new Map<string, CompanionCombatant>();
    for (const companion of [...run.companions, ...run.benchedCompanions]) {
      known.set(companion.definitionId, companion);
    }

    const next: CompanionCombatant[] = [];
    const fielded = new Set<string>();

    companions.party.slice(0, PARTY_SIZE).forEach((definitionId, slot) => {
      if (!definitionId) return;
      const owned = companions.owned[definitionId];
      if (!owned) return; // A party entry for something no longer owned is simply empty.
      const definition = requireCompanion(definitionId);
      const maxHp = companionMaxHp(definition, owned.stars, run.mage.maxHp);
      const existing = known.get(definitionId);
      fielded.add(definitionId);

      if (existing) {
        next.push({
          ...existing,
          slot,
          stars: owned.stars,
          maxHp,
          hp: scaleHealth(existing.hp, existing.maxHp, maxHp),
        });
        return;
      }

      next.push({
        slot,
        definitionId,
        stars: owned.stars,
        hp: big(maxHp),
        maxHp,
        attackCooldown: definition.attackInterval,
        abilityCooldown: definition.ability.cooldown,
        downed: false,
      });
    });

    run.companions = next;
    // Whoever fought and is no longer fielded waits here with their wounds.
    run.benchedCompanions = [...known.values()].filter(
      (companion) => !fielded.has(companion.definitionId),
    );
  }

  equip(state: GameState, definitionId: string, slot: number): boolean {
    if (!Number.isInteger(slot) || slot < 0 || slot >= PARTY_SIZE) return false;
    const { companions } = state;
    if (!companions.owned[definitionId]) return false;
    // A companion cannot hold two slots; moving it vacates the one it was in.
    const existing = companions.party.indexOf(definitionId);
    if (existing === slot) return false;
    if (existing !== -1) companions.party[existing] = null;
    companions.party[slot] = definitionId;
    this.sync(state);
    this.emit({
      type: 'companion_equipped',
      time: state.run.elapsedSeconds,
      definitionId,
      slot,
    });
    return true;
  }

  unequip(state: GameState, slot: number): boolean {
    const { companions } = state;
    if (!Number.isInteger(slot) || slot < 0 || slot >= PARTY_SIZE) return false;
    const definitionId = companions.party[slot];
    if (!definitionId) return false;
    companions.party[slot] = null;
    this.sync(state);
    this.emit({
      type: 'companion_equipped',
      time: state.run.elapsedSeconds,
      definitionId: null,
      slot,
    });
    return true;
  }

  ascend(state: GameState, definitionId: string): boolean {
    const owned = state.companions.owned[definitionId];
    if (!owned) return false;
    const cost = starUpCost(definitionId, owned.stars);
    if (cost === null || owned.shards < cost) return false;

    owned.shards -= cost;
    owned.stars += 1;
    this.sync(state);
    this.emit({
      type: 'companion_ascended',
      time: state.run.elapsedSeconds,
      definitionId,
      stars: owned.stars,
    });
    return true;
  }
}

/** Keeps the same fraction of health across a change in maximum. */
function scaleHealth(hp: Decimal, previousMax: Decimal, nextMax: Decimal): Decimal {
  if (previousMax.cmp(0) <= 0) return big(nextMax);
  const scaled = hp.div(previousMax).mul(nextMax);
  return scaled.cmp(nextMax) > 0 ? big(nextMax) : scaled;
}
