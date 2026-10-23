/**
 * The parole board's model prisoner (P39), shared by paroletest and holidaybotstest (P42): a run
 * kept to the routine, an application, the week, the hearing's best answers, out on parole.
 */
import { MEDAL_DAYS } from '../src/content/medals';
import { RECORD } from '../src/content/parole';
import { command, EXT, OP } from '../src/sim/command';
import { ESCAPES, type SimEvent } from '../src/sim/Sim';
import { DAY_STEPS } from '../src/sim/systems/clock';
import { answerWorth, linePoints, OUTCOME, P, PAROLE, recordCounts, recordScore } from '../src/sim/systems/parole';
import { check } from './assert';
import { Bot, tileOf } from './bots';
import { PLANS } from './escapes';

const refusals = (seen: SimEvent[]) => seen.filter((e) => e.type === 'refused').map((e) => (e as Extract<SimEvent, { type: 'refused' }>).why);
const APPLY = command(0, OP.EXT, EXT.PAROLE, PAROLE.APPLY);
const answer = (k: number) => command(0, OP.EXT, EXT.PAROLE, PAROLE.ANSWER, k);

/**
 * The model prisoner: the routine kept to day 3, applied at the release desk, the routine kept a
 * week (the record from the ledger), to the hearing at 10:00 (the routine sends them), the best
 * answer to each question by the record and Intellect, granted; the next morning, reported at the
 * desk and out through the doors: route parole.
 */
export function modelPrisoner(prisonId: string, seed: number): string {
  const plan = PLANS.find((p) => p.def.id === prisonId)!;
  const bot = new Bot(plan.def, seed);
  const st = bot.st;
  const r = plan.def.comms!.release;
  check(bot.routineUntil(3, 10 * 60 + 5), `${prisonId}: the first days kept`);
  check(bot.walkTo(tileOf(r.at[0].x, r.at[0].z), 6000), `${prisonId}: at the release desk`);
  bot.step(APPLY);
  const appliedAt = bot.time;
  check(st.parole[P.HEARING] === 10, `${prisonId}: applied, the hearing on day 10 (${refusals(bot.sim.events).join()})`);
  // The week: the routine kept; the hearing's morning, the routine sends the player to the room.
  check(bot.keepRoutine(() => !!st.hearing, 8 * DAY_STEPS), `${prisonId}: sat before the board (${bot.time})`);
  const sat = bot.time;
  const counts = recordCounts(st);
  const said: number[] = [];
  for (let q = 0; q < 3 && st.hearing; q++) {
    bot.until(() => !st.hearing || (st.hearing.q === q && !st.hearing.until), 400);
    if (!st.hearing) break;
    const t = st.hearing.topics[q];
    const all = [0, 1, 2].map((c) => answerWorth(q, t, c, counts, st.items.int));
    const best = all.indexOf(Math.max(...all));
    bot.step(answer(best));
    said.push(st.hearing?.worth[q] ?? 0);
  }
  bot.until(() => !st.hearing, 400);
  const pts = linePoints(counts);
  const lines = RECORD.map((r, k) => (pts[k] ? `${r.id} ${pts[k] > 0 ? '+' : ''}${pts[k]}` : '')).filter(Boolean).join(', ');
  check(st.parole[P.OUTCOME] === OUTCOME.GRANTED, `${prisonId}: granted (${st.parole[P.SCORE]}: ${lines}; answers ${said.join(' ')})`);
  check(bot.routineUntil(11, 10 * 60), `${prisonId}: the last night kept`);
  check(bot.walkTo(tileOf(r.at[0].x, r.at[0].z), 3000), `${prisonId}: at the release desk`);
  bot.act();
  check(st.release[1] > 0, `${prisonId}: cleared (${bot.time})`);
  check(bot.walkTo(tileOf(...plan.gates), 3000) || bot.done, `${prisonId}: out through the doors`);
  check(bot.done && ESCAPES[st.via] === 'parole', `${prisonId}: out by parole (${ESCAPES[st.via]})`);
  const medal = MEDAL_DAYS[prisonId].parole;
  return `${prisonId}: applied ${appliedAt}, sat ${sat}; record ${recordScore(counts)} (${lines}), answers ${said.map((x) => (x > 0 ? `+${x}` : `${x}`)).join(' ')}: granted ${st.parole[P.SCORE]}; out ${bot.time} by ${ESCAPES[st.via]} (gold by day ${medal[0]})`;
}

