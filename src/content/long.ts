/**
 * Long games (P28, docs/PLAN.md §9): pruno brewed over two prison days, a garden bed grown over
 * three, and a pet rat trained for the race nights. The makings are taken on request (pantry.ts),
 * never stocked: nothing here changes what the furniture holds or draws on the state's RNG.
 */
import { STEPS_PER_MINUTE } from '../sim/tuning';

/** What the player can take on request (EXT.TAKE's b): fruit off a canteen counter at a meal, sugar from a kitchen freezer, a seed packet off a library shelf. Never renumber: logs store them. */
export const TAKE = { FRUIT: 0, SUGAR: 1, VEG_SEEDS: 2, FRUIT_SEEDS: 3 } as const;
/** The item each TAKE gives, and the table of the open furniture it's taken from. */
export const PANTRY_GOODS: ReadonlyArray<readonly [item: string, table: string]> = [
  ['fruit', 'canteenCounter'],
  ['sugar', 'kitchenFreezer'],
  ['veg_seeds', 'libraryShelf'],
  ['fruit_seeds', 'libraryShelf'],
];
/** What every merchant sells besides its stock (TALK.BUY, b = SHOP_SLOTS + its place here), and what it buys (TALK.SELL) at its value. */
export const STAPLES: readonly string[] = ['sugar', 'veg_seeds', 'fruit_seeds'];
export const WANTED: readonly string[] = ['pruno', 'vegetable'];
/** What a merchant pays for what it buys (percent of its value), and how many things the player can sell in a prison day (all merchants together). */
export const SALE_SHARE = 75;
export const SALES_A_DAY = 4;

/** Pruno: a bag ferments this many prison days in a desk or a toilet's tank (its uses, counted down at 08:00). */
export const BREW_DAYS = 2;
/** Drunk: tipsy for 3 prison hours. Blows hit TIPSY_BLOW / 2 as hard; walking at TIPSY_PACE / 100 of the pace. */
export const TIPSY_STEPS = 3 * 60 * STEPS_PER_MINUTE;
export const TIPSY_BLOW = 3;
export const TIPSY_PACE = 80;
/** Walking tipsy, a stumble every STUMBLE_STEPS steps on the move: heard STUMBLE_NOISE tiles away. */
export const STUMBLE_STEPS = 6 * 20;
export const STUMBLE_NOISE = 3;
/** A guard who catches sight of the player tipsy: this much heat (once a sighting). */
export const TIPSY_HEAT = 20;

/** The garden: a bed grows a stage a prison day it was watered; ripe at GROWN stages. A day dry wilts it, DRY_DEATH in a row kill it. */
export const GROWN = 3;
export const DRY_DEATH = 2;
/** Waterings a bed takes in a day (a heatwave's day needs HEATWAVE_WATER of them). */
export const WATER_MAX = 2;
export const HEATWAVE_WATER = 2;
/** What a ripe bed gives. */
export const HARVEST = 2;
/** What a bed holds (its crop): nothing, vegetables, fruit. Never renumber: saves store them. */
export const CROP = { NONE: 0, VEG: 1, FRUIT: 2 } as const;

/** The rat: its speed when tamed, and what a session on the track adds (TRACK_GAIN + what's left to 100 / TRACK_SLOW). */
export const RAT_START_SPEED = 20;
export const TRACK_GAIN = 3;
export const TRACK_SLOW = 10;
/** A session on the track lasts this long (steps: the 3D shows the rat's laps). */
export const TRACK_STEPS = 8 * 20;

/** Race nights: odd prison days, at RACE_MINUTE (21:00); the card is up from CARD_MINUTE (20:00); bets at most BET_RANGE tiles from the track. */
export const RACE_MINUTE = 21 * 60;
export const CARD_MINUTE = 20 * 60;
export const BET_RANGE = 3;
/** The inmates' rats: this many a night, each with a speed of RIVAL_SPEED + up to RIVAL_SPREAD, fed RIVAL_FED times in 100. */
export const RIVALS = 3;
export const RIVAL_SPEED = 30;
export const RIVAL_SPREAD = 50;
export const RIVAL_FED = 65;
/** The stakes ($). */
export const BETS: readonly number[] = [5, 10, 20];
/**
 * The bookie's odds, in tenths (25: a winning bet pays back ×2.5, stake included): each rat's chance
 * worked out over ODDS_SAMPLES races run in his head, from the speeds alone (whether each ate he
 * can't know: as most nights, RIVAL_FED), paid at ODDS_MARGIN% of fair, rounded down to a half,
 * between ODDS_MIN and ODDS_MAX.
 */
export const ODDS_SAMPLES = 400;
export const ODDS_MARGIN = 85;
export const ODDS_MIN = 12;
export const ODDS_MAX = 200;
/** The race: LEGS legs, each a rat running its speed, FED_BONUS more fed, and up to LUCK more by roll(). */
export const LEGS = 10;
export const FED_BONUS = 40;
export const LUCK = 200;
/** How long the race takes to watch (steps), and the purse when the player's rat wins. */
export const RACE_STEPS = 12 * 20;
export const PURSE = 10;
/** The race's cheering, heard this far (tiles); a guard who sees the player at it with a bet on gives this much heat (as dice). */
export const RACE_NOISE = 6;
/** The rats' names (i18n `ratName.<n>`): an inmate's rat is named by its cell. */
export const RAT_NAMES = 12;
