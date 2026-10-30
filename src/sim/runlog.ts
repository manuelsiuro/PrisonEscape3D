/**
 * The silent run recorder (P16): a game as the commands that made it, stored small, so an
 * escape can be watched again (P25). Nothing but commands goes in: the sim is deterministic,
 * so the prison, the seed and the commands are the whole run. Commands are kept as runs
 * (the command, then how many steps it held) in varints; an hourly checksum of the state lets
 * a replay tell where it drifted (a rules change since). No keyframes are kept in memory.
 * A save carries its log next to it (copied on save, so a game loaded and played two ways
 * makes two logs, each whole).
 */
import { keepOldCards, planOf, prisonDay, quietCalendar } from './systems/calendar';
import { DAY_BOOKS } from '../content/days';
import { fnv1a } from './rng';
import { ESCAPES, Sim, type Snapshot } from './Sim';
import { STEPS_PER_MINUTE } from './tuning';
import type { PrisonDef } from '../content/prisons/types';
import { HOLIDAYS } from '../content/holidays';

/** A checksum every game hour. */
export const SUM_STEPS = STEPS_PER_MINUTE * 60;

export interface RunLog {
  v: 1;
  prison: string;
  /** The new game's seed; -1 when it starts from `start` (a game loaded from a save made before logs). */
  seed: number;
  /** The Daily's twists the new game was set up under (P26; none in the campaign). */
  mods?: string[];
  /** v2.21 (P42): the holiday the new game began under (content/holidays.ts HOLIDAYS index; none when left out). */
  holiday?: number;
  /** P25, kept with an escape's log: the way out (ESCAPES name), and the Daily it was (P26). */
  via?: string;
  daily?: number;
  start?: Snapshot;
  /** The game's version when the run began. */
  game: string;
  /** The step it starts at, and how many it holds. */
  from: number;
  steps: number;
  /** Runs of commands, base64: varint command, varint how many steps. */
  data: string;
  /** [step, fingerprint of the state after it] every game hour. */
  sums: Array<[number, string]>;
}

/**
 * The state's fingerprint for the checksums (short: the log stays small). Only what has always
 * been in the state and says where the run is (the clock, the RNG, the player, everyone's place,
 * the tiles changed): a field added in a later version (or the ledger counting a little
 * differently) leaves an old log verifiable; a rule that plays out differently doesn't.
 */
export function sumOf(sim: Sim): string {
  const s = sim.state;
  return fnv1a(
    JSON.stringify([s.step, s.rng, s.player.x, s.player.z, s.layer, s.heat, s.health, s.cash, s.escaped, s.items.inv, s.inmates.map((m) => [m.body.x, m.body.z]), s.guards.map((g) => [g.body.x, g.body.z]), s.tiles]),
  );
}

