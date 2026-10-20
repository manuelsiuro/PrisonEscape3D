import type { DecorPlacement } from '../../decor';

/** Table tops (props.ts), for things standing on them. */
const TABLE = 0.52;

/** Cabin cells: a poster or a shelf over the bunk's end, by turns (top row on the north wall, bottom row on the south). */
const cells: DecorPlacement[] = [5, 10, 15, 24, 29, 34].flatMap((x0, k) => [{ kind: k % 2 ? 'wallShelf' : 'posterB', x: x0 + 1, z: 7 } as const]);
const lower: DecorPlacement[] = [5, 10, 24, 29].map((x0, k) => ({ kind: k % 2 ? 'posterC' : 'wallShelf', x: x0 + 1, z: 19, rot: 2 }) as const);

/**
 * Stalag Flucht dressed (P9): log cabins with a stove corner, a mess hall, a gym with its
 * bag, workshops with their racks, a sick bay, the guards' barracks and the generator hut.
 * Pieces keep clear of doors, stations and the ways between them.
 */
export const STALAG_FLUCHT_DECOR: readonly DecorPlacement[] = [
  ...cells,
  ...lower,
  // Cabin halls: notices and a clock; an extinguisher by cabin A's east door.
  { kind: 'noticeBoard', x: 8, z: 12, w: 2 },
  { kind: 'clock', x: 13, z: 12 },
  { kind: 'extinguisher', x: 18, z: 12, rot: 3 },
  { kind: 'noticeBoard', x: 27, z: 12, w: 2 },
  { kind: 'clock', x: 32, z: 12 },
  // Cabin B's common room: books and a mug on the table, a drum stove in the corner.
  { kind: 'books', x: 35, z: 17, y: TABLE },
  { kind: 'coffee', x: 36, z: 17, y: TABLE },
  { kind: 'drum', x: 34, z: 19 },
  // Cabin A's storeroom: sacks, a drum, timber.
  { kind: 'sacks', x: 18, z: 19 },
  { kind: 'drum', x: 18, z: 17 },
  { kind: 'timber', x: 17, z: 16 },
  // Canteen: the menu, a water cooler, plants.
  { kind: 'menuBoard', x: 16, z: 30, w: 2 },
  { kind: 'waterCooler', x: 17, z: 35 },
  { kind: 'plant', x: 5, z: 35 },
  // Kitchen: pans on the wall, the sink, a sack of potatoes.
  { kind: 'panRack', x: 14, z: 37, w: 2 },
  { kind: 'sink', x: 17, z: 37 },
  { kind: 'potatoes', x: 12, z: 38 },
  // Gym: a punching bag, dumbbells, a mat, a mirror.
  { kind: 'punchingBag', x: 30, z: 32 },
  { kind: 'dumbbells', x: 32, z: 34 },
  { kind: 'mat', x: 28, z: 33, w: 2 },
  { kind: 'mirror', x: 26, z: 34, rot: 2 },
  // Showers: towel hooks, the drain.
  { kind: 'towelHooks', x: 28, z: 36, w: 2 },
  { kind: 'drain', x: 30, z: 38 },
  // Woodshop: the tool rack, a sawhorse, timber.
  { kind: 'toolRack', x: 9, z: 46, w: 2 },
  { kind: 'sawhorse', x: 16, z: 47 },
  { kind: 'timber', x: 15, z: 49, w: 2 },
  // Laundry: a basket, an ironing board.
  { kind: 'basket', x: 28, z: 48 },
  { kind: 'ironingBoard', x: 24, z: 48 },
  // Metalshop: a warning sign, a drum.
  { kind: 'warningSign', x: 34, z: 46 },
  { kind: 'drum', x: 31, z: 49 },
  // Library: a globe, books on the tables, a plant.
  { kind: 'globe', x: 9, z: 55 },
  { kind: 'books', x: 6, z: 56, y: TABLE },
  { kind: 'books', x: 15, z: 56, y: TABLE },
  { kind: 'plant', x: 18, z: 57 },
  // Infirmary: the medicine cabinet, a drip stand between the beds.
  { kind: 'medCabinet', x: 25, z: 54 },
  { kind: 'ivStand', x: 25, z: 55 },
  // Janitor's closet: the mop bucket, a wet-floor sign.
  { kind: 'mopBucket', x: 33, z: 56 },
  { kind: 'wetSign', x: 32, z: 57 },
  // Corridors: notices, a clock, an extinguisher.
  { kind: 'noticeBoard', x: 7, z: 51, w: 2 },
  { kind: 'clock', x: 15, z: 51 },
  { kind: 'noticeBoard', x: 30, z: 51, w: 2 },
  { kind: 'extinguisher', x: 36, z: 52, rot: 2 },
  // The barracks: lockers, the key cabinet, a TV, coffee on the table.
  { kind: 'lockers', x: 50, z: 6 },
  { kind: 'lockers', x: 52, z: 6 },
  { kind: 'keyCabinet', x: 54, z: 13, rot: 2 },
  { kind: 'tv', x: 56, z: 10 },
  { kind: 'coffee', x: 51, z: 10, y: TABLE },
  // The generator hut: the fuse box, pipes, a warning sign, a drum.
  { kind: 'fuseBox', x: 52, z: 23 },
  { kind: 'warningSign', x: 56, z: 23 },
  { kind: 'pipes', x: 55, z: 28, rot: 2 },
  { kind: 'drum', x: 49, z: 28 },
  // Solitary: a drain.
  { kind: 'drain', x: 51, z: 44 },
  // The roll call square's flag, sacks and drums by the barracks; a basketball hoop by the first row of cabins (P27: its court).
  { kind: 'flagpole', x: 29, z: 21 },
  { kind: 'hoop', x: 11, z: 21 },
  { kind: 'sacks', x: 59, z: 20 },
  { kind: 'drum', x: 59, z: 21 },
];
