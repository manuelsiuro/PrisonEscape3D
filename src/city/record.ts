import { KEYS, readJSON, writeJSON } from '../game/storage';

/**
 * City Escape's records (C3b): the ways out taken across every city, and its own feats (the prisons'
 * achievements and stats never see them). Read by the city's menu without the city's code.
 */
export const FEATS = ['heli', 'boat', 'metro', 'three', 'hardcore', 'swift', 'reader', 'friend', 'clean', 'hunter'] as const;
export type Feat = (typeof FEATS)[number];

export interface CityRecord {
  v: 1;
  /** Times out by each way (helicopter, boat, metro), the fewest days it took (0: never out), the feats had. */
  wins: [number, number, number];
  best: number;
  feats: Feat[];
}

/** What a city left behind says of how it went. */
export interface Run {
  way: number;
  day: number;
  hardcore: boolean;
  deaths: number;
  kills: number;
  notes: number;
  errands: number;
}

export const SWIFT_DAY = 6;
export const HUNTER_KILLS = 40;

const fresh = (): CityRecord => ({ v: 1, wins: [0, 0, 0], best: 0, feats: [] });

export function readRecord(): CityRecord {
  const r = readJSON<CityRecord | null>(KEYS.cityRecord, null);
  if (!r || r.v !== 1 || !Array.isArray(r.wins) || r.wins.length !== 3 || !r.wins.every((n) => Number.isInteger(n) && n >= 0))
    return fresh();
  if (!Number.isInteger(r.best) || !Array.isArray(r.feats)) return fresh();
  return { v: 1, wins: [r.wins[0], r.wins[1], r.wins[2]], best: r.best, feats: FEATS.filter((f) => r.feats.includes(f)) };
}

/** The record with a city left added: what it becomes, and the feats that are new. Pure. */
export function withRun(rec: CityRecord, run: Run): { record: CityRecord; fresh: Feat[] } {
  const wins: [number, number, number] = [rec.wins[0], rec.wins[1], rec.wins[2]];
  if (run.way >= 1 && run.way <= 3) wins[run.way - 1]++;
  const had: Feat[] = [];
  if (run.way === 1) had.push('heli');
  if (run.way === 2) had.push('boat');
  if (run.way === 3) had.push('metro');
  if (wins.every((n) => n > 0)) had.push('three');
  if (run.hardcore) had.push('hardcore');
  if (run.day <= SWIFT_DAY) had.push('swift');
  if (run.notes >= 10) had.push('reader');
  if (run.errands >= 8) had.push('friend');
  if (run.deaths === 0) had.push('clean');
  if (run.kills >= HUNTER_KILLS) had.push('hunter');
  const news = had.filter((f) => !rec.feats.includes(f));
  return {
    record: {
      v: 1,
      wins,
      best: rec.best ? Math.min(rec.best, run.day) : run.day,
      feats: FEATS.filter((f) => rec.feats.includes(f) || had.includes(f)),
    },
    fresh: news,
  };
}

/** A city left: the record written, the new feats told. */
export function recordRun(run: Run): Feat[] {
  const { record, fresh: news } = withRun(readRecord(), run);
  writeJSON(KEYS.cityRecord, record);
  return news;
}
