import {
  AssetContainer,
  Color3,
  LoadAssetContainerAsync,
  MeshBuilder,
  PBRMaterial,
  Scene,
  ShadowGenerator,
  TransformNode,
} from '@babylonjs/core';
// Narrow loader plus the authored matte-specular extension; no compressed textures.
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_specular';
import manifest from '../../../public/models/environment/manifest.json';
import type { AtmosphereState } from '../render/Atmosphere';
import { finishEnvironmentMaterial } from './EnvironmentMaterials';

type AssetDefinition = (typeof manifest.assets)[number];
export type EnvironmentAssetLoader = (url: string, scene: Scene) => Promise<AssetContainer>;

const definitions = new Map(manifest.assets.map((asset) => [asset.id, asset]));

/** Owns scene-local templates; chunk instances share geometry and materials. */
export class EnvironmentAssets {
  private readonly requests = new Map<string, Promise<AssetContainer | undefined>>();
  private readonly containers = new Map<string, AssetContainer>();
  private readonly fallbackMaterials = new Map<string, PBRMaterial>();
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private readonly loader: EnvironmentAssetLoader = (url, target) => LoadAssetContainerAsync(url, target),
    private readonly shadows?: ShadowGenerator,
    private readonly atmosphere?: AtmosphereState,
  ) {}

  place(id: string, parent: TransformNode, x: number, z: number, scale = 1, yaw = 0,
    options: { height?: number; castShadow?: boolean } = {}): TransformNode {
    const definition = definitions.get(id);
    if (!definition) throw new Error(`Unknown environment asset: ${id}`);
    const placement = new TransformNode(`prop-${id}`, this.scene);
    placement.parent = parent;
    placement.position.set(x, options.height ?? 0, z);
    placement.scaling.setAll(scale);
    // Blender's authored front (-Y) imports facing +Z; our camera sits at -Z.
    placement.rotation.y = Math.PI + yaw;
    placement.metadata = { assetId: id, assetState: 'loading', castShadow: options.castShadow !== false };
    void this.populate(definition, placement).catch((error: unknown) => {
      if (this.disposed || this.scene.isDisposed || placement.isDisposed()) return;
      console.warn(`Evercast: could not instantiate ${id}; using fallback scenery.`, error);
      for (const child of placement.getChildren()) child.dispose();
      this.addFallback(definition, placement);
      placement.metadata.assetState = 'fallback';
    });
    return placement;
  }

  /**
   * Every prop requested so far. Mirrors `ActorAssets.whenReady`, and exists for
   * the same caller: the boot gate promises a world that has finished arriving,
   * and four of the six megabytes it is covering are scenery.
   *
   * Settled rather than all - a prop that failed already falls back to primitive
   * geometry, and one missing shrine must not hold the gate shut over a world
   * that is otherwise complete.
   */
  async whenReady(): Promise<void> {
    await Promise.allSettled(this.requests.values());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const container of this.containers.values()) container.dispose();
    for (const material of this.fallbackMaterials.values()) material.dispose();
    this.containers.clear();
    this.requests.clear();
    this.fallbackMaterials.clear();
  }

  private load(asset: AssetDefinition): Promise<AssetContainer | undefined> {
    const existing = this.requests.get(asset.id);
    if (existing) return existing;
    const url = `${import.meta.env.BASE_URL}${asset.url.replace(/^\//, '')}`;
    const request = this.loader(url, this.scene).then((container) => {
      // A scene can unmount while network requests are in flight (including StrictMode).
      if (this.disposed || this.scene.isDisposed) {
        container.dispose();
        return undefined;
      }
      for (const mesh of container.meshes) { mesh.isPickable = false; mesh.receiveShadows = true; }
      for (const material of container.materials) {
        if (material instanceof PBRMaterial) {
          finishEnvironmentMaterial(material, asset.id, this.atmosphere);
        }
      }
      this.containers.set(asset.id, container);
      return container;
    }).catch((error: unknown) => {
      if (!this.disposed && !this.scene.isDisposed) {
        console.warn(`Evercast: could not load ${asset.id}; using fallback scenery.`, error);
      }
      return undefined;
    });
    // Failed requests are cached too, avoiding a request storm as chunks scroll.
    this.requests.set(asset.id, request);
    return request;
  }

  private async populate(asset: AssetDefinition, placement: TransformNode): Promise<void> {
    const container = await this.load(asset);
    if (this.disposed || this.scene.isDisposed || placement.isDisposed()) return;
    if (!container) {
      this.addFallback(asset, placement);
      placement.metadata.assetState = 'fallback';
      return;
    }
    const entries = container.instantiateModelsToScene(
      (name) => `${placement.name}-${placement.uniqueId}-${name}`,
      false,
      { doNotInstantiate: false },
    );
    // Keep the glTF handedness conversion root intact; placement applies outside it.
    for (const node of entries.rootNodes) node.parent = placement;
    for (const mesh of placement.getChildMeshes()) {
      mesh.isPickable = false;
      if (this.shadows && placement.metadata.castShadow && mesh.getTotalVertices() > 0) {
        this.shadows.addShadowCaster(mesh, false);
        mesh.onDisposeObservable.addOnce(() => this.shadows?.removeShadowCaster(mesh, false));
      }
    }
    placement.metadata.assetState = 'ready';
  }

  private addFallback(asset: AssetDefinition, root: TransformNode): void {
    let material = this.fallbackMaterials.get(asset.biome);
    if (!material) {
      material = new PBRMaterial(`fallback-${asset.biome}`, this.scene);
      material.albedoColor = Color3.FromHexString(
        asset.biome === 'greenfields' ? '#637347' : asset.biome === 'whispering_woods' ? '#294E3E' : '#625D70',
      );
      material.metallic = 0;
      material.roughness = 1;
      material.specularIntensity = 0;
      this.fallbackMaterials.set(asset.biome, material);
    }
    const [width, depth, height] = asset.dimensionsMeters;
    const mesh = asset.id.includes('tree')
      ? MeshBuilder.CreateCylinder(`fallback-${asset.id}`, {
        height, diameterBottom: width * 0.5, diameterTop: 0.08, tessellation: 7,
      }, this.scene)
      : MeshBuilder.CreateBox(`fallback-${asset.id}`, { width, depth, height }, this.scene);
    mesh.parent = root;
    mesh.position.y = height / 2;
    mesh.material = material;
    mesh.isPickable = false;
  }
}
