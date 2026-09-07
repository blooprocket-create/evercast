export type SpellTrigger = 'onHit' | 'onCrit' | 'onKill';

export type SpellStat =
  | 'damage'
  | 'castSpeed'
  | 'projectiles'
  | 'critChance'
  | 'critMultiplier';

export type SpellCombatAction =
  | { kind: 'pierce'; count: number }
  | { kind: 'splash'; targets: number; damageMultiplier: number }
  | { kind: 'chain'; count: number; damageMultiplier: number }
  | { kind: 'control'; delaySeconds: number }
  | { kind: 'leech'; fraction: number };

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
    }
  | {
      id: string;
      kind: 'combat';
      action: SpellCombatAction;
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
  pierceTargets: number;
  splashTargets: number;
  splashDamageMultiplier: number;
  chainTargets: number;
  chainDamageMultiplier: number;
  controlDelaySeconds: number;
  leechFraction: number;
  triggerModifiers: ReadonlyMap<SpellTrigger, readonly Extract<SpellModifier, { kind: 'trigger' }>[]>;
}
