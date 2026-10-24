/**
 * The parole board (P39, docs/PLAN.md §13; numbers in content/parole.ts). A second, slower way
 * out: route `parole`, through the front door as the paperwork's release (P36) goes.
 *
 * - **Applying** (EXT.PAROLE APPLY at the release desk, or the lawyer by phone for PAROLE_FEE: a
 *   day sooner), from prison day APPLY_DAY: the hearing is set HEARING_AFTER prison days on, at
 *   10:00, in the visiting room (HEARINGS). The record runs from the day of applying.
 * - **The record**: a pure function of the run's ledger (`recordCounts`): the counters since
 *   applying (the state keeps them as they stood then), and the days with a fight since.
 * - **The hearing**: on its day the routine sends the player to the room; there by 10:30, they sit
 *   before the board. Three members, a question each on a topic drawn by roll() (EXT.PAROLE
 *   ANSWER: a claim, owning up, or fine words). A claim the record doesn't bear out is a lie
 *   caught. The record's score and the answers' together, PASS or more: granted, the name on
 *   tomorrow's release list (paperwork.ts takes it from there); else denied, the two lines that
 *   weighed most kept for the card, and again after APPLY_AGAIN prison days. A lockdown puts the
 *   hearing off a day; not there by 10:30, or walking out, it's lost.
 * - **Plotting** voids an application (or a release granted, until the desk has cleared the
 *   player): damage found (a tunnel, a hole), cutters, a shovel or the multitool taken off the
 *   player, or seen out at night. A grant lost at the desk waits APPLY_AGAIN as a no does.
 *
 * Nothing runs until the player first applies in the run (the escape bots play as before), and
 * every draw comes from roll() (SALT.PAROLE).
 */
import { ANSWER, ANSWER_STEPS, APPLY_AGAIN, APPLY_DAY, HEARING_AFTER, HEARING_FROM, HEARING_TO, HEARINGS, LAWYER_SOONER, MEMBERS, PASS, RECORD, SILENT, SIT_STEPS, TOPICS, WEIGH_STEPS, type HearingPlace } from '../../content/parole';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import type { Refusal, SimState } from '../state';
import { CHASE_HEAT, STEPS_PER_MINUTE, UNIT } from '../tuning';
import { LAYER, MAP_W } from '../world/World';
import { dayMinute, prisonDay } from './calendar';
import { clockAt } from './clock';
import { DAY, FEAT } from './ledger';
import { atDesk, freedNow, releaseOf } from './paperwork';
import { endTalk, refuse } from './social';
import { REACH } from './items';
import { atProp, seatSpot } from './rest';
import { stopTraining } from './training';
import { afterHours } from './watch';

/** What EXT.PAROLE asks (b): apply at the desk, an answer to the board (c: ANSWER). Never renumber. */
export const PAROLE = { APPLY: 0, ANSWER: 1 } as const;

/** The places in `state.parole`. */
export const P = { HEARING: 0, FROM: 1, LAWYER: 2, AGAIN: 3, OUTCOME: 4, SCORE: 5, LINE1: 6, LINE2: 7, USED: 8, RELEASE: 9 } as const;
/** How the last application ended (`parole[OUTCOME]`). */
export const OUTCOME = { NONE: 0, GRANTED: 1, DENIED: 2, VOIDED: 3, MISSED: 4 } as const;
/** Why an application was voided (kept in LINE1). Never renumber. */
export const VOIDS = ['dig', 'tools', 'night'] as const;
export type VoidWhy = (typeof VOIDS)[number];
/** A line that weighed: a RECORD place, a question's answer (ANSWERED + its place), walking out. */
export const ANSWERED = 100;
export const WALKED_OUT = 99;

/** A fresh `state.parole`. */
export const freshParole = () => [0, 0, 0, 0, 0, 0, -1, -1, 0, 0];

/** The lowest and highest score a verdict can have (every line against at its cap and the worst answers; the reverse): a save's bounds. */
export const SCORE_MIN = -RECORD.reduce((a, r) => a + (r.side < 0 ? r.cap : 0), 0) + MEMBERS.reduce((a, m) => a + Math.min(m.lie, SILENT, 0), 0);
export const SCORE_MAX = RECORD.reduce((a, r) => a + (r.side > 0 ? r.cap : 0), 0) + MEMBERS.reduce((a, m) => a + Math.max(m.claim, m.own, m.words, 0), 0);

