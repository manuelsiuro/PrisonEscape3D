import type { PropPlacement } from '../props';
import type { RoutineId } from '../routine';
import type { ZoneId } from '../zones';

/** A rectangle of tiles, corners included: [x0, z0, x1, z1]. */
export type Rect = readonly [number, number, number, number];

/** A stop on a guard's round: a tile, how long it stands there (seconds), which way it looks (1–16, 5 = south). */
export interface Waypoint {
  x: number;
  z: number;
  wait?: number;
  face?: number;
}

/** A guard's duties (GDD §5): the rounds it walks, where it stands during some blocks. */
export interface GuardDef {
  /** Its round by day, walked in a loop. */
  beat: readonly Waypoint[];
  /** Where it stands instead during some blocks (roll call, meals…). */
  posts?: Partial<Record<RoutineId, Waypoint>>;
  /** Its round at Lights Out; without one it sleeps in the guard quarters. */
  night?: readonly Waypoint[];
  /** Jobs besides: the night bed checks (00:30, 04:00), the morning shakedown (08:00). */
  duties?: ReadonlyArray<'bedCheck' | 'shakedown'>;
}

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
  guards: readonly GuardDef[];
}
