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
  /** The cold (P9, GDD §4.2): how far it has built up (0–1; null: warm), seconds until it bites, and whether it has (energy costs double); `hot`: a heatwave's sun instead (P17). */
  cold: { built: number; left: number; bit: boolean; warming: boolean; hot: boolean } | null;
  /** A guard bribed to look the other way (P15): who, until when, game minutes left of it, out of how many (null: none). */
  bribe: { name: string; until: string; left: number; of: number } | null;
  /** The day (P17): the weather's icon by the clock (its name for the tooltip), and the day's event chip (null: nothing to show). */
  weather: { icon: string; name: string; color: string };
  today: { icon: string; color: string; text: string; time: string; soon: boolean; left: number | null; of: number; sr: string } | null;
  /** The fire drill (P17): the routine pill says so until it's over; whether the player has mustered. */
  drill: { mustered: boolean; missed: boolean } | null;
  /** Guard dogs (P19): one close by would smell the contraband in the hotbar ('nose'), one is on the player's trail ('track'); null neither. */
  dog: 'nose' | 'track' | null;
  /** The pet rat (P20): its name, what it's doing ('' on the shoulder), out on an errand or loose, and the seconds left of a panic (null none) out of how many. */
  rat: { name: string; status: string; busy: boolean; left: number | null; of: number; usable: boolean } | null;
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
  private shownDog: HudState['dog'] = null;
  private readonly paw: HTMLElement;
  private readonly pawSr: HTMLElement;
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
        <span class="pill big hud-clock"><i class="hud-sky"></i><span class="hud-day"></span><b class="hud-time"></b><i class="hud-wx" role="img"></i></span>
        <span class="pill big hud-zone">${icon('pin', 16)}<span></span></span>
        <button class="pill big hud-cash">${icon('coin', 16)}<b></b></button>
        <button class="icon-btn hud-pause" aria-label="${t('hud.pause')}">${icon('pause')}</button>
      </div>
      <div class="hud-row">
        <span class="pill big hud-routine"><i class="hud-routine-ic"></i><span class="hud-routine-text"><span class="hud-routine-head"><b></b><small></small></span><span class="hud-routine-place"></span></span><em class="hud-badge"></em></span>
        <span class="pill big hud-heat" aria-label="${t('hud.heat')}">${icon('flame', 16)}<i class="hud-heat-bar"><i></i></i><b></b><span class="hud-eye" title="${t('hud.seen')}">${icon('eye', 16)}</span><span class="hud-paw" role="img">${icon('paw', 16)}</span><span class="sr-only hud-paw-sr" role="status"></span></span>
      </div>
      <div class="hud-row hud-alerts">
        <span class="pill hud-alert hud-power hidden" role="status">${icon('plug', 15)}<span></span><b></b><i class="hud-alert-bar"><i></i></i></span>
        <span class="pill hud-alert hud-riot hidden" role="status">${icon('users', 15)}<span></span><b></b><i class="hud-alert-bar"><i></i></i></span>
        <span class="pill hud-alert hud-bribe hidden">${icon('eyeOff', 15)}<span role="status"></span><b></b><i class="hud-alert-bar" aria-hidden="true"><i></i></i></span>
        <span class="pill hud-alert hud-cold hidden"><i class="hud-cold-ic">${icon('snow', 15)}</i><span role="status"></span><b aria-hidden="true"></b><i class="hud-alert-bar" aria-hidden="true"><i></i></i></span>
        <span class="pill hud-alert hud-today hidden"><i class="hud-today-ic"></i><span aria-hidden="true"></span><b aria-hidden="true"></b><span class="sr-only" role="status"></span><i class="hud-alert-bar" aria-hidden="true"><i></i></i></span>
        <button class="pill hud-alert hud-rat hidden">${icon('rat', 15)}<span></span><b></b><i class="hud-alert-bar" aria-hidden="true"><i></i></i></button>
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
    this.paw = q('.hud-paw');
    this.pawSr = q('.hud-paw-sr');
    for (const el of [this.zonePill, this.badge, this.heatPill, this.routinePill]) el.addEventListener('animationend', () => el.classList.remove('pulse', 'pop', 'bump'));
    q('.hud-pause').addEventListener('click', onPause);
    this.cashPill = q('.hud-cash');
    this.cashText = q('.hud-cash b');
    this.cashPill.addEventListener('click', onProfile);
    this.cashPill.addEventListener('animationend', () => this.cashPill.classList.remove('gain', 'spend'));
    this.power = q('.hud-power');
    this.riot = q('.hud-riot');
    this.cold = q('.hud-cold');
    this.bribe = q('.hud-bribe');
    this.today = q('.hud-today');
    this.rat = q('.hud-rat');
    this.rat.addEventListener('click', () => this.onRat());
    this.wx = q('.hud-wx');
    document.body.append(this.el);
  }

  private readonly bribe: HTMLElement;
  private readonly power: HTMLElement;
  private readonly riot: HTMLElement;
  private readonly cold: HTMLElement;
  private readonly today: HTMLElement;
  private readonly rat: HTMLElement;
  /** The rat pill tapped (P20): its panel. */
  onRat: () => void = () => {};
  private readonly wx: HTMLElement;
  private shownAlerts = '';
  private shownWx = '';
  private coldIcon = 'snow';
  private todayIcon = '';

  /** A chip under the rows while something runs out: its label, the seconds left and a bar draining from full. */
  private alert(el: HTMLElement, label: Key, left: number | null, total: number) {
    el.classList.toggle('hidden', left === null);
    if (left === null) return;
    setText(el.querySelector('span')!, t(label));
    setText(el.querySelector('b')!, `0:${String(Math.max(0, Math.ceil(left))).padStart(2, '0')}`);
    (el.querySelector('.hud-alert-bar i') as HTMLElement).style.width = `${Math.max(0, Math.min(1, left / total)) * 100}%`;
    el.classList.toggle('low', left <= 10);
  }

  /** A guard looking the other way (P15): who, until when (the clock's time), the bar for what's left. */
  private lookAway(b: HudState['bribe']) {
    const el = this.bribe;
    el.classList.toggle('hidden', !b);
    if (!b) return;
    setText(el.querySelector('span')!, t('hud.bribe', { name: b.name }));
    setText(el.querySelector('b')!, t('hud.bribeUntil', { time: b.until }));
    (el.querySelector('.hud-alert-bar i') as HTMLElement).style.width = `${Math.max(0, Math.min(1, b.left / b.of)) * 100}%`;
    el.classList.toggle('low', b.left <= 15);
  }

  /** The cold's chip: the bar fills as it builds, the seconds until it bites; then "Frozen" until warm again. A heatwave's (P17): "Hot", "Baked", "Cooling down". */
  private chill(c: HudState['cold']) {
    const el = this.cold;
    el.classList.toggle('hidden', !c);
    if (!c) return;
    el.classList.toggle('bit', c.bit);
    el.classList.toggle('warming', c.warming);
    el.classList.toggle('hot', c.hot);
    const ic = c.hot ? 'heat' : 'snow';
    if (ic !== this.coldIcon) {
      this.coldIcon = ic;
      el.querySelector('.hud-cold-ic')!.innerHTML = icon(ic, 15);
    }
    setText(el.querySelector('span')!, t(c.hot ? (c.bit ? 'hud.baked' : c.warming ? 'hud.cooling' : 'hud.hot') : c.bit ? 'hud.frozen' : c.warming ? 'hud.warming' : 'hud.cold'));
    setText(el.querySelector('b')!, c.bit ? '×2' : c.warming ? '' : `0:${String(Math.min(59, Math.max(0, Math.ceil(c.left)))).padStart(2, '0')}`);
    (el.querySelector('.hud-alert-bar i') as HTMLElement).style.width = `${Math.max(0, Math.min(1, c.built)) * 100}%`;
  }

  /** The pet rat's pill (P20): its name and what it's up to; a bar draining while it runs loose. Tapped, its panel. */
  private ratChip(r: HudState['rat']) {
    const el = this.rat;
    el.classList.toggle('hidden', !r);
    if (!r) return;
    el.classList.toggle('busy', r.busy);
    (el as HTMLButtonElement).disabled = !r.usable;
    setText(el.querySelector('span')!, r.name);
    setText(el.querySelector('b')!, r.left === null ? r.status : `${r.status} 0:${String(Math.ceil(r.left)).padStart(2, '0')}`);
    const bar = el.querySelector<HTMLElement>('.hud-alert-bar')!;
    bar.style.display = r.left === null ? 'none' : '';
    if (r.left !== null) (bar.firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(1, r.left / r.of)) * 100}%`;
    el.title = TOUCH ? t('hud.rat') : `${t('hud.rat')} (T)`;
    el.setAttribute('aria-label', `${r.name}${r.status ? `, ${r.status}` : ''}. ${t('hud.rat')}`);
  }

  /** The day's chip (P17): what's on or coming, its time; the drill's muster draining. */
  private dayChip(d: HudState['today']) {
    const el = this.today;
    el.classList.toggle('hidden', !d);
    if (!d) return;
    el.classList.toggle('soon', d.soon);
    el.style.setProperty('--c', d.color);
    if (d.icon !== this.todayIcon) {
      this.todayIcon = d.icon;
      el.querySelector('.hud-today-ic')!.innerHTML = icon(d.icon, 15);
    }
    setText(el.querySelector('span')!, d.text);
    // The screen reader hears the whole phrase, once (never the countdown's seconds).
    setText(el.querySelector('.sr-only')!, d.sr);
    setText(el.querySelector('b')!, d.left === null ? d.time : `${Math.floor(d.left / 60)}:${String(Math.max(0, Math.ceil(d.left % 60))).padStart(2, '0')}`);
    const bar = el.querySelector<HTMLElement>('.hud-alert-bar')!;
    bar.style.display = d.left === null ? 'none' : '';
    if (d.left !== null) (bar.firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(1, d.left / d.of)) * 100}%`;
    el.classList.toggle('low', d.left !== null && d.left <= 5);
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
    if (!on) return;
    this.shownWx = '';
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
    // The weather by the clock (P17).
    const wx = `${s.weather.icon}|${s.weather.name}`;
    if (wx !== this.shownWx) {
      this.shownWx = wx;
      this.wx.innerHTML = s.weather.icon ? icon(s.weather.icon, 15) : '';
      this.wx.style.setProperty('--wx', s.weather.color);
      this.wx.setAttribute('aria-label', t('hud.weather', { weather: s.weather.name }));
      this.wx.title = t('hud.weather', { weather: s.weather.name });
    }
    this.updateRoutine(s);
    this.updateHeat(s.heat);
    const c = s.cold;
    const d = s.today;
    const alerts = `${s.powerLeft === null ? '' : Math.ceil(s.powerLeft)}:${s.powerKey}|${s.takeoverLeft === null ? '' : Math.ceil(s.takeoverLeft)}|${c ? `${Math.round(c.built * 40)}:${Math.ceil(c.left)}:${c.bit}:${c.warming}:${c.hot}` : ''}|${s.bribe ? `${s.bribe.name}:${s.bribe.left}` : ''}|${d ? `${d.icon}:${d.text}:${d.time}:${d.soon}:${d.left === null ? '' : Math.ceil(d.left)}` : ''}|${s.rat ? `${s.rat.name}:${s.rat.status}:${s.rat.left === null ? '' : Math.ceil(s.rat.left)}:${s.rat.usable}` : ''}|${this.lang}`;
    if (alerts !== this.shownAlerts) {
      this.shownAlerts = alerts;
      this.alert(this.power, s.powerKey, s.powerLeft, 45);
      this.alert(this.riot, 'hud.gatesOpen', s.takeoverLeft, 30);
      this.chill(c);
      this.lookAway(s.bribe);
      this.dayChip(d);
      this.ratChip(s.rat);
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
    // The paw (P19): a dog close by would smell the contraband on you; a dog on your trail.
    if (s.dog !== this.shownDog) {
      this.shownDog = s.dog;
      this.paw.dataset.dog = s.dog ?? '';
      const say = s.dog ? t(s.dog === 'nose' ? 'hud.dogNose' : 'hud.dogTrack') : '';
      this.paw.title = say;
      this.paw.setAttribute('aria-label', say);
      // (Said to a screen reader as it comes on.)
      this.pawSr.textContent = say;
      if (s.dog) this.heatPill.classList.add('bump');
    }
  }

  private updateRoutine(s: HudState) {
    const w = s.work;
    const mandatory = ROUTINE[s.routine].zones.length > 0 || !!w;
    const key = `${s.routine}|${s.attended}|${s.lockdown}|${s.solitaryMinutes}|${NARROW.matches}|${w ? `${w.place}:${w.quota}:${w.of}:${w.paid}` : ''}|${s.drill ? (s.drill.missed ? 'missed' : s.drill.mustered) : ''}`;
    if (key === this.shownKey) return;
    const was = this.shownKey;
    this.shownKey = key;
    this.routinePill.classList.toggle('alarm', s.lockdown);
    this.routinePill.classList.toggle('solitary', s.solitaryMinutes !== null);
    this.routinePill.classList.toggle('drill', !!s.drill && !s.lockdown && s.solitaryMinutes === null);
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
    // The fire drill (P17): out to roll call, the badge says whether the player has mustered.
    if (s.drill) {
      this.routineIcon.innerHTML = icon('siren', 16);
      setText(this.routineName, t('routine.drill'));
      setText(this.routinePlace, t('zone.rollCall'));
      setText(this.routineUntil, '');
      this.badge.className = `hud-badge${s.drill.mustered ? ' done' : s.drill.missed ? ' missed' : ''}`;
      this.badge.innerHTML = s.drill.mustered ? `${icon('check', 12)}${t('routine.mustered')}` : s.drill.missed ? t('routine.drillMissed') : t('routine.pending');
      const wasDrill = was.split('|')[6] ?? '';
      if (was && wasDrill === '') this.routinePill.classList.add('pulse');
      else if (wasDrill === 'false' && s.drill.mustered) this.badge.classList.add('pop');
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
