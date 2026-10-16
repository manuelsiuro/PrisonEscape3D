import type { Achievement } from '../content/achievements';
import { t, type Key } from '../i18n';
import { h } from './dom';
import { icon } from './icons';

/**
 * "Achievement unlocked" (P16): a gold-rimmed card dropping in at the top of the screen, one
 * at a time (several earned at once queue up), with what it gives your prisoner. The screen
 * reader hears it once. Under reduced motion it simply appears and fades (the stylesheet).
 */
export class TrophyToast {
  private readonly queue: Achievement[] = [];
  private el: HTMLElement | null = null;
  private timer = 0;
  /** Called as each card shows (the fanfare). */
  onShow: () => void = () => {};
  /** One live region, always in the page (a region arriving already filled isn't read out). */
  private readonly live = h('div', 'sr-only');

  constructor() {
    this.live.setAttribute('role', 'status');
    document.body.append(this.live);
  }

  show(list: readonly Achievement[]) {
    this.queue.push(...list);
    if (!this.el) this.next();
  }

  private next() {
    if (!this.queue.length) return;
    // Not over a dialog (the pause card, the escape, a screen): it waits for the game.
    if (document.querySelector('.modal, .intake')) {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.next(), 600);
      return;
    }
    const a = this.queue.shift()!;
    const el = h(
      'div',
      'trophy-toast',
      `<span class="tt-medal">${icon(a.icon, 24)}</span><span class="tt-text"><small>${t('trophy.unlocked')}</small><b></b>${a.gives ? `<em>${icon('shirt', 13)}<span></span></em>` : ''}</span>`,
    );
    el.setAttribute('aria-hidden', 'true');
    el.querySelector('b')!.textContent = t(`ach.${a.id}` as Key);
    if (a.gives) el.querySelector('em span')!.textContent = t('trophy.gives', { what: t(`look.${a.gives}` as Key) });
    this.live.textContent = t('trophy.unlockedSr', { name: el.querySelector('b')!.textContent!, gift: a.gives ? ` ${el.querySelector('em span')!.textContent}` : '' });
    document.body.append(el);
    this.el = el;
    this.onShow();
    this.timer = window.setTimeout(() => this.leave(), 3600);
  }

  private leave() {
    const el = this.el;
    if (!el) return;
    el.classList.add('leaving');
    window.setTimeout(() => {
      el.remove();
      if (this.el === el) this.el = null;
      this.next();
    }, 380);
  }

  /** Everything off the screen (leaving the game). */
  clear() {
    clearTimeout(this.timer);
    this.queue.length = 0;
    this.el?.remove();
    this.el = null;
  }
}
