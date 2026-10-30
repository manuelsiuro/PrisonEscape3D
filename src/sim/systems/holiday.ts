/**
 * Holidays (P42, content/holidays.ts): the run's holiday (`state.holiday`, set when the run began,
 * never from the clock) and its days. Each step (`holidays`) starts and ends the holiday's day on
 * the minute: the egg hunt's eggs hidden at 08:00 (in some of the inmates' desks and about the
 * yard) and those not found gone at 22:00 (the yard's and the desks'); the water fight, costume
 * night, Christmas Day and New Year's fireworks. What they change is asked of this module by the other systems: a soaked
 * guard's sight (calendar.ts sightOf), the fireworks' din (muffled), a holiday dinner's feast
 * (feastNow). The rest is on the player's request: a treat taken from the open furniture
 * (`takeTreat`, EXT.HOLIDAY), a pumpkin carved in the kitchen (`carve`), the costume worn on
 * costume night (the inmates laugh, once a night each). The Training Block has none of it.
 */
import { DAY_BOOKS } from '../../content/days';
import { EGG_DESKS, EGG_YARD, HOLIDAY, HOLIDAY_DAY, holidayDaysOn, LAUGH_OPINION, LAUGH_REACH, TREATS, WET_SIGHT, type HolidayDay } from '../../content/holidays';
import { itemNumber } from '../../content/items';
import { floorOf } from '../ai/places';
import { SLOT } from '../command';
import type { SimContext } from '../context';
import { roll, SALT } from '../rng';
import { STEPS_PER_MINUTE, UNIT } from '../tuning';
import { containersOf } from '../world/containers';
import { LAYER, layerOfKey, MAP_W, tileOfKey } from '../world/World';
import { TODAY } from './calendar';
import { dayMinute, prisonDay } from './clock';
import type { Guard } from './guards';
import { DOING } from './inmates';
import { HOTBAR, itemOf, slot, usesOf } from './items';
import { changeOpinion, refuse } from './social';

const CHOC_EGG = itemNumber('choc_egg');
const COSTUME = itemNumber('costume');
const PUMPKIN = itemNumber('pumpkin');
const JACK_LANTERN = itemNumber('jack_lantern');
/** An egg still hidden (its uses bits): found once it's in the player's pockets. */
const HIDDEN = 1;

type HolidaySim = Pick<SimContext, 'prison' | 'state' | 'world'>;

/** The run's holiday here (0 none): only in a prison with days (the campaign's five), never in a lesson's relaxed rules. */
export const holidayOf = (sim: HolidaySim): number => (sim.state.holiday && DAY_BOOKS[sim.prison.id] && !sim.world.def.rules?.relaxed ? sim.state.holiday : 0);

/** The holiday's days on a prison day (today by default). */
export const holidayDays = (sim: HolidaySim, day = prisonDay(sim.state.step)): HolidayDay[] => holidayDaysOn(holidayOf(sim), day);

/** Whether a holiday day is on now (from its start to its end). */
export function holidayNow(sim: HolidaySim, id: HolidayDay): boolean {
  const s = sim.state;
  if (!s.holiday) return false;
  if (!holidayDays(sim).includes(id)) return false;
  const d = HOLIDAY_DAY[id];
  const m = dayMinute(s.step);
  return m >= d.at && m < d.at + d.length;
}

/** Dinner is a holiday's feast today (the lamb roast, the barbecue, Christmas dinner). */
export const holidayFeast = (sim: HolidaySim) => !!sim.state.holiday && holidayDays(sim).some((id) => HOLIDAY_DAY[id].feast);

/** The fireworks are going off (New Year's Eve, 00:00–00:10): every noise is drowned. */
export const fireworksOn = (sim: HolidaySim) => holidayNow(sim, 'newYearsEve');

/** A guard soaked by the water fight: out on the sports ground while it's on. Sees no further than WET_SIGHT. */
export function soaked(sim: SimContext, g: Guard): boolean {
  if (!sim.state.holiday || !holidayNow(sim, 'waterFight')) return false;
  return WATER_ZONES.includes(sim.world.zoneAt(Math.floor(g.body.x / UNIT), Math.floor(g.body.z / UNIT)));
}
/** Where the water fight's hoses reach: the sports ground (every prison has one), where the exercise hour wants the player (routine.ts zonesOf: never the courtyard's). */
const WATER_ZONES: readonly string[] = ['sports'];
export { WET_SIGHT };

