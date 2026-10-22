/**
 * Guard dogs (P19). A dog belongs to its handler (a guard with `dog` in its data): no Cast id,
 * it never bites and nobody fights it. From prison day 2 it works its shifts at the handler's
 * heel (10:00–22:00, 01:00–05:00 too if it works nights, and every lockdown) and lies by its
 * kennel otherwise.
 *
 * - **Its nose:** contraband in the hotbar this close (SNIFF_RANGE, a clear line) and it points
 *   and barks: heat, and the handler comes to look. A pouch in the hotbar keeps the smell in;
 *   a guard's uniform fools a dog not at all.
 * - **The trail:** out of bounds (after hours out of the cell, somewhere staff only, wanted or in
 *   a lockdown) the player leaves a scent on the ground floor, SCENT_TILES tiles fresh for
 *   SCENT_STEPS. A dog that crosses it (in a lockdown, any dog on shift) follows it to its end:
 *   to the player, or to the way they went down, up or through (a shaft, a grate, a hole in a
 *   wall or the fence), cover or no cover: damage found.
 * - **What works on a dog**, thrown to land by it: jerky (trust, once a day: from TRUST_IGNORE it
 *   lets contraband by, a friend at TRUST_FRIEND never tracks the player), pepper (sneezing, the
 *   trail gone), sleepy jerky (asleep for 2 game hours). Soap or a shower washes the scent off.
 */
import { twist } from './twists';
import { itemDef, itemNumber } from '../../content/items';
import { LOOT } from '../../content/loot';
import type { DogDef } from '../../content/prisons/types';
import { RESTRICTED } from '../../content/zones';
import { centerX, centerZ, nearestDir, tileAt } from '../ai/path';
import { lineOfSight } from '../ai/sight';
import { route, walkPath, type Crowd, type Walker } from '../ai/walker';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import {
  BARK_NOISE,
  CHASE_HEAT,
  DAZE_STEPS,
  DOG_CATCH_UP,
  DOG_DAY_FROM,
  DOG_DAY_TO,
  DOG_FIRST_DAY,
  DOG_HEEL,
  DOG_HEEL_SPEED,
  DOG_NIGHT_FROM,
  DOG_NIGHT_TO,
  DOG_RAT_RANGE,
  DOG_RAT_STEPS,
  DOG_RUN_SPEED,
  DOG_SLEEP_STEPS,
  DOG_TRACK_SPEED,
  POINT_STEPS,
  SCENT_STEPS,
  SCENT_TILES,
  SNEEZE_NOISE,
  SNIFF_AGAIN,
  SNIFF_HEAT,
  SNIFF_RANGE,
  STEPS_PER_SECOND,
  TREAT_RANGE,
  TREAT_TRUST,
  TRUST_FRIEND,
  TRUST_IGNORE,
  UNIT,
} from '../tuning';

/** Having lost a trail, a dog takes this long before it picks one up again. */
const TRAIL_REST = 10 * STEPS_PER_SECOND;
import { containersOf } from '../world/containers';
import { TILE } from '../world/tiles';
import { LAYER, layerOfKey, MAP_H, MAP_W, placeKey, tileOfKey, type World } from '../world/World';
import { clockAt, prisonDay } from './clock';
import { awake, GUARD, sendToLook, type Guard } from './guards';
import { HOTBAR, itemOf, slot, usesOf } from './items';
import { bodyAt, type Body } from './movement';
import { aimToss, makeNoise, type TossAim } from './noise';
import { underShower } from './actions';
import { chaseOff, ratOut, type Rat } from './rats';
import { addHeat, afterHours } from './watch';
import { brewNear, seizeBrew } from './pruno';

/** What a dog is up to. Never renumber: saves store them. */
export const DOG = {
  /** Off shift: to its kennel, and lying there. */
  KENNEL: 0,
  /** At its handler's heel. */
  HEEL: 1,
  /** Standing, pointing and barking: at the player (contraband, or the trail's end), or where the trail led. */
  POINT: 2,
  /** On the player's trail. */
  TRACK: 3,
  /** After a rat it saw running (P20). */
  RAT: 4,
} as const;

