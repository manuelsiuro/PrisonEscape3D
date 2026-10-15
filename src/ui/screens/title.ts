import { TOUCH, h } from '../dom';
import { icon } from '../icons';
import { t } from '../../i18n';

export type TitleChoice = 'play' | 'settings';

export interface TitleInfo {
  prisonName: string;
  /** The ways out found so far ("2 of 4 ways out"), empty before the first escape. */
  record?: string;
  muted: boolean;
  /** Flips sound on or off; returns whether it's now muted. */
  toggleSound: () => boolean;
}

/**
 * Title screen over the drifting prison; resolves with the player's choice. A hero card for
 * the main action, a sound switch and the controls in the footer, the version in the corner.
 */
export function showTitle(info: TitleInfo, click: () => void): Promise<TitleChoice> {
  const sound = (muted: boolean) => `${icon(muted ? 'mute' : 'sound', 16)}<span>${t(muted ? 'title.soundOff' : 'title.soundOn')}</span>`;
  const el = h(
    'div',
    'title-screen',
    `<div class="title-inner">
      <div class="logo"><div class="logo-mark">${icon('bars', 40)}</div><h1>Prison Escape <span>3D</span></h1><p class="tagline">${t('title.tagline')}</p></div>
      <div class="title-actions">
        <button class="hero-card play-card" data-c="play">
          <span class="hero-ic">${icon('play', 22)}</span>
          <span class="hero-text"><b>${t('title.play')}</b><small>${t('title.prison', { name: info.prisonName })}</small>${info.record ? `<small class="t-record">${icon('trophy', 13)}${info.record}</small>` : ''}</span>
        </button>
        <button class="menu-btn" data-c="settings" style="--tone:#8a94a6;--tone-2:#5d6779">
          <span class="menu-ic">${icon('gear', 18)}</span>
          <span class="menu-text"><span class="menu-label">${t('title.settings')}</span></span>
          ${icon('chevronRight', 16)}
        </button>
      </div>
      <div class="title-foot"><button class="sound-toggle ${info.muted ? 'off' : ''}" data-sound>${sound(info.muted)}</button><span>${t(TOUCH ? 'title.touch' : 'title.keys')}</span></div>
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
  });
}
