import { buzz } from '../app/haptics';
import { itemNumber, KEY_ITEM_COLORS } from '../content/items';
import { escapesOf } from '../content/prisons';
import { recordEscape } from '../game/records';
import { deleteSave, writeSave } from '../game/saves';
import { t, type Key } from '../i18n';
import type { BedPose } from '../render/Character';
import { Autopilot } from '../sim/ai/autopilot';
import { placesOf } from '../sim/ai/places';
import { Recorder } from '../sim/Recorder';
import { ESCAPES, type Sim } from '../sim/Sim';
import { formatTime } from '../sim/systems/clock';
import { ladderFootOf } from '../sim/systems/structure';
import { STEPS_PER_MINUTE, UNIT, WALK_SPEED } from '../sim/tuning';
import { TOUCH, h } from '../ui/dom';
import { routineName } from '../ui/hud';
import { showVictory } from '../ui/screens/escaped';
import { showHelp } from '../ui/screens/help';
import { showPause } from '../ui/screens/pause';
import { showSaves } from '../ui/screens/saves';
import { showSettings } from '../ui/screens/settings';
import { announce } from './announce';
import { resetButtons } from './buttons';
import {
  banner,
  board,
  click,
  combatUI,
  controls,
  darkCell,
  hint,
  hud,
  itemsUI,
  profile,
  savedMark,
  settings,
  sleepVeil,
  solitaryPanel,
  sound,
  talk,
  tools,
  trainCard,
  view,
  vignette,
  workChips,
} from './context';
import { play, type Game } from './game';
import { firstDay, seenTip, settingsChanged, tipsSeen } from './tips';
import { hideLesson, type LessonRun } from './lesson';
import { LESSONS } from '../tutorial/lessons';

/**
 * A game from start to end: into it (new or loaded), the saves along the way, pausing, and
 * out again (to the title, or the escape screen first).
 */

/** A short fade from black when a game starts. */
function fadeIn() {
  if (settings.reducedMotion) return;
  const veil = h('div', 'veil');
  document.body.append(veil);
  veil.addEventListener('animationend', () => veil.remove());
}

// ------------------------------------------------------------------ saves
let savedMarkTimer = 0;
/** "Game saved" for a moment in the corner (the autosaves at 08:00 and on falling asleep). */
function flashSaved() {
  savedMark.querySelector('span')!.textContent = t('toast.autosaved');
  savedMark.classList.add('on');
  clearTimeout(savedMarkTimer);
  savedMarkTimer = window.setTimeout(() => savedMark.classList.remove('on'), 1800);
}

/** Writes the game in progress (never once it's over: an escape ends the run). */
export function autosave(g: Game, show = false) {
  if (g.over || g.lesson) return;
  g.saved = writeSave('auto', g.rec.sim);
  if (g.saved && show) flashSaved();
}

/**
 * Into a game: a new one, or one loaded from a save (`resumed`: no day-one welcome, the guide
 * stays away, a "welcome back" instead).
 */
export function startGame(sim: Sim, resumed = false, lesson: LessonRun | null = null) {
  view.setWorld(sim.world);
  // Start a little wide and settle in on the player.
  view.snapTo(sim.state.player.x / UNIT, sim.state.player.z / UNIT, settings.reducedMotion ? 1 : 0.8);
  view.zoomBy(1.25);
  view.setCast(sim.state.inmates.map((m) => ({ cell: m.cell, gait: m.speed / WALK_SPEED })));
  view.setGuards(
    guardBeds(sim),
    sim.prison.guards.map((d) => KEY_ITEM_COLORS.find(([c]) => c === d.key)![2]),
  );
  play.game = {
    rec: new Recorder(sim),
    prev: { x: sim.state.player.x, z: sim.state.player.z },
    prevInmates: sim.state.inmates.map((m) => ({ x: m.body.x, z: m.body.z })),
    prevGuards: sim.state.guards.map((m) => ({ x: m.body.x, z: m.body.z })),
    paused: false,
    walked: 0,
    pilot: new Autopilot(sim.world, () => sim.world.layers[sim.state.layer].block),
    guide: null,
    guideAge: 1,
    guideFrom: -1,
    speed: 1,
    ops: [],
    ladderFoot: ladderFootOf(sim.world),
    over: false,
    guardKeys: sim.prison.guards.map((d) => itemNumber(`key_${d.key}`)),
    saved: false,
    lesson,
  };
  tipsSeen.clear();
  // Loaded asleep or out cold: the veil says which.
  sleepVeil.querySelector('span')!.textContent = t(sim.state.ko > 0 ? 'sleep.knockedOut' : 'sleep.asleep');
  itemsUI.show(true);
  tools.show(true);
  combatUI.show(true);
  resetButtons();
  play.acc = 0;
  controls.reset();
  controls.enabled = true;
  hud.show(true);
  sound.ambience(true);
  fadeIn();
  document.body.classList.add('is-playing');
  const g = play.game;
  const later = (ms: number, f: () => void) => startTimers.push(window.setTimeout(() => play.game === g && !g.paused && f(), ms));
  // A lesson: its card says what to do; no day one, no guide, no saves.
  if (lesson) return;
  if (resumed) {
    // Back where they left: the block they're in, and when.
    later(500, () => banner.show(routineName(sim.state.routine), t('toast.loaded', { when: `${t('hud.day', { n: sim.clock.day })} · ${formatTime(sim.clock)}` })));
    // A loaded game is the game in progress from now on.
    autosave(g);
    // Left on the first day before the guide was through: it picks up where the day is.
    if (!seenTip('guide') && sim.clock.day === 1) later(3000, () => firstDay.start());
    return;
  }
  // Day 1 opens on roll call: the bell and the banner, once the fade is over.
  later(700, () => announce({ type: 'routine', routine: sim.state.routine }, sim));
  // The first game: the guide through the first day (once; again when the tips are reset).
  if (!seenTip('guide')) later(5200, () => firstDay.start());
  if (!seenTip('walk')) {
    later(4600, () => hint.show(TOUCH ? [t('hint.walkTouch'), t('hint.tapWalk'), t('hint.arrows')] : [t('hint.walkKeys'), t('hint.clickWalk'), t('hint.arrows')]));
  }
}

