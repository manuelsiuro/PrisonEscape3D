/**
 * City Escape's light and fire (2.52): the numbers. The dead keep to the dark: one that isn't after
 * anyone won't step into strong light (a brute will), and none is put down in it. Three strong lights, each burning
 * fuel: a street barrel lit as a fire, a lantern made and set down, a generator lighting its whole
 * building. The torch is a dim light: it shows the player the night, and shows the player to it.
 * Never renumber the kinds: saves store them.
 */
export const LIGHT_KIND = { FIRE: 0, LANTERN: 1, POWER: 2 } as const;

export const LIGHT = {
  /** A battery's worth of torch (game minutes). */
  torchMinutes: 240,
  /** A fire barrel: how far it lights (tiles, with a clear line), how long a can of fuel burns (game minutes). */
  fireReach: 4,
  fireMinutes: 480,
  /** A lantern set down. */
  lanternReach: 3,
  lanternMinutes: 600,
  /** A generator: its whole building, this long on a can. */
  powerMinutes: 720,
  /** The most lights kept burning in a district (the oldest goes out for one more). */
  most: 12,
} as const;

/** Where the player stands: in strong light (or daylight), by their torch alone, or in the dark. */
export const LEVEL = { DARK: 0, DIM: 1, LIT: 2 } as const;
