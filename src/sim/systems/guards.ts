import type { GuardDef, GuardTrait, Waypoint } from '../../content/prisons/types';
import { twist } from './twists';
import { ROUTINE } from '../../content/routine';
import { clearLine, nearestDir } from '../ai/path';
import { centerX, centerZ, tileAt } from '../world/grid';
import { lineOfSight, SIGHT_RANGE } from '../ai/sight';
import { placesOf } from '../ai/places';
import { route, walkPath, type Crowd, type Walker } from '../ai/walker';
import { turnDir } from '../command';
import { rollInt, SALT } from '../rng';
import { GUARD_STR, NAP_FROM, NAP_MAX, NAP_MIN, NAP_TO, RIOT_STR, STEPS_PER_SECOND, STIR_RANGE, STIR_STEPS, UNIT } from '../tuning';
import { clockAt } from './clock';
import { MAP_W, type World } from '../world/World';
import type { Fighter } from './combat';
import { DOING, fighter, STAND_OFF } from './inmates';
import { bodyAt, type Body } from './movement';
import type { DeliveryDuty } from './delivery';

/** What a guard is up to. Never renumber: saves store them. */
export const GUARD = {
  /** Its round, its post, or asleep in the guard quarters (yellow cone, none asleep). */
  DUTY: 0,
  /** Going to look where it last saw the player, and looking around (orange). */
  INVESTIGATE: 1,
  /** Running after the player (red). */
  CHASE: 2,
  /** Night bed check: looking into each cell from its door. */
  BED_CHECK: 3,
  /** Morning shakedown: searching cell desks. */
  SHAKEDOWN: 4,
} as const;

/** Cone colors (GDD §5.1): none (asleep), yellow, orange, red. */
export const ALERT = { NONE: 0, CALM: 1, SUSPICIOUS: 2, HOSTILE: 3 } as const;

/** A guard. Plain data, part of the simulation state. */
export interface Guard extends Walker, Fighter {
  mode: number;
  /** The duty it is set up for (see dutyOf); a change sends it somewhere new. */
  plan: number;
  /** Its place in its round. */
  leg: number;
  /** Where it looks while standing (1–16); it glances either side of it. */
  face: number;
  /** Steps left standing at a stop, looking into a cell, searching a desk, looking around. */
  timer: number;
  /** Cells still to look into (bed check) or search (shakedown). */
  tasks: number[];
  /** The tile it is investigating. */
  target: number;
  /** DOING: asleep, searching (the view poses it). */
  doing: number;
  /** It saw the player at the end of the last step, and where. */
  sees: boolean;
  lastSeen: number;
  /** A bed check or shakedown interrupted by a chase (GUARD mode, 0 for none): taken up again after. */
  resume?: number;
  /** P15. Steps left dozing at its nap stop (a lazy guard on its night round; blind meanwhile), 0 awake. */
  doze: number;
  /** The day it last dozed off (once a night). */
  napDay: number;
  /** Steps the player has stood right beside it while it dozes (STIR_STEPS wakes it). */
  stir: number;
  /** Bribed to look the other way (a corrupt guard): the step it looks again, 0 none. */
  bribed: number;
  /** The day it last lost the player's paperwork (once a day). */
  paperDay: number;
}

/** Guards stroll on their rounds and run when chasing (the player walks at 184). */
export const GUARD_SPEED = 120;
/** A little faster than the player walks: running only buys time, breaking line of sight escapes. */
export const CHASE_SPEED = 196;
/** How long a guard looks around where it lost the player, looks into a cell, searches a desk. */
const LOOK_AROUND = 8 * STEPS_PER_SECOND;
/** A chaser that loses sight keeps going this long before it investigates instead. */
const CHASE_GRACE = STEPS_PER_SECOND;
const CHECK_STEPS = 2 * STEPS_PER_SECOND;
const SEARCH_STEPS = 4 * STEPS_PER_SECOND;
/** Standing guards glance to one side and the other this often. */
const GLANCE = 30;

