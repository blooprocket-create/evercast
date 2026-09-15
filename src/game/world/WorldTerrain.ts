import { Color3, Mesh, PBRMaterial, Scene, VertexData } from '@babylonjs/core';
import { type AtmosphereState, breatheOn } from '../render/Atmosphere';

export const TERRAIN_CHUNK_SIZE = 12;
export type TerrainPalette = { ground: Color3; road: Color3 };

export function terrainNoise(x: number, z: number): number {
  return Math.sin(x * 0.39 + Math.sin(z * 0.51)) * 0.48
    + Math.sin(x * 0.87 - z * 0.73) * 0.29 + Math.sin(x * 1.93 + z * 1.37) * 0.13;
}

/** A continuous world-space surface, with a flat, unobstructed combat corridor. */
export function terrainHeight(x: number, z: number): number {
  const bank = Math.max(0, Math.abs(z) - 1.35);
  const rise = Math.min(1, bank / 2.8);
  return rise * (0.17 + terrainNoise(x, z) * 0.17)
    + Math.max(0, z - 7) * 0.028 - Math.max(0, -z - 5) * 0.035;
}

export function roadCenter(x: number): number { return Math.sin(x * 0.13) * 0.12; }
export function roadWidth(x: number): number { return 1.02 + Math.sin(x * 0.72) * 0.075 + Math.sin(x * 1.63) * 0.03; }

function surfaceMaterial(name: string, scene: Scene): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = Color3.White();
  material.metallic = 0;
  material.roughness = 1;
  material.specularIntensity = 0;
  material.metallicF0Factor = 0;
  return material;
}

export function createTerrainChunk(
  index: number,
  scene: Scene,
  paletteAt: (x: number) => TerrainPalette,
  material: PBRMaterial,
  roadMaterial: PBRMaterial,
): Mesh[] {
  const center = index * TERRAIN_CHUNK_SIZE;
  const zRows = [-24, -20, -16, -12, -10, -8, -6, -5, -4, -3, -2, -1.35, 0, 1.35,
    2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 21, 24, 28, 33, 39, 47, 56];
  const build = (road: boolean): Mesh => {
    const positions: number[] = [], indices: number[] = [], colors: number[] = [], normals: number[] = [];
    const steps = 24;
    const rows = road ? [-1, -0.78, -0.36, 0, 0.36, 0.78, 1] : zRows;
    const vertex = (x: number, row: number): [number, number, number] => {
      const worldX = center + x;
      const z = road ? roadCenter(worldX) + row * roadWidth(worldX) : row;
      return [x, road ? 0.021 : terrainHeight(worldX, z) - 0.005, z];
    };
    for (let i = 0; i < steps; i++) {
      const x0 = -6 + i * 0.5, x1 = x0 + 0.5;
      for (let row = 0; row < rows.length - 1; row++) {
        const points = [vertex(x0, rows[row]), vertex(x1, rows[row]), vertex(x1, rows[row + 1]), vertex(x0, rows[row + 1])];
        for (const triangle of [[0, 1, 2], [0, 2, 3]]) {
          const cx = center + (points[triangle[0]][0] + points[triangle[1]][0] + points[triangle[2]][0]) / 3;
          const cz = (points[triangle[0]][2] + points[triangle[1]][2] + points[triangle[2]][2]) / 3;
          const palette = paletteAt(cx);
          const noise = terrainNoise(cx * 1.7, cz * 2.1);
          const edge = Math.abs(cz - roadCenter(cx));
          const track = road ? 1 - 0.08 * Math.exp(-Math.pow((edge - 0.42) * 6, 2)) : 1;
          const base = road ? palette.road : palette.ground;
          const tint = base.scale((1 + noise * (road ? 0.075 : 0.045)) * track);
          for (const p of triangle) {
            indices.push(positions.length / 3);
            positions.push(...points[p]);
            colors.push(tint.r, tint.g, tint.b, 1);
          }
        }
      }
    }
    VertexData.ComputeNormals(positions, indices, normals);
    const data = new VertexData();data.positions = positions;data.indices = indices;data.colors = colors;data.normals = normals;
    const mesh = new Mesh(`${road ? 'trail' : 'terrain'}-${index}`, scene);
    data.applyToMesh(mesh);mesh.material = road ? roadMaterial : material;
    mesh.receiveShadows = true;mesh.isPickable = false;
    return mesh;
  };
  return [build(false), build(true)];
}

export function createTerrainMaterials(scene: Scene, atmosphere?: AtmosphereState): [PBRMaterial, PBRMaterial] {
  const materials: [PBRMaterial, PBRMaterial] = [
    surfaceMaterial('matte meadow floor', scene),
    surfaceMaterial('worn earth trail', scene),
  ];
  // The ground is most of the picture, and it is the surface that runs from
  // under the mage's feet to the horizon - so it is the one that has to carry
  // the haze, or the road simply stops at the edge of the last chunk.
  if (atmosphere) for (const material of materials) breatheOn(material, atmosphere);
  return materials;
}
