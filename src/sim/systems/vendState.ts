/**
 * The vending machine's state (2.32): a leaf, so that the state's own file can start one. Plain data; the rules
 * are vending.ts.
 */
import { GOODS } from '../../content/vending';
import type { SimContext } from '../context';

/** Nobody at it (`who`); the player. Otherwise an inmate's index. */
export const VEND_NOBODY = -2;
export const VEND_PLAYER = -1;

export interface VendState {
  /** The prison day its rows were last filled (0: not yet), and how many each has left. */
  day: number;
  left: number[];
  /** What's stuck in it: its row + 1 (0 nothing), the thumps it still takes, a guard's told the player off for it. */
  jam: number;
  hits: number;
  told: boolean;
  /** The queue, first at the machine: inmates' indices, and VEND_PLAYER. */
  line: number[];
  /** Who has it now, the row turning for them, the step it drops (or their thumping ends); thumping away rather than buying. */
  who: number;
  row: number;
  until: number;
  thumping: boolean;
  /** The step of the player's last thump; the step their turn began (0: not their turn); the step the head of the queue became it. */
  hit: number;
  turn: number;
  head: number;
  /** Who wants something today, by the block (a mask of inmates joined): 0 and 1 as the free times come. */
  asked: number[];
  /** The player's been up to it since their turn began (walking off then ends it). */
  up: boolean;
}

export const newVend = (): VendState => ({ day: 0, left: GOODS.map((g) => g.stock), jam: 0, hits: 0, told: false, line: [], who: VEND_NOBODY, row: 0, until: 0, thumping: false, hit: 0, turn: 0, head: 0, asked: [0, 0], up: false });

/** Off the card and out of the queue (walked away, asked to, or hit). */
export function closeCard(sim: Pick<SimContext, 'state' | 'events'>, left = false) {
  const s = sim.state;
  const v = s.vend;
  const had = s.vendOpen || v.line.includes(VEND_PLAYER);
  s.vendOpen = false;
  v.line = v.line.filter((k) => k !== VEND_PLAYER);
  v.turn = 0;
  v.up = false;
  if (had) sim.events.push({ type: 'vend', what: left ? 'left' : 'closed' });
}

/** The machine as a save holds it. */
export function vendOk(o: VendState | undefined, inmates: number): boolean {
  if (!o || typeof o !== 'object') return false;
  const ints = [o.day, o.jam, o.hits, o.row, o.until, o.hit, o.turn, o.head, o.who];
  const whoOk = (k: number) => k === VEND_PLAYER || (k >= 0 && k < inmates);
  return (
    ints.every((x) => Number.isInteger(x)) &&
    Array.isArray(o.left) &&
    o.left.length === GOODS.length &&
    o.left.every((x) => Number.isInteger(x) && x >= 0) &&
    o.jam >= 0 &&
    o.jam <= GOODS.length &&
    o.row >= 0 &&
    o.row < GOODS.length &&
    (o.who === VEND_NOBODY || whoOk(o.who)) &&
    Array.isArray(o.line) &&
    o.line.every(whoOk) &&
    Array.isArray(o.asked) &&
    o.asked.length === 2 &&
    o.asked.every((x) => Number.isInteger(x)) &&
    typeof o.told === 'boolean' &&
    typeof o.up === 'boolean' &&
    typeof o.thumping === 'boolean'
  );
}
