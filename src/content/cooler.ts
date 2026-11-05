/**
 * The canteen's water cooler (2.33, docs/PLAN.md §2): a paper cup of water. As data; the rules are systems/cooler.ts.
 * A cup gives a little energy, once in a while, and on a heatwave's day cools the player down at once, as a shower
 * does. Inmates stop at it in the free times for a drink and a word: standing by while two are at it, the player
 * overhears something true (talk/director.ts).
 */
import { STEPS_PER_MINUTE, STEPS_PER_SECOND } from '../sim/tuning';

/** What EXT.COOLER asks (b). Never renumber: logs store them. */
export const COOLER = {
  /** A cup drunk. */
  DRINK: 0,
} as const;

/** A cup's worth of energy; how long before another does anything (sooner: not thirsty). */
export const CUP_ENERGY = 5;
export const THIRST_STEPS = 30 * STEPS_PER_MINUTE;
/** The cup at the lips (the pose): the player's, an inmate's. */
export const SIP_STEPS = 2 * STEPS_PER_SECOND;

/** Inmates come for a drink from this prison day: the first plays as it always did (the escape bots' day). */
export const COOLER_FROM_DAY = 2;
/** Whether an inmate wants a drink in a free time (in 100), when (a few rushes, so that two meet at it), how long it stays there. */
export const DRINK_ODDS = 70;
export const DRINK_RUSH: readonly number[] = [5, 35, 80];
export const DRINK_SPREAD = 2;
export const INMATE_DRINK_STEPS = 22 * STEPS_PER_SECOND;
/** An inmate that can't get to its place by the cooler gives up after this long. */
export const DRINK_STALL_STEPS = 30 * STEPS_PER_SECOND;
