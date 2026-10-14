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

/** Guard heat is a whole percent; out of sight it cools 1% every 4 game minutes (GDD §3.1). */
export const HEAT_DECAY_STEPS = 4 * STEPS_PER_MINUTE;
/** Missing a meal, exercise or showers (GDD §2.2). */
export const MISSED_ROUTINE_HEAT = 25;
/**
 * Until guards arrive (P3), a lockdown ends after the player has spent this long locked in
 * their cell, and leaves this much heat. Guards replace it with capture and solitary.
 */
export const LOCKDOWN_STEPS = 60 * STEPS_PER_MINUTE;
export const LOCKDOWN_END_HEAT = 75;

/** Inmates stroll a little slower than the player can walk (units per step). */
export const INMATE_SPEED = 150;
/** After a bell, inmates set off within this many steps (not all at once). */
export const INMATE_REACTION = 6 * STEPS_PER_SECOND;