/** A hearing before the board (P39): plain data in the state. */
export interface Hearing {
  /** The step the player sat down; the question now (0–2; -1 sitting down); the step it was put. */
  from: number;
  q: number;
  at: number;
  /** Each member's topic (TOPICS places); the answer said (ANSWER; -1 none yet, -2 silence); what it was worth. */
  topics: number[];
  said: number[];
  worth: number[];
  /** The step the answer stops being weighed (0: still being asked). */
  until: number;
}

/** The prison's hearing room and board (none at the Training Block, nor where there's no release desk). */
export const hearingOf = (sim: Pick<SimContext, 'world'>): HearingPlace | null => (releaseOf(sim) ? (HEARINGS[sim.world.def.id] ?? null) : null);

/** The player has applied at least once this run (from then on the record's own counters run). */
export const paroleUsed = (s: Pick<SimState, 'parole'>) => s.parole[P.USED] > 0;

/** The prison day of the hearing set (0 none). */
export const hearingDay = (s: Pick<SimState, 'parole'>) => s.parole[P.HEARING];

/** The name on the release list by the board's grant (P36's release then takes it as route `parole`). */
export const paroled = (s: Pick<SimState, 'parole' | 'release'>) => s.parole[P.RELEASE] > 0 && s.release[0] === s.parole[P.RELEASE];

// ------------------------------------------------------------------ the record

/** The ledger's counters each record line counts (cumulative: the record is now's less applying's). Fights are counted in days apart; knockouts are the player's own, in fights they started (FEAT.kosDealt). */
function rawCounts(s: Pick<SimState, 'feats'>): number[] {
  const f = s.feats;
  const at = (k: number) => f[k] ?? 0;
  return RECORD.map((r) => {
    switch (r.id) {
      case 'work':
        return at(FEAT.wages);
      case 'courses':
        return at(FEAT.coursesPassed);
      case 'rollCalls':
        return at(FEAT.rollCallsKept);
      case 'meals':
        return at(FEAT.mealsKept);
      case 'showers':
        return at(FEAT.showersKept);
      case 'family':
        return at(FEAT.homeCalls);
      case 'favors':
        return at(FEAT.favors);
      case 'garden':
        return at(FEAT.planted) + at(FEAT.harvests);
      case 'kos':
        return at(FEAT.kosDealt);
      case 'solitary':
        return at(FEAT.solitary);
      case 'contraband':
        return at(FEAT.contrabandFound);
      case 'heat':
        return at(FEAT.eveningHeat);
      case 'missed':
        return at(FEAT.missed);
      case 'dogs':
        return at(FEAT.sniffed);
      default:
        return 0;
    }
  });
}

/** What each record line counts since the day of applying (RECORD order): pure, from the ledger. */
export function recordCounts(s: Pick<SimState, 'feats' | 'days' | 'parole' | 'paroleBase'>): number[] {
  const now = rawCounts(s);
  const from = s.parole[P.FROM];
  return RECORD.map((r, k) => {
    if (r.id === 'fights') {
      // (The days with a fight the player started: DAY.STARTED, set only once they've applied, today's cleared on applying.)
      let n = 0;
      for (let d = Math.max(0, from - 1); d < s.days.length; d++) if (s.days[d] & DAY.STARTED) n++;
      return n;
    }
    return Math.max(0, now[k] - (s.paroleBase[k] ?? 0));
  });
}

/** Each line's points (signed: against lines below zero). */
export const linePoints = (counts: readonly number[]) => RECORD.map((r, k) => r.side * Math.min(r.cap, Math.floor((counts[k] * r.w) / r.each)));

/** The record's score: the lines' points added up. */
export const recordScore = (counts: readonly number[]) => linePoints(counts).reduce((a, b) => a + b, 0);

/** A claim on a topic is true: each of its lines clean (a line for at its need, a line against at nothing at all). The card's file line says the same (play/parole.ts). */
export function claimTrue(counts: readonly number[], topic: number): boolean {
  const t = TOPICS[topic];
  return t.lines.every((id) => {
    const k = RECORD.findIndex((r) => r.id === id);
    return RECORD[k].side > 0 ? counts[k] >= (t.need ?? 1) : counts[k] === 0;
  });
}

