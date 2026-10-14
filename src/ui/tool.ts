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
  /** Holding the button repeats it (strikes); eating is one press. */
  repeat: boolean;
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
  private readonly energyFill: HTMLElement;
  private shown = '';
  private shownEnergy = -1;
  private ring: HTMLElement | null = null;
  private bar: HTMLElement | null = null;
  /** Held down (touch or Space). */
  held = false;
  /** Called on a press (a one-press action fires here; strikes repeat while `held`). */
  onPress: () => void = () => {};

  constructor() {
    this.btn = h('button', 'tool-btn hidden');
    this.prompt = h('div', 'tool-prompt hidden');
    this.energy = h('div', 'energy hidden', `${icon('bolt', 14)}<i class="energy-bar"><i></i></i>`);
    this.energyFill = this.energy.querySelector('.energy-bar i')!;
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

  show(on: boolean) {
    if (!on) {
      for (const el of [this.btn, this.prompt, this.energy]) el.classList.add('hidden');
      document.body.classList.remove('has-tool');
      this.shown = '';
      this.shownEnergy = -1;
      this.held = false;
    }
  }

  /** Each frame: what a strike would do (null: nothing to strike), the energy, whether a tool is in hand. */
  update(v: ToolView | null, energy: number, toolInHand: boolean, blocked: boolean) {
    const on = !!v && !blocked;
    this.btn.classList.toggle('hidden', !on || !TOUCH);
    this.prompt.classList.toggle('hidden', !on || TOUCH);
    document.body.classList.toggle('has-tool', on && TOUCH);
    if (!on) this.held = false;
    if (on && v) {
      const key = `${v.verb}|${v.what}|${v.icon}|${v.fits}|${v.progress === null}`;
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
      }
      const p = Math.round((v.progress ?? 0) * 100);
      if (this.ring) this.ring.style.setProperty('--p', `${p}%`);
      if (this.bar) this.bar.style.width = `${p}%`;
    }
    // Energy: while a tool is in hand, or while it's down.
    const e = Math.round(energy);
    this.energy.classList.toggle('hidden', !(toolInHand || e < 100) || blocked);
    if (e !== this.shownEnergy) {
      this.shownEnergy = e;
      this.energyFill.style.width = `${e}%`;
      this.energy.classList.toggle('low', e < 25);
      this.energy.title = `${t('hud.energy')} ${e}%`;
    }
  }
}
