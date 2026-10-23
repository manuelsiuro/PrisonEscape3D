import { h } from '../dom';
import { icon } from '../icons';
import { t } from '../../i18n';
import { showShare } from './share';

export type TitleChoice = 'continue' | 'play' | 'load' | 'tutorial' | 'trophies' | 'help' | 'settings' | 'daily';

export interface TitleInfo {
  /** Where Play goes: the prison and its security level, or how many prisons are open to choose from. */
  prisonLine: string;
  /** The ways out found so far ("2 of 4 ways out"), empty before the first escape. */
  record?: string;
  /** The game in progress ("Day 3 · 14:20 · Laundry"), when there is one to continue. */
  resume?: string;
  /** Any saved game to load (the game in progress or a slot). */
  saves: boolean;
  /** The tutorial's progress ("3 of 9 lessons"), and whether it's where a newcomer should start. */
  tutorial: string;
  newcomer: boolean;
  /** The Daily Escape (P26): today's ("#12 · Shankton · 2 twists"), whether it's done today, the streak; locked before a first escape. */
  daily: { line: string; done: boolean; streak: number; locked: boolean };
  /** Achievements earned (12 of 42), and whether some are new since the shelf was last opened (P16). */
  trophies: { n: number; of: number };
  trophiesNew: boolean;
  muted: boolean;
  /** The button to focus (the one that opened the screen just closed: Play, Settings…), so a keyboard picks up where it was. */
  focus?: TitleChoice | null;
  /** Flips sound on or off; returns whether it's now muted. */
  toggleSound: () => boolean;
}

/**
 * Title screen over the drifting prison; resolves with the player's choice. A hero card for
 * the main action (Continue the game in progress, else Play), New game and Load under it,
 * Trophies (P16), How to play and Settings side by side, a sound switch and Share (the game's link as a QR code) in the footer, the
 * version in the corner.
 */