/** A guard dog. Plain data, part of the simulation state. */
export interface Dog extends Walker {
  mode: number;
  /** Steps left pointing. */
  timer: number;
  /** What it thinks of the player, 0–100 (jerky). */
  trust: number;
  /** The prison day it last had jerky (0 never). */
  fed: number;
  /** The step it stops sneezing (pepper), and the step it wakes (sleepy jerky); 0 none. */
  daze: number;
  sleep: number;
  /** The step it last smelled contraband or ran the player down (0 never): neither again for SNIFF_AGAIN. */
  sniffed: number;
  /** On the trail: the step the scent tile it's making for was laid; off it, the newest it has followed (it picks up only fresher scent). */
  trail: number;
  /** Having lost a trail, the step it may pick one up again (a trail it can't follow isn't tried 4 times a second). */
  rest: number;
}

const JERKY = itemNumber('jerky');
const PEPPER = itemNumber('pepper');
const SLEEPY = itemNumber('sleepy_jerky');
const PILLS = itemNumber('sleeping_pills');
const POUCH = itemNumber('pouch');
const NOBODY: readonly Body[] = [];

const handlersCache = new WeakMap<World, number[]>();

/** The guards with a dog (guard indexes), in the order of `state.dogs`. */
export function handlersOf(w: World): number[] {
  let list = handlersCache.get(w);
  if (!list) {
    list = [];
    w.def.guards.forEach((g, k) => g.dog && list!.push(k));
    handlersCache.set(w, list);
  }
  return list;
}

/** A dog's data (by its index in `state.dogs`). */
export const dogDef = (w: World, k: number): DogDef => w.def.guards[handlersOf(w)[k]].dog!;

/** The dogs of a new game, each lying by its kennel. */
export function spawnDogs(w: World): Dog[] {
  return handlersOf(w).map((h) => {
    const at = w.def.guards[h].dog!.kennel;
    return { body: bodyAt(at.x, at.z, at.face ?? 5), goal: -1, path: [], wait: 0, speed: DOG_HEEL_SPEED, stall: 0, mode: DOG.KENNEL, timer: 0, trust: 0, fed: 0, daze: 0, sleep: 0, sniffed: 0, trail: 0, rest: 0 };
  });
}

/** Asleep (sleepy jerky), sneezing (pepper). */
export const dogAsleep = (d: Dog, step: number) => d.sleep > step;
export const dogDazed = (d: Dog, step: number) => d.daze > step;

/** Whether a dog works now: from day 2, its shifts, every lockdown (not a run logged before the dogs came). */
export function onShift(sim: SimContext, def: DogDef): boolean {
  const s = sim.state;
  if (sim.noDogs || prisonDay(s.step) < dogsFrom(s)) return false;
  if (s.lockdown) return true;
  const m = clockAt(s.step).minuteOfDay;
  return (m >= DOG_DAY_FROM && m < DOG_DAY_TO) || (!!def.night && m >= DOG_NIGHT_FROM && m < DOG_NIGHT_TO);
}

/** P35: the hollow book (what it hides kept in its slot's upper bits). */
const HOLLOW_BOOK = itemNumber('hollow_book');

/** Contraband in the hotbar with no pouch there to keep the smell in: what a dog's nose finds (P35: a hollow book's pages don't hide it). */
export function smellsOfContraband(sim: SimContext): boolean {
  const inv = sim.state.items.inv;
  let found = false;
  for (let k = 0; k < HOTBAR; k++) {
    const n = itemOf(inv[k]);
    if (n === POUCH) return false;
    if (n && itemDef(n).contraband) found = true;
    const inside = n === HOLLOW_BOOK ? itemOf(usesOf(inv[k])) : 0;
    if (inside && itemDef(inside).contraband) found = true;
  }
  return found;
}

/** The player up and about on the ground floor (not hidden in a vehicle, out cold, in solitary). */
const playerAbout = (sim: SimContext) => sim.state.layer === LAYER.GROUND && !sim.state.stowed && !sim.away;

