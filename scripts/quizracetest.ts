/**
 * Quiz night and the rat races polished (2.41), in every prison: the host's place and the crowd's (open floor, in the
 * library, never a contestant's place nor between them and the host), the owners' at the start and the crowd's beside
 * the track (never on it); the history questions going round the whole bank a week at a time, the warden's and the key
 * holder's questions true; the answers the player's Intellect rules out (never the right one, not to be chosen) and
 * what blind guessing wins with them; a quiz played with its host and crowd, a race with its owners and crowd, both gone
 * after; nothing of it in a run from before 2.41 (Sim.rules240) nor without the player in on it; a save mid-quiz.
 * Quiz night's rules otherwise: stagetest; the races': longtest.
 */
import { DAY_EVENTS } from '../src/content/days';
import { HISTORY, HISTORY_240, QUESTION_STEPS, QUIZ_GATHER, QUIZ_QUESTIONS, STRIKE_ONE, STRIKE_TWO, WARDENS } from '../src/content/nights';
import { RIVALS } from '../src/content/long';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { isFloor } from '../src/sim/ai/places';
import { DOING } from '../src/sim/ai/doing';
import { command, EXT, OP } from '../src/sim/command';
import { loadState } from '../src/sim/load';
import { Sim } from '../src/sim/Sim';
import { prisonDay } from '../src/sim/systems/clock';
import { hostSpot, questionNow, questionsOf, quizOf, struckOf } from '../src/sim/systems/quiz';
import { RACE, rivals, trackOf, trackTiles } from '../src/sim/systems/races';
import { sceneNow } from '../src/sim/systems/spectate';
import { staysPut } from '../src/sim/systems/vending';
import { huddleOf } from '../src/sim/systems/huddles';
import { librarianOf } from '../src/sim/systems/training';
import { STEPS_PER_MINUTE, STEPS_PER_SECOND, UNIT } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';
import { Bot, tileOf } from './bots';

const QUIZ = DAY_EVENTS.indexOf('quiz');
const tileAt = (b: { x: number; z: number }) => Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);

// ------------------------------------------------------------------ the places, in every prison
for (const def of PRISONS) {
  const sim = new Sim(def, 1);
  const w = sim.world;
  const pl = quizOf(w)!;
  const h = hostSpot(w);
  const lib = w.zoneAt(pl.spots[0].x, pl.spots[0].z);
  const open = (x: number, z: number) => isFloor(w, x, z) && !w.npcBlock[z * MAP_W + x];
  check(
    !!h && open(h.x, h.z) && w.zoneAt(h.x, h.z) === lib && !pl.spots.some((q) => q.x === h.x && q.z === h.z),
    `${def.id}: the host's place, open library floor`,
  );
  // (Quiz night's scene as the player joins: its crowd's places.)
  sim.state.quiz = {
    who: [0, 1, 2],
    seats: [0, 1, 2, 3],
    from: 0,
    q: -1,
    at: 0,
    pts: [0, 0, 0, 0],
    said: [-1, -1, -1, -1],
    got: -1,
    until: 0,
    host: 3,
  };
  const q = sceneNow(sim)!;
  const qs = q.spots.map((p) => tileAt(p));
  check(
    q.spots.length >= 2 &&
      new Set(qs).size === qs.length &&
      qs.every((t) => open(t % MAP_W, Math.floor(t / MAP_W)) && w.zoneAt(t % MAP_W, Math.floor(t / MAP_W)) === lib) &&
      !qs.some((t) => pl.spots.some((p) => tileOf(p.x, p.z) === t) || (h && tileOf(h.x, h.z) === t)),
    `${def.id}: quiz night's crowd stands on open library floor of its own (${q.spots.length} places)`,
  );
  sim.state.quiz = null;
  // (A race the player's bet on, at the off: the owners' places and the crowd's.)
  const t = trackOf(w)!;
  const track = trackTiles(t);
  const day = 3;
  sim.state.step = ((day - 1) * 1440 + 21 * 60 - 8 * 60) * STEPS_PER_MINUTE;
  sim.state.race = [day, 0, 0, 15, 0, 1, sim.state.step, 0];
  const r = sceneNow(sim)!;
  const os = r.ownerSpots.map((p) => tileAt(p));
  const cs = r.spots.map((p) => tileAt(p));
  check(
    os.length === RIVALS && cs.length >= 2 && new Set([...os, ...cs]).size === os.length + cs.length,
    `${def.id}: ${os.length} owners' places at the start, ${cs.length} for the crowd, each its own`,
  );
  check(
    [...os, ...cs].every((k) => open(k % MAP_W, Math.floor(k / MAP_W)) && !track.includes(k)),
    `${def.id}: the owners and the crowd stand on open floor, never on the track`,
  );
  sim.state.race = [];
  console.log(
    `${def.id}: host at ${h?.x},${h?.z}; quiz crowd ${q.spots.length} places; race owners ${os.map((k) => `${k % MAP_W},${Math.floor(k / MAP_W)}`).join(' ')}, crowd ${cs.length}`,
  );
}
check(WARDENS.length === PRISONS.length && PRISONS.every((p) => WARDENS.includes(p.id)), 'every prison has its warden to ask about');

