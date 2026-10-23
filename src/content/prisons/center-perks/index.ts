import { comms } from '../../phone';
import { court } from '../../leisure';
import { pitch } from '../../team';
import { quizAt, stage } from '../../nights';
import type { PropPlacement } from '../../props';
import type { GuardDef, PrisonDef, Rect } from '../types';
import { L0 } from './L0.map';
import { L1 } from './L1.map';
import { CENTER_PERKS_DECOR } from './decor';

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
  // Canteen: rows of tables either side of the entrance, a low bench along each side, the
  // serving counter at the back.
  ...[9, 12, 15, 18].flatMap((z) =>
    [41, 46].flatMap((x) => [
      { kind: 'table', x, z, w: 3 } as const,
      { kind: 'seat', x, z: z - 1, w: 3 } as const,
      { kind: 'seat', x, z: z + 1, w: 3, rot: 2 } as const,
    ]),
  ),
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
  // Showers: heads along the north wall (in view from the south), either side of the door.
  ...[16, 17, 18, 20, 21, 22].map((x) => ({ kind: 'shower', x, z: 25 }) as const),
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
  // Generator room, and the ladder up to the roof (and the vents' end) against its north wall.
  { kind: 'generator', x: 7, z: 42, w: 2, d: 2 },
  { kind: 'ladder', x: 13, z: 39 },
  // Solitary.
  { kind: 'bed', x: 16, z: 43, d: 2, rot: 2 },
  { kind: 'bed', x: 22, z: 43, d: 2, rot: 2 },
  // Visitation.
  { kind: 'counter', x: 27, z: 41, w: 3 },
  { kind: 'counter', x: 32, z: 41, w: 4 },
  // Guard quarters and control room.
  { kind: 'bed', x: 39, z: 43, d: 2, rot: 2 },
  { kind: 'bed', x: 41, z: 43, d: 2, rot: 2 },
  { kind: 'bed', x: 43, z: 43, d: 2, rot: 2 },
  { kind: 'bed', x: 45, z: 43, d: 2, rot: 2 },
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

// Chairs (P8+), appended so every earlier prop keeps its index (saves, containers and
// training name props by index): one at each cell's desk, the library's tables, the guard
// quarters' table, stools either side of the visitation counters, the control room's desk.
props.push(
  ...cells.map(([x0, z0], k) => ({ kind: 'chair', x: x0 + 2, z: k < 4 ? z0 : z0 + 3, rot: 1 }) as const),
  ...[16, 17, 21, 22].map((x) => ({ kind: 'chair', x, z: 33, rot: 2 }) as const),
  ...[39, 40].map((x) => ({ kind: 'chair', x, z: 41, rot: 2 }) as const),
  ...[27, 28, 29, 32, 33, 34, 35].flatMap((x) => [{ kind: 'chair', x, z: 40, rot: 0 } as const, { kind: 'chair', x, z: 42, rot: 2 } as const]),
  { kind: 'chair', x: 55, z: 41, rot: 1 },
);

// The sports ground and the vegetable garden (P31), south of the building either side of the
// delivery drive: the weights corner, the bleachers by the pitch, lamps; the gardener's
// planters, the tool shed and the produce crate by the gate.
props.push(
  { kind: 'weights', x: 6, z: 52 },
  { kind: 'weights', x: 8, z: 52 },
  { kind: 'pullup', x: 7, z: 54, w: 2 },
  { kind: 'bleachers', x: 12, z: 46, w: 9 },
  { kind: 'lamp', x: 26, z: 46 },
  { kind: 'lamp', x: 6, z: 55 },
  ...[47, 50, 53].flatMap((z) => [{ kind: 'planter', x: 37, z, w: 3 } as const, { kind: 'planter', x: 41, z, w: 3 } as const]),
  { kind: 'toolShed', x: 52, z: 47, w: 3, d: 2 },
  { kind: 'crate', x: 50, z: 47 },
  { kind: 'lamp', x: 56, z: 55 },
);

/** Two rows of four, facing the guard at the north end. */
const rollCall = [12, 15].flatMap((z) => [29, 31, 34, 36].map((x) => ({ x, z })));

/**
 * Five guards (GDD §4.1). Directions: 1 east, 5 south, 9 west, 13 north.
 * - The warden walks the cell block and the roll call yard, takes roll call, and at night
 *   keeps the cell block and does the bed checks.
 * - The canteen guard watches meals and walks the canteen and kitchen.
 * - The wing guard walks the north corridor, gym and showers, watches showers, and searches
 *   cells at the morning shakedown.
 * - The yard guard walks the courtyard and the south corridor, watches exercise (from the
 *   sports ground, P31), and at night walks the yards.
 * - The east guard walks the workshops, the mailroom and the staff rooms.
 * The canteen, wing and east guards sleep in the guard quarters at night.
 * Their ways (P15): the canteen guard takes bribes, the wing guard goes by the book to the
 * letter (the shakedown is thorough), the yard guard dozes off in the yard on the night round.
 * Keys (GDD §10.2): the warden red (solitary, staff rooms), the canteen guard cyan (kitchen,
 * laundry, mailroom, janitor), the wing guard yellow (cell doors after dark), the yard guard
 * green (the gate to the south yard), the east guard purple (the generator room).
 */
