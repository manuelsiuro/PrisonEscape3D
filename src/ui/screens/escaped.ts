import { h } from '../dom';
import { icon } from '../icons';
import { t } from '../../i18n';

/**
 * Out on the road (GDD §4.0): the prison, the day and the time of the escape, then back to
 * the title. The full victory screen (days, walls chipped, tunnels dug…) comes with P7.
 */
export function showEscaped(info: { prison: string; day: number; time: string }, click: () => void): Promise<void> {
  const el = h(
    'div',
    'modal escaped',
    `<div class="card">
      <div class="escaped-icon">${icon('trophy', 34)}</div>
      <h2>${t('escaped.title')}</h2>
      <p></p>
      <p class="card-note">${t('escaped.note')}</p>
      <div class="actions">
        <button class="big-btn primary" data-c="back">${icon('home', 18)}${t('escaped.back')}</button>
      </div>
    </div>`,
  );
  el.querySelector('p')!.textContent = t('escaped.sub', info);
  return new Promise((resolve) => {
    el.querySelector('[data-c="back"]')!.addEventListener('click', () => {
      click();
      el.remove();
      resolve();
    });
    document.body.append(el);
    el.querySelector<HTMLElement>('[data-c="back"]')?.focus();
  });
}
