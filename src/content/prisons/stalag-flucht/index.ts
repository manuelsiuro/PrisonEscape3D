import type { PropPlacement } from '../../props';
import type { GuardDef, PrisonDef, Rect } from '../types';
import { L0 } from './L0.map';
import { L1 } from './L1.map';
import { LM1 } from './Lm1.map';
import { STALAG_FLUCHT_DECOR } from './decor';

/**
 * Cells: two log cabins of five, three along the north side of each hall (doors south) and
 * two along its south side (doors north). Cell 1, the player's, is cabin A's first; cabin A's
 * last corner is a locked storeroom, cabin B's a common room open to its hall.
 */
const cells: Rect[] = [];
const props: PropPlacement[] = [];
const cell = (x0: number, top: boolean) => {
  const z0 = top ? 7 : 16;
  cells.push([x0, z0, x0 + 3, z0 + 3]);
  props.push(
    { kind: 'bed', x: x0, z: top ? z0 : z0 + 2, d: 2, rot: top ? 0 : 2 },
    { kind: 'desk', x: x0 + 3, z: top ? z0 : z0 + 3, rot: 3 },
    { kind: 'toilet', x: x0 + 3, z: top ? z0 + 3 : z0, rot: 3 },
    { kind: 'chair', x: x0 + 2, z: top ? z0 : z0 + 3, rot: 1 },
  );
};
for (const cabin of [5, 24]) {
  for (const k of [0, 1, 2]) cell(cabin + k * 5, true);
  for (const k of [0, 1]) cell(cabin + k * 5, false);
}

