import { t } from '../i18n';
import { h, TOUCH } from './dom';
import { icon } from './icons';

/** A row of the morning card: what's on, the weather. */
export interface PaRow {
  icon: string;
  /** Its colour (the icon's chip). */
  color: string;
  label: string;
  title: string;
  /** When (a time span), or '' for none. */
  when: string;
  sub: string;
  /** A last line, quieter (the wind). */
  note?: string;
}

/** Characters typed a second (the warden's voice keeps pace). */
const TYPE_RATE = 42;

/**
 * The warden's speakers (P17). The morning card at 08:00: who's speaking and the day, a line in
 * their voice typed out, then the day's event and weather with what they change; closed with
 * a tap (or on its own). Announcements through the day: a strip under the HUD, the line typed
 * out, one at a time (they wait while a banner is up, and give way when one comes). The screen
 * reader hears each line once, whole. With reduced motion the text is there at once.
 */
export class PaBoard {
  private card: HTMLElement | null = null;
  private strip: HTMLElement | null = null;
  /** The line the strip says (put back in the queue if a banner cuts it short). */
  private stripLine: { from: string; text: string } | null = null;
  private readonly queue: Array<{ from: string; text: string }> = [];
  private readonly timers = new Set<number>();
  private typing = 0;
  private waited = 0;
  private measure = 0;
  private alertsBottom = -1;
  /** No typing, no slide (the setting). */
  reducedMotion = false;
  /** Called as a line starts (the chime and the voice): how long it is. */
  onSpeak: (chars: number, chime: boolean) => void = () => {};
  /** One live region, always in the page. */
  private readonly live = h('div', 'sr-only');

  constructor() {
    this.live.setAttribute('role', 'status');
    document.body.append(this.live);
    // Esc closes the morning card (before anything else hears it: the pause waits for the next press).
    addEventListener(
      'keydown',
      (e) => {
        if (e.code !== 'Escape' || !this.card) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        this.closeCard();
      },
      true,
    );
  }

