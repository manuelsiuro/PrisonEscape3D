import type { PropPlacement } from '../../props';
import type { GuardDef, PrisonDef, Rect } from '../types';
import { L0 } from './L0.map';
import { L1 } from './L1.map';
import { IRONGATE_DECOR } from './decor';

/**
 * Cells: two rows either side of the north block's hall, eight on the north side (doors
 * south), six on the south side (doors north) either side of the vestibule out to the yard
 * (in the middle, so nobody's walk home from the yard is long). Each cell has the bed along its west wall, the desk in the far corner from the door
 * with the chair before it, the toilet in the near corner. Cell 1, the player's, is the
 * north row's first (north-west corner, against the fortress wall).
 */
const cells: Rect[] = [];
const props: PropPlacement[] = [];
const cell = (x0: number, z0: number, doorSouth: boolean) => {
  cells.push([x0, z0, x0 + 3, z0 + 3]);
  props.push(
    ...(doorSouth
      ? [
          { kind: 'bed', x: x0, z: z0, d: 2 },
          { kind: 'desk', x: x0 + 3, z: z0 },
          { kind: 'chair', x: x0 + 3, z: z0 + 1, rot: 2 },
          { kind: 'toilet', x: x0, z: z0 + 3, rot: 1 },
        ]
      : [
          { kind: 'bed', x: x0, z: z0 + 2, d: 2, rot: 2 },
          { kind: 'desk', x: x0 + 3, z: z0 + 3, rot: 2 },
          { kind: 'chair', x: x0 + 3, z: z0 + 2 },
          { kind: 'toilet', x: x0, z: z0, rot: 1 },
        ]) as PropPlacement[],
  );
};
for (let x0 = 8; x0 <= 43; x0 += 5) cell(x0, 9, true);
for (const x0 of [8, 13, 18, 23, 33, 38]) cell(x0, 17, false);

props.push(
  // Kitchen: the freezer, two ovens, the counter the meals go out on.
  { kind: 'freezer', x: 8, z: 28, d: 2, rot: 1 },
  { kind: 'oven', x: 9, z: 37, rot: 2 },
  { kind: 'oven', x: 10, z: 37, rot: 2 },
  { kind: 'counter', x: 12, z: 33, d: 3, rot: 3 },
  // Canteen: six two-seat tables in three aisles, benches either side, the serving counter by the kitchen.
  ...[30, 34].flatMap((z) =>
    [16, 19, 22].flatMap((x) => [
      { kind: 'table', x, z, w: 2 } as const,
      { kind: 'seat', x, z: z - 1, w: 2 } as const,
      { kind: 'seat', x, z: z + 1, w: 2, rot: 2 } as const,
    ]),
  ),
  { kind: 'counter', x: 14, z: 33, d: 3, rot: 1 },
  // Gym: treadmills, weights, the job board.
  { kind: 'treadmill', x: 26, z: 29, d: 2 },
  { kind: 'treadmill', x: 27, z: 29, d: 2 },
  { kind: 'weights', x: 32, z: 29 },
  { kind: 'weights', x: 32, z: 31 },
  { kind: 'jobBoard', x: 33, z: 28, rot: 3 },
  // Showers: heads along the south wall.
  ...[26, 27, 28, 31, 32, 33].map((x) => ({ kind: 'shower', x, z: 37, rot: 2 }) as const),
  // Library: shelves along the north wall, two tables.
  { kind: 'shelf', x: 35, z: 28, w: 3 },
  { kind: 'shelf', x: 39, z: 28, w: 3 },
  { kind: 'table', x: 36, z: 30, w: 2 },
  { kind: 'table', x: 39, z: 30, w: 2 },
  ...[36, 37, 39, 40].map((x) => ({ kind: 'chair', x, z: 31, rot: 2 }) as const),
  // Infirmary.
  { kind: 'bed', x: 35, z: 34, d: 2 },
  { kind: 'bed', x: 37, z: 34, d: 2 },
  { kind: 'bed', x: 40, z: 34, d: 2 },
  // Laundry: the dirty bin, three washers along the south wall, the clean bin.
  { kind: 'bin', x: 43, z: 28 },
  { kind: 'washer', x: 49, z: 31, rot: 2 },
  { kind: 'washer', x: 50, z: 31, rot: 2 },
  { kind: 'washer', x: 51, z: 31, rot: 2 },
  { kind: 'bin', x: 51, z: 28 },
  // Janitor's closet.
  { kind: 'bin', x: 43, z: 33 },
  { kind: 'shelf', x: 46, z: 33 },
  // Mailroom: sorting desks either side of the aisle, the outgoing shelf.
  { kind: 'sortingDesk', x: 48, z: 35, d: 3, rot: 1 },
  { kind: 'sortingDesk', x: 51, z: 35, d: 3, rot: 3 },
  { kind: 'shelf', x: 49, z: 33, w: 2 },
  // Woodshop (behind its detector arch): the timber bin, two benches, the output bin.
  { kind: 'bin', x: 8, z: 43 },
  { kind: 'workbench', x: 9, z: 46, w: 2 },
  { kind: 'workbench', x: 12, z: 46, w: 2 },
  { kind: 'bin', x: 13, z: 50 },
  // Metalshop (behind its own): the metal bin, two presses, the output bin.
  { kind: 'bin', x: 15, z: 43 },
  { kind: 'press', x: 15, z: 46, w: 2 },
  { kind: 'press', x: 19, z: 46, w: 2 },
  { kind: 'bin', x: 20, z: 50 },
  // The control room.
  { kind: 'controlDesk', x: 28, z: 45, d: 3, rot: 3 },
  { kind: 'chair', x: 27, z: 46, rot: 1 },
  // Solitary.
  { kind: 'bed', x: 48, z: 9, d: 2 },
  // GEN-1 (detectors and cameras) and the ladder up to the north roof; GEN-2 (the dock fence, searchlights, lamps).
  { kind: 'generator', x: 44, z: 18, w: 2, d: 2 },
  { kind: 'ladder', x: 51, z: 17 },
  { kind: 'generator', x: 43, z: 46, w: 2, d: 2 },
  // Guard quarters: six bunks either side of the aisle.
  ...[43, 46, 49].flatMap((z) => [{ kind: 'bed', x: 48, z, d: 2 } as const, { kind: 'bed', x: 51, z, d: 2 } as const]),
  // The helipad, in its walled court.
  { kind: 'helipad', x: 35, z: 44, w: 4, d: 4 },
  // The yard: benches against the blocks, lamps; the court's lamps; the dock's.
  { kind: 'bench', x: 10, z: 22, w: 2 },
  { kind: 'bench', x: 46, z: 22, w: 2 },
  { kind: 'bench', x: 12, z: 26, w: 2, rot: 2 },
  { kind: 'bench', x: 44, z: 26, w: 2, rot: 2 },
  ...[
    [8, 22],
    [51, 22],
    [8, 26],
    [51, 26],
    [33, 42],
    [40, 50],
    [57, 23],
    [59, 33],
  ].map(([x, z]) => ({ kind: 'lamp', x, z }) as const),
);

