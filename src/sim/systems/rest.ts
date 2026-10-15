import { UNIT } from '../tuning';
import { MAP_W, type World } from '../world/World';
import type { Body } from './movement';

/** Directions (as in `command.ts`): east, south, west, north. */
const EAST = 1;
const SOUTH = 5;
const WEST = 9;
const NORTH = 13;

/**
 * Where someone sits on a seat, bench or chair (GDD §3.1): the prop's tile nearest to them,
 * and the way they face: a canteen seat or a chair faces the table, desk or counter beside it,
 * a bench faces the way it's turned. The view seats the character there; the sim only keeps
 * which prop (the body stays where it stood, beside or on it).
 */
export function seatSpot(w: World, index: number, b: Body): { x: number; z: number; facing: number } {
  const p = w.props[index];
  const tx = Math.min(p.x + p.w - 1, Math.max(p.x, Math.floor(b.x / UNIT)));
  const tz = Math.min(p.z + p.d - 1, Math.max(p.z, Math.floor(b.z / UNIT)));
  return { x: tx, z: tz, facing: facingAt(w, p, tx, tz) };
}

/** The way a seat at (x, z) faces: towards the furniture it serves, else by its turn. */
export function facingAt(w: World, p: World['props'][number], x: number, z: number): number {
  const at = (dx: number, dz: number) => {
    const i = (z + dz) * MAP_W + x + dx;
    const q = w.props.find((o) => o !== p && SERVED.has(o.kind) && o.x <= i % MAP_W && i % MAP_W < o.x + o.w && o.z <= Math.floor(i / MAP_W) && Math.floor(i / MAP_W) < o.z + o.d);
    return !!q;
  };
  if (at(0, -1)) return NORTH;
  if (at(0, 1)) return SOUTH;
  if (at(1, 0)) return EAST;
  if (at(-1, 0)) return WEST;
  // A bench: turned 0 faces south (its back to the north), 1 east, 2 north, 3 west.
  return p.rot === 2 ? NORTH : p.rot === 1 ? EAST : p.rot === 3 ? WEST : SOUTH;
}

/** What a seat can face. */
const SERVED = new Set(['table', 'desk', 'counter', 'controlDesk', 'sortingDesk']);

/** Whether someone is still at a prop (sitting, resting): within reach of its footprint. */
export function atProp(w: World, index: number, b: Body, reach: number): boolean {
  const p = w.props[index];
  const dx = Math.max(p.x * UNIT - b.x, 0, b.x - (p.x + p.w) * UNIT);
  const dz = Math.max(p.z * UNIT - b.z, 0, b.z - (p.z + p.d) * UNIT);
  return Math.max(dx, dz) <= reach;
}
