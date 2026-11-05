/**
 * The canteen's menu board (2.33, docs/PLAN.md §2): what each meal's tray holds, a dish a meal that changes from day
 * to day, each giving its own energy (and some health). As data; the rules are systems/menu.ts. The first day serves
 * the plain tray everyone knew (+35 at each meal), so a run's opening is what it always was and the board teaches the
 * rest. A feast (P17's, a holiday's) still beats whatever was on.
 *
 * The board can also be scribbled on, once a day: the inmates who see it laugh, a guard who sees it being done says
 * something. Wiped every morning.
 */
import { STEPS_PER_SECOND } from '../sim/tuning';

/** What EXT.MENU asks (b). Never renumber: logs store them. */
export const MENU = {
  /** Up to the board, its card open; walked off or closed. */
  OPEN: 0,
  CLOSE: 1,
  /** A scribble begun on it. */
  SCRIBBLE: 2,
} as const;

/** A dish: what a tray of it gives (energy, and health back). */
export interface Dish {
  id: string;
  energy: number;
  health?: number;
}

/** What breakfast can be. The first is the plain one (day 1's). Append only: a dish's place is drawn by day. */
export const BREAKFASTS: readonly Dish[] = [
  { id: 'porridge', energy: 35 },
  { id: 'eggs', energy: 40 },
  { id: 'pancakes', energy: 45 },
  { id: 'cereal', energy: 25, health: 10 },
  { id: 'beans', energy: 30, health: 5 },
];

/** What dinner can be. The first is the plain one (day 1's). Append only. */
export const DINNERS: readonly Dish[] = [
  { id: 'stew', energy: 35 },
  { id: 'meatloaf', energy: 45 },
  { id: 'fish', energy: 30, health: 10 },
  { id: 'soup', energy: 20, health: 25 },
  { id: 'pasta', energy: 40 },
  { id: 'mystery', energy: 15 },
];

/** Each prison's own dinner, served as often as any other (the Training Block has none). */
export const HOUSE_DINNER: Readonly<Record<string, Dish>> = {
  'center-perks': { id: 'burger', energy: 45 },
  'stalag-flucht': { id: 'sausage', energy: 40, health: 5 },
  shankton: { id: 'meatballs', energy: 40, health: 5 },
  'san-pancho': { id: 'tacos', energy: 40, health: 5 },
  irongate: { id: 'pie', energy: 40, health: 5 },
};

/** A feast's dish on the board, by what feast it is (the day's event, or the holiday's). */
export const FEASTS = ['roast', 'lamb', 'barbecue', 'christmas'] as const;
export type Feast = (typeof FEASTS)[number];

/** Breakfast or dinner. */
export const MEAL = { BREAKFAST: 0, DINNER: 1 } as const;

/** A scribble takes this long, standing at the board; a guard who sees it done: this much heat (never into a chase). */
export const SCRIBBLE_STEPS = 2 * STEPS_PER_SECOND;
export const SCRIBBLE_HEAT = 10;
/** The scribbles there are (a joke each, its place drawn by day). */
export const SCRIBBLES = 8;
/** An inmate this close to the scribbled board (tiles), in the canteen and seeing it, laughs, once a day each, and likes the player this much more (nobody knows who did it but them). */
export const SCRIBBLE_REACH = 5;
export const SCRIBBLE_OPINION = 2;
/** The board's reach: the player within a tile of it and facing the wall it hangs on. */
export const MENU_REACH_TILES = 1;
