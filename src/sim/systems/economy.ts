import { itemNumber } from '../../content/items';
import { JOBS, type JobDef } from '../../content/jobs';
import { zoneIndex } from '../../content/zones';
import { DIR_X, DIR_Z } from '../command';
import { MAX_DISCOUNT, OPINION_START, UNIT } from '../tuning';
import { MAP_W, type Prop, type World } from '../world/World';
import { freeHotbar, hotbarSlotOf, itemOf } from './items';
import type { Body } from './movement';

/**
 * The prison economy and social life (GDD §3.2, §10.3–10.4, §11) as pure functions: which
 * furniture each job works with, what the action button would do at a job station, prices,
 * favors. The simulation (Sim) keeps the state and applies them.
 */

/** A favor an inmate asks (GDD §10.4). Plain data in the state. */
export interface Favor {
  /** Who asks (Cast id). */
  by: number;
  /** FAVOR kind. */
  kind: number;
  /** The item to bring (scavenge, retrieval), 0 for none. */
  item: number;
  /** Who it's about (retrieval: holds the item; beatdown: to knock out), -1 for none. */
  target: number;
  /** Dollars paid when it's handed in. */
  reward: number;
  /** FAVOR_STATE. */
  state: number;
}

/** Favor kinds (GDD §10.4). Never renumber: saves store them. */
export const FAVOR = { SCAVENGE: 0, RETRIEVE: 1, BEATDOWN: 2, DISTRACTION: 3 } as const;
export const FAVOR_KINDS = ['scavenge', 'retrieve', 'beatdown', 'distraction'] as const;
/** Offered (the "!" over their head), taken on, done (ready to hand in). */
export const FAVOR_STATE = { OFFERED: 0, TAKEN: 1, DONE: 2 } as const;
/** What favors ask to be found: everyday things from desks. */
export const FAVOR_ITEMS: readonly string[] = ['magazine', 'soap', 'battery', 'talcum', 'ink', 'chocolate', 'sock', 'toothpaste'];

/** Who holds a job: the player, nobody, else an inmate's Cast id. */
export const HOLDER = { PLAYER: -1, NOBODY: -2 } as const;

/** The furniture a job works with (prop indices; -1 when the room has none). */
export interface JobRoom {
  def: JobDef;
  zone: number;
  take: number;
  put: number;
  machines: number[];
}

const rooms = new WeakMap<World, JobRoom[]>();

/** The prison's jobs, in its own order, with their furniture. */
export function jobRooms(w: World): JobRoom[] {
  let list = rooms.get(w);
  if (list) return list;
  list = w.def.jobs.map(({ id }) => {
    const def = JOBS[id];
    const zone = zoneIndex(def.zone);
    const inRoom = (kind: string | undefined) => w.props.map((p, i) => ({ p, i })).filter(({ p }) => p.kind === kind && w.ground.zone[p.z * MAP_W + p.x] === zone);
    const take = inRoom(def.take);
    const put = inRoom(def.put);
    return {
      def,
      zone,
      take: take[0]?.i ?? -1,
      put: put[put.length - 1]?.i ?? -1,
      machines: inRoom(def.machine).map(({ i }) => i),
    };
  });
  rooms.set(w, list);
  return list;
}

/** Distance (units) from a body to a prop's footprint, along the larger axis. */
function reachOfProp(p: Prop, b: Body): number {
  const dx = Math.max(p.x * UNIT - b.x, 0, b.x - (p.x + p.w) * UNIT);
  const dz = Math.max(p.z * UNIT - b.z, 0, b.z - (p.z + p.d) * UNIT);
  return Math.max(dx, dz);
}

/** How close to a job station, the job board or gym equipment the player must stand (units). */
export const STATION_REACH = Math.round(UNIT * 0.85);

/** Whether a body faces a prop (its middle is ahead of them). */
function faces(p: Prop, b: Body): boolean {
  const fx = DIR_X[b.facing] ?? 0;
  const fz = DIR_Z[b.facing] ?? 0;
  return fx * ((p.x + p.w / 2) * UNIT - b.x) + fz * ((p.z + p.d / 2) * UNIT - b.z) > 0;
}

/** The nearest prop of some kinds within reach (the one faced wins ties), -1 for none. */
export function nearestProp(w: World, b: Body, ok: (p: Prop, i: number) => boolean, reach = STATION_REACH): number {
  let best = -1;
  let bestScore = Infinity;
  w.props.forEach((p, i) => {
    if (!ok(p, i)) return;
    const d = reachOfProp(p, b);
    if (d > reach) return;
    const sc = d - (faces(p, b) ? UNIT / 3 : 0);
    if (sc < bestScore) {
      bestScore = sc;
      best = i;
    }
  });
  return best;
}

/** What the action button does at a job station (GDD §11.1). */
export type StationAct = 'take' | 'load' | 'running' | 'unload' | 'put' | 'sort' | 'mop' | 'full';
export interface Station {
  /** Prop index (a puddle: -1). */
  prop: number;
  /** The tile mopped (puddles), -1 otherwise. */
  tile: number;
  act: StationAct;
  /** The item taken, put in or handed over. */
  item: number;
}

