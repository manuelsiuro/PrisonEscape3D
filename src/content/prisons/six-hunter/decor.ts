import type { DecorPlacement } from '../../decor';

/** Counter tops (props.ts), for things standing on them. */
const COUNTER = 0.56;

/** The cells: a poster on the back wall (north row: the north wall; south row: the south wall), beside the bed. */
const cells: DecorPlacement[] = [
  ...[8, 13, 18, 23, 28, 33, 38].map((x0, k) => ({ kind: (['poster', 'posterB', 'posterC'] as const)[k % 3], x: x0 + 1, z: 9 }) as const),
  ...[8, 13, 18, 28, 33].map(
    (x0, k) => ({ kind: (['posterC', 'poster', 'wallShelf'] as const)[k % 3], x: x0 + 1, z: 20, rot: 2 }) as const,
  ),
];

/** The hunting grounds between the lodge and the wall: pines (the look's pass gives the forest its own trees). */
const woods: DecorPlacement[] = [
  ...[12, 18, 26, 34, 40, 50].map((z) => ({ kind: 'tree', x: 4, z }) as const),
  ...[14, 24, 30, 38, 48].map((z) => ({ kind: 'tree', x: 58, z }) as const),
  ...[10, 16, 34, 44, 52].map((x) => ({ kind: 'tree', x, z: 58 }) as const),
  ...[28, 49].map((z) => ({ kind: 'bush', x: 5, z }) as const),
];

/**
 * The Six Hunter dressed (a first pass: the look's adds the lodge's own pieces): the cells' posters, the hall's clock and
 * speakers, the Trophy Hall's menu and trays (the tally board stands in as a notice board by the door), the kitchen's
 * pans, the gym's dumbbells, the library's globe, the boathouse's rope and life ring, the kennels' sacks; the yard's
 * flagpole, the sports ground's hoop, the garden's water butt; pines in the hunting grounds.
 */
export const SIX_HUNTER_DECOR: readonly DecorPlacement[] = [
  ...cells,
  ...woods,
  // The hall: a clock, speakers.
  { kind: 'clock', x: 24, z: 14 },
  { kind: 'speaker', x: 14, z: 14 },
  { kind: 'speaker', x: 34, z: 14 },
  { kind: 'extinguisher', x: 32, z: 15, rot: 2 },
  // The main corridor.
  { kind: 'clock', x: 36, z: 33 },
  { kind: 'speaker', x: 14, z: 34, rot: 2 },
  { kind: 'speaker', x: 44, z: 34, rot: 2 },
  // The Trophy Hall: the menu (its dishes drawn from the def's `menu`), trays on the serving counter, the Hunters' tally by the door.
  { kind: 'menuBoard', x: 49, z: 22, w: 3 },
  { kind: 'trays', x: 37, z: 24, d: 4, rot: 1, y: COUNTER },
  { kind: 'noticeBoard', x: 39, z: 22, w: 2 },
  // The kitchen: pans on the wall, a sack of potatoes.
  { kind: 'panRack', x: 34, z: 22 },
  { kind: 'potatoes', x: 31, z: 30 },
  // The gym, the library.
  { kind: 'dumbbells', x: 9, z: 43 },
  { kind: 'globe', x: 22, z: 43 },
  // The boathouse: coils of rope, a life ring by the river door.
  { kind: 'ropeCoil', x: 53, z: 12 },
  { kind: 'lifebuoy', x: 50, z: 9 },
  // The kennels: sacks of feed.
  { kind: 'sacks', x: 46, z: 41 },
  // The yard's flagpole, the sports ground's hoop, the garden's water butt.
  { kind: 'flagpole', x: 15, z: 31 },
  { kind: 'hoop', x: 24, z: 50, rot: 3 },
  { kind: 'waterButt', x: 12, z: 22 },
];
