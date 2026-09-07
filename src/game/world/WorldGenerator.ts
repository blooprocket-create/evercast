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

interface WorldChunk {
  index: number;
  root: TransformNode;
  meshes: Mesh[];
  materials: Array<PBRMaterial | StandardMaterial>;
}

const CHUNK_SIZE = 12;
const VISIBLE_BEHIND = 4;
const VISIBLE_AHEAD = 7;
const SEGMENT_LENGTH = 72;
const TRANSITION_LENGTH = 24;
const CYCLE_LENGTH = SEGMENT_LENGTH * 3;
const WORLD_ANCHOR_X = 0;

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

function wrap(value: number, max: number): number {
  return ((value % max) + max) % max;
}

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
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

export function sampleBiome(distance: number): { from: BiomeId; to: BiomeId; t: number } {
  const wrapped = wrap(distance, CYCLE_LENGTH);
  const segment = Math.floor(wrapped / SEGMENT_LENGTH);
  const local = wrapped - segment * SEGMENT_LENGTH;
  const from = BIOMES[segment];
  const to = BIOMES[(segment + 1) % BIOMES.length];
  const transitionStart = SEGMENT_LENGTH - TRANSITION_LENGTH;
  const t = local <= transitionStart ? 0 : smoothstep((local - transitionStart) / TRANSITION_LENGTH);
  return { from: from.id, to: t === 0 ? from.id : to.id, t };
}

