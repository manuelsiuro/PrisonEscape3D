/**
 * The menu board's and the water cooler's state (2.33): a leaf, so that the state's own file can start them. Plain
 * data; the rules are menu.ts and cooler.ts.
 */
import { SCRIBBLES } from '../../content/menu';
import type { SimContext } from '../context';

export interface MenuState {
  /** The prison day it was scribbled on (0: clean); the scribble's joke (its place in SCRIBBLES). Wiped every morning. */
  scribbled: number;
  joke: number;
  /** A scribble under way: the step it's done (0: none). */
  until: number;
  /** Those who've laughed at today's scribble (inmates' indices). */
  laughed: number[];
}

export const newMenu = (): MenuState => ({ scribbled: 0, joke: 0, until: 0, laughed: [] });

export interface CoolerState {
  /** Who stands at each place beside it (an inmate's index, -1 nobody), the step they were sent (on the way), the step they got there (0: not yet). */
  who: number[];
  sent: number[];
  there: number[];
  /** Who wants a drink today, by the block (a mask of inmates sent): 0 and 1 as the free times come; the prison day they're for. */
  asked: number[];
  day: number;
}

export const newCooler = (spots = 2): CoolerState => ({
  who: Array(spots).fill(-1),
  sent: Array(spots).fill(0),
  there: Array(spots).fill(0),
  asked: [0, 0],
  day: 0,
});

/** Off the menu's card (walked away, asked to, or hit): a scribble under way stops too. */
export function closeMenu(sim: Pick<SimContext, 'state' | 'events'>, left = false) {
  const s = sim.state;
  const had = s.menuOpen;
  s.menuOpen = false;
  if (s.menu.until) {
    s.menu.until = 0;
    sim.events.push({ type: 'menu', what: 'stopped' });
  }
  if (had) sim.events.push({ type: 'menu', what: left ? 'left' : 'closed' });
}

/** The menu as a save holds it. */
export function menuOk(o: MenuState | undefined): boolean {
  if (!o || typeof o !== 'object') return false;
  return (
    [o.scribbled, o.joke, o.until].every((x) => Number.isInteger(x) && x >= 0) &&
    o.joke < SCRIBBLES &&
    Array.isArray(o.laughed) &&
    o.laughed.every((x) => Number.isInteger(x) && x >= 0)
  );
}

/** The cooler as a save holds it. */
export function coolerOk(o: CoolerState | undefined, inmates: number, spots: number): boolean {
  if (!o || typeof o !== 'object') return false;
  const each = (a: unknown, ok: (x: number) => boolean) =>
    Array.isArray(a) && a.length === spots && a.every((x) => Number.isInteger(x) && ok(x));
  return (
    each(o.who, (k) => k >= -1 && k < inmates) &&
    each(o.sent, (x) => x >= 0) &&
    each(o.there, (x) => x >= 0) &&
    Array.isArray(o.asked) &&
    o.asked.length === 2 &&
    o.asked.every((x) => Number.isInteger(x)) &&
    Number.isInteger(o.day) &&
    o.day >= 0
  );
}
