import { HUNT } from '../../content/manhunt';
import { findPath, nearestDir } from '../ai/path';
import { walk, type Body } from '../systems/movement';
import { centerX, centerZ, chebTiles, tileAt } from '../world/grid';
import { LAYER } from '../world/World';
import { FOREVER, N, type Walker } from './common';
import type { Hunt } from './Hunt';

// Walking a way (out of Hunt.ts, v2.34.2): searchers and dogs alike, along a path over a grid, a new
// one looked for when stuck.

/** Close enough to a waypoint to aim at the next one (units), and steps without getting closer before the way is looked for again. */
const REACHED = 200;
const STUCK_STEPS = 24;

/** At its goal (in the tile, or next to it when the goal is somewhere it can't stand: cover, a hedge the player hid in). */
export function arrived(m: { body: Body; goal: number; path: number[] }): boolean {
  if (m.goal < 0) return true;
  const here = tileAt(m.body.x, m.body.z);
  if (here === m.goal) return Math.abs(m.body.x - centerX(m.goal)) + Math.abs(m.body.z - centerZ(m.goal)) < REACHED * 2 || !m.path.length;
  return !m.path.length && chebTiles(here, m.goal) <= 1;
}

/** The way to a tile over a grid (next to it, if it's somewhere that grid won't stand on); from somewhere the grid shuts in (a searcher left in cover), through cover. */
export function route(hunt: Hunt, w: Walker, goal: number, grid = hunt.npcGrid) {
  w.goal = goal;
  w.best = FOREVER;
  w.stuck = 0;
  const from = tileAt(w.body.x, w.body.z);
  const find = (g: Uint8Array) =>
    findPath(hunt.world, from, !g[goal] ? (i) => i === goal : (i) => chebTiles(i, goal) <= 1, goal, N, undefined, g);
  w.path = find(grid) ?? (grid !== hunt.chaseGrid ? find(hunt.chaseGrid) : null) ?? [];
}

/** A step along the way at a pace (a new way looked for when stuck against something). */
export function follow(hunt: Hunt, w: Walker, speed: number, rough = true, grid = hunt.npcGrid) {
  const b = w.body;
  while (w.path.length) {
    const next = w.path[0];
    const dx = centerX(next) - b.x;
    const dz = centerZ(next) - b.z;
    const d = Math.abs(dx) + Math.abs(dz);
    if (d < REACHED) {
      w.path.shift();
      w.best = FOREVER;
      continue;
    }
    if (d < w.best) {
      w.best = d;
      w.stuck = 0;
    } else if (++w.stuck > STUCK_STEPS) {
      route(hunt, w, w.goal, grid);
      return;
    }
    walk(
      hunt.npcFeet,
      b,
      nearestDir(dx, dz),
      rough ? hunt.terrain(tileAt(b.x, b.z), speed) : Math.floor((speed * HUNT.pace) / 100),
      LAYER.GROUND,
    );
    return;
  }
  b.moving = false;
}
