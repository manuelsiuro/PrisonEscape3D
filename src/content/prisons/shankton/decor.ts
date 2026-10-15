import type { DecorPlacement } from '../../decor';

/** Table tops (props.ts), for things standing on them. */
const TABLE = 0.52;

/** The cells: a poster over each bunk's foot, by turns (west cells on the west wall, east cells on the east). */
const cells: DecorPlacement[] = [9, 14, 19, 41, 46, 51].flatMap((z0, k) => [
  { kind: k % 2 ? 'posterC' : 'posterB', x: 9, z: z0 + 3, rot: 1 } as const,
  { kind: k % 2 ? 'wallShelf' : 'poster', x: 22, z: z0 + 3, rot: 3 } as const,
]);

/**
 * Shankton dressed (P10): bare institutional halls, a mess hall with its menu and vending
 * machine, warning signs at every detector, workshops with their racks and drums, a mailroom
 * of pigeonholes, the generator room's pipes and fuses, the guards' lockers and the control
 * room's monitors. Pieces keep clear of doors, stations, grates and the ways between them.
 */
export const SHANKTON_DECOR: readonly DecorPlacement[] = [
  ...cells,
  // The wings' halls: a clock, an extinguisher, a speaker each.
  { kind: 'clock', x: 15, z: 9 },
  { kind: 'extinguisher', x: 17, z: 13, rot: 3 },
  { kind: 'speaker', x: 14, z: 18, rot: 1 },
  { kind: 'clock', x: 16, z: 54, rot: 2 },
  { kind: 'extinguisher', x: 17, z: 44, rot: 3 },
  { kind: 'speaker', x: 14, z: 50, rot: 1 },
  // Canteen: the menu, plants in the corners, a water cooler and a vending machine.
  { kind: 'menuBoard', x: 30, z: 9, w: 2 },
  { kind: 'plant', x: 24, z: 9 },
  { kind: 'plant', x: 39, z: 9 },
  { kind: 'waterCooler', x: 24, z: 21 },
  { kind: 'vending', x: 39, z: 21 },
  { kind: 'trays', x: 27, z: 12, y: TABLE },
  { kind: 'trays', x: 34, z: 17, y: TABLE },
  // Kitchen: pans on the wall, the sink, potatoes.
  { kind: 'panRack', x: 43, z: 9, w: 2 },
  { kind: 'sink', x: 48, z: 9 },
  { kind: 'potatoes', x: 52, z: 13 },
  { kind: 'pans', x: 41, z: 15 },
  // Laundry: a basket, an ironing board. Janitor's closet: the mop bucket, a wet-floor sign.
  { kind: 'basket', x: 45, z: 20 },
  { kind: 'ironingBoard', x: 42, z: 21 },
  { kind: 'mopBucket', x: 50, z: 21 },
  { kind: 'wetSign', x: 53, z: 21 },
  // The corridors: warnings at the arches, notices, clocks, pipes.
  { kind: 'warningSign', x: 25, z: 24 },
  { kind: 'warningSign', x: 25, z: 39, rot: 2 },
  { kind: 'warningSign', x: 33, z: 24 },
  { kind: 'noticeBoard', x: 20, z: 24, w: 2 },
  { kind: 'extinguisher', x: 12, z: 26, rot: 2 },
  { kind: 'clock', x: 45, z: 24 },
  { kind: 'speaker', x: 50, z: 26, rot: 2 },
  { kind: 'clock', x: 20, z: 37 },
  { kind: 'noticeBoard', x: 43, z: 39, w: 2, rot: 2 },
  { kind: 'pipes', x: 50, z: 37 },
  // Gym: a punching bag, dumbbells, a mat, a mirror. Showers: towel hooks, the drain.
  { kind: 'punchingBag', x: 18, z: 33 },
  { kind: 'dumbbells', x: 16, z: 33 },
  { kind: 'mat', x: 14, z: 34, w: 2 },
  { kind: 'mirror', x: 16, z: 28 },
  { kind: 'towelHooks', x: 12, z: 30, rot: 3 },
  { kind: 'drain', x: 10, z: 31 },
  // The courtyard: the flag, a hoop on the east wall.
  { kind: 'flagpole', x: 28, z: 28 },
  { kind: 'hoop', x: 39, z: 31, rot: 3 },
  // Woodshop: the tool rack, a sawhorse, timber.
  { kind: 'toolRack', x: 45, z: 28, w: 2 },
  { kind: 'sawhorse', x: 43, z: 34 },
  { kind: 'timber', x: 41, z: 33 },
  // Metalshop: a warning sign, drums, pipes.
  { kind: 'warningSign', x: 53, z: 28 },
  { kind: 'drum', x: 49, z: 34 },
  { kind: 'drum', x: 49, z: 35 },
  { kind: 'pipes', x: 54, z: 33, rot: 3 },
  // Library: a globe, books on the tables, a plant. Mailroom: pigeonholes, parcels.
  { kind: 'globe', x: 30, z: 46 },
  { kind: 'books', x: 25, z: 44, y: TABLE },
  { kind: 'books', x: 29, z: 44, y: TABLE },
  { kind: 'plant', x: 24, z: 46 },
  { kind: 'pigeonholes', x: 28, z: 48, w: 2 },
  { kind: 'parcels', x: 29, z: 53 },
  { kind: 'parcels', x: 30, z: 53 },
  // Infirmary: the medicine cabinet, a drip stand, the sink.
  { kind: 'medCabinet', x: 36, z: 41 },
  { kind: 'ivStand', x: 34, z: 42 },
  { kind: 'sink', x: 39, z: 45, rot: 3 },
  // The generator room: fuses, a warning, pipes, a drum.
  { kind: 'fuseBox', x: 32, z: 52, rot: 1 },
  { kind: 'warningSign', x: 37, z: 48 },
  { kind: 'pipes', x: 39, z: 52, rot: 3 },
  { kind: 'drum', x: 32, z: 54 },
  // Guard quarters: lockers, the key cabinet, a TV, coffee on the table.
  { kind: 'lockers', x: 54, z: 44 },
  { kind: 'lockers', x: 54, z: 45 },
  { kind: 'keyCabinet', x: 53, z: 46, rot: 2 },
  { kind: 'tv', x: 41, z: 46 },
  { kind: 'coffee', x: 48, z: 44, y: TABLE },
  // Solitary: a drain. The control room: monitors, the key cabinet, files.
  { kind: 'drain', x: 43, z: 51 },
  { kind: 'monitors', x: 48, z: 48, w: 2 },
  { kind: 'keyCabinet', x: 48, z: 51, rot: 1 },
  { kind: 'filing', x: 48, z: 54 },
  // The gatehouse: its monitors and a warning by the wire.
  { kind: 'monitors', x: 49, z: 59 },
  { kind: 'warningSign', x: 54, z: 59 },
];
