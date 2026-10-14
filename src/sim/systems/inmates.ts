import { ROUTINE } from '../../content/routine';
import type { ZoneId } from '../../content/zones';
import { DIR_X, DIR_Z } from '../command';
import { centerX, centerZ, clearLine, nearestDir, pathTo, smooth, tileAt } from '../ai/path';
import { floorOf, placesOf, type Spot } from '../ai/places';
import { randomInt } from '../rng';
import { INMATE_REACTION, INMATE_SPEED, STEPS_PER_SECOND, UNIT } from '../tuning';
import { MAP_H, MAP_W, type World } from '../world/World';
import { bodyAt, type Body } from './movement';

/** What an inmate is doing where it stands (the view poses it). */
export const DOING = { NOTHING: 0, SLEEP: 1, EAT: 2, EXERCISE: 3, SHOWER: 4, LINE_UP: 5 } as const;

/** The plan an inmate follows: a routine block's index, or this during a lockdown. */
export const LOCKDOWN_PLAN = -2;

/** An AI inmate. Plain data, part of the simulation state. */
export interface Inmate {
  body: Body;
  /** Its cell number (2–8; cell 1 is the player's). */
  cell: number;
  /** DOING, once it has arrived. */
  doing: number;
  /** The plan its goal was chosen for (routine index or LOCKDOWN_PLAN; -1 none yet). */
  plan: number;
  /** Destination tile, -1 when it has none. */
  goal: number;
  /** Direction to face on arrival (1–16). */
  face: number;
  /** What to do on arrival. */
  then: number;
  /** Waypoints still to walk (tile indices). */
  path: number[];
  /** Steps to wait before acting again. */
  wait: number;
  /** Units per step (each inmate walks at its own pace). */
  speed: number;
  /** Steps spent waiting for someone in the way (past YIELD_STEPS it squeezes by). */
  stall: number;
}

/** Someone this close ahead (units, centre to centre) makes a walker wait. */
const PERSONAL_SPACE = 760;
/** How long a walker waits for someone in the way before squeezing past, and for how long it squeezes. */
const YIELD_STEPS = 30;
const SQUEEZE_STEPS = 40;

/** Where inmates like to spend free time (their own cell is added). */
const HANGOUTS: readonly ZoneId[] = ['yard', 'yard', 'library', 'gym', 'cellBlock', 'rollCall', 'corridor', 'canteen'];

/** One inmate per cell after the player's, starting in bed-side position. */
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
    });
  }
  return out;
}

/** Goals other inmates already hold (so two never pick the same tile). */
function taken(all: Inmate[], tile: number) {
  return all.some((m) => m.goal === tile);
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

/** Chooses where an inmate goes next for its plan, and what it does there. */
function choose(w: World, m: Inmate, all: Inmate[], rng: { rng: number }) {
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
      break;
    case 'exercise':
      spot = pickSpot(all, tiles(floorOf(w, randomInt(rng, 3) ? ['yard'] : ['gym']), 1 + randomInt(rng, 16)), rng);
      then = DOING.EXERCISE;
      break;
    case 'showers': {
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
      // Free time: somewhere to hang about for a while, then somewhere else.
      const r = randomInt(rng, HANGOUTS.length + 1);
      const list = r === HANGOUTS.length ? own() : floorOf(w, [HANGOUTS[r]]);
      spot = pickSpot(all, tiles(list, 1 + randomInt(rng, 16)), rng);
    }
  }
  if (!spot) return;
  m.goal = spot.tile;
  m.face = spot.face;
  m.then = then;
  route(w, m);
}

/** Plans the walk to the goal (smoothed); without a way there, waits and tries again. */
function route(w: World, m: Inmate) {
  const path = pathTo(w, tileAt(m.body.x, m.body.z), m.goal);
  if (path === null) {
    m.path = [];
    m.wait = STEPS_PER_SECOND * 2;
    return;
  }
  m.path = smooth(w, path, m.body.x, m.body.z);
}

/** What is ahead of a walker: nobody, someone to wait for, or someone coming the other way to step aside for. */
const CLEAR = 0;
const WAIT = 1;
const GIVE_WAY = 2;

/**
 * Who stands in the walker's way: the player, or another inmate close ahead (within about
 * 60° of the heading). A follower keeps its distance; when two inmates meet head on, the
 * one earlier in the list goes first and the other steps aside.
 */
function inTheWay(m: Inmate, k: number, all: Inmate[], player: Body, dx: number, dz: number, dist: number): number {
  const ahead = (o: Body) => {
    const ox = o.x - m.body.x;
    const oz = o.z - m.body.z;
    const d2 = ox * ox + oz * oz;
    return d2 < PERSONAL_SPACE * PERSONAL_SPACE && (ox * dx + oz * dz) * 2 > Math.sqrt(d2) * dist;
  };
  const coming = (o: Body) => o.moving && DIR_X[o.facing] * dx + DIR_Z[o.facing] * dz < 0;
  if (ahead(player)) return coming(player) ? GIVE_WAY : WAIT;
  for (let j = 0; j < all.length; j++) {
    const o = all[j];
    if (j === k || !ahead(o.body)) continue;
    // Arrived and standing there (not merely waiting its turn): wait, then squeeze by.
    if (!o.path.length) return WAIT;
    if (coming(o.body)) {
      if (j < k) return GIVE_WAY;
      continue;
    }
    // Walking the same way: follow at a distance.
    return WAIT;
  }
  return CLEAR;
}

/** Steps of waiting before looking for a way round someone who stays put. */
const DETOUR_STEPS = 8;
const avoidMask = new Uint8Array(MAP_W * MAP_H);

