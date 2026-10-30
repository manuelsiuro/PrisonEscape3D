import { fitPrisoner, type Prisoner } from '../content/prisoner';
import { prisonById, PRISONS } from '../content/prisons';
import { TWIST_IDS } from '../content/twists';
import { decodeRuns, fitLog, fromBase64, prepareReplay, type RunLog } from '../sim/runlog';
import { clockAt, DAY_STEPS } from '../sim/systems/clock';
import { readReplay } from './logs';

/**
 * Escapes to watch again (P25): the last one (a Daily's too) and each prison's quickest, kept
 * on this device (game/logs.ts); a replay saved as a file to pass on, and one opened from a
 * file (a guest's: watched, never counted for anything).
 */

/** A file's kind, and its biggest size (characters): the longest log kept is well under it. */
const FILE_KIND = 'pe3d-replay';
export const FILE_MAX = 2_000_000;
/** The longest run a file may hold: 60 prison days (the longest log kept is a few weeks). */
const FILE_DAYS = 60;

export interface Replay {
  log: RunLog;
  /** Opened from a file: someone else's (or this device's, passed round): nothing it shows is earned. */
  guest: boolean;
  /** The prisoner who played it (a file's), or null: this device's own prisoner (or the default look). */
  by: Prisoner | null;
}

/** The escape's day, as the clock and the escape card say it (where the log ends). */
export const replayDay = (log: RunLog) => clockAt(log.from + log.steps).day;

/** The replays kept on this device: the last escape's, then each prison's quickest (in campaign order). */
export function replaysKept(): { last: RunLog | null; best: Array<{ prison: string; log: RunLog }> } {
  const best: Array<{ prison: string; log: RunLog }> = [];
  for (const p of PRISONS) {
    const log = readReplay(p.id);
    if (log) best.push({ prison: p.id, log });
  }
  return { last: readReplay(), best };
}

/** A replay as a file's text: the log, and who played it (their name and look, if they made a prisoner). */
export function replayFile(log: RunLog, by: Prisoner | null): string {
  return JSON.stringify({ kind: FILE_KIND, v: 1, log, ...(by ? { by } : {}) });
}

/** A file name for a replay: the prison, the day, the way out. */
export function replayFileName(log: RunLog): string {
  const parts = ['prison-escape', log.prison, log.daily !== undefined ? `daily-${log.daily + 1}` : '', `day${replayDay(log)}`, log.via ?? ''].filter(Boolean);
  return `${parts.join('-')}.pe3d.json`;
}

export type ReplayFileError = 'notReplay' | 'tooBig' | 'unknownPrison';

/** A file's text read as a replay (a guest's), or why it isn't one this game can play. */
export function readReplayFile(text: string): Replay | ReplayFileError {
  if (text.length > FILE_MAX) return 'tooBig';
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return 'notReplay';
  }
  const f = raw as { kind?: unknown; log?: unknown; by?: unknown } | null;
  if (!f || typeof f !== 'object' || f.kind !== FILE_KIND) return 'notReplay';
  const log = fitLog(f.log);
  if (!log) return 'notReplay';
  // (A prison or a twist from a later version of the game: this one can't set it up.)
  if (!PRISONS.some((p) => p.id === log.prison) || (log.mods ?? []).some((m) => !(TWIST_IDS as readonly string[]).includes(m))) return 'unknownPrison';
  // Its commands as long as it says, no longer than any run kept; and a game that sets up from its start.
  const runs = decodeRuns(fromBase64(log.data) ?? new Uint8Array());
  if (!runs || log.steps <= 0 || log.from + log.steps > FILE_DAYS * DAY_STEPS || runs.reduce((n, [, k]) => n + k, 0) !== log.steps) return 'notReplay';
  try {
    const prison = prisonById(log.prison)!;
    const set = prepareReplay(log, prison);
    if (!set) return 'notReplay';
    // (A crafted start that sets up but can't be played: caught at its first step.)
    set.sim.step(set.runs[0][0]);
  } catch {
    return 'notReplay';
  }
  const by = f.by && typeof f.by === 'object' ? fitPrisoner(f.by) : null;
  return { log, guest: true, by };
}
