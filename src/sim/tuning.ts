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
/** From this much heat a guard who sees the player gives chase; caught from this much, it's solitary (GDD §3.1). */
export const CHASE_HEAT = 80;
export const SOLITARY_HEAT = 90;
/** Out of the cell this long after Lights Out begins before it counts (the walk home). */
export const LIGHTS_OUT_GRACE = 15 * STEPS_PER_MINUTE;
/** A contraband tool or weapon in hand in sight: +40% a second (GDD §5.2), so +2 a step. */
export const CONTRABAND_HEAT = 2;
/** In a guard outfit, a guard this close (units) for this long recognizes the player: +50% a second after that. */
export const RECOGNIZE_RANGE = Math.round(2.5 * UNIT);
export const RECOGNIZE_STEPS = 2 * STEPS_PER_SECOND;
/** Knocked out for 30 s (docs/PLAN.md §2), then carried off. */
export const KO_STEPS = 30 * STEPS_PER_SECOND;
/** Solitary lasts 2 game hours; each peeled potato takes 10 minutes off, a potato is 5 presses (GDD §5.6). */
export const SOLITARY_STEPS = 120 * STEPS_PER_MINUTE;
export const POTATO_PRESSES = 5;
export const POTATO_STEPS = 10 * STEPS_PER_MINUTE;

/** Inmates stroll a little slower than the player can walk (units per step). */
export const INMATE_SPEED = 150;
/** After a bell, inmates set off within this many steps (not all at once). */
export const INMATE_REACTION = 6 * STEPS_PER_SECOND;
