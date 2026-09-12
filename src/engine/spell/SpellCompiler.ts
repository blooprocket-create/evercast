import { big } from '../numbers';
import type { CompiledSpell, SpellBuild, SpellModifier, SpellTrigger } from './types';
import type { SpellMechanics } from './SpellMechanics';

export function createDefaultSpellBuild(): SpellBuild {
  return {
    baseDamage: '2',
    castInterval: 1.35,
    projectileCount: 1,
    critChance: 0.05,
    critMultiplier: 2,
    modifiers: [],
  };
}

/**
 * Every multiplier the routes put on base damage before a single hit is
 * resolved: the charge, and the cost of holding more than one shape at once.
 *
 * One definition because two drift. `wizardPerHit` and this were computed
 * separately once before and the charged route made it into only one of them,
 * so companions quietly hit for less than the interface said.
 */
export function routeDamageScale(mechanics: SpellMechanics | undefined): number {
  if (!mechanics) return 1;
  const routes =
    Number(mechanics.twinCast) + Number(mechanics.piercingCast) + Number(mechanics.chargedCast);
  const blend = routes > 1 ? Math.pow(mechanics.routeBlendScale, routes - 1) : 1;
  return (mechanics.chargedCast ? mechanics.chargedDamage : 1) * blend;
}

export function compileSpell(build: SpellBuild): CompiledSpell {
  let damage = big(build.baseDamage);
  let castInterval = build.castInterval;
  let projectileCount = build.projectileCount;
  let critChance = build.critChance;
  let critMultiplier = build.critMultiplier;
  let pierceTargets = 0;
  let splashTargets = 0;
  let splashDamageMultiplier = 0;
  let chainTargets = 0;
  let chainDamageMultiplier = 0;
  let controlDelaySeconds = 0;
  let leechFraction = 0;
  const triggerMap = new Map<SpellTrigger, Extract<SpellModifier, { kind: 'trigger' }>[]>();

  for (const modifier of build.modifiers) {
    if (modifier.kind === 'trigger') {
      const list = triggerMap.get(modifier.trigger) ?? [];
      list.push(modifier);
      triggerMap.set(modifier.trigger, list);
      continue;
    }

    if (modifier.kind === 'combat') {
      switch (modifier.action.kind) {
        case 'pierce':
          pierceTargets += Math.max(0, Math.floor(modifier.action.count));
          break;
        case 'splash':
          splashTargets += Math.max(0, Math.floor(modifier.action.targets));
          splashDamageMultiplier = Math.max(
            splashDamageMultiplier,
            Math.max(0, modifier.action.damageMultiplier),
          );
          break;
        case 'chain':
          chainTargets += Math.max(0, Math.floor(modifier.action.count));
          chainDamageMultiplier = Math.max(
            chainDamageMultiplier,
            Math.max(0, modifier.action.damageMultiplier),
          );
          break;
        case 'control':
          controlDelaySeconds += Math.max(0, modifier.action.delaySeconds);
          break;
        case 'leech':
          leechFraction += Math.max(0, modifier.action.fraction);
          break;
      }
      continue;
    }

    const apply = (current: number): number =>
      modifier.operation === 'add' ? current + modifier.value : current * modifier.value;

    switch (modifier.stat) {
      case 'damage':
        damage = modifier.operation === 'add' ? damage.add(modifier.value) : damage.mul(modifier.value);
        break;
      case 'castSpeed': {
        const castSpeed = apply(1 / castInterval);
        castInterval = 1 / Math.max(0.01, castSpeed);
        break;
      }
      case 'projectiles':
        projectileCount = Math.max(1, Math.floor(apply(projectileCount)));
        break;
      case 'critChance':
        critChance = Math.min(1, Math.max(0, apply(critChance)));
        break;
      case 'critMultiplier':
        critMultiplier = Math.max(1, apply(critMultiplier));
        break;
    }
  }

  const mechanics = build.mechanics;
  // The routes compose, so these are three independent adjustments rather than
  // one switch: Piercing and Charged fix the projectile count at one, and Twin
  // overrides that to two whether or not they are also held.
  if (mechanics?.piercingCast) {
    projectileCount = 1;
    pierceTargets = mechanics.chain ? 0 : mechanics.penetrations;
    chainTargets = mechanics.chain ? mechanics.penetrations : 0;
    chainDamageMultiplier = mechanics.piercedDamage;
  }
  if (mechanics?.chargedCast) {
    projectileCount = 1;
    castInterval *= mechanics.chargedInterval;
  }
  if (mechanics?.twinCast) projectileCount = 2;
  return {
    damage: damage.toString(),
    mechanics: build.mechanics,
    castInterval: Math.max(0.01, castInterval),
    projectileCount,
    critChance,
    critMultiplier,
    pierceTargets,
    splashTargets,
    splashDamageMultiplier,
    chainTargets,
    chainDamageMultiplier,
    controlDelaySeconds,
    leechFraction: Math.min(1, leechFraction),
    triggerModifiers: triggerMap,
  };
}
