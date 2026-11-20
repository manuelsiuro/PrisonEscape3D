import type { PropKind } from '../../content/props';

/**
 * Breaking things (C5, 2.66): what gives way to blows, how much work it is and what it is made of. A blow does as much work as the
 * tool that strikes it has for the piece's stuff (wood or metal); the work done, the piece is gone and what it was made of lies
 * where it stood with whatever was in it. Not listed: never broken (a station, a light, a toilet, the landmarks' own pieces).
 */
export interface Salvage {
  /** Work to break it (a blow of a bat on wood is 2). */
  work: number;
  /** Metal: bare hands and blades do nothing to it. */
  metal?: true;
  /** What it gives: [item id, how many]. */
  gives: ReadonlyArray<readonly [string, number]>;
}

export const SALVAGE: Partial<Record<PropKind | 'car' | 'wreck', Salvage>> = {
  chair: { work: 2, gives: [['plank', 1]] },
  readChair: {
    work: 3,
    gives: [
      ['plank', 1],
      ['cloth', 1],
    ],
  },
  deskChair: { work: 3, metal: true, gives: [['scrap', 1]] },
  bench: { work: 4, gives: [['plank', 2]] },
  table: { work: 4, gives: [['plank', 2]] },
  crate: {
    work: 4,
    gives: [
      ['plank', 2],
      ['nails', 1],
    ],
  },
  desk: {
    work: 5,
    gives: [
      ['plank', 2],
      ['scrap', 1],
    ],
  },
  shelf: {
    work: 5,
    gives: [
      ['plank', 2],
      ['nails', 1],
    ],
  },
  counter: {
    work: 6,
    gives: [
      ['plank', 2],
      ['scrap', 1],
    ],
  },
  bed: {
    work: 6,
    gives: [
      ['plank', 2],
      ['cloth', 2],
    ],
  },
  bin: { work: 3, metal: true, gives: [['scrap', 1]] },
  freezer: {
    work: 8,
    metal: true,
    gives: [
      ['scrap', 2],
      ['wire', 1],
    ],
  },
  vending: {
    work: 10,
    metal: true,
    gives: [
      ['scrap', 2],
      ['wire', 1],
      ['soda', 1],
    ],
  },
  car: {
    work: 12,
    metal: true,
    gives: [
      ['scrap', 2],
      ['wire', 1],
    ],
  },
  wreck: { work: 8, metal: true, gives: [['scrap', 2]] },
};

/** An inner wall (a sledgehammer's work only): nothing comes of it but a way through. */
export const WALL_WORK = 16;

/**
 * What a blow does, by what strikes: [on wood, on metal]. A weapon without its own says by its edge (a blade cuts wood poorly and
 * metal not at all); bare hands only wood. Tired, half (never under one where it did any).
 */
export const BREAK_RATE: Record<string, readonly [number, number]> = {
  fists: [1, 0],
  blunt: [2, 1],
  edge: [1, 0],
  axe: [4, 1],
  sledge: [3, 4],
  cleaver: [2, 0],
  crowbar: [2, 2],
};

/** How far a blow on each is heard (tiles): wood, metal, a wall. */
export const BREAK_NOISE = { wood: 7, metal: 10, wall: 12 } as const;
