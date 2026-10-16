import type { Bubble } from '../talk/director';
import { h } from './dom';
import { icon } from './icons';

/** Where someone is on screen at a height (world units above their feet); -1 is the player. */
type Project = (id: number, out: { x: number; y: number }, height: number) => { x: number; y: number } | null;

interface Shown {
  el: HTMLElement;
  /** Its size, measured when it's made and again after a rotation or the fonts loading (0: to measure). */
  w: number;
  h: number;
  /** How far it's been slid or nudged from straight above the head (eased: a nudge glides instead of jumping). */
  ox: number;
  oy: number;
  visible: boolean;
  /** Pushed up over another bubble: its tail would point into that one, so it has none. */
  stacked: boolean;
  /** The tail's offset last written (styles are written only when they change). */
  tail: number;
}

interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Room kept from the screen's edges (CSS pixels). */
const EDGE = 12;
/** How high over the feet a bubble's tail points: above the head and the "!" and "$" badges. */
export const BUBBLE_HEIGHT = 2.35;
/** What a bubble never covers: the HUD, the item bar, the buttons and prompts, the target card. */
const KEEP_CLEAR = ['.hud', '.hotbar', '.act-btn', '.tool-btn', '.lock-btn', '.act-prompt', '.tool-prompt', '.energy', '.target-card', '.train-card', '.lesson-card'];
/** A typical bubble (two lines), to tell whether a head on screen has room for one at all. */
const TYPICAL = { w: 150, h: 42 };
/** Screen-reader lines: one every few seconds, the rest waiting (at most a few). */
const LOG_GAP = 3000;
const LOG_WAITING = 3;

const overlaps = (a: Rect, b: Rect) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

/**
 * Speech bubbles over heads (P13): HTML, not 3D (crisp text in any language, no draw
 * call), placed every frame over the speaker's head from the view's projection, like the
 * work chips. A bubble never covers the player, another bubble, the HUD, the buttons or the
 * screen's edges: it slides sideways (its tail still on its speaker) or up over the one in the
 * way, else waits its turn out of sight. It tells `onShow` the first time it's seen (the
 * murmur, the screen reader, the notebook go by what was seen). Gossip and guards' warnings
 * also go to a polite screen-reader log; the rest are for the eyes only.
 */
export class Bubbles {
  private readonly layer: HTMLElement;
  private readonly log: HTMLElement;
  private readonly shown = new Map<Bubble, Shown>();
  private readonly spare: HTMLElement[] = [];
  private readonly at = { x: 0, y: 0 };
  private readonly foot = { x: 0, y: 0 };
  /** Rectangles taken this frame: the player, then each bubble placed. */
  private readonly placed: Rect[] = [];
  /** Bubbles whose time is up, fading out where they were (element, when to take it away). */
  private readonly leaving: Array<{ el: HTMLElement; until: number }> = [];
  private readonly waiting: string[] = [];
  private logAt = -Infinity;
  /** The controls' rectangles, measured a few times a second (they move with the layout). */
  private clear: Rect[] = [];
  private measuredAt = 0;
  /** Where the HUD ends (heads above it have no room for a bubble). */
  topBand = 96;
  /** A bubble reached the screen for the first time. */
  onShow: ((b: Bubble) => void) | null = null;

  constructor() {
    this.layer = h('div', 'bubbles');
    this.layer.setAttribute('aria-hidden', 'true');
    this.log = h('div', 'sr-only');
    this.log.setAttribute('role', 'log');
    this.log.setAttribute('aria-live', 'polite');
    document.body.append(this.layer, this.log);
    // Sizes change with a rotation, and once the game's fonts arrive: measure again.
    const remeasure = () => {
      for (const s of this.shown.values()) s.w = s.h = 0;
      this.measuredAt = 0;
    };
    addEventListener('resize', remeasure);
    document.fonts?.ready.then(remeasure).catch(() => {});
  }

  /** A new bubble: its element made (or reused). */
  private add(b: Bubble): Shown {
    const el = this.spare.pop() ?? h('div', 'bubble');
    el.className = `bubble ${b.guard ? 'guard' : 'inmate'} ${b.style}`;
    el.innerHTML = `<span class="bubble-in">${b.name ? '<b class="bubble-name"></b>' : ''}${b.style === 'gossip' ? icon('ear', 13) : ''}<span class="bubble-text"></span></span>`;
    if (b.name) el.querySelector('.bubble-name')!.textContent = b.name;
    el.querySelector('.bubble-text')!.textContent = b.text;
    el.style.transform = 'translate3d(-9999px, 0, 0)';
    el.style.removeProperty('--tail');
    this.layer.append(el);
    const s: Shown = { el, w: 0, h: 0, ox: 0, oy: 0, visible: false, stacked: false, tail: -1 };
    this.shown.set(b, s);
    return s;
  }

  /** Reads a line out to screen readers (gossip, a guard's warning), a few seconds apart. */
  announce(text: string) {
    this.waiting.push(text);
    if (this.waiting.length > LOG_WAITING) this.waiting.shift();
    this.flushLog(performance.now());
  }

  private flushLog(now: number) {
    if (!this.waiting.length || now - this.logAt < LOG_GAP) return;
    this.logAt = now;
    const p = document.createElement('p');
    p.textContent = this.waiting.shift()!;
    this.log.append(p);
    while (this.log.childElementCount > 3) this.log.firstElementChild!.remove();
  }