// ------------------------------------------------------------------ the questions
{
  for (const def of PRISONS) {
    const sim = new Sim(def, 7);
    // A quiz night a week for ten weeks: the history questions go round the whole bank, none twice.
    const seen: string[] = [];
    for (let wk = 0; wk < HISTORY.length / 4; wk++)
      seen.push(
        ...questionsOf(sim, 2 + wk * 7 + (wk % 7))
          .filter((x) => x.id.startsWith('h.'))
          .map((x) => x.id),
      );
    check(
      seen.length === HISTORY.length && new Set(seen).size === HISTORY.length,
      `${def.id}: ten weeks of quiz nights ask all ${HISTORY.length} famous escapes, none twice`,
    );
    // Before 2.41: the first fifteen, drawn each night.
    const old = new Sim(def, 7);
    old.rules240 = true;
    const oldIds = new Set<string>();
    for (let day = 1; day <= 40; day++) for (const x of questionsOf(old, day)) if (x.id.startsWith('h.')) oldIds.add(x.id);
    check(
      [...oldIds].every((id) => HISTORY.indexOf(id.slice(2) as never) < HISTORY_240),
      `${def.id}: a run from before 2.41 asks from the first ${HISTORY_240} only`,
    );
    // The new ones true: this prison's warden; the guard with that key's colour, the others' another.
    let warden = 0;
    let keyHolder = 0;
    for (let day = 1; day <= 60; day++)
      for (const x of questionsOf(sim, day)) {
        if (x.id === 'warden') {
          const right = x.choices[x.answer];
          check(
            right.kind === 'warden' && right.id === def.id && new Set(x.choices.map((c) => (c.kind === 'warden' ? c.id : ''))).size === 4,
            `${def.id}: the warden's question true`,
          );
          warden++;
        }
        if (x.id === 'keyHolder') {
          const guards = sim.prison.guards;
          const ks = x.choices.map((c) => (c.kind === 'guard' ? c.k : -1));
          check(
            guards[ks[x.answer]]?.key === x.colour &&
              ks.every((k, j) => j === x.answer || guards[k]?.key !== x.colour) &&
              new Set(ks).size === 4,
            `${def.id}: the key holder's question true`,
          );
          keyHolder++;
        }
      }
    // The key's question and the key holder's, the same night: never the same guard nor the same colour.
    let apart = 0;
    for (let day = 1; day <= 200; day++) {
      const qs = questionsOf(sim, day);
      const key = qs.find((x) => x.id === 'key');
      const holder = qs.find((x) => x.id === 'keyHolder');
      if (!key || !holder) continue;
      const g = key.guard ?? -1;
      if (holder.colour === sim.prison.guards[g]?.key || holder.choices.some((c) => c.kind === 'guard' && c.k === g)) apart++;
    }
    check(apart === 0, `${def.id}: the key's question never gives the key holder's away`);
    check(
      warden > 0 && keyHolder > 0,
      `${def.id}: the warden's and the key holder's questions are asked (${warden}, ${keyHolder} in 60 days)`,
    );
  }
}

