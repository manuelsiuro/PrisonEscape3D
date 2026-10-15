import { h } from '../dom';
import { icon } from '../icons';
import { t } from '../../i18n';

export type PauseChoice = 'resume' | 'quit' | 'settings' | 'save' | 'help';

/**
 * The pause card; resolves with Resume, Save, How to play, Settings or Title screen (Escape
 * resumes too). `saved` says the game in progress was just saved; `canSave` is false while a
 * slot can't be written (the game is over); `note` replaces the line under the title (a
 * save just made into a slot).
 */
export function showPause(click: () => void, saved: boolean, canSave = true, note = ''): Promise<PauseChoice> {
  const el = h(
    'div',
    'modal',
    `<div class="card">
      <h2>${t('pause.title')}</h2>
      <p class="card-note">${note ? `${icon('check', 14)}${note}` : saved ? `${icon('check', 14)}${t('pause.saved')}` : t('pause.notSaved')}</p>
      <div class="pause-links">
        ${canSave ? `<button class="link-btn" data-c="save">${icon('save', 16)}${t('pause.save')}</button>` : ''}
        <button class="link-btn" data-c="help">${icon('help', 16)}${t('pause.help')}</button>
        <button class="link-btn" data-c="settings">${icon('gear', 16)}${t('pause.settings')}</button>
      </div>
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
