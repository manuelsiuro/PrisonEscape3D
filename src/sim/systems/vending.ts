/**
 * The vending machine (2.32, docs/decisions/jobs-money.md): one in each campaign prison's canteen, its rows filled every morning
 * (a little more on a delivery day) and bought from by the player and the inmates alike.
 *
 * - **Up to it** (the action button, EXT.VEND OPEN): its card opens. Nobody there first: it's the player's. Someone
 *   there: a place at the end of the queue, or the front of it, which those passed don't forgive.
 * - **Buying** (BUY): paid up front, the coil turns, it drops into the hand. Nothing's taken for what can't be had:
 *   sold out, no room in the pockets, no money, a shut or dark machine. Walked away while it turns, it's on the floor
 *   in front of the machine.
 * - **A jam**: now and then it sticks. The money's gone; a thump or three (THUMP) frees it, loud enough for a guard to
 *   come and look, and a guard watching says something (a little heat, once a jam, never a chase). Left there, it
 *   stays until the morning's refill for anyone who thumps it, and nothing else can be bought meanwhile.
 * - **Inmates** come in the free times, at a few rushes, by roll() (never the state's RNG), queue on the machine's
 *   tiles, buy food or drink and go off with it; they take what they buy out of the same rows.
 *
 * A run from before 2.32 (Sim.rules231) has none of it; the Training Block has no machine.
 */
import { itemDef, itemNumber } from '../../content/items';
import { CUT_OPINION, CUT_SWING, HOSTILE_SWING } from '../../content/phone';
import { ROUTINE } from '../../content/routine';
import {
  COIL_STEPS,
  DELIVERY_EXTRA,
  FANCIED,
  GIVE_UP_ODDS,
  GOODS,
  HEAD_STALL_STEPS,
  INMATE_COIL_STEPS,
  INMATE_JAM_ODDS,
  INMATE_THUMP_STEPS,
  JAM_ODDS,
  LINE_MAX,
  RUSH_MINUTES,
  RUSH_SPREAD,
  SNACK_STEPS,
  THERE_FIRST,
  THUMP_HEAT,
  THUMP_NOISE,
  THUMP_STEPS,
  THUMPS_MAX,
  VEND,
  VEND_LINE_REACH,
  VEND_TURN_STEPS,
  WANT_ODDS,
} from '../../content/vending';
import { canSee } from '../ai/sight';
import { DOING } from '../ai/doing';
import { DIR_X, DIR_Z } from '../command';
import type { SimContext } from '../context';
import type { Refusal } from '../events';
import { rollInt, SALT } from '../rng';
import { ANGRY_STEPS, CHASE_HEAT, STEPS_PER_MINUTE, UNIT } from '../tuning';
import { centerX, centerZ, tileAt } from '../world/grid';
import { LAYER, layerOfKey, MAP_W, placeKey, tileOfKey, type Prop } from '../world/World';
import { byCanteen, crowdPlan, dayMinute, drillOn, planOf, prisonDay } from './calendar';
import { awake } from './guards';
import { freeHotbar, PICKUP_REACH, REACH, slot } from './items';
import { bodyAt, type Body } from './movement';
import { makeNoise } from './noise';
import { powered } from './power';
import { playerUp } from './presence';
import { propReach } from './rest';
import { changeOpinion, endTalk, hostile, refuse } from './social';
import { closeCard, VEND_NOBODY, VEND_PLAYER } from './vendState';
import { addHeat } from './watch';

export { VEND_NOBODY, VEND_PLAYER };

type VendSim = Pick<SimContext, 'world' | 'state' | 'rules231'>;

/** The prison's machine (a run before 2.32, the Training Block: none). */
export const vendingOf = (sim: Pick<SimContext, 'world' | 'rules231'>) => (sim.rules231 ? undefined : sim.world.def.vending);

/** Its prop. */
export function vendProp(sim: Pick<SimContext, 'world' | 'rules231'>): Prop | null {
  const m = vendingOf(sim);
  return m ? (sim.world.props.find((p) => p.kind === 'vending' && p.x === m.x && p.z === m.z) ?? null) : null;
}

/** Why the machine won't sell now (null: it will). Stuck or not, it's dark in a power cut and shut in a lockdown or a drill. */
export function vendShut(sim: SimContext): Refusal | null {
  if (sim.state.lockdown || drillOn(sim)) return 'vendShut';
  return powered(sim.world, sim.state, 'lights') ? null : 'vendDark';
}

