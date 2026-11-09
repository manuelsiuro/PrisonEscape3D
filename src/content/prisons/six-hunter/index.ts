import { comms } from '../../phone';
import { court } from '../../leisure';
import { pitch } from '../../team';
import { quizAt, stage } from '../../nights';
import { AIM, type PropPlacement } from '../../props';
import type { GuardDef, PrisonDef, Rect } from '../types';
import { L0 } from './L0.map';
import { L1 } from './L1.map';
import { LM1 } from './Lm1.map';
import { SIX_HUNTER_DECOR } from './decor';

/**
 * Cells: two rows either side of the cell wing's hall, seven on the north side (doors south),
 * five on the south side (doors north) either side of the vestibule down to the yard (in the
 * middle, so nobody's walk home is long), solitary at the south row's east end. Each cell has
 * the bed along its west wall, the desk in the far corner from the door with the chair before
 * it, the toilet in the near corner. Cell 1, the player's, is the north row's first: against
 * the north-west corner, the river beyond the fence to the north, the granite ledge under it.
 */
const cells: Rect[] = [];
const props: PropPlacement[] = [];
const cell = (x0: number, z0: number, doorSouth: boolean) => {
  cells.push([x0, z0, x0 + 3, z0 + 3]);
  props.push(
    ...((doorSouth
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
        ]) as PropPlacement[]),
  );
};
for (let x0 = 8; x0 <= 38; x0 += 5) cell(x0, 9, true);
for (const x0 of [8, 13, 18, 28, 33]) cell(x0, 17, false);

