import { t } from '../i18n';
import { POTATO_PRESSES } from '../sim/tuning';
import { h, setText, TOUCH } from './dom';
import { icon } from './icons';

/**
 * Solitary confinement (GDD §5.6): a card above the hotbar with the time left and the
 * potato being peeled (a stroke per press, a pop when one is done), and how to peel.
 */
export class SolitaryPanel {
  private readonly el = h(
    'div',
    'solitary-panel hidden',
    `<div class="sol-potato">${icon('potato', 30)}<i class="sol-ring"></i></div>
     <div class="sol-text"><b></b><span class="sol-time"></span><small></small></div>
     <div class="sol-strokes"></div>`,
  );
  private readonly title: HTMLElement;
  private readonly time: HTMLElement;
  private readonly how: HTMLElement;
  private readonly strokes: HTMLElement[] = [];
  private readonly potato: HTMLElement;
  private shown = false;
  private peeled = -1;

  constructor() {
    this.title = this.el.querySelector('b')!;
    this.time = this.el.querySelector('.sol-time')!;
    this.how = this.el.querySelector('small')!;
    this.potato = this.el.querySelector('.sol-potato')!;
    const row = this.el.querySelector('.sol-strokes')!;
    for (let k = 0; k < POTATO_PRESSES; k++) this.strokes.push(row.appendChild(h('i')));
    this.potato.addEventListener('animationend', () => this.potato.classList.remove('done', 'stroke'));
    document.body.append(this.el);
  }

  /** `minutes` left (null hides the card) and presses on the current potato. */
  update(minutes: number | null, peeled: number) {
    const on = minutes !== null;
    if (on !== this.shown) {
      this.shown = on;
      this.el.classList.toggle('hidden', !on);
      this.peeled = -1;
    }
    if (!on) return;
    setText(this.title, t('solitary.title'));
    setText(this.time, `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`);
    setText(this.how, TOUCH ? t('solitary.hintTouch') : t('solitary.hintKeys'));
    if (peeled === this.peeled) return;
    // A stroke on the potato; back to no strokes: one more potato in the pot.
    if (this.peeled >= 0) this.potato.classList.add(peeled === 0 ? 'done' : 'stroke');
    this.peeled = peeled;
    this.strokes.forEach((s, k) => s.classList.toggle('on', k < peeled));
  }
}
