import { currentLang, t } from '../i18n';
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
  private readonly cardTrail: HTMLElement;
  private readonly cardStr: HTMLElement;
  private readonly cardMood: HTMLElement;
  private readonly cardIcon: HTMLElement;
  private readonly lockBtn: HTMLButtonElement;
  private readonly flash: HTMLElement;
  private readonly cardKeys: HTMLElement | null;
  /** What the card shows now (redrawn only when one of these changes). */
  private shownName = '';
  private shownMood = '';
  private shownStr = -1;
  private shownReach: boolean | null = null;
  private shownHealth = -1;
  private lang = currentLang();
  /** Pressed: lock on to the next (R on a keyboard). */
  onLock: () => void = () => {};

  constructor() {
    this.card = h(
      'div',
      'target-card hidden',
      `<i class="target-ic"></i><span class="target-text"><span class="target-head"><b role="status" aria-live="polite"></b><em></em></span><span class="target-row"><i class="target-bar"><i class="trail"></i><i class="fill"></i></i><small></small></span></span>${TOUCH ? '' : `<span class="target-keys"><kbd>R</kbd><kbd class="wide"></kbd></span>`}`,
    );
    this.cardKeys = this.card.querySelector('.target-keys kbd.wide');
    this.cardName = this.card.querySelector('.target-head b')!;
    this.cardMood = this.card.querySelector('.target-head em')!;
    this.cardFill = this.card.querySelector('.target-bar .fill')!;
    this.cardTrail = this.card.querySelector('.target-bar .trail')!;
    this.cardStr = this.card.querySelector('.target-row small')!;
    this.cardIcon = this.card.querySelector('.target-ic')!;
    this.lockBtn = h('button', 'lock-btn hidden', `<i class="lock-round">${icon('target', 24)}</i>`);
    this.lockBtn.setAttribute('aria-pressed', 'false');
    // Pointer down for touch (no click delay); a click without one (assistive tech, keyboard) too.
    let pointed = false;
    this.lockBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pointed = true;
      this.onLock();
    });
    this.lockBtn.addEventListener('click', () => {
      if (!pointed) this.onLock();
      pointed = false;
    });
    this.lockBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    this.flash = h('div', 'hurt-flash');
    this.flash.setAttribute('aria-hidden', 'true');
    this.relabel();
    this.flash.addEventListener('animationend', () => this.flash.classList.remove('on'));
    document.body.append(this.card, this.lockBtn, this.flash);
  }

  /** Text that follows the language: the lock button's label, the Space key. */
  private relabel() {
    this.lang = currentLang();
    this.lockBtn.setAttribute('aria-label', t('combat.lock'));
    if (this.cardKeys) this.cardKeys.textContent = t('key.space');
    this.shownName = this.shownMood = '';
    this.shownStr = -1;
  }

  show(on: boolean) {
    if (on) return;
    this.card.classList.add('hidden');
    this.lockBtn.classList.add('hidden');
    document.body.classList.remove('has-lock');
    this.shownName = '';
    this.shownHealth = -1;
  }

  /**
   * Each frame: the target (null: none), whether anyone is in lock range (the touch button
   * shows then), and whether controls are busy (asleep, out cold, a panel open).
   */
  update(target: TargetInfo | null, canLock: boolean, busy: boolean) {
    if (this.lang !== currentLang()) this.relabel();
    const card = !!target && !busy;
    this.card.classList.toggle('hidden', !card);
    const btn = TOUCH && !busy && (canLock || !!target);
    this.lockBtn.classList.toggle('hidden', !btn);
    this.lockBtn.classList.toggle('on', !!target);
    if ((this.lockBtn.getAttribute('aria-pressed') === 'true') !== !!target) this.lockBtn.setAttribute('aria-pressed', String(!!target));
    document.body.classList.toggle('has-lock', btn);
    if (!target) {
      this.shownName = '';
      this.shownHealth = -1;
      return;
    }
    // Someone new: everything is written afresh, and the card pops.
    if (target.name !== this.shownName) {
      this.shownName = target.name;
      this.shownMood = '';
      this.shownStr = -1;
      this.shownReach = null;
      this.shownHealth = -1;
      setText(this.cardName, target.name);
      this.cardIcon.innerHTML = icon(target.guard ? 'shield' : 'fist', 18);
      this.card.classList.remove('pop', 'hit');
      void this.card.offsetWidth;
      this.card.classList.add('pop');
    }
    if (target.attitude !== this.shownMood) {
      this.shownMood = target.attitude;
      setText(this.cardMood, t(`attitude.${target.attitude}`));
      this.card.dataset.mood = target.attitude;
    }
    if (target.str !== this.shownStr) {
      this.shownStr = target.str;
      setText(this.cardStr, t('combat.str', { n: target.str }));
    }
    if (target.inReach !== this.shownReach) {
      this.shownReach = target.inReach;
      this.card.classList.toggle('far', !target.inReach);
    }
    const hp = Math.round(target.health * 100);
    if (hp !== this.shownHealth) {
      // A blow landed: the card jolts and the bar leaves a trail (the health just lost) that catches up.
      if (this.shownHealth >= 0 && hp < this.shownHealth) {
        this.card.classList.remove('hit');
        void this.card.offsetWidth;
        this.card.classList.add('hit');
      }
      this.shownHealth = hp;
      this.cardFill.style.width = `${hp}%`;
      this.cardTrail.style.width = `${hp}%`;
      this.card.dataset.health = hp > 60 ? 'high' : hp > 30 ? 'mid' : 'low';
    }
  }

  /** A number floating up from a point on screen: damage dealt (gold), taken (red), or a word ("Out cold!"). */
  float(text: string, x: number, y: number, kind: 'dealt' | 'taken' | 'ko' | 'cash' | 'gain' | 'ally') {
    const el = h('div', `float-num ${kind}`);
    el.textContent = text;
    el.setAttribute('aria-hidden', 'true');
    // A little sideways scatter, so quick blows don't stack on one spot.
    if (kind === 'dealt' || kind === 'taken' || kind === 'ally') x += (Math.random() - 0.5) * 24;
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
