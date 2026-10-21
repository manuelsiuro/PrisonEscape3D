import type { DecorPlacement } from '../../decor';

/** Table tops (props.ts), for things standing on them. */
const TABLE = 0.52;

/** The cells: a poster on the outer wall by the bunk's foot (the wall away from the door). */
const cells: DecorPlacement[] = [
  ...[12, 17, 22, 27].map((z0, k) => ({ kind: k % 2 ? 'posterB' : 'poster', x: 12, z: z0 + 3, rot: 1 }) as const),
  ...[12, 17, 22].map((z0, k) => ({ kind: k % 2 ? 'posterC' : 'wallShelf', x: 25, z: z0 + 3, rot: 3 }) as const),
  ...[12, 17, 22].map((z0, k) => ({ kind: k % 2 ? 'wallShelf' : 'posterC', x: 38, z: z0 + 3, rot: 1 }) as const),
  ...[12, 17, 22, 27].map((z0, k) => ({ kind: k % 2 ? 'poster' : 'posterB', x: 51, z: z0 + 3, rot: 3 }) as const),
];

/**
 * Skull-and-crossbones signs on posts across the minefield and either side of the supply
 * corridor, all facing the camera: nobody should ever walk onto the mines by mistake.
 */
const signs: DecorPlacement[] = [
  ...[12, 22, 32, 42, 52].map((x) => ({ kind: 'mineSign', x, z: 4 }) as const),
  ...[8, 18, 44, 54].map((x) => ({ kind: 'mineSign', x, z: 58 }) as const),
  ...[18, 30, 42].flatMap((z) => [{ kind: 'mineSign', x: 5, z } as const, { kind: 'mineSign', x: 58, z } as const]),
  ...[57, 59].flatMap((z) => [{ kind: 'mineSign', x: 29, z } as const, { kind: 'mineSign', x: 34, z } as const]),
];

/** On the inner wall, facing the walkway: a warning every so often. */
const walkway: DecorPlacement[] = [
  ...[20, 43].map((x) => ({ kind: 'warningSign', x, z: 9 }) as const),
  ...[20, 43].map((x) => ({ kind: 'warningSign', x, z: 54, rot: 2 }) as const),
  ...[20, 43].map((z) => ({ kind: 'warningSign', x: 9, z, rot: 1 }) as const),
  ...[20, 43].map((z) => ({ kind: 'warningSign', x: 54, z, rot: 3 }) as const),
];

/**
 * San Pancho dressed (P11): adobe cells with their posters, a canteen with its menu and
 * cooler, workshops with racks and drums, a dusty plaza of saguaros round its flagpole, the
 * gym's bag, the control room's monitors, warnings on the inner wall and signs all over the
 * minefield. Pieces keep clear of doors, stations and the ways between them.
 */
export const SAN_PANCHO_DECOR: readonly DecorPlacement[] = [
  ...cells,
  ...signs,
  ...walkway,
  // The wings' halls: a clock, a speaker, an extinguisher each.
  { kind: 'clock', x: 18, z: 12 },
  { kind: 'speaker', x: 17, z: 20, rot: 1 },
  { kind: 'extinguisher', x: 20, z: 25, rot: 3 },
  { kind: 'clock', x: 45, z: 12 },
  { kind: 'speaker', x: 46, z: 20, rot: 3 },
  { kind: 'extinguisher', x: 43, z: 25, rot: 1 },
  // Canteen: the menu, a plant, the water cooler, a vending machine, trays left on the tables.
  { kind: 'menuBoard', x: 20, z: 32, w: 2 },
  { kind: 'plant', x: 17, z: 33 },
  { kind: 'waterCooler', x: 18, z: 32 },
  { kind: 'vending', x: 24, z: 39, rot: 3 },
  { kind: 'trays', x: 20, z: 33, y: TABLE },
  { kind: 'trays', x: 23, z: 37, y: TABLE },
  // Kitchen: pans on the wall, the sink, a sack of potatoes.
  { kind: 'panRack', x: 14, z: 32, w: 2 },
  { kind: 'sink', x: 12, z: 36, rot: 1 },
  { kind: 'potatoes', x: 13, z: 37 },
  // Woodshop: the tool rack, timber, a sawhorse.
  { kind: 'toolRack', x: 14, z: 43, w: 2 },
  { kind: 'timber', x: 12, z: 50 },
  { kind: 'sawhorse', x: 15, z: 50 },
  // Metalshop: the rack, drums.
  { kind: 'toolRack', x: 21, z: 43, w: 2 },
  { kind: 'drum', x: 20, z: 51 },
  { kind: 'drum', x: 21, z: 51 },
  // Laundry: a basket. Janitor's closet: the mop bucket, a wet-floor sign. Mailroom: pigeonholes, parcels, sacks.
  { kind: 'basket', x: 29, z: 15 },
  { kind: 'mopBucket', x: 31, z: 18 },
  { kind: 'wetSign', x: 31, z: 16 },
  { kind: 'pigeonholes', x: 34, z: 12 },
  { kind: 'parcels', x: 34, z: 19 },
  { kind: 'sacks', x: 36, z: 19 },
  // The yard (the plaza's north half): the flagpole, saguaros at its south corners by the fence.
  { kind: 'flagpole', x: 33, z: 23 },
  { kind: 'cactus', x: 27, z: 30 },
  { kind: 'cactus', x: 36, z: 30 },
  // The sports ground (P33): the hoop on its post (its court), dumbbells by the weights.
  { kind: 'hoop', x: 29, z: 32 },
  { kind: 'dumbbells', x: 38, z: 32 },
  // The garden (P33): the water butt by the shed, saguaros by the beds.
  { kind: 'waterButt', x: 51, z: 35 },
  { kind: 'cactus', x: 48, z: 34 },
  { kind: 'cactus', x: 51, z: 36 },
  // Gym and showers: a mat and dumbbells; towel hooks, a mirror, the drain.
  { kind: 'mat', x: 42, z: 37 },
  { kind: 'dumbbells', x: 41, z: 36 },
  { kind: 'towelHooks', x: 44, z: 37, rot: 3 },
  { kind: 'mirror', x: 41, z: 38, rot: 1 },
  { kind: 'drain', x: 43, z: 39 },
  // Library: books and a lamp on the tables, the notice board, a globe.
  { kind: 'books', x: 42, z: 44, y: TABLE },
  { kind: 'deskLamp', x: 43, z: 44, y: TABLE },
  { kind: 'noticeBoard', x: 43, z: 46, rot: 2 },
  { kind: 'globe', x: 44, z: 46 },
  // Infirmary: the medicine cabinet, a drip stand.
  { kind: 'medCabinet', x: 51, z: 45, rot: 3 },
  { kind: 'ivStand', x: 50, z: 45 },
  // Generator room: the fuses, the pipes.
  { kind: 'fuseBox', x: 43, z: 48 },
  { kind: 'pipes', x: 43, z: 50, rot: 3 },
  // Guard quarters: lockers, the TV.
  { kind: 'lockers', x: 49, z: 51, rot: 2 },
  { kind: 'tv', x: 45, z: 51, rot: 2 },
  // Control room: the monitors, the key cabinet, the files (a coffee on the quarters' table).
  { kind: 'monitors', x: 32, z: 48, w: 2 },
  { kind: 'keyCabinet', x: 31, z: 49, rot: 1 },
  { kind: 'filing', x: 34, z: 48 },
  { kind: 'coffee', x: 47, z: 51, y: TABLE },
  // Solitary: the drain.
  { kind: 'drain', x: 28, z: 49 },
];
