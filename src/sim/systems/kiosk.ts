/**
 * The internet kiosk (P35, docs/PLAN.md §11): a wall terminal in the library (`comms.kiosk`),
 * open in the free times outside a lockdown, for one at a time (inmates never use it: the escape
 * bots play as before).
 *
 * - **Logged in** (EXT.KIOSK LOGIN): $1 a block of ten game minutes, paid up front; the next
 *   block is paid as the last runs out. Walking away, the kiosk shutting or no dollar left for the
 *   next block logs the player out (what's left of a block is lost).
 * - **Mail** (WRITE, once a prison day): the week's money order (shared with the phone's call
 *   home: phone.ts askMoney), and a reply at a mail call after today with a drawing (roll()),
 *   pinned over the player's bed (PHOTO_WALL at most: a new one takes the oldest's place).
 * - **Shop** (ORDER, once a prison day, one order coming at a time): legal goods, paid at once,
 *   into the desk's open drawers at the next mail call (a full desk: the mail call after).
 * - **News**: the days ahead (the calendar's own, pure: nothing in here).
 * - **Courses** (COURSE, once a prison day; ANSWER, QUIT): COURSE_QUESTIONS from the quiz bank
 *   under SALT.COURSE (not quiz night's set); COURSE_PASS right gives COURSE_INT Intellect.
 * - **The hollow book**: a small item moved onto an empty hollow book goes inside it (its slot's
 *   upper bits, where wear is kept: no search reads them); the use button takes it out again.
 *
 * Every draw comes from roll() (SALT.KIOSK, SALT.COURSE), never the state's RNG.
 */
import { COURSE_ENERGY, COURSE_LATE, COURSE_FEE, COURSE_INT, COURSE_PASS, COURSE_QUESTIONS, COURSE_REVEAL, COURSE_STEPS, KIOSK, KIOSK_BLOCK, KIOSK_FEE, PHOTO_WALL, PHOTOS, SHOP, shopPrice } from '../../content/kiosk';
import { itemDef, itemNumber } from '../../content/items';
import { MAIL_MINUTE } from '../../content/phone';
import type { CommsDef } from '../../content/prisons/types';
import { SLOT } from '../command';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import { ATTRS, type Refusal, type SimState } from '../state';
import { ATTR_MAX, STEPS_PER_MINUTE, UNIT } from '../tuning';
import { containersOf } from '../world/containers';
import { dayMinute, prisonDay } from './calendar';
import { clockAt } from './clock';
import { routineEnd } from '../../content/routine';
import { freeHotbar, itemOf, slot, usesOf } from './items';
import { askMoney, commsOf, phoneOpen } from './phone';
import { questionsOf, type Question } from './quiz';
import { endTalk, refuse } from './social';
import { HOLLOW_BOOK } from './structure';
import { stopTraining } from './training';
import { powered } from './power';
import { LAYER } from '../world/World';


/** The prison's kiosk: where the player stands to use it (none at the Training Block). */
export const kioskOf = (sim: Pick<SimContext, 'world'>): CommsDef['kiosk'] | null => commsOf(sim)?.kiosk ?? null;

/** The kiosk's hours: the phone's (the free times, outside a lockdown or a drill), with the lights on (a power cut shuts it). */
export const kioskOpen = (sim: SimContext) => !!kioskOf(sim) && phoneOpen(sim) && powered(sim.world, sim.state, 'lights');

/** At the kiosk: on its tile or one beside it, in the library (not through its wall). */
export function atKiosk(sim: SimContext): boolean {
  const k = kioskOf(sim);
  const s = sim.state;
  if (!k || s.layer !== LAYER.GROUND || sim.away || s.stowed || s.sleeping || s.ko > 0) return false;
  const x = Math.floor(s.player.x / UNIT);
  const z = Math.floor(s.player.z / UNIT);
  return Math.max(Math.abs(x - k.x), Math.abs(z - k.z)) <= 1 && sim.world.zoneAt(x, z) === sim.world.zoneAt(k.x, k.z);
}

/** Logged in (time paid for): the step it runs out at, 0 when logged out. */
export const loggedIn = (s: Pick<SimState, 'kiosk'>) => s.kiosk > 0;

/** The course's question now (null: no course). */
export function courseQuestion(sim: Pick<SimContext, 'prison' | 'state'>): Question | null {
  const c = sim.state.course;
  if (!c.length) return null;
  return questionsOf(sim, prisonDay(c[0]), SALT.COURSE, COURSE_QUESTIONS, 2)[c[1]] ?? null;
}

/** The drawing a letter written on a day brings back: one not on the wall yet if there is one, by roll(). */
function replyDrawing(s: Pick<SimState, 'salt' | 'photos'>, day: number): number {
  const fresh = PHOTOS.map((_, k) => k).filter((k) => !s.photos.includes(k));
  const pool = fresh.length ? fresh : PHOTOS.map((_, k) => k);
  return pool[rollInt(s.salt, SALT.KIOSK, day, 0, pool.length)];
}