/** Duty codes besides a routine index (a post during that block). */
const PLAN_ROUND = -1;
const PLAN_NIGHT = -2;
const PLAN_BED = -3;
/** The delivery's supervisor (P18): its round of the vehicle, then the sign-off at its tail. */
const PLAN_DELIVERY = -4;
const PLAN_SIGN = -5;
const PLAN_NONE = -9;

export function spawnGuards(w: World): Guard[] {
  return w.def.guards.map((d) => {
    const at = d.beat[0];
    return {
      body: bodyAt(at.x, at.z, at.face ?? 5),
      goal: -1,
      path: [],
      wait: 0,
      speed: GUARD_SPEED,
      stall: 0,
      mode: GUARD.DUTY,
      plan: PLAN_NONE,
      leg: 0,
      face: at.face ?? 5,
      timer: 0,
      tasks: [],
      target: -1,
      doing: DOING.NOTHING,
      sees: false,
      lastSeen: -1,
      resume: 0,
      ...fighter(d.riot ? RIOT_STR : GUARD_STR),
      doze: 0,
      napDay: 0,
      stir: 0,
      bribed: 0,
      paperDay: 0,
    };
  });
}

export const alertOf = (g: Guard) =>
  !awake(g) ? ALERT.NONE : g.mode === GUARD.CHASE ? ALERT.HOSTILE : g.mode === GUARD.INVESTIGATE ? ALERT.SUSPICIOUS : ALERT.CALM;

/** Awake and on its feet (sleeping, dozing or knocked-out guards see nothing). */
export const awake = (g: Guard) => g.doing !== DOING.SLEEP && g.doing !== DOING.DOZE && g.ko <= 0;

/** A guard's ways (P15): its trait, steady unless the prison says otherwise. */
export const traitOf = (def: GuardDef): GuardTrait => def.trait ?? 'steady';

/** Woken from a doze (by a noise, the player at its elbow, a job to do). Returns whether it was dozing. */
export function rouse(g: Guard): boolean {
  const was = g.doze > 0;
  g.doze = 0;
  g.stir = 0;
  if (g.doing === DOING.DOZE) g.doing = DOING.NOTHING;
  return was;
}

/**
 * How fast a guard's look around runs down (P15): a lazy one gives up a quarter sooner
 * (2 steps' worth one step in three), a strict one keeps at it half as long again (nothing
 * one step in three). Worked out from the step, so nothing more is stored.
 */
const lookDrain = (trait: GuardTrait, step: number) => (trait === 'lazy' ? (step % 3 === 0 ? 2 : 1) : trait === 'strict' ? (step % 3 === 0 ? 0 : 1) : 1);

/** Which guards sleep at night (those without a night round), and the bed each takes. */
function bedOf(w: World, k: number): number {
  let n = 0;
  for (let j = 0; j < k; j++) if (!w.def.guards[j].night) n++;
  return placesOf(w).guardBeds[n]?.tile ?? -1;
}

/** A guard's duty during a routine block: a post, its day round, its night round or bed; the delivery's supervisor (P18) the vehicle's round or its sign-off. */
function dutyOf(def: GuardDef, routine: number, k: number, delivery: DeliveryDuty | null, mods: readonly string[] = []): number {
  if (delivery?.guard === k) return delivery.signOff ? PLAN_SIGN : PLAN_DELIVERY;
  const id = ROUTINE[routine].id;
  if (def.posts?.[id]) return routine;
  if (id !== 'lightsOut') return PLAN_ROUND;
  // (P26: a Double Shift Daily, nobody goes to bed: who has no night round walks its day one.)
  return def.night || twist({ mods }, 'doubleShift') ? PLAN_NIGHT : PLAN_BED;
}

/** The round a guard walks at night: its own, or (a Double Shift Daily, P26) its day round. */
const nightRound = (def: GuardDef) => def.night ?? def.beat;

/** Steps the player stands at a dozing guard's elbow before it wakes (P26: half that with Light Sleepers). */
export const stirSteps = (s: { readonly mods: readonly string[] }) => (twist(s, 'lightSleepers') ? STIR_STEPS / 2 : STIR_STEPS);

