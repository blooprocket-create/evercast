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

/**
 * The first time the mage falls, and only the first.
 *
 * Death is the loop boundary in this game - push until you fail, farm, push
 * again - so a full screen every time would be the wrong shape entirely. It is
 * the *first* one that has to be explained: a bright button nobody mentioned
 * appears, a pill starts saying `FARMING n`, and before this nothing said why.
 * Every later defeat is a toast.
 *
 * Stored for the reason the premise is: it is progress, not preference. It
 * survives a Rebirth, travels with an export, and comes back when a save is
 * erased.
 */
export const FIRST_DEFEAT_FLAG = 'first_defeat_seen';
