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
 * title. Resolves true when the player, done with the last lesson, chose to play for real.
 */
export async function tutorialFlow(): Promise<boolean> {
  let k: number | null = null;
  for (;;) {
    if (k === null) {
      view.setWorld(new Sim(TRAINING).world);
      k = await showLessons(LESSONS, lessonsDone(), click);
      if (k === null) return false;
    }
    const result = await runLesson(k);
    if (result === 'play') return true;
    if (result === 'next') k = k + 1 < LESSONS.length ? k + 1 : null;
    else if (result !== 'again') k = null;
  }
}

/** One lesson: its scene set up on a fresh game, played until it ends one way or the other. */
function runLesson(k: number): Promise<LessonResult | 'quit'> {
  return new Promise((resolve) => {
    const lesson = LESSONS[k];
    const sim = new Sim(lesson.prison ?? TRAINING, lesson.seed ?? 7 + k);
    lesson.setup(sim);
    let settled = false;
    const run = newLessonRun(k, (r) => {
      if (settled) return;
      settled = true;
      // Quitting from the pause card ends the game itself; a result card ends it here.
      if (r !== 'quit') endGame();
      resolve(r);
    });
    // Guards' ways the lesson takes as known: as rumors heard (the talk panel names them).
    const rumors = (lesson.known ?? []).map(({ guard, kind }) => ({ fact: { kind, key: `trait:${guard}`, guard }, step: 0, by: -1 }));
    startGame(sim, false, run, rumors);
  });
}
