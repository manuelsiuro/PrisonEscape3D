import { markLessonDone } from '../game/lessons';
import { ESCAPES } from '../sim/Sim';
import { LAYER } from '../sim/world/World';
import { t, type Key } from '../i18n';
import type { SimEvent } from '../sim/Sim';
import { chapterOf, LESSONS, type LessonCtx } from '../tutorial/lessons';
import { LessonProgress } from '../tutorial/progress';
import { LessonCard, showLessonResult, type LessonResult } from '../ui/lessonCard';
import { board, click, controls, hud, itemsUI, profile, ratPanel, phonePanel, crewPanel, socialOpen, sound, talk, tools, view } from './context';
import { play, type Game } from './game';

/**
 * A tutorial lesson under way (P8+): its steps ticked off as the game shows them done, the
 * card under the HUD saying what to do now, the floor arrows to the step's goal, the clock
 * hurried while a step only waits for time to pass. Caught or knocked out: the lesson is
 * failed (try again). Done: the result card, and the tutorial flow takes over.
 */
export interface LessonRun {
  index: number;
  progress: LessonProgress;
  /** The step the card shows (it lags the progress while a done step shows its tick). */
  shown: number;
  /** Seconds the tick stays up. */
  tick: number;
  /** Seconds the step showing has been up (play time). */
  since: number;
  /** Settles the tutorial flow's wait with the player's choice. */
  finish: (r: LessonResult | 'quit') => void;
  ended: boolean;
}

const card = new LessonCard(hud.el);
const ctx: LessonCtx = { sim: null as never, craftOpen: false };
/** A done step's tick shows this long before the next step. */
const TICK = 0.9;

export function newLessonRun(index: number, finish: (r: LessonResult | 'quit') => void): LessonRun {
  return { index, progress: new LessonProgress(LESSONS[index]), shown: 0, tick: 0, since: 0, finish, ended: false };
}

/** The step's goal (a tile) for the floor arrows, if it has one. */
export function lessonGoal(g: Game): number | null {
  const run = g.lesson;
  if (!run || run.ended) return null;
  const step = run.progress.step;
  // (Only on the layer it's on: a goal on the ground floor leads nowhere from the roof.)
  if (!step?.goal || (step.layer ?? LAYER.GROUND) !== g.rec.sim.state.layer) return null;
  return step.goal(g.rec.sim);
}

/** Every frame: steps ticked off, the card, the game's pace, the end. */
export function updateLesson(g: Game, dt: number, hidden: boolean) {
  const run = g.lesson;
  if (!run) return;
  ctx.sim = g.rec.sim;
  ctx.craftOpen = itemsUI.craftIsOpen;
  if (!run.ended && !g.paused) {
    // A step with something to read in it shows a few seconds before it can tick (it may be done the moment it comes up).
    const now = run.progress.step;
    const hold = !!now?.least && (run.shown !== run.progress.k || run.since < now.least);
    if (run.progress.update(ctx, hold) && run.tick <= 0) {
      run.tick = TICK;
      sound.chime();
    }
    // A step that can't be done any more (the firecrackers gone off out of earshot): try again.
    const why = run.progress.step?.fail?.(ctx);
    if (why) {
      end(g, false, why);
      return;
    }
  }
  // The tick on the step just done, then on to the next (one at a time); it waits while the
  // game is paused, so a lesson never ends under the pause card or the help.
  if (!g.paused) run.since += dt;
  if (run.tick > 0 && !g.paused) {
    run.tick -= dt;
    if (run.tick <= 0) {
      run.shown++;
      run.since = 0;
      if (run.shown < run.progress.k) run.tick = TICK;
    }
  }
  const lesson = LESSONS[run.index];
  const step = lesson.steps[Math.min(run.shown, lesson.steps.length - 1)];
  // Waiting for time to pass: the clock hurries (never while the player could miss something).
  if (!g.paused && !run.ended) g.speed = run.tick <= 0 && run.shown === run.progress.k ? (step.speed ?? 1) : 1;
  const ch = chapterOf(run.index);
  card.update(ch.n, ch.of, ch.id, lesson.id, step.text, step.touch, lesson.steps.length, Math.min(run.shown, lesson.steps.length), run.tick > 0, hidden || run.ended);
  if (!run.ended && run.shown >= lesson.steps.length) end(g, true);
}

/** What the lesson makes of the game's events: caught or knocked out fails it (once every step is done, nothing does). */
export function lessonEvent(g: Game, e: SimEvent) {
  const run = g.lesson;
  if (!run || run.ended || run.progress.done) return;
  run.progress.event(e, g.rec.sim);
  if (e.type === 'caught') end(g, false);
  else if (e.type === 'floored') end(g, false, 'lesson.knocked');
}

async function end(g: Game, won: boolean, why: Key = 'lesson.failed') {
  const run = g.lesson!;
  run.ended = true;
  g.over = true;
  g.paused = true;
  g.speed = 1;
  controls.enabled = false;
  controls.reset();
  tools.release();
  itemsUI.closePanels();
  // The game is paused for good: the container's panel comes down at once (no step will close it).
  itemsUI.show(false);
  talk.hide();
  board.close();
  profile.close();
  ratPanel.close();
  phonePanel.close();
  crewPanel.close();
  card.hide();
  if (won) markLessonDone(LESSONS[run.index].id);
  sound.music('title');
  // A breath to see it done (or the guard's hand on the shoulder) before the card; off a roof on a glider (P24), down on the road first.
  await new Promise((r) => setTimeout(r, won ? 700 : 1200));
  if (play.game !== g) return;
  // (And a moment on the road; the delivery's vehicle away with the player hidden in it, P18.)
  if (view.gliding) {
    await view.glideDown();
    await new Promise((r) => setTimeout(r, 600));
  }
  const sim = g.rec.sim;
  if (won && ESCAPES[sim.state.via] === 'stowaway') {
    view.depart('stowaway');
    if (sim.prison.delivery?.vehicle === 'helicopter') sound.rotor();
    else sound.engine();
    await new Promise((r) => setTimeout(r, view.reducedMotion ? 900 : 3200));
  }
  if (play.game !== g) return;
  const ch = chapterOf(run.index);
  const choice = await showLessonResult(won ? 'lesson.done' : why, run.index + 1 < LESSONS.length ? (ch.n === ch.of ? 'chapter' : 'lesson') : null, t(`lesson.${LESSONS[run.index].id}.t` as Key), click);
  run.finish(choice);
}

/** The lesson's card comes down (the game ended). */
export function hideLesson() {
  card.hide();
}

/**
 * Whether a panel covers the card: a talk, the board, the file, the rat's, the phone's or the
 * crew's, where it would overlap it (on a phone, mostly; on a wide screen they sit side by side,
 * and a step often says what to do in the panel). Containers and crafting leave it up (they sit
 * at the side or the bottom).
 */
export function lessonHidden(): boolean {
  if (!socialOpen()) return false;
  const c = card.at;
  if (!c) return true;
  for (const p of [talk, board, profile, ratPanel, phonePanel, crewPanel]) {
    const r = p.el.getBoundingClientRect();
    if (r.width && r.height && r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top) return true;
  }
  return false;
}

/** "Prison life · Lesson 3 of 7" (the pause card in a lesson). */
export function lessonPlace(index: number): string {
  const ch = chapterOf(index);
  return `${t(`chapter.${ch.id}` as Key)} · ${t('lesson.of', { n: ch.n, of: ch.of })}`;
}
