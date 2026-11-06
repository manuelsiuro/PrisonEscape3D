import { DIR_X, DIR_Z } from '../command';
import type { Body } from '../systems/movement';
import { STEPS_PER_SECOND } from '../tuning';
import { MAP_H, MAP_W, type World } from '../world/World';
import { clearLine, nearestDir, pathTo, smooth } from './path';
import { centerX, centerZ, tileAt } from '../world/grid';

/** Someone who walks A* paths on their own (inmates, guards). Plain data in the sim state. */
export interface Walker {
  body: Body;
  /** Destination tile, -1 when it has none. */
  goal: number;
  /** Waypoints still to walk (tile indices). */
  path: number[];
  /** Steps to wait before acting again. */
  wait: number;
  /** Units per step. */
  speed: number;
  /** Steps spent waiting for someone in the way (past YIELD_STEPS it squeezes by). */
  stall: number;
}

/**
 * Who a group of walkers shares the floor with. `all` walk by the same rules and give way
 * to each other by their place in the list; `others` (the player, people of another group)
 * never give way, so a walker waits for them or steps aside. `grid` is what blocks the group.
 */
export interface Crowd {
  w: World;
  grid: Uint8Array;
  all: readonly Walker[];
  others: readonly Body[];
  step: number;
}

/** Someone this close ahead (units, centre to centre) makes a walker wait. */
const PERSONAL_SPACE = 760;
/** How long a walker waits for someone in the way before squeezing past, and for how long it squeezes. */
const YIELD_STEPS = 30;
const SQUEEZE_STEPS = 40;

/** Plans the walk to the goal (smoothed); without a way there, waits and tries again. */
export function route(c: Crowd, m: Walker) {
  const path = pathTo(c.w, tileAt(m.body.x, m.body.z), m.goal, undefined, c.grid);
  if (path === null) {
    m.path = [];
    m.wait = STEPS_PER_SECOND * 2;
    return;
  }
  m.path = smooth(c.w, path, m.body.x, m.body.z, undefined, c.grid);
}

/** What is ahead of a walker: nobody, someone to wait for, or someone coming the other way to step aside for. */
const CLEAR = 0;
const WAIT = 1;
const GIVE_WAY = 2;

/**
 * Who stands in the walker's way: one of the others, or a fellow walker close ahead (within
 * about 60° of the heading). A follower keeps its distance; when two walkers meet head on,
 * the one earlier in the list goes first and the other steps aside.
 */
function inTheWay(c: Crowd, m: Walker, k: number, dx: number, dz: number, dist: number): number {
  const ahead = (o: Body) => {
    const ox = o.x - m.body.x;
    const oz = o.z - m.body.z;
    const d2 = ox * ox + oz * oz;
    return d2 < PERSONAL_SPACE * PERSONAL_SPACE && (ox * dx + oz * dz) * 2 > Math.sqrt(d2) * dist;
  };
  const coming = (o: Body) => o.moving && (DIR_X[o.facing] ?? 0) * dx + (DIR_Z[o.facing] ?? 0) * dz < 0;
  for (const o of c.others) if (ahead(o)) return coming(o) ? GIVE_WAY : WAIT;
  for (let j = 0; j < c.all.length; j++) {
    const o = c.all[j];
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
function detour(c: Crowd, m: Walker, k: number): boolean {
  const marked: number[] = [];
  const mark = (b: Body) => {
    const t = tileAt(b.x, b.z);
    if (t !== m.goal && t !== tileAt(m.body.x, m.body.z) && !avoidMask[t]) {
      avoidMask[t] = 1;
      marked.push(t);
    }
  };
  c.all.forEach((o, j) => j !== k && !o.body.moving && mark(o.body));
  for (const o of c.others) if (!o.moving) mark(o);
  const path = pathTo(c.w, tileAt(m.body.x, m.body.z), m.goal, avoidMask, c.grid);
  if (path) {
    m.path = smooth(c.w, path, m.body.x, m.body.z, avoidMask, c.grid);
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
function stepAside(c: Crowd, b: Body, dx: number, dz: number, dist: number) {
  const sx = Math.trunc((-dz * SIDESTEP) / dist);
  const sz = Math.trunc((dx * SIDESTEP) / dist);
  for (const side of [1, -1]) {
    const nx = b.x + sx * side;
    const nz = b.z + sz * side;
    if (clearLine(c.w, b.x, b.z, nx, nz, undefined, c.grid)) {
      b.x = nx;
      b.z = nz;
      b.moving = true;
      return;
    }
  }
}

/**
 * Walks toward the next waypoint at `speed` (the walker's own when not given); returns true
 * once the last one is reached. Walkers make way for each other and for the others.
 */
export function walkPath(c: Crowd, m: Walker, k: number, speed = m.speed): boolean {
  const b = m.body;
  if (!m.path.length) return true;
  const next = m.path[0];
  const nx = next % MAP_W;
  const nz = Math.floor(next / MAP_W);
  // Now and then: is the way to the next waypoint still open (a door may have shut)?
  const blocked = c.grid[next] === 1 || !c.w.inside(nx, nz);
  if (blocked || ((c.step + k) % 10 === 0 && !clearLine(c.w, b.x, b.z, centerX(next), centerZ(next), undefined, c.grid))) {
    route(c, m);
    return false;
  }
  const dx = centerX(next) - b.x;
  const dz = centerZ(next) - b.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dx || dz) b.facing = nearestDir(dx, dz);
  // Someone in the way: wait a moment, then squeeze by (nobody gets stuck for good).
  const way = m.stall < YIELD_STEPS && (dx || dz) ? inTheWay(c, m, k, dx, dz, dist) : CLEAR;
  if (way !== CLEAR) {
    m.stall++;
    // Someone stays put in the way (at their spot): after a moment, find a way round them.
    if (way === WAIT && m.stall === DETOUR_STEPS && detour(c, m, k)) return false;
    b.moving = false;
    if (way === GIVE_WAY && m.stall <= SIDESTEP_STEPS) stepAside(c, b, dx, dz, dist);
    return false;
  }
  m.stall = m.stall >= YIELD_STEPS && m.stall < YIELD_STEPS + SQUEEZE_STEPS ? m.stall + 1 : 0;
  b.moving = true;
  if (dist <= speed) {
    b.x += dx;
    b.z += dz;
    m.path.shift();
    return m.path.length === 0;
  }
  b.x += Math.trunc((dx * speed) / dist);
  b.z += Math.trunc((dz * speed) / dist);
  return false;
}
