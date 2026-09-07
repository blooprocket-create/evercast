import { describe, expect, it } from 'vitest';
import { compileSpell, createDefaultSpellBuild } from './SpellCompiler';
import { resolveEffects } from './EffectResolver';

describe('spell compiler', () => {
  it('compiles data-driven stats and trigger effects', () => {
    const build = createDefaultSpellBuild();
    build.modifiers = [
      { id: 'power', kind: 'stat', stat: 'damage', operation: 'multiply', value: 2 },
      { id: 'split', kind: 'stat', stat: 'projectiles', operation: 'add', value: 2 },
      { id: 'echo', kind: 'trigger', trigger: 'onCrit', action: { kind: 'repeatProjectile', count: 2, damageMultiplier: 0.5 } },
    ];
    const compiled = compileSpell(build);
    expect(compiled.damage).toBe('4');
    expect(compiled.projectileCount).toBe(3);
    expect(resolveEffects(compiled, 'onCrit').repeatProjectiles).toEqual([
      { count: 2, damageMultiplier: 0.5 },
    ]);
  });
});
