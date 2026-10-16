/**
 * The simulation's random numbers: mulberry32, its 32-bit state kept in the sim state, so a
 * save or a keyframe carries it and replays draw the same numbers. Never use Math.random in
 * the simulation.
 */
export function nextRandom(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** An integer in [0, n). */
export const randomInt = (s: { rng: number }, n: number) => Math.floor(nextRandom(s) * n);

/** FNV-1a over a string: a short, stable fingerprint for snapshots and tests. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * A 32-bit mix (murmur3's fmix32): the same bits on every device. `state.salt` is the seed
 * mixed once; roll() hashes it with what a draw is for, so new rules get their randomness
 * without drawing from `state.rng` (the old draws, and the escape bots' runs, stay as they were).
 */
export function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** What a roll() is for (its own stream). Never renumber: saves replay them. */
export const SALT = { SHAKEDOWN: 1, NAP: 2, DECK: 3, WEATHER: 4, WIND: 5, MOOD: 6, EVENT_TIME: 7, OUTAGE: 8 } as const;

/** A number in [0, 2³²) for a draw of a kind (SALT) and its arguments: pure, never the same stream as another kind. */
export const roll = (salt: number, kind: number, a: number, b = 0) => mix32(mix32(mix32(salt ^ Math.imul(kind, 0x9e3779b9)) ^ a) ^ Math.imul(b + 1, 0x27d4eb2f));

/** An integer in [0, n) from roll(). */
export const rollInt = (salt: number, kind: number, a: number, b: number, n: number) => Math.floor((roll(salt, kind, a, b) / 4294967296) * n);
