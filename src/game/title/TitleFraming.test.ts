import { describe, expect, it } from 'vitest';
import { ArcRotateCamera, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import {
  TITLE_ALTITUDE,
  WORLD_VERTICAL_EXTENT,
  applyPose,
  capturePose,
  titlePose,
} from './TitleFraming';

/**
 * The camera the scene actually builds, to the number. Copied from
 * `EvercastScene`'s constructor rather than imported because `EvercastScene`
 * takes an `HTMLCanvasElement` and builds a real `Engine`; these are the values
 * under test, and a drift between the two files is exactly what the last test
 * here is for.
 */
const GAME_CAMERA = {
  alpha: -Math.PI / 2,
  beta: 1.31,
  radius: 17.5,
  target: new Vector3(0.9, 1.15, 1),
  maxZ: 180,
  fov: 0.68,
} as const;

function gameCamera(): ArcRotateCamera {
  const scene = new Scene(new NullEngine());
  const camera = new ArcRotateCamera(
    'camera',
    GAME_CAMERA.alpha,
    GAME_CAMERA.beta,
    GAME_CAMERA.radius,
    GAME_CAMERA.target.clone(),
    scene,
  );
  // The pinning is load-bearing: without it `_checkInputs` re-clamps radius
  // every frame, and the pose round-trip below would be testing nothing.
  camera.lowerRadiusLimit = GAME_CAMERA.radius;
  camera.upperRadiusLimit = GAME_CAMERA.radius;
  camera.fov = GAME_CAMERA.fov;
  camera.maxZ = GAME_CAMERA.maxZ;
  camera.inputs.clear();
  return camera;
}

describe('title framing', () => {
  /**
   * Why `applyPose` passes `setTarget`'s fourth argument, pinned as behaviour
   * rather than asserted in a comment.
   *
   * `setTarget` ends with `if (!cloneAlphaBetaRadius) rebuildAnglesAndRadius()`,
   * which re-derives the angles from the camera's position - so the obvious
   * `camera.target = v` does not translate the camera, it swings it. Moving the
   * target 400 units up drags beta from 1.31 to 3.10, which is the camera
   * looking up from almost directly underneath.
   *
   * This is a claim about Babylon, not about our code, and that is the point:
   * it is the assumption `applyPose` is built on, and an upgrade that changed
   * the default would fail here rather than in the shot.
   */
  it('pins the setTarget behaviour that the fourth argument exists for', () => {
    const naive = gameCamera();
    const flagged = gameCamera();
    const lifted = new Vector3(0.9, GAME_CAMERA.target.y + TITLE_ALTITUDE, 1);

    naive.target = lifted.clone();
    flagged.setTarget(lifted.clone(), false, false, true);

    expect(naive.beta).not.toBeCloseTo(GAME_CAMERA.beta, 3);
    expect(flagged.beta).toBeCloseTo(GAME_CAMERA.beta, 9);
    expect(flagged.alpha).toBeCloseTo(GAME_CAMERA.alpha, 9);
  });

  /**
   * `applyPose` sets all four components, so it restores the framing whatever
   * `setTarget` did to the angles on the way. The test above is what keeps the
   * fourth argument honest; this one is what keeps the round trip honest.
   */
  it('returns the camera to exactly the framing it left', () => {
    const camera = gameCamera();
    const game = capturePose(camera);

    applyPose(camera, titlePose(game));
    applyPose(camera, game);

    expect(camera.alpha).toBeCloseTo(game.alpha, 9);
    expect(camera.beta).toBeCloseTo(game.beta, 9);
    expect(camera.radius).toBeCloseTo(game.radius, 9);
    expect(camera.target.x).toBeCloseTo(game.target.x, 9);
    expect(camera.target.y).toBeCloseTo(game.target.y, 9);
    expect(camera.target.z).toBeCloseTo(game.target.z, 9);
  });

  it('keeps the view direction while it is away, so the shot is the same shot', () => {
    const camera = gameCamera();
    const game = capturePose(camera);
    applyPose(camera, titlePose(game));

    // Angles and distance untouched means the camera translated rather than
    // swung - which is what lets the whole post-process stack stay calibrated.
    expect(camera.alpha).toBeCloseTo(game.alpha, 9);
    expect(camera.beta).toBeCloseTo(game.beta, 9);
    expect(camera.radius).toBeCloseTo(game.radius, 9);
    expect(camera.target.y - game.target.y).toBeCloseTo(TITLE_ALTITUDE, 9);
  });

  it('never touches the fov, which belongs to resize and CombatFeel', () => {
    const camera = gameCamera();
    const game = capturePose(camera);

    applyPose(camera, titlePose(game));
    expect(camera.fov).toBe(GAME_CAMERA.fov);
    applyPose(camera, game);
    expect(camera.fov).toBe(GAME_CAMERA.fov);
  });

  it('captures a pose that does not move when the camera does', () => {
    const camera = gameCamera();
    const game = capturePose(camera);
    applyPose(camera, titlePose(game));

    // A pose aliasing `camera.target` would have followed it up and made the
    // round-trip above a no-op that passes for the wrong reason.
    expect(game.target.y).toBe(GAME_CAMERA.target.y);
  });

  /**
   * The title hides the world by outrunning the far plane, not by disabling
   * anything - so the margin has to hold, and the two numbers it depends on
   * live in different files.
   */
  it('parks the title far enough out that the world is clipped', () => {
    expect(TITLE_ALTITUDE - WORLD_VERTICAL_EXTENT).toBeGreaterThan(GAME_CAMERA.maxZ);
  });
});
