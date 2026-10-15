import type { Lesson, LessonCtx } from './lessons';

/**
 * Where a lesson is: the step showing, ticked off in order as the game shows each done (a
 * step already done when it comes up passes straight on). The UI calls `update` every frame;
 * `tutorialtest` every simulation step.
 */
export class LessonProgress {
  k = 0;

  constructor(readonly lesson: Lesson) {}

  get step() {
    return this.lesson.steps[this.k];
  }

  get done() {
    return this.k >= this.lesson.steps.length;
  }

  /** Ticks off what's done now; returns how many steps were. */
  update(c: LessonCtx): number {
    let n = 0;
    while (!this.done && this.lesson.steps[this.k].done(c)) {
      this.k++;
      n++;
    }
    return n;
  }
}
