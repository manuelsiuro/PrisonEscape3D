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
/** Strokes of the peeler count at most this often (mashing faster gains nothing): 5 a second. */
export const PEEL_STEPS = 4;
export const POTATO_STEPS = 10 * STEPS_PER_MINUTE;

/** Inmates stroll a little slower than the player can walk (units per step). */
export const INMATE_SPEED = 150;
/** After a bell, inmates set off within this many steps (not all at once). */
export const INMATE_REACTION = 6 * STEPS_PER_SECOND;

// ---------------------------------------------------------------- layers and destruction (P4, GDD §9)
/** A tool strike at most this often (a swing takes a moment; holding the button repeats it). */
export const STRIKE_STEPS = 9;
/** Hit points: brick walls and chain-link fences 100, electric fences 120, vent grates 60 (GDD §9.1). */
export const WALL_HP = 100;
export const FENCE_HP = 100;
export const ELECTRIC_HP = 120;
export const GRATE_HP = 60;
/** Digging a tunnel entrance through the floor, a tile of earth below, back up to the surface. */
export const FLOOR_HP = 40;
export const SOIL_HP = 30;
/** More than this many tunnel tiles in a row without a brace cave in (GDD §9.2). */
export const UNBRACED_RUN = 2;
/** What a cave-in costs until health arrives (P5): energy, knocked out of the player. */
export const CAVE_IN_ENERGY = 40;
/** A toilet takes this many loads of dirt an hour, then stays clogged for an hour (GDD §9.2). */
export const TOILET_LOADS = 3;
export const TOILET_CLOG_STEPS = 60 * STEPS_PER_MINUTE;
/** Energy (0–100): back to full after a night's sleep, a little back every couple of minutes, more from meals, showers and chocolate. */
export const ENERGY_REGEN_STEPS = 2 * STEPS_PER_MINUTE;
export const MEAL_ENERGY = 35;
export const SHOWER_ENERGY = 20;
export const CHOCOLATE_ENERGY = 25;
/** Crawling in the vents and stooping in tunnels are slower than walking (units per step). */
export const CRAWL_SPEED = 110;
export const TUNNEL_SPEED = 150;
/** A guard who saw a strike this recently (steps) saw the player at it. */
export const STRIKE_SEEN_STEPS = 10;
