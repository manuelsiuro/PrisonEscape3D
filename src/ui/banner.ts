import { h } from './dom';
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
    this.el = el;
    this.timer = window.setTimeout(() => this.hide(), ms);
  }

  hide() {
    clearTimeout(this.timer);
    const el = this.el;
    if (!el) return;
    this.el = null;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 400);
  }

  toast(text: string, kind: 'bad' | 'good' | 'info' = 'info', ms = 3200) {
    const el = h('div', `toast ${kind}`, icon(kind === 'bad' ? 'flame' : kind === 'good' ? 'check' : 'lock', 16));
    el.append(text);
    this.toasts.append(el);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 350);
    }, ms);
  }

  /** Clears everything (leaving the game). */
  clear() {
    this.hide();
    this.toasts.replaceChildren();
  }
}
