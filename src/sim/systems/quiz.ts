/**
 * Quiz night (P30, docs/PLAN.md §9): a day card, 19:00–21:00, at the four places in the library.
 *
 * - **Joining** (EXT.QUIZ 0): within QUIZ_RANGE of a place, once a night. The three nearest
 *   inmates up and about (within QUIZ_CALL) are the contestants; they walk over (QUIZ_GATHER at
 *   most), then the questions are put.
 * - **The questions**: eight, ten seconds each, a pure function of the run and the day
 *   (`questionsOf`). Half escape history (a bank of written, checked facts), half this prison,
 *   made from the game's own data and constants, the way gossip is, so always true: the day's
 *   times, the guards' ways and keys, the cells, what a recipe makes, the day cards' hours.
 * - **The buzzers**: the first right answer takes the question. Each contestant buzzes at a step
 *   drawn by roll(), right with odds by its wits (an Intellect of its own, by roll() for its
 *   cell); one wrong is out of that question. The player answers with EXT.ANSWER (b = the
 *   choice); wrong, they're out of it too.
 * - **The end**: most points wins QUIZ_PRIZE and QUIZ_INTELLECT (a tie at the top, half of each),
 *   and QUIZ_WIN_OPINION with the contestants; playing it out, QUIZ_OPINION. Given up (EXT.QUIZ 1)
 *   or off (the player QUIZ_LEAVE away, a lockdown): nothing.
 */
import { BUZZ_MIN, BUZZ_SPAN, HISTORY, QUESTION_STEPS, QUIZ_CALL, QUIZ_GATHER, QUIZ_HISTORY, QUIZ_INTELLECT, QUIZ_LAST, QUIZ_LEAVE, QUIZ_OPINION, QUIZ_PRIZE, QUIZ_QUESTIONS, QUIZ_RANGE, QUIZ_WIN_OPINION, REVEAL_STEPS, RIGHT_BASE, RIGHT_PER, WITS_MIN, WITS_SPAN } from '../../content/nights';
import { DAY_BOOKS, EVENT_TIMES } from '../../content/days';
import { KEY_ITEM_COLORS } from '../../content/items';
import { RECIPES } from '../../content/recipes';
import { ROUTINE } from '../../content/routine';
import type { QuizPlace } from '../../content/prisons/types';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import type { Refusal, SimState } from '../state';
import { ATTR_MAX, UNIT } from '../tuning';
import { LAYER, type World } from '../world/World';
import { bodyAt, type Body } from './movement';
import { dayMinute, eventOn, prisonDay } from './calendar';
import { gameOn } from './games';
import { DOING } from './inmates';
import { ATTRS } from '../state';
import { changeOpinion, endTalk, refuse } from './social';
import { stopTraining } from './training';

/** A quiz under way (P30): plain data in the state. */
export interface Quiz {
  /** The contestants (inmate indexes), and the places each takes ([the player's, then theirs]). */
  who: number[];
  seats: number[];
  /** The step it began (the walk over), the question now (-1 walking over), the step it was put. */
  from: number;
  q: number;
  at: number;
  /** Points: the player's, then each contestant's. */
  pts: number[];
  /** What each said to this question (the choice, -1 nothing yet): the player, then the contestants. */
  said: number[];
  /** Who took it (-1 nobody yet, or nobody: time up; 0 the player, 1–3 a contestant); the step its answer stops being shown (0: still being asked). */
  got: number;
  until: number;
}

/** A choice as the card shows it: a time (minutes of the day), a guard (index), an item (id), a number, a key's colour, a history answer (its place in the text). */
export type Choice = { kind: 'time'; m: number } | { kind: 'guard'; k: number } | { kind: 'item'; id: string } | { kind: 'n'; n: number } | { kind: 'colour'; c: string } | { kind: 'h'; k: number };

/** A question: its text (`quiz.<id>`), what it needs (a guard, ingredients), the four choices, the right one. */
export interface Question {
  id: string;
  guard?: number;
  items?: string[];
  choices: Choice[];
  answer: number;
}

/** The prison's quiz places, if it has them. */
export const quizOf = (w: World): QuizPlace | null => w.def.leisure?.quiz ?? null;

/** Quiz night is on now. */
export const quizOn = (sim: SimContext) => !!quizOf(sim.world) && !sim.world.def.rules?.relaxed && eventOn(sim, 'quiz');

/** An inmate's wits (its Intellect for the quiz): the same all run, by its cell. */
export const witsOf = (salt: number, cell: number) => WITS_MIN + rollInt(salt, SALT.QUIZ, 0, cell, WITS_SPAN);

