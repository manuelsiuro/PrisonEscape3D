import { t } from '../i18n';
import { h, setText, TOUCH } from './dom';
import { icon } from './icons';

/** What the target card shows about the locked-on person (GDD §10.1: health, strength, attitude). */
export interface TargetInfo {
  /** "Inmate · cell 3", "Guard · purple key". */
  name: string;
  guard: boolean;
  /** 0–1. */
  health: number;
  str: number;
  /** calm, angry, onDuty, chasing (i18n `attitude.<id>`). */
  attitude: 'calm' | 'angry' | 'onDuty' | 'chasing';
  /** The blow would land now (in reach, nothing between). */
  inReach: boolean;
}

/**
 * Combat on screen (GDD §10.1, §13.2):
 * - the target card under the HUD: who is locked on, their health bar, strength and attitude
 *   (and on a keyboard, the keys: R next, Space hit);
 * - the lock button on touch (beside the tool button), lit while locked; tapping someone
 *   locks on too;
 * - numbers floating up from whoever is hit, and a red flash at the screen's edges when the
 *   player is.
 */
export class CombatUI {
  private readonly card: HTMLElement;
  private readonly cardName: HTMLElement;
  private readonly cardFill: HTMLElement;
  private readonly cardStr: HTMLElement;
  private readonly cardMood: HTMLElement;
  private readonly cardIcon: HTMLElement;
  private readonly lockBtn: HTMLButtonElement;
  private readonly flash: HTMLElement;
  private shown = '';
  private shownHealth = -1;
  /** Pressed: lock on to the next (R on a keyboard). */
  onLock: () => void = () => {};

  constructor() {
    this.card = h(
      'div',
      'target-card hidden',
      `<i class="target-ic"></i><span class="target-text"><span class="target-head"><b></b><em></em></span><span class="target-row"><i class="target-bar"><i></i></i><small></small></span></span>${TOUCH ? '' : `<span class="target-keys"><kbd>R</kbd><kbd class="wide">${t('key.space')}</kbd></span>`}`,
    );
    this.cardName = this.card.querySelector('.target-head b')!;
    this.cardMood = this.card.querySelector('.target-head em')!;
    this.cardFill = this.card.querySelector('.target-bar i')!;
    this.cardStr = this.card.querySelector('.target-row small')!;
    this.cardIcon = this.card.querySelector('.target-ic')!;
    this.lockBtn = h('button', 'lock-btn hidden', `<i class="lock-round">${icon('target', 24)}</i>`);
    this.lockBtn.setAttribute('aria-label', t('combat.lock'));
    this.lockBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onLock();
    });
    this.lockBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    this.flash = h('div', 'hurt-flash');
    this.flash.addEventListener('animationend', () => this.flash.classList.remove('on'));
    document.body.append(this.card, this.lockBtn, this.flash);
  }

  show(on: boolean) {
    if (on) return;
    this.card.classList.add('hidden');
    this.lockBtn.classList.add('hidden');
    document.body.classList.remove('has-lock');
    this.shown = '';
  }

  /**
   * Each frame: the target (null: none), whether anyone is in lock range (the touch button
   * shows then), and whether controls are busy (asleep, out cold, a panel open).
   */
  update(target: TargetInfo | null, canLock: boolean, busy: boolean) {
    const card = !!target && !busy;
    this.card.classList.toggle('hidden', !card);
    const btn = TOUCH && !busy && (canLock || !!target);
    this.lockBtn.classList.toggle('hidden', !btn);
    this.lockBtn.classList.toggle('on', !!target);
    document.body.classList.toggle('has-lock', btn);
    if (!target) {
      this.shown = '';
      this.shownHealth = -1;
      return;
    }
    const key = `${target.name}|${target.attitude}|${target.str}|${target.inReach}`;
    if (key !== this.shown) {
      const fresh = !this.shown.startsWith(`${target.name}|`);
      this.shown = key;
      setText(this.cardName, target.name);
      setText(this.cardMood, t(`attitude.${target.attitude}`));
      setText(this.cardStr, t('combat.str', { n: target.str }));
      this.cardIcon.innerHTML = icon(target.guard ? 'shield' : 'fist', 18);
      this.card.dataset.mood = target.attitude;
      this.card.classList.toggle('far', !target.inReach);
      if (fresh) {
        this.card.classList.remove('pop');
        void this.card.offsetWidth;
        this.card.classList.add('pop');
      }
    }
    const hp = Math.round(target.health * 100);
    if (hp !== this.shownHealth) {
      this.shownHealth = hp;
      this.cardFill.style.width = `${hp}%`;
      this.card.classList.toggle('low', hp <= 30);
    }
  }

  /** A number floating up from a point on screen: damage dealt (gold), taken (red), or a word ("Out cold!"). */
  float(text: string, x: number, y: number, kind: 'dealt' | 'taken' | 'ko') {
    const el = h('div', `float-num ${kind}`);
    el.textContent = text;
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.addEventListener('animationend', () => el.remove());
    document.body.append(el);
  }

  /** The player is hit: the screen's edges flash red. */
  hurt(heavy: boolean) {
    this.flash.classList.remove('on', 'heavy');
    void this.flash.offsetWidth;
    this.flash.classList.add('on');
    this.flash.classList.toggle('heavy', heavy);
  }
}
