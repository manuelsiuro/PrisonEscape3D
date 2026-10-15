import type { PropPlacement } from '../../props';
import type { GuardDef, PrisonDef, Rect } from '../types';
import { L0 } from './L0.map';
import { SAN_PANCHO_DECOR } from './decor';

/**
 * Cells: two wings of seven, each a hall between two columns of cells; the column on the
 * plaza side has three and a vestibule out onto the plaza. Cells whose door is on their east
 * wall have the desk and the toilet against it, the others mirror them. Cell 1, the
 * player's, is the west wing's first (north-west corner, against the compound wall).
 */
const cells: Rect[] = [];
const props: PropPlacement[] = [];
const cell = (x0: number, z0: number, doorEast: boolean) => {
  cells.push([x0, z0, x0 + 3, z0 + 3]);
  props.push(
    ...(doorEast
      ? [
          { kind: 'bed', x: x0, z: z0, d: 2 },
          { kind: 'desk', x: x0 + 3, z: z0, rot: 3 },
          { kind: 'toilet', x: x0 + 3, z: z0 + 3, rot: 3 },
          { kind: 'chair', x: x0 + 2, z: z0, rot: 1 },
        ]
      : [
          { kind: 'bed', x: x0 + 3, z: z0, d: 2 },
          { kind: 'desk', x: x0, z: z0, rot: 1 },
          { kind: 'toilet', x: x0, z: z0 + 3, rot: 1 },
          { kind: 'chair', x: x0 + 1, z: z0, rot: 3 },
        ]) as PropPlacement[],
  );
};
for (const z0 of [12, 17, 22, 27]) cell(12, z0, true);
for (const z0 of [12, 17, 22]) cell(22, z0, false);
for (const z0 of [12, 17, 22]) cell(38, z0, true);
for (const z0 of [12, 17, 22, 27]) cell(48, z0, false);

