import { ROUTINE } from '../../content/routine';
import type { ZoneId } from '../../content/zones';
import { tileAt } from '../ai/path';
import { route, walkPath, type Crowd, type Walker } from '../ai/walker';
import { floorOf, placesOf, type Spot } from '../ai/places';
import { randomInt } from '../rng';
import { INMATE_REACTION, INMATE_SPEED, STEPS_PER_SECOND, UNIT } from '../tuning';
import { MAP_W, type World } from '../world/World';
import { bodyAt, type Body } from './movement';

/** What someone is doing where they stand (the view poses it): inmates, guards (searching), the player (knocked out). */
export const DOING = { NOTHING: 0, SLEEP: 1, EAT: 2, EXERCISE: 3, SHOWER: 4, LINE_UP: 5, SEARCH: 6, KNOCKED_OUT: 7, CRAWL: 8 } as const;

/** The plan an inmate follows: a routine block's index, or this during a lockdown. */
export const LOCKDOWN_PLAN = -2;

/** An AI inmate. Plain data, part of the simulation state. */
export interface Inmate extends Walker {
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
}

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
function choose(c: Crowd, m: Inmate, all: Inmate[], rng: { rng: number }) {
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
  route(c, m);
}

/**
 * One step of inmate life: each follows the routine block (or the lockdown), setting off a
 * moment after the bell, walking an A* path, then lining up, eating, exercising,
 * showering or sleeping where it arrives. Free time is spent wandering between hangouts.
 * Inmates make way for each other and for `others` (the player, guards); they never pick
 * the same spot.
 */
export function stepInmates(w: World, all: Inmate[], plan: number, rng: { rng: number }, others: readonly Body[], step: number) {
  const c: Crowd = { w, grid: w.npcBlock, all, others, step };
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
      choose(c, m, all, rng);
      if (m.goal >= 0 && !m.path.length && tileAt(m.body.x, m.body.z) === m.goal) arrive(m, plan, rng);
      return;
    }
    if (m.path.length) {
      if (walkPath(c, m, k)) arrive(m, plan, rng);
      return;
    }
    if (tileAt(m.body.x, m.body.z) !== m.goal) {
      // Not there and no path (none was found earlier): try again.
      route(c, m);
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
