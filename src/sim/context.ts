/**
 * What the systems (src/sim/systems/*) see of the Sim: the state, the world, the events of
 * the step, and the few things worked out from them that every system asks about. The Sim
 * passes itself; nothing outside the simulation needs this.
 */
import type { Guard } from './systems/guards';
import type { Inmate, Social } from './systems/inmates';
import type { Body } from './systems/movement';
import type { WorkState } from './systems/economy';
import type { Sim } from './Sim';

export type SimContext = Pick<
  Sim,
  | 'world'
  | 'prison'
  | 'state'
  | 'events'
  | 'tilesRev'
  | 'wearRev'
  | 'movedBy'
  | 'boarded'
  | 'legacy'
  | 'noDogs'
  | 'noRats'
  | 'aboutBefore'
  | 'groundFrom'
  | 'ladderFoot'
  | 'showerTiles'
  | 'scratch'
  | 'away'
  | 'power'
  | 'bedtime'
  | 'onDuty'
  | 'today'
  | 'playerJob'
  | 'playerZone'
  | 'dutyZones'
  | 'jobActive'
  | 'merchantOf'
  | 'shopsOpen'
  | 'fixerOpen'
>;

/** Arrays and objects the systems refill every step instead of allocating (asleep, hundreds of steps run a second). Not state. */
export interface Scratch {
  /** The guards awake, for noticeDamage. */
  watchers: Guard[];
  point: { x: number; z: number };
  /** Everyone about on the ground floor (nobody digs under people). */
  about: Body[];
  /** Everyone who can be fought or looted, by Cast id (inmates, then guards). */
  cast: Array<Inmate | Guard>;
  workState: WorkState;
  /** Who each follower goes after this step (a foe of the player's, else the player), and every inmate's job room. */
  social: Social & { follow: Array<Body | null>; gap: number[]; work: number[]; scare: Array<{ x: number; z: number }>; doing: number[]; pace: number[] };
  /** The foe each follower is after (Cast id, -1 none). */
  allyFoe: number[];
}

export function newScratch(): Scratch {
  return {
    watchers: [],
    point: { x: 0, z: 0 },
    about: [],
    cast: [],
    workState: { job: -1, onDuty: false, machines: {}, puddles: [], step: 0, inv: [], hand: 0, mail: [], owed: 0 },
    social: { follow: [], gap: [], talk: -1, work: [], seat: -1, scare: [], doing: [], pace: [] },
    allyFoe: [],
  };
}
