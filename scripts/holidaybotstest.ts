/**
 * Every escape bot under each holiday (P42): the routes escapetest runs, in runs begun under
 * Easter, summer, Halloween and Christmas (each holiday's day on day 2, its eggs, treats,
 * soaked guards, fireworks and summer weather): every one still out by its own way.
 * (Beside holidaytest.ts, so the two run side by side.)
 */
import { HOLIDAYS } from '../src/content/holidays';
import { holidayBots } from './holidaybots';

for (let h = 1; h < HOLIDAYS.length; h++) holidayBots(h);
