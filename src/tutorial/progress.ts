import type { Sim, SimEvent } from '../sim/Sim';
import type { Key } from '../i18n';
import type { Lesson, LessonCtx } from './lessons';

/** What ends any lesson, whatever its step (it's tried again): caught, knocked out, shocked by a live fence (each wakes the player with their kit taken). */
const ENDS: Partial<Record<SimEvent['type'], Key>> = { caught: 'lesson.failed', floored: 'lesson.knocked', shocked: 'lesson.shocked' };

/**
 * Where a lesson is: the step showing, ticked off in order as the game shows each done (a
 * step already done when it comes up passes straight on; one waiting for an event, once it
 * has happened). The UI calls `event` with every simulation event and `update` every frame;
 * `tutorialtest` both every simulation step. The events since the last `update` are kept
 * until it, so several steps can tick on events of the same step or frame (the drill's bell
 * and the muster at once, for a player already at roll call).
 */
export class LessonProgress {
  k = 0;
  /** Events since the last update (each checked against the steps as they come up). */
  private readonly seen: SimEvent[] = [];
  private sim: Sim | null = null;
  /** Why the lesson ended on an event (a step's `failOn`, or one that ends any lesson), if it did. */
  failed: Key | null = null;

  constructor(readonly lesson: Lesson) {}

  get step() {
    return this.lesson.steps[this.k];
  }

  get done() {
    return this.k >= this.lesson.steps.length;
  }

  /** An event from the game, kept for the next update. */
  event(e: SimEvent, sim: Sim) {
    if (this.done) return;
    this.failed ??= this.step.failOn?.(e, sim) ?? ENDS[e.type] ?? null;
    if (this.seen.length >= 256) return;
    this.seen.push(e);
    this.sim = sim;
  }

  /**
   * Whether the lesson is over before its steps are: why it ends (tried again), or 'won' for a
   * player out on the road with every step left holding (getting out was its goal; the game
   * stops there: no step would ever tick again); null while it goes on.
   */
  verdict(c: LessonCtx): Key | 'won' | null {
    if (this.done) return null;
    const why = this.failed ?? this.step.fail?.(c) ?? null;
    if (why) return why;
    // (Won only if every step left holds now: getting out was the goal, and nothing it teaches was skipped.)
    if (c.sim.state.escaped > 0) return this.lesson.steps.slice(this.k).every((s) => s.done?.(c)) ? 'won' : 'lesson.outEarly';
    return null;
  }

  /** Ticks off what's done now (`hold`: the step showing may not tick yet); returns how many steps were. */
  update(c: LessonCtx, hold = false): number {
    let n = 0;
    while (!this.done && !(hold && n === 0)) {
      const s = this.lesson.steps[this.k];
      const sim = this.sim ?? c.sim;
      if (!s.done?.(c) && !(s.on && this.seen.some((e) => s.on!(e, sim)))) break;
      this.k++;
      n++;
      // A step with something to read in it is never ticked past in the same breath: it shows first.
      if (this.lesson.steps[this.k]?.least) break;
    }
    // (Held: the events wait for the step to be allowed to tick.)
    if (!hold || n > 0) this.seen.length = 0;
    return n;
  }
}
