import type { PropPlacement } from '../props';
import type { ZoneId } from '../zones';

/** A rectangle of tiles, corners included: [x0, z0, x1, z1]. */
export type Rect = readonly [number, number, number, number];

/** Everything that defines one prison. Maps are ASCII pictures, the rest is plain data. */
export interface PrisonDef {
  id: string;
  /** 1 (minimum security) to 5 (supermax). */
  difficulty: number;
  /** The ground floor picture (layer 0). Tunnels, vents and roofs come with their phases. */
  ground: string;
  /** Zones by rectangle; later rectangles win. Unlisted tiles: road → outside, open ground → perimeter, indoor → none. */
  zones: ReadonlyArray<readonly [ZoneId, ...Rect]>;
  /** Cells in order: cell 1 is the player's. */
  cells: readonly Rect[];
  props: readonly PropPlacement[];
  /** Standing spots at roll call, one per inmate (painted on the ground; used by the routine). */
  rollCall: ReadonlyArray<{ x: number; z: number }>;
  /** Where the player starts, as a tile. */
  spawn: { x: number; z: number };
  /** Zones the player must be able to walk to from the cell with no keys or tools (validated). */
  reachable: readonly ZoneId[];
}
