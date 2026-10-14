import type { PropPlacement } from '../../props';
import type { PrisonDef, Rect } from '../types';
import { L0 } from './L0.map';

/** Cells: four on top (doors south), four below (doors north). Cell 1 is the player's. */
const cells: Rect[] = [];
const props: PropPlacement[] = [];
for (const top of [true, false]) {
  for (let k = 0; k < 4; k++) {
    const x0 = 7 + k * 5;
    const z0 = top ? 7 : 16;
    cells.push([x0, z0, x0 + 3, z0 + 3]);
    props.push(
      { kind: 'bed', x: x0, z: top ? z0 : z0 + 2, d: 2, rot: top ? 0 : 2 },
      { kind: 'desk', x: x0 + 3, z: top ? z0 : z0 + 3, rot: 3 },
      { kind: 'toilet', x: x0 + 3, z: top ? z0 + 3 : z0, rot: 3 },
    );
  }
}

props.push(
  // Canteen: rows of tables either side of the entrance, the serving counter at the back.
  ...[9, 12, 15, 18].flatMap((z) => [
    { kind: 'table', x: 41, z, w: 3 } as const,
    { kind: 'table', x: 46, z, w: 3 } as const,
  ]),
  { kind: 'counter', x: 51, z: 9, w: 5 },
  // Kitchen.
  { kind: 'oven', x: 50, z: 19, rot: 2 },
  { kind: 'oven', x: 51, z: 19, rot: 2 },
  { kind: 'freezer', x: 56, z: 16, d: 2, rot: 3 },
  { kind: 'counter', x: 53, z: 19, w: 3, rot: 2 },
  // Corridor.
  { kind: 'jobBoard', x: 27, z: 21 },
  // Gym.
  { kind: 'treadmill', x: 13, z: 25, d: 2 },
  { kind: 'treadmill', x: 13, z: 28, d: 2 },
  { kind: 'weights', x: 7, z: 28 },
  { kind: 'weights', x: 9, z: 28 },
  // Infirmary.
  { kind: 'bed', x: 7, z: 31, d: 2 },
  { kind: 'bed', x: 9, z: 31, d: 2 },
  { kind: 'bed', x: 12, z: 31, d: 2 },
  // Showers.
  ...[16, 18, 20, 22].map((x) => ({ kind: 'shower', x, z: 28, rot: 2 }) as const),
  // Library.
  { kind: 'shelf', x: 16, z: 30, w: 3 },
  { kind: 'shelf', x: 20, z: 30, w: 3 },
  { kind: 'table', x: 16, z: 32, w: 2 },
  { kind: 'table', x: 21, z: 32, w: 2 },
  // Woodshop.
  { kind: 'workbench', x: 40, z: 27, w: 2 },
  { kind: 'workbench', x: 46, z: 27, w: 2 },
  { kind: 'bin', x: 39, z: 29 },
  { kind: 'bin', x: 48, z: 29 },
  // Laundry.
  { kind: 'washer', x: 50, z: 25 },
  { kind: 'washer', x: 51, z: 25 },
  { kind: 'washer', x: 55, z: 25 },
  { kind: 'washer', x: 56, z: 25 },
  { kind: 'bin', x: 50, z: 29 },
  { kind: 'bin', x: 56, z: 29 },
  // Mailroom and janitor's closet.
  { kind: 'sortingDesk', x: 40, z: 31, w: 3 },
  { kind: 'sortingDesk', x: 45, z: 31, w: 3 },
  { kind: 'shelf', x: 50, z: 31, w: 2 },
  { kind: 'bin', x: 56, z: 31 },
  // Generator room.
  { kind: 'generator', x: 7, z: 42, w: 2, d: 2 },
  // Solitary.
  { kind: 'bed', x: 16, z: 43, d: 2, rot: 2 },
  { kind: 'bed', x: 22, z: 43, d: 2, rot: 2 },
  // Visitation.
  { kind: 'counter', x: 26, z: 41, w: 4 },
  { kind: 'counter', x: 32, z: 41, w: 4 },
  // Guard quarters and control room.
  { kind: 'bed', x: 39, z: 43, d: 2, rot: 2 },
  { kind: 'bed', x: 41, z: 43, d: 2, rot: 2 },
  { kind: 'bed', x: 46, z: 43, d: 2, rot: 2 },
  { kind: 'bed', x: 48, z: 43, d: 2, rot: 2 },
  { kind: 'table', x: 39, z: 40, w: 2 },
  { kind: 'controlDesk', x: 56, z: 40, d: 3, rot: 3 },
  // Courtyard benches.
  { kind: 'bench', x: 26, z: 27, w: 2 },
  { kind: 'bench', x: 34, z: 27, w: 2 },
  { kind: 'bench', x: 26, z: 32, w: 2, rot: 2 },
  { kind: 'bench', x: 34, z: 32, w: 2, rot: 2 },
  // Lamps: the yards' corners, the perimeter ring and the south yard.
  ...[
    [27, 7],
    [38, 7],
    [24, 25],
    [37, 25],
    [24, 34],
    [37, 34],
    ...[9, 21, 33, 43].flatMap((z) => [
      [4, z],
      [59, z],
    ]),
    ...[14, 26, 38, 50].map((x) => [x, 4]),
    [28, 49],
    [33, 49],
    [28, 56],
    [33, 56],
  ].map(([x, z]) => ({ kind: 'lamp', x, z }) as const),
);

/** Two rows of four, facing the guard at the north end. */
const rollCall = [12, 15].flatMap((z) => [29, 31, 34, 36].map((x) => ({ x, z })));

/** Level 1: minimum security, suburban (GDD §4.1). */
export const CENTER_PERKS: PrisonDef = {
  id: 'center-perks',
  difficulty: 1,
  ground: L0,
  zones: [
    ['cellBlock', 7, 7, 25, 19],
    ['rollCall', 27, 7, 38, 19],
    ['rollCall', 31, 20, 34, 20],
    ['canteen', 40, 7, 56, 13],
    ['canteen', 40, 14, 48, 19],
    ['canteen', 44, 20, 45, 20],
    ['kitchen', 50, 15, 56, 19],
    ['corridor', 7, 21, 56, 23],
    ['corridor', 7, 36, 56, 37],
    ['gym', 7, 25, 14, 29],
    ['infirmary', 7, 31, 14, 34],
    ['showers', 16, 25, 22, 28],
    ['library', 16, 30, 22, 34],
    ['yard', 24, 24, 37, 35],
    ['woodshop', 39, 25, 48, 29],
    ['woodshop', 43, 24, 44, 24],
    ['laundry', 50, 25, 56, 29],
    ['mailroom', 39, 31, 48, 34],
    ['janitor', 50, 31, 56, 34],
    ['generator', 7, 39, 14, 44],
    ['solitary', 16, 39, 22, 44],
    ['visitation', 24, 38, 37, 44],
    ['guardQuarters', 39, 39, 48, 44],
    ['controlRoom', 50, 39, 56, 44],
  ],
  cells,
  props,
  rollCall,
  spawn: { x: 9, z: 9 },
  reachable: ['cellBlock', 'rollCall', 'canteen', 'corridor', 'gym', 'showers', 'library', 'infirmary', 'yard', 'woodshop', 'visitation'],
};