/** What the player's job lets them do here, with what's in hand and what the machines hold. */
export interface WorkState {
  job: number;
  /** On the clock: the Work Period, the job counting today, the quota not yet done. */
  onDuty: boolean;
  machines: Record<number, number>;
  puddles: number[];
  step: number;
  /** Carried slots (hotbar) and the hand. */
  inv: number[];
  hand: number;
  /** The mail round: inmates still waiting for a letter (Cast ids). */
  mail: readonly number[];
  /** Pieces still owed today (the quota less those handed in). */
  owed: number;
}

/**
 * Whether the player may take job j: Intellect enough for it, or it's the job the prison gave
 * them on day 1 (Shankton starts the player in the metalshop at Intellect 40 of 60: fired once,
 * they may still have it back).
 */
export const qualifies = (w: World, int: number, j: number) => int >= jobRooms(w)[j].def.int || w.def.jobs[j]?.cell === 1;

const hotbarHas = (s: WorkState, item: number) => hotbarSlotOf(s.inv, item) >= 0;

/** The job station in reach and what it would do now, or null (the action button falls back to the usual). */
export function stationTarget(w: World, s: WorkState, b: Body): Station | null {
  if (s.job < 0 || !s.onDuty) return null;
  const room = jobRooms(w)[s.job];
  if (!room) return null;
  const def = room.def;
  const raw = def.raw ? itemNumber(def.raw) : 0;
  const done = def.done ? itemNumber(def.done) : 0;
  const free = freeHotbar(s.inv) >= 0;
  const held = itemOf(s.inv[s.hand]);
  // Mopping: a puddle underfoot or just ahead, mop in hand.
  if (def.flow === 'mop' && held === raw) {
    const t = puddleAt(s.puddles, b);
    if (t >= 0) return { prop: -1, tile: t, act: 'mop', item: raw };
  }
  const machine = nearestProp(w, b, (_, i) => room.machines.includes(i));
  if (machine >= 0) {
    const ready = s.machines[machine];
    if (ready !== undefined) {
      if (s.step < ready) return { prop: machine, tile: -1, act: 'running', item: done };
      return { prop: machine, tile: -1, act: free ? 'unload' : 'full', item: done };
    }
    // Sorting only while someone still waits for a letter not already in the bag or on a desk.
    if (def.flow === 'mail') {
      let pending = 0;
      for (const k in s.machines) if (room.machines.includes(Number(k))) pending++;
      for (let k = 0; k < 6; k++) if ((s.inv[k] & 255) === done) pending++;
      return s.mail.length > pending ? { prop: machine, tile: -1, act: 'sort', item: done } : null;
    }
    if (hotbarHas(s, raw)) return { prop: machine, tile: -1, act: 'load', item: raw };
  }
  const put = room.put >= 0 && room.put !== room.take ? nearestProp(w, b, (_, i) => i === room.put) : -1;
  if (put >= 0 && done && hotbarHas(s, done)) return { prop: put, tile: -1, act: 'put', item: done };
  const take = room.take >= 0 ? nearestProp(w, b, (_, i) => i === room.take) : -1;
  // A fresh one only with nothing of the kind on the go (in the hands or in a machine), and
  // only while the quota still wants one: a piece taken past it (contraband sheet metal, timber)
  // would be left in the pockets once the job is paid.
  let going = 0;
  for (const k in s.machines) if (room.machines.includes(Number(k))) going++;
  for (let k = 0; k < 6; k++) if ((s.inv[k] & 255) === done) going++;
  if (take >= 0 && raw && !hotbarHas(s, raw) && !(done && hotbarHas(s, done)) && (def.flow !== 'machine' || s.owed > going)) return { prop: take, tile: -1, act: free ? 'take' : 'full', item: raw };
  return null;
}

const PUDDLE_AHEAD = Math.round(UNIT * 0.6);

/** A puddle under the player or a step ahead of them (-1 for none). */
function puddleAt(puddles: readonly number[], b: Body): number {
  const fx = DIR_X[b.facing] ?? 0;
  const fz = DIR_Z[b.facing] ?? 0;
  for (const reach of [0, PUDDLE_AHEAD]) {
    const x = Math.floor((b.x + Math.trunc((fx * reach) / 1024)) / UNIT);
    const z = Math.floor((b.z + Math.trunc((fz * reach) / 1024)) / UNIT);
    const t = z * MAP_W + x;
    if (puddles.includes(t)) return t;
  }
  return -1;
}

/** A merchant's discount (GDD §10.3): nothing at the starting opinion, up to 50% at 100. */
export const discountOf = (opinion: number) => (Math.max(0, Math.min(100, opinion) - OPINION_START) / (100 - OPINION_START)) * MAX_DISCOUNT;

/** What a merchant asks for an item worth `value` (whole dollars, at least 1). */
export const priceOf = (value: number, opinion: number) => Math.max(1, Math.round(value * (1 - discountOf(opinion))));

/** How much a gift is worth to the one given it (opinion points): half its value, 2–15. */
export const giftOpinion = (value: number) => Math.max(2, Math.min(15, Math.round(value / 2)));
/** Cash given as a present: 3 points for $5, 6 for $10, 12 for $20. */
export const cashOpinion = (dollars: number) => Math.round(dollars * 0.6);
/** The amounts the talk panel offers to give. */
export const CASH_GIFTS: readonly number[] = [5, 10, 20];
