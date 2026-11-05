import { cornersOf } from '../../content/grounds';
import { JOBS } from '../../content/jobs';
import { OPEN_HOURS, ROUTINE } from '../../content/routine';
import { zoneIndex, type ZoneId } from '../../content/zones';
import { DOING, ON_MACHINE } from '../ai/doing';
import { clearLine, nearestDir } from '../ai/path';
import { centerX, centerZ, tileAt } from '../world/grid';
import { lineOfSight } from '../ai/sight';
import { route, walkPath, type Crowd, type Walker } from '../ai/walker';
import { floorOf, placesOf, type Spot } from '../ai/places';
import { randomInt } from '../rng';
import { BODY_HALF, BROWSE_STEPS, DUTY_HAND_STEPS, DUTY_MOP_STEPS, DUTY_REST_STEPS, EAT_SPREAD, FLEE_RANGE, FLEE_SPEED, HOSTILE_GRUDGE, HOSTILE_OPINION, INMATE_DRY_STEPS, INMATE_EAT_STEPS, INMATE_REACTION, INMATE_WASH_STEPS, INMATE_SPEED, INMATE_STR_MIN, JOG_EXTRA, INMATE_STR_SPAN, OPINION_START, SERVE_STEPS, STEPS_PER_SECOND, UNIT, WASH_SPREAD } from '../tuning';
import { MAP_H, MAP_W, type World } from '../world/World';
import { DIR_X, DIR_Z } from '../command';
import { maxHealth, type Fighter } from './combat';
import { bodyAt, type Body } from './movement';

/**
 * What someone is doing where they stand (the view poses it): inmates, guards (searching), the
 * player (knocked out). Append only. (P22's WRESTLE, PICK and DICE are the view's alone: an
 * arm-wrestle, a lock being picked, dice thrown; the sim never sets them.) P23: BRAWL, two inmates
 * scrapping (the sim's); LOOKOUT, a lookout on watch (the view's). P40: DIG, an inmate digging under his
 * bed while the player keeps a lookout for him (the sim's: an odd job). 2.25: SERVE, at the serving
 * counter, a tray picked up or put back.
 */
export { DOING };

/** A meal's tray (2.25, canteen.ts), the player's or an inmate's: none, with its food, eaten. */
export const TRAY = { NONE: 0, FULL: 1, EMPTY: 2 } as const;

/** The plan an inmate follows: a routine block's index, or this during a lockdown. */
export const LOCKDOWN_PLAN = -2;

/** An AI inmate. Plain data, part of the simulation state. */
export interface Inmate extends Walker, Fighter {
  /** Its cell number (2–8; cell 1 is the player's). */
  cell: number;
  /** DOING, once it has arrived. */
  doing: number;
  /** The plan its goal was chosen for (routine index or LOCKDOWN_PLAN; -1 none yet). */
  plan: number;
  /** Direction to face on arrival (1–16). */
  face: number;
  /** What to do on arrival. */
  then: number;
  /** Steps left fighting the player back (hit by them, GDD §10.1); 0 when calm. */
  angry: number;
  /** What it thinks of the player (GDD §10.3): 0–100, from 50. */
  opinion: number;
  /** Today's Work Period (GDD §11): 0 not at work yet, 1 turned up, 2 knocked out on the job (it loses the job at 15:00). */
  shift: number;
  /** This meal's tray (TRAY), in hand or on the table in front of it. */
  tray: number;
  /** The seat kept for this meal while it goes to the counter and back (its tile, -1 none), and the way it faces there. */
  seat: number;
  seatFace: number;
  /** 2.26: steps left squaring up before an ambush (angry, standing, no blows yet). */
  windup: number;
  /** 2.30: how far through the day's work: its legs from station to station, counted up from 0 at the bell. */
  duty: number;
  /** 2.31: at a library shelf choosing a book (1), a book in hand (2), neither (0). */
  book: number;
  /** 2.32: what it's bought from the machine and is still eating or drinking (an item, 0 none), until this step. */
  snack: number;
  snackEnd: number;
}

/** Where inmates like to spend free time (their own cell is added). */
const HANGOUTS: readonly ZoneId[] = ['yard', 'yard', 'library', 'gym', 'cellBlock', 'rollCall', 'corridor', 'canteen'];
/** 2.31: the library's a place people go. */
const HANGOUTS_READ: readonly ZoneId[] = [...HANGOUTS, 'library', 'library'];
/** P31: where they go with a sports ground and a garden open (the courtyard is the quiet yard now). */
const HANGOUTS_GROUNDS: readonly ZoneId[] = ['yard', 'sports', 'sports', 'garden', 'library', 'gym', 'cellBlock', 'rollCall', 'corridor', 'canteen'];
const HANGOUTS_GROUNDS_READ: readonly ZoneId[] = [...HANGOUTS_GROUNDS, 'library', 'library'];

/** One inmate per cell after the player's, starting in bed-side position (in a hostile prison, cooler towards the player). */
export function spawnInmates(w: World, rng: { rng: number }): Inmate[] {
  const out: Inmate[] = [];
  const places = placesOf(w);
  for (let cell = 2; cell <= w.def.cells.length; cell++) {
    const t = places.bedside[cell];
    out.push({
      body: bodyAt(t % MAP_W, Math.floor(t / MAP_W)),
      cell,
      doing: DOING.NOTHING,
      plan: -1,
      goal: -1,
      face: 5,
      then: DOING.NOTHING,
      path: [],
      wait: 0,
      speed: INMATE_SPEED - 12 + randomInt(rng, 25),
      stall: 0,
      ...fighter(INMATE_STR_MIN + randomInt(rng, INMATE_STR_SPAN)),
      angry: 0,
      opinion: !w.def.rules?.hostile ? OPINION_START : cell % 4 === 0 ? HOSTILE_GRUDGE : HOSTILE_OPINION,
      shift: 0,
      tray: TRAY.NONE,
      windup: 0,
      seat: -1,
      seatFace: 0,
      duty: 0,
      book: 0,
      snack: 0,
      snackEnd: 0,
    });
  }
  return out;
}

