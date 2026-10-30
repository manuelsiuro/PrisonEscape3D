/**
 * Tiles and units: a tile's index is `z * MAP_W + x`; a body stands at a point in units
 * (`UNIT` a tile). Its column and row, its middle, the tile under a point, and how far apart
 * two tiles are the larger way (Chebyshev: a step to any of the eight around is one).
 */
import { UNIT } from '../tuning';

export const MAP_W = 64;
export const MAP_H = 64;

export const tileX = (i: number) => i % MAP_W;
export const tileZ = (i: number) => Math.floor(i / MAP_W);
/** The middle of a tile, in units. */
export const centerX = (i: number) => (i % MAP_W) * UNIT + UNIT / 2;
export const centerZ = (i: number) => Math.floor(i / MAP_W) * UNIT + UNIT / 2;
/** The tile under a point (units). */
export const tileAt = (ux: number, uz: number) => Math.floor(uz / UNIT) * MAP_W + Math.floor(ux / UNIT);
/** Tiles between two tiles, the larger way. */
export const chebTiles = (a: number, b: number) => Math.max(Math.abs(tileX(a) - tileX(b)), Math.abs(tileZ(a) - tileZ(b)));
/** Tiles from a tile (column, row) to the one under a point (units), the larger way. */
export const tilesFrom = (tx: number, tz: number, ux: number, uz: number) => Math.max(Math.abs(Math.floor(ux / UNIT) - tx), Math.abs(Math.floor(uz / UNIT) - tz));
/** A grid's test of a tile (column, row): off the map, or a 1 in it (World.block, guardBlock, a hunt's grid). */
export const blockedIn = (grid: Uint8Array) => (x: number, z: number) => x < 0 || z < 0 || x >= MAP_W || z >= MAP_H || grid[z * MAP_W + x] === 1;
/** A tile's four neighbours, west, east, north, south (that order: floods and searches depend on it), each with whether it's on the map. */
export const neighbours4 = (t: number) =>
  [
    [t - 1, t % MAP_W > 0],
    [t + 1, t % MAP_W < MAP_W - 1],
    [t - MAP_W, t >= MAP_W],
    [t + MAP_W, t < MAP_W * (MAP_H - 1)],
  ] as const;