/** Where the player leaves a trail: out of bounds (after hours out of the cell, somewhere staff only), wanted, or in a lockdown. */
export function outOfBounds(sim: SimContext): boolean {
  const s = sim.state;
  if (s.lockdown || s.heat >= CHASE_HEAT) return true;
  const zone = sim.playerZone;
  return (afterHours(s) && zone !== 'playerCell') || RESTRICTED.includes(zone);
}

/** Whether a dog (by its index) would smell contraband on the player now, by its nose alone (the HUD's paw). */
export function noseFor(sim: SimContext, k: number): boolean {
  const s = sim.state;
  const d = s.dogs[k];
  const g = s.guards[handlersOf(sim.world)[k]];
  return !!d && d.mode === DOG.HEEL && g.ko <= 0 && !dogAsleep(d, s.step) && !dogDazed(d, s.step) && d.trust < TRUST_IGNORE && !s.lockdown && playerAbout(sim) && onShift(sim, dogDef(sim.world, k));
}

/** How close (units) a dog that would smell contraband on the player lights the paw on the HUD. */
const PAW_WARN = 3 * UNIT;

/**
 * The HUD's paw: 'track' while a dog is on the player's trail, 'nose' while one within PAW_WARN
 * would smell the contraband in the hotbar (every sniff happens with the paw on: k9test), null otherwise.
 */
export function dogWarning(sim: SimContext): 'nose' | 'track' | null {
  const s = sim.state;
  if (!s.dogs.length) return null;
  if (s.dogs.some((d) => d.mode === DOG.TRACK && !dogAsleep(d, s.step) && !dogDazed(d, s.step))) return 'track';
  if (!smellsOfContraband(sim)) return null;
  const p = s.player;
  for (let k = 0; k < s.dogs.length; k++) if (noseFor(sim, k) && dist(s.dogs[k].body, p.x, p.z) <= PAW_WARN) return 'nose';
  return null;
}

/**
 * The dogs' step (after the guards have looked): the player's trail laid or fading, then each
 * dog to its kennel, at its handler's heel, pointing, or on the trail.
 */
export function dogs(sim: SimContext) {
  const s = sim.state;
  if (!s.dogs.length || sim.noDogs || prisonDay(s.step) < dogsFrom(s)) return;
  layScent(sim);
  const w = sim.world;
  const handlers = handlersOf(w);
  const crowd: Crowd = { w, grid: w.guardBlock, all: s.dogs, others: NOBODY, step: s.step };
  for (let k = 0; k < s.dogs.length; k++) stepDog(sim, crowd, k, s.guards[handlers[k]], dogDef(w, k));
}

/** The trail: tiles too old fade; out of bounds, each new ground tile the player stands on is laid. */
function layScent(sim: SimContext) {
  const s = sim.state;
  while (s.scent.length && s.step - s.scent[0][1] > SCENT_STEPS) s.scent.shift();
  // Off the floor this step (down a shaft, up into the vents or onto a roof): the trail's last tile is where they left it.
  // (Only the tile they stood on as the step began, laid while they were out of bounds: never an older one.)
  const last0 = s.scent[s.scent.length - 1];
  if (sim.movedBy && s.layer !== LAYER.GROUND && last0 && last0[0] === sim.groundFrom) last0[2] = 1;
  // (Under a running shower nothing is laid: it washes off as it would be.)
  if (!playerAbout(sim) || !outOfBounds(sim) || underShower(sim)) return;
  const here = tileAt(s.player.x, s.player.z);
  const last = s.scent[s.scent.length - 1];
  if (last && last[0] === here) return;
  s.scent.push([here, s.step]);
  if (s.scent.length > SCENT_TILES) s.scent.shift();
}

/** The player's scent washed off (soap, a shower, pepper's sneezes): the trail is gone. Returns whether there was one. */
export function washScent(sim: SimContext, quiet = false): boolean {
  const s = sim.state;
  if (!s.scent.length) return false;
  s.scent = [];
  if (!quiet) sim.events.push({ type: 'washed' });
  return true;
}

const dist = (b: Body, x: number, z: number) => Math.sqrt((b.x - x) ** 2 + (b.z - z) ** 2);

