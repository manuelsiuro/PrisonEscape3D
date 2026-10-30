import { KEYS, readJSON, writeJSON } from './storage';

/**
 * Lifetime stats (P16), across every game on this device: the runs' ledgers added up as they
 * go (trophies.ts), plus games started, escapes, days served and rumors heard. Counts are
 * plain numbers by name; a high (the heat's peak) keeps its highest.
 */
export type Stats = Record<string, number>;

/** Stats kept as the highest seen, not a sum. */
const HIGHS: readonly string[] = ['maxHeat', 'dailyStreak'];

export function readStats(): Stats {
  const raw = readJSON<Record<string, unknown>>(KEYS.stats, {});
  const out: Stats = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
  return out;
}

/** Adds counts to the stats (highs keep the highest); returns the stats as they are now. */
export function addStats(delta: Stats): Stats {
  const s = readStats();
  let changed = false;
  for (const [k, v] of Object.entries(delta)) {
    if (!v) continue;
    const next = HIGHS.includes(k) ? Math.max(s[k] ?? 0, v) : (s[k] ?? 0) + v;
    if (next !== s[k]) {
      s[k] = next;
      changed = true;
    }
  }
  if (changed) writeJSON(KEYS.stats, s);
  return s;
}
