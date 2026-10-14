import { ROUTINE } from '../content/routine';
import { formatTime, type Clock } from '../sim/systems/clock';
import type { ZoneId } from '../content/zones';
import { t, type Key } from '../i18n';
import { h, setText } from './dom';
import { icon } from './icons';

/** What the HUD shows besides the clock and the zone. */
export interface HudState {
  /** The routine block (index into ROUTINE). */
  routine: number;
  attended: boolean;
  /** Guard heat, 0–100. */
  heat: number;
  lockdown: boolean;
  /** Minutes the player still has to sit in the cell before a lockdown lifts (when there). */
  lockedMinutes: number | null;
}

/** "Canteen", "Gym or Courtyard": where a block wants the player. */
export function routinePlace(k: number): string {
  const names = ROUTINE[k].zones.map((z) => t(`zone.${z}` as Key));
  if (!names.length) return t('routine.free');
  return names.reduce((a, b) => t('routine.or', { a, b }));
}

export const routineName = (k: number) => t(`routine.${ROUTINE[k].id}` as Key);

/**
 * The in-game HUD. Top row: the clock and day, where the player stands, the pause button.
 * Second row: the routine block, where it wants the player and the PENDING / ATTENDED badge
 * (GDD §13), and the heat meter. Text is written only when it changes (it updates every
 * frame). Both rows must still fit at 412 px.
 */
export class Hud {
  readonly el: HTMLElement;
  private readonly day: HTMLElement;
  private readonly time: HTMLElement;
  private readonly zone: HTMLElement;
  private readonly zonePill: HTMLElement;
  private readonly clockIcon: HTMLElement;
  private readonly routinePill: HTMLElement;
  private readonly routineIcon: HTMLElement;
  private readonly routineName: HTMLElement;
  private readonly routinePlace: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly heatPill: HTMLElement;
  private readonly heatFill: HTMLElement;
  private readonly heatText: HTMLElement;
  private shownZone = '';
  private night: boolean | null = null;
  private shownKey = '';
  private shownHeat = -1;

  constructor(onPause: () => void) {
    this.el = h(
      'div',
      'hud hidden',
      `<div class="hud-row">
        <span class="pill big hud-clock"><i class="hud-sky"></i><span class="hud-day"></span><b class="hud-time"></b></span>
        <span class="pill big hud-zone">${icon('pin', 16)}<span></span></span>
        <button class="icon-btn hud-pause" aria-label="${t('hud.pause')}">${icon('pause')}</button>
      </div>
      <div class="hud-row">
        <span class="pill big hud-routine"><i class="hud-routine-ic"></i><span class="hud-routine-text"><b></b><span></span></span><em class="hud-badge"></em></span>
        <span class="pill big hud-heat" aria-label="${t('hud.heat')}">${icon('flame', 16)}<i class="hud-heat-bar"><i></i></i><b></b></span>
      </div>`,
    );
    const q = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
    this.day = q('.hud-day');
    this.time = q('.hud-time');
    this.zone = q('.hud-zone span');
    this.zonePill = q('.hud-zone');
    this.clockIcon = q('.hud-sky');
    this.routinePill = q('.hud-routine');
    this.routineIcon = q('.hud-routine-ic');
    this.routineName = q('.hud-routine-text b');
    this.routinePlace = q('.hud-routine-text span');
    this.badge = q('.hud-badge');
    this.heatPill = q('.hud-heat');
    this.heatFill = q('.hud-heat-bar i');
    this.heatText = q('.hud-heat b');
    for (const el of [this.zonePill, this.badge, this.heatPill, this.routinePill]) el.addEventListener('animationend', () => el.classList.remove('pulse', 'pop', 'bump'));
    q('.hud-pause').addEventListener('click', onPause);
    document.body.append(this.el);
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
    if (!on) return;
    this.shownZone = this.shownKey = '';
    this.shownHeat = -1;
  }

  update(clock: Clock, zone: ZoneId, s: HudState) {
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
    this.updateRoutine(s);
    this.updateHeat(s.heat);
  }

  private updateRoutine(s: HudState) {
    const mandatory = ROUTINE[s.routine].zones.length > 0;
    const key = `${s.routine}|${s.attended}|${s.lockdown}|${s.lockedMinutes}`;
    if (key === this.shownKey) return;
    const was = this.shownKey;
    this.shownKey = key;
    this.routinePill.classList.toggle('alarm', s.lockdown);
    if (s.lockdown) {
      this.routineIcon.innerHTML = icon('siren', 16);
      setText(this.routineName, t('routine.lockdown'));
      setText(this.routinePlace, s.lockedMinutes !== null ? t('routine.lockedIn', { n: s.lockedMinutes }) : t('routine.home'));
      this.badge.className = 'hud-badge hidden';
      return;
    }
    this.routineIcon.innerHTML = icon('bell', 16);
    setText(this.routineName, routineName(s.routine));
    setText(this.routinePlace, routinePlace(s.routine));
    this.badge.className = `hud-badge${mandatory ? '' : ' hidden'}${s.attended ? ' done' : ''}`;
    this.badge.innerHTML = s.attended ? `${icon('check', 12)}${t('routine.attended')}` : t('routine.pending');
    // Checked in: the badge pops. A new block: the whole pill does.
    const [wasRoutine, wasAttended] = was.split('|');
    if (was && wasRoutine === String(s.routine) && wasAttended === 'false' && s.attended) this.badge.classList.add('pop');
    else if (was && wasRoutine !== String(s.routine)) this.routinePill.classList.add('pulse');
  }

  private updateHeat(heat: number) {
    if (heat === this.shownHeat) return;
    if (this.shownHeat >= 0 && heat > this.shownHeat) this.heatPill.classList.add('bump');
    this.shownHeat = heat;
    this.heatFill.style.width = `${heat}%`;
    setText(this.heatText, `${heat}%`);
    this.heatPill.dataset.level = heat >= 80 ? 'high' : heat >= 40 ? 'mid' : heat > 0 ? 'low' : 'none';
  }
}