function putVarint(out: number[], v: number) {
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

/** Runs of commands as bytes. */
export function encodeRuns(runs: ReadonlyArray<readonly [number, number]>): Uint8Array {
  const out: number[] = [];
  for (const [cmd, n] of runs) {
    putVarint(out, cmd >>> 0);
    putVarint(out, n);
  }
  return Uint8Array.from(out);
}

/** Bytes back to runs of commands (null if they're cut short). */
export function decodeRuns(bytes: Uint8Array): Array<[number, number]> | null {
  const runs: Array<[number, number]> = [];
  let k = 0;
  const read = (): number | null => {
    let v = 0;
    let mul = 1;
    for (;;) {
      if (k >= bytes.length) return null;
      const b = bytes[k++];
      v += (b & 0x7f) * mul;
      if (b < 0x80) return v;
      mul *= 128;
      if (mul > 2 ** 35) return null;
    }
  };
  while (k < bytes.length) {
    const cmd = read();
    const n = read();
    if (cmd === null || n === null) return null;
    runs.push([cmd, n]);
  }
  return runs;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array | null {
  try {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let k = 0; k < s.length; k++) out[k] = s.charCodeAt(k);
    return out;
  } catch {
    return null;
  }
}

/** A stored log checked for shape (null when it isn't one). */
export function fitLog(v: unknown): RunLog | null {
  const l = v as Partial<RunLog> | null;
  if (!l || typeof l !== 'object' || l.v !== 1) return null;
  if (typeof l.prison !== 'string' || typeof l.seed !== 'number' || typeof l.from !== 'number' || typeof l.steps !== 'number' || typeof l.data !== 'string' || typeof l.game !== 'string') return null;
  // (Whole numbers, a start and a length that can be: a file from elsewhere may say anything, P25.)
  if (!Number.isSafeInteger(l.seed) || !Number.isSafeInteger(l.from) || !Number.isSafeInteger(l.steps) || l.from < 0 || l.steps < 0) return null;
  if (!Array.isArray(l.sums) || !l.sums.every((s) => Array.isArray(s) && typeof s[0] === 'number' && typeof s[1] === 'string')) return null;
  if (l.seed < 0 && !(l.start && typeof l.start === 'object' && l.start.prison === l.prison)) return null;
  if (l.mods !== undefined && !(Array.isArray(l.mods) && l.mods.every((m) => typeof m === 'string'))) return null;
  if (l.holiday !== undefined && !(Number.isInteger(l.holiday) && l.holiday >= 0 && l.holiday < HOLIDAYS.length)) return null;
  if ((l.via !== undefined && !(ESCAPES as readonly unknown[]).includes(l.via)) || (l.daily !== undefined && !(Number.isSafeInteger(l.daily) && l.daily >= 0))) return null;
  return l as RunLog;
}

/**
 * Steps a game and records its commands (Game.rec): a new game from its seed, or a game
 * loaded from a save, carrying on that save's log (or a new one from the loaded state when it
 * has none that fits).
 */
export class RunRecorder {
  /** The runs so far as bytes (grown by doubling), and how many are used. */
  private buf = new Uint8Array(1024);
  private len = 0;
  private readonly tmp: number[] = [];
  /** The run being held: its command and how many steps so far (0: none yet). */
  private cmd = 0;
  private held = 0;
  private readonly head: Omit<RunLog, 'data' | 'steps' | 'sums'>;
  private steps = 0;
  private readonly sums: Array<[number, string]> = [];

  constructor(
    readonly sim: Sim,
    origin: { seed: number; game: string } | { log: RunLog | null; game: string },
  ) {
    const from = sim.state.step;
    if ('seed' in origin) this.head = { v: 1, prison: sim.prison.id, seed: origin.seed, ...(sim.state.mods.length ? { mods: [...sim.state.mods] } : {}), ...(sim.state.holiday ? { holiday: sim.state.holiday } : {}), game: origin.game, from };
    else {
      const log = origin.log;
      // (A log from before the day's events (P17) can't be carried on under them, nor one from before the dogs (P19) where there are dogs: the game starts a log of its own from here.)
      // (Nor one from before the rats, P20: a guard waking without his key now raises the alarm; nor one from before visiting day, P21: the week's cards changed.)
      // (Nor one from before sports day, P22: the week's cards changed again; nor stage nights, P30; nor the P23–P30 fixes of 2.5.1; nor the easier games of 2.16.)
      // (Every one of those versions comes before 2.16, the latest gate: one test covers them all.)
      const stale = beforeEasier(log?.game ?? '');
      const runs = log && log.prison === sim.prison.id && log.from + log.steps === from && !stale ? decodeRuns(fromBase64(log.data) ?? new Uint8Array()) : null;
      if (log && runs) {
        this.head = { v: 1, prison: log.prison, seed: log.seed, ...(log.mods ? { mods: log.mods } : {}), ...(log.holiday ? { holiday: log.holiday } : {}), ...(log.start ? { start: log.start } : {}), game: log.game, from: log.from };
        this.put(encodeRuns(runs));
        this.steps = log.steps;
        this.sums.push(...log.sums);
      } else this.head = { v: 1, prison: sim.prison.id, seed: -1, start: sim.snapshot(), game: origin.game, from };
    }
  }

  /** Steps the simulation with a command and records it (nothing once the game is over). */
  step(cmd: number) {
    const was = this.sim.state.step;
    this.sim.step(cmd);
    if (this.sim.state.step === was) return;
    if (this.held > 0 && cmd !== this.cmd) this.flush();
    this.cmd = cmd;
    this.held++;
    this.steps++;
    if (this.sim.state.step % SUM_STEPS === 0) this.sums.push([this.sim.state.step, sumOf(this.sim)]);
  }

  private put(bytes: ArrayLike<number>) {
    if (this.len + bytes.length > this.buf.length) {
      const grown = new Uint8Array(Math.max(this.buf.length * 2, this.len + bytes.length));
      grown.set(this.buf.subarray(0, this.len));
      this.buf = grown;
    }
    for (let k = 0; k < bytes.length; k++) this.buf[this.len++] = bytes[k];
  }

  private flush() {
    this.tmp.length = 0;
    putVarint(this.tmp, this.cmd >>> 0);
    putVarint(this.tmp, this.held);
    this.put(this.tmp);
    this.held = 0;
  }

  /** The log so far (the run being held included), ready to store. */
  toLog(): RunLog {
    const tail: number[] = [];
    if (this.held > 0) {
      putVarint(tail, this.cmd >>> 0);
      putVarint(tail, this.held);
    }
    const bytes = new Uint8Array(this.len + tail.length);
    bytes.set(this.buf.subarray(0, this.len));
    bytes.set(tail, this.len);
    // The state where the log ends (an escape's last step, a save's) checked too, not just the hours.
    const sums = this.sums.map((x): [number, string] => [x[0], x[1]]);
    const end = this.sim.state.step;
    if (sums.at(-1)?.[0] !== end) sums.push([end, sumOf(this.sim)]);
    return { ...this.head, steps: this.steps, data: toBase64(bytes), sums };
  }

  /** The bytes the commands take so far (tests: how small a day is). */
  get size(): number {
    return this.len;
  }
}

/** Where a replay got to: the sim at the end (or where it stopped), and the last step whose checksum matched. */
export interface Replayed {
  sim: Sim;
  /** Every checksum matched to the end. */
  ok: boolean;
  /** The last checked step that matched (the log's start if none). */
  verified: number;
}

/**
 * Whether a game version ("2.15.3") came before major.minor(.patch); false for one that isn't a
 * version at all. The gates below keep old logs playing under the rules they were recorded with.
 */
function versionBefore(game: string, major: number, minor: number, patch?: number): boolean {
  const m = (patch === undefined ? /^(\d+)\.(\d+)\./ : /^(\d+)\.(\d+)\.(\d+)/).exec(game);
  if (!m) return false;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return a < major || (a === major && (b < minor || (patch !== undefined && b === minor && c < patch)));
}

/** Before the pay phone (2.10.0): nobody queued for it then. */
const beforePhone = (game: string) => versionBefore(game, 2, 10);
/** Before the day's events (1.11.0): its days were all quiet. */
const beforeDays = (game: string) => versionBefore(game, 1, 11);
/** Before the guard dogs (1.13.0). */
const beforeDogs = (game: string) => versionBefore(game, 1, 13);
/** Before the pet rat (1.14.0): a guard who woke without his key raised nothing then. */
const beforeRats = (game: string) => versionBefore(game, 1, 14);
/** Before visiting day (1.15.0): the card it took the place of was dealt then. */
const beforeVisits = (game: string) => versionBefore(game, 1, 15);
/** Before sports day (1.16.0): the card it took the place of was dealt then. */
const beforeSports = (game: string) => versionBefore(game, 1, 16);
/** Before stage nights (2.5.0): the cards they took the places of were dealt then. */
export const beforeStage = (game: string) => versionBefore(game, 2, 5);
/** Before the P23–P30 fixes (2.5.1): Sim.rules250 plays it as it was. */
export const beforeFixes = (game: string) => versionBefore(game, 2, 5, 1);
/** Before the easier quiz, football and race nights (2.16.0): Sim.rules215 plays it as it was. */
const beforeEasier = (game: string) => versionBefore(game, 2, 16);

/** The last prison day a log's old cards are dealt for: its own last, or at most LEGACY_DAYS on (a log that runs on and on past its end). */
const LEGACY_DAYS = 1000;
const lastDay = (log: RunLog) => Math.min(prisonDay(log.from + log.steps), prisonDay(log.from) + LEGACY_DAYS);

/**
 * A log's game set up to be played back (P25: the replay viewer's scout and its picture share
 * it): the sim at the log's start, with the rules of the version it was played under, and its
 * commands. Null when the log doesn't fit this prison or its commands are damaged.
 */
export function prepareReplay(log: RunLog, prison: PrisonDef): { sim: Sim; runs: Array<[number, number]> } | null {
  if (prison.id !== log.prison) return null;
  const runs = decodeRuns(fromBase64(log.data) ?? new Uint8Array());
  if (!runs) return null;
  const sim = new Sim(prison, log.seed < 0 ? 1 : log.seed, log.mods, log.holiday ?? 0);
  if (log.seed < 0) sim.restore(log.start!);
  // Played before the day's events (P17): every day was quiet then.
  if (beforeDays(log.game)) {
    sim.state.calendar = quietCalendar();
    sim.legacy = true;
  }
  // Played before the dogs came (P19): they stayed in their kennels.
  if (beforeDogs(log.game)) sim.noDogs = true;
  // Played before the rats (P20): a guard waking without his key went unnoticed.
  if (beforeRats(log.game)) sim.noRats = true;
  // Played before visiting day (P21): every day it would deal now dealt the card it took the place of.
  const book = DAY_BOOKS[prison.id];
  const logDays: number[] = [];
  for (let day = prisonDay(log.from); day <= lastDay(log); day++) logDays.push(day);
  const logPlan = (day: number) => planOf(sim, day).event;
  if (beforeVisits(log.game) && !beforeDays(log.game)) keepOldCards(sim.state, logDays, logPlan, { visiting: book?.beforeVisits ?? 'none' });
  // Played before sports day (P22): likewise.
  if (beforeSports(log.game) && !beforeDays(log.game)) keepOldCards(sim.state, logDays, logPlan, { sports: book?.beforeSports ?? 'none' });
  // Played before stage nights (P30): likewise, for both.
  if (beforeStage(log.game) && !beforeDays(log.game) && book?.beforeStage) keepOldCards(sim.state, logDays, logPlan, book.beforeStage);
  // Played before the P23–P30 fixes (2.5.1): those rules as they were.
  if (beforeFixes(log.game)) sim.rules250 = true;
  // Played before the pay phone (P34): nobody queued for it.
  if (beforePhone(log.game)) sim.noQueue = true;
  // Played before the easier quiz, football and race nights (2.16): those as they were.
  if (beforeEasier(log.game)) sim.rules215 = true;
  if (sim.state.step !== log.from) return null;
  return { sim, runs };
}

/** Plays a log back from its start, checking the hourly sums (stops at the first that doesn't match). */
export function replayLog(log: RunLog, prison: PrisonDef): Replayed | null {
  const set = prepareReplay(log, prison);
  if (!set) return null;
  const { sim, runs } = set;
  const sums = new Map(log.sums);
  let verified = log.from;
  let checked = 0;
  for (const [cmd, n] of runs)
    for (let k = 0; k < n; k++) {
      sim.step(cmd);
      const want = sums.get(sim.state.step);
      if (want === undefined) continue;
      if (want !== sumOf(sim)) return { sim, ok: false, verified };
      verified = sim.state.step;
      checked++;
    }
  // Whole only if it got to where the log ends and every checksum on the way was met (none skipped).
  const end = log.from + log.steps;
  return { sim, ok: sim.state.step === end && allChecked(log, sums, checked, end), verified };
}

/** Every one of a log's checksums up to `end` was met on the way (`checked` of them, none skipped), the last at `end` itself. */
export const allChecked = (log: RunLog, sums: ReadonlyMap<number, string>, checked: number, end: number) =>
  checked === log.sums.filter(([k]) => k > log.from && k <= end).length && sums.has(end);