/** What an answer is worth to a member (ANSWER): a claim borne out or a lie caught, owning up, fine words (by Intellect). */
export function answerWorth(member: number, topic: number, choice: number, counts: readonly number[], int: number): number {
  const m = MEMBERS[member];
  if (choice === ANSWER.CLAIM) return claimTrue(counts, topic) ? m.claim : m.lie;
  if (choice === ANSWER.OWN) return m.own;
  if (choice === ANSWER.WORDS) return Math.floor((Math.max(0, Math.min(100, int)) * m.words) / 100);
  return SILENT;
}

/** The three topics the board asks about at a hearing: distinct, by roll() for the run and the day. */
export function topicsOf(salt: number, day: number): number[] {
  const order = TOPICS.map((_, k) => k);
  for (let j = order.length - 1; j > 0; j--) {
    const i = rollInt(salt, SALT.PAROLE, day, j, j + 1);
    [order[j], order[i]] = [order[i], order[j]];
  }
  return order.slice(0, MEMBERS.length);
}

/**
 * The two lines that weighed most (codes: a RECORD place, ANSWERED + a question, WALKED_OUT): for
 * a denial the worst (lines against, lies and silences), for a grant the best. A line worth
 * nothing never weighed (-1 in its place when there aren't two).
 */
export function weighed(counts: readonly number[], worth: readonly number[], granted: boolean): number[] {
  const pts = linePoints(counts);
  const all: Array<[number, number]> = [];
  RECORD.forEach((_, k) => {
    if (granted ? pts[k] > 0 : pts[k] < 0) all.push([k, pts[k]]);
  });
  worth.forEach((v, q) => {
    if (granted ? v > 0 : v < 0) all.push([ANSWERED + q, v]);
  });
  all.sort((a, b) => (granted ? b[1] - a[1] : a[1] - b[1]) || a[0] - b[0]);
  const out = all.slice(0, 2).map(([c]) => c);
  while (out.length < 2) out.push(-1);
  return out;
}

// ------------------------------------------------------------------ applying

/** Why the player can't apply now (null: they can). `byPhone`: the lawyer files it (no need to be at the desk). Pure: the card says the same. */
export function applyRefusal(sim: SimContext, byPhone = false): Refusal | null {
  const s = sim.state;
  // (Never in the Daily: it deals no parole. Never at the Training Block.)
  if (!hearingOf(sim) || s.mods.length) return 'noParole';
  const day = prisonDay(s.step);
  if (s.parole[P.HEARING] || paroled(s) || s.hearing) return 'paroleOn';
  if (day < APPLY_DAY) return 'paroleEarly';
  if (s.parole[P.AGAIN] > day) return 'paroleWait';
  if (s.lockdown || s.heat >= CHASE_HEAT) return 'hunted';
  if (s.release[0] > 0) return 'onList';
  if (!byPhone && !atDesk(sim)) return 'notAtDesk';
  return null;
}

/** Applied (EXT.PAROLE APPLY at the desk; the lawyer's call, `lawyer`): the hearing set, the record from today. False: refused. */
export function applyParole(sim: SimContext, lawyer = false): boolean {
  const s = sim.state;
  const why = applyRefusal(sim, lawyer);
  if (why) {
    refuse(sim, why);
    return false;
  }
  const day = prisonDay(s.step);
  const p = s.parole;
  p[P.HEARING] = day + HEARING_AFTER - (lawyer ? LAWYER_SOONER : 0);
  p[P.FROM] = day;
  p[P.LAWYER] = lawyer ? 1 : 0;
  p[P.AGAIN] = 0;
  p[P.OUTCOME] = OUTCOME.NONE;
  p[P.SCORE] = 0;
  p[P.LINE1] = -1;
  p[P.LINE2] = -1;
  p[P.USED] = 1;
  p[P.RELEASE] = 0;
  s.paroleBase = rawCounts(s);
  // (Fights count from now: one started earlier today, under an older application, stays off. The ledger's days are
  // the calendar's, a day ahead of the prison day before 08:00: both cleared.)
  for (const d of [day - 1, clockAt(s.step).day - 1]) if (s.days[d]) s.days[d] &= ~DAY.STARTED;
  sim.events.push({ type: 'parole', what: 'applied', n: p[P.HEARING], lawyer });
  return true;
}

