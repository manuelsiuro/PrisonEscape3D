import { BETS, RACE_MINUTE, RACE_STEPS } from '../content/long';
import { BLOCK, ROUTINE, routineAt, routineEnd } from '../content/routine';
import { DRILL_HEAT } from '../content/days';
import { t, type Key } from '../i18n';
import { dayMinute, formatTime } from '../sim/systems/clock';
import { planOf, TODAY, today } from '../sim/systems/calendar';
import { jobRooms } from '../sim/systems/economy';
import { cardMinute, RACE, raceNight, trackOf } from '../sim/systems/races';
import { petOf } from '../sim/systems/rats';
import { MISSED_ROUTINE_HEAT, STEPS_PER_MINUTE } from '../sim/tuning';
import { prisonDay } from '../sim/systems/clock';
import { routineName, routinePlace } from '../ui/hud';
import { prisonName } from '../ui/screens/prisons';
import { showDay, type DayBlock, type DayChip, type DayPin, type DayView } from '../ui/screens/day';
import { click, controls, tools } from './context';
import { dayRows, dayTime, EVENT_COLOR, eventIcon, FORECAST_AT, hasDays, whenOf } from './day';
import { play, type Game } from './game';
import { ratName } from './rat';
import { shootKey } from './pastimes';
import { kickKey } from './team';
import { HEARING_FROM, HEARING_TO } from '../content/parole';
import { P } from '../sim/systems/parole';
import { roomOf } from './parole';
import { HOLIDAY_DAY } from '../content/holidays';
import { holidayDays } from '../sim/systems/holiday';

/** The parole board's colour (P39: its help topic's). */
const PAROLE_COLOR = '#8a6bd1';
/** Race night's colour on the card (the race's own help topic's). */
const RACE_COLOR = '#d9773a';
/** The player's pet's name (its own, given when tamed). */
const petName = (g: Game) => ratName(g.rec.sim);

/** Each block's icon down the card's line. */
const BLOCK_ICON: Record<string, string> = {
  rollCall: 'bell',
  breakfast: 'utensils',
  freeTime: 'walk',
  work: 'briefcase',
  exercise: 'dumbbell',
  showers: 'drop',
  dinner: 'utensils',
  eveningFreeTime: 'walk',
  eveningRollCall: 'bell',
  lightsOut: 'moon',
};

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** "27 min left", "3 h 05 left". */
const leftOf = (n: number) => (n < 60 ? t('dayCard.left', { n }) : t('dayCard.leftH', { h: Math.floor(n / 60), m: String(n % 60).padStart(2, '0') }));

/** The block a minute into the prison day falls in. */
const blockOf = (dayMin: number) => routineAt((dayMin + 8 * 60) % 1440);

