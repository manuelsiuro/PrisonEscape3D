import { box, cyl, type Part } from '../../render/kit';
import { mix32 } from '../../sim/rng';
import { MAP_H, MAP_W } from '../../sim/world/grid';
import type { District } from '../gen/district';

/**
 * What a street is furnished with (2.57): lamp posts along the kerbs, their heads out over the road and
 * dark (the power went with the people), a dead traffic light at each corner of a junction, a hydrant
 * here and there. Thin things on the pavement's very edge, drawn only: nobody is stopped by one, and none
 * stands before a door, on what the generator put down, or in a checkpoint's way. Hashed from the tile.
 */
const IRON = 0x444a52;
const DARK = 0x23272c;

/** A lamp post, its arm out along +z. */
function lamp(h: number): Part[] {
  const out = [
    box(0.16, 0.22, 0.16, IRON, 0, 0, 0),
    cyl(0.04, 2.3, IRON, 0, 0, 0, 6),
    box(0.05, 0.05, 0.62, IRON, 0, 2.26, 0.28),
    box(0.2, 0.07, 0.3, DARK, 0, 2.2, 0.56),
    box(0.14, 0.02, 0.22, 0xb9c0c6, 0, 2.185, 0.56),
  ];
  // (One in seven leans: something drove into it.)
  if (h % 7 === 0) for (const p of out) p.rotateX(0.14 + ((h >> 4) & 3) * 0.03);
  return out;
}
/** A traffic light: its head facing +z, its three lamps out. */
function signal(): Part[] {
  return [
    box(0.14, 0.18, 0.14, IRON, 0, 0, 0),
    cyl(0.04, 1.75, IRON, 0, 0, 0, 6),
    box(0.2, 0.5, 0.16, DARK, 0, 1.55, 0.02),
    box(0.26, 0.04, 0.2, DARK, 0, 2.05, 0.04),
    box(0.1, 0.1, 0.02, 0x4a1c18, 0, 1.9, 0.11),
    box(0.1, 0.1, 0.02, 0x4a3a16, 0, 1.75, 0.11),
    box(0.1, 0.1, 0.02, 0x163a22, 0, 1.6, 0.11),
  ];
}
function hydrant(): Part[] {
  return [
    cyl(0.09, 0.3, 0xa83a30, 0, 0, 0, 8),
    cyl(0.11, 0.05, 0x8a2e26, 0, 0.3, 0, 8),
    cyl(0.06, 0.06, 0xa83a30, 0, 0.35, 0, 6),
    box(0.3, 0.07, 0.07, 0x8a2e26, 0, 0.17, 0),
  ];
}

export interface StreetThing {
  kind: 'lamp' | 'signal' | 'hydrant';
  /** The pavement tile it stands on, and where on it (tiles). */
  tile: number;
  x: number;
  z: number;
  angle: number;
  hash: number;
}

/** Where each stands (pure: the test reads it). */
export function streetPlan(district: District): StreetThing[] {
  const out: StreetThing[] = [];
  const at = (x: number, z: number) => (x >= 0 && z >= 0 && x < MAP_W && z < MAP_H ? district.rows[z][x] : ' ');
  const road = (x: number, z: number) => at(x, z) === ',';
  const SIDES = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ] as const;
  for (let z = 2; z < MAP_H - 2; z++)
    for (let x = 2; x < MAP_W - 2; x++) {
      const i = z * MAP_W + x;
      if (at(x, z) !== 'a' || district.deco[i] || district.lotAt[i]) continue;
      // (Clear of every door's step.)
      if (SIDES.some(([dx, dz]) => at(x + dx, z + dz) === 'y')) continue;
      const beside = SIDES.filter(([dx, dz]) => road(x + dx, z + dz));
      const hash = mix32(Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(district.index + 5, 0x85ebca6b));
      if (beside.length === 2 && beside[0][0] !== beside[1][0] && beside[0][1] !== beside[1][1]) {
        // A block's corner on a junction: a signal on its point, facing back down the street it stops.
        const dx = beside[0][0] + beside[1][0];
        const dz = beside[0][1] + beside[1][1];
        if (dx > 0 === dz > 0)
          out.push({ kind: 'signal', tile: i, x: x + 0.5 + dx * 0.4, z: z + 0.5 + dz * 0.4, angle: dz > 0 ? Math.PI : 0, hash });
        continue;
      }
      if (beside.length !== 1) continue;
      const [dx, dz] = beside[0];
      const along = dx ? z : x;
      // (A lamp every eight tiles, the two kerbs out of step; a hydrant now and then between them.)
      if ((along + (dx + dz > 0 ? 3 : 0)) % 8 === 2)
        out.push({ kind: 'lamp', tile: i, x: x + 0.5 + dx * 0.42, z: z + 0.5 + dz * 0.42, angle: Math.atan2(dx, dz), hash });
      else if (hash % 37 === 0)
        out.push({ kind: 'hydrant', tile: i, x: x + 0.5 + dx * 0.36, z: z + 0.5 + dz * 0.36, angle: dx ? Math.PI / 2 : 0, hash });
    }
  return out;
}

export function streetParts(district: District): Part[] {
  const parts: Part[] = [];
  for (const t of streetPlan(district)) {
    for (const p of t.kind === 'lamp' ? lamp(t.hash) : t.kind === 'signal' ? signal() : hydrant()) {
      if (t.angle) p.rotateY(t.angle);
      p.translate(t.x, 0, t.z);
      parts.push(p);
    }
  }
  return parts;
}
