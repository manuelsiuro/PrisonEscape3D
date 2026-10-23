import type { PrisonDef } from './prisons/types';
import type { StartKind } from './outside/types';

/**
 * The manhunt (P41): the run's last act, outside the wall. Its rules' numbers live here (the
 * sim reads them, the help and the tests print them); the maps are in content/outside/.
 */

/**
 * The legal ways out: a release, not an escape, so nobody comes after the player (a short
 * bus-stop scene and no manhunt): forged release papers (P36) and parole (P39).
 */
export const LEGAL_ROUTES: readonly string[] = ['paperwork', 'parole'];

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
  /** In a guard's uniform, only this close (tiles: the inside's RECOGNIZE_RANGE), till the search has widened this many times (the radio says a uniform's gone missing); in the helicopter's light, at sight's length whatever they wear. */
  uniform: 2.5,
  uniformHeat: 2,
  /** The notice meter: full at this (a step in sight adds 1, 3 within `near` tiles; out of sight it drains 1 a step). */
  spot: 12,
  near: 2.5,
  /** Still in cover this long (steps): hidden from every eye (a dog's nose still finds them). Moving in it: seen only this close (tiles), the meter filling at a third of the pace. */
  settle: 10,
  coverSeen: 3,
  /** A searcher's walk, a look's hurry, a chase (units a step on a road: the player walks 184 at Speed 40; inside, guards chase at 196). Off the road, searchers slow as the player does; dogs don't. */
  walk: 120,
  hurry: 150,
  chase: 176,
  /** Caught: a chaser this close (tiles, centre to centre); this close in cover (a chaser who saw them go in, a handler whose dog points at them there, hidden or not). */
  catch: 0.75,
  found: 1.6,
  /** Spotted or lit, the searchers out within this many tiles of the player hear it on the radio and come to look. */
  radio: 20,
  /** Out of sight this long (steps), a chaser has lost them: to where they were last seen, a look round, then back to the beat. */
  lose: 3 * S,
  look: 8 * S,
  /** A chaser looks again for the way every this many steps. */
  replan: 10,
  /** The dogs: at the heel, on the trail (units a step); a fresh trail tile this close (tiles) puts a dog on it; the player this close (its nose: hidden or not, cover or not), it points and barks. */
  dogHeel: 130,
  dogTrack: 220,
  sniff: 4,
  nose: 2.5,
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
  /** Out there everyone (the player, the searchers, the dogs, the helicopter) moves at this share of the pace given here (percent): the country is bigger than a yard. */
  pace: 45,
  /** Off the roads, this much of the pace (percent): grass, snow or sand; pushing through cover, less; a ford, less again (no trail is laid in it). */
  roughPace: 75,
  coverPace: 55,
  fordPace: 50,
  /** The helicopter: its pace (units a step: 2 tiles a second), its light's reach (tiles; someone moving in cover only under its middle, someone hidden never), how long it holds a player it has lit (steps). */
  heliSpeed: 180,
  heliChase: 150,
  heliLight: 2.5,
  heliCover: 1.25,
  heliHold: 4 * S,
  /** The head start: at most this long (seconds) before the alarm, however long until the next headcount. */
  headStartMax: 10,
  /** Nobody comes on (a searcher, a roadblock's officer) within this many tiles of the player or in their sight: they wait. Nobody due at the alarm comes on before this long (steps) into the hunt (a takeover's, a seen start's grace). */
  clear: 5,
  grace: 4 * S,
  /** The run's salt moves each searcher's time this much either way at most (seconds), a roadblock's and the helicopter's too. */
  jitter: 4,
  /** A roadblock waits for a player loitering by it this long at most (steps); then it goes up as soon as they're off its tiles. */
  blockWait: 10 * S,
  /**
   * Once the alarm is up, the searchers out after it (not the patrols, nor the roadblocks' officers) sweep
   * the cover nearest where the player is reckoned to have got to (`guess`: from where they were
   * last known, along the shortest way to safety, this many tiles a second), a look round at each
   * place (`sweepLook`, steps). After the last of them is out, the search widens every `rampEvery`
   * steps, up to `rampMax` times: each time eyes see `rampSight` tiles further, the dog teams work
   * back where the player was last known (every other time), the helicopter
   * leaves its sweep to search the cover where they're reckoned to be, and from the second time
   * the patrols leave their beats to sweep too.
   */
  rampEvery: 15 * S,
  rampMax: 6,
  rampSight: 1,
  sweepLook: 2 * S,
  guess: 1.5,
  /** A crew member keeping watch whistles when a searcher comes this close (tiles), again once it has gone past `lookoutClear`. */
  lookoutWarn: 7,
  lookoutClear: 10,
  /** Lou's car: this close to it (tiles) and you're in. */
  car: 1.2,
} as const;