props.push(
  // Cabin A's storeroom.
  { kind: 'shelf', x: 15, z: 19, w: 2, rot: 2 },
  // Cabin B's common room: a table by the stove.
  { kind: 'table', x: 35, z: 17, w: 2 },
  { kind: 'chair', x: 35, z: 16, rot: 0 },
  { kind: 'chair', x: 36, z: 16, rot: 0 },
  { kind: 'chair', x: 35, z: 18, rot: 2 },
  { kind: 'chair', x: 36, z: 18, rot: 2 },
  // Canteen: two rows of tables either side of the door, benches along them, the serving counter on the east wall.
  ...[31, 34].flatMap((z) =>
    [6, 14].flatMap((x) => [
      { kind: 'table', x, z, w: 3 } as const,
      { kind: 'seat', x, z: z - 1, w: 3 } as const,
      { kind: 'seat', x, z: z + 1, w: 3, rot: 2 } as const,
    ]),
  ),
  { kind: 'counter', x: 18, z: 31, d: 3, rot: 3 },
  // Kitchen.
  { kind: 'freezer', x: 5, z: 37, d: 2, rot: 1 },
  { kind: 'oven', x: 8, z: 39, rot: 2 },
  { kind: 'oven', x: 9, z: 39, rot: 2 },
  { kind: 'counter', x: 14, z: 39, w: 3, rot: 2 },
  // Gym.
  { kind: 'treadmill', x: 25, z: 30, d: 2 },
  { kind: 'treadmill', x: 27, z: 30, d: 2 },
  { kind: 'weights', x: 34, z: 32 },
  { kind: 'weights', x: 36, z: 32 },
  { kind: 'jobBoard', x: 37, z: 30, rot: 3 },
  // Showers: heads along the south wall, either side.
  ...[25, 26, 27, 33, 34, 35].map((x) => ({ kind: 'shower', x, z: 39, rot: 2 }) as const),
  // Woodshop (the west block).
  { kind: 'bin', x: 5, z: 46 },
  { kind: 'workbench', x: 8, z: 47, w: 2 },
  { kind: 'workbench', x: 13, z: 47, w: 2 },
  { kind: 'bin', x: 18, z: 49 },
  // Library.
  { kind: 'shelf', x: 5, z: 54, w: 3 },
  { kind: 'shelf', x: 14, z: 54, w: 3 },
  { kind: 'table', x: 6, z: 56, w: 2 },
  { kind: 'table', x: 14, z: 56, w: 2 },
  // Laundry (the east block).
  { kind: 'bin', x: 24, z: 46 },
  { kind: 'washer', x: 25, z: 46 },
  { kind: 'washer', x: 26, z: 46 },
  { kind: 'bin', x: 29, z: 49 },
  // Metalshop: the metal bin, two presses, the output bin.
  { kind: 'bin', x: 31, z: 46 },
  { kind: 'press', x: 32, z: 47, w: 2 },
  { kind: 'press', x: 35, z: 47, w: 2 },
  { kind: 'bin', x: 37, z: 49 },
  // Infirmary.
  { kind: 'bed', x: 24, z: 56, d: 2, rot: 2 },
  { kind: 'bed', x: 26, z: 56, d: 2, rot: 2 },
  { kind: 'bed', x: 29, z: 56, d: 2, rot: 2 },
  // Janitor's closet.
  { kind: 'bin', x: 31, z: 54 },
  { kind: 'shelf', x: 35, z: 54, w: 2 },
  // The guards' barracks: four bunks for the night's sleepers, a table.
  { kind: 'bed', x: 46, z: 6, d: 2 },
  { kind: 'bed', x: 48, z: 6, d: 2 },
  { kind: 'bed', x: 55, z: 6, d: 2 },
  { kind: 'bed', x: 57, z: 6, d: 2 },
  { kind: 'table', x: 50, z: 10, w: 3 },
  // The generator hut, and the ladder up to its roof against the north wall (GDD §4.2: [L]).
  { kind: 'generator', x: 54, z: 24, w: 2, d: 2 },
  { kind: 'ladder', x: 57, z: 23 },
  { kind: 'controlDesk', x: 49, z: 23, w: 2, rot: 0 },
  // Solitary.
  { kind: 'bed', x: 47, z: 45, d: 2, rot: 2 },
  { kind: 'bed', x: 56, z: 45, d: 2, rot: 2 },
  // Yard benches along the roll call square.
  { kind: 'bench', x: 8, z: 23, w: 2 },
  { kind: 'bench', x: 32, z: 23, w: 2 },
  { kind: 'bench', x: 8, z: 27, w: 2, rot: 2 },
  { kind: 'bench', x: 32, z: 27, w: 2, rot: 2 },
  // Chairs: the library's tables, the barracks' table.
  ...[6, 7, 14, 15].map((x) => ({ kind: 'chair', x, z: 57, rot: 2 }) as const),
  ...[50, 51, 52].flatMap((x) => [{ kind: 'chair', x, z: 9, rot: 0 } as const, { kind: 'chair', x, z: 11, rot: 2 } as const]),
  // Lamps: the yard, the avenue, the east compound.
  ...[
    [4, 22],
    [37, 22],
    [4, 28],
    [37, 28],
    [21, 44],
    [3, 59],
    [38, 59],
    [44, 16],
    [59, 16],
    [44, 34],
    [59, 34],
    [44, 50],
    [59, 50],
  ].map(([x, z]) => ({ kind: 'lamp', x, z }) as const),
);

/** Two rows of five on the snow, facing the warden at the north end. */
const rollCall = [23, 25].flatMap((z) => [14, 17, 20, 23, 26].map((x) => ({ x, z })));

/**
 * Six guards (GDD §4.2). Directions: 1 east, 5 south, 9 west, 13 north.
 * - The warden walks the cabins and the yard, takes roll call, and at night keeps the
 *   cabins and does the bed checks.
 * - The canteen guard watches meals and walks the canteen and kitchen.
 * - The gym guard walks the gym and showers, watches showers, and searches cells at the
 *   morning shakedown.
 * - The yard guard walks the yard and the avenue, watches exercise, and walks the yard at night.
 * - The east guard keeps the guards' compound: the inner gate, the barracks, the generator hut, solitary.
 * - The workshop guard walks the service blocks' corridors and rooms.
 * The canteen, gym, east and workshop guards sleep in the barracks at night.
 * Keys (GDD §10.2): the warden red (the storeroom, the barracks, solitary), the canteen and
 * workshop guards cyan (kitchen, workshops, laundry, janitor), the gym guard yellow (cell
 * doors after dark), the yard guard green, the east guard purple (the inner gate, the generator hut).
 */