  /** The rectangles to keep clear, measured again when they may have moved. */
  private measure() {
    const now = performance.now();
    if (now - this.measuredAt < 250) return;
    this.measuredAt = now;
    this.clear.length = 0;
    for (const sel of KEEP_CLEAR) {
      document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
        if (el.classList.contains('hidden')) return;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) this.clear.push({ l: r.left - 4, t: r.top - 4, r: r.right + 4, b: r.bottom + 4 });
      });
    }
    const hud = document.querySelector('.hud')?.getBoundingClientRect();
    this.topBand = hud && hud.height > 0 ? hud.bottom + 4 : 96;
  }

  /** Whether a bubble's rectangle is on screen, below the HUD and clear of the controls. */
  private onScreen(r: Rect): boolean {
    return r.l >= EDGE && r.r <= innerWidth - EDGE && r.t >= this.topBand && r.b <= innerHeight - EDGE && !this.clear.some((c) => overlaps(r, c));
  }

  /** Whether a bubble's rectangle is free: on screen and clear of what's placed this frame. */
  private free(r: Rect): boolean {
    return this.onScreen(r) && !this.placed.some((c) => overlaps(r, c));
  }

  /** The rectangle of a bubble over a head, slid sideways by dx (kept inside the screen). */
  private over(p: { x: number; y: number }, w: number, hgt: number, dx: number, t = p.y - hgt - 10): Rect {
    const l = Math.min(innerWidth - EDGE - w, Math.max(EDGE, p.x - w / 2 + dx));
    return { l, t, r: l + w, b: t + hgt + 8 };
  }

  /** Whether a head on screen has room for a typical bubble above it (straight, or slid aside). */
  roomAt(p: { x: number; y: number }): boolean {
    this.measure();
    if (p.x < EDGE || p.x > innerWidth - EDGE || p.y > innerHeight - 8) return false;
    const slide = TYPICAL.w / 2 - 18;
    return [0, slide, -slide].some((dx) => this.onScreen(this.over(p, TYPICAL.w, TYPICAL.h, dx)));
  }

  /** Every frame: the bubbles of the moment, where their speakers' heads are. */
  update(active: readonly Bubble[], project: Project, hidden: boolean, motion = true) {
    const now = performance.now();
    for (const [b, s] of this.shown) {
      if (!active.includes(b) || hidden) {
        s.el.classList.remove('on');
        this.shown.delete(b);
        // Said: it fades where it was (hidden at once when the game goes quiet).
        if (hidden || !s.visible || !motion) this.recycle(s.el);
        else this.leaving.push({ el: s.el, until: now + 220 });
      }
    }
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      if (hidden || now >= this.leaving[i].until) {
        this.recycle(this.leaving[i].el);
        this.leaving.splice(i, 1);
      }
    }
    this.flushLog(now);
    if (hidden) return;
    this.measure();
    this.placed.length = 0;
    // The player is never covered: their figure, head to feet, is taken first.
    const top = project(-1, this.at, 1.95);
    const feet = top && project(-1, this.foot, 0);
    if (top && feet) {
      const half = Math.max(14, (feet.y - top.y) * 0.32);
      this.placed.push({ l: top.x - half, t: top.y - 4, r: top.x + half, b: feet.y });
    }
    // The oldest keep their place; newer ones find room around them.
    for (const b of active) {
      const s = this.shown.get(b) ?? this.add(b);
      if (!s.w) {
        s.w = s.el.offsetWidth;
        s.h = s.el.offsetHeight;
      }
      const p = project(b.speaker, this.at, BUBBLE_HEIGHT);
      let spot: Rect | null = null;
      let stacked = false;
      if (p) {
        // Straight above the head; else slid aside (the tail still under the speaker); else over what's in the way.
        const slide = Math.max(0, s.w / 2 - 18);
        for (const dx of [0, slide, -slide]) {
          const r = this.over(p, s.w, s.h, dx);
          if (this.free(r)) {
            spot = r;
            break;
          }
        }
        if (!spot) {
          const straight = this.over(p, s.w, s.h, 0);
          const hit = this.placed.find((c) => overlaps(straight, c));
          const r = hit && this.over(p, s.w, s.h, 0, hit.t - s.h - 14);
          if (r && this.free(r)) {
            spot = r;
            stacked = true;
          }
        }
        if (spot) {
          this.placed.push(spot);
          // It follows the head exactly; a slide or a nudge glides there (appearing, it's in place at once).
          const base = this.over(p, s.w, s.h, 0);
          const ease = s.visible && motion ? 0.3 : 1;
          s.ox += (spot.l - base.l - s.ox) * ease;
          s.oy += (spot.t - base.t - s.oy) * ease;
          const x = base.l + s.ox;
          s.el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(base.t + s.oy)}px, 0)`;
          // The tail points at the speaker wherever the bubble is (none when it's stacked over another).
          const tail = Math.round(Math.min(s.w - 14, Math.max(14, p.x - x)));
          if (tail !== s.tail) {
            s.tail = tail;
            s.el.style.setProperty('--tail', `${tail}px`);
          }
          if (stacked !== s.stacked) {
            s.stacked = stacked;
            s.el.classList.toggle('stacked', stacked);
          }
        }
      }
      const ok = !!spot;
      if (ok !== s.visible) {
        s.visible = ok;
        s.el.classList.toggle('on', ok);
        // It pops in once; hidden and shown again (someone walked past), it just fades back.
        if (ok && !b.shown) {
          s.el.classList.add('pop');
          this.onShow?.(b);
          b.shown = true;
        }
      }
    }
  }

  private recycle(el: HTMLElement) {
    el.classList.remove('pop', 'stacked');
    el.remove();
    this.spare.push(el);
  }

  hide() {
    this.update([], () => null, true);
  }
}
