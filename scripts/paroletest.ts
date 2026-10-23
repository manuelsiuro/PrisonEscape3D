/**
 * The parole board (P39, docs/PLAN.md §13), through the real simulation:
 * - the data: each campaign prison's hearing room (walked to at 10:00 with no key), the board's
 *   three places in it, the player's seat; the record's lines and the topics;
 * - applying: at the release desk from prison day 3, refused before, away from the desk, with a
 *   hearing set, while denied's wait runs, wanted, with a name listed, in the Daily, at the
 *   Training Block; by the lawyer on the phone (the fee, a day sooner);
 * - the record: a pure function of the ledger, from the day of applying (a record bot's card
 *   lines against what it saw happen);
 * - the hearing: called at 10:00, sat on entering the room, three questions, a claim borne out or
 *   a lie caught, owning up, fine words by Intellect, silence; the verdict; walked out of; missed;
 *   put off by a lockdown;
 * - denied: the two lines that weighed most, applying again after 3 prison days;
 * - plotting voids it: damage found, cutters taken off the player, out at night (and a release
 *   granted struck);
 * - granted: the name on tomorrow's release list (no records check), out by route parole;
 * - bots: a model prisoner granted in every prison, a plotter voided;
 * - saves with an application or a hearing under way, from before P39, damaged numbers.
 */
import { escapesOf, PRISONS } from '../src/content/prisons';
import { itemNumber } from '../src/content/items';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { TRAINING } from '../src/content/prisons/training';
import { ANSWER, ANSWER_STEPS, APPLY_AGAIN, HEARINGS, MEMBERS, PAROLE_FEE, PASS, RECORD, SILENT, TOPICS, WEIGH_STEPS } from '../src/content/parole';
import { CALLEE, LAWYER } from '../src/content/phone';
import { ROUTINE } from '../src/content/routine';
import { MEDAL_DAYS } from '../src/content/medals';
import { dailyOf } from '../src/content/daily';
import { command, EXT, OP, SLOT } from '../src/sim/command';
import { ESCAPES, Sim, type SimEvent } from '../src/sim/Sim';
import { loadState } from '../src/sim/state';
import { DAY_STEPS, prisonDay } from '../src/sim/systems/clock';
import { slot } from '../src/sim/systems/items';
import { DAY, FEAT } from '../src/sim/systems/ledger';
import { answerWorth, applyRefusal, claimTrue, linePoints, OUTCOME, P, PAROLE, recordCounts, recordScore, topicsOf, WALKED_OUT, ANSWERED } from '../src/sim/systems/parole';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { MAP_H, MAP_W, type World } from '../src/sim/world/World';
import { check } from './assert';
import { Bot, tileOf } from './bots';
import { PLANS } from './escapes';
import { modelPrisoner } from './parolebots';

const at = (day: number, hour: number, minute = 0) => (day - 1) * DAY_STEPS + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
const of = <T extends SimEvent['type']>(seen: SimEvent[], type: T) => seen.filter((e) => e.type === type) as Array<Extract<SimEvent, { type: T }>>;
const news = (seen: SimEvent[], what: string) => of(seen, 'parole').filter((e) => e.what === what);
const refusals = (seen: SimEvent[]) => of(seen, 'refused').map((e) => e.why);
const put = (b: { x: number; z: number }, x: number, z: number) => {
  b.x = x * UNIT + UNIT / 2;
  b.z = z * UNIT + UNIT / 2;
};
const APPLY = command(0, OP.EXT, EXT.PAROLE, PAROLE.APPLY);
const answer = (k: number) => command(0, OP.EXT, EXT.PAROLE, PAROLE.ANSWER, k);

/** Ground tiles walkable from some tiles, as the world's doors are now. */
function reachFrom(w: World, from: number[]): Uint8Array {
  const seen = new Uint8Array(MAP_W * MAP_H);
  const queue = from.slice();
  for (const t of queue) seen[t] = 1;
  for (let k = 0; k < queue.length; k++) {
    const t = queue[k];
    const x = t % MAP_W;
    for (const [j, ok] of [
      [t - 1, x > 0],
      [t + 1, x < MAP_W - 1],
      [t - MAP_W, t >= MAP_W],
      [t + MAP_W, t < MAP_W * (MAP_H - 1)],
    ] as const)
      if (ok && !seen[j] && !w.ground.block[j]) (seen[j] = 1), queue.push(j);
  }
  return seen;
}

