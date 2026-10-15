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
/** Knocked out for 30 s (docs/PLAN.md §2): the player, then carried off; inmates and guards, then up again (GDD §10.2). */
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
/** A toilet takes this many loads of dirt an hour, then stays clogged for an hour (GDD §9.2). */
export const TOILET_LOADS = 3;
export const TOILET_CLOG_STEPS = 60 * STEPS_PER_MINUTE;
/** Energy (0–100): back to full after a night's sleep, a little back every couple of minutes, more from meals, showers and chocolate. */
export const ENERGY_REGEN_STEPS = 2 * STEPS_PER_MINUTE;
/** A meal (GDD §2): seated at a canteen table during breakfast or dinner, the tray takes this long to eat, then +35, once a meal. */
export const MEAL_ENERGY = 35;
export const MEAL_STEPS = 3 * STEPS_PER_SECOND;
/** Standing under a shower in the showers block (GDD §3.1): a point every 10 steps (2 a second). */
export const SHOWER_ENERGY_STEPS = 10;
/** Sitting (a chair, a bench, a canteen seat) or lying on an infirmary bed: a point every 13 steps (about 1.5 a second, GDD §3.1). */
export const SIT_ENERGY_STEPS = 13;
export const CHOCOLATE_ENERGY = 25;
/** Crawling in the vents and stooping in tunnels are slower than walking (units per step). */
export const CRAWL_SPEED = 110;
export const TUNNEL_SPEED = 150;
/** A guard who saw a strike this recently (steps) saw the player at it. */
export const STRIKE_SEEN_STEPS = 10;
/** A lockdown with the player off the ground floor this long: the guards call off the hunt (damage found is put right, the heat stays). */
export const HIDING_STEPS = 60 * STEPS_PER_MINUTE;

// ---------------------------------------------------------------- combat (P5, GDD §3.1, §10)
/** Attributes run 20–100 and start at 40 (GDD §3.2; training arrives in P6). */
export const START_STR = 40;
export const START_SPD = 40;
/** Guards are tougher than the average inmate; inmates vary (STR 30–60). */
export const GUARD_STR = 60;
export const INMATE_STR_MIN = 30;
export const INMATE_STR_SPAN = 31;
/** A melee blow reaches this far (units, centre to centre); the razor whip further (its def says). */
export const MELEE_REACH = Math.round(1.3 * UNIT);
/** Molten chocolate is thrown this far (GDD §10.1: 3 tiles). */
export const THROW_RANGE = 3 * UNIT;
/** Lock-on picks someone this close (and in sight); the lock holds out to the second range. */
export const LOCK_RANGE = 5 * UNIT;
export const LOCK_KEEP = 7 * UNIT;
/** Steps between a guard's baton blows, and between an angry inmate's punches. */
export const GUARD_SWING_STEPS = 16;
export const INMATE_SWING_STEPS = 18;
/** An inmate the player hits fights back this long (steps), unless it loses them first. */
export const ANGRY_STEPS = 20 * STEPS_PER_SECOND;
/** Health comes back a point a game minute (two asleep). */
export const HEALTH_REGEN_STEPS = STEPS_PER_MINUTE;
/** A tunnel roof coming down on the player (GDD §9.2). */
export const CAVE_IN_DAMAGE = 40;
/** A landmine underfoot (GDD §4.4): 100 HP, out cold unless Strength has raised the most health past it. */
export const MINE_DAMAGE = 100;
/** Rubbing a comb or toothbrush on a wall this many times sharpens it into a shiv. */
export const SHARPEN_STROKES = 4;

