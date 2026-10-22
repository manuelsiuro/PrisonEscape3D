/**
 * The pay phone (P34, docs/PLAN.md §11): a wall phone in a corridor (`PrisonDef.comms`), open in
 * the free times outside a lockdown.
 *
 * - **The queue** (from LINE_DAY): in each free time an inmate may want a call (roll(), CALL_WANT
 *   in 100, from a minute of its own); he joins the line if there's room, waits on its tiles and
 *   talks 10–20 game minutes. The player gets in line (EXT.LINE), buys the place of the inmate
 *   ahead (TALK.SWAP) or cuts in (everyone in line thinks less of them; the one pushed back may
 *   swing). The player's turn: a call within TURN_STEPS, or the place is lost.
 * - **Calls** (EXT.CALL): home (energy; a money order once a week, paid at mail call), the lawyer
 *   (an appeal takes heat off; a retainer halves a stretch in solitary), an anonymous tip (the
 *   shakedown guard searches the cell named), and the player's cousin Lou.
 * - **Lou's line is tapped**: the job is said in three lines (EXT.SAY), each picked from a plain,
 *   a coded and a deep-code phrase. Lou understands when their clarity adds up (CLEAR_NEED); a
 *   deep code he has understood once is his for the run. The guard listening (drawn per call)
 *   catches a call whose risk adds up to what their way lets slip (CATCH): heat, and the job blown.
 * - **Lou's jobs**: a diversion at the front gate at an hour named, a cake with a file in it at
 *   the next visit (or Red Cross parcel), a getaway car waiting tonight.
 * - **Eavesdropping**: within OVERHEAR_RANGE of an inmate on the phone for OVERHEAR_STEPS, a true
 *   secret (the event; the play layer's Director picks the fact).
 *
 * Every draw comes from roll() (SALT.CALLS, SALT.TAP), never the state's RNG.
 */
import { APPEAL_HEAT, CAKE_ENERGY, CALL_STEPS, CALL_WANT, CALLEE, CAR_FROM, CAR_TO, CATCH, CLARITY, CLEAR_NEED, codeBit, COINS, CUT_OPINION, CUT_SWING, DIVERT_AHEAD, DIVERT_GUARDS, DIVERT_LOOK, HOME_ENERGY, HOSTILE_SWING, INMATE_CALL_MIN, INMATE_CALL_SPAN, JOB, JOB_FEES, LAWYER, LAWYER_FEES, LEARNED_CLARITY, LINE_DAY, LINE_MAX, LINE_REACH, LINE_STEPS, MAIL_MINUTE, MONEY_EVERY, MONEY_MIN, MONEY_SPAN, OVERHEAR_RANGE, OVERHEAR_STEPS, REACH_STEPS, RETAINER_DAYS, WANT_WITHIN, RISK, SNITCH_ODDS, SNITCH_OPINION, SWAP_PRICE, TAP_HEAT, TIER, TIP_HEAT, TURN_STEPS, VARIANTS } from '../../content/phone';
import { itemNumber } from '../../content/items';
import { ROUTINE } from '../../content/routine';
import { PARCEL_MINUTE } from '../../content/smuggling';
import type { CommsDef } from '../../content/prisons/types';
import { LINE } from '../command';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import type { Call, Refusal, SimState } from '../state';
import { ANGRY_STEPS, CHASE_HEAT, STEPS_PER_MINUTE, UNIT } from '../tuning';
import { LAYER, MAP_W } from '../world/World';
import { containersOf } from '../world/containers';
import { crowdPlan, dayMinute, drillOn, prisonDay, TODAY, today } from './calendar';
import { assign, awake, GUARD, traitOf } from './guards';
import { DOING } from './inmates';
import { HOTBAR, slot } from './items';
import { bodyAt, type Body } from './movement';
import { summon } from './power';
import { hostile, changeOpinion, refuse, endTalk } from './social';
import { smugglingOf } from './smuggling';
import { lookingAway } from './ways';
import { addHeat } from './watch';

export const CAKE = itemNumber('cake');
const FILE = itemNumber('metal_file');
/** The player's place in the queue (`state.line`). */
export const PLAYER_IN_LINE = -1;

/** The prison's pay phone (none at the Training Block, whose rules are relaxed). */
export const commsOf = (sim: Pick<SimContext, 'world'>): CommsDef | null => (sim.world.def.rules?.relaxed ? null : sim.world.def.comms ?? null);

/** The phone's hours: the free times, outside a lockdown. */
export const phoneOpen = (sim: SimContext) => !!commsOf(sim) && sim.fixerOpen && !drillOn(sim);

/** How far a point (units) is from a tile (tiles, the larger way). */
const offBy = (t: { x: number; z: number }, x: number, z: number) => Math.max(Math.abs(Math.floor(x / UNIT) - t.x), Math.abs(Math.floor(z / UNIT) - t.z));

