import {
  Color3,
  MaterialPluginBase,
  PBRMaterial,
  Scene,
  ShaderLanguage,
  type AbstractMesh,
  type Material,
  type MaterialDefines,
  type UniformBuffer,
  Vector3,
} from '@babylonjs/core';

/**
 * The air, and what it does to everything seen through it.
 *
 * Babylon's own fog is one flat colour applied by distance, and on a diorama
 * shot down a road it is the thing that gives the game away: the far treeline,
 * the near verge and the sky all arrive at the same grey, so the horizon reads
 * as a band of paint rather than as distance. Worse, it is a *constant*, so the
 * light has no direction - a scene lit by a low sun fogs identically whether
 * you are looking into that sun or away from it.
 *
 * This replaces it with the three things that actually make distance legible:
 *
 *   - **Aerial perspective.** Haze pools low and thins with height, so a hill
 *     rises out of it and a road disappears into it. The colour of the air is
 *     not one colour either: it runs from the ground haze along the floor to
 *     the sky at the top of the frame, which is what makes a far object sit
 *     *against* the sky rather than in front of it.
 *   - **Forward scatter.** Air lit from behind glows toward the sun. It costs
 *     one dot product and it is most of why a shot reads as a time of day.
 *   - **Translucency.** A leaf with the sun behind it lights up. Foliage is
 *     the only thing in the world thin enough for this to be true of, and it
 *     is the difference between a tree and a green rock.
 *
 * And, in the vertex half, the wind - which used to be the CPU rotating every
 * prop node on the road once a frame, forcing a world-matrix rebuild down each
 * of their subtrees for a sway of a fiftieth of a radian. Here it costs nothing
 * per frame and it is better: the tips of the grass move and the base does not,
 * because the sway is scaled by height above the prop's own root.
 *
 * All of it rides on the PBR shader through a material plugin rather than
 * replacing it, which is what keeps the lights, the shadows and the image
 * processing exactly as they were.
 */

/** Shared by every material in the scene; the biome writes it once a frame. */
export class AtmosphereState {
  /** Where the camera is, in world space. */
  readonly eye = new Vector3(0, 2, -17);
  /** The direction sunlight travels, normalised. */
  readonly sun = new Vector3(0.5, -1, 0.45).normalize();
  /** The haze along the ground. */
  readonly near = new Color3(0.28, 0.39, 0.4);
  /** What the air becomes against the sky. */
  readonly far = new Color3(0.105, 0.2, 0.24);
  /** The colour the air takes looking down-sun. */
  readonly glow = new Color3(0.5, 0.36, 0.18);
  /** How thick the air is, per world unit. */
  density = 0.026;
  /**
   * The height the haze starts thinning from, and how fast it thins.
   *
   * The floor is up at head height rather than on the ground because the
   * camera is five and a half units up: sampling the midpoint of the ray means
   * a fragment at the mage's feet is already averaging three units of altitude,
   * and a floor of zero would thin the haze where it should be thickest.
   */
  floor = 3;
  falloff = 0.11;
  /** The most of a surface the air may ever take. Under one, so nothing vanishes. */
  ceiling = 0.78;
  /** Seconds, for the wind. */
  time = 0;
  /** A gust, 0 to 1, so a still biome can be still. */
  gust = 1;
  /**
   * How far the world has walked.
   *
   * Load-bearing for anything keyed to a position. The chunks scroll *under* a
   * pinned camera, so a fragment's world x is not a place in the world - it is
   * a place on the screen, and noise sampled there would sit still while the
   * ground slid beneath it, which is the oldest artefact in the book. Adding
   * the travel back gives the coordinate the world actually has.
   */
  travelled = 0;
}

/** How hard a surface answers to the wind, the sun behind it, and its own place. */
export interface AtmosphereResponse {
  /** Sway in world units per unit of height above the prop's base. 0 is rigid. */
  wind?: number;
  /** How much light comes through the surface, 0 to 1. */
  translucency?: number;
  /**
   * How much world-scale variation is painted over this surface, 0 to 1.
   *
   * For the ground, which is half the frame and was one flat colour across all
   * of it. Three scales of noise and a wear gradient beside the trail is what
   * turns a wash of green into a meadow, and it costs a handful of instructions
   * on a surface that is already the cheapest thing being shaded.
   */
  ground?: number;
  /**
   * How far one instance's colour may stand from its neighbours', 0 to 1.
   *
   * Every grass clump on the road is the same mesh with the same material, and
   * without this they are also the same green - which is what makes a field
   * read as a repeated asset rather than as a field. Hashed from the instance's
   * own place, so a given clump keeps its colour for as long as it exists.
   */
  vary?: number;
}