/** Where each guard sleeps at night: the guard-quarters beds, in order, for those without a night round. */
function guardBeds(sim: Sim): Array<BedPose | undefined> {
  const beds = placesOf(sim.world).guardBeds;
  let n = 0;
  return sim.prison.guards.map((d) => {
    if (d.night) return undefined;
    const b = sim.world.props[beds[n++]?.bed ?? -1];
    return b && { x: b.x + b.w / 2, z: b.z + b.d / 2, angle: (b.rot * Math.PI) / 2 };
  });
}

/** Timers set when a game starts (cleared when it ends, so they never reach the next one). */
let startTimers: number[] = [];

/** Resolves when the player quits to the title. */
let quit: (() => void) | null = null;
/** Waits until the game just started is over and the player is back on the title. */
export const untilQuit = () => new Promise<void>((resolve) => (quit = resolve));

export async function pause() {
  if (!play.game || play.game.paused) return;
  click();
  play.game.paused = true;
  play.game.speed = 1;
  controls.enabled = false;
  controls.reset();
  // Paused is saved: a phone may close the tab from here.
  autosave(play.game);
  let note = '';
  for (;;) {
    // A lesson isn't saved: the card says which one it is.
    const lesson = play.game.lesson;
    const choice = await showPause(click, play.game.saved, !play.game.over && !lesson, lesson ? t('lesson.of', { n: lesson.index + 1, of: LESSONS.length }) : note);
    note = '';
    if (!play.game) return;
    if (choice === 'settings') {
      await showSettings(settings, settingsChanged, click);
      continue;
    }
    if (choice === 'help') {
      await showHelp(click);
      continue;
    }
    if (choice === 'save') {
      const slot = await showSaves('save', click);
      if (slot !== null && play.game) {
        const ok = writeSave(slot, play.game.rec.sim);
        if (ok) sound.chime();
        else sound.sting();
        note = ok ? t('toast.saved', { n: slot }) : `!${t('toast.saveFailed')}`;
      }
      continue;
    }
    if (choice === 'resume') {
      play.game.paused = false;
      controls.enabled = true;
      play.last = performance.now();
      return;
    }
    break;
  }
  // Out of a lesson: back to the list of lessons.
  play.game?.lesson?.finish('quit');
  endGame();
}

/** How to play over the game (H): the game waits while it's open. */
export async function openHelp() {
  const g = play.game;
  if (!g || g.paused) return;
  click();
  g.paused = true;
  controls.enabled = false;
  controls.reset();
  tools.release();
  await showHelp(click);
  if (play.game !== g) return;
  g.paused = false;
  controls.enabled = true;
  play.last = performance.now();
}

/** Back to the title: everything the game put up comes down. */
export function endGame() {
  if (play.game) autosave(play.game);
  firstDay.stop();
  hideLesson();
  play.game = null;
  for (const id of startTimers) clearTimeout(id);
  startTimers = [];
  controls.enabled = false;
  hud.show(false);
  itemsUI.show(false);
  tools.show(false);
  combatUI.show(false);
  sleepVeil.classList.remove('on', 'ko');
  solitaryPanel.update(null, 0);
  darkCell.classList.remove('on');
  hint.hide();
  banner.clear();
  vignette.classList.remove('on');
  sound.siren(false);
  sound.ambience(false);
  talk.hide();
  view.setShift(0, 0);
  board.close();
  profile.close();
  trainCard.hide();
  workChips.hide();
  document.body.classList.remove('is-playing', 'panel-open', 'training');
  quit?.();
}

/** Out on the road: the escape screen, then the title. */
export async function escaped() {
  const g = play.game;
  // A lesson's escape is its last step: the lesson ends it.
  if (!g || g.over || g.lesson) return;
  g.over = true;
  g.paused = true;
  controls.enabled = false;
  controls.reset();
  tools.held = false;
  itemsUI.closePanels();
  sound.siren(false);
  sound.chime();
  buzz('attended');
  const sim = g.rec.sim;
  const st = sim.state;
  const clock = sim.clock;
  // Kept on this device: the way out joins the prison's list, the quickest is remembered.
  const via = ESCAPES[st.via];
  const rec = recordEscape(sim.prison.id, via, clock.day, Math.floor(st.step / STEPS_PER_MINUTE));
  // The run is over: nothing left to continue (games kept in slots stay).
  deleteSave('auto');
  firstDay.stop();
  sound.music('title');
  // A moment to see the road under their feet before the card.
  await new Promise((r) => setTimeout(r, 900));
  if (play.game !== g) return;
  const choice = await showVictory(
    {
      prison: t(`prison.${sim.prison.id}` as Key),
      day: clock.day,
      time: formatTime(clock),
      via,
      routes: escapesOf(sim.prison),
      found: rec.record.routes,
      newRoute: rec.newRoute,
      best: rec.best,
      tally: st.tally,
      bestDay: rec.record.bestDay,
    },
    click,
  );
  if (play.game !== g) return;
  playAgain = choice === 'again';
  endGame();
}
/** The victory screen's "Play again": straight into a new game, past the title. */
let playAgain = false;
/** Whether "Play again" was chosen (asked once: the answer is used up). */
export function takePlayAgain() {
  const again = playAgain;
  playAgain = false;
  return again;
}
