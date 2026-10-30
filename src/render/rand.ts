/**
 * The view's own random numbers, the same on every load and device (scenery scattered, texture
 * noise, drawings): a seeded generator, and a hash of a place for what doesn't need a sequence.
 * Not the simulation's (sim/rng.ts): nothing here changes what happens.
 */

/** A generator from a seed: numbers in [0, 1), the same run of them for the same seed. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A number in [0, 1) for a place `i` and what it's for `k`: the same every time. */
export function hash01(i: number, k: number): number {
  let h = Math.imul(i ^ (k * 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