/** A fighter's starting numbers: full health, up and about. */
/** The inmate in a cell (an index; -1 none). */
export const inmateInCell = (s: { inmates: readonly Inmate[] }, cell: number) => s.inmates.findIndex((m) => m.cell === cell);

export const fighter = (str: number) => ({ hp: maxHealth(str), ko: 0, str, swing: -1000 });

/** The player's seat (its tile, -1 standing): nobody picks it while they sit there. */
let playerSeat = -1;
/** The tiles kept clear this step (Social.off). */
let offTiles: readonly number[] = [];
/** A meal on, fetched from the serving counter (Social.serve). */
let serving = false;
/** The showers taken in turns (Social.turns). */
let turns = false;
/** The gym's machines in use (Social.machines). */
let machines = false;
let reads = false;

/** 2.30: inmates work their stations (Social.jobOf: each one's job, -1 none; empty: replaying an older run). */
let jobOf: readonly number[] = [];

/** The delivery's bay while its vehicle is in (P18): nobody picks a spot under it. */
let bay: Uint8Array | null = null;

/** Goals other inmates already hold, or the player's seat (so two never pick the same tile); under the delivery's vehicle. */
function taken(all: Inmate[], tile: number) {
  return tile === playerSeat || offTiles.includes(tile) || (bay !== null && bay[tile] === 1) || all.some((m) => m.goal === tile || m.seat === tile);
}

/** What each machine has someone doing on it (2.29). */
const USED_AS: Partial<Record<string, number>> = { weights: DOING.BENCH, pullup: DOING.PULLUP, treadmill: DOING.RUN, mat: DOING.PUSHUP, punchingBag: DOING.BAG };

/**
 * A free machine in a zone for an inmate who uses them (2.29: two in three, by its cell, so no draw; the
 * rest do what they always did), or null. Nobody is on one the player is using or has asked for: `off`.
 */
function machineFor(c: Crowd, all: Inmate[], m: Inmate, zone: ZoneId): { spot: Spot; then: number } | null {
  // (Not those people come looking for, who shouldn't be hard to get a word with: a merchant, the fixer.)
  if (!machines || m.cell % 3 === 0 || c.w.def.merchants.includes(m.cell) || c.w.def.smuggling?.fixer === m.cell) return null;
  const at = zoneIndex(zone);
  const free = placesOf(c.w).machines.filter((q) => c.w.ground.zone[q.tile] === at && !taken(all, q.tile));
  if (!free.length) return null;
  const q = free[m.cell % free.length];
  return { spot: { tile: q.tile, face: q.face }, then: USED_AS[c.w.props[q.prop].kind] ?? DOING.NOTHING };
}

/** A random spot from a list that nobody else is heading for (or any, if all are taken). */
function pickSpot(all: Inmate[], spots: Spot[], rng: { rng: number }): Spot | null {
  if (!spots.length) return null;
  const start = randomInt(rng, spots.length);
  for (let k = 0; k < spots.length; k++) {
    const s = spots[(start + k) % spots.length];
    if (!taken(all, s.tile)) return s;
  }
  return spots[start];
}

const tiles = (list: number[], face: number): Spot[] => list.map((tile) => ({ tile, face }));

/** A shelf to choose a book at, by the inmate's cell (no draw), null none free (2.31). */
function shelfFor(w: World, all: Inmate[], m: Inmate): Spot | null {
  const free = placesOf(w).shelves.filter((q) => !taken(all, q.tile));
  return free.length ? free[m.cell % free.length] : null;
}

/** A library chair to read at, by the inmate's cell (no draw), null none free (2.31). */
function readSeatFor(w: World, all: Inmate[], m: Inmate): Spot | null {
  const free = placesOf(w).readSeats.filter((q) => !taken(all, q.tile));
  return free.length ? free[m.cell % free.length] : null;
}

/** The place at the serving counter fewest others are heading for, by the inmate's cell (no draw: a meal's walk leaves the RNG as it was). */
function counterSpot(all: Inmate[], spots: Spot[], m: Inmate): Spot {
  const start = (m.cell * 3) % spots.length;
  let best = spots[start];
  let fewest = Infinity;
  for (let k = 0; k < spots.length; k++) {
    const s = spots[(start + k) % spots.length];
    const n = all.reduce((sum, o) => sum + (o !== m && o.goal === s.tile ? 1 : 0), 0);
    if (n < fewest) {
      fewest = n;
      best = s;
    }
  }
  return best;
}

/** Close enough to the counter to see its place is taken. */
const COUNTER_SIGHT = (UNIT * 3) / 2;
/** Steps before looking again. */
const TURN_STEPS = 8;

/**
 * Coming up to a place at the counter with someone standing at it: another one, if there's one
 * free; else it waits there a step back for its turn. True when it isn't walking on this step.
 */
function waitsItsTurn(c: Crowd, all: Inmate[], m: Inmate): boolean {
  const stoodAt = (tile: number) => all.some((o) => o !== m && !o.body.moving && tileAt(o.body.x, o.body.z) === tile) || c.others.some((o) => tileAt(o.x, o.z) === tile);
  const g = m.goal;
  if (!stoodAt(g) || Math.abs(centerX(g) - m.body.x) + Math.abs(centerZ(g) - m.body.z) > COUNTER_SIGHT) return false;
  const free = placesOf(c.w).counters.find((s) => !stoodAt(s.tile) && !all.some((o) => o !== m && o.goal === s.tile));
  m.stall = 0;
  if (free) {
    m.goal = free.tile;
    m.face = free.face;
    route(c, m);
    return true;
  }
  m.body.moving = false;
  m.wait = TURN_STEPS;
  return true;
}

