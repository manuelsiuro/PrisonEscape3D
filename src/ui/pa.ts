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

/** A line waiting to be said: who says it, what, how long it has waited (ms of play), and whether it was heard already (cut short by a banner). */
interface Line {
  from: string;
  text: string;
  waited: number;
  heard: boolean;
}

/** A banner holds the next line back this long at most; a line cut short comes back only this fresh (ms of play). */
const BANNER_WAIT = 6000;
const STALE = 10000;
/** Something waiting for a clear stage gives up after this long. */
const CLEAR_WAIT = 8000;

/**
 * The warden's speakers (P17). The morning card at 08:00: who's speaking and the day, a line in
 * their voice typed out, then the day's event and weather with what they change; closed with
 * a tap, Esc (while it's on top) or on its own. Announcements through the day: a strip under the
 * HUD, the line typed out, one at a time (they wait while a banner is up, and give way when one
 * comes, back after it if still fresh, never heard twice). Its clock is play time: paused,
 * nothing runs out and nothing new starts. The screen reader hears each line once, whole. With
 * reduced motion the text is there at once.
 */
export class PaBoard {
  private card: { el: HTMLElement; left: number } | null = null;
  private strip: { el: HTMLElement; left: number; line: Line } | null = null;
  private readonly queue: Line[] = [];
  /** Things to do once the stage is clear (the morning card after the bell's banner). */
  private readonly pending: Array<{ f: () => void; waited: number }> = [];
  /** The line being typed out (on play time, like everything here). */
  private typer: { typed: HTMLElement; rest: HTMLElement; chars: string[]; shown: number; ms: number } | null = null;
  private measure = 0;
  private alertsBottom = -1;
  private last = performance.now();
  private paused = false;
  /** No typing, no slide (the setting). */
  reducedMotion = false;
  /** Called as a line starts (the chime and the voice): how long it is. */
  onSpeak: (chars: number, chime: boolean) => void = () => {};
  /** Whether the card is what the keyboard is talking to (no pause card, no panel over it). */
  onTop: () => boolean = () => true;
  /** One live region, always in the page. */
  private readonly live = h('div', 'sr-only');

  constructor() {
    this.live.setAttribute('role', 'status');
    document.body.append(this.live);
    // Esc closes the morning card while it's on top (the pause waits for the next press).
    addEventListener(
      'keydown',
      (e) => {
        if (e.code !== 'Escape' || !this.card || this.paused || !this.onTop() || document.querySelector('.modal')) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        this.closeCard();
      },
      true,
    );
  }

