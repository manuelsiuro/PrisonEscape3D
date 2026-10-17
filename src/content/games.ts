/**
 * Side games (P22): dice and arm-wrestling with the inmates, and the lockpick on a keyed door.
 * The numbers they play by; how they play out is src/sim/systems/games.ts.
 */

/** Who'll play the player at anything: an inmate who thinks this well of them, this many games a day each. */
export const GAME_OPINION = 40;
export const GAMES_A_DAY = 3;
/** When the yard's games are on: free time, morning and evening, and the exercise hour (not in a lockdown). */
export const GAME_BLOCKS: readonly string[] = ['freeTime', 'exercise', 'eveningFreeTime'];
/** A game played, won or lost, brings two people closer (opinion points). */
export const PLAY_OPINION = 2;

/** Dice: the stakes on offer (dollars; TALK.DICE's b is the place in this list). */
export const STAKES: readonly number[] = [5, 10, 20];
/** Seen gambling by a guard as the dice go down: this much heat. */
export const DICE_HEAT = 10;

/** Arm-wrestling: the bar runs 0 (the inmate's win) to BAR (the player's), from the middle. */
export const BAR = 1000;
/** A press (left and right in turn) pushes the bar this much plus the player's Strength / 4. */
export const PUSH_BASE = 20;
/** The inmate pushes back every step: (its Strength + this) / 10, half as much again in a surge. */
export const DRAIN_BASE = 30;
/** A bout lasts at most this long (steps: 30 s), then it's a draw. */
export const BOUT_STEPS = 600;
/** Each second, the odds (out of 100) the inmate surges for its first half. */
export const SURGE_ODDS = 30;
/** A bout costs this much energy (too tired, no bout). */
export const BOUT_ENERGY = 6;
/** A win: the loser thinks this much more of the player (a good loser), everyone watching this much (each once a day), and a point of Strength. */
export const WIN_OPINION = 6;
export const CROWD_OPINION = 2;
/** Who watches a bout: inmates this close (tiles) who can see it. */
export const CROWD_RANGE = 6;

/** Sports day (a day card): this many arm-wrestling wins in the day earn the prize, and everyone's respect. */
export const SPORTS_WINS = 3;
export const SPORTS_PRIZE = 30;
export const SPORTS_OPINION = 3;

/** The lockpick: pins to set by door colour (tiles.ts KEY order: none, yellow, cyan, purple, red, green). */
export const PINS: readonly number[] = [0, 2, 3, 4, 5, 6];
/** The marker sweeps 0 → 1000 → 0, this far a step (a sweep each way in 2 s). */
export const PICK_SPEED = 25;
/** The sweet spot's width: this plus the player's Intellect (out of 1000). */
export const PICK_ZONE = 120;
/** A pin set clicks (heard this far, tiles); a slip scrapes, louder, and wears the pick. */
export const PICK_HIT_NOISE = 2;
export const PICK_MISS_NOISE = 6;
/** A door picked stays open for the player this long (steps: 15 s), or until they've gone through. */
export const PICKED_STEPS = 300;