/** Where the player is, as the phone sees it: at it (a tile from where the caller stands), within the queue's reach. */
function playerAbout(sim: SimContext) {
  const s = sim.state;
  return s.layer === LAYER.GROUND && !sim.away && !s.stowed && !s.sleeping && s.ko <= 0;
}
export function atPhone(sim: SimContext): boolean {
  const c = commsOf(sim);
  return !!c && playerAbout(sim) && offBy(c.phone, sim.state.player.x, sim.state.player.z) <= 1;
}
export function byPhone(sim: SimContext): boolean {
  const c = commsOf(sim);
  if (!c || !playerAbout(sim) || offBy(c.phone, sim.state.player.x, sim.state.player.z) > LINE_REACH) return false;
  // (In the phone's own room: not behind a wall beside it.)
  const p = sim.state.player;
  return sim.world.zoneAt(Math.floor(p.x / UNIT), Math.floor(p.z / UNIT)) === sim.world.zoneAt(c.phone.x, c.phone.z);
}

/** The player has used the phone this run (a call, a place in line): from then on, inmates queue for it too (the escape bots never do). */
export const phoneUsed = (s: Pick<SimState, 'phoned'>) => s.phoned[6] > 0;

/** Someone is on the phone (an inmate, or the player). */
export const phoneBusy = (s: Pick<SimState, 'booth' | 'call'>) => s.booth[0] >= 0 || s.call !== null;

/** The player's place in the queue (-1: not in it). */
export const placeInLine = (s: Pick<SimState, 'line'>) => s.line.indexOf(PLAYER_IN_LINE);

/** A retainer runs today: a stretch in solitary is halved. */
export const retained = (s: Pick<SimState, 'phoned' | 'step'>) => s.phoned[2] > 0 && prisonDay(s.step) < s.phoned[2];

/** What a call costs up front: coins (Lou's fee is paid once he understands), the lawyer's fee. */
export const callCost = (to: number, sub: number) => (to === CALLEE.LAWYER ? LAWYER_FEES[sub] ?? LAWYER_FEES[0] : COINS);

/** The step a diversion called for at an hour goes off: that hour's next stroke at least DIVERT_AHEAD on (-1 no such hour). */
export function divertStep(step: number, hour: number): number {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return -1;
  // (Prison days run from 08:00: the hour's minute into the day.)
  const m = ((hour - 8 + 24) % 24) * 60;
  const dayStart = step - (step % (STEPS_PER_MINUTE * 60 * 24));
  let at = dayStart + m * STEPS_PER_MINUTE;
  while (at < step + DIVERT_AHEAD * STEPS_PER_MINUTE) at += STEPS_PER_MINUTE * 60 * 24;
  return at;
}

// ------------------------------------------------------------------ the queue

/** The free time block now (0 the morning's, 1 the evening's; -1 neither). */
function blockNow(s: SimState): number {
  const id = ROUTINE[s.routine].id;
  return id === 'freeTime' ? 0 : id === 'eveningFreeTime' ? 1 : -1;
}

/** Minutes into the prison day a free time block starts and ends. */
function blockSpan(b: number): [number, number] {
  const k = ROUTINE.findIndex((r) => r.id === (b ? 'eveningFreeTime' : 'freeTime'));
  return [ROUTINE[k].start - 8 * 60, ROUTINE[k + 1].start - 8 * 60];
}

/** The minute into the prison day an inmate wants to call in a free time (-1: not today), by roll(). */
export function wantsCall(salt: number, day: number, b: number, k: number): number {
  if (rollInt(salt, SALT.CALLS, day * 2 + b, k, 100) >= CALL_WANT) return -1;
  const [from, to] = blockSpan(b);
  return from + rollInt(salt, SALT.CALLS, day * 2 + b, 1000 + k, Math.min(WANT_WITHIN, to - from - 30));
}

/** An inmate free to queue: up and about, calm, not busy with the player, a game, the crew or the stage. */
function freeToQueue(sim: SimContext, k: number, waiting = false): boolean {
  const s = sim.state;
  const m = s.inmates[k];
  // (One already waiting may chat with the player: he keeps his place.)
  if (!m || m.ko > 0 || m.angry > 0 || (s.talk === k && !waiting) || s.followers.includes(k)) return false;
  if (m.doing === DOING.SLEEP || m.doing === DOING.BRAWL) return false;
  if (s.match?.team.includes(k) || s.ink?.who === k || s.cheat?.who === k || s.shootout?.who === k || s.dice[0] === k || s.bout[0] === k || s.quiz?.who.includes(k)) return false;
  return true;
}

