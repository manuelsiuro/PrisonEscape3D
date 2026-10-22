/**
 * The internet kiosk (P35, docs/PLAN.md §11), through the real simulation:
 * - the data: every campaign prison's kiosk (open floor in the library before a wall, clear of
 *   what stands on the floor, out of the rows a wall hides, reachable); none at the Training Block;
 * - logging in: its hours and refusals, $1 a block of ten game minutes paid up front, the next
 *   block as one runs out, logged out walking away, broke, or as the kiosk shuts;
 * - mail: a letter home once a prison day; the money order shared with the phone (one a week);
 *   the reply's drawing at a mail call after the day it was written, never the same day, at most
 *   PHOTO_WALL pinned (the oldest goes), held over a lockdown;
 * - the shop: legal goods only, cheaper than a merchant asks a stranger; once a prison day, one
 *   order coming at a time; into the desk's open drawers at mail call; a full desk keeps it waiting;
 * - the news: the days ahead as the calendar has them (planOf, pure) are the days that come;
 * - courses: a set of its own (not quiz night's), its fee and energy, once a prison day; all right
 *   (Intellect), three right, time up, given up, logged out mid-course;
 * - the hollow book: made from a thick book (the razor kept); a small item hidden inside, past a
 *   detector's frisk, a cell search and the guards after a capture, but not a dog's nose; taken out;
 * - saves mid-course, a save from before the kiosk, damaged numbers.
 */
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { TRAINING } from '../src/content/prisons/training';
import { DECOR } from '../src/content/decor';
import { itemDef, itemNumber } from '../src/content/items';
import { RECIPES } from '../src/content/recipes';
import { COURSE_ENERGY, COURSE_FEE, COURSE_INT, COURSE_QUESTIONS, COURSE_STEPS, KIOSK, KIOSK_BLOCK, NEWS_DAYS, PHOTO_WALL, SHOP, shopPrice } from '../src/content/kiosk';
import { MONEY_EVERY } from '../src/content/phone';
import { CALLEE } from '../src/content/phone';
import { command, EXT, OP, SLOT, TALK } from '../src/sim/command';
import { SALT } from '../src/sim/rng';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { loadState } from '../src/sim/state';
import { DAY_STEPS } from '../src/sim/systems/clock';
import { planOf, today } from '../src/sim/systems/calendar';
import { priceOf } from '../src/sim/systems/economy';
import { assign, GUARD } from '../src/sim/systems/guards';
import { slot } from '../src/sim/systems/items';
import { wakeUp } from '../src/sim/systems/justice';
import { smellsOfContraband } from '../src/sim/systems/k9';
import { courseQuestion, hiddenIn, HOLLOW_BOOK, kioskOf } from '../src/sim/systems/kiosk';
import { frisk } from '../src/sim/systems/power';
import { questionsOf } from '../src/sim/systems/quiz';
import { OPINION_START, STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { containersOf } from '../src/sim/world/containers';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';

const at = (day: number, hour: number, minute = 0) => (day - 1) * DAY_STEPS + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
const of = <T extends SimEvent['type']>(seen: SimEvent[], type: T) => seen.filter((e) => e.type === type) as Array<Extract<SimEvent, { type: T }>>;
const news = (seen: SimEvent[], what: string) => of(seen, 'kiosk').filter((e) => e.what === what);
const refusals = (seen: SimEvent[]) => of(seen, 'refused').map((e) => e.why);
const n = itemNumber;

/** A game kept calm (lockdowns cleared each step), quiet days. */
function game(prison = CENTER_PERKS, seed = 5) {
  const sim = new Sim(prison, seed);
  sim.state.calendar = [[0, 0, 0]];
  const seen: SimEvent[] = [];
  let calm = true;
  const step = (cmd = 0) => {
    sim.step(cmd);
    seen.push(...sim.events);
    if (calm && sim.state.lockdown) sim.state.lockdown = false;
  };
  const jump = (day: number, hour: number, minute = 0) => {
    if (Math.floor((at(day, hour, minute) - 1) / DAY_STEPS) !== Math.floor(sim.state.step / DAY_STEPS)) sim.state.eventFlags = 0;
    sim.state.step = at(day, hour, minute) - 1;
    sim.state.attended = true;
    sim.state.excused = true;
    step();
  };
  const to = (day: number, hour: number, minute = 0) => {
    const target = at(day, hour, minute);
    while (sim.state.step < target && !sim.state.escaped) step();
  };
  const ext = (b: number, c = 0) => step(command(0, OP.EXT, EXT.KIOSK, b, c));
  /** The player at the kiosk, facing it. */
  const toKiosk = () => {
    const k = prison.comms!.kiosk;
    put(sim.state.player, k.x, k.z);
    sim.state.player.facing = k.face;
  };
  const setCalm = (on: boolean) => (calm = on);
  return { sim, seen, step, jump, to, ext, toKiosk, setCalm };
}

const put = (b: { x: number; z: number }, x: number, z: number) => {
  b.x = x * UNIT + UNIT / 2;
  b.z = z * UNIT + UNIT / 2;
};

/** The player's desk (its index among the containers, and its first open drawer). */
function deskOf(sim: Sim) {
  const list = containersOf(sim.world);
  const k = list.findIndex((c) => c.mine && c.prop.kind === 'desk');
  return { k, box: sim.state.items.containers[k], hidden: list[k].hidden };
}

// ------------------------------------------------------------------ the data
{
  const lines: string[] = [];
  for (const p of PRISONS) {
    const sim = new Sim(p, 1);
    const w = sim.world;
    const k = p.comms?.kiosk;
    check(!!k, `${p.id}: a kiosk`);
    if (!k) continue;
    const onFloor = (x: number, z: number) => w.props.some((o) => x >= o.x && x < o.x + o.w && z >= o.z && z < o.z + o.d) || (p.decor ?? []).some((d) => !DECOR[d.kind].wall && x >= d.x && x < d.x + (d.w ?? 1) && z >= d.z && z < d.z + (d.d ?? 1));
    const zone = w.zoneAt(k.x, k.z);
    check(!w.blocked(k.x, k.z) && !onFloor(k.x, k.z) && zone === 'library', `${p.id}: the kiosk's tile is open floor in the library (${zone})`);
    const dx = k.face === 1 ? 1 : k.face === 9 ? -1 : 0;
    const dz = k.face === 13 ? -1 : k.face === 5 ? 1 : 0;
    check(k.face !== 5 && w.blocked(k.x + dx, k.z + dz), `${p.id}: it hangs on a wall the camera sees (north, or a side wall)`);
    const wallDecor = (p.decor ?? []).filter((d) => DECOR[d.kind].wall && d.x <= k.x && d.x + (d.w ?? 1) > k.x && d.z <= k.z && d.z + (d.d ?? 1) > k.z);
    check(wallDecor.length === 0, `${p.id}: nothing else hangs on its bit of wall (${wallDecor.map((d) => d.kind).join(' ')})`);
    // (Never in the two rows a wall south of it hides.)
    check(!w.blocked(k.x, k.z + 1) && !w.blocked(k.x, k.z + 2), `${p.id}: no wall in the two rows in front of it (the camera's side)`);
    w.setPlayerKeys(new Set([1, 2, 3, 4, 5]) as never);
    const from = sim.state.player;
    const reach = new Set<number>([Math.floor(from.z / UNIT) * MAP_W + Math.floor(from.x / UNIT)]);
    const queue = [...reach];
    while (queue.length) {
      const t = queue.pop()!;
      const x = t % MAP_W;
      const z = Math.floor(t / MAP_W);
      for (const [ddx, ddz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nt = (z + ddz) * MAP_W + x + ddx;
        if (reach.has(nt) || !w.inside(x + ddx, z + ddz) || w.npcBlock[nt]) continue;
        reach.add(nt);
        queue.push(nt);
      }
    }
    check(reach.has(k.z * MAP_W + k.x), `${p.id}: the kiosk can be walked to`);
    lines.push(`${p.id}: kiosk ${k.x},${k.z} facing ${k.face}`);
  }
  check(!TRAINING.comms && !kioskOf(new Sim(TRAINING, 1)), 'the Training Block has none');
  console.log(lines.join('\n'));
}

// ------------------------------------------------------------------ the shop's goods
{
  for (const id of SHOP) {
    const d = itemDef(n(id));
    check(!d.contraband, `the shop sells ${id}: legal`);
    check(shopPrice(id) < priceOf(d.value, OPINION_START), `${id}: $${shopPrice(id)}, under a merchant's $${priceOf(d.value, OPINION_START)} to a stranger`);
  }
  console.log(`shop: ${SHOP.map((id) => `${id} $${shopPrice(id)}`).join(', ')}`);
}

// ------------------------------------------------------------------ logging in and the bill
{
  const g = game();
  const { sim, seen } = g;
  g.jump(1, 9, 30);
  g.toKiosk();
  sim.state.cash = 3;
  g.ext(KIOSK.LOGIN);
  check(refusals(seen).at(-1) === 'kioskClosed' && !sim.state.kiosk, 'shut at breakfast');
  g.jump(1, 10, 2);
  put(sim.state.player, 30, 40);
  g.ext(KIOSK.LOGIN);
  check(refusals(seen).at(-1) === 'notAtKiosk', 'away from it: not at the kiosk');
  g.toKiosk();
  g.ext(KIOSK.WRITE);
  check(refusals(seen).at(-1) === 'loggedOut', 'a letter needs logging in first');
  g.ext(KIOSK.LOGIN);
  check(sim.state.kiosk === sim.state.step + KIOSK_BLOCK && sim.state.cash === 2 && news(seen, 'login').length === 1, 'logged in: $1, ten minutes paid');
  g.ext(KIOSK.LOGIN);
  check(refusals(seen).at(-1) === 'loggedIn', 'not twice');
  for (let k = 0; k < KIOSK_BLOCK; k++) g.step();
  check(news(seen, 'paid').length === 1 && sim.state.cash === 1, 'the next block paid as the first runs out');
  for (let k = 0; k < KIOSK_BLOCK; k++) g.step();
  check(news(seen, 'paid').length === 2 && sim.state.cash === 0, 'and the next');
  for (let k = 0; k < KIOSK_BLOCK; k++) g.step();
  const out = news(seen, 'logout');
  check(out.length === 1 && out[0].why === 'broke' && !sim.state.kiosk && sim.state.cash === 0, 'no dollar for the next: logged out');
  sim.state.cash = 10;
  g.ext(KIOSK.LOGIN);
  put(sim.state.player, sim.prison.comms!.kiosk.x, sim.prison.comms!.kiosk.z + 3);
  g.step();
  check(news(seen, 'logout').at(-1)?.why === 'left' && !sim.state.kiosk, 'walked away: logged out');
  g.toKiosk();
  sim.state.cash = 30;
  g.ext(KIOSK.LOGIN);
  g.to(1, 12, 1);
  check(news(seen, 'logout').at(-1)?.why === 'closed' && !sim.state.kiosk, 'free time over: logged out');
  g.jump(1, 18, 5);
  g.toKiosk();
  sim.state.lockdown = true;
  g.setCalm(false);
  g.ext(KIOSK.LOGIN);
  check(refusals(seen).at(-1) === 'gamesLockdown', 'shut in a lockdown');
  sim.state.lockdown = false;
  g.setCalm(true);
  g.toKiosk();
  g.ext(KIOSK.LOGOUT);
  check(refusals(seen).at(-1) === 'loggedOut', 'logging out logged out: refused');
  // A power cut: the screen goes dark, logged out, no logging in till it's back.
  g.ext(KIOSK.LOGIN);
  sim.state.powerOff = 50;
  g.step();
  check(news(seen, 'logout').at(-1)?.why === 'closed' && !sim.state.kiosk, 'a power cut: logged out');
  g.ext(KIOSK.LOGIN);
  check(refusals(seen).at(-1) === 'kioskDark', 'and dark till the power is back');
  sim.state.powerOff = 0;
  g.ext(KIOSK.LOGIN);
  g.ext(KIOSK.LOGOUT);
  check(news(seen, 'logout').at(-1)?.why === 'asked' && !sim.state.kiosk, 'logged out when asked');
}

// ------------------------------------------------------------------ mail: letters, money orders, drawings
{
  const g = game();
  const { sim, seen } = g;
  g.jump(1, 10, 2);
  g.toKiosk();
  sim.state.cash = 50;
  g.ext(KIOSK.LOGIN);
  g.ext(KIOSK.WRITE);
  const wrote = news(seen, 'wrote');
  check(wrote.length === 1 && (wrote[0].n ?? 0) > 0 && sim.state.phoned[1] === wrote[0].n, 'a letter home: the week\'s money order asked for');
  const coming = sim.state.post[1];
  check(coming > 0 && sim.state.post[2] === 1, 'and a reply on its way');
  g.ext(KIOSK.WRITE);
  check(refusals(seen).at(-1) === 'wrote', 'one letter a prison day');
  g.ext(KIOSK.LOGOUT);
  const cash = sim.state.cash;
  g.to(1, 12, 1);
  check(sim.state.cash === cash + wrote[0].n! && sim.state.photos.length === 0 && news(seen, 'photo').length === 0, 'mail call: the money, but no reply the same day');
  g.to(2, 12, 1);
  const photo = news(seen, 'photo');
  check(photo.length === 1 && sim.state.photos.join() === String(coming - 1) && sim.state.post[1] === 0, 'the next day\'s mail call: the drawing pinned over the bed');
  // A week on, the phone's call home brings no second money order that week.
  g.jump(3, 10, 2);
  g.toKiosk();
  g.ext(KIOSK.LOGIN);
  g.ext(KIOSK.WRITE);
  check(news(seen, 'wrote').at(-1)?.n === 0, 'a second letter that week: no money order');
  // Drawings: never more than PHOTO_WALL, the oldest goes; a new one is one not up yet.
  for (let day = 4; day <= 9; day++) {
    g.jump(day, 10, 2);
    g.toKiosk();
    g.ext(KIOSK.LOGIN);
    g.ext(KIOSK.WRITE);
    g.to(day + 1, 12, 1);
  }
  check(sim.state.photos.length === PHOTO_WALL && new Set(sim.state.photos).size === PHOTO_WALL, `at most ${PHOTO_WALL} pinned, all different (${sim.state.photos.join(' ')})`);
  check(news(seen, 'wrote').filter((e) => (e.n ?? 0) > 0).length === 2, `money orders a week apart (days 1 and ${1 + MONEY_EVERY})`);
  // A lockdown at noon: the reply waits for the next mail call.
  g.jump(12, 10, 2);
  g.toKiosk();
  g.ext(KIOSK.LOGIN);
  g.ext(KIOSK.WRITE);
  const before = news(seen, 'photo').length;
  g.jump(13, 11, 59);
  g.setCalm(false);
  sim.state.lockdown = true;
  g.to(13, 12, 1);
  check(news(seen, 'photo').length === before && sim.state.post[1] > 0, 'a lockdown at noon: no mail');
  sim.state.lockdown = false;
  g.setCalm(true);
  g.to(14, 12, 1);
  check(news(seen, 'photo').length === before + 1, 'the reply at the next mail call');
}

// ------------------------------------------------------------------ the shop
{
  const g = game();
  const { sim, seen } = g;
  g.jump(1, 10, 2);
  g.toKiosk();
  sim.state.cash = 40;
  g.ext(KIOSK.LOGIN);
  const book = SHOP.indexOf('thick_book');
  g.ext(KIOSK.ORDER, book);
  check(news(seen, 'ordered').length === 1 && sim.state.cash === 40 - 1 - shopPrice('thick_book') && sim.state.post[3] === n('thick_book'), 'a thick book ordered, paid at once');
  g.ext(KIOSK.ORDER, SHOP.indexOf('soap'));
  check(refusals(seen).at(-1) === 'orderComing', 'one order coming at a time');
  const desk = deskOf(sim);
  g.to(1, 12, 1);
  const got = news(seen, 'goods');
  const k = desk.box.indexOf(n('thick_book'));
  check(got.length === 1 && k >= desk.hidden && sim.state.post[3] === 0, 'mail call: into the desk\'s open drawers');
  g.jump(1, 18, 5);
  g.toKiosk();
  g.ext(KIOSK.LOGIN);
  g.ext(KIOSK.ORDER, SHOP.indexOf('soap'));
  check(refusals(seen).at(-1) === 'shopToday', 'one order a prison day');
  // A full desk: the order waits.
  g.jump(2, 10, 2);
  g.toKiosk();
  g.ext(KIOSK.LOGIN);
  g.ext(KIOSK.ORDER, SHOP.indexOf('chocolate'));
  for (let j = desk.hidden; j < desk.box.length; j++) desk.box[j] = desk.box[j] || slot(n('sock'));
  g.to(2, 12, 1);
  check(news(seen, 'goodsWait').length === 1 && sim.state.post[3] === n('chocolate'), 'a full desk: it waits');
  desk.box[desk.hidden] = 0;
  g.to(3, 12, 1);
  check(news(seen, 'goods').length === 2 && desk.box[desk.hidden] === slot(n('chocolate')), 'room made: the next mail call');
  g.ext(KIOSK.ORDER, 99);
  check(refusals(seen).length > 0, 'nothing off the end of the list');
}

// ------------------------------------------------------------------ the news: the days ahead are the days that come
{
  const g = game(CENTER_PERKS, 9);
  const { sim } = g;
  sim.state.calendar = [];
  g.jump(2, 10);
  const ahead = [1, 2, 3].slice(0, NEWS_DAYS).map((d) => planOf(sim, 2 + d));
  for (let d = 1; d <= NEWS_DAYS; d++) {
    g.jump(2 + d, 9);
    const p = today(sim);
    const was = ahead[d - 1];
    check(p.event === was.event && p.weather === was.weather && p.wind === was.wind && p.windForce === was.windForce, `day ${2 + d}: as the news said (${was.event}, ${was.weather})`);
  }
  console.log(`news from day 2 (seed 9): ${ahead.map((p) => `day ${p.day} ${p.event} ${p.weather} wind ${p.wind}/${p.windForce}`).join('; ')}`);
}

// ------------------------------------------------------------------ courses
{
  const g = game();
  const { sim, seen } = g;
  const quiz = questionsOf(sim, 1).map((q) => q.id + q.answer).join();
  const course = questionsOf(sim, 1, SALT.COURSE, COURSE_QUESTIONS, 2);
  check(course.length === COURSE_QUESTIONS && course.map((q) => q.id + q.answer).join() !== quiz.slice(0, course.length), 'a course: its own questions, not quiz night\'s');
  check(course.filter((q) => q.id.startsWith('h.')).length === 2, 'two of escape history, three of this prison');
  g.jump(1, 10, 2);
  g.toKiosk();
  sim.state.cash = 30;
  sim.state.energy = 50;
  const int0 = sim.state.items.int;
  g.ext(KIOSK.LOGIN);
  g.ext(KIOSK.COURSE);
  check(sim.state.course.length === 6 && sim.state.cash === 30 - 1 - COURSE_FEE && sim.state.energy === 50 - COURSE_ENERGY, `a course begun: $${COURSE_FEE} and ${COURSE_ENERGY} energy`);
  for (let q = 0; q < COURSE_QUESTIONS; q++) {
    const now = courseQuestion(sim)!;
    check(now.id === course[q].id, `question ${q + 1} is the course's own`);
    g.ext(KIOSK.ANSWER, now.answer);
    while (sim.state.course.length && sim.state.course[1] === q) g.step();
  }
  const passed = news(seen, 'passed');
  check(passed.length === 1 && passed[0].n === COURSE_QUESTIONS && sim.state.items.int === int0 + COURSE_INT, `all right: passed, +${COURSE_INT} Intellect`);
  g.ext(KIOSK.COURSE);
  check(refusals(seen).at(-1) === 'coursed', 'one course a prison day');
  // Day 2: three right, one wrong, one let run out: failed.
  g.jump(2, 10, 2);
  g.toKiosk();
  sim.state.cash = 30;
  sim.state.energy = COURSE_ENERGY - 1;
  g.ext(KIOSK.LOGIN);
  g.ext(KIOSK.COURSE);
  check(refusals(seen).at(-1) === 'tired', 'too tired for a course');
  sim.state.energy = 60;
  g.ext(KIOSK.COURSE);
  for (let q = 0; q < COURSE_QUESTIONS; q++) {
    const now = courseQuestion(sim)!;
    if (q < 3) g.ext(KIOSK.ANSWER, now.answer);
    else if (q === 3) g.ext(KIOSK.ANSWER, (now.answer + 1) % 4);
    while (sim.state.course.length && sim.state.course[1] === q) g.step();
  }
  check(news(seen, 'timeUp').length === 1, `a question left unanswered: time up after ${COURSE_STEPS / STEPS_PER_MINUTE} minutes`);
  const failed = news(seen, 'failed');
  check(failed.length === 1 && failed[0].n === 3 && sim.state.items.int === int0 + COURSE_INT, 'three right: failed, nothing gained');
  // Too late in the free time: refused.
  g.jump(2, 11, 40);
  g.toKiosk();
  sim.state.post[5] = 0;
  g.ext(KIOSK.LOGIN);
  g.ext(KIOSK.COURSE);
  check(refusals(seen).at(-1) === 'courseLate' && !sim.state.course.length, 'twenty minutes before the kiosk shuts: no course');
  g.ext(KIOSK.LOGOUT);
  sim.state.post[5] = 2;
  // Day 3: given up; day 4: logged out mid-course.
  g.jump(3, 10, 2);
  g.toKiosk();
  g.ext(KIOSK.LOGIN);
  g.ext(KIOSK.COURSE);
  g.ext(KIOSK.QUIT);
  check(!sim.state.course.length && news(seen, 'quit').length === 1, 'a course given up');
  g.jump(4, 10, 2);
  g.toKiosk();
  g.ext(KIOSK.LOGIN);
  g.ext(KIOSK.COURSE);
  put(sim.state.player, 30, 40);
  g.step();
  check(!sim.state.course.length && news(seen, 'quit').length === 2, 'walked away mid-course: over');
  check(news(seen, 'passed').length + news(seen, 'failed').length === 2, 'two courses finished');
}

// ------------------------------------------------------------------ the hollow book
{
  const g = game();
  const { sim, seen } = g;
  const it = sim.state.items;
  g.jump(1, 10, 2);
  const r = RECIPES.findIndex((x) => x.result === 'hollow_book');
  check(r >= 0 && RECIPES[r].int === 30 && RECIPES[r].keep?.includes('razor_blade') === true, 'a hollow book: a thick book and a razor blade (Intellect 30), the blade kept');
  it.inv = [slot(n('thick_book')), slot(n('razor_blade')), 0, 0, 0, 0, 0, slot(n('inmate_outfit'))];
  it.int = 40;
  g.step(command(0, OP.CRAFT, 3, r + 1));
  check(it.inv.some((v) => (v & 255) === HOLLOW_BOOK) && it.inv.some((v) => (v & 255) === n('razor_blade')), 'crafted, the razor blade still in hand');
  const bookAt = it.inv.findIndex((v) => (v & 255) === HOLLOW_BOOK);
  // A non-small item onto it: an ordinary swap.
  const free = it.inv.indexOf(0);
  it.inv[free] = slot(n('timber'));
  g.step(command(0, OP.MOVE, free, bookAt));
  check((it.inv[bookAt] & 255) === n('timber') && (it.inv[free] & 255) === HOLLOW_BOOK, 'timber is no small thing: swapped, not hidden');
  g.step(command(0, OP.MOVE, free, bookAt));
  it.inv[free] = 0;
  // A lockpick hidden in it.
  const pick = it.inv.indexOf(0);
  it.inv[pick] = slot(n('lockpick'), 7);
  g.step(command(0, OP.MOVE, pick, bookAt));
  check(it.inv[pick] === 0 && hiddenIn(it.inv[bookAt]) === slot(n('lockpick'), 7) && news(seen, 'hidden').length === 1, 'a lockpick (worn to 7) hidden in it');
  check(!itemDef(it.inv[bookAt] & 255).contraband, 'the book itself is nothing to look at');
  // (The razor blade put away: only the book's secret on the player.)
  it.inv[it.inv.findIndex((v) => (v & 255) === n('razor_blade'))] = 0;
  // A detector's frisk: not found (the same pockets with the pick out in the open trip it).
  const tile = Math.floor(sim.state.player.z / UNIT) * MAP_W + Math.floor(sim.state.player.x / UNIT);
  frisk(sim, tile);
  check(!sim.events.some((e) => e.type === 'scanned' && e.tripped), 'a detector\'s frisk: not found');
  const was = it.inv.slice();
  it.inv[pick] = slot(n('lockpick'));
  sim.events = [];
  frisk(sim, tile);
  const tripped = sim.events.some((e) => e.type === 'scanned' && e.tripped);
  it.inv = was;
  check(tripped || sim.events.length === 0, 'the same pick out in the open trips it (where the detectors are on)');
  // A dog smells it all the same.
  check(smellsOfContraband(sim), 'a dog still smells what\'s in it');
  // Caught: the guards take contraband, not the book or what's in it.
  sim.state.wake = 2;
  wakeUp(sim);
  sim.state.solitary = 0;
  check(hiddenIn(it.inv[bookAt]) === slot(n('lockpick'), 7), 'caught: the book and what it hides kept');
  // In the desk, a cell search: not found.
  const desk = deskOf(sim);
  const j = desk.box.indexOf(0, desk.hidden);
  desk.box[j] = it.inv[bookAt];
  it.inv[bookAt] = 0;
  const guard = sim.world.def.guards.findIndex((d) => d.duties?.includes('shakedown'));
  g.jump(1, 13);
  assign(sim.state.guards[guard >= 0 ? guard : 0], GUARD.SHAKEDOWN, [1]);
  for (let k = 0; k < 20 * 60 * 3 && !seen.some((e) => e.type === 'searched' && e.cell === 1); k++) g.step();
  check(seen.some((e) => e.type === 'searched' && e.cell === 1), 'the player\'s cell searched');
  check(hiddenIn(desk.box[j]) === slot(n('lockpick'), 7), 'the cell search: the book and what it hides left alone');
  // Taken out with the use button.
  it.inv[0] = desk.box[j];
  desk.box[j] = 0;
  it.hand = 0;
  for (let k = 1; k < 6; k++) it.inv[k] = 0;
  g.step(command(0, OP.USE, 1));
  check(it.inv[0] === slot(HOLLOW_BOOK) && it.inv.slice(1, 6).includes(slot(n('lockpick'), 7)) && news(seen, 'unhidden').length === 1, 'opened: the pick out (its wear kept), the book empty again');
  check(!smellsOfContraband(sim) || it.inv.some((v) => itemDef(v & 255)?.contraband), 'and nothing left to smell in the book');
  // Given away with something in it: refused (what it hides would go with it).
  const pk = it.inv.findIndex((v) => (v & 255) === n('lockpick'));
  g.step(command(0, OP.MOVE, pk, 0));
  const talkTo = 0;
  const m = sim.state.inmates[talkTo];
  m.body.x = sim.state.player.x + UNIT;
  m.body.z = sim.state.player.z;
  m.path = [];
  sim.state.talk = talkTo;
  g.step(command(0, OP.TALK, TALK.GIFT, 0));
  check(refusals(seen).at(-1) === 'bookFull' && hiddenIn(it.inv[0]) > 0, 'a hollow book with something in it: not given away');
  sim.state.talk = -1;
  void SLOT;
  void CALLEE;
}

// ------------------------------------------------------------------ saves
{
  const g = game();
  const { sim } = g;
  g.jump(1, 10, 2);
  g.toKiosk();
  sim.state.cash = 30;
  sim.state.energy = 80;
  g.ext(KIOSK.LOGIN);
  g.ext(KIOSK.COURSE);
  g.ext(KIOSK.ORDER, 0);
  const saved = JSON.parse(JSON.stringify(sim.state));
  const back = new Sim(CENTER_PERKS, 5);
  back.state = loadState(back.world, CENTER_PERKS, saved);
  check(JSON.stringify(back.state) === JSON.stringify(sim.state) && back.state.course.length === 6 && back.state.kiosk > 0, 'a save mid-course loads as it was');
  for (let k = 0; k < 400; k++) {
    sim.step(0);
    back.step(0);
  }
  check(sim.hash() === back.hash(), 'and plays on the same');
  const old = JSON.parse(JSON.stringify(sim.state));
  for (const k of ['kiosk', 'post', 'photos', 'course']) delete old[k];
  const o = new Sim(CENTER_PERKS, 5);
  o.state = loadState(o.world, CENTER_PERKS, old);
  check(o.state.kiosk === 0 && o.state.post.join() === '0,0,0,0,0,0' && o.state.photos.length === 0 && o.state.course.length === 0, 'a save from before the kiosk: logged out, nothing coming');
  const bad = JSON.parse(JSON.stringify(sim.state));
  bad.post = [1, 99, 0, n('lockpick'), 0, 0];
  bad.photos = [1, 2, 3, 4];
  bad.course = [0, 9];
  bad.kiosk = -5;
  const b = new Sim(CENTER_PERKS, 5);
  b.state = loadState(b.world, CENTER_PERKS, bad);
  check(b.state.post.join() === '0,0,0,0,0,0' && b.state.photos.length === 0 && b.state.course.length === 0 && b.state.kiosk === 0, 'damaged numbers (contraband ordered, a fourth drawing) load as none');
  // A course with nobody logged in, time paid far ahead: neither.
  const odd = JSON.parse(JSON.stringify(saved));
  odd.kiosk = 0;
  const o2 = new Sim(CENTER_PERKS, 5);
  o2.state = loadState(o2.world, CENTER_PERKS, odd);
  check(o2.state.course.length === 0, 'a course with nobody logged in loads as none');
  odd.kiosk = 1e9;
  odd.course = saved.course;
  const o3 = new Sim(CENTER_PERKS, 5);
  o3.state = loadState(o3.world, CENTER_PERKS, odd);
  check(o3.state.kiosk === 0 && o3.state.course.length === 0, 'time paid far ahead loads as logged out');
}
console.log('kiosk ok');
