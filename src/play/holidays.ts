import { buzz } from '../app/haptics';
import { LAYER } from '../sim/world/World';
import { DAY_BOOKS } from '../content/days';
import { HOLIDAY_DAY, HOLIDAYS, TREATS, WET_SIGHT, type HolidayDay } from '../content/holidays';
import type { PrisonDef } from '../content/prisons/types';
import { dateHoliday, runHoliday } from '../game/holidays';
import { t, type Key } from '../i18n';
import type { Sim, SimEvent } from '../sim/Sim';
import { fireworksOn, holidayDays, holidayOf, treatCheck } from '../sim/systems/holiday';
import { HOLIDAY_TAKE, itemName } from '../ui/items';
import type { PaRow } from '../ui/pa';
import { banner, itemsUI, settings, sound } from './context';
import { floatAt } from './floats';
import { announcePa, dayTime } from './warden';
import { inmateName } from '../ui/names';

/**
 * Holidays on screen (P42): which holiday the picture dresses for (the run's own; a Daily's by the
 * date, decor only), the holiday's rows on the warden's card, the day card and the file, the
 * treats on offer at the open furniture, and what the events say (the warden, toasts, banners,
 * floats). Nothing here touches the simulation: the holiday came into the run when it began.
 */

const HOLIDAY_ICON: Record<HolidayDay, string> = { eggHunt: 'egg', waterFight: 'splash', costumeNight: 'pumpkin', christmasDay: 'tree', newYearsEve: 'sparkle' };
const HOLIDAY_COLOR: Record<HolidayDay, string> = { eggHunt: '#f7a8c8', waterFight: '#5fc8ff', costumeNight: '#ff8a2a', christmasDay: '#4fbf6a', newYearsEve: '#ffd23f' };

/** The holiday a new run in this prison begins under: Settings and the date (none in the Training Block). */
export const newRunHoliday = (prison: PrisonDef): number => (DAY_BOOKS[prison.id] ? runHoliday(settings) : 0);

/** The holiday's name ("Halloween"). */
const holidayName = (kind: number) => t(`holiday.name.${HOLIDAYS[kind] ?? 'none'}` as Key);

/** The holiday the picture dresses for: the run's own, else (a Daily: it plays without one) the date's (never a holiday picked in Settings; none with holidays off). */
const dailyDecor = new WeakMap<Sim, number>();
export function decorHoliday(sim: Sim): number {
  const own = holidayOf(sim);
  if (own) return own;
  if (!sim.state.mods.length || !DAY_BOOKS[sim.prison.id]) return 0;
  let k = dailyDecor.get(sim);
  if (k === undefined) dailyDecor.set(sim, (k = dateHoliday(settings)));
  return k;
}

/** When a holiday day is on, as the card says it. */
function whenOf(id: HolidayDay): string {
  const d = HOLIDAY_DAY[id];
  if (id === 'eggHunt' || id === 'christmasDay') return t('holiday.allDay');
  if (id === 'newYearsEve') return t('holiday.midnight');
  return t('day.when', { from: dayTime(d.at), to: dayTime(d.at + d.length) });
}

/** The holiday's rows for a prison day (the warden's card, the file, the day card; `forecast` for tomorrow's). */
export function holidayRows(sim: Sim, day: number, forecast = false, inFile = false, past = (_: HolidayDay) => false): PaRow[] {
  return holidayDays(sim, day).map((id) => ({
    icon: HOLIDAY_ICON[id],
    color: HOLIDAY_COLOR[id],
    label: inFile || forecast ? t('holiday.label') : holidayName(sim.state.holiday),
    title: t(`holiday.day.${id}` as Key),
    when: whenOf(id),
    sub: past(id) ? t('day.eventD.over') : t(`holiday.dayD.${id}` as Key, { n: WET_SIGHT }),
  }));
}

/** The warden's morning line for the holiday's day (or ''). */
export function holidayMorning(sim: Sim, day: number): string {
  return holidayDays(sim, day)
    .map((id) => t(`holiday.pa.${id}` as Key))
    .join(' ');
}