/** The queue moves on: who joins, who's at the phone, the player's turn. */
function queue(sim: SimContext) {
  const s = sim.state;
  const day = prisonDay(s.step);
  const b = blockNow(s);
  // Inmates who want a call join at their minute, if there's room (from LINE_DAY; never in a replay from before the phone).
  // (Not while the day's event has everyone elsewhere: a movie, talent night.)
  // (And only once the player has used the phone: a run that never does plays as it did before the phone.)
  if (s.step % STEPS_PER_MINUTE === 0 && b >= 0 && day >= LINE_DAY && phoneUsed(s) && !sim.noQueue && crowdPlan(sim, s.routine) === s.routine) {
    if (s.rang.length !== 2 || s.rang[0] !== day) s.rang = [day, 0];
    const m = dayMinute(s.step);
    for (let k = 0; k < s.inmates.length && k < 15; k++) {
      const bit = 1 << (2 * k + b);
      if (s.rang[1] & bit) continue;
      const at = wantsCall(s.salt, day, b, k);
      if (at < 0 || m < at) continue;
      if (s.line.filter((x) => x !== PLAYER_IN_LINE).length >= LINE_MAX || s.booth[0] === k || s.line.includes(k) || !freeToQueue(sim, k)) continue;
      s.rang[1] |= bit;
      s.line.push(k);
      s.inmates[k].path = [];
      sim.events.push({ type: 'phone', what: 'joined', who: k });
    }
  }
  // Someone in line who can't wait now (knocked out, fighting, busy elsewhere; the day's event has them elsewhere) is out of it.
  const elsewhere = crowdPlan(sim, s.routine) !== s.routine;
  s.line = s.line.filter((k) => k === PLAYER_IN_LINE || (!elsewhere && freeToQueue(sim, k, true)));
  if (elsewhere && s.booth[0] >= 0) s.booth = [-1, 0, 0, 0];
  // The player walked off: out of the line.
  const mine = placeInLine(s);
  if (mine >= 0 && !byPhone(sim)) {
    s.line.splice(mine, 1);
    s.turn = 0;
    sim.events.push({ type: 'phone', what: 'left' });
  }
  if (phoneBusy(s) || !s.line.length) {
    if (placeInLine(s) !== 0) s.turn = 0;
    return;
  }
  const first = s.line[0];
  if (first === PLAYER_IN_LINE) {
    // The player's turn: a call soon, or the place is gone.
    if (!s.turn) {
      s.turn = s.step;
      sim.events.push({ type: 'phone', what: 'turn' });
    } else if (s.step - s.turn > TURN_STEPS) {
      s.line.shift();
      s.turn = 0;
      sim.events.push({ type: 'phone', what: 'lostTurn' });
    }
    return;
  }
  // The next inmate walks to the phone.
  s.line.shift();
  s.booth = [first, 0, 0, s.step];
  s.inmates[first].path = [];
}

/** The inmate on the phone: there (his call begins), his call over, eavesdropped on. */
function booth(sim: SimContext, c: CommsDef) {
  const s = sim.state;
  const k = s.booth[0];
  if (k < 0) return;
  const m = s.inmates[k];
  if (!m || m.ko > 0 || m.angry > 0) return void (s.booth = [-1, 0, 0, 0]);
  if (!s.booth[1]) {
    // (At the phone, or a tile from it with someone in the way: he reaches over.)
    if (offBy(c.phone, m.body.x, m.body.z) <= (s.step - s.booth[3] > REACH_STEPS / 3 ? 1 : 0) && !m.body.moving) {
      const day = prisonDay(s.step);
      s.booth[1] = s.step + (INMATE_CALL_MIN + rollInt(s.salt, SALT.CALLS, day, 2000 + k * 2 + Math.max(0, blockNow(s)), INMATE_CALL_SPAN)) * STEPS_PER_MINUTE;
      sim.events.push({ type: 'phone', what: 'inmateCall', who: k });
    } else if (s.step - s.booth[3] > REACH_STEPS) s.booth = [-1, 0, 0, 0];
    return;
  }
  if (s.step >= s.booth[1]) return void (s.booth = [-1, 0, 0, 0]);
  // Listening in: close by, on the ground, not on a call of their own.
  if (playerAbout(sim) && !s.call && Math.max(Math.abs(s.player.x - m.body.x), Math.abs(s.player.z - m.body.z)) <= OVERHEAR_RANGE * UNIT + UNIT / 2) {
    const day = prisonDay(s.step);
    if (s.phoned[5] !== day) {
      s.phoned[4] = 0;
      s.phoned[5] = day;
    }
    if (k < 30 && !(s.phoned[4] & (1 << k)) && ++s.booth[2] >= OVERHEAR_STEPS) {
      s.phoned[4] |= 1 << k;
      sim.events.push({ type: 'phone', what: 'overheard', who: k });
    }
  }
}

