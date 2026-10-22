import { comms } from '../../phone';
import { court } from '../../leisure';
import { pitch } from '../../team';
import { quizAt, stage } from '../../nights';
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
  // The middle block (P33: east of the sports ground, its rooms narrower). Kitchen: the
  // freezer, two ovens, the counter the meals go out on.
  { kind: 'freezer', x: 23, z: 28, d: 2, rot: 1 },
  { kind: 'oven', x: 24, z: 36, rot: 2 },
  { kind: 'oven', x: 25, z: 36, rot: 2 },
  { kind: 'counter', x: 26, z: 33, d: 3, rot: 3 },
  // Canteen: four two-seat tables in two aisles, benches either side, the serving counter by
  // the kitchen; the stage at its south end, clear of the corridor's door.
  ...[30, 34].flatMap((z) =>
    [30, 33].flatMap((x) => [
      { kind: 'table', x, z, w: 2 } as const,
      { kind: 'seat', x, z: z - 1, w: 2 } as const,
      { kind: 'seat', x, z: z + 1, w: 2, rot: 2 } as const,
    ]),
  ),
  { kind: 'counter', x: 28, z: 33, d: 3, rot: 1 },
  // Gym: treadmills, weights, the job board.
  { kind: 'treadmill', x: 36, z: 29, d: 2 },
  { kind: 'treadmill', x: 37, z: 29, d: 2 },
  { kind: 'weights', x: 40, z: 30 },
  { kind: 'weights', x: 39, z: 30 },
  { kind: 'jobBoard', x: 40, z: 28, rot: 3 },
  // Showers: heads along the south wall.
  ...[36, 37, 38, 39, 40].map((x) => ({ kind: 'shower', x, z: 37, rot: 2 }) as const),
  // Laundry: the dirty bin, three washers along the south wall, the clean bin.
  { kind: 'bin', x: 43, z: 28 },
  { kind: 'washer', x: 44, z: 31, rot: 2 },
  { kind: 'washer', x: 45, z: 31, rot: 2 },
  { kind: 'washer', x: 46, z: 31, rot: 2 },
  { kind: 'bin', x: 46, z: 28 },
  // Mailroom: sorting desks either side of the aisle, the outgoing shelf.
  { kind: 'sortingDesk', x: 42, z: 34, d: 3, rot: 1 },
  { kind: 'sortingDesk', x: 46, z: 34, d: 3, rot: 3 },
  { kind: 'shelf', x: 43, z: 34, w: 2 },
  // Infirmary (through the library).
  { kind: 'bed', x: 48, z: 28, d: 2 },
  { kind: 'bed', x: 51, z: 28, d: 2 },
  // Library (off the corridor): a shelf, a table with the quiz's places north of it.
  { kind: 'shelf', x: 50, z: 34, w: 2 },
  { kind: 'table', x: 49, z: 36, w: 2 },
  // Janitor's closet (P33: off the corridor, beside the control room).
  { kind: 'bin', x: 23, z: 43 },
  { kind: 'shelf', x: 23, z: 46 },
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
  // The yard: benches against the north block, lamps; the court's lamps; the dock's.
  { kind: 'bench', x: 24, z: 22, w: 2 },
  { kind: 'bench', x: 39, z: 22, w: 2 },
  ...[
    [23, 22],
    [41, 22],
    [33, 42],
    [40, 50],
    [57, 23],
    [59, 33],
  ].map(([x, z]) => ({ kind: 'lamp', x, z }) as const),
  // The sports ground (P33, the yard's west third down to the corridor): the court, the
  // weights corner and the bleachers north of the track; lamps at its corners.
  { kind: 'pullup', x: 15, z: 22, w: 2 },
  { kind: 'weights', x: 18, z: 22 },
  { kind: 'weights', x: 20, z: 22 },
  { kind: 'bleachers', x: 14, z: 27, w: 6 },
  { kind: 'lamp', x: 8, z: 37 },
  { kind: 'lamp', x: 21, z: 37 },
  { kind: 'lamp', x: 8, z: 27 },
  { kind: 'lamp', x: 21, z: 27 },
  // The garden (P33, the yard's east end, fenced from the walkway): the beds and the tool shed
  // along the north block's wall (the shed, tall, in the back rows would hide the beds); the
  // planters in the row behind, the crate in the corner (the wall hides those two rows from the
  // camera, the crops stand above it).
  { kind: 'toolShed', x: 50, z: 22, w: 2, d: 2 },
  { kind: 'planter', x: 45, z: 25, w: 2 },
  { kind: 'planter', x: 47, z: 25, w: 2 },
  { kind: 'planter', x: 49, z: 25, w: 2 },
  { kind: 'planter', x: 51, z: 25, d: 2 },
  { kind: 'crate', x: 44, z: 26 },
);