/** How long an inmate's tray lasts it. */
export const inmateEatSteps = (m: Pick<Inmate, 'cell'>) => INMATE_EAT_STEPS + (m.cell * 53) % EAT_SPREAD;

/** A meal given up: no tray, its seat free for anyone. */
function dropMeal(m: Inmate) {
  // (Whatever called it away, it goes now: not after the time its tray had left.)
  if (m.tray !== TRAY.NONE || m.seat >= 0) m.wait = 0;
  m.tray = TRAY.NONE;
  m.seat = -1;
}

/** A shower head nobody stands under or is heading for, by the inmate's cell (no draw: the block's walk leaves the RNG as it was). */
function freeHead(c: Crowd, all: Inmate[], m: Inmate): Spot | null {
  const heads = placesOf(c.w).showers;
  const start = (m.cell * 3) % heads.length;
  for (let k = 0; k < heads.length; k++) {
    const h = heads[(start + k) % heads.length];
    if (!taken(all, h.tile) && !standsOn(c, all, m, h.tile)) return { tile: h.tile, face: h.wall };
  }
  return null;
}

/** Someone else stopped on that tile, inmate, player or guard. */
const standsOn = (c: Crowd, all: Inmate[], m: Inmate, tile: number) => all.some((o) => o !== m && !o.body.moving && tileAt(o.body.x, o.body.z) === tile) || c.others.some((o) => tileAt(o.x, o.z) === tile);

/**
 * Where an inmate waits for a head, or dries off: a free tile of the room, clear of the heads and, while
 * there's room, of the tiles in front of them, so that the way to a head stays open. By its cell, no draw.
 */
function asideSpot(c: Crowd, all: Inmate[], m: Inmate): Spot {
  const heads = placesOf(c.w).showers;
  const isHead = (t: number) => heads.some((h) => h.tile === t);
  // (A head's front: the tile the opposite way from its wall.)
  const before = (t: number) => heads.some((h) => t === h.tile - Math.round(DIR_X[h.wall] / 1024) - Math.round(DIR_Z[h.wall] / 1024) * MAP_W);
  const floor = floorOf(c.w, ['showers']).filter((t) => !isHead(t));
  const start = (m.cell * 5) % floor.length;
  const turned = floor.map((_, k) => floor[(start + k) % floor.length]);
  const face = heads[0].wall;
  const tile = turned.find((t) => !before(t) && !taken(all, t)) ?? turned.find((t) => !taken(all, t)) ?? turned[0];
  return { tile, face };
}

/**
 * The next step of a turn at the showers, once what it was doing is done: a head that's come free, off
 * to dry after its time under one, dressed and done after the towel. True when that took up the step.
 */
function nextWash(c: Crowd, all: Inmate[], m: Inmate): boolean {
  if (m.path.length || tileAt(m.body.x, m.body.z) !== m.goal) return false;
  if (m.doing === DOING.SHOWER) {
    setOff(c, m, asideSpot(c, all, m), DOING.TOWEL);
    return true;
  }
  if (m.doing === DOING.SHOWER_WAIT) {
    const head = freeHead(c, all, m);
    if (head) setOff(c, m, head, DOING.SHOWER);
    else m.wait = TURN_STEPS;
    return true;
  }
  if (m.doing === DOING.TOWEL) {
    m.doing = DOING.NOTHING;
    m.then = DOING.NOTHING;
    return true;
  }
  return false;
}

/** Whether a job has what it takes for its holder to work it: a machine job its three stations, the mail its desk, the janitor a round. */
function dutyHere(w: World, job: number): boolean {
  const d = placesOf(w).duties[job];
  if (!d) return false;
  const flow = JOBS[w.def.jobs[job].id].flow;
  return flow === 'machine' ? !!d.take && !!d.put && d.machines.length > 0 : flow === 'mail' ? d.machines.length > 0 : d.round.length > 0;
}

/** Where its work takes an inmate next, by how far through it is (no draw: the same legs every day). */
function dutyStop(c: Crowd, all: Inmate[], m: Inmate, job: number): { spot: Spot; then: number } | null {
  const d = placesOf(c.w).duties[job];
  const n = m.duty;
  const flow = JOBS[c.w.def.jobs[job].id].flow;
  if (flow === 'mop') {
    // The closet first, for the mop; then along its round.
    if (n === 0 && d.take) return { spot: d.take, then: DOING.WORK };
    return { spot: { tile: d.round[(n + m.cell * 3) % d.round.length], face: 5 }, then: DOING.MOP };
  }
  if (flow === 'mail') {
    if (n % 2 === 0) return { spot: d.machines[(n / 2) % d.machines.length], then: DOING.WORK };
    // A letter for someone, wherever they are now, handed over from the tile beside them.
    const others = all.filter((o) => o !== m && o.ko === 0);
    if (!others.length) return { spot: d.machines[0], then: DOING.WORK };
    const to = others[((n - 1) / 2 + m.cell) % others.length].body;
    const t = tileAt(to.x, to.z);
    const beside = [t + MAP_W, t - 1, t + 1, t - MAP_W].find((q) => q >= 0 && q < c.w.ground.zone.length && !c.w.npcBlock[q] && !taken(all, q)) ?? t;
    return { spot: { tile: beside, face: nearestDir(to.x - centerX(beside), to.z - centerZ(beside)) || 5 }, then: DOING.WORK };
  }
  const piece = Math.floor(n / 3);
  const stop = n % 3 === 0 ? d.take : n % 3 === 1 ? d.machines[(piece + m.cell) % d.machines.length] : d.put;
  return stop && { spot: stop, then: DOING.WORK };
}