const tileOf = (p: Waypoint) => p.z * MAP_W + p.x;

/** Sets off for a tile (planning the walk now). */
function head(c: Crowd, g: Guard, tile: number) {
  g.goal = tile;
  g.doing = DOING.NOTHING;
  route(c, g);
}


/** Standing somewhere: glance left, ahead, right, ahead… */
function glance(g: Guard, step: number, wide: number) {
  const k = Math.floor(step / GLANCE) % 4;
  g.body.facing = k === 1 ? turnDir(g.face, -wide) : k === 3 ? turnDir(g.face, wide) : g.face;
}

/** Whether a guard stands at its goal. */
const there = (g: Guard) => g.goal >= 0 && !g.path.length && tileAt(g.body.x, g.body.z) === g.goal;

/** What a guard reports from a stop on its bed check or shakedown, and dozing off or waking up (Sim applies it). */
export type GuardReport = { kind: 'bedCheck'; cell: number } | { kind: 'search'; cell: number } | { kind: 'nap'; guard: number; on: boolean };

/**
 * One step of guard life. Each guard follows its duty for the routine block (a round of
 * waypoints with stops, a post, or bed at night), unless something more pressing is on:
 * chasing the player (a lockdown sends everyone), investigating where it lost them, the
 * night bed checks, the morning shakedown. Guards hold keys to every door (they walk the
 * guard grid). What they see is worked out after the player moves (see Sim); `report` is
 * called when a guard finishes looking into a cell or searching a desk.
 */
