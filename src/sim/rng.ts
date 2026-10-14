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