/** A game kept calm (lockdowns cleared each step unless asked), quiet days. */
function game(prison = CENTER_PERKS, seed = 5, mods: string[] = []) {
  const sim = new Sim(prison, seed, mods);
  sim.state.calendar = [[0, 0, 0]];
  const seen: SimEvent[] = [];
  let calm = true;
  const step = (cmd = 0) => {
    sim.step(cmd);
    seen.push(...sim.events);
    if (calm && sim.state.lockdown) {
      sim.state.lockdown = false;
      sim.state.heat = 0;
    }
  };
  const jump = (day: number, hour: number, minute = 0) => {
    if (Math.floor((at(day, hour, minute) - 1) / DAY_STEPS) !== Math.floor(sim.state.step / DAY_STEPS)) sim.state.eventFlags = 0;
    sim.state.step = at(day, hour, minute) - 1;
    sim.state.attended = true;
    sim.state.excused = true;
    step();
  };
  const to = (day: number, hour: number, minute = 0) => {
    const target = at(day, hour, minute);
    while (sim.state.step < target && !sim.state.escaped) step();
  };
  const r = prison.comms!.release;
  const toDesk = () => put(sim.state.player, r.at[0].x, r.at[0].z);
  const h = HEARINGS[prison.id];
  const toRoom = () => put(sim.state.player, h.seat.x, h.seat.z);
  const setCalm = (on: boolean) => (calm = on);
  return { sim, seen, step, jump, to, toDesk, toRoom, setCalm };
}

// ------------------------------------------------------------------ the data
{
  const lines: string[] = [];
  for (const p of PRISONS) {
    const h = HEARINGS[p.id];
    check(!!h, `${p.id}: a hearing room`);
    if (!h) continue;
    const sim = new Sim(p, 1);
    const w = sim.world;
    check(h.board.length === MEMBERS.length, `${p.id}: a place for each member`);
    check([...h.board, h.seat].every((q) => w.zoneAt(q.x, q.z) === h.zone), `${p.id}: the board and the player's seat in the ${h.zone}`);
    check(h.board.every((q) => w.props.some((r) => r.kind !== 'table' && q.x >= r.x && q.x < r.x + r.w && q.z >= r.z && q.z < r.z + r.d)), `${p.id}: each member on a seat`);
    // The room walked to at 10:00 with no key.
    while (sim.clock.minuteOfDay !== 10 * 60 + 5) sim.step(0);
    w.setLockedCells(0n);
    w.setPlayerKeys(0);
    const c1 = p.cells[0];
    const home = reachFrom(w, [((c1[1] + c1[3]) >> 1) * MAP_W + ((c1[0] + c1[2]) >> 1)]);
    let room = 0;
    for (let i = 0; i < MAP_W * MAP_H; i++) if (home[i] && w.zoneAt(i % MAP_W, Math.floor(i / MAP_W)) === h.zone) room++;
    check(room > 0, `${p.id}: the hearing room is walked to at 10:00 with no key`);
    check(escapesOf(p).includes('parole') && !!MEDAL_DAYS[p.id].parole, `${p.id}: parole a way out, with medals`);
    lines.push(`${p.id}: the board in the ${h.zone} at ${h.board.map((q) => `${q.x},${q.z}`).join(' ')}, the player's seat ${h.seat.x},${h.seat.z}; medals ${MEDAL_DAYS[p.id].parole.join('/')}`);
  }
  check(!HEARINGS[TRAINING.id] && !(TRAINING.escapes ?? []).includes('parole'), 'none at the Training Block');
  // Every topic rests on record lines there are; a line for has a need.
  check(TOPICS.every((t) => t.lines.every((id) => RECORD.some((r) => r.id === id))), 'every topic rests on lines of the record');
  check(new Set(RECORD.map((r) => r.id)).size === RECORD.length, 'the record\'s lines are each once');
  console.log(lines.join('\n'));
  console.log(`record: ${RECORD.filter((r) => r.side > 0).length} lines for, ${RECORD.filter((r) => r.side < 0).length} against (at most +${RECORD.filter((r) => r.side > 0).reduce((a, r) => a + r.cap, 0)} / -${RECORD.filter((r) => r.side < 0).reduce((a, r) => a + r.cap, 0)}); ${TOPICS.length} topics; granted from ${PASS}`);
}