/** One row of fourteen through the middle of the yard (it is only five tiles deep), facing the warden at its north side: the painted box clear of the walls and doorways on every side. */
const rollCall = Array.from({ length: 14 }, (_, k) => ({ x: 19 + k, z: 24 }));

/**
 * Ten guards (GDD §4.5), four of them armored riot guards. Directions: 1 east, 5 south,
 * 9 west, 13 north.
 * - The warden keeps the control room, takes roll call in the yard, and at night walks the
 *   hall and the main corridor and does the bed checks.
 * - The canteen guard walks the canteen and kitchen and watches meals.
 * - The wing guard walks the hall, the gym and the showers, watches showers, and searches
 *   cells at the morning shakedown.
 * - The yard guard walks the yard and the main corridor, watches exercise, and at night the yard.
 * - The workshop guard walks the laundry, the janitor's closet, the mailroom and the shops.
 * - The staff guard walks GEN-1, solitary, GEN-2 and the quarters.
 * - Two riot guards walk the walkway between the fortress and the outer wall, day and night:
 *   the north and west sides; the south and east sides and the dock (at night the south side
 *   only: the searchlights keep the east and the dock).
 * - Two riot guards hold the helipad court, day and night, one down each side of the pad
 *   (the helicopter takes nobody while one of them is up and about).
 * The canteen, wing, workshop and staff guards sleep in the quarters at night.
 * Keys (GDD §10.2): the warden, the south-east walkway guard and a helipad guard red (the
 * sally port out to the walkway, the dock, solitary, the quarters), the yard guard and the other helipad guard
 * green (the dock's second door), the canteen and workshop guards cyan, the wing guard and
 * the north-west walkway guard yellow, the staff guard purple (both generators).
 */
