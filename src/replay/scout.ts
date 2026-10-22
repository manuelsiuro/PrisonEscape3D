import type { PrisonDef } from '../content/prisons/types';
import { prepareReplay, sumOf, type RunLog } from '../sim/runlog';
import { ESCAPES, type Snapshot } from '../sim/Sim';
import type { SimEvent } from '../sim/state';
import { STEPS_PER_MINUTE } from '../sim/tuning';
import { LAYER } from '../sim/world/World';

/**
 * The replay viewer's scout (P25): a stored run played through once, ahead of the picture
 * (in a worker), checking the hourly checksums as it goes. It leaves keyframes to jump to,
 * the run's highlights for the scrubber and the director, the quiet stretches to skip (asleep,
 * knocked out, in solitary) and how far the run can be trusted: after a rules change a
 * checksum stops matching, and the replay plays up to the last hour that did.
 */

/** A keyframe every half game hour (a jump steps at most this far from one). */
export const KEY_STEPS = 30 * STEPS_PER_MINUTE;
/** "Skip to the escape" lands this long before the end. */
export const FINALE_STEPS = 30 * STEPS_PER_MINUTE;
/** A highlight of the same kind within this long of the last is the same moment. */
const MERGE_STEPS = 60 * STEPS_PER_MINUTE;
/** Quiet stretches shorter than this aren't worth a skip. */
const QUIET_MIN = 2 * STEPS_PER_MINUTE;

export const HIGHLIGHTS = ['caught', 'lockdown', 'ko', 'mishap', 'through', 'tunnel', 'vents', 'roof', 'power', 'takeover', 'stow', 'bluff', 'glide', 'release', 'escape'] as const;
export type HighlightKind = (typeof HIGHLIGHTS)[number];

/** Each highlight's icon on the scrubber. */
export const HIGHLIGHT_ICON: Record<HighlightKind, string> = { caught: 'siren', lockdown: 'bell', ko: 'fist', mishap: 'heart', through: 'pick', tunnel: 'shovel', vents: 'screw', roof: 'hook', power: 'plug', takeover: 'users', stow: 'truck', bluff: 'idCard', glide: 'glider', release: 'clipboard', escape: 'run' };

export interface Highlight {
  step: number;
  kind: HighlightKind;
}

export interface Keyframe {
  step: number;
  snap: Snapshot;
}

/** What the scout found, so far or in the end. */
export interface Scouted {
  /** Every checksum met to the log's end. */
  ok: boolean;
  /** The last checked step that matched (the log's start if none did). */
  verified: number;
  /** Where the replay can be watched to: the end, or (a checksum missed) the last hour that matched. */
  end: number;
  keys: Keyframe[];
  /** The keyframe "Skip to the escape" lands on. */
  finale: Keyframe | null;
  highlights: Highlight[];
  /** [from, to) steps the player spent asleep, knocked out or in solitary. */
  quiet: Array<[number, number]>;
  /** The way out (ESCAPES name), when the escape is in what plays. */
  via: string | null;
}

/** As the scout goes: how far it got, and the keyframes and highlights found since the last word. */
export interface ScoutProgress {
  at: number;
  /** The last step checked against the run's checksums (the picture plays no further yet). */
  verified: number;
  keys: Keyframe[];
  highlights: Highlight[];
}

/** The highlight an event makes (most make none). */
export function highlightOf(e: SimEvent): HighlightKind | null {
  switch (e.type) {
    case 'caught':
      return 'caught';
    case 'lockdown':
      return e.on ? 'lockdown' : null;
    case 'koed':
      return 'ko';
    case 'shocked':
    case 'caveIn':
    case 'blast':
    case 'flood':
    case 'floored':
      return 'mishap';
    case 'strike':
      // A wall, a fence or a grate giving way; a shaft opened in a floor; up out of a tunnel.
      return e.broke && (e.action === 'chip' || e.action === 'cut' || e.action === 'unscrew' || e.action === 'digUp' || (e.action === 'dig' && e.layer === LAYER.GROUND)) ? 'through' : null;
    case 'layer':
      return e.layer === LAYER.UNDER ? 'tunnel' : e.layer === LAYER.VENTS ? 'vents' : e.layer === LAYER.ROOF ? 'roof' : null;
    case 'power':
      return !e.on && e.by === 'player' ? 'power' : null;
    case 'takeover':
      return e.on ? 'takeover' : null;
    case 'stow':
      return e.on ? 'stow' : null;
    case 'bluff':
      return e.on ? 'bluff' : null;
    case 'glide':
      return 'glide';
    // (P36: cleared at the release desk.)
    case 'paper':
      return e.what === 'cleared' ? 'release' : null;
    case 'escaped':
      return 'escape';
    default:
      return null;
  }
}

/**
 * Plays a log through, yielding every `chunk` steps (a worker posts each as it comes; the main
 * thread, if it has to, gives the frame back between them). Returns null when the log can't be
 * set up in this prison.
 */
