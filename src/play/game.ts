import type { Autopilot } from '../sim/ai/autopilot';
import type { Recorder } from '../sim/Recorder';
import type { LessonRun } from './lesson';

// ------------------------------------------------------------------ the game
export interface Game {
  rec: Recorder;
  /** The player's and inmates' positions before the last step (interpolation). */
  prev: { x: number; z: number };
  prevInmates: Array<{ x: number; z: number }>;
  prevGuards: Array<{ x: number; z: number }>;
  paused: boolean;
  /** How far the player has walked (tiles), for the first-play hint. */
  walked: number;
  /** Tap-to-walk: steers the player with ordinary commands. */
  pilot: Autopilot;
  /** The floor arrows: the way to the routine's place, recomputed now and then. */
  guide: Array<{ x: number; z: number }> | null;
  guideAge: number;
  guideFrom: number;
  /** Dev builds: simulation speed (`]` toggles fast-forward). */
  speed: number;
  /** One-step operations waiting for the next steps (one per step), from the item UI and keys. */
  ops: Array<[number, number, number]>;
  /** Where the ladder comes down (for the action button's label), worked out once. */
  ladderFoot: number;
  /** The escape screen is up: the game is over. */
  over: boolean;
  /** Each guard's own key (item number): the view hangs it on the belt while it's in the guard's pockets. */
  guardKeys: number[];
  /** The game in progress was last written to storage successfully. */
  saved: boolean;
  /** A tutorial lesson (P8+): no saves, no records, its own end. */
  lesson: LessonRun | null;
}

/**
 * The game in progress (null on the title) and the frame clock: `acc` is the time not yet
 * stepped, `last` the previous frame's time. Fields of one object rather than module `let`s,
 * because every play module reads them and several replace them (an import can't be reassigned).
 */
export const play: { game: Game | null; acc: number; last: number } = { game: null, acc: 0, last: performance.now() };

/** Queues a one-step operation (sent with the next simulation step). */
export function sendOp(op: number, a = 0, b = 0) {
  play.game?.ops.push([op, a, b]);
}