/** The treats on offer at the open furniture (its table), as take buttons: their `what` past 100 (play/long.ts sends EXT.HOLIDAY for those). */
const TREAT_OFFSET = HOLIDAY_TAKE;
const offers: Array<{ what: number; label: string; why: string }> = [];
const TREAT_LABEL: readonly Key[] = ['holiday.take.lolly', 'holiday.take.costume', 'holiday.take.pumpkin', 'holiday.take.gift'];
export function treatOffers(sim: Sim, table: string): ReadonlyArray<{ what: number; label: string; why: string }> {
  offers.length = 0;
  if (!holidayOf(sim)) return offers;
  TREATS.forEach((tr, what) => {
    if (tr.table !== table) return;
    const why = treatCheck(sim, what);
    if (why === 'notHere') return;
    offers.push({ what: TREAT_OFFSET + what, label: t(TREAT_LABEL[what]), why: why === 'takenToday' ? t('holiday.take.today') : why === 'room' ? t('refused.room') : '' });
  });
  return offers;
}

/** The warden's line (day.ts: not with the announcements off; never in your sleep). */
const say = (sim: Sim, text: string) => announcePa(sim, text);

/** What the holidays' events say. */
export function announceHoliday(sim: Sim, e: Extract<SimEvent, { type: 'holiday' }>) {
  switch (e.what) {
    case 'start':
      if (e.day === 'waterFight') {
        sound.splash();
        buzz('giveWay');
        banner.show(t('holiday.banner.waterFight'), t('holiday.banner.waterFightSub', { n: WET_SIGHT }), 'routine', 4200);
      } else if (e.day === 'newYearsEve') {
        sound.bang(0.8);
        buzz('giveWay');
        banner.show(t('holiday.banner.newYear'), t('holiday.banner.newYearSub'), 'routine', 4600);
      } else if (e.day === 'costumeNight') {
        banner.show(t('holiday.banner.costumeNight'), t('holiday.banner.costumeNightSub'), 'routine', 4200);
      }
      if (e.day && e.day !== 'eggHunt' && e.day !== 'christmasDay') say(sim, t(`holiday.paStart.${e.day}` as Key));
      break;
    case 'end':
      if (e.day === 'eggHunt') say(sim, t('holiday.paEnd.eggHunt'));
      else if (e.day === 'waterFight' || e.day === 'costumeNight') say(sim, t(`holiday.paEnd.${e.day}` as Key));
      break;
    case 'egg':
      sound.chime();
      buzz('attended');
      // (On the banner's toasts, held as long as the others: the hotbar's own note goes as the next one comes, and taking the egg brings one.)
      banner.toast(t('holiday.toast.egg'), 'good');
      break;
    case 'splash':
      sound.splash();
      banner.toast(t('holiday.toast.splash', { n: WET_SIGHT }), 'good', 4200);
      break;
    case 'took':
      sound.pickup();
      if (e.item) itemsUI.toast(t('holiday.toast.took', { item: itemName(e.item) }));
      break;
    case 'carved':
      sound.pickup();
      buzz('attended');
      itemsUI.toast(t('holiday.toast.carved'));
      break;
    case 'laugh':
      if (e.who === undefined) break;
      floatAt(e.who, t('holiday.float.laugh'), 'gain');
      itemsUI.toast(t('holiday.toast.laugh', { name: inmateName(sim, e.who) }));
      break;
  }
}

/** After each step: New Year's fireworks crackling and booming while they last (not asleep, not in a tunnel). */
export function holidayStep(sim: Sim) {
  const st = sim.state;
  if (!st.holiday || st.sleeping || st.step % 7 !== 0 || !fireworksOn(sim)) return;
  if (Math.random() < 0.45) sound.bang(st.layer === LAYER.UNDER ? 0.12 : 0.25 + Math.random() * 0.45);
}
