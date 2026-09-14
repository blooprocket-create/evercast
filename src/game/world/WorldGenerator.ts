import {
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  PointLight,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { EnvironmentAssets } from './EnvironmentAssets';
import { chooseEnvironmentProp } from './EnvironmentPropCatalog';
import { createTerrainChunk, createTerrainMaterials, terrainHeight, type TerrainPalette } from './WorldTerrain';
import { createGroundDetails, createContactShadow } from './WorldGroundDetails';
import { WorldBackdrop } from './WorldBackdrop';
import { ZONES } from '../../content/zones';
import { WORLD_TRAVEL_SPEED, WORLD_UNITS_PER_ZONE } from './JourneyProgress';

/**
 * The rendered biomes are the authored zones, one for one, by id.
 *
 * They were three against the content's four, cycling on travel distance while
 * the HUD named its zone from the stage - so the two agreed at the start of a
 * run and nowhere after it. Observed at stage 766: the interface reading
 * `Gravehollow` in purple over bright green Greenfields grass, with gravestones
 * scattered through it.
 */
export type BiomeId = (typeof ZONES)[number]['id'];

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
}

const CHUNK_SIZE = 12;
const VISIBLE_BEHIND = 4;
const VISIBLE_AHEAD = 8;
// Each region has a clear arrival, a settled landscape, and a gradual ecological drift.
const SEGMENT_LENGTH = WORLD_UNITS_PER_ZONE;
const TRANSITION_LENGTH = SEGMENT_LENGTH * 0.6;
const CYCLE_LENGTH = SEGMENT_LENGTH * ZONES.length;
const WORLD_ANCHOR_X = 0;
const FAR_LOOKAHEAD = 28;

const STYLES: Record<BiomeId, BiomeStyle> = {
  greenfields: {
    id: 'greenfields',
    ground: new Color3(0.12, 0.19, 0.085),
    road: new Color3(0.23, 0.174, 0.092),
    trunk: new Color3(0.22, 0.12, 0.06),
    foliage: new Color3(0.18, 0.42, 0.16),
    stone: new Color3(0.29, 0.32, 0.28),
    accent: new Color3(0.72, 0.8, 0.35),
    sky: new Color3(0.105, 0.20, 0.24),
    fog: new Color3(0.28, 0.39, 0.40),
    fogDensity: 0.013,
    ambient: 0.9,
    sun: 2.1,
  },
  whispering_woods: {
    id: 'whispering_woods',
    ground: new Color3(0.036, 0.077, 0.043),
    road: new Color3(0.11, 0.10, 0.063),
    trunk: new Color3(0.11, 0.065, 0.04),
    foliage: new Color3(0.055, 0.21, 0.11),
    stone: new Color3(0.19, 0.24, 0.2),
    accent: new Color3(0.34, 0.72, 0.46),
    sky: new Color3(0.035, 0.073, 0.083),
    fog: new Color3(0.13, 0.225, 0.185),
    fogDensity: 0.022,
    ambient: 0.96,
    sun: 1.85,
  },
  gravehollow: {
    id: 'gravehollow',
    ground: new Color3(0.065, 0.056, 0.072),
    road: new Color3(0.135, 0.12, 0.117),
    trunk: new Color3(0.095, 0.075, 0.07),
    foliage: new Color3(0.12, 0.14, 0.13),
    stone: new Color3(0.28, 0.27, 0.32),
    accent: new Color3(0.5, 0.38, 0.62),
    sky: new Color3(0.043, 0.047, 0.077),
    fog: new Color3(0.20, 0.20, 0.26),
    fogDensity: 0.026,
    ambient: 0.8,
    sun: 1.8,
  },
  /*
   * The zone the renderer never had. Ashen Road has been in `content/zones.ts`
   * and in the HUD's accent since the beginning, and the world simply skipped
   * it - which is half of why the two disagreed at all.
   *
   * Its props are the ones the road already owns: dead trees, bare rock,
   * broken fences and rubble, none of them tinted by this palette. So the place
   * is made by the ground, the air and the light - scorched earth, a pale ash
   * road, the thickest fog in the game, and a low sun through it, which is the
   * warmest light anywhere on the journey. The accent is the same amber
   * `--accent-ashen-road` the interface has always worn here.
   */
  ashen_road: {
    id: 'ashen_road',
    ground: new Color3(0.108, 0.083, 0.064),
    road: new Color3(0.2, 0.177, 0.158),
    trunk: new Color3(0.085, 0.062, 0.052),
    foliage: new Color3(0.2, 0.145, 0.075),
    stone: new Color3(0.3, 0.275, 0.25),
    accent: new Color3(0.79, 0.54, 0.31),
    sky: new Color3(0.086, 0.055, 0.052),
    fog: new Color3(0.26, 0.21, 0.185),
    fogDensity: 0.027,
    ambient: 0.88,
    sun: 2.05,
  },
};