const guards: GuardDef[] = [
  {
    name: 'Hollis',
    about: { nick: 'SARGE', home: 'DAYTON', team: 'COMETS' },
    beat: [
      { x: 8, z: 13, wait: 3, face: 1 },
      { x: 24, z: 13, wait: 2, face: 9 },
      { x: 33, z: 10, wait: 4, face: 5 },
      { x: 33, z: 18, wait: 3, face: 13 },
    ],
    posts: { rollCall: { x: 32, z: 8, face: 5 }, eveningRollCall: { x: 32, z: 8, face: 5 } },
    night: [
      { x: 24, z: 13, wait: 3, face: 9 },
      { x: 8, z: 13, wait: 4, face: 1 },
      { x: 30, z: 22, wait: 3, face: 9 },
      { x: 12, z: 22, wait: 3, face: 1 },
    ],
    duties: ['bedCheck'],
    key: 'red',
  },
  {
    name: 'Pratt',
    about: { nick: 'SLICK', home: 'FRESNO', team: 'ROLLERS' },
    trait: 'corrupt',
    beat: [
      { x: 44, z: 10, wait: 4, face: 5 },
      { x: 52, z: 12, wait: 3, face: 9 },
      { x: 53, z: 17, wait: 3, face: 9 },
      { x: 44, z: 22, wait: 2, face: 13 },
    ],
    posts: { breakfast: { x: 44, z: 16, face: 13 }, dinner: { x: 44, z: 16, face: 13 } },
    key: 'cyan',
  },
  {
    name: 'Dunn',
    about: { nick: 'DEACON', home: 'PEORIA', team: 'CHIEFS' },
    trait: 'strict',
    beat: [
      { x: 12, z: 22, wait: 2, face: 1 },
      { x: 10, z: 27, wait: 3, face: 1 },
      { x: 19, z: 27, wait: 3, face: 13 },
      { x: 30, z: 22, wait: 2, face: 9 },
    ],
    posts: { showers: { x: 19, z: 28, face: 13 } },
    duties: ['shakedown'],
    key: 'yellow',
  },
  {
    name: 'Moss',
    about: { nick: 'DOZER', home: 'TULSA', team: 'SOONERS' },
    trait: 'lazy',
    beat: [
      { x: 30, z: 25, wait: 3, face: 5 },
      { x: 35, z: 30, wait: 3, face: 9 },
      { x: 30, z: 34, wait: 3, face: 13 },
      { x: 19, z: 37, wait: 2, face: 1 },
      { x: 10, z: 36, wait: 2, face: 1 },
    ],
    posts: { exercise: { x: 22, z: 46, face: 5 } },
    night: [
      { x: 32, z: 10, wait: 4, face: 5 },
      { x: 33, z: 18, wait: 3, face: 13 },
      { x: 31, z: 22, wait: 2, face: 5 },
      { x: 30, z: 29, wait: 4, face: 1, nap: true },
    ],
    key: 'green',
  },
  {
    name: 'Keller',
    about: { nick: 'BULLDOG', home: 'BOISE', team: 'BRONCOS' },
    beat: [
      { x: 50, z: 22, wait: 2, face: 9 },
      { x: 43, z: 27, wait: 3, face: 5 },
      { x: 43, z: 33, wait: 3, face: 13 },
      { x: 50, z: 36, wait: 2, face: 9 },
      { x: 44, z: 41, wait: 3, face: 1 },
      { x: 53, z: 41, wait: 3, face: 9 },
    ],
    key: 'purple',
  },
];

