/**
 * Decor (P8+): things that dress a room and do nothing else. Nobody walks round them and the
 * simulation never sees them, so adding or moving decor changes no route, no test, no save.
 *
 * A placement covers w×d tiles from (x, z), turned by `rot` (quarter turns: 0 faces south, 1
 * east, 2 north, 3 west). A WALL piece hangs on the wall behind its tile: at rot 0 the wall to
 * the north (the tile itself is the floor in front of it). `y` lifts a piece onto furniture
 * (trays on a counter, a lamp on a table).
 */
export const DECOR = {
  // On the walls.
  poster: { wall: true },
  posterB: { wall: true },
  posterC: { wall: true },
  clock: { wall: true },
  noticeBoard: { wall: true },
  menuBoard: { wall: true },
  monitors: { wall: true },
  pigeonholes: { wall: true },
  toolRack: { wall: true },
  panRack: { wall: true },
  fuseBox: { wall: true },
  pipes: { wall: true },
  warningSign: { wall: true },
  mirror: { wall: true },
  towelHooks: { wall: true },
  speaker: { wall: true },
  extinguisher: { wall: true },
  wallShelf: { wall: true },
  medCabinet: { wall: true },
  sink: { wall: true },
  keyCabinet: { wall: true },
  // On the floor.
  plant: { wall: false },
  smallBin: { wall: false },
  waterCooler: { wall: false },
  vending: { wall: false },
  lockers: { wall: false },
  tv: { wall: false },
  drum: { wall: false },
  sacks: { wall: false },
  parcels: { wall: false },
  mopBucket: { wall: false },
  wetSign: { wall: false },
  basket: { wall: false },
  ironingBoard: { wall: false },
  sawhorse: { wall: false },
  timber: { wall: false },
  punchingBag: { wall: false },
  dumbbells: { wall: false },
  mat: { wall: false },
  flagpole: { wall: false },
  tree: { wall: false },
  bush: { wall: false },
  // P11 (San Pancho): a saguaro in the plaza, a skull-and-crossbones sign on a post at the minefield's edge.
  cactus: { wall: false },
  mineSign: { wall: false },
  hoop: { wall: false },
  filing: { wall: false },
  ivStand: { wall: false },
  rug: { wall: false },
  drain: { wall: false },
  potatoes: { wall: false },
  globe: { wall: false },
  // On top of furniture (with y).
  trays: { wall: false },
  pans: { wall: false },
  deskLamp: { wall: false },
  coffee: { wall: false },
  books: { wall: false },
  phone: { wall: false },
} as const;

export type DecorKind = keyof typeof DECOR;

export interface DecorPlacement {
  kind: DecorKind;
  x: number;
  z: number;
  w?: number;
  d?: number;
  rot?: 0 | 1 | 2 | 3;
  /** Lifted onto furniture (tiles). */
  y?: number;
}

/** The tile a wall piece hangs on (the wall behind its floor tile, by its turn). */
export function wallBehind(p: DecorPlacement): [number, number] {
  const r = p.rot ?? 0;
  return r === 0 ? [p.x, p.z - 1] : r === 1 ? [p.x - 1, p.z] : r === 2 ? [p.x, p.z + (p.d ?? 1)] : [p.x + (p.w ?? 1), p.z];
}
