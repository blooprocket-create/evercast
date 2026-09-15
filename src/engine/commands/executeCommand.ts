import { clearSpellCombat } from '../combat/SpellCombatState';
import { breakSurge } from '../combat/Surge';
import { requireCompanion } from '../companions/CompanionCatalog';
import type { CompanionSystem } from '../companions/CompanionSystem';
import type { GachaSystem } from '../companions/GachaSystem';
import type { EngineConfig } from '../config';
import type { GameEvent } from '../events/GameEvent';
import type { GearSystem } from '../gear/GearSystem';
import type { GameState } from '../model';
import type { ProgressionSystem } from '../progression/ProgressionSystem';
import type { RebirthSystem } from '../prestige/RebirthSystem';
import { compileSpell } from '../spell/SpellCompiler';
import type { SpellTreeSystem } from '../spellTree/SpellTreeSystem';
import type { EngineCommand, LastSummonSnapshot } from '../types';

/**
 * Everything the interface can ask the simulation to do, in one place.
 *
 * This used to be an 86-line switch inside `EvercastSimulation`, which the
 * architecture suite caps at 300 lines precisely so the coordinator stays one.
 * That cap fired twice in a row as commands were added, which is the guard
 * doing its job rather than being in the way: a dispatcher that grows with
 * every feature is not coordination, and it now has somewhere to grow.
 *
 * Every case returns whether the engine accepted it, so a surface can reflect
 * a rejection without reimplementing the rule behind it.
 */
export interface CommandContext {
  state: GameState;
  config: EngineConfig;
  emit: (event: GameEvent) => void;
  gear: GearSystem;
  spellTree: SpellTreeSystem;
  companions: CompanionSystem;
  gacha: GachaSystem;
  progression: ProgressionSystem;
  rebirth: RebirthSystem;
  /** Hands a draw to the reveal overlay. Only a player's own draw does this. */
  recordSummon(summon: LastSummonSnapshot): void;
}

/** Keeps a faster spell from waiting out a cooldown the slower one set. */
function reseatCastCooldown(state: GameState): void {
  state.run.castCooldown = Math.min(
    state.run.castCooldown,
    compileSpell(state.run.spell).castInterval,
  );
}

export function executeCommand(context: CommandContext, command: EngineCommand): boolean {
  const { state } = context;
  switch (command.type) {
    case 'retry_frontier':
      context.progression.retryFrontier(state);
      return true;
    case 'set_spell_build':
      clearSpellCombat(state.run);
      state.run.spell = structuredClone(command.build);
      reseatCastCooldown(state);
      return true;
    case 'level_gear': {
      const levelled = context.gear.levelUp(state, command.slot);
      // Companion health is a share of the mage's, so a gear level that raises
      // her maximum raises theirs in the same breath.
      if (levelled) context.companions.sync(state);
      return levelled;
    }
    case 'buy_spell_point':
      return context.spellTree.buyPoint(state);
    case 'buy_attunement':
      return context.spellTree.buyAttunement(state, command.attunementId);
    case 'activate_spell_node': {
      const activated = context.spellTree.activateNode(state, command.nodeId);
      if (activated) reseatCastCooldown(state);
      return activated;
    }
    /**
     * The one piece of onboarding that cannot be derived. A hint about gold
     * stops being true the moment gold is spent, so nothing needs recording;
     * a premise the player has read leaves no mark on the state it described,
     * so it does. Refusing a flag already held keeps it idempotent, and keeps
     * a re-dismissal from spending a publish and a save on nothing.
     */
    case 'mark_story_flag':
      if (state.meta.storyFlags.includes(command.flag)) return false;
      state.meta.storyFlags.push(command.flag);
      return true;
    case 'respec_spell_tree':
      return context.spellTree.respec(state);
    case 'rebirth': {
      const performed = context.rebirth.perform(state);
      if (performed) {
        context.spellTree.syncSpell(state);
        // The roster survives a rebirth alongside gear and the spell tree; a
        // prestige that wiped a collection would make the gacha worthless.
        context.companions.sync(state);
      }
      return performed;
    }
    case 'summon_draw': {
      const results = context.gacha.draw(state, command.count);
      if (!results) return false;
      context.companions.sync(state);
      context.recordSummon({
        serial: state.companions.drawSerial,
        results: results.map((result) => ({
          ...result,
          name: requireCompanion(result.definitionId).name,
        })),
      });
      return true;
    }
    case 'ascend_companion':
      return context.companions.ascend(state, command.definitionId);
    case 'equip_companion':
      return context.companions.equip(state, command.definitionId, command.slot);
    case 'unequip_companion':
      return context.companions.unequip(state, command.slot);
    /**
     * Refusing a setting already held keeps it idempotent, for the same reason
     * `mark_story_flag` does: a toggle re-sent by a re-render should not cost a
     * publish and a save.
     */
    case 'set_automation':
      if (state.meta.automation[command.key] === command.enabled) return false;
      state.meta.automation[command.key] = command.enabled;
      return true;
    /**
     * The only command here with a deadline - everything above is equally legal
     * a minute later. `breakSurge` settles that against the boss's own cooldown
     * rather than against whatever the interface last drew.
     */
    case 'counterspell':
      return breakSurge(state.run, context.config.enemyAttackRange, context.emit) !== undefined;
  }
}
