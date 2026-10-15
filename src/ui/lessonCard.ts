import { t, type Key } from '../i18n';
import { TOUCH, h } from './dom';
import { icon } from './icons';

/**
 * A lesson under way (P8+): the step to do now, in the guide's card under the HUD ("Lesson 3
 * of 9 · Crafting", the prompt, its step dots), ticked as each step is done.
 */
export class LessonCard {
  private readonly el = h('div', 'coach lesson-coach hidden');
  private shown = '';

  constructor(parent: HTMLElement) {
    this.el.setAttribute('role', 'status');
    parent.append(this.el);
  }

  /** The lesson (number, of, its id), the step showing (its prompt and its touch variant), the steps and how many are done; hidden while a panel covers it. */
  update(n: number, of: number, id: string, text: Key, touch: Key | undefined, steps: number, done: number, tick: boolean, hidden: boolean) {
    this.el.classList.toggle('hidden', hidden);
    const key = `${n}:${done}:${tick}:${text}`;
    if (key === this.shown) return;
    this.shown = key;
    this.el.classList.toggle('done', tick);
    const dots = Array.from({ length: steps }, (_, k) => `<i class="${k < done ? 'on' : k === done ? 'now' : ''}"></i>`).join('');
    this.el.innerHTML = `<span class="coach-ic">${icon(tick ? 'check' : 'bulb', 18)}</span>
      <span class="coach-text"><small>${t('lesson.of', { n, of })} · ${t(`lesson.${id}.t` as Key)}</small><b>${t(TOUCH && touch ? touch : text)}</b><span class="lesson-dots">${dots}</span></span>`;
  }

  hide() {
    this.el.classList.add('hidden');
    this.shown = '';
  }
}

export type LessonResult = 'next' | 'list' | 'again';

/** The end of a lesson: done (the next one, or all lessons), or failed (again, or all lessons). */
export function showLessonResult(won: boolean, hasNext: boolean, title: string, click: () => void): Promise<LessonResult> {
  const el = h(
    'div',
    'modal lesson-result',
    `<div class="card${won ? ' won' : ''}">
      <div class="escaped-icon">${icon(won ? 'star' : 'siren', 32)}</div>
      <h2>${t(won ? 'lesson.done' : 'lesson.failed')}</h2>
      <p class="card-note"></p>
      <div class="actions">
        <button class="big-btn ghost" data-c="list">${icon('book', 18)}${t('lesson.list')}</button>
        ${won ? (hasNext ? `<button class="big-btn primary" data-c="next">${icon('play', 18)}${t('lesson.next')}</button>` : '') : `<button class="big-btn primary" data-c="again">${icon('replay', 18)}${t('lesson.again')}</button>`}
      </div>
    </div>`,
  );
  el.querySelector('.card-note')!.textContent = title;
  return new Promise((resolve) => {
    el.onclick = (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')?.dataset.c as LessonResult | undefined;
      if (!c) return;
      click();
      el.remove();
      resolve(c);
    };
    document.body.append(el);
    el.querySelector<HTMLElement>('.big-btn.primary')?.focus();
  });
}
