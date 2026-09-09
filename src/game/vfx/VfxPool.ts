import {
  AssetContainer,
  Color3,
  Geometry,
  LoadAssetContainerAsync,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  SubMesh,
  Vector3,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
import manifest from '../../../public/models/vfx/manifest.json';

export type School = 'arcane' | 'fire' | 'frost' | 'storm' | 'blood' | 'plague';
export type VfxQuality = 'low' | 'medium' | 'high';
export const VFX_BUDGETS = {
  low: { meshes: 48, paths: 16, jobs: 192, shards: 2, segments: 8, lights: 0 },
  medium: { meshes: 96, paths: 32, jobs: 384, shards: 4, segments: 12, lights: 0 },
  high: { meshes: 160, paths: 48, jobs: 576, shards: 7, segments: 16, lights: 1 },
} as const;
const COLORS: Record<School, string> = {
  plague: '#8ee36f',
  arcane: '#9b70ff',
  fire: '#ff762b',
  frost: '#63dcff',
  storm: '#b6cbff',
  blood: '#ff378a',
};
type Slot = {
  mesh: Mesh;
  age: number;
  life: number;
  core: boolean;
  key?: string;
  animate: (t: number, mesh: Mesh) => void;
};
export type VfxLoader = (url: string, scene: Scene) => Promise<AssetContainer>;

/** Fixed ceilings, shared geometry/materials, reusable slots. No per-hit GPU allocation after warmup. */
export class VfxPool {
  readonly budget;
  readonly ready: Promise<void>;
  private slots: Slot[] = [];
  private paths: Slot[] = [];
  private geometry = new Map<string, Geometry>();
  private materials = new Map<School, StandardMaterial>();
  private heart: StandardMaterial;
  private templates: Mesh[] = [];
  private disposed = false;
  private fallback: Mesh;

  constructor(
    private scene: Scene,
    quality: VfxQuality = 'medium',
    loader: VfxLoader = (url, scene) => LoadAssetContainerAsync(url, scene),
  ) {
    this.budget = VFX_BUDGETS[quality];
    this.fallback = MeshBuilder.CreateIcoSphere('VFX fallback', { radius: 0.25, subdivisions: 1 }, scene);
    this.fallback.setEnabled(false);
    this.heart = new StandardMaterial('VFX / arcane heart', scene);
    this.heart.disableLighting = true;
    this.heart.emissiveColor = new Color3(0.92, 0.82, 1);
    this.heart.alpha = 0.9;
    for (const school of Object.keys(COLORS) as School[]) {
      const mat = new StandardMaterial(`VFX / ${school}`, scene);
      mat.disableLighting = true;
      mat.emissiveColor = Color3.FromHexString(COLORS[school]);
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.backFaceCulling = false;
      mat.alpha = 0.88;
      this.materials.set(school, mat);
    }
    this.ready = Promise.all(
      manifest.assets.map(async (asset) => {
        let container: AssetContainer | undefined;
        try {
          container = await loader(`${import.meta.env.BASE_URL}models/vfx/${asset.file}`, scene);
          if (this.disposed || scene.isDisposed) return;
          const source = container.meshes.find((m) => m instanceof Mesh && m.getTotalVertices() > 0) as
            Mesh | undefined;
          if (!source) throw new Error(`Empty VFX mesh: ${asset.id}`);
          // Bake the glTF conversion root once, never into shared actor geometry.
          const template = source.clone(`VFX template ${asset.id}`, null, true)!;
          template.makeGeometryUnique();
          template.bakeTransformIntoVertices(source.computeWorldMatrix(true));
          template.parent = null;
          template.position.setAll(0);
          template.rotation.setAll(0);
          template.rotationQuaternion = null;
          template.scaling.setAll(1);
          template.material = null;
          template.setEnabled(false);
          this.templates.push(template);
          this.geometry.set(asset.id, template.geometry!);
        } catch (error) {
          if (!this.disposed) console.warn(`Evercast VFX: ${asset.id} uses fallback geometry.`, error);
        } finally {
          container?.dispose();
        }
      }),
    ).then(() => {});
  }

  emit(id: string, school: School, life: number, animate: Slot['animate'], core = false, key?: string): void {
    if (this.disposed) return;
    const slot =
      (key ? this.slots.find((s) => s.key === key && s.age < s.life) : undefined) ??
      this.acquire(this.slots, this.budget.meshes, core, false);
    if (!slot) return;
    slot.key = key;
    (this.geometry.get(id) ?? this.fallback.geometry!).applyToMesh(slot.mesh);
    // Geometry.applyToMesh can retain an old, smaller submesh range. Rebuild the
    // lightweight draw range when a pooled slot changes template size.
    const range = slot.mesh.subMeshes[0];
    if (
      !range ||
      range.verticesCount !== slot.mesh.getTotalVertices() ||
      range.indexCount !== slot.mesh.getTotalIndices()
    ) {
      slot.mesh.releaseSubMeshes();
      new SubMesh(0, 0, slot.mesh.getTotalVertices(), 0, slot.mesh.getTotalIndices(), slot.mesh);
    }
    this.start(slot, school, life, animate, core);
    if (id === 'arcane_core_b') slot.mesh.material = this.heart;
  }

  path(
    school: School,
    life: number,
    from: Vector3,
    to: Vector3,
    lightning = false,
    bend = 0,
    key?: string,
  ): void {
    if (this.disposed) return;
    const slot =
      (key ? this.paths.find((s) => s.key === key && s.age < s.life) : undefined) ??
      this.acquire(this.paths, this.budget.paths, true, true);
    if (!slot) return;
    slot.key = key;
    const count = this.budget.segments;
    const data = slot.mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const seed = from.x * 17 + to.z * 39 + to.x * 23;
    this.start(
      slot,
      school,
      life,
      (t, mesh) => {
        for (let i = 0; i <= count; i++) {
          const u = i / count;
          const envelope = Math.sin(u * Math.PI);
          const noise = lightning ? Math.sin(i * 17.13 + Math.floor(t * 5) * 7 + seed) * 0.16 * envelope : 0;
          const x = from.x + (to.x - from.x) * u;
          const y = from.y + (to.y - from.y) * u + envelope * bend + noise;
          const z = from.z + (to.z - from.z) * u - 0.08;
          const width = (lightning ? 0.026 : 0.017) * (1 - t * 0.7);
          for (let side = 0; side < 2; side++) {
            const k = (i * 2 + side) * 3;
            data[k] = x;
            data[k + 1] = y + (side ? width : -width);
            data[k + 2] = z;
          }
        }
        mesh.updateVerticesData(VertexBuffer.PositionKind, data, false, false);
        mesh.visibility = (1 - t) * (lightning ? 1 : school === 'blood' ? 0.35 : 0.65);
      },
      true,
    );
  }

  update(dt: number): void {
    if (this.disposed) return;
    for (const collection of [this.slots, this.paths])
      for (const slot of collection) {
        if (slot.age >= slot.life) continue;
        slot.age += Math.max(0, dt);
        if (slot.age >= slot.life) {
          slot.mesh.setEnabled(false);
          slot.animate = noop;
        } else slot.animate(slot.age / slot.life, slot.mesh);
      }
  }

  get stats() {
    return {
      active: [...this.slots, ...this.paths].filter((s) => s.age < s.life).length,
      meshes: this.slots.length,
      paths: this.paths.length,
      templates: this.templates.length,
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const slot of [...this.slots, ...this.paths]) {
      slot.animate = noop;
      slot.mesh.dispose();
    }
    this.slots.length = 0;
    this.paths.length = 0;
    for (const mesh of this.templates) mesh.dispose();
    this.templates.length = 0;
    this.geometry.clear();
    this.fallback.dispose();
    for (const mat of this.materials.values()) mat.dispose();
    this.materials.clear();
    this.heart.dispose();
  }

  private start(slot: Slot, school: School, life: number, animate: Slot['animate'], core: boolean) {
    slot.age = 0;
    slot.life = Math.min(3, Math.max(0.01, life));
    slot.core = core;
    slot.animate = animate;
    slot.mesh.material = this.materials.get(school)!;
    slot.mesh.position.setAll(0);
    slot.mesh.rotationQuaternion = null;
    slot.mesh.rotation.setAll(0);
    slot.mesh.scaling.setAll(1);
    slot.mesh.visibility = 1;
    slot.mesh.setEnabled(true);
    animate(0, slot.mesh);
  }

  private acquire(slots: Slot[], cap: number, core: boolean, path: boolean): Slot | undefined {
    let slot = slots.find((s) => s.age >= s.life);
    if (!slot && slots.length < cap) {
      const mesh = new Mesh(`VFX ${path ? 'path' : 'piece'} ${slots.length}`, this.scene);
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      if (path) {
        const count = this.budget.segments;
        const data = new VertexData();
        data.positions = new Float32Array((count + 1) * 6);
        data.indices = Array.from({ length: count }, (_, i) => [
          i * 2,
          i * 2 + 1,
          i * 2 + 2,
          i * 2 + 1,
          i * 2 + 3,
          i * 2 + 2,
        ]).flat();
        data.applyToMesh(mesh, true);
      }
      slot = { mesh, age: 1, life: 0, core, animate: noop };
      slots.push(slot);
    }
    // Drop decoration first; at the hard ceiling replace the oldest core sample.
    if (!slot && core)
      slot =
        slots.filter((s) => !s.core).sort((a, b) => b.age - a.age)[0] ??
        slots.reduce((a, b) => (a.age > b.age ? a : b));
    return slot;
  }
}
function noop() {}