/** Close enough to use it (a tile's reach), on the ground floor. */
export function atVending(sim: VendSim & Pick<SimContext, 'away'>): boolean {
  const p = vendProp(sim);
  const s = sim.state;
  // (In its own room: not from behind the wall it stands against, nor round the back of it where it stands clear of one. It fronts south.)
  return (
    !!p &&
    s.layer === LAYER.GROUND &&
    playerUp(sim) &&
    s.player.z >= p.z * UNIT &&
    propReach(p, s.player.x, s.player.z) <= REACH &&
    sim.world.zoneAt(Math.floor(s.player.x / UNIT), Math.floor(s.player.z / UNIT)) === sim.world.zoneAt(p.x, p.z)
  );
}

/**
 * The machine as the action button's target: faced, in reach, the hands free and on their feet. It comes ahead of
 * whoever is queueing for it beside the player (they'd take the button otherwise); turning away, the button's theirs.
 */
export function vendOffer(sim: VendSim & Pick<SimContext, 'away'>): boolean {
  const s = sim.state;
  if (!atVending(sim) || s.tray || s.seat >= 0 || s.train >= 0 || s.vendOpen || s.talk >= 0 || s.items.open >= 0) return false;
  // (Something on the floor at their feet, with room for it, is picked up first: what walking off mid-turn leaves there.)
  if (freeHotbar(s.items.inv) >= 0 && groundInReach(s.items.ground, s.player)) return false;
  // (Turned towards its middle, within 60°: from wherever along the tile in front they've come to a stop.)
  const p = vendProp(sim)!;
  const dx = (p.x + p.w / 2) * UNIT - s.player.x;
  const dz = (p.z + p.d / 2) * UNIT - s.player.z;
  const ahead = (DIR_X[s.player.facing] ?? 0) * dx + (DIR_Z[s.player.facing] ?? 0) * dz;
  return ahead > 0 && ahead * ahead * 4 >= (dx * dx + dz * dz) * 1024 * 1024;
}

/** Something on the ground floor that the action button would pick up from where this body stands. */
function groundInReach(ground: ReadonlyArray<readonly [number, number]>, b: { x: number; z: number }): boolean {
  return ground.some(([key]) => {
    if (layerOfKey(key) !== LAYER.GROUND) return false;
    const tile = tileOfKey(key);
    return Math.max(Math.abs(centerX(tile) - b.x), Math.abs(centerZ(tile) - b.z)) <= PICKUP_REACH;
  });
}

/** The inmates who've got there ahead of the player: the one using it, and those in the queue within a few tiles of it. */
function thereFirst(sim: SimContext): number {
  const s = sim.state;
  const m = vendingOf(sim);
  if (!m) return 0;
  const mine = s.vend.line.indexOf(VEND_PLAYER);
  const ahead = mine < 0 ? s.vend.line : s.vend.line.slice(0, mine);
  return ahead.filter((k) => s.vend.who === k || inmateThere(sim, k)).length;
}

/** This inmate's within a few tiles of the machine: come, rather than on the way. */
function inmateThere(sim: SimContext, k: number): boolean {
  const m = vendingOf(sim);
  const b = sim.state.inmates[k]?.body;
  return !!m && !!b && Math.max(Math.abs(b.x - m.x * UNIT), Math.abs(b.z - m.z * UNIT)) <= THERE_FIRST * UNIT;
}

/** The player's place: how many are ahead of them right now (0: it's theirs). */
export const peopleAhead = (sim: SimContext) => thereFirst(sim);

/** Why this row can't be bought now (null: it can). Whatever it says, nothing has been paid. */
export function vendRefusal(sim: SimContext, row: number): Refusal | null {
  const s = sim.state;
  const v = s.vend;
  if (!atVending(sim)) return 'vendFar';
  const shut = vendShut(sim);
  if (shut) return shut;
  if (v.who !== VEND_NOBODY) return 'vendBusy';
  if (v.jam) return 'vendStuck';
  if (thereFirst(sim) > 0) return 'vendFirst';
  const g = GOODS[row];
  if (!g) return 'vendFar';
  if (v.left[row] <= 0) return 'vendSoldOut';
  if (s.cash < g.price) return 'cash';
  return freeHotbar(s.items.inv) < 0 ? 'vendPockets' : null;
}

