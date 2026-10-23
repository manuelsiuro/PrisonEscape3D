import type { StartKind } from '../../content/outside/types';
import type { Body } from '../systems/movement';

/**
 * The manhunt's state (P41): plain data, its own (the inside run's state, records and replays
 * are never touched). Built from the outside's map and what carried over from the wall
 * (`Carry`); everything the hunt does follows from it and the commands.
 */

/** What the player brings out over the wall (worked out once, at the wall: sim/hunt/carry.ts). */
export interface Carry {
  /** The prison and the way out, and where that way out leaves them. */
  prison: string;
  via: string;
  kind: StartKind;
  /** Speed (the walk's pace). */
  spd: number;
  /** What they wear (an item number, 0 none) and carry (the hotbar and the weapon: item numbers). */
  outfit: number;
  kit: number[];
  /** How many of the crew got out with them (one keeps watch). */
  crew: number;
  /** Cousin Lou's car waits out there (P34, a call set it up). */
  lou: boolean;
  /** Seconds until the alarm goes up (0: it's up already: seen going, a lockdown, a takeover). */
  headStart: number;
  /** The minute of the day at the wall (the light, how far eyes see). */
  minute: number;
  /** The run's salt (the hunt's own draws). */
  salt: number;
}

/** What a searcher is up to. Never renumber. */
export const SEEK = {
  /** Not out yet (it comes with the alarm's age). */
  OFF: 0,
  /** Walking its beat (a single stop: standing post, as at a roadblock). */
  BEAT: 1,
  /** Gone to look where something was heard, said on the radio or last seen; then a look round. */
  LOOK: 2,
  /** After the player, seen. */
  CHASE: 3,
  /** Following its dog on the trail. */
  FOLLOW: 4,
  /** The search widened (HUNT.rampEvery): off the beat, working through the cover nearest where the player was last known to be. */
  SWEEP: 5,
} as const;

/** What a hunt dog is up to. Never renumber. */
export const HOUND = { HEEL: 0, TRACK: 1, POINT: 2, CALM: 3, DAZED: 4, ASLEEP: 5 } as const;

export interface Searcher {
  body: Body;
  mode: number;
  /** Its beat's next stop. */
  k: number;
  /** Steps left standing (at a stop, looking round). */
  wait: number;
  /** The tile it's heading for (-1 none), the way there (tiles, the next first), and how stuck it is on it. */
  goal: number;
  path: number[];
  best: number;
  stuck: number;
  /** The notice meter (HUNT.spot: it knows the player). */
  notice: number;
  /** Chasing: steps since it last saw them, and where it last did (a tile). */
  unseen: number;
  last: number;
  /** It sees the player now (its cone's colour). */
  sees: boolean;
  /** Its dog (index into dogs; -1 none). */
  dog: number;
}

export interface HuntDog {
  body: Body;
  mode: number;
  /** Its handler (a searcher). */
  handler: number;
  /** The step its calm, daze or point ends (0 none). */
  until: number;
  /** On the trail: the step the scent tile it's making for was laid; off it, the newest it has followed. */
  trail: number;
  /** The step it may pick up a trail again (having lost one). */
  rest: number;
  path: number[];
  goal: number;
  best: number;
  stuck: number;
}

export interface Heli {
  /** Up (it comes with the alarm's age). */
  on: boolean;
  x: number;
  z: number;
  /** The sweep's next stop. */
  k: number;
  /** Steps left holding the player in its light (it follows them). */
  hold: number;
  /** Its light on the player now. */
  lit: boolean;
  /** The search widened: the place it's searching (a tile; -1 none: its sweep). */
  aim?: number;
}

/** The hunt's counts (the run's ledger for the manhunt; the lifetime stats add them up). Append only. */
export const HUNT_FEATS = ['spotted', 'lost', 'hid', 'swaps', 'cuts', 'stones', 'treats', 'lit', 'whistles', 'crunches'] as const;
export type HuntFeat = (typeof HUNT_FEATS)[number];
export const HFEAT = Object.fromEntries(HUNT_FEATS.map((f, k) => [f, k])) as Record<HuntFeat, number>;

/** How a hunt ended. */
export const OVER = { RUNNING: 0, SAFE: 1, LOU: 2, CAUGHT: 3 } as const;

export interface HuntState {
  step: number;
  salt: number;
  player: Body;
  /** Steps standing still; hidden (in cover, still for HUNT.settle). */
  still: number;
  hidden: boolean;
  /** What they wear: 0 the prison's, 1 a guard's uniform, 2 other clothes (their own, off a washing line). */
  clothes: number;
  /** The trail: [tile, the step it was laid], oldest first. */
  trail: Array<[number, number]>;
  searchers: Searcher[];
  dogs: HuntDog[];
  heli: Heli;
  /** The step the alarm goes up (0 or less: up when the hunt began). */
  alarmAt: number;
  /** Roadblocks up and washing lines used (a bit each). */
  blocks: number;
  lines: number;
  /** Wire cut through (tiles), and a cut under way ([tile, steps done]; [] none). */
  cut: number[];
  cutting: number[];
  /** The step of the last stone thrown (0 none). */
  stoneAt: number;
  /** Treats for the dogs left: jerky, pepper, sleepy jerky. */
  treats: number[];
  /** Cutters in the pockets. */
  cutters: boolean;
  /** Noises lately (for the view): [tile, the step, its reach]. */
  noises: Array<[number, number, number]>;
  /** The tile the player stood on last step. */
  at: number;
  /** Searchers the lookout has whistled about (a bit each, cleared once they've gone past). */
  warned: number;
  /** OVER, the step it ended, and who caught them (a searcher; -1). */
  over: number;
  overAt: number;
  by: number;
  /** HUNT_FEATS counts. */
  feats: number[];
  /** The fewest walking tiles to safety yet (how close they got). */
  best: number;
  /** Where the player was last known to be (a tile: seen, lit, heard, found by a dog; at first where they came out), and the step they were. */
  known: number;
  knownAt: number;
  /** How far the search has widened (0 not yet; HUNT.rampMax at most). */
  heat: number;
  /** The places swept since the search widened (tiles, HuntWorld's sweep points), cleared once all are. */
  swept: number[];
  /** The places the dog teams have sniffed (their own round of the same places). */
  sniffed?: number[];
}