// ------------------------------------------------------------------ the hearing

/** The hearing is due now: its day, 10:00–10:30, not yet held (and nothing put it off). */
export function hearingDue(s: Pick<SimState, 'parole' | 'step' | 'hearing'>): boolean {
  const m = dayMinute(s.step);
  return s.parole[P.HEARING] > 0 && s.parole[P.HEARING] === prisonDay(s.step) && m >= HEARING_FROM && m < HEARING_TO && !s.hearing;
}

/** In the hearing room, up and about on the ground floor. */
export function inHearingRoom(sim: SimContext): boolean {
  const h = hearingOf(sim);
  const s = sim.state;
  if (!h || s.layer !== LAYER.GROUND || sim.away || s.stowed || s.sleeping) return false;
  return sim.world.zoneAt(Math.floor(s.player.x / UNIT), Math.floor(s.player.z / UNIT)) === h.zone;
}

/** Where the routine wants the player while the hearing is due or sitting (null: it isn't). */
export function hearingZones(sim: SimContext): readonly string[] | null {
  const s = sim.state;
  if (!s.parole[P.HEARING] && !s.hearing) return null;
  if (!s.hearing && (!hearingDue(s) || s.lockdown)) return null;
  const h = hearingOf(sim);
  if (!h) return null;
  let z = zoneLists.get(h.zone);
  if (!z) zoneLists.set(h.zone, (z = [h.zone]));
  return z;
}
const zoneLists = new Map<string, readonly string[]>();

/** The board's chairs and the player's seat across from them (ground tiles) into `out`, while the hearing is due or sitting (else none): kept clear of inmates. */
export function boardKeptClear(sim: SimContext, out: number[]) {
  out.length = 0;
  const s = sim.state;
  if (!s.hearing && !(hearingDue(s) && !s.lockdown)) return;
  const h = hearingOf(sim);
  if (!h) return;
  for (const b of h.board) out.push(b.z * MAP_W + b.x);
  out.push(h.seat.z * MAP_W + h.seat.x);
}

/** The question being asked (its member, its topic), null between questions or none. */
export function questionNow(s: Pick<SimState, 'hearing'>): { member: number; topic: number } | null {
  const o = s.hearing;
  if (!o || o.q < 0) return null;
  return { member: o.q, topic: o.topics[o.q] };
}

/** The player's answer (EXT.PAROLE ANSWER, c: ANSWER) while a question is put and not yet answered. */
export function answerBoard(sim: SimContext, choice: number) {
  const s = sim.state;
  const o = s.hearing;
  if (!o || o.q < 0 || o.until || o.said[o.q] !== -1 || choice < 0 || choice > 2) return;
  const counts = recordCounts(s);
  const worth = answerWorth(o.q, o.topics[o.q], choice, counts, s.items.int);
  o.said[o.q] = choice;
  o.worth[o.q] = worth;
  o.until = s.step + WEIGH_STEPS;
  const lie = choice === ANSWER.CLAIM && !claimTrue(counts, o.topics[o.q]);
  sim.events.push({ type: 'parole', what: 'answer', q: o.q, choice, worth, lie });
}

/** The player sits before the board (on the seat across from it, when they're at it: facing the board). */
function sitDown(sim: SimContext) {
  const s = sim.state;
  stopTraining(sim);
  endTalk(sim);
  const h = hearingOf(sim)!;
  const seat = sim.world.props.findIndex((p) => p.kind !== 'table' && h.seat.x >= p.x && h.seat.x < p.x + p.w && h.seat.z >= p.z && h.seat.z < p.z + p.d);
  if (seat >= 0 && s.seat < 0 && atProp(sim.world, seat, s.player, REACH)) {
    s.player.moving = false;
    s.player.facing = seatSpot(sim.world, seat, s.player).facing;
    s.seat = seat;
    sim.events.push({ type: 'sit', on: true, use: 'sit' });
  }
  s.hearing = { from: s.step, q: -1, at: 0, topics: topicsOf(s.salt, prisonDay(s.step)), said: [-1, -1, -1], worth: [0, 0, 0], until: 0 };
  sim.events.push({ type: 'parole', what: 'sat' });
}