// ------------------------------------------------------------------ the questions

/** Shuffles a list by roll() (draw `k` of the night's). */
function shuffled<T>(list: readonly T[], salt: number, day: number, k: number): T[] {
  const out = [...list];
  for (let j = out.length - 1; j > 0; j--) {
    const i = rollInt(salt, SALT.QUIZ, day, k * 64 + j, j + 1);
    [out[j], out[i]] = [out[i], out[j]];
  }
  return out;
}

/** The hour as minutes of the day, n hours on (round the clock). */
const hours = (m: number, n: number) => (((m + n * 60) % 1440) + 1440) % 1440;

/** A time question: the right time among four an hour apart, in order (where it falls among them by roll()). */
function timeQuestion(id: string, m: number, salt: number, day: number, k: number): Question {
  const at = rollInt(salt, SALT.QUIZ, day, 800 + k, 4);
  const choices = [0, 1, 2, 3].map((j): Choice => ({ kind: 'time', m: hours(m, j - at) }));
  return { id, choices, answer: at };
}

/** The minutes of the day a routine block starts at (the prison day starts at 08:00 in clock minutes: ROUTINE's are clock minutes). */
const blockAt = (id: string) => ROUTINE.find((r) => r.id === id)!.start;

/** What a recipe needs, as plain item ids (none with a choice of items, none with keys). */
const plainRecipes = RECIPES.filter((r) => r.ingredients.every((i) => !i.includes('|') && !i.startsWith('key_') && !i.startsWith('mold_')) && !r.keep);

/** The questions about this prison that it can be asked (each always true in the running game). */
function prisonQuestions(sim: Pick<SimContext, 'prison'>, salt: number, day: number, mods: readonly string[]): Question[] {
  const p = sim.prison;
  const out: Question[] = [];
  out.push(timeQuestion('rollCall', blockAt('eveningRollCall'), salt, day, 0));
  out.push(timeQuestion('lightsOut', blockAt('lightsOut'), salt, day, 1));
  out.push(timeQuestion('breakfast', blockAt('breakfast'), salt, day, 2));
  out.push(timeQuestion('showers', blockAt('showers'), salt, day, 3));
  // The guards' ways: one with it, three without (named guards only).
  const named = p.guards.map((g, k) => ({ g, k })).filter((e) => !!e.g.name);
  for (const trait of ['corrupt', 'lazy', 'strict'] as const) {
    // (P26's Straight-Laced: nobody takes a bribe, nobody naps; those questions would be false.)
    if (trait !== 'strict' && mods.includes('straightLaced')) continue;
    const yes = named.filter((e) => e.g.trait === trait);
    const no = named.filter((e) => (e.g.trait ?? 'steady') !== trait);
    if (!yes.length || no.length < 3) continue;
    const right = yes[rollInt(salt, SALT.QUIZ, day, 500 + trait.length, yes.length)].k;
    const others = shuffled(no.map((e) => e.k), salt, day, 6 + trait.length).slice(0, 3);
    const choices = shuffled([right, ...others], salt, day, 9 + trait.length).map((k): Choice => ({ kind: 'guard', k }));
    out.push({ id: `trait.${trait}`, choices, answer: choices.findIndex((c) => c.kind === 'guard' && c.k === right) });
  }
  // A guard's key's colour.
  if (named.length) {
    const g = named[rollInt(salt, SALT.QUIZ, day, 600, named.length)];
    const others = shuffled(KEY_ITEM_COLORS.map(([c]) => c).filter((c) => c !== g.g.key), salt, day, 13).slice(0, 3);
    const choices = shuffled([g.g.key, ...others], salt, day, 14).map((c): Choice => ({ kind: 'colour', c }));
    out.push({ id: 'key', guard: g.k, choices, answer: choices.findIndex((c) => c.kind === 'colour' && c.c === g.g.key) });
  }
  // The cells in the block.
  // (Four two apart, in order, the right one where roll() puts it: never below one.)
  const cells = p.cells.length;
  const at = Math.min(rollInt(salt, SALT.QUIZ, day, 900, 4), Math.floor((cells - 1) / 2));
  out.push({ id: 'cells', choices: [0, 1, 2, 3].map((j): Choice => ({ kind: 'n', n: cells + 2 * (j - at) })), answer: at });
  // What a recipe makes.
  {
    const r = plainRecipes[rollInt(salt, SALT.QUIZ, day, 700, plainRecipes.length)];
    const others = shuffled([...new Set(plainRecipes.map((x) => x.result).filter((x) => x !== r.result))], salt, day, 15).slice(0, 3);
    const choices = shuffled([r.result, ...others], salt, day, 16).map((id): Choice => ({ kind: 'item', id }));
    out.push({ id: 'recipe', items: [...r.ingredients], choices, answer: choices.findIndex((c) => c.kind === 'item' && c.id === r.result) });
  }
  // The day cards' hours, where the deck deals them (minutes into the prison day + 08:00).
  const deck = DAY_BOOKS[p.id]?.deck ?? [];
  if (deck.includes('delivery')) out.push(timeQuestion('delivery', 480 + (EVENT_TIMES.delivery.at as number) + EVENT_TIMES.delivery.length - 1, salt, day, 4));
  if (deck.includes('visiting')) out.push(timeQuestion('visiting', 480 + (EVENT_TIMES.visiting.at as number), salt, day, 5));
  return out;
}