/** The queue's people where they stand (socialNow): the caller at the phone, the rest on their tiles, facing it. */
export function phoneTargets(sim: SimContext, so: { follow: Array<Body | null>; gap: number[]; doing: number[]; face: number[] }) {
  const s = sim.state;
  const c = commsOf(sim);
  if (!c || (!s.line.length && s.booth[0] < 0)) return;
  const lead = (k: number, x: number, z: number, doing: number, face: number, j: number) => {
    const m = s.inmates[k];
    if (!m || m.ko > 0 || m.angry > 0) return;
    m.wait = 0;
    const at = marks[j];
    at.x = x * UNIT + UNIT / 2;
    at.z = z * UNIT + UNIT / 2;
    so.follow[k] = at;
    so.gap[k] = 0;
    so.doing[k] = doing;
    so.face[k] = face;
  };
  if (s.booth[0] >= 0) lead(s.booth[0], c.phone.x, c.phone.z, s.booth[1] ? DOING.PHONE : DOING.NOTHING, c.phone.face, 0);
  s.line.forEach((k, j) => {
    const t = c.line[Math.min(j, c.line.length - 1)];
    if (k === PLAYER_IN_LINE || !t) return;
    // (Facing up the line: the tile ahead, the first the phone.)
    lead(k, t.x, t.z, DOING.QUEUE, faceTo(t, j > 0 ? c.line[Math.min(j - 1, c.line.length - 1)] : c.phone), j + 1);
  });
}
const marks: Body[] = [0, 1, 2, 3, 4, 5, 6].map(() => bodyAt(0, 0));

/** The way from a tile to another (1 east, 5 south, 9 west, 13 north). */
function faceTo(from: { x: number; z: number }, to: { x: number; z: number }): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 1 : 9;
  if (dz) return dz > 0 ? 5 : 13;
  return dx > 0 ? 1 : 9;
}

/** The queue asked of (EXT.LINE): a place at its end, out of it, cut in at the front. */
export function lineOp(sim: SimContext, b: number) {
  const s = sim.state;
  if (!commsOf(sim)) return refuse(sim, 'noPhone');
  const mine = placeInLine(s);
  if (b === LINE.LEAVE) {
    if (mine < 0) return;
    s.line.splice(mine, 1);
    s.turn = 0;
    sim.events.push({ type: 'phone', what: 'left' });
    return;
  }
  if (!phoneOpen(sim)) return refuse(sim, s.lockdown ? 'gamesLockdown' : 'phoneClosed');
  if (!byPhone(sim)) return refuse(sim, 'notAtPhone');
  if (s.call) return refuse(sim, 'onPhone');
  if (b === LINE.JOIN) {
    if (mine >= 0) return refuse(sim, 'inLine');
    s.line.push(PLAYER_IN_LINE);
    s.phoned[6] = 1;
    sim.events.push({ type: 'phone', what: 'joined', who: -1, n: s.line.length - 1 });
    return;
  }
  if (b !== LINE.CUT) return;
  if (mine === 0 || (mine < 0 && !s.line.length)) return refuse(sim, 'lineFirst');
  const pushed = s.line.find((k) => k !== PLAYER_IN_LINE) ?? -1;
  const passed = s.line.slice(0, mine < 0 ? s.line.length : mine);
  if (mine >= 0) s.line.splice(mine, 1);
  s.line.unshift(PLAYER_IN_LINE);
  for (const k of passed) changeOpinion(sim, k, CUT_OPINION);
  sim.events.push({ type: 'phone', what: 'cut', n: passed.length });
  // The one pushed back may swing at them.
  if (pushed >= 0) {
    const odds = hostile(sim) ? HOSTILE_SWING : CUT_SWING;
    const lines = s.lou[1] + s.step;
    if (rollInt(s.salt, SALT.CALLS, prisonDay(s.step), 5000 + (lines % 997), 100) < odds) {
      const m = s.inmates[pushed];
      m.angry = ANGRY_STEPS;
      m.doing = DOING.NOTHING;
      m.wait = 0;
      s.line = s.line.filter((k) => k !== pushed);
      if (s.talk === pushed) endTalk(sim);
      sim.events.push({ type: 'phone', what: 'swing', who: pushed });
    }
  }
}

/** A place bought from the inmate the player is talking to, ahead of them in the queue (TALK.SWAP). */
export function swapPlace(sim: SimContext, who: number) {
  const s = sim.state;
  const mine = placeInLine(s);
  const his = s.line.indexOf(who);
  if (mine < 0) return refuse(sim, 'notInLine');
  // (The one just ahead: a place, not the whole line.)
  if (his < 0 || his !== mine - 1) return refuse(sim, 'notAhead');
  if (s.cash < SWAP_PRICE) return refuse(sim, 'cash');
  s.cash -= SWAP_PRICE;
  sim.events.push({ type: 'cash', n: -SWAP_PRICE, why: 'phone' });
  s.line[his] = PLAYER_IN_LINE;
  s.line[mine] = who;
  sim.events.push({ type: 'phone', what: 'swapped', who });
}