function put(sim: SimContext, q: number) {
  const o = sim.state.hearing!;
  o.q = q;
  o.at = sim.state.step;
  o.until = 0;
  sim.events.push({ type: 'parole', what: 'question', q, topic: o.topics[q] });
}

/** The board's verdict on the record and the answers. */
function verdict(sim: SimContext) {
  const s = sim.state;
  const o = s.hearing!;
  const p = s.parole;
  const day = prisonDay(s.step);
  const counts = recordCounts(s);
  const score = recordScore(counts) + o.worth.reduce((a, b) => a + b, 0);
  const granted = score >= PASS;
  const lines = weighed(counts, o.worth, granted);
  s.hearing = null;
  p[P.HEARING] = 0;
  p[P.SCORE] = score;
  p[P.LINE1] = lines[0];
  p[P.LINE2] = lines[1];
  if (granted) {
    p[P.OUTCOME] = OUTCOME.GRANTED;
    p[P.RELEASE] = day + 1;
    // (Tomorrow's release list, as a form in the tray puts a name there: P36 calls it at 10:00.)
    s.release[0] = day + 1;
  } else {
    p[P.OUTCOME] = OUTCOME.DENIED;
    p[P.AGAIN] = day + APPLY_AGAIN;
  }
  sim.events.push({ type: 'parole', what: granted ? 'granted' : 'denied', score, lines: lines.slice(), n: granted ? day + 1 : day + APPLY_AGAIN });
}

/** The hearing lost: not there in time (`missed`), or walked out of (a denial). */
function lost(sim: SimContext, how: 'missed' | 'walkedOut') {
  const s = sim.state;
  const p = s.parole;
  const day = prisonDay(s.step);
  s.hearing = null;
  p[P.HEARING] = 0;
  p[P.OUTCOME] = how === 'missed' ? OUTCOME.MISSED : OUTCOME.DENIED;
  p[P.SCORE] = 0;
  p[P.LINE1] = how === 'walkedOut' ? WALKED_OUT : -1;
  p[P.LINE2] = -1;
  p[P.AGAIN] = day + APPLY_AGAIN;
  sim.events.push({ type: 'parole', what: how, n: day + APPLY_AGAIN });
}

/** Put off to tomorrow (a lockdown; knocked out at the hearing by someone else). */
function postpone(sim: SimContext) {
  const s = sim.state;
  s.hearing = null;
  s.parole[P.HEARING] = prisonDay(s.step) + 1;
  sim.events.push({ type: 'parole', what: 'postponed', n: s.parole[P.HEARING] });
}

/** Caught plotting: the application (or the release granted, not yet cleared at the desk) void, the record to start again. */
function voidIt(sim: SimContext, why: VoidWhy) {
  const s = sim.state;
  const p = s.parole;
  const day = prisonDay(s.step);
  if (paroled(s)) s.release[0] = 0;
  s.hearing = null;
  p[P.HEARING] = 0;
  p[P.RELEASE] = 0;
  p[P.OUTCOME] = OUTCOME.VOIDED;
  p[P.SCORE] = 0;
  p[P.LINE1] = VOIDS.indexOf(why);
  p[P.LINE2] = -1;
  p[P.AGAIN] = day + APPLY_AGAIN;
  sim.events.push({ type: 'parole', what: 'voided', why, n: day + APPLY_AGAIN });
}

/** Plotting seen this step (null: none). */
function plotting(sim: SimContext): VoidWhy | null {
  // (Out of the cell after Lights Out: seen by a guard, filmed, lit up, or caught out there in a lockdown, when nothing more is "spotted".)
  const outLate = afterHours(sim.state) && sim.playerZone !== 'playerCell';
  for (const e of sim.events) {
    if (e.type === 'found') return 'dig';
    if ((e.type === 'solitary' && e.on) || e.type === 'infirmary') if (e.plot) return 'tools';
    if (e.type === 'spotted' && (e.reason === 'night' || e.reason === 'bedCheck')) return 'night';
    if (outLate && ((e.type === 'spotted' && (e.reason === 'camera' || e.reason === 'searchlight')) || e.type === 'caught')) return 'night';
    // (A bed check failed in a lockdown says so only in its own news.)
    if (e.type === 'bedCheck' && e.result === 'fail') return 'night';
  }
  return null;
}

