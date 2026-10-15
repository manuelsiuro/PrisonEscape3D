import type { DecorPlacement } from '../decor';
import type { JobId } from '../jobs';
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
  /** The door key it carries on its belt (GDD §10.2: one color each). */
  key: 'yellow' | 'cyan' | 'purple' | 'red' | 'green';
}

/** The ways out a prison has (GDD §12), as the victory screen names them (`ESCAPES` in sim/state.ts). */
export type EscapeRoute = 'fence' | 'tunnel' | 'roof' | 'takeover';

/**
 * How a prison bends the common rules (P8+; each default is Center Perks'). New prisons add
 * what they need here rather than in code: San Pancho's snipers by night too, the tutorial's
 * forgiving routine.
 */
export interface PrisonRules {
  /** The towers' snipers on duty: by day (default; searchlights at night), or always. */
  snipers?: 'day' | 'always';
  /** The tutorial: missed blocks cost nothing; no shakedowns, no bed checks, nobody sent to the generator. */
  relaxed?: boolean;
  /** Contraband in sight adds its heat one step in this many (default 1: +40% a second). */
  contrabandEvery?: number;
  /** Freezing weather (Stalag Flucht, GDD §4.2): a minute outdoors without a warm outfit doubles what energy costs. */
  cold?: boolean;
}

/** Everything that defines one prison. Maps are ASCII pictures, the rest is plain data. */
export interface PrisonDef {
  id: string;
  /** 1 (minimum security) to 5 (supermax). */
  difficulty: number;
  /** How it looks (render only): Center Perks' suburban green (default), Stalag Flucht's alpine snow, Shankton's industrial grey. */
  theme?: 'suburban' | 'alpine' | 'industrial';
  /** The ground floor picture (layer 0). */
  ground: string;
  /** The vents picture (layer +1): ducts, ceiling grates, the ladder to the roof. Roofs cover every building; tunnels are dug. */
  vents?: string;
  /** The underground picture (layer -1): `O` boulders in the earth (UNDER_LEGEND). Without one, earth all through. */
  under?: string;
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
  /** The inmates' nicknames, by cell (cell 2 first); the same in every language. */
  names: readonly string[];
  /** Cells whose inmates run a contraband shop during free time (GDD §10.3). */
  merchants: readonly number[];
  /** The jobs on offer (GDD §11) and who holds each on day 1: a cell number (1: the player), 0 for open. */
  jobs: ReadonlyArray<{ id: JobId; cell: number }>;
  /** Security cameras (GDD §5.6): the floor tile each hangs over (against a wall) and the way it looks (1–16), sweeping ±45°. */
  cameras?: ReadonlyArray<{ x: number; z: number; face: number }>;
  /** Searchlights at night (GDD §5.2), one per tower: the tiles the beam sweeps along, back and forth. */
  searchlights?: ReadonlyArray<ReadonlyArray<{ x: number; z: number }>>;
  /** Decor (P8+): pieces that dress the rooms and nothing else (the simulation never sees them). */
  decor?: readonly DecorPlacement[];
  /** Rules that differ from Center Perks' (P8+). */
  rules?: PrisonRules;
  /** The perimeter gates (doors no key opens; a takeover does). Default: every door beside the road. */
  gates?: ReadonlyArray<{ x: number; z: number }>;
  /** The ways out of this prison (default: fence, tunnel, roof, takeover), for the victory screen and the records. */
  escapes?: readonly EscapeRoute[];
}
