import { ROUTINE } from '../../content/routine';
import { openPrisons } from '../../game/campaign';
import { t, type Key } from '../../i18n';
import { withKeys } from '../../i18n/keys';
import { TOUCH, h } from '../dom';
import { icon } from '../icons';

/**
 * How to play (GDD §13): the basics with the day's schedule, prison life, escaping, and the
 * controls of this device (keys or touch, with the other a tab away). Opened from the title,
 * the pause card and H. Resolves when closed.
 */
type Tab = 'basics' | 'life' | 'escape' | 'controls';
const TABS: Tab[] = ['basics', 'life', 'escape', 'controls'];

/** A rule: its icon and color, then help.<id>.t (title) and help.<id> (text); a prison's own rules name it (shown once it's open). */
const TOPICS: Record<Exclude<Tab, 'controls'>, Array<[string, string, string, string?]>> = {
  basics: [
    ['goal', 'route', '#ff7714'],
    ['routine', 'clock', '#3d7fd0'],
    ['heat', 'flame', '#e5484d'],
    ['items', 'briefcase', '#8e5a2b'],
    ['craft', 'hammer', '#6f93b8'],
    ['energy', 'heart', '#e0507a'],
  ],
  life: [
    ['guards', 'eye', '#1e3a5f'],
    ['caught', 'siren', '#e5484d'],
    ['searches', 'bell', '#d9930a'],
    ['work', 'coin', '#c99a12'],
    ['inmates', 'chat', '#3fb07a'],
    ['chatter', 'ear', '#d9a21b'],
    ['train', 'dumbbell', '#8e4fc4'],
    ['fight', 'fist', '#c0392b'],
  ],
  escape: [
    ['tools', 'pick', '#6f93b8'],
    ['layers', 'down', '#8e5a2b'],
    ['cover', 'lock', '#5d6779'],
    ['power', 'plug', '#d9930a'],
    ['cams', 'camera', '#2fb6c8'],
    ['towers', 'target', '#e5484d'],
    ['ways', 'hook', '#ff7714'],
    ['weather', 'snow', '#2f78be', 'stalag-flucht'],
    ['shell', 'shield', '#5d6b7a', 'shankton'],
    ['mines', 'mine', '#c8372d', 'san-pancho'],
    ['island', 'boat', '#2b6f9a', 'irongate'],
  ],
};

/** Read when shown (the language and the keyboard's labels may change). */
const keys = (): Array<[string, Key]> => [
  ['%KeyW% %KeyA% %KeyS% %KeyD%', 'help.k.walk'],
  [t('help.k.clickKey'), 'help.k.click'],
  ['%KeyE%', 'help.k.act'],
  [t('help.k.space'), 'help.k.use'],
  ['%KeyR%', 'help.k.lock'],
  ['1 – 6', 'help.k.slots'],
  ['%KeyQ%', 'help.k.drop'],
  ['%KeyC%', 'help.k.craft'],
  ['%KeyI%', 'help.k.file'],
  ['%KeyH%', 'help.k.help'],
  [t('help.k.esc'), 'help.k.pause'],
];

const TOUCHES: Array<[string, Key]> = [
  ['walk', 'help.t.stick'],
  ['pin', 'help.t.tap'],
  ['hand', 'help.t.act'],
  ['pick', 'help.t.use'],
  ['target', 'help.t.lock'],
  ['hammer', 'help.t.slots'],
  ['coin', 'help.t.file'],
  ['pause', 'help.t.pause'],
];

const row = (id: string, ic: string, tone: string) =>
  `<section class="help-row"><span class="help-ic" style="--tone:${tone}">${icon(ic, 22)}</span><div><h3>${t(`help.${id}.t` as Key)}</h3><p>${t(`help.${id}` as Key)}</p></div></section>`;

const pad = (n: number) => String(n).padStart(2, '0');