  /** A timer that forgets itself when it fires (clear() cancels those still waiting). */
  private later(f: () => void, ms: number) {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      f();
    }, ms);
    this.timers.add(id);
  }

  /** Where the HUD's alert chips end (the card and strip go below them), and how tall the warden's board is (toasts make room in landscape). */
  private place() {
    const alerts = document.querySelector<HTMLElement>('.hud-alerts');
    const bottom = alerts && alerts.offsetParent ? alerts.getBoundingClientRect().bottom : 0;
    if (bottom !== this.alertsBottom) {
      this.alertsBottom = bottom;
      document.body.style.setProperty('--hud-alerts', `${Math.round(bottom)}px`);
    }
    const up = this.card ?? this.strip;
    document.body.classList.toggle('pa-up', !!up);
    if (up) document.body.style.setProperty('--pa-h', `${Math.round(up.offsetHeight)}px`);
  }

  /** The morning card; `ms` until it closes on its own. */
  morning(from: string, text: string, rows: readonly PaRow[], ms = 11000) {
    this.closeCard();
    const el = h(
      'div',
      'pa-card',
      `<button class="pa-close icon-btn" aria-label="${t('common.close')}">${icon('close', 18)}</button>
      <div class="pa-head"><span class="pa-mic">${icon('megaphone', 18)}</span><b class="pa-from"></b></div>
      <p class="pa-line" aria-hidden="true"><span class="pa-typed"></span><span class="pa-rest"></span></p>
      <div class="pa-rows">${rows
        .map(
          (r) =>
            `<div class="pa-row"><span class="pa-ic" style="--c:${r.color}">${icon(r.icon, 18)}</span><span class="pa-text"><small>${esc(r.label)}</small><b>${esc(r.title)}${r.when ? `<em>${esc(r.when)}</em>` : ''}</b><span>${esc(r.sub)}</span>${r.note ? `<i class="pa-note">${icon('wind', 13)}${esc(r.note)}</i>` : ''}</span></div>`,
        )
        .join('')}</div>
      <small class="pa-hint" aria-hidden="true">${t(TOUCH ? 'pa.dismiss' : 'pa.dismissKeys')}</small>`,
    );
    el.querySelector('.pa-from')!.textContent = from;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.closeCard();
    });
    el.querySelector('.pa-close')!.addEventListener('click', () => this.closeCard());
    document.body.append(el);
    this.card = el;
    document.body.classList.add('pa-card-up');
    this.live.textContent = `${from}. ${text} ${rows.map((r) => `${r.label}: ${r.title}${r.when ? ` (${r.when})` : ''}. ${r.sub}${r.note ? ` ${r.note}.` : ''}`).join(' ')}`;
    this.onSpeak(text.length, true);
    this.type(el, text);
    this.place();
    this.later(() => this.closeCard(), ms);
  }

  /** Runs `f` once nothing is up where the warden speaks (a banner, a card, a strip): a few seconds at most. */
  whenClear(f: () => void, tries = 0) {
    const busy = document.body.classList.contains('banner-up') || !!this.card || !!this.strip;
    if (busy && tries < 32) {
      this.later(() => this.whenClear(f, tries + 1), 250);
      return;
    }
    f();
  }

  /** An announcement: queued behind any other (and any banner). */
  say(from: string, text: string) {
    this.queue.push({ from, text });
    if (!this.strip) this.next();
  }

  /** Each frame: a banner arriving puts the strip away (it says something more pressing). */
  frame() {
    // Below the HUD's alert chips when there are any (the power out, the day's chip...).
    if ((this.card || this.strip) && ++this.measure % 10 === 0) this.place();
    // A banner arriving puts the strip away; its line comes back after the banner.
    const banner = document.body.classList.contains('banner-up');
    if (banner && this.strip && !this.strip.classList.contains('leaving')) {
      if (this.stripLine) this.queue.unshift(this.stripLine);
      this.stripLine = null;
      this.leave(this.strip);
    }
  }

  private next() {
    if (this.strip || !this.queue.length) return;
    // The morning card up: wait for it. A banner: a few seconds at most.
    if (this.card || (document.body.classList.contains('banner-up') && this.waited < 24)) {
      this.waited++;
      this.later(() => this.next(), 250);
      return;
    }
    this.waited = 0;
    const line = this.queue.shift()!;
    const { from, text } = line;
    this.stripLine = line;
    const el = h('div', 'pa-strip', `<span class="pa-mic">${icon('megaphone', 16)}</span><span class="pa-body"><small class="pa-from"></small><span class="pa-line" aria-hidden="true"><span class="pa-typed"></span><span class="pa-rest"></span></span></span>`);
    el.querySelector('.pa-from')!.textContent = from;
    document.body.append(el);
    this.strip = el;
    this.live.textContent = `${from}: ${text}`;
    this.onSpeak(text.length, true);
    this.type(el, text);
    this.place();
    const read = Math.max(3800, 1400 + (text.length / TYPE_RATE) * 1000 + text.length * 45);
    this.later(() => {
      if (this.strip === el) this.stripLine = null;
      this.leave(el);
    }, read);
  }

  /** Types a line out (all at once with reduced motion); the untyped rest holds its place, invisible. */
  private type(el: HTMLElement, text: string) {
    const typed = el.querySelector<HTMLElement>('.pa-typed')!;
    const rest = el.querySelector<HTMLElement>('.pa-rest')!;
    if (this.reducedMotion) {
      typed.textContent = text;
      rest.textContent = '';
      return;
    }
    const chars = [...text];
    let n = 0;
    const start = performance.now();
    const tick = () => {
      if (!el.isConnected) return;
      const k = Math.min(chars.length, Math.floor(((performance.now() - start) / 1000) * TYPE_RATE));
      if (k !== n) {
        n = k;
        typed.textContent = chars.slice(0, n).join('');
        rest.textContent = chars.slice(n).join('');
      }
      if (n < chars.length) this.typing = requestAnimationFrame(tick);
    };
    rest.textContent = text;
    tick();
  }

  private leave(el: HTMLElement) {
    el.classList.add('leaving');
    this.later(() => {
      el.remove();
      if (this.strip === el) {
        this.strip = null;
        this.place();
        this.next();
      }
    }, 320);
  }

  closeCard() {
    const el = this.card;
    if (!el) return;
    this.card = null;
    document.body.classList.remove('pa-card-up');
    this.place();
    el.classList.add('leaving');
    window.setTimeout(() => el.remove(), 320);
  }

  /** Everything down (leaving the game, the announcements switched off). */
  clear() {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    cancelAnimationFrame(this.typing);
    this.queue.length = 0;
    this.closeCard();
    this.strip?.remove();
    this.strip = null;
    this.stripLine = null;
    this.waited = 0;
    document.body.classList.remove('pa-up');
  }

  get up() {
    return !!this.card || !!this.strip;
  }

}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