const asked = new Map<string, Question[]>();

/** The night's eight questions, in order: escape history and this prison by turns. Pure (and kept). */
export function questionsOf(sim: Pick<SimContext, 'prison'> & { state: Pick<SimState, 'salt' | 'mods'> }, day: number): Question[] {
  const salt = sim.state.salt;
  const mods = sim.state.mods ?? [];
  const key = `${sim.prison.id}:${salt}:${day}:${mods.join()}`;
  const had = asked.get(key);
  if (had) return had;
  const history = shuffled(HISTORY.map((_, k) => k), salt, day, 1)
    .slice(0, QUIZ_HISTORY)
    .map((k, j): Question => {
      const order = shuffled([0, 1, 2, 3], salt, day, 20 + j);
      return { id: `h.${HISTORY[k]}`, choices: order.map((a): Choice => ({ kind: 'h', k: a })), answer: order.indexOf(0) };
    });
  const local = shuffled(prisonQuestions(sim, salt, day, mods), salt, day, 2).slice(0, QUIZ_QUESTIONS - history.length);
  const out: Question[] = [];
  for (let k = 0; out.length < history.length + local.length; k++) {
    if (k < history.length) out.push(history[k]);
    if (k < local.length) out.push(local[k]);
  }
  if (asked.size > 64) asked.clear();
  asked.set(key, out);
  return out;
}

/** A contestant's buzz on a question: when (steps after it's put), and whether right; the wrong choice it gives otherwise. */
export function buzzOf(s: Pick<SimState, 'salt' | 'inmates'>, day: number, q: number, who: number, answer: number): { at: number; right: boolean; says: number } {
  const salt = s.salt;
  const wits = witsOf(salt, s.inmates[who]?.cell ?? 0);
  const at = BUZZ_MIN + rollInt(salt, SALT.QUIZ, day * 16 + q, 1000 + who, BUZZ_SPAN);
  const right = rollInt(salt, SALT.QUIZ, day * 16 + q, 2000 + who, 100) < RIGHT_BASE + Math.floor((wits * RIGHT_PER) / 100);
  const wrong = rollInt(salt, SALT.QUIZ, day * 16 + q, 3000 + who, 3);
  return { at, right, says: right ? answer : wrong >= answer ? wrong + 1 : wrong };
}

// ------------------------------------------------------------------ joining

/** A place's tile middle (units). */
const placeAt = (pl: QuizPlace, k: number) => bodyAt(pl.spots[k].x, pl.spots[k].z);

/** How far a point is from a place (tiles, the larger way). */
const offBy = (pl: QuizPlace, k: number, x: number, z: number) => Math.max(Math.abs(Math.floor(x / UNIT) - pl.spots[k].x), Math.abs(Math.floor(z / UNIT) - pl.spots[k].z));

/** The place nearest the player (within QUIZ_RANGE; -1 none). */
export function nearestPlace(sim: SimContext): number {
  const pl = quizOf(sim.world);
  const s = sim.state;
  if (!pl || s.layer !== LAYER.GROUND) return -1;
  let best = -1;
  let bestD = QUIZ_RANGE + 1;
  pl.spots.forEach((_, k) => {
    const d = offBy(pl, k, s.player.x, s.player.z);
    if (d < bestD) {
      best = k;
      bestD = d;
    }
  });
  return best;
}

const BUSY: ReadonlySet<number> = new Set([DOING.SLEEP, DOING.BOARD, DOING.CARDS, DOING.DICE, DOING.WRESTLE, DOING.LOOKOUT, DOING.BRAWL, DOING.DRUMS, DOING.GUITAR]);