/** Each step, once the player has applied in the run: plotting found out, the hearing called and held, the release granted kept in step with the list. */
export function parole(sim: SimContext) {
  const s = sim.state;
  const p = s.parole;
  if (!p[P.USED]) return;
  const day = prisonDay(s.step);
  // (The release granted struck off the list since: missed, turned away, or out of the doors' minute. Applying again waits as after a no.)
  if (p[P.RELEASE] && s.release[0] !== p[P.RELEASE]) {
    p[P.RELEASE] = 0;
    p[P.AGAIN] = day + APPLY_AGAIN;
  }
  // (Cleared at the desk and on the way out: the board's word stands.)
  const pending = p[P.HEARING] > 0 || (p[P.RELEASE] > 0 && !freedNow(s));
  if (pending) {
    const why = plotting(sim);
    if (why) return voidIt(sim, why);
  }
  const o = s.hearing;
  if (o) return keepHearing(sim);
  const at = p[P.HEARING];
  if (!at) return;
  // (A day gone by without the hearing: in solitary, out cold.)
  if (at < day) return lost(sim, 'missed');
  if (at !== day) return;
  const m = dayMinute(s.step);
  if (m < HEARING_FROM) return;
  if (m >= HEARING_TO) return lost(sim, 'missed');
  if (s.lockdown) return postpone(sim);
  if (s.step % STEPS_PER_MINUTE === 0 && m === HEARING_FROM) sim.events.push({ type: 'parole', what: 'called', n: day });
  if (inHearingRoom(sim) && !s.quiz && !s.show && !s.call) sitDown(sim);
}

/** Each step of the hearing: off if the player leaves (put off by a lockdown, or someone knocking them out); the questions; the verdict. */
function keepHearing(sim: SimContext) {
  const s = sim.state;
  const o = s.hearing!;
  if (s.lockdown || s.ko > 0) return postpone(sim);
  if (!inHearingRoom(sim)) return lost(sim, 'walkedOut');
  if (o.q < 0) {
    if (s.step - o.from >= SIT_STEPS) put(sim, 0);
    return;
  }
  if (o.until) {
    if (s.step < o.until) return;
    if (o.q + 1 >= MEMBERS.length) return verdict(sim);
    return put(sim, o.q + 1);
  }
  if (s.step - o.at >= ANSWER_STEPS) {
    o.said[o.q] = -2;
    o.worth[o.q] = SILENT;
    o.until = s.step + WEIGH_STEPS;
    sim.events.push({ type: 'parole', what: 'silent', q: o.q, worth: SILENT });
  }
}

/** EXT.PAROLE: applying at the desk, an answer to the board. */
export function paroleOp(sim: SimContext, b: number, c: number) {
  if (b === PAROLE.APPLY) applyParole(sim, false);
  else if (b === PAROLE.ANSWER) answerBoard(sim, c);
}

/** Steps left to answer the question put (0 none). */
export const answerLeft = (s: Pick<SimState, 'hearing' | 'step'>) => (s.hearing && s.hearing.q >= 0 && !s.hearing.until ? Math.max(0, ANSWER_STEPS - (s.step - s.hearing.at)) : 0);

/** A hearing as a save holds it (state.ts loadState). */
export function hearingOk(o: Hearing | null, step: number): boolean {
  if (o === null) return true;
  if (!o || typeof o !== 'object') return false;
  const ints = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every((x) => Number.isInteger(x));
  return (
    [o.from, o.q, o.at, o.until].every((x) => Number.isInteger(x)) &&
    o.from <= step &&
    o.q >= -1 &&
    o.q < MEMBERS.length &&
    o.at <= step &&
    o.until <= step + WEIGH_STEPS &&
    ints(o.topics, 3) &&
    o.topics.every((t) => t >= 0 && t < TOPICS.length) &&
    ints(o.said, 3) &&
    o.said.every((x) => x >= -2 && x <= 2) &&
    ints(o.worth, 3)
  );
}
