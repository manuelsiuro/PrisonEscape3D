import type { PrisonDef } from '../content/prisons/types';
import { dirOf } from './command';
import { fnv1a } from './rng';
import { clockAt, hourStarts, type Clock } from './systems/clock';
import { bodyAt, tileOfBody, walk, type Body } from './systems/movement';
import { World } from './world/World';

/** Something that happened during a step; sound, effects and the HUD read these. */
export type SimEvent = { type: 'hour'; hour: number };

/**
 * Everything that changes, as plain data (the world's tiles are kept in World and saved
 * with it). New fields go at the end and must be optional when loading old snapshots.
 */
export interface SimState {
  step: number;
  /** mulberry32 state (rng.ts). */
  rng: number;
  player: Body;
}

export interface Snapshot {
  v: 1;
  prison: string;
  state: SimState;
}

/**
 * The game's rules: `step(cmd)` advances one fixed step (1/20 s). The state depends only
 * on the prison, the seed and the commands, never on frame time, the DOM or Three.js, so
 * the tests replay it headless. Systems run in a fixed order (docs/PLAN.md §3):
 * clock → input → movement.
 */
export class Sim {
  readonly world: World;
  state: SimState;
  /** What happened during the last step. */
  events: SimEvent[] = [];

  constructor(
    readonly prison: PrisonDef,
    seed = 1,
  ) {
    this.world = new World(prison);
    this.state = { step: 0, rng: seed | 0, player: bodyAt(prison.spawn.x, prison.spawn.z) };
  }

  get clock(): Clock {
    return clockAt(this.state.step);
  }

  step(cmd: number) {
    const s = this.state;
    this.events = [];
    s.step++;
    // Clock.
    if (hourStarts(s.step)) this.events.push({ type: 'hour', hour: this.clock.hour });
    // Input and movement.
    walk(this.world, s.player, dirOf(cmd));
  }

  /** The zone the player stands in. */
  get playerZone() {
    const t = tileOfBody(this.state.player);
    return this.world.zoneAt(t.x, t.z);
  }

  snapshot(): Snapshot {
    return { v: 1, prison: this.prison.id, state: structuredClone(this.state) };
  }

  restore(snap: Snapshot) {
    if (snap.prison !== this.prison.id) throw new Error(`snapshot of ${snap.prison}, not ${this.prison.id}`);
    this.state = structuredClone(snap.state);
    this.world.refreshBlock(this.clock.minuteOfDay);
    this.events = [];
  }

  /** A fingerprint of the whole state (tests compare these). */
  hash(): string {
    const g = this.world.ground;
    return fnv1a(JSON.stringify(this.state) + fnv1a(String.fromCharCode(...g.kind)) + fnv1a(String.fromCharCode(...this.world.block)));
  }
}
