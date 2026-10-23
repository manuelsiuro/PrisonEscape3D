import { comms } from '../../phone';
import { court } from '../../leisure';
import { pitch } from '../../team';
import { quizAt, stage } from '../../nights';
import type { PropPlacement } from '../../props';
import type { GuardDef, PrisonDef, Rect } from '../types';
import { L0 } from './L0.map';
import { L1 } from './L1.map';
import { SHANKTON_DECOR } from './decor';

/**
 * Cells: two wings of six, each two columns of three either side of a hall. West cells have
 * their door on the east wall, east cells on the west wall. Cell 1, the player's, is the
 * north wing's first (north-west corner, against the shell).
 */
const cells: Rect[] = [];
const props: PropPlacement[] = [];
const cell = (x0: number, z0: number, west: boolean) => {
  cells.push([x0, z0, x0 + 3, z0 + 3]);
  props.push(
    ...(west
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
for (const wing of [9, 41]) {
  for (const x0 of [9, 19]) for (const k of [0, 1, 2]) cell(x0, wing + k * 5, x0 === 9);
}

props.push(
  // Canteen: four long tables, benches either side, the serving counter on the east wall.
  ...[16, 20].flatMap((z) =>
    [26, 33].flatMap((x) => [
      { kind: 'table', x, z, w: 3 } as const,
      { kind: 'seat', x, z: z - 1, w: 3 } as const,
      { kind: 'seat', x, z: z + 1, w: 3, rot: 2 } as const,
    ]),
  ),
  { kind: 'counter', x: 39, z: 17, d: 3, rot: 3 },
  // Behind the canteen (P32: the rec ground took their block): the kitchen, the laundry, the janitor's closet.
  { kind: 'freezer', x: 24, z: 9, d: 2, rot: 1 },
  { kind: 'oven', x: 24, z: 12, rot: 2 },
  { kind: 'oven', x: 25, z: 12, rot: 2 },
  { kind: 'counter', x: 28, z: 9, w: 2 },
  { kind: 'bin', x: 31, z: 9 },
  { kind: 'washer', x: 32, z: 9 },
  { kind: 'washer', x: 33, z: 9 },
  { kind: 'washer', x: 34, z: 9 },
  { kind: 'bin', x: 35, z: 12 },
  { kind: 'bin', x: 37, z: 9 },
  { kind: 'shelf', x: 38, z: 9, w: 2 },
  // Showers: heads along the north and south walls.
  ...[9, 10, 11, 12].flatMap((x) => [{ kind: 'shower', x, z: 28 } as const, { kind: 'shower', x, z: 35, rot: 2 } as const]),
  // Gym.
  { kind: 'treadmill', x: 14, z: 29, d: 2 },
  { kind: 'treadmill', x: 16, z: 29, d: 2 },
  { kind: 'weights', x: 20, z: 34 },
  { kind: 'weights', x: 22, z: 34 },
  { kind: 'jobBoard', x: 22, z: 29, rot: 3 },
  // Woodshop.
  { kind: 'bin', x: 41, z: 28 },
  { kind: 'workbench', x: 42, z: 31, w: 2 },
  { kind: 'workbench', x: 45, z: 31, w: 2 },
  { kind: 'bin', x: 47, z: 35 },
  // Metalshop: the metal bin, two presses, the output bin.
  { kind: 'bin', x: 49, z: 28 },
  { kind: 'press', x: 50, z: 31, w: 2 },
  { kind: 'press', x: 53, z: 31, w: 2 },
  { kind: 'bin', x: 54, z: 35 },
  // Library.
  { kind: 'shelf', x: 24, z: 41, w: 3 },
  { kind: 'shelf', x: 28, z: 41, w: 3 },
  { kind: 'table', x: 25, z: 44, w: 2 },
  { kind: 'table', x: 28, z: 44, w: 2 },
  // Mailroom.
  { kind: 'sortingDesk', x: 24, z: 50, w: 3 },
  { kind: 'sortingDesk', x: 28, z: 50, w: 3 },
  { kind: 'shelf', x: 24, z: 54, w: 2, rot: 2 },
  // Infirmary.
  { kind: 'bed', x: 32, z: 41, d: 2 },
  { kind: 'bed', x: 33, z: 41, d: 2 },
  { kind: 'bed', x: 38, z: 41, d: 2 },
  // The generator room, and the ladder up through the vents to the roof (GDD §4.3: [GEN] [L]).
  { kind: 'generator', x: 33, z: 50, w: 2, d: 2 },
  { kind: 'ladder', x: 38, z: 49 },
  // Guard quarters: six bunks along the north wall, a table.
  ...[41, 43, 45, 49, 51, 53].map((x) => ({ kind: 'bed', x, z: 41, d: 2 }) as const),
  { kind: 'table', x: 48, z: 44, w: 2 },
  // Solitary.
  { kind: 'bed', x: 41, z: 53, d: 2, rot: 2 },
  { kind: 'bed', x: 46, z: 53, d: 2, rot: 2 },
  // The control room, by the main gate.
  { kind: 'controlDesk', x: 54, z: 49, d: 3, rot: 3 },
  // The courtyard's benches, along its south wall behind the roll call rows.
  { kind: 'bench', x: 34, z: 35, w: 2, rot: 2 },
  { kind: 'bench', x: 37, z: 35, w: 2, rot: 2 },
  // Chairs: the library's tables, the quarters' table, the control desk.
  ...[25, 26, 28, 29].map((x) => ({ kind: 'chair', x, z: 45, rot: 2 }) as const),
  ...[48, 49].map((x) => ({ kind: 'chair', x, z: 45, rot: 2 }) as const),
  { kind: 'chair', x: 53, z: 50, rot: 1 },
  // Lamps: the courtyard's north-east corner, the rec ground's, the gravel round the shell.
  ...[
    [39, 28],
    [54, 13],
    [6, 6],
    [31, 6],
    [57, 6],
    [6, 31],
    [57, 31],
    [6, 57],
    [20, 57],
    [57, 57],
  ].map(([x, z]) => ({ kind: 'lamp', x, z }) as const),
  // The rec ground (P32): the court, the bleachers and the weights corner north of the track.
  // The garden plot (P32), walled in the courtyard's west end: the planters, the tool shed, the crate.
  { kind: 'bleachers', x: 47, z: 13, w: 5 },
  { kind: 'pullup', x: 50, z: 9, w: 2 },
  { kind: 'weights', x: 53, z: 10 },
  { kind: 'weights', x: 53, z: 12 },
  // (The beds and planters clear of the two rows the corridor's wall hides from the camera.)
  { kind: 'toolShed', x: 24, z: 28, w: 2, d: 2 },
  { kind: 'planter', x: 26, z: 28, w: 2 },
  { kind: 'planter', x: 28, z: 28, w: 2 },
  { kind: 'planter', x: 25, z: 33, w: 2 },
  { kind: 'planter', x: 27, z: 33, w: 2 },
  { kind: 'crate', x: 24, z: 30 },
);

/** Three rows of four in the courtyard east of the garden (P32), facing the warden at the north end. */
const rollCall = [30, 32, 34].flatMap((z) => [32, 34, 36, 38].map((x) => ({ x, z })));

/**
 * Eight guards (GDD §4.3). Directions: 1 east, 5 south, 9 west, 13 north.
 * - The warden walks the north wing and the courtyard, takes roll call, and at night walks
 *   both wings' halls and does the bed checks.
 * - The canteen guard watches meals and walks the canteen and kitchen.
 * - The wing guard walks the north wing's hall, the gym and showers (a dead end off the north
 *   corridor: its post is a step away), watches showers, and searches cells at the morning
 *   shakedown.
 * - The yard guard walks the courtyard and both corridors, watches exercise (from the rec
 *   ground, P32), and at night walks the corridors.
 * - The workshop guard walks the laundry, the janitor's closet (behind the canteen since P32) and the shops.
 * - The south guard walks the library, mailroom, infirmary and generator room.
 * - The staff guard keeps the quarters, solitary and the control room.
 * - The corridor guard walks the two security corridors, day and night.
 * The canteen, wing, workshop, south and staff guards sleep in the quarters at night.
 * Keys (GDD §10.2): the warden and the staff guard red (staff rooms, solitary), the canteen
 * and workshop guards cyan (kitchen, shops, laundry, janitor, mailroom), the wing and
 * corridor guards yellow (cell doors after dark), the yard guard green, the south guard
 * purple (the generator room).
 */
const guards: GuardDef[] = [
  {
    name: 'Crane',
    about: { nick: 'BIRDIE', home: 'TOLEDO', team: 'IRONMEN' },
    beat: [
      { x: 15, z: 10, wait: 3, face: 5 },
      { x: 16, z: 21, wait: 2, face: 13 },
      { x: 20, z: 25, wait: 3, face: 1 },
      { x: 36, z: 29, wait: 3, face: 5 },
    ],
    posts: { rollCall: { x: 35, z: 28, face: 5 }, eveningRollCall: { x: 35, z: 28, face: 5 } },
    night: [
      { x: 15, z: 10, wait: 4, face: 5 },
      { x: 16, z: 22, wait: 3, face: 13 },
      { x: 15, z: 42, wait: 3, face: 5 },
      { x: 16, z: 53, wait: 4, face: 13 },
    ],
    duties: ['bedCheck'],
    key: 'red',
  },
  {
    name: 'Sully',
    about: { nick: 'MOOSE', home: 'BUFFALO', team: 'SABRES' },
    beat: [
      { x: 25, z: 15, wait: 4, face: 5 },
      { x: 37, z: 15, wait: 3, face: 9 },
      { x: 37, z: 21, wait: 3, face: 13 },
      { x: 27, z: 10, wait: 3, face: 5 },
    ],
    posts: { breakfast: { x: 31, z: 18, face: 13 }, dinner: { x: 31, z: 18, face: 13 } },
    key: 'cyan',
  },
  {
    name: 'Ortega',
    about: { nick: 'PADRE', home: 'LAREDO', team: 'MINERS' },
    trait: 'strict',
    beat: [
      { x: 16, z: 21, wait: 2, face: 13 },
      { x: 18, z: 31, wait: 3, face: 5 },
      { x: 11, z: 31, wait: 2, face: 1 },
      { x: 20, z: 25, wait: 3, face: 1 },
    ],
    posts: { showers: { x: 12, z: 32, face: 9 } },
    duties: ['shakedown'],
    key: 'yellow',
  },
  {
    name: 'Briggs',
    about: { nick: 'PILLOW', home: 'AKRON', team: 'ROCKETS' },
    trait: 'lazy',
    beat: [
      { x: 30, z: 25, wait: 3, face: 5 },
      { x: 37, z: 31, wait: 3, face: 9 },
      { x: 31, z: 34, wait: 3, face: 13 },
      { x: 45, z: 38, wait: 2, face: 9 },
      { x: 30, z: 38, wait: 2, face: 13 },
    ],
    posts: { exercise: { x: 49, z: 11, face: 5 } },
    night: [
      { x: 30, z: 25, wait: 3, face: 9 },
      { x: 45, z: 25, wait: 3, face: 9 },
      { x: 36, z: 31, wait: 3, face: 9 },
      { x: 45, z: 38, wait: 3, face: 9, nap: true },
      { x: 30, z: 38, wait: 3, face: 13 },
    ],
    key: 'green',
  },
  {
    name: 'Gibbs',
    about: { nick: 'GRIFTER', home: 'CAMDEN', team: 'SHARKS' },
    trait: 'corrupt',
    beat: [
      { x: 44, z: 25, wait: 2, face: 5 },
      { x: 44, z: 30, wait: 3, face: 5 },
      { x: 51, z: 30, wait: 3, face: 5 },
      { x: 33, z: 10, wait: 3, face: 13 },
      { x: 38, z: 11, wait: 3, face: 13 },
    ],
    key: 'cyan',
  },
  {
    name: 'Hale',
    about: { nick: 'HAMMER', home: 'FLINT', team: 'PISTONS' },
    beat: [
      { x: 27, z: 43, wait: 3, face: 5 },
      { x: 27, z: 52, wait: 3, face: 13 },
      { x: 35, z: 44, wait: 3, face: 5 },
      { x: 36, z: 52, wait: 3, face: 9 },
      { x: 30, z: 38, wait: 2, face: 1 },
    ],
    key: 'purple',
  },
  {
    name: 'Novak',
    about: { nick: 'GADGET', home: 'YONKERS', team: 'WELDERS' },
    beat: [
      { x: 47, z: 43, wait: 3, face: 5 },
      { x: 44, z: 51, wait: 3, face: 13 },
      { x: 51, z: 51, wait: 3, face: 13 },
      { x: 50, z: 38, wait: 2, face: 9 },
    ],
    key: 'red',
  },
  {
    name: 'Duffy',
    about: { nick: 'BOOMER', home: 'DUBLIN', team: 'ROVERS' },
    beat: [
      { x: 20, z: 38, wait: 3, face: 1 },
      { x: 50, z: 38, wait: 3, face: 9 },
      { x: 50, z: 25, wait: 3, face: 9 },
      { x: 20, z: 25, wait: 3, face: 1 },
    ],
    night: [
      { x: 20, z: 25, wait: 4, face: 1 },
      { x: 50, z: 26, wait: 3, face: 9 },
      { x: 50, z: 38, wait: 3, face: 9 },
      { x: 20, z: 39, wait: 4, face: 1 },
    ],
    key: 'yellow',
    dog: { name: 'Brutus', kennel: { x: 41, z: 44, face: 1 }, night: true, coat: 'mastiff' },
  },
];

/** Level 3: high security, an industrial megaprison (GDD §4.3). */
export const SHANKTON: PrisonDef = {
  id: 'shankton',
  difficulty: 3,
  theme: 'industrial',
  decor: SHANKTON_DECOR,
  ground: L0,
  vents: L1,
  zones: [
    ['cellBlock', 14, 9, 17, 23],
    ['cellBlock', 14, 40, 17, 54],
    ['canteen', 24, 14, 39, 22],
    ['canteen', 31, 23, 32, 23],
    // P32: the kitchen, laundry and janitor's closet behind the canteen; the rec ground in their old block.
    ['kitchen', 24, 9, 29, 12],
    ['laundry', 31, 9, 35, 12],
    ['janitor', 37, 9, 39, 12],
    ['sports', 41, 9, 54, 22],
    ['corridor', 9, 24, 54, 26],
    ['corridor', 9, 37, 54, 39],
    ['showers', 9, 28, 12, 35],
    ['gym', 14, 28, 22, 35],
    ['yard', 24, 27, 39, 36],
    // P32: the walled garden plot in the courtyard's west end; roll call east of it.
    ['garden', 24, 28, 29, 35],
    ['rollCall', 31, 29, 39, 34],
    ['woodshop', 41, 28, 47, 35],
    ['metalshop', 49, 28, 54, 35],
    ['library', 24, 41, 30, 46],
    ['mailroom', 24, 48, 30, 54],
    ['infirmary', 32, 41, 39, 46],
    ['generator', 32, 48, 39, 54],
    ['guardQuarters', 41, 41, 54, 46],
    ['solitary', 41, 48, 46, 54],
    ['controlRoom', 48, 48, 54, 54],
    // The gatehouse astride both fences (walls and all): perimeter, like the gravel round it.
    ['perimeter', 48, 58, 55, 62],
  ],
  cells,
  props,
  rollCall,
  spawn: { x: 10, z: 10 },
  reachable: ['cellBlock', 'corridor', 'rollCall', 'yard', 'canteen', 'gym', 'showers', 'library', 'infirmary', 'sports', 'garden'],
  guards,
  names: ['Rivet', 'Hammer', 'Smokes', 'Knuckles', 'Deacon', 'Flint', 'Sparky', 'Moose', 'Weasel', 'Preacher', 'Lugnut'],
  merchants: [2, 6, 9, 11],
  crew: ['digger', 'muscle', 'smuggler', 'muscle', 'smuggler', 'digger', 'lookout', 'muscle', 'lookout', 'lookout', 'digger'],
  // The player starts in the metalshop (GDD §4.3); every job is on offer, the woodshop open.
  jobs: [
    { id: 'metalshop', cell: 1 },
    { id: 'kitchen', cell: 3 },
    { id: 'laundry', cell: 5 },
    { id: 'woodshop', cell: 0 },
    { id: 'janitor', cell: 8 },
    { id: 'mailman', cell: 10 },
    { id: 'gardener', cell: 7 },
  ],
  // Cameras in every corridor (GDD §4.3): both ends and two along each; and the generator room and quarters.
  cameras: [
    { x: 9, z: 24, face: 1 },
    { x: 54, z: 26, face: 9 },
    { x: 38, z: 24, face: 9 },
    { x: 28, z: 26, face: 1 },
    { x: 9, z: 39, face: 1 },
    { x: 54, z: 37, face: 9 },
    { x: 38, z: 39, face: 1 },
    { x: 28, z: 37, face: 9 },
    { x: 32, z: 48, face: 3 },
    { x: 54, z: 41, face: 7 },
  ],
  // Searchlights at night, one per corner tower (each path starts nearest its own tower),
  // sweeping its corner's two stretches of gravel.
  searchlights: [
    [
      { x: 6, z: 30 },
      { x: 6, z: 6 },
      { x: 30, z: 6 },
    ],
    [
      { x: 33, z: 6 },
      { x: 57, z: 6 },
      { x: 57, z: 30 },
    ],
    [
      { x: 6, z: 33 },
      { x: 6, z: 57 },
      { x: 30, z: 59 },
    ],
    [
      { x: 57, z: 33 },
      { x: 57, z: 57 },
      { x: 44, z: 57 },
    ],
  ],
  // The gates no key opens (a takeover does): the shell's, and the gatehouse's either side.
  gates: [51, 52].flatMap((x) => [55, 58, 62].map((z) => ({ x, z }))),
  // (P24: waved out through the shell's gate and the gatehouse at the shift change; a glider off the shell with a strong wind behind it.)
  escapes: ['fence', 'tunnel', 'roof', 'takeover', 'bluff', 'glider', 'paperwork', 'parole'],
  // The checkpoint (P24): the gatekeeper's booth on the gravel just outside the shell's gate;
  // papers are shown from the control room, and waved through, the shell's gate and both of the
  // gatehouse's open.
  checkpoint: {
    window: [
      { x: 51, z: 54 },
      { x: 52, z: 54 },
    ],
    gates: [51, 52].flatMap((x) => [55, 58, 62].map((z) => ({ x, z }))),
    booth: { x: 54, z: 56, face: 9 },
  },
  // Smuggling (P21): Deacon sells burner phones; the drone drops on the roll call square in the
  // yard inside the shell; visitors sit in the canteen.
  smuggling: { fixer: 6, drop: [31, 29, 39, 34], visits: [24, 14, 39, 22] },
  // Free time (P27): the old-timer who plays checkers; the hoop, the pitch and its track on the rec ground, the beds in the garden (P32).
  leisure: {
    hoop: court(44, 9, 5),
    oldTimer: 7,
    garden: { x: 24, z: 31, w: 6, d: 2 },
    race: { x: 15, z: 12, dir: 5, len: 6 },
    // (A row clear along the south wall, which would hide the track's lane from the camera.)
    pitch: pitch(42, 15, 12, 6),
    track: { x: 41, z: 14, w: 14, d: 8 },
    stage: stage(31, 14, 5),
    quiz: quizAt(5, [25, 42], [26, 42], [28, 42], [29, 42]),
  },
  // Rebuilt in 2.8 (P32): the rec ground in the kitchen's old block, the garden plot in the courtyard.
  // The pay phone (P34): on the corridor's north wall, its queue along it; the front gate's inside for Lou's diversion, the road for his car.
  // (P36: the release reported at the staff door off the corridor, then through the quarters, the control room and the shell's gates.)
  comms: comms([36, 24, 13], [[37, 24], [38, 24], [39, 24], [40, 24]], [51, 54], [55, 63, 9], [24, 43, 9], { at: [[47, 39]], gates: [[47, 40], [51, 47], [51, 55], [52, 55], [51, 58], [52, 58], [51, 62], [52, 62]] }),
  // The odd jobs board (P40): on the canteen's north wall (brick behind it, not a door), clear of the stage and of the two rows a wall hides.
  board: { x: 25, z: 14, face: 13 },
  map: 1,
};
