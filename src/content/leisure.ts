import type { Court } from './prisons/types';

/**
 * A hoop's court (P27): the rim over the floor tile (x, z), facing into the court (1 east, 5
 * south, 9 west, 13 north): the prison's decor has its hoop there, turned the same way (cardstest
 * checks). Its five spots in shooting order: from the near left round to the
 * near right, a tile out at the sides and four at the top of the key (maptest checks every spot
 * is open yard floor in sight of the rim).
 */
export function court(x: number, z: number, face: 1 | 5 | 9 | 13): Court {
  // Into the court (a) and across it (s), as tile offsets.
  const [ax, az] = face === 1 ? [1, 0] : face === 5 ? [0, 1] : face === 9 ? [-1, 0] : [0, -1];
  const [sx, sz] = [-az, ax];
  const at = (a: number, s: number) => ({ x: x + ax * a + sx * s, z: z + az * a + sz * s });
  return { x, z, face, spots: [at(1, -2), at(3, -1), at(4, 0), at(3, 1), at(1, 2)] };
}
