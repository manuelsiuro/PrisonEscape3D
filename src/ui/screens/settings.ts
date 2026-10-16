import { resetProgress, resetTips, type Settings } from '../../game/settings';
import { t, type Key } from '../../i18n';
import { h } from '../dom';
import { icon } from '../icons';

type Choice<K extends keyof Settings> = Array<[Settings[K], Key]>;

const QUALITY: Choice<'quality'> = [
  ['auto', 'settings.auto'],
  ['high', 'settings.high'],
  ['low', 'settings.low'],
];
const CHATTER: Choice<'chatter'> = [
  ['lots', 'settings.chatterLots'],
  ['some', 'settings.chatterSome'],
  ['off', 'settings.chatterOff'],
];
const LANGS: Choice<'lang'> = [
  ['auto', 'settings.auto'],
  ['en', 'settings.english'],
  ['fr', 'settings.french'],
];

type Toggle = 'haptics' | 'reducedMotion' | 'shake' | 'tips' | 'voices';

/**
 * Settings, as a card over the game; every change applies at once through `apply` (sound,
 * music, motion, graphics, language). Resolves when closed. Vibration only shows where the
 * device can vibrate. From the title (`fromTitle`), the progress can be wiped (asked twice);
 * the tips can be shown again from anywhere.
 */
export function showSettings(settings: Settings, apply: () => void, click: () => void, fromTitle = false): Promise<void> {
  const el = h('div', 'modal');
  const canVibrate = typeof navigator.vibrate === 'function';
  /** A button waiting for its second press, and what was just done. */
  let armed = '';
  let done = '';
  const toggle = (k: Toggle, label: Key, ic: string) =>
    `<div class="set-row"><span class="set-name">${icon(ic, 17)}${t(label)}</span><button class="switch ${settings[k] ? 'on' : ''}" role="switch" aria-checked="${settings[k]}" data-toggle="${k}" aria-label="${t(label)}"><i></i></button></div>`;
  const choice = <K extends 'quality' | 'lang' | 'chatter'>(k: K, label: Key, ic: string, options: Choice<K>) =>
    `<div class="set-row"><span class="set-name">${icon(ic, 17)}${t(label)}</span><div class="seg" role="radiogroup" aria-label="${t(label)}">${options
      .map(([v, l]) => `<button role="radio" aria-checked="${settings[k] === v}" class="${settings[k] === v ? 'on' : ''}" data-choice="${k}" data-value="${v}">${t(l)}</button>`)
      .join('')}</div></div>`;
  const slider = (k: 'sfx' | 'music', label: Key, value: number, ic: string) =>
    `<div class="set-row"><span class="set-name">${icon(ic, 17)}${t(label)}</span><div class="volume"><input type="range" min="0" max="100" step="5" value="${Math.round(value * 100)}" data-volume="${k}" aria-label="${t(label)}"></div></div>`;
  const render = () => {
    el.innerHTML = `<div class="card settings-card">
      <div class="settings-head"><h2>${t('settings.title')}</h2><button class="icon-btn" data-close aria-label="${t('common.close')}">${icon('close')}</button></div>
      <div class="settings-scroll">
        ${slider('sfx', 'settings.sound', settings.muted ? 0 : settings.sfxVolume, settings.muted ? 'mute' : 'sound')}
        ${slider('music', 'settings.music', settings.musicVolume, 'music')}
        ${canVibrate ? toggle('haptics', 'settings.haptics', 'vibrate') : ''}
        ${toggle('shake', 'settings.shake', 'bolt')}
        ${toggle('reducedMotion', 'settings.motion', 'eye')}
        ${toggle('tips', 'settings.tips', 'bulb')}
        ${choice('chatter', 'settings.chatter', 'users', CHATTER)}
        ${toggle('voices', 'settings.voices', 'ear')}
        ${choice('quality', 'settings.quality', 'sun', QUALITY)}
        ${choice('lang', 'settings.language', 'chat', LANGS)}
        <div class="set-actions">
          <button class="link-btn${done === 'tips' ? ' done' : ''}" data-act="tips">${icon(done === 'tips' ? 'check' : 'bulb', 15)}${t(done === 'tips' ? 'settings.tipsReset' : 'settings.resetTips')}</button>
          ${fromTitle ? `<button class="link-btn danger${armed === 'progress' ? ' armed' : ''}${done === 'progress' ? ' done' : ''}" data-act="progress">${icon(done === 'progress' ? 'check' : 'trash', 15)}${t(done === 'progress' ? 'settings.progressReset' : armed === 'progress' ? 'settings.resetSure' : 'settings.resetProgress')}</button>` : ''}
        </div>
      </div>
    </div>`;
  };
  render();
  return new Promise((resolve) => {
    const close = () => {
      click();
      removeEventListener('keydown', key, true);
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
      const v = Number(range.value) / 100;
      // Turning the music up turns the sound back on (the title's switch mutes both).
      if (range.dataset.volume === 'music') {
        settings.musicVolume = v;
        if (v > 0 && settings.muted && settings.sfxVolume > 0) {
          settings.muted = false;
          const sfx = el.querySelector<HTMLInputElement>('[data-volume="sfx"]')!;
          sfx.value = String(Math.round(settings.sfxVolume * 100));
          sfx.closest('.set-row')!.querySelector('.set-name .ic')!.outerHTML = icon('sound', 17);
        }
      } else {
        settings.sfxVolume = v;
        settings.muted = v === 0;
        el.querySelector('[data-volume="sfx"]')!.closest('.set-row')!.querySelector('.set-name .ic')!.outerHTML = icon(settings.muted ? 'mute' : 'sound', 17);
      }
      apply();
    });
    el.addEventListener('change', () => click());
    el.onclick = (e) => {
      const target = e.target as HTMLElement;
      if (target === el || target.closest('[data-close]')) return close();
      const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'tips') {
        resetTips();
        done = 'tips';
      } else if (act === 'progress') {
        if (armed === 'progress') {
          resetProgress();
          armed = '';
          done = 'progress';
        } else armed = 'progress';
      }
      const tg = target.closest<HTMLElement>('[data-toggle]');
      if (tg) {
        const k = tg.dataset.toggle as Toggle;
        settings[k] = !settings[k];
      }
      const ch = target.closest<HTMLElement>('[data-choice]');
      if (ch) (settings as unknown as Record<string, string>)[ch.dataset.choice!] = ch.dataset.value!;
      if (!tg && !ch && !act) return;
      click();
      apply();
      // Re-render (the language may have changed every label), keeping the scroll.
      const top = el.querySelector('.settings-scroll')?.scrollTop ?? 0;
      render();
      el.querySelector('.settings-scroll')!.scrollTop = top;
    };
    document.body.append(el);
  });
}
