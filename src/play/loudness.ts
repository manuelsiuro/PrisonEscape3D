/** How loud something sounds to the player, by how far away it is. */
import type { Sim } from '../sim/Sim';
import { UNIT } from '../sim/tuning';
import { tileX, tileZ } from '../sim/world/grid';

/** How far a tile is from the player (tiles). */
export function tilesTo(sim: Sim, tile: number): number {
  const p = sim.state.player;
  return Math.hypot(tileX(tile) + 0.5 - p.x / UNIT, tileZ(tile) + 0.5 - p.z / UNIT);
}

/** How loud something at a tile sounds to the player: full close by, a whisper across the prison. */
export const gainAt = (sim: Sim, tile: number) => Math.max(0.12, Math.min(1, 1.15 - tilesTo(sim, tile) / 16));
