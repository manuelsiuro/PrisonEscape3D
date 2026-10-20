import type { DecorPlacement } from '../../decor';

/** Table tops (props.ts), for things standing on them. */
const TABLE = 0.52;

/**
 * The Training Block dressed (P8+), as Center Perks is: each room reads as what it is. Pieces
 * keep clear of what the lessons point at: the cell wall the pickaxe chips (20, 16), the
 * generator, the gate and its fence, and the ways between them.
 */
export const TRAINING_DECOR: readonly DecorPlacement[] = [
  // The two cells: a shelf over the desk, a poster, a sink by the door.
  { kind: 'wallShelf', x: 22, z: 17 },
  { kind: 'sink', x: 19, z: 20, rot: 1 },
  { kind: 'posterB', x: 25, z: 17 },
  { kind: 'wallShelf', x: 27, z: 17 },
  { kind: 'sink', x: 24, z: 20, rot: 1 },
  // Store room: the tool rack over the workbench's end, timber, a sawhorse, a warning sign.
  { kind: 'toolRack', x: 33, z: 17, w: 2 },
  { kind: 'warningSign', x: 32, z: 17 },
  { kind: 'timber', x: 36, z: 20, w: 2 },
  { kind: 'sawhorse', x: 29, z: 20 },
  // Generator room: the fuse box, pipes, a warning sign, a drum.
  { kind: 'fuseBox', x: 40, z: 17 },
  { kind: 'pipes', x: 43, z: 17, w: 2 },
  { kind: 'warningSign', x: 44, z: 20, rot: 3 },
  { kind: 'drum', x: 40, z: 20 },
  // Corridor: notices, a clock, posters, an extinguisher, plants at its ends.
  { kind: 'noticeBoard', x: 27, z: 22, w: 2 },
  { kind: 'clock', x: 36, z: 22 },
  { kind: 'poster', x: 30, z: 22 },
  { kind: 'extinguisher', x: 40, z: 22 },
  { kind: 'plant', x: 19, z: 24 },
  { kind: 'plant', x: 44, z: 24 },
  // Common room (eaten in as a canteen): the menu, a water cooler, a tray, a bin, a plant.
  { kind: 'menuBoard', x: 26, z: 26, w: 3 },
  { kind: 'clock', x: 20, z: 26 },
  { kind: 'waterCooler', x: 30, z: 26 },
  { kind: 'trays', x: 23, z: 29, y: TABLE },
  { kind: 'smallBin', x: 19, z: 33 },
  { kind: 'plant', x: 30, z: 33 },
  // Patrol hall: a mirror, dumbbells, a punching bag, a mat.
  { kind: 'mirror', x: 34, z: 26, w: 2 },
  { kind: 'dumbbells', x: 40, z: 26, w: 2 },
  { kind: 'posterC', x: 43, z: 26 },
  { kind: 'punchingBag', x: 42, z: 29 },
  { kind: 'mat', x: 38, z: 31, w: 2 },
  // Outside: the flag by roll call, trees and bushes off the paths; a basketball hoop by the building (P27: its court).
  { kind: 'flagpole', x: 34, z: 38 },
  { kind: 'hoop', x: 40, z: 35 },
  { kind: 'tree', x: 16, z: 40 },
  { kind: 'tree', x: 45, z: 40 },
  { kind: 'tree', x: 41, z: 46 },
  { kind: 'bush', x: 17, z: 36 },
  { kind: 'bush', x: 46, z: 36 },
  { kind: 'bush', x: 24, z: 47 },
];
