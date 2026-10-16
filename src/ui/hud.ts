import { ROUTINE, routineEnd } from '../content/routine';
import { formatTime, type Clock } from '../sim/systems/clock';
import type { ZoneId } from '../content/zones';
import { currentLang, t, type Key } from '../i18n';
import { h, setText, TOUCH } from './dom';
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
  /** Dollars (GDD §13.2: CASH in the top bar). */
  cash: number;
  /** During the Work Period with a job (GDD §11): where, and the quota so far (the badge shows it instead of PENDING). */
  work: { place: string; quota: number; of: number; paid: boolean } | null;
  /** Security (GDD §5.5, §12): seconds until the power comes back (null: on), and until the first guard comes round in a takeover (null: none). */
  powerLeft: number | null;
  /** What the power pill says (Irongate's generators each kill their half, P12). */
  powerKey: 'hud.powerOut' | 'hud.powerOutCams' | 'hud.powerOutFence';
  takeoverLeft: number | null;
  /** The cold (P9, GDD §4.2): how far it has built up (0–1; null: warm), seconds until it bites, and whether it has (energy costs double). */
  cold: { built: number; left: number; bit: boolean; warming: boolean } | null;
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

/** Phones narrower than this move the block's deadline under its name. */
const NARROW = matchMedia('(max-width: 440px)');

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
  private shownCash = -1;
  private readonly cashPill: HTMLElement;
  private readonly cashText: HTMLElement;
  private lang = currentLang();

  constructor(onPause: () => void, onProfile: () => void = () => {}) {
    this.el = h(
      'div',
      'hud hidden',
      `<div class="hud-row">
        <span class="pill big hud-clock"><i class="hud-sky"></i><span class="hud-day"></span><b class="hud-time"></b></span>
        <span class="pill big hud-zone">${icon('pin', 16)}<span></span></span>
        <button class="pill big hud-cash">${icon('coin', 16)}<b></b></button>
        <button class="icon-btn hud-pause" aria-label="${t('hud.pause')}">${icon('pause')}</button>
      </div>
      <div class="hud-row">
        <span class="pill big hud-routine"><i class="hud-routine-ic"></i><span class="hud-routine-text"><span class="hud-routine-head"><b></b><small></small></span><span class="hud-routine-place"></span></span><em class="hud-badge"></em></span>
        <span class="pill big hud-heat" aria-label="${t('hud.heat')}">${icon('flame', 16)}<i class="hud-heat-bar"><i></i></i><b></b><span class="hud-eye" title="${t('hud.seen')}">${icon('eye', 16)}</span></span>
      </div>
      <div class="hud-row hud-alerts">
        <span class="pill hud-alert hud-power hidden" role="status">${icon('plug', 15)}<span></span><b></b><i class="hud-alert-bar"><i></i></i></span>
        <span class="pill hud-alert hud-riot hidden" role="status">${icon('users', 15)}<span></span><b></b><i class="hud-alert-bar"><i></i></i></span>
        <span class="pill hud-alert hud-cold hidden">${icon('snow', 15)}<span role="status"></span><b aria-hidden="true"></b><i class="hud-alert-bar" aria-hidden="true"><i></i></i></span>
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
    this.cashPill = q('.hud-cash');
    this.cashText = q('.hud-cash b');
    this.cashPill.addEventListener('click', onProfile);
    this.cashPill.addEventListener('animationend', () => this.cashPill.classList.remove('gain', 'spend'));
    this.power = q('.hud-power');
    this.riot = q('.hud-riot');
    this.cold = q('.hud-cold');
    document.body.append(this.el);
  }

  private readonly power: HTMLElement;
  private readonly riot: HTMLElement;
  private readonly cold: HTMLElement;
  private shownAlerts = '';

  /** A chip under the rows while something runs out: its label, the seconds left and a bar draining from full. */
  private alert(el: HTMLElement, label: Key, left: number | null, total: number) {
    el.classList.toggle('hidden', left === null);
    if (left === null) return;
    setText(el.querySelector('span')!, t(label));
    setText(el.querySelector('b')!, `0:${String(Math.max(0, Math.ceil(left))).padStart(2, '0')}`);
    (el.querySelector('.hud-alert-bar i') as HTMLElement).style.width = `${Math.max(0, Math.min(1, left / total)) * 100}%`;
    el.classList.toggle('low', left <= 10);
  }

  /** The cold's chip: the bar fills as it builds, the seconds until it bites; then "Frozen" until warm again. */
  private chill(c: HudState['cold']) {
    const el = this.cold;
    el.classList.toggle('hidden', !c);
    if (!c) return;
    el.classList.toggle('bit', c.bit);
    el.classList.toggle('warming', c.warming);
    setText(el.querySelector('span')!, t(c.bit ? 'hud.frozen' : c.warming ? 'hud.warming' : 'hud.cold'));
    setText(el.querySelector('b')!, c.bit ? '×2' : c.warming ? '' : `0:${String(Math.min(59, Math.max(0, Math.ceil(c.left)))).padStart(2, '0')}`);
    (el.querySelector('.hud-alert-bar i') as HTMLElement).style.width = `${Math.max(0, Math.min(1, c.built)) * 100}%`;
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
    if (!on) return;
    this.shownZone = this.shownKey = this.shownMinute = '';
    this.shownHeat = -1;
    this.shownCash = -1;
    this.shownAlerts = '';
  }

  update(clock: Clock, zone: ZoneId, s: HudState) {
    // The language changed (settings, from the pause menu): rewrite everything.
    if (currentLang() !== this.lang) {
      this.lang = currentLang();
      this.shownKey = this.shownMinute = '';
      this.zone.textContent = '';
      this.cashPill.title = '';
    }
    // Text only when it changes: the clock once a game minute, the zone on entering one.
    const minute = `${clock.day}:${clock.minuteOfDay}:${NARROW.matches}`;
    if (minute !== this.shownMinute) {
      this.shownMinute = minute;
      // Narrow phones: "D1" leaves the zone room for its name beside the cash.
      setText(this.day, t(NARROW.matches ? 'hud.dayShort' : 'hud.day', { n: clock.day }));
      this.day.title = t('hud.day', { n: clock.day });
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
    const c = s.cold;
    const alerts = `${s.powerLeft === null ? '' : Math.ceil(s.powerLeft)}:${s.powerKey}|${s.takeoverLeft === null ? '' : Math.ceil(s.takeoverLeft)}|${c ? `${Math.round(c.built * 40)}:${Math.ceil(c.left)}:${c.bit}:${c.warming}` : ''}|${this.lang}`;
    if (alerts !== this.shownAlerts) {
      this.shownAlerts = alerts;
      this.alert(this.power, s.powerKey, s.powerLeft, 45);
      this.alert(this.riot, 'hud.gatesOpen', s.takeoverLeft, 30);
      this.chill(c);
    }
    if (s.cash !== this.shownCash || this.cashPill.title === '') {
      // Money in: the pill flashes gold; out: it dips.
      if (this.shownCash >= 0 && s.cash !== this.shownCash) {
        this.cashPill.classList.remove('gain', 'spend');
        void this.cashPill.offsetWidth;
        this.cashPill.classList.add(s.cash > this.shownCash ? 'gain' : 'spend');
      }
      this.shownCash = s.cash;
      setText(this.cashText, `$${s.cash}`);
      // The keyboard's shortcut in the tooltip (not on touch).
      this.cashPill.title = TOUCH ? t('hud.profile') : `${t('hud.profile')} (I)`;
      this.cashPill.setAttribute('aria-label', `${t('hud.cash')} $${s.cash}. ${t('hud.profile')}`);
    }
    // The eye opens while a guard is looking (so stealth can be read at a glance).
    if (s.seen !== this.shownSeen) {
      this.shownSeen = s.seen;
      this.heatPill.classList.toggle('seen', s.seen);
    }
  }

  private updateRoutine(s: HudState) {
    const w = s.work;
    const mandatory = ROUTINE[s.routine].zones.length > 0 || !!w;
    const key = `${s.routine}|${s.attended}|${s.lockdown}|${s.solitaryMinutes}|${NARROW.matches}|${w ? `${w.place}:${w.quota}:${w.of}:${w.paid}` : ''}`;
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
    // Narrow phones: "Canteen · until 10:00" on the second line (the name keeps the first).
    const place = w ? w.place : routinePlace(s.routine);
    const pending = w ? !w.paid : !s.attended;
    setText(this.routinePlace, NARROW.matches && mandatory && pending ? `${place} · ${until}` : place);
    setText(this.routineUntil, until);
    // At work the badge counts the quota (GDD §11), and says PAID once it's done.
    const done = w ? w.paid : s.attended;
    this.badge.className = `hud-badge${mandatory ? '' : ' hidden'}${done ? ' done' : ''}${w && !w.paid ? ' quota' : ''}`;
    this.badge.innerHTML = w ? (w.paid ? `${icon('check', 12)}${t('routine.paid')}` : `${w.quota}/${w.of}`) : s.attended ? `${icon('check', 12)}${t('routine.attended')}` : t('routine.pending');
    // Checked in (or a load done): the badge pops. A new block: the whole pill does.
    const [wasRoutine, wasAttended] = was.split('|');
    const wasWork = was.split('|')[5] ?? '';
    if (was && wasRoutine === String(s.routine) && ((wasAttended === 'false' && s.attended && !w) || (w && wasWork && wasWork !== key.split('|')[5]))) this.badge.classList.add('pop');
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
