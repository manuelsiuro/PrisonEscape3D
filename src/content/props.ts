/**
 * Furniture and fixtures. A placement covers w×d tiles from (x, z); `rot` (quarter turns)
 * only turns the model. Solid props block walking.
 */
export const PROPS = {
  bed: { solid: true },
  desk: { solid: true },
  toilet: { solid: true },
  table: { solid: true },
  counter: { solid: true },
  jobBoard: { solid: true },
  weights: { solid: true },
  treadmill: { solid: true },
  shower: { solid: false },
  shelf: { solid: true },
  washer: { solid: true },
  bin: { solid: true },
  workbench: { solid: true },
  oven: { solid: true },
  freezer: { solid: true },
  generator: { solid: true },
  sortingDesk: { solid: true },
  controlDesk: { solid: true },
  /** A street lamp: lights a pool of ground at night. */
  lamp: { solid: true },
  bench: { solid: true },
  /** A low canteen bench: inmates sit on it at meals, anyone can step over it. */
  seat: { solid: false },
} as const;

export type PropKind = keyof typeof PROPS;

export interface PropPlacement {
  kind: PropKind;
  x: number;
  z: number;
  w?: number;
  d?: number;
  rot?: 0 | 1 | 2 | 3;
}