// ---------------------------------------------------------------- economy, training, social (P6, GDD §3.2, §10.3–10.4, §11)
/** Walking speed grows with Speed (GDD §3.2): 184 at the starting 40, 220 at 100 (a chasing guard runs 196). */
export const walkSpeed = (spd: number) => 160 + Math.floor((spd * 3) / 5);
/** Attributes run 20–100; training adds 2 a set (GDD §3.2). Decay takes a point a day off an untrained one, never below the start. */
export const ATTR_MIN = 20;
export const ATTR_MAX = 100;
export const ATTR_START = 40;
export const TRAIN_GAIN = 2;
/** A set: the bar fills by alternate presses, drains while idle; full, it costs this much energy (GDD: 12% gym, 10% library). */
export const REP_GAIN = 6;
export const REP_DRAIN_STEPS = 2;
export const GYM_ENERGY = 12;
export const STUDY_ENERGY = 10;
/** Below this much energy: no tools, no training (GDD §3.1). */
export const TIRED = 10;
/** Talking to an inmate: within this reach (units, either axis), nothing between. */
export const TALK_REACH = Math.round(1.4 * UNIT);
/** Opinion (GDD §10.3): 0–100 from 50; at or under LOW an inmate may jump the player at meals and showers; from HIGH it joins them. */
export const OPINION_START = 50;
export const OPINION_LOW = 25;
/** A hostile prison (San Pancho, P11): what inmates think of the new arrival on day 1; every fourth cell's starts with a grudge. */
export const HOSTILE_OPINION = 40;
export const HOSTILE_GRUDGE = 20;
/** A score settled: an inmate who put the player down gets over its grudge (its opinion back up to this). */
export const GRUDGE_SETTLED = 35;
export const OPINION_HIGH = 80;
/** An inmate tells the player a recipe (once a day) from this opinion up (P8+, PLAN §2). */
export const TIP_OPINION = 60;
/** Studying tells the player a recipe each time Intellect passes a multiple of this. */
export const STUDY_TIP_EVERY = 5;
export const FAVOR_OPINION = 15;
export const HIT_OPINION = 8;
export const KO_OPINION = 15;
export const BUY_OPINION = 2;
/** A grudge: each step in the same canteen or shower block, nearby, 1 chance in this many of an ambush. */
export const AMBUSH_ODDS = 400;
export const AMBUSH_RANGE = 4 * UNIT;
/** At most 2 followers (GDD §10.3); they keep this far behind, and go for whoever comes for the player within this range. */
export const MAX_FOLLOWERS = 2;
export const FOLLOW_GAP = Math.round(1.6 * UNIT);
export const GUARD_RANGE = 6 * UNIT;
/** Favors pay $20–50 (GDD §10.4); at most this many on offer at once, and under way. */
export const FAVOR_OFFERS = 3;
export const FAVORS_TAKEN = 3;
/** A job left open is filled by an inmate this many mornings after it opened (the player has until then to apply). */
export const VACANCY_DAYS = 2;
/** Merchants: up to 50% off at full opinion (GDD §10.3); they won't deal with someone they despise. */
export const MAX_DISCOUNT = 0.5;
/** Seen hitting back at an inmate who jumped the player: this much heat a blow (attacking first: 100%). */
export const SELF_DEFENSE_HEAT = 10;

// Security and escapes (GDD §5.4–5.6, §12).
/** The generator switched off (GDD §5.5): 45 s until the maintenance guard has it back on. */
export const POWER_OFF_STEPS = 45 * STEPS_PER_SECOND;
/** Walking through a live detector arch with unshielded contraband (GDD §5.4). */
export const DETECTOR_HEAT = 50;
/** Tape or toothpaste over a camera's lens blinds it this long (GDD §5.6). */
export const CAMERA_BLIND_STEPS = 60 * STEPS_PER_SECOND;
/** How far a camera sees (units), and how often it turns a sixteenth of a turn on its ±45° sweep. */
export const CAMERA_RANGE = 6 * UNIT;
export const CAMERA_TURN_STEPS = 40;
/** Reach to tape a camera: standing under it or beside it (units). */
export const CAMERA_REACH = Math.round(1.5 * UNIT);
/** Searchlights at night (GDD §5.2): +35% heat a second in the beam (this much every 4 steps), its radius and speed. */
export const SEARCHLIGHT_HEAT = 7;
export const BEAM_RADIUS = 2 * UNIT;
export const BEAM_SPEED = 90;
/** Snipers by day (GDD §5.6): their reach from the towers, the aim before the warning shot, the pace and the damage of the rest. */
export const SNIPER_RANGE = 26 * UNIT;
export const SNIPER_AIM = 2 * STEPS_PER_SECOND;
export const SNIPER_PACE = 3 * STEPS_PER_SECOND;
export const SNIPER_DAMAGE = 30;
/** The takeover (GDD §12): this share of the guards out cold at once opens the gates (L1: all 5). */
export const TAKEOVER_SHARE = 0.85;
/** How far beyond a roof's edge a grapnel can hook the perimeter fence (tiles). */
export const GRAPNEL_REACH = 6;

/** The cold (GDD §4.2): a minute out in the snow without a warm outfit chills; indoors it wears off four times as fast. */
export const COLD_STEPS = 60 * STEPS_PER_SECOND;
export const WARM_RATE = 4;
