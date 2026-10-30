import { escapesOf, prisonById, PRISONS } from '../content/prisons';
import { recordOf } from '../game/records';
import { ALL_SLOTS, deleteSave, loadSave, readSave, rebuiltSince, type SaveFile, type SlotId } from '../game/saves';
import { readLog } from '../game/logs';
import { t } from '../i18n';
import { Sim } from '../sim/Sim';
import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { ask } from '../ui/screens/ask';
import { showHelp } from '../ui/screens/help';
import { saveWhen, showSaves } from '../ui/screens/saves';
import { showSettings } from '../ui/screens/settings';
import { showTitle, type TitleChoice } from '../ui/screens/title';
import { prisonName, securityOf, showPrisons } from '../ui/screens/prisons';
import { openPrisons } from '../game/campaign';
import { applySettings, banner, click, settings, sound, view } from '../play/context';
import { play } from '../play/game';
import { startGame, takePlayAgain, untilQuit } from '../play/session';
import { settingsChanged } from '../play/tips';
import { lessonsDone } from '../game/lessons';
import { LESSONS } from '../tutorial/lessons';
import { tutorialFlow } from './tutorial';
import { dailyFlow } from './daily';
import { dailyNumber, dailyOf } from '../content/daily';
import { dailyRecord, streakOf } from '../game/daily';
import { intakeFlow } from './intake';
import { ACHIEVEMENTS } from '../content/achievements';
import { readPrisoner } from '../game/prisoner';
import { careerOf, earnedTrophies, markTrophiesSeen, syncCareer, unseenTrophies } from '../game/trophies';
import { showTrophies } from '../ui/screens/trophies';
import { watchReplay } from '../play/replay';
import { newRunHoliday } from '../play/holidays';

// ------------------------------------------------------------------ flows
/** The title, and from it into a game (new, continued or loaded) and back, for good. */
export async function titleFlow() {
  /** A choice made elsewhere (the tutorial's last lesson: play), taken instead of the title's. */
  /** The title button whose screen was last opened (focused when the title comes back). */
  let back: TitleChoice | null = null;
  let next: 'play' | null = null;
  for (;;) {
    sound.music('title');
    showUpdate();
    // (P42: the prison behind the title dressed for the holiday, the date's as Settings have it.)
    view.setHoliday(newRunHoliday(backdrop));
    const again = takePlayAgain();
    const open = openPrisons();
    // Progress reset (settings): the prison behind the title may be locked again.
    if (!open.includes(backdrop)) {
      backdrop = open.at(-1) ?? PRISONS[0];
      view.setWorld(new Sim(backdrop).world);
    }
    // Ways out found across the campaign, of all its prisons have.
    const found = PRISONS.reduce((n, p) => n + recordOf(p.id).routes.length, 0);
    // What the records and the stats have earned so far (older escapes included).
    syncCareer();
    const earned = Object.keys(earnedTrophies()).length;
    const resume = readSave('auto');
    const choice: TitleChoice = again || next
      ? 'play'
      : await showTitle(
          {
            prisonLine: open.length > 1 ? t('title.prisonsOpen', { n: open.length, of: PRISONS.length }) : t('title.prison', { name: prisonName(open[0]), security: securityOf(open[0]) }),
            record: found ? t('title.record', { n: found, of: PRISONS.reduce((n, p) => n + escapesOf(p).length, 0) }) : '',
            resume: resume ? saveWhen(resume) : undefined,
            saves: ALL_SLOTS.some((k) => readSave(k)),
            tutorial: t(lessonsDone().length < 2 ? 'title.tutorialSub1' : 'title.tutorialSub', { n: lessonsDone().length, of: LESSONS.length }),
            newcomer: !resume && lessonsDone().length === 0 && !found,
            daily: dailyCard(found > 0),
            trophies: { n: earned, of: ACHIEVEMENTS.length },
            trophiesNew: unseenTrophies().length > 0,
            focus: back,
            muted: settings.muted,
            toggleSound: () => {
              settings.muted = !settings.muted;
              if (!settings.muted && settings.sfxVolume === 0) settings.sfxVolume = 0.8;
              applySettings();
              return settings.muted;
            },
          },
          click,
        );
    next = null;
    // Back on the title after this choice's screen (closed, or a game over): its button gets the focus.
    back = choice;
    updateCard?.remove();
    if (choice === 'settings') {
      await showSettings(settings, settingsChanged, click, true);
      continue;
    }
    if (choice === 'help') {
      // A lesson picked on a topic's page is played, then the page is there again.
      let topic: string | undefined;
      for (;;) {
        const picked = await showHelp(click, { lessons: true, topic });
        if (!picked) break;
        topic = picked.topic;
        const k = LESSONS.findIndex((l) => l.id === picked.lesson);
        const played = await tutorialFlow(k);
        view.setWorld(new Sim(backdrop).world);
        if (played) {
          next = 'play';
          break;
        }
      }
      continue;
    }
    if (choice === 'trophies') {
      // The shelf, and from it the Intake or a replay (P25; back to the shelf after).
      let back: Awaited<ReturnType<typeof showTrophies>> = null;
      while ((back = await showTrophies({ earned: earnedTrophies(), unseen: unseenTrophies(), career: careerOf(), prisoner: readPrisoner() }, click, back?.tab, back?.to === 'intake' ? '[data-intake]' : back?.to === 'watch' ? back.from : null))) {
        markTrophiesSeen();
        if (back.to === 'watch') {
          await watchReplay(back.replay, null);
          view.setWorld(new Sim(backdrop).world);
          sound.music('title');
        } else await intakeFlow();
      }
      markTrophiesSeen();
      continue;
    }
    if (choice === 'daily') {
      await dailyFlow();
      continue;
    }
    if (choice === 'tutorial') {
      if (await tutorialFlow()) next = 'play';
      view.setWorld(new Sim(backdrop).world);
      continue;
    }
    let sim: Sim | null = null;
    let rumors: SaveFile['rumors'];
    /** A new game's seed (its run log starts from it); a loaded game carries on its slot's log. */
    let seed = -1;
    let slot: SlotId | null = null;
    if (choice === 'play') {
      // Which prison (GDD §13.1): the one chosen on the victory screen, else picked from those
      // open (straight into the first while it's the only one).
      const prison = again ?? (open.length > 1 ? await showPrisons(click) : open[0]);
      if (!prison) continue;
      // A new game replaces the one in progress: asked first (games in slots stay).
      if (!again && resume && !(await ask(t('title.newSure', { when: saveWhen(resume) }), t('title.newYes'), click))) continue;
      // The first game: the Intake first (once; skipped, it isn't asked again).
      if (!readPrisoner()) {
        view.setWorld(new Sim(prison).world);
        // Escape: not now (back to the title).
        if (!(await intakeFlow(true))) continue;
      }
      seed = Date.now() & 0x7fffffff;
      sim = new Sim(prison, seed, [], newRunHoliday(prison));
    } else {
      slot = choice === 'continue' ? 'auto' : await showSaves('load', click);
      if (slot === null) continue;
      const f = readSave(slot);
      // (P31: its prison rebuilt since: the run starts again there, the stale save let go.)
      if (f && rebuiltSince(f)) {
        const prison = prisonById(f.prison)!;
        deleteSave(slot);
        banner.toast(t('toast.rebuilt', { prison: prisonName(prison) }), 'info', 6000);
        seed = Date.now() & 0x7fffffff;
        sim = new Sim(prison, seed, [], newRunHoliday(prison));
        startGame(sim, false, null, [], { seed });
        backdrop = sim.prison;
        await untilQuit();
        view.setWorld(new Sim(backdrop).world);
        continue;
      }
      sim = f && loadSave(f);
      rumors = f?.rumors;
      if (!sim) {
        banner.toast(t('toast.loadFailed'), 'bad');
        continue;
      }
    }
    startGame(sim, choice !== 'play', null, rumors, seed >= 0 ? { seed } : { log: slot === null ? null : readLog(slot) });
    backdrop = sim.prison;
    await untilQuit();
    view.setWorld(new Sim(backdrop).world);
  }
}

