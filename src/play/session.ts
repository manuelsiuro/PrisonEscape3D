import { buzz } from '../app/haptics';
import { resetRat } from './rat';
import { resetSmuggle } from './smuggle';
import { resetGames } from './games';
import { resetPastimes } from './pastimes';
import { resetLong } from './long';
import { resetTeam } from './team';
import { resetNights } from './nights';
import { resetCrew } from './crew';
import { inmateName } from '../ui/social';
import { itemNumber } from '../content/items';
import { escapesOf, PRISONS } from '../content/prisons';
import { recordEscape } from '../game/records';
import { MEDAL_DAYS } from '../content/medals';
import { isOpen, nextPrison } from '../game/campaign';
import { prisonName, securityOf } from '../ui/screens/prisons';
import type { PrisonDef } from '../content/prisons/types';
import { deleteSave, writeSave } from '../game/saves';
import { t, type Key } from '../i18n';
import { Autopilot } from '../sim/ai/autopilot';
import { RunRecorder, type RunLog } from '../sim/runlog';
import { keepReplay } from '../game/logs';
import { readPrisoner } from '../game/prisoner';
import { escapeRun, startRun, stopRun, syncRun } from '../game/trophies';
import { PLAYER } from '../talk/fill';
import { ESCAPES, type Sim } from '../sim/Sim';
import { formatTime } from '../sim/systems/clock';
import { ladderFootOf } from '../sim/systems/structure';
import { STEPS_PER_MINUTE } from '../sim/tuning';
import { TOUCH, h } from '../ui/dom';
import { routineName } from '../ui/hud';
import { showVictory, type Victory, type VictoryChoice } from '../ui/screens/escaped';
import { watchReplay } from './replay';
import { showHelp } from '../ui/screens/help';
import { showPause } from '../ui/screens/pause';
import { showSaves } from '../ui/screens/saves';
import { showSettings } from '../ui/screens/settings';
import { announce } from './announce';
import { chatterStart, chatterStop, director } from './chatter';
import { dayStart, dayStop } from './day';
import { cancelThrow } from './aim';
import type { Rumor } from '../talk/director';
import { resetButtons } from './buttons';
import { banner, board, click, combatUI, controls, darkCell, hint, hud, itemsUI, profile, ratPanel, phonePanel, crewPanel, crewChips, savedMark, settings, sleepVeil, solitaryPanel, sound, stowPanel, talk, tools, trainCard, trophyToast, view, vignette, workChips } from './context';
import { play, type DailyRun, type Game } from './game';
import { dailyBanner, dailyEscaped, dailyPlace, dailyRestart, dailyTwistsHtml } from './daily';
import { ask } from '../ui/screens/ask';
import { firstDay, seenTip, settingsChanged, tipsSeen } from './tips';
import { hideLesson, lessonPlace, objectivesOf, type LessonRun } from './lesson';
import { showObjectives } from '../ui/screens/objectives';
import { escapeScene, stageWorld } from './stage';

export { escapeScene };

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
  if (g.over || g.lesson || g.replay) return;
  // The lifetime stats catch up with the run as it's saved (P16).
  syncRun();
  // (A Daily's run in its own slot, P26: the campaign's game in progress stays as it was.)
  g.saved = g.daily ? writeSave('daily', g.rec.sim, undefined, director.rumors, g.rec.toLog(), g.daily.n) : writeSave('auto', g.rec.sim, undefined, director.rumors, g.rec.toLog());
  if (g.saved && show) flashSaved();
}

/**
 * Into a game: a new one, or one loaded from a save (`resumed`: no day-one welcome, the guide
 * stays away, a "welcome back" instead). `origin`: where its run log starts (P16): a new
 * game's seed, or the log saved with the game loaded.
 */