/** What a slot hides, if it's a hollow book (0: nothing, or not a hollow book). */
export { HOLLOW_BOOK };
export const hiddenIn = (v: number) => (itemOf(v) === HOLLOW_BOOK ? usesOf(v) : 0);

// ------------------------------------------------------------------ asking

/** Why the player can't do this at the kiosk now (null: they can). */
export function kioskRefusal(sim: SimContext, b: number, c = 0): Refusal | null {
  const s = sim.state;
  if (!kioskOf(sim)) return 'noKiosk';
  if (b === KIOSK.LOGOUT) return loggedIn(s) ? null : 'loggedOut';
  if (b === KIOSK.QUIT || b === KIOSK.ANSWER) return s.course.length ? null : 'loggedOut';
  if (!kioskOpen(sim)) return s.lockdown ? 'gamesLockdown' : phoneOpen(sim) ? 'kioskDark' : 'kioskClosed';
  if (!atKiosk(sim)) return 'notAtKiosk';
  if (b === KIOSK.LOGIN) return loggedIn(s) ? 'loggedIn' : s.cash < KIOSK_FEE ? 'cash' : null;
  if (!loggedIn(s)) return 'loggedOut';
  const day = prisonDay(s.step);
  if (b === KIOSK.WRITE) return s.post[0] === day ? 'wrote' : null;
  if (b === KIOSK.ORDER) {
    const id = SHOP[c];
    if (!id) return 'noKiosk';
    if (s.post[3] > 0) return 'orderComing';
    if (s.post[4] === day) return 'shopToday';
    return s.cash < shopPrice(id) ? 'cash' : null;
  }
  if (b === KIOSK.COURSE) {
    if (s.course.length) return 'inCourse';
    if (s.post[5] === day) return 'coursed';
    // (Not with the free time nearly over: the kiosk would shut mid-course, the fee lost.)
    if ((((routineEnd(s.routine) - clockAt(s.step).minuteOfDay) % 1440) + 1440) % 1440 < COURSE_LATE) return 'courseLate';
    if (s.energy < COURSE_ENERGY) return 'tired';
    return s.cash < COURSE_FEE ? 'cash' : null;
  }
  return 'noKiosk';
}

/** At the kiosk (EXT.KIOSK b, c). */
export function kioskOp(sim: SimContext, b: number, c: number) {
  const why = kioskRefusal(sim, b, c);
  if (why) return refuse(sim, why);
  const s = sim.state;
  const day = prisonDay(s.step);
  switch (b) {
    case KIOSK.LOGIN:
      endTalk(sim);
      stopTraining(sim);
      pay(sim, KIOSK_FEE);
      s.kiosk = s.step + KIOSK_BLOCK;
      sim.events.push({ type: 'kiosk', what: 'login' });
      return;
    case KIOSK.LOGOUT:
      return logOut(sim, 'asked');
    case KIOSK.WRITE: {
      s.post[0] = day;
      // (A reply already on its way stays the one coming.)
      if (!s.post[1]) {
        s.post[1] = replyDrawing(s, day) + 1;
        s.post[2] = day;
      }
      const n = askMoney(sim);
      sim.events.push({ type: 'kiosk', what: 'wrote', n });
      return;
    }
    case KIOSK.ORDER: {
      const item = itemNumber(SHOP[c]);
      pay(sim, shopPrice(SHOP[c]));
      s.post[3] = item;
      s.post[4] = day;
      sim.events.push({ type: 'kiosk', what: 'ordered', item });
      return;
    }
    case KIOSK.COURSE:
      pay(sim, COURSE_FEE);
      s.energy -= COURSE_ENERGY;
      s.post[5] = day;
      s.course = [s.step, 0, 0, s.step, -1, 0];
      sim.events.push({ type: 'kiosk', what: 'course' }, { type: 'kiosk', what: 'question', q: 0 });
      return;
    case KIOSK.ANSWER:
      return answer(sim, c);
    case KIOSK.QUIT:
      s.course = [];
      sim.events.push({ type: 'kiosk', what: 'quit' });
      return;
  }
}

function pay(sim: SimContext, n: number) {
  sim.state.cash -= n;
  sim.events.push({ type: 'cash', n: -n, why: 'kiosk' });
}

/** Logged out: the time left is lost, a course under way with it. */
function logOut(sim: SimContext, why: 'asked' | 'left' | 'closed' | 'broke') {
  const s = sim.state;
  s.kiosk = 0;
  if (s.course.length) {
    s.course = [];
    sim.events.push({ type: 'kiosk', what: 'quit' });
  }
  sim.events.push({ type: 'kiosk', what: 'logout', why });
}

// ------------------------------------------------------------------ courses

/** An answer to the course's question (once, before its time is up). */
function answer(sim: SimContext, choice: number) {
  const s = sim.state;
  const c = s.course;
  const q = courseQuestion(sim);
  if (!q || c[5] || c[4] !== -1 || choice < 0 || choice > 3) return;
  const right = choice === q.answer;
  if (right) c[2]++;
  c[4] = choice;
  c[5] = s.step + COURSE_REVEAL;
  sim.events.push({ type: 'kiosk', what: 'answer', q: c[1], choice, right });
}

