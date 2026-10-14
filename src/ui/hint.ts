import { h } from './dom';
import { icon } from './icons';

/**
 * A coach hint at the bottom of the screen ("Drag anywhere to walk"): slides in, stays
 * until the player has done the thing (the caller hides it), then slides away.
 */
export class Hint {
  private el: HTMLElement | null = null;

  show(lines: string[], iconName = 'gamepad') {
    this.hide();
    const el = h('div', 'hint', `${icon(iconName, 22)}<div>${lines.map((l) => `<span>${l}</span>`).join('')}</div>`);
    document.body.append(el);
    this.el = el;
    // Toasts rise above the hint while it is up (see .toasts): from its resting place (its
    // bottom offset and height, not its box mid-slide).
    requestAnimationFrame(() => {
      if (this.el !== el) return;
      const clear = parseFloat(getComputedStyle(el).bottom) + el.offsetHeight + 10;
      document.body.style.setProperty('--hint-clear', `${Math.round(clear)}px`);
    });
  }

  get visible() {
    return this.el !== null;
  }

  hide() {
    const el = this.el;
    if (!el) return;
    this.el = null;
    document.body.style.removeProperty('--hint-clear');
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 350);
  }
}