/** How long it stays at the stop it has just reached. */
function dutyWait(w: World, m: Inmate, job: number): number {
  const def = JOBS[w.def.jobs[job].id];
  const rest = DUTY_REST_STEPS + (m.cell * 17) % DUTY_REST_STEPS;
  const cycle = (def.cycle ?? 3) * STEPS_PER_SECOND;
  if (def.flow === 'mop') return m.duty === 0 ? DUTY_HAND_STEPS : DUTY_MOP_STEPS;
  if (def.flow === 'mail') return m.duty % 2 === 0 ? cycle : DUTY_HAND_STEPS + rest;
  return m.duty % 3 === 1 ? cycle : m.duty % 3 === 2 ? DUTY_HAND_STEPS + rest : DUTY_HAND_STEPS;
}

/** The stop done and the wait over: on to the next. True when that took up the step. */
function nextDuty(c: Crowd, all: Inmate[], m: Inmate, job: number): boolean {
  if (m.goal < 0 || m.path.length || tileAt(m.body.x, m.body.z) !== m.goal) return false;
  m.duty++;
  const next = dutyStop(c, all, m, job);
  if (!next) return false;
  setOff(c, m, next.spot, next.then);
  if (!m.path.length && tileAt(m.body.x, m.body.z) === m.goal) {
    // (The next stop is the tile it's on.)
    m.doing = m.then;
    m.body.facing = m.face;
    m.wait = dutyWait(c.w, m, job);
  }
  return true;
}

/** What an inmate has in its hands at work (an item id), by how far through it is: 2.30. */
export function dutyCarry(w: World, m: Inmate, job: number): string | null {
  const def = JOBS[w.def.jobs[job]?.id];
  if (!def || !dutyHere(w, job)) return null;
  if (def.flow === 'mop') return m.duty > 0 || m.doing === DOING.WORK ? 'mop' : null;
  if (def.flow === 'mail') return m.duty % 2 === 1 ? 'letter' : null;
  const leg = m.duty % 3;
  // (Into the machine as it gets there; out of it on the way to the bin.)
  if (leg === 1) return m.doing === DOING.WORK ? null : (def.raw ?? null);
  if (leg === 2) return def.done ?? null;
  return m.doing === DOING.WORK ? (def.raw ?? null) : null;
}

/** The machine an inmate is running, and how far through (0–1), or null: 2.30. */
export function dutyMachine(w: World, m: Inmate, job: number): { prop: number; done: number } | null {
  const def = JOBS[w.def.jobs[job]?.id];
  if (!def || !dutyHere(w, job) || m.doing !== DOING.WORK) return null;
  const at = def.flow === 'machine' && m.duty % 3 === 1 ? placesOf(w).duties[job].machines : def.flow === 'mail' && m.duty % 2 === 0 ? placesOf(w).duties[job].machines : null;
  const tile = tileAt(m.body.x, m.body.z);
  const q = at?.find((s) => s.tile === tile);
  if (!q) return null;
  const cycle = (def.cycle ?? 3) * STEPS_PER_SECOND;
  return { prop: q.prop, done: Math.max(0, Math.min(1, 1 - m.wait / cycle)) };
}

/** Off to a spot: goal, what it does there, and the walk planned. */
function setOff(c: Crowd, m: Inmate, spot: Spot, then: number) {
  m.goal = spot.tile;
  m.face = spot.face;
  m.then = then;
  m.doing = DOING.NOTHING;
  route(c, m);
}

/**
 * The next leg of a meal, once what it was doing is done: from the counter to its seat (with its
 * tray) or back to it (having put the tray down), from a finished tray to the counter. True when
 * it set off.
 */
function nextLeg(c: Crowd, all: Inmate[], m: Inmate): boolean {
  if (m.seat < 0 || m.path.length || tileAt(m.body.x, m.body.z) !== m.goal) return false;
  if (m.doing === DOING.SERVE) {
    const backAgain = m.tray === TRAY.EMPTY;
    m.tray = backAgain ? TRAY.NONE : TRAY.FULL;
    setOff(c, m, { tile: m.seat, face: m.seatFace }, backAgain ? DOING.SIT : DOING.EAT);
    return true;
  }
  if (m.doing === DOING.EAT && m.tray === TRAY.FULL) {
    m.tray = TRAY.EMPTY;
    setOff(c, m, counterSpot(all, placesOf(c.w).counters, m), DOING.SERVE);
    return true;
  }
  return false;
}

