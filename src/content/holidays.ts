/**
 * Holidays (P42, v2.21): the prisons dress up for the real calendar's holidays. The play layer
 * reads the date once, when a run starts (`holidayOn`, or the player's pick in Settings), and the
 * run keeps it in `state.holiday`; inside the simulation it is only data, so a replay plays back
 * the same whatever day it's watched on. 0 is none: the campaign as it always was.
 *
 * Each holiday brings its day (or two) to the run, on day 2 and every seventh day after (New
 * Year's Eve the day after Christmas Day's): its own row on the warden's card, besides whatever the
 * week's deck deals (`HOLIDAY_DAYS`). What they do lives in src/sim/systems/holiday.ts; the decor
 * (render only, nothing solid) in src/render/Holidays.ts.
 */

/** The holidays. Stored as numbers (state.holiday, run logs): append only, never renumber. */
export const HOLIDAYS = ['none', 'easter', 'summer', 'halloween', 'christmas'] as const;
export type Holiday = (typeof HOLIDAYS)[number];
export const HOLIDAY = { NONE: 0, EASTER: 1, SUMMER: 2, HALLOWEEN: 3, CHRISTMAS: 4 } as const;

/** The holiday's own days. Stored as numbers in events: append only. */
export const HOLIDAY_DAYS = ['eggHunt', 'waterFight', 'costumeNight', 'christmasDay', 'newYearsEve'] as const;
export type HolidayDay = (typeof HOLIDAY_DAYS)[number];

export interface HolidayDayDef {
  holiday: number;
  /** The run's first prison day it falls on (it comes again every HOLIDAY_WEEK days). */
  first: number;
  /** When it's on, as minutes into the prison day (0 is 08:00), and for how long. */
  at: number;
  length: number;
  /** Dinner is a feast that day (the lamb roast, the barbecue, Christmas dinner). */
  feast?: boolean;
}

/** Each holiday day's place and time. */
export const HOLIDAY_DAY: Record<HolidayDay, HolidayDayDef> = {
  // Easter: eggs hidden at 08:00 in the inmates' desks and about the yard; what's left at 22:00 (in the yard, in their desks) the inmates found first. A lamb roast at dinner.
  eggHunt: { holiday: HOLIDAY.EASTER, first: 2, at: 0, length: 840, feast: true },
  // Summer: the water fight in the exercise hour (15:00–15:30) soaks the guards out in the yard. The barbecue at dinner.
  waterFight: { holiday: HOLIDAY.SUMMER, first: 2, at: 420, length: 30, feast: true },
  // Halloween: costume night, 19:00–21:00 (the costume and a pumpkin to be had from 08:00).
  costumeNight: { holiday: HOLIDAY.HALLOWEEN, first: 2, at: 660, length: 120 },
  // Christmas: a present under the tree from 08:00, Christmas dinner at 17:00.
  christmasDay: { holiday: HOLIDAY.CHRISTMAS, first: 2, at: 0, length: 840, feast: true },
  // New Year's Eve: the fireworks at midnight (00:00–00:10).
  newYearsEve: { holiday: HOLIDAY.CHRISTMAS, first: 3, at: 960, length: 10 },
};

/** A holiday's days come round again this many prison days later (a run that lasts weeks keeps its holiday). */
export const HOLIDAY_WEEK = 7;

/** The holiday days falling on a prison day for a run's holiday (none on day 1, the escape bots' day). */
export function holidayDaysOn(holiday: number, day: number): HolidayDay[] {
  if (!holiday) return [];
  return HOLIDAY_DAYS.filter((id) => {
    const d = HOLIDAY_DAY[id];
    return d.holiday === holiday && day >= d.first && (day - d.first) % HOLIDAY_WEEK === 0;
  });
}

/**
 * Easter Sunday of a year (the Gregorian computus, Meeus/Jones/Butcher): [month 1–12, day].
 * Pure arithmetic: the sim never asks the clock.
 */
export function easterSunday(year: number): [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

/** Days since a fixed point for a calendar date (proleptic Gregorian, UTC-free arithmetic). */
function dayNumber(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

/**
 * The holiday on a calendar date (year, month 1–12, day): Easter from Good Friday to Easter
 * Monday; summer 1 July – 31 August; Halloween 24 October – 2 November; Christmas and New Year
 * 15 December – 6 January. 0 (none) otherwise.
 */
export function holidayOn(y: number, m: number, d: number): number {
  const [em, ed] = easterSunday(y);
  const off = dayNumber(y, m, d) - dayNumber(y, em, ed);
  if (off >= -2 && off <= 1) return HOLIDAY.EASTER;
  if (m === 7 || m === 8) return HOLIDAY.SUMMER;
  if ((m === 10 && d >= 24) || (m === 11 && d <= 2)) return HOLIDAY.HALLOWEEN;
  if ((m === 12 && d >= 15) || (m === 1 && d <= 6)) return HOLIDAY.CHRISTMAS;
  return HOLIDAY.NONE;
}

/**
 * Taken on request (EXT.HOLIDAY, b): the ice lolly at a canteen counter on the water fight's day
 * (the ice-cream van's been), the costume there on costume night's, a pumpkin from the kitchen
 * freezer that day, a present from under the tree (a canteen counter) on Christmas Day. One each a
 * prison day, from 08:00 until the holiday day is over (holiday.ts treatHours). Never renumber.
 */
export const TREAT = { LOLLY: 0, COSTUME: 1, PUMPKIN: 2, GIFT: 3 } as const;
/** Each treat: its item, the furniture it's had from (the container's table), the holiday day it's had on. */
export const TREATS: ReadonlyArray<{ item: string; table: string; day: HolidayDay }> = [
  { item: 'ice_lolly', table: 'canteenCounter', day: 'waterFight' },
  { item: 'costume', table: 'canteenCounter', day: 'costumeNight' },
  { item: 'pumpkin', table: 'kitchenFreezer', day: 'costumeNight' },
  { item: 'gift', table: 'canteenCounter', day: 'christmasDay' },
];

/** The egg hunt: eggs hidden in this many of the inmates' desks (those with room), and lying about the yard. */
export const EGG_DESKS = 6;
export const EGG_YARD = 6;
/** The water fight: a soaked guard out in the yard sees this far (tiles) while it lasts. */
export const WET_SIGHT = 2;
/** Costume night: an inmate within this reach of the player in costume laughs (once a night each), and likes them this much more. */
export const LAUGH_REACH = 2;
export const LAUGH_OPINION = 5;
/** The fireworks: any noise made while they go off carries this share (tenths). */
export const FIREWORK_NOISE = 2;
/** Summer: where a prison's climate has heatwaves at all, their weight doubles and gains this much. */
export const SUMMER_HEAT = 10;