export function stepGuards(
  w: World,
  guards: Guard[],
  routine: number,
  lockdown: boolean,
  player: Body,
  inmates: readonly Body[],
  step: number,
  report: (r: GuardReport) => void,
  /** The player is on the ground floor (in the tunnels, vents or up on a roof nobody bumps into them). */
  playerHere = true,
  /** The guard the player is talking to (P15; -1 none): it stands still, facing them. */
  talkTo = -1,
  /** state.salt (P15): how long a nap lasts. */
  salt = 0,
  /** The delivery's supervisor and what it's to do (P18; null while no vehicle is in). */
  delivery: DeliveryDuty | null = null,
  /** The Daily's twists (P26: Double Shift, Light Sleepers, Straight-Laced). */
  mods: readonly string[] = [],
) {
  const crowd: Crowd = { w, grid: w.guardBlock, all: guards, others: playerHere ? [player, ...inmates] : inmates, step };
  const chasers: Crowd = { ...crowd, others: inmates };
  const places = placesOf(w);
  guards.forEach((g, k) => {
    const def = w.def.guards[k];
    // Out cold (GDD §10.2): lies where it fell; Sim counts the time and wakes it.
    if (g.ko > 0) {
      g.body.moving = false;
      g.doing = DOING.KNOCKED_OUT;
      return;
    }
    // A lockdown: every guard hunts the player, the sleepers too.
    if (lockdown && g.mode !== GUARD.CHASE) startChase(g);
    // Talking with the player (P15): it stands still and faces them, its duty on hold (once
    // its duty is planned: back from a look this very step, it plans first, or Sim's
    // dutyDue could never see the talk out).
    if (k === talkTo && g.mode === GUARD.DUTY && g.plan !== PLAN_NONE && playerHere) {
      const b = g.body;
      b.moving = false;
      if (player.x !== b.x || player.z !== b.z) b.facing = nearestDir(player.x - b.x, player.z - b.z);
      return;
    }
    switch (g.mode) {
      case GUARD.CHASE: {
        // Out of sight a moment (a corner, a glance): it keeps on for a second before giving up.
        if (g.sees || lockdown) g.timer = CHASE_GRACE;
        else g.timer--;
        if (!lockdown && g.timer <= 0) {
          // Lost them: go and look where they were last seen.
          if (g.lastSeen < 0) {
            backToDuty(g);
            break;
          }
          g.mode = GUARD.INVESTIGATE;
          g.target = g.lastSeen;
          g.timer = LOOK_AROUND;
          head(crowd, g, g.target);
          break;
        }
        const b = g.body;
        const dx = player.x - b.x;
        const dz = player.z - b.z;
        // Close and nothing between: straight at them, to arm's length (the baton does the
        // rest, see Sim). Further: follow a path, re-planned often.
        if (playerHere && Math.abs(dx) + Math.abs(dz) < UNIT * 2 && clearLine(w, b.x, b.z, player.x, player.z, undefined, w.guardBlock)) {
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d > 0) b.facing = nearestDir(dx, dz);
          b.moving = d > STAND_OFF;
          if (b.moving) {
            const go = Math.min(CHASE_SPEED, d - STAND_OFF);
            b.x += Math.trunc((dx * go) / d);
            b.z += Math.trunc((dz * go) / d);
          }
          g.path = [];
          break;
        }
        // No way there (a spot guards can't reach): wait before trying again, never A* every step.
        if (g.wait > 0) {
          g.wait--;
          b.moving = false;
          break;
        }
        // Gone below or up into the vents: guards can't know where; they make for where the
        // player was last seen (and wait there), never for the live position.
        const goal = playerHere ? tileAt(player.x, player.z) : g.lastSeen >= 0 ? g.lastSeen : g.goal;
        if (goal < 0) {
          b.moving = false;
          break;
        }
        if (!g.path.length || (goal !== g.goal && (step + k) % 10 === 0)) head(chasers, g, goal);
        walkPath(chasers, g, k, CHASE_SPEED);
        // Running a path round a corner, it keeps its eyes on the player while it can see them.
        if (playerHere && Math.abs(dx) + Math.abs(dz) < SIGHT_RANGE && lineOfSight(w, b.x, b.z, player.x, player.z)) b.facing = nearestDir(dx, dz);
        break;
      }
      case GUARD.INVESTIGATE:
        // Sent to look somewhere (a detector, a camera, the generator): plan the walk there once.
        if (g.target >= 0 && g.goal !== g.target) head(crowd, g, g.target);
        if (g.wait > 0) g.wait--;
        else if (g.path.length) walkPath(crowd, g, k);
        else {
          // There (or as close as it got): a good look around, then back to duty.
          g.body.moving = false;
          g.body.facing = turnDir(g.body.facing, step % 12 === 0 ? 2 : 0);
          g.timer -= lookDrain(traitOf(def), step);
          if (g.timer <= 0) backToDuty(g);
        }
        break;
      case GUARD.BED_CHECK:
      case GUARD.SHAKEDOWN: {
        const cell = g.tasks[0];
        if (cell === undefined) {
          backToDuty(g);
          break;
        }
        const check = g.mode === GUARD.BED_CHECK;
        const spot = check ? places.doorstep[cell] : places.deskside[cell];
        // Nowhere to stand for it (a cell without a door or desk): skip it.
        if (spot < 0) {
          g.tasks.shift();
          break;
        }
        if (g.goal !== spot) {
          head(crowd, g, spot);
          // A strict guard searches a desk half as long again (P15).
          g.timer = check ? CHECK_STEPS : traitOf(def) === 'strict' ? (SEARCH_STEPS * 3) / 2 : SEARCH_STEPS;
        }
        if (g.wait > 0) g.wait--;
        else if (g.path.length) walkPath(crowd, g, k);
        else if (!there(g)) head(crowd, g, spot);
        else {
          // At the door (or the desk): face it, look (or rummage), then report.
          const door = w.cellDoor[cell];
          const desk = w.props.find((p) => p.kind === 'desk' && w.cellOf[p.z * MAP_W + p.x] === cell);
          const tx = check ? centerX(door) : desk ? (desk.x + desk.w / 2) * UNIT : g.body.x;
          const tz = check ? centerZ(door) : desk ? (desk.z + desk.d / 2) * UNIT : g.body.z;
          g.body.moving = false;
          if (tx !== g.body.x || tz !== g.body.z) g.body.facing = nearestDir(tx - g.body.x, tz - g.body.z);
          g.doing = check ? DOING.NOTHING : DOING.SEARCH;
          if (--g.timer <= 0) {
            report(check ? { kind: 'bedCheck', cell } : { kind: 'search', cell });
            g.tasks.shift();
            g.goal = -1;
            g.doing = DOING.NOTHING;
          }
        }
        break;
      }
      default:
        duty(crowd, g, k, def, routine, step, w, player, playerHere, report, salt, delivery, mods);
    }
  });
}