/** Chooses where an inmate goes next for its plan, and what it does there (`work`: its job's zone index, -1 without one). */
function choose(c: Crowd, m: Inmate, all: Inmate[], rng: { rng: number }, work: number, job: number) {
  const w = c.w;
  const places = placesOf(w);
  const own = () => floorOf(w, ['inmateCell']).filter((i) => w.cellOf[i] === m.cell);
  let spot: Spot | null = null;
  let then: number = DOING.NOTHING;
  const id = m.plan === LOCKDOWN_PLAN ? 'lockdown' : ROUTINE[m.plan].id;
  switch (id) {
    case 'rollCall':
    case 'eveningRollCall':
      spot = places.rollCall[m.cell - 1] ?? pickSpot(all, tiles(floorOf(w, ['rollCall']), 13), rng);
      then = DOING.LINE_UP;
      break;
    case 'breakfast':
    case 'dinner':
      spot = pickSpot(all, places.seats, rng);
      then = DOING.EAT;
      // (2.25: its seat kept, the tray fetched from the serving counter first.)
      if (serving && spot) {
        m.seat = spot.tile;
        m.seatFace = spot.face;
        spot = counterSpot(all, places.counters, m);
        then = DOING.SERVE;
      }
      break;
    case 'exercise': {
      // (P31: with a sports ground, out there: a third of them jog the track.)
      const ring = w.def.leisure?.track;
      if (!ring || !floorOf(w, ['sports']).length) {
        const out = randomInt(rng, 3);
        spot = pickSpot(all, tiles(floorOf(w, out ? ['yard'] : ['gym']), 1 + randomInt(rng, 16)), rng);
        then = DOING.EXERCISE;
        if (!out) {
          const on = machineFor(c, all, m, 'gym');
          if (on) ({ spot, then } = on);
        }
        break;
      }
      const r = randomInt(rng, 3);
      if (r === 2) {
        spot = pickSpot(all, cornersOf(ring).map((q) => ({ tile: q.z * MAP_W + q.x, face: 1 })), rng);
        then = DOING.JOG;
        break;
      }
      // (Jumping jacks on the ground, never up on the bleachers.)
      const seats = new Set(places.rests.map((q) => q.tile));
      // (2.29: nor on the tile a machine is used from.)
      const mounts = machines ? new Set(places.machines.map((q) => q.tile)) : null;
      spot = pickSpot(all, tiles(floorOf(w, r ? ['sports'] : ['gym']).filter((t) => !seats.has(t) && !mounts?.has(t)), 1 + randomInt(rng, 16)), rng);
      then = DOING.EXERCISE;
      // (2.29: on a machine, if it uses them and one's free.)
      const on = machineFor(c, all, m, r ? 'sports' : 'gym');
      if (on) ({ spot, then } = on);
      break;
    }
    case 'showers': {
      if (turns && places.showers.length) {
        const head = freeHead(c, all, m);
        spot = head ?? asideSpot(c, all, m);
        then = head ? DOING.SHOWER : DOING.SHOWER_WAIT;
        break;
      }
      const free = places.showers.filter((s) => !taken(all, s.tile));
      spot = free.length ? pickSpot(all, free, rng) : pickSpot(all, tiles(floorOf(w, ['showers']), 1 + randomInt(rng, 16)), rng);
      then = DOING.SHOWER;
      break;
    }
    case 'lightsOut':
      spot = { tile: places.bedside[m.cell], face: 5 };
      then = DOING.SLEEP;
      break;
    case 'lockdown':
      spot = pickSpot(all, tiles(own(), 5), rng);
      break;
    default: {
      // The Work Period: at the job, if it has one (GDD §11); else more free time.
      if (id === 'work' && work >= 0) {
        spot = pickSpot(all, tiles(placesOf(w).floor[work] ?? [], 1 + randomInt(rng, 16)), rng);
        then = DOING.WORK;
        // (2.30: the draws above as they were, then its stations rather than a spot on the floor.)
        const stop = job >= 0 ? dutyStop(c, all, m, job) : null;
        if (stop) ({ spot, then } = stop);
        break;
      }
      // (2.31: the librarian at the desk, a book open; anyone with a book chosen, to a chair with it, or on their feet.)
      if (reads) {
        const desk = w.def.leisure?.librarian;
        if (desk && desk.cell === m.cell) {
          spot = { tile: desk.z * MAP_W + desk.x, face: desk.face };
          then = DOING.SIT_READ;
          m.book = 2;
          break;
        }
        if (m.book === 1) {
          m.book = 2;
          const seat = readSeatFor(w, all, m);
          spot = seat ?? pickSpot(all, tiles(floorOf(w, ['library']), 1 + randomInt(rng, 16)), rng);
          then = seat ? DOING.SIT_READ : DOING.READ;
          break;
        }
        m.book = 0;
      }
      // Free time: now and then a seat (reading at a library table, a yard bench, the chair in
      // its own cell), else somewhere to hang about for a while, then somewhere else.
      if (randomInt(rng, 3) === 0) {
        const lib = zoneIndex('library');
        const yard = zoneIndex('yard');
        // (P31: the sports ground's bleachers too, while it's open.)
        const stands = OPEN_HOURS.sports!.includes(id) ? zoneIndex('sports') : -1;
        const free = places.rests.filter((r) => (w.ground.zone[r.tile] === lib || w.ground.zone[r.tile] === yard || w.ground.zone[r.tile] === stands || w.cellOf[r.tile] === m.cell) && !taken(all, r.tile));
        if (free.length) {
          spot = free[randomInt(rng, free.length)];
          then = w.ground.zone[spot.tile] === lib ? DOING.SIT_READ : DOING.SIT;
          // (2.31: to a library chair by way of the shelves, for a book.)
          if (reads && then === DOING.SIT_READ) {
            const shelf = shelfFor(w, all, m);
            if (shelf) {
              spot = shelf;
              then = DOING.READ;
              m.book = 1;
            } else m.book = 2;
          }
          break;
        }
      }
      // (P31: the sports ground and the garden while they're open.)
      const grounds = OPEN_HOURS.sports!.includes(id) && w.def.leisure?.track;
      const hangouts = reads ? (grounds ? HANGOUTS_GROUNDS_READ : HANGOUTS_READ) : grounds ? HANGOUTS_GROUNDS : HANGOUTS;
      const r = randomInt(rng, hangouts.length + 1);
      const list = r === hangouts.length ? own() : floorOf(w, [hangouts[r]]);
      spot = pickSpot(all, tiles(list, 1 + randomInt(rng, 16)), rng);
      // (2.31: in the library, at the shelves, for a book.)
      if (reads && r < hangouts.length && hangouts[r] === 'library') {
        const shelf = shelfFor(w, all, m);
        if (shelf) {
          spot = shelf;
          then = DOING.READ;
          m.book = 1;
        }
      }
      // (2.29: at the gym or the sports ground, a machine if one's free, for as long as it lingers.)
      if (r < hangouts.length && (hangouts[r] === 'gym' || hangouts[r] === 'sports')) {
        const on = machineFor(c, all, m, hangouts[r]);
        if (on) ({ spot, then } = on);
      }
    }
  }
  if (!spot) return;
  m.goal = spot.tile;
  m.face = spot.face;
  m.then = then;
  route(c, m);
}