// ------------------------------------------------------------------ calls

/** Why the player can't make a call now (null: they can). */
export function callRefusal(sim: SimContext, to: number, sub: number, arg: number): Refusal | null {
  const s = sim.state;
  const c = commsOf(sim);
  if (!c) return 'noPhone';
  if (s.call) return 'onPhone';
  if (!phoneOpen(sim)) return s.lockdown ? 'gamesLockdown' : 'phoneClosed';
  if (!atPhone(sim)) return 'notAtPhone';
  if (s.booth[0] >= 0) return 'phoneBusy';
  const mine = placeInLine(s);
  if (s.line.length && mine !== 0) return 'phoneLine';
  const day = prisonDay(s.step);
  if (to === CALLEE.HOME) {
    if (s.eventFlags & TODAY.CALLED_HOME) return 'calledHome';
  } else if (to === CALLEE.LAWYER) {
    if (sub === LAWYER.APPEAL) {
      if (s.heat >= CHASE_HEAT || s.lockdown) return 'hunted';
      if (s.heat <= 0) return 'clean';
      if (s.eventFlags & TODAY.APPEALED) return 'appealed';
    } else if (sub === LAWYER.RETAINER) {
      if (retained(s)) return 'retained';
    } else return 'noPhone';
  } else if (to === CALLEE.TIP) {
    if (s.eventFlags & TODAY.TIPPED || s.phoned[3] > 0) return 'tipped';
    if (!s.inmates.some((m) => m.cell === arg)) return 'badCell';
  } else if (to === CALLEE.COUSIN) {
    if (sub === JOB.DIVERSION) {
      if (s.eventFlags & TODAY.DIVERTED || s.lou[2] > 0) return 'divertBooked';
      if (divertStep(s.step, arg) < 0) return 'badHour';
    } else if (sub === JOB.CAKE) {
      if (s.lou[4] > 0) return 'cakeComing';
      const d = smugglingOf(sim);
      if (!d || !(d.visits || d.parcel)) return 'noPhone';
    } else if (sub === JOB.CAR) {
      if (s.lou[5] === day) return 'carBooked';
    } else return 'noPhone';
    if (s.cash < COINS + JOB_FEES[sub]) return 'cash';
  } else return 'noPhone';
  if (s.cash < callCost(to, sub)) return 'cash';
  return null;
}

/** A call begun (EXT.CALL; b = CALLEE × 16 + what's asked, c = its argument). */
export function startCall(sim: SimContext, b: number, c: number) {
  const s = sim.state;
  const to = b >> 4;
  const sub = b & 15;
  const why = callRefusal(sim, to, sub, c);
  if (why) return refuse(sim, why);
  const cost = callCost(to, sub);
  s.cash -= cost;
  sim.events.push({ type: 'cash', n: -cost, why: 'phone' });
  if (placeInLine(s) === 0) s.line.shift();
  s.turn = 0;
  s.phoned[6] = 1;
  endTalk(sim);
  const ear = to === CALLEE.COUSIN ? listener(sim) : -1;
  if (to === CALLEE.COUSIN) s.lou[1]++;
  s.call = { to, sub, arg: c, from: s.step, ends: s.step + (to === CALLEE.COUSIN ? LINE_STEPS : CALL_STEPS[to]), at: 0, said: [-1, -1, -1], ear };
  sim.events.push({ type: 'phone', what: 'call', to, sub, arg: c });
}

/**
 * Who listens to Lou's call: a guard drawn by roll() for the day among those awake and not
 * chasing (-1 nobody: none is; or the one drawn is a corrupt guard paid to look the other way
 * today). The same all day: hanging up and calling again doesn't change who's on the tap.
 */
function listener(sim: SimContext): number {
  const s = sim.state;
  const pool = s.guards.map((g, k) => (awake(g) && g.mode !== GUARD.CHASE ? k : -1)).filter((k) => k >= 0);
  if (!pool.length) return -1;
  const k = pool[rollInt(s.salt, SALT.TAP, prisonDay(s.step), 0, pool.length)];
  return lookingAway(s.guards[k], s.step) ? -1 : k;
}

/** The phrases offered on a line of Lou's call, in the order the card shows them: [tier, variant] each. */
export function phrasesOf(s: Pick<SimState, 'salt' | 'lou'>, call: Call, line: number): Array<[number, number]> {
  const key = call.from;
  const out: Array<[number, number]> = [0, 1, 2].map((tier) => {
    let v = rollInt(s.salt, SALT.TAP, key, 100 + line * 3 + tier, VARIANTS);
    // (A deep code Lou already knows for this line is the one offered.)
    if (tier === TIER.DEEP) for (let k = 0; k < VARIANTS; k++) if (s.lou[0] & codeBit(call.sub, line, k)) v = k;
    return [tier, v];
  });
  // Shuffled by roll(): which is which is the player's to read.
  const first = rollInt(s.salt, SALT.TAP, key, 200 + line, 3);
  const flip = rollInt(s.salt, SALT.TAP, key, 300 + line, 2);
  const rest = out.filter((_, k) => k !== first);
  return [out[first], ...(flip ? rest.reverse() : rest)];
}

