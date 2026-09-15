/**
 * The player the balance harnesses drive.
 *
 * Extracted from `sweep.test.ts` when a second harness needed the same player,
 * and then cut in half when automation shipped: the bot used to carry its own
 * copy of the marginal-stat-per-gold purchase rule, which meant every figure
 * in `PROGRESSION_CURVE_V1.md` was measured against a player the game did not
 * actually have. The engine now owns that rule
 * (`AutomationSystem.bestGearPurchase`) and runs it before every encounter, so
 * what is left here is only what a real player still does by hand.
 *
 * That split is the point. Anything this file does that automation also does
 * would be measuring double; anything automation does that this file skips is
 * measured for free, because the simulation is doing it.
 *
 * Measurement only. Nothing in `src/` may import from here.
 */
import { EvercastSimulation } from '../../src/engine/EvercastSimulation';
import { SPELL_ATTUNEMENTS, SPELL_TREE_NODES } from '../../src/content/spellTree';

export const TICK_SECONDS = 0.25;

/**
 * The bot has no state left to carry.
 *
 * It used to hold `wantHp`, the flag that alternated offence and defence
 * between purchases. That moved into the run alongside the rest of automation,
 * so the policy the curve was measured against is now the policy that ships.
 */
export interface BotState {
  readonly manual: true;
}

export function createBot(): BotState {
  return { manual: true };
}

/**
 * Everything a player still has to decide.
 *
 * Gold, Spell Points and shards are gone from here because automation spends
 * them. What remains is deliberate: activating a node is a build decision the
 * game must never take for the player, attunements are a prestige choice, and
 * summoning is off by default because the reveal is content rather than
 * friction - so a harness measuring the default experience has to draw by
 * hand, exactly as a default player does.
 */
export function developBuild(simulation: EvercastSimulation): void {
  for (let pass = 0; pass < 3; pass += 1) {
    let progressed = false;
    for (const node of SPELL_TREE_NODES) {
      if (simulation.execute({ type: 'activate_spell_node', nodeId: node.id })) progressed = true;
    }
    if (!progressed) break;
  }
  for (const attunement of SPELL_ATTUNEMENTS) {
    simulation.execute({ type: 'buy_attunement', attunementId: attunement.id });
  }
  while (simulation.execute({ type: 'summon_draw', count: 10 }));

  const owned = Object.keys(simulation.getState().companions.owned);
  const { party } = simulation.getState().companions;
  for (let slot = 0; slot < 5; slot += 1) {
    if (party[slot]) continue;
    for (const definitionId of owned) {
      if (party.includes(definitionId)) continue;
      if (simulation.execute({ type: 'equip_companion', definitionId, slot })) break;
    }
  }
}

export function play(simulation: EvercastSimulation, _state: BotState): void {
  simulation.advance(TICK_SECONDS, { presentationEvents: false });
  developBuild(simulation);
}