// ------------------------------------------------------------------ the Daily
{
  let dealt = 0;
  for (let n = 0; n < 400; n++) {
    const d = dailyOf(n);
    if (d.twists.length) dealt++;
  }
  // (Applying in the Daily: refused.)
  const g = game(CENTER_PERKS, 5, ['shortFuse']);
  g.jump(3, 10, 5);
  g.toDesk();
  g.step(APPLY);
  check(refusals(g.seen).includes('noParole') && !g.sim.state.parole[P.HEARING], 'the Daily deals no parole: applying is refused');
  check(dealt === 400, 'every Daily still dealt');
}

// ------------------------------------------------------------------ applying
{
  const g = game();
  const { sim, seen } = g;
  const s = sim.state;
  g.jump(2, 10, 5);
  g.toDesk();
  g.step(APPLY);
  check(refusals(seen).at(-1) === 'paroleEarly', 'day 2: too early');
  g.jump(3, 10, 5);
  put(s.player, 20, 20);
  g.step(APPLY);
  check(refusals(seen).at(-1) === 'notAtDesk', 'away from the desk: refused');
  g.toDesk();
  s.heat = 85;
  g.setCalm(false);
  g.step(APPLY);
  check(refusals(seen).at(-1) === 'hunted', 'wanted: refused');
  s.heat = 0;
  s.release[0] = 4;
  g.step(APPLY);
  check(refusals(seen).at(-1) === 'onList', 'a name already listed: refused');
  s.release[0] = 0;
  g.setCalm(true);
  g.step(APPLY);
  check(news(seen, 'applied').at(-1)?.n === 10 && s.parole[P.HEARING] === 10 && s.parole[P.FROM] === 3 && s.parole[P.USED] === 1, 'applied on day 3: the hearing on day 10');
  check(s.feats[FEAT.paroleFiled] === 1, 'the ledger counts the application');
  g.step(APPLY);
  check(refusals(seen).at(-1) === 'paroleOn', 'applied already: refused');
  // The Training Block: none.
  const t = new Sim(TRAINING, 1);
  check(applyRefusal(t, true) === 'noParole', 'the Training Block: no parole');
}
{
  // The lawyer files it by phone: the fee, the hearing a day sooner.
  const g = game();
  const { sim, seen } = g;
  const s = sim.state;
  const c = CENTER_PERKS.comms!.phone;
  g.jump(3, 10, 5);
  put(s.player, c.x, c.z);
  s.player.facing = c.face;
  s.cash = PAROLE_FEE + 5;
  g.step(command(0, OP.EXT, EXT.CALL, CALLEE.LAWYER * 16 + LAWYER.PAROLE));
  check(!!s.call && s.cash === 5, `the lawyer's fee: $${PAROLE_FEE} (${refusals(seen).join()})`);
  for (let k = 0; k < 6 * STEPS_PER_MINUTE && s.call; k++) g.step();
  check(news(seen, 'applied').at(-1)?.lawyer === true && s.parole[P.HEARING] === 9 && s.parole[P.LAWYER] === 1, 'filed by the lawyer: the hearing on day 9');
  check(s.feats[FEAT.lawyerFiled] === 1, 'the ledger counts the lawyer\'s filing');
  const g2 = game();
  g2.jump(2, 10, 5);
  put(g2.sim.state.player, c.x, c.z);
  g2.sim.state.cash = 100;
  g2.step(command(0, OP.EXT, EXT.CALL, CALLEE.LAWYER * 16 + LAWYER.PAROLE));
  check(refusals(g2.seen).at(-1) === 'paroleEarly' && g2.sim.state.cash === 100, 'too early on the phone too (and nothing paid)');
}