props.push(
  // Kitchen: the freezer, two ovens, the counter the meals go out on.
  { kind: 'freezer', x: 12, z: 32, d: 2, rot: 1 },
  { kind: 'oven', x: 12, z: 40, rot: 2 },
  { kind: 'oven', x: 13, z: 40, rot: 2 },
  { kind: 'counter', x: 15, z: 38, d: 3, rot: 3 },
  // Canteen: four tables, benches either side, the serving counter by the kitchen; aisles
  // between and along the plaza side, so the whole compound files in through the wide door.
  ...[34, 38].flatMap((z) =>
    [19, 22].flatMap((x) => [
      { kind: 'table', x, z, w: 2 } as const,
      { kind: 'seat', x, z: z - 1, w: 2 } as const,
      { kind: 'seat', x, z: z + 1, w: 2, rot: 2 } as const,
    ]),
  ),
  { kind: 'counter', x: 17, z: 36, d: 3, rot: 1 },
  // Woodshop (behind its detector arch): the timber bin, two benches, the output bin.
  { kind: 'bin', x: 12, z: 43 },
  { kind: 'workbench', x: 13, z: 47, w: 2 },
  { kind: 'workbench', x: 16, z: 47, w: 2 },
  { kind: 'bin', x: 18, z: 51 },
  // Metalshop (behind its own): the metal bin, two presses, the output bin.
  { kind: 'bin', x: 20, z: 43 },
  { kind: 'press', x: 20, z: 47, w: 2 },
  { kind: 'press', x: 24, z: 47, w: 2 },
  { kind: 'bin', x: 25, z: 51 },
  // Laundry: the dirty bin, three washers along the west wall, the clean bin.
  { kind: 'bin', x: 29, z: 12 },
  { kind: 'washer', x: 27, z: 13, rot: 1 },
  { kind: 'washer', x: 27, z: 15, rot: 1 },
  { kind: 'washer', x: 27, z: 17, rot: 1 },
  { kind: 'bin', x: 29, z: 18 },
  // Janitor's closet.
  { kind: 'bin', x: 31, z: 12 },
  { kind: 'shelf', x: 32, z: 12 },
  // Mailroom: two sorting desks either side of the aisle, the outgoing shelf.
  { kind: 'sortingDesk', x: 34, z: 14, d: 3, rot: 1 },
  { kind: 'sortingDesk', x: 36, z: 14, d: 3, rot: 3 },
  { kind: 'shelf', x: 35, z: 12, rot: 0 },
  // Gym: treadmills, weights, the job board.
  { kind: 'treadmill', x: 39, z: 32, d: 2 },
  { kind: 'treadmill', x: 41, z: 32, d: 2 },
  { kind: 'weights', x: 40, z: 39 },
  { kind: 'weights', x: 43, z: 39 },
  { kind: 'jobBoard', x: 45, z: 33, rot: 3 },
  // Showers: heads along the north and south walls.
  ...[47, 48, 49, 50, 51].flatMap((x) => [{ kind: 'shower', x, z: 32 } as const, { kind: 'shower', x, z: 40, rot: 2 } as const]),
  // Library.
  { kind: 'shelf', x: 38, z: 42, w: 3 },
  { kind: 'shelf', x: 42, z: 42, w: 3 },
  { kind: 'table', x: 39, z: 44, w: 2 },
  { kind: 'table', x: 42, z: 44, w: 2 },
  ...[39, 40, 42, 43].map((x) => ({ kind: 'chair', x, z: 45, rot: 2 }) as const),
  // Infirmary.
  { kind: 'bed', x: 47, z: 42, d: 2 },
  { kind: 'bed', x: 49, z: 42, d: 2 },
  { kind: 'bed', x: 51, z: 42, d: 2 },
  // The generator.
  { kind: 'generator', x: 39, z: 49, w: 2, d: 2 },
  // Guard quarters: four bunks, a table.
  ...[45, 46, 50, 51].map((x) => ({ kind: 'bed', x, z: 48, d: 2 }) as const),
  { kind: 'table', x: 47, z: 51, w: 2 },
  // Solitary.
  { kind: 'bed', x: 27, z: 45, d: 2 },
  { kind: 'bed', x: 27, z: 50, d: 2, rot: 2 },
  // The control room, on the supply road out.
  { kind: 'controlDesk', x: 36, z: 46, d: 3, rot: 3 },
  { kind: 'chair', x: 35, z: 47, rot: 1 },
  // The plaza: benches along its sides, lamps at its corners.
  { kind: 'bench', x: 27, z: 36, d: 2, rot: 1 },
  { kind: 'bench', x: 36, z: 36, d: 2, rot: 3 },
  { kind: 'bench', x: 27, z: 40, d: 2, rot: 1 },
  { kind: 'bench', x: 36, z: 40, d: 2, rot: 3 },
  ...[
    [27, 22],
    [36, 22],
    [27, 43],
    [36, 43],
  ].map(([x, z]) => ({ kind: 'lamp', x, z }) as const),
);

/** Two rows of seven at the plaza's north end, facing the warden. */
const rollCall = [27, 29].flatMap((z) => [28, 29, 30, 31, 32, 33, 34].map((x) => ({ x, z })));

/**
 * Eight guards (GDD §4.4: a lawless interior, an armed perimeter). Directions: 1 east,
 * 5 south, 9 west, 13 north.
 * - The warden keeps to the control room, comes out for roll call, and at night walks both
 *   wings' halls and does the bed checks.
 * - The sweeper is the one guard who walks the compound: through both wings, the canteen,
 *   the workshops, the plaza, the gym and the library, then a long sit in the control room;
 *   it searches the cells at the morning shakedown.
 * - Four guards walk the walkway between the compound and the inner wall, one side each,
 *   day and night.
 * - The gate guard keeps the supply road: the control room, the walkway by it, the corridor
 *   through the mines.
 * - The staff guard walks the generator room, the quarters, the infirmary and the library.
 * The sweeper and the staff guard sleep in the quarters at night.
 * Keys (GDD §10.2): the warden and the gate guard red (the supply road, solitary, the
 * quarters), the sweeper green (the outer gate), the north and south walkway guards yellow
 * and purple, the east and west cyan, the staff guard purple (the generator room).
 */
