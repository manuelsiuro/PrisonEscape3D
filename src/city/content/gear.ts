/**
 * Crafting that grows (C5 batch 4, 2.69): the tricks' numbers. The rules are sim/gear.ts's; the items content/items.ts's, the
 * recipes and a repair's cost content/recipes.ts's.
 */
export const GEAR = {
  /** A smoke bomb: its cloud's reach round where it lands (tiles), how long it lasts (steps: 15 seconds), how far it's heard. */
  smokeReach: 2,
  smokeSteps: 300,
  smokeHeard: 3,
  /** A noisemaker set down: rings this many steps later (30 seconds), for so long, calling the dead from so far every so often. */
  tickSteps: 600,
  ringSteps: 200,
  ringEvery: 40,
  ringHeard: 14,
  ticksMost: 4,
  /** A flare: how long it burns where it lands (game minutes), a fire's reach. */
  flareMinutes: 30,
} as const;