// ------------------------------------------------------------------ the record and the answers
{
  const g = game();
  const s = g.sim.state;
  g.jump(3, 10, 5);
  g.toDesk();
  g.step(APPLY);
  const counts0 = recordCounts(s);
  check(counts0.every((n) => n === 0), 'the record starts clean on the day of applying');
  // The ledger moves: a wage, a fight's day, a solitary stretch, a missed block.
  s.feats[FEAT.wages] += 2;
  s.feats[FEAT.solitary] += 1;
  s.feats[FEAT.missed] += 3;
  s.days[3] |= DAY.FIGHT;
  // (A fight before the day of applying stays off it.)
  s.days[1] |= DAY.FIGHT;
  const counts = recordCounts(s);
  const k = (id: string) => RECORD.findIndex((r) => r.id === id);
  check(counts[k('work')] === 2 && counts[k('solitary')] === 1 && counts[k('missed')] === 3 && counts[k('fights')] === 1, `the record follows the ledger from the day of applying (${counts.join(',')})`);
  const pts = linePoints(counts);
  check(pts[k('work')] === 6 && pts[k('solitary')] === -6 && pts[k('missed')] === -6 && pts[k('fights')] === -4 && recordScore(counts) === -10, `points: ${pts.join(',')}`);
  // Claims: borne out, or a lie.
  const work = TOPICS.findIndex((t) => t.id === 'work');
  const fights = TOPICS.findIndex((t) => t.id === 'fights');
  const heat = TOPICS.findIndex((t) => t.id === 'heat');
  check(!claimTrue(counts, work) && !claimTrue(counts, fights) && claimTrue(counts, heat), 'a claim is true only where the record bears it out');
  check(answerWorth(0, heat, ANSWER.CLAIM, counts, 40) === MEMBERS[0].claim && answerWorth(1, fights, ANSWER.CLAIM, counts, 40) === MEMBERS[1].lie, 'a claim borne out is worth the member\'s claim, a lie its price');
  check(answerWorth(1, fights, ANSWER.OWN, counts, 40) === MEMBERS[1].own, 'owning up');
  check(answerWorth(0, fights, ANSWER.WORDS, counts, 40) === 1 && answerWorth(0, fights, ANSWER.WORDS, counts, 100) === MEMBERS[0].words, 'fine words, by Intellect');
  const tp = topicsOf(s.salt, 10);
  check(tp.length === 3 && new Set(tp).size === 3 && tp.join() === topicsOf(s.salt, 10).join(), `three topics, distinct, the same for the day (${tp.map((t) => TOPICS[t].id).join(', ')})`);
  console.log(`answers: a claim ${MEMBERS.map((m) => `+${m.claim}`).join('/')} (a lie ${MEMBERS.map((m) => m.lie).join('/')}), owning up ${MEMBERS.map((m) => `+${m.own}`).join('/')}, words up to ${MEMBERS.map((m) => `+${m.words}`).join('/')}, silence ${SILENT}`);
}

