import type { Bubble } from '../talk/director';
import { h } from './dom';
import { icon } from './icons';

type Project = (id: number, out: { x: number; y: number }) => { x: number; y: number } | null;

interface Shown {
  el: HTMLElement;
  w: number;
  h: number;
  /** Where it was put last frame (to keep the others clear of it). */
  x: number;
  y: number;
  visible: boolean;
}

/** Room kept from the screen's edges (CSS pixels). */
const EDGE = 12;
/** What a bubble never covers: the HUD, the item bar, the buttons and prompts, the target card. */
const KEEP_CLEAR = ['.hud', '.hotbar', '.act-btn', '.tool-btn', '.lock-btn', '.act-prompt', '.tool-prompt', '.energy', '.target-card', '.train-card', '.lesson-card'];

/**
 * Speech bubbles over heads (P13): HTML, not 3D (crisp text in any language, no draw
 * call), placed every frame over the speaker's head from the view's projection, like the
 * work chips. Bubbles that would overlap are nudged up (twice at most), else they wait their
 * turn; none over the HUD, the buttons or the screen's edges. Gossip and guards' warnings
 * also go to a polite screen-reader log; the rest are for the eyes only.
 */
export class Bubbles {
  private readonly layer: HTMLElement;
  private readonly log: HTMLElement;
  private readonly shown = new Map<Bubble, Shown>();
  private readonly spare: HTMLElement[] = [];
  private readonly at = { x: 0, y: 0 };
  private readonly placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  private logAt = 0;
  /** The controls' rectangles, measured a few times a second (they move with the layout). */
  private clear: Array<{ l: number; t: number; r: number; b: number }> = [];
  private measuredAt = 0;
  /** Where the HUD ends (heads above it have no room for a bubble). */
  topBand = 96;

  constructor() {
    this.layer = h('div', 'bubbles');
    this.layer.setAttribute('aria-hidden', 'true');
    this.log = h('div', 'sr-only');
    this.log.setAttribute('role', 'log');
    this.log.setAttribute('aria-live', 'polite');
    document.body.append(this.layer, this.log);
  }

  /** A new bubble: its element made (or reused) and measured. */
  private add(b: Bubble): Shown {
    const el = this.spare.pop() ?? h('div', 'bubble');
    el.className = `bubble ${b.guard ? 'guard' : 'inmate'} ${b.style}`;
    el.innerHTML = `<span class="bubble-in">${b.style === 'gossip' ? icon('ear', 13) : ''}<span class="bubble-text"></span></span>`;
    el.querySelector('.bubble-text')!.textContent = b.text;
    el.style.transform = 'translate3d(-9999px, 0, 0)';
    this.layer.append(el);
    const s: Shown = { el, w: el.offsetWidth, h: el.offsetHeight, x: 0, y: 0, visible: false };
    this.shown.set(b, s);
    return s;
  }

  /** Reads a line out to screen readers (gossip, a guard's warning), a few seconds apart at most. */
  announce(text: string, now: number) {
    if (now - this.logAt < 3) return;
    this.logAt = now;
    const p = document.createElement('p');
    p.textContent = text;
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

  /** Whether a head on screen has room for a bubble above it (below the HUD, inside the screen). */
  roomAt(p: { x: number; y: number }): boolean {
    return p.x > EDGE && p.x < innerWidth - EDGE && p.y > this.topBand + 24 && p.y < innerHeight - 8;
  }

  /** Every frame: the bubbles of the moment, where their speakers' heads are. */
  update(active: readonly Bubble[], project: Project, hidden: boolean) {
    for (const [b, s] of this.shown) {
      if (!active.includes(b) || hidden) {
        s.el.classList.remove('on');
        s.el.remove();
        this.spare.push(s.el);
        this.shown.delete(b);
      }
    }
    if (hidden) return;
    this.measure();
    this.placed.length = 0;
    const W = innerWidth;
    const H = innerHeight;
    // The oldest keep their place; newer ones find room around them.
    for (const b of active) {
      const s = this.shown.get(b) ?? this.add(b);
      const p = project(b.speaker, this.at);
      let ok = !!p;
      let x = 0;
      let y = 0;
      if (p) {
        x = Math.min(W - EDGE - s.w / 2, Math.max(EDGE + s.w / 2, p.x));
        y = p.y - s.h - 10;
        // Rectangles by their top edge: overlapping one placed already, go above it (twice at most).
        for (let tries = 0; tries < 3; tries++) {
          const hit = this.placed.find((r) => Math.abs(r.x - x) < (r.w + s.w) / 2 + 4 && y < r.y + r.h + 4 && y + s.h + 4 > r.y);
          if (!hit) break;
          if (tries === 2) ok = false;
          else y = hit.y - s.h - 6;
        }
        const l = x - s.w / 2;
        if (y < this.topBand || y + s.h > H - EDGE || this.clear.some((c) => l < c.r && l + s.w > c.l && y < c.b && y + s.h + 8 > c.t)) ok = false;
        // The tail points at the speaker even when the bubble is pushed in from the edge.
        s.el.style.setProperty('--tail', `${Math.round(Math.min(s.w - 14, Math.max(14, p.x - (x - s.w / 2))))}px`);
      }
      if (ok) {
        this.placed.push({ x, y, w: s.w, h: s.h });
        s.el.style.transform = `translate3d(${Math.round(x - s.w / 2)}px, ${Math.round(y)}px, 0)`;
      }
      if (ok !== s.visible) {
        s.visible = ok;
        s.el.classList.toggle('on', ok);
      }
    }
  }

  hide() {
    this.update([], () => null, true);
  }
}