/**
 * One step of inmate life: each follows the routine block (or the lockdown), setting off a
 * moment after the bell, walking an A* path, then lining up, eating, exercising,
 * showering or sleeping where it arrives. Free time is spent wandering between hangouts.
 * Inmates make way for each other and for `others` (the player, guards); they never pick
 * the same spot.
 */
export function stepInmates(w: World, all: Inmate[], plan: number, rng: { rng: number }, others: readonly Body[], step: number, foe: Body | null = null, social: Social = NO_SOCIAL) {
  const c: Crowd = { w, grid: w.npcBlock, all, others, step };
  playerSeat = social.seat;
  offTiles = social.off ?? [];
  serving = !!social.serve;
  turns = !!social.turns;
  machines = !!social.machines;
  reads = !!social.reads;
  jobOf = social.jobOf ?? [];
  bay = w.delivering ? w.parked : null;
  all.forEach((m, k) => {
    // (Calmed off by anything else, a knockout, an arrest: its moment of warning goes too.)
    if (m.angry <= 0) m.windup = 0;
    // Out cold: lies where it fell (Sim counts the time and wakes it).
    if (m.ko > 0) {
      m.body.moving = false;
      m.doing = DOING.KNOCKED_OUT;
      dropMeal(m);
      return;
    }
    // A follower (GDD §10.3): after whoever comes for the player, else at the player's heels.
    const lead = social.follow[k];
    if (lead && m.angry <= 0) {
      m.doing = social.doing[k] ?? DOING.NOTHING;
      m.plan = -1;
      dropMeal(m);
      closeIn(c, m, k, lead, social.pace?.[k] || m.speed + 30, social.gap[k]);
      // (A lookout at his post, P23: facing south, as the camera sees him.)
      if (m.doing === DOING.LOOKOUT && !m.body.moving) m.body.facing = 5;
      // (P30: on the stage, at the quiz, facing the way the place does.)
      else if (social.face?.[k] && !m.body.moving) m.body.facing = social.face[k];
      return;
    }
    // Talking to the player: it stands and listens.
    if (social.talk === k && m.angry <= 0) {
      m.body.moving = false;
      if (foe && (foe.x !== m.body.x || foe.z !== m.body.z)) m.body.facing = nearestDir(foe.x - m.body.x, foe.z - m.body.z);
      return;
    }
    // Hit by the player: it goes for them (Sim lands the punches) until it calms down or loses them.
    if (m.angry > 0) {
      m.angry--;
      dropMeal(m);
      if (foe && m.angry > 0) {
        m.doing = DOING.NOTHING;
        // (2.26: an ambush begins with a moment squaring up, facing them.)
        if (m.windup > 0) {
          m.windup--;
          m.body.moving = false;
          if (foe.x !== m.body.x || foe.z !== m.body.z) m.body.facing = nearestDir(foe.x - m.body.x, foe.z - m.body.z);
          return;
        }
        closeIn(c, m, k, foe, m.speed + 24);
        return;
      }
      // Calm again: back to the routine, planned afresh.
      m.angry = 0;
      m.windup = 0;
      m.plan = -1;
    }
    if (m.plan !== plan) {
      m.plan = plan;
      m.goal = -1;
      m.path = [];
      m.doing = DOING.NOTHING;
      m.body.moving = false;
      m.stall = 0;
      dropMeal(m);
      m.duty = 0;
      m.book = 0;
      m.wait = randomInt(rng, INMATE_REACTION);
    }
    // (2.30: its job, in the Work Period, where the job can be worked.)
    const job = plan !== LOCKDOWN_PLAN && ROUTINE[plan].id === 'work' && (jobOf[k] ?? -1) >= 0 && dutyHere(w, jobOf[k]) ? jobOf[k] : -1;
    // A meal broken off and its seat given up (a fight, led away, out cold), the routine taken up again: fetched afresh.
    if (serving && m.seat < 0 && (m.then === DOING.SERVE || m.then === DOING.EAT)) {
      m.goal = -1;
      m.path = [];
      m.doing = DOING.NOTHING;
      m.then = DOING.NOTHING;
    }
    // A rat running loose close by, in sight (P20): away from it as fast as legs go, then watching it
    // from a safe distance (its goal kept: its spot stays its own); once it's over, back to it.
    if (social.scare.length && m.doing !== DOING.SLEEP && flee(c, m, social.scare)) return;
    // Back on its spot after fleeing (P20): what it was doing there, taken up again as it was (nothing drawn).
    if (m.doing === DOING.NOTHING && m.then !== DOING.NOTHING && m.goal >= 0 && !m.path.length && tileAt(m.body.x, m.body.z) === m.goal) {
      settle(m);
      m.body.facing = m.face;
      m.body.moving = false;
    }
    // (P39: headed for, or sitting on, a tile kept clear: somewhere else.)
    if (offTiles.length && m.goal >= 0 && offTiles.includes(m.goal)) {
      // (2.29: off a machine the player's now on: at once, not after what's left of a free time's linger.)
      if (machines && ON_MACHINE.includes(m.then)) m.wait = 0;
      m.goal = -1;
      m.path = [];
      m.doing = DOING.NOTHING;
      m.seat = -1;
    }
    if (m.wait > 0) {
      m.wait--;
      return;
    }
    // Jogging the track (P31): at a corner, on round to the next (no draw: the way round is the same for all).
    if (m.doing === DOING.JOG && plan !== LOCKDOWN_PLAN && ROUTINE[plan].id === 'exercise' && !m.path.length && w.def.leisure?.track) {
      const corners = cornersOf(w.def.leisure.track);
      const at = corners.findIndex((q) => q.z * MAP_W + q.x === m.goal);
      const next = corners[(at + 1) % 4];
      m.goal = next.z * MAP_W + next.x;
      m.doing = DOING.NOTHING;
      m.then = DOING.JOG;
      m.face = 1;
      route(c, m);
      return;
    }
    if (job >= 0 && nextDuty(c, all, m, job)) return;
    if (nextLeg(c, all, m)) return;
    if (turns && plan !== LOCKDOWN_PLAN && ROUTINE[plan].id === 'showers' && nextWash(c, all, m)) return;
    if (m.goal < 0) {
      choose(c, m, all, rng, social.work[k] ?? -1, job);
      if (m.goal >= 0 && !m.path.length && tileAt(m.body.x, m.body.z) === m.goal) arrive(c, m, plan, rng, job);
      return;
    }
    if (m.path.length) {
      if (serving && m.then === DOING.SERVE && waitsItsTurn(c, all, m)) return;
      // (2.26: the head it was heading for has someone under it now, the player perhaps: back to waiting.)
      if (turns && m.then === DOING.SHOWER && standsOn(c, all, m, m.goal) && Math.abs(centerX(m.goal) - m.body.x) + Math.abs(centerZ(m.goal) - m.body.z) <= COUNTER_SIGHT) {
        setOff(c, m, asideSpot(c, all, m), DOING.SHOWER_WAIT);
        return;
      }
      // (Jogging the track, P31: a jog's pace, not a walk's.)
      if (walkPath(c, m, k, m.then === DOING.JOG ? m.speed + JOG_EXTRA : m.speed)) arrive(c, m, plan, rng, job);
      return;
    }
    if (tileAt(m.body.x, m.body.z) !== m.goal) {
      // Not there and no path (none was found earlier): try again.
      route(c, m);
      // (2.30: at work, no way to this stop for now: the next one, in a moment.)
      if (job >= 0 && !m.path.length) {
        m.duty++;
        m.goal = -1;
        m.wait = TURN_STEPS;
        return;
      }
      // (2.25: at work, a spot behind furniture no door will ever open on, Irongate's planters: another next time.)
      if (social.reroute && !m.path.length && plan !== LOCKDOWN_PLAN && ROUTINE[plan].id === 'work') m.goal = -1;
      return;
    }
    // Free time: done lingering, somewhere new next step. Routines keep them where they are.
    if (plan !== LOCKDOWN_PLAN && ROUTINE[plan].zones.length === 0) {
      m.goal = -1;
      // (2.29: off the machine, and not walking away still lifting.)
      if (ON_MACHINE.includes(m.doing)) {
        m.doing = DOING.NOTHING;
        m.then = DOING.NOTHING;
      }
    }
  });
}

