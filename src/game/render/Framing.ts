/**
 * How the diorama is composed for the shape of the screen it is drawn on.
 *
 * The shot was composed once, for a landscape window, and then used at every
 * aspect the game runs at. On a 390x844 phone that left a ~100px band of
 * action in the middle of the viewport with the mage about 40px tall and the
 * rest of the frame empty grass and sky; on an 820x1180 tablet it was worse.
 * The one concession to portrait was a rule widening the field of view until
 * 11 world units of road were visible - which fixed what was in frame and paid
 * for it entirely in height, because on a tall screen width only comes with
 * height attached.
 *
 * So this decides three things together rather than one of them alone: how
 * wide the shot has to be, where along the road it is aimed, and how far above
 * the road it looks from. Pure, and tested, because the alternative is tuning
 * a camera by eye at four aspect ratios and hoping.
 */

/** Pinned by `lowerRadiusLimit === upperRadiusLimit` in EvercastScene. */
export const CAMERA_RADIUS = 17.5;

/**
 * The framing everything else is calibrated against: the depth-of-field
 * aperture and CombatFeel's shake were both measured at this field of view,
 * and nothing here ever goes below it - only wider, and only when a narrow
 * screen leaves no choice.
 */
export const BASE_FOV = 0.68;

/**
 * Where the wide shot is aimed, and from how far above the road.
 *
 * A landscape window shows twenty-two units of road for a fight that is under
 * nine wide, and the aim decides where in all that space the party stands.
 * Aimed at 0.9 it stood in the middle - the mage within a few percent of dead
 * centre - which is the one place a side-on shot should never put its subject,
 * and it did not even agree with itself: a phone has no spare width, so it
 * centres the fight rather than the aim, and there the mage has always sat
 * about a third in from the left.
 *
 * So the wide shot is aimed further down the road, which walks the party left
 * to the third that portrait already used, and spends the width it frees on
 * the road ahead - where the enemies come from, and where `Atmosphere` now has
 * something to say. The arrival is covered by `ActorVisual`'s veil: at this aim
 * the spawn line is just inside the frame on a wide screen, so an enemy fades
 * up out of the haze instead of appearing at the edge of it.
 */
export const BASE_TARGET_X = 3.2;
export const BASE_BETA = 1.31;

/**
 * The span of road that has to be on screen, in world units.
 *
 * Both ends are content rather than taste. `Formation.ts` puts the back row of
 * the party at x = -2.35, and `SpellCombatState.formationSlot` puts the
 * furthest enemy contact slot at x = 5.28; half a body is added at each end so
 * nobody stands with their shoulder off the frame. Everything between is the
 * fight.
 *
 * Enemies spawn at x = 13 - and a boss at 9.4 - and walk in from there. At the
 * aim above a wide screen reaches the first and is well past the second, which
 * is why the arrival is a veil rather than a hard edge: `ActorVisual` fades a
 * foe up as it comes, so nothing pops into open grass.
 */
export const FIGHT_MIN_X = -2.9;
export const FIGHT_MAX_X = 5.9;

/**
 * Where the composition stops being the authored one and starts being derived.
 *
 * Above `WIDE_ASPECT` every number below resolves to the authored shot exactly,
 * so no landscape window changes at all. `TALL_ASPECT` is a 9:16 phone, past
 * which nothing more is gained by leaning further.
 */
const WIDE_ASPECT = 1.2;
const TALL_ASPECT = 0.62;

/**
 * How far above the road the tall shot looks from.
 *
 * A near-horizontal camera turns the ground into a thin band and gives the
 * rest of a tall frame to sky - so the taller the screen, the further over the
 * shot leans, and the more of the road and the lanes it spends that height on.
 * 1.12 is about 26 degrees above the road against the authored 15, which is as
 * far as it can go before the actors start reading as seen from above rather
 * than watched from the verge.
 */
const TALL_BETA = 1.12;

export interface Framing {
  /** Vertical field of view, radians. Never below `BASE_FOV`. */
  fov: number;
  /** Where along the road the camera aims. */
  targetX: number;
  /** Polar angle from +y, radians. Smaller is higher above the road. */
  beta: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/**
 * `aspect` is width / height of the canvas.
 *
 * Guards against the zero and the NaN a canvas can report mid-rotation: a
 * single bad frame here would write a broken fov into CombatFeel's base and
 * keep it.
 */
export function framingFor(aspect: number): Framing {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : WIDE_ASPECT;
  const lean = clamp01((WIDE_ASPECT - safeAspect) / (WIDE_ASPECT - TALL_ASPECT));

  const targetX = lerp(BASE_TARGET_X, (FIGHT_MIN_X + FIGHT_MAX_X) / 2, lean);
  const beta = lerp(BASE_BETA, TALL_BETA, lean);

  // The half-width the aim actually needs, which is the longer of its two
  // reaches - aiming at the centre of the fight is what makes them equal.
  const halfWidth = Math.max(targetX - FIGHT_MIN_X, FIGHT_MAX_X - targetX);
  const needed = 2 * Math.atan(halfWidth / (CAMERA_RADIUS * safeAspect));

  return { fov: Math.max(BASE_FOV, needed), targetX, beta };
}

/** What the shot actually shows at a given aspect, for the tests to assert on. */
export function visibleSpan(framing: Framing, aspect: number): { width: number; height: number } {
  const height = 2 * CAMERA_RADIUS * Math.tan(framing.fov / 2);
  return { width: height * aspect, height };
}