/**
 * In the zones' own order, so the segment a distance falls in *is* the zone a
 * stage falls in. A zone added to the content without a style above is a type
 * error here rather than a fourth biome quietly rendering as the third.
 */
const BIOMES: readonly BiomeStyle[] = ZONES.map((zone) => STYLES[zone.id]);

/**
 * The tree that makes each zone's skyline, where a zone has one. Gravehollow
 * and Ashen Road share their dead trees; only the light on them differs.
 */
const CANOPY_TREE: Record<BiomeId, string> = {
  greenfields: 'healthy_tree',
  whispering_woods: 'dark_tree',
  gravehollow: 'dead_tree',
  ashen_road: 'dead_tree',
};

/** What stands at the mouth of each zone. */
const LANDMARK_GATE: Record<BiomeId, string> = {
  greenfields: 'graveyard_gate',
  whispering_woods: 'forest_shrine_arch',
  gravehollow: 'graveyard_gate',
  ashen_road: 'ruined_arch',
};

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
  const style = rawBiomeSample(Math.max(0, distance));
  const profile = sampleTransitionProfile(Math.max(0, distance));
  return { from: style.from, to: style.to, t: profile[layer] };
}

function influenceFor(sample: BiomeSample, biome: BiomeId): number {
  return (sample.from.id === biome ? 1 - sample.t : 0) + (sample.to.id === biome ? sample.t : 0);
}

