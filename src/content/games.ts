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

// ------------------------------------------------------------------ P27 Card sharks

/**
 * Cheat (P27): the deck (CARDS: a King, a Queen, an Ace, and the Joker, wild), how many of each
 * (14: six of them true whatever the table card, so a big claim can be shown false), the hand dealt, the chips each starts with (the last one lost loses the stake), the most cards
 * one play may claim. Stakes as dice's (STAKES), and it counts as one of the day's games.
 */
export const CARD = { KING: 1, QUEEN: 2, ACE: 3, JOKER: 4 } as const;
export const DECK: readonly number[] = [4, 4, 4, 2];
export const HAND = 5;
export const CHIPS = 2;
export const CLAIM_MAX = 3;
/** How long the inmate takes over its turn, and how long a call's cards stay face up before the next deal (steps). */
export const THINK_STEPS = 30;
export const REVEAL_STEPS = 80;
/**
 * Its tell (by cell): shown on a lie with these odds out of 100 (plus the player's Intellect / 4,
 * at most TELL_MAX), and on the truth with FALSE_TELL: Intellect reads people, never for certain.
 */
export const TELL_BASE = 30;
export const TELL_MAX = 80;
export const FALSE_TELL = 20;
export const TELLS = ['ear', 'glance', 'drum', 'whistle'] as const;
export type Tell = (typeof TELLS)[number];
/**
 * The inmate calls "Liar!" on a claim it can't prove false with odds (out of 100) of CALL_DOUBT
 * per cent of its doubt past CALL_FLOOR (its doubt: 100 less the claim's odds as it sees them),
 * CALL_STUCK more with no true card of its own to lay, CALL_PRESS more with the player down to two
 * cards or fewer (a hand played out is a chip lost), at most CALL_MAX. (Measured in cardstest:
 * a player who never calls wins about 47%, one who reads the tells 53–61%, one who calls every
 * play 6%, one who bluffs every play 24%.)
 */
export const CALL_DOUBT = 60;
export const CALL_FLOOR = 20;
export const CALL_STUCK = 10;
export const CALL_PRESS = 30;
export const CALL_MAX = 85;

/**
 * Hoops (P27): a shootout from the court's 5 spots, turn about (the most baskets; level, sudden
 * death from the first spot again, then a draw), or shots on one's own. A shot is held (the power
 * marker sweeps 0 → 1000 → 0) and let go: judged at that step or the one before, against the power
 * the spot needs (more further out; a tailwind needs less), in a window as wide as WINDOW_BASE +
 * Speed / 2, narrower further out and in the rain.
 */
export const SHOOT_SPOTS = 5;
export const SUDDEN_DEATH = 3;
export const POWER_SPEED = 42;
/** A shot held this long goes up anyway (steps). */
export const HOLD_MAX = 120;
/** The power a shot needs: NEED_BASE + NEED_PER_TILE a tile from the rim; the wind moves it NEED_WIND a point of strength. */
export const NEED_BASE = 250;
export const NEED_PER_TILE = 150;
export const NEED_WIND = 40;
/** The window's half-width: WINDOW_BASE + Speed / 2, less WINDOW_PER_TILE a tile past 2, less WINDOW_RAIN in the rain (never under WINDOW_MIN); a rim-out RIM_OUT past it. */
export const WINDOW_BASE = 70;
export const WINDOW_PER_TILE = 15;
export const WINDOW_RAIN = 20;
export const WINDOW_MIN = 25;
export const RIM_OUT = 70;
/** The inmate shoots this long after the player (steps), making it with its skill (out of 100: SKILL_BASE + up to SKILL_SPREAD, less SKILL_PER_TILE a tile past 2). */
export const INMATE_SHOT = 40;
export const SKILL_BASE = 35;
export const SKILL_SPREAD = 30;
export const SKILL_PER_TILE = 8;
/** The court: a shootout starts with both this close to the rim (tiles), and is off if the player goes this far. */
export const COURT_RANGE = 7;
export const COURT_LEAVE = 10;
/** The partner keeps this far from the player meanwhile (units). */
export const HOOPS_GAP = 1800;
/** The rim's clang as a ball comes off it (heard this far, tiles). */
export const RIM_NOISE = 3;
/** Shots on one's own: this many baskets in a prison day are worth a point of Speed, once a day. */
export const PRACTICE_MAKES = 5;

/**
 * Checkers with the old-timer (P27): English draughts on the 32 dark squares, the player's men
 * from the bottom (20–31), his from the top (0–11), the player first; captures forced, men
 * crowned on the far row (the move ends there). No stakes, no heat: he plays anyone who thinks
 * ELDER_OPINION of him, in the games' hours, and the board stays set up between times.
 */
export const ELDER_OPINION = 20;
/** He looks ahead this many plies, by the games the player has won off him (the last for every game after). */
export const ELDER_DEPTH: readonly number[] = [2, 3, 4, 5, 6];
/** And at first he slips now and then (a move at random, out of 100), by the same count. */
export const ELDER_SLIP: readonly number[] = [30, 15, 5, 0, 0];
/** He thinks this long over a move (steps: 1–3 s, drawn per move). */
export const ELDER_THINK = 20;
export const ELDER_THINK_MORE = 40;
/** A game is drawn after this many plies with no capture and no man crowned. */
export const DRAW_PLIES = 60;
/** A win: he thinks this much more of the player; any game finished, this much. */
export const ELDER_WIN_OPINION = 4;
