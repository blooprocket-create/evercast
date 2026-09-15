import {
  Color3,
  Mesh,
  PBRMaterial,
  Scene,
  ShaderMaterial,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core';
import { type AtmosphereState, breatheOn } from '../render/Atmosphere';
import { terrainHeight, terrainNoise } from './WorldTerrain';

/**
 * The land past the last chunk, and the mist lying on it.
 *
 * The chunks are a twelve-unit strip each, and they have to be: they carry the
 * road, the banks, the props and the ground cover, all of which are authored
 * against a scrolling window. But a camera frustum *widens* with depth. At the
 * fight the shot is about twenty-two units across; forty units down the road it
 * is over fifty, and at the treeline it is wider still. So however many chunks
 * are kept alive, the ground they cover runs out inside the frame long before
 * the frame does - and the far corners of the picture show the world simply
 * ending on a diagonal, with sky where the grass should be.
 *
 * Widening the chunks is the wrong fix twice over: it multiplies the geometry
 * that carries the detail nobody can see at that range, and it does not scale -
 * a wider window needs wider chunks again. So the far ground stops being made
 * of chunks at all. This is one mesh, four hundred vertices, drawn once, that
 * reaches further than any frame can and is *continuous with* the chunk terrain
 * where the two meet, because both read their height from `terrainHeight`.
 *
 * It also gets to do something the chunks cannot: relief. Past the treeline the
 * land rolls, because a horizon that is flat is a horizon that reads as a
 * backdrop - and rolling it costs two sine waves on four hundred vertices
 * rather than per-chunk geometry that would then have to tile.
 */

/**
 * Where the far ground begins, and where the chunks stop.
 *
 * They overlap by design: the horizon starts *under* the last few rows of chunk
 * terrain and sits `SINKAGE` below it, so the chunks win wherever they exist
 * and the horizon shows through only where they have run out. Matching the two
 * exactly is what makes that invisible, and it is why both read the same
 * height function rather than each approximating the other.
 */
export const HORIZON_FROM_Z = 13;
/** How far the chunk terrain now bothers to reach. */
export const CHUNK_FAR_Z = 19;
const SINKAGE = 0.05;

/** Where the land starts rolling, and how hard. Zero at the seam, by design. */
const RELIEF_FROM_Z = 26;
const RELIEF_TO_Z = 70;

/**
 * Dense across the middle, where the seam with the chunk terrain has to hold,
 * and coarse out at the edges, where a column is forty units from its
 * neighbour and thirty degrees off-axis.
 */
const COLUMNS: readonly number[] = (() => {
  const near: number[] = [];
  for (let x = -26; x <= 26; x += 2) near.push(x);
  const far = [32, 40, 50, 64, 82, 106, 138, 180];
  return [...far.map((x) => -x).reverse(), ...near, ...far];
})();

/** Rows out to a hundred and thirty units, which is past anything the camera can reach. */
const ROWS: readonly number[] = [HORIZON_FROM_Z, 16, 20, 25, 32, 41, 53, 70, 95, 130];

/** How far the world walks before the far ground is rebuilt. */
const REBUILD_STEP = 0.35;

/**
 * Mist, at three depths.
 *
 * Camera-facing rather than lying flat, which is the usual cheat and the right
 * one here: the shot looks down the road from fifteen degrees up, so a
 * horizontal sheet of fog would be seen almost edge-on and read as a line. A
 * standing band with its density falling off upward reads as mist pooling in
 * the hollow - and it is the single cheapest thing that puts air between the
 * treeline and the hills behind it.
 */
const MIST_BANDS: readonly { z: number; height: number; speed: number; density: number }[] = [
  { z: 21, height: 3.4, speed: 0.055, density: 0.5 },
  { z: 34, height: 5, speed: 0.032, density: 0.62 },
  { z: 52, height: 7, speed: 0.019, density: 0.5 },
];

const MIST_VERTEX = `precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
varying vec3 vWorld;
void main(){
  vUV = uv;
  vWorld = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

const MIST_FRAGMENT = `precision highp float;
varying vec2 vUV;
varying vec3 vWorld;
uniform vec3 tint;
uniform float density;
uniform float drift;
uniform float sunward;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float valueNoise(vec2 p){
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
    mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), f.x),
    f.y);
}