// ------------------------------------------------------------------ the answers ruled out, and guessing
/** A quiz night at Center Perks on day 1 (stagetest's way: the clock put at 19:00), the player at the first place, an Intellect. */
function quizGame(seed: number, int: number, before241 = false) {
  const sim = new Sim(CENTER_PERKS, seed);
  sim.rules240 = before241;
  sim.state.calendar = [
    [0, 0, 0],
    [1, QUIZ, 0],
  ];
  sim.state.items.int = int;
  sim.state.step = (19 - 8) * 60 * STEPS_PER_MINUTE - 1;
  sim.state.attended = true;
  sim.state.excused = true;
  sim.step(0);
  const pl = quizOf(sim.world)!;
  sim.state.player.x = pl.spots[0].x * UNIT + UNIT / 2;
  sim.state.player.z = pl.spots[0].z * UNIT + UNIT / 2;
  const go = (cmd = 0) => {
    sim.step(cmd);
    if (sim.state.lockdown) sim.state.lockdown = false;
    return sim.events;
  };
  go(command(0, OP.EXT, EXT.QUIZ, 0));
  return { sim, go };
}
{
  const rows: string[] = [];
  for (const int of [40, STRIKE_ONE, STRIKE_TWO]) {
    let asked = 0;
    let struck = 0;
    let bad = 0;
    // (Five nights each: from STRIKE_ONE on about half the questions, from STRIKE_TWO on all.)
    for (let seed = 1; seed <= 5; seed++) {
      const { sim, go } = quizGame(seed, int);
      for (let k = 0; k < QUIZ_GATHER + QUIZ_QUESTIONS * (QUESTION_STEPS + 60) && sim.state.quiz; k++) {
        const o = sim.state.quiz;
        const q = questionNow(sim);
        if (q && !o.until && sim.state.step === o.at) {
          const s = struckOf(sim);
          asked++;
          if (s.length > 1 || s.includes(q.answer)) bad++;
          if (s.length) {
            struck++;
            // (A ruled-out answer pressed: nothing happens.)
            go(command(0, OP.EXT, EXT.ANSWER, s[0]));
            if (sim.state.quiz!.said[0] !== -1) bad++;
            continue;
          }
        }
        go();
      }
    }
    const share = struck / Math.max(1, asked);
    check(
      asked === 5 * QUIZ_QUESTIONS && bad === 0,
      `Intellect ${int}: at most one wrong answer ruled out, never the right one, never to be chosen`,
    );
    check(
      int < STRIKE_ONE ? struck === 0 : int < STRIKE_TWO ? share > 0.25 && share < 0.75 : share === 1,
      `Intellect ${int}: ruled out on ${struck} questions of ${asked}`,
    );
    rows.push(`Intellect ${int}: one ruled out on ${struck} of ${asked}`);
  }
  const { sim } = quizGame(1, STRIKE_TWO, true);
  for (let k = 0; k < QUIZ_GATHER + 40 && !questionNow(sim); k++) sim.step(0);
  check(
    !!questionNow(sim) && struckOf(sim).length === 0 && sim.state.quiz!.host === undefined,
    'a run from before 2.41: nothing ruled out, no host',
  );
  console.log(rows.join('; '));
}
/** Over 40 nights: answering each question `wait` steps in, right if `knows` else a guess among the answers left. */
function nights(int: number, wait: number, knows: boolean) {
  let won = 0;
  let tie = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { sim, go } = quizGame(seed, int);
    let put = -1;
    let end = '';
    for (let k = 0; k < QUIZ_GATHER + QUIZ_QUESTIONS * (QUESTION_STEPS + 60) + 40 && sim.state.quiz; k++) {
      const o = sim.state.quiz;
      const q = questionNow(sim);
      if (q && o.q !== put) put = o.q;
      let cmd = 0;
      if (q && !o.until && o.said[0] < 0 && sim.state.step - o.at >= wait) {
        const left = [0, 1, 2, 3].filter((c) => !struckOf(sim).includes(c));
        const guess = left.filter((c) => c !== q.answer)[(seed + o.q) % (left.length - 1)];
        cmd = command(0, OP.EXT, EXT.ANSWER, knows ? q.answer : (seed * 7 + o.q * 3) % left.length === 0 ? q.answer : guess);
      }
      for (const e of go(cmd)) if (e.type === 'quiz' && (e.what === 'won' || e.what === 'tie' || e.what === 'lost')) end = e.what;
    }
    if (end === 'won') won++;
    if (end === 'tie') tie++;
  }
  return `${won} won ${tie} tied`;
}
{
  const blind = [40, STRIKE_ONE, STRIKE_TWO].map((i) => `Intellect ${i}: ${nights(i, 30, false)}`);
  console.log(`guessing 1.5 s in, over 40 nights: ${blind.join('; ')}; knowing, 5 s in, Intellect 40: ${nights(40, 100, true)}`);
}