const guards: GuardDef[] = [
  {
    name: 'Blackwood',
    beat: [
      { x: 26, z: 46, wait: 25, face: 1 },
      { x: 25, z: 40, wait: 3, face: 13 },
      { x: 30, z: 23, wait: 4, face: 5 },
    ],
    posts: { rollCall: { x: 26, z: 22, face: 5 }, eveningRollCall: { x: 26, z: 22, face: 5 } },
    night: [
      { x: 9, z: 14, wait: 4, face: 1 },
      { x: 50, z: 15, wait: 4, face: 9 },
      { x: 39, z: 24, wait: 3, face: 9 },
      { x: 50, z: 40, wait: 3, face: 9 },
      { x: 9, z: 39, wait: 3, face: 1 },
    ],
    duties: ['bedCheck'],
    key: 'red',
  },
  {
    name: 'Finch',
    beat: [
      { x: 15, z: 28, wait: 3, face: 5 },
      { x: 24, z: 32, wait: 3, face: 9 },
      { x: 10, z: 30, wait: 3, face: 1 },
      { x: 21, z: 37, wait: 3, face: 13 },
    ],
    posts: { breakfast: { x: 24, z: 28, face: 7 }, dinner: { x: 24, z: 28, face: 7 } },
    key: 'cyan',
  },
  {
    name: 'Pike',
    beat: [
      { x: 12, z: 15, wait: 3, face: 1 },
      { x: 29, z: 18, wait: 3, face: 13 },
      { x: 30, z: 28, wait: 3, face: 5 },
      { x: 29, z: 35, wait: 3, face: 1 },
      { x: 45, z: 14, wait: 3, face: 9 },
    ],
    posts: { showers: { x: 30, z: 34, face: 5 } },
    duties: ['shakedown'],
    key: 'yellow',
  },
  {
    name: 'Penrose',
    beat: [
      { x: 9, z: 24, wait: 3, face: 1 },
      { x: 50, z: 24, wait: 3, face: 9 },
      { x: 50, z: 39, wait: 3, face: 9 },
      { x: 9, z: 40, wait: 3, face: 1 },
    ],
    posts: { exercise: { x: 37, z: 23, face: 7 } },
    night: [
      { x: 9, z: 23, wait: 4, face: 1 },
      { x: 50, z: 25, wait: 4, face: 9 },
    ],
    key: 'green',
  },
  {
    name: 'Quill',
    beat: [
      { x: 45, z: 29, wait: 3, face: 5 },
      { x: 45, z: 35, wait: 3, face: 1 },
      { x: 49, z: 36, wait: 3, face: 13 },
      { x: 11, z: 45, wait: 3, face: 5 },
      { x: 17, z: 45, wait: 3, face: 5 },
    ],
    key: 'cyan',
  },
  {
    name: 'Mercer',
    beat: [
      { x: 47, z: 18, wait: 4, face: 9 },
      { x: 49, z: 12, wait: 3, face: 13 },
      { x: 44, z: 43, wait: 4, face: 5 },
      { x: 49, z: 47, wait: 4, face: 1 },
    ],
    key: 'purple',
  },
  {
    name: 'Thorne',
    beat: [
      { x: 5, z: 50, wait: 4, face: 13 },
      { x: 5, z: 7, wait: 3, face: 1 },
      { x: 52, z: 6, wait: 4, face: 9 },
    ],
    night: [
      { x: 5, z: 50, wait: 4, face: 13 },
      { x: 5, z: 7, wait: 3, face: 1 },
      { x: 52, z: 6, wait: 4, face: 9 },
    ],
    key: 'yellow',
    riot: true,
  },
  {
    name: 'Hask',
    beat: [
      { x: 31, z: 53, wait: 4, face: 1 },
      { x: 54, z: 52, wait: 3, face: 13 },
      { x: 58, z: 28, wait: 6, face: 1 },
      { x: 54, z: 9, wait: 3, face: 5 },
    ],
    night: [
      { x: 20, z: 53, wait: 6, face: 1 },
      { x: 54, z: 52, wait: 4, face: 9 },
    ],
    key: 'red',
    riot: true,
  },
  {
    name: 'Doyle',
    beat: [
      { x: 33, z: 43, wait: 8, face: 3 },
      { x: 33, z: 49, wait: 6, face: 15 },
    ],
    night: [
      { x: 33, z: 43, wait: 8, face: 3 },
      { x: 33, z: 49, wait: 6, face: 15 },
    ],
    key: 'red',
    riot: true,
    helipad: true,
  },
  {
    name: 'Vance',
    beat: [
      { x: 40, z: 49, wait: 7, face: 11 },
      { x: 40, z: 43, wait: 9, face: 7 },
    ],
    night: [
      { x: 40, z: 49, wait: 7, face: 11 },
      { x: 40, z: 43, wait: 9, face: 7 },
    ],
    key: 'green',
    riot: true,
    helipad: true,
  },
];

