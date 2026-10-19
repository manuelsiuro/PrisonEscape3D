import { t, type Key } from '../../i18n';
import { TOUCH, h } from '../dom';
import { icon } from '../icons';

/** A lesson's objectives, as the bulb (O) shows them: where it stands, the steps done, the one to do now. */
export interface Objectives {
  /** "Prison life · Lesson 3 of 7". */
  place: string;
  title: string;
  about: string;
  /** Each step's prompt (its touch variant where it has one), in order. */
  steps: ReadonlyArray<{ text: Key; touch?: Key }>;
  /** How many are done (the next one is the step to do now). */
  done: number;
}

/**
 * The lesson's objectives over the paused game (the bulb in the HUD, or O): for when the card
 * under the HUD is hidden (a panel open, asleep) or the step has slipped the player's mind. The
 * steps ahead stay unsaid (each makes sense once the one before is done): only how many are left.
 */
export function showObjectives(o: Objectives, click: () => void): Promise<void> {
  const step = (s: { text: Key; touch?: Key }) => t(TOUCH && s.touch ? s.touch : s.text);
  const rows = o.steps
    .slice(0, o.done + 1)
    .map((s, k) => `<li class="${k < o.done ? 'done' : 'now'}"><span class="obj-ic">${icon(k < o.done ? 'check' : 'bulb', k < o.done ? 14 : 16)}</span><span>${step(s)}</span></li>`)
    .join('');
  const left = o.steps.length - o.done - 1;
  const el = h(
    'div',
    'modal objectives',
    `<div class="card objectives-card">
      <p class="obj-place">${icon('bulb', 13)}<span></span></p>
      <h2 id="objectives-h"></h2>
      <p class="card-note"></p>
      <ol class="obj-steps">${rows}</ol>
      <p class="obj-left">${t(left > 1 ? 'obj.left' : left === 1 ? 'obj.leftOne' : 'obj.last', { n: left })}</p>
      <div class="actions">
        <button class="big-btn primary" data-c="resume">${icon('play', 18)}${t('pause.resume')}</button>
      </div>
    </div>`,
  );
  el.querySelector('.obj-place span')!.textContent = o.place;
  el.querySelector('#objectives-h')!.textContent = o.title;
  el.querySelector('.card-note')!.textContent = o.about;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'objectives-h');
  return new Promise((resolve) => {
    const done = () => {
      click();
      removeEventListener('keydown', key, true);
      el.remove();
      resolve();
    };
    // Escape or O again: back to the game (the pause key must not reach the game behind).
    const key = (e: KeyboardEvent) => {
      // (A held O, repeating, never closes what it just opened.)
      if (e.repeat || (e.code !== 'Escape' && e.code !== 'KeyO')) return;
      e.stopImmediatePropagation();
      done();
    };
    addEventListener('keydown', key, true);
    el.onclick = (e) => {
      if (e.target === el || (e.target as HTMLElement).closest('[data-c]')) done();
    };
    document.body.append(el);
    el.querySelector<HTMLElement>('[data-c="resume"]')?.focus();
  });
}
