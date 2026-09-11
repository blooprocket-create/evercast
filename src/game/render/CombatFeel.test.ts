import { describe, expect, it } from 'vitest';
import { ArcRotateCamera, DefaultRenderingPipeline, ImageProcessingConfiguration, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { CombatFeel } from './CombatFeel';
import type { GameEvent } from '../../engine/events/GameEvent';

const BASE_FOV = 0.68;

function harness() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('c', -Math.PI / 2, 1.31, 17.5, Vector3.Zero(), scene);
  camera.fov = BASE_FOV;
  const pipeline = new DefaultRenderingPipeline('p', true, scene, [camera]);
  const feel = new CombatFeel({
    camera,
    pipeline,
    imageProcessing: scene.imageProcessingConfiguration,
  });
  const dispose = () => {
    feel.dispose();
    pipeline.dispose();
    scene.dispose();
    engine.dispose();
  };
  return { feel, camera, dispose };
}

/** Enough of a wallop to put real shake in flight. */
const bossKill: GameEvent[] = [
  { type: 'enemy_killed', time: 1, stage: 10, instanceId: 1, enemyId: 'road_warden', gold: '100' },
];

describe('camera framing across a resize', () => {
  it('rests at whatever base it was last given', () => {
    const { feel, camera, dispose } = harness();
    feel.setBaseFov(1.03);
    feel.update(0.016);
    expect(camera.fov).toBeCloseTo(1.03, 6);
    dispose();
  });

  it('does not bake an in-flight shake into the base', () => {
    /*
     * The bug this exists for. Shake used to be applied by adding last frame's
     * offset back and subtracting this frame's, which assumed nothing else
     * ever wrote camera.fov. Resize does. Rotating a phone mid-fight set a new
     * fov while an offset was still in flight, the next frame added that
     * offset to a base it had never been taken from, and the base stayed
     * drifted - so landscape was wrong and portrait was wrong ever after.
     */
    const { feel, camera, dispose } = harness();
    feel.ingest(bossKill, () => true);
    feel.update(0.016);
    expect(camera.fov).toBeLessThan(BASE_FOV); // shake is in flight

    // Rotate: a new framing arrives mid-shake, several times over as a real
    // phone reports transitional sizes.
    feel.setBaseFov(1.03);
    feel.setBaseFov(0.9);
    feel.setBaseFov(1.03);

    // Let the shake decay all the way out.
    for (let step = 0; step < 400; step += 1) feel.update(0.016);
    expect(camera.fov).toBeCloseTo(1.03, 6);
    dispose();
  });

  it('comes back to the same portrait framing it started with', () => {
    const { feel, camera, dispose } = harness();
    const portrait = 1.03;
    feel.setBaseFov(portrait);
    for (let step = 0; step < 30; step += 1) feel.update(0.016);
    const before = camera.fov;

    // Rotate to landscape and back, with a fight going on throughout.
    for (let round = 0; round < 5; round += 1) {
      feel.ingest(bossKill, () => true);
      feel.update(0.016);
      feel.setBaseFov(0.68);
      feel.update(0.016);
      feel.setBaseFov(portrait);
      feel.update(0.016);
    }
    for (let step = 0; step < 400; step += 1) feel.update(0.016);

    expect(camera.fov).toBeCloseTo(before, 6);
    dispose();
  });

  it('leaves the camera at its base when disposed mid-shake', () => {
    const { feel, camera, dispose } = harness();
    feel.setBaseFov(0.9);
    feel.ingest(bossKill, () => true);
    feel.update(0.016);
    feel.dispose();
    expect(camera.fov).toBeCloseTo(0.9, 6);
    expect(camera.targetScreenOffset.x).toBe(0);
    dispose();
  });
});