/** Level 5: supermax, an island fortress (GDD §4.5). */
export const IRONGATE: PrisonDef = {
  id: 'irongate',
  difficulty: 5,
  theme: 'island',
  decor: IRONGATE_DECOR,
  ground: L0,
  vents: L1,
  zones: [
    // The walkway between the fortress and the outer wall, the sally port through the south
    // block (staff only); the dock and its pier (staff only).
    ['walkway', 4, 5, 55, 7],
    ['walkway', 4, 52, 55, 54],
    ['walkway', 4, 8, 6, 51],
    ['walkway', 53, 8, 55, 51],
    ['walkway', 30, 42, 31, 50],
    ['dock', 57, 23, 59, 33],
    ['dock', 61, 27, 62, 29],
    // The north block.
    ['cellBlock', 8, 14, 51, 15],
    ['cellBlock', 28, 16, 31, 20],
    ['solitary', 48, 9, 51, 12],
    ['generator', 43, 17, 51, 20],
    // The yard.
    ['yard', 8, 22, 51, 26],
    ['rollCall', 18, 23, 33, 25],
    // The middle block.
    ['kitchen', 8, 28, 12, 37],
    ['canteen', 14, 27, 24, 38],
    ['gym', 26, 27, 33, 32],
    ['showers', 26, 33, 33, 37],
    ['library', 35, 27, 41, 32],
    ['infirmary', 35, 33, 41, 38],
    ['laundry', 43, 28, 51, 31],
    ['janitor', 43, 33, 46, 37],
    ['mailroom', 48, 33, 51, 37],
    // The main corridor, then the south block.
    ['corridor', 8, 39, 51, 40],
    ['woodshop', 8, 42, 13, 50],
    ['metalshop', 15, 42, 20, 50],
    ['controlRoom', 22, 42, 28, 50],
    ['helipad', 33, 42, 40, 50],
    ['generator', 42, 42, 46, 50],
    ['guardQuarters', 48, 42, 51, 50],
  ],
  cells,
  props,
  rollCall,
  spawn: { x: 10, z: 11 },
  reachable: ['cellBlock', 'rollCall', 'yard', 'canteen', 'gym', 'showers', 'library', 'infirmary', 'corridor'],
  guards,
  names: ['Brick', 'Gull', 'Barnacle', 'Fog', 'Anchor', 'Tide', 'Crab', 'Mutton', 'Bosun', 'Kipper', 'Shanty', 'Rook', 'Granite'],
  merchants: [2, 6, 9, 13],
  // The player starts in the woodshop (its timber and balsa make braces and rafts); every job is on offer, the mailroom open.
  jobs: [
    { id: 'woodshop', cell: 1 },
    { id: 'kitchen', cell: 3 },
    { id: 'laundry', cell: 5 },
    { id: 'metalshop', cell: 8 },
    { id: 'janitor', cell: 11 },
    { id: 'mailman', cell: 0 },
  ],
  // Cameras (on GEN-1): both ends of the hall and of the main corridor, the control room, both generator rooms, the sally port.
  cameras: [
    { x: 8, z: 14, face: 1 },
    { x: 51, z: 15, face: 9 },
    { x: 8, z: 39, face: 1 },
    { x: 51, z: 40, face: 9 },
    { x: 22, z: 42, face: 3 },
    { x: 43, z: 17, face: 3 },
    { x: 46, z: 42, face: 7 },
    { x: 30, z: 42, face: 5 },
  ],
  // Searchlights at night (on GEN-2), one per corner tower (each path starts nearest its own
  // tower), sweeping the walkway; the north-east one takes in the dock too.
  searchlights: [
    [
      { x: 5, z: 29 },
      { x: 5, z: 6 },
      { x: 29, z: 6 },
    ],
    [
      { x: 30, z: 6 },
      { x: 54, z: 6 },
      { x: 54, z: 28 },
      { x: 58, z: 28 },
    ],
    [
      { x: 5, z: 30 },
      { x: 5, z: 53 },
      { x: 29, z: 53 },
    ],
    [
      { x: 32, z: 53 },
      { x: 54, z: 53 },
      { x: 54, z: 29 },
    ],
  ],
  // The gates no key opens (a takeover does): the outer ferry gate, the helipad court's.
  gates: [
    { x: 30, z: 55 },
    { x: 31, z: 55 },
    { x: 32, z: 46 },
  ],
  escapes: ['raft', 'helicopter', 'takeover'],
  // GEN-1 (north block) runs the detectors and cameras; GEN-2 (south block) the dock's fence, the searchlights and the lamps.
  grid: [
    ['detectors', 'cameras'],
    ['fence', 'searchlights', 'lights'],
  ],
  // The roofs south of the yard: a grapnel swings across the chasm onto them from the north block's.
  landings: [[7, 27, 52, 51]],
  drawbridge: [30, 56, 31, 58],
};
