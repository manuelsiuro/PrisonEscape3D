import { fadeOut, h } from './dom';
import { icon } from './icons';

/**
 * Announcements under the HUD: a banner when a routine block starts or a lockdown begins
 * (GDD §2: bells, banners and floor arrows), and small toasts for what just happened
 * (missed a block, lockdown lifted). One banner at a time: a new one replaces the last.
 */
export class Banner {
  private el: HTMLElement | null = null;
  private timer = 0;
  private readonly toasts = h('div', 'toasts');

  constructor() {
    document.body.append(this.toasts);
  }

  show(title: string, sub: string, kind: 'routine' | 'alarm' = 'routine', ms = 3600) {
    this.hide();
    const el = h('div', `banner ${kind}`, `${icon(kind === 'alarm' ? 'siren' : 'bell', 26)}<div><b></b><span></span></div>`);
    el.querySelector('b')!.textContent = title;
    el.querySelector('span')!.textContent = sub;
    document.body.append(el);
    // What sits under the HUD (the target card) makes way while it's up.
    document.body.classList.add('banner-up');
    document.body.style.setProperty('--banner-h', `${el.offsetHeight}px`);
    this.el = el;
    this.timer = window.setTimeout(() => this.hide(), ms);
  }

  hide() {
    clearTimeout(this.timer);
    const el = this.el;
    if (!el) return;
    this.el = null;
    document.body.classList.remove('banner-up');
    fadeOut(el, 400);
  }

  toast(text: string, kind: 'bad' | 'good' | 'info' = 'info', ms = 3200) {
    // The same line again while it's up (a button tapped twice): it stays longer instead of piling up.
    const last = this.toasts.lastElementChild as HTMLElement | null;
    if (last && last.textContent === text && last.classList.contains(kind) && !last.classList.contains('leaving')) {
      clearTimeout(this.leaving.get(last));
      this.leaving.set(last, this.leave(last, ms));
      return;
    }
    const el = h('div', `toast ${kind}`, icon(kind === 'bad' ? 'flame' : kind === 'good' ? 'check' : 'lock', 16));
    el.append(text);
    this.toasts.append(el);
    this.leaving.set(el, this.leave(el, ms));
  }

  private readonly leaving = new WeakMap<HTMLElement, number>();

  private leave(el: HTMLElement, ms: number): number {
    return window.setTimeout(() => fadeOut(el, 350), ms);
  }

  /** Clears everything (leaving the game). */
  clear() {
    this.hide();
    this.toasts.replaceChildren();
  }
}
