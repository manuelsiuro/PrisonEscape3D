/** The sports ground's running track (P31): pure geometry, shared by the sim, the render and the tests. */
import type { Ring } from './prisons/types';

/** The track's four corners, clockwise from its north-west one. */
export function cornersOf(r: Ring): Array<{ x: number; z: number }> {
  return [
    { x: r.x, z: r.z },
    { x: r.x + r.w - 1, z: r.z },
    { x: r.x + r.w - 1, z: r.z + r.d - 1 },
    { x: r.x, z: r.z + r.d - 1 },
  ];
}

/** Whether a tile is one of the track's lanes (the ring's edge tiles). */
export function onTrack(r: Ring, x: number, z: number): boolean {
  if (x < r.x || z < r.z || x >= r.x + r.w || z >= r.z + r.d) return false;
  return x === r.x || z === r.z || x === r.x + r.w - 1 || z === r.z + r.d - 1;
}
