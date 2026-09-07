import { big } from '../numbers';
import type { CompiledSpell, SpellTrigger } from './types';

export interface EffectResolution {
  bonusDamage: string;
  repeatProjectiles: Array<{ count: number; damageMultiplier: number }>;
  essenceMultiplier: number;
}

export function resolveEffects(
  spell: CompiledSpell,
  trigger: SpellTrigger,
  triggeringDamage = '0',
): EffectResolution {
  let bonusDamage = big(0);
  const repeatProjectiles: Array<{ count: number; damageMultiplier: number }> = [];
  let essenceMultiplier = 1;

  for (const modifier of spell.triggerModifiers.get(trigger) ?? []) {
    switch (modifier.action.kind) {
      case 'bonusDamage':
        bonusDamage = bonusDamage.add(big(triggeringDamage).mul(modifier.action.multiplier));
        break;
      case 'repeatProjectile':
        repeatProjectiles.push({
          count: Math.max(0, Math.floor(modifier.action.count)),
          damageMultiplier: Math.max(0, modifier.action.damageMultiplier),
        });
        break;
      case 'essenceMultiplier':
        essenceMultiplier *= Math.max(0, modifier.action.multiplier);
        break;
    }
  }

  return {
    bonusDamage: bonusDamage.toString(),
    repeatProjectiles,
    essenceMultiplier,
  };
}
