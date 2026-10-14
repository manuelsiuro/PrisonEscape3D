import { t } from '../i18n';
import { h, TOUCH } from './dom';
import { icon } from './icons';

/** What a strike would do now, for the button: a verb, what to, the icon, and how far along the tile is. */
export interface ToolView {
  verb: string;
  what: string;
  icon: string;
  /** The tool in hand can do it (else pressing says what is needed). */
  fits: boolean;
  /** How much of the tile's hit points are gone (0–1), null for nothing to wear down (eating). */
  progress: number | null;
  /** Holding the button repeats it (strikes, blows); eating is one press. */
  repeat: boolean;
  /** A blow at the locked-on target (the button turns red). */
  attack?: boolean;
}

/**
 * The tool controls (GDD §13.1 "Use Tool"): on touch a round button above the action button,
 * held to keep striking, with a ring filling as the wall, fence, grate or earth gives way; on
 * a keyboard a Space prompt above the E prompt. Beside the hotbar, the energy meter (GDD
 * §3.1), shown while it matters (a tool in hand, or below full).
 */
export class ToolControls {
  private readonly btn: HTMLButtonElement;
  private readonly prompt: HTMLElement;
  private readonly energy: HTMLElement;
  private readonly energyPart: HTMLElement;
  private readonly energyFill: HTMLElement;
  private readonly healthPart: HTMLElement;
  private readonly healthFill: HTMLElement;
  private shown = '';
  private shownEnergy = -1;
  private shownHealth = -1;
  private ring: HTMLElement | null = null;
  private bar: HTMLElement | null = null;
  /** Held down (touch or Space). */
  held = false;
  /** Called on a press (a one-press action fires here; strikes repeat while `held`). */
  onPress: () => void = () => {};

  constructor() {
    this.btn = h('button', 'tool-btn hidden');
    this.prompt = h('div', 'tool-prompt hidden');
    // The vitals pill (GDD §13.2): health (while it's down or in a fight) and energy.
    this.energy = h('div', 'energy hidden', `<span class="vital hp">${icon('heart', 14)}<i class="energy-bar"><i></i></i></span><span class="vital en">${icon('bolt', 14)}<i class="energy-bar"><i></i></i></span>`);
    this.healthPart = this.energy.querySelector('.vital.hp')!;
    this.energyPart = this.energy.querySelector('.vital.en')!;
    this.healthFill = this.healthPart.querySelector('.energy-bar i')!;
    this.energyFill = this.energyPart.querySelector('.energy-bar i')!;
    const down = (e: Event) => {
      e.preventDefault();
      if (this.btn.classList.contains('hidden')) return;
      this.held = true;
      this.btn.classList.add('down');
      this.onPress();
    };
    const up = () => {
      this.held = false;
      this.btn.classList.remove('down');
    };
    this.btn.addEventListener('pointerdown', down);
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) this.btn.addEventListener(ev, up);
    this.btn.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.append(this.btn, this.prompt, this.energy);
  }

  /** Lets go of the button (the target changed under the hold, the window lost focus). */
  release() {
    this.held = false;
    this.btn.classList.remove('down');
  }

  show(on: boolean) {
    if (!on) {
      for (const el of [this.btn, this.prompt, this.energy]) el.classList.add('hidden');
      document.body.classList.remove('has-tool', 'tool-up');
      this.shown = '';
      this.shownEnergy = -1;
      this.shownHealth = -1;
      this.held = false;
    }
  }

  /**
   * Each frame: what a strike would do (null: nothing to strike), the energy, whether a tool
   * is in hand, whether the controls are put away; health as a fraction, and whether a fight
   * is on (health shows then, or while it's down).
   */
  update(v: ToolView | null, energy: number, toolInHand: boolean, blocked: boolean, health = 1, fighting = false) {
    const on = !!v && !blocked;
    this.btn.classList.toggle('hidden', !on || !TOUCH);
    this.prompt.classList.toggle('hidden', !on || TOUCH);
    document.body.classList.toggle('has-tool', on && TOUCH);
    document.body.classList.toggle('tool-up', on);
    if (!on) this.release();
    if (on && v) {
      const key = `${v.verb}|${v.what}|${v.icon}|${v.fits}|${v.progress === null}|${!!v.attack}`;
      if (key !== this.shown) {
        this.shown = key;
        if (TOUCH) {
          this.btn.innerHTML = `<i class="tool-round"><i class="tool-ring"></i>${icon(v.icon, 24)}<span></span></i>`;
          this.btn.querySelector('span')!.textContent = v.verb;
          this.ring = this.btn.querySelector('.tool-ring');
          this.btn.setAttribute('aria-label', `${v.verb} ${v.what}`);
        } else {
          this.prompt.innerHTML = `<kbd class="wide">${t('key.space')}</kbd><span></span><b></b>${v.progress === null ? '' : '<i class="tool-bar"><i></i></i>'}`;
          this.prompt.querySelector('span')!.textContent = v.verb;
          this.prompt.querySelector('b')!.textContent = v.what;
          this.bar = this.prompt.querySelector('.tool-bar i');
        }
        this.btn.classList.toggle('no', !v.fits);
        this.prompt.classList.toggle('no', !v.fits);
        this.btn.classList.toggle('attack', !!v.attack);
        this.prompt.classList.toggle('attack', !!v.attack);
      }
      const p = Math.round((v.progress ?? 0) * 100);
      if (this.ring) this.ring.style.setProperty('--p', `${p}%`);
      if (this.bar) this.bar.style.width = `${p}%`;
    }
    // Energy: while a tool is in hand, or while it's down. Health: in a fight, or while it's down.
    const e = Math.round(energy);
    const hp = Math.round(health * 100);
    const showEnergy = toolInHand || e < 100;
    const showHealth = fighting || hp < 100;
    this.energy.classList.toggle('hidden', !(showEnergy || showHealth) || blocked);
    this.energyPart.classList.toggle('hidden', !showEnergy);
    this.healthPart.classList.toggle('hidden', !showHealth);
    if (e !== this.shownEnergy) {
      this.shownEnergy = e;
      this.energyFill.style.width = `${e}%`;
      this.energyPart.classList.toggle('low', e < 25);
      this.energyPart.title = `${t('hud.energy')} ${e}%`;
    }
    if (hp !== this.shownHealth) {
      // A blow taken: the heart thumps.
      if (this.shownHealth >= 0 && hp < this.shownHealth) {
        this.healthPart.classList.remove('thump');
        void this.healthPart.offsetWidth;
        this.healthPart.classList.add('thump');
      }
      this.shownHealth = hp;
      this.healthFill.style.width = `${hp}%`;
      this.healthPart.classList.toggle('low', hp <= 30);
      this.healthPart.title = `${t('hud.health')} ${hp}%`;
    }
  }
}
