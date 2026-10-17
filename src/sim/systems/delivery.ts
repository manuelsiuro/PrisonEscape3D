/**
 * Delivery day (P18): once a week a vehicle comes in at 12:30 (Center Perks' supply truck,
 * Stalag Flucht's Red Cross truck, San Pancho's produce truck, Irongate's supply helicopter)
 * and leaves at 14:31. While it's in, its bay is solid and stops sight, the doors it needs
 * stand open, and its supervisor walks a round of it instead of his own. A player who reaches
 * its tail unseen can climb in: hidden, going nowhere on foot (the routine's blocks still
 * count as missed), never seen. At 14:25 the supervisor goes to the tail to sign it off; at
 * 14:30, if he's there (on duty, awake, within SEARCH_REACH tiles and not bribed to look the
 * other way), he searches it: thoroughly on some days (the prison's odds, every day for a
 * strict guard, and for WARY_DAYS after a stowaway is caught), and a thorough search finds
 * whoever hides in it. In a lockdown nothing leaves unsearched (damage the guards find
 * while the player hides raises it as ever). At 14:31 it drives off, and a
 * stowaway still aboard is out (route `stowaway`).
 */
import type { DeliveryDef, Waypoint } from '../../content/prisons/types';
import { SEARCH_REACH, SIGN_OFF_MINUTES, WARY_DAYS } from '../../content/days';
import { nearestDir } from '../ai/path';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import { CHASE_HEAT, KO_STEPS, SOLITARY_HEAT, UNIT } from '../tuning';
import { LAYER, MAP_H, MAP_W } from '../world/World';
import { closeBox, standUp } from './actions';
import { eventOn, today, TODAY, type DayPlan } from './calendar';
import { dayMinute, prisonDay } from './clock';
import { awake, GUARD, traitOf } from './guards';
import { caught } from './justice';
import type { Body } from './movement';
import { endTalk } from './social';
import { stopTraining } from './training';
import { lookingAway } from './ways';

/** How near the tail the player stands to climb in (units from its middle, either way). */
const TAIL_REACH = Math.round(UNIT * 0.75);

/** The prison's delivery (none in a relaxed prison: the Training Block has no vehicle anyway). */
const deliveryOf = (sim: Pick<SimContext, 'world'>): DeliveryDef | undefined => (sim.world.def.rules?.relaxed ? undefined : sim.world.def.delivery);

/** The vehicle is in now: 12:30–14:31 on a delivery day. */
export const vehicleIn = (sim: Pick<SimContext, 'world' | 'prison' | 'state'>) => !!deliveryOf(sim) && eventOn(sim, 'delivery');

/** When the search comes and the vehicle leaves (minutes into the prison day), from the day's plan. */
export const searchMinute = (p: DayPlan) => p.until - 1;
const signOffMinute = (p: DayPlan) => searchMinute(p) - SIGN_OFF_MINUTES;

/**
 * Whether a day's search is thorough: a strict supervisor's always is, and every one for
 * WARY_DAYS after a stowaway was caught; else the prison's odds, drawn for the day. Pure (the
 * gossip tells it, the tests check it).
 */
export function thorough(sim: Pick<SimContext, 'world' | 'state'>, day = prisonDay(sim.state.step)): boolean {
  const d = sim.world.def.delivery;
  if (!d) return false;
  const s = sim.state;
  if (traitOf(sim.world.def.guards[d.supervisor]) === 'strict') return true;
  if (s.stowCaught > 0 && day > s.stowCaught && day <= s.stowCaught + WARY_DAYS) return true;
  return rollInt(s.salt, SALT.DELIVERY, day, 0, 100) < d.thorough;
}

/** What the supervisor is to do now (guards.ts): walk the vehicle's round, or sign it off at its tail. Null while it isn't in. */
export interface DeliveryDuty {
  guard: number;
  round: readonly Waypoint[];
  /** At the tail, facing the vehicle (the last minutes before the search). */
  signOff: Waypoint | null;
}

export function deliveryDuty(sim: Pick<SimContext, 'world' | 'prison' | 'state'>): DeliveryDuty | null {
  const d = deliveryOf(sim);
  if (!d || !vehicleIn(sim)) return null;
  const m = dayMinute(sim.state.step);
  const signing = m >= signOffMinute(today(sim));
  return { guard: d.supervisor, round: d.round, signOff: signing ? { x: d.tail.x, z: d.tail.z, face: d.face } : null };
}

/** The middle of the tail tile (units). */
const tailX = (d: DeliveryDef) => d.tail.x * UNIT + UNIT / 2;
const tailZ = (d: DeliveryDef) => d.tail.z * UNIT + UNIT / 2;

/** The player stands at the vehicle's tail while it's in (on the ground floor, not hidden already): Interact climbs in. */
export function atTail(sim: SimContext): boolean {
  const d = deliveryOf(sim);
  const s = sim.state;
  // (Not once the tailgate is shut for the search.)
  if (!d || !sim.world.delivering || s.layer !== LAYER.GROUND || s.stowed || dayMinute(s.step) >= searchMinute(today(sim))) return false;
  return Math.abs(s.player.x - tailX(d)) <= TAIL_REACH && Math.abs(s.player.z - tailZ(d)) <= TAIL_REACH;
}

/**
 * Into the vehicle (Interact at its tail, before the search): not under a guard's eyes
 * (s.seen: a guard not looking the other way, or a camera), not while wanted or in a lockdown.
 */
