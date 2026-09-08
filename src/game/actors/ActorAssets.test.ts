import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetContainer, LoadAssetContainerAsync, NullEngine, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { ActorAssets, ActorVisual } from './ActorAssets';
import { ENEMIES } from '../../content/enemies';
import { GEAR_SLOT_ORDER } from '../../engine/gear/GearCatalog';
import type { GearSnapshot } from '../../engine/types';
import manifest from '../../../public/models/characters/manifest.json';

let engine: NullEngine, scene: Scene, library: ActorAssets;
const actors: ActorVisual[] = [];
function loadLocal(url: string, target: Scene): Promise<AssetContainer> {
  return LoadAssetContainerAsync(new Uint8Array(readFileSync(resolve('public', url.replace(/^\//, '')))), target, { pluginExtension: '.glb' });
}
beforeEach(() => { engine = new NullEngine(); scene = new Scene(engine); library = new ActorAssets(scene, undefined, loadLocal); });
afterEach(() => { for (const actor of actors.splice(0)) actor.dispose(); library.dispose(); scene.dispose(); engine.dispose(); vi.restoreAllMocks(); });
async function create(id: string): Promise<ActorVisual> {
  const actor = library.create(id, id); actors.push(actor);
  await vi.waitFor(() => expect(actor.root.metadata.assetState).toBe('ready'));
  return actor;
}

describe('the Blender cast', () => {
  it('covers every enemy, equipment slot, and five playable clips with real imported geometry', async () => {
    for (const enemy of ENEMIES) expect(manifest.assets.some((a) => a.id === enemy.modelKey.split('/').pop()!.replaceAll('-', '_'))).toBe(true);
    for (const slot of GEAR_SLOT_ORDER) expect(manifest.assets.some((a) => a.id === `gear_${slot}`)).toBe(true);
    for (const asset of manifest.assets) {
      const container = await loadLocal(asset.url, scene);
      expect(container.meshes.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0), asset.id).toBeGreaterThan(50);
      expect(container.animationGroups.map((g) => g.name).sort(), asset.id).toEqual([...asset.animations].sort());
      for (const group of container.animationGroups) {
        expect(group.to - group.from, `${asset.id}/${group.name}`).toBeGreaterThan(0);
        expect(group.targetedAnimations.length).toBeGreaterThan(0);
      }
      container.dispose();
    }
  });

  it('animates each instance independently, restores the bind pose, and retains survivors', async () => {
    const a = await create('briarling'), b = await create('briarling');
    const joint = (actor: ActorVisual) => actor.root.getDescendants().find((n) => n.name.startsWith('joint_body')) as TransformNode;
    const initial = joint(b).position.clone();
    a.play('attack'); a.update(0.35);
    expect(Vector3.Distance(joint(a).position, initial)).toBeGreaterThan(0.05);
    expect(joint(b).position.asArray()).toEqual(initial.asArray());
    a.update(1); expect(a.root.metadata.animation).toBe('idle');
    a.play('death'); a.update(2); expect(a.root.metadata.animation).toBe('death');
    a.revive(false); expect(joint(a).position.asArray()).toEqual(initial.asArray());
    a.dispose(); actors.splice(actors.indexOf(a), 1);
    expect(b.root.getChildMeshes().every((mesh) => !mesh.isDisposed())).toBe(true);
    b.setLocomotion(true); b.update(0.2);
    expect(b.root.metadata.animation).toBe('walk');
  });

  it('supports all six gear tiers without scaling anatomy, and the spell socket follows the staff', async () => {
    const mage = await create('mage');
    const upgrades = mage.root.getDescendants().filter((n) => n.name.startsWith('upgrade_'));
    expect(upgrades).toHaveLength(45); // Both articulated boots have their own attached details.
    for (const upgrade of upgrades.filter((node) => node.name.startsWith('upgrade_boots_'))) {
      expect(upgrade.parent?.name).toMatch(/^joint_leg_/);
    }
    for (let tier = 0; tier <= 5; tier++) {
      mage.setGear(GEAR_SLOT_ORDER.map((slot) => ({ slot, evolutionTier: tier }) as GearSnapshot));
      expect(upgrades.filter((n) => n.isEnabled())).toHaveLength(tier * 9);
      expect(mage.root.scaling.asArray()).toEqual([1, 1, 1]);
    }
    const before = mage.socketPosition('socket_spell', Vector3.Zero());
    mage.play('attack'); mage.update(0.35);
    expect(Vector3.Distance(before, mage.socketPosition('socket_spell', Vector3.Zero()))).toBeGreaterThan(0.05);
  });

  it('does not resurrect a disposed actor after its GLB arrives', async () => {
    library.dispose();
    const container = await loadLocal('/models/characters/moss_slime.glb', scene);
    let complete!: (value: AssetContainer) => void;
    library = new ActorAssets(scene, undefined, () => new Promise((resolve) => { complete = resolve; }));
    const actor = library.create('moss_slime', 'late'); actor.dispose();
    complete(container); await Promise.resolve(); await Promise.resolve();
    expect(scene.transformNodes.some((n) => n.name === 'late')).toBe(false);
  });

  it('caches a failed download and supplies a disposable matte fallback', async () => {
    library.dispose(); vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = vi.fn(async () => { throw new Error('offline'); });
    library = new ActorAssets(scene, undefined, loader);
    const a = library.create('moss_slime', 'offline-a'), b = library.create('moss_slime', 'offline-b'); actors.push(a, b);
    await vi.waitFor(() => expect(a.root.metadata.assetState).toBe('fallback'));
    expect(loader).toHaveBeenCalledTimes(1); expect(b.root.getChildMeshes()).toHaveLength(1);
  });
});