props.push(
  // Solitary, at the south row's east end.
  { kind: 'bed', x: 41, z: 18, d: 2 },
  // The boathouse (the net mender's): the bin of torn nets by the door, two net frames, the bin the mended ones go in by the river door.
  { kind: 'bin', x: 43, z: 10 },
  { kind: 'netFrame', x: 46, z: 11, w: 2 },
  { kind: 'netFrame', x: 51, z: 11, w: 2 },
  { kind: 'bin', x: 54, z: 9 },
  // The generator room, and the ladder up to the roof (and the vents' end) against its east wall.
  { kind: 'generator', x: 48, z: 16, w: 2, d: 2 },
  { kind: 'ladder', x: 54, z: 15 },
  // The kitchen: the freezer, two ovens, the counter the meals go out on.
  { kind: 'freezer', x: 30, z: 22, d: 2, rot: 1 },
  { kind: 'oven', x: 32, z: 22 },
  { kind: 'oven', x: 33, z: 22 },
  { kind: 'counter', x: 35, z: 26, d: 3, rot: 3 },
  // The Trophy Hall: four tables in two aisles, benches either side, the serving counter along the kitchen wall.
  ...[25, 29].flatMap((z) =>
    [40, 46].flatMap((x) => [
      { kind: 'table', x, z, w: 3 } as const,
      { kind: 'seat', x, z: z - 1, w: 3 } as const,
      { kind: 'seat', x, z: z + 1, w: 3, rot: 2 } as const,
    ]),
  ),
  { kind: 'counter', x: 37, z: 24, d: 4, rot: 1 },
  // The yard: benches against the cell wing and the corridor's wall.
  { kind: 'bench', x: 16, z: 22, w: 2 },
  { kind: 'bench', x: 20, z: 31, w: 2, rot: 2 },
  // The garden at the yard's west end: the tool shed, the planters, the crate by the gate.
  { kind: 'toolShed', x: 8, z: 22, w: 2, d: 2 },
  { kind: 'planter', x: 8, z: 25, w: 2 },
  { kind: 'planter', x: 11, z: 25, w: 2 },
  { kind: 'planter', x: 8, z: 28, w: 2 },
  { kind: 'planter', x: 11, z: 28, w: 2 },
  { kind: 'crate', x: 13, z: 24 },
  // The gym: treadmills, weights, the job board.
  { kind: 'treadmill', x: 8, z: 37, d: 2 },
  { kind: 'treadmill', x: 8, z: 40, d: 2 },
  { kind: 'weights', x: 12, z: 38 },
  { kind: 'weights', x: 12, z: 41 },
  { kind: 'jobBoard', x: 12, z: 43, rot: 3 },
  // The showers: heads along both walls.
  ...[38, 40, 42].flatMap((z) => [{ kind: 'shower', x: 14, z, rot: 1 } as const, { kind: 'shower', x: 17, z, rot: 3 } as const]),
  // The library: shelves, the table (its chairs, the quiz's places south of it).
  { kind: 'shelf', x: 21, z: 36, w: 2 },
  { kind: 'shelf', x: 19, z: 44, w: 2 },
  { kind: 'table', x: 20, z: 40, w: 2 },
  // The gatehouse: the visiting counter, stools either side.
  { kind: 'counter', x: 25, z: 40, w: 4 },
  ...[25, 26, 27, 28].flatMap((x) => [{ kind: 'chair', x, z: 39, rot: 0 } as const, { kind: 'chair', x, z: 41, rot: 2 } as const]),
  // The infirmary.
  { kind: 'bed', x: 31, z: 37, d: 2 },
  { kind: 'bed', x: 33, z: 37, d: 2 },
  // The laundry: the dirty bin, three washers, the clean bin.
  { kind: 'bin', x: 38, z: 36 },
  { kind: 'washer', x: 35, z: 41 },
  { kind: 'washer', x: 36, z: 41 },
  { kind: 'washer', x: 37, z: 41 },
  { kind: 'bin', x: 38, z: 44 },
  // The smokehouse: the freezer of fish, two smokers, the counter the smoked fish go out on.
  { kind: 'freezer', x: 44, z: 36, d: 2, rot: 3 },
  { kind: 'smoker', x: 40, z: 39 },
  { kind: 'smoker', x: 40, z: 42 },
  { kind: 'counter', x: 44, z: 42, d: 2, rot: 3 },
  // The kennels (open to their run): the feed bin, two troughs, the bin by the run the bowls go in.
  { kind: 'bin', x: 46, z: 36 },
  { kind: 'trough', x: 49, z: 39, w: 2 },
  { kind: 'trough', x: 49, z: 42, w: 2 },
  { kind: 'bin', x: 54, z: 44 },
  // The Hunters' quarters: four bunks, the table where the tally is kept.
  ...[30, 32, 34, 36].map((x) => ({ kind: 'bed', x, z: 48, d: 2 }) as const),
  { kind: 'table', x: 32, z: 52, w: 2 },
  // The sports ground: the weights corner by the drive's fence, a lamp over it; bleachers along the gym's wall.
  { kind: 'weights', x: 21, z: 54 },
  { kind: 'pullup', x: 22, z: 54, w: 2 },
  { kind: 'lamp', x: 24, z: 54, aim: AIM.NW },
  { kind: 'bleachers', x: 20, z: 46, w: 3 },
  // Lamps: the yard's corners, the sports ground's, the drive's, the kennel run's, the hunting grounds'.
  ...[
    [15, 22, AIM.SE],
    [28, 22, AIM.SW],
    [28, 31, AIM.NW],
    [38, 54, AIM.NE],
    [54, 54, AIM.NW],
    [6, 20, AIM.W],
    [6, 44, AIM.W],
    [56, 20, AIM.E],
    [56, 44, AIM.E],
    [20, 7, AIM.N],
    [40, 7, AIM.N],
  ].map(([x, z, aim]) => ({ kind: 'lamp', x, z, aim }) as const),
);

/** The library's chairs, the librarian's at the end of the table, the gym's bag and mat: not solid. */
const GEAR: PropPlacement[] = [
  { kind: 'punchingBag', x: 11, z: 36 },
  { kind: 'mat', x: 10, z: 40, d: 2 },
  { kind: 'deskChair', x: 19, z: 40, rot: 1 },
  { kind: 'readChair', x: 22, z: 40, rot: 3 },
  { kind: 'readChair', x: 20, z: 39 },
];