/** What a phrase said is worth to Lou (clarity) and to the listener (risk). */
export function phraseWorth(s: Pick<SimState, 'lou'>, job: number, line: number, tier: number, v: number): { clarity: number; risk: number } {
  if (tier === TIER.DEEP && s.lou[0] & codeBit(job, line, v)) return { clarity: LEARNED_CLARITY, risk: RISK[TIER.DEEP] };
  return { clarity: CLARITY[tier], risk: RISK[tier] };
}

/** How much risk the listener on a call lets slip before catching it (Infinity: nobody listens). */
export function catchAt(sim: Pick<SimContext, 'world'>, ear: number): number {
  if (ear < 0) return Infinity;
  const def = sim.world.def.guards[ear];
  return def ? CATCH[traitOf(def)] : Infinity;
}

/** A phrase said on Lou's line (EXT.SAY b: its place on the card; 3 hangs up). */
export function say(sim: SimContext, b: number) {
  const s = sim.state;
  const call = s.call;
  if (!call) return;
  if (b === 3) return hangUp(sim);
  if (call.to !== CALLEE.COUSIN || call.at > 2 || b < 0 || b > 2) return;
  const [tier] = phrasesOf(s, call, call.at)[b];
  // (Only its kind is kept: which variant it was comes back from phrasesOf, the same draws.)
  call.said[call.at] = tier;
  sim.events.push({ type: 'phone', what: 'said', n: call.at, tier });
  call.at++;
  call.ends = s.step + LINE_STEPS;
  if (call.at === 3) louHears(sim);
}
/** The call hung up (EXT.SAY 3, walked away, the phone shut): nothing comes of it. */
function hangUp(sim: SimContext) {
  const s = sim.state;
  if (!s.call) return;
  sim.events.push({ type: 'phone', what: 'hungUp', to: s.call.to });
  s.call = null;
}

/** Lou has heard all three lines: understood or not, caught or not; the job booked. */
function louHears(sim: SimContext) {
  const s = sim.state;
  const call = s.call!;
  const job = call.sub;
  let clarity = 0;
  let risk = 0;
  const said = [0, 1, 2].map((line) => {
    const tier = call.said[line];
    const v = phrasesOf(s, call, line).find(([t]) => t === tier)![1];
    const w = phraseWorth(s, job, line, tier, v);
    clarity += w.clarity;
    risk += w.risk;
    return [tier, v] as const;
  });
  s.call = null;
  if (clarity < CLEAR_NEED) {
    sim.events.push({ type: 'phone', what: 'lou', sub: job, ok: false, n: clarity });
    return;
  }
  // Understood: his fee (spent meanwhile: nothing booked), and the deep codes said become his.
  const fee = JOB_FEES[job];
  if (s.cash < fee) {
    refuse(sim, 'cash');
    sim.events.push({ type: 'phone', what: 'lou', sub: job, ok: false, n: clarity, arg: -1 });
    return;
  }
  s.cash -= fee;
  sim.events.push({ type: 'cash', n: -fee, why: 'phone' });
  let learned = 0;
  said.forEach(([tier, v], line) => {
    if (tier === TIER.DEEP && !(s.lou[0] & codeBit(job, line, v))) {
      s.lou[0] |= codeBit(job, line, v);
      learned++;
    }
  });
  const blown = risk >= catchAt(sim, call.ear);
  if (blown) addHeat(sim, TAP_HEAT);
  if (job === JOB.DIVERSION) {
    s.lou[2] = divertStep(s.step, call.arg);
    s.lou[3] = blown ? 1 : 0;
    s.eventFlags |= TODAY.DIVERTED;
  } else if (job === JOB.CAKE) {
    s.lou[4] = blown ? 2 : 1;
    // (Baked and brought in from tomorrow: the next visit or parcel after today.)
    s.lou[7] = prisonDay(s.step);
  }
  else if (job === JOB.CAR) {
    s.lou[5] = prisonDay(s.step);
    s.lou[6] = blown ? 1 : 0;
  }
  sim.events.push({ type: 'phone', what: 'lou', sub: job, ok: true, blown, n: clarity, arg: risk, who: call.ear, learned });
}

