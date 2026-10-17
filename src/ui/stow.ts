import { t } from '../i18n';
import { h, setText, TOUCH } from './dom';
import { icon } from './icons';

/** What the hidden player's card shows (P18). */
export interface StowView {
  /** The vehicle's icon, and how it's said ("the supply truck"). */
  icon: string;
  vehicle: string;
  /** "14:31", "14:30", and who searches. */
  leaves: string;
  search: string;
  guard: string;
  /** How far through its stay the vehicle is (0 at 12:30, 1 as it leaves). */
  done: number;
  /** The search so far: to come, a quick look, nobody came. */
  searched: 'ahead' | 'quick' | 'waved';
  waiting: boolean;
  /** Wait can run the clock fast (not in the last minutes before the search). */
  canWait: boolean;
}

/**
 * Hidden in the delivery's vehicle (P18): a card above the hotbar (where the vehicle goes,
 * when it leaves, who searches it and when), a bar running down to the departure, and the
 * Wait button that runs the clock fast (it stops on its own for the search). The screen's
 * edges go dark between the crates' slats.
 */
export class StowPanel {
  private readonly el = h(
    'div',
    'stow-panel hidden',
    `<div class="stow-ic"></div>
     <div class="stow-text"><b></b><span class="stow-time"></span><small class="stow-search"></small><small class="stow-hint"></small></div>
     <button class="stow-wait" type="button" aria-pressed="false"></button>
     <i class="stow-bar"><i></i></i>`,
  );
  private readonly veil = h('div', 'stow-veil');
  private readonly live = h('div', 'sr-only');
  private readonly ic: HTMLElement;
  private readonly title: HTMLElement;
  private readonly time: HTMLElement;
  private readonly search: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly wait: HTMLButtonElement;
  private readonly bar: HTMLElement;
  private shown = false;
  private iconName = '';
  private waitKey = '';
  private searchedSaid: StowView['searched'] = 'ahead';
  /** The Wait button pressed. */
  onWait: () => void = () => {};

  constructor() {
    this.ic = this.el.querySelector('.stow-ic')!;
    this.title = this.el.querySelector('b')!;
    this.time = this.el.querySelector('.stow-time')!;
    this.search = this.el.querySelector('.stow-search')!;
    this.hint = this.el.querySelector('.stow-hint')!;
    this.wait = this.el.querySelector('.stow-wait')!;
    this.bar = this.el.querySelector('.stow-bar i')!;
    this.live.setAttribute('role', 'status');
    this.wait.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onWait();
    });
    this.wait.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.append(this.veil, this.el, this.live);
  }

  /** The hidden player's card (null: not hidden). */
  update(v: StowView | null) {
    const on = v !== null;
    if (on !== this.shown) {
      this.shown = on;
      this.el.classList.toggle('hidden', !on);
      this.veil.classList.toggle('on', on);
      document.body.classList.toggle('stowed', on);
      this.live.textContent = on && v ? t('stow.sr', { vehicle: v.vehicle, time: v.leaves, guard: v.guard, search: v.search }) : '';
      this.waitKey = '';
      this.searchedSaid = 'ahead';
    }
    if (!v) return;
    // How the search went, told once to a screen reader (the speakers may be off).
    if (v.searched !== this.searchedSaid) {
      this.searchedSaid = v.searched;
      if (v.searched !== 'ahead') this.live.textContent = t(v.searched === 'quick' ? 'stow.searched' : 'stow.waved');
    }
    if (v.icon !== this.iconName) {
      this.iconName = v.icon;
      this.ic.innerHTML = icon(v.icon, 26);
    }
    setText(this.title, t('stow.where', { vehicle: v.vehicle }));
    setText(this.time, t('stow.leaves', { time: v.leaves }));
    setText(this.search, v.searched === 'quick' ? t('stow.searched') : v.searched === 'waved' ? t('stow.waved') : t('stow.search', { guard: v.guard, time: v.search }));
    this.search.classList.toggle('good', v.searched !== 'ahead');
    setText(this.hint, TOUCH ? t('stow.hintTouch') : t(v.canWait ? 'stow.hintKeys' : 'stow.hintKeysLate'));
    this.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, v.done)).toFixed(4)})`;
    // The Wait button: off once the search is near (the clock runs at its own pace then).
    const key = `${v.waiting}|${v.searched}|${v.canWait}`;
    if (key !== this.waitKey) {
      this.waitKey = key;
      // (Gone with the focus on it: the focus goes back to the page, not lost.)
      if (!v.canWait && document.activeElement === this.wait) this.wait.blur();
      this.wait.classList.toggle('gone', !v.canWait);
      this.wait.disabled = !v.canWait;
      // One name for it (its state is aria-pressed); the label shown follows the state.
      this.wait.innerHTML = `${icon(v.waiting ? 'pause' : 'clock', 18)}<span aria-hidden="true">${v.waiting ? t('stow.waiting') : t('stow.wait')}</span>`;
      this.wait.setAttribute('aria-label', t('stow.wait'));
      this.wait.setAttribute('aria-pressed', String(v.waiting));
      this.wait.classList.toggle('on', v.waiting);
    }
  }
}
