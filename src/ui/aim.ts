import { t } from '../i18n';
import { h } from './dom';
import { icon } from './icons';

/** Where someone's head is on screen (Cast id; null off screen). */
type Project = (id: number, out: { x: number; y: number }) => { x: number; y: number } | null;

/** How long a guard's "heard it" mark stays up (ms). */
const POP_MS = 2400;
const EARS = 12;

/**
 * Throwing and noise over the picture (P14): while aiming, a hint (how to throw, how to
 * cancel; a Cancel button on touch), a label at the landing spot (who would hear it, or why it
 * can't land), and an ear over each guard who would hear it; after a noise, a "?" over each
 * guard on the way to look. Built once; text written only when it changes.
 */
export class AimUI {
  private readonly hint: HTMLElement;
  private readonly hintText: HTMLElement;
  private readonly cancel: HTMLButtonElement;
  private readonly label: HTMLElement;
  private readonly labelText: HTMLElement;
  private readonly ears: HTMLElement[] = [];
  private readonly pops = new Map<number, { el: HTMLElement; until: number }>();
  private readonly layer: HTMLElement;
  private readonly at = { x: 0, y: 0 };
  private mode = '';
  private text = '';
  private bad = false;
  /** The label's size, measured when its text changes; what it keeps clear of (the hint, the item bar), measured a few times a second. */
  private labelW = 0;
  private labelH = 0;
  private readonly hintBox = { l: 0, t: 0, r: 0, b: 0 };
  private barTop = 0;
  private measuredAt = 0;
  onCancel: () => void = () => {};

  constructor() {
    this.layer = h('div', 'aim-layer');
    this.layer.setAttribute('aria-hidden', 'true');
    this.hint = h('div', 'aim-hint hidden', `${icon('toss', 16)}<span></span>`);
    this.hintText = this.hint.querySelector('span')!;
    this.cancel = h('button', 'aim-cancel', `${icon('close', 14)}<span></span>`);
    this.cancel.addEventListener('click', () => this.onCancel());
    this.cancel.addEventListener('mousedown', (e) => e.preventDefault());
    this.hint.append(this.cancel);
    this.label = h('div', 'aim-label hidden', `${icon('ear', 13)}<span></span>`);
    this.labelText = this.label.querySelector('span')!;
    for (let k = 0; k < EARS; k++) {
      const e = h('i', 'ear-pin hidden', icon('ear', 13));
      this.ears.push(e);
      this.layer.append(e);
    }
    this.layer.append(this.label);
    document.body.append(this.layer, this.hint);
  }

  /** The aim's hint: how this aim throws (null: not aiming). */
  show(mode: 'mouse' | 'click' | 'touch' | null) {
    const m = mode ?? '';
    if (m === this.mode) return;
    this.mode = m;
    this.hint.classList.toggle('hidden', !mode);
    document.body.classList.toggle('aiming', !!mode);
    if (!mode) {
      this.label.classList.add('hidden');
      for (const e of this.ears) e.classList.add('hidden');
      return;
    }
    this.hintText.textContent = t(mode === 'touch' ? 'aim.touch' : mode === 'click' ? 'aim.click' : 'aim.mouse');
    this.cancel.querySelector('span')!.textContent = t('aim.cancel');
    // The mouse held down lets go to throw; a cancel is Esc. Armed or on touch, a button cancels.
    this.cancel.classList.toggle('hidden', mode === 'mouse');
    this.measuredAt = 0;
  }

  /** Where the hint and the item bar are (they move with the layout, the hint as it comes in). */
  private measure() {
    const now = performance.now();
    if (now - this.measuredAt < 250) return;
    this.measuredAt = now;
    const h = this.hint.getBoundingClientRect();
    Object.assign(this.hintBox, { l: h.left, t: h.top, r: h.right, b: h.bottom });
    const bar = document.querySelector('.hotbar')?.getBoundingClientRect();
    this.barTop = bar && bar.height > 0 ? bar.top : innerHeight;
  }

  /**
   * Each frame while aiming: the label at the landing spot (screen px; why not, in red, or who
   * would hear), and an ear over each guard who would (Cast ids).
   */
  update(spot: { x: number; y: number } | null, text: string, bad: boolean, hearers: readonly number[], project: Project) {
    this.label.classList.toggle('hidden', !spot);
    if (spot) {
      if (text !== this.text || bad !== this.bad) {
        this.text = text;
        this.bad = bad;
        this.labelText.textContent = text;
        this.label.classList.toggle('bad', bad);
        this.labelW = this.label.offsetWidth;
        this.labelH = this.label.offsetHeight;
      }
      // Under the landing ring, or over it when the hint, the item bar or the screen's edge is in the way.
      this.measure();
      const half = this.labelW / 2;
      const hh = this.labelH;
      const x = Math.min(innerWidth - 10 - half, Math.max(10 + half, spot.x));
      const hb = this.hintBox;
      const fits = (y: number) => y >= 8 && y + hh <= this.barTop - 6 && !(x + half > hb.l && x - half < hb.r && y + hh > hb.t - 4 && y < hb.b + 4);
      let y = spot.y + 18;
      if (!fits(y)) y = fits(spot.y - 18 - hh) ? spot.y - 18 - hh : Math.max(8, Math.min(y, this.barTop - 6 - hh));
      this.label.style.transform = `translate3d(${Math.round(x - half)}px, ${Math.round(y)}px, 0)`;
    }
    this.ears.forEach((e, k) => {
      const at = k < hearers.length ? project(hearers[k], this.at) : null;
      e.classList.toggle('hidden', !at);
      if (at) e.style.transform = `translate3d(${Math.round(at.x)}px, ${Math.round(at.y)}px, 0) translate(4px, -100%)`;
    });
  }

  /** Guards (Cast ids) on their way to look at a noise: a "?" over each for a moment. */
  heard(ids: readonly number[]) {
    const now = performance.now();
    for (const id of ids) {
      let p = this.pops.get(id);
      if (!p) {
        p = { el: h('i', 'heard-pop', '?'), until: 0 };
        this.pops.set(id, p);
        this.layer.append(p.el);
      }
      p.until = now + POP_MS;
      // Popped again: the bounce plays again.
      p.el.classList.remove('on');
      void p.el.offsetWidth;
      p.el.classList.add('on');
    }
  }

  /** Each frame: the "?" marks follow their guards, and go when their time is up (or the game is busy). */
  frame(project: Project, hidden: boolean) {
    const now = performance.now();
    for (const [id, p] of this.pops) {
      const at = hidden || now > p.until ? null : project(id, this.at);
      if (now > p.until) {
        p.el.remove();
        this.pops.delete(id);
        continue;
      }
      p.el.classList.toggle('hidden', !at);
      if (at) p.el.style.transform = `translate3d(${Math.round(at.x)}px, ${Math.round(at.y)}px, 0) translate(4px, -100%)`;
    }
  }
}