/** Walks a dog towards a tile (planning the walk when the goal changes); returns whether it's there. */
function goTo(c: Crowd, d: Dog, k: number, tile: number, speed: number): boolean {
  const b = d.body;
  if (d.goal !== tile) {
    d.goal = tile;
    route(c, d);
  }
  if (d.wait > 0) {
    d.wait--;
    b.moving = false;
    return false;
  }
  if (d.path.length) {
    walkPath(c, d, k, speed);
    return false;
  }
  if (tileAt(b.x, b.z) === tile) {
    b.moving = false;
    return true;
  }
  route(c, d);
  b.moving = false;
  return false;
}

function stepDog(sim: SimContext, c: Crowd, k: number, g: Guard, def: DogDef) {
  const s = sim.state;
  const d = s.dogs[k];
  const b = d.body;
  // Asleep where it lay down (sleepy jerky), sneezing on the spot (pepper).
  if (d.sleep) {
    if (s.step < d.sleep) {
      b.moving = false;
      return;
    }
    d.sleep = 0;
    sim.events.push({ type: 'dog', dog: k, what: 'woke' });
    // (It gathers itself this step: its nose works from the next, the HUD's paw a step ahead of it.)
    b.moving = false;
    return;
  }
  if (d.daze && s.step <= d.daze) {
    b.moving = false;
    return;
  }
  if (!onShift(sim, def)) {
    if (d.mode !== DOG.KENNEL) {
      d.mode = DOG.KENNEL;
      d.goal = -1;
    }
    const kennel = def.kennel.z * MAP_W + def.kennel.x;
    if (goTo(c, d, k, kennel, DOG_HEEL_SPEED)) b.facing = def.kennel.face ?? 5;
    return;
  }
  if (d.mode === DOG.KENNEL) {
    d.mode = DOG.HEEL;
    d.goal = -1;
    // (On shift from this step: it sets off next, the HUD's paw a step ahead of its nose.)
    return;
  }
  // Its handler out cold: off the trail, back by him.
  if (g.ko > 0 && (d.mode === DOG.TRACK || d.mode === DOG.POINT)) return lose(sim, k);
  const p = s.player;
  const w = sim.world;
  const here = tileAt(b.x, b.z);
  // After a rat (P20): the nearest one still in sight and running, for DOG_RAT_STEPS at most; then a rest before the next.
  if (d.mode === DOG.RAT) {
    const r = ratSeen(sim, b, Infinity);
    // (Its handler out cold: back by him.)
    if (--d.timer <= 0 || !r || g.ko > 0) {
      // (Back at the heel a while before the next rat, its timer counting up from below 0; the trail it may pick up at once.)
      d.timer = -DOG_RAT_STEPS * 2;
      d.mode = DOG.HEEL;
      d.goal = -1;
      d.path = [];
      b.moving = false;
      return;
    }
    const rt = tileAt(r.x, r.z);
    if (d.goal !== rt && (!d.path.length || (s.step + k) % 10 === 0)) d.goal = -1;
    goTo(c, d, k, d.goal >= 0 ? d.goal : rt, DOG_RUN_SPEED);
    return;
  }
  if (d.mode === DOG.POINT) {
    b.moving = false;
    if (playerAbout(sim) && (p.x !== b.x || p.z !== b.z) && dist(b, p.x, p.z) <= SNIFF_RANGE * 2) b.facing = nearestDir(p.x - b.x, p.z - b.z);
    if (--d.timer <= 0) {
      d.mode = DOG.HEEL;
      d.goal = -1;
    }
    return;
  }
  // (A player only just back on the ground floor this step, out of the vents, a vehicle, solitary or a faint, is noticed from the next: the HUD's paw a step ahead.)
  const near = sim.aboutBefore && playerAbout(sim) && dist(b, p.x, p.z) <= SNIFF_RANGE && lineOfSight(w, b.x, b.z, p.x, p.z);
  if (d.mode === DOG.TRACK) {
    // Caught up with the player: there they are.
    if (near) {
      d.sniffed = s.step;
      return point(sim, k, g, 'point');
    }
    const at = s.scent.findIndex((e) => e[1] === d.trail);
    // The trail gone (washed off, gone stale): lost.
    if (at < 0) return lose(sim, k);
    const tile = s.scent[at][0];
    const there = goTo(c, d, k, tile, DOG_TRACK_SPEED);
    // No way there for a dog (a trail through a hole in a wall): it stops where the trail goes through.
    const stuck = !there && !d.path.length && d.wait > 0;
    if (there || stuck) {
      const next = s.scent[at + 1];
      if (stuck || (next && passage(w, next[0]))) return trailEnd(sim, k, g, stuck ? tile : next[0], stuck ? here : tile, false);
      if (next) {
        d.trail = next[1];
        d.goal = -1;
      } else return trailEnd(sim, k, g, tile, tile, s.scent[at][2] === 1);
    }
    // The handler follows the dog.
    if (s.step % STEPS_PER_SECOND === k % STEPS_PER_SECOND && awake(g) && g.mode !== GUARD.CHASE && (g.mode !== GUARD.INVESTIGATE || cheb(g.target, here) > 2)) sendToLook(g, here);
    return;
  }
  // At the heel: catching up when it's fallen behind, and standing by when it's close.
  const gt = tileAt(g.body.x, g.body.z);
  const far = dist(b, g.body.x, g.body.z);
  if (far > DOG_HEEL) {
    if (d.goal !== gt && (!d.path.length || (s.step + k) % 10 === 0)) d.goal = -1;
    goTo(c, d, k, d.goal >= 0 ? d.goal : gt, far > DOG_CATCH_UP ? DOG_RUN_SPEED : DOG_HEEL_SPEED);
  } else {
    b.moving = false;
    if (!g.body.moving) b.facing = g.body.facing;
  }
  // (Its handler out cold: it stays by him, and minds nothing else.)
  if (g.ko > 0) return;
  // A rat running in sight (P20): it's off after it, barking (the rat bolts home).
  // (A while after the last chase it minds its handler: not a bark every few seconds.)
  if (d.timer < 0) d.timer++;
  const rat = d.timer >= 0 ? ratSeen(sim, b, DOG_RAT_RANGE) : null;
  if (rat) {
    d.mode = DOG.RAT;
    d.timer = DOG_RAT_STEPS;
    d.goal = -1;
    d.path = [];
    sim.events.push({ type: 'dog', dog: k, what: 'rat' });
    makeNoise(sim, 'bark', LAYER.GROUND, here, BARK_NOISE);
    chaseOff(sim, rat);
    return;
  }
  // Its nose: contraband close by.
  if (near && !s.lockdown && d.trust < TRUST_IGNORE && (d.sniffed === 0 || s.step - d.sniffed >= SNIFF_AGAIN) && smellsOfContraband(sim)) {
    d.sniffed = s.step;
    point(sim, k, g, 'sniff');
    if (!s.lockdown) sim.events.push({ type: 'spotted', reason: 'sniffed' });
    addHeat(sim, SNIFF_HEAT);
    return;
  }
  // A brew in the furniture close by (P28: a bag of pruno fermenting, or ripe), smelled through the bars: pointed at, seized.
  if (!s.lockdown && d.trust < TRUST_IGNORE && (d.sniffed === 0 || s.step - d.sniffed >= SNIFF_AGAIN) && (s.step + k) % 10 === 0) {
    const c = brewNear(sim, b);
    if (c >= 0) {
      d.sniffed = s.step;
      const { tile } = seizeBrew(sim, c);
      const mine = containersOf(w)[c].mine;
      point(sim, k, g, 'brew', tile);
      sim.events.push({ type: 'pruno', what: 'seized', container: c, mine });
      // In the player's cell: theirs, and the guards know it.
      if (mine) {
        if (!s.lockdown) sim.events.push({ type: 'spotted', reason: 'sniffed' });
        addHeat(sim, SNIFF_HEAT);
      }
      return;
    }
  }
  // The trail: crossed (any dog on shift in a lockdown sets off along it). A friend never follows the player's;
  // one that has just run the player down or smelled them out gives it a while (its handler is looking already).
  if (d.trust >= TRUST_FRIEND || !s.scent.length || (d.sniffed !== 0 && s.step - d.sniffed < SNIFF_AGAIN) || s.step < d.rest) return;
  const pick = trailNear(s.scent, here, s.lockdown, d.trail);
  if (pick < 0) return;
  d.mode = DOG.TRACK;
  d.trail = s.scent[pick][1];
  d.goal = -1;
  d.path = [];
  d.wait = 0;
  sim.events.push({ type: 'dog', dog: k, what: 'track' });
}