export class WorldGenerator {
  private readonly assets: EnvironmentAssets;
  private readonly terrainMaterials: [PBRMaterial, PBRMaterial];
  private readonly contactMaterial: StandardMaterial;
  private readonly backdrop: WorldBackdrop;
  private readonly windNodes = new Set<TransformNode>();
  private readonly lanternNodes = new Set<TransformNode>();
  private readonly localLights: PointLight[] = [];
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
    shadows?: ShadowGenerator,
  ) {
    this.assets = new EnvironmentAssets(scene, undefined, shadows);
    this.terrainMaterials = createTerrainMaterials(scene);
    this.contactMaterial = new StandardMaterial('ground contact shade', scene);
    this.contactMaterial.disableLighting = true;
    this.contactMaterial.emissiveColor = Color3.White();
    this.contactMaterial.backFaceCulling = false;
    this.backdrop = new WorldBackdrop(scene);
    for (let i = 0; i < 2; i++) {
      const light = new PointLight(`landmark candle-${i}`, Vector3.Zero(), scene);
      light.diffuse = new Color3(1, 0.52, 0.19); light.intensity = 2.8; light.range = 3.5; light.setEnabled(false);
      this.localLights.push(light);
    }
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
    this.distance += walking ? deltaSeconds * WORLD_TRAVEL_SPEED : 0;
    this.rebuildVisibleChunks();
    this.updateAtmosphere();
    this.updateMotes(deltaSeconds);
    this.updateWind();
    this.updateLocalLights();
  }

  jumpToNextBiome(previewTransition = false): void {
    this.distance = previewTransition
      ? Math.floor(this.distance / SEGMENT_LENGTH) * SEGMENT_LENGTH + SEGMENT_LENGTH - TRANSITION_LENGTH + 12
      : (Math.floor(this.distance / SEGMENT_LENGTH) + 1) * SEGMENT_LENGTH;
    this.lastCenterIndex = Number.NaN;
    this.rebuildVisibleChunks(true);
    this.updateAtmosphere();
  }

  getDebugBiomeLabel(): string {
    const sample = sampleBiome(this.distance + 12);
    if (sample.from === sample.to) return this.prettyBiome(sample.from);
    return `${this.prettyBiome(sample.from)} → ${this.prettyBiome(sample.to)} ${Math.round(sample.t * 100)}%`;
  }

  /** The scenery half of `EvercastScene.whenReady`. */
  async whenReady(): Promise<void> {
    await this.assets.whenReady();
  }

  dispose(): void {
    for (const chunk of this.chunks.values()) this.disposeChunk(chunk);
    this.chunks.clear();
    for (const mote of this.motes) mote.dispose();
    this.moteMaterial.dispose();
    this.assets.dispose();
    this.backdrop.dispose();
    for (const material of this.terrainMaterials) material.dispose();
    this.contactMaterial.dispose();
    this.windNodes.clear();
    this.lanternNodes.clear();
    for (const light of this.localLights) light.dispose();
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

  private readonly paletteAt = (x: number): TerrainPalette => {
    const style = styleAt(x, 'ground');
    return { ground: lerpColor(style.from.ground, style.to.ground, style.t), road: lerpColor(style.from.road, style.to.road, style.t) };
  };

  private buildChunk(index: number): WorldChunk {
    const root = new TransformNode(`world-chunk-${index}`, this.scene);
    for (const mesh of createTerrainChunk(index, this.scene, this.paletteAt, ...this.terrainMaterials)) mesh.parent = root;
    createGroundDetails(index, this.scene, this.terrainMaterials[0], this.paletteAt).parent = root;
    const center = index * CHUNK_SIZE;
    const arrival = wrap(center, CYCLE_LENGTH);
    // One at the mouth of every zone but the first, whose mouth is the start.
    const boundary = arrival / SEGMENT_LENGTH;
    const landmark = center > 0 && Number.isInteger(boundary) && boundary > 0;

    this.addFarScenery(index, root);
    // Three spaced anchors create groves and clearings rather than a random pile of props.
    for (let slot = 0; slot < 3; slot++) {
      const seed = index * 97 + slot * 31;
      const x = -4.1 + slot * 4.1 + (random01(seed + 1) - 0.5) * 0.55;
      const style = styleAt(center + x, 'props');
      const biome = random01(seed + 2) < style.t ? style.to.id : style.from.id;
      if (landmark && slot === 1) continue;
      const prop = chooseEnvironmentProp(biome, random01(seed + 10));
      const canopy = CANOPY_TREE[biome];
      const id =
        slot === 0 && !landmark && canopy
          ? `${canopy}_${String.fromCharCode(97 + Math.floor(random01(seed + 18) * 3))}`
          : prop.id;
      const tall = /tree|fir|waystone|lantern|mausoleum|arch|gravestone|fence/.test(id);
      const z = tall ? 3.5 + random01(seed + 3) * 1.6 : 2.1 + random01(seed + 3) * 1.2;
      const scale = (id.includes('tree') ? 0.91 : prop.scale) * (0.9 + random01(seed + 4) * 0.2);
      this.placeProp(id, root, x, z, scale, (random01(seed + 5) - 0.5) * 0.6);
      if (tall && !id.includes('mausoleum')) {
        const companion =
          biome === 'greenfields' ? (slot % 2 ? 'fallen_log' : 'rock_b')
            : biome === 'whispering_woods' ? 'mossy_rock_a'
              : biome === 'ashen_road' ? (slot % 2 ? 'rock_a' : 'small_ruin_stone')
                : 'gravestone_b';
        this.placeProp(companion, root, x + 0.85, z - 0.65, biome === 'gravehollow' ? 0.55 : 0.4, random01(seed + 6) * 2);
      }
    }

    // Ground cover follows the verges, in small ecological patches with breathing room.
    for (let slot = 0; slot < 22; slot++) {
      const seed = index * 197 + slot * 19;
      const x = -5.8 + (slot % 11) * 1.12 + (random01(seed) - 0.5) * 0.65;
      const z = slot < 11 ? -1.45 - random01(seed + 1) * 2.1 : 1.65 + random01(seed + 1) * 2.4;
      const style = styleAt(center + x, 'props');
      const biome = random01(seed + 2) < style.t ? style.to.id : style.from.id;
      let id: string, scale: number;
      if (biome === 'greenfields') {
        id = random01(seed + 3) < 0.7 ? (slot % 2 ? 'grass_clump_a' : 'grass_clump_b') : (slot % 3 ? 'flower_patch_a' : 'flower_patch_b');
        scale = 0.34 + random01(seed + 4) * 0.23;
      } else if (biome === 'whispering_woods') {
        id = random01(seed + 3) < 0.48 ? 'forest_fern' : (slot % 3 ? 'mushroom_patch' : 'root_cluster');
        scale = 0.4 + random01(seed + 4) * 0.25;
      } else if (biome === 'gravehollow') {
        if (slot % 3 !== 0) continue;
        id = 'bone_pile_rubble';
        scale = 0.28 + random01(seed + 4) * 0.22;
      } else {
        // Sparser than anywhere else, because nothing grows here.
        if (slot % 4 !== 0) continue;
        id = random01(seed + 3) < 0.55 ? 'bone_pile_rubble' : 'small_ruin_stone';
        scale = 0.26 + random01(seed + 4) * 0.2;
      }
      this.placeProp(id, root, x, z, scale, random01(seed + 5) * Math.PI * 2, false);
    }

    if (landmark) {
      // The gateway names the zone being entered, so it belongs to the biome
      // on the far side of the boundary rather than to the one being left.
      const entering = BIOMES[boundary % BIOMES.length]!.id;
      const gate = LANDMARK_GATE[entering];
      this.placeProp(gate, root, 0, 4.6, 1.35);
      if (gate !== 'forest_shrine_arch') {
        this.placeProp('broken_fence_segment', root, -3.4, 4.6, 1.05);
        this.placeProp('broken_fence_segment', root, 3.4, 4.6, 1.05);
        this.placeProp('vigil_lantern', root, -2.1, 3.8, 0.95);
        this.placeProp('vigil_lantern', root, 2.1, 3.8, 0.95);
      }
    }
    if (wrap(index, 10) === 0 && !landmark && styleAt(center, 'props').from.id === 'greenfields') {
      this.placeProp('meadow_waystone', root, 2.1, 2.6, 1);
    }
    return { index, root };
  }

  private placeProp(id: string, root: TransformNode, x: number, z: number, scale = 1, yaw = 0, castShadow = true): void {
    const index = Number(root.name.replace('world-chunk-', ''));
    const absoluteX = index * CHUNK_SIZE + x;
    const node = this.assets.place(id, root, x, z, scale, yaw, { height: terrainHeight(absoluteX, z), castShadow });
    if (id === 'vigil_lantern' || id === 'forest_shrine_arch') {
      this.lanternNodes.add(node);
      node.onDisposeObservable.addOnce(() => this.lanternNodes.delete(node));
    }
    if (/tree|fir|fern|grass_clump|flower_patch|bush_clump/.test(id)) {
      node.metadata.windPhase = random01(absoluteX * 41 + z * 7) * Math.PI * 2;
      node.metadata.windStrength = /tree|fir/.test(id) ? 0.004 : 0.024;
      this.windNodes.add(node);
      node.onDisposeObservable.addOnce(() => this.windNodes.delete(node));
    }
    if (castShadow && z < 8) {
      const radius = /mausoleum|arch|gate/.test(id) ? 1.7 : id.includes('tree') ? 0.65 : 0.6;
      const contact = createContactShadow(this.scene, this.contactMaterial, absoluteX, x, z, radius * scale);
      contact.parent = root;
    }
  }

  private updateWind(): void {
    for (const node of this.windNodes) {
      if (Math.abs(node.getAbsolutePosition().x) > 28) continue;
      node.rotation.z = Math.sin(this.visualTime * 0.85 + node.metadata.windPhase) * node.metadata.windStrength;
    }
  }

  private updateLocalLights(): void {
    const nearby = [...this.lanternNodes].filter((node) => Math.abs(node.getAbsolutePosition().x) < 14)
      .sort((a, b) => Math.abs(a.getAbsolutePosition().x) - Math.abs(b.getAbsolutePosition().x));
    this.localLights.forEach((light, i) => {
      const node = nearby[i]; light.setEnabled(Boolean(node));
      if (!node) return;
      const shrine = node.metadata.assetId === 'forest_shrine_arch';
      light.position.copyFrom(node.getAbsolutePosition()).addInPlace(new Vector3(0, shrine ? 1.7 : 1.45, -0.15));
      light.diffuse.set(shrine ? 0.25 : 1, shrine ? 0.85 : 0.52, shrine ? 0.62 : 0.19);
      light.intensity = shrine ? 1.4 : 2.8 + Math.sin(this.visualTime * 4 + i * 2) * 0.15;
    });
  }

  private addFarScenery(index: number, root: TransformNode): void {
    const style = styleAt(index * CHUNK_SIZE + FAR_LOOKAHEAD, 'background');
    const seed = index * 151;
    const biome = random01(seed + 70) < style.t ? style.to.id : style.from.id;
    if (biome === 'gravehollow' && wrap(index, 10) === 0) {
      this.placeProp('cathedral_nave', root, 0, 20, 1.35, 0, false);
      this.placeProp('cathedral_tower', root, -3.4, 20.2, 1.12, 0, false);
      this.placeProp('cathedral_tower', root, 3.4, 20.2, 0.96, 0, false);
      this.placeProp('cathedral_buttress', root, -4.9, 19.8, 1, 0, false);
      this.placeProp('cathedral_buttress', root, 4.9, 19.8, 1, 0, false);
      return;
    }
    const count = biome === 'greenfields' ? 2 : 3;
    for (let slot = 0; slot < count; slot++) {
      const variant = String.fromCharCode(97 + Math.floor(random01(seed + slot + 9) * 3));
      const family = CANOPY_TREE[biome] ?? 'dead_tree';
      const id = biome === 'whispering_woods' && random01(seed + slot + 6) < 0.55 ? 'ancient_fir' : `${family}_${variant}`;
      this.placeProp(id, root, -4 + slot * (count === 2 ? 7 : 4),
        10.5 + random01(seed + slot + 8) * 5,
        biome === 'whispering_woods' ? 1.1 + random01(seed + slot) * 0.3 : 0.9 + random01(seed + slot) * 0.2,
        random01(seed + slot + 25) * Math.PI * 2, false);
    }
  }

  private createAtmosphereMotes(): void {
    for (let i = 0; i < 22; i += 1) {
      const mote = MeshBuilder.CreateSphere(`world-mote-${i}`, { diameter: 0.018 + (i % 5) * 0.004, segments: 4 }, this.scene);
      mote.material = this.moteMaterial;
      mote.position = new Vector3(-7 + random01(i * 13) * 17, 0.6 + random01(i * 17) * 4.8, -1.8 + random01(i * 23) * 7.5);
      this.motes.push(mote);
    }
  }

  private updateMotes(deltaSeconds: number): void {
    const style = styleAt(this.distance + 8, 'motes');
    const accent = lerpColor(style.from.accent, style.to.accent, style.t);
    this.moteMaterial.emissiveColor = accent;
    this.moteMaterial.alpha = lerp(0.18, 0.4, influenceFor(style, 'whispering_woods'));

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
    const backdropStyle = styleAt(this.distance + FAR_LOOKAHEAD, 'background');
    const farFoliage = lerpColor(backdropStyle.from.foliage, backdropStyle.to.foliage, backdropStyle.t);
    this.backdrop.update(this.distance, sky, fog, farFoliage, influenceFor(skyStyle, 'greenfields'));
    this.scene.fogColor = fog;
    this.scene.fogDensity = lerp(fogStyle.from.fogDensity, fogStyle.to.fogDensity, fogStyle.t);

    this.skyLight.intensity = lerp(skyStyle.from.ambient, skyStyle.to.ambient, skyStyle.t);
    const gloom = 1 - influenceFor(skyStyle, 'greenfields');
    this.skyLight.diffuse = lerpColor(new Color3(0.91, 0.96, 0.92), new Color3(0.66, 0.77, 0.88), gloom);
    this.skyLight.groundColor = lerpColor(groundStyle.from.ground.scale(0.32), groundStyle.to.ground.scale(0.32), groundStyle.t);

    // Sun changes later than the sky, preserving warm light for a while as the horizon darkens.
    const sunT = staged(rawBiomeSample(this.distance + 6).t, 0.24, 0.9);
    const sunSample = rawBiomeSample(this.distance + 6);
    this.sun.intensity = lerp(sunSample.from.sun, sunSample.to.sun, sunT);
    this.sun.diffuse = lerpColor(new Color3(1, 0.95, 0.83), new Color3(0.74, 0.80, 1), gloom);
  }

  private disposeChunk(chunk: WorldChunk): void {
    chunk.root.dispose();
  }

  /** Debug overlay only. The player reads `zoneName` from the snapshot. */
  private prettyBiome(id: BiomeId): string {
    return ZONES.find((zone) => zone.id === id)?.name ?? id;
  }
}
