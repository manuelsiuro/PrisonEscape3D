/**
 * Every gameplay number in one place. Positions are integers: a tile is UNIT units wide,
 * so the simulation never depends on float rounding.
 */
export const STEPS_PER_SECOND = 20;
/** 1 real second = 1 game minute (GDD §2). */
export const STEPS_PER_MINUTE = 20;
/** Day 1 starts at Morning Roll Call, 08:00. */
export const START_MINUTE = 8 * 60;

export const UNIT = 1024;
/** Half the player's footprint (a square 0.6 tile wide). */
export const BODY_HALF = 300;
/** Walking speed, units per step (about 3.6 tiles a second). */
export const WALK_SPEED = 184;
/** How far a blocked step may slide the player sideways to round a door frame. */
export const CORNER_ASSIST = 96;
