/**
 * The vending machine (2.32, docs/PLAN.md §2): one in every campaign prison's canteen. What it holds, as data;
 * the rules are systems/vending.ts. Prices sit above the kiosk's (which takes till mail call) because it's there
 * and then, and what it sells is worth less than it costs: nothing to be made selling it on or giving it away.
 */
import { STEPS_PER_SECOND } from '../sim/tuning';

/** What EXT.VEND asks (b). Never renumber: logs store them. */
export const VEND = {
  /** Up to the machine, its card open; walked off or closed. */
  OPEN: 0,
  CLOSE: 1,
  /** A row paid for (c: its place in GOODS). */
  BUY: 2,
  /** What's stuck thumped. */
  THUMP: 3,
  /** A place at the end of the queue, the front of it (they won't like it). */
  WAIT: 4,
  CUT: 5,
} as const;

export interface Good {
  id: string;
  price: number;
  /** How many a row holds after the morning's refill. */
  stock: number;
}

/** The machine's rows in order, three to a shelf: A1, A2, A3, B1… Append only (logs store a row's place). */
export const GOODS: readonly Good[] = [
  { id: 'chocolate', price: 10, stock: 3 },
  { id: 'soda', price: 6, stock: 4 },
  { id: 'coffee', price: 8, stock: 3 },
  { id: 'crisps', price: 5, stock: 4 },
  { id: 'toothpaste', price: 7, stock: 2 },
  { id: 'soap', price: 7, stock: 2 },
  { id: 'talcum', price: 11, stock: 1 },
];
/** A row's name on the glass: A1, A2, A3, B1… */
export const rowCode = (k: number) => `${'ABC'[Math.floor(k / 3)]}${(k % 3) + 1}`;
/** The first rows are food and drink, the rest toiletries. */
export const SNACK_ROWS = 4;
/** What inmates pick (rows, in the proportions they fancy them): chocolate and soda go first. */
export const FANCIED: readonly number[] = [0, 0, 0, 1, 1, 1, 2, 2, 3];
/** On a delivery day each row holds this many more. */
export const DELIVERY_EXTRA = 1;

/** How long a coil turns before what's bought drops (steps): the player's, an inmate's slower hand included. */
export const COIL_STEPS = 30;
export const INMATE_COIL_STEPS = 60;
/** One buy in this many jams; the run's first never does. An inmate's: a little less often. */
export const JAM_ODDS = 7;
export const INMATE_JAM_ODDS = 10;
/** A thump's worth: at most one every so many steps, how far it carries (tiles); a guard watching: the heat, once a jam. */
export const THUMP_STEPS = 12;
export const THUMP_NOISE = 5;
export const THUMP_HEAT = 3;
/** Most it takes to free what's stuck. */
export const THUMPS_MAX = 3;
/** An inmate thumping away; one time in this many it gives up, and what's stuck stays there for someone else. */
export const INMATE_THUMP_STEPS = 40;
export const GIVE_UP_ODDS = 3;

/** Inmates in the queue at most; how near (tiles, the larger way) the player has to stay to keep a place. */
export const LINE_MAX = 3;
export const VEND_LINE_REACH = 4;
/** Coming up to it, inmates this close to the machine (tiles) count as there first. */
export const THERE_FIRST = 4;
/** The player's turn with others waiting and nothing bought (steps): after that it passes. */
export const VEND_TURN_STEPS = 15 * STEPS_PER_SECOND;
/** An inmate at the head of the queue who can't get to the machine gives up after this long. */
export const HEAD_STALL_STEPS = 40 * STEPS_PER_SECOND;

/** Whether an inmate wants something in a free time (in 100), when (a few rushes, so that a queue forms), and how long it lasts it. */
export const WANT_ODDS = 75;
export const RUSH_MINUTES: readonly number[] = [12, 55, 130];
export const RUSH_SPREAD = 8;
export const SNACK_STEPS = 14 * STEPS_PER_SECOND;
