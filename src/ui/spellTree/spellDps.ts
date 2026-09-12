import type Decimal from 'break_eternity.js';
import { big } from '../../engine/numbers';
import { compileSpell } from '../../engine/spell/SpellCompiler';
import type { CompiledSpell } from '../../engine/spell/types';
import { buildSpellFromTree } from '../../engine/spellTree/SpellTreeSystem';
import type { SpellTreeState } from '../../engine/spellTree/types';

/**
 * What a tree node is actually worth. The old tree told you a node existed and
 * what it cost; it never told you what it would do, which is the only question
 * a player is really asking.
 *
 * Both sides of the comparison are compiled the same way, so the ratio is
 * exact even though the base cast interval ignores momentum and overdrive.
 */
export function dpsOf(compiled: CompiledSpell, gearDamageBonus: string): Decimal {
  const m = compiled.mechanics;
  const charged = m?.chargedCast ? m.chargedDamage : 1;
  // A second route costs base damage as well as points, so the projection has
  // to say so - otherwise awakening one reads as a bigger gain than it is.
  const routes = m ? Number(m.twinCast) + Number(m.piercingCast) + Number(m.chargedCast) : 0;
  const blend = m && routes > 1 ? Math.pow(m.routeBlendScale, routes - 1) : 1;
  const perProjectile = big(compiled.damage).add(big(gearDamageBonus)).mul(charged).mul(blend);
  const critFactor = 1 + compiled.critChance * Math.max(0, compiled.critMultiplier - 1);
  return perProjectile
    .mul(compiled.projectileCount)
    .mul(critFactor)
    .div(Math.max(0.01, compiled.castInterval));
}

export interface DpsProjection {
  /** The player's real DPS, scaled by what the node changes. */
  projected: Decimal;
  /** Percentage change, or null when it cannot be expressed as one. */
  percent: number | null;
  /**
   * Human names of everything the node alters. Plenty of nodes move blast
   * radius, penetrations or status durations without touching single-target
   * DPS at all - reporting a bare "+0%" for those would read as "useless"
   * when it only means "not captured by the DPS formula".
   */
  changes: string[];
}

/** blastRadius -> Blast radius */
function humanise(key: string): string {
  const spaced = key.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const COMPILED_KEYS = [
  'damage',
  'castInterval',
  'projectileCount',
  'critChance',
  'critMultiplier',
  'pierceTargets',
  'splashTargets',
  'splashDamageMultiplier',
  'chainTargets',
  'chainDamageMultiplier',
  'controlDelaySeconds',
  'leechFraction',
] as const;

function describeChanges(before: CompiledSpell, after: CompiledSpell): string[] {
  const changed: string[] = [];
  for (const key of COMPILED_KEYS) {
    if (before[key] !== after[key]) changed.push(humanise(key));
  }
  const beforeMechanics = before.mechanics;
  const afterMechanics = after.mechanics;
  if (beforeMechanics && afterMechanics) {
    for (const key of Object.keys(afterMechanics) as (keyof typeof afterMechanics)[]) {
      if (beforeMechanics[key] !== afterMechanics[key]) changed.push(humanise(String(key)));
    }
  }
  return [...new Set(changed)];
}

export function projectNode(
  state: SpellTreeState,
  nodeId: string,
  gearDamageBonus: string,
  currentDps: Decimal,
): DpsProjection {
  const compiledBefore = compileSpell(buildSpellFromTree(state));
  const compiledAfter = compileSpell(
    buildSpellFromTree({
      purchasedPoints: state.purchasedPoints,
      activatedNodeIds: [...state.activatedNodeIds, nodeId],
      attunements: state.attunements,
    }),
  );
  const changes = describeChanges(compiledBefore, compiledAfter);

  const before = dpsOf(compiledBefore, gearDamageBonus);
  const after = dpsOf(compiledAfter, gearDamageBonus);
  if (before.cmp(0) <= 0) return { projected: currentDps, percent: null, changes };

  const ratio = after.div(before);
  return {
    projected: currentDps.mul(ratio),
    percent: Math.round((ratio.toNumber() - 1) * 1000) / 10,
    changes,
  };
}
