/**
 * The only piece of onboarding that is stored rather than derived.
 *
 * It lives in `MetaState.storyFlags`, which the save codec has carried since
 * v8 and nothing had yet written to - so this needs no migration and no new
 * key. That placement is the decision worth defending: onboarding state is
 * progress, not preference. It survives a Rebirth, it travels with an exported
 * save, and erasing a save is what brings it back. Someone who moves to a new
 * device is not a new player, and a bit kept beside the volume sliders would
 * have told them they were.
 */
export const PREMISE_FLAG = 'premise_seen';