/** Each step: the holiday's day starts and ends on the minute; eggs found; the costume's laughs. */
export function holidays(sim: SimContext) {
  const s = sim.state;
  if (!holidayOf(sim)) return;
  if (s.step % STEPS_PER_MINUTE === 0) {
    const m = dayMinute(s.step);
    for (const id of holidayDays(sim)) {
      const d = HOLIDAY_DAY[id];
      if (m === d.at) {
        if (id === 'eggHunt') hideEggs(sim);
        sim.events.push({ type: 'holiday', what: 'start', day: id });
      } else if (m === d.at + d.length) {
        if (id === 'eggHunt') eggsGone(sim);
        sim.events.push({ type: 'holiday', what: 'end', day: id });
      }
    }
  }
  if (s.holiday === HOLIDAY.EASTER) eggsFound(sim);
  if (s.holiday === HOLIDAY.HALLOWEEN && s.step % 10 === 0) laughs(sim);
  if (s.holiday === HOLIDAY.SUMMER && holidayNow(sim, 'waterFight') && !sim.away && s.layer === LAYER.GROUND && WATER_ZONES.includes(sim.playerZone) && !(s.eventFlags & TODAY.SPLASHED)) {
    s.eventFlags |= TODAY.SPLASHED;
    sim.events.push({ type: 'holiday', what: 'splash', day: 'waterFight' });
  }
}

/** 08:00 on the egg hunt's day: an egg in some of the inmates' desks (those with a free slot), and some about the yard. */
function hideEggs(sim: SimContext) {
  const s = sim.state;
  const day = prisonDay(s.step);
  const list = containersOf(sim.world);
  // (Drawn by roll(): the same desks and spots for the same run and day, never a draw from the sim's RNG.)
  const desks = list
    .map((c, k) => ({ c, k, r: roll(s.salt, SALT.EGGS, day, k) }))
    .filter(({ c, k }) => c.table === 'inmateDesk' && s.items.containers[k].slice(c.hidden).includes(0))
    .sort((a, b) => a.r - b.r || a.k - b.k)
    .slice(0, EGG_DESKS);
  let n = 0;
  for (const { c, k } of desks) {
    const box = s.items.containers[k];
    box[box.indexOf(0, c.hidden)] = slot(CHOC_EGG, HIDDEN);
    n++;
  }
  const yard = floorOf(sim.world, ['yard'])
    .map((t) => ({ t, r: roll(s.salt, SALT.EGGS, day, 1000 + t) }))
    .sort((a, b) => a.r - b.r || a.t - b.t)
    .slice(0, EGG_YARD);
  for (const { t } of yard) {
    s.items.ground.push([t, slot(CHOC_EGG, HIDDEN)]);
    n++;
  }
  s.items.rev++;
  sim.events.push({ type: 'holiday', what: 'hidden', day: 'eggHunt', n });
}

/**
 * 22:00: the eggs not found yet the inmates found first: those still hidden about the yard (where
 * they were hidden: one carried off and dropped elsewhere stays where it lies), and those still in
 * the inmates' desks (theirs, eaten; else a desk would keep them for good and fill with them, week
 * after week, leaving no room for its loot).
 */
function eggsGone(sim: SimContext) {
  const it = sim.state.items;
  const hidden = (v: number) => itemOf(v) === CHOC_EGG && usesOf(v) === HIDDEN;
  const inYard = (key: number) => layerOfKey(key) === LAYER.GROUND && sim.world.zoneAt(tileOfKey(key) % MAP_W, Math.floor(tileOfKey(key) / MAP_W)) === 'yard';
  const before = it.ground.length;
  it.ground = it.ground.filter(([key, v]) => !(hidden(v) && inYard(key)));
  let gone = it.ground.length !== before;
  containersOf(sim.world).forEach((c, k) => {
    if (c.table !== 'inmateDesk') return;
    const box = it.containers[k];
    for (let j = 0; j < box.length; j++) {
      if (!hidden(box[j])) continue;
      box[j] = 0;
      gone = true;
    }
  });
  if (gone) it.rev++;
}