export function stow(sim: SimContext) {
  const s = sim.state;
  if (s.heat >= CHASE_HEAT || s.lockdown) return refuse(sim, 'hunted');
  if (s.seen || s.guards.some((g) => g.mode === GUARD.CHASE)) return refuse(sim, 'watched');
  standUp(sim);
  stopTraining(sim);
  endTalk(sim);
  closeBox(sim);
  s.lock = -1;
  s.player.moving = false;
  s.stowed = true;
  sim.events.push({ type: 'stow', on: true });
}

/** Out of the vehicle again (Interact while hidden), back at its tail. */
export function climbOut(sim: SimContext) {
  if (!sim.state.stowed) return;
  sim.state.stowed = false;
  sim.events.push({ type: 'stow', on: false });
}

const refuse = (sim: SimContext, why: 'hunted' | 'watched') => {
  sim.events.push({ type: 'refused', why });
};

/**
 * The day's delivery, on each minute's first step (calendar.ts theDay): the sign-off, the
 * search, and the departure (a stowaway aboard is out with it).
 */
export function deliveryMinute(sim: SimContext, p: DayPlan, m: number) {
  const d = deliveryOf(sim);
  if (!d || p.event !== 'delivery') return;
  if (m === signOffMinute(p)) sim.events.push({ type: 'today', event: 'delivery', phase: 'signOff' });
  if (m === searchMinute(p)) search(sim, d, p.day);
  if (m === p.until && sim.state.stowed) sim.boarded = 'stowaway';
}

/** 14:30: the supervisor at the tail searches it (thoroughly or not), or nobody does and it's waved through; in a lockdown it's searched to the last crate. */
function search(sim: SimContext, d: DeliveryDef, day: number) {
  const s = sim.state;
  const g = s.guards[d.supervisor];
  const there = !!g && awake(g) && g.mode === GUARD.DUTY && !lookingAway(g, s.step) && Math.max(Math.abs(g.body.x - tailX(d)), Math.abs(g.body.z - tailZ(d))) <= SEARCH_REACH * UNIT;
  const close = thorough(sim, day) || s.lockdown;
  if (!there && !s.lockdown) {
    s.eventFlags |= TODAY.WAVED;
    sim.events.push({ type: 'today', event: 'delivery', phase: 'waved', thorough: close });
    return;
  }
  s.eventFlags |= close ? TODAY.SEARCHED_CLOSE : TODAY.SEARCHED;
  sim.events.push({ type: 'today', event: 'delivery', phase: 'search', thorough: close });
  if (!close || !s.stowed) return;
  // Found: pulled out at the tail, the escape attempt plain to see (solitary), every search thorough for a while.
  s.stowed = false;
  s.stowCaught = day;
  sim.events.push({ type: 'stow', on: false, found: true });
  s.heat = Math.max(s.heat, SOLITARY_HEAT);
  caught(sim);
  if (g && awake(g)) {
    g.wait = KO_STEPS;
    g.body.moving = false;
    const p = s.player;
    if (g.body.x !== p.x || g.body.z !== p.z) g.body.facing = nearestDir(p.x - g.body.x, p.z - g.body.z);
  }
}

/**
 * The vehicle has just come in (Sim, as its bay turns solid): anyone standing where it parks
 * steps out of the way to the nearest free tile, and inmates heading for a spot under it
 * choose again.
 */
export function clearBay(sim: SimContext) {
  const w = sim.world;
  const s = sim.state;
  const move = (b: Body, grid: Uint8Array) => {
    if (!overBay(w.parked, b)) return;
    const to = nearestFree(w.parked, grid, Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT));
    if (to < 0) return;
    b.x = (to % MAP_W) * UNIT + UNIT / 2;
    b.z = Math.floor(to / MAP_W) * UNIT + UNIT / 2;
    b.moving = false;
  };
  if (s.layer === LAYER.GROUND) move(s.player, w.block);
  for (const m of s.inmates) {
    move(m.body, w.npcBlock);
    if (m.goal >= 0 && w.parked[m.goal]) {
      m.goal = -1;
      m.path = [];
    }
  }
  // (Guards, and their dogs, P19.)
  for (const g of [...s.guards, ...s.dogs]) {
    move(g.body, w.guardBlock);
    if (g.path.some((t) => w.parked[t])) {
      g.path = [];
      g.goal = -1;
    }
  }
}

/** Whether a body's footprint touches the bay. */
function overBay(parked: Uint8Array, b: Body): boolean {
  const r = Math.round(UNIT * 0.3);
  for (const x of [b.x - r, b.x + r - 1])
    for (const z of [b.z - r, b.z + r - 1]) {
      const tx = Math.floor(x / UNIT);
      const tz = Math.floor(z / UNIT);
      if (tx >= 0 && tz >= 0 && tx < MAP_W && tz < MAP_H && parked[tz * MAP_W + tx]) return true;
    }
  return false;
}

/** The nearest tile (4-way steps out from `from`) that isn't under the vehicle and is free to stand on. */
function nearestFree(parked: Uint8Array, grid: Uint8Array, from: number): number {
  const seen = new Set<number>([from]);
  const queue = [from];
  for (let k = 0; k < queue.length && k < 400; k++) {
    const t = queue[k];
    if (!parked[t] && !grid[t]) return t;
    const x = t % MAP_W;
    for (const [j, ok] of [
      [t - 1, x > 0],
      [t + 1, x < MAP_W - 1],
      [t - MAP_W, t >= MAP_W],
      [t + MAP_W, t < MAP_W * (MAP_H - 1)],
    ] as const) {
      // (Out through the bay and onto open floor, never through a wall.)
      if (!ok || seen.has(j) || (!parked[j] && grid[j])) continue;
      seen.add(j);
      queue.push(j);
    }
  }
  return -1;
}
