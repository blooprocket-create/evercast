import { readFileSync } from 'node:fs';
import { NO_MASTERY } from '../../engine/prestige/Mastery';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AssetContainer, LoadAssetContainerAsync, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { VfxPool, VFX_BUDGETS, type VfxQuality } from './VfxPool';
import { SpellVfxPresenter } from './SpellVfxPresenter';
import { CombatFxPresenter } from './CombatFxPresenter';
import { CombatSystem } from '../../engine/combat/CombatSystem';
import { DEFAULT_ENGINE_CONFIG } from '../../engine/config';
import { createInitialGameState } from '../../engine/state';
import { big } from '../../engine/numbers';
import type { GameEvent } from '../../engine/events/GameEvent';
import { SPELL_MECHANIC_DEFAULTS } from '../../content/spellTreeTuning';

function local(url: string, scene: Scene): Promise<AssetContainer> {
  return LoadAssetContainerAsync(
    new Uint8Array(readFileSync(resolve('public', url.replace(/^\//, '')))),
    scene,
    { pluginExtension: '.glb' },
  );
}

describe('VFX resource ownership', () => {
  it('bounds meteor and contagion visuals without limiting or mutating authoritative procs', async () => {
    const engine = new NullEngine(),
      scene = new Scene(engine),
      pool = new VfxPool(scene, 'low', local);
    await pool.ready;
    const state = createInitialGameState(DEFAULT_ENGINE_CONFIG),
      events: GameEvent[] = [];
    state.run.spell = {
      baseDamage: '1',
      castInterval: 0.02,
      projectileCount: 2,
      critChance: 0,
      critMultiplier: 2,
      modifiers: [],
      mechanics: {
        ...SPELL_MECHANIC_DEFAULTS,
        route: 'twin',
        twinCast: true,
        explosive: true,
        dot: true,
        contagion: true,
        meteor: true,
        plaguefall: true,
        meteorChance: 1,
        contagionChance: 1,
      },
    };
    state.run.enemies = Array.from({ length: 6 }, (_, i) => ({
      instanceId: i + 1,
      definitionId: 'briarling',
      name: 'Target',
      stage: 1,
      boss: false,
      hp: big('1e12'),
      maxHp: big('1e12'),
      attackDamage: big(0),
      attackInterval: 1,
      attackCooldown: 1,
      position: { x: 2 + i * 0.4, z: 0 },
    }));
    const presenter = new SpellVfxPresenter(pool, new CombatFxPresenter(pool, scene), {
      staff: () => new Vector3(-3, 1, 0),
      mage: () => new Vector3(-3, 1, 0),
      target: (id) => new Vector3(2 + (id - 1) * 0.4, 0.65, 0),
      actor: () => undefined,
    });
    const combat = new CombatSystem(DEFAULT_ENGINE_CONFIG, (e) => events.push(e));
    let maxPending = 0;
    for (let i = 0; i < 200; i++) {
      combat.cast(state.run, state.equipment, NO_MASTERY);
      state.run.elapsedSeconds += 0.02;
      combat.evolving.effects.advance(state.run);
      maxPending = Math.max(maxPending, state.run.combatState!.meteors.length);
      const before = JSON.stringify(state.run);
      presenter.ingest(
        { castInterval: 0.02, activeSpellNodeIds: [], spellMechanics: state.run.spell.mechanics },
        events.splice(0),
      );
      presenter.update(0.02);
      expect(JSON.stringify(state.run)).toBe(before);
      expect(presenter.stats.jobs).toBeLessThanOrEqual(pool.budget.jobs);
    }
    expect(maxPending).toBeGreaterThan(pool.budget.meshes);
    expect(pool.stats.meshes).toBeLessThanOrEqual(pool.budget.meshes);
    expect(pool.stats.paths).toBeLessThanOrEqual(pool.budget.paths);
    presenter.ingest({ castInterval: 1, activeSpellNodeIds: [], enemies: [], elapsedSeconds: 10 }, []);
    for (let i = 0; i < 20; i++) presenter.update(0.1);
    expect(presenter.stats.active).toBe(0);
    expect(presenter.stats.jobs).toBe(0);
    presenter.dispose();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.materials).toEqual([scene.defaultMaterial]);
    scene.dispose();
    engine.dispose();
  });
  it('refreshes the complete draw range when a shard slot becomes a larger rune', async () => {
    const engine = new NullEngine(),
      scene = new Scene(engine),
      pool = new VfxPool(scene, 'low', local);
    await pool.ready;
    expect(scene.getMeshByName('VFX template arcane_ring_a')!.getTotalIndices()).not.toBe(
      scene.getMeshByName('VFX template arcane_ring_b')!.getTotalIndices(),
    );
    expect(scene.getMeshByName('VFX template arcane_glyph_a')!.getTotalIndices()).not.toBe(
      scene.getMeshByName('VFX template arcane_glyph_b')!.getTotalIndices(),
    );
    pool.emit('arcane_shard_a', 'arcane', 0.1, () => {});
    const piece = scene.meshes.find((m) => m.name === 'VFX piece 0')!;
    const small = piece.getTotalIndices();
    pool.update(0.2);
    pool.emit('fire_ring', 'fire', 0.1, () => {});
    expect(pool.stats.meshes).toBe(1);
    expect(piece.getTotalIndices()).toBeGreaterThan(small);
    expect(piece.subMeshes[0].indexCount).toBe(piece.getTotalIndices());
    expect(piece.subMeshes[0].verticesCount).toBe(piece.getTotalVertices());
    pool.dispose();
    scene.dispose();
    engine.dispose();
  });
  it('samples the moving staff at release and delivers impact before death even after the target disappears', async () => {
    const engine = new NullEngine(),
      scene = new Scene(engine),
      pool = new VfxPool(scene, 'low', local);
    await pool.ready;
    const feedback = new CombatFxPresenter(pool, scene),
      order: string[] = [];
    vi.spyOn(feedback, 'hit').mockImplementation(() => {
      order.push('hit');
    });
    vi.spyOn(feedback, 'death').mockImplementation(() => {
      order.push('death');
    });
    let target: Vector3 | undefined = new Vector3(2, 0.7, 0);
    const staff = new Vector3(-3, 1, 0);
    const presenter = new SpellVfxPresenter(pool, feedback, {
      staff: () => staff.clone(),
      mage: () => staff.clone(),
      target: () => target,
      actor: () => undefined,
    });
    presenter.ingest({ castInterval: 1, activeSpellNodeIds: [] }, [
      {
        type: 'projectile_hit',
        time: 0,
        castId: 1,
        projectileIndex: 0,
        instanceId: 1,
        damage: '5',
        critical: false,
        source: 'direct',
        sequence: 0,
      },
      { type: 'enemy_killed', time: 0, stage: 1, instanceId: 1, enemyId: 'moss_slime', gold: '0' },
    ]);
    staff.x = -2;
    target = undefined;
    presenter.update(0.12);
    expect(order).toEqual([]);
    expect(
      scene.meshes.some((m) => m.name.startsWith('VFX piece') && m.isEnabled() && m.position.x === -2),
    ).toBe(true);
    presenter.update(0.14);
    expect(order).toEqual(['hit']);
    presenter.update(0.02);
    expect(order).toEqual(['hit', 'death']);
    presenter.dispose();
    scene.dispose();
    engine.dispose();
  });
  it.each(['low', 'medium', 'high'] as VfxQuality[])(
    'bounds %s resources over sustained real combat, then drains and disposes',
    async (quality) => {
      const engine = new NullEngine(),
        scene = new Scene(engine),
        pool = new VfxPool(scene, quality, local);
      await pool.ready;
      expect(pool.stats.templates).toBe(30);
      const positions = new Map(Array.from({ length: 6 }, (_, i) => [i + 1, new Vector3(i + 2, 0.7, i % 2)]));
      const presenter = new SpellVfxPresenter(pool, new CombatFxPresenter(pool, scene), {
        staff: () => new Vector3(-3, 1, 0),
        mage: () => new Vector3(-3, 0.8, 0),
        target: (id) => positions.get(id),
        actor: () => undefined,
      });
      const state = createInitialGameState(DEFAULT_ENGINE_CONFIG);
      state.run.mage.maxHp = big('1e12');
      state.run.mage.hp = big(1);
      state.run.spell = {
        baseDamage: '1',
        castInterval: 0.01,
        projectileCount: 5,
        critChance: 1,
        critMultiplier: 2,
        modifiers: [
          { id: 'p', kind: 'combat', action: { kind: 'pierce', count: 1 } },
          { id: 'c', kind: 'combat', action: { kind: 'chain', count: 3, damageMultiplier: 0.5 } },
          { id: 's', kind: 'combat', action: { kind: 'splash', targets: 5, damageMultiplier: 0.3 } },
          { id: 'f', kind: 'combat', action: { kind: 'control', delaySeconds: 0.2 } },
          { id: 'b', kind: 'combat', action: { kind: 'leech', fraction: 0.2 } },
          {
            id: 'r',
            kind: 'trigger',
            trigger: 'onCrit',
            action: { kind: 'repeatProjectile', count: 2, damageMultiplier: 0.3 },
          },
        ],
      };
      state.run.enemies = Array.from(positions.keys(), (instanceId) => ({
        instanceId,
        definitionId: 'moss_slime',
        name: 'target',
        stage: 1,
        boss: false,
        hp: big('1e12'),
        maxHp: big('1e12'),
        attackDamage: big(0),
        attackInterval: 1,
        attackCooldown: 1,
      }));
      const events: GameEvent[] = [];
      const combat = new CombatSystem(DEFAULT_ENGINE_CONFIG, (e) => events.push(e));
      let warmMeshes = 0;
      for (let frame = 0; frame < 800; frame++) {
        combat.cast(state.run, state.equipment, NO_MASTERY);
        presenter.ingest({ castInterval: 0.01, activeSpellNodeIds: [] }, events.splice(0));
        presenter.update(0.01);
        expect(presenter.stats.jobs).toBeLessThanOrEqual(VFX_BUDGETS[quality].jobs);
        if (frame === 399) warmMeshes = scene.meshes.length;
      }
      expect(scene.meshes.length).toBe(warmMeshes);
      expect(pool.stats.meshes).toBeLessThanOrEqual(VFX_BUDGETS[quality].meshes);
      expect(pool.stats.paths).toBeLessThanOrEqual(VFX_BUDGETS[quality].paths);
      positions.clear();
      for (let i = 0; i < 60; i++) presenter.update(0.1);
      expect(presenter.stats.jobs).toBe(0);
      expect(presenter.stats.active).toBe(0);
      expect(presenter.stats.chilled).toBe(0);
      presenter.dispose();
      expect(scene.meshes.length).toBe(0);
      expect(scene.materials).toEqual([scene.defaultMaterial]);
      expect(scene.lights.length).toBe(0);
      scene.dispose();
      engine.dispose();
    },
    30000,
  );

  it('disposes downloads that complete after teardown without resurrecting meshes', async () => {
    const engine = new NullEngine(),
      scene = new Scene(engine);
    const resolvers: ((c: AssetContainer) => void)[] = [];
    const pool = new VfxPool(scene, 'low', () => new Promise((resolve) => resolvers.push(resolve)));
    pool.dispose();
    for (const resolve of resolvers) {
      const container = new AssetContainer(scene);
      const dispose = vi.spyOn(container, 'dispose');
      resolve(container);
      await Promise.resolve();
      expect(dispose).toHaveBeenCalledOnce();
    }
    await pool.ready;
    expect(scene.meshes).toHaveLength(0);
    expect(pool.stats.active).toBe(0);
    scene.dispose();
    engine.dispose();
  });
});
