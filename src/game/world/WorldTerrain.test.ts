import { Color3, NullEngine, Scene, VertexBuffer } from '@babylonjs/core';
import { expect, it } from 'vitest';
import { createTerrainChunk, createTerrainMaterials, terrainHeight } from './WorldTerrain';

it('keeps the combat lane level and both surfaces upward-facing with matching chunk edges', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const materials = createTerrainMaterials(scene);
  const palette = () => ({ ground: Color3.Green(), road: Color3.Gray() });
  const a = createTerrainChunk(0, scene, palette, ...materials), b = createTerrainChunk(1, scene, palette, ...materials);
  for (const mesh of [...a, ...b]) {
    const normals = mesh.getVerticesData(VertexBuffer.NormalKind)!;
    for (let i = 1; i < normals.length; i += 3) expect(normals[i]).toBeGreaterThan(0.85);
  }
  const edge = (mesh: typeof a[number], x: number) => {
    const points = mesh.getVerticesData(VertexBuffer.PositionKind)!; const values = new Set<string>();
    for (let i = 0; i < points.length; i += 3) if (points[i] === x) values.add(`${points[i + 1].toFixed(5)},${points[i + 2].toFixed(5)}`);
    return [...values].sort();
  };
  for (let i = 0; i < 2; i++) expect(edge(a[i], 6)).toEqual(edge(b[i], -6));
  for (let x = -120; x <= 360; x += 5) for (const z of [-1.2, 0, 1.2]) expect(terrainHeight(x, z)).toBe(0);
  scene.dispose(); engine.dispose();
});