/** A plain call's end: what it does. */
function callDone(sim: SimContext, call: Call) {
  const s = sim.state;
  const day = prisonDay(s.step);
  s.call = null;
  if (call.to === CALLEE.HOME) {
    s.eventFlags |= TODAY.CALLED_HOME;
    s.energy = Math.min(100, s.energy + HOME_ENERGY);
    sim.events.push({ type: 'phone', what: 'home', n: HOME_ENERGY });
    askMoney(sim);
  } else if (call.to === CALLEE.LAWYER) {
    if (call.sub === LAWYER.APPEAL) {
      const n = Math.min(s.heat, APPEAL_HEAT);
      s.heat -= n;
      s.eventFlags |= TODAY.APPEALED;
      sim.events.push({ type: 'phone', what: 'appeal', n });
    } else {
      s.phoned[2] = day + RETAINER_DAYS;
      sim.events.push({ type: 'phone', what: 'retainer', n: RETAINER_DAYS });
    }
  } else if (call.to === CALLEE.TIP) {
    s.eventFlags |= TODAY.TIPPED;
    s.phoned[3] = call.arg;
    // The shakedown guard (any guard up and about without one) goes and searches the cell named.
    const k = searcher(sim);
    if (k >= 0) assign(s.guards[k], GUARD.SHAKEDOWN, [call.arg]);
    else s.phoned[3] = 0;
    sim.events.push({ type: 'phone', what: 'tip', cell: call.arg, who: k });
    // Word may get round to the inmate named.
    const named = s.inmates.findIndex((m) => m.cell === call.arg);
    if (named >= 0 && rollInt(s.salt, SALT.CALLS, day, 4000 + call.arg, 100) < SNITCH_ODDS) {
      changeOpinion(sim, named, SNITCH_OPINION);
      sim.events.push({ type: 'phone', what: 'snitch', who: named });
    }
  }
}

/**
 * Once a week the family sends money, paid at the next mail call: asked for by a call home, or
 * (P35) a letter from the kiosk, whichever comes first that week. The dollars sent (0: not yet).
 */
export function askMoney(sim: SimContext): number {
  const s = sim.state;
  const day = prisonDay(s.step);
  if (s.phoned[0] && day - s.phoned[0] < MONEY_EVERY) return 0;
  const n = MONEY_MIN + rollInt(s.salt, SALT.CALLS, day, 3000, MONEY_SPAN);
  s.phoned[0] = day;
  s.phoned[1] += n;
  sim.events.push({ type: 'phone', what: 'moneyOrder', n });
  return n;
}

/** Who searches a cell tipped off: the shakedown guard, else the first guard awake (-1 none). */
function searcher(sim: SimContext): number {
  const s = sim.state;
  const defs = sim.world.def.guards;
  const k = defs.findIndex((d) => d.duties?.includes('shakedown'));
  if (k >= 0 && awake(s.guards[k]) && s.guards[k].mode !== GUARD.CHASE) return k;
  return s.guards.findIndex((g) => awake(g) && g.mode !== GUARD.CHASE);
}

/** The player's call goes on: walked away or the phone shut (hung up), a line's time up (Lou hangs up), a plain call over. */
function keepCall(sim: SimContext) {
  const s = sim.state;
  const call = s.call;
  if (!call) return;
  if (!phoneOpen(sim) || !atPhone(sim)) return hangUp(sim);
  if (s.step < call.ends) return;
  if (call.to === CALLEE.COUSIN) {
    s.call = null;
    sim.events.push({ type: 'phone', what: 'silence' });
    return;
  }
  callDone(sim, call);
}

// ------------------------------------------------------------------ what comes of it

/** 12:00: the mail (a money order waiting), outside a lockdown. */
function mailCall(sim: SimContext) {
  const s = sim.state;
  if (s.phoned[1] <= 0 || s.lockdown) return;
  const n = s.phoned[1];
  s.phoned[1] = 0;
  s.cash += n;
  s.tally[3] += n;
  sim.events.push({ type: 'cash', n, why: 'mail' });
  sim.events.push({ type: 'phone', what: 'mail', n });
}

/** Lou's diversion goes off: the nearest guards go and look at the gate (blown: they know it's nothing). */
function diversion(sim: SimContext, c: CommsDef) {
  const s = sim.state;
  const tile = c.gate.z * MAP_W + c.gate.x;
  // (Blown, or the sirens on: the guards have better things to do.)
  const blown = s.lou[3] === 1 || s.lockdown;
  s.lou[2] = 0;
  s.lou[3] = 0;
  if (!blown) summon(sim, tile, DIVERT_GUARDS, DIVERT_LOOK);
  sim.events.push({ type: 'phone', what: blown ? 'ignored' : 'diversion', tile });
}

/** A tip's search: the cell searched (something found or nothing: heat). */
function tipOutcome(sim: SimContext) {
  const s = sim.state;
  const cell = s.phoned[3];
  if (!cell) return;
  for (const e of sim.events) {
    if (e.type !== 'searched' || e.cell !== cell) continue;
    s.phoned[3] = 0;
    if (e.taken > 0) sim.events.push({ type: 'phone', what: 'tipFound', cell, n: e.taken });
    else {
      addHeat(sim, TIP_HEAT);
      sim.events.push({ type: 'phone', what: 'tipEmpty', cell });
    }
    return;
  }
  // (Lights Out: a search not made is off, and so is the tip.)
  if (s.step % STEPS_PER_MINUTE === 0 && ROUTINE[s.routine].id === 'lightsOut') s.phoned[3] = 0;
}

