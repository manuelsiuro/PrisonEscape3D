import { t } from '../../i18n';
import { h } from '../dom';
import { icon } from '../icons';

/** A yes-or-no card ("Start a new game?"); resolves true for yes. Escape and the backdrop say no. */
export function ask(text: string, yes: string, click: () => void): Promise<boolean> {
  const el = h(
    'div',
    'modal',
    `<div class="card ask-card" role="alertdialog" aria-modal="true">
      <span class="ask-ic" aria-hidden="true">${icon('replay', 26)}</span>
      <p></p>
      <div class="actions">
        <button class="big-btn ghost" data-c="no">${t('common.back')}</button>
        <button class="big-btn primary" data-c="yes">${icon('replay', 18)}${yes}</button>
      </div>
    </div>`,
  );
  el.querySelector('p')!.textContent = text;
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      click();
      removeEventListener('keydown', key, true);
      el.remove();
      resolve(v);
    };
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.stopImmediatePropagation();
      done(false);
    };
    addEventListener('keydown', key, true);
    el.onclick = (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')?.dataset.c;
      if (c) done(c === 'yes');
      else if (e.target === el) done(false);
    };
    document.body.append(el);
    el.querySelector<HTMLElement>('[data-c="no"]')?.focus();
  });
}