// ------------------------------------------------------------------ quiz night with its host and its crowd, in every prison
let crowdAll = 0;
for (const def of PRISONS) {
  const bot = new Bot(def, 3);
  bot.st.calendar = [[2, QUIZ, 0]];
  bot.routineUntil(2, 19 * 60 + 2);
  const pl = def.leisure!.quiz!;
  bot.walkTo(tileOf(pl.spots[0].x, pl.spots[0].z), 3000);
  const lib = librarianOf(bot.sim);
  bot.op(OP.EXT, EXT.QUIZ, 0);
  const o = bot.st.quiz;
  check(!!o, `${def.id}: quiz night joined`);
  if (!o) continue;
  const host = o.host ?? -1;
  check(
    host >= 0 && !o.who.includes(host),
    `${def.id}: a host, never a contestant (${host === lib ? 'the librarian' : 'the nearest after them'})`,
  );
  const h = hostSpot(bot.sim.world)!;
  let hostIn = -1;
  let most = 0;
  let wrong = 0;
  let watched = 0;
  const from = bot.st.step;
  // (The player knowing every answer, 5 s in: the quiz played to its end.)
  for (let k = 0; k < QUIZ_GATHER + QUIZ_QUESTIONS * (QUESTION_STEPS + 60) + 40 && bot.st.quiz; k++) {
    const q = questionNow(bot.sim);
    const now = bot.st.quiz;
    const m = bot.st.inmates[host];
    if (hostIn < 0 && m.doing === DOING.HOST && tileAt(m.body) === tileOf(h.x, h.z)) hostIn = bot.st.step - from;
    const w = bot.st.watch ?? [];
    most = Math.max(most, w.length);
    // (The host never taken off for the machine's queue or a gathering meanwhile.)
    if (bot.st.vend.line.includes(host) || huddleOf(bot.sim, host) >= 0) wrong++;
    for (const k2 of w) {
      if (now.who.includes(k2) || k2 === host || staysPut(bot.sim, k2) || bot.st.vend.line.includes(k2)) wrong++;
      if (bot.st.inmates[k2].doing === DOING.WATCH) watched |= 1 << k2;
    }
    if (q && !now.until && now.said[0] < 0 && bot.st.step - now.at >= 100) bot.op(OP.EXT, EXT.ANSWER, q.answer);
    else bot.step();
  }
  const there = watched.toString(2).split('1').length - 1;
  crowdAll += there;
  check(
    hostIn >= 0 && hostIn < 15 * STEPS_PER_SECOND,
    `${def.id}: the host at his place reading them out within 15 s (${(hostIn / STEPS_PER_SECOND).toFixed(0)} s)`,
  );
  check(
    wrong === 0,
    `${def.id}: never a contestant, the host, a stall-keeper or a queuer in the crowd; the host never queuing or gathered`,
  );
  const after = bot.st.watch?.length ?? 0;
  for (let k = 0; k < 5 * STEPS_PER_SECOND; k++) bot.step();
  check(!bot.st.watch?.length, `${def.id}: the crowd gone after the quiz`);
  console.log(
    `${def.id}: quiz night hosted by ${host === lib ? 'the librarian' : `inmate ${host}`}, at his place in ${(hostIn / STEPS_PER_SECOND).toFixed(0)} s; ${there} came to watch (${most} at most at once), ${after} a moment after, then gone`,
  );
}
check(crowdAll > 0, 'quiz night draws a crowd');

