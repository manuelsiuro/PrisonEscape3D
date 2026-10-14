import { h } from '../dom';
import { icon } from '../icons';
import { t } from '../../i18n';

export type PauseChoice = 'resume' | 'quit' | 'settings';

/** The pause card; resolves with Resume, Settings or Title screen (Escape resumes too). */
export function showPause(click: () => void): Promise<PauseChoice> {
  const el = h(
    'div',
    'modal',
    `<div class="card">
      <h2>${t('pause.title')}</h2>
      <p class="card-note">${t('pause.note')}</p>
      <button class="link-btn" data-c="settings">${icon('gear', 16)}${t('pause.settings')}</button>
      <div class="actions">
        <button class="big-btn ghost" data-c="quit">${icon('home', 18)}${t('pause.quit')}</button>
        <button class="big-btn primary" data-c="resume">${icon('play', 18)}${t('pause.resume')}</button>
      </div>
    </div>`,
  );
  return new Promise((resolve) => {
    const done = (c: PauseChoice) => {
      click();
      removeEventListener('keydown', key);
      el.remove();
      resolve(c);
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape') done('resume');
    };
    addEventListener('keydown', key);
    el.onclick = (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')?.dataset.c as PauseChoice | undefined;
      if (c) done(c);
      else if (e.target === el) done('resume');
    };
    document.body.append(el);
    el.querySelector<HTMLElement>('[data-c="resume"]')?.focus();
  });
}
