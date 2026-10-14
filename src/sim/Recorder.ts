import { STEPS_PER_MINUTE } from './tuning';
import type { Sim, Snapshot } from './Sim';

/** A keyframe every game hour. */
export const KEYFRAME_STEPS = STEPS_PER_MINUTE * 60;

/**
 * Records a game as its commands (only when they change) plus a snapshot every game hour,
 * instead of every frame (web-sim-game-playbook §1). `seek(step)` loads the keyframe before
 * the step and replays the commands: debugging, bug reports, replays and bots use it.
 */
export class Recorder {
  /** [step, command] whenever the command changes; the command holds until the next entry. */
  readonly log: Array<[number, number]> = [];
  private readonly keyframes = new Map<number, Snapshot>();

  constructor(readonly sim: Sim) {
    this.keyframes.set(sim.state.step, sim.snapshot());
  }

  /** Steps the simulation with a command and records it. */
  step(cmd: number) {
    const last = this.log[this.log.length - 1];
    if (!last || last[1] !== cmd) this.log.push([this.sim.state.step, cmd]);
    this.sim.step(cmd);
    if (this.sim.state.step % KEYFRAME_STEPS === 0) this.keyframes.set(this.sim.state.step, this.sim.snapshot());
  }

  /** The command recorded for the step that starts at `step`. */
  commandAt(step: number): number {
    let cmd = 0;
    for (const [s, c] of this.log) {
      if (s > step) break;
      cmd = c;
    }
    return cmd;
  }

  /** Puts the simulation back at an earlier step (load a keyframe, replay the log). */
  seek(step: number) {
    let from = -1;
    for (const k of this.keyframes.keys()) if (k <= step && k > from) from = k;
    if (from < 0) throw new Error(`no keyframe before step ${step}`);
    this.sim.restore(this.keyframes.get(from)!);
    while (this.sim.state.step < step) this.sim.step(this.commandAt(this.sim.state.step));
  }
}