/** How close a fighter steps up to the one it is after (units, centre to centre): within arm's reach, not on top of them. */
export const STAND_OFF = 820;

/** What the player's social life asks of the inmates this step (by inmate index). */
export interface Social {
  /** Whom each follower goes after (a foe, or the player to follow), null for the routine. */
  follow: ReadonlyArray<Body | null>;
  /** How close each follower comes (a foe: arm's length; the player: a step behind). */
  gap: readonly number[];
  /** The inmate talking to the player (-1 none). */
  talk: number;
  /** Each inmate's job zone (-1 none). */
  work: readonly number[];
  /** The tile the player sits on (-1 standing). */
  seat: number;
  /** Rats running loose (P20): inmates flee them. */
  scare: ReadonlyArray<{ x: number; z: number }>;
  /** What each one led about does on the way (P23: a brawl; else nothing), by inmate index. */
  doing: readonly number[];
  /** The pace each one led about goes at (P29: a match's players; 0 or missing: a follower's). */
  pace?: readonly number[];
  /** The way each one led about faces once there (P30: an act on the stage, a contestant; 0 or missing: as it came). */
  face?: readonly number[];
  /** Tiles nobody heads for (P39: the parole board's chairs and the player's seat across, while the hearing is due or sitting). */
  off?: readonly number[];
  /** 2.26: the showers taken in turns (false: replaying an older run). */
  turns?: boolean;
  /** 2.25: an inmate at work with no way to its spot picks another (false: replaying an older run). */
  reroute?: boolean;
  /** 2.29: inmates use the gym's machines (false: replaying an older run). */
  machines?: boolean;
  /** 2.31: inmates choose books and read them; the librarian's at the desk. */
  reads?: boolean;
  /** 2.30: each inmate's job (the prison's job index, -1 none), for working its stations (empty: replaying an older run; not at the Training Block). */
  jobOf?: number[];
  /** 2.25: a meal on, fetched from the serving counter (false: none on, no counter here, or replaying an older run). */
  serve?: boolean;
}
const NO_SOCIAL: Social = { follow: [], gap: [], talk: -1, work: [], seat: -1, scare: [], doing: [], pace: [], face: [] };

/**
 * Scared of a rat running loose (P20): within FLEE_RANGE, away from the nearest, faster than a
 * walk (turning aside from a wall); a little beyond, standing still facing it. Returns whether
 * the inmate was scared this step (its path is dropped: walked afresh once it's over).
 */