// ------------------------------------------------------------------ the hearing
/** Applied on day 3, now at day 10 a minute before the hearing, the record as asked. */
function applied(prison = CENTER_PERKS) {
  const g = game(prison);
  g.jump(3, 10, 5);
  g.toDesk();
  g.step(APPLY);
  g.jump(10, 9, 59);
  // (Out of the room: at Center Perks the release desk is in the visiting room.)
  put(g.sim.state.player, 20, 20);
  return g;
}
{
  const g = applied();
  const { sim, seen } = g;
  const s = sim.state;
  check(!sim.dutyZones.includes('visitation'), 'before 10:00 the routine has nothing of it');
  g.to(10, 10, 0);
  check(news(seen, 'called').length === 1 && sim.dutyZones.includes('visitation'), '10:00: called, the routine sends the player to the visiting room');
  g.step();
  check(!s.hearing, 'not in the room: nothing yet');
  g.toRoom();
  g.step();
  check(!!s.hearing && news(seen, 'sat').length === 1, 'in the room: sat before the board');
  for (let k = 0; k < 200 && s.hearing!.q < 0; k++) g.step();
  check(s.hearing!.q === 0 && news(seen, 'question').length === 1, 'the first question put');
  // A clean, empty record (the routine wasn't kept here): every claim on a line against is true, on a line for a lie.
  const counts = recordCounts(s);
  const best = (q: number) => {
    const t = s.hearing!.topics[q];
    const all = [0, 1, 2].map((c) => answerWorth(q, t, c, counts, s.items.int));
    return all.indexOf(Math.max(...all));
  };
  g.step(answer(best(0)));
  check(news(seen, 'answer').length === 1 && s.hearing!.until > 0, 'answered: the answer weighed');
  for (let k = 0; k < WEIGH_STEPS + 5 && s.hearing!.q === 0; k++) g.step();
  check(s.hearing!.q === 1, 'then the next member\'s question');
  // Silence: the time runs out.
  for (let k = 0; k < ANSWER_STEPS + 5 && s.hearing!.said[1] === -1; k++) g.step();
  check(s.hearing!.said[1] === -2 && s.hearing!.worth[1] === SILENT && news(seen, 'silent').length === 1, 'no answer in time: silence, and it costs');
  for (let k = 0; k < WEIGH_STEPS + 5 && s.hearing!.q === 1; k++) g.step();
  g.step(answer(best(2)));
  const worth = s.hearing!.worth.slice();
  for (let k = 0; k < WEIGH_STEPS + 5 && s.hearing; k++) g.step();
  const v = of(seen, 'parole').find((e) => e.what === 'granted' || e.what === 'denied')!;
  const score = recordScore(recordCounts(s)) + worth.reduce((a, b) => a + b, 0);
  check(!!v && v.score === score && (v.what === 'granted') === score >= PASS, `the verdict: ${v?.what} at ${v?.score} (granted from ${PASS})`);
  check(s.feats[FEAT.hearings] === 1, 'the ledger counts the hearing');
}
{
  // Granted: the name on tomorrow's list; no records check at 22:00; called at 10:00, out by parole.
  const g = applied();
  const { sim, seen } = g;
  const s = sim.state;
  s.feats[FEAT.rollCallsKept] += 14;
  s.feats[FEAT.mealsKept] += 14;
  s.feats[FEAT.showersKept] += 7;
  s.feats[FEAT.wages] += 5;
  g.to(10, 10, 0);
  g.toRoom();
  g.step();
  const counts = recordCounts(s);
  for (let q = 0; q < 3; q++) {
    for (let k = 0; k < 400 && (s.hearing?.q ?? 9) < q; k++) g.step();
    for (let k = 0; k < 400 && s.hearing && s.hearing.until; k++) g.step();
    const t = s.hearing!.topics[q];
    g.step(answer(claimTrue(counts, t) ? ANSWER.CLAIM : ANSWER.OWN));
  }
  for (let k = 0; k < WEIGH_STEPS + 5 && s.hearing; k++) g.step();
  const v = news(seen, 'granted')[0];
  check(!!v && s.parole[P.OUTCOME] === OUTCOME.GRANTED && s.release[0] === 11 && s.parole[P.RELEASE] === 11, `granted (${v?.score}): on tomorrow's release list`);
  check((v?.lines ?? []).every((c) => c >= 0 && c < RECORD.length && linePoints(counts)[c] > 0), `what tipped it: ${(v?.lines ?? []).map((c) => RECORD[c]?.id).join(', ')}`);
  check(s.feats[FEAT.paroleGranted] === 1, 'the ledger counts the grant');
  s.heat = 50;
  g.setCalm(false);
  g.to(10, 22, 1);
  check(of(seen, 'paper').every((e) => e.what !== 'found') && s.release[0] === 11, 'the records at 22:00 have nothing to find in the board\'s grant');
  s.heat = 0;
  s.lockdown = false;
  g.setCalm(true);
  g.jump(11, 9, 59);
  g.to(11, 10, 0);
  check(of(seen, 'paper').some((e) => e.what === 'called'), 'the next morning at 10:00: the name called');
  g.toDesk();
  g.step(command(0, OP.INTERACT));
  check(of(seen, 'paper').some((e) => e.what === 'cleared') && s.release[1] > 0, 'cleared at the desk, in their own clothes');
  let k = 0;
  while (!s.escaped && k++ < 3000) g.step(command(5));
  check(s.escaped > 0 && ESCAPES[s.via] === 'parole', `out on the road: by parole (${ESCAPES[s.via]})`);
}
{
  // Denied: the two lines that weighed most; applying again after 3 prison days.
  const g = applied();
  const { sim, seen } = g;
  const s = sim.state;
  s.feats[FEAT.solitary] += 2;
  s.feats[FEAT.koInmates] += 1;
  g.to(10, 10, 0);
  g.toRoom();
  g.step();
  for (let q = 0; q < 3; q++) {
    for (let k = 0; k < 400 && (s.hearing?.q ?? 9) < q; k++) g.step();
    for (let k = 0; k < 400 && s.hearing && s.hearing.until; k++) g.step();
    g.step(answer(ANSWER.OWN));
  }
  for (let k = 0; k < WEIGH_STEPS + 5 && s.hearing; k++) g.step();
  const v = news(seen, 'denied')[0];
  const solitary = RECORD.findIndex((r) => r.id === 'solitary');
  const kos = RECORD.findIndex((r) => r.id === 'kos');
  check(!!v && s.parole[P.OUTCOME] === OUTCOME.DENIED && v.lines?.join() === `${solitary},${kos}` && s.parole[P.LINE1] === solitary && s.parole[P.LINE2] === kos, `denied (${v?.score}): what weighed most, solitary and a knockout (${v?.lines?.join()})`);
  check(s.parole[P.AGAIN] === 10 + APPLY_AGAIN && s.release[0] === 0, `again from day ${10 + APPLY_AGAIN}`);
  for (const day of [11, 12]) {
    g.jump(day, 10, 5);
    g.toDesk();
    g.step(APPLY);
    check(refusals(seen).at(-1) === 'paroleWait', `day ${day}: still to wait`);
  }
  g.jump(13, 10, 5);
  g.toDesk();
  g.step(APPLY);
  check(news(seen, 'applied').length === 2 && s.parole[P.HEARING] === 20 && s.parole[P.FROM] === 13 && recordCounts(s).every((n) => n === 0), 'day 13: applied again, the record from today, the hearing on day 20');
  console.log(`denied: solitary twice and a knockout (score ${v?.score}), again from day ${10 + APPLY_AGAIN}, the next hearing day 20`);
}
{
  // A lie caught.
  const g = applied();
  const { seen } = g;
  const s = g.sim.state;
  s.feats[FEAT.solitary] += 1;
  s.feats[FEAT.missed] += 1;
  s.feats[FEAT.koGuards] += 1;
  s.feats[FEAT.contrabandFound] += 1;
  s.feats[FEAT.eveningHeat] += 30;
  s.days[4] |= DAY.FIGHT;
  g.to(10, 10, 0);
  g.toRoom();
  g.step();
  for (let k = 0; k < 400 && s.hearing!.q < 0; k++) g.step();
  const t = s.hearing!.topics[0];
  g.step(answer(ANSWER.CLAIM));
  const e = news(seen, 'answer')[0];
  check(!!e && e.lie === !claimTrue(recordCounts(s), t) && e.worth === (e.lie ? MEMBERS[0].lie : MEMBERS[0].claim), `a claim on ${TOPICS[t].id}: ${e?.lie ? 'a lie caught' : 'borne out'} (${e?.worth})`);
  check(s.feats[FEAT.liesCaught] === (e?.lie ? 1 : 0), 'the ledger counts a lie caught');
}
{
  // Walked out; missed; put off by a lockdown.
  const g = applied();
  const s = g.sim.state;
  g.to(10, 10, 0);
  g.toRoom();
  g.step();
  put(s.player, 20, 20);
  g.step();
  check(news(g.seen, 'walkedOut').length === 1 && s.parole[P.OUTCOME] === OUTCOME.DENIED && s.parole[P.LINE1] === WALKED_OUT, 'walked out of the hearing: denied');
  const m = applied();
  m.to(10, 10, 31);
  check(news(m.seen, 'missed').length === 1 && m.sim.state.parole[P.OUTCOME] === OUTCOME.MISSED && m.sim.state.parole[P.AGAIN] === 13, 'not there by 10:30: the hearing missed');
  const l = applied();
  l.setCalm(false);
  l.sim.state.lockdown = true;
  l.to(10, 10, 0);
  check(news(l.seen, 'postponed')[0]?.n === 11 && l.sim.state.parole[P.HEARING] === 11, 'a lockdown at 10:00: put off to tomorrow');
}