const UNIFORMS = [
  { name: 'vAtmoEye', size: 3, type: 'vec3' },
  { name: 'vAtmoSun', size: 3, type: 'vec3' },
  { name: 'vAtmoNear', size: 3, type: 'vec3' },
  { name: 'vAtmoFar', size: 3, type: 'vec3' },
  { name: 'vAtmoGlow', size: 3, type: 'vec3' },
  { name: 'vAtmoAir', size: 4, type: 'vec4' },
  { name: 'vAtmoWind', size: 4, type: 'vec4' },
  { name: 'vAtmoLeaf', size: 4, type: 'vec4' },
  { name: 'vAtmoSurface', size: 4, type: 'vec4' },
] as const;

const DECLARATIONS = `
uniform vec3 vAtmoEye;
uniform vec3 vAtmoSun;
uniform vec3 vAtmoNear;
uniform vec3 vAtmoFar;
uniform vec3 vAtmoGlow;
uniform vec4 vAtmoAir;
uniform vec4 vAtmoWind;
uniform vec4 vAtmoLeaf;
uniform vec4 vAtmoSurface;
`;

/**
 * Two sines rather than one: a single frequency reads as a metronome, and the
 * beat between two close ones is what makes a gust feel like weather. The
 * phase comes from the instance's own world translation, so a field of grass
 * sharing one material still moves as a field rather than as one blade
 * repeated - `finalWorld` is per-instance even where the geometry is not.
 */
const WIND_CODE = `
#ifdef ATMO_WIND
{
  float atmoHeight = max(positionUpdated.y, 0.0);
  float atmoPhase = finalWorld[3].x * 0.63 + finalWorld[3].z * 0.37;
  float atmoSway =
    sin(vAtmoWind.x * 1.15 + atmoPhase) * 0.62 +
    sin(vAtmoWind.x * 2.07 + atmoPhase * 1.7) * 0.38;
  float atmoAmount = vAtmoWind.y * vAtmoWind.z * atmoHeight;
  worldPos.xz += vec2(atmoSway, atmoSway * 0.42) * atmoAmount;
}
#endif
#ifdef ATMO_VARY
{
  // The instance's own place, with the travel added back so a clump keeps its
  // colour as the road walks past rather than inheriting its neighbour's.
  vec2 atmoSeed = vec2(finalWorld[3].x + vAtmoSurface.w, finalWorld[3].z);
  float atmoValue = fract(sin(dot(atmoSeed, vec2(41.31, 289.07))) * 43758.5453);
  float atmoHue = fract(sin(dot(atmoSeed, vec2(93.71, 17.93))) * 24634.6345);
  // Value first, because that is what actually separates one clump from the
  // next; then a small push along the yellow-to-blue axis foliage varies on.
  float atmoLevel = 1.0 + (atmoValue - 0.5) * vAtmoSurface.x;
  float atmoSkew = (atmoHue - 0.5) * vAtmoSurface.y;
  vAtmoTint = atmoLevel * vec3(1.0 + atmoSkew, 1.0 + atmoSkew * 0.25, 1.0 - atmoSkew);
}
#endif
`;

const VERTEX_DECLARATIONS = `
#ifdef ATMO_VARY
varying vec3 vAtmoTint;
#endif
`;

/**
 * Value noise, three octaves of it, over the ground.
 *
 * Cheap on purpose: a hash and four mixes per octave, no texture, no
 * derivatives. The ground is the largest surface in the frame and the one that
 * least deserves a dependent texture read.
 */
const FRAGMENT_DECLARATIONS = `
#ifdef ATMO_VARY
varying vec3 vAtmoTint;
#endif
#ifdef ATMO_GROUND
float atmoHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float atmoNoise(vec2 p){
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(atmoHash(cell), atmoHash(cell + vec2(1.0, 0.0)), f.x),
    mix(atmoHash(cell + vec2(0.0, 1.0)), atmoHash(cell + vec2(1.0, 1.0)), f.x),
    f.y);
}
#endif
`;