/** The tile a dog picks the trail up at: one beside it (in a lockdown, the nearest anywhere), fresher than `after`; -1 none. */
function trailNear(scent: ReadonlyArray<readonly [number, number, number?]>, here: number, anywhere: boolean, after: number): number {
  let best = -1;
  let bestD = anywhere ? Infinity : 2;
  for (let k = 0; k < scent.length; k++) {
    if (scent[k][1] <= after) continue;
    const dd = cheb(scent[k][0], here);
    if (dd < bestD) {
      best = k;
      bestD = dd;
    }
  }
  return best;
}

const cheb = (a: number, b: number) => (a < 0 || b < 0 ? Infinity : Math.max(Math.abs((a % MAP_W) - (b % MAP_W)), Math.abs(Math.floor(a / MAP_W) - Math.floor(b / MAP_W))));

/** A way through on the ground floor the player could walk and a dog can't: a hole in a wall (covered or not), a fence cut (or patched). */
function passage(w: World, t: number): boolean {
  const k = w.ground.kind[t];
  return k === TILE.HOLE || k === TILE.HOLE_POSTER || k === TILE.HOLE_FAKE || k === TILE.FENCE_CUT || k === TILE.FENCE_FAKE;
}

/**
 * Where the player went off the trail (a placeKey; -1 none): a way through at its end; and where
 * they left the floor there (`off`), a shaft down or a grate up (open or behind a fake vent) on
 * or beside the tile. (A trail that ends with the player back in bounds leads nowhere.)
 */
