import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NullEngine, Scene } from '@babylonjs/core';
import { COMPANIONS } from '../../content/companions';
import { COMPANION_MODELS } from '../../engine/companions/types';
import { buildCompanion } from './CompanionModels';
import { CompanionVisual } from './CompanionVisual';

let engine: NullEngine;
let scene: Scene;
const built: CompanionVisual[] = [];

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  for (const visual of built.splice(0)) visual.dispose();
  scene.dispose();
  engine.dispose();
});

function make(modelKey = 'humanoid_heavy' as const, stars = 3): CompanionVisual {
  const visual = new CompanionVisual(scene, `test-${modelKey}`, modelKey, 'vanguard', 'legendary', stars);
  built.push(visual);
  return visual;
}

describe('procedural companion art', () => {
  it('builds every silhouette the catalog asks for', () => {
    for (const modelKey of COMPANION_MODELS) {
      const build = buildCompanion(scene, `probe-${modelKey}`, modelKey, 'vanguard', 'epic', 1);
      expect(build.meshes.length, modelKey).toBeGreaterThan(2);
      expect(
        build.meshes.reduce((total, mesh) => total + mesh.getTotalVertices(), 0),
        modelKey,
      ).toBeGreaterThan(50);
      // Something has to move, or the idle is a statue.
      expect(build.limbs.length, modelKey).toBeGreaterThan(0);
      for (const mesh of build.meshes) mesh.dispose();
      for (const material of build.materials) material.dispose();
      build.root.dispose();
    }
  });

  it('covers every companion in the roster', () => {
    for (const companion of COMPANIONS) {
      expect(COMPANION_MODELS, companion.id).toContain(companion.modelKey);
    }
  });

  it('shows star level on the field, not only in the roster', () => {
    const one = buildCompanion(scene, 'one-star', 'humanoid_heavy', 'vanguard', 'common', 1);
    const five = buildCompanion(scene, 'five-star', 'humanoid_heavy', 'vanguard', 'common', 5);
    expect(five.meshes.length - one.meshes.length).toBe(4);
    for (const build of [one, five]) {
      for (const mesh of build.meshes) mesh.dispose();
      build.root.dispose();
    }
  });

  it('gives each companion its own materials, so a tint never leaks', () => {
    const first = buildCompanion(scene, 'a', 'humanoid_robed', 'support', 'common', 1);
    const second = buildCompanion(scene, 'b', 'humanoid_robed', 'support', 'mythical', 1);
    expect(first.materials[0]).not.toBe(second.materials[0]);
    expect(first.materials[1]?.albedoColor.equals(second.materials[1]!.albedoColor)).toBe(false);
    for (const build of [first, second]) {
      for (const mesh of build.meshes) mesh.dispose();
      for (const material of build.materials) material.dispose();
      build.root.dispose();
    }
  });
});

describe('companion animation', () => {
  it('breathes without being told to', () => {
    const visual = make();
    visual.update(0.016);
    const first = visual.root.position.y;
    for (let step = 0; step < 30; step += 1) visual.update(0.05);
    expect(visual.root.position.y).not.toBe(first);
  });

  it('offsets its idle so a row does not breathe in unison', () => {
    const left = new CompanionVisual(scene, 'left', 'humanoid_light', 'ranger', 'rare', 1, 0);
    const right = new CompanionVisual(scene, 'right', 'humanoid_light', 'ranger', 'rare', 1, 1.7);
    built.push(left, right);
    left.update(0.4);
    right.update(0.4);
    expect(left.root.position.y).not.toBe(right.root.position.y);
  });

  it('returns to rest after a swing', () => {
    const visual = make();
    visual.update(0.016);
    const rest = visual.root.rotation.z;
    visual.play('attack');
    visual.update(0.2);
    // Run past the clip and the limbs settle back.
    visual.update(0.5);
    expect(visual.root.rotation.z).toBe(rest);
  });

  it('folds over when it goes down, and gets back up when revived', () => {
    const visual = make();
    visual.setDowned(true);
    for (let step = 0; step < 20; step += 1) visual.update(0.05);
    const fallen = visual.root.rotation.z;
    expect(fallen).toBeGreaterThan(1);

    visual.setDowned(false);
    visual.update(0.05);
    expect(visual.root.rotation.z).toBe(0);
  });

  it('will not flinch out of a swing it is already landing', () => {
    const visual = make();
    visual.play('attack');
    visual.update(0.1);
    const mid = visual.root.position.y;
    visual.play('hit');
    visual.update(0);
    expect(visual.root.position.y).toBe(mid);
  });

  it('hovers a spirit off the ground and keeps a walker on it', () => {
    const spirit = new CompanionVisual(scene, 'spirit', 'floating_orb', 'arcanist', 'mythical', 1);
    const walker = new CompanionVisual(scene, 'walker', 'beast_quadruped', 'bruiser', 'common', 1);
    built.push(spirit, walker);
    spirit.update(0.016);
    walker.update(0.016);
    expect(spirit.root.position.y).toBeGreaterThan(walker.root.position.y + 0.1);
  });

  it('releases its meshes and materials on disposal', () => {
    const visual = make();
    const before = scene.meshes.length;
    expect(before).toBeGreaterThan(0);
    visual.dispose();
    built.pop();
    expect(scene.meshes.length).toBeLessThan(before);
  });
});