const guards: GuardDef[] = [
  {
    name: 'Kessler',
    beat: [
      { x: 8, z: 13, wait: 3, face: 1 },
      { x: 21, z: 13, wait: 2, face: 5 },
      { x: 30, z: 13, wait: 3, face: 9 },
      { x: 21, z: 24, wait: 3, face: 5 },
    ],
    posts: { rollCall: { x: 20, z: 21, face: 5 }, eveningRollCall: { x: 20, z: 21, face: 5 } },
    night: [
      { x: 8, z: 13, wait: 4, face: 1 },
      { x: 21, z: 13, wait: 3, face: 5 },
      { x: 30, z: 13, wait: 4, face: 9 },
      { x: 21, z: 21, wait: 3, face: 13 },
    ],
    duties: ['bedCheck'],
    key: 'red',
  },
  {
    name: 'Brandt',
    beat: [
      { x: 11, z: 31, wait: 3, face: 5 },
      { x: 17, z: 35, wait: 3, face: 9 },
      { x: 12, z: 38, wait: 3, face: 9 },
      { x: 11, z: 27, wait: 2, face: 13 },
    ],
    posts: { breakfast: { x: 11, z: 33, face: 1 }, dinner: { x: 11, z: 33, face: 1 } },
    key: 'cyan',
  },
  {
    name: 'Weber',
    trait: 'strict',
    beat: [
      { x: 31, z: 31, wait: 3, face: 5 },
      { x: 35, z: 34, wait: 2, face: 9 },
      { x: 30, z: 37, wait: 3, face: 5 },
      { x: 30, z: 27, wait: 2, face: 13 },
    ],
    posts: { showers: { x: 30, z: 37, face: 5 } },
    duties: ['shakedown'],
    key: 'yellow',
  },
  {
    name: 'Huber',
    trait: 'lazy',
    beat: [
      { x: 10, z: 42, wait: 3, face: 1 },
      { x: 30, z: 42, wait: 3, face: 9 },
      { x: 40, z: 30, wait: 3, face: 9 },
      { x: 30, z: 22, wait: 2, face: 5 },
    ],
    posts: { exercise: { x: 21, z: 28, face: 5 } },
    night: [
      { x: 21, z: 22, wait: 3, face: 5 },
      { x: 10, z: 42, wait: 3, face: 1 },
      { x: 40, z: 42, wait: 3, face: 9, nap: true },
      { x: 40, z: 10, wait: 3, face: 5 },
    ],
    key: 'green',
  },
  {
    name: 'Lang',
    trait: 'corrupt',
    beat: [
      { x: 43, z: 31, wait: 3, face: 9 },
      { x: 51, z: 16, wait: 3, face: 5 },
      { x: 53, z: 26, wait: 3, face: 1 },
      { x: 53, z: 31, wait: 2, face: 5 },
      { x: 51, z: 37, wait: 3, face: 13 },
    ],
    key: 'purple',
  },
  {
    name: 'Fink',
    beat: [
      { x: 8, z: 51, wait: 3, face: 1 },
      { x: 11, z: 48, wait: 3, face: 5 },
      { x: 30, z: 51, wait: 2, face: 9 },
      { x: 34, z: 49, wait: 3, face: 13 },
      { x: 27, z: 55, wait: 3, face: 13 },
    ],
    key: 'cyan',
  },
];