/** After the player. A bed check or shakedown under way is kept, to take up afterwards. */
export function startChase(g: Guard) {
  rouse(g);
  if (g.mode === GUARD.BED_CHECK || g.mode === GUARD.SHAKEDOWN) g.resume = g.mode;
  g.mode = GUARD.CHASE;
  g.timer = CHASE_GRACE;
  g.doing = DOING.NOTHING;
  g.path = [];
  g.goal = -1;
  g.wait = 0;
}

/**
 * Sent to look at a place (GDD §5.4–5.6: a tripped detector, a camera's alarm, the generator
 * switched off): it goes there and looks around, then back to duty. A chase comes first; a bed
 * check or shakedown under way is taken up again after.
 */
export function sendToLook(g: Guard, tile: number, look = LOOK_AROUND) {
  if (g.mode === GUARD.CHASE) return;
  rouse(g);
  if (g.mode === GUARD.BED_CHECK || g.mode === GUARD.SHAKEDOWN) g.resume = g.mode;
  g.mode = GUARD.INVESTIGATE;
  g.target = tile;
  g.timer = look;
  g.path = [];
  g.goal = -1;
  g.wait = 0;
  g.doing = DOING.NOTHING;
}

/** Back to work: an interrupted bed check or shakedown first, else the round or post (planned afresh). */
export function backToDuty(g: Guard) {
  g.mode = g.resume && g.tasks.length ? g.resume : GUARD.DUTY;
  g.resume = 0;
  if (g.mode === GUARD.DUTY) g.tasks = [];
  g.plan = PLAN_NONE;
  g.path = [];
  g.goal = -1;
  g.doing = DOING.NOTHING;
}

/**
 * Calls off a bed check or shakedown (under way or waiting for a chase to end): its time has
 * passed (bed checks belong to the night, shakedowns to the morning).
 */
export function cancelTasks(g: Guard, mode: number) {
  if (g.resume === mode) {
    g.resume = 0;
    g.tasks = [];
  }
  if (g.mode === mode) backToDuty(g);
}

/** Sends a guard on a list of cells: the bed check or the shakedown (after the chase, if it's chasing). */
export function assign(g: Guard, mode: number, cells: number[]) {
  rouse(g);
  g.tasks = cells;
  if (g.mode === GUARD.CHASE || g.mode === GUARD.INVESTIGATE) {
    g.resume = mode;
    return;
  }
  g.mode = mode;
  g.path = [];
  g.goal = -1;
  g.wait = 0;
  g.doing = DOING.NOTHING;
}

/** Whether a guard's duty changes with this block (a new round, a post, bed): a talk with it ends (P15). */
export const dutyDue = (def: GuardDef, g: Guard, routine: number, k: number, delivery: DeliveryDuty | null, mods: readonly string[] = []) => g.plan !== PLAN_NONE && dutyOf(def, routine, k, delivery, mods) !== g.plan;

/**
 * Rounds, posts and bed. A lazy guard on its night round dozes off at its nap stop between
 * 01:00 and 05:00, once a night (P15): blind until the nap is over (05:00 at the latest), a
 * noise wakes it (noise.ts), or the player stands at its elbow a moment.
 */