const guards: GuardDef[] = [
  {
    beat: [
      { x: 34, z: 48, wait: 20, face: 9 },
      { x: 31, z: 41, wait: 4, face: 13 },
    ],
    posts: { rollCall: { x: 31, z: 25, face: 5 }, eveningRollCall: { x: 31, z: 25, face: 5 } },
    night: [
      { x: 18, z: 13, wait: 4, face: 5 },
      { x: 19, z: 29, wait: 3, face: 13 },
      { x: 44, z: 29, wait: 3, face: 13 },
      { x: 45, z: 13, wait: 4, face: 5 },
    ],
    duties: ['bedCheck'],
    key: 'red',
  },
  {
    beat: [
      { x: 18, z: 14, wait: 3, face: 5 },
      { x: 23, z: 29, wait: 2, face: 1 },
      { x: 21, z: 36, wait: 3, face: 9 },
      { x: 16, z: 49, wait: 3, face: 13 },
      { x: 32, z: 33, wait: 3, face: 5 },
      { x: 44, z: 14, wait: 3, face: 5 },
      { x: 41, z: 36, wait: 3, face: 1 },
      { x: 41, z: 44, wait: 3, face: 5 },
      { x: 33, z: 49, wait: 40, face: 13 },
    ],
    duties: ['shakedown'],
    key: 'green',
  },
  {
    beat: [
      { x: 10, z: 10, wait: 4, face: 1 },
      { x: 53, z: 9, wait: 4, face: 9 },
    ],
    night: [
      { x: 10, z: 10, wait: 4, face: 1 },
      { x: 53, z: 9, wait: 4, face: 9 },
    ],
    key: 'yellow',
  },
  {
    beat: [
      { x: 53, z: 10, wait: 4, face: 5 },
      { x: 54, z: 53, wait: 4, face: 13 },
    ],
    night: [
      { x: 53, z: 10, wait: 4, face: 5 },
      { x: 54, z: 53, wait: 4, face: 13 },
    ],
    key: 'cyan',
  },
  {
    beat: [
      { x: 53, z: 53, wait: 4, face: 9 },
      { x: 10, z: 54, wait: 4, face: 1 },
    ],
    night: [
      { x: 53, z: 53, wait: 4, face: 9 },
      { x: 10, z: 54, wait: 4, face: 1 },
    ],
    key: 'purple',
  },
  {
    beat: [
      { x: 10, z: 53, wait: 4, face: 13 },
      { x: 9, z: 10, wait: 4, face: 5 },
    ],
    night: [
      { x: 10, z: 53, wait: 4, face: 13 },
      { x: 9, z: 10, wait: 4, face: 5 },
    ],
    key: 'cyan',
  },
  {
    beat: [
      { x: 32, z: 50, wait: 8, face: 13 },
      { x: 33, z: 53, wait: 3, face: 1 },
      { x: 32, z: 59, wait: 6, face: 13 },
      { x: 30, z: 54, wait: 3, face: 9 },
    ],
    night: [
      { x: 32, z: 50, wait: 8, face: 13 },
      { x: 33, z: 53, wait: 3, face: 1 },
      { x: 32, z: 59, wait: 6, face: 13 },
      { x: 30, z: 54, wait: 3, face: 9 },
    ],
    key: 'red',
  },
  {
    beat: [
      { x: 42, z: 49, wait: 4, face: 9 },
      { x: 48, z: 50, wait: 4, face: 13 },
      { x: 48, z: 44, wait: 4, face: 1 },
      { x: 41, z: 43, wait: 4, face: 5 },
    ],
    key: 'purple',
  },
];

