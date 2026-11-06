import { type Settings } from '../../game/settings';
import { t, type Key } from '../../i18n';
import { rawKeyLabel } from '../../i18n/keys';
import { ACTIONS, type Action, keyFor, rebind, reserved } from '../../input/bindings';
import { h } from '../dom';
import { icon } from '../icons';

/** What each action is called on the card (How to play's words where it has them). */
const NAMES: Record<Action, Key> = {
  up: 'keys.up',
  left: 'keys.left',
  down: 'keys.down',
  right: 'keys.right',
  act: 'help.k.act',
  use: 'help.k.use',
  lock: 'help.k.lock',
  block: 'help.k.block',
  drop: 'help.k.drop',
  throwAhead: 'help.k.throwAhead',
  digUp: 'help.k.digUp',
  craft: 'help.k.craft',
  file: 'help.k.file',
  day: 'help.k.day',
  job: 'keys.job',
  rat: 'help.k.rat',
  phone: 'help.k.phone',
  crew: 'help.k.crew',
  objectives: 'help.k.objectives',
  help: 'help.k.help',
};

/**
 * The Keys card (session 9), over the settings: each main action and its key; a key pressed on one
 * moves it there, and an action that had that key takes the old one (so none is left without one).
 * Escape while it waits lets it be; the keys the game keeps say so. Every change applies at once.
 */
export function showKeys(settings: Settings, apply: () => void, click: () => void): Promise<void> {
  const el = h('div', 'modal');
  /** The action waiting for a key, and the line under the list. */
  let waiting: Action | null = null;
  let note = '';
  const render = () => {
    const groups = ['move', 'do', 'panels'] as const;
    el.innerHTML = `<div class="card settings-card keys-card">
      <div class="settings-head"><h2>${t('keys.title')}</h2><button class="icon-btn" data-close aria-label="${t('common.close')}">${icon('close')}</button></div>
      <div class="settings-scroll">
        ${groups
          .map(
            (g) =>
              `<h3 class="set-head">${t(`help.cg.${g}`)}</h3>${ACTIONS.filter((a) => a.group === g)
                .map(
                  (a) =>
                    `<div class="set-row"><span class="set-name">${t(NAMES[a.id])}</span><button class="keycap${waiting === a.id ? ' waiting' : ''}${a.key !== keyFor(a.id) ? ' moved' : ''}" data-action="${a.id}" aria-label="${t(NAMES[a.id])}: ${waiting === a.id ? t('keys.press') : rawKeyLabel(keyFor(a.id))}">${waiting === a.id ? t('keys.press') : rawKeyLabel(keyFor(a.id))}</button></div>`,
                )
                .join('')}`,
          )
          .join('')}
        <p class="set-note keys-note" role="status">${note || t('keys.note')}</p>
        <div class="set-actions"><button class="link-btn" data-reset>${icon('replay', 15)}${t('keys.reset')}</button></div>
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
      // (Nothing behind sees the keys while the card is up: the settings' Escape, the game's.)
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (!waiting) {
        if (e.code === 'Escape') close();
        return;
      }
      // (A shortcut, Cmd R or Ctrl W, is the browser's: no key taken.)
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      const id = waiting;
      waiting = null;
      if (e.code === 'Escape') note = '';
      else {
        const why = reserved(e.code);
        if (why) note = t(why === 'kept' ? 'keys.kept' : 'keys.other', { key: rawKeyLabel(e.code) });
        else {
          const { bindings, swapped } = rebind(settings.keys, id, e.code);
          settings.keys = bindings;
          apply();
          note = swapped ? t('keys.swapped', { a: t(NAMES[swapped]), key: rawKeyLabel(keyFor(swapped)) }) : '';
        }
      }
      click();
      render();
      el.querySelector<HTMLElement>(`[data-action="${id}"]`)?.focus();
    };
    addEventListener('keydown', key, true);
    el.onclick = (e) => {
      const target = e.target as HTMLElement;
      if (target === el || target.closest('[data-close]')) return close();
      const cap = target.closest<HTMLElement>('[data-action]');
      if (cap) {
        const id = cap.dataset.action as Action;
        waiting = waiting === id ? null : id;
        note = '';
      } else if (target.closest('[data-reset]')) {
        settings.keys = {};
        waiting = null;
        apply();
        note = t('keys.wasReset');
      } else return;
      click();
      const top = el.querySelector('.settings-scroll')?.scrollTop ?? 0;
      render();
      el.querySelector('.settings-scroll')!.scrollTop = top;
      el.querySelector<HTMLElement>(cap ? `[data-action="${cap.dataset.action}"]` : '[data-reset]')?.focus();
    };
    document.body.append(el);
  });
}
