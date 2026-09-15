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

  it('flashes only the hit actor, expires the overlay, and preserves shared materials',async()=>{
    const a=await create('briarling'),b=await create('briarling');
    const materials=a.root.getChildMeshes().map(m=>m.material);
    a.flash(true);a.update(.01);b.update(.01);
    expect(a.root.getChildMeshes().some(m=>m.renderOverlay)).toBe(true);
    expect(b.root.getChildMeshes().some(m=>m.renderOverlay)).toBe(false);
    a.update(.2);expect(a.root.getChildMeshes().some(m=>m.renderOverlay)).toBe(false);
    expect(a.root.getChildMeshes().map(m=>m.material)).toEqual(materials);
  });

  it('grows each clip out of the pose the one before it was holding', async () => {
    const a = await create('briarling'), b = await create('briarling');
    const joint = (actor: ActorVisual) => actor.root.getDescendants().find((n) => n.name.startsWith('joint_body')) as TransformNode;
    // `b` never animates, so it holds the bind pose - which is exactly where a
    // transition used to dump the whole body before going to frame zero.
    const bind = joint(b).position.clone();
    a.setLocomotion(true);
    a.update(0.3);
    const handoff = joint(a).position.clone();
    const snapped = Vector3.Distance(bind, handoff);
    expect(snapped).toBeGreaterThan(0.02);
    a.play('attack');
    a.update(1 / 60);
    expect(Vector3.Distance(joint(a).position, handoff)).toBeLessThan(snapped / 4);
  });

  it('settles onto the clip exactly, so a blend leaves nothing behind', async () => {
    const a = await create('briarling'), b = await create('briarling');
    const joint = (actor: ActorVisual) => actor.root.getDescendants().find((n) => n.name.startsWith('joint_body')) as TransformNode;
    a.setLocomotion(true);
    a.update(0.3);
    a.play('attack');
    // Both are swinging from a clock of zero; one arrived there out of a walk.
    // Past the blend they have to agree to the bit, or an actor keeps a trace
    // of every transition it ever made.
    a.update(0.3);
    b.play('attack');
    b.update(0.3);
    expect(joint(a).position.asArray()).toEqual(joint(b).position.asArray());
    expect(joint(a).rotationQuaternion?.asArray()).toEqual(joint(b).rotationQuaternion?.asArray());
  });

  it('throws a struck body off the blow and puts it back on its feet', async () => {
    const actor = await create('briarling');
    const hinge = actor.root.getChildren().find((n) => n.name.endsWith('-hinge')) as TransformNode;
    expect(hinge).toBeTruthy();
    expect(hinge.position.asArray()).toEqual([0, 0, 0]);
    actor.shove(new Vector3(1, 0, 0), 0.2, 0.26);
    actor.update(0.05);
    expect(hinge.position.x).toBeGreaterThan(0.05);
    expect(hinge.rotation.z).toBeLessThan(0);
    actor.update(0.5);
    // Exactly home: a hinge left a millimetre out is a body a millimetre off
    // its own feet for the rest of the run.
    expect(hinge.position.asArray()).toEqual([0, 0, 0]);
    expect(hinge.rotation.asArray()).toEqual([0, 0, 0]);
  });

  it('staggers in the body\'s own frame, whichever way it is facing', async () => {
    const actor = await create('briarling');
    const hinge = actor.root.getChildren().find((n) => n.name.endsWith('-hinge')) as TransformNode;
    actor.root.rotation.y = Math.PI / 2;
    // Struck from behind in world space, with the body turned a quarter turn:
    // the recoil belongs along its local z, not along the world x it came in on.
    actor.shove(new Vector3(1, 0, 0), 0.2);
    actor.update(0.05);
    expect(hinge.position.z).toBeGreaterThan(0.05);
    expect(Math.abs(hinge.position.x)).toBeLessThan(0.01);
  });

  it('staggers a body mid-swing, which is the only reaction it can show there', async () => {
    const actor = await create('briarling');
    const hinge = actor.root.getChildren().find((n) => n.name.endsWith('-hinge')) as TransformNode;
    actor.play('attack');
    actor.update(0.05);
    actor.play('hit');
    // The flinch clip is refused so the swing survives - so if the stagger did
    // not layer over it, most hits in a busy fight would show nothing at all.
    expect(actor.root.metadata.animation).toBe('attack');
    actor.shove(new Vector3(-1, 0, 0), 0.15);
    actor.update(0.04);
    expect(hinge.position.x).toBeLessThan(-0.02);
  });

  it('replaces a stagger rather than summing two, and leaves the dead alone', async () => {
    const actor = await create('briarling');
    const hinge = actor.root.getChildren().find((n) => n.name.endsWith('-hinge')) as TransformNode;
    actor.shove(new Vector3(1, 0, 0), 0.2);
    actor.update(0.05);
    const single = hinge.position.x;
    actor.shove(new Vector3(1, 0, 0), 0.2);
    actor.update(0.05);
    // Two blows in a frame must not launch anything across the road.
    expect(hinge.position.x).toBeCloseTo(single, 5);
    actor.update(0.5);
    actor.play('death');
    actor.shove(new Vector3(1, 0, 0), 0.2);
    actor.update(0.05);
    expect(hinge.position.asArray()).toEqual([0, 0, 0]);
  });

  it('takes a body apart rather than turning it transparent', async () => {
    const actor = await create('briarling');
    const meshes = actor.root.getChildMeshes().filter((m) => m.getTotalVertices() > 0);
    expect(meshes.length).toBeGreaterThan(0);
    expect(actor.solidity).toBe(1);
    actor.dissolve(0.7);
    actor.update(0.35);
    // Halfway through, the shader is doing the work and the flat fade has
    // barely started - but it is already under one, or Babylon would dispatch
    // the mesh to the opaque pass and discard the alpha the shader computes.
    for (const mesh of meshes) {
      expect(mesh.visibility).toBeLessThan(1);
      expect(mesh.visibility).toBeGreaterThan(0.8);
    }
    expect(actor.solidity).toBeCloseTo(0.5, 2);
    actor.update(0.4);
    for (const mesh of meshes) expect(mesh.visibility).toBe(0);
    expect(actor.solidity).toBe(0);
  });

  it('keeps an arrival a veil, because walking out of haze is not dying', async () => {
    const actor = await create('briarling');
    const mesh = actor.root.getChildMeshes().find((m) => m.getTotalVertices() > 0)!;
    actor.materialise(0.55);
    expect(mesh.visibility).toBe(0);
    actor.update(0.275);
    // Flat, and exactly the veil: no burn is running, so nothing else may
    // touch the number.
    expect(mesh.visibility).toBeCloseTo(0.5, 5);
    expect(actor.solidity).toBeCloseTo(0.5, 5);
    actor.update(0.4);
    expect(mesh.visibility).toBe(1);
  });

  it('puts a body that gets back up back together', async () => {
    const actor = await create('briarling');
    const mesh = actor.root.getChildMeshes().find((m) => m.getTotalVertices() > 0)!;
    actor.play('death');
    actor.dissolve(0.7);
    actor.update(0.5);
    expect(mesh.visibility).toBeLessThan(1);
    actor.revive(false);
    expect(mesh.visibility).toBe(1);
    expect(actor.solidity).toBe(1);
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

describe('a cancelled swing', () => {
  it('goes back to locomotion instead of following through', async () => {
    const actor = await create('road_warden');
    // Started from the windup and stretched across it, the way a Surge is.
    actor.play('attack', 1.7);
    expect(actor.root.metadata.animation).toBe('attack');
    actor.interrupt();
    expect(actor.root.metadata.animation).toBe('idle');
  });

  it('leaves anything that is not a swing alone', async () => {
    const actor = await create('road_warden');
    actor.play('hit');
    expect(actor.root.metadata.animation).toBe('hit');
    actor.interrupt();
    expect(actor.root.metadata.animation).toBe('hit');
  });

  it('does not put a dead body back on its feet', async () => {
    const actor = await create('road_warden');
    actor.play('death');
    actor.interrupt();
    expect(actor.root.metadata.animation).toBe('death');
  });
});