function flee(c: Crowd, m: Inmate, rats: ReadonlyArray<{ x: number; z: number }>): boolean {
  const b = m.body;
  let near: { x: number; z: number } | null = null;
  let best = (FLEE_RANGE + 2 * UNIT) ** 2;
  for (const r of rats) {
    const d2 = (b.x - r.x) ** 2 + (b.z - r.z) ** 2;
    if (d2 <= best && lineOfSight(c.w, r.x, r.z, b.x, b.z)) {
      best = d2;
      near = r;
    }
  }
  if (!near) return false;
  m.path = [];
  m.doing = DOING.NOTHING;
  m.stall = 0;
  const dx = b.x - near.x;
  const dz = b.z - near.z;
  if (best >= FLEE_RANGE * FLEE_RANGE) {
    b.moving = false;
    if (dx || dz) b.facing = nearestDir(-dx, -dz);
    return true;
  }
  const away = dx || dz ? nearestDir(dx, dz) : b.facing;
  for (const turn of [0, 2, -2, 4, -4]) {
    const dir = ((away - 1 + turn + 16) % 16) + 1;
    if (shove(c.w, c.grid, b, dir, m.speed + FLEE_SPEED)) return true;
  }
  b.moving = false;
  return true;
}

/** Moves a body one step in a direction against a grid (each axis in turn, stopping at what blocks it); returns whether it got anywhere. */
function shove(w: World, grid: Uint8Array, b: Body, dir: number, speed: number): boolean {
  const x0 = b.x;
  const z0 = b.z;
  const free = (x: number, z: number) => {
    for (const ux of [x - BODY_HALF, x + BODY_HALF - 1])
      for (const uz of [z - BODY_HALF, z + BODY_HALF - 1]) {
        const tx = Math.floor(ux / UNIT);
        const tz = Math.floor(uz / UNIT);
        if (tx < 0 || tz < 0 || tx >= MAP_W || tz >= MAP_H || !w.inside(tx, tz) || grid[tz * MAP_W + tx]) return false;
      }
    return true;
  };
  const dx = Math.trunc((DIR_X[dir] * speed) / 1024);
  const dz = Math.trunc((DIR_Z[dir] * speed) / 1024);
  if (dx && free(b.x + dx, b.z)) b.x += dx;
  if (dz && free(b.x, b.z + dz)) b.z += dz;
  b.facing = dir;
  b.moving = b.x !== x0 || b.z !== z0;
  // (Not even a quarter of the way: no good, try another way.)
  return Math.abs(b.x - x0) + Math.abs(b.z - z0) >= speed / 4;
}

/**
 * Goes for someone: straight at them when close with nothing between, else along a path
 * re-planned now and then. Stops at arm's length, facing them.
 */
function closeIn(c: Crowd, m: Walker, k: number, foe: Body, speed: number, gap = STAND_OFF) {
  const b = m.body;
  const dx = foe.x - b.x;
  const dz = foe.z - b.z;
  if (Math.abs(dx) + Math.abs(dz) < UNIT * 2 && clearLine(c.w, b.x, b.z, foe.x, foe.z, undefined, c.grid)) {
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 0) b.facing = nearestDir(dx, dz);
    m.path = [];
    b.moving = d > gap;
    if (b.moving) {
      const go = Math.min(speed, d - gap);
      b.x += Math.trunc((dx * go) / d);
      b.z += Math.trunc((dz * go) / d);
    }
    return;
  }
  if (m.wait > 0) {
    m.wait--;
    b.moving = false;
    return;
  }
  const goal = tileAt(foe.x, foe.z);
  if (!m.path.length || (goal !== m.goal && (c.step + k) % 10 === 0)) {
    m.goal = goal;
    route(c, m);
  }
  walkPath(c, m, k, speed);
}

/** Starts on what its spot is for; at a meal (2.25) that takes time: a moment at the counter, a tray's worth at the table. */
function settle(m: Inmate) {
  m.doing = m.then;
  if (m.then === DOING.SERVE) m.wait = SERVE_STEPS;
  else if (m.then === DOING.EAT && m.tray === TRAY.FULL) m.wait = inmateEatSteps(m);
  // (2.26: a turn at the showers. Replaying an older run, it stays under the head for the block.)
  else if (turns && m.then === DOING.SHOWER) m.wait = INMATE_WASH_STEPS + (m.cell * 37) % WASH_SPREAD;
  else if (m.then === DOING.TOWEL) m.wait = INMATE_DRY_STEPS;
}

/** At the goal: stop, face the right way, start doing what the spot is for. */
function arrive(c: Crowd, m: Inmate, plan: number, rng: { rng: number }, job: number) {
  m.body.moving = false;
  m.stall = 0;
  m.body.facing = m.face;
  settle(m);
  // (2.30: at a station for as long as the work takes, with nothing drawn.)
  if (job >= 0) {
    m.wait = dutyWait(c.w, m, job);
    return;
  }
  // (2.31: at the shelf for a moment, by its cell, with no draw.)
  if (reads && m.book === 1) {
    m.wait = BROWSE_STEPS + (m.cell % 4) * STEPS_PER_SECOND;
    return;
  }
  // Free time: linger 15–45 s before moving on.
  if (plan !== LOCKDOWN_PLAN && ROUTINE[plan].zones.length === 0) m.wait = STEPS_PER_SECOND * (15 + randomInt(rng, 31));
}

/** The zone an inmate stands in. */
export const inmateZone = (w: World, m: Inmate) => w.zoneAt(Math.floor(m.body.x / UNIT), Math.floor(m.body.z / UNIT));