/**
 * Runs on the linear colour, after Babylon's lighting and before the tone
 * mapper. Scene fog is off - `Atmosphere` turns it off - so nothing here is
 * applied twice.
 */
const AIR_CODE = `
{
  vec3 atmoToEye = vPositionW - vAtmoEye;
  float atmoDistance = length(atmoToEye);
  vec3 atmoView = atmoToEye / max(atmoDistance, 0.0001);

  // Haze pools low. Sampling the midpoint of the ray rather than integrating
  // it is wrong by a few percent and right by every measure that matters here.
  float atmoMidY = (vPositionW.y + vAtmoEye.y) * 0.5;
  float atmoDensity = vAtmoAir.x * exp(-max(atmoMidY - vAtmoAir.y, 0.0) * vAtmoAir.z);
  float atmoHaze = (1.0 - exp(-atmoDistance * atmoDensity)) * vAtmoAir.w;

  // Looking up through the air arrives at the sky; looking along the ground
  // arrives at the haze standing on it.
  float atmoUp = clamp(atmoView.y * 2.2 + 0.42, 0.0, 1.0);
  vec3 atmoColor = mix(vAtmoNear, vAtmoFar, atmoUp);

  // Looking toward the sun, the air itself lights up.
  //
  // vAtmoSun is the direction the light *travels*, and atmoView points from the
  // eye to the fragment - so light arriving at the eye travels along -atmoView,
  // and forward scatter is where that agrees with the sun. The sign was the
  // other way round here and nowhere else, which peaked the glow looking away
  // from the sun and left it disagreeing with the sky, which had it right.
  float atmoScatter = max(-dot(atmoView, vAtmoSun), 0.0);
  float atmoForward = atmoScatter * atmoScatter;
  atmoColor += vAtmoGlow * atmoForward * atmoForward;

#ifdef ATMO_VARY
  // This instance's own colour, decided in the vertex shader from where it
  // stands. Before the haze, because the haze is the air in front of it.
  finalColor.rgb *= vAtmoTint;
#endif

#ifdef ATMO_GROUND
  {
    // The un-scrolled coordinate: see AtmosphereState.travelled.
    vec2 atmoGround = vec2(vPositionW.x + vAtmoSurface.w, vPositionW.z);
    // Three scales. The meadow patches are what the eye reads at a distance,
    // the clumps are what it reads at the mage's feet, and the fine octave is
    // only there to stop the other two looking like a gradient.
    float atmoPatch =
      atmoNoise(atmoGround * 0.068) * 0.55 +
      atmoNoise(atmoGround * 0.31) * 0.3 +
      atmoNoise(atmoGround * 1.37) * 0.15;
    // Ground beside a trail is trodden and dry; further out it is not. This is
    // the one piece of variation here that is about the place rather than the
    // noise, and it is the one that makes the road look walked on.
    float atmoWear = 1.0 - smoothstep(0.85, 3.6, abs(vPositionW.z));
    float atmoDry = clamp(atmoPatch * 0.75 + atmoWear * 0.5, 0.0, 1.0);
    vec3 atmoSoil = mix(vec3(0.80, 1.06, 0.83), vec3(1.26, 1.07, 0.68), atmoDry);
    finalColor.rgb *= mix(vec3(1.0), atmoSoil, vAtmoSurface.z) * (0.70 + atmoPatch * 0.62);
  }
#endif

#ifdef ATMO_LEAF
  // A leaf with the sun behind it. Strongest where the surface faces away from
  // the light, which is exactly where direct lighting has left it darkest.
  float atmoBack = clamp(-dot(normalize(vNormalW), vAtmoSun), 0.0, 1.0);
  finalColor.rgb += vAtmoLeaf.rgb * vAtmoLeaf.a * atmoForward * (0.35 + 0.65 * atmoBack);
#endif

  finalColor.rgb = mix(finalColor.rgb, atmoColor, clamp(atmoHaze, 0.0, 1.0));
}
`;

export class AtmospherePlugin extends MaterialPluginBase {
  private readonly leaf = new Color3(0, 0, 0);
  private readonly response: AtmosphereResponse = {};

  constructor(
    material: Material,
    private readonly state: AtmosphereState,
    response: AtmosphereResponse = {},
  ) {
    super(material, 'Atmosphere', 220, {
      ATMO_WIND: false,
      ATMO_LEAF: false,
      ATMO_GROUND: false,
      ATMO_VARY: false,
    });
    this.respondWith(response);
    this._enable(true);
  }

