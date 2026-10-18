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
  /** Where it was last seen on screen. */
  at: DOMRect | null = null;

  constructor(parent: HTMLElement) {
    this.el.setAttribute('role', 'status');
    parent.append(this.el);
  }

  /** The lesson (its number in its chapter, of how many, the chapter's id, its id), the step showing (its prompt and its touch variant), the steps and how many are done; hidden while a panel covers it. */
  update(n: number, of: number, chapter: string, id: string, text: Key, touch: Key | undefined, steps: number, done: number, tick: boolean, hidden: boolean) {
    this.el.classList.toggle('hidden', hidden);
    // Where it stands while shown (a panel is judged against it while it's hidden).
    if (!hidden) {
      const r = this.el.getBoundingClientRect();
      if (r.width) this.at = r;
    }
    const key = `${chapter}:${n}:${done}:${tick}:${text}`;
    if (key === this.shown) return;
    this.shown = key;
    this.el.classList.toggle('done', tick);
    const dots = Array.from({ length: steps }, (_, k) => `<i class="${k < done ? 'on' : k === done ? 'now' : ''}"></i>`).join('');
    this.el.innerHTML = `<span class="coach-ic">${icon(tick ? 'check' : 'bulb', 18)}</span>
      <span class="coach-text"><small>${t(`chapter.${chapter}` as Key)} · ${t('lesson.of', { n, of })} · ${t(`lesson.${id}.t` as Key)}</small><b>${t(TOUCH && touch ? touch : text)}</b><span class="lesson-dots">${dots}</span></span>`;
  }

  hide() {
    this.el.classList.add('hidden');
    this.shown = '';
  }
}

export type LessonResult = 'next' | 'list' | 'again' | 'play';

/** The end of a lesson: done (the next one, the next chapter after a chapter's last, or all lessons; after the very last, the real game), or failed (again, or all lessons). */
export function showLessonResult(head: Key, next: 'lesson' | 'chapter' | null, title: string, click: () => void): Promise<LessonResult> {
  const won = head === 'lesson.done';
  const el = h(
    'div',
    'modal lesson-result',
    `<div class="card${won ? ' won' : ''}">
      <div class="escaped-icon">${icon(won ? 'star' : 'siren', 32)}</div>
      <h2 id="lesson-result-h">${t(head)}</h2>
      <p class="card-note"></p>
      <div class="actions">
        <button class="big-btn ghost" data-c="list">${icon('book', 18)}${t('lesson.list')}</button>
        ${won ? (next ? `<button class="big-btn primary" data-c="next">${icon('play', 18)}${t(next === 'chapter' ? 'lesson.nextChapter' : 'lesson.next')}</button>` : `<button class="big-btn primary" data-c="play">${icon('play', 18)}${t('title.play')}</button>`) : `<button class="big-btn primary" data-c="again">${icon('replay', 18)}${t('lesson.again')}</button>`}
      </div>
    </div>`,
  );
  el.querySelector('.card-note')!.textContent = title;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'lesson-result-h');
  return new Promise((resolve) => {
    const done = (c: LessonResult) => {
      click();
      removeEventListener('keydown', key, true);
      el.remove();
      resolve(c);
    };
    // Escape: back to the list (the pause key must not reach the game behind).
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.stopImmediatePropagation();
      done('list');
    };
    addEventListener('keydown', key, true);
    el.onclick = (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')?.dataset.c as LessonResult | undefined;
      if (c) done(c);
    };
    document.body.append(el);
    (el.querySelector<HTMLElement>('.big-btn.primary') ?? el.querySelector<HTMLElement>('[data-c="list"]'))?.focus();
  });
}