// ------------------------------------------------------------------ plotting
{
  const g = applied();
  const { sim, seen } = g;
  const s = sim.state;
  // Out at night: spotted.
  g.jump(5, 23, 30);
  g.setCalm(false);
  put(s.player, CENTER_PERKS.rollCall[0].x, CENTER_PERKS.rollCall[0].z);
  for (let k = 0; k < 2000 && !news(seen, 'voided').length; k++) g.step();
  check(news(seen, 'voided')[0]?.why === 'night' && s.parole[P.HEARING] === 0 && s.parole[P.OUTCOME] === OUTCOME.VOIDED, 'out of the cell at night: voided');
  check(s.parole[P.AGAIN] === prisonDay(s.step) + APPLY_AGAIN && s.feats[FEAT.paroleVoided] === 1, 'applying again in 3 days, counted');
}
{
  // Cutters taken off the player after a capture.
  const g = applied();
  const { sim, seen } = g;
  const s = sim.state;
  g.jump(6, 13, 0);
  s.items.inv[0] = slot(itemNumber('light_cutters'));
  s.ko = 1;
  s.wake = 1;
  g.step();
  check(news(seen, 'voided')[0]?.why === 'tools', 'cutters taken off the player: voided');
}
{
  // Damage found (a hole by the desk) while a release is granted: the name struck.
  const g = applied();
  const s = g.sim.state;
  s.parole[P.RELEASE] = 11;
  s.release[0] = 11;
  s.parole[P.HEARING] = 0;
  g.sim.events.length = 0;
  g.sim.events.push({ type: 'found', kind: 1 });
  // (The system reads the step's events: one run by hand.)
  const { parole } = await import('../src/sim/systems/parole');
  parole(g.sim);
  check(g.sim.events.some((e) => e.type === 'parole' && e.what === 'voided' && e.why === 'dig') && s.release[0] === 0 && s.parole[P.RELEASE] === 0, 'damage found with the release granted: voided, the name struck');
}

