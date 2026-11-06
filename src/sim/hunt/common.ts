import type { Body } from '../systems/movement';
import { STEPS_PER_SECOND, UNIT } from '../tuning';
import { MAP_H, MAP_W } from '../world/World';

// What the manhunt's parts share (v2.34.2: Hunt.ts split into the hunt, its walkers, searchers,
// dogs and helicopter).

export const S = STEPS_PER_SECOND;
export const N = MAP_W * MAP_H;
/** Longer than any hunt (steps): an officer at his post stays there. */
export const FOREVER = 1e9;
/** What the salt's draws are for (roll()'s first argument, negative: never a step). */
export const DRAW = { ORDER: -1, TIME: -2, STOP: -3, BLOCK: -4, HELI: -5, AIM: -6 } as const;

export const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
export const within = (a: { x: number; z: number }, b: { x: number; z: number }, tiles: number) => dist2(a, b) <= (tiles * UNIT) ** 2;

/** The whole square root of a whole number (the same on every device). */
export function isqrt(n: number): number {
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/** Someone who walks a way (a searcher, a dog). */
export type Walker = { body: Body; goal: number; path: number[]; best: number; stuck: number };