function sampleBiomeStyle(distance: number): BiomeSample {
  const wrapped = wrap(distance, CYCLE_LENGTH);
  const segment = Math.floor(wrapped / SEGMENT_LENGTH);
  const local = wrapped - segment * SEGMENT_LENGTH;
  const from = BIOMES[segment];
  const to = BIOMES[(segment + 1) % BIOMES.length];
  const transitionStart = SEGMENT_LENGTH - TRANSITION_LENGTH;
  const t = local <= transitionStart ? 0 : smoothstep((local - transitionStart) / TRANSITION_LENGTH);
  return { from, to, t };
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
    this.moteMaterial.alpha = 0.65;
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
    this.distance += SEGMENT_LENGTH - wrapped + 2;
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
    const absoluteCenter = index * CHUNK_SIZE + CHUNK_SIZE / 2;
    const style = sampleBiomeStyle(absoluteCenter);

    const blended = {
      ground: lerpColor(style.from.ground, style.to.ground, style.t),
      road: lerpColor(style.from.road, style.to.road, style.t),
      trunk: lerpColor(style.from.trunk, style.to.trunk, style.t),
      foliage: lerpColor(style.from.foliage, style.to.foliage, style.t),
      stone: lerpColor(style.from.stone, style.to.stone, style.t),
      accent: lerpColor(style.from.accent, style.to.accent, style.t),
    };

    const groundMat = this.makePbr(`ground-${index}`, blended.ground, 0.98, materials);
    const roadMat = this.makePbr(`road-${index}`, blended.road, 0.94, materials);
    const trunkMat = this.makePbr(`trunk-${index}`, blended.trunk, 0.92, materials);
    const foliageMat = this.makePbr(`foliage-${index}`, blended.foliage, 0.88, materials);
    const stoneMat = this.makePbr(`stone-${index}`, blended.stone, 0.96, materials);
    const accentMat = this.makePbr(`accent-${index}`, blended.accent, 0.8, materials);
    accentMat.emissiveColor = blended.accent.scale(0.08);

    const ground = MeshBuilder.CreateBox(`ground-${index}`, { width: CHUNK_SIZE + 0.06, height: 0.32, depth: 7 }, this.scene);
    ground.parent = root;
    ground.position.y = -0.16;
    ground.material = groundMat;
    meshes.push(ground);

    const road = MeshBuilder.CreateBox(`road-${index}`, { width: CHUNK_SIZE + 0.08, height: 0.04, depth: 1.55 }, this.scene);
    road.parent = root;
    road.position = new Vector3(0, 0.02, 0);
    road.material = roadMat;
    meshes.push(road);

    this.addFarScenery(index, root, meshes, materials, style, stoneMat, foliageMat);

    for (let slot = 0; slot < 7; slot += 1) {
      const seed = index * 97 + slot * 13;
      const localX = -CHUNK_SIZE / 2 + 0.8 + random01(seed + 1) * (CHUNK_SIZE - 1.6);
      const side = random01(seed + 2) > 0.48 ? 1 : -1;
      const z = side * (1.55 + random01(seed + 3) * 1.55);
      const chooseTo = random01(seed + 4) < style.t;
      const biome = chooseTo ? style.to.id : style.from.id;
      this.addBiomeProp(biome, localX, z, seed, root, meshes, trunkMat, foliageMat, stoneMat, accentMat);
    }

    const wrappedCenter = wrap(absoluteCenter, CYCLE_LENGTH);
    if (Math.abs(wrappedCenter - SEGMENT_LENGTH) < CHUNK_SIZE * 0.55) {
      this.addForestThreshold(root, meshes, trunkMat, foliageMat);
    }
    if (Math.abs(wrappedCenter - SEGMENT_LENGTH * 2) < CHUNK_SIZE * 0.55) {
      this.addGraveGate(root, meshes, stoneMat, accentMat);
    }

    return { index, root, meshes, materials };
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
      if (random01(seed + 10) < 0.45) {
        this.addTree(x, z, 0.7 + random01(seed + 11) * 0.55, root, meshes, trunkMat, foliageMat, false);
      } else if (random01(seed + 12) < 0.55) {
        this.addRock(x, z, 0.3 + random01(seed + 13) * 0.35, root, meshes, stoneMat);
      } else {
        this.addFlowerPatch(x, z, root, meshes, accentMat, seed);
      }
      return;
    }

    if (biome === 'whispering_woods') {
      if (random01(seed + 20) < 0.72) {
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
    root: TransformNode,
    meshes: Mesh[],
    materials: Array<PBRMaterial | StandardMaterial>,
    style: BiomeSample,
    stoneMat: PBRMaterial,
    foliageMat: PBRMaterial,
  ): void {
    const dominant = style.t < 0.5 ? style.from.id : style.to.id;
    const farSeed = index * 151;

    if (dominant === 'greenfields') {
      const hillMat = this.makePbr(`hill-${index}`, lerpColor(style.from.foliage, style.to.foliage, style.t).scale(0.58), 1, materials);
      const hill = MeshBuilder.CreateSphere(`far-hill-${index}`, { diameter: 5.5 + random01(farSeed) * 3, segments: 8 }, this.scene);
      hill.parent = root;
      hill.position = new Vector3((random01(farSeed + 1) - 0.5) * 6, 0.2, 5.8);
      hill.scaling = new Vector3(1.8, 0.55, 0.75);
      hill.material = hillMat;
      meshes.push(hill);
      return;
    }

    if (dominant === 'whispering_woods') {
      for (let i = 0; i < 3; i += 1) {
        this.addTree(-4 + i * 4 + random01(farSeed + i) * 1.2, 4.6 + random01(farSeed + i + 8), 1.25 + random01(farSeed + i + 20) * 0.65, root, meshes, stoneMat, foliageMat, false);
      }
      return;
    }

    if (Math.abs(index % 17) === 0 || Math.abs(index % 17) === 1) {
      this.addCathedralSilhouette(root, meshes, stoneMat);
    } else {
      for (let i = 0; i < 3; i += 1) {
        this.addTombstone(-4 + i * 3.5, 4.7 + random01(farSeed + i) * 1.2, root, meshes, stoneMat, farSeed + i);
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
    const style = sampleBiomeStyle(this.distance + 12);
    const accent = lerpColor(style.from.accent, style.to.accent, style.t);
    this.moteMaterial.emissiveColor = accent;
    this.moteMaterial.alpha = lerp(0.42, 0.78, style.t);

    const graveInfluence = (style.from.id === 'gravehollow' ? 1 - style.t : 0) + (style.to.id === 'gravehollow' ? style.t : 0);
    const woodsInfluence = (style.from.id === 'whispering_woods' ? 1 - style.t : 0) + (style.to.id === 'whispering_woods' ? style.t : 0);
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
    const style = sampleBiomeStyle(this.distance + 12);
    const sky = lerpColor(style.from.sky, style.to.sky, style.t);
    const fog = lerpColor(style.from.fog, style.to.fog, style.t);
    this.scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    this.scene.fogColor = fog;
    this.scene.fogDensity = lerp(style.from.fogDensity, style.to.fogDensity, style.t);
    this.skyLight.intensity = lerp(style.from.ambient, style.to.ambient, style.t);
    this.skyLight.diffuse = lerpColor(new Color3(0.82, 0.88, 1), new Color3(0.62, 0.65, 0.82), style.t);
    this.skyLight.groundColor = lerpColor(style.from.ground.scale(0.32), style.to.ground.scale(0.32), style.t);
    this.sun.intensity = lerp(style.from.sun, style.to.sun, style.t);
    this.sun.diffuse = lerpColor(new Color3(1, 0.92, 0.76), new Color3(0.72, 0.75, 0.94), style.t);
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