  /** Where the HUD's alert chips (and the first day's guide card) end: the card and strip go below them. How tall the board is (toasts make room in landscape). */
  private place() {
    let bottom = 0;
    for (const sel of ['.hud-alerts', '.coach:not(.hidden)']) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el && el.offsetParent) bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
    }
    if (bottom !== this.alertsBottom) {
      this.alertsBottom = bottom;
      document.body.style.setProperty('--hud-alerts', `${Math.round(bottom)}px`);
    }
    const up = this.card?.el ?? this.strip?.el;
    document.body.classList.toggle('pa-up', !!up);
    if (up) document.body.style.setProperty('--pa-h', `${Math.round(up.offsetHeight)}px`);
  }

  /** The morning card is up (the first-time hints hold back meanwhile: they'd cover its rows). */
  get cardUp() {
    return !!this.card;
  }

  /** The morning card; `ms` of play until it closes on its own. */
  morning(from: string, text: string, rows: readonly PaRow[], least = 11000) {
    // Long enough to read it all: the line typed out, then the rows.
    const rowChars = rows.reduce((n, r) => n + r.title.length + r.sub.length + (r.note?.length ?? 0), 0);
    const ms = Math.max(least, (text.length / TYPE_RATE) * 1000 + rowChars * 32 + 2500);
    this.closeCard();
    const el = h(
      'div',
      'pa-card',
      `<button class="pa-close icon-btn" aria-label="${t('common.close')}">${icon('close', 18)}</button>
      <div class="pa-head"><span class="pa-mic">${icon('megaphone', 18)}</span><b class="pa-from"></b></div>
      <p class="pa-line" aria-hidden="true"><span class="pa-typed"></span><span class="pa-rest"></span></p>
      <div class="pa-rows">${rows
        .map(
          (r, k) =>
            `<div class="pa-row${k === rows.length - 1 ? ' last' : ''}"><span class="pa-ic" style="--c:${r.color}">${icon(r.icon, 18)}</span><span class="pa-text"><small>${esc(r.label)}</small><b>${esc(r.title)}${r.when ? `<em>${esc(r.when)}</em>` : ''}</b><span>${esc(r.sub)}</span>${r.note ? `<i class="pa-note">${icon('wind', 13)}${esc(r.note)}</i>` : ''}</span></div>`,
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
    this.card = { el, left: ms };
    document.body.classList.add('pa-card-up');
    this.live.textContent = `${from}. ${text} ${rows.map((r) => `${t('pa.srRow', { label: r.label, title: r.title })}${r.when ? ` (${r.when})` : ''}. ${r.sub}${r.note ? ` ${r.note}.` : ''}`).join(' ')}`;
    this.onSpeak(text.length, true);
    this.type(el, text);
    this.place();
  }

  /** Runs `f` once nothing is up where the warden speaks (a banner, a card, a strip) and the game isn't paused: a few seconds at most. */
  whenClear(f: () => void, least = 0) {
    // (`least`: not before this long, e.g. the bell's banner still to come.)
    this.pending.push({ f, waited: -least });
  }

  /** An announcement: queued behind any other (and any banner). */
  say(from: string, text: string) {
    this.queue.push({ from, text, waited: 0, heard: false });
  }

  /** Each frame (`paused`: the game is): the clocks run in play time, lines start when the stage is clear, a banner cuts a strip short. */
  frame(paused: boolean) {
    const now = performance.now();
    const dt = Math.min(250, now - this.last);
    this.last = now;
    this.paused = paused;
    if (this.card || this.strip) {
      if (++this.measure % 10 === 0) this.place();
    }
    if (paused) return;
    const banner = document.body.classList.contains('banner-up');
    // The card and the strip run out.
    // The card steps out of the way of a banner (and its clock waits for it).
    if (this.card) {
      this.card.el.classList.toggle('behind', banner);
      if (!banner && (this.card.left -= dt) <= 0) this.closeCard();
    }
    // Typing on play time.
    const ty = this.typer;
    if (ty) {
      ty.ms += dt;
      const n = Math.min(ty.chars.length, Math.floor((ty.ms / 1000) * TYPE_RATE));
      if (n !== ty.shown) {
        ty.shown = n;
        ty.typed.textContent = ty.chars.slice(0, n).join('');
        ty.rest.textContent = ty.chars.slice(n).join('');
      }
      if (n >= ty.chars.length || !ty.typed.isConnected) this.typer = null;
    }
    if (this.strip) {
      // A banner arriving puts the strip away; its line comes back after the banner (heard already: no chime, no second reading).
      if (banner) {
        const line = this.strip.line;
        line.heard = true;
        line.waited = 0;
        this.queue.unshift(line);
        this.leave();
      } else if ((this.strip.left -= dt) <= 0) this.leave();
    }
    // Waiting lines grow stale (one cut short comes back only while fresh).
    for (let k = this.queue.length - 1; k >= 0; k--) {
      const l = this.queue[k];
      l.waited += dt;
      if (l.heard && l.waited > STALE) this.queue.splice(k, 1);
    }
    const busy = banner || !!this.card || !!this.strip;
    // Things waiting for a clear stage (or giving up the wait).
    for (let k = 0; k < this.pending.length; k++) {
      const p = this.pending[k];
      p.waited += dt;
      if (busy && p.waited < CLEAR_WAIT) continue;
      this.pending.splice(k--, 1);
      p.f();
    }
    // The next line: not over the card; behind a banner a few seconds at most.
    if (!this.strip && !this.card && this.queue.length && (!banner || this.queue[0].waited > BANNER_WAIT)) this.next();
  }

  private next() {
    const line = this.queue.shift()!;
    const { from, text } = line;
    const el = h('div', 'pa-strip', `<span class="pa-mic">${icon('megaphone', 16)}</span><span class="pa-body"><small class="pa-from"></small><span class="pa-line" aria-hidden="true"><span class="pa-typed"></span><span class="pa-rest"></span></span></span>`);
    el.querySelector('.pa-from')!.textContent = from;
    document.body.append(el);
    const read = Math.max(3800, 1400 + (text.length / TYPE_RATE) * 1000 + text.length * 45);
    this.strip = { el, left: read, line };
    if (!line.heard) {
      this.live.textContent = t('pa.srLine', { from, text });
      this.onSpeak(text.length, true);
      this.type(el, text);
    } else this.type(el, text, true);
    this.place();
  }

  /** Types a line out (all at once with reduced motion, or a line heard already); the untyped rest holds its place, invisible. */
  private type(el: HTMLElement, text: string, whole = false) {
    const typed = el.querySelector<HTMLElement>('.pa-typed')!;
    const rest = el.querySelector<HTMLElement>('.pa-rest')!;
    if (this.reducedMotion || whole) {
      typed.textContent = text;
      rest.textContent = '';
      return;
    }
    typed.textContent = '';
    rest.textContent = text;
    this.typer = { typed, rest, chars: [...text], shown: 0, ms: 0 };
  }

  private leave() {
    const s = this.strip;
    if (!s) return;
    this.strip = null;
    s.el.classList.add('leaving');
    window.setTimeout(() => s.el.remove(), 320);
    this.place();
  }

  closeCard() {
    const c = this.card;
    if (!c) return;
    this.card = null;
    document.body.classList.remove('pa-card-up');
    this.place();
    c.el.classList.add('leaving');
    window.setTimeout(() => c.el.remove(), 320);
  }

  /** A line no longer worth saying (overtaken by events): off the queue, and put away if it's being said. */
  drop(text: string) {
    for (let k = this.queue.length - 1; k >= 0; k--) if (this.queue[k].text === text) this.queue.splice(k, 1);
    if (this.strip?.line.text === text) {
      this.typer = null;
      this.leave();
    }
  }

  /** Everything down (leaving the game, the announcements switched off). */
  clear() {
    this.typer = null;
    this.queue.length = 0;
    this.pending.length = 0;
    this.closeCard();
    this.strip?.el.remove();
    this.strip = null;
    document.body.classList.remove('pa-up');
  }

  get up() {
    return !!this.card || !!this.strip;
  }

  /** Anything up, queued or waiting to be said. */
  get busy() {
    return this.up || this.queue.length > 0 || this.pending.length > 0;
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