/** The cake at a visit (smuggling.ts visit): into the hotbar (no room: kept for the next), or taken by the guard (blown). */
export function cakeAtVisit(sim: SimContext) {
  const s = sim.state;
  if (!s.lou[4] || prisonDay(s.step) <= s.lou[7]) return;
  if (s.lou[4] === 2) {
    s.lou[4] = 0;
    sim.events.push({ type: 'phone', what: 'cakeSeized' });
    return;
  }
  const free = s.items.inv.slice(0, HOTBAR).indexOf(0);
  if (free < 0) return void sim.events.push({ type: 'phone', what: 'cakeKept' });
  s.items.inv[free] = slot(CAKE);
  s.items.rev++;
  s.lou[4] = 0;
  sim.events.push({ type: 'phone', what: 'cake' });
}

/** Stalag Flucht's cake: in the Red Cross parcel on delivery day (from PARCEL_MINUTE), into the desk's open slots. */
function cakeParcel(sim: SimContext) {
  const s = sim.state;
  const d = smugglingOf(sim);
  if (!s.lou[4] || prisonDay(s.step) <= s.lou[7] || !d?.parcel || dayMinute(s.step) < PARCEL_MINUTE || today(sim).event !== 'delivery') return;
  if (s.lou[4] === 2) {
    s.lou[4] = 0;
    sim.events.push({ type: 'phone', what: 'cakeSeized' });
    return;
  }
  const w = sim.world;
  const desk = containersOf(w).findIndex((c) => c.mine && c.prop.kind === 'desk');
  const box = desk >= 0 ? s.items.containers[desk] : null;
  const free = box ? box.indexOf(0, containersOf(w)[desk].hidden) : -1;
  if (!box || free < 0) return;
  box[free] = slot(CAKE);
  s.items.rev++;
  s.lou[4] = 0;
  sim.events.push({ type: 'phone', what: 'cake' });
}

/** The cake eaten (actions.ts): energy, and the file inside in hand. */
export function eatCake(sim: SimContext) {
  const s = sim.state;
  s.items.inv[s.items.hand] = slot(FILE);
  s.items.rev++;
  s.energy = Math.min(100, s.energy + CAKE_ENERGY);
  sim.events.push({ type: 'ate', item: CAKE });
}

/** Out on the road on the night Lou's car waits (Sim.out): away in it. */
export function wheels(sim: SimContext, via: string) {
  const s = sim.state;
  if (!s.lou[5] || s.lou[6] || via === 'raft' || via === 'helicopter' || via === 'stowaway') return;
  const day = prisonDay(s.step);
  const m = dayMinute(s.step);
  if (s.lou[5] !== day || m < CAR_FROM || m >= CAR_TO) return;
  s.lou[5] = -day;
  sim.events.push({ type: 'phone', what: 'wheels' });
}

/** Lou's car waits on the road now (the view draws it): tonight, unless blown. */
export const carWaiting = (s: Pick<SimState, 'lou' | 'step'>) => s.lou[5] > 0 && !s.lou[6] && s.lou[5] === prisonDay(s.step) && dayMinute(s.step) >= CAR_FROM && dayMinute(s.step) < CAR_TO;

/** Each step: the queue, the inmate on the phone, the player's call, the mail, Lou's jobs, a tip's search. */
export function phone(sim: SimContext) {
  const s = sim.state;
  const c = commsOf(sim);
  if (!c) return;
  if (s.step % STEPS_PER_MINUTE === 0) {
    const m = dayMinute(s.step);
    if (m === MAIL_MINUTE) mailCall(sim);
    cakeParcel(sim);
  }
  if (s.lou[2] > 0 && s.step >= s.lou[2]) diversion(sim, c);
  tipOutcome(sim);
  // Out of hours: nobody queues, nobody's on it.
  if (!phoneOpen(sim)) {
    if (s.line.length || s.booth[0] >= 0) {
      s.line = [];
      s.booth = [-1, 0, 0, 0];
      s.turn = 0;
    }
    if (s.call) hangUp(sim);
    return;
  }
  keepCall(sim);
  booth(sim, c);
  queue(sim);
}

/** For the card: the dollars waiting at mail call, the prison day the next money order can be asked for. */
export const mailWaiting = (s: Pick<SimState, 'phoned'>) => s.phoned[1];
export const nextMoneyDay = (s: Pick<SimState, 'phoned'>) => (s.phoned[0] ? s.phoned[0] + MONEY_EVERY : 0);