/** The three contestants: the nearest inmates up and about to the places, not busy with the player or the crew (ties: the lower index); null if fewer. */
export function contestantsFor(sim: SimContext): number[] | null {
  const s = sim.state;
  const pl = quizOf(sim.world);
  if (!pl) return null;
  const c = placeAt(pl, 0);
  const pool: number[] = [];
  s.inmates.forEach((m, k) => {
    if (m.ko > 0 || m.angry > 0 || BUSY.has(m.doing) || s.talk === k || s.followers.includes(k)) return;
    if (s.match?.team.includes(k) || s.ink?.who === k || s.cheat?.who === k || s.shootout?.who === k || s.dice[0] === k || s.bout[0] === k) return;
    if (Math.max(Math.abs(m.body.x - c.x), Math.abs(m.body.z - c.z)) > QUIZ_CALL * UNIT) return;
    pool.push(k);
  });
  if (pool.length < 3) return null;
  const d2 = (k: number) => (s.inmates[k].body.x - c.x) ** 2 + (s.inmates[k].body.z - c.z) ** 2;
  return pool.sort((a, b) => d2(a) - d2(b) || a - b).slice(0, 3);
}

/** Why the player can't join the quiz now (null: they can). */
export function quizRefusal(sim: SimContext): Refusal | null {
  const s = sim.state;
  if (!quizOn(sim)) return 'quizClosed';
  if (s.lockdown) return 'gamesLockdown';
  if (s.quizDay === prisonDay(s.step)) return 'quizzed';
  // (Late in the evening there's no time for eight questions before roll call.)
  if (dayMinute(s.step) >= QUIZ_LAST) return 'quizLate';
  if (nearestPlace(sim) < 0) return 'notAtQuiz';
  if (!contestantsFor(sim)) return 'fewQuiz';
  return null;
}

/** Joining (EXT.QUIZ 0): the contestants walk over to their places. */
export function joinQuiz(sim: SimContext) {
  const s = sim.state;
  if (gameOn(s) || s.quiz || s.show) return;
  const why = quizRefusal(sim);
  if (why) return refuse(sim, why);
  const who = contestantsFor(sim)!;
  const mine = nearestPlace(sim);
  const seats = [mine, ...[0, 1, 2, 3].filter((k) => k !== mine)];
  stopTraining(sim);
  endTalk(sim);
  for (const k of who) {
    s.inmates[k].wait = 0;
    s.inmates[k].path = [];
  }
  s.quizDay = prisonDay(s.step);
  s.quiz = { who, seats, from: s.step, q: -1, at: 0, pts: [0, 0, 0, 0], said: [-1, -1, -1, -1], got: -1, until: 0 };
  sim.events.push({ type: 'quiz', what: 'start', who: who.slice() });
}

// ------------------------------------------------------------------ the questions put

/** The question being asked now (null walking over, or none). */
export function questionNow(sim: SimContext): Question | null {
  const o = sim.state.quiz;
  if (!o || o.q < 0) return null;
  return questionsOf(sim, prisonDay(o.from))[o.q] ?? null;
}

/** The player's answer (EXT.ANSWER b): while the question's being asked and they're not out of it. */
export function answerQuiz(sim: SimContext, choice: number) {
  const s = sim.state;
  const o = s.quiz;
  const q = questionNow(sim);
  if (!o || !q || o.until || o.said[0] >= 0 || choice < 0 || choice > 3) return;
  o.said[0] = choice;
  const right = choice === q.answer;
  sim.events.push({ type: 'quiz', what: right ? 'right' : 'wrong', by: 0, q: o.q, choice });
  if (right) taken(sim, 0);
}

/** The question taken (by 0 the player, 1–3 a contestant; -1 time up): its answer shown a moment. */
function taken(sim: SimContext, by: number) {
  const s = sim.state;
  const o = s.quiz!;
  o.got = by;
  if (by >= 0) o.pts[by]++;
  o.until = s.step + REVEAL_STEPS;
  if (by < 0) sim.events.push({ type: 'quiz', what: 'timeUp', q: o.q });
}

