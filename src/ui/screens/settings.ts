import { resetProgress, resetTips, UI_SCALES, type Settings } from '../../game/settings';
import { IOS, SCALES, uiScale } from '../../app/scale';
import { canRumble } from '../../app/haptics';
import { MOBILE } from '../dom';
import { showKeys } from './keys';
import { loadLang, t, type Key } from '../../i18n';
import { h } from '../dom';
import { perfOn, setPerf } from '../../app/perf';
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
const PA: Choice<'pa'> = [
  ['full', 'settings.paFull'],
  ['short', 'settings.paShort'],
  ['off', 'settings.paOff'],
];
/** 2.45: the letters a gamepad's buttons are named with. */
const PAD_BUTTONS: Choice<'padButtons'> = [
  ['auto', 'settings.auto'],
  ['xbox', 'settings.padXbox'],
  ['ps', 'settings.padPs'],
  ['nintendo', 'settings.padNintendo'],
  ['8bitdo', 'settings.pad8bitdo'],
];
/** P42: holidays by the date, one picked now, or none; and which one when picked. */
const HOLIDAYS: Choice<'holidays'> = [
  ['calendar', 'holiday.setCalendar'],
  ['pick', 'holiday.setPick'],
  ['off', 'holiday.setOff'],
];
const HOLIDAY_PICK: Choice<'holidayPick'> = [
  ['easter', 'holiday.short.easter'],
  ['summer', 'holiday.short.summer'],
  ['halloween', 'holiday.short.halloween'],
  ['christmas', 'holiday.short.christmas'],
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
 * the tips can be shown again from anywhere. Last, a Developer section: the frame counter (app/perf.ts).
 */
/** A gamepad plugged in (2.45: its buttons' letters can be picked then). */
const padHere = () => [...(navigator.getGamepads?.() ?? [])].some((p) => p?.connected && p.mapping === 'standard');

export function showSettings(settings: Settings, apply: () => void, click: () => void, fromTitle = false): Promise<void> {
  const el = h('div', 'modal');
  const canVibrate = typeof navigator.vibrate === 'function' || canRumble();
  // (Session 9: the Keys card where there's likely a keyboard: not a phone, or a tablet with a trackpad.)
  const keyboard = !MOBILE || matchMedia('(any-pointer: fine)').matches;
  /** The Keys card is up over this one: the keys are its. */
  let sub = false;
  /** A button waiting for its second press, and what was just done. */
  let armed = '';
  let done = '';
  const toggle = (k: Toggle, label: Key, ic: string) =>
    `<div class="set-row"><span class="set-name">${icon(ic, 17)}${t(label)}</span><button class="switch ${settings[k] ? 'on' : ''}" role="switch" aria-checked="${settings[k]}" data-toggle="${k}" aria-label="${t(label)}"><i></i></button></div>`;
  const choice = <K extends 'quality' | 'lang' | 'chatter' | 'pa' | 'holidays' | 'holidayPick' | 'padButtons'>(
    k: K,
    label: Key,
    ic: string,
    options: Choice<K>,
  ) =>
    `<div class="set-row"><span class="set-name">${icon(ic, 17)}${t(label)}</span><div class="seg" role="radiogroup" aria-label="${t(label)}">${options
      .map(
        ([v, l]) =>
          `<button role="radio" aria-checked="${settings[k] === v}" class="${settings[k] === v ? 'on' : ''}" data-choice="${k}" data-value="${v}">${t(l)}</button>`,
      )
      .join('')}</div></div>`;
  const slider = (k: 'sfx' | 'music', label: Key, value: number, ic: string) =>
    `<div class="set-row"><span class="set-name">${icon(ic, 17)}${t(label)}</span><div class="volume"><input type="range" min="0" max="100" step="5" value="${Math.round(value * 100)}" data-volume="${k}" aria-label="${t(label)}"></div></div>`;
  /**
   * Session 9: the interface's size, where the page's viewport tag sizes it (a phone, a tablet; app/scale.ts),
   * with what this screen allows when that's less; elsewhere, the browser's own zoom does it, and the row says so.
   */
  const scaleRow = () => {
    if (!SCALES)
      return `<div class="set-row"><span class="set-name">${icon('search', 17)}${t('settings.scale')}</span></div><p class="set-note">${t(IOS ? 'settings.scaleSafari' : 'settings.scaleZoom')}</p>`;
    const row = `<div class="set-row"><span class="set-name">${icon('search', 17)}${t('settings.scale')}</span><div class="seg" role="radiogroup" aria-label="${t('settings.scale')}">${UI_SCALES.map(
      (v) =>
        `<button role="radio" aria-checked="${settings.uiScale === v}" class="${settings.uiScale === v ? 'on' : ''}" data-choice="uiScale" data-value="${v}">${Math.round(v * 100)}%</button>`,
    ).join('')}</div></div>`;
    const now = uiScale();
    return now + 0.01 < settings.uiScale ? `${row}<p class="set-note">${t('settings.scaleCapped', { n: Math.round(now * 100) })}</p>` : row;
  };
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
        ${choice('pa', 'settings.pa', 'megaphone', PA)}
        ${choice('holidays', 'holiday.setting', 'tree', HOLIDAYS)}
        ${settings.holidays === 'pick' ? choice('holidayPick', 'holiday.settingPick', 'calendar', HOLIDAY_PICK).replace('class="set-row"', 'class="set-row set-wide"') : ''}
        ${settings.holidays !== 'off' ? `<p class="set-note">${t('holiday.settingNote')}</p>` : ''}
        ${choice('quality', 'settings.quality', 'sun', QUALITY)}
        ${scaleRow()}
        ${choice('lang', 'settings.language', 'chat', LANGS)}
        ${padHere() || settings.padButtons !== 'auto' ? `${choice('padButtons', 'settings.padButtons', 'gamepad', PAD_BUTTONS).replace('class="set-row"', 'class="set-row set-wide"')}<p class="set-note">${t('settings.padButtonsNote')}</p>` : ''}
        ${keyboard ? `<div class="set-row"><span class="set-name">${icon('keyboard', 17)}${t('settings.keys')}</span><button class="link-btn set-open" data-act="keys">${t('settings.keysChange')}${icon('chevronRight', 15)}</button></div>` : ''}
        <h3 class="set-head">${icon('wrench', 14)}${t('settings.developer')}</h3>
        <div class="set-row"><span class="set-name">${icon('monitor', 17)}${t('settings.perf')}</span><button class="switch ${perfOn() ? 'on' : ''}" role="switch" aria-checked="${perfOn()}" data-dev="perf" aria-label="${t('settings.perf')}"><i></i></button></div>
        <p class="set-note">${t('settings.perfNote')}</p>
        <div class="set-actions">
          <button class="link-btn${done === 'tips' ? ' done' : ''}" data-act="tips">${icon(done === 'tips' ? 'check' : 'bulb', 15)}${t(done === 'tips' ? 'settings.tipsReset' : 'settings.resetTips')}</button>
          ${fromTitle ? `<button class="link-btn danger${armed === 'progress' ? ' armed' : ''}${done === 'progress' ? ' done' : ''}" data-act="progress">${icon(done === 'progress' ? 'check' : 'trash', 15)}${t(done === 'progress' ? 'settings.progressReset' : armed === 'progress' ? 'settings.resetSure' : 'settings.resetProgress')}</button>` : ''}
        </div>
      </div>
    </div>`;
  };
  render();
  /** A language picked and being fetched (closing waits for it). */
  let langLoad: Promise<void> = Promise.resolve();
  return new Promise((resolve) => {
    const close = () => {
      click();
      removeEventListener('keydown', key, true);
      el.remove();
      // (A language being fetched: the screen behind redrawn once it's in.)
      void langLoad.then(() => resolve());
    };
    const key = (e: KeyboardEvent) => {
      if (sub) return;
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
        el.querySelector('[data-volume="sfx"]')!.closest('.set-row')!.querySelector('.set-name .ic')!.outerHTML = icon(
          settings.muted ? 'mute' : 'sound',
          17,
        );
      }
      apply();
    });
    el.addEventListener('change', () => click());
    el.onclick = (e) => {
      const target = e.target as HTMLElement;
      if (target === el || target.closest('[data-close]')) return close();
      const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'keys') {
        click();
        sub = true;
        void showKeys(settings, apply, click).then(() => {
          sub = false;
          el.querySelector<HTMLElement>('[data-act="keys"]')?.focus();
        });
        return;
      }
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
      // (The developer's frame counter: kept apart from the settings, as `?perf` sets it too: app/perf.ts.)
      const dev = target.closest<HTMLElement>('[data-dev]');
      if (dev) setPerf(!perfOn());
      const ch = target.closest<HTMLElement>('[data-choice]');
      const langBefore = settings.lang;
      if (ch?.dataset.choice === 'uiScale') settings.uiScale = Number(ch.dataset.value);
      else if (ch) (settings as unknown as Record<string, string>)[ch.dataset.choice!] = ch.dataset.value!;
      if (!tg && !ch && !act && !dev) return;
      click();
      const redo = () => {
        apply();
        // Re-render (the language may have changed every label), keeping the scroll.
        const top = el.querySelector('.settings-scroll')?.scrollTop ?? 0;
        render();
        el.querySelector('.settings-scroll')!.scrollTop = top;
      };
      // A language picked: its text fetched first (French is a file of its own, v2.34.2), then shown;
      // not fetched (an old tab after an update deleted its files), the language stays as it was.
      if (ch?.dataset.choice === 'lang')
        langLoad = loadLang(settings.lang).then((ok) => {
          if (!ok) settings.lang = langBefore;
          redo();
        });
      else redo();
    };
    document.body.append(el);
  });
}
