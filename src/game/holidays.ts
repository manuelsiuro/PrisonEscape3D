/**
 * The holiday a run begins under (P42): read once, when it starts, from the date and Settings
 * (by the calendar, a holiday picked now, or none), and kept in the run's state from then on.
 * The Daily keeps its deal for everyone alike: it plays without one, and only its decor follows
 * the date (`decorHoliday`).
 */
import { HOLIDAYS, holidayOn, type Holiday } from '../content/holidays';
import type { Settings } from './settings';

/** The holidays a player can pick in Settings (not 'none'). */
export const PICKABLE: ReadonlyArray<Exclude<Holiday, 'none'>> = ['easter', 'summer', 'halloween', 'christmas'];

/** The holiday a new run begins under (HOLIDAYS index; 0 none): by the date, the one picked, or none. */
export function runHoliday(s: Pick<Settings, 'holidays' | 'holidayPick'>, date: Date = new Date()): number {
  if (s.holidays === 'off') return 0;
  if (s.holidays === 'pick') return Math.max(0, HOLIDAYS.indexOf(s.holidayPick));
  return holidayOn(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** The date's holiday, whatever was picked (none with holidays off): what a Daily's decor follows. */
export function dateHoliday(s: Pick<Settings, 'holidays'>, date: Date = new Date()): number {
  return s.holidays === 'off' ? 0 : holidayOn(date.getFullYear(), date.getMonth() + 1, date.getDate());
}
