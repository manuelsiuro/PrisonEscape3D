import { TRAINING } from '../content/prisons/training';
import { lessonsDone } from '../game/lessons';
import { Sim } from '../sim/Sim';
import { LESSONS } from '../tutorial/lessons';
import type { LessonResult } from '../ui/lessonCard';
import { showLessons } from '../ui/screens/lessons';
import { click, view } from '../play/context';
import { endGame, startGame } from '../play/session';
import { newLessonRun } from '../play/lesson';

/**
 * The tutorial from the title (P8+): the list of lessons, then a lesson on the Training Block,
 * and after it the next one, the same again, or the list; closing the list goes back to the
 * title.
 */
export async function tutorialFlow() {
  let k: number | null = null;
  for (;;) {
    if (k === null) {
      view.setWorld(new Sim(TRAINING).world);
      k = await showLessons(LESSONS, lessonsDone(), click);
      if (k === null) return;
    }
    const result = await runLesson(k);
    if (result === 'next') k = k + 1 < LESSONS.length ? k + 1 : null;
    else if (result !== 'again') k = null;
  }
}

/** One lesson: its scene set up on a fresh game, played until it ends one way or the other. */
function runLesson(k: number): Promise<LessonResult | 'quit'> {
  return new Promise((resolve) => {
    const sim = new Sim(TRAINING, 7 + k);
    LESSONS[k].setup(sim);
    let settled = false;
    const run = newLessonRun(k, (r) => {
      if (settled) return;
      settled = true;
      // Quitting from the pause card ends the game itself; a result card ends it here.
      if (r !== 'quit') endGame();
      resolve(r);
    });
    startGame(sim, false, run);
  });
}
