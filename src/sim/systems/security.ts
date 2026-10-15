import { DIRS } from '../command';
import { BEAM_RADIUS, BEAM_SPEED, CAMERA_RANGE, CAMERA_TURN_STEPS, SNIPER_RANGE, UNIT } from '../tuning';
import { canSee } from '../ai/sight';
import { TILE, TILE_INFO } from '../world/tiles';
import { LAYER, MAP_H, MAP_W, type World } from '../world/World';
import type { Body } from './movement';

/**
 * Security (GDD §5.4–5.6): cameras sweeping their corners, searchlights sweeping the yards
 * at night, snipers in the towers by day. Pure functions of the world and the step: the
 * simulation applies the rules, the renderer draws the same sweeps.
 */

/** A camera's sweep: a sixteenth of a turn at a time, out to ±45° and back. */
const SWEEP = [0, 1, 2, 1, 0, -1, -2, -1];

/** Turns a direction (1–16) by n sixteenths. */
const turn = (d: number, n: number) => ((((d - 1 + n) % DIRS) + DIRS) % DIRS) + 1;

/** Where camera k looks at a step (1–16); cameras are out of step with each other. */
export function cameraFacing(face: number, k: number, step: number): number {
  return turn(face, SWEEP[Math.floor((step + k * 97) / CAMERA_TURN_STEPS) % SWEEP.length]);
}

/**
 * The same sweep as a continuous angle offset (sixteenths, fractional) for the renderer: it
 * eases between the sim's headings.
 */
export function cameraSweep(k: number, step: number): number {
  const t = (step + k * 97) / CAMERA_TURN_STEPS;
  const i = Math.floor(t);
  const f = t - i;
  const a = SWEEP[i % SWEEP.length];
  const b = SWEEP[(i + 1) % SWEEP.length];
  // Turn in the last quarter of each hold, so it reads as a pause then a pan.
  const e = f < 0.75 ? 0 : (f - 0.75) * 4;
  return a + (b - a) * e * e * (3 - 2 * e);
}

/** The eye of camera k (reused body), looking its way at this step. */
const eye: Body = { x: 0, z: 0, facing: 1, moving: false };
export function cameraEye(cam: { x: number; z: number; face: number }, k: number, step: number): Body {
  eye.x = cam.x * UNIT + UNIT / 2;
  eye.z = cam.z * UNIT + UNIT / 2;
  eye.facing = cameraFacing(cam.face, k, step);
  return eye;
}

/** Whether camera k sees a point on the ground floor (its cone, its range, walls and shut doors in the way). */
export function cameraSees(w: World, cam: { x: number; z: number; face: number }, k: number, step: number, at: { x: number; z: number }): boolean {
  return canSee(w, cameraEye(cam, k, step), at, CAMERA_RANGE);
}

/** Lengths of a searchlight's legs (units), cached per path. */
const legsOf = new WeakMap<object, number[]>();
function legs(path: ReadonlyArray<{ x: number; z: number }>): number[] {
  let l = legsOf.get(path);
  if (!l) {
    l = [];
    // Math.sqrt is exactly rounded everywhere (Math.hypot need not be).
    for (let k = 1; k < path.length; k++) l.push(Math.round(Math.sqrt((path[k].x - path[k - 1].x) ** 2 + (path[k].z - path[k - 1].z) ** 2) * UNIT));
    legsOf.set(path, l);
  }
  return l;
}

/**
 * Where a searchlight's beam is at a step (units, the middle of its pool): it runs along its
 * path and back at BEAM_SPEED. Integer math, so the same on every platform. `out` is filled.
 */
export function beamAt(path: ReadonlyArray<{ x: number; z: number }>, step: number, out: { x: number; z: number }): { x: number; z: number } {
  const l = legs(path);
  const total = l.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    out.x = path[0].x * UNIT + UNIT / 2;
    out.z = path[0].z * UNIT + UNIT / 2;
    return out;
  }
  let d = (step * BEAM_SPEED) % (2 * total);
  if (d > total) d = 2 * total - d;
  let k = 0;
  while (k < l.length - 1 && d > l[k]) d -= l[k++];
  const a = path[k];
  const b = path[k + 1];
  const f = l[k] ? d / l[k] : 0;
  out.x = Math.round((a.x + (b.x - a.x) * f) * UNIT) + UNIT / 2;
  out.z = Math.round((a.z + (b.z - a.z) * f) * UNIT) + UNIT / 2;
  return out;
}

const beam = { x: 0, z: 0 };
/** Whether a body on the ground floor stands in a searchlight's pool (outdoors only: roofs and rooms are never swept). */
export function inBeam(w: World, b: Body, step: number): number {
  const lights = w.def.searchlights ?? [];
  const t = Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);
  if (!TILE_INFO[w.ground.kind[t]].outdoor) return -1;
  for (let k = 0; k < lights.length; k++) {
    beamAt(lights[k], step, beam);
    if ((beam.x - b.x) ** 2 + (beam.z - b.z) ** 2 <= BEAM_RADIUS * BEAM_RADIUS) return k;
  }
  return -1;
}

/** The middle of each watchtower (units): a block of tower tiles on the map. Cached per world. */
const towersOf = new WeakMap<World, Array<{ x: number; z: number }>>();
export function towers(w: World): ReadonlyArray<{ x: number; z: number }> {
  let list = towersOf.get(w);
  if (list) return list;
  list = [];
  const k = w.ground.kind;
  for (let z = 0; z < MAP_H; z++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = z * MAP_W + x;
      if (k[i] !== TILE.TOWER || (x > 0 && k[i - 1] === TILE.TOWER) || (z > 0 && k[i - MAP_W] === TILE.TOWER)) continue;
      let wd = 1;
      while (x + wd < MAP_W && k[i + wd] === TILE.TOWER) wd++;
      let dp = 1;
      while (z + dp < MAP_H && k[i + dp * MAP_W] === TILE.TOWER) dp++;
      list.push({ x: Math.round((x + wd / 2) * UNIT), z: Math.round((z + dp / 2) * UNIT) });
    }
  }
  towersOf.set(w, list);
  return list;
}

/**
 * Which tower's sniper has the player in its sights (-1: none): out in the open (outdoor
 * ground, or up on a roof) within range of a tower. From up there nothing on the ground is in the way.
 */
export function sniperOn(w: World, b: Body, layer: number): number {
  if (layer === LAYER.GROUND) {
    const t = Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);
    if (!TILE_INFO[w.ground.kind[t]].outdoor || w.ground.kind[t] === TILE.ROAD) return -1;
  } else if (layer !== LAYER.ROOF) return -1;
  const list = towers(w);
  let best = -1;
  let bestD = SNIPER_RANGE * SNIPER_RANGE;
  list.forEach((t, k) => {
    const d = (t.x - b.x) ** 2 + (t.z - b.z) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = k;
    }
  });
  return best;
}