export function* scout(log: RunLog, prison: PrisonDef, chunk = 4000): Generator<ScoutProgress, Scouted | null> {
  const set = prepareReplay(log, prison);
  if (!set) return null;
  const { sim, runs } = set;
  const st = () => sim.state;
  const sums = new Map(log.sums);
  const last = log.from + log.steps;
  const finaleAt = Math.max(log.from, last - FINALE_STEPS);
  const keys: Keyframe[] = [{ step: log.from, snap: sim.snapshot() }];
  let finale: Keyframe | null = finaleAt === log.from ? keys[0] : null;
  const highlights: Highlight[] = [];
  const lastOf = new Map<HighlightKind, number>();
  const quiet: Array<[number, number]> = [];
  let quietFrom = -1;
  let sentKeys = 0;
  let sentHighlights = 0;
  let verified = log.from;
  let checked = 0;
  let bad = false;
  let n = 0;
  const closeQuiet = (at: number) => {
    if (quietFrom >= 0 && at - quietFrom >= QUIET_MIN) quiet.push([quietFrom, at]);
    quietFrom = -1;
  };
  const progress = (): ScoutProgress => {
    const out = { at: st().step, verified, keys: keys.slice(sentKeys), highlights: highlights.slice(sentHighlights) };
    sentKeys = keys.length;
    sentHighlights = highlights.length;
    return out;
  };
  play: for (const [cmd, count] of runs)
    for (let k = 0; k < count; k++) {
      const before = st().step;
      sim.step(cmd);
      const step = st().step;
      // (Out, or out of time: nothing more happens; a log that goes on past it is let go.)
      if (step === before) break play;
      let marked = false;
      for (const e of sim.events) {
        const kind = highlightOf(e);
        if (!kind) continue;
        marked = true;
        const prev = lastOf.get(kind);
        if (kind !== 'escape' && prev !== undefined && step - prev < MERGE_STEPS) continue;
        lastOf.set(kind, step);
        highlights.push({ step, kind });
      }
      // (A quiet stretch ends at anything worth seeing in it: skipping never jumps a highlight.)
      const s = st();
      const still = (s.sleeping || s.ko > 0 || s.solitary > 0) && !marked;
      if (still && quietFrom < 0) quietFrom = step;
      else if (!still) closeQuiet(step);
      if (step % KEY_STEPS === 0) keys.push({ step, snap: sim.snapshot() });
      if (step === finaleAt) finale = { step, snap: sim.snapshot() };
      const want = sums.get(step);
      if (want !== undefined) {
        if (want !== sumOf(sim)) {
          bad = true;
          break play;
        }
        verified = step;
        checked++;
      }
      if (++n % chunk === 0) yield progress();
    }
  closeQuiet(st().step);
  const reached = st().step;
  const ok = !bad && reached === last && checked === log.sums.filter(([k]) => k > log.from && k <= last).length && sums.has(last);
  // A checksum missed: what came after the last hour that matched can't be trusted.
  const end = bad ? verified : reached;
  const trim = <T extends { step: number }>(list: T[]) => list.filter((x) => x.step <= end);
  return {
    ok,
    verified,
    end,
    keys: trim(keys),
    finale: finale && finale.step <= end ? finale : null,
    highlights: trim(highlights),
    quiet: quiet.filter(([a]) => a < end).map(([a, b]): [number, number] => [a, Math.min(b, end)]),
    via: !bad && sim.state.escaped > 0 ? ESCAPES[sim.state.via] : null,
  };
}

/** Plays a whole scout at once (tests, and where there's no worker), returning its result. */
export function scoutAll(log: RunLog, prison: PrisonDef): Scouted | null {
  const it = scout(log, prison, 1 << 30);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/**
 * The commands of a log as a tape: put at any step, then read one command a step. (The runs
 * as stored, with where each starts: a jump finds its run by halving.)
 */
export class Tape {
  private readonly starts: number[] = [];
  private run = 0;
  private off = 0;
  readonly length: number;

  constructor(private readonly runs: ReadonlyArray<readonly [number, number]>) {
    let at = 0;
    for (const [, n] of runs) {
      this.starts.push(at);
      at += n;
    }
    this.length = at;
  }

  /** Puts the tape `at` steps from the log's start. */
  seek(at: number) {
    let lo = 0;
    let hi = this.runs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    this.run = lo;
    this.off = at - (this.starts[lo] ?? 0);
  }

  /** The next step's command (-1 past the end). */
  next(): number {
    while (this.run < this.runs.length && this.off >= this.runs[this.run][1]) {
      this.run++;
      this.off = 0;
    }
    if (this.run >= this.runs.length) return -1;
    this.off++;
    return this.runs[this.run][0];
  }
}

/**
 * The director's pace (Auto): fast through ordinary time, easing down to twice real time as a
 * highlight comes up and a moment after it, quickest through the quiet stretches.
 */
export const AUTO_MAX = 32;
export const AUTO_QUIET = 96;
export const AUTO_MIN = 2;
export function autoSpeed(step: number, highlights: readonly Highlight[], quiet: ReadonlyArray<readonly [number, number]>): number {
  let lo = 0;
  let hi = highlights.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (highlights[mid].step < step) lo = mid + 1;
    else hi = mid;
  }
  const ahead = lo < highlights.length ? highlights[lo].step - step : Infinity;
  const behind = lo > 0 ? step - highlights[lo - 1].step : Infinity;
  const near = Math.min(ahead, behind * 4);
  if (near > 25 * AUTO_MAX && quiet.some(([a, b]) => step >= a && step < b)) return AUTO_QUIET;
  return Math.max(AUTO_MIN, Math.min(AUTO_MAX, near / 25));
}
