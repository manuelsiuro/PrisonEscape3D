import { escapesOf, PRISONS } from '../content/prisons';
import { recordOf } from '../game/records';
import { ALL_SLOTS, loadSave, readSave, type SaveFile, type SlotId } from '../game/saves';
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
    const again = takePlayAgain();
    const open = openPrisons();
    // Progress reset (settings): the prison behind the title may be locked again.
    if (!open.includes(backdrop)) {
      backdrop = open.at(-1) ?? PRISONS[0];
      view.setWorld(new Sim(backdrop).world);
    }
    // Ways out found across the campaign, of all its prisons have.
    const found = PRISONS.reduce((n, p) => n + recordOf(p.id).routes.length, 0);
    const resume = readSave('auto');
    const choice: TitleChoice = again || next
      ? 'play'
      : await showTitle(
          {
            prisonLine: open.length > 1 ? t('title.prisonsOpen', { n: open.length, of: PRISONS.length }) : t('title.prison', { name: prisonName(open[0]), security: securityOf(open[0]) }),
            record: found ? t('title.record', { n: found, of: PRISONS.reduce((n, p) => n + escapesOf(p).length, 0) }) : '',
            resume: resume ? saveWhen(resume) : undefined,
            saves: ALL_SLOTS.some((k) => readSave(k)),
            tutorial: t('title.tutorialSub', { n: lessonsDone().length, of: LESSONS.length }),
            newcomer: !resume && lessonsDone().length === 0 && !found,
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
      await showHelp(click);
      continue;
    }
    if (choice === 'tutorial') {
      if (await tutorialFlow()) next = 'play';
      view.setWorld(new Sim(backdrop).world);
      continue;
    }
    let sim: Sim | null = null;
    let rumors: SaveFile['rumors'];
    if (choice === 'play') {
      // Which prison (GDD §13.1): the one chosen on the victory screen, else picked from those
      // open (straight into the first while it's the only one).
      const prison = again ?? (open.length > 1 ? await showPrisons(click) : open[0]);
      if (!prison) continue;
      // A new game replaces the one in progress: asked first (games in slots stay).
      if (!again && resume && !(await ask(t('title.newSure', { when: saveWhen(resume) }), t('title.newYes'), click))) continue;
      sim = new Sim(prison, Date.now() & 0x7fffffff);
    } else {
      const slot: SlotId | null = choice === 'continue' ? 'auto' : await showSaves('load', click);
      if (slot === null) continue;
      const f = readSave(slot);
      sim = f && loadSave(f);
      rumors = f?.rumors;
      if (!sim) {
        banner.toast(t('toast.loadFailed'), 'bad');
        continue;
      }
    }
    startGame(sim, choice !== 'play', null, rumors);
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
