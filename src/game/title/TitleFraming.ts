import type { ArcRotateCamera } from '@babylonjs/core';
import { Vector3 } from '@babylonjs/core';

/**
 * Where the camera stands for the title screen, and how it gets back.
 *
 * The title needs a clean void to hang a sigil in, and the scene has no such
 * place: `WorldGenerator`'s constructor calls `rebuildVisibleChunks()`, so
 * terrain, props and motes are all built and drawn from the first frame. Only
 * the *look* is deferred - `updateAtmosphere()` never runs until the first
 * `sync()`, which leaves fog at Babylon's default 0.1 and the sky shader's
 * uniforms unset. Hiding the world mesh by mesh was therefore never an option.
 * The camera leaves instead.
 *
 * It leaves by moving its *target*, not by being replaced. With the angles held
 * and `radius` pinned by `lowerRadiusLimit === upperRadiusLimit`, translating
 * the target translates the camera by the same vector and the view direction is
 * unchanged - so everything calibrated against the framing survives untouched:
 * bloom, depth of field, the ACES tone map, the vignette, grain, chromatic
 * aberration and the colour grade all still apply, because it is still the same
 * camera the `DefaultRenderingPipeline` was built around. A second camera would
 * have had none of them.
 */
export interface CameraPose {
  alpha: number;
  beta: number;
  radius: number;
  target: Vector3;
}

/**
 * How far above the world the title sits.
 *
 * The world is clipped rather than hidden: at this height the nearest geometry
 * is further away than `camera.maxZ`, so it falls outside the far plane and is
 * never drawn. `TitleFraming.test.ts` asserts the margin rather than trusting
 * this comment, because the two numbers live in different files.
 */
export const TITLE_ALTITUDE = 400;

/**
 * The tallest thing the world puts above the ground, generously over-estimated.
 * Only used to prove the clipping margin holds.
 */
export const WORLD_VERTICAL_EXTENT = 40;

export function capturePose(camera: ArcRotateCamera): CameraPose {
  return {
    alpha: camera.alpha,
    beta: camera.beta,
    radius: camera.radius,
    // Cloned: `camera.target` is live, and a pose that aliases it stops being a
    // record of where the camera *was* the moment anything moves it.
    target: camera.target.clone(),
  };
}

/** The same pose, lifted clear of the world. */
export function titlePose(gamePose: CameraPose): CameraPose {
  return {
    ...gamePose,
    target: gamePose.target.add(new Vector3(0, TITLE_ALTITUDE, 0)),
  };
}

/**
 * Moves the camera to a pose without disturbing its framing.
 *
 * The fourth argument is why this is a function rather than an assignment.
 * `setTarget` ends with `if (!cloneAlphaBetaRadius) { rebuildAnglesAndRadius(); }`,
 * so the obvious `camera.target = v` does not translate the camera - it swings
 * it, re-deriving the angles from its position. Lifting the target 400 units
 * drags beta from 1.31 to 3.10: the camera looking up from underneath the
 * world, with the depth of field, the portrait fov rule and CombatFeel's shake
 * all still calibrated for the shot it used to have.
 *
 * Setting all four components afterwards means this would in fact survive the
 * naive call - but relying on that would make the correctness of the title
 * depend on the order of four lines. The flag says what is meant, and
 * `TitleFraming.test.ts` pins the Babylon behaviour it depends on.
 *
 * `fov` is deliberately never written here. `resize()` owns it through
 * `CombatFeel.setBaseFov`, and a title that set it would be overwritten by the
 * next resize and would fight CombatFeel the moment the game loop started.
 */
export function applyPose(camera: ArcRotateCamera, pose: CameraPose): void {
  camera.setTarget(pose.target, false, false, true);
  camera.alpha = pose.alpha;
  camera.beta = pose.beta;
  camera.radius = pose.radius;
}
