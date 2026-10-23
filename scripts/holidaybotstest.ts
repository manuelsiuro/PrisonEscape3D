/**
 * Every escape bot under each holiday (P42): the routes escapetest runs, in runs begun under
 * Easter, summer, Halloween and Christmas (each holiday's day on day 2, its eggs, treats,
 * soaked guards, fireworks and summer weather): every one still out by its own way; and the
 * parole board's model prisoner (P39), whose run lives through two holiday days, under each.
 * (Beside holidaytest.ts, so the two run side by side.)
 */
import { HOLIDAY, HOLIDAYS } from '../src/content/holidays';
import { PRISONS } from '../src/content/prisons';
import { holidayBots } from './holidaybots';
import { modelPrisoner } from './parolebots';
import { Bot } from './bots';
import { quiet } from './escapes';

for (let h = 1; h < HOLIDAYS.length; h++) holidayBots(h);

// The parole board's model prisoner (P39) lives through two of the holiday's days (day 2 and day 9): one a holiday, each at another prison (as paroletest's seeds).
const PAROLED: Array<[number, string]> = [
  [HOLIDAY.EASTER, 'center-perks'],
  [HOLIDAY.SUMMER, 'san-pancho'],
  [HOLIDAY.HALLOWEEN, 'shankton'],
  [HOLIDAY.CHRISTMAS, 'stalag-flucht'],
];
console.log("the parole board's model prisoner under a holiday:");
quiet.on = true;
for (const [h, id] of PAROLED) {
  Bot.holiday = h;
  console.log(`  ${HOLIDAYS[h]}: ${modelPrisoner(id, 31 + PRISONS.findIndex((p) => p.id === id))}`);
}
Bot.holiday = 0;
quiet.on = false;