/** The course goes on: time up on a question, the next one put, the end (passed or not). */
function keepCourse(sim: SimContext) {
  const s = sim.state;
  const c = s.course;
  if (!c.length) return;
  if (!c[5]) {
    if (s.step - c[3] < COURSE_STEPS) return;
    c[4] = -2;
    c[5] = s.step + COURSE_REVEAL;
    sim.events.push({ type: 'kiosk', what: 'timeUp', q: c[1] });
    return;
  }
  if (s.step < c[5]) return;
  if (c[1] + 1 < COURSE_QUESTIONS) {
    c[1]++;
    c[3] = s.step;
    c[4] = -1;
    c[5] = 0;
    sim.events.push({ type: 'kiosk', what: 'question', q: c[1] });
    return;
  }
  const n = c[2];
  s.course = [];
  if (n < COURSE_PASS) return void sim.events.push({ type: 'kiosk', what: 'failed', n });
  const gain = Math.max(0, Math.min(COURSE_INT, ATTR_MAX - s.items.int));
  if (gain) {
    s.items.int += gain;
    s.items.rev++;
    s.trained |= 1 << ATTRS.indexOf('int');
  }
  sim.events.push({ type: 'kiosk', what: 'passed', n, int: gain });
}

// ------------------------------------------------------------------ mail call

/** 12:00, outside a lockdown (phone.ts pays the money order): the shop's goods into the desk, a reply's drawing on the wall. */
function mailCall(sim: SimContext) {
  const s = sim.state;
  if (s.lockdown) return;
  const day = prisonDay(s.step);
  if (s.post[1] && s.post[2] < day) {
    const d = s.post[1] - 1;
    s.photos = [...s.photos.filter((x) => x !== d), d].slice(-PHOTO_WALL);
    s.post[1] = 0;
    s.post[2] = 0;
    sim.events.push({ type: 'kiosk', what: 'photo', n: d });
  }
  const item = s.post[3];
  if (!item) return;
  const list = containersOf(sim.world);
  const desk = list.findIndex((c) => c.mine && c.prop.kind === 'desk');
  const box = desk >= 0 ? s.items.containers[desk] : null;
  // (The open drawers only: never into the hidden ones, the first `hidden` slots, kept for what's hidden.)
  const free = box ? box.indexOf(0, list[desk].hidden) : -1;
  if (!box || free < 0) return void sim.events.push({ type: 'kiosk', what: 'goodsWait', item });
  box[free] = slot(item);
  s.items.rev++;
  s.post[3] = 0;
  sim.events.push({ type: 'kiosk', what: 'goods', item });
}

// ------------------------------------------------------------------ the hollow book

/** An item moved onto an empty hollow book (OP.MOVE): a small one goes inside. Whether it was. */
export function bookMove(sim: SimContext, from: number, to: number): boolean {
  const it = sim.state.items;
  const get = (addr: number) => (addr < SLOT.CONTAINER ? it.inv[addr] : it.containers[it.open]?.[addr - SLOT.CONTAINER]);
  const va = get(from);
  const vb = get(to);
  if (!va || !vb || from === to || itemOf(vb) !== HOLLOW_BOOK || usesOf(vb)) return false;
  if (!itemDef(itemOf(va)).small) return false;
  const set = (addr: number, v: number) => {
    if (addr < SLOT.CONTAINER) it.inv[addr] = v;
    else it.containers[it.open][addr - SLOT.CONTAINER] = v;
  };
  set(to, vb | (va << 8));
  set(from, 0);
  it.rev++;
  sim.events.push({ type: 'kiosk', what: 'hidden', item: itemOf(va) });
  return true;
}

/** The hollow book in hand opened (the use button): what's inside into a free hotbar slot. */
export function openBook(sim: SimContext) {
  const it = sim.state.items;
  const v = it.inv[it.hand];
  const inside = hiddenIn(v);
  if (!inside) return;
  const k = freeHotbar(it.inv);
  if (k < 0) return void sim.events.push({ type: 'full' });
  it.inv[k] = inside;
  it.inv[it.hand] = slot(HOLLOW_BOOK);
  it.rev++;
  sim.events.push({ type: 'kiosk', what: 'unhidden', item: itemOf(inside) });
}

// ------------------------------------------------------------------ each step

/** Each step: mail call's goods and drawings, the time paid for (or logged out), the course. */
export function kiosk(sim: SimContext) {
  const s = sim.state;
  if (!kioskOf(sim)) return;
  if (s.step % STEPS_PER_MINUTE === 0 && dayMinute(s.step) === MAIL_MINUTE) mailCall(sim);
  if (!loggedIn(s)) return;
  if (!kioskOpen(sim)) return logOut(sim, 'closed');
  if (!atKiosk(sim)) return logOut(sim, 'left');
  if (s.step >= s.kiosk) {
    if (s.cash < KIOSK_FEE) return logOut(sim, 'broke');
    pay(sim, KIOSK_FEE);
    s.kiosk = s.step + KIOSK_BLOCK;
    sim.events.push({ type: 'kiosk', what: 'paid' });
  }
  keepCourse(sim);
}
