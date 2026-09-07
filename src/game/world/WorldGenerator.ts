import {
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';

export type BiomeId = 'greenfields' | 'whispering_woods' | 'gravehollow';

interface BiomeStyle {
  id: BiomeId;
  ground: Color3;
  road: Color3;
  trunk: Color3;
  foliage: Color3;
  stone: Color3;
  accent: Color3;
  sky: Color3;
  fog: Color3;
  fogDensity: number;
  ambient: number;
  sun: number;
}

interface BiomeSample {
  from: BiomeStyle;
  to: BiomeStyle;
  t: number;
}

export interface TransitionProfile {
  raw: number;
  background: number;
  sky: number;
  ground: number;
  props: number;
  fog: number;
  motes: number;
}

interface WorldChunk {
  index: number;
  root: TransformNode;
  meshes: Mesh[];
  materials: Array<PBRMaterial | StandardMaterial>;
}

const CHUNK_SIZE = 12;
const GROUND_SLICES = 4;
const VISIBLE_BEHIND = 4;
const VISIBLE_AHEAD = 8;
// Prototype scale only. Longer regions give us several screen widths of ecological drift.
const SEGMENT_LENGTH = 120;
const TRANSITION_LENGTH = 72;
const CYCLE_LENGTH = SEGMENT_LENGTH * 3;
const WORLD_ANCHOR_X = 0;
const FAR_LOOKAHEAD = 28;

const BIOMES: readonly BiomeStyle[] = [
  {
    id: 'greenfields',
    ground: new Color3(0.12, 0.28, 0.12),
    road: new Color3(0.24, 0.19, 0.11),
    trunk: new Color3(0.22, 0.12, 0.06),
    foliage: new Color3(0.18, 0.42, 0.16),
    stone: new Color3(0.29, 0.32, 0.28),
    accent: new Color3(0.72, 0.8, 0.35),
    sky: new Color3(0.16, 0.27, 0.38),
    fog: new Color3(0.35, 0.46, 0.38),
    fogDensity: 0.008,
    ambient: 0.78,
    sun: 2.25,
  },
  {
    id: 'whispering_woods',
    ground: new Color3(0.045, 0.13, 0.075),
    road: new Color3(0.11, 0.085, 0.055),
    trunk: new Color3(0.11, 0.065, 0.04),
    foliage: new Color3(0.055, 0.21, 0.11),
    stone: new Color3(0.19, 0.24, 0.2),
    accent: new Color3(0.34, 0.72, 0.46),
    sky: new Color3(0.055, 0.1, 0.13),
    fog: new Color3(0.09, 0.16, 0.12),
    fogDensity: 0.018,
    ambient: 0.48,
    sun: 1.35,
  },
  {
    id: 'gravehollow',
    ground: new Color3(0.085, 0.075, 0.09),
    road: new Color3(0.14, 0.125, 0.14),
    trunk: new Color3(0.095, 0.075, 0.07),
    foliage: new Color3(0.12, 0.14, 0.13),
    stone: new Color3(0.28, 0.27, 0.32),
    accent: new Color3(0.5, 0.38, 0.62),
    sky: new Color3(0.06, 0.055, 0.09),
    fog: new Color3(0.16, 0.13, 0.19),
    fogDensity: 0.026,
    ambient: 0.38,
    sun: 0.8,
  },
] as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function wrap(value: number, max: number): number {
  return ((value % max) + max) % max;
}

function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function staged(raw: number, start: number, end: number): number {
  if (end <= start) return raw >= end ? 1 : 0;
  return smoothstep((raw - start) / (end - start));
}

function random01(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return value - Math.floor(value);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: Color3, b: Color3, t: number): Color3 {
  return new Color3(lerp(a.r, b.r, t), lerp(a.g, b.g, t), lerp(a.b, b.b, t));
}

function rawBiomeSample(distance: number): BiomeSample {
  const wrapped = wrap(distance, CYCLE_LENGTH);
  const segment = Math.floor(wrapped / SEGMENT_LENGTH);
  const local = wrapped - segment * SEGMENT_LENGTH;
  const from = BIOMES[segment];
  const to = BIOMES[(segment + 1) % BIOMES.length];
  const transitionStart = SEGMENT_LENGTH - TRANSITION_LENGTH;
  const t = local <= transitionStart ? 0 : clamp01((local - transitionStart) / TRANSITION_LENGTH);
  return { from, to, t };
}

export function sampleTransitionProfile(distance: number): TransitionProfile {
  const raw = rawBiomeSample(distance).t;
  return {
    raw,
    // Distant scenery telegraphs the destination first.
    background: staged(raw, 0.0, 0.58),
    sky: staged(raw, 0.08, 0.76),
    // The ground and nearby ecosystem lag behind the horizon.
    ground: staged(raw, 0.16, 0.84),
    props: staged(raw, 0.24, 0.94),
    // Thick fog and particles arrive latest so they do not read as a preset crossfade.
    fog: staged(raw, 0.34, 1.0),
    motes: staged(raw, 0.42, 1.0),
  };
}

export function sampleBiome(distance: number): { from: BiomeId; to: BiomeId; t: number } {
  const style = rawBiomeSample(distance);
  const t = smoothstep(style.t);
  return { from: style.from.id, to: t === 0 ? style.from.id : style.to.id, t };
}

function styleAt(distance: number, layer: keyof Omit<TransitionProfile, 'raw'>): BiomeSample {
  const style = rawBiomeSample(distance);
  const profile = sampleTransitionProfile(distance);
  return { from: style.from, to: style.to, t: profile[layer] };
}

function influenceFor(sample: BiomeSample, biome: BiomeId): number {
  return (sample.from.id === biome ? 1 - sample.t : 0) + (sample.to.id === biome ? sample.t : 0);
}

export class WorldGenerator {
  private readonly chunks = new Map<number, WorldChunk>();
  private readonly motes: Mesh[] = [];
  private readonly moteMaterial: StandardMaterial;
  private distance = 0;
  private visualTime = 0;
  private lastCenterIndex = Number.NaN;

  constructor(
    private readonly scene: Scene,
    private readonly skyLight: HemisphericLight,
    private readonly sun: DirectionalLight,
  ) {
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.moteMaterial = new StandardMaterial('world-motes', this.scene);
    this.moteMaterial.disableLighting = true;
    this.moteMaterial.emissiveColor = BIOMES[0].accent;
    this.moteMaterial.alpha = 0.55;
    this.createAtmosphereMotes();
    this.rebuildVisibleChunks();
  }

  update(deltaSeconds: number, walking: boolean): void {
    this.visualTime += deltaSeconds;
    this.distance += deltaSeconds * (walking ? 2.6 : 0.08);
    this.rebuildVisibleChunks();
    this.updateAtmosphere();
    this.updateMotes(deltaSeconds);
  }

  jumpToNextBiome(): void {
    const wrapped = wrap(this.distance, SEGMENT_LENGTH);
    const transitionStart = SEGMENT_LENGTH - TRANSITION_LENGTH;
    // Jump near the beginning of the transition, not past it, so N previews the full drift.
    const target = transitionStart + 5;
    this.distance += wrapped < target ? target - wrapped : SEGMENT_LENGTH - wrapped + target;
    this.lastCenterIndex = Number.NaN;
    this.rebuildVisibleChunks(true);
    this.updateAtmosphere();
  }

  getDebugBiomeLabel(): string {
    const sample = sampleBiome(this.distance + 12);
    if (sample.from === sample.to) return this.prettyBiome(sample.from);
    return `${this.prettyBiome(sample.from)} → ${this.prettyBiome(sample.to)} ${Math.round(sample.t * 100)}%`;
  }

  dispose(): void {
    for (const chunk of this.chunks.values()) this.disposeChunk(chunk);
    this.chunks.clear();
    for (const mote of this.motes) mote.dispose();
    this.moteMaterial.dispose();
  }

  private rebuildVisibleChunks(force = false): void {
    const centerIndex = Math.floor(this.distance / CHUNK_SIZE);
    if (!force && centerIndex === this.lastCenterIndex) {
      this.positionChunks();
      return;
    }
    this.lastCenterIndex = centerIndex;

    const min = centerIndex - VISIBLE_BEHIND;
    const max = centerIndex + VISIBLE_AHEAD;

    for (const [index, chunk] of this.chunks) {
      if (index < min || index > max) {
        this.disposeChunk(chunk);
        this.chunks.delete(index);
      }
    }

    for (let index = min; index <= max; index += 1) {
      if (!this.chunks.has(index)) this.chunks.set(index, this.buildChunk(index));
    }
    this.positionChunks();
  }

  private positionChunks(): void {
    for (const [index, chunk] of this.chunks) {
      chunk.root.position.x = index * CHUNK_SIZE - this.distance + WORLD_ANCHOR_X;
    }
  }

  private buildChunk(index: number): WorldChunk {
    const root = new TransformNode(`world-chunk-${index}`, this.scene);
    const meshes: Mesh[] = [];
    const materials: Array<PBRMaterial | StandardMaterial> = [];
    const absoluteStart = index * CHUNK_SIZE;
    const absoluteCenter = absoluteStart + CHUNK_SIZE / 2;

    // Split the floor into smaller pieces so material changes are not quantized to 12m chunks.
    this.addGroundSlices(index, absoluteStart, root, meshes, materials);

    const localStyle = styleAt(absoluteCenter, 'props');
    const trunkMat = this.makePbr(`trunk-${index}`, lerpColor(localStyle.from.trunk, localStyle.to.trunk, localStyle.t), 0.92, materials);
    const foliageMat = this.makePbr(`foliage-${index}`, lerpColor(localStyle.from.foliage, localStyle.to.foliage, localStyle.t), 0.88, materials);
    const stoneMat = this.makePbr(`stone-${index}`, lerpColor(localStyle.from.stone, localStyle.to.stone, localStyle.t), 0.96, materials);
    const accent = lerpColor(localStyle.from.accent, localStyle.to.accent, localStyle.t);
    const accentMat = this.makePbr(`accent-${index}`, accent, 0.8, materials);
    accentMat.emissiveColor = accent.scale(0.08);

    this.addFarScenery(index, absoluteCenter, root, meshes, materials);

    // Density itself now changes with biome influence instead of always placing seven props.
    for (let slot = 0; slot < 10; slot += 1) {
      const seed = index * 97 + slot * 13;
      const localX = -CHUNK_SIZE / 2 + 0.6 + random01(seed + 1) * (CHUNK_SIZE - 1.2);
      const absoluteX = absoluteCenter + localX;
      const style = styleAt(absoluteX, 'props');
      const woods = influenceFor(style, 'whispering_woods');
      const grave = influenceFor(style, 'gravehollow');
      const density = 0.54 + woods * 0.4 + grave * 0.12;
      if (random01(seed + 90) > density) continue;

      const side = random01(seed + 2) > 0.48 ? 1 : -1;
      const z = side * (1.55 + random01(seed + 3) * 1.55);
      const chooseTo = random01(seed + 4) < style.t;
      const biome = chooseTo ? style.to.id : style.from.id;
      this.addBiomeProp(biome, localX, z, seed, root, meshes, trunkMat, foliageMat, stoneMat, accentMat);
    }

    // Arrival landmarks sit at the end of the ecological blend, rather than causing it.
    const wrappedCenter = wrap(absoluteCenter, CYCLE_LENGTH);
    if (Math.abs(wrappedCenter - SEGMENT_LENGTH) < CHUNK_SIZE * 0.52) {
      this.addForestThreshold(root, meshes, trunkMat, foliageMat);
    }
    if (Math.abs(wrappedCenter - SEGMENT_LENGTH * 2) < CHUNK_SIZE * 0.52) {
      this.addGraveGate(root, meshes, stoneMat, accentMat);
    }

    return { index, root, meshes, materials };
  }

  private addGroundSlices(
    index: number,
    absoluteStart: number,
    root: TransformNode,
    meshes: Mesh[],
    materials: Array<PBRMaterial | StandardMaterial>,
  ): void {
    const width = CHUNK_SIZE / GROUND_SLICES;
    for (let slice = 0; slice < GROUND_SLICES; slice += 1) {
      const localX = -CHUNK_SIZE / 2 + width * (slice + 0.5);
      const absoluteX = absoluteStart + width * (slice + 0.5);
      const style = styleAt(absoluteX, 'ground');
      const groundColor = lerpColor(style.from.ground, style.to.ground, style.t);
      const roadColor = lerpColor(style.from.road, style.to.road, style.t);
      const groundMat = this.makePbr(`ground-${index}-${slice}`, groundColor, 0.98, materials);
      const roadMat = this.makePbr(`road-${index}-${slice}`, roadColor, 0.94, materials);

      const ground = MeshBuilder.CreateBox(`ground-${index}-${slice}`, { width: width + 0.035, height: 0.32, depth: 7 }, this.scene);
      ground.parent = root;
      ground.position = new Vector3(localX, -0.16, 0);
      ground.material = groundMat;
      meshes.push(ground);

      const road = MeshBuilder.CreateBox(`road-${index}-${slice}`, { width: width + 0.045, height: 0.04, depth: 1.55 }, this.scene);
      road.parent = root;
      road.position = new Vector3(localX, 0.02, 0);
      road.material = roadMat;
      meshes.push(road);
    }
  }

  private addBiomeProp(
    biome: BiomeId,
    x: number,
    z: number,
    seed: number,
    root: TransformNode,
    meshes: Mesh[],
    trunkMat: PBRMaterial,
    foliageMat: PBRMaterial,
    stoneMat: PBRMaterial,
    accentMat: PBRMaterial,
  ): void {
    if (biome === 'greenfields') {
      if (random01(seed + 10) < 0.38) {
        this.addTree(x, z, 0.7 + random01(seed + 11) * 0.55, root, meshes, trunkMat, foliageMat, false);
      } else if (random01(seed + 12) < 0.5) {
        this.addRock(x, z, 0.3 + random01(seed + 13) * 0.35, root, meshes, stoneMat);
      } else {
        this.addFlowerPatch(x, z, root, meshes, accentMat, seed);
      }
      return;
    }

    if (biome === 'whispering_woods') {
      if (random01(seed + 20) < 0.78) {
        this.addTree(x, z, 0.9 + random01(seed + 21) * 0.8, root, meshes, trunkMat, foliageMat, false);
      } else {
        this.addRock(x, z, 0.4 + random01(seed + 22) * 0.45, root, meshes, stoneMat);
      }
      return;
    }

    if (random01(seed + 30) < 0.42) {
      this.addTree(x, z, 0.75 + random01(seed + 31) * 0.65, root, meshes, trunkMat, foliageMat, true);
    } else if (random01(seed + 32) < 0.7) {
      this.addTombstone(x, z, root, meshes, stoneMat, seed);
    } else {
      this.addRock(x, z, 0.45 + random01(seed + 33) * 0.4, root, meshes, stoneMat);
    }
  }

  private addTree(
    x: number,
    z: number,
    scale: number,
    root: TransformNode,
    meshes: Mesh[],
    trunkMat: PBRMaterial,
    foliageMat: PBRMaterial,
    dead: boolean,
  ): void {
    const trunk = MeshBuilder.CreateCylinder(`tree-trunk-${root.name}-${meshes.length}`, {
      height: 2.8 * scale,
      diameterTop: 0.2 * scale,
      diameterBottom: 0.45 * scale,
      tessellation: 7,
    }, this.scene);
    trunk.parent = root;
    trunk.position = new Vector3(x, 1.4 * scale, z);
    trunk.rotation.z = (random01(x * 17 + z * 31) - 0.5) * 0.12;
    trunk.material = trunkMat;
    meshes.push(trunk);

    if (dead) {
      for (const direction of [-1, 1]) {
        const branch = MeshBuilder.CreateCylinder(`dead-branch-${root.name}-${meshes.length}`, {
          height: 1.25 * scale,
          diameterTop: 0.05 * scale,
          diameterBottom: 0.14 * scale,
          tessellation: 6,
        }, this.scene);
        branch.parent = root;
        branch.position = new Vector3(x + direction * 0.28 * scale, 2.35 * scale, z);
        branch.rotation.z = direction * 0.78;
        branch.material = trunkMat;
        meshes.push(branch);
      }
      return;
    }

    const crown = MeshBuilder.CreatePolyhedron(`tree-crown-${root.name}-${meshes.length}`, { type: 2, size: 1.05 * scale }, this.scene);
    crown.parent = root;
    crown.position = new Vector3(x, 3.25 * scale, z);
    crown.scaling = new Vector3(1.05, 1.2, 0.9);
    crown.material = foliageMat;
    meshes.push(crown);
  }

  private addRock(x: number, z: number, scale: number, root: TransformNode, meshes: Mesh[], material: PBRMaterial): void {
    const rock = MeshBuilder.CreatePolyhedron(`rock-${root.name}-${meshes.length}`, { type: 1, size: scale }, this.scene);
    rock.parent = root;
    rock.position = new Vector3(x, scale * 0.45, z);
    rock.scaling = new Vector3(1.25, 0.72, 1.05);
    rock.rotation.y = random01(x * 41 + z * 19) * Math.PI;
    rock.material = material;
    meshes.push(rock);
  }

  private addFlowerPatch(x: number, z: number, root: TransformNode, meshes: Mesh[], material: PBRMaterial, seed: number): void {
    for (let i = 0; i < 4; i += 1) {
      const flower = MeshBuilder.CreateSphere(`flower-${root.name}-${meshes.length}`, { diameter: 0.08 + random01(seed + i) * 0.05, segments: 5 }, this.scene);
      flower.parent = root;
      flower.position = new Vector3(x + (random01(seed + i * 7) - 0.5) * 0.7, 0.08, z + (random01(seed + i * 9) - 0.5) * 0.45);
      flower.material = material;
      meshes.push(flower);
    }
  }

  private addTombstone(x: number, z: number, root: TransformNode, meshes: Mesh[], material: PBRMaterial, seed: number): void {
    const stone = MeshBuilder.CreateBox(`tomb-${root.name}-${meshes.length}`, {
      width: 0.38 + random01(seed + 1) * 0.15,
      height: 0.82 + random01(seed + 2) * 0.35,
      depth: 0.18,
    }, this.scene);
    stone.parent = root;
    stone.position = new Vector3(x, 0.45, z);
    stone.rotation.z = (random01(seed + 3) - 0.5) * 0.2;
    stone.material = material;
    meshes.push(stone);
  }

  private addFarScenery(
    index: number,
    absoluteCenter: number,
    root: TransformNode,
    meshes: Mesh[],
    materials: Array<PBRMaterial | StandardMaterial>,
  ): void {
    // Far scenery samples ahead of the player, so the destination appears on the horizon
    // before the local ground and props have fully changed.
    const style = styleAt(absoluteCenter + FAR_LOOKAHEAD, 'background');
    const farSeed = index * 151;
    const chooseTo = random01(farSeed + 70) < style.t;
    const biome = chooseTo ? style.to.id : style.from.id;
    const foliageColor = lerpColor(style.from.foliage, style.to.foliage, style.t).scale(0.58);
    const stoneColor = lerpColor(style.from.stone, style.to.stone, style.t).scale(0.72);
    const farFoliage = this.makePbr(`far-foliage-${index}`, foliageColor, 1, materials);
    const farStone = this.makePbr(`far-stone-${index}`, stoneColor, 1, materials);

    if (biome === 'greenfields') {
      const hill = MeshBuilder.CreateSphere(`far-hill-${index}`, { diameter: 5.5 + random01(farSeed) * 3, segments: 8 }, this.scene);
      hill.parent = root;
      hill.position = new Vector3((random01(farSeed + 1) - 0.5) * 6, 0.2, 5.8);
      hill.scaling = new Vector3(1.8, 0.55, 0.75);
      hill.material = farFoliage;
      meshes.push(hill);
      return;
    }

    if (biome === 'whispering_woods') {
      for (let i = 0; i < 3; i += 1) {
        this.addTree(-4 + i * 4 + random01(farSeed + i) * 1.2, 4.6 + random01(farSeed + i + 8), 1.25 + random01(farSeed + i + 20) * 0.65, root, meshes, farStone, farFoliage, false);
      }
      return;
    }

    const graveInfluence = influenceFor(style, 'gravehollow');
    if (graveInfluence > 0.35 && (Math.abs(index % 17) === 0 || Math.abs(index % 17) === 1)) {
      this.addCathedralSilhouette(root, meshes, farStone);
    } else {
      for (let i = 0; i < 3; i += 1) {
        this.addTombstone(-4 + i * 3.5, 4.7 + random01(farSeed + i) * 1.2, root, meshes, farStone, farSeed + i);
      }
    }
  }

  private addForestThreshold(root: TransformNode, meshes: Mesh[], trunkMat: PBRMaterial, foliageMat: PBRMaterial): void {
    this.addTree(-2.3, 2.7, 1.5, root, meshes, trunkMat, foliageMat, false);
    this.addTree(2.1, 2.5, 1.6, root, meshes, trunkMat, foliageMat, false);
    const fallen = MeshBuilder.CreateCylinder(`threshold-log-${root.name}`, { height: 4.2, diameter: 0.3, tessellation: 7 }, this.scene);
    fallen.parent = root;
    fallen.position = new Vector3(0, 2.95, 2.55);
    fallen.rotation.z = Math.PI / 2;
    fallen.material = trunkMat;
    meshes.push(fallen);
  }

  private addGraveGate(root: TransformNode, meshes: Mesh[], stoneMat: PBRMaterial, accentMat: PBRMaterial): void {
    for (const side of [-1, 1]) {
      const pillar = MeshBuilder.CreateBox(`grave-pillar-${side}-${root.name}`, { width: 0.65, height: 4.2, depth: 0.65 }, this.scene);
      pillar.parent = root;
      pillar.position = new Vector3(side * 2.25, 2.1, 2.8);
      pillar.material = stoneMat;
      meshes.push(pillar);

      const cap = MeshBuilder.CreatePolyhedron(`grave-cap-${side}-${root.name}`, { type: 1, size: 0.58 }, this.scene);
      cap.parent = root;
      cap.position = new Vector3(side * 2.25, 4.45, 2.8);
      cap.material = accentMat;
      meshes.push(cap);
    }

    const lintel = MeshBuilder.CreateBox(`grave-lintel-${root.name}`, { width: 5.2, height: 0.42, depth: 0.55 }, this.scene);
    lintel.parent = root;
    lintel.position = new Vector3(0, 3.9, 2.8);
    lintel.material = stoneMat;
    meshes.push(lintel);
  }

  private addCathedralSilhouette(root: TransformNode, meshes: Mesh[], material: PBRMaterial): void {
    const body = MeshBuilder.CreateBox(`cathedral-body-${root.name}`, { width: 5.6, height: 4.2, depth: 1.7 }, this.scene);
    body.parent = root;
    body.position = new Vector3(0, 2.1, 7.5);
    body.material = material;
    meshes.push(body);

    for (const x of [-2.1, 0, 2.1]) {
      const tower = MeshBuilder.CreateBox(`cathedral-tower-${x}-${root.name}`, { width: 1.2, height: x === 0 ? 6.8 : 5.6, depth: 1.45 }, this.scene);
      tower.parent = root;
      tower.position = new Vector3(x, x === 0 ? 3.4 : 2.8, 7.4);
      tower.material = material;
      meshes.push(tower);

      const spire = MeshBuilder.CreateCylinder(`cathedral-spire-${x}-${root.name}`, {
        height: 2.6,
        diameterTop: 0,
        diameterBottom: 1.35,
        tessellation: 6,
      }, this.scene);
      spire.parent = root;
      spire.position = new Vector3(x, x === 0 ? 8.1 : 6.9, 7.4);
      spire.material = material;
      meshes.push(spire);
    }
  }

  private makePbr(name: string, color: Color3, roughness: number, materials: Array<PBRMaterial | StandardMaterial>): PBRMaterial {
    const material = new PBRMaterial(name, this.scene);
    material.albedoColor = color;
    material.metallic = 0;
    material.roughness = roughness;
    materials.push(material);
    return material;
  }

  private createAtmosphereMotes(): void {
    for (let i = 0; i < 22; i += 1) {
      const mote = MeshBuilder.CreateSphere(`world-mote-${i}`, { diameter: 0.035 + (i % 5) * 0.008, segments: 4 }, this.scene);
      mote.material = this.moteMaterial;
      mote.position = new Vector3(-7 + random01(i * 13) * 17, 0.6 + random01(i * 17) * 4.8, -1.8 + random01(i * 23) * 7.5);
      this.motes.push(mote);
    }
  }

  private updateMotes(deltaSeconds: number): void {
    const style = styleAt(this.distance + 8, 'motes');
    const accent = lerpColor(style.from.accent, style.to.accent, style.t);
    this.moteMaterial.emissiveColor = accent;
    this.moteMaterial.alpha = lerp(0.42, 0.72, style.t);

    const graveInfluence = influenceFor(style, 'gravehollow');
    const woodsInfluence = influenceFor(style, 'whispering_woods');
    const driftX = lerp(0.12, -0.38, graveInfluence);

    for (let i = 0; i < this.motes.length; i += 1) {
      const mote = this.motes[i];
      mote.position.x += deltaSeconds * (driftX + Math.sin(this.visualTime * 0.8 + i) * 0.04);
      mote.position.y += deltaSeconds * (0.05 + woodsInfluence * Math.sin(this.visualTime * 1.8 + i * 0.6) * 0.08 - graveInfluence * 0.12);
      if (mote.position.x < -8.5) mote.position.x = 9;
      if (mote.position.x > 9.5) mote.position.x = -8;
      if (mote.position.y < 0.25) mote.position.y = 5.2;
      if (mote.position.y > 5.5) mote.position.y = 0.45;
      const pulse = 0.65 + woodsInfluence * (0.35 + Math.sin(this.visualTime * 4 + i) * 0.35);
      mote.scaling.setAll(Math.max(0.25, pulse));
    }
  }

  private updateAtmosphere(): void {
    // Each atmospheric system has its own curve; they no longer all lerp with the same t.
    const skyStyle = styleAt(this.distance + 10, 'sky');
    const groundStyle = styleAt(this.distance, 'ground');
    const fogStyle = styleAt(this.distance + 4, 'fog');

    const sky = lerpColor(skyStyle.from.sky, skyStyle.to.sky, skyStyle.t);
    const fog = lerpColor(fogStyle.from.fog, fogStyle.to.fog, fogStyle.t);
    this.scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    this.scene.fogColor = fog;
    this.scene.fogDensity = lerp(fogStyle.from.fogDensity, fogStyle.to.fogDensity, fogStyle.t);

    this.skyLight.intensity = lerp(skyStyle.from.ambient, skyStyle.to.ambient, skyStyle.t);
    this.skyLight.diffuse = lerpColor(new Color3(0.82, 0.88, 1), new Color3(0.62, 0.65, 0.82), skyStyle.t);
    this.skyLight.groundColor = lerpColor(groundStyle.from.ground.scale(0.32), groundStyle.to.ground.scale(0.32), groundStyle.t);

    // Sun changes later than the sky, preserving warm light for a while as the horizon darkens.
    const sunT = staged(rawBiomeSample(this.distance + 6).t, 0.24, 0.9);
    const sunSample = rawBiomeSample(this.distance + 6);
    this.sun.intensity = lerp(sunSample.from.sun, sunSample.to.sun, sunT);
    this.sun.diffuse = lerpColor(new Color3(1, 0.92, 0.76), new Color3(0.72, 0.75, 0.94), sunT);
  }

  private disposeChunk(chunk: WorldChunk): void {
    for (const mesh of chunk.meshes) mesh.dispose(false, false);
    for (const material of chunk.materials) material.dispose();
    chunk.root.dispose();
  }

  private prettyBiome(id: BiomeId): string {
    if (id === 'greenfields') return 'Greenfields';
    if (id === 'whispering_woods') return 'Whispering Woods';
    return 'Gravehollow';
  }
}
