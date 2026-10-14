import { formatTime, type Clock } from '../sim/systems/clock';
import type { ZoneId } from '../content/zones';
import { t } from '../i18n';
import { h, setText } from './dom';
import { icon } from './icons';

/**
 * The in-game HUD: the clock and day, where the player stands, and the pause button.
 * Text is written only when it changes (it updates every frame). More bars and the hotbar
 * join it phase by phase; the top row must still fit at 412 px.
 */
export class Hud {
  readonly el: HTMLElement;
  private readonly day: HTMLElement;
  private readonly time: HTMLElement;
  private readonly zone: HTMLElement;

  constructor(onPause: () => void) {
    this.el = h(
      'div',
      'hud hidden',
      `<div class="hud-row">
        <span class="pill big hud-clock">${icon('clock', 16)}<span class="hud-day"></span><b class="hud-time"></b></span>
        <span class="pill big hud-zone">${icon('pin', 16)}<span></span></span>
        <button class="icon-btn hud-pause" aria-label="${t('hud.pause')}">${icon('pause')}</button>
      </div>`,
    );
    this.day = this.el.querySelector('.hud-day')!;
    this.time = this.el.querySelector('.hud-time')!;
    this.zone = this.el.querySelector('.hud-zone span')!;
    this.el.querySelector('.hud-pause')!.addEventListener('click', onPause);
    document.body.append(this.el);
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
  }

  update(clock: Clock, zone: ZoneId) {
    setText(this.day, t('hud.day', { n: clock.day }));
    setText(this.time, formatTime(clock));
    setText(this.zone, t(`zone.${zone}`));
  }
}