void main(){
  // Dense along the ground and gone by the top of the band, with the last
  // tenth feathered so the band has no edge of its own.
  float lift = 1.0 - vUV.y;
  float body = pow(clamp(lift, 0.0, 1.0), 1.6) * smoothstep(0.0, 0.12, vUV.y);

  // Two scrolling octaves at different rates: one alone is a moving texture,
  // two is fog thickening and thinning in place.
  vec2 p = vec2(vWorld.x * 0.055 + drift, vUV.y * 1.7);
  float wisps = valueNoise(p) * 0.6 + valueNoise(p * 2.3 + 17.0) * 0.4;
  float alpha = body * density * smoothstep(0.25, 0.85, wisps);

  // Mist is bright looking down-sun and almost nothing looking away from it.
  gl_FragColor = vec4(tint * (0.85 + sunward * 0.5), clamp(alpha, 0.0, 1.0));
}`;

export class WorldHorizon {
  private readonly land: Mesh;
  private readonly landMaterial: PBRMaterial;
  private readonly mist: { mesh: Mesh; material: ShaderMaterial; band: (typeof MIST_BANDS)[number] }[] = [];
  private builtAt = Number.NaN;

  constructor(scene: Scene, atmosphere: AtmosphereState, bands: number) {
    this.landMaterial = new PBRMaterial('far land', scene);
    this.landMaterial.metallic = 0;
    this.landMaterial.roughness = 1;
    this.landMaterial.specularIntensity = 0;
    this.landMaterial.metallicF0Factor = 0;
    this.landMaterial.environmentIntensity = 0;
    // Less than the chunks take: at forty units the fine octaves are below a
    // pixel, and all that is left of them is noise in the literal sense.
    breatheOn(this.landMaterial, atmosphere, { ground: 0.6 });

    this.land = new Mesh('far land', scene);
    this.land.material = this.landMaterial;
    this.land.isPickable = false;
    // It is most of the frame at its widest and always in view; testing that
    // every frame is work with one possible answer.
    this.land.alwaysSelectAsActiveMesh = true;
    this.rebuild(0);

    for (const band of MIST_BANDS.slice(0, Math.max(0, bands))) {
      const material = new ShaderMaterial(
        `ground mist-${band.z}`,
        scene,
        { vertexSource: MIST_VERTEX, fragmentSource: MIST_FRAGMENT },
        {
          attributes: ['position', 'uv'],
          uniforms: ['worldViewProjection', 'tint', 'density', 'drift', 'sunward'],
          needAlphaBlending: true,
        },
      );
      material.backFaceCulling = false;
      // Mist in front of mist should thicken, not replace: without this the
      // nearest band punches its own silhouette through the two behind it.
      material.disableDepthWrite = true;
      const mesh = buildMistBand(scene, band);
      mesh.material = material;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      // After the opaque world, before the VFX, sorted far to near by depth.
      mesh.renderingGroupId = 0;
      this.mist.push({ mesh, material, band });
    }
  }

  /**
   * `distance` is how far the world has walked, which is what the chunks are
   * offset by - so the far ground reads its height at the same world x they do
   * and the seam holds however far the road has come.
   */
  update(distance: number, ground: Color3, haze: Color3, sunward: number, seconds: number): void {
    this.landMaterial.albedoColor.copyFrom(ground);
    if (!Number.isFinite(this.builtAt) || Math.abs(distance - this.builtAt) >= REBUILD_STEP) {
      this.rebuild(distance);
    }
    for (const { material, band } of this.mist) {
      material.setColor3('tint', haze);
      material.setFloat('density', band.density);
      material.setFloat('drift', seconds * band.speed + distance * band.speed * 0.4);
      material.setFloat('sunward', sunward);
    }
  }

  dispose(): void {
    this.land.dispose();
    this.landMaterial.dispose();
    for (const { mesh, material } of this.mist) {
      mesh.dispose();
      material.dispose();
    }
    this.mist.length = 0;
  }

  private rebuild(distance: number): void {
    this.builtAt = distance;
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];

    for (let row = 0; row < ROWS.length; row++) {
      const z = ROWS[row];
      // Rolling land, ramped in past the treeline so the seam with the chunk
      // terrain is exactly the chunk terrain.
      const relief = smoothstep((z - RELIEF_FROM_Z) / (RELIEF_TO_Z - RELIEF_FROM_Z));
      for (let column = 0; column < COLUMNS.length; column++) {
        const x = COLUMNS[column];
        const worldX = x + distance;
        const rolling =
          (Math.sin(worldX * 0.021 + z * 0.013) * 2.6 + Math.sin(worldX * 0.047 - z * 0.03) * 1.1) *
          relief;
        positions.push(x, terrainHeight(worldX, z) - SINKAGE + rolling, z);
        if (row < ROWS.length - 1 && column < COLUMNS.length - 1) {
          const a = row * COLUMNS.length + column;
          const b = a + COLUMNS.length;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }

    if (this.land.isVerticesDataPresent(VertexBuffer.PositionKind)) {
      this.land.updateVerticesData(VertexBuffer.PositionKind, positions);
      // Normals move with the relief; without this the far hills light as if
      // they were still flat, which is exactly how a painted backdrop looks.
      const existing = this.land.getVerticesData(VertexBuffer.NormalKind)!;
      VertexData.ComputeNormals(positions, indices, existing as unknown as number[]);
      this.land.updateVerticesData(VertexBuffer.NormalKind, existing);
      return;
    }
    VertexData.ComputeNormals(positions, indices, normals);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = normals;
    data.applyToMesh(this.land, true);
  }
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** A standing band of mist: wide, low, and tessellated only enough to fog. */
function buildMistBand(scene: Scene, band: (typeof MIST_BANDS)[number]): Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const columns = 24;
  const base = terrainNoise(band.z, 0) * 0.2;
  for (let i = 0; i <= columns; i++) {
    const x = -180 + (360 * i) / columns;
    positions.push(x, base - 0.5, band.z, x, base + band.height, band.z);
    uvs.push(i / columns, 0, i / columns, 1);
    if (i < columns) {
      const a = i * 2;
      indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.uvs = uvs;
  data.normals = normals;
  const mesh = new Mesh(`ground mist-${band.z}`, scene);
  data.applyToMesh(mesh);
  return mesh;
}
