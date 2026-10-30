import { medalFor, MEDALS, type Medal } from '../content/medals';
import { fnv1a } from '../sim/rng';
import { DAY } from '../sim/systems/ledger';
import { KEYS, readJSON, writeJSON } from './storage';

/**
 * The Daily Escape's history on this device (P26): for each Daily played, how many tries and
 * the best escape (the quickest; its medal, the way out, the day strip, the check code). A
 * Daily can be finished a day late (yesterday's still counts for yesterday); the streak is
 * worked out from the history (nothing more is stored).
 */
export interface DailyBest {
  day: number;
  /** Game minutes from day 1 08:00 (the quickest wins). */
  minutes: number;
  via: string;
  medal: Medal | null;
  /** One mark per prison day (STRIP order): how it went, nothing of how it was done. */
  strip: number[];
  code: string;
  /** The try it was won on. */
  tries: number;
}

export interface DailyRecord {
  tries: number;
  best?: DailyBest;
}

/** Days kept (older ones are dropped: a streak never needs them all). */
const KEEP = 400;

type History = Record<string, DailyRecord>;

function fitBest(v: unknown): DailyBest | undefined {
  const b = v as Partial<DailyBest> | null;
  if (!b || typeof b !== 'object' || !Number.isInteger(b.day) || !Number.isInteger(b.minutes) || typeof b.via !== 'string' || typeof b.code !== 'string') return undefined;
  const strip = Array.isArray(b.strip) ? b.strip.filter((x): x is number => Number.isInteger(x) && x >= 0 && x < STRIP.length) : [];
  return { day: b.day!, minutes: b.minutes!, via: b.via, medal: b.medal && MEDALS.includes(b.medal) ? b.medal : null, strip, code: b.code, tries: Number.isInteger(b.tries) && b.tries! > 0 ? b.tries! : 1 };
}

function readDailies(): History {
  const raw = readJSON<Record<string, unknown>>(KEYS.daily, {});
  const out: History = {};
  for (const [k, v] of Object.entries(raw)) {
    const r = v as Partial<DailyRecord> | null;
    if (!/^-?\d+$/.test(k) || !r || typeof r !== 'object') continue;
    const tries = Number.isInteger(r.tries) && r.tries! >= 0 ? r.tries! : 0;
    const best = fitBest(r.best);
    out[k] = best ? { tries: Math.max(tries, best.tries), best } : { tries };
  }
  return out;
}

export const dailyRecord = (n: number): DailyRecord => readDailies()[n] ?? { tries: 0 };

function write(h: History) {
  const keys = Object.keys(h).map(Number).sort((a, b) => b - a);
  for (const k of keys.slice(KEEP)) delete h[k];
  writeJSON(KEYS.daily, h);
}

/** A new try at Daily `n` (started, or started again): its count. */
export function dailyTry(n: number): number {
  const h = readDailies();
  const r = h[n] ?? { tries: 0 };
  h[n] = { ...r, tries: r.tries + 1 };
  write(h);
  return h[n].tries;
}

/** An escape from Daily `n`: kept if it's the quickest yet. What it did to the record. */
export function dailyEscape(n: number, e: Omit<DailyBest, 'tries' | 'medal'> & { prison: string }): { best: boolean; medal: Medal | null; record: DailyRecord } {
  const h = readDailies();
  const r = h[n] ?? { tries: 1 };
  const tries = Math.max(1, r.tries);
  const medal = medalFor(e.prison, e.via, e.day);
  const best = !r.best || e.minutes < r.best.minutes;
  const { prison: _, ...rest } = e;
  void _;
  // (The best is the quickest escape, with its own medal: what it shares is what that escape did.)
  h[n] = best ? { tries, best: { ...rest, medal, tries } } : { ...r, tries };
  write(h);
  return { best, medal, record: h[n] };
}

/**
 * The streak: Dailies escaped one after the other, up to today's (or yesterday's, while today's
 * is still to play: a streak isn't broken before the day is out).
 */
export function streakOf(today: number, h: History = readDailies()): number {
  let n = h[today]?.best ? today : today - 1;
  let streak = 0;
  while (h[n]?.best) {
    streak++;
    n--;
  }
  return streak;
}

/** The longest streak ever (the shelf's Daily achievements). */
export function bestStreak(h: History = readDailies()): number {
  const won = Object.keys(h).filter((k) => h[k].best).map(Number).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  won.forEach((n, k) => {
    run = k > 0 && won[k - 1] === n - 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

/** The day strip's marks: a quiet day, spotted, wanted or in a fight, caught (or a lockdown, solitary), the day out. */
export const STRIP = ['quiet', 'spotted', 'hot', 'caught', 'out'] as const;
export const STRIP_EMOJI = ['⬜', '🟨', '🟧', '🟥', '🟩'];

/** The run's days (the ledger's bits) as the strip shows them. */
export function stripOf(days: readonly number[]): number[] {
  return days.map((b) => (b & DAY.ESCAPED ? 4 : b & (DAY.CAUGHT | DAY.SOLITARY | DAY.LOCKDOWN) ? 3 : b & (DAY.WANTED | DAY.FIGHT) ? 2 : b & DAY.SPOTTED ? 1 : 0));
}

/** A short code for an escape (shared with the result): the Daily, how, when, on which try, and the run's final fingerprint. */
export function checkCode(n: number, via: string, minutes: number, tries: number, sum: string): string {
  return fnv1a(`${n}|${via}|${minutes}|${tries}|${sum}`).slice(0, 6).toUpperCase();
}
