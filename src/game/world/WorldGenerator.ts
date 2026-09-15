import {
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Matrix,
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
import { createGroundDetails, createContactShadows, type ContactPatch } from './WorldGroundDetails';
import { WorldBackdrop } from './WorldBackdrop';
import { WorldHorizon } from './WorldHorizon';
import { ZONES } from '../../content/zones';
import { DEFAULT_ENGINE_CONFIG } from '../../engine/config';
import { AtmosphereState } from '../render/Atmosphere';
import { type RenderProfile, renderProfileFor, readDeviceFacts } from '../render/DeviceProfile';
import { WORLD_UNITS_PER_ZONE, worldTravelSpeed } from './JourneyProgress';
// Thin instances put the whole mote cloud in one draw call; the methods are a
// side-effect import rather than part of `Mesh` itself.
import '@babylonjs/core/Meshes/thinInstanceMesh';

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
  /** Kept so a chunk can be shown or hidden without walking its subtree. */
  shown: boolean;
}

const CHUNK_SIZE = 12;
/**
 * How far past the edge of the frame a chunk is still shown.
 *
 * Half a chunk of slack, because the camera's half-width is measured at the
 * road and a tall prop leaning in from a chunk just off-frame is drawn at a
 * shallower angle than its root suggests.
 */
const CHUNK_MARGIN = CHUNK_SIZE * 0.5;
/** Frames between re-picking which lanterns the two point lights stand in. */
const LANTERN_SCAN_FRAMES = 8;
/**
 * The authored fog densities, converted to haze per world unit.
 *
 * Babylon's EXP2 fog squares the distance, so it is nearly absent up close and
 * then arrives all at once; `Atmosphere` is linear in distance and needs a
 * smaller number to reach the same place at the far end of the road.
 */
const HAZE_SCALE = 0.34;

/**
 * Key to fill, and the reason the diorama used to look like a product shot.
 *
 * The biomes author an ambient and a sun each, and between the sky light, the
 * rim and the sun the three came out at very nearly the same strength - a ratio
 * of about one to one. At that ratio nothing has a lit side and a dark side, so
 * nothing has a shape: turning the sun off entirely changed the picture about as
 * much as a cloud passing. It also made the shadow map pointless, because a
 * shadow only removes the sun's share and the sun's share was a third.
 *
 * These pull the fill down and the key up without touching a single authored
 * biome value, so the relative mood of the four zones is exactly as written and
 * only the contrast between them and their own shadows changes.
 */
const FILL_SCALE = 0.52;
const KEY_SCALE = 1.3;
/** Scratch, so a cloud of motes costs no allocation a frame. */
const MOTE_MATRIX = Matrix.Identity();

/** A prop's x in world terms: its chunk has the travel in it, the prop the offset. */
function absoluteX(node: TransformNode): number {
  return ((node.parent as TransformNode | null)?.position.x ?? 0) + node.position.x;
}
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

/**
 * What stands in the foreground of each biome.
 *
 * Tall enough to be cropped by the bottom of the frame, and nothing with a
 * silhouette worth reading - it is a blurred plane, not a subject.
 */
