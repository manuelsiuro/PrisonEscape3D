/**
 * Every escape bot under a holiday (P42, holidaytest and its siblings): each prison's routes as
 * escapetest runs them, quietly, in a run begun under the holiday (its day dealt on day 2, its
 * eggs, treats, soaked guards, fireworks and summer weather as a player would have them). Each
 * must still get out by its own way. One file a holiday, so the four run side by side.
 */
import { check } from './assert';
import { HOLIDAYS } from '../src/content/holidays';
import { ESCAPES } from '../src/sim/Sim';
import { PLANS, quiet, runRoute } from './escapes';
import { Bot } from './bots';

/** The bots' names for the routes. */
const VIA: Record<string, string> = { cutout: 'fence', rooftop: 'roof' };

export function holidayBots(holiday: number) {
  console.log(`the escape bots under ${HOLIDAYS[holiday]}:`);
  quiet.on = true;
  Bot.holiday = holiday;
  for (const p of PLANS) {
    const out: string[] = [];
    for (const r of p.routes ?? (['cutout', 'tunnel', 'rooftop', 'takeover'] as const)) {
      const via = VIA[r] ?? r;
      const log = console.log;
      const err = console.error;
      console.log = () => {};
      console.error = () => {};
      const bot = runRoute(p, r);
      console.log = log;
      console.error = err;
      const ok = !!bot?.done && ESCAPES[bot.st.via] === via && bot.st.holiday === holiday;
      out.push(`${via} ${ok ? bot!.time.replace('day ', 'd') : 'STILL INSIDE'}`);
      check(ok, `${p.def.id}: the ${via} still wins under ${HOLIDAYS[holiday]}`);
    }
    console.log(`  ${p.def.id}: ${out.join(', ')}`);
  }
  Bot.holiday = 0;
  quiet.on = false;
}