// ------------------------------------------------------------------ saves
{
  const g = applied();
  const s = g.sim.state;
  g.to(10, 10, 0);
  g.toRoom();
  g.step();
  for (let k = 0; k < 100; k++) g.step();
  const saved = JSON.parse(JSON.stringify(s));
  const back = new Sim(CENTER_PERKS, 5);
  back.state = loadState(back.world, CENTER_PERKS, saved);
  check(JSON.stringify(back.state) === JSON.stringify(s) && !!back.state.hearing, 'a save in the middle of a hearing loads as it was');
  for (let k = 0; k < 600; k++) {
    g.sim.step(0);
    back.step(0);
  }
  check(g.sim.hash() === back.hash(), 'and plays on the same');
  const old = JSON.parse(JSON.stringify(s));
  delete old.parole;
  delete old.paroleBase;
  delete old.hearing;
  const o = new Sim(CENTER_PERKS, 5);
  o.state = loadState(o.world, CENTER_PERKS, old);
  check(o.state.parole.join() === '0,0,0,0,0,0,-1,-1,0,0' && o.state.hearing === null && o.state.paroleBase.length === 0, 'a save from before P39: nothing applied for');
  const bad = JSON.parse(JSON.stringify(s));
  bad.parole = [999, -4];
  bad.hearing = { q: 7 };
  const b = new Sim(CENTER_PERKS, 5);
  b.state = loadState(b.world, CENTER_PERKS, bad);
  check(b.state.parole.join() === '0,0,0,0,0,0,-1,-1,0,0' && b.state.hearing === null, 'damaged numbers load as none');
}

