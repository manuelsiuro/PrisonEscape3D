import { cornersOf } from '../../content/grounds';
import { OPEN_HOURS, ROUTINE } from '../../content/routine';
import { zoneIndex, type ZoneId } from '../../content/zones';
import { clearLine, nearestDir } from '../ai/path';
import { tileAt } from '../world/grid';
import { lineOfSight } from '../ai/sight';
import { route, walkPath, type Crowd, type Walker } from '../ai/walker';
import { floorOf, placesOf, type Spot } from '../ai/places';
import { randomInt } from '../rng';
import { BODY_HALF, FLEE_RANGE, FLEE_SPEED, HOSTILE_GRUDGE, HOSTILE_OPINION, INMATE_REACTION, INMATE_SPEED, INMATE_STR_MIN, JOG_EXTRA, INMATE_STR_SPAN, OPINION_START, STEPS_PER_SECOND, UNIT } from '../tuning';
import { MAP_H, MAP_W, type World } from '../world/World';
import { DIR_X, DIR_Z } from '../command';
import { maxHealth, type Fighter } from './combat';
import { bodyAt, type Body } from './movement';

/**
 * What someone is doing where they stand (the view poses it): inmates, guards (searching), the
 * player (knocked out). Append only. (P22's WRESTLE, PICK and DICE are the view's alone: an
 * arm-wrestle, a lock being picked, dice thrown; the sim never sets them.) P23: BRAWL, two inmates
 * scrapping (the sim's); LOOKOUT, a lookout on watch (the view's). P40: DIG, an inmate digging under his
 * bed while the player keeps a lookout for him (the sim's: an odd job).
 */
export const DOING = { NOTHING: 0, SLEEP: 1, EAT: 2, EXERCISE: 3, SHOWER: 4, LINE_UP: 5, SEARCH: 6, KNOCKED_OUT: 7, CRAWL: 8, WORK: 9, LIFT: 10, RUN: 11, READ: 12, SIT: 13, SIT_READ: 14, DOZE: 15, WRESTLE: 16, PICK: 17, DICE: 18, BRAWL: 19, LOOKOUT: 20, CARDS: 21, SHOOT: 22, BOARD: 23, FOOTBALL: 24, TATTOO: 25, DRUMS: 26, GUITAR: 27, QUIZ: 28, JOG: 29, PHONE: 30, QUEUE: 31, KIOSK: 32, DIG: 35 } as const;

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
/** P31: where they go with a sports ground and a garden open (the courtyard is the quiet yard now). */
const HANGOUTS_GROUNDS: readonly ZoneId[] = ['yard', 'sports', 'sports', 'garden', 'library', 'gym', 'cellBlock', 'rollCall', 'corridor', 'canteen'];

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

/** The delivery's bay while its vehicle is in (P18): nobody picks a spot under it. */
let bay: Uint8Array | null = null;

/** Goals other inmates already hold, or the player's seat (so two never pick the same tile); under the delivery's vehicle. */
function taken(all: Inmate[], tile: number) {
  return tile === playerSeat || offTiles.includes(tile) || (bay !== null && bay[tile] === 1) || all.some((m) => m.goal === tile);
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
    case 'exercise': {
      // (P31: with a sports ground, out there: a third of them jog the track.)
      const ring = w.def.leisure?.track;
      if (!ring || !floorOf(w, ['sports']).length) {
        spot = pickSpot(all, tiles(floorOf(w, randomInt(rng, 3) ? ['yard'] : ['gym']), 1 + randomInt(rng, 16)), rng);
        then = DOING.EXERCISE;
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
      spot = pickSpot(all, tiles(floorOf(w, r ? ['sports'] : ['gym']).filter((t) => !seats.has(t)), 1 + randomInt(rng, 16)), rng);
      then = DOING.EXERCISE;
      break;
    }
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
        // (P31: the sports ground's bleachers too, while it's open.)
        const stands = OPEN_HOURS.sports!.includes(id) ? zoneIndex('sports') : -1;
        const free = places.rests.filter((r) => (w.ground.zone[r.tile] === lib || w.ground.zone[r.tile] === yard || w.ground.zone[r.tile] === stands || w.cellOf[r.tile] === m.cell) && !taken(all, r.tile));
        if (free.length) {
          spot = free[randomInt(rng, free.length)];
          then = w.ground.zone[spot.tile] === lib ? DOING.SIT_READ : DOING.SIT;
          break;
        }
      }
      // (P31: the sports ground and the garden while they're open.)
      const hangouts = OPEN_HOURS.sports!.includes(id) && w.def.leisure?.track ? HANGOUTS_GROUNDS : HANGOUTS;
      const r = randomInt(rng, hangouts.length + 1);
      const list = r === hangouts.length ? own() : floorOf(w, [hangouts[r]]);
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
  playerSeat = social.seat;
  offTiles = social.off ?? [];
  bay = w.delivering ? w.parked : null;
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
      m.doing = social.doing[k] ?? DOING.NOTHING;
      m.plan = -1;
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
    // A rat running loose close by, in sight (P20): away from it as fast as legs go, then watching it
    // from a safe distance (its goal kept: its spot stays its own); once it's over, back to it.
    if (social.scare.length && m.doing !== DOING.SLEEP && flee(c, m, social.scare)) return;
    // Back on its spot after fleeing (P20): what it was doing there, taken up again as it was (nothing drawn).
    if (m.doing === DOING.NOTHING && m.then !== DOING.NOTHING && m.goal >= 0 && !m.path.length && tileAt(m.body.x, m.body.z) === m.goal) {
      m.doing = m.then;
      m.body.facing = m.face;
      m.body.moving = false;
    }
    // (P39: headed for, or sitting on, a tile kept clear: somewhere else.)
    if (offTiles.length && m.goal >= 0 && offTiles.includes(m.goal)) {
      m.goal = -1;
      m.path = [];
      m.doing = DOING.NOTHING;
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
    if (m.goal < 0) {
      choose(c, m, all, rng, social.work[k] ?? -1);
      if (m.goal >= 0 && !m.path.length && tileAt(m.body.x, m.body.z) === m.goal) arrive(m, plan, rng);
      return;
    }
    if (m.path.length) {
      // (Jogging the track, P31: a jog's pace, not a walk's.)
      if (walkPath(c, m, k, m.then === DOING.JOG ? m.speed + JOG_EXTRA : m.speed)) arrive(m, plan, rng);
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
