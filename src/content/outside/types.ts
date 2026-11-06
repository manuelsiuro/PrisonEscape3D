import type { DogCoat } from '../prisons/types';

/**
 * The outside (P41, the manhunt): a small map per prison, past its wall, where the run's last
 * act is played. All of it data: an ASCII picture (OUTSIDE_LEGEND), where each kind of way out
 * leaves the player, the safe point across it, the hiding places, washing lines, roadblocks,
 * the searchers' beats and the helicopter's sweep. Coordinates are the picture's own (x across,
 * z down from its top row); the hunt places the picture in the middle of the 64×64 world.
 */

/**
 * Where a way out leaves the player (content/manhunt.ts startKindOf): over the wall (fence,
 * tunnel, roof), out of the front gate (takeover, gate, bluff), down from a glider (further
 * out), out of the delivery's vehicle (stowaway), ashore off a raft, down from a helicopter.
 */
export type StartKind = 'wall' | 'gate' | 'glider' | 'van' | 'sea' | 'air';
export const START_KINDS: readonly StartKind[] = ['wall', 'gate', 'glider', 'van', 'sea', 'air'];

/** A tile and the way someone there faces (1–16, 5 = south). */
export interface Spot {
  x: number;
  z: number;
  face?: number;
}

/** A rectangle of tiles, corners included: [x0, z0, x1, z1]. */
export type Area = readonly [number, number, number, number];

/** What the safe point is (how it's drawn and named): the night bus, a border post, a freight train, a truck stop, a coach out of town. */
export type SafeKind = 'bus' | 'border' | 'train' | 'truck' | 'coach';

/**
 * A searcher on foot (a dog at the heel if it has one): where it comes on, its beat, walked in a
 * loop, and when it comes out. The hunt shuffles the searchers' times among those out after the
 * alarm and moves each a few seconds by the run's salt, starts each beat at a stop of its own,
 * and never brings anyone on within HUNT.clear tiles of the player or in their sight.
 */
interface SearcherDef {
  /** Its surname (the same in every language). */
  name: string;
  /** Where it comes on (an edge of the map, a gate); its beat's first stop if none. A patrol out before any alarm is already on its beat, at one of its stops. */
  from?: Spot;
  /** Its beat. */
  beat: readonly Spot[];
  /** Seconds after the alarm it comes out (negative: out already, a patrol before any alarm). */
  at: number;
  dog?: { name: string; coat: DogCoat };
}

/** A roadblock: the tiles its barrier closes, the officer's post beside it, and when it goes up (seconds after the alarm). */
interface RoadblockDef {
  area: Area;
  post: Spot;
  at: number;
}

export interface OutsideDef {
  /** The prison it lies outside. */
  prison: string;
  /** The picture: rows of OUTSIDE_LEGEND, at most 64 × 64 (every row as wide). Past its edge: woods, or the sea where the edge is water. */
  map: string;
  /** Where each kind of way out leaves the player (the kinds this prison's ways out need). */
  starts: Partial<Record<StartKind, Spot>>;
  /** The safe point: its tiles (open ground) and what it is. */
  safe: Area;
  safeKind: SafeKind;
  /** Where the safe point's vehicle or booth stands (drawn only), and the way it faces. */
  safeAt: Spot;
  /** Where cousin Lou's car waits (P34), when a call set it up: a shorter run. */
  lou: Spot;
  /** Washing lines: the tile to stand on to take clothes off it, and the way the line runs (1 across x, 5 along z). */
  lines: readonly Spot[];
  roadblocks: readonly RoadblockDef[];
  searchers: readonly SearcherDef[];
  /** The helicopter: when it comes (seconds after the alarm) and its sweep, flown in a loop. */
  heli: { at: number; route: readonly Spot[] };
  /** Where a crew member who got out too keeps watch (a rise with a view). */
  lookout: Spot;
}

/**
 * What each character of an outside picture is (sim/hunt/world.ts builds the world from it):
 * - `.` grass (snow at Stalag Flucht, sand at San Pancho), `,` road, `a` asphalt, `d` a dirt
 *   track, `g` gravel (loud underfoot), `r` a railway line (loud underfoot);
 * - `T` a tree, `k` a cactus (a tall saguaro), `o` a rock, `c` crates or a wreck: solid, and
 *   they block sight;
 * - `h` a hedge or a thicket and `u` a culvert under a road: cover (walk in, keep still and
 *   no eye finds you; moving in it you're seen only close by; a dog's nose still finds you);
 * - `~` water, `f` a ford (shallow: slow going, and it washes the trail away), `P` a bridge
 *   or a jetty;
 * - `#` a building, `@` the prison's wall, `F` a wire fence (cutters cut through it).
 */
export const OUTSIDE_LEGEND = '.,adgrTkochu~fP#@F';
