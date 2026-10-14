import { DIR_X, DIR_Z } from '../command';
import { BODY_HALF, CORNER_ASSIST, UNIT, WALK_SPEED } from '../tuning';
import type { World } from '../world/World';

/** A walker's position (integer units, the middle of its square footprint) and heading. */
export interface Body {
  x: number;
  z: number;
  /** The last direction walked (1–16): the model faces it. */
  facing: number;
  moving: boolean;
}

const tile = (u: number) => Math.floor(u / UNIT);

/**
 * Moves one axis at a time against the blocked tiles, stopping flush with walls. When a
 * straight move is blocked on one side only (a door frame), the walker slides toward the
 * opening, so 1-tile doors are easy to hit with a thumb stick.
 */
function slide(w: World, b: Body, d: number, alongX: boolean, assist: boolean) {
  if (d === 0) return;
  const pos = alongX ? b.x : b.z;
  const side = alongX ? b.z : b.x;
  const a0 = tile(side - BODY_HALF);
  const a1 = tile(side + BODY_HALF - 1);
  const next = pos + d;
  const edge = d > 0 ? tile(next + BODY_HALF - 1) : tile(next - BODY_HALF);
  const at = (t: number) => (alongX ? w.blocked(edge, t) : w.blocked(t, edge));
  const b0 = at(a0);
  const b1 = a1 === a0 ? b0 : at(a1);
  if (!b0 && !b1) {
    if (alongX) b.x = next;
    else b.z = next;
    return;
  }
  const flush = d > 0 ? edge * UNIT - BODY_HALF : (edge + 1) * UNIT + BODY_HALF;
  if (alongX) b.x = flush;
  else b.z = flush;
  if (!assist || b0 === b1) return;
  // Only one side is blocked: ease toward the open row (never further than the gap needs).
  const need = b0 ? a1 * UNIT + BODY_HALF - side : a0 * UNIT + UNIT - BODY_HALF - side;
  if (Math.abs(need) > UNIT / 2) return;
  const shift = Math.sign(need) * Math.min(Math.abs(need), CORNER_ASSIST);
  if (alongX) b.z += shift;
  else b.x += shift;
}

/** Walks a body one step in a direction (0 = stand still). */
export function walk(w: World, b: Body, dir: number, speed = WALK_SPEED) {
  b.moving = dir !== 0;
  if (!dir) return;
  b.facing = dir;
  const dx = Math.trunc((DIR_X[dir] * speed) / 1024);
  const dz = Math.trunc((DIR_Z[dir] * speed) / 1024);
  slide(w, b, dx, true, dz === 0);
  slide(w, b, dz, false, dx === 0);
}

/** The tile a body stands on. */
export const tileOfBody = (b: Body) => ({ x: tile(b.x), z: tile(b.z) });

/** A body standing in the middle of a tile. */
export const bodyAt = (x: number, z: number, facing = 5): Body => ({ x: x * UNIT + UNIT / 2, z: z * UNIT + UNIT / 2, facing, moving: false });
