import { DIR_X, DIR_Z } from '../command';
import { BODY_HALF, UNIT } from '../tuning';
import { MAP_H, MAP_W, type World } from '../world/World';

/**
 * A* on the ground floor: eight-way steps (diagonals only where both sides are open, so
 * bodies never clip a corner), costs 10 and 14, scratch arrays reused between searches.
 * Deterministic: the same world and request give the same path on every platform. Paths are
 * lists of tile indices (z * MAP_W + x), the start left out, the goal last.
 */
const N = MAP_W * MAP_H;
const cost = new Int32Array(N);
const from = new Int32Array(N);
const seen = new Int32Array(N);
const done = new Int32Array(N);
let search = 0;

// A binary heap of tile indices keyed by f (then by push order, for stable ties).
const heapKey = new Float64Array(N * 8);
const heapVal = new Int32Array(N * 8);
let heapSize = 0;
let pushes = 0;

function push(key: number, val: number) {
  let i = heapSize++;
  const k = key * 1e6 + pushes++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapKey[p] <= k) break;
    heapKey[i] = heapKey[p];
    heapVal[i] = heapVal[p];
    i = p;
  }
  heapKey[i] = k;
  heapVal[i] = val;
}

function pop(): number {
  const top = heapVal[0];
  const k = heapKey[--heapSize];
  const v = heapVal[heapSize];
  let i = 0;
  for (;;) {
    let c = i * 2 + 1;
    if (c >= heapSize) break;
    if (c + 1 < heapSize && heapKey[c + 1] < heapKey[c]) c++;
    if (heapKey[c] >= k) break;
    heapKey[i] = heapKey[c];
    heapVal[i] = heapVal[c];
    i = c;
  }
  heapKey[i] = k;
  heapVal[i] = v;
  return top;
}

const STEPS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 10],
  [-1, 0, 10],
  [0, 1, 10],
  [0, -1, 10],
  [1, 1, 14],
  [-1, 1, 14],
  [1, -1, 14],
  [-1, -1, 14],
];

/** Octile distance between tiles, in path cost units. */
function octile(ax: number, az: number, bx: number, bz: number) {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return 10 * Math.max(dx, dz) + 4 * Math.min(dx, dz);
}

/**
 * The shortest walk from a tile to the first tile that passes `isGoal`. Give `target` (a
 * tile index) when there is a single goal: it guides the search. Returns null when no goal
 * can be reached, [] when the start already is one. `limit` caps the tiles explored.
 */
export function findPath(w: World, start: number, isGoal: (i: number) => boolean, target = -1, limit = N): number[] | null {
  if (isGoal(start)) return [];
  search++;
  heapSize = 0;
  pushes = 0;
  const tx = target % MAP_W;
  const tz = (target - tx) / MAP_W;
  const h = (x: number, z: number) => (target < 0 ? 0 : octile(x, z, tx, tz));
  const sx = start % MAP_W;
  const sz = (start - sx) / MAP_W;
  cost[start] = 0;
  from[start] = -1;
  seen[start] = search;
  push(h(sx, sz), start);
  let explored = 0;
  while (heapSize > 0 && explored++ < limit) {
    const i = pop();
    if (done[i] === search) continue;
    done[i] = search;
    if (isGoal(i)) {
      const path: number[] = [];
      for (let k = i; k !== start; k = from[k]) path.push(k);
      return path.reverse();
    }
    const x = i % MAP_W;
    const z = (i - x) / MAP_W;
    for (const [dx, dz, c] of STEPS) {
      const nx = x + dx;
      const nz = z + dz;
      if (w.blocked(nx, nz)) continue;
      if (dx && dz && (w.blocked(x + dx, z) || w.blocked(x, z + dz))) continue;
      const j = nz * MAP_W + nx;
      if (done[j] === search) continue;
      const g = cost[i] + c;
      if (seen[j] === search && cost[j] <= g) continue;
      seen[j] = search;
      cost[j] = g;
      from[j] = i;
      push(g + h(nx, nz), j);
    }
  }
  return null;
}

/** The path to one tile. */
export const pathTo = (w: World, start: number, goal: number) => findPath(w, start, (i) => i === goal, goal);

/** Tile index ↔ the middle of the tile, in units. */
export const tileIndex = (x: number, z: number) => z * MAP_W + x;
export const centerX = (i: number) => (i % MAP_W) * UNIT + UNIT / 2;
export const centerZ = (i: number) => Math.floor(i / MAP_W) * UNIT + UNIT / 2;
export const tileAt = (ux: number, uz: number) => Math.floor(uz / UNIT) * MAP_W + Math.floor(ux / UNIT);

/** Whether a body can walk straight from one point to another (units) without touching anything blocked. */
export function clearLine(w: World, ax: number, az: number, bx: number, bz: number): boolean {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(bz - az)) / (UNIT / 4)));
  const r = BODY_HALF + 40;
  for (let k = 0; k <= n; k++) {
    const x = ax + Math.trunc(((bx - ax) * k) / n);
    const z = az + Math.trunc(((bz - az) * k) / n);
    const x0 = Math.floor((x - r) / UNIT);
    const x1 = Math.floor((x + r) / UNIT);
    const z0 = Math.floor((z - r) / UNIT);
    const z1 = Math.floor((z + r) / UNIT);
    if (w.blocked(x0, z0) || w.blocked(x1, z0) || w.blocked(x0, z1) || w.blocked(x1, z1)) return false;
  }
  return true;
}

/**
 * Drops the waypoints a walker can skip by heading straight for a later one (string
 * pulling), so walks run in natural diagonals instead of tile zigzags. `x`, `z` is where the
 * walker stands (units).
 */
export function smooth(w: World, path: number[], x: number, z: number): number[] {
  const out: number[] = [];
  let ax = x;
  let az = z;
  let k = 0;
  while (k < path.length) {
    let far = k;
    for (let j = path.length - 1; j > k; j--) {
      if (clearLine(w, ax, az, centerX(path[j]), centerZ(path[j]))) {
        far = j;
        break;
      }
    }
    out.push(path[far]);
    ax = centerX(path[far]);
    az = centerZ(path[far]);
    k = far + 1;
  }
  return out;
}

/** The compass direction (1–16, command.ts) closest to a vector (integer math only). */
export function nearestDir(dx: number, dz: number): number {
  let best = 0;
  let bestDot = -Infinity;
  for (let d = 1; d < DIR_X.length; d++) {
    const dot = DIR_X[d] * dx + DIR_Z[d] * dz;
    if (dot > bestDot) {
      bestDot = dot;
      best = d;
    }
  }
  return best;
}
