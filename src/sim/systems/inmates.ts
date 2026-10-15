import { ROUTINE } from '../../content/routine';
import { zoneIndex, type ZoneId } from '../../content/zones';
import { clearLine, nearestDir, tileAt } from '../ai/path';
import { route, walkPath, type Crowd, type Walker } from '../ai/walker';
import { floorOf, placesOf, type Spot } from '../ai/places';
import { randomInt } from '../rng';
import { INMATE_REACTION, INMATE_SPEED, INMATE_STR_MIN, INMATE_STR_SPAN, OPINION_START, STEPS_PER_SECOND, UNIT } from '../tuning';
import { MAP_W, type World } from '../world/World';
import { maxHealth, type Fighter } from './combat';
import { bodyAt, type Body } from './movement';

/** What someone is doing where they stand (the view poses it): inmates, guards (searching), the player (knocked out). */
export const DOING = { NOTHING: 0, SLEEP: 1, EAT: 2, EXERCISE: 3, SHOWER: 4, LINE_UP: 5, SEARCH: 6, KNOCKED_OUT: 7, CRAWL: 8, WORK: 9, LIFT: 10, RUN: 11, READ: 12, SIT: 13, SIT_READ: 14 } as const;

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
      ...fighter(INMATE_STR_MIN + randomInt(rng, INMATE_STR_SPAN)),
      angry: 0,
      opinion: OPINION_START,
      shift: 0,
    });
  }
  return out;
}

/** A fighter's starting numbers: full health, up and about. */
export const fighter = (str: number) => ({ hp: maxHealth(str), ko: 0, str, swing: -1000 });

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

/** Chooses where an inmate goes next for its plan, and what it does there (`work`: its job's zone index, -1 without one). */
function choose(c: Crowd, m: Inmate, all: Inmate[], rng: { rng: number }, work: number) {
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
      // The Work Period: at the job, if it has one (GDD §11); else more free time.
      if (id === 'work' && work >= 0) {
        spot = pickSpot(all, tiles(placesOf(w).floor[work] ?? [], 1 + randomInt(rng, 16)), rng);
        then = DOING.WORK;
        break;
      }
      // Free time: now and then a seat (reading at a library table, a yard bench, the chair in
      // its own cell), else somewhere to hang about for a while, then somewhere else.
      if (randomInt(rng, 3) === 0) {
        const lib = zoneIndex('library');
        const yard = zoneIndex('yard');
        const free = places.rests.filter((r) => (w.ground.zone[r.tile] === lib || w.ground.zone[r.tile] === yard || w.cellOf[r.tile] === m.cell) && !taken(all, r.tile));
        if (free.length) {
          spot = free[randomInt(rng, free.length)];
          then = w.ground.zone[spot.tile] === lib ? DOING.SIT_READ : DOING.SIT;
          break;
        }
      }
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
export function stepInmates(w: World, all: Inmate[], plan: number, rng: { rng: number }, others: readonly Body[], step: number, foe: Body | null = null, social: Social = NO_SOCIAL) {
  const c: Crowd = { w, grid: w.npcBlock, all, others, step };
  all.forEach((m, k) => {
    // Out cold: lies where it fell (Sim counts the time and wakes it).
    if (m.ko > 0) {
      m.body.moving = false;
      m.doing = DOING.KNOCKED_OUT;
      return;
    }
    // A follower (GDD §10.3): after whoever comes for the player, else at the player's heels.
    const lead = social.follow[k];
    if (lead && m.angry <= 0) {
      m.doing = DOING.NOTHING;
      m.plan = -1;
      closeIn(c, m, k, lead, m.speed + 30, social.gap[k]);
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
      if (foe && m.angry > 0) {
        m.doing = DOING.NOTHING;
        closeIn(c, m, k, foe, m.speed + 24);
        return;
      }
      // Calm again: back to the routine, planned afresh.
      m.angry = 0;
      m.plan = -1;
    }
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
      choose(c, m, all, rng, social.work[k] ?? -1);
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
}
const NO_SOCIAL: Social = { follow: [], gap: [], talk: -1, work: [] };

/**
 * Goes for someone: straight at them when close with nothing between, else along a path
 * re-planned now and then. Stops at arm's length, facing them.
 */
export function closeIn(c: Crowd, m: Walker, k: number, foe: Body, speed: number, gap = STAND_OFF) {
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