/** Level 1: minimum security, suburban (GDD §4.1). */
export const CENTER_PERKS: PrisonDef = {
  id: 'center-perks',
  difficulty: 1,
  decor: CENTER_PERKS_DECOR,
  ground: L0,
  vents: L1,
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
    ['visitation', 27, 38, 37, 44],
    ['guardQuarters', 39, 39, 45, 44],
    ['controlRoom', 50, 39, 56, 44],
    // P31: the passages down to the sports ground and the garden, and the two places.
    ['corridor', 24, 38, 25, 44],
    ['corridor', 47, 38, 48, 44],
    ['sports', 6, 46, 26, 55],
    ['garden', 36, 46, 56, 55],
  ],
  cells,
  props,
  rollCall,
  spawn: { x: 9, z: 9 },
  reachable: ['cellBlock', 'rollCall', 'canteen', 'corridor', 'gym', 'showers', 'library', 'infirmary', 'yard', 'woodshop', 'visitation', 'sports', 'garden'],
  guards,
  names: ['Rusty', 'Tank', 'Mouse', 'Doc', 'Lefty', 'Bones', 'Slim'],
  merchants: [2, 6, 7],
  crew: ['digger', 'muscle', 'lookout', 'digger', 'smuggler', 'muscle', 'lookout'],
  // The player starts in the laundry; the woodshop is open (Intellect 40, as the player starts).
  jobs: [
    { id: 'laundry', cell: 1 },
    { id: 'janitor', cell: 3 },
    { id: 'kitchen', cell: 5 },
    { id: 'woodshop', cell: 0 },
    { id: 'mailman', cell: 8 },
    { id: 'gardener', cell: 4 },
  ],
  // Cameras (GDD §5.6): the staff corridor (its west end, looking down it past the generator and
  // solitary doors), the woodshop's corner, the control room.
  cameras: [
    { x: 7, z: 36, face: 1 },
    { x: 39, z: 25, face: 3 },
    { x: 50, z: 39, face: 3 },
  ],
  // The two south towers' searchlights (GDD §4.1): each sweeps its side's strip and half the south yard.
  searchlights: [
    [
      { x: 4, z: 18 },
      { x: 4, z: 47 },
      { x: 14, z: 53 },
      { x: 27, z: 57 },
    ],
    [
      { x: 59, z: 18 },
      { x: 59, z: 47 },
      { x: 49, z: 53 },
      { x: 34, z: 57 },
    ],
  ],
  // (P24: waved out through the south gate at the shift change; a glider off the roof's north, east or west edge with the wind behind it.)
  escapes: ['fence', 'tunnel', 'roof', 'takeover', 'stowaway', 'bluff', 'glider', 'paperwork', 'parole'],
  // Delivery day (P18): the supply truck backs up the south drive to the visitation room's gate
  // (propped open while it's unloaded); the yard guard walks round it, and searches it one day
  // in four.
  delivery: {
    vehicle: 'truck',
    bay: [30, 47, 31, 51],
    tail: { x: 30, z: 46 },
    face: 5,
    open: [
      { x: 30, z: 45 },
      { x: 31, z: 45 },
    ],
    supervisor: 3,
    round: [
      { x: 32, z: 46, wait: 5, face: 13 },
      { x: 33, z: 50, wait: 4, face: 9 },
      { x: 31, z: 53, wait: 5, face: 13 },
      { x: 28, z: 50, wait: 4, face: 1 },
      { x: 29, z: 46, wait: 5, face: 13 },
    ],
    thorough: 25,
    road: [
      { x: 31, z: 68 },
      { x: 31, z: 49.5 },
    ],
  },
  // Smuggling (P21): Lefty sells burner phones; the drone comes over the courtyard in the evening
  // (21:00–22:00, free time: the yard is open to everyone then); visitors sit across the
  // visitation room's counters.
  smuggling: { fixer: 6, drop: [25, 25, 36, 34], droneHours: [780, 840], visits: [27, 38, 37, 44] },
  // The checkpoint (P24): the gatekeeper's booth on the road beside the south gate; papers are
  // shown through the wire at the end of the drive.
  checkpoint: {
    window: [
      { x: 30, z: 60 },
      { x: 31, z: 60 },
    ],
    gates: [
      { x: 30, z: 61 },
      { x: 31, z: 61 },
    ],
    booth: { x: 33, z: 62, face: 13 },
  },
  // Free time (P27): the old-timer who plays checkers; the hoop, the pitch and its track on the sports ground, the beds in the garden (P31).
  leisure: {
    hoop: court(8, 46, 5),
    oldTimer: 5,
    garden: { x: 44, z: 51, w: 6, d: 2 },
    race: { x: 10, z: 13, dir: 1, len: 6 },
    // (The track's south lane runs along the fence: seen through its mesh. A row of grass there would cost the pitch a row, and a match its goals.)
    pitch: pitch(12, 48, 14, 7),
    track: { x: 11, z: 47, w: 16, d: 9 },
    stage: stage(56, 11, 9),
    quiz: quizAt(13, [17, 34], [18, 34], [20, 34], [21, 34]),
  },
  // Rebuilt in 2.7 (P31): the sports ground and the garden in the south grounds.
  // The pay phone (P34): on the corridor's north wall, its queue along it; the front gate's inside for Lou's diversion, the road for his car.
  // (P36: the release reported by the visiting room's doors, then out through them and the south gate.)
  comms: comms([41, 21, 13], [[40, 21], [39, 21], [38, 21], [37, 21]], [30, 60], [34, 63, 1], [19, 30, 13], { at: [[30, 44], [31, 44]], gates: [[30, 45], [31, 45], [30, 61], [31, 61]] }),
  map: 1,
};