/** Plans round the tiles of everyone standing still (not the goal); true when a way was found. */
function detour(w: World, m: Inmate, k: number, all: Inmate[], player: Body): boolean {
  const marked: number[] = [];
  const mark = (b: Body) => {
    const t = tileAt(b.x, b.z);
    if (t !== m.goal && t !== tileAt(m.body.x, m.body.z) && !avoidMask[t]) {
      avoidMask[t] = 1;
      marked.push(t);
    }
  };
  all.forEach((o, j) => j !== k && !o.body.moving && mark(o.body));
  if (!player.moving) mark(player);
  const path = pathTo(w, tileAt(m.body.x, m.body.z), m.goal, avoidMask);
  if (path) {
    m.path = smooth(w, path, m.body.x, m.body.z, avoidMask);
    // On the way round: no more stopping for the people it is walking past, for a moment.
    m.stall = YIELD_STEPS;
  }
  for (const t of marked) avoidMask[t] = 0;
  return path !== null;
}

/** How far a walker steps aside per step, and for how many steps at most. */
const SIDESTEP = 70;
const SIDESTEP_STEPS = 10;

/** Steps to the right of the heading (or the left if the right is a wall) to let someone by. */
function stepAside(w: World, b: Body, dx: number, dz: number, dist: number) {
  const sx = Math.trunc((-dz * SIDESTEP) / dist);
  const sz = Math.trunc((dx * SIDESTEP) / dist);
  for (const side of [1, -1]) {
    const nx = b.x + sx * side;
    const nz = b.z + sz * side;
    if (clearLine(w, b.x, b.z, nx, nz)) {
      b.x = nx;
      b.z = nz;
      b.moving = true;
      return;
    }
  }
}

/** Walks toward the next waypoint; returns true once the last one is reached. */
function walkPath(w: World, m: Inmate, k: number, all: Inmate[], player: Body, step: number): boolean {
  const b = m.body;
  if (!m.path.length) return true;
  const next = m.path[0];
  // Now and then: is the way to the next waypoint still open (a door may have shut)?
  const blocked = w.blocked(next % MAP_W, Math.floor(next / MAP_W));
  if (blocked || ((step + k) % 10 === 0 && !clearLine(w, b.x, b.z, centerX(next), centerZ(next)))) {
    route(w, m);
    return false;
  }
  const dx = centerX(next) - b.x;
  const dz = centerZ(next) - b.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dx || dz) b.facing = nearestDir(dx, dz);
  // Someone in the way: wait a moment, then squeeze by (nobody gets stuck for good).
  const way = m.stall < YIELD_STEPS && (dx || dz) ? inTheWay(m, k, all, player, dx, dz, dist) : CLEAR;
  if (way !== CLEAR) {
    m.stall++;
    // Someone stays put in the way (at their spot): after a moment, find a way round them.
    if (way === WAIT && m.stall === DETOUR_STEPS && detour(w, m, k, all, player)) return false;
    b.moving = false;
    if (way === GIVE_WAY && m.stall <= SIDESTEP_STEPS) stepAside(w, b, dx, dz, dist);
    return false;
  }
  m.stall = m.stall >= YIELD_STEPS && m.stall < YIELD_STEPS + SQUEEZE_STEPS ? m.stall + 1 : 0;
  b.moving = true;
  if (dist <= m.speed) {
    b.x += dx;
    b.z += dz;
    m.path.shift();
    return m.path.length === 0;
  }
  b.x += Math.trunc((dx * m.speed) / dist);
  b.z += Math.trunc((dz * m.speed) / dist);
  return false;
}

/**
 * One step of inmate life: each follows the routine block (or the lockdown), setting off a
 * moment after the bell, walking an A* path, then lining up, eating, exercising,
 * showering or sleeping where it arrives. Free time is spent wandering between hangouts.
 * Walkers make way for each other and for the player (they never pick the same spot).
 */
export function stepInmates(w: World, all: Inmate[], plan: number, rng: { rng: number }, player: Body, step: number) {
  all.forEach((m, k) => {
    if (m.plan !== plan) {
      m.plan = plan;
      m.goal = -1;
      m.path = [];
      m.doing = DOING.NOTHING;
      m.body.moving = false;
      m.stall = 0;
      m.wait = randomInt(rng, INMATE_REACTION);
    }
    if (m.wait > 0) {
      m.wait--;
      return;
    }
    if (m.goal < 0) {
      choose(w, m, all, rng);
      if (m.goal >= 0 && !m.path.length && tileAt(m.body.x, m.body.z) === m.goal) arrive(m, plan, rng);
      return;
    }
    if (m.path.length) {
      if (walkPath(w, m, k, all, player, step)) arrive(m, plan, rng);
      return;
    }
    if (tileAt(m.body.x, m.body.z) !== m.goal) {
      // Not there and no path (none was found earlier): try again.
      route(w, m);
      return;
    }
    // Free time: done lingering, somewhere new next step. Routines keep them where they are.
    if (plan !== LOCKDOWN_PLAN && ROUTINE[plan].zones.length === 0) m.goal = -1;
  });
}

/** At the goal: stop, face the right way, start doing what the spot is for. */
function arrive(m: Inmate, plan: number, rng: { rng: number }) {
  m.body.moving = false;
  m.stall = 0;
  m.body.facing = m.face;
  m.doing = m.then;
  // Free time: linger 15–45 s before moving on.
  if (plan !== LOCKDOWN_PLAN && ROUTINE[plan].zones.length === 0) m.wait = STEPS_PER_SECOND * (15 + randomInt(rng, 31));
}

/** The zone an inmate stands in. */
export const inmateZone = (w: World, m: Inmate) => w.zoneAt(Math.floor(m.body.x / UNIT), Math.floor(m.body.z / UNIT));