/** At the machine (EXT.VEND b, c). */
export function vendOp(sim: SimContext, b: number, c: number) {
  const s = sim.state;
  if (!vendingOf(sim)) return;
  const v = s.vend;
  if (b === VEND.CLOSE) return closeCard(sim);
  if (b === VEND.OPEN) {
    if (!atVending(sim)) return refuse(sim, 'vendFar');
    // (Both hands on a tray, the button still pointing at it: told why. Seated or at a set, what those ask comes first.)
    if (s.tray) return refuse(sim, 'vendTray');
    if (s.seat >= 0 || s.train >= 0) return;
    s.vendOpen = true;
    if (thereFirst(sim) === 0) takeTurn(sim);
    sim.events.push({ type: 'vend', what: 'open' });
    return;
  }
  if (b === VEND.BUY) {
    const why = vendRefusal(sim, c);
    if (why) return refuse(sim, why);
    const g = GOODS[c];
    takeTurn(sim);
    s.cash -= g.price;
    v.left[c]--;
    v.who = VEND_PLAYER;
    v.row = c;
    v.until = s.step + COIL_STEPS;
    v.thumping = false;
    s.vendBought++;
    sim.events.push({ type: 'cash', n: -g.price, why: 'buy' }, { type: 'vend', what: 'paid', row: c, item: itemNumber(g.id) });
    return;
  }
  if (b === VEND.THUMP) return thump(sim);
  if (b === VEND.WAIT) {
    if (!atVending(sim) && !byVending(sim)) return refuse(sim, 'vendFar');
    if (v.line.includes(VEND_PLAYER)) return;
    v.line.push(VEND_PLAYER);
    sim.events.push({ type: 'vend', what: 'waiting', n: v.line.length - 1 });
    return;
  }
  if (b === VEND.CUT) return cutIn(sim);
}

/** The queue's reach: a few tiles from the machine, in its own room. */
function byVending(sim: SimContext): boolean {
  const m = vendingOf(sim);
  const s = sim.state;
  if (!m || !playerUp(sim) || s.layer !== LAYER.GROUND) return false;
  const near = Math.max(Math.abs(Math.floor(s.player.x / UNIT) - m.x), Math.abs(Math.floor(s.player.z / UNIT) - m.z)) <= VEND_LINE_REACH;
  return near && byCanteen(sim, Math.floor(s.player.x / UNIT), Math.floor(s.player.z / UNIT));
}

/** The machine is the player's: at the head of the queue, anyone still on their way behind them. */
function takeTurn(sim: SimContext) {
  const v = sim.state.vend;
  v.line = [VEND_PLAYER, ...v.line.filter((k) => k !== VEND_PLAYER)];
  if (!v.turn) v.turn = sim.state.step;
}

/** Who pushing in would pass: those ahead in the queue, not whoever's already using it. */
export function cutPast(sim: Pick<SimContext, 'state'>): number[] {
  const v = sim.state.vend;
  const mine = v.line.indexOf(VEND_PLAYER);
  return (mine < 0 ? v.line : v.line.slice(0, mine)).filter((k) => k !== v.who);
}

/** Pushing in: the front of the queue, at the price of what those passed think of it; the one pushed back may swing. */
function cutIn(sim: SimContext) {
  const s = sim.state;
  const v = s.vend;
  if (!byVending(sim)) return refuse(sim, 'vendFar');
  const shut = vendShut(sim);
  if (shut) return refuse(sim, shut);
  const passed = cutPast(sim);
  if (!passed.length) return refuse(sim, 'vendBusy');
  const pushed = passed[0];
  takeTurn(sim);
  for (const k of passed) changeOpinion(sim, k, CUT_OPINION);
  sim.events.push({ type: 'vend', what: 'cut', n: passed.length, who: pushed });
  const odds = hostile(sim) ? HOSTILE_SWING : CUT_SWING;
  if (rollInt(s.salt, SALT.VEND, prisonDay(s.step), 7000 + (s.step % 997), 100) < odds) {
    const m = s.inmates[pushed];
    m.angry = ANGRY_STEPS;
    m.doing = DOING.NOTHING;
    m.wait = 0;
    v.line = v.line.filter((k) => k !== pushed);
    if (s.talk === pushed) endTalk(sim);
    sim.events.push({ type: 'vend', what: 'swing', who: pushed });
  }
}