/** Level 2: medium security, an alpine POW camp (GDD §4.2). */
export const STALAG_FLUCHT: PrisonDef = {
  id: 'stalag-flucht',
  difficulty: 2,
  theme: 'alpine',
  decor: STALAG_FLUCHT_DECOR,
  ground: L0,
  vents: L1,
  under: LM1,
  zones: [
    // The prisoners' compound is all yard, but for the roll call square and the buildings.
    ['yard', 3, 3, 41, 60],
    ['rollCall', 12, 22, 29, 26],
    ['cellBlock', 5, 12, 18, 14],
    ['cellBlock', 24, 12, 37, 14],
    ['cellBlock', 34, 15, 37, 19],
    ['storeroom', 15, 16, 18, 19],
    ['canteen', 5, 30, 18, 35],
    ['kitchen', 5, 37, 18, 39],
    ['gym', 24, 30, 37, 34],
    ['showers', 24, 36, 37, 39],
    ['woodshop', 5, 46, 18, 49],
    ['laundry', 24, 46, 29, 49],
    ['metalshop', 31, 46, 37, 49],
    ['corridor', 5, 51, 18, 52],
    ['corridor', 24, 51, 37, 52],
    ['library', 5, 54, 18, 57],
    ['infirmary', 24, 54, 29, 57],
    ['janitor', 31, 54, 37, 57],
    // The guards' compound: its open ground is the perimeter.
    ['guardQuarters', 46, 6, 57, 13],
    ['generator', 49, 23, 57, 28],
    ['solitary', 46, 39, 57, 46],
  ],
  cells,
  props,
  rollCall,
  spawn: { x: 6, z: 9 },
  reachable: ['cellBlock', 'rollCall', 'yard', 'canteen', 'gym', 'showers', 'library', 'infirmary', 'corridor'],
  guards,
  names: ['Ferret', 'Kipper', 'Biscuit', 'Badger', 'Ginger', 'Taffy', 'Chalky', 'Scraps', 'Nobby'],
  merchants: [3, 7, 9],
  crew: ['digger', 'lookout', 'smuggler', 'digger', 'lookout', 'muscle', 'digger', 'smuggler', 'muscle'],
  // The player starts in the kitchen (GDD §4.2); the woodshop is open (Intellect 40, as the player starts).
  jobs: [
    { id: 'kitchen', cell: 1 },
    { id: 'laundry', cell: 4 },
    { id: 'woodshop', cell: 0 },
    { id: 'metalshop', cell: 6 },
    { id: 'janitor', cell: 8 },
  ],
  // Cameras (GDD §5.6): the generator hut, the barracks.
  cameras: [
    { x: 57, z: 28, face: 11 },
    { x: 57, z: 13, face: 11 },
  ],
  // Searchlights at night, one per tower: the west wire, the north wire past the cabins, the
  // guards' compound, the south wire.
  searchlights: [
    [
      { x: 3, z: 8 },
      { x: 3, z: 40 },
    ],
    [
      { x: 58, z: 4 },
      { x: 44, z: 4 },
      { x: 44, z: 20 },
      { x: 60, z: 36 },
    ],
    [
      { x: 38, z: 59 },
      { x: 4, z: 59 },
    ],
  ],
  rules: { cold: true },
  // (P24: a glider off the generator hut's east edge, with the wind behind it.)
  escapes: ['fence', 'tunnel', 'roof', 'takeover', 'stowaway', 'glider'],
  // Delivery day (P18): the Red Cross truck backs in through the south gate and up the camp's
  // middle path (a lane left beside it); the south guard walks round it, and searches it two
  // days in five.
  delivery: {
    vehicle: 'redCross',
    bay: [20, 54, 21, 58],
    tail: { x: 20, z: 53 },
    face: 5,
    supervisor: 5,
    round: [
      { x: 22, z: 53, wait: 5, face: 13 },
      { x: 22, z: 57, wait: 3, face: 5 },
      { x: 20, z: 60, wait: 5, face: 13 },
      { x: 25, z: 59, wait: 3, face: 9 },
      { x: 22, z: 57, wait: 3, face: 13 },
    ],
    thorough: 40,
    road: [
      { x: 21, z: 68 },
      { x: 21, z: 56.5 },
    ],
  },
  // Smuggling (P21): Scraps sells burner phones; the drone drops on the open ground east of roll
  // call; nobody visits up here: a Red Cross parcel comes with the truck instead.
  smuggling: { fixer: 9, drop: [30, 22, 38, 28], parcel: true },
};
