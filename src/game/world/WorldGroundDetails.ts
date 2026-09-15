import { Color3, Mesh, PBRMaterial, Scene, StandardMaterial, VertexData } from '@babylonjs/core';
import { roadCenter, terrainHeight, type TerrainPalette } from './WorldTerrain';

const roll = (n: number): number => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

/** Small stones, leaves and grass tips are batched into one mesh per chunk. */
export function createGroundDetails(index: number, scene: Scene, material: PBRMaterial, paletteAt: (x: number) => TerrainPalette, count = 150): Mesh {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [], normals: number[] = [];
  const triangle = (points: number[][], color: Color3): void => {
    for (const p of [points[0], points[2], points[1]]) { indices.push(positions.length / 3);positions.push(...p);colors.push(color.r, color.g, color.b, 1); }
  };
  // The trail keeps its share of the scatter whatever the budget is: it is the
  // strip the fight stands on, and it is the one a thinner tier would notice.
  const onTrailCount = Math.round(count * 0.23);
  for (let i = 0; i < count; i++) {
    const seed = index * 431 + i * 17;
    const x = -6 + roll(seed) * 12, absoluteX = index * 12 + x;
    const side = roll(seed + 1) < 0.5 ? -1 : 1;
    const onTrail = i < onTrailCount;
    const z = onTrail ? roadCenter(absoluteX) + side * (0.24 + roll(seed + 2) * 0.7) : side * (1.1 + roll(seed + 2) * 4.5);
    const y = onTrail ? 0.024 : terrainHeight(absoluteX, z) + 0.002;
    const palette = paletteAt(absoluteX);
    const size = (onTrail ? 0.018 : 0.03) + roll(seed + 3) * (onTrail ? 0.043 : 0.08);
    if (onTrail || i % 5 === 0) {
      const color = Color3.Lerp(palette.road, palette.ground, 0.18).scale(0.72 + roll(seed + 5) * 0.45);
      const top = [x + size * 0.2, y + size * 0.42, z];
      const points = [[x - size, y, z], [x, y, z - size * 0.7], [x + size, y, z], [x, y, z + size * 0.7]];
      for (let k = 0; k < 4; k++) triangle([points[k], top, points[(k + 1) % 4]], color.scale(0.9 + k * 0.035));
    } else {
      const color = palette.ground.scale(0.78 + roll(seed + 5) * 0.55);
      triangle([[x - size * 0.25, y, z], [x, y + size * 2.5, z + size * 0.3], [x + size * 0.25, y, z]], color);
    }
  }
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();data.positions = positions;data.indices = indices;data.normals = normals;data.colors = colors;
  const mesh = new Mesh(`trail details-${index}`, scene);data.applyToMesh(mesh);mesh.material = material;mesh.isPickable = false;mesh.receiveShadows = true;
  return mesh;
}

/** Where one prop meets the ground: centre, and how far the smudge reaches. */
export interface ContactPatch { worldX: number; localX: number; z: number; radius: number; }

/**
 * Every prop's ground contact in a chunk, as one mesh.
 *
 * These used to be a mesh each - one draw call per tree, per rock, per
 * waystone, all of them alpha-blended and therefore all of them sorted. A
 * chunk carries a dozen or more and nothing about them ever moves relative to
 * the chunk they sit in, so there was never a reason for them to be separate;
 * merged, the whole road costs one draw call per chunk.
 */
export function createContactShadows(scene: Scene, material: StandardMaterial, patches: readonly ContactPatch[]): Mesh | null {
  if (patches.length === 0) return null;
  const positions: number[] = [], colors: number[] = [], indices: number[] = [], normals: number[] = [];
  for (const { worldX, localX, z, radius } of patches) {
    const center = positions.length / 3;
    positions.push(localX, terrainHeight(worldX, z) + 0.024, z);
    colors.push(0, 0, 0, 0.19);
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI * 2 / 16;
      const dx = Math.cos(angle) * radius, dz = Math.sin(angle) * radius * 0.62;
      positions.push(localX + dx, terrainHeight(worldX + dx, z + dz) + 0.026, z + dz);
      colors.push(0, 0, 0, 0);
      indices.push(center, center + 1 + i, center + 1 + ((i + 1) % 16));
    }
  }
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();data.positions = positions;data.indices = indices;data.colors = colors;data.normals = normals;
  const mesh = new Mesh('soft ground contact', scene);data.applyToMesh(mesh);mesh.hasVertexAlpha = true;mesh.material = material;mesh.isPickable = false;
  return mesh;
}
