/**
 * Penalties (2.44, in the place of the yard's football match): a shootout with an inmate at the
 * pitch's goal (PrisonDef.leisure.pitch: the goal at its far end, the spot before it), and kicks on
 * one's own at the empty net. The player's kick is one press: a marker sweeps across the goal and
 * the ball goes where it stood. Keeping goal, one press dives (left, right) or stays. Nothing here
 * draws on the state's RNG: the escape bots' runs stay as they were (the inmates' kicks and dives
 * are roll()s).
 */
import { STEPS_PER_SECOND, UNIT } from '../sim/tuning';

// ------------------------------------------------------------------ the goal and the spot

/** The spot: this far out from the goal line (units: three tiles). */
export const SPOT_OUT = 3 * UNIT;
/** At the spot: within this of it (units, either way). */
export const SPOT_NEAR = 360;
/** The goal's mouth, post to post (units either side of its middle: the nets' two tiles). */
export const MOUTH_HALF = UNIT;
/** The ball's radius (units: drawn at it). */
export const PEN_BALL_R = 160;

// ------------------------------------------------------------------ the aim

/**
 * Where a kick goes across the goal, -AIM_POST (the left post, as the kicker sees it) to AIM_POST
 * (the right); past AIM_WIDE it misses wide; between the post and AIM_WIDE it strikes the post.
 * The marker sweeps from -AIM_SWEEP to AIM_SWEEP and back, a little past the posts each way.
 */
export const AIM_POST = 1000;
export const AIM_WIDE = 1060;
export const AIM_SWEEP = 1180;
/** The marker's pace (aim units a step): AIM_PACE at Speed 0, AIM_PACE_SLOW less at Speed 100 (more time to pick). */
export const AIM_PACE = 96;
export const AIM_PACE_SLOW = 30;
/** The marker starts at a place by roll() (not always the same corner), and only after this many steps (the kicker set). */
export const AIM_SETTLE = 8;

// ------------------------------------------------------------------ the keeper

/** A keeper who stays saves a kick within STAY_REACH of the middle. */
export const STAY_REACH = 320;
/** A keeper who dives saves a kick on his side from DIVE_IN out to his reach (units of aim). */
export const DIVE_IN = 220;
/** An inmate keeper's reach: KEEPER_BASE + up to KEEPER_SPREAD by roll(), drawn for the run by his cell. */
export const KEEPER_BASE = 760;
export const KEEPER_SPREAD = 120;
/** The player's reach in goal: KEEP_BASE + their Speed × KEEP_PER_SPEED / 100. */
export const KEEP_BASE = 740;
export const KEEP_PER_SPEED = 160;
/** An inmate keeper's dive (out of 100): stays STAY_ODDS, else left or right alike. */
export const STAY_ODDS = 30;

// ------------------------------------------------------------------ the inmate's kick

/**
 * The inmate's kick (out of 100, by roll()): MISS_BASE + up to MISS_SPREAD of them miss (the post
 * or wide), CORNER of them go in a corner past most reaches, CENTRE straight down the middle, the
 * rest to a side. Aimed at a side, he looks at it first LOOK_TRUE times in 100 (else the other way).
 */
export const MISS_BASE = 6;
export const MISS_SPREAD = 10;
export const CORNER = 22;
export const CENTRE = 18;
export const LOOK_TRUE = 70;
/**
 * His run-up: RUN_UP steps from the whistle to the kick; he looks at a corner from LOOK_AT steps
 * in. A dive more than DIVE_EARLY steps before the kick shows him which way: he puts it the other way.
 */
export const RUN_UP = 36;
export const LOOK_AT = 6;
export const DIVE_EARLY = 14;

// ------------------------------------------------------------------ the shootout

/** Five kicks each, then a pair at a time once level: SUDDEN pairs at most, then a draw. */
export const PEN_KICKS = 5;
export const SUDDEN = 5;
/** A kick in the air, from the spot to the line (steps), then the result shown (steps) before the next. */
export const FLIGHT = 10;
export const AFTER_KICK = 2 * STEPS_PER_SECOND;
/** Walked to their places by the shootout (the kicker to the spot, the keeper to the line): set, or this long at most. */
export const PLACES_STEPS = 6 * STEPS_PER_SECOND;
/** The player's kick: it goes where the marker is once this long has passed with no press (steps). */
export const KICK_CLOCK = 8 * STEPS_PER_SECOND;
/** Who and where: the player and the inmate within PEN_RANGE tiles of the pitch to start; it ends past PEN_LEAVE (an inmate wandered off). */
export const PEN_RANGE = 3;
export const PEN_LEAVE = 10;
/** A kick's thud, heard this many tiles away; the post's clang, as far. */
export const KICK_NOISE = 3;

/** Won: the loser's opinion (a game each time, GAMES_A_DAY at most with him), the crowd's (each once a day); played, his. A point of Speed for a win. */
export const PEN_WIN_OPINION = 6;
export const PEN_CROWD_OPINION = 2;
export const PEN_PLAY_OPINION = 2;

/** On one's own: this many goals in a corner in a day are worth a point of Speed. */
export const CORNERS_A_DAY = 5;

// ------------------------------------------------------------------ the cover

/** Guards watching a shootout: those outdoors within this many tiles of the pitch. Anything off the pitch they see at half their range. */
export const YARD_EYES = 16;
/** A goal turns the watching guards' heads to the net this long (steps). */
export const GOAL_LOOK = 3 * STEPS_PER_SECOND;