  /**
   * Merges in what this surface does, and recompiles if that changed the shape
   * of the shader.
   *
   * Merging rather than replacing, because the callers legitimately overlap and
   * their order is not something any of them can see. `EvercastScene` installs
   * the plugin from the scene's new-material observable - which fires from the
   * material's own constructor - so by the time `createTerrainMaterials` says
   * "and this one is ground", the plugin is already there. It used to return
   * early at that point, which is why the ground kept its flat wash: the one
   * call that knew it was ground was the one that did nothing.
   */
  respondWith(response: AtmosphereResponse): void {
    Object.assign(this.response, response);
    const material = this._material;
    if (material instanceof PBRMaterial && this.response.translucency) {
      // The light that comes through a leaf is the leaf's own colour, warmed:
      // a green leaf against a low sun goes yellow, not white.
      Color3.LerpToRef(material.albedoColor, new Color3(1, 0.86, 0.5), 0.35, this.leaf);
    }
    this.markAllDefinesAsDirty();
  }

  getClassName(): string {
    return 'AtmospherePlugin';
  }

  /**
   * GLSL only, and that is a statement about this project rather than about
   * the technique: the game builds a WebGL `Engine`, so a WGSL translation
   * would be a second copy of the shader with nothing to compile it.
   */
  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override prepareDefines(defines: MaterialDefines, _scene: Scene, _mesh: AbstractMesh): void {
    defines.ATMO_WIND = (this.response.wind ?? 0) > 0;
    defines.ATMO_LEAF = (this.response.translucency ?? 0) > 0;
    defines.ATMO_GROUND = (this.response.ground ?? 0) > 0;
    defines.ATMO_VARY = (this.response.vary ?? 0) > 0;
  }

  override getUniforms(): {
    ubo: { name: string; size: number; type: string }[];
    vertex: string;
    fragment: string;
  } {
    return {
      ubo: UNIFORMS.map((uniform) => ({ ...uniform })),
      vertex: DECLARATIONS,
      fragment: DECLARATIONS,
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    const state = this.state;
    uniformBuffer.updateVector3('vAtmoEye', state.eye);
    uniformBuffer.updateVector3('vAtmoSun', state.sun);
    uniformBuffer.updateColor3('vAtmoNear', state.near);
    uniformBuffer.updateColor3('vAtmoFar', state.far);
    uniformBuffer.updateColor3('vAtmoGlow', state.glow);
    uniformBuffer.updateFloat4('vAtmoAir', state.density, state.floor, state.falloff, state.ceiling);
    uniformBuffer.updateFloat4('vAtmoWind', state.time, this.response.wind ?? 0, state.gust, 0);
    uniformBuffer.updateFloat4(
      'vAtmoLeaf',
      this.leaf.r,
      this.leaf.g,
      this.leaf.b,
      this.response.translucency ?? 0,
    );
    const vary = this.response.vary ?? 0;
    uniformBuffer.updateFloat4(
      'vAtmoSurface',
      vary * 0.34,
      vary * 0.16,
      this.response.ground ?? 0,
      state.travelled,
    );
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: VERTEX_DECLARATIONS,
        CUSTOM_VERTEX_UPDATE_WORLDPOS: WIND_CODE,
      };
    }
    if (shaderType === 'fragment') {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: FRAGMENT_DECLARATIONS,
        CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: AIR_CODE,
      };
    }
    return null;
  }
}

/**
 * Installs the plugin on one material, once.
 *
 * Idempotent because the callers overlap on purpose: environment props are
 * finished by `EnvironmentMaterials`, actors by `StylizedMaterials`, and
 * anything either of them missed is caught by the scene's new-material
 * observable - a belt-and-braces arrangement that matters because a material
 * without the plugin does not look slightly wrong, it looks like a cut-out
 * with no air in front of it.
 */
export function breatheOn(
  material: Material,
  state: AtmosphereState,
  response: AtmosphereResponse = {},
): void {
  if (!(material instanceof PBRMaterial)) return;
  const installed = material.pluginManager?.getPlugin<AtmospherePlugin>('Atmosphere');
  if (installed) {
    installed.respondWith(response);
    return;
  }
  new AtmospherePlugin(material, state, response);
}