/** Two rows of six in the middle of the yard, facing the Huntmaster at its west side. */
// (2.37: a tile further west, the zone a tile wider, so a tile of yard lies round the squares on every side; the wall stands
// just past x 28. Before, x 18 to 28: the east column on the zone's edge, under its painted line.)
const rollCall = [24, 26].flatMap((z) => [17, 19, 21, 23, 25, 27].map((x) => ({ x, z })));
const rollCall236 = [24, 26].flatMap((z) => [18, 20, 22, 24, 26, 28].map((x) => ({ x, z })));

/**
 * The Six (the Master of the Hunt's own), each with a hound. Directions: 1 east, 5 south, 9 west, 13 north.
 * - Garrow, the Huntmaster: walks the cell wing and the yard, takes roll call, and at night walks
 *   the hall, the yard and the corridor and does the bed checks. His recall horn on his belt.
 * - Fell (strict): the hall, the showers and the library; watches the showers; searches the cells at
 *   the morning shakedown (and carries the release forms).
 * - Bracken (lazy): the yard and the sports ground, watches exercise there; at night the yard,
 *   dozing on the bench by the corridor.
 * - Harrow (corrupt): the Trophy Hall and the kitchen, watches meals.
 * - Larch: the boathouse, the generator room, the smokehouse and the kennels; at night the
 *   hunting grounds, all round the lodge.
 * - Quiller: the gatehouse, the infirmary, the laundry and the gym; signs the delivery off.
 * Fell, Harrow and Quiller sleep in the Hunters' quarters. Their hounds work nights with them.
 * Keys: Garrow red (solitary, the quarters, the boathouse's river door), Fell yellow (cell doors after
 * dark), Bracken green (the gates: the garden's, the sports ground's, the gatehouse's to the drive), Harrow
 * and Quiller cyan (the work rooms), Larch purple (the generator room).
 */