export function startGame(sim: Sim, resumed = false, lesson: LessonRun | null = null, rumors: readonly Rumor[] = [], origin: { seed: number } | { log: RunLog | null } = { seed: 0 }, daily: DailyRun | null = null) {
  // Your prisoner (P16): how the player looks, and the name friends call them.
  const prisoner = readPrisoner();
  stageWorld(sim, prisoner);
  PLAYER.name = prisoner?.name ?? '';
  // The speech bubbles (P13): this prison's voices, and the rumors the save kept.
  chatterStart(sim, rumors);
  play.game = {
    rec: new RunRecorder(sim, { ...origin, game: __APP_VERSION__ }),
    prev: { x: sim.state.player.x, z: sim.state.player.z },
    prevInmates: sim.state.inmates.map((m) => ({ x: m.body.x, z: m.body.z })),
    prevGuards: sim.state.guards.map((m) => ({ x: m.body.x, z: m.body.z })),
    prevDogs: sim.state.dogs.map((d) => ({ x: d.body.x, z: d.body.z })),
    prevRats: sim.state.rats.map((r) => ({ x: r.x, z: r.z, mode: r.mode })),
    paused: false,
    walked: 0,
    pilot: new Autopilot(sim.world, () => sim.world.routeGrid(sim.state.layer)),
    guide: null,
    guideAge: 1,
    guideFrom: -1,
    speed: 1,
    waiting: false,
    ops: [],
    ladderFoot: ladderFootOf(sim.world),
    over: false,
    guardKeys: sim.prison.guards.map((d) => itemNumber(`key_${d.key}`)),
    saved: false,
    lesson,
    daily,
  };
  tipsSeen.clear();
  // Achievements and stats follow the run (not a lesson's).
  if (!lesson) startRun(sim, !resumed);
  // The day (P17): the warden's first morning for a new game (after the bell).
  dayStart(sim, !resumed);
  // Loaded asleep or out cold: the veil says which.
  sleepVeil.querySelector('span')!.textContent = t(sim.state.ko > 0 ? 'sleep.knockedOut' : 'sleep.asleep');
  itemsUI.show(true);
  tools.show(true);
  combatUI.show(true);
  resetButtons();
  resetRat();
  resetSmuggle();
  resetGames();
  resetPastimes();
  resetLong();
  resetTeam();
  resetNights();
  resetCrew();
  // No aim carried over from another game (P14).
  cancelThrow();
  play.acc = 0;
  controls.reset();
  controls.enabled = true;
  hud.show(true);
  sound.ambience(true);
  // Irongate's surf and gulls (P12).
  sound.setCoast(sim.world.def.theme === 'island');
  fadeIn();
  document.body.classList.add('is-playing');
  const g = play.game;
  const later = (ms: number, f: () => void) => startTimers.push(window.setTimeout(() => play.game === g && !g.paused && f(), ms));
  // A lesson: its card says what to do; no day one, no guide, no saves.
  if (lesson) return;
  // A Daily (P26): what today's twists are, as the game begins (or is picked up again).
  if (daily) later(resumed ? 4200 : 4400, () => dailyBanner(sim, daily));
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
    // (A Daily, P26: saved in its own slot only; its twists said, and a new try offered.)
    const daily = play.game.daily;
    const sim = play.game.rec.sim;
    const choice = await showPause(
      click,
      play.game.saved,
      !play.game.over && !lesson && !daily,
      lesson ? lessonPlace(lesson.index) : note,
      !!lesson,
      lesson ? '' : daily ? dailyPlace(sim, daily) : `${prisonName(sim.prison)} · ${t('hud.day', { n: sim.clock.day })}`,
      daily ? dailyTwistsHtml(sim.state.mods) : '',
    );
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
    if (choice === 'objectives' && play.game.lesson) {
      await showObjectives(objectivesOf(play.game.lesson), click);
      continue;
    }
    if (choice === 'save') {
      const slot = await showSaves('save', click);
      if (slot !== null && play.game) {
        const ok = writeSave(slot, play.game.rec.sim, undefined, director.rumors, play.game.rec.toLog());
        if (ok) sound.chime();
        else sound.sting();
        note = ok ? t('toast.saved', { n: slot }) : `!${t('toast.saveFailed')}`;
      }
      continue;
    }
    if (choice === 'restart' && play.game.lesson) {
      // The same lesson from its start (the tutorial flow sets it up again).
      play.game.lesson.finish('again');
      return;
    }
    if (choice === 'restart' && play.game.daily) {
      // A new try at the Daily (this one's run let go: asked first).
      if (!(await ask(t('daily.restartSure'), t('daily.tryAgain'), click))) continue;
      if (!play.game) return;
      const n = play.game.daily.n;
      play.game.over = true;
      deleteSave('daily');
      dailyRestart(n);
      endGame();
      return;
    }
    if (choice === 'resume') {
      if (play.game.over) return;
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
  if (play.game !== g || g.over) return;
  g.paused = false;
  controls.enabled = true;
  play.last = performance.now();
}

/** Back to the title: everything the game put up comes down. */
export function endGame() {
  if (play.game) autosave(play.game);
  if (play.game && !play.game.lesson) stopRun();
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
  stowPanel.update(null);
  darkCell.classList.remove('on');
  hint.hide();
  banner.clear();
  vignette.classList.remove('on');
  sound.siren(false);
  sound.ambience(false);
  talk.hide();
  chatterStop();
  dayStop();
  cancelThrow();
  view.setShift(0, 0);
  board.close();
  profile.close();
  ratPanel.close();
  phonePanel.close();
  crewPanel.close();
  trainCard.hide();
  workChips.hide();
  crewChips.hide();
  document.body.classList.remove('is-playing', 'panel-open', 'items-open', 'training');
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
  tools.release();
  itemsUI.closePanels();
  sound.siren(false);
  sound.chime();
  buzz('attended');
  // A Daily (P26): its own records and its own card.
  if (g.daily) return dailyEscaped(g);
  const sim = g.rec.sim;
  const st = sim.state;
  const clock = sim.clock;
  // Kept on this device: the way out joins the prison's list, the quickest is remembered.
  const via = ESCAPES[st.via];
  // The first way out of a prison opens the next one (GDD §4).
  const next = nextPrison(sim.prison);
  const wasOpen = !!next && isOpen(PRISONS.indexOf(next));
  const rec = recordEscape(sim.prison.id, via, clock.day, Math.floor(st.step / STEPS_PER_MINUTE), st.crewOut.length);
  // What the escape earned (P16), and its run log kept to watch again (the prison's quickest too).
  const earned = escapeRun(rec);
  // Toasts still queued give way to the victory card (the shelf marks them new).
  trophyToast.clear();
  // The run is over: nothing left to continue (games kept in slots stay); its log (room freed first) kept to watch again.
  const log: RunLog = { ...g.rec.toLog(), via };
  deleteSave('auto');
  keepReplay(log, rec.best);
  if (!(await escapeScene(g))) return;
  const victory: Victory = {
    prison: t(`prison.${sim.prison.id}` as Key),
    prisonId: sim.prison.id,
    day: clock.day,
    time: formatTime(clock),
    via,
    routes: escapesOf(sim.prison),
    found: rec.record.routes,
    newRoute: rec.newRoute,
    best: rec.best,
    tally: st.tally,
    bestDay: rec.record.bestDay,
    unlocked: next && !wasOpen ? { name: prisonName(next), security: securityOf(next) } : undefined,
    medal: rec.medal,
    newMedal: rec.newMedal,
    routeBest: rec.routeBest,
    bronzeBy: MEDAL_DAYS[sim.prison.id]?.[via]?.[2],
    earned,
    campaign: !next && rec.record.routes.length === 1 && rec.newRoute,
    crew: st.crewOut.map((id) => inmateName(sim, id)),
    watch: true,
  };
  // (Watch the replay, P25: then the card again.)
  let choice: VictoryChoice;
  for (let back = false; ; back = true) {
    choice = await showVictory(victory, click, back);
    if (play.game !== g) return;
    if (choice !== 'watch') break;
    await watchReplay({ log, guest: false, by: null }, g);
    if (play.game !== g) return;
  }
  playAgain = choice === 'again' ? sim.prison : choice === 'next' ? (next ?? null) : null;
  endGame();
}
/** The victory screen's "Play again" (this prison) or "On to" (the next): straight into a new game there, past the title. */
let playAgain: PrisonDef | null = null;
/** The prison chosen to play straight away, if any (asked once: the answer is used up). */
export function takePlayAgain(): PrisonDef | null {
  const again = playAgain;
  playAgain = null;
  return again;
}
