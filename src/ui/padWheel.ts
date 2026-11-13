import { t, type Key } from '../i18n';
import type { Action } from '../input/bindings';
import { h } from './dom';
import { icon } from './icons';

/** A panel the wheel opens: its action (whose key opens it), icon and name. */
export interface WheelRow {
  /** The panel's action, or the pockets (the hotbar chosen with the D-pad: an item's menu, its slots). */
  action: Action | 'pockets';
  icon: string;
  name: Key;
}

/** Every panel, in the wheel's order (the ones there's nothing for are left out when it opens). */
export const WHEEL: readonly WheelRow[] = [
  { action: 'pockets', icon: 'hand', name: 'pad.wheel.pockets' },
  { action: 'craft', icon: 'hammer', name: 'pad.wheel.craft' },
  { action: 'file', icon: 'idCard', name: 'pad.wheel.file' },
  { action: 'day', icon: 'calendar', name: 'pad.wheel.day' },
  { action: 'job', icon: 'clipboard', name: 'pad.wheel.job' },
  { action: 'rat', icon: 'rat', name: 'pad.wheel.rat' },
  { action: 'phone', icon: 'phone', name: 'pad.wheel.phone' },
  { action: 'crew', icon: 'users', name: 'pad.wheel.crew' },
  { action: 'objectives', icon: 'bulb', name: 'pad.wheel.objectives' },
  { action: 'help', icon: 'help', name: 'pad.wheel.help' },
];

/**
 * The panels' wheel (2.45): a pad has no keys for the nine panels, so its View button opens this card of
 * them, chosen with the D-pad and A. The game goes on behind it, as behind any panel.
 */
export class PadWheel {
  readonly el = h('div', 'pad-wheel hidden', '');
  onPick: (a: WheelRow['action']) => void = () => {};
  private shown: readonly WheelRow['action'][] = [];

  constructor() {
    this.el.setAttribute('role', 'dialog');
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (b) this.onPick(b.dataset.a as WheelRow['action']);
      else if (e.target === this.el) this.close();
    });
    document.body.append(this.el);
  }

  get isOpen() {
    return !this.el.classList.contains('hidden');
  }

  /** Opened with these panels, the first one chosen. */
  open(rows: readonly WheelRow[]) {
    this.shown = rows.map((r) => r.action);
    this.el.setAttribute('aria-label', t('pad.wheel.title'));
    this.el.innerHTML = `<div class="pad-wheel-card">
      <h2>${icon('gamepad', 18)}${t('pad.wheel.title')}</h2>
      <div class="pad-wheel-grid">${rows
        .map((r) => `<button class="pad-wheel-btn" data-a="${r.action}">${icon(r.icon, 22)}<span>${t(r.name)}</span></button>`)
        .join('')}</div>
    </div>`;
    this.el.classList.remove('hidden');
    this.el.querySelector<HTMLElement>('[data-a]')?.focus();
  }

  close() {
    if (!this.isOpen) return;
    this.el.classList.add('hidden');
    this.el.innerHTML = '';
  }

  /** The panels it shows now. */
  get actions() {
    return this.shown;
  }
}