/** Level 4: maximum security, a desert cartel compound (GDD §4.4). */
export const SAN_PANCHO: PrisonDef = {
  id: 'san-pancho',
  difficulty: 4,
  theme: 'desert',
  decor: SAN_PANCHO_DECOR,
  ground: L0,
  zones: [
    // The walkway and the minefield beyond the inner wall; the supply road through the mines (staff only, like the walkway).
    ['walkway', 9, 9, 54, 10],
    ['walkway', 9, 53, 54, 54],
    ['walkway', 9, 11, 10, 52],
    ['walkway', 53, 11, 54, 52],
    ['minefield', 3, 3, 60, 7],
    ['minefield', 3, 56, 60, 60],
    ['minefield', 3, 8, 7, 55],
    ['minefield', 56, 8, 60, 55],
    ['walkway', 30, 56, 33, 60],
    // Inside the compound wall.
    ['corridor', 17, 12, 20, 30],
    ['corridor', 43, 12, 46, 30],
    ['cellBlock', 21, 27, 25, 30],
    ['cellBlock', 38, 27, 42, 30],
    ['kitchen', 12, 32, 15, 40],
    ['canteen', 17, 32, 26, 40],
    ['woodshop', 12, 42, 18, 51],
    ['metalshop', 20, 42, 25, 51],
    ['laundry', 27, 12, 29, 20],
    ['janitor', 31, 12, 32, 20],
    ['mailroom', 34, 12, 36, 20],
    ['yard', 27, 22, 36, 43],
    ['rollCall', 27, 25, 36, 31],
    ['solitary', 27, 45, 29, 51],
    ['controlRoom', 31, 45, 36, 51],
    ['gym', 37, 32, 45, 40],
    ['showers', 46, 32, 51, 40],
    ['library', 38, 41, 44, 46],
    ['infirmary', 45, 42, 51, 46],
    ['generator', 38, 48, 43, 51],
    ['guardQuarters', 45, 48, 51, 51],
  ],
  cells,
  props,
  rollCall,
  spawn: { x: 13, z: 13 },
  reachable: ['cellBlock', 'corridor', 'rollCall', 'yard', 'canteen', 'gym', 'showers', 'library', 'infirmary'],
  guards,
  names: ['Chuy', 'Flaco', 'Tigre', 'Lobo', 'Chato', 'Toro', 'Nacho', 'Primo', 'Rata', 'Diablo', 'Zorro', 'Paco', 'Gallo'],
  merchants: [3, 6, 9, 12],
  // The player starts as the janitor (GDD §4.4); every job but the gym's is on offer, the woodshop open.
  jobs: [
    { id: 'janitor', cell: 1 },
    { id: 'kitchen', cell: 3 },
    { id: 'laundry', cell: 5 },
    { id: 'woodshop', cell: 0 },
    { id: 'metalshop', cell: 8 },
    { id: 'mailman', cell: 11 },
  ],
  // Cameras watch the guards' world, not the inmates': the walkway's four corners, the halls by night, the control and generator rooms.
  cameras: [
    { x: 9, z: 9, face: 3 },
    { x: 54, z: 9, face: 7 },
    { x: 54, z: 54, face: 11 },
    { x: 9, z: 54, face: 15 },
    { x: 17, z: 12, face: 5 },
    { x: 46, z: 12, face: 5 },
    { x: 36, z: 51, face: 11 },
    { x: 38, z: 48, face: 3 },
  ],
  // Searchlights at night, one per corner tower, sweeping its corner's two stretches of mines
  // (the southern two across the supply corridor).
  searchlights: [
    [
      { x: 5, z: 30 },
      { x: 5, z: 5 },
      { x: 30, z: 5 },
    ],
    [
      { x: 33, z: 5 },
      { x: 58, z: 5 },
      { x: 58, z: 30 },
    ],
    [
      { x: 5, z: 33 },
      { x: 5, z: 58 },
      { x: 31, z: 58 },
    ],
    [
      { x: 58, z: 33 },
      { x: 58, z: 58 },
      { x: 32, z: 58 },
    ],
  ],
  // No gate a key can't open: cloned red and green keys walk the supply road out (GDD §4.4).
  gates: [],
  escapes: ['tunnel', 'gate', 'takeover'],
  rules: { snipers: 'always', hostile: true },
};
