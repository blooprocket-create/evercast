import { big } from '../numbers';
import type { CompiledSpell, SpellBuild, SpellModifier, SpellTrigger } from './types';

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

export function compileSpell(build: SpellBuild): CompiledSpell {
  let damage = big(build.baseDamage);
  let castInterval = build.castInterval;
  let projectileCount = build.projectileCount;
  let critChance = build.critChance;
  let critMultiplier = build.critMultiplier;
  const triggerMap = new Map<SpellTrigger, Extract<SpellModifier, { kind: 'trigger' }>[]>();

  for (const modifier of build.modifiers) {
    if (modifier.kind === 'trigger') {
      const list = triggerMap.get(modifier.trigger) ?? [];
      list.push(modifier);
      triggerMap.set(modifier.trigger, list);
      continue;
    }

    const apply = (current: number): number =>
      modifier.operation === 'add' ? current + modifier.value : current * modifier.value;

    switch (modifier.stat) {
      case 'damage':
        damage = modifier.operation === 'add'
          ? damage.add(modifier.value)
          : damage.mul(modifier.value);
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

  return {
    damage: damage.toString(),
    castInterval: Math.max(0.01, castInterval),
    projectileCount,
    critChance,
    critMultiplier,
    triggerModifiers: triggerMap,
  };
}
