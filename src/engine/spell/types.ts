export type SpellTrigger = 'onHit' | 'onCrit' | 'onKill';

export type SpellStat =
  | 'damage'
  | 'castSpeed'
  | 'projectiles'
  | 'critChance'
  | 'critMultiplier';

export type SpellModifier =
  | {
      id: string;
      kind: 'stat';
      stat: SpellStat;
      operation: 'add' | 'multiply';
      value: number;
    }
  | {
      id: string;
      kind: 'trigger';
      trigger: SpellTrigger;
      action:
        | { kind: 'bonusDamage'; multiplier: number; retrigger?: boolean }
        | { kind: 'repeatProjectile'; count: number; damageMultiplier: number }
        | { kind: 'essenceMultiplier'; multiplier: number };
    };

export interface SpellBuild {
  baseDamage: string;
  castInterval: number;
  projectileCount: number;
  critChance: number;
  critMultiplier: number;
  modifiers: SpellModifier[];
}

export interface CompiledSpell {
  damage: string;
  castInterval: number;
  projectileCount: number;
  critChance: number;
  critMultiplier: number;
  triggerModifiers: ReadonlyMap<SpellTrigger, readonly Extract<SpellModifier, { kind: 'trigger' }>[]>;
}