/** One row of fourteen through the middle of the yard (it is only five tiles deep), facing the warden at its north side: the painted box clear of the walls and doorways on every side. */
const rollCall = Array.from({ length: 14 }, (_, k) => ({ x: 28 + k, z: 24 }));

/**
 * Ten guards (GDD §4.5), four of them armored riot guards. Directions: 1 east, 5 south,
 * 9 west, 13 north.
 * - The warden keeps the control room, takes roll call in the yard, and at night walks the
 *   hall and the main corridor and does the bed checks.
 * - The canteen guard walks the canteen and kitchen and watches meals.
 * - The wing guard walks the hall, the gym and the showers, watches showers, and searches
 *   cells at the morning shakedown.
 * - The yard guard walks the yard and the main corridor, watches exercise (P33: on the sports
 *   ground), and at night the yard.
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
    about: { nick: 'BISHOP', home: 'POOLE', team: 'PIRATES' },
    beat: [
      { x: 26, z: 46, wait: 25, face: 1 },
      { x: 25, z: 40, wait: 3, face: 13 },
      { x: 30, z: 23, wait: 4, face: 5 },
    ],
    posts: { rollCall: { x: 35, z: 22, face: 5 }, eveningRollCall: { x: 35, z: 22, face: 5 } },
    night: [
      { x: 9, z: 14, wait: 4, face: 1 },
      { x: 50, z: 15, wait: 4, face: 9 },
      { x: 37, z: 23, wait: 3, face: 9 },
      { x: 50, z: 40, wait: 3, face: 9 },
      { x: 9, z: 39, wait: 3, face: 1 },
    ],
    duties: ['bedCheck'],
    key: 'red',
  },
  {
    name: 'Finch',
    about: { nick: 'BIRDY', home: 'BRISTOL', team: 'ROBINS' },
    beat: [
      // (P33 review: the beat kept off the yard's door, the canteen just south of the yard now.)
      { x: 29, z: 32, wait: 3, face: 1 },
      { x: 34, z: 32, wait: 3, face: 9 },
      { x: 24, z: 30, wait: 3, face: 1 },
      { x: 32, z: 36, wait: 3, face: 13 },
    ],
    posts: { breakfast: { x: 34, z: 28, face: 7 }, dinner: { x: 34, z: 28, face: 7 } },
    key: 'cyan',
  },
  {
    name: 'Pike',
    about: { nick: 'RULER', home: 'CHESTER', team: 'BLADES' },
    trait: 'strict',
    beat: [
      { x: 12, z: 15, wait: 3, face: 1 },
      { x: 29, z: 18, wait: 3, face: 13 },
      { x: 38, z: 31, wait: 3, face: 5 },
      { x: 37, z: 35, wait: 3, face: 1 },
      { x: 45, z: 14, wait: 3, face: 9 },
    ],
    posts: { showers: { x: 38, z: 34, face: 5 } },
    duties: ['shakedown'],
    key: 'yellow',
  },
  {
    name: 'Penrose',
    about: { nick: 'SLOTH', home: 'TRURO', team: 'CORNISH' },
    trait: 'lazy',
    beat: [
      { x: 23, z: 24, wait: 3, face: 1 },
      { x: 42, z: 22, wait: 3, face: 9 },
      { x: 50, z: 39, wait: 3, face: 9 },
      { x: 9, z: 40, wait: 3, face: 1 },
    ],
    posts: { exercise: { x: 20, z: 26, face: 9 } },
    night: [
      { x: 23, z: 23, wait: 4, face: 1 },
      { x: 41, z: 26, wait: 4, face: 9, nap: true },
    ],
    key: 'green',
  },
  {
    name: 'Quill',
    about: { nick: 'FIDDLER', home: 'MARGATE', team: 'MAGPIES' },
    trait: 'corrupt',
    beat: [
      { x: 44, z: 30, wait: 3, face: 5 },
      { x: 44, z: 36, wait: 3, face: 1 },
      { x: 22, z: 45, wait: 3, face: 1 },
      { x: 11, z: 45, wait: 3, face: 5 },
      { x: 17, z: 45, wait: 3, face: 5 },
    ],
    key: 'cyan',
  },
  {
    name: 'Mercer',
    about: { nick: 'TAILOR', home: 'GRIMSBY', team: 'TIGERS' },
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
    about: { nick: 'SPIKE', home: 'DOVER', team: 'CLARETS' },
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
    about: { nick: 'SKIPPER', home: 'WHITBY', team: 'BOROUGH' },
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
    dog: { name: 'Admiral', kennel: { x: 51, z: 45, face: 9 }, night: true, coat: 'shepherd' },
  },
  {
    name: 'Doyle',
    about: { nick: 'ANCHOR', home: 'WEXFORD', team: 'SAINTS' },
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
    about: { nick: 'RAVEN', home: 'LEEDS', team: 'RANGERS' },
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
    // The yard (P33: its east two thirds, five tiles deep: the roofs' chasm).
    ['yard', 23, 22, 42, 26],
    ['rollCall', 27, 23, 42, 25],
    // The middle block (P33: east of the sports ground).
    ['kitchen', 23, 28, 26, 37],
    ['canteen', 28, 27, 34, 38],
    ['gym', 36, 27, 40, 32],
    ['showers', 36, 33, 40, 37],
    ['laundry', 42, 27, 46, 32],
    ['mailroom', 42, 33, 46, 38],
    ['infirmary', 48, 28, 51, 32],
    ['library', 48, 33, 51, 38],
    // The main corridor, then the south block.
    ['corridor', 8, 39, 51, 40],
    ['woodshop', 8, 42, 13, 50],
    ['metalshop', 15, 42, 20, 50],
    ['janitor', 22, 42, 23, 50],
    ['controlRoom', 25, 42, 28, 50],
    ['helipad', 33, 42, 40, 50],
    ['generator', 42, 42, 46, 50],
    ['guardQuarters', 48, 42, 51, 50],
    // P33: the sports ground in the yard's west third, down to the corridor; the garden at the
    // yard's east end.
    ['sports', 8, 22, 21, 37],
    ['garden', 44, 22, 51, 26],
  ],
  cells,
  props,
  rollCall,
  spawn: { x: 10, z: 11 },
  reachable: ['cellBlock', 'rollCall', 'yard', 'canteen', 'gym', 'showers', 'library', 'infirmary', 'corridor', 'sports', 'garden'],
  guards,
  names: ['Brick', 'Gull', 'Barnacle', 'Fog', 'Anchor', 'Tide', 'Crab', 'Mutton', 'Bosun', 'Kipper', 'Shanty', 'Rook', 'Granite'],
  merchants: [2, 6, 9, 13],
  crew: ['muscle', 'lookout', 'digger', 'lookout', 'muscle', 'smuggler', 'digger', 'muscle', 'lookout', 'smuggler', 'lookout', 'smuggler', 'digger'],
  // The player starts in the woodshop (its timber and balsa make braces and rafts); every job is on offer, the mailroom open.
  jobs: [
    { id: 'woodshop', cell: 1 },
    { id: 'kitchen', cell: 3 },
    { id: 'laundry', cell: 5 },
    { id: 'metalshop', cell: 8 },
    { id: 'janitor', cell: 11 },
    { id: 'mailman', cell: 0 },
    { id: 'gardener', cell: 7 },
  ],
  // Cameras (on GEN-1): both ends of the hall and of the main corridor, the control room, both generator rooms, the sally port.
  cameras: [
    { x: 8, z: 14, face: 1 },
    { x: 51, z: 15, face: 9 },
    { x: 8, z: 39, face: 1 },
    { x: 51, z: 40, face: 9 },
    { x: 25, z: 42, face: 3 },
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
  // (P24: waved out through the ferry gate at the shift change, the drawbridge lowered.)
  escapes: ['raft', 'helicopter', 'takeover', 'stowaway', 'bluff', 'paperwork'],
  // The checkpoint (P24): the gatekeeper's booth on the rock outside the ferry gate, beside the
  // drawbridge; papers are shown from the walkway, and waved through, the gate opens and the
  // drawbridge comes down.
  checkpoint: {
    window: [
      { x: 30, z: 54 },
      { x: 31, z: 54 },
    ],
    gates: [
      { x: 30, z: 55 },
      { x: 31, z: 55 },
    ],
    bridge: true,
    booth: { x: 32, z: 56, face: 9 },
  },
  // Delivery day (P18): the supply helicopter sets down on its pad by day too, the court's gate
  // propped open for the porters from the sally port; the west helipad guard walks round it,
  // and searches it four days in five.
  delivery: {
    vehicle: 'helicopter',
    bay: [35, 44, 38, 47],
    tail: { x: 36, z: 48 },
    face: 13,
    open: [{ x: 32, z: 46 }],
    supervisor: 8,
    round: [
      { x: 34, z: 49, wait: 5, face: 1 },
      { x: 33, z: 45, wait: 4, face: 1 },
      { x: 36, z: 42, wait: 4, face: 5 },
      { x: 33, z: 45, wait: 3, face: 5 },
    ],
    thorough: 80,
    road: [
      { x: 37, z: 30 },
      { x: 37, z: 46 },
    ],
  },
  // GEN-1 (north block) runs the detectors and cameras; GEN-2 (south block) the dock's fence, the searchlights and the lamps.
  grid: [
    ['detectors', 'cameras'],
    ['fence', 'searchlights', 'lights'],
  ],
  // The roofs south of the yard: a grapnel swings across the chasm onto them from the north block's.
  landings: [[7, 27, 52, 51]],
  drawbridge: [30, 56, 31, 58],
  // Smuggling (P21): Rook sells burner phones; the drone drops on the roll call box in the
  // yard; visitors (off the ferry) sit in the canteen.
  smuggling: { fixer: 13, drop: [27, 23, 42, 25], visits: [28, 27, 34, 38] },
  // Free time (P27): the old-timer who plays checkers; the hoop, the pitch and its track on the
  // sports ground, the beds in the garden (P33).
  leisure: {
    hoop: court(10, 22, 5),
    oldTimer: 4,
    garden: { x: 44, z: 22, w: 6, d: 2 },
    race: { x: 26, z: 15, dir: 1, len: 6 },
    // (Two rows clear along the corridor's wall, which would hide the track's lane from the camera.)
    pitch: pitch(9, 29, 12, 6),
    track: { x: 8, z: 28, w: 14, d: 8 },
    stage: stage(30, 37, 13),
    quiz: quizAt(5, [48, 35], [49, 35], [50, 35], [51, 35]),
  },
  // Rebuilt in 2.9 (P33): the sports ground in the yard's west third, the garden at its east end.
  // The pay phone (P34): on the corridor's north wall, its queue along it; the front gate's inside for Lou's diversion, the road for his car.
  // (P36: the release reported at the corridor's south doors, then out through the ferry gate, the drawbridge lowered.)
  comms: comms([40, 39, 13], [[39, 39], [38, 39], [37, 39], [36, 39]], [30, 54], [32, 60, 9], [48, 34, 13], { at: [[30, 40], [31, 40]], gates: [[30, 41], [31, 41], [30, 51], [31, 51], [30, 55], [31, 55]], bridge: true }),
  map: 1,
};