/** A thump at what's stuck: noise, a word from a guard watching, and in a thump or three it drops. */
function thump(sim: SimContext) {
  const s = sim.state;
  const v = s.vend;
  if (!atVending(sim)) return refuse(sim, 'vendFar');
  if (!v.jam || v.who !== VEND_NOBODY) return refuse(sim, v.who === VEND_NOBODY ? 'vendNoJam' : 'vendBusy');
  if (thereFirst(sim) > 0) return refuse(sim, 'vendFirst');
  if (v.hit && s.step - v.hit < THUMP_STEPS) return;
  v.hit = s.step;
  takeTurn(sim);
  v.turn = s.step;
  const p = vendProp(sim)!;
  makeNoise(sim, 'thump', LAYER.GROUND, p.z * MAP_W + p.x, THUMP_NOISE);
  // (Told, not caught at anything: a little heat, once a jam, and it never starts a chase.)
  if (!v.told && s.guards.some((g) => awake(g) && canSee(sim.world, g.body, s.player))) {
    v.told = true;
    const heat = Math.min(THUMP_HEAT, Math.max(0, CHASE_HEAT - 1 - s.heat));
    if (heat > 0) addHeat(sim, heat);
    sim.events.push({ type: 'vend', what: 'toldOff' });
  }
  v.hits--;
  sim.events.push({ type: 'vend', what: 'thump', row: v.jam - 1 });
  if (v.hits > 0) return;
  const row = v.jam - 1;
  v.jam = 0;
  v.hits = 0;
  v.told = false;
  sim.events.push({ type: 'vend', what: 'freed', row });
  dropFor(sim, row);
}

/** What's bought lands: into the player's hand with them at it and room for it, else on the floor in front of the machine. */
function dropFor(sim: SimContext, row: number) {
  const s = sim.state;
  const it = s.items;
  const item = itemNumber(GOODS[row].id);
  const k = atVending(sim) && !s.tray ? freeHotbar(it.inv) : -1;
  if (k >= 0) {
    it.inv[k] = slot(item);
    it.hand = k;
    it.rev++;
    sim.events.push({ type: 'vend', what: 'got', item, row });
    return;
  }
  const front = vendingOf(sim)!.line[0];
  it.ground.push([placeKey(LAYER.GROUND, front.z * MAP_W + front.x), slot(item)]);
  it.rev++;
  sim.events.push({ type: 'vend', what: 'floor', item, row });
}

/** The free time block now (0 the morning's, 1 the evening's; -1 neither). */
export function blockNow(sim: SimContext): number {
  const id = ROUTINE[sim.state.routine].id;
  return id === 'freeTime' ? 0 : id === 'eveningFreeTime' ? 1 : -1;
}

/** The minute into the prison day an inmate wants something in a free time (-1: not this one), by roll(). */
export function wantsSnack(salt: number, day: number, b: number, k: number): number {
  if (rollInt(salt, SALT.VEND, day * 2 + b, k, 100) >= WANT_ODDS) return -1;
  const id = b ? 'eveningFreeTime' : 'freeTime';
  const at = ROUTINE.findIndex((r) => r.id === id);
  const from = ROUTINE[at].start - 8 * 60;
  const to = ROUTINE[at + 1].start - 8 * 60;
  const rush =
    RUSH_MINUTES[rollInt(salt, SALT.VEND, day * 2 + b, 1000 + k, RUSH_MINUTES.length)] +
    rollInt(salt, SALT.VEND, day * 2 + b, 2000 + k, RUSH_SPREAD);
  return from + Math.min(rush, to - from - 15);
}

