import { ROUTINE, routineEnd } from '../content/routine';
import { formatTime, type Clock } from '../sim/systems/clock';
import type { ZoneId } from '../content/zones';
import { currentLang, t, type Key } from '../i18n';
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
  /** A guard sees the player right now. */
  seen: boolean;
  /** Game minutes left in solitary, null when not there. */
  solitaryMinutes: number | null;
}

/** "Canteen", "Gym or Courtyard": where a block wants the player. */
export function routinePlace(k: number): string {
  const names = ROUTINE[k].zones.map((z) => t(`zone.${z}` as Key));
  if (!names.length) return t('routine.free');
  return names.reduce((a, b) => t('routine.or', { a, b }));
}

/** The zones that are layers, and the pill's icon for each. */
const LAYER_ZONES: Partial<Record<ZoneId, string>> = { tunnels: 'under', vents: 'vents', roof: 'roof' };
const LAYER_ICONS: Record<string, string> = { under: 'down', vents: 'bars', roof: 'up' };

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
  private readonly routineUntil: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly heatPill: HTMLElement;
  private readonly heatFill: HTMLElement;
  private readonly heatText: HTMLElement;
  private shownSeen = false;
  private shownZone = '';
  private night: boolean | null = null;
  private shownKey = '';
  private shownHeat = -1;
  private shownMinute = '';
  private lang = currentLang();

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
        <span class="pill big hud-routine"><i class="hud-routine-ic"></i><span class="hud-routine-text"><span class="hud-routine-head"><b></b><small></small></span><span class="hud-routine-place"></span></span><em class="hud-badge"></em></span>
        <span class="pill big hud-heat" aria-label="${t('hud.heat')}">${icon('flame', 16)}<i class="hud-heat-bar"><i></i></i><b></b><span class="hud-eye" title="${t('hud.seen')}">${icon('eye', 16)}</span></span>
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
    this.routineName = q('.hud-routine-head b');
    this.routineUntil = q('.hud-routine-head small');
    this.routinePlace = q('.hud-routine-place');
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
    this.shownZone = this.shownKey = this.shownMinute = '';
    this.shownHeat = -1;
  }

  update(clock: Clock, zone: ZoneId, s: HudState) {
    // The language changed (settings, from the pause menu): rewrite everything.
    if (currentLang() !== this.lang) {
      this.lang = currentLang();
      this.shownKey = this.shownMinute = '';
      this.zone.textContent = '';
    }
    // Text only when it changes: the clock once a game minute, the zone on entering one.
    const minute = `${clock.day}:${clock.minuteOfDay}`;
    if (minute !== this.shownMinute) {
      this.shownMinute = minute;
      setText(this.day, t('hud.day', { n: clock.day }));
      setText(this.time, formatTime(clock));
    }
    if (zone !== this.shownZone || !this.zone.textContent) {
      setText(this.zone, t(`zone.${zone}`));
      // Off the ground floor the pill shows the layer (GDD §13.2): its own color and icon.
      const layer = LAYER_ZONES[zone] ?? '';
      if (layer !== this.zonePill.dataset.layer) {
        this.zonePill.dataset.layer = layer;
        this.zonePill.querySelector('.ic')!.outerHTML = icon(LAYER_ICONS[layer] ?? 'pin', 16);
      }
      // A pulse on entering a new zone (not on the first frame).
      if (this.shownZone && zone !== this.shownZone) this.zonePill.classList.add('pulse');
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
    // The eye opens while a guard is looking (so stealth can be read at a glance).
    if (s.seen !== this.shownSeen) {
      this.shownSeen = s.seen;
      this.heatPill.classList.toggle('seen', s.seen);
    }
  }

  private updateRoutine(s: HudState) {
    const mandatory = ROUTINE[s.routine].zones.length > 0;
    const key = `${s.routine}|${s.attended}|${s.lockdown}|${s.solitaryMinutes}`;
    if (key === this.shownKey) return;
    const was = this.shownKey;
    this.shownKey = key;
    this.routinePill.classList.toggle('alarm', s.lockdown);
    this.routinePill.classList.toggle('solitary', s.solitaryMinutes !== null);
    if (s.lockdown) {
      this.routineIcon.innerHTML = icon('siren', 16);
      setText(this.routineName, t('routine.lockdown'));
      setText(this.routinePlace, t('routine.hunted'));
      setText(this.routineUntil, '');
      this.badge.className = 'hud-badge hidden';
      return;
    }
    if (s.solitaryMinutes !== null) {
      const m = s.solitaryMinutes;
      this.routineIcon.innerHTML = icon('lock', 16);
      setText(this.routineName, t('routine.solitary'));
      setText(this.routinePlace, t('routine.solitaryLeft', { time: `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` }));
      setText(this.routineUntil, '');
      this.badge.className = 'hud-badge hidden';
      return;
    }
    this.routineIcon.innerHTML = icon('bell', 16);
    setText(this.routineName, routineName(s.routine));
    const end = routineEnd(s.routine);
    const until = t('routine.until', { time: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}` });
    setText(this.routinePlace, routinePlace(s.routine));
    setText(this.routineUntil, until);
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