/** The prison behind the title: the last one played (this session), else the newest open. */
let backdrop = openPrisons().at(-1) ?? PRISONS[0];

/** A new version waiting (the installed app): offered on the title, never mid-game. */
let update: { version: string | null; restart: () => void } | null = null;
let updateCard: HTMLElement | null = null;
function showUpdate() {
  if (!update || play.game) return;
  updateCard?.remove();
  const u = update;
  updateCard = h(
    'div',
    'update-card',
    `<span class="uc-ic">${icon('star', 18)}</span><span class="uc-text"><b>${t('update.title')}</b><small></small></span><button class="uc-btn">${icon('replay', 15)}<span>${t('update.restart')}</span></button>`,
  );
  updateCard.setAttribute('role', 'status');
  updateCard.querySelector('small')!.textContent = u.version ? t('update.version', { v: u.version }) : t('update.note');
  updateCard.querySelector('button')!.onclick = () => {
    click();
    u.restart();
  };
  document.body.append(updateCard);
}

/** A new version is ready: offered now if the title is up, else the next time it is. */
export function offerUpdate(version: string | null, restart: () => void) {
  update = { version, restart };
  showUpdate();
}

/** The title's Daily card (P26): today's prison and how many twists, done or not, the streak; locked before a first escape anywhere. */
function dailyCard(open: boolean) {
  const n = dailyNumber(new Date());
  const d = dailyOf(n);
  if (!open) return { line: t('daily.locked'), done: false, streak: 0, locked: true };
  return {
    line: t(d.twists.length === 1 ? 'daily.line1' : 'daily.line', { n: n + 1, prison: prisonName(d.prison), twists: d.twists.length }),
    done: !!dailyRecord(n).best,
    streak: streakOf(n),
    locked: false,
  };
}
