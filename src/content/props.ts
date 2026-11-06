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
  /** A yard bench: sat on like a canteen seat (anyone can step over it). */
  bench: { solid: false },
  /** A low canteen bench: inmates sit on it at meals, anyone can step over it. */
  seat: { solid: false },
  /** A ladder against a wall up to the roof hatch (and past the vents). */
  ladder: { solid: true },
  /** A chair or stool: sat on (P8+); low, stepped round. */
  chair: { solid: false },
  /** 2.31: a library's added chairs, as `chair` but only for runs from then on (World.plainBooks); the librarian's own, never the player's. */
  readChair: { solid: false },
  deskChair: { solid: false },
  /** The metalshop's hydraulic press (P9): sheet metal in, a license plate out. */
  press: { solid: true },
  /** HMP Irongate's helipad (P12): kept clear (nobody walks onto it, the helicopter sets down on it at night); boarded from beside it. */
  helipad: { solid: true },
  // P31 (sports grounds & gardens).
  /** A pull-up bar in the sports ground's weights corner: trains Strength, as the weights do. */
  pullup: { solid: true },
  /** Bleachers along a pitch: tiers of seats, sat on like a yard bench (and stepped over). */
  bleachers: { solid: false },
  /** A raised planter in the garden's rows: the gardener's machine (seedlings in, produce out). */
  planter: { solid: true },
  /** The garden's tool shed: where the gardener takes seedlings. */
  toolShed: { solid: true },
  /** The produce crate by the garden gate: the gardener's crates go in it, for the kitchen. */
  crate: { solid: true },
  // 2.29 (the gym's bag and mat, decoration until then; not solid, so that older runs still walk the map they had).
  /** A punching bag on its bracket: trains Speed. */
  punchingBag: { solid: false },
  /** An exercise mat: push-ups, for Strength. */
  mat: { solid: false },
  /** 2.32: the canteen's vending machine (solid only for runs from then on: World.plainVending). */
  vending: { solid: true },
  /** 2.33: the canteen's water cooler (decoration before; solid only for runs from then on: World.plainCooler). */
  cooler: { solid: true },
} as const;

export type PropKind = keyof typeof PROPS;

export interface PropPlacement {
  kind: PropKind;
  x: number;
  z: number;
  w?: number;
  d?: number;
  rot?: 0 | 1 | 2 | 3;
  /**
   * A lamp's arm (2.34.1, drawing only: the rules never read it): the way it reaches, in eighth turns
   * (AIM). Over what it lights, as a real one would: a drive or path beside it, the fence of a
   * perimeter strip, a yard or ground from its corner. Unset: south, as before.
   */
  aim?: number;
  /** A lamp with a second arm opposite the first (2.34.1, drawing only): one standing in the open. */
  heads?: 1 | 2;
}

/** A lamp's `aim`: eighth turns from south, the same way round as `rot` (2 east, 4 north, 6 west). */
export const AIM = { S: 0, SE: 1, E: 2, NE: 3, N: 4, NW: 5, W: 6, SW: 7 } as const;