// ------------------------------------------------------------------ a race with its owners and its crowd, in every prison
let ownersAll = 0;
for (const def of PRISONS) {
  let owners = 0;
  let crowd = 0;
  let onTrack = 0;
  let late = 0;
  let gone = 0;
  let nights = 0;
  for (const seed of [4, 5]) {
    const bot = new Bot(def, seed);
    bot.routineUntil(3, 20 * 60 + 10);
    const t = trackOf(bot.sim.world)!;
    const track = trackTiles(t);
    bot.walkTo(tileOf(t.x, t.z), 3000);
    bot.st.cash = 50;
    bot.op(OP.EXT, EXT.RACE, 0, 0);
    if (bot.st.race[RACE.LANE] !== 0) continue;
    nights++;
    const day = prisonDay(bot.st.step);
    const own = rivals(bot.st, day).map((e) => e.owner);
    const atStart = new Set<number>();
    const watching = new Set<number>();
    while (bot.st.race.length) {
      bot.step();
      const sc = sceneNow(bot.sim);
      for (const k of bot.st.watch ?? []) {
        const m = bot.st.inmates[k];
        if (m.doing !== DOING.WATCH) continue;
        if (track.includes(tileAt(m.body))) onTrack++;
        if (own.includes(k) && sc) atStart.add(k);
        else watching.add(k);
      }
      if (bot.st.race[RACE.ON] && !atStart.size) late++;
    }
    owners += atStart.size;
    crowd += watching.size;
    for (let k = 0; k < 5 * STEPS_PER_SECOND; k++) bot.step();
    if (!bot.st.watch?.length) gone++;
  }
  ownersAll += owners;
  check(nights === 2 && onTrack === 0, `${def.id}: nobody watches from the track itself`);
  check(gone === nights, `${def.id}: the owners and the crowd gone after the race`);
  console.log(`${def.id}: two race nights with a bet on: ${owners} of ${nights * RIVALS} owners at the start, ${crowd} more came to watch`);
}
check(ownersAll >= PRISONS.length * 3, "the rats' owners come to the start");

// ------------------------------------------------------------------ nothing of it without the player in on it, or before 2.41
{
  const bot = new Bot(PRISONS[0], 4);
  bot.routineUntil(3, 21 * 60 + 20);
  check(!bot.st.watch?.length, "a race night with no bet nor rat of the player's: nobody gathers at the track");
  const old = new Bot(PRISONS[0], 4);
  old.sim.rules240 = true;
  old.routineUntil(3, 20 * 60 + 10);
  const t = trackOf(old.sim.world)!;
  old.walkTo(tileOf(t.x, t.z), 3000);
  old.st.cash = 50;
  old.op(OP.EXT, EXT.RACE, 0, 0);
  let any = 0;
  while (old.st.race.length) {
    old.step();
    any += old.st.watch?.length ?? 0;
  }
  check(old.st.race.length === 0 && any === 0, 'a run from before 2.41: a race bet on, nobody comes');
  const oq = new Bot(PRISONS[0], 3);
  oq.sim.rules240 = true;
  oq.st.calendar = [[2, QUIZ, 0]];
  oq.routineUntil(2, 19 * 60 + 2);
  const pl = PRISONS[0].leisure!.quiz!;
  oq.walkTo(tileOf(pl.spots[0].x, pl.spots[0].z), 3000);
  oq.op(OP.EXT, EXT.QUIZ, 0);
  for (let k = 0; k < 30 * STEPS_PER_SECOND; k++) oq.step();
  check(
    !!oq.st.quiz && oq.st.quiz.host === undefined && !oq.st.watch?.length,
    'a run from before 2.41: quiz night with no host and no crowd',
  );
}

// ------------------------------------------------------------------ a save mid-quiz
{
  const { sim, go } = quizGame(2, 40);
  for (let k = 0; k < QUIZ_GATHER + 60; k++) go();
  const saved = JSON.parse(JSON.stringify(sim.state));
  const back = loadState(sim.world, CENTER_PERKS, JSON.parse(JSON.stringify(saved)));
  check(
    JSON.stringify(back) === JSON.stringify(saved) && (back.quiz?.host ?? -1) >= 0,
    'a save mid-quiz loads as it was, its host with it',
  );
  const bad = JSON.parse(JSON.stringify(saved));
  bad.quiz.host = bad.quiz.who[0];
  check(loadState(sim.world, CENTER_PERKS, bad).quiz === null, 'a quiz whose host is a contestant loads as none');
  console.log('a save mid-quiz round trips with its host');
}
