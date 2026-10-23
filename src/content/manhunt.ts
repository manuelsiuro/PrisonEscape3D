import type { PrisonDef } from './prisons/types';
import type { StartKind } from './outside/types';

/**
 * The manhunt (P41): the run's last act, outside the wall. Its rules' numbers live here (the
 * sim reads them, the help and the tests print them); the maps are in content/outside/.
 */

/**
 * The legal ways out: a release, not an escape, so nobody comes after the player (a short
 * bus-stop scene and no manhunt). P39 adds `parole` at the merge.
 */
export const LEGAL_ROUTES: readonly string[] = ['paperwork'];

/** Whether a way out ends at the wall as before (a legal release), or is followed by a manhunt. */
export const isLegal = (via: string) => LEGAL_ROUTES.includes(via);

/** Where a way out leaves the player (the outside map's `starts`). Irongate's stowaway rides the supply helicopter. */
export function startKindOf(via: string, prison: PrisonDef): StartKind {
  switch (via) {
    case 'takeover':
    case 'gate':
    case 'bluff':
      return 'gate';
    case 'glider':
      return 'glider';
    case 'stowaway':
      return prison.delivery?.vehicle === 'helicopter' ? 'air' : 'van';
    case 'raft':
      return 'sea';
    case 'helicopter':
      return 'air';
    default:
      return 'wall';
  }
}

/** Steps a second (the hunt runs at the inside's pace: 1 s a game minute). */
const S = 20;

export const HUNT = {
  /** How far a searcher sees (tiles), by day and after dark (torches). */
  sightDay: 7,
  sightNight: 5,
  /** In other clothes (a guard's uniform, your own, off a washing line) a searcher knows you only this close (tiles). */
  disguised: 3,
  /** In a guard's uniform, only this close (tiles: the inside's RECOGNIZE_RANGE). */
  uniform: 2.5,
  /** The notice meter: full at this (a step in sight adds 1, 3 within `near` tiles; out of sight it drains 1 a step). */
  spot: 16,
  near: 2.5,
  /** Moving through cover: seen at a third of the pace; still in it this long (steps), hidden from every eye. */
  settle: 10,
  /** A searcher's walk, a look's hurry, a chase (units a step on a road: the player walks 184 at Speed 40; inside, guards chase at 196). Off the road, searchers slow as the player does; dogs don't. */
  walk: 120,
  hurry: 150,
  chase: 176,
  /** Caught: a chaser this close (tiles, centre to centre); a handler this close to a player his dog found, hidden or not. */
  catch: 0.75,
  found: 1.2,
  /** Out of sight this long (steps), a chaser has lost them: to where they were last seen, a look round, then back to the beat. */
  lose: 3 * S,
  look: 8 * S,
  /** A chaser looks again for the way every this many steps. */
  replan: 10,
  /** The dogs: at the heel, on the trail (units a step); a fresh trail tile this close (tiles) puts a dog on it; this close to the player, it points and barks. */
  dogHeel: 130,
  dogTrack: 168,
  sniff: 1.6,
  point: 1.6,
  /** The trail: this many tiles at most, each fresh this long (steps; inside it lasts 90 s). */
  trailTiles: 60,
  trailSteps: 60 * S,
  /** Something thrown to a dog reaches this far (tiles): jerky calms it this long, pepper dazes it (and its trail is gone), sleepy jerky puts it to sleep. */
  treatRange: 6,
  calm: 30 * S,
  daze: 10 * S,
  /** A stone thrown to draw them off: this far ahead at most (tiles), heard this many walking tiles round where it lands, one every this many steps. */
  stoneRange: 6,
  stoneNoise: 5,
  stoneEvery: 5 * S,
  /** Gravel and railway ballast underfoot: heard this far (walking tiles), once a tile walked. */
  crunch: 3,
  /** Cutting a wire fence (cutters in the pockets): this long (steps), heard this far (walking tiles: the inside's cut). */
  cutSteps: 2 * S,
  cutNoise: 5,
  /** A dog's bark carries this far (walking tiles: the inside's BARK_NOISE). */
  bark: 6,
  /** Off the roads, this much of the pace (percent): grass, snow or sand; pushing through cover, less; a ford, less again (no trail is laid in it). */
  roughPace: 75,
  coverPace: 55,
  fordPace: 50,
  /** The helicopter: its pace (units a step: 2 tiles a second), its light's reach (tiles), how long it holds a player it has lit (steps). */
  heliSpeed: 102,
  heliChase: 150,
  heliLight: 2.5,
  heliHold: 4 * S,
  /** The head start: at most this long (seconds) before the alarm, however long until the next headcount. */
  headStartMax: 20,
  /** A crew member keeping watch whistles when a searcher comes this close (tiles), again once it has gone past `lookoutClear`. */
  lookoutWarn: 7,
  lookoutClear: 10,
  /** Lou's car: this close to it (tiles) and you're in. */
  car: 1.2,
} as const;
