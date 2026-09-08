import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetContainer, InstancedMesh, LoadAssetContainerAsync, NullEngine, PBRMaterial, Scene, TransformNode } from '@babylonjs/core';
import { EnvironmentAssets } from './EnvironmentAssets';
import { BIOME_PROP_POOLS, chooseEnvironmentProp, LANDMARK_ASSETS } from './EnvironmentPropCatalog';
import manifest from '../../../public/models/environment/manifest.json';

let engine: NullEngine;
let scene: Scene;
let library: EnvironmentAssets | undefined;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  library?.dispose();
  library = undefined;
  scene.dispose();
  engine.dispose();
  vi.restoreAllMocks();
});

function loadLocal(url: string, target: Scene): Promise<AssetContainer> {
  const bytes = new Uint8Array(readFileSync(resolve('public', url.replace(/^\//, ''))));
  return LoadAssetContainerAsync(bytes, target, { pluginExtension: '.glb' });
}

describe('Blender environment assets', () => {
  it('imports every shipped GLB through Babylon and keeps its pivot on the ground', async () => {
    for (const asset of manifest.assets) {
      const container = await loadLocal(asset.url, scene);
      const entries = container.instantiateModelsToScene(undefined, false, { doNotInstantiate: false });
      const meshes = entries.rootNodes.flatMap((root) => root.getChildMeshes()).filter((mesh) => mesh.getTotalVertices() > 0);
      expect(meshes.length, asset.id).toBeGreaterThan(0);
      for (const mesh of meshes) {
        mesh.computeWorldMatrix(true);
        expect(mesh.material, asset.id).toBeTruthy();
      }
      const minY = Math.min(...meshes.map((mesh) => mesh.getBoundingInfo().boundingBox.minimumWorld.y));
      const maxY = Math.max(...meshes.map((mesh) => mesh.getBoundingInfo().boundingBox.maximumWorld.y));
      expect(minY, asset.id).toBeCloseTo(0, 3);
      expect(maxY, asset.id).toBeCloseTo(asset.dimensionsMeters[2], 2);
      entries.dispose();
      container.dispose();
    }
  });

  it('keeps natural surfaces matte while reserving muted highlights for actual metal', async () => {
    library = new EnvironmentAssets(scene, loadLocal);
    const root = new TransformNode('material-check', scene);
    const tree = library.place('healthy_tree_a', root, 0, 3);
    const lantern = library.place('vigil_lantern', root, 3, 3);
    await vi.waitFor(() => expect(lantern.metadata.assetState).toBe('ready'));
    await vi.waitFor(() => expect(tree.metadata.assetState).toBe('ready'));
    const materials = tree.getChildMeshes().map((mesh) => mesh.material).filter((material): material is PBRMaterial => material instanceof PBRMaterial);
    expect(materials.length).toBeGreaterThan(0);
    for (const material of materials) {
      expect(material.roughness).toBe(1); expect(material.metallic).toBe(0);
      expect(material.specularIntensity).toBe(0); expect(material.metallicF0Factor).toBe(0);
    }
    const metal = lantern.getChildMeshes().map((mesh) => mesh.material).find((material) => material?.name === 'Iron / oxidized') as PBRMaterial;
    expect(metal.metallic).toBeGreaterThan(0); expect(metal.roughness).toBeGreaterThan(0.7);
    root.dispose();
  });

  it('loads once, shares geometry/materials, and preserves surviving instances when a chunk leaves', async () => {
    const loader = vi.fn(loadLocal);
    library = new EnvironmentAssets(scene, loader);
    const chunkA = new TransformNode('chunk-a', scene);
    const chunkB = new TransformNode('chunk-b', scene);
    const first = library.place('healthy_tree_a', chunkA, 0, 3);
    const second = library.place('healthy_tree_a', chunkB, 2, 3);
    await vi.waitFor(() => expect(second.metadata.assetState).toBe('ready'));
    expect(loader).toHaveBeenCalledTimes(1);
    const firstMesh = first.getChildMeshes().find((mesh) => mesh instanceof InstancedMesh) as InstancedMesh;
    const secondMesh = second.getChildMeshes().find((mesh) => mesh instanceof InstancedMesh) as InstancedMesh;
    expect(firstMesh).toBeTruthy();
    expect(firstMesh.sourceMesh).toBe(secondMesh.sourceMesh);
    expect(firstMesh.material).toBe(secondMesh.material);
    const disposeMaterial = vi.spyOn(secondMesh.material!, 'dispose');
    chunkA.dispose();
    expect(secondMesh.isDisposed()).toBe(false);
    expect(secondMesh.sourceMesh.isDisposed()).toBe(false);
    expect(disposeMaterial).not.toHaveBeenCalled();
    chunkB.dispose();
    library.dispose();
    expect(secondMesh.sourceMesh.isDisposed()).toBe(true);
  });

  it('does not resurrect an evicted chunk when its download completes', async () => {
    const container = await loadLocal('/models/environment/greenfields/rock_a.glb', scene);
    let complete!: (value: AssetContainer) => void;
    library = new EnvironmentAssets(scene, () => new Promise((resolveLoad) => { complete = resolveLoad; }));
    const retired = new TransformNode('retired', scene);
    const current = new TransformNode('current', scene);
    const oldProp = library.place('rock_a', retired, 0, 2);
    const newProp = library.place('rock_a', current, 1, 2);
    retired.dispose();
    complete(container);
    await vi.waitFor(() => expect(newProp.metadata.assetState).toBe('ready'));
    expect(oldProp.isDisposed()).toBe(true);
    expect(oldProp.getChildMeshes()).toHaveLength(0);
    expect(newProp.getChildMeshes().length).toBeGreaterThan(0);
    current.dispose();
  });

  it('disposes a late download after the world has unmounted', async () => {
    const container = await loadLocal('/models/environment/greenfields/rock_a.glb', scene);
    const dispose = vi.spyOn(container, 'dispose');
    let complete!: (value: AssetContainer) => void;
    library = new EnvironmentAssets(scene, () => new Promise((resolveLoad) => { complete = resolveLoad; }));
    const parent = new TransformNode('chunk', scene);
    const prop = library.place('rock_a', parent, 0, 2);
    parent.dispose();
    library.dispose();
    complete(container);
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
    expect(prop.getChildMeshes()).toHaveLength(0);
  });

  it('keeps scenery on failed downloads without retrying every placement', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = vi.fn().mockRejectedValue(new Error('offline'));
    library = new EnvironmentAssets(scene, loader);
    const parent = new TransformNode('chunk', scene);
    const first = library.place('rock_a', parent, 0, 2);
    const second = library.place('rock_a', parent, 1, 2);
    await vi.waitFor(() => expect(second.metadata.assetState).toBe('fallback'));
    expect(first.getChildMeshes()).toHaveLength(1);
    expect(second.getChildMeshes()).toHaveLength(1);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    parent.dispose();
  });
});

describe('environment prop coverage', () => {
  it('places every exported asset in a biome pool or landmark', () => {
    const placed = new Set([...Object.values(BIOME_PROP_POOLS).flat().map((entry) => entry.id), ...LANDMARK_ASSETS]);
    expect([...placed].sort()).toEqual(manifest.assets.map((asset) => asset.id).sort());
    for (const [biome, pool] of Object.entries(BIOME_PROP_POOLS)) {
      for (const entry of pool) expect(manifest.assets.find((asset) => asset.id === entry.id)?.biome).toBe(biome);
    }
  });

  it('keeps tall props out of the foreground and reaches each variant with seeded rolls', () => {
    for (const biome of Object.keys(BIOME_PROP_POOLS) as Array<keyof typeof BIOME_PROP_POOLS>) {
      const seen = new Set(Array.from({ length: 1000 }, (_, i) => chooseEnvironmentProp(biome, i / 1000).id));
      expect([...seen].sort()).toEqual(BIOME_PROP_POOLS[biome].map((entry) => entry.id).sort());
      for (const entry of BIOME_PROP_POOLS[biome]) {
        const asset = manifest.assets.find((candidate) => candidate.id === entry.id)!;
        if (asset.dimensionsMeters[2] * entry.scale > 1.2) expect(entry.background, entry.id).toBe(true);
      }
    }
  });
});