function wayOff(w: World, at: number, off: boolean): number {
  if (passage(w, at)) return placeKey(LAYER.GROUND, at);
  if (!off) return -1;
  const x0 = at % MAP_W;
  const z0 = Math.floor(at / MAP_W);
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = x0 + dx;
      const z = z0 + dz;
      if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
      const t = z * MAP_W + x;
      if (w.ground.kind[t] === TILE.SHAFT) return placeKey(LAYER.GROUND, t);
      const v = w.layers[LAYER.VENTS].kind[t];
      if (v === TILE.GRATE_OPEN || v === TILE.GRATE_FAKE) return placeKey(LAYER.VENTS, t);
    }
  return -1;
}

/**
 * The trail's end (`end`, the dog at `from`): where it leads off the floor (a way through, down
 * or up) is damage found, cover or no cover: the alarm, and every guard told where. Otherwise
 * the scent stops there: lost.
 */
function trailEnd(sim: SimContext, k: number, g: Guard, end: number, from: number, off: boolean) {
  const s = sim.state;
  const key = wayOff(sim.world, end, off);
  // (With the player out cold or in solitary there's nobody to hunt: as the guards do then, it's left be.)
  if (key < 0 || s.found.includes(key) || sim.away) return lose(sim, k);
  s.found.push(key);
  sim.events.push({ type: 'found', kind: sim.world.layers[layerOfKey(key)].kind[tileOfKey(key)] });
  for (const o of s.guards) o.lastSeen = from;
  point(sim, k, g, 'dug', from);
  if (!s.lockdown) sim.events.push({ type: 'spotted', reason: 'dogFound' });
  addHeat(sim, 100);
}

/** Off the trail: back to the heel (what it followed is done with: only fresher scent sets it off again). */
function lose(sim: SimContext, k: number) {
  const d = sim.state.dogs[k];
  done(sim, d);
  d.rest = sim.state.step + TRAIL_REST;
  d.mode = DOG.HEEL;
  d.goal = -1;
  d.path = [];
  sim.events.push({ type: 'dog', dog: k, what: 'lost' });
}

/** The scent a dog has followed (up to the trail's newest now) won't set it off again. */
function done(sim: SimContext, d: Dog) {
  const s = sim.state;
  if (s.scent.length) d.trail = Math.max(d.trail, s.scent[s.scent.length - 1][1]);
}

