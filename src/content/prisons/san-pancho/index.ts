import { comms } from '../../phone';
import { court } from '../../leisure';
import { pitch } from '../../team';
import { quizAt, stage } from '../../nights';
import type { PropPlacement } from '../../props';
import type { GuardDef, PrisonDef, Rect } from '../types';
import { L0 } from './L0.map';
import { SAN_PANCHO_DECOR } from './decor';

/**
 * Cells: two wings of seven, each a hall between two columns of cells; the column on the
 * plaza side has three and a vestibule out onto the plaza (P33: and south, into the canteen
 * from the west wing, the gym from the east one). Cells whose door is on their east
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
  // between and along the east side, where the whole compound files in from the west wing's lobby;
  // the stage at the south end (P33).
  ...[33, 37].flatMap((z) =>
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
  { kind: 'press', x: 23, z: 47, w: 2 },
  { kind: 'bin', x: 24, z: 51 },
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
  // Gym and showers (P33: one room off the east wing's lobby): treadmills, weights, the job
  // board; the heads along the south wall and the east one, clear of the library's door.
  { kind: 'treadmill', x: 43, z: 32, d: 2 },
  { kind: 'treadmill', x: 44, z: 32, d: 2 },
  // (The weights a tile off the board's front, so it reads from any side.)
  { kind: 'weights', x: 43, z: 35 },
  { kind: 'jobBoard', x: 41, z: 35, rot: 1 },
  ...[42, 43, 44].map((x) => ({ kind: 'shower', x, z: 40, rot: 2 }) as const),
  { kind: 'shower', x: 44, z: 38, rot: 3 },
  // Library.
  // (A way clear down its west side, from the gym's door to the generator room's.)
  { kind: 'shelf', x: 42, z: 42, w: 3 },
  { kind: 'table', x: 42, z: 44, w: 2 },
  ...[42, 43].map((x) => ({ kind: 'chair', x, z: 45, rot: 2 }) as const),
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
  { kind: 'bed', x: 27, z: 48, d: 2 },
  { kind: 'bed', x: 27, z: 50, d: 2, rot: 2 },
  // The control room, on the supply road out (P33: behind the generator room).
  { kind: 'controlDesk', x: 36, z: 48, d: 3, rot: 3 },
  { kind: 'chair', x: 35, z: 49, rot: 1 },
  // The yard: benches either side, lamps at its north corners.
  { kind: 'bench', x: 27, z: 23, d: 2, rot: 1 },
  { kind: 'bench', x: 36, z: 23, d: 2, rot: 3 },
  ...[
    [27, 22],
    [36, 22],
  ].map(([x, z]) => ({ kind: 'lamp', x, z }) as const),
  // The sports ground (P33, the plaza's south half): the court, the weights corner and the
  // bleachers north of the track; lamps at its corners.
  { kind: 'pullup', x: 36, z: 32, w: 2 },
  { kind: 'weights', x: 39, z: 33 },
  { kind: 'weights', x: 39, z: 35 },
  { kind: 'bleachers', x: 33, z: 36, w: 6 },
  { kind: 'lamp', x: 26, z: 46 },
  { kind: 'lamp', x: 39, z: 46 },
  { kind: 'lamp', x: 26, z: 36 },
  { kind: 'lamp', x: 39, z: 36 },
  // The garden (P33, the old showers): the planters and the tool shed along the north wall,
  // the crate under the shed; two more planters behind the beds (the wall hides the rows in
  // front of it from the camera, the crops stand above it).
  { kind: 'planter', x: 46, z: 32, w: 2 },
  { kind: 'planter', x: 48, z: 32, w: 2 },
  { kind: 'toolShed', x: 50, z: 32, w: 2, d: 2 },
  { kind: 'crate', x: 50, z: 34 },
  { kind: 'planter', x: 47, z: 39, w: 2 },
  { kind: 'planter', x: 49, z: 39, w: 2 },
);

/** Two rows of seven in the yard (the plaza's north half), facing the warden. */
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
 * Keys (GDD §10.2): the warden and the gate guard red (the supply road, solitary; since P33 the
 * road out runs from the library through the generator room and the control room), the
 * sweeper green (the outer gate), the north and south walkway guards yellow and purple, the
 * east and west cyan, the staff guard purple (the guards' quarters: with the generator room's
 * red, the GDD's "[P][GEN][R]" guard post).
 */
const guards: GuardDef[] = [
  {
    name: 'Varga',
    beat: [
      { x: 33, z: 49, wait: 20, face: 9 },
      { x: 31, z: 26, wait: 4, face: 13 },
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
    name: 'Ríos',
    trait: 'strict',
    beat: [
      { x: 18, z: 14, wait: 3, face: 5 },
      { x: 23, z: 29, wait: 2, face: 1 },
      { x: 21, z: 36, wait: 3, face: 9 },
      { x: 16, z: 49, wait: 3, face: 13 },
      { x: 32, z: 26, wait: 3, face: 5 },
      // (P33 review: through the sports ground and the garden too, which nobody would see otherwise.)
      { x: 37, z: 34, wait: 3, face: 9 },
      { x: 44, z: 14, wait: 3, face: 5 },
      { x: 43, z: 36, wait: 3, face: 1 },
      { x: 47, z: 34, wait: 3, face: 5 },
      { x: 41, z: 45, wait: 3, face: 1 },
      { x: 33, z: 49, wait: 40, face: 13 },
    ],
    duties: ['shakedown'],
    key: 'green',
    dog: { name: 'Canela', kennel: { x: 45, z: 50, face: 1 }, coat: 'retriever' },
  },
  {
    name: 'Molina',
    trait: 'corrupt',
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
    name: 'Cruz',
    trait: 'lazy',
    beat: [
      { x: 53, z: 10, wait: 4, face: 5 },
      { x: 54, z: 53, wait: 4, face: 13 },
    ],
    night: [
      { x: 53, z: 10, wait: 4, face: 5 },
      { x: 54, z: 53, wait: 4, face: 13, nap: true },
    ],
    key: 'cyan',
  },
  {
    name: 'Ortiz',
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
    name: 'Peña',
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
    name: 'Ochoa',
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
    dog: { name: 'Bandido', kennel: { x: 51, z: 50, face: 9 }, night: true, coat: 'collie' },
  },
  {
    name: 'Paz',
    trait: 'corrupt',
    beat: [
      { x: 42, z: 49, wait: 4, face: 9 },
      { x: 48, z: 50, wait: 4, face: 13 },
      { x: 48, z: 44, wait: 4, face: 1 },
      { x: 41, z: 46, wait: 4, face: 13 },
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
    ['canteen', 17, 32, 24, 40],
    ['woodshop', 12, 42, 18, 51],
    ['metalshop', 20, 42, 24, 51],
    ['laundry', 27, 12, 29, 20],
    ['janitor', 31, 12, 32, 20],
    ['mailroom', 34, 12, 36, 20],
    ['yard', 27, 22, 36, 30],
    ['rollCall', 27, 25, 36, 30],
    ['solitary', 27, 48, 29, 51],
    ['controlRoom', 31, 48, 36, 51],
    ['gym', 41, 32, 44, 36],
    ['showers', 41, 37, 44, 40],
    ['library', 41, 41, 44, 46],
    ['infirmary', 45, 42, 51, 46],
    ['generator', 38, 48, 43, 51],
    ['guardQuarters', 45, 48, 51, 51],
    // P33: the sports ground in the plaza's south half, behind the yard's fence; the garden in
    // the showers' old place, through the gym.
    ['sports', 26, 32, 39, 46],
    ['garden', 46, 32, 51, 40],
  ],
  cells,
  props,
  rollCall,
  spawn: { x: 13, z: 13 },
  reachable: ['cellBlock', 'corridor', 'rollCall', 'yard', 'canteen', 'gym', 'showers', 'library', 'infirmary', 'sports', 'garden'],
  guards,
  names: ['Chuy', 'Flaco', 'Tigre', 'Lobo', 'Chato', 'Toro', 'Nacho', 'Primo', 'Rata', 'Diablo', 'Zorro', 'Paco', 'Gallo'],
  merchants: [3, 6, 9, 12],
  crew: ['lookout', 'lookout', 'muscle', 'muscle', 'digger', 'muscle', 'smuggler', 'smuggler', 'digger', 'muscle', 'lookout', 'digger', 'lookout'],
  // The player starts as the janitor (GDD §4.4); every job but the gym's is on offer, the woodshop open.
  jobs: [
    { id: 'janitor', cell: 1 },
    { id: 'kitchen', cell: 3 },
    { id: 'laundry', cell: 5 },
    { id: 'woodshop', cell: 0 },
    { id: 'metalshop', cell: 8 },
    { id: 'mailman', cell: 11 },
    { id: 'gardener', cell: 6 },
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
  escapes: ['tunnel', 'gate', 'takeover', 'stowaway'],
  rules: { snipers: 'always', hostile: true },
  // Delivery day (P18): the produce truck comes up the supply road between the mines to the
  // inner wall's door (only keys and a uniform get anyone there); the road's guard walks round
  // it, and searches it three days in five.
  delivery: {
    vehicle: 'produce',
    bay: [31, 57, 32, 59],
    tail: { x: 31, z: 56 },
    face: 5,
    supervisor: 6,
    round: [
      { x: 30, z: 56, wait: 4, face: 1 },
      { x: 30, z: 60, wait: 3, face: 13 },
      { x: 33, z: 60, wait: 3, face: 13 },
      { x: 33, z: 56, wait: 4, face: 9 },
    ],
    thorough: 60,
    road: [
      { x: 32, z: 68 },
      { x: 32, z: 58.5 },
    ],
  },
  // Smuggling (P21): Primo sells burner phones; the drone drops on the roll call square (P33:
  // the plaza's south half is the sports ground); visitors sit in the canteen.
  smuggling: { fixer: 9, drop: [27, 25, 36, 30], visits: [17, 32, 24, 40] },
  // Free time (P27): the old-timer who plays checkers; the hoop, the pitch and its track on the
  // sports ground, the beds in the garden (P33).
  leisure: {
    hoop: court(29, 32, 5),
    oldTimer: 5,
    garden: { x: 46, z: 37, w: 6, d: 2 },
    race: { x: 19, z: 28, dir: 1, len: 6 },
    // (Two rows clear along the south wall, which would hide the track's lane from the camera.)
    pitch: pitch(27, 38, 12, 6),
    track: { x: 26, z: 37, w: 14, d: 8 },
    stage: stage(21, 40, 13),
    quiz: quizAt(5, [41, 43], [42, 43], [43, 43], [44, 43]),
  },
  // Rebuilt in 2.9 (P33): the sports ground in the plaza's south half, the garden in the showers' old place.
  // The pay phone (P34): on the corridor's north wall, its queue along it; the front gate's inside for Lou's diversion, the road for his car.
  comms: comms([19, 12, 13], [[20, 12], [20, 13], [20, 14], [20, 15]], [31, 51], [35, 63, 1]),
  map: 1,
};