/** The day, block by block: when, what, where, and what missing it costs. */
function schedule() {
  const rows = ROUTINE.map((r) => {
    const miss =
      r.miss === 'lockdown'
        ? `<em class="must lock">${t('help.mustLockdown')}</em>`
        : r.miss === 'heat'
          ? `<em class="must">${t('help.mustHeat')}</em>`
          : r.id === 'work'
            ? `<em class="must job">${t('help.mustJob')}</em>`
            : r.id === 'lightsOut'
              ? `<em class="must lock">${t('help.mustCell')}</em>`
              : '';
    return `<li><time>${pad(r.start / 60)}:00</time><span>${t(`routine.${r.id}` as Key)}</span>${miss}</li>`;
  }).join('');
  return `<h3 class="help-sub">${icon('clock', 16)}${t('help.schedule')}</h3><ol class="help-day">${rows}</ol>`;
}

function body(tab: Tab, touch: boolean) {
  if (tab === 'basics') return TOPICS.basics.map(([id, ic, tone]) => row(id, ic, tone)).join('') + schedule();
  // A prison's own rules only once it's open (no spoilers of the campaign ahead).
  if (tab !== 'controls')
    return TOPICS[tab]
      .filter(([, , , prison]) => !prison || openPrisons().some((p) => p.id === prison))
      .map(([id, ic, tone]) => row(id, ic, tone))
      .join('');
  const which = `<div class="seg help-device" role="radiogroup">${(['keys', 'touch'] as const)
    .map((d) => `<button role="radio" data-device="${d}" class="${(d === 'touch') === touch ? 'on' : ''}" aria-checked="${(d === 'touch') === touch}">${icon(d === 'keys' ? 'keyboard' : 'hand', 15)}${t(`help.device.${d}`)}</button>`)
    .join('')}</div>`;
  const list = touch
    ? TOUCHES.map(([ic, k]) => `<li><span class="help-btn">${icon(ic, 18)}</span><span>${t(k)}</span></li>`).join('')
    : keys().map(([label, k]) => `<li><kbd>${withKeys(label)}</kbd><span>${t(k)}</span></li>`).join('');
  return `${which}<ul class="help-keys">${list}</ul><p class="help-foot">${t(touch ? 'help.t.zoom' : 'help.k.zoom')}</p>`;
}

export function showHelp(click: () => void, start: Tab = 'basics'): Promise<void> {
  let tab = start;
  let touch = TOUCH;
  const el = h(
    'div',
    'modal help-modal',
    `<div class="card help-card" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <div class="settings-head"><h2 id="help-title">${t('help.title')}</h2><button class="icon-btn" data-done aria-label="${t('common.close')}">${icon('close')}</button></div>
      <div class="seg help-tabs" role="tablist">${TABS.map((k) => `<button role="tab" data-tab="${k}">${t(`help.tab.${k}` as Key)}</button>`).join('')}</div>
      <div class="help-body" tabindex="-1"></div>
    </div>`,
  );
  const pane = el.querySelector<HTMLElement>('.help-body')!;
  const show = () => {
    for (const b of el.querySelectorAll<HTMLElement>('[data-tab]')) {
      b.classList.toggle('on', b.dataset.tab === tab);
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    }
    pane.innerHTML = body(tab, touch);
    pane.scrollTop = 0;
  };
  show();
  return new Promise((resolve) => {
    const done = () => {
      click();
      removeEventListener('keydown', key, true);
      el.remove();
      resolve();
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyH') {
        e.stopImmediatePropagation();
        done();
      }
      // Left and right go through the tabs.
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.stopImmediatePropagation();
        tab = TABS[(TABS.indexOf(tab) + (e.code === 'ArrowLeft' ? TABS.length - 1 : 1)) % TABS.length];
        click();
        show();
      }
    };
    addEventListener('keydown', key, true);
    el.onclick = (e) => {
      const target = e.target as HTMLElement;
      const k = target.closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
      if (k && k !== tab) {
        click();
        tab = k;
        return show();
      }
      const d = target.closest<HTMLElement>('[data-device]')?.dataset.device;
      if (d && (d === 'touch') !== touch) {
        click();
        touch = d === 'touch';
        return show();
      }
      if (target.closest('[data-done]') || target === el) done();
    };
    document.body.append(el);
    pane.focus();
  });
}