/** An egg still hidden in the player's pockets: found (it's a plain egg from now on). */
function eggsFound(sim: SimContext) {
  const inv = sim.state.items.inv;
  for (let k = 0; k < HOTBAR; k++) {
    if (itemOf(inv[k]) !== CHOC_EGG || usesOf(inv[k]) !== HIDDEN) continue;
    inv[k] = slot(CHOC_EGG, 0);
    sim.state.items.rev++;
    sim.events.push({ type: 'holiday', what: 'egg', day: 'eggHunt', item: CHOC_EGG });
  }
}

/** Costume night: an inmate close to the player in costume laughs (once a night each) and likes them a little more. */
function laughs(sim: SimContext) {
  const s = sim.state;
  if (!holidayNow(sim, 'costumeNight') || itemOf(s.items.inv[SLOT.OUTFIT]) !== COSTUME || sim.away || s.layer !== LAYER.GROUND) return;
  const day = prisonDay(s.step);
  if (s.laughed[0] !== day) s.laughed = [day];
  const reach = LAUGH_REACH * UNIT;
  s.inmates.forEach((m, k) => {
    if (m.ko > 0 || m.doing === DOING.SLEEP || s.laughed.includes(k, 1)) return;
    if (Math.abs(m.body.x - s.player.x) > reach || Math.abs(m.body.z - s.player.z) > reach) return;
    s.laughed.push(k);
    sim.events.push({ type: 'holiday', what: 'laugh', day: 'costumeNight', who: k });
    changeOpinion(sim, k, LAUGH_OPINION);
  });
}

/** Whether a treat is on offer now: on its holiday day, from 08:00 until that day's over (the ice lollies until the water fight's end, the costume and the pumpkin until costume night's, the present until Christmas Day's 22:00). */
function treatHours(sim: HolidaySim, what: number): boolean {
  const treat = TREATS[what];
  if (!treat || !holidayDays(sim).includes(treat.day)) return false;
  const d = HOLIDAY_DAY[treat.day];
  return dayMinute(sim.state.step) < d.at + d.length;
}

/** Why a treat can't be had from the open furniture now (null: it can; 'notHere' when it isn't that furniture, that day or its hours). */
export function treatCheck(sim: HolidaySim, what: number): 'notHere' | 'takenToday' | 'room' | null {
  const s = sim.state;
  const treat = TREATS[what];
  const open = s.items.open;
  const c = open >= 0 ? containersOf(sim.world)[open] : undefined;
  if (!treat || !c || c.table !== treat.table || !treatHours(sim, what)) return 'notHere';
  const day = prisonDay(s.step);
  if (s.hol[0] === day && s.hol[1] & (1 << what)) return 'takenToday';
  if (s.items.inv.slice(0, HOTBAR).indexOf(0) < 0) return 'room';
  return null;
}

/** EXT.HOLIDAY (b: TREAT): the holiday's treat from the open furniture, into the hotbar (one of each a day). */
export function takeTreat(sim: SimContext, what: number) {
  const s = sim.state;
  const why = treatCheck(sim, what);
  if (why === 'notHere') return;
  if (why) return refuse(sim, why);
  const day = prisonDay(s.step);
  s.hol = [day, (s.hol[0] === day ? s.hol[1] : 0) | (1 << what)];
  const item = itemNumber(TREATS[what].item);
  s.items.inv[s.items.inv.slice(0, HOTBAR).indexOf(0)] = slot(item);
  s.items.rev++;
  sim.events.push({ type: 'holiday', what: 'took', day: TREATS[what].day, item });
}

/** The pumpkin in hand carved into a lantern: in the kitchen only. */
export function carve(sim: SimContext) {
  const it = sim.state.items;
  if (itemOf(it.inv[it.hand]) !== PUMPKIN) return;
  it.inv[it.hand] = slot(JACK_LANTERN);
  it.rev++;
  sim.events.push({ type: 'holiday', what: 'carved', item: JACK_LANTERN });
}

/** Where a pumpkin can be carved: the kitchen's floor. */
export const carveHere = (zone: string) => zone === 'kitchen';
