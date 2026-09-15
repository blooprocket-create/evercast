import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetContainer, LoadAssetContainerAsync, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { VfxPool } from './VfxPool';
import { SpellVfxPresenter } from './SpellVfxPresenter';
import { CombatFxPresenter } from './CombatFxPresenter';
import { SPELL_MECHANIC_DEFAULTS } from '../../content/spellTreeTuning';
import type { GameEvent } from '../../engine/events/GameEvent';

function local(url: string, scene: Scene): Promise<AssetContainer> {
  return LoadAssetContainerAsync(
    new Uint8Array(readFileSync(resolve('public', url.replace(/^\//, '')))),
    scene,
    { pluginExtension: '.glb' },
  );
}

const snapshot = {
  castInterval: 0.5,
  activeSpellNodeIds: [] as string[],
  spellMechanics: SPELL_MECHANIC_DEFAULTS,
};

const killingBlow: GameEvent = {
  type: 'projectile_hit',
  time: 0,
  castId: 1,
  projectileIndex: 0,
  instanceId: 7,
  damage: '10',
  critical: false,
  source: 'direct',
  sequence: 1,
};

const explosion: GameEvent = {
  type: 'effect_hit',
  time: 0,
  effectId: 1,
  castId: 1,
  instanceId: 7,
  sourceInstanceId: 0,
  damage: '20',
  effect: 'explosion',
  position: { x: 3, z: 0 },
};

let engine: NullEngine, scene: Scene, pool: VfxPool, combat: CombatFxPresenter;
/** Stands in for `BossTracker`, which forgets a boss the moment it dies. */
let remembered: Set<number>;
let presenter: SpellVfxPresenter;
let staggered: (boolean | undefined)[];

beforeEach(async () => {
  engine = new NullEngine();
  scene = new Scene(engine);
  pool = new VfxPool(scene, 'low', local);
  await pool.ready;
  combat = new CombatFxPresenter(pool, scene);
  remembered = new Set([7]);
  staggered = [];
  vi.spyOn(combat, 'hit').mockImplementation((_hit, _at, _actor, _from, boss) => {
    staggered.push(boss);
  });
  vi.spyOn(combat, 'effect').mockImplementation((_event, _at, _actor, _from, boss) => {
    staggered.push(boss);
  });
  presenter = new SpellVfxPresenter(pool, combat, {
    staff: () => new Vector3(-3, 1, 0),
    mage: () => new Vector3(-3, 1, 0),
    target: () => new Vector3(3, 0.65, 0),
    actor: () => undefined,
    boss: (id) => remembered.has(id),
  });
});

afterEach(() => {
  presenter.dispose();
  pool.dispose();
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});

describe('the last hit a boss ever takes', () => {
  it('still knows it landed on a boss', () => {
    presenter.ingest(snapshot, [killingBlow]);
    // What `EvercastScene.sync` does the moment the killing batch is planned.
    remembered.clear();
    presenter.update(1);
    expect(staggered).toEqual([true]);
  });

  it('knows it through an explosion, which is deferred twice over', () => {
    presenter.ingest(snapshot, [explosion]);
    remembered.clear();
    // Once to run the deferred `procs.ingest`, which is where the answer would
    // have been asked of a tracker that had already moved on.
    presenter.update(1);
    presenter.update(1);
    expect(staggered).toEqual([true]);
  });

  it('still says no for an ordinary enemy', () => {
    remembered.clear();
    presenter.ingest(snapshot, [killingBlow]);
    presenter.update(1);
    expect(staggered).toEqual([false]);
  });
});
