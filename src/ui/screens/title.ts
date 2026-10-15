import { TOUCH, h } from '../dom';
import { icon } from '../icons';
import { t } from '../../i18n';
import { keysReady } from '../../i18n/keys';

export type TitleChoice = 'continue' | 'play' | 'load' | 'help' | 'settings';

export interface TitleInfo {
  prisonName: string;
  /** The ways out found so far ("2 of 4 ways out"), empty before the first escape. */
  record?: string;
  /** The game in progress ("Day 3 · 14:20 · Laundry"), when there is one to continue. */
  resume?: string;
  /** Any saved game to load (the game in progress or a slot). */
  saves: boolean;
  muted: boolean;
  /** Flips sound on or off; returns whether it's now muted. */
  toggleSound: () => boolean;
}

/**
 * Title screen over the drifting prison; resolves with the player's choice. A hero card for
 * the main action (Continue the game in progress, else Play), New game and Load under it, How
 * to play and Settings side by side, a sound switch and the controls in the footer, the
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
          <span class="menu-text"><span class="menu-label">${t('title.newGame')}</span><small>${info.record ? `${icon('trophy', 12)}${info.record}` : t('title.prison', { name: info.prisonName })}</small></span>
          ${icon('chevronRight', 16)}
        </button>`
            : `<button class="hero-card play-card" data-c="play">
          <span class="hero-ic">${icon('play', 22)}</span>
          <span class="hero-text"><b>${t('title.play')}</b><small>${t('title.prison', { name: info.prisonName })}</small>${info.record ? `<small class="t-record">${icon('trophy', 13)}${info.record}</small>` : ''}</span>
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
        <div class="title-row">
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
      <div class="title-foot"><button class="sound-toggle ${info.muted ? 'off' : ''}" data-sound>${sound(info.muted)}</button><span class="title-keys">${t(TOUCH ? 'title.touch' : 'title.keys')}</span></div>
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
      const c = target.closest<HTMLElement>('[data-c]')?.dataset.c as TitleChoice | undefined;
      if (!c) return;
      click();
      el.remove();
      resolve(c);
    };
    document.body.append(el);
    // The keys' labels follow the keyboard once the browser says which it is (Z Q S D on AZERTY).
    if (!TOUCH) keysReady.then(() => (el.querySelector('.title-keys')!.textContent = t('title.keys')));
  });
}