// ------------------------------------------------------------------ bots
// (The model prisoner: scripts/parolebots.ts, shared with holidaybotstest.)
for (const p of PRISONS) console.log(modelPrisoner(p.id, 31 + PRISONS.indexOf(p)));

/** The plotter: applied on day 3, then out of the cell after Lights Out (a bed check, a guard about): voided. */
{
  const bot = new Bot(CENTER_PERKS, 41);
  const st = bot.st;
  const r = CENTER_PERKS.comms!.release;
  check(bot.routineUntil(3, 10 * 60 + 5), 'plotter: the first days kept');
  check(bot.walkTo(tileOf(r.at[0].x, r.at[0].z), 6000), 'plotter: at the desk');
  bot.step(APPLY);
  check(bot.routineUntil(3, 22 * 60 + 30), 'plotter: roll call');
  const spot = CENTER_PERKS.rollCall[0];
  bot.walkTo(tileOf(spot.x, spot.z), 3000);
  bot.until(() => st.parole[P.OUTCOME] === OUTCOME.VOIDED, 4 * 60 * STEPS_PER_MINUTE);
  const v = bot.log.find((l) => l.includes('parole: voided'));
  check(st.parole[P.OUTCOME] === OUTCOME.VOIDED && st.parole[P.HEARING] === 0, `plotter: out of the cell at night, voided (${v ?? bot.time})`);
  console.log(`plotter: ${v ?? 'not voided'}; again from day ${st.parole[P.AGAIN]}`);
}

/** The record bot: applied, a call home, a block missed, a scuffle; the card's lines are what it saw happen. */
{
  const bot = new Bot(CENTER_PERKS, 43);
  const st = bot.st;
  st.cash = 10;
  const r = CENTER_PERKS.comms!.release;
  check(bot.routineUntil(3, 10 * 60 + 5), 'record bot: the first days kept');
  check(bot.walkTo(tileOf(r.at[0].x, r.at[0].z), 6000), 'record bot: at the desk');
  bot.step(APPLY);
  // (Everything the bot sees happen from here on, step by step.)
  const events: SimEvent[] = [];
  const step = bot.step.bind(bot);
  bot.step = (cmd = 0) => {
    step(cmd);
    events.push(...bot.sim.events);
  };
  const watch = (cmd = 0) => bot.step(cmd);
  // A call home.
  const c = CENTER_PERKS.comms!.phone;
  bot.walkTo(tileOf(c.x, c.z), 3000);
  watch(command(0, OP.EXT, EXT.CALL, CALLEE.HOME * 16));
  for (let k = 0; k < 8 * STEPS_PER_MINUTE && st.call; k++) watch();
  // The routine, breakfast on day 5 skipped (in the cell meanwhile).
  const runTo = (day: number, minute: number) => check(bot.routineUntil(day, minute), `record bot: the routine to day ${day}`);
  runTo(5, 9 * 60 - 5);
  for (let k = 0; k < 65 * STEPS_PER_MINUTE; k++) watch(0);
  runTo(7, 12 * 60);
  const counts = recordCounts(st);
  const k = (id: string) => RECORD.findIndex((x) => x.id === id);
  const seenKept = (ids: string[]) => events.filter((e) => e.type === 'attended' && ids.includes(ROUTINE[e.routine].id)).length;
  const lines = [
    ['rollCalls', seenKept(['rollCall', 'eveningRollCall'])],
    ['meals', seenKept(['breakfast', 'dinner'])],
    ['showers', seenKept(['showers'])],
    ['family', events.filter((e) => e.type === 'phone' && e.what === 'home').length],
    ['missed', events.filter((e) => e.type === 'missed').length],
    ['work', events.filter((e) => e.type === 'cash' && e.why === 'wage' && e.n > 0).length],
  ] as const;
  for (const [id, n] of lines) check(counts[k(id)] === n, `record bot: ${id} on the card ${counts[k(id)]}, seen ${n}`);
  check(counts[k('missed')] >= 1, 'record bot: the breakfast missed is on the card');
  console.log(`record bot: ${lines.map(([id, n]) => `${id} ${n}`).join(', ')}: the card's lines as the ledger has them (${recordScore(counts)} so far)`);
}
console.log('parole ok');