/** An inmate free to go to the machine (as the phone's queue asks), and none of those people come looking for. */
export function freeToGo(sim: SimContext, k: number, waiting = false): boolean {
  const s = sim.state;
  const m = s.inmates[k];
  if (!m || m.ko > 0 || m.angry > 0 || (s.talk === k && !waiting) || s.followers.includes(k)) return false;
  if (m.doing === DOING.SLEEP || m.doing === DOING.BRAWL) return false;
  if (s.line.includes(k) || s.booth[0] === k) return false;
  // (2.33: having a drink at the water cooler: done with that first.)
  if (!waiting && s.cooler.who.includes(k)) return false;
  // (2.39: gathered for a chat or a game: done with that first; 2.40: watching the player's game, likewise.)
  if (!waiting && s.huddle?.who.includes(k)) return false;
  if (!waiting && s.watch?.includes(k)) return false;
  if (
    s.match?.team.includes(k) ||
    s.ink?.who === k ||
    s.cheat?.who === k ||
    s.shootout?.who === k ||
    s.dice[0] === k ||
    s.bout[0] === k ||
    s.quiz?.who.includes(k) ||
    // (2.41: quiz night's host too: a stand-in isn't one who stays put.)
    s.quiz?.host === k
  )
    return false;
  return true;
}

/** Those people come looking for stay where they're looked for: a merchant, the fixer, the librarian. */
export function staysPut(sim: SimContext, k: number): boolean {
  const def = sim.world.def;
  const cell = sim.state.inmates[k].cell;
  return def.merchants.includes(cell) || def.smuggling?.fixer === cell || def.leisure?.librarian?.cell === cell;
}

/** Each step: the morning's refill, who comes to it, what's dropping, whose turn it is. */
export function vending(sim: SimContext) {
  const m = vendingOf(sim);
  if (!m) return;
  const s = sim.state;
  const v = s.vend;
  const day = prisonDay(s.step);
  if (v.day !== day) {
    const extra = planOf(sim, day).event === 'delivery' ? DELIVERY_EXTRA : 0;
    const first = v.day === 0;
    v.day = day;
    v.left = GOODS.map((g) => g.stock + extra);
    v.jam = 0;
    v.hits = 0;
    v.told = false;
    v.asked = [0, 0];
    if (!first) sim.events.push({ type: 'vend', what: 'refilled', n: extra });
  }
  const shut = vendShut(sim);
  const elsewhere = crowdPlan(sim, s.routine) !== s.routine;
  // A lockdown, a drill or the day's event has them elsewhere; the card shuts on the player.
  if (s.vendOpen && (s.lockdown || drillOn(sim))) {
    closeCard(sim);
    sim.events.push({ type: 'vend', what: 'shut' });
  }
  if (s.lockdown || drillOn(sim) || elsewhere) {
    // (Called away mid-buy, by a film, a talent night, a drill or a lockdown: what's paid for drops and goes with
    // them, not lost from the row. Something stuck stays stuck.)
    if (v.who >= 0 && !v.thumping) gotIt(sim, v.who, v.row, s.inmates[v.who]);
    v.line = v.line.filter((k) => k === VEND_PLAYER);
    if (v.who >= 0) v.who = VEND_NOBODY;
  }
  // Inmates want something at their minute, in the free times.
  const b = blockNow(sim);
  if (b >= 0 && s.step % STEPS_PER_MINUTE === 0 && !shut && !elsewhere) {
    const minute = dayMinute(s.step);
    for (let k = 0; k < s.inmates.length && k < 30; k++) {
      if (v.asked[b] & (1 << k) || v.who === k || v.line.includes(k)) continue;
      const at = wantsSnack(s.salt, day, b, k);
      if (at < 0 || minute < at) continue;
      // (2.39: gathered for a chat or a game: the snack waits till it's over.)
      if (s.huddle?.who.includes(k)) continue;
      v.asked[b] |= 1 << k;
      if (v.line.filter((q) => q !== VEND_PLAYER).length >= LINE_MAX || staysPut(sim, k) || !freeToGo(sim, k)) continue;
      v.line.push(k);
      s.inmates[k].path = [];
    }
  }
  // Someone who can't wait now is out of the line.
  v.line = v.line.filter((k) => k === VEND_PLAYER || freeToGo(sim, k, true));
  if (v.who >= 0 && !v.line.includes(v.who)) v.who = VEND_NOBODY;
  // The player walked off, or was stopped.
  if ((s.vendOpen || v.line.includes(VEND_PLAYER)) && !byVending(sim)) closeCard(sim, true);
  // (The card up, no place taken: stepping off it ends it. Only someone waiting in line can wander a few tiles.)
  else if (s.vendOpen && !v.line.includes(VEND_PLAYER) && !atVending(sim)) closeCard(sim, true);
  else if (v.line[0] === VEND_PLAYER) {
    // (Turning away from it, once at it. A place come up with them still a few tiles off: they've time to step up.)
    if (atVending(sim)) v.up = true;
    else if (v.up) closeCard(sim, true);
  } else v.up = false;
  if (v.who === VEND_PLAYER && s.step >= v.until) finishPlayer(sim);
  if (v.who >= 0) atMachine(sim);
  if (v.who === VEND_NOBODY) nextUp(sim);
  // (Whoever's at the head: how long for, for an inmate who can't reach it.)
  if (v.line.length === 0) v.head = 0;
}

