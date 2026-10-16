import { buzz } from '../app/haptics';
import { COMMENDATION, DAY_BOOKS, DRILL_HEAT, FEAST_ENERGY, MUSTER_MINUTES, WEATHER_SIGHT, type DayEvent, type Weather } from '../content/days';
import { t, type Key } from '../i18n';
import type { Sim, SimEvent } from '../sim/Sim';
import { dayMinute, dayRoll, eventOn, planOf, TODAY, today, weatherNow, type DayPlan } from '../sim/systems/calendar';
import { STEPS_PER_MINUTE, UNIT } from '../sim/tuning';
import { LAYER } from '../sim/world/World';
import type { HudState } from '../ui/hud';
import type { PaRow } from '../ui/pa';
import { PLAYER } from '../talk/fill';
import { banner, lightningVeil, paBoard, profile, settings, sound, view } from './context';
import { play, type Game } from './game';
import { seenTip } from './tips';

/**
 * The day in play (P17): the warden's speakers (the morning card at 08:00, warnings fifteen
 * minutes ahead, the events starting and ending, the 22:00 forecast, a quip on a quiet
 * afternoon), what the HUD shows of the day (the weather by the clock, the event's chip, the
 * drill in the routine pill), the storm's lightning and thunder, the rain and wind's sound.
 * Nothing here touches the simulation: the plan is the sim's own (calendar.ts), so what the
 * warden says is what happens.
 */

export const EVENT_ICON: Record<DayEvent, string> = { none: 'calendar', inspection: 'clipboard', drill: 'siren', feast: 'utensils', maintenance: 'wrench', movie: 'film', foodFight: 'splash' };
export const EVENT_COLOR: Record<DayEvent, string> = { none: '#8aa0b8', inspection: '#5fa8e8', drill: '#ff7a1a', feast: '#e2a21b', maintenance: '#f0b429', movie: '#a77bff', foodFight: '#ff5f6d' };
/** The weather as it's named and drawn: in the snow (Stalag Flucht) a clear day snows, a storm is a blizzard. */
type WeatherName = Weather | 'snow' | 'blizzard';
const WX_ICON: Record<WeatherName, string> = { clear: 'sun', snow: 'snow', fog: 'fog', rain: 'rain', storm: 'storm', blizzard: 'storm', heatwave: 'heat' };
const WX_COLOR: Record<WeatherName, string> = { clear: '#ffd76a', snow: '#e6f3ff', fog: '#cfd8e2', rain: '#8cc8ff', storm: '#b8a8ff', blizzard: '#cfe6ff', heatwave: '#ffb35a' };
/** Events the warden warns of fifteen minutes ahead (the drill is a surprise; a food fight just happens). */
const WARNED: ReadonlySet<DayEvent> = new Set(['inspection', 'feast', 'maintenance', 'movie']);
const WARN_AHEAD = 15;
/** 22:00: tomorrow's forecast; 14:30: a quip on a quiet afternoon (minutes into the prison day). */
const FORECAST_AT = 14 * 60;
const QUIP_AT = 6 * 60 + 30;
const QUIPS = 3;

