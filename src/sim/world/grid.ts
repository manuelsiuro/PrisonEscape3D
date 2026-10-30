/**
 * Tiles and units: a tile's index is `z * MAP_W + x`; a body stands at a point in units
 * (`UNIT` a tile). Its column and row, its middle, the tile under a point, and how far apart
 * two tiles are the larger way (Chebyshev: a step to any of the eight around is one).
 */
import { UNIT } from '../tuning';
import { MAP_W } from './World';

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