/** Stands pointing and barking (at the player, or at where the trail led): the handler comes to look. */
function point(sim: SimContext, k: number, g: Guard, what: 'sniff' | 'point' | 'dug' | 'brew', at = -1) {
  const s = sim.state;
  const d = s.dogs[k];
  const b = d.body;
  const p = s.player;
  d.mode = DOG.POINT;
  d.timer = POINT_STEPS;
  d.goal = -1;
  d.path = [];
  b.moving = false;
  const look = at >= 0 ? at : tileAt(p.x, p.z);
  if (what !== 'sniff' && what !== 'brew') done(sim, d);
  if (at < 0 && (p.x !== b.x || p.z !== b.z)) b.facing = nearestDir(p.x - b.x, p.z - b.z);
  // (P28: at a brew, it faces the furniture.)
  if (what === 'brew' && at >= 0) b.facing = nearestDir(centerX(at) - b.x, centerZ(at) - b.z) || b.facing;
  sim.events.push({ type: 'dog', dog: k, what });
  makeNoise(sim, 'bark', LAYER.GROUND, tileAt(b.x, b.z), BARK_NOISE);
  if (awake(g)) sendToLook(g, look);
}

/**
 * Something thrown lands (noise.ts throwItem): by an awake dog (the nearest within TREAT_RANGE),
 * jerky is eaten (trust, once a day; a second one stays where it fell), pepper sets it sneezing
 * (and its sneezing loses the trail), sleepy jerky puts it to sleep. Returns whether the dog
 * took it (it's gone).
 */
export function catchTreat(sim: SimContext, item: number, tile: number): boolean {
  if ((item !== JERKY && item !== PEPPER && item !== SLEEPY) || sim.noDogs) return false;
  const s = sim.state;
  const x = centerX(tile);
  const z = centerZ(tile);
  let k = -1;
  let best = Infinity;
  const day = prisonDay(s.step);
  const reach = (d: Dog) => !dogAsleep(d, s.step) && dist(d.body, x, z) <= TREAT_RANGE && lineOfSight(sim.world, x, z, d.body.x, d.body.z);
  // (Jerky goes to the nearest dog that hasn't had its share today, if one is in reach.)
  const hungry = item === JERKY && s.dogs.some((d) => reach(d) && d.fed !== day);
  s.dogs.forEach((d, j) => {
    const dd = dist(d.body, x, z);
    // (Within reach of where it lands, nothing between: never round a corner.)
    if (reach(d) && dd < best && (!hungry || d.fed !== day)) {
      k = j;
      best = dd;
    }
  });
  if (k < 0) return false;
  const d = s.dogs[k];
  if (item === JERKY) {
    if (d.fed === day) {
      sim.events.push({ type: 'dog', dog: k, what: 'full', trust: d.trust });
      return false;
    }
    const was = d.trust;
    d.fed = day;
    d.trust = Math.min(TRUST_FRIEND, d.trust + TREAT_TRUST);
    sim.events.push({ type: 'dog', dog: k, what: 'fed', trust: d.trust });
    if (was < TRUST_FRIEND && d.trust >= TRUST_FRIEND) sim.events.push({ type: 'dog', dog: k, what: 'friend', trust: d.trust });
    return true;
  }
  if (d.mode === DOG.TRACK || d.mode === DOG.POINT || d.mode === DOG.RAT) d.mode = DOG.HEEL;
  d.goal = -1;
  d.path = [];
  d.body.moving = false;
  if (item === SLEEPY) {
    d.sleep = s.step + DOG_SLEEP_STEPS;
    d.daze = 0;
    sim.events.push({ type: 'dog', dog: k, what: 'asleep' });
    return true;
  }
  d.daze = s.step + DAZE_STEPS;
  const trail = washScent(sim, true);
  sim.events.push({ type: 'dog', dog: k, what: 'dazed', trail });
  makeNoise(sim, 'bark', LAYER.GROUND, tileAt(d.body.x, d.body.z), SNEEZE_NOISE);
  return true;
}

const TREATS: ReadonlySet<number> = new Set([JERKY, PEPPER, PILLS]);

/** What's for throwing to a dog: jerky, pepper, sleepy jerky. */
export const FOR_DOGS: ReadonlySet<number> = new Set([JERKY, PEPPER, SLEEPY]);

