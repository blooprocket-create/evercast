import {
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  Scene,
  ShaderMaterial,
  Vector3,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core';

/**
 * Everything past the last chunk: the sky, and three ridgelines standing in it.
 *
 * Both used to be painted in screen space. The sky ran its gradient up `vUV.y`
 * and hung its sun at a fixed (0.76, 0.955), which is a guess about where the
 * horizon falls on the screen - and the horizon moves, because `Framing` leans
 * the camera further over the road the taller the window gets. On a phone the
 * sun sat in the grass. The ridges were flat emissive silhouettes, one colour
 * each, which is what turned the far distance into three bands of mint.
 *
 * So the sky is cast from the view ray instead. Each pixel reconstructs the
 * direction it is looking, which makes every part of it - the gradient, the
 * sun, the cloud deck, the stars - a fact about the world rather than about the
 * window it is being watched through. It costs one inverse matrix a frame and
 * one full-screen quad, which is the cheapest thing in the renderer.
 *
 * And the ridges carry a gradient now: haze at the foot, foliage at the crown,
 * each further one nearer to the colour of the air. That is the whole trick of
 * distance in a painted landscape, and it was the one thing they did not have.
 */

interface Ridge {
  mesh: Mesh;
  material: ShaderMaterial;
  depth: number;
  height: number;
  speed: number;
}

/** What the air and the light are doing, this far along the road. */
export interface BackdropLook {
  sky: Color3;
  haze: Color3;
  foliage: Color3;
  /** 1 under an open Greenfields sky, 0 under anything else. */
  daylight: number;
  /** How far into the dark biomes the road has got; brings the stars out. */
  starlight: number;
  /** The direction sunlight travels. */
  sun: Vector3;
  seconds: number;
}

const SKY_VERTEX = `precision highp float;
attribute vec3 position;
uniform mat4 inverseViewProjection;
uniform vec3 eye;
varying vec3 vRay;
void main(){
  // The far plane, unprojected: the direction this pixel is looking.
  vec4 far = inverseViewProjection * vec4(position.xy, 1.0, 1.0);
  vRay = far.xyz / far.w - eye;
  gl_Position = vec4(position.xy, 0.99999, 1.0);
}`;

const SKY_FRAGMENT = `precision highp float;
varying vec3 vRay;
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 haze;
uniform vec3 sunDirection;
uniform float daylight;
uniform float starlight;
uniform float seconds;
uniform float drift;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float valueNoise(vec2 p){
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(cell), b = hash(cell + vec2(1.0, 0.0));
  float c = hash(cell + vec2(0.0, 1.0)), d = hash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/** Three octaves. A fourth is invisible behind the tone mapper and the bloom. */
float clouds(vec2 p){
  float v = valueNoise(p) * 0.55;
  v += valueNoise(p * 2.03 + 11.0) * 0.3;
  v += valueNoise(p * 4.11 + 23.0) * 0.15;
  return v;
}

void main(){
  vec3 dir = normalize(vRay);
  float up = clamp(dir.y, -1.0, 1.0);

  // The gradient. Curved rather than linear, so the horizon band stays tight
  // and the zenith has somewhere to go.
  float lift = pow(clamp(up * 1.35, 0.0, 1.0), 0.72);
  vec3 color = mix(horizon, zenith, lift);
  // The haze that the ground is disappearing into, standing on the horizon so
  // the two meet in the same colour rather than at a seam.
  color = mix(color, haze, exp(-max(up, 0.0) * 11.0) * 0.8);

  // The sun, in the world rather than on the screen: sunDirection is where the
  // light is going, so looking back along it is looking at it.
  float toSun = max(dot(dir, -sunDirection), 0.0);
  float halo = pow(toSun, 220.0);
  float bloom = pow(toSun, 7.0);
  color += vec3(1.0, 0.82, 0.55) * halo * (0.55 + daylight * 0.9);
  color += vec3(0.55, 0.42, 0.26) * bloom * (0.06 + daylight * 0.2);

  // A cloud deck at a fixed altitude, projected the way a real one would be:
  // squashed toward the horizon, opening out overhead.
  float ceiling = 1.0 / max(up, 0.045);
  vec2 deck = dir.xz * ceiling * 0.42 + vec2(drift * 0.06 + seconds * 0.004, seconds * 0.002);
  float band = clouds(deck);
  float cover = smoothstep(0.52, 0.78, band) * smoothstep(0.0, 0.22, up);
  // Lit from the sun's side, so the deck has a form rather than being a stain.
  float lit = 0.45 + 0.55 * pow(toSun, 1.4);
  color = mix(color, mix(haze, vec3(1.0, 0.96, 0.9), 0.35 * daylight + 0.1) * lit, cover * (0.22 + daylight * 0.3));

  // Stars, where the biome is dark enough to have any. Hashed off the view
  // direction, so they hold still while the world walks past underneath.
  if (starlight > 0.01) {
    vec2 sky = dir.xz / max(up, 0.08) * 6.0;
    vec2 cell = floor(sky);
    float spark = hash(cell);
    if (spark > 0.955) {
      vec2 offset = fract(sky) - vec2(hash(cell + 3.7), hash(cell + 9.1));
      float star = smoothstep(0.22, 0.0, length(offset));
      float twinkle = 0.6 + 0.4 * sin(seconds * 2.4 + spark * 90.0);
      color += vec3(0.8, 0.85, 1.0) * star * twinkle * starlight * smoothstep(0.02, 0.3, up);
    }
  }

  // A gradient over eight bits of colour bands visibly, and the bloom threshold
  // makes it worse. A dither under half a level is cheaper than more bits.
  float dither = (hash(gl_FragCoord.xy * 0.17 + seconds) - 0.5) * 0.0035;
  gl_FragColor = vec4(color + dither, 1.0);
}`;

const RIDGE_VERTEX = `precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
uniform float crest;
varying float vHeight;
void main(){
  // 0 at the foot of the ridge, 1 at the highest crest it ever reaches.
  vHeight = clamp((position.y + 3.0) / crest, 0.0, 1.0);
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

const RIDGE_FRAGMENT = `precision highp float;
varying float vHeight;
uniform vec3 foot;
uniform vec3 crown;
void main(){
  // Haze pools along the base of a distant ridge and thins toward the crest,
  // which is the whole of why one hill reads as further away than another.
  gl_FragColor = vec4(mix(foot, crown, smoothstep(0.0, 0.85, vHeight)), 1.0);
}`;

/** Scratch: the sky's horizon tone, which the ridges are mixed out of. */
const HORIZON = new Color3();

/** Depth from the road, crest height, and how fast it slides past. */
const RIDGES: readonly [number, number, number][] = [
  [72, 6.5, 0.16],
  [46, 3.5, 0.3],
  [27, 1.8, 0.52],
];

export class WorldBackdrop {
  private readonly sky: Mesh;
  private readonly skyMaterial: ShaderMaterial;
  private readonly ridges: Ridge[] = [];
  private readonly inverseViewProjection = Matrix.Identity();
  private lastDistance = Number.NaN;

  constructor(private readonly scene: Scene) {
    this.skyMaterial = new ShaderMaterial(
      'painted sky',
      scene,
      { vertexSource: SKY_VERTEX, fragmentSource: SKY_FRAGMENT },
      {
        attributes: ['position'],
        uniforms: [
          'inverseViewProjection', 'eye', 'zenith', 'horizon', 'haze',
          'sunDirection', 'daylight', 'starlight', 'seconds', 'drift',
        ],
      },
    );
    this.skyMaterial.backFaceCulling = false;
    this.skyMaterial.disableDepthWrite = true;
    this.sky = MeshBuilder.CreatePlane('sky backdrop', { size: 2 }, scene);
    this.sky.material = this.skyMaterial;
    this.sky.alwaysSelectAsActiveMesh = true;
    this.sky.isPickable = false;

    for (const [depth, height, speed] of RIDGES) {
      const mesh = new Mesh(`ridge-${depth}`, scene);
      const material = new ShaderMaterial(
        `ridge atmosphere-${depth}`,
        scene,
        { vertexSource: RIDGE_VERTEX, fragmentSource: RIDGE_FRAGMENT },
        { attributes: ['position'], uniforms: ['worldViewProjection', 'crest', 'foot', 'crown'] },
      );
      material.backFaceCulling = false;
      // The crest a vertex is measured against: the ridge line wanders up to
      // about a third above its nominal height.
      material.setFloat('crest', 3 + height * 1.4);
      mesh.material = material;
      mesh.isPickable = false;
      this.ridges.push({ mesh, material, depth, height, speed });
    }
  }

  update(distance: number, look: BackdropLook): void {
    const camera = this.scene.activeCamera;
    if (camera) {
      this.scene.getTransformMatrix().invertToRef(this.inverseViewProjection);
      this.skyMaterial.setMatrix('inverseViewProjection', this.inverseViewProjection);
      this.skyMaterial.setVector3('eye', camera.globalPosition);
    }
    // Brighter than the air it sits behind, or the sky reads as another layer
    // of fog rather than as the thing the fog is standing against.
    this.skyMaterial.setColor3('zenith', look.sky.scale(1.25 + look.daylight * 0.75));
    this.skyMaterial.setColor3('horizon', look.haze.scale(1.1 + look.daylight * 0.55));
    this.skyMaterial.setColor3('haze', look.haze.scale(0.95));
    this.skyMaterial.setVector3('sunDirection', look.sun);
    this.skyMaterial.setFloat('daylight', look.daylight);
    this.skyMaterial.setFloat('starlight', look.starlight);
    this.skyMaterial.setFloat('seconds', look.seconds);
    this.skyMaterial.setFloat('drift', distance);

    // The same colour the sky shader paints its horizon, so the two agree.
    HORIZON.copyFrom(look.haze).scaleInPlace(1.1 + look.daylight * 0.55);
    const moved = !Number.isFinite(this.lastDistance) || Math.abs(distance - this.lastDistance) >= 0.12;
    for (let layer = 0; layer < this.ridges.length; layer++) {
      const ridge = this.ridges[layer];
      /*
       * Mixed from the sky's own horizon rather than from a brightness of their
       * own, which is what keeps them nested inside it: a ridge painted to an
       * independent value is either a pale band across the sky or a black one,
       * and the game has had both. The furthest is very nearly the air itself;
       * the nearest is half foliage.
       */
      const closeness = layer / (this.ridges.length - 1);
      const crown = Color3.Lerp(
        HORIZON.scale(0.92),
        look.foliage.scale(1.3),
        0.14 + closeness * 0.46,
      );
      ridge.material.setColor3('crown', crown);
      // Haze pools along the foot of a hill, which is what separates one
      // ridgeline from the one standing behind it.
      ridge.material.setColor3('foot', Color3.Lerp(crown, HORIZON, 0.62 - closeness * 0.22));
      if (!moved) continue;
      this.rebuildRidge(ridge, layer, distance);
    }
    if (moved) this.lastDistance = distance;
  }

  dispose(): void {
    this.sky.dispose();
    this.skyMaterial.dispose();
    for (const ridge of this.ridges) {
      ridge.mesh.dispose();
      ridge.material.dispose();
    }
  }

  private rebuildRidge(ridge: Ridge, layer: number, distance: number): void {
    const positions: number[] = [], indices: number[] = [], normals: number[] = [];
    for (let i = 0; i <= 120; i++) {
      const x = -180 + i * 3;
      const sample = x + distance * ridge.speed;
      const y = ridge.height
        + Math.sin(sample * 0.065 + layer * 2) * ridge.height * 0.22
        + Math.sin(sample * 0.17 + layer * 3) * ridge.height * 0.11
        + Math.sin(sample * 0.38) * ridge.height * 0.045;
      positions.push(x, -3, ridge.depth, x, y, ridge.depth);
      if (i < 120) {
        const a = i * 2;
        indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
    if (ridge.mesh.isVerticesDataPresent(VertexBuffer.PositionKind)) {
      ridge.mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
      return;
    }
    VertexData.ComputeNormals(positions, indices, normals);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = normals;
    data.applyToMesh(ridge.mesh, true);
  }
}