function foregroundProp(biome: BiomeId, roll: number): string {
  switch (biome) {
    case 'greenfields':
      // Mostly grass. A flower head this close to the lens is a bright blob
      // the size of the mage, and the bloom finds it before the blur does.
      return roll < 0.88 ? (roll < 0.44 ? 'grass_clump_a' : 'grass_clump_b') : 'flower_patch_a';
    case 'whispering_woods':
      return roll < 0.6 ? 'forest_fern' : 'root_cluster';
    case 'gravehollow':
      return roll < 0.5 ? 'bone_pile_rubble' : 'gravestone_b';
    default:
      return roll < 0.55 ? 'bone_pile_rubble' : 'small_ruin_stone';
  }
}

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
  private readonly horizon: WorldHorizon;
  private readonly lanternNodes = new Set<TransformNode>();
  /** Scratch: one chunk's ground contacts, gathered while it is being built. */
  private readonly contacts: ContactPatch[] = [];
  private readonly localLights: PointLight[] = [];
  private readonly nearestLanterns: TransformNode[] = [];
  private readonly chunks = new Map<number, WorldChunk>();
  private readonly motes: Mesh | null = null;
  private readonly moteDrift: { x: number; y: number; z: number; size: number }[] = [];
  private readonly moteMatrices: Float32Array;
  private readonly moteMaterial: StandardMaterial;
  /** Half the width of road on screen, in world units. Set by the camera. */
  private visibleHalfWidth = 14;
  private visibleCenterX = 0;
  private lanternScan = 0;
  private distance = 0;
  private visualTime = 0;
  /** Overwritten from the snapshot on the first sync; see `setZoneLength`. */
  private zoneLength = DEFAULT_ENGINE_CONFIG.zoneLength;
  private lastCenterIndex = Number.NaN;

  constructor(
    private readonly scene: Scene,
    private readonly skyLight: HemisphericLight,
    private readonly sun: DirectionalLight,
    shadows?: ShadowGenerator,
    private readonly profile: RenderProfile = renderProfileFor(readDeviceFacts()),
    readonly atmosphere: AtmosphereState = new AtmosphereState(),
  ) {
    this.assets = new EnvironmentAssets(scene, undefined, shadows, atmosphere);
    this.terrainMaterials = createTerrainMaterials(scene, atmosphere);
    this.contactMaterial = new StandardMaterial('ground contact shade', scene);
    this.contactMaterial.disableLighting = true;
    this.contactMaterial.emissiveColor = Color3.White();
    this.contactMaterial.backFaceCulling = false;
    this.backdrop = new WorldBackdrop(scene);
    this.horizon = new WorldHorizon(scene, atmosphere, profile.mistBands);
    for (let i = 0; i < 2; i++) {
      const light = new PointLight(`landmark candle-${i}`, Vector3.Zero(), scene);
      light.diffuse = new Color3(1, 0.52, 0.19); light.intensity = 2.8; light.range = 3.5; light.setEnabled(false);
      this.localLights.push(light);
    }
    // Babylon's own fog is off for the whole scene: `Atmosphere` is doing the
    // job, in the same pass, with a direction and a height to it.
    this.scene.fogMode = Scene.FOGMODE_NONE;
    this.moteMaterial = new StandardMaterial('world-motes', this.scene);
    this.moteMaterial.disableLighting = true;
    this.moteMaterial.emissiveColor = BIOMES[0].accent;
    this.moteMaterial.alpha = 0.55;
    this.moteMatrices = new Float32Array(Math.max(1, this.profile.motes) * 16);
    this.motes = this.createAtmosphereMotes();
    this.rebuildVisibleChunks();
  }

  /**
   * What the camera can see of the road, so the chunks off either end can be
   * hidden rather than drawn and then thrown away by the frustum test.
   *
   * Frustum culling already skipped them, but culling is not free: every mesh
   * in the scene is walked, transformed and tested every frame, and a chunk is
   * a few hundred of them. Hiding the root takes the whole subtree out of that
   * walk, out of the shadow map, and out of the glow layer at once.
   */
  setView(centerX: number, halfWidth: number): void {
    this.visibleCenterX = centerX;
    this.visibleHalfWidth = halfWidth;
    this.positionChunks();
  }

  /**
   * The run's zone length, so the road walks one biome per zone of stages
   * rather than per twenty-five of them. Set from the snapshot, which is where
   * the HUD reads the same number.
   */
  setZoneLength(zoneLength: number): void {
    this.zoneLength = zoneLength;
  }

  update(deltaSeconds: number, walking: boolean): void {
    this.visualTime += deltaSeconds;
    this.distance += walking ? deltaSeconds * worldTravelSpeed(this.zoneLength) : 0;
    this.rebuildVisibleChunks();
    this.updateAtmosphere();
    this.updateMotes(deltaSeconds);
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
    this.motes?.dispose();
    this.moteMaterial.dispose();
    this.assets.dispose();
    this.backdrop.dispose();
    this.horizon.dispose();
    for (const material of this.terrainMaterials) material.dispose();
    this.contactMaterial.dispose();
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

    const min = centerIndex - this.profile.chunksBehind;
    const max = centerIndex + this.profile.chunksAhead;

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
    const left = this.visibleCenterX - this.visibleHalfWidth - CHUNK_MARGIN;
    const right = this.visibleCenterX + this.visibleHalfWidth + CHUNK_MARGIN;
    for (const [index, chunk] of this.chunks) {
      const x = index * CHUNK_SIZE - this.distance + WORLD_ANCHOR_X;
      chunk.root.position.x = x;
      // A chunk is twelve units wide about its own origin.
      const shown = x + CHUNK_SIZE * 0.5 >= left && x - CHUNK_SIZE * 0.5 <= right;
      if (shown === chunk.shown) continue;
      chunk.shown = shown;
      chunk.root.setEnabled(shown);
    }
  }

  private readonly paletteAt = (x: number): TerrainPalette => {
    const style = styleAt(x, 'ground');
    return { ground: lerpColor(style.from.ground, style.to.ground, style.t), road: lerpColor(style.from.road, style.to.road, style.t) };
  };

  private buildChunk(index: number): WorldChunk {
    const root = new TransformNode(`world-chunk-${index}`, this.scene);
    this.contacts.length = 0;
    for (const mesh of createTerrainChunk(index, this.scene, this.paletteAt, ...this.terrainMaterials)) mesh.parent = root;
    createGroundDetails(index, this.scene, this.terrainMaterials[0], this.paletteAt, this.profile.groundDetail).parent = root;
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
    for (let slot = 0; slot < this.profile.groundCover; slot++) {
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

    /*
     * The foreground: a few clumps between the camera and the road.
     *
     * The bottom edge of the frame lands at about z = -7.5, so these are half
     * cropped by it - deliberately. They are also eight units from the lens
     * against a plane of focus out on the road, so wherever depth of field is
     * affordable they are a soft green wash across the bottom of the picture
     * rather than blades anyone can count. Two things nothing else here does:
     * they give the shot a foreground plane, and they hide the line where the
     * ground cover stops.
     */
    for (let slot = 0; slot < this.profile.foreground; slot++) {
      const seed = index * 613 + slot * 53;
      const x = -5.5 + (slot + random01(seed)) * (11 / Math.max(1, this.profile.foreground));
      const z = -7.6 + random01(seed + 1) * 1.7;
      const style = styleAt(center + x, 'props');
      const biome = random01(seed + 2) < style.t ? style.to.id : style.from.id;
      this.placeProp(
        foregroundProp(biome, random01(seed + 3)),
        root, x, z,
        1.35 + random01(seed + 4) * 0.55,
        random01(seed + 5) * Math.PI * 2,
        false,
      );
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
    // One mesh for every ground contact in the chunk, built last so it has them
    // all. See `createContactShadows`.
    const contact = createContactShadows(this.scene, this.contactMaterial, this.contacts);
    if (contact) contact.parent = root;
    this.contacts.length = 0;
    return { index, root, shown: true };
  }

  private placeProp(id: string, root: TransformNode, x: number, z: number, scale = 1, yaw = 0, castShadow = true): void {
    const index = Number(root.name.replace('world-chunk-', ''));
    const absoluteX = index * CHUNK_SIZE + x;
    const node = this.assets.place(id, root, x, z, scale, yaw, { height: terrainHeight(absoluteX, z), castShadow });
    if (id === 'vigil_lantern' || id === 'forest_shrine_arch') {
      this.lanternNodes.add(node);
      node.onDisposeObservable.addOnce(() => this.lanternNodes.delete(node));
    }
    if (castShadow && z < 8) {
      const radius = /mausoleum|arch|gate/.test(id) ? 1.7 : id.includes('tree') ? 0.65 : 0.6;
      this.contacts.push({ worldX: absoluteX, localX: x, z, radius: radius * scale });
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

  /**
   * One mesh, however many specks.
   *
   * These were a mesh each, and a mesh each is a draw call each: two dozen of
   * them for four hundred triangles of dust. As thin instances they are one
   * buffer of matrices and one call, which is also what makes the count worth
   * tiering - a phone can have ten and a desktop twenty-two without either of
   * them costing a draw.
   */
  private createAtmosphereMotes(): Mesh | null {
    if (this.profile.motes <= 0) return null;
    const mesh = MeshBuilder.CreateSphere('world-motes', { diameter: 0.024, segments: 4 }, this.scene);
    mesh.material = this.moteMaterial;
    mesh.isPickable = false;
    // The drift wanders them well past the box they start in; culling them on
    // one shared bounding box would blink the whole cloud out at the edge.
    mesh.alwaysSelectAsActiveMesh = true;
    for (let i = 0; i < this.profile.motes; i += 1) {
      this.moteDrift.push({
        x: -7 + random01(i * 13) * 17,
        y: 0.6 + random01(i * 17) * 4.8,
        z: -1.8 + random01(i * 23) * 7.5,
        size: 0.75 + (i % 5) * 0.17,
      });
    }
    mesh.thinInstanceSetBuffer('matrix', this.moteMatrices, 16, false);
    return mesh;
  }

  private updateMotes(deltaSeconds: number): void {
    if (!this.motes) return;
    const style = styleAt(this.distance + 8, 'motes');
    const accent = lerpColor(style.from.accent, style.to.accent, style.t);
    this.moteMaterial.emissiveColor = accent;
    this.moteMaterial.alpha = lerp(0.18, 0.4, influenceFor(style, 'whispering_woods'));

    const graveInfluence = influenceFor(style, 'gravehollow');
    const woodsInfluence = influenceFor(style, 'whispering_woods');
    const driftX = lerp(0.12, -0.38, graveInfluence);

    for (let i = 0; i < this.moteDrift.length; i += 1) {
      const mote = this.moteDrift[i];
      mote.x += deltaSeconds * (driftX + Math.sin(this.visualTime * 0.8 + i) * 0.04);
      mote.y += deltaSeconds * (0.05 + woodsInfluence * Math.sin(this.visualTime * 1.8 + i * 0.6) * 0.08 - graveInfluence * 0.12);
      if (mote.x < -8.5) mote.x = 9;
      if (mote.x > 9.5) mote.x = -8;
      if (mote.y < 0.25) mote.y = 5.2;
      if (mote.y > 5.5) mote.y = 0.45;
      const pulse = 0.65 + woodsInfluence * (0.35 + Math.sin(this.visualTime * 4 + i) * 0.35);
      const scale = Math.max(0.25, pulse) * mote.size;
      Matrix.ScalingToRef(scale, scale, scale, MOTE_MATRIX);
      MOTE_MATRIX.setTranslationFromFloats(mote.x, mote.y, mote.z);
      MOTE_MATRIX.copyToArray(this.moteMatrices, i * 16);
    }
    this.motes.thinInstanceBufferUpdated('matrix');
  }

  private updateAtmosphere(): void {
    // Each atmospheric system has its own curve; they no longer all lerp with the same t.
    const skyStyle = styleAt(this.distance + 10, 'sky');
    const groundStyle = styleAt(this.distance, 'ground');
    const fogStyle = styleAt(this.distance + 4, 'fog');

    const sky = lerpColor(skyStyle.from.sky, skyStyle.to.sky, skyStyle.t);
    const haze = lerpColor(fogStyle.from.fog, fogStyle.to.fog, fogStyle.t);
    // Behind the painted sky, so it is only ever seen through a hole in it.
    this.scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    const backdropStyle = styleAt(this.distance + FAR_LOOKAHEAD, 'background');
    const farFoliage = lerpColor(backdropStyle.from.foliage, backdropStyle.to.foliage, backdropStyle.t);
    const daylight = influenceFor(skyStyle, 'greenfields');

    this.skyLight.intensity = lerp(skyStyle.from.ambient, skyStyle.to.ambient, skyStyle.t) * FILL_SCALE;
    const gloom = 1 - daylight;
    this.skyLight.diffuse = lerpColor(new Color3(0.91, 0.96, 0.92), new Color3(0.66, 0.77, 0.88), gloom);
    this.skyLight.groundColor = lerpColor(groundStyle.from.ground.scale(0.32), groundStyle.to.ground.scale(0.32), groundStyle.t);

    // Sun changes later than the sky, preserving warm light for a while as the horizon darkens.
    const sunSample = rawBiomeSample(this.distance + 6);
    const sunT = staged(sunSample.t, 0.24, 0.9);
    this.sun.intensity = lerp(sunSample.from.sun, sunSample.to.sun, sunT) * KEY_SCALE;
    this.sun.diffuse = lerpColor(new Color3(1, 0.95, 0.83), new Color3(0.74, 0.80, 1), gloom);

    /*
     * The air itself, which every PBR surface in the scene reads from.
     *
     * `near` is the haze standing on the ground and `far` is what that haze
     * becomes against the sky - lifted most of the way toward the sky colour
     * rather than all of it, because a ridge that faded to the exact zenith
     * would not recede into the distance, it would disappear into it.
     */
    const air = this.atmosphere;
    air.near.copyFrom(haze);
    Color3.LerpToRef(haze, sky, 0.66, air.far);
    // The authored densities were tuned for Babylon's squared-distance fog;
    // this one is linear in distance, which is softer close up and is what
    // makes a long road read as a long road rather than as a wall of grey.
    air.density = lerp(fogStyle.from.fogDensity, fogStyle.to.fogDensity, fogStyle.t) * HAZE_SCALE;
    // Down-sun glow, in the sun's own colour: brightest under an open sky and
    // almost nothing under a canopy, which is the difference between a golden
    // afternoon and a cold one.
    air.glow.copyFrom(this.sun.diffuse).scaleInPlace(0.1 + daylight * 0.32);
    air.sun.copyFrom(this.sun.direction).normalize();
    air.time = this.visualTime;
    air.travelled = this.distance;

    /*
     * The far ground, and the mist on it. It reads its height at the same world
     * x the chunks do - `distance` is what both are offset by - so the seam
     * where one takes over from the other holds however far the road has come.
     */
    const farGround = lerpColor(groundStyle.from.ground, groundStyle.to.ground, groundStyle.t);
    // How much of the shot is looking down-sun, which is what decides whether
    // the mist glows or just sits there.
    const sunward = Math.max(0, -air.sun.z) * daylight;
    this.horizon.update(this.distance, farGround, haze, sunward, this.visualTime);

    this.backdrop.update(this.distance, {
      sky,
      haze,
      foliage: farFoliage,
      daylight,
      // Gravehollow is the one place with a sky worth looking up at; the woods
      // have a canopy over them and the Ashen Road has smoke.
      starlight: influenceFor(skyStyle, 'gravehollow'),
      sun: air.sun,
      seconds: this.visualTime,
    });
    // Gusts, shared by every blade of grass on the road so they lean together.
    air.gust = 0.72 + Math.sin(this.visualTime * 0.31) * 0.2 + Math.sin(this.visualTime * 0.13) * 0.12;
  }

  private disposeChunk(chunk: WorldChunk): void {
    chunk.root.dispose();
  }

  /** Debug overlay only. The player reads `zoneName` from the snapshot. */
  private prettyBiome(id: BiomeId): string {
    return ZONES.find((zone) => zone.id === id)?.name ?? id;
  }
}