/** The day as the card shows it: what's on, the routine block by block, how it has gone so far. */
function dayView(g: Game): DayView {
  const sim = g.rec.sim;
  const st = sim.state;
  const days = hasDays(g);
  // (The Training Block's rules are relaxed: nothing missed there costs anything.)
  const stakes = !sim.world.def.rules?.relaxed;
  const mod = sim.clock.minuteOfDay;
  const night = mod >= 21 * 60 || mod < 6 * 60;
  const chips: DayChip[] = [];
  const pins = new Map<number, DayPin[]>();
  let tomorrow: DayView['tomorrow'] = null;
  if (days) {
    const p = today(sim);
    const m = dayMinute(st.step);
    const [ev, wx, ...hol] = dayRows(sim, p, false, true);
    chips.push({ icon: ev.icon, color: ev.color, text: ev.title, when: ev.when }, { icon: wx.icon, color: wx.color, text: wx.title, when: '' });
    // (P42: the holiday's own day, a chip and a pin where it falls.)
    holidayDays(sim, p.day).forEach((id, k) => {
      const r = hol[k];
      if (!r) return;
      chips.push({ icon: r.icon, color: r.color, text: r.title, when: r.when });
      const d = HOLIDAY_DAY[id];
      const over = m >= d.at + d.length;
      const pin: DayPin = { icon: r.icon, color: r.color, title: r.title, when: r.when, sub: r.sub, over, tag: '', tagTone: '' };
      const at = blockOf(d.at);
      pins.set(at, [...(pins.get(at) ?? []), pin]);
    });
    // The event where it falls (the drill once its bell has rung, a food fight once it has broken out: neither is said before).
    const begun = m >= p.at;
    if (p.event !== 'none' && (begun || (p.event !== 'drill' && p.event !== 'foodFight'))) {
      const over = m >= p.until;
      const pin: DayPin = { icon: eventIcon(sim, p.event), color: EVENT_COLOR[p.event], title: ev.title, when: p.event === 'drill' ? t('day.rang', { time: dayTime(p.at) }) : whenOf(p), sub: over ? t('day.eventD.over') : ev.sub, over, tag: '', tagTone: '' };
      if (p.event === 'drill') {
        if (st.eventFlags & TODAY.MUSTERED) Object.assign(pin, { tag: t('routine.mustered'), tagTone: 'ok' });
        else if (st.eventFlags & TODAY.MISSED_DRILL) Object.assign(pin, { tag: t('dayCard.missedHeat', { n: DRILL_HEAT }), tagTone: 'bad' });
        else if (st.eventFlags & TODAY.EXCUSED) Object.assign(pin, { tag: t('dayCard.excused'), tagTone: 'quiet' });
      }
      if (p.event === 'foodFight') pin.when = t('day.when', { from: dayTime(p.at), to: dayTime(p.until) });
      pins.set(blockOf(p.at), [pin]);
    }
    // Tomorrow, once the warden has forecast it (22:00).
    if (m >= FORECAST_AT) {
      const next = dayRows(sim, planOf(sim, p.day + 1), true, true);
      tomorrow = { label: t(sim.clock.day !== p.day ? 'profile.fromMorning' : 'profile.tomorrow'), chips: next.map((r) => ({ icon: r.icon, color: r.color, text: r.title, when: r.when })) };
    }
  }
  // Race night (odd nights, at a prison with a rat track): a chip, and the card's hours pinned in the evening (with the player's bet, their rat entered).
  const track = !!trackOf(sim.world);
  const pd = prisonDay(st.step);
  if (track && raceNight(pd)) {
    const m = mod;
    const from = cardMinute(sim);
    const r = st.race[RACE.DAY] === pd ? st.race : null;
    const over = m >= RACE_MINUTE + Math.ceil(RACE_STEPS / STEPS_PER_MINUTE) || m < 8 * 60;
    // (Nothing else on: the race in its place, never "Nothing on" beside it.)
    if (days && today(sim).event === 'none') chips.shift();
    chips.push({ icon: 'race', color: RACE_COLOR, text: t('dayCard.race'), when: hhmm(RACE_MINUTE) });
    const bet = r && r[RACE.LANE] >= 0 ? t('dayCard.raceBet', { n: BETS[r[RACE.STAKE]] ?? 0 }) : '';
    const entered = r && r[RACE.ENTERED] ? t('dayCard.raceEntered', { name: petName(g) }) : '';
    const pin: DayPin = { icon: 'race', color: RACE_COLOR, title: t('dayCard.race'), when: t('day.when', { from: hhmm(from), to: hhmm(RACE_MINUTE) }), sub: over ? t('day.eventD.over') : t(petOf(st) ? 'dayCard.raceSubPet' : 'dayCard.raceSub'), over, tag: [entered, bet].filter(Boolean).join(' · '), tagTone: 'ok' };
    const k = routineAt(from);
    const was = pins.get(k);
    pins.set(k, was ? [...was, pin] : [pin]);
  } else if (track && tomorrow && raceNight(pd + 1)) {
    if (planOf(sim, today(sim).day + 1).event === 'none') tomorrow.chips.shift();
    tomorrow.chips.push({ icon: 'race', color: RACE_COLOR, text: t('dayCard.race'), when: hhmm(RACE_MINUTE) });
  }
  // The parole hearing (P39): its chip and its hour on the day it sits; tomorrow's, once tomorrow is told.
  const hearing = st.parole[P.HEARING];
  if (hearing && hearing === pd) {
    const m = dayMinute(st.step);
    const over = m >= HEARING_TO && !st.hearing;
    chips.push({ icon: 'scale', color: PAROLE_COLOR, text: t('dayCard.hearing'), when: dayTime(HEARING_FROM) });
    const pin: DayPin = { icon: 'scale', color: PAROLE_COLOR, title: t('dayCard.hearing'), when: t('day.when', { from: dayTime(HEARING_FROM), to: dayTime(HEARING_TO) }), sub: t('dayCard.hearingSub', { room: roomOf(sim) }), over, tag: st.hearing ? t('dayCard.hearingOn') : '', tagTone: 'ok' };
    const k = blockOf(HEARING_FROM);
    const was = pins.get(k);
    pins.set(k, was ? [...was, pin] : [pin]);
  } else if (hearing && hearing === pd + 1 && tomorrow) tomorrow.chips.push({ icon: 'scale', color: PAROLE_COLOR, text: t('dayCard.hearing'), when: dayTime(HEARING_FROM) });
  const job = sim.jobActive();
  const def = job >= 0 ? jobRooms(sim.world)[job].def : null;
  const blocks = ROUTINE.map((r, k): DayBlock => {
    const at = k < st.routine ? 'past' : k === st.routine ? 'now' : 'next';
    const work = r.id === 'work';
    const cell = r.id === 'lightsOut';
    const b = st.blocks[k];
    // (Work gone by: as it went then, paid, fired or let off; nothing recorded, there was no job that counted.)
    const worked = work && (at === 'past' ? b !== 0 : !!def);
    const must = !!r.miss || worked || cell;
    let place = routinePlace(k);
    if (work) place = def && worked ? t(`zone.${def.zone}` as Key) : worked ? t('dayCard.firedPlace') : sim.playerJob >= 0 ? t('dayCard.jobTomorrow') : t('dayCard.noJob');
    let tag: DayBlock['tag'] = null;
    if (work && at === 'past') {
      if (b === BLOCK.ATTENDED) tag = { text: t('routine.paid'), tone: 'ok', icon: 'check' };
      else if (b === BLOCK.MISSED) tag = { text: t('dayCard.fired'), tone: 'bad' };
      else if (b === BLOCK.EXCUSED) tag = { text: t('dayCard.excused'), tone: 'quiet' };
    } else if (work && def) {
      if (st.paid) tag = { text: t('routine.paid'), tone: 'ok', icon: 'check' };
      else if (at === 'now') tag = { text: `${st.quota}/${def.quota}`, tone: 'job' };
      else if (at === 'next') tag = { text: t('dayCard.quota', { n: def.quota }), tone: 'job' };
    } else if (cell) {
      tag = at === 'now' && sim.playerZone === 'playerCell' ? { text: t('help.mustCell'), tone: 'ok', icon: 'check' } : { text: t('dayCard.cell'), tone: at === 'now' ? 'warn' : 'quiet' };
    } else if (r.miss) {
      const lock = r.miss === 'lockdown';
      if (at === 'past') {
        if (b === BLOCK.ATTENDED) tag = { text: t('routine.attended'), tone: 'ok', icon: 'check' };
        else if (b === BLOCK.MISSED) tag = { text: lock ? t('dayCard.missedLock') : t('dayCard.missedHeat', { n: MISSED_ROUTINE_HEAT }), tone: 'bad' };
        else if (b === BLOCK.EXCUSED) tag = { text: t('dayCard.excused'), tone: 'quiet' };
      } else if (at === 'now') tag = st.attended ? { text: t('routine.attended'), tone: 'ok', icon: 'check' } : st.excused ? { text: t('dayCard.excused'), tone: 'quiet' } : { text: t('routine.pending'), tone: 'warn' };
      // (In a lockdown the blocks ahead are let off as they come: nothing said of missing them.)
      else if (stakes && !st.lockdown) tag = { text: lock ? t('dayCard.missLock') : t('dayCard.missHeat', { n: MISSED_ROUTINE_HEAT }), tone: lock ? 'bad' : 'warn' };
    }
    const block: DayBlock = { time: hhmm(r.start), icon: BLOCK_ICON[r.id], name: routineName(k), place, at, must, tag, pins: pins.get(k) ?? [] };
    if (at === 'now') {
      const len = (routineEnd(k) - r.start + 1440) % 1440;
      const into = (mod - r.start + 1440) % 1440;
      block.through = into / len;
      block.left = `${t('routine.until', { time: hhmm(routineEnd(k)) })} · ${leftOf(len - into)}`;
    }
    return block;
  });
  let alert: DayView['alert'] = null;
  if (st.lockdown) alert = { icon: 'siren', title: t('routine.lockdown'), sub: `${t('routine.hunted')}. ${t('dayCard.held')}` };
  else if (st.solitary > 0) {
    const left = Math.ceil(st.solitary / STEPS_PER_MINUTE);
    alert = { icon: 'lock', title: t('routine.solitary'), sub: t('routine.solitaryLeft', { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` }) };
  }
  return {
    // (After midnight the prison day runs on to 08:00: its number, as the timeline is its.)
    title: t('hud.day', { n: days ? today(sim).day : sim.clock.day }),
    sub: `${prisonName(sim.prison)} · ${formatTime(sim.clock)}`,
    sky: night ? 'moon' : 'sun',
    chips,
    alert,
    blocks,
    tomorrow,
  };
}

/** The clock in the HUD (or J): the day over the paused game. */
export async function openDay() {
  const g = play.game;
  if (!g || g.paused || g.over || g.replay) return;
  const v = dayView(g);
  click();
  // (A kick or a shot held on Space is let go: its key-up would come while paused.)
  kickKey(false);
  shootKey(false);
  g.paused = true;
  controls.enabled = false;
  controls.reset();
  tools.release();
  await showDay(v, click);
  if (play.game !== g || g.over) return;
  g.paused = false;
  controls.enabled = true;
  play.last = performance.now();
}