/** "10:00" for a minute into the prison day. */
export function dayTime(dayMin: number): string {
  const m = (dayMin + 8 * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const cold = (sim: Sim) => !!sim.world.def.rules?.cold;
/** How the weather is named in this prison. */
export function weatherName(sim: Sim, w: Weather): WeatherName {
  if (cold(sim)) return w === 'clear' ? 'snow' : w === 'storm' ? 'blizzard' : w;
  return w;
}

/** Whether a prison has days at all (the Training Block doesn't), and the game isn't a lesson. */
const hasDays = (g: Game | null): g is Game => !!g && !g.lesson && !!DAY_BOOKS[g.rec.sim.prison.id];

export const wardenOf = (sim: Sim) => t(`warden.${sim.prison.id}` as Key);

/** When an event happens, as the card and the file say it. */
function whenOf(p: DayPlan): string {
  if (p.event === 'none') return '';
  if (p.event === 'drill') return t('day.whenBell');
  if (p.event === 'foodFight') return t('day.whenMeal');
  return t('day.when', { from: dayTime(p.at), to: dayTime(p.until) });
}

/** The day's two rows (its event, its weather), as the morning card and the file show them. */
export function dayRows(sim: Sim, p: DayPlan, forecast = false, inFile = false): PaRow[] {
  // Over for today (the file, after it): said so. A food fight isn't announced (a rowdy canteen) until it happens.
  const past = !forecast && p.event !== 'none' && today(sim).day === p.day && dayMinute(sim.state.step) >= p.until;
  const ev = p.event === 'foodFight' && !past ? 'rowdy' : p.event;
  const sub = (() => {
    if (past) return t('day.eventD.over');
    if (p.event === 'drill' && forecast) return t('day.eventD.drillAhead', { n: MUSTER_MINUTES, heat: DRILL_HEAT });
    switch (p.event) {
      case 'inspection':
        return t('day.eventD.inspection', { n: COMMENDATION });
      case 'drill':
        return t('day.eventD.drill', { n: MUSTER_MINUTES, heat: DRILL_HEAT });
      case 'feast':
        return t('day.eventD.feast', { n: FEAST_ENERGY });
      case 'maintenance':
        return t('day.eventD.maintenance', { from: dayTime(p.at), to: dayTime(p.until) });
      default:
        return t(`day.eventD.${ev}` as Key);
    }
  })();
  const w = weatherName(sim, p.weather);
  return [
    { icon: EVENT_ICON[p.event], color: EVENT_COLOR[p.event], label: t(inFile ? 'pa.event' : forecast ? 'profile.tomorrow' : 'pa.today'), title: t(`day.event.${ev}` as Key), when: ev === 'rowdy' ? '' : whenOf(p), sub },
    { icon: WX_ICON[w], color: WX_COLOR[w], label: t('pa.weather'), title: t(`weather.${w}` as Key), when: '', note: t(`windForce.${p.windForce}` as Key, { dir: t(`wind.${p.wind}` as Key) }), sub: t(`weatherD.${w}` as Key, { n: WEATHER_SIGHT[p.weather] ?? 7 }) },
  ];
}

// ------------------------------------------------------------------ the warden's speakers

/** A line over the speakers (not with the announcements off; never in your sleep). */
function say(sim: Sim, text: string) {
  if (settings.pa === 'off' || sim.state.sleeping) return;
  paBoard.say(wardenOf(sim), text);
}

/** The morning card (or its short line): the day's greeting, what's on, the weather. */
function morning(sim: Sim, first: boolean) {
  if (settings.pa === 'off' || sim.state.sleeping) return;
  const p = today(sim);
  const id = sim.prison.id;
  const what = t(`pa.morning.${p.event}` as Key, { time: dayTime(p.at), from: dayTime(p.at), to: dayTime(p.until) });
  const sky = t(`pa.weatherSay.${weatherName(sim, p.weather)}` as Key);
  if (settings.pa === 'short') {
    paBoard.say(wardenOf(sim), `${what} ${sky}`);
    return;
  }
  const hello = first ? t(`pa.first.${id}` as Key) : t(`pa.hello.${id}.${p.mood}` as Key);
  paBoard.morning(t('pa.from', { name: wardenOf(sim), n: p.day }), `${hello} ${what}`, dayRows(sim, p));
}

/** A game begins: a new one's first morning (after the bell, once the first day's guide has been seen; the guide has the stage before). */
export function dayStart(sim: Sim, fresh: boolean) {
  paBoard.clear();
  forecastDay = 0;
  bolt = 6 + Math.random() * 8;
  const g = play.game;
  if (!hasDays(g) || !fresh || !seenTip('guide')) return;
  paBoard.whenClear(() => play.game === g && morning(sim, true));
}

export function dayStop() {
  paBoard.clear();
  sound.setWeather(0, 0);
}

/** After each step: the clock's own announcements (warnings, the forecast, a quip), on the minute. */
export function dayStep(sim: Sim) {
  const g = play.game;
  const st = sim.state;
  if (!hasDays(g) || st.step % STEPS_PER_MINUTE !== 0 || st.sleeping || g.over) return;
  const m = dayMinute(st.step);
  const p = today(sim);
  if (WARNED.has(p.event) && m === p.at - WARN_AHEAD) say(sim, t(`pa.warn.${p.event}` as Key));
  if (m === FORECAST_AT) {
    const next = planOf(sim, p.day + 1);
    const sky = t(`weather.${weatherName(sim, next.weather)}` as Key).toLocaleLowerCase();
    say(sim, t('pa.forecast', { weather: sky, event: next.event === 'none' ? t('pa.forecastNone') : t(`pa.forecastEvent.${next.event}` as Key) }));
    forecastDay = next.day;
  }
  if (m === QUIP_AT && p.day > 1 && (p.event === 'none' || p.event === 'feast')) say(sim, t(`pa.quip.${sim.prison.id}.${Math.floor(dayRoll(st.salt, p.day, 7) * QUIPS)}` as Key));
}

/** The day the warden last forecast (the file shows it as "tomorrow" from then on). */
let forecastDay = 0;

/** What the simulation reports, the day's side of it: the morning, the events, the storm's power cuts. */
export function dayEvent(e: SimEvent, sim: Sim) {
  const g = play.game;
  if (!hasDays(g)) return;
  switch (e.type) {
    case 'day':
      paBoard.whenClear(() => play.game === g && morning(sim, false));
      break;
    case 'today': {
      const p = today(sim);
      if (e.phase === 'start') {
        if (e.event === 'drill') {
          sound.drillBell();
          buzz('lockdown');
          banner.show(t('banner.drill'), t('banner.drillSub', { n: MUSTER_MINUTES }), 'alarm', 4200);
        } else if (e.event === 'foodFight') {
          sound.crowd();
          buzz('giveWay');
          banner.show(t('banner.foodFight'), t('banner.foodFightSub'), 'routine', 3800);
          say(sim, t('pa.start.foodFight'));
        } else say(sim, t(`pa.start.${e.event}` as Key, { time: dayTime(p.until) }));
      } else if (e.phase === 'end') {
        if (e.event !== 'feast') say(sim, t(`pa.end.${e.event}` as Key));
      } else if (e.phase === 'muster') {
        sound.chime();
        buzz('attended');
        banner.toast(t('toast.mustered'), 'good');
      } else if (e.phase === 'missed') {
        sound.sting();
        buzz('missed');
        banner.toast(t('toast.drillMissed', { n: DRILL_HEAT }), 'bad', 4500);
        say(sim, t('pa.drillMissed'));
      } else if (e.phase === 'commend') {
        buzz('attended');
        banner.toast(t('toast.commend', { n: COMMENDATION }), 'good', 4500);
        say(sim, t('pa.commend', { name: PLAYER.name || t('pa.someone') }));
      }
      break;
    }
    case 'power':
      if (!e.on && e.by === 'storm' && e.gen !== 1) {
        // Lightning (a blizzard just takes the power: no bolt in the snow); none seen asleep or underground.
        if (!cold(sim) && !sim.state.sleeping && sim.state.layer !== LAYER.UNDER) strike(1);
        say(sim, t(cold(sim) ? 'pa.outageCold' : 'pa.outage'));
      }
      break;
  }
}

// ------------------------------------------------------------------ lightning, rain and wind

/** Seconds to the next bolt in a storm. */
let bolt = 8;

/** A bolt of lightning: the flash (not with reduced motion), and thunder, later the further it is. */
function strike(near: number) {
  view.lightning();
  if (!settings.reducedMotion) {
    lightningVeil.classList.remove('on');
    void lightningVeil.offsetWidth;
    lightningVeil.classList.add('on');
  }
  window.setTimeout(() => sound.thunder(near), (1 - near) * 2200 + 120);
}

/** Each frame: the storm's bolts, the rain and the wind's sound. */
export function dayFrame(g: Game, dt: number, quiet: boolean) {
  const sim = g.rec.sim;
  // Announcements switched off: whatever the warden was saying stops.
  if (settings.pa === 'off' && paBoard.up) paBoard.clear();
  if (!hasDays(g)) {
    sound.setWeather(0, 0);
    return;
  }
  const p = today(sim);
  const now = weatherNow(sim);
  const below = sim.state.layer === LAYER.UNDER;
  // Asleep the night races by: no bolts, no rain on the roof to hear.
  const live = !quiet && !g.paused && !sim.state.sleeping;
  if (now === 'storm' && !cold(sim) && live && !below && (bolt -= dt) <= 0) {
    bolt = 7 + Math.random() * 16;
    strike(Math.random());
  }
  const storm = now === 'storm';
  const rain = cold(sim) ? 0 : storm ? 1 : now === 'rain' ? 0.6 : 0;
  const wind = storm ? (cold(sim) ? 1 : 0.75) : now === 'fog' ? 0 : p.windForce / 4;
  sound.setWeather(live ? rain : 0, live ? wind : 0);
}

/** Food landing in a food fight: a splat, quieter the further from the player (a few a second at most). */
let splatAt = 0;
view.onSplat = (x, z) => {
  const g = play.game;
  const now = performance.now();
  if (!g || now - splatAt < 140) return;
  splatAt = now;
  const p = g.rec.sim.state.player;
  const d = Math.hypot(x - p.x / UNIT, z - p.z / UNIT);
  if (d < 14) sound.splat(1 - d / 14);
};

// ------------------------------------------------------------------ the HUD

const weatherHud = { icon: '', name: '', color: '' };
const todayHud = { icon: '', color: '', text: '', time: '', soon: false, left: null as number | null, of: MUSTER_MINUTES };
const drillHud = { mustered: false, missed: false };

/** The day's part of the HUD: the weather by the clock, the event's chip, the drill. */
export function dayHud(sim: Sim, hud: HudState, a: number) {
  const g = play.game;
  if (!hasDays(g)) {
    weatherHud.icon = '';
    hud.weather = weatherHud;
    hud.today = null;
    hud.drill = null;
    return;
  }
  const p = today(sim);
  const st = sim.state;
  // The weather that holds now (the fog only while it lies thick).
  const w = weatherName(sim, weatherNow(sim));
  // A clear day shows nothing beside the clock (the sun or moon is there already).
  weatherHud.icon = w === 'clear' ? '' : WX_ICON[w];
  weatherHud.name = t(`weather.${w}` as Key);
  weatherHud.color = WX_COLOR[w];
  hud.weather = weatherHud;
  const m = dayMinute(st.step);
  hud.drill = null;
  hud.today = null;
  if (p.event === 'none') return;
  const name = t(`day.event.${p.event}` as Key);
  todayHud.icon = EVENT_ICON[p.event];
  todayHud.color = EVENT_COLOR[p.event];
  todayHud.left = null;
  if (p.event === 'drill' && eventOn(sim, 'drill')) {
    const mustered = (st.eventFlags & TODAY.MUSTERED) !== 0;
    // Excused (out cold, in solitary, a lockdown at any point of the muster): no countdown, no pending badge.
    const excused = st.lockdown || st.solitary > 0 || st.ko > 0 || (st.eventFlags & TODAY.EXCUSED) !== 0;
    drillHud.mustered = mustered;
    drillHud.missed = (st.eventFlags & TODAY.MISSED_DRILL) !== 0;
    hud.drill = excused && !mustered ? null : drillHud;
    // Until the muster closes: its seconds draining (a game minute is a second).
    const close = (p.at + MUSTER_MINUTES) * STEPS_PER_MINUTE;
    const into = (st.step % (1440 * STEPS_PER_MINUTE)) + a;
    if (!mustered && !excused && into < close && !drillHud.missed) {
      todayHud.text = t('today.muster');
      todayHud.left = (close - into) / STEPS_PER_MINUTE;
      todayHud.of = MUSTER_MINUTES;
      todayHud.time = '';
      todayHud.soon = false;
    } else {
      todayHud.text = name;
      todayHud.time = t('today.until', { time: dayTime(p.until) });
      todayHud.soon = false;
    }
    hud.today = todayHud;
    return;
  }
  if (WARNED.has(p.event) && m >= p.at - WARN_AHEAD && m < p.at) {
    todayHud.text = name;
    todayHud.time = t('today.at', { time: dayTime(p.at) });
    todayHud.soon = true;
    hud.today = todayHud;
    return;
  }
  if (m >= p.at && m < p.until && p.event !== 'drill') {
    todayHud.text = name;
    todayHud.time = t('today.until', { time: dayTime(p.until) });
    todayHud.soon = false;
    hud.today = todayHud;
  }
}

// ------------------------------------------------------------------ the file

/** The file's Today (and Tomorrow, once the warden has forecast it). */
profile.day = () => {
  const g = play.game;
  if (!hasDays(g)) return null;
  const sim = g.rec.sim;
  const p = today(sim);
  const st = sim.state;
  const notes: string[] = [];
  if (st.eventFlags & TODAY.MUSTERED) notes.push(t('profile.mustered'));
  if (st.eventFlags & TODAY.COMMENDED) notes.push(t('profile.commended'));
  const tomorrow = forecastDay === p.day + 1 ? dayRows(sim, planOf(sim, p.day + 1), true, true) : null;
  return { day: p.day, today: dayRows(sim, p, false, true), tomorrow, notes, key: `${p.day}|${tomorrow ? 1 : 0}|${st.eventFlags}|${dayMinute(st.step) >= p.at}` };
};

