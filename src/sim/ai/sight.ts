import { DIR_X, DIR_Z } from '../command';
import type { Body } from '../systems/movement';
import { UNIT } from '../tuning';
import { TILE, TILE_INFO } from '../world/tiles';
import { MAP_H, MAP_W, type World } from '../world/World';

/** How far a guard sees (units): 7 tiles. */
export const SIGHT_RANGE = 7 * UNIT;
/** The cone's half angle: 30° each side of the heading, a 60° cone (GDD §5.1). */
export const SIGHT_HALF_ANGLE = Math.PI / 6;
/** Closer than this (units) a guard notices you whichever way it faces: you're touching it. */
export const SIGHT_TOUCH = Math.round(UNIT * 0.9);

/** Whether a tile stops sight: walls, doors while shut (open doors are see-through; a key in the player's pocket opens nothing to the eye), the delivery's vehicle (P18). */
export function sightBlocked(w: World, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) return true;
  const i = z * MAP_W + x;
  if (w.parked[i]) return true;
  const k = w.ground.kind[i];
  if (k === TILE.DOOR) return w.doorShut[i] === 1;
  return TILE_INFO[k].opaque;
}

/** Sample spacing along a sight line (units). */
const STEP = UNIT / 8;

/**
 * Whether nothing blocks the straight line between two points (units). The tile the line
 * starts on never blocks (a guard standing in a doorway sees out of it), and a line can't
 * slip between two walls that touch at a corner.
 */
export function lineOfSight(w: World, ax: number, az: number, bx: number, bz: number): boolean {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(bz - az)) / STEP));
  let px = Math.floor(ax / UNIT);
  let pz = Math.floor(az / UNIT);
  for (let k = 1; k <= n; k++) {
    const tx = Math.floor((ax + Math.trunc(((bx - ax) * k) / n)) / UNIT);
    const tz = Math.floor((az + Math.trunc(((bz - az) * k) / n)) / UNIT);
    if (tx === px && tz === pz) continue;
    if (sightBlocked(w, tx, tz)) return false;
    if (tx !== px && tz !== pz && sightBlocked(w, px, tz) && sightBlocked(w, tx, pz)) return false;
    px = tx;
    pz = tz;
  }
  return true;
}

/**
 * Whether a watcher facing its heading sees a point (a body, a hole in a wall): inside the
 * 60° cone and the range with a clear line, or touching. Integer math only (the comparisons are squared), so it is the
 * same on every platform.
 */
export function canSee(w: World, eye: Body, target: { x: number; z: number }, range = SIGHT_RANGE, walls = true): boolean {
  const dx = target.x - eye.x;
  const dz = target.z - eye.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > range * range) return false;
  if (d2 > SIGHT_TOUCH * SIGHT_TOUCH) {
    const fx = DIR_X[eye.facing];
    const fz = DIR_Z[eye.facing];
    const dot = fx * dx + fz * dz;
    // cos² 30° = 3/4.
    if (dot <= 0 || 4 * dot * dot < 3 * (fx * fx + fz * fz) * d2) return false;
  }
  // Without `walls` (someone up on a roof, seen from the open yard) nothing on the ground is in the way.
  return !walls || lineOfSight(w, eye.x, eye.z, target.x, target.z);
}

/**
 * How far sight reaches from a point along an angle (tiles), up to the range: the renderer
 * draws the cones with it, so they show exactly what the rules see. Angles: 0 = +x, π/2 = +z.
 */
export function sightReach(w: World, x: number, z: number, angle: number, range = SIGHT_RANGE / UNIT): number {
  const cx = Math.cos(angle);
  const cz = Math.sin(angle);
  const step = 1 / 8;
  let px = Math.floor(x);
  let pz = Math.floor(z);
  for (let d = step; d <= range; d += step) {
    const tx = Math.floor(x + cx * d);
    const tz = Math.floor(z + cz * d);
    if (tx === px && tz === pz) continue;
    if (sightBlocked(w, tx, tz) || (tx !== px && tz !== pz && sightBlocked(w, px, tz) && sightBlocked(w, tx, pz))) return d;
    px = tx;
    pz = tz;
  }
  return range;
}