function duty(c: Crowd, g: Guard, k: number, def: GuardDef, routine: number, step: number, w: World, player: Body, playerHere: boolean, report: (r: GuardReport) => void, salt: number, delivery: DeliveryDuty | null, mods: readonly string[]) {
  const plan = dutyOf(def, routine, k, delivery, mods);
  if (plan !== g.plan) {
    if (rouse(g)) report({ kind: 'nap', guard: k, on: false });
    g.plan = plan;
    g.path = [];
    g.goal = -1;
    g.timer = 0;
    g.doing = DOING.NOTHING;
    // Off to the round: start at its nearest stop.
    const round = plan === PLAN_NIGHT ? nightRound(def) : plan === PLAN_DELIVERY ? delivery!.round : def.beat;
    if (plan === PLAN_ROUND || plan === PLAN_NIGHT || plan === PLAN_DELIVERY) g.leg = nearest(g.body, round);
  }
  if (g.wait > 0) {
    g.wait--;
    return;
  }
  if (plan === PLAN_BED) {
    const bed = bedOf(w, k);
    if (g.doing === DOING.SLEEP) return;
    if (g.goal !== bed) head(c, g, bed);
    if (g.path.length) walkPath(c, g, k);
    else if (there(g)) {
      g.body.moving = false;
      g.doing = DOING.SLEEP;
    } else head(c, g, bed);
    return;
  }
  if (plan >= 0 || plan === PLAN_SIGN) {
    // A post: walk there, then stand watching, glancing either side. (The delivery's sign-off: at the vehicle's tail, facing it.)
    const post = plan === PLAN_SIGN ? delivery!.signOff! : def.posts![ROUTINE[plan].id]!;
    if (g.goal !== tileOf(post)) {
      head(c, g, tileOf(post));
      g.face = post.face ?? 5;
    }
    if (g.path.length) walkPath(c, g, k);
    else if (there(g)) {
      g.body.moving = false;
      glance(g, step + k * 7, 2);
    } else head(c, g, tileOf(post));
    return;
  }
  const round = plan === PLAN_NIGHT ? nightRound(def) : plan === PLAN_DELIVERY ? delivery!.round : def.beat;
  const stop = round[g.leg % round.length];
  if (g.goal !== tileOf(stop)) {
    head(c, g, tileOf(stop));
    g.timer = (stop.wait ?? 0) * STEPS_PER_SECOND;
  }
  if (g.path.length) {
    if (walkPath(c, g, k)) g.face = stop.face ?? g.body.facing;
    return;
  }
  if (!there(g)) {
    head(c, g, tileOf(stop));
    return;
  }
  g.body.moving = false;
  if (stop.face) g.face = stop.face;
  if (g.doze > 0) {
    const near = playerHere && Math.max(Math.abs(player.x - g.body.x), Math.abs(player.z - g.body.z)) <= STIR_RANGE;
    g.stir = near ? g.stir + 1 : 0;
    const late = clockAt(step).minuteOfDay >= NAP_TO;
    const stir = stirSteps({ mods });
    if (--g.doze <= 0 || late || g.stir >= stir) {
      // Someone right there: it comes to with a start, facing them.
      if (g.stir >= stir && (player.x !== g.body.x || player.z !== g.body.z)) g.body.facing = nearestDir(player.x - g.body.x, player.z - g.body.z);
      rouse(g);
      report({ kind: 'nap', guard: k, on: false });
    }
    return;
  }
  // (P26: never on a Straight-Laced Daily.)
  if (stop.nap && plan === PLAN_NIGHT && traitOf(def) === 'lazy' && !twist({ mods }, 'straightLaced')) {
    const clock = clockAt(step);
    if (clock.minuteOfDay >= NAP_FROM && clock.minuteOfDay < NAP_TO && g.napDay !== clock.day) {
      g.napDay = clock.day;
      g.doze = NAP_MIN + rollInt(salt, SALT.NAP, k, clock.day, NAP_MAX - NAP_MIN + 1);
      g.stir = 0;
      g.doing = DOING.DOZE;
      g.body.facing = g.face;
      report({ kind: 'nap', guard: k, on: true });
      return;
    }
  }
  glance(g, step + k * 7, 3);
  if (--g.timer <= 0) {
    g.leg = (g.leg + 1) % round.length;
    g.goal = -1;
  }
}

/** The stop of a round closest to a body (as the crow flies). */
function nearest(b: Body, round: readonly Waypoint[]): number {
  let best = 0;
  let bestD = Infinity;
  round.forEach((p, i) => {
    const d = Math.abs(centerX(tileOf(p)) - b.x) + Math.abs(centerZ(tileOf(p)) - b.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}