/** The coil's turned for the player: it drops, or sticks. */
function finishPlayer(sim: SimContext) {
  const s = sim.state;
  const v = s.vend;
  v.who = VEND_NOBODY;
  // (The first thing a run buys always comes out, so that it's met working.)
  if (s.vendBought > 1 && jamsAt(s.salt, s.vendBought)) {
    v.jam = v.row + 1;
    v.hits = 1 + rollInt(s.salt, SALT.VEND, s.vendBought, 3000, THUMPS_MAX);
    v.told = false;
    // (A fresh turn to thump it in: what they've just paid for isn't lost while they stand there.)
    v.turn = s.step;
    sim.events.push({ type: 'vend', what: 'jam', row: v.row, item: itemNumber(GOODS[v.row].id) });
    return;
  }
  dropFor(sim, v.row);
  v.turn = s.step;
}

/** Whether the player's nth buy sticks (pure, for a lesson to arrange one). */
export const jamsAt = (salt: number, n: number) => rollInt(salt, SALT.VEND, n, 4000, JAM_ODDS) === 0;

/** The inmate at the machine: the coil done, what it gets, or a jam thumped at. */
function atMachine(sim: SimContext) {
  const s = sim.state;
  const v = s.vend;
  const k = v.who;
  if (s.step < v.until) return;
  const m = s.inmates[k];
  const day = prisonDay(s.step);
  if (v.thumping) {
    v.thumping = false;
    // Whatever it was at, one time in so many it gives up and leaves it for someone else.
    if (rollInt(s.salt, SALT.VEND, day * 64 + k, 5000 + v.row, GIVE_UP_ODDS) === 0) {
      sim.events.push({ type: 'vend', what: 'gaveUp', who: k, row: v.jam - 1 });
      v.who = VEND_NOBODY;
      v.line = v.line.filter((q) => q !== k);
      return;
    }
    if (v.jam) v.row = v.jam - 1;
    v.jam = 0;
    v.hits = 0;
    return gotIt(sim, k, v.row, m);
  }
  if (rollInt(s.salt, SALT.VEND, day * 64 + k, 6000, INMATE_JAM_ODDS) === 0) {
    v.jam = v.row + 1;
    v.hits = 1 + rollInt(s.salt, SALT.VEND, day * 64 + k, 6500, THUMPS_MAX);
    v.told = false;
    v.thumping = true;
    v.until = s.step + INMATE_THUMP_STEPS;
    sim.events.push({ type: 'vend', what: 'inmateJam', who: k, row: v.row });
    return;
  }
  gotIt(sim, k, v.row, m);
}

/** An inmate's got what it came for and goes off with it. */
function gotIt(sim: SimContext, k: number, row: number, m: SimContext['state']['inmates'][number]) {
  const s = sim.state;
  const v = s.vend;
  const item = itemNumber(GOODS[row].id);
  m.snack = item;
  m.snackEnd = s.step + SNACK_STEPS + (k % 5) * 20;
  v.who = VEND_NOBODY;
  v.line = v.line.filter((q) => q !== k);
  sim.events.push({ type: 'vend', what: 'inmateGot', who: k, item, row });
}

