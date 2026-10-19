import type { Sim, SimEvent } from '../sim/Sim';
import type { Key } from '../i18n';
import type { Lesson, LessonCtx } from './lessons';

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
  /** Why the lesson ended on an event (a step's `failOn`), if it did. */
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
    this.failed ??= this.step.failOn?.(e, sim) ?? null;
    if (this.seen.length >= 256) return;
    this.seen.push(e);
    this.sim = sim;
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
    }
    // (Held: the events wait for the step to be allowed to tick.)
    if (!hold || n > 0) this.seen.length = 0;
    return n;
  }
}
