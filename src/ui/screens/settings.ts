import type { Settings } from '../../game/settings';
import { t, type Key } from '../../i18n';
import { h } from '../dom';
import { icon } from '../icons';

type Choice<K extends keyof Settings> = Array<[Settings[K], Key]>;

const QUALITY: Choice<'quality'> = [
  ['auto', 'settings.auto'],
  ['high', 'settings.high'],
  ['low', 'settings.low'],
];
const LANGS: Choice<'lang'> = [
  ['auto', 'settings.auto'],
  ['en', 'settings.english'],
  ['fr', 'settings.french'],
];

/**
 * Settings, as a card over the game; every change applies at once through `apply` (sound,
 * motion, graphics, language). Resolves when closed. Vibration only shows where the device
 * can vibrate.
 */
export function showSettings(settings: Settings, apply: () => void, click: () => void): Promise<void> {
  const el = h('div', 'modal');
  const canVibrate = typeof navigator.vibrate === 'function';
  const toggle = (k: 'haptics' | 'reducedMotion', label: Key) =>
    `<div class="set-row"><span>${t(label)}</span><button class="switch ${settings[k] ? 'on' : ''}" role="switch" aria-checked="${settings[k]}" data-toggle="${k}" aria-label="${t(label)}"><i></i></button></div>`;
  const choice = <K extends 'quality' | 'lang'>(k: K, label: Key, options: Choice<K>) =>
    `<div class="set-row"><span>${t(label)}</span><div class="seg" role="radiogroup" aria-label="${t(label)}">${options
      .map(([v, l]) => `<button role="radio" aria-checked="${settings[k] === v}" class="${settings[k] === v ? 'on' : ''}" data-choice="${k}" data-value="${v}">${t(l)}</button>`)
      .join('')}</div></div>`;
  const render = () => {
    el.innerHTML = `<div class="card settings-card">
      <div class="settings-head"><h2>${t('settings.title')}</h2><button class="icon-btn" data-close aria-label="${t('common.close')}">${icon('close')}</button></div>
      <div class="set-row"><span>${t('settings.sound')}</span><div class="volume">${icon(settings.muted ? 'mute' : 'sound', 18)}<input type="range" min="0" max="100" step="5" value="${settings.muted ? 0 : Math.round(settings.sfxVolume * 100)}" aria-label="${t('settings.sound')}"></div></div>
      ${canVibrate ? toggle('haptics', 'settings.haptics') : ''}
      ${toggle('reducedMotion', 'settings.motion')}
      ${choice('quality', 'settings.quality', QUALITY)}
      ${choice('lang', 'settings.language', LANGS)}
    </div>`;
  };
  render();
  return new Promise((resolve) => {
    const close = () => {
      click();
      removeEventListener('keydown', key);
      el.remove();
      resolve();
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.stopImmediatePropagation();
        close();
      }
    };
    addEventListener('keydown', key, true);
    el.addEventListener('input', (e) => {
      const range = e.target as HTMLInputElement;
      if (range.type !== 'range') return;
      settings.sfxVolume = Number(range.value) / 100;
      settings.muted = settings.sfxVolume === 0;
      apply();
      el.querySelector('.volume .ic')!.outerHTML = icon(settings.muted ? 'mute' : 'sound', 18);
    });
    el.addEventListener('change', () => click());
    el.onclick = (e) => {
      const target = e.target as HTMLElement;
      if (target === el || target.closest('[data-close]')) return close();
      const tg = target.closest<HTMLElement>('[data-toggle]');
      if (tg) {
        const k = tg.dataset.toggle as 'haptics' | 'reducedMotion';
        settings[k] = !settings[k];
      }
      const ch = target.closest<HTMLElement>('[data-choice]');
      if (ch) (settings as unknown as Record<string, string>)[ch.dataset.choice!] = ch.dataset.value!;
      if (!tg && !ch) return;
      click();
      apply();
      // Re-render (the language may have changed every label).
      render();
    };
    document.body.append(el);
  });
}