const treatAim: TossAim = { why: null, to: -1 };

/**
 * The dog the item in hand would be thrown to now (the tool button's "Throw to …"): the nearest
 * awake one the throw can reach, on its own tile; -1 none. Where it lands is `treatAim.to`.
 */
export function treatTarget(sim: SimContext): { dog: number; tile: number } | null {
  const s = sim.state;
  const p = s.player;
  const px = Math.floor(p.x / UNIT);
  const pz = Math.floor(p.z / UNIT);
  let best: { dog: number; tile: number } | null = null;
  let bestD = Infinity;
  s.dogs.forEach((d, k) => {
    if (dogAsleep(d, s.step)) return;
    const t = tileAt(d.body.x, d.body.z);
    const dd = (t % MAP_W - px) ** 2 + (Math.floor(t / MAP_W) - pz) ** 2;
    if (dd >= bestD) return;
    aimToss(sim, (t % MAP_W) - px, Math.floor(t / MAP_W) - pz, treatAim);
    if (treatAim.why || dist(d.body, centerX(treatAim.to), centerZ(treatAim.to)) > TREAT_RANGE) return;
    best = { dog: k, tile: t };
    bestD = dd;
  });
  return best;
}

/**
 * 08:00 at a prison with dogs (from day 2), after the restock: jerky and pepper on every
 * canteen counter, and sleeping pills in one inmate's desk (drawn with roll(): who has them is
 * known ahead, and true when told). A full container gives up its last ordinary item for it.
 */
export function treats(sim: SimContext) {
  const s = sim.state;
  if (!s.dogs.length || sim.noDogs || prisonDay(s.step) < dogsFrom(s)) return;
  const list = containersOf(sim.world);
  list.forEach((c, i) => {
    if (c.table !== 'canteenCounter') return;
    put(s.items.containers[i], c.hidden, JERKY, c.table);
    put(s.items.containers[i], c.hidden, PEPPER, c.table);
  });
  const desk = pillsDesk(sim);
  if (desk >= 0) put(s.items.containers[desk], list[desk].hidden, PILLS, list[desk].table);
  s.items.rev++;
}

/** The inmate desk (container index) a day's sleeping pills go into (-1: no dogs, no desks). */
export function pillsDesk(sim: SimContext, day = prisonDay(sim.state.step)): number {
  if (!sim.state.dogs.length) return -1;
  const desks: number[] = [];
  containersOf(sim.world).forEach((c, i) => c.table === 'inmateDesk' && desks.push(i));
  return desks.length ? desks[rollInt(sim.state.salt, SALT.TREATS, day, 0, desks.length)] : -1;
}

/** An item into a container's ordinary slots: a free one, else the last holding something its own table stocks (never what someone put there). */
function put(slots: number[], hidden: number, item: number, table: string) {
  if (slots.some((v) => itemOf(v) === item)) return;
  for (let k = hidden; k < slots.length; k++)
    if (!slots[k]) {
      slots[k] = slot(item);
      return;
    }
  const stocked = LOOT[table]?.items ?? [];
  for (let k = slots.length - 1; k >= hidden; k--)
    if (!TREATS.has(itemOf(slots[k])) && stocked.some(([id]) => itemNumber(id) === itemOf(slots[k]))) {
      slots[k] = slot(item);
      return;
    }
}

/** The nearest rat running (on an errand, coming back, loose) within `range` of a dog and in its sight; null none (P20). */
function ratSeen(sim: SimContext, b: Body, range: number): Rat | null {
  let best: Rat | null = null;
  let bestD = range;
  for (const r of sim.state.rats) {
    if (!ratOut(r)) continue;
    const dd = dist(b, r.x, r.z);
    if (dd <= bestD && lineOfSight(sim.world, b.x, b.z, r.x, r.z)) {
      best = r;
      bestD = dd;
    }
  }
  return best;
}

/** The first prison day the dogs work (P26: from day 1 on a Dog Day Daily). */
export const dogsFrom = (s: { readonly mods: readonly string[] }): number => (twist(s, 'dogDay') ? 1 : DOG_FIRST_DAY);