export function showTitle(info: TitleInfo, click: () => void): Promise<TitleChoice> {
  const sound = (muted: boolean) => `${icon(muted ? 'mute' : 'sound', 16)}<span>${t(muted ? 'title.soundOff' : 'title.soundOn')}</span>`;
  const el = h(
    'div',
    'title-screen',
    `<div class="title-inner">
      <div class="logo"><div class="logo-mark">${icon('bars', 40)}</div><h1>Prison Escape <span>3D</span></h1><p class="tagline">${t('title.tagline')}</p></div>
      <div class="title-actions">
        ${
          info.resume
            ? `<button class="hero-card play-card" data-c="continue">
          <span class="hero-ic">${icon('play', 22)}</span>
          <span class="hero-text"><b>${t('title.continue')}</b><small>${info.resume}</small></span>
        </button>
        <button class="menu-btn" data-c="play" style="--tone:#ff7714;--tone-2:#d9530a">
          <span class="menu-ic">${icon('replay', 18)}</span>
          <span class="menu-text"><span class="menu-label">${t('title.newGame')}</span><small>${info.record ? `${icon('trophy', 12)}${info.record}` : info.prisonLine}</small></span>
          ${icon('chevronRight', 16)}
        </button>`
            : `<button class="hero-card play-card" data-c="play">
          <span class="hero-ic">${icon('play', 22)}</span>
          <span class="hero-text"><b>${t('title.play')}</b><small>${info.prisonLine}</small>${info.record ? `<small class="t-record">${icon('trophy', 13)}${info.record}</small>` : ''}</span>
        </button>`
        }
        ${
          info.saves
            ? `<button class="menu-btn" data-c="load" style="--tone:#6f93b8;--tone-2:#3d5f84">
          <span class="menu-ic">${icon('folder', 18)}</span>
          <span class="menu-text"><span class="menu-label">${t('title.load')}</span></span>
          ${icon('chevronRight', 16)}
        </button>`
            : ''
        }
        <button class="menu-btn daily-btn${info.daily.locked ? ' locked' : info.daily.done ? ' done' : ''}" data-c="daily" style="--tone:#2fb6c8;--tone-2:#1d7f9a"${info.daily.locked ? ' aria-disabled="true"' : ''}>
          <span class="menu-ic">${icon(info.daily.locked ? 'lock' : 'calendar', 18)}</span>
          <span class="menu-text"><span class="menu-label">${t('daily.title')}</span><small></small></span>
          ${info.daily.locked ? '' : info.daily.done ? `<span class="daily-pill done">${icon('check', 12)}${info.daily.streak > 1 ? t('daily.streakShort', { n: info.daily.streak }) : t('daily.doneShort')}</span>` : info.daily.streak ? `<span class="daily-pill" aria-label="${t('daily.streakShort', { n: info.daily.streak })}">${icon('flame', 12)}${info.daily.streak}</span>` : `<span class="daily-pill new">${t('daily.new')}</span>`}
        </button>
        <button class="menu-btn${info.newcomer ? ' suggest' : ''}" data-c="tutorial" style="--tone:#8e4fc4;--tone-2:#6a35a0">
          <span class="menu-ic">${icon('book', 18)}</span>
          <span class="menu-text"><span class="menu-label">${t('title.tutorial')}</span><small>${info.tutorial}</small></span>
          ${icon('chevronRight', 16)}
        </button>
        <div class="title-row three">
          <button class="menu-btn" data-c="trophies" style="--tone:#e2a21b;--tone-2:#b87a0c;--done:${Math.round((100 * info.trophies.n) / Math.max(1, info.trophies.of))}%">
            <span class="menu-ic">${icon('trophy', 18)}<span class="menu-count${info.trophiesNew ? ' new' : ''}" aria-hidden="true">${info.trophies.n}/${info.trophies.of}</span></span>
            <span class="menu-text"><span class="menu-label">${t('title.trophies')}</span><span class="sr-only">, ${t('title.trophiesSr', info.trophies)}${info.trophiesNew ? `, ${t('trophy.newSr')}` : ''}</span></span>
            <span class="menu-bar"></span>
          </button>
          <button class="menu-btn" data-c="help" style="--tone:#3fb07a;--tone-2:#1f8a5a">
            <span class="menu-ic">${icon('help', 18)}</span>
            <span class="menu-text"><span class="menu-label">${t('title.help')}</span></span>
          </button>
          <button class="menu-btn" data-c="settings" style="--tone:#8a94a6;--tone-2:#5d6779">
            <span class="menu-ic">${icon('gear', 18)}</span>
            <span class="menu-text"><span class="menu-label">${t('title.settings')}</span></span>
          </button>
        </div>
      </div>
      <div class="title-foot"><button class="sound-toggle ${info.muted ? 'off' : ''}" data-sound>${sound(info.muted)}</button><button class="share-toggle" data-share>${icon('share', 15)}<span>${t('title.share')}</span></button></div>
    </div>
    <span class="title-version">v${__APP_VERSION__}</span>`,
  );
  return new Promise((resolve) => {
    el.onclick = (e) => {
      const target = e.target as HTMLElement;
      const toggle = target.closest<HTMLElement>('[data-sound]');
      if (toggle) {
        const muted = info.toggleSound();
        toggle.classList.toggle('off', muted);
        toggle.innerHTML = sound(muted);
        if (!muted) click();
        return;
      }
      const shareBtn = target.closest<HTMLElement>('[data-share]');
      if (shareBtn) {
        click();
        // (Over the title, which stays, out of reach of Tab meanwhile; the keyboard back on Share once it's closed.)
        el.inert = true;
        void showShare(click).then(() => {
          el.inert = false;
          shareBtn.focus({ preventScroll: true });
        });
        return;
      }
      const btn = target.closest<HTMLElement>('[data-c]');
      const c = btn?.dataset.c as TitleChoice | undefined;
      if (!c) return;
      // (The Daily before a first escape: says what opens it.)
      if (btn!.getAttribute('aria-disabled') === 'true') {
        click();
        btn!.classList.remove('shake');
        void btn!.offsetWidth;
        btn!.classList.add('shake');
        return;
      }
      click();
      el.remove();
      resolve(c);
    };
    el.querySelector('.daily-btn small')!.textContent = info.daily.line;
    document.body.append(el);
    if (info.focus) el.querySelector<HTMLElement>(`[data-c="${info.focus}"]`)?.focus({ preventScroll: true });
  });
}