/** Nobody at it: the head of the queue steps up, or it's the player's turn. */
function nextUp(sim: SimContext) {
  const s = sim.state;
  const v = s.vend;
  const m = vendingOf(sim)!;
  const first = v.line[0];
  if (first === undefined) return;
  if (first === VEND_PLAYER) {
    if (!v.turn) {
      v.turn = s.step;
      if (v.line.length > 1 || !s.vendOpen) sim.events.push({ type: 'vend', what: 'turn' });
    } else if (v.line.length < 2 || !inmateThere(sim, v.line[1])) {
      // (Nobody actually waiting yet: the clock starts when someone is.)
      v.turn = s.step;
    } else if (s.step - v.turn > VEND_TURN_STEPS) {
      // Nothing bought with others waiting: to the back of the line.
      v.line = [...v.line.slice(1), VEND_PLAYER];
      v.turn = 0;
      sim.events.push({ type: 'vend', what: 'lostTurn' });
    }
    v.head = 0;
    return;
  }
  v.turn = 0;
  if (!v.head) v.head = s.step;
  const inmate = s.inmates[first];
  const front = m.line[0];
  const on =
    !inmate.body.moving &&
    Math.max(Math.abs(inmate.body.x - (front.x * UNIT + UNIT / 2)), Math.abs(inmate.body.z - (front.z * UNIT + UNIT / 2))) <= UNIT / 2;
  if (!on) {
    // (Someone standing in its place, a wedged way there: not for ever.)
    if (s.step - v.head > HEAD_STALL_STEPS) {
      v.line.shift();
      v.head = 0;
      sim.events.push({ type: 'vend', what: 'gaveUp', who: first });
    }
    return;
  }
  v.head = 0;
  // Something stuck in it: thumped at, whatever it is.
  if (v.jam) {
    v.who = first;
    v.row = v.jam - 1;
    v.thumping = true;
    v.until = s.step + INMATE_THUMP_STEPS;
    sim.events.push({ type: 'vend', what: 'inmateThump', who: first, row: v.row });
    return;
  }
  // Else what it fancies of what's left, by roll(); the machine dark or nothing left, it goes off cursing.
  const rows = FANCIED.filter((r) => v.left[r] > 0);
  if (vendShut(sim) || !rows.length) {
    v.line.shift();
    sim.events.push({ type: 'vend', what: 'empty', who: first });
    return;
  }
  const row = rows[rollInt(s.salt, SALT.VEND, prisonDay(s.step) * 64 + first, 7500, rows.length)];
  v.left[row]--;
  v.who = first;
  v.row = row;
  v.thumping = false;
  v.until = s.step + INMATE_COIL_STEPS;
  sim.events.push({ type: 'vend', what: 'inmatePaid', who: first, row });
}

const marks: Body[] = [0, 1, 2, 3, 4, 5].map(() => bodyAt(0, 0));

/** The way from a tile to another (1 east, 5 south, 9 west, 13 north). */
function faceTo(from: { x: number; z: number }, to: { x: number; z: number }): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 1 : 9;
  if (dz) return dz > 0 ? 5 : 13;
  return dx > 0 ? 1 : 9;
}

/** The queue where it stands (socialNow): the head in front of the machine, the rest on their tiles behind, each facing the next. */
export function vendTargets(sim: SimContext, so: { follow: Array<Body | null>; gap: number[]; doing: number[]; face: number[] }) {
  const s = sim.state;
  const m = vendingOf(sim);
  if (!m || !s.vend.line.length) return;
  const v = s.vend;
  const pt = tileAt(s.player.x, s.player.z);
  const front = m.line[0];
  // (The player standing in front of it, not yet in the line: nobody walks into them.)
  const blocked = pt === front.z * MAP_W + front.x && !v.line.includes(VEND_PLAYER) ? 1 : 0;
  v.line.forEach((k, j) => {
    if (k === VEND_PLAYER) return;
    const inmate = s.inmates[k];
    if (!inmate || inmate.ko > 0 || inmate.angry > 0) return;
    inmate.wait = 0;
    const i = Math.min(j + blocked, m.line.length - 1);
    const t = m.line[i];
    const at = marks[Math.min(j, marks.length - 1)];
    at.x = t.x * UNIT + UNIT / 2;
    at.z = t.z * UNIT + UNIT / 2;
    so.follow[k] = at;
    so.gap[k] = 0;
    so.doing[k] = v.who === k ? (v.thumping ? DOING.THUMP : DOING.VEND) : DOING.QUEUE;
    so.face[k] = i === 0 ? faceTo(t, m) : faceTo(t, m.line[i - 1]);
  });
}

/** What an item eaten or drunk gives; whether it would do anything now (a full bar keeps it for later). */
export function foodUse(item: number, energy: number, health: number, maxHealth: number): boolean {
  const f = itemDef(item).food;
  if (!f) return false;
  return (!!f.energy && energy < 100) || (!!f.health && health < maxHealth);
}
