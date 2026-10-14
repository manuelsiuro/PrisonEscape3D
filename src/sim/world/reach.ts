import { MAP_H, MAP_W, type World } from './World';

/**
 * Every ground tile a walker can reach from (x, z) right now (doors as the current rules
 * have them, no keys, no tools): 1 for reachable. Four-way steps, since bodies are narrower
 * than a tile and doors are one tile wide.
 */
export function reachableFrom(w: World, x: number, z: number): Uint8Array {
  const seen = new Uint8Array(MAP_W * MAP_H);
  if (w.blocked(x, z)) return seen;
  const queue = [z * MAP_W + x];
  seen[queue[0]] = 1;
  while (queue.length) {
    const i = queue.pop()!;
    const tx = i % MAP_W;
    const tz = (i - tx) / MAP_W;
    for (const [nx, nz] of [
      [tx + 1, tz],
      [tx - 1, tz],
      [tx, tz + 1],
      [tx, tz - 1],
    ]) {
      if (w.blocked(nx, nz)) continue;
      const j = nz * MAP_W + nx;
      if (!seen[j]) {
        seen[j] = 1;
        queue.push(j);
      }
    }
  }
  return seen;
}
