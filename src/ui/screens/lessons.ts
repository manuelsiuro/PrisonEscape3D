import { t, type Key } from '../../i18n';
import type { Lesson } from '../../tutorial/lessons';
import { h } from '../dom';
import { icon } from '../icons';

/**
 * The tutorial (P8+): the lessons in order, each a card (its number, icon, name and what it
 * teaches, a tick once done), the next one to take highlighted. Resolves with the lesson
 * picked (its index), or null when closed.
 */
export function showLessons(lessons: readonly Lesson[], done: readonly string[], click: () => void): Promise<number | null> {
  const next = lessons.findIndex((l) => !done.includes(l.id));
  const count = lessons.filter((l) => done.includes(l.id)).length;
  const cards = lessons
    .map((l, k) => {
      const ok = done.includes(l.id);
      return `<button class="lesson-card${ok ? ' done' : ''}${k === next ? ' next' : ''}" data-k="${k}" style="--d:${k * 0.035}s">
        <span class="lesson-num">${ok ? icon('check', 16) : k + 1}</span>
        <span class="lesson-ic">${icon(l.icon, 22)}</span>
        <span class="lesson-text"><b>${t(`lesson.${l.id}.t` as Key)}${ok ? `<span class="sr-only"> · ${t('lessons.doneOne')}</span>` : ''}</b><small>${t(`lesson.${l.id}.d` as Key)}</small></span>
        ${icon(k === next ? 'play' : 'chevronRight', 16)}
      </button>`;
    })
    .join('');
  const el = h(
    'div',
    'modal lessons-modal',
    `<div class="card lessons-card" role="dialog" aria-modal="true" aria-labelledby="lessons-title">
      <div class="settings-head"><h2 id="lessons-title">${t('lessons.title')}</h2><button class="icon-btn" data-close aria-label="${t('common.close')}">${icon('close')}</button></div>
      <p class="card-note">${count === lessons.length ? t('lessons.all') : t('lessons.note')}</p>
      <div class="lessons-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${lessons.length}" aria-valuenow="${count}"><i style="width:${(count / lessons.length) * 100}%"></i><span>${t('lessons.done', { n: count, of: lessons.length })}</span></div>
      <div class="lessons-list">${cards}</div>
    </div>`,
  );
  return new Promise((resolve) => {
    const finish = (k: number | null) => {
      click();
      removeEventListener('keydown', key, true);
      el.remove();
      resolve(k);
    };
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.stopImmediatePropagation();
      finish(null);
    };
    addEventListener('keydown', key, true);
    el.onclick = (e) => {
      const target = e.target as HTMLElement;
      if (target === el || target.closest('[data-close]')) return finish(null);
      const b = target.closest<HTMLElement>('[data-k]');
      if (b) finish(Number(b.dataset.k));
    };
    document.body.append(el);
    el.querySelector<HTMLElement>(`[data-k="${Math.max(0, next)}"]`)?.focus();
  });
}