const guards: GuardDef[] = [
  {
    name: 'Garrow',
    about: { nick: 'GAFFER', home: 'KENDAL', team: 'HOUNDS' },
    beat: [
      { x: 12, z: 15, wait: 3, face: 1 },
      { x: 36, z: 14, wait: 3, face: 9 },
      { x: 24, z: 18, wait: 3, face: 5 },
      { x: 21, z: 29, wait: 4, face: 13 },
    ],
    posts: { rollCall: { x: 16, z: 25, face: 1 }, eveningRollCall: { x: 16, z: 25, face: 1 } },
    night: [
      { x: 16, z: 15, wait: 4, face: 1 },
      { x: 40, z: 15, wait: 4, face: 9 },
      { x: 25, z: 19, wait: 3, face: 5 },
      { x: 22, z: 27, wait: 3, face: 9 },
      { x: 40, z: 34, wait: 3, face: 9 },
      { x: 12, z: 33, wait: 3, face: 1 },
    ],
    duties: ['bedCheck'],
    key: 'red',
    kit: ['recall_horn'],
    dog: { name: 'Duchess', kennel: { x: 40, z: 47, face: 5 }, night: true, coat: 'bloodhound' },
  },
  {
    name: 'Fell',
    about: { nick: 'LEDGER', home: 'HEXHAM', team: 'STAGS' },
    trait: 'strict',
    beat: [
      { x: 20, z: 14, wait: 3, face: 1 },
      { x: 31, z: 15, wait: 3, face: 13 },
      { x: 16, z: 37, wait: 3, face: 5 },
      { x: 21, z: 38, wait: 3, face: 9 },
    ],
    posts: { showers: { x: 16, z: 37, face: 5 } },
    duties: ['shakedown'],
    key: 'yellow',
    dog: { name: 'Rascal', kennel: { x: 43, z: 47, face: 5 }, coat: 'foxhound' },
  },
  {
    name: 'Bracken',
    about: { nick: 'SNOOZE', home: 'ALSTON', team: 'OTTERS' },
    trait: 'lazy',
    beat: [
      { x: 18, z: 29, wait: 3, face: 1 },
      { x: 27, z: 23, wait: 3, face: 9 },
      { x: 16, z: 50, wait: 3, face: 1 },
      { x: 10, z: 33, wait: 3, face: 1 },
    ],
    posts: { exercise: { x: 20, z: 47, face: 9 } },
    night: [
      { x: 16, z: 23, wait: 4, face: 1 },
      { x: 22, z: 30, wait: 4, face: 13, nap: true },
    ],
    key: 'green',
    dog: { name: 'Pudding', kennel: { x: 46, z: 47, face: 5 }, night: true, coat: 'retriever' },
  },
  {
    name: 'Harrow',
    about: { nick: 'TRADER', home: 'PENRITH', team: 'FALCONS' },
    trait: 'corrupt',
    beat: [
      { x: 39, z: 23, wait: 3, face: 1 },
      { x: 50, z: 27, wait: 3, face: 9 },
      { x: 32, z: 27, wait: 3, face: 1 },
      { x: 44, z: 31, wait: 3, face: 13 },
    ],
    posts: { breakfast: { x: 51, z: 27, face: 9 }, dinner: { x: 51, z: 27, face: 9 } },
    key: 'cyan',
    dog: { name: 'Tinker', kennel: { x: 49, z: 47, face: 5 }, coat: 'collie' },
  },
  {
    name: 'Larch',
    about: { nick: 'OWLET', home: 'KESWICK', team: 'RAVENS' },
    beat: [
      { x: 47, z: 15, wait: 3, face: 1 },
      { x: 48, z: 10, wait: 3, face: 5 },
      { x: 42, z: 38, wait: 3, face: 9 },
      { x: 52, z: 38, wait: 3, face: 9 },
      { x: 46, z: 50, wait: 3, face: 13 },
    ],
    night: [
      { x: 5, z: 30, wait: 4, face: 1 },
      { x: 31, z: 57, wait: 4, face: 13 },
      { x: 57, z: 30, wait: 4, face: 9 },
      { x: 31, z: 57, wait: 4, face: 13 },
    ],
    key: 'purple',
    dog: { name: 'Brutus', kennel: { x: 52, z: 47, face: 5 }, night: true, coat: 'mastiff' },
  },
  {
    name: 'Quiller',
    about: { nick: 'SCRIBE', home: 'AMBLE', team: 'SWIFTS' },
    beat: [
      { x: 27, z: 37, wait: 4, face: 5 },
      { x: 32, z: 40, wait: 3, face: 9 },
      { x: 36, z: 38, wait: 3, face: 5 },
      { x: 10, z: 38, wait: 3, face: 1 },
    ],
    key: 'cyan',
    dog: { name: 'Smudge', kennel: { x: 54, z: 50, face: 9 }, coat: 'shepherd' },
  },
];

