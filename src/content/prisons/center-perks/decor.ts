import type { DecorPlacement } from '../../decor';

/** Table and counter tops (props.ts), for things standing on them. */
const TABLE = 0.52;
const COUNTER = 0.56;

/**
 * Center Perks dressed (P8+): what makes each room read as what it is. Pieces stand where
 * people rarely walk (against walls, in corners), off the routes through the doors; wall
 * pieces mostly hang on north walls, the ones the camera faces.
 */
const cells: DecorPlacement[] = [7, 12, 17, 22].flatMap((x0, k) => {
  const posters = ['poster', 'posterB', 'posterC'] as const;
  return [
    // Top row (doors south): a poster over the bed's foot, a sink by the door.
    { kind: posters[k % 3], x: x0 + 1, z: 7 },
    { kind: 'sink', x: x0, z: 10, rot: 1 },
    // Bottom row (doors north): a shelf over the desk's corner, a sink by the door.
    { kind: 'wallShelf', x: x0 + 2, z: 16 },
    { kind: posters[(k + 1) % 3], x: x0 + 1, z: 19, rot: 2 },
    { kind: 'sink', x: x0, z: 16, rot: 1 },
  ] as DecorPlacement[];
});

export const CENTER_PERKS_DECOR: readonly DecorPlacement[] = [
  ...cells,
  // Cell block landing.
  { kind: 'noticeBoard', x: 10, z: 12, w: 2 },
  { kind: 'clock', x: 16, z: 12 },
  { kind: 'extinguisher', x: 20, z: 12 },
  { kind: 'plant', x: 7, z: 14 },
  { kind: 'plant', x: 25, z: 12 },
  // Roll call yard: the flag and the PA.
  { kind: 'flagpole', x: 37, z: 9 },
  { kind: 'speaker', x: 32, z: 7 },
  // Canteen: the menu over the serving counter, trays ready on it, a water cooler, bins.
  { kind: 'menuBoard', x: 51, z: 7, w: 5 },
  { kind: 'trays', x: 51, z: 9, w: 5, y: COUNTER },
  { kind: 'waterCooler', x: 56, z: 7 },
  { kind: 'clock', x: 44, z: 7 },
  { kind: 'posterC', x: 47, z: 7 },
  { kind: 'plant', x: 40, z: 7 },
  { kind: 'smallBin', x: 56, z: 13 },
  { kind: 'smallBin', x: 40, z: 19 },
  // Kitchen.
  { kind: 'panRack', x: 54, z: 15 },
  { kind: 'sink', x: 50, z: 15 },
  { kind: 'pans', x: 53, z: 19, w: 3, rot: 2, y: COUNTER },
  { kind: 'sacks', x: 56, z: 19 },
  // North corridor: notices, clocks, an extinguisher, plants at its ends.
  { kind: 'noticeBoard', x: 12, z: 21, w: 2 },
  { kind: 'posterB', x: 24, z: 21 },
  { kind: 'clock', x: 20, z: 21 },
  { kind: 'noticeBoard', x: 38, z: 21, w: 2 },
  { kind: 'clock', x: 52, z: 21 },
  { kind: 'extinguisher', x: 8, z: 21 },
  { kind: 'extinguisher', x: 49, z: 21 },
  { kind: 'plant', x: 7, z: 23 },
  { kind: 'plant', x: 56, z: 23 },
  // South corridor.
  { kind: 'poster', x: 15, z: 36 },
  { kind: 'posterC', x: 25, z: 36 },
  { kind: 'clock', x: 35, z: 36 },
  { kind: 'posterB', x: 40, z: 36 },
  { kind: 'noticeBoard', x: 47, z: 36, w: 2 },
  { kind: 'extinguisher', x: 56, z: 36 },
  { kind: 'plant', x: 7, z: 37 },
  // Gym: a dumbbell rack, a mirror, a bag, a mat.
  { kind: 'dumbbells', x: 7, z: 25, w: 2 },
  { kind: 'mirror', x: 11, z: 25, w: 2 },
  { kind: 'punchingBag', x: 14, z: 27 },
  { kind: 'mat', x: 10, z: 28, w: 2 },
  { kind: 'posterB', x: 9, z: 25 },
  // Showers: drains, towels on the west wall.
  { kind: 'drain', x: 17, z: 27 },
  { kind: 'drain', x: 21, z: 27 },
  { kind: 'towelHooks', x: 16, z: 26, d: 2, rot: 1 },
  { kind: 'mirror', x: 22, z: 26, d: 2, rot: 3 },
  // Library: a rug, a globe between the shelves, lamps and books on the tables, plants.
  { kind: 'rug', x: 18, z: 31, w: 3, d: 3 },
  { kind: 'globe', x: 19, z: 30 },
  { kind: 'deskLamp', x: 16, z: 32, y: TABLE },
  { kind: 'deskLamp', x: 22, z: 32, y: TABLE },
  { kind: 'books', x: 17, z: 32, y: TABLE },
  { kind: 'books', x: 21, z: 32, y: TABLE },
  { kind: 'plant', x: 16, z: 34 },
  { kind: 'plant', x: 22, z: 34 },
  // Infirmary.
  { kind: 'medCabinet', x: 14, z: 31 },
  { kind: 'ivStand', x: 8, z: 32 },
  { kind: 'ivStand', x: 13, z: 32 },
  { kind: 'sink', x: 7, z: 34, rot: 1 },
  { kind: 'filing', x: 14, z: 34 },
  { kind: 'posterC', x: 11, z: 31 },
  // Courtyard (the quiet yard since P31): trees, bushes.
  { kind: 'tree', x: 25, z: 30 },
  { kind: 'tree', x: 36, z: 26 },
  { kind: 'tree', x: 31, z: 30 },
  { kind: 'bush', x: 24, z: 28 },
  { kind: 'bush', x: 37, z: 31 },
  { kind: 'bush', x: 28, z: 34 },
  { kind: 'bush', x: 33, z: 25 },
  // Woodshop: timber, the tool rack, a sawhorse.
  { kind: 'timber', x: 46, z: 25, w: 2 },
  { kind: 'toolRack', x: 39, z: 25, w: 2 },
  { kind: 'sawhorse', x: 42, z: 29 },
  { kind: 'warningSign', x: 41, z: 25 },
  // Laundry: baskets, an ironing board.
  { kind: 'basket', x: 52, z: 29 },
  { kind: 'basket', x: 55, z: 28 },
  { kind: 'ironingBoard', x: 51, z: 27 },
  { kind: 'posterB', x: 52, z: 25 },
  // Mailroom: pigeonholes, mail sacks, parcels.
  { kind: 'pigeonholes', x: 48, z: 32, d: 2, rot: 3 },
  { kind: 'sacks', x: 39, z: 34 },
  { kind: 'parcels', x: 47, z: 34 },
  { kind: 'clock', x: 44, z: 31 },
  // Janitor's closet.
  { kind: 'mopBucket', x: 55, z: 34 },
  { kind: 'wetSign', x: 54, z: 33 },
  { kind: 'wallShelf', x: 53, z: 31, w: 2 },
  { kind: 'sink', x: 50, z: 34, rot: 1 },
  // Generator room: drums, the fuse box, pipes, a warning.
  { kind: 'drum', x: 13, z: 44 },
  { kind: 'drum', x: 14, z: 44 },
  { kind: 'drum', x: 14, z: 43 },
  { kind: 'fuseBox', x: 11, z: 39 },
  { kind: 'pipes', x: 7, z: 39, w: 3 },
  { kind: 'warningSign', x: 12, z: 39 },
  // Solitary: the potatoes to peel.
  { kind: 'potatoes', x: 18, z: 42 },
  { kind: 'potatoes', x: 20, z: 42 },
  // Visitation: a vending machine, phones on the counters, plants, a clock.
  { kind: 'vending', x: 27, z: 39 },
  { kind: 'phone', x: 27, z: 41, y: COUNTER },
  { kind: 'phone', x: 34, z: 41, y: COUNTER },
  { kind: 'plant', x: 37, z: 39 },
  { kind: 'plant', x: 27, z: 44 },
  { kind: 'plant', x: 37, z: 44 },
  { kind: 'clock', x: 35, z: 39 },
  { kind: 'posterC', x: 28, z: 39 },
  // Guard quarters: lockers, the TV, coffee.
  { kind: 'lockers', x: 43, z: 39, w: 3 },
  { kind: 'tv', x: 41, z: 39 },
  { kind: 'coffee', x: 40, z: 40, y: TABLE },
  { kind: 'rug', x: 42, z: 41, w: 2, d: 2 },
  // Control room: the CCTV wall, the key cabinet, files.
  { kind: 'monitors', x: 50, z: 39, w: 3 },
  { kind: 'keyCabinet', x: 55, z: 39 },
  { kind: 'filing', x: 50, z: 44 },
  { kind: 'filing', x: 51, z: 44 },
  // The passages to the sports ground and the garden (P31): notices, an extinguisher.
  { kind: 'noticeBoard', x: 24, z: 41, rot: 1 },
  { kind: 'extinguisher', x: 48, z: 39, rot: 3 },
  // The sports ground (P31): the hoop on its post, a mat and dumbbells by the weights.
  { kind: 'hoop', x: 8, z: 46 },
  { kind: 'dumbbells', x: 9, z: 55, w: 2 },
  { kind: 'mat', x: 6, z: 53 },
  // The garden (P31): the water butt by the shed, sacks of compost, bushes in its corners.
  { kind: 'waterButt', x: 55, z: 47 },
  { kind: 'sacks', x: 56, z: 49 },
  { kind: 'bush', x: 36, z: 55 },
  { kind: 'bush', x: 56, z: 52 },
  // Outside: trees on the grass south of the new fences, clear of the drive and the lamps.
  { kind: 'tree', x: 10, z: 58 },
  { kind: 'tree', x: 20, z: 59 },
  { kind: 'tree', x: 42, z: 58 },
  { kind: 'tree', x: 52, z: 59 },
  { kind: 'bush', x: 3, z: 50 },
  { kind: 'bush', x: 60, z: 50 },
];
