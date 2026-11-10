import { t, type Key } from '../i18n';
import { TOUCH, h } from './dom';
import { icon } from './icons';

/**
 * A lesson under way (P8+): the step to do now, in the guide's card under the HUD ("Lesson 3
 * of 9 · Crafting", the prompt, its step dots), ticked as each step is done.
 */
export class LessonCard {
  private readonly el = h('div', 'coach lesson-coach hidden');
  /** The step showing, at the top of a panel that covers the card (a talk, the board…, on a screen too narrow for both). */
  private readonly strip = h('div', 'lesson-strip');
  private shown = '';
  /** Where the card's bottom and right edge were last set for the banner and the toasts to keep clear of (px). */
  private edge = '';
  /** The window's size (and whether a game's card has the top row) when the card was last fitted. */
  private size = '';
  /** Where it was last seen on screen. */
  at: DOMRect | null = null;

  constructor(parent: HTMLElement) {
    this.el.setAttribute('role', 'status');
    parent.append(this.el);
  }

  /** The lesson (its number in its chapter, of how many, the chapter's id, its id), the step showing (its prompt and its touch variant), the steps and how many are done; hidden while a panel covers it. */
  update(
    n: number,
    of: number,
    chapter: string,
    id: string,
    text: Key,
    touch: Key | undefined,
    steps: number,
    done: number,
    tick: boolean,
    hidden: boolean,
  ) {
    this.el.classList.toggle('hidden', hidden);
    document.body.classList.toggle('lesson-on', !hidden);
    // Where it stands while shown (a panel is judged against it while it's hidden); the banner and the toasts keep clear of it.
    if (!hidden) {
      const r = this.el.getBoundingClientRect();
      if (r.width) this.at = r;
      const edge = `${Math.round(r.bottom)}:${Math.round(r.right)}`;
      if (r.width && edge !== this.edge) {
        this.edge = edge;
        document.documentElement.style.setProperty('--lesson-bottom', `${Math.round(r.bottom)}px`);
        document.documentElement.style.setProperty('--lesson-right', `${Math.round(r.right)}px`);
      }
    }
    const key = `${chapter}:${n}:${done}:${tick}:${text}`;
    // (Fitted again when the step, the window or the layout changes; hidden, the routine pill is never left lifted over.)
    const size = hidden ? '' : `${innerWidth}x${innerHeight}:${document.body.matches(OWN_PLACE)}`;
    if (key === this.shown) {
      if (size !== this.size) this.fit(size);
      return;
    }
    this.shown = key;
    this.el.classList.toggle('done', tick);
    const dots = Array.from({ length: steps }, (_, k) => `<i class="${k < done ? 'on' : k === done ? 'now' : ''}"></i>`).join('');
    this.el.innerHTML = `<span class="coach-ic">${icon(tick ? 'check' : 'bulb', 18)}</span>
      <span class="coach-text"><small>${t(`chapter.${chapter}` as Key)} · ${t('lesson.of', { n, of })} · ${t(`lesson.${id}.t` as Key)}</small><b>${t(TOUCH && touch ? touch : text)}</b><span class="lesson-dots">${dots}</span></span>`;
    this.fit(size);
    this.strip.classList.toggle('done', tick);
    this.strip.innerHTML = `${icon(tick ? 'check' : 'bulb', 15)}<span></span>`;
    this.strip.querySelector('span')!.textContent = t(TOUCH && touch ? touch : text);
  }

  private fit(size: string) {
    this.size = size;
    if (size) fitLessonCard(this.el);
    else document.body.classList.remove('lesson-high');
  }

  /** The step docked at the top of the panel covering the card (or taken down): a panel that redraws itself gets it back the next frame. */
  dock(panel: HTMLElement | null) {
    if (!panel) this.strip.remove();
    else if (this.strip.parentElement !== panel) panel.prepend(this.strip);
  }

  hide() {
    this.el.classList.add('hidden');
    document.body.classList.remove('lesson-on', 'lesson-high');
    this.size = '';
    this.strip.remove();
    this.shown = '';
  }
}

/** A phone turned (in Chrome about 274 tall): the room under the routine pill and above the hotbar. */
const SHORT = '(max-height: 520px) and (orientation: landscape)';
/** A game's own card layout, where the lesson's card has a place of its own (25-tutorial.css's list): never lifted. */
const OWN_PLACE = '.gaming, .courting, .matching, .inking, .racing, .staging, .quizzing, .phoning, .kiosking, .jobbing, .paroling';

/**
 * 2.39.1: on a phone turned, a step too long for the room above the hotbar lifts the card over the routine pill
 * (`body.lesson-high`, 25-tutorial.css), for that step only; the rest keep it where it was. Where the card is laid out,
 * not where its slide-in has it now. Also run by screensweep's `lessonCards()`.
 */
export function fitLessonCard(card: HTMLElement) {
  document.body.classList.remove('lesson-high');
  if (!matchMedia(SHORT).matches || document.body.matches(OWN_PLACE)) return;
  const bar = document.querySelector<HTMLElement>('.hotbar');
  const parent = card.offsetParent?.getBoundingClientRect();
  if (!bar || !parent) return;
  const h = bar.getBoundingClientRect();
  const left = parent.left + card.offsetLeft;
  const bottom = parent.top + card.offsetTop + card.offsetHeight;
  const across = h.width > 0 && left + card.offsetWidth > h.left && left < h.right;
  if (bottom > (across ? h.top : innerHeight)) document.body.classList.add('lesson-high');
}

export type LessonResult = 'next' | 'list' | 'again' | 'play';

/** The end of a lesson: done (the next one, the next chapter after a chapter's last, or all lessons; after the very last, the real game), or failed (again, or all lessons). */
export function showLessonResult(
  head: Key,
  next: 'lesson' | 'chapter' | null,
  title: string,
  click: () => void,
  sub: Key | null = null,
): Promise<LessonResult> {
  const won = head === 'lesson.done';
  const el = h(
    'div',
    'modal lesson-result',
    `<div class="card${won ? ' won' : ''}">
      <div class="escaped-icon">${icon(won ? 'star' : 'siren', 32)}</div>
      <h2 id="lesson-result-h">${t(head)}</h2>
      ${sub ? `<p class="v-sub">${t(sub)}</p>` : ''}
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