/** Level 6: the hunting grounds, past the campaign's five (2.36, docs/phases/9-six-hunter.md). */
export const SIX_HUNTER: PrisonDef = {
  id: 'six-hunter',
  difficulty: 6,
  theme: 'forest',
  decor: SIX_HUNTER_DECOR,
  ground: L0,
  vents: L1,
  under: LM1,
  zones: [
    // The cell wing: the hall and the vestibule, solitary.
    ['cellBlock', 8, 14, 41, 15],
    ['cellBlock', 23, 16, 26, 20],
    ['solitary', 38, 17, 41, 20],
    // The boathouse, the passage, the generator room.
    ['boathouse', 43, 9, 54, 12],
    ['corridor', 43, 14, 45, 20],
    ['generator', 47, 14, 54, 20],
    // The yard (roll call in its middle), the garden at its west end; the kitchen, the Trophy Hall.
    ['yard', 15, 22, 28, 31],
    ['rollCall', 16, 23, 28, 27],
    ['garden', 8, 22, 13, 31],
    ['kitchen', 30, 22, 35, 31],
    ['canteen', 37, 22, 54, 31],
    // The main corridor and the rooms off it.
    ['corridor', 8, 33, 54, 34],
    ['gym', 8, 36, 12, 44],
    ['showers', 14, 36, 17, 44],
    ['library', 19, 36, 22, 44],
    ['visitation', 24, 36, 29, 44],
    ['infirmary', 31, 36, 33, 44],
    ['laundry', 35, 36, 38, 44],
    ['smokehouse', 40, 36, 44, 44],
    ['kennels', 46, 36, 54, 44],
    // South: the sports ground, the Hunters' quarters, the kennel run.
    ['sports', 8, 46, 24, 54],
    ['guardQuarters', 29, 46, 36, 54],
    ['kennels', 38, 46, 54, 54],
    ['kennels', 50, 45, 52, 45],
  ],
  cells,
  props: [...props, ...GEAR, { kind: 'vending', x: 52, z: 22 }, { kind: 'cooler', x: 37, z: 31 }],
  vending: {
    x: 52,
    z: 22,
    line: [
      { x: 52, z: 23 },
      { x: 52, z: 24 },
      { x: 52, z: 25 },
      { x: 51, z: 25 },
    ],
  },
  menu: { x: 49, z: 22, w: 3 },
  cooler: {
    x: 37,
    z: 31,
    spots: [
      { x: 38, z: 31 },
      { x: 37, z: 30 },
    ],
  },
  rollCall,
  rollCallBefore237: { spots: rollCall236, zones: [[17, 23, 28, 27]] },
  spawn: { x: 9, z: 11 },
  reachable: [
    'cellBlock',
    'rollCall',
    'yard',
    'canteen',
    'corridor',
    'gym',
    'showers',
    'library',
    'infirmary',
    'visitation',
    'sports',
    'garden',
  ],
  guards,
  names: ['Badger', 'Wren', 'Stoat', 'Otter', 'Moth', 'Hare', 'Toad', 'Crow', 'Boar', 'Lynx', 'Fox'],
  merchants: [3, 6, 9, 12],
  // Gangs (2.36, session 16): the kitchen crew round Wren (the cook), the lifers round Moth (old Badger among them), the gym
  // rats round Crow; their tables in the Trophy Hall at dinner, their corners of the yard and the sports ground of an evening.
  gangs: [
    { id: 'kitchen', boss: 3, members: [3, 5, 8], table: [40, 24, 42, 26], corner: [23, 29, 27, 29] },
    { id: 'lifers', boss: 6, members: [6, 2, 11], table: [46, 28, 48, 30], corner: [15, 29, 16, 30] },
    { id: 'gymRats', boss: 9, members: [9, 10, 4], table: [46, 24, 48, 26], corner: [20, 52, 21, 53] },
  ],
  crew: ['muscle', 'lookout', 'digger', 'smuggler', 'muscle', 'lookout', 'digger', 'smuggler', 'muscle', 'lookout', 'digger'],
  // The player starts as the kennel hand (the pack fed from their hands); the boathouse's nets are open.
  jobs: [
    { id: 'kennels', cell: 1 },
    { id: 'kitchen', cell: 3 },
    { id: 'laundry', cell: 5 },
    { id: 'smokehouse', cell: 7 },
    { id: 'nets', cell: 0 },
    { id: 'gardener', cell: 9 },
  ],
  // Cameras: both ends of the main corridor, the generator room, the boathouse.
  cameras: [
    { x: 8, z: 33, face: 1 },
    { x: 54, z: 34, face: 9 },
    { x: 47, z: 14, face: 3 },
    { x: 43, z: 9, face: 3 },
  ],
  // The stands' searchlights at night, each sweeping the hunting grounds from its corner.
  searchlights: [
    [
      { x: 5, z: 32 },
      { x: 5, z: 9 },
      { x: 8, z: 6 },
      { x: 30, z: 6 },
    ],
    [
      { x: 31, z: 6 },
      { x: 55, z: 6 },
      { x: 57, z: 9 },
      { x: 57, z: 32 },
    ],
    [
      { x: 5, z: 33 },
      { x: 5, z: 55 },
      { x: 8, z: 57 },
      { x: 25, z: 57 },
    ],
    [
      { x: 28, z: 57 },
      { x: 55, z: 57 },
      { x: 57, z: 55 },
      { x: 57, z: 33 },
    ],
  ],
  // (No takeover: six Hunters and their hounds, and nowhere to rally. The fieldstone wall can't be chipped; the deer
  // fence, cut, gives onto the river: the raft or nothing.)
  escapes: ['raft', 'tunnel', 'glider', 'stowaway', 'bluff', 'paperwork', 'parole'],
  // Delivery day: the outfitter's truck backs up the drive to the gatehouse's doors (propped open while it's
  // unloaded); Quiller walks round it, and searches it one day in three.
  delivery: {
    vehicle: 'truck',
    bay: [26, 48, 27, 52],
    tail: { x: 26, z: 47 },
    face: 5,
    open: [
      { x: 26, z: 45 },
      { x: 27, z: 45 },
    ],
    supervisor: 5,
    round: [
      { x: 27, z: 47, wait: 5, face: 5 },
      { x: 26, z: 54, wait: 4, face: 13 },
      { x: 27, z: 56, wait: 5, face: 13 },
      { x: 26, z: 46, wait: 5, face: 5 },
    ],
    thorough: 30,
    road: [
      { x: 27, z: 68 },
      { x: 27, z: 50.5 },
    ],
  },
  // Smuggling: Fox sells burner phones; the drone drops on the yard's roll call box; visitors sit across the gatehouse's counter.
  smuggling: { fixer: 12, drop: [17, 23, 28, 27], visits: [24, 36, 29, 44] },
  // The checkpoint: papers shown at the foot of the drive, before the gate; the gatekeeper's booth on the grass west of it (off the truck's way).
  checkpoint: {
    window: [
      { x: 26, z: 58 },
      { x: 27, z: 58 },
    ],
    gates: [
      { x: 26, z: 59 },
      { x: 27, z: 59 },
    ],
    booth: { x: 25, z: 58, face: 1 },
  },
  leisure: {
    hoop: court(24, 50, 9),
    oldTimer: 2,
    garden: { x: 8, z: 30, w: 6, d: 2 },
    race: { x: 12, z: 14, dir: 1, len: 6 },
    pitch: pitch(9, 47, 10, 7),
    track: { x: 8, z: 46, w: 12, d: 9 },
    stage: stage(54, 28, 9),
    quiz: quizAt(13, [19, 42], [20, 42], [21, 42], [22, 42]),
    librarian: { cell: 8, x: 19, z: 40, face: 1 },
  },
  // The pay phone on the corridor's north wall, its queue along it; the gate's inside for Lou's diversion, the road for his car.
  // (The release reported at the gatehouse's south doors, then out through them and the gate.)
  comms: comms(
    [24, 33, 13],
    [
      [25, 33],
      [26, 33],
      [27, 33],
      [28, 33],
    ],
    [26, 58],
    [29, 61, 1],
    [19, 38, 9],
    {
      at: [
        [26, 44],
        [27, 44],
      ],
      gates: [
        [26, 45],
        [27, 45],
        [26, 59],
        [27, 59],
      ],
    },
  ),
  // The odd jobs board, on the Trophy Hall's north wall beside its door.
  board: { x: 42, z: 22, face: 13 },
  // (Built with its sports ground and garden from the start: the campaign's layout since P31–P33.)
  map: 1,
};
