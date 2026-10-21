import type { DecorPlacement } from '../../decor';

/** Table tops (props.ts), for things standing on them. */
const TABLE = 0.52;

/** The cells: a poster on the back wall (north row: the north wall; south row: the south wall), beside the bed. */
const cells: DecorPlacement[] = [
  ...[8, 13, 18, 23, 28, 33, 38, 43].map((x0, k) => ({ kind: (['poster', 'posterB', 'posterC'] as const)[k % 3], x: x0 + 1, z: 9 }) as const),
  ...[8, 13, 18, 23, 33, 38].map((x0, k) => ({ kind: (['posterC', 'poster', 'wallShelf'] as const)[k % 3], x: x0 + 1, z: 20, rot: 2 }) as const),
];

/** Warnings on the fortress wall facing the walkway, every so often. */
const walkway: DecorPlacement[] = [
  ...[18, 40].map((x) => ({ kind: 'warningSign', x, z: 7, rot: 2 }) as const),
  ...[18, 40].map((x) => ({ kind: 'warningSign', x, z: 52 }) as const),
  ...[14, 40].map((z) => ({ kind: 'warningSign', x: 6, z, rot: 3 }) as const),
  ...[14, 40].map((z) => ({ kind: 'warningSign', x: 53, z, rot: 1 }) as const),
];

/**
 * HMP Irongate dressed (P12): cells with their posters, the hall's clock and speakers, a
 * canteen with its menu and cooler, the gym's bag, the library's globe, the shops' racks,
 * the control room's monitors and key cabinet; the dock's bollards, crates, rope and life
 * rings; the helipad's windsock. Pieces keep clear of doors, stations and the ways between them.
 */
export const IRONGATE_DECOR: readonly DecorPlacement[] = [
  ...cells,
  ...walkway,
  // The hall: clocks, speakers, an extinguisher.
  { kind: 'clock', x: 24, z: 14 },
  { kind: 'speaker', x: 14, z: 14 },
  { kind: 'speaker', x: 44, z: 14 },
  { kind: 'extinguisher', x: 34, z: 15, rot: 2 },
  { kind: 'noticeBoard', x: 31, z: 17, rot: 3 },
  // The main corridor.
  { kind: 'clock', x: 30, z: 39 },
  { kind: 'speaker', x: 16, z: 40, rot: 2 },
  { kind: 'speaker', x: 40, z: 40, rot: 2 },
  { kind: 'extinguisher', x: 36, z: 39 },
  // Canteen: the menu, the water cooler, a vending machine, trays left on the tables.
  { kind: 'menuBoard', x: 33, z: 28, w: 2 },
  { kind: 'waterCooler', x: 34, z: 36 },
  { kind: 'vending', x: 28, z: 37, rot: 1 },
  { kind: 'trays', x: 30, z: 30, y: TABLE },
  { kind: 'trays', x: 34, z: 34, y: TABLE },
  // Kitchen: pans on the wall, the sink, a sack of potatoes.
  { kind: 'panRack', x: 24, z: 28, w: 2 },
  { kind: 'sink', x: 23, z: 34, rot: 1 },
  { kind: 'potatoes', x: 23, z: 36 },
  // Gym: the punching bag, dumbbells.
  { kind: 'punchingBag', x: 36, z: 32 },
  { kind: 'dumbbells', x: 39, z: 31 },
  // Showers: towel hooks, a mirror, the drains.
  { kind: 'towelHooks', x: 36, z: 35, rot: 1 },
  { kind: 'mirror', x: 40, z: 35, rot: 3 },
  { kind: 'drain', x: 37, z: 36 },
  { kind: 'drain', x: 39, z: 36 },
  // Library: books and a lamp on the table, a globe.
  { kind: 'books', x: 49, z: 36, y: TABLE },
  { kind: 'deskLamp', x: 50, z: 36, y: TABLE },
  { kind: 'globe', x: 51, z: 37 },
  // Infirmary: the medicine cabinet, a drip stand.
  { kind: 'medCabinet', x: 51, z: 31, rot: 3 },
  { kind: 'ivStand', x: 49, z: 28 },
  // Laundry: a basket, an ironing board.
  { kind: 'basket', x: 45, z: 28 },
  { kind: 'ironingBoard', x: 42, z: 30 },
  // Janitor's closet: the mop bucket, a wet-floor sign. Mailroom: pigeonholes, parcels, sacks.
  { kind: 'mopBucket', x: 23, z: 49 },
  { kind: 'wetSign', x: 23, z: 48 },
  { kind: 'pigeonholes', x: 42, z: 37, rot: 1 },
  { kind: 'parcels', x: 43, z: 37 },
  { kind: 'sacks', x: 45, z: 37 },
  // Woodshop: the tool rack, timber, a sawhorse. Metalshop: the rack, drums.
  { kind: 'toolRack', x: 12, z: 42, w: 2 },
  { kind: 'timber', x: 8, z: 49 },
  { kind: 'sawhorse', x: 10, z: 49 },
  { kind: 'toolRack', x: 16, z: 42, w: 2 },
  { kind: 'drum', x: 15, z: 50 },
  { kind: 'drum', x: 16, z: 50 },
  // Control room: the monitors, the key cabinet, the files.
  { kind: 'monitors', x: 27, z: 42, w: 2 },
  { kind: 'keyCabinet', x: 25, z: 48, rot: 1 },
  { kind: 'filing', x: 26, z: 50, rot: 2 },
  // GEN-1 and GEN-2: fuses and pipes.
  { kind: 'fuseBox', x: 49, z: 17 },
  { kind: 'pipes', x: 51, z: 19, rot: 3 },
  { kind: 'fuseBox', x: 45, z: 42 },
  { kind: 'pipes', x: 42, z: 49, rot: 1 },
  // Guard quarters: lockers, the TV.
  { kind: 'lockers', x: 50, z: 42 },
  { kind: 'tv', x: 49, z: 50, rot: 2 },
  // Solitary: the drain.
  { kind: 'drain', x: 50, z: 11 },
  // The yard: the flagpole. The sports ground (P33): the hoop on its post (its court), dumbbells
  // by the weights. The garden: the water butt by the gate.
  { kind: 'flagpole', x: 25, z: 25 },
  { kind: 'hoop', x: 10, z: 22 },
  { kind: 'dumbbells', x: 21, z: 22 },
  { kind: 'waterButt', x: 45, z: 26 },
  // The helipad court: the windsock, a life ring on the wall.
  { kind: 'windsock', x: 40, z: 42 },
  { kind: 'lifebuoy', x: 36, z: 50, rot: 2 },
  // The dock: bollards along the quay, crates, a coil of rope, life rings on the outer wall.
  { kind: 'bollard', x: 59, z: 26 },
  { kind: 'bollard', x: 59, z: 30 },
  { kind: 'crates', x: 57, z: 28 },
  { kind: 'crates', x: 58, z: 32 },
  { kind: 'ropeCoil', x: 58, z: 24 },
  { kind: 'lifebuoy', x: 57, z: 27, rot: 1 },
  { kind: 'lifebuoy', x: 57, z: 30, rot: 1 },
];