/** Each step of the quiz: off when it can't go on; the walk over; the buzzers; the next question; the end. */
export function keepQuiz(sim: SimContext) {
  const s = sim.state;
  const o = s.quiz;
  const pl = quizOf(sim.world);
  if (!o) return;
  if (!pl || s.lockdown || sim.away || s.sleeping || s.stowed || s.ko > 0 || s.layer !== LAYER.GROUND || offBy(pl, o.seats[0], s.player.x, s.player.z) > QUIZ_LEAVE) return endQuiz(sim, 'off');
  // (A contestant knocked out or going for the player: the quiz is off, never won by default.)
  if (o.who.some((k) => !s.inmates[k] || s.inmates[k].ko > 0 || s.inmates[k].angry > 0)) return endQuiz(sim, 'off');
  if (o.q < 0) {
    // Walking over: under way once all three are at their places, or after QUIZ_GATHER.
    const there = o.who.every((k, j) => {
      const m = s.inmates[k];
      return !m || m.ko > 0 || offBy(pl, o.seats[j + 1], m.body.x, m.body.z) === 0;
    });
    if (there || s.step - o.from >= QUIZ_GATHER) put(sim, 0);
    return;
  }
  if (o.until) {
    if (s.step < o.until) return;
    if (o.q + 1 >= QUIZ_QUESTIONS) return endQuiz(sim, 'done');
    return put(sim, o.q + 1);
  }
  const q = questionNow(sim);
  if (!q) return endQuiz(sim, 'done');
  const k = s.step - o.at;
  const day = prisonDay(o.from);
  // The buzzers, in order round the table: the first right takes it.
  for (let j = 0; j < 3; j++) {
    const m = s.inmates[o.who[j]];
    if (o.said[j + 1] >= 0 || !m) continue;
    const b = buzzOf(s, day, o.q, o.who[j], q.answer);
    if (b.at !== k) continue;
    o.said[j + 1] = b.says;
    sim.events.push({ type: 'quiz', what: b.right ? 'right' : 'wrong', by: j + 1, q: o.q, choice: b.says });
    if (b.right) return taken(sim, j + 1);
  }
  if (k >= QUESTION_STEPS || o.said.every((x) => x >= 0)) taken(sim, -1);
}

/** A question put. */
function put(sim: SimContext, q: number) {
  const o = sim.state.quiz!;
  o.q = q;
  o.at = sim.state.step;
  o.said = [-1, -1, -1, -1];
  o.got = -1;
  o.until = 0;
  sim.events.push({ type: 'quiz', what: 'question', q });
}

/** The quiz over: played out (the winner), given up (EXT.QUIZ 1), or off. */
export function endQuiz(sim: SimContext, how: 'done' | 'quit' | 'off') {
  const s = sim.state;
  const o = s.quiz;
  if (!o) return;
  s.quiz = null;
  if (how !== 'done') return void sim.events.push({ type: 'quiz', what: how, who: o.who.slice() });
  const top = Math.max(...o.pts.slice(1));
  const won = o.pts[0] > top;
  const tie = !won && o.pts[0] === top && top > 0;
  const prize = won ? QUIZ_PRIZE : tie ? Math.floor(QUIZ_PRIZE / 2) : 0;
  const gain = Math.min(ATTR_MAX - s.items.int, won ? QUIZ_INTELLECT : tie ? Math.floor(QUIZ_INTELLECT / 2) : 0);
  if (prize) {
    s.cash += prize;
    s.tally[3] += prize;
    sim.events.push({ type: 'cash', n: prize, why: 'quiz' });
  }
  if (gain > 0) {
    s.items.int += gain;
    s.items.rev++;
    s.trained |= 1 << ATTRS.indexOf('int');
  }
  for (const k of o.who) changeOpinion(sim, k, won ? QUIZ_WIN_OPINION : QUIZ_OPINION);
  sim.events.push({ type: 'quiz', what: won ? 'won' : tie ? 'tie' : 'lost', who: o.who.slice(), pts: o.pts.slice(), prize, int: Math.max(0, gain) });
}

/** The contestants at their places, facing the same way (socialNow). */
export function quizTargets(sim: SimContext, so: { follow: Array<Body | null>; gap: number[]; doing: number[]; face: number[] }) {
  const s = sim.state;
  const o = s.quiz;
  const pl = quizOf(sim.world);
  if (!o || !pl) return;
  o.who.forEach((k, j) => {
    const m = s.inmates[k];
    if (!m || m.ko > 0 || m.angry > 0) return;
    // (2.5.1: at his place now, whatever he was lingering over.)
    if (!sim.rules250) m.wait = 0;
    const at = marks[j];
    const c = pl.spots[o.seats[j + 1]];
    at.x = c.x * UNIT + UNIT / 2;
    at.z = c.z * UNIT + UNIT / 2;
    so.follow[k] = at;
    so.gap[k] = 0;
    so.doing[k] = DOING.QUIZ;
    so.face[k] = pl.face;
  });
}
const marks: Body[] = [0, 1, 2].map(() => bodyAt(0, 0));
