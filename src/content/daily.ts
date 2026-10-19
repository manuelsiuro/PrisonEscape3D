/**
 * The Daily Escape (P26): one challenge a day, the same for everyone, worked out from the
 * day's number alone (`dailyOf`, pure): a prison, a seed and one to three twists. The week has
 * a rhythm: a gentle Monday at the first prisons, harder days towards the weekend, a Saturday
 * at the toughest; each day has a difficulty budget the twists spend (a help gives some back).
 * Any prison may come up (the Daily opens after a first escape anywhere), and at least one way
 * out is always left open (twists.ts `breaks`).
 */
import { PRISONS, escapesOf } from './prisons';
import type { PrisonDef } from './prisons/types';
import { TWIST_IDS, TWISTS, type TwistId } from './twists';
import { roll, SALT } from '../sim/rng';

/** Daily #1: Monday 19 October 2026 (the day it came out). */
const EPOCH = Date.UTC(2026, 9, 19);
const DAY_MS = 86_400_000;

/** The Daily on a date (the player's own calendar day): 0 for the first. */
export function dailyNumber(d: Date): number {
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / DAY_MS);
}

/** The calendar day a Daily is for (noon UTC that day: the same date in every time zone's display). */
export const dailyDate = (n: number): Date => new Date(EPOCH + n * DAY_MS + DAY_MS / 2);

/** Each weekday's Daily, Monday first: how many twists, the prisons' security levels, and the twists' budget. */
export const RHYTHM: ReadonlyArray<{ twists: number; levels: readonly [number, number]; budget: number }> = [
  { twists: 1, levels: [1, 2], budget: 2 },
  { twists: 2, levels: [1, 3], budget: 3 },
  { twists: 2, levels: [2, 4], budget: 3 },
  { twists: 2, levels: [1, 3], budget: 4 },
  { twists: 2, levels: [2, 5], budget: 4 },
  { twists: 3, levels: [3, 5], budget: 5 },
  { twists: 3, levels: [1, 5], budget: 5 },
];

export interface Daily {
  /** Its number (0 for the first; shown as #n + 1). */
  n: number;
  /** 0 Monday … 6 Sunday. */
  weekday: number;
  prison: PrisonDef;
  seed: number;
  /** In TWIST_IDS order. */
  twists: TwistId[];
}

/** The prison a Daily draws, before it's made to differ from the day before's. */
function drawPrison(n: number): PrisonDef {
  const [lo, hi] = RHYTHM[weekdayOf(n)].levels;
  const open = PRISONS.filter((p) => p.difficulty >= lo && p.difficulty <= hi);
  return open[roll(0, SALT.DAILY, n, 0) % open.length];
}

const weekdayOf = (n: number) => ((n % 7) + 7) % 7;

/** Where the days are worked out from (each from the one before), and those worked out so far. */
const FIRST = -7;
const prisons: PrisonDef[] = [];

/** The prison of Daily `n`: its draw, or the next one up its weekday's list when that's where yesterday's was. */
function prisonOf(n: number): PrisonDef {
  if (n <= FIRST) return drawPrison(n);
  for (let m = FIRST + 1 + prisons.length; m <= n; m++) {
    const before = m - 1 === FIRST ? drawPrison(FIRST) : prisons[m - 1 - FIRST - 1];
    let p = drawPrison(m);
    if (p === before) {
      const [lo, hi] = RHYTHM[weekdayOf(m)].levels;
      const open = PRISONS.filter((q) => q.difficulty >= lo && q.difficulty <= hi);
      p = open[(open.indexOf(p) + 1) % open.length];
    }
    prisons.push(p);
  }
  return prisons[n - FIRST - 1];
}

/** The Daily number `n`: pure (everyone gets the same), never the same prison two days running. */
export function dailyOf(n: number): Daily {
  const weekday = weekdayOf(n);
  const rhythm = RHYTHM[weekday];
  const prison = prisonOf(n);
  // The toughest prisons leave less of the budget to the twists.
  const budget = rhythm.budget - (prison.difficulty >= 4 ? 1 : 0);
  const routes = escapesOf(prison);
  const fits = TWISTS.filter((t) => !t.at || t.at(prison));
  let best: TwistId[] = [];
  // Shuffled afresh until a hand fits (a few tries are plenty; the first that deals them all wins).
  for (let attempt = 0; attempt < 32 && best.length < rhythm.twists; attempt++) {
    const deck = fits.map((t, k) => ({ t, r: roll(0, SALT.DAILY, n, 1 + attempt * 64 + k) })).sort((a, b) => a.r - b.r || TWIST_IDS.indexOf(a.t.id) - TWIST_IDS.indexOf(b.t.id));
    const hand: TwistId[] = [];
    let spent = 0;
    for (const { t } of deck) {
      if (hand.length === rhythm.twists) break;
      if (spent + t.cost > budget) continue;
      if (hand.some((h) => t.not?.includes(h) || TWISTS.find((x) => x.id === h)!.not?.includes(t.id))) continue;
      const closed = new Set([...hand, t.id].flatMap((id) => TWISTS.find((x) => x.id === id)!.breaks ?? []));
      if (routes.every((r) => closed.has(r))) continue;
      // (A help only on a day that's had some twist dealt first: never a Daily that's only a gift.)
      if (t.cost < 0 && hand.length === 0) continue;
      hand.push(t.id);
      spent += t.cost;
    }
    if (hand.length > best.length) best = hand;
  }
  const twists = best.sort((a, b) => TWIST_IDS.indexOf(a) - TWIST_IDS.indexOf(b));
  return { n, weekday, prison, seed: (roll(0, SALT.DAILY, n, 4096) >>> 1) || 1, twists };
}
