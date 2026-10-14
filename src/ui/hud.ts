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
  private readonly zonePill: HTMLElement;
  private readonly clockIcon: HTMLElement;
  private shownZone = '';
  private night: boolean | null = null;

  constructor(onPause: () => void) {
    this.el = h(
      'div',
      'hud hidden',
      `<div class="hud-row">
        <span class="pill big hud-clock"><i class="hud-sky"></i><span class="hud-day"></span><b class="hud-time"></b></span>
        <span class="pill big hud-zone">${icon('pin', 16)}<span></span></span>
        <button class="icon-btn hud-pause" aria-label="${t('hud.pause')}">${icon('pause')}</button>
      </div>`,
    );
    this.day = this.el.querySelector('.hud-day')!;
    this.time = this.el.querySelector('.hud-time')!;
    this.zone = this.el.querySelector('.hud-zone span')!;
    this.zonePill = this.el.querySelector('.hud-zone')!;
    this.clockIcon = this.el.querySelector('.hud-sky')!;
    this.zonePill.addEventListener('animationend', () => this.zonePill.classList.remove('pulse'));
    this.el.querySelector('.hud-pause')!.addEventListener('click', onPause);
    document.body.append(this.el);
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
    if (on) this.shownZone = '';
  }

  update(clock: Clock, zone: ZoneId) {
    setText(this.day, t('hud.day', { n: clock.day }));
    setText(this.time, formatTime(clock));
    setText(this.zone, t(`zone.${zone}`));
    // A pulse on entering a new zone (not on the first frame).
    if (zone !== this.shownZone) {
      if (this.shownZone) this.zonePill.classList.add('pulse');
      this.shownZone = zone;
    }
    // Sun by day, moon from 21:00 to 06:00.
    const night = clock.hour >= 21 || clock.hour < 6;
    if (night !== this.night) {
      this.night = night;
      this.clockIcon.innerHTML = icon(night ? 'moon' : 'sun', 16);
      this.clockIcon.classList.toggle('moon', night);
    }
  }
}
