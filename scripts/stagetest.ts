/**
 * Stage nights (P30, docs/PLAN.md §9), through the real simulation:
 * - the data: every prison's stage (open canteen floor) and quiz places (open library floor);
 *   the decks (each card once a week, the cards they took the places of); the songs' charts;
 * - talent night: the night's acts and their performers on the stage; the sign-up's refusals; a
 *   song played by bots pressing at fixed steps (the judging at the step, strays, misses); the
 *   verdict (place, prize, applause, the warden's goodwill); the music's cover; 2.5.1: every
 *   performer called in time (none lost to a free-time linger), no-shows (no music, no mark,
 *   out of the running, the stage free sooner), a performer held by the player still counted;
 * - quiz night: the questions (four different choices, the right one true in the running game),
 *   the contestants, the buzzers, bots that know the answers or guess (measured), the rewards;
 * - off, saves mid-act and mid-quiz, a save and a log from before stage nights; nothing happens
 *   without the player.
 */
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { TRAINING } from '../src/content/prisons/training';
import { DAY_BOOKS, DAY_EVENTS, MOVIE_NOISE } from '../src/content/days';
import { itemNumber, KEY_ITEM_COLORS } from '../src/content/items';
import { RECIPES } from '../src/content/recipes';
import { ROUTINE } from '../src/content/routine';
import { APPLAUSE, CHARTS, countIn, GOODWILL, GOODWILL_HEAT, HISTORY, INSTRUMENT, LATE, NO_SHOW, QUESTION_STEPS, QUIZ_GATHER, QUIZ_PRIZE, QUIZ_QUESTIONS, SONGS, songSteps } from '../src/content/nights';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';
import { command, EXT } from '../src/sim/command';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { loadState } from '../src/sim/state';
import { DAY_STEPS } from '../src/sim/systems/clock';
import { dayPlan, muffled } from '../src/sim/systems/calendar';
import { DOING } from '../src/sim/systems/inmates';
import { slot } from '../src/sim/systems/items';
import { acted, actNow, actsOf, boardsOf, markOf, musicOn, noShow, placeOf, prizeOf, stageFreeFrom, stageOf, tonight, turnFrom } from '../src/sim/systems/talent';
import { questionNow, questionsOf, quizOf, type Choice } from '../src/sim/systems/quiz';
import { beforeFixes, beforeStage, prepareReplay } from '../src/sim/runlog';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { LAYER, MAP_W } from '../src/sim/world/World';
import { check } from './assert';

const at = (day: number, hour: number, minute = 0) => (day - 1) * DAY_STEPS + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
const refusals = (seen: SimEvent[]) => seen.filter((e) => e.type === 'refused').map((e) => (e as { why: string }).why);
const of = <T extends SimEvent['type']>(seen: SimEvent[], type: T) => seen.filter((e) => e.type === type) as Array<Extract<SimEvent, { type: T }>>;
const TALENT = DAY_EVENTS.indexOf('talent');
const QUIZ = DAY_EVENTS.indexOf('quiz');

/** A game kept calm (heat and lockdowns cleared each step), day 1 forced to a card (else quiet). */
function game(card: number, prison = CENTER_PERKS, seed = 5) {
  const sim = new Sim(prison, seed);
  sim.state.calendar = [[0, 0, 0], [1, card, 0]];
  const seen: SimEvent[] = [];
  let calm = true;
  const step = (cmd = 0) => {
    sim.step(cmd);
    seen.push(...sim.events);
    if (calm) {
      if (sim.state.lockdown) sim.state.lockdown = false;
    }
  };
  const jump = (day: number, hour: number, minute = 0) => {
    sim.state.step = at(day, hour, minute) - 1;
    sim.state.attended = true;
    sim.state.excused = true;
    step();
  };
  const ext = (a: number, b = 0, c = 0) => step(command(0, OP_EXT, a, b, c));
  const setCalm = (on: boolean) => (calm = on);
  return { sim, seen, step, jump, ext, setCalm };
}
const OP_EXT = 13;

/** Puts a body in the middle of a tile. */
const put = (b: { x: number; z: number }, x: number, z: number) => {
  b.x = x * UNIT + UNIT / 2;
  b.z = z * UNIT + UNIT / 2;
};

// ------------------------------------------------------------------ the data
{
  const lines: string[] = [];
  for (const p of PRISONS) {
    const sim = new Sim(p, 1);
    const w = sim.world;
    const st = p.leisure?.stage;
    const pl = p.leisure?.quiz;
    check(!!st && !!pl, `${p.id}: a stage and quiz places`);
    if (!st || !pl) continue;
    const blocked = (x: number, z: number, zone: string) => {
      const prop = w.props.some((o) => x >= o.x && x < o.x + o.w && z >= o.z && z < o.z + o.d);
      const decor = (p.decor ?? []).some((d) => x >= d.x && x < d.x + (d.w ?? 1) && z >= d.z && z < d.z + (d.d ?? 1));
      return w.zoneAt(x, z) !== zone || w.blocked(x, z) || prop || decor;
    };
    const bad = boardsOf(st).filter((t) => blocked(t % MAP_W, Math.floor(t / MAP_W), 'canteen'));
    check(bad.length === 0, `${p.id}: the stage's boards are open canteen floor (${bad.map((t) => `${t % MAP_W},${Math.floor(t / MAP_W)}`).join(' ')})`);
    check([1, 5, 9, 13].includes(st.face) && [1, 5, 9, 13].includes(pl.face), `${p.id}: the stage and the quiz face a compass point`);
    const spots = pl.spots.filter((q) => blocked(q.x, q.z, 'library'));
    check(pl.spots.length === 4 && spots.length === 0, `${p.id}: four quiz places, open library floor (${spots.map((q) => `${q.x},${q.z}`).join(' ')})`);
    check(new Set(pl.spots.map((q) => q.z * MAP_W + q.x)).size === 4, `${p.id}: four different places`);
    // Every one of them reachable on foot from the player's cell (the inmates' paths).
    const from = sim.state.player;
    const reach = new Set<number>();
    const queue = [Math.floor(from.z / UNIT) * MAP_W + Math.floor(from.x / UNIT)];
    reach.add(queue[0]);
    w.setPlayerKeys(new Set([1, 2, 3, 4, 5]) as never);
    while (queue.length) {
      const t = queue.pop()!;
      const x = t % MAP_W;
      const z = Math.floor(t / MAP_W);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nt = (z + dz) * MAP_W + x + dx;
        if (reach.has(nt) || !w.inside(x + dx, z + dz) || w.npcBlock[nt]) continue;
        reach.add(nt);
        queue.push(nt);
      }
    }
    const lost = [...boardsOf(st), ...pl.spots.map((q) => q.z * MAP_W + q.x)].filter((t) => !reach.has(t));
    check(lost.length === 0, `${p.id}: the stage and the places can be walked to`);
    // The deck: each card once, the cards they took the places of named.
    const book = DAY_BOOKS[p.id];
    check(book.deck.filter((e) => e === 'talent').length === 1 && book.deck.filter((e) => e === 'quiz').length === 1 && book.deck.length === 7, `${p.id}: a talent night and a quiz night once a week`);
    check(!!book.beforeStage && !book.deck.includes(book.beforeStage.talent) && !book.deck.includes(book.beforeStage.quiz), `${p.id}: the cards they took the places of are gone from the deck`);
    lines.push(`${p.id}: stage ${st.x},${st.z} facing ${st.face}; quiz ${pl.spots.map((q) => `${q.x},${q.z}`).join(' ')}; was ${book.beforeStage!.talent}/${book.beforeStage!.quiz}`);
  }
  check(!TRAINING.leisure?.stage && !TRAINING.leisure?.quiz, 'the Training Block has neither (no day cards)');
  // The songs.
  for (const [k, s] of SONGS.entries()) {
    const chart = CHARTS[k];
    const gaps = chart.slice(1).map((n, i) => n[0] - chart[i][0]);
    check(s.bars.every((b) => b.length === 8 && /^[012.]+$/.test(b)) && s.bars.length === s.chords.length, `${s.id}: eight eighths a bar, a chord a bar`);
    check(Math.min(...gaps) >= 4, `${s.id}: notes at least 4 steps apart (one press a step, and the windows apart)`);
    const secs = songSteps(k) / 20;
    check(secs >= 36 && secs <= 42, `${s.id}: about 40 seconds (${secs})`);
    lines.push(`${s.id}: level ${s.level}, ${chart.length} notes, ${secs.toFixed(1)} s, lanes ${[0, 1, 2].map((l) => chart.filter((n) => n[1] === l).length).join('/')}`);
  }
  console.log(lines.join('\n'));
}

// ------------------------------------------------------------------ talent night: the acts
{
  const g = game(TALENT);
  const { sim } = g;
  const acts = actsOf(sim.state, 1);
  check(acts.length >= 2 && acts.length <= 3 && new Set(acts.map((a) => a.who)).size === acts.length, `two or three acts, different inmates (${acts.length})`);
  check(acts.every((a) => a.mark >= 50 && a.mark <= 85), 'their marks 50–85');
  check(JSON.stringify(actsOf(sim.state, 1)) === JSON.stringify(acts) && JSON.stringify(actsOf(sim.state, 2)) !== JSON.stringify(acts), 'the same for the night, another the next');
  // Each performer on the stage in its slot.
  const st = stageOf(sim.world)!;
  let onStage = 0;
  let music = 0;
  const t = st.z * MAP_W + st.x;
  g.jump(1, 18, 45);
  for (const [k, a] of acts.entries()) {
    while (sim.state.step < at(1, 19, a.at - 660 + 3)) g.step();
    const m = sim.state.inmates[a.who];
    const there = Math.floor(m.body.x / UNIT) === st.x && Math.floor(m.body.z / UNIT) === st.z && !m.body.moving;
    if (there && (m.doing === DOING.DRUMS || m.doing === DOING.GUITAR) && m.body.facing === st.face) onStage++;
    else console.log(`act ${k}: ${a.who} at ${Math.floor(m.body.x / UNIT)},${Math.floor(m.body.z / UNIT)} doing ${m.doing}`);
    if (muffled(sim, LAYER.GROUND, t, 10) === MOVIE_NOISE) music++;
  }
  check(onStage === acts.length, `each act's performer on the stage in its slot, playing, facing the room (${onStage}/${acts.length})`);
  check(music === acts.length, `while an act plays, a noise in the canteen carries as little as on movie night (${music}/${acts.length})`);
  check(acts.every((_, k) => acted(sim.state, k) && !noShow(sim, k)), 'every act stood');
  // Afterwards: off again.
  g.jump(1, 20, 0);
  for (let j = 0; j < 400; j++) g.step();
  check(acts.every((a) => sim.state.inmates[a.who].doing !== DOING.DRUMS && sim.state.inmates[a.who].doing !== DOING.GUITAR), 'off the stage after their slot');
  // The crowd in the canteen.
  const inCanteen = sim.state.inmates.filter((m) => sim.world.zoneAt(Math.floor(m.body.x / UNIT), Math.floor(m.body.z / UNIT)) === 'canteen').length;
  check(inCanteen >= sim.state.inmates.length / 2, `the evening's crowd in the canteen (${inCanteen}/${sim.state.inmates.length})`);
  // The music's cover: over with the acts.
  check(muffled(sim, LAYER.GROUND, t, 10) === 10, 'no music after the acts: a noise in the canteen carries as ever');
  console.log(`acts: ${acts.map((a) => `${a.who} ${SONGS[a.song].id} ${a.inst ? 'guitar' : 'drums'} ${a.mark}% ${a.at}–${a.until}`).join(' | ')}; ${inCanteen} in the canteen`);
}

/**
 * The player's song played by a bot: each note pressed `late` steps after its own (every `every`-th
 * one), and a stray press every `stray` steps (0 none). At 19:45 with every act stood (as if the
 * evening had been played through), or on a game `given` where it stands.
 */
function playSong(song: number, late: number, every = 1, stray = 0, inst: number = INSTRUMENT.DRUMS, seed = 5, given?: ReturnType<typeof game>) {
  const g = given ?? game(TALENT, CENTER_PERKS, seed);
  const { sim } = g;
  const st = stageOf(sim.world)!;
  if (!given) {
    g.jump(1, 19, 45);
    sim.state.acted = [1, (1 << tonight(sim).length) - 1];
  }
  put(sim.state.player, st.x, st.z);
  sim.state.heat = 40;
  g.ext(EXT.STAGE, song, inst);
  const o = sim.state.show;
  if (!o) return { g, mark: -1, done: undefined };
  const chart = CHARTS[song];
  const due = new Map<number, number>();
  chart.forEach(([t, lane], i) => {
    if (every > 0 && i % every === 0) due.set(o.from + countIn(o.song) + LATE + t + late - 1, lane);
  });
  for (let k = 0; k < countIn(song) + songSteps(song) + 10 && sim.state.show; k++) {
    const lane = due.get(sim.state.step);
    if (lane !== undefined) g.ext(EXT.NOTE, lane);
    else if (stray && k % stray === 0) g.ext(EXT.NOTE, k % 3);
    else g.step();
  }
  const done = of(g.seen, 'stage').find((e) => e.what === 'done');
  return { g, mark: done?.mark ?? -1, done };
}

// ------------------------------------------------------------------ talent night: the sign-up
{
  const g = game(TALENT);
  const { sim } = g;
  const st = stageOf(sim.world)!;
  g.jump(1, 18, 30);
  put(sim.state.player, st.x, st.z);
  g.ext(EXT.STAGE, 0, 0);
  check(!sim.state.show && refusals(g.seen).includes('stageClosed'), 'before 19:00: not yet');
  g.jump(1, 19, 2);
  put(sim.state.player, st.x, st.z);
  g.ext(EXT.STAGE, 0, 0);
  check(!sim.state.show && refusals(g.seen).includes('actsOn'), 'while the acts are on: after them');
  const from = turnFrom(tonight(sim));
  g.jump(1, 19, from - 660);
  put(sim.state.player, st.x + 4, st.z + 2);
  g.ext(EXT.STAGE, 0, 0);
  check(!sim.state.show && refusals(g.seen).includes('offStage'), 'off the stage: no');
  put(sim.state.player, st.x, st.z);
  g.ext(EXT.STAGE, 0, INSTRUMENT.GUITAR);
  check(!sim.state.show && refusals(g.seen).includes('noGuitar'), 'the guitar: only with one');
  sim.state.items.inv[0] = slot(itemNumber('guitar'));
  g.ext(EXT.STAGE, 1, INSTRUMENT.GUITAR);
  check(!!sim.state.show && sim.state.show.inst === INSTRUMENT.GUITAR, 'with the guitar in the hotbar: on');
  const x = sim.state.player.x;
  for (let k = 0; k < 40; k++) g.step(command(1));
  check(sim.state.player.x === x, 'the player keeps still on the stage (the keys play the lanes)');
  sim.state.show = null;
  g.ext(EXT.STAGE, 0, 0);
  check(!sim.state.show && refusals(g.seen).includes('performed'), 'once a night');
  const quiet = game(0);
  quiet.jump(1, 19, 40);
  put(quiet.sim.state.player, st.x, st.z);
  quiet.ext(EXT.STAGE, 0, 0);
  check(!quiet.sim.state.show && refusals(quiet.seen).includes('stageClosed'), 'not on another night');
}

// ------------------------------------------------------------------ talent night: the song
{
  const lines: string[] = [];
  for (const [k, s] of SONGS.entries()) {
    const perfect = playSong(k, 0);
    const late1 = playSong(k, 1);
    const early1 = playSong(k, -1);
    const late2 = playSong(k, 2);
    const half = playSong(k, 0, 2);
    const none = playSong(k, 0, 0);
    const spam = playSong(k, 0, 0, 1);
    check(perfect.mark === 100, `${s.id}: every note on its step: 100 (${perfect.mark})`);
    check(late1.mark === 100 && early1.mark === 100, `${s.id}: a step either side: still perfect (${early1.mark}, ${late1.mark})`);
    check(late2.mark === 60, `${s.id}: two steps late: good, 60 (${late2.mark})`);
    check(half.mark >= 45 && half.mark <= 55, `${s.id}: every other note: about half (${half.mark})`);
    check(none.mark === 0, `${s.id}: nothing played: 0 (${none.mark})`);
    check(spam.mark === 0, `${s.id}: mashing every step: 0 (${spam.mark})`);
    const misses = of(none.g.seen, 'stage').filter((e) => e.what === 'miss').length;
    check(misses === CHARTS[k].length, `${s.id}: each note let go by: missed (${misses})`);
    lines.push(`${s.id}: perfect ${perfect.mark}, ±1 ${early1.mark}/${late1.mark}, +2 ${late2.mark}, half ${half.mark}, none ${none.mark}, mashing ${spam.mark}`);
  }
  // The verdict.
  const best = playSong(2, 0);
  const d = best.done!;
  const acts = tonight(best.g.sim);
  check(d.place === 0 && d.prize === prizeOf(0, 2) && d.prize === 60, `first with the hardest song: $60 (${d.prize})`);
  check(d.heat === Math.min(40, GOODWILL_HEAT) && best.g.sim.state.heat <= 40 - GOODWILL_HEAT + 1, `a mark of ${GOODWILL}+: the warden's goodwill, ${GOODWILL_HEAT} heat off`);
  check((d.crowd ?? 0) > 0, `the room won over (${d.crowd})`);
  const mid = playSong(0, 0, 2);
  const dm = mid.done!;
  check(dm.place === placeOf(dm.mark!, acts) && dm.heat === 0, `a middling act: placed by the marks (${dm.mark}% → ${dm.place}), no goodwill`);
  check(dm.place! > 0 || dm.mark! >= Math.max(...acts.map((a) => a.mark)), 'behind every act marked higher');
  check(prizeOf(3, 0) === 0 && prizeOf(1, 1) === 22 && prizeOf(2, 0) === 5, 'prizes by place, more for a harder song');
  const poor = playSong(0, 0, 0);
  check(poor.done!.crowd === 0 && poor.done!.prize === 0, 'nothing played: no applause, no prize');
  // Off: a lockdown.
  const g = game(TALENT);
  g.setCalm(false);
  const st = stageOf(g.sim.world)!;
  g.jump(1, 19, 45);
  put(g.sim.state.player, st.x, st.z);
  g.ext(EXT.STAGE, 0, 0);
  g.sim.state.lockdown = true;
  g.step();
  check(!g.sim.state.show && of(g.seen, 'stage').some((e) => e.what === 'off'), 'a lockdown: the act is off');
  console.log(lines.join('\n'));
  console.log(`verdict: the hardest song perfect: place ${d.place}, $${d.prize}, ${d.crowd} won over, ${d.heat} heat off; every other note of the easiest: ${dm.mark}% place ${dm.place} $${dm.prize}`);
}

// ------------------------------------------------------------------ talent night: no-shows (2.5.1)
{
  // Every performer knocked out before his walk-on: each slot left empty (no music after its
  // grace, no mark), the stage the player's NO_SHOW minutes into the last, the player first of none.
  const g = game(TALENT);
  const { sim } = g;
  const st = stageOf(sim.world)!;
  const acts = tonight(sim);
  g.jump(1, 18, 45);
  for (const a of acts) sim.state.inmates[a.who].ko = 120 * STEPS_PER_MINUTE;
  const t = st.z * MAP_W + st.x;
  while (sim.state.step < at(1, 19, 1)) g.step();
  check(actNow(sim) === 0 && !musicOn(sim) && muffled(sim, LAYER.GROUND, t, 10) === 10, 'a performer out cold: his slot, but no music');
  while (sim.state.step < at(1, 19, NO_SHOW)) g.step();
  check(noShow(sim, 0) && actNow(sim) === -1 && !acted(sim.state, 0), `${NO_SHOW} minutes in with nobody on the boards: a no-show, the slot empty`);
  const last = acts[acts.length - 1];
  while (sim.state.step < at(1, 19, last.at - 660 + NO_SHOW) - 2) g.step();
  put(sim.state.player, st.x, st.z);
  g.ext(EXT.STAGE, 0, 0);
  check(!sim.state.show && refusals(g.seen).includes('actsOn'), 'the last act\'s grace not over: not yet');
  g.step();
  check(stageFreeFrom(sim) === last.at + NO_SHOW && stageFreeFrom(sim) < turnFrom(acts), `the stage free at ${last.at + NO_SHOW}, not ${turnFrom(acts)}`);
  const r = playSong(0, 0, 2, 0, INSTRUMENT.DRUMS, 5, g);
  check(r.mark >= APPLAUSE && r.done?.place === 0 && r.done.prize === prizeOf(0, 0), `every act a no-show: ${r.mark}% is first, $${r.done?.prize} (marks ${acts.map((a) => a.mark).join(' ')} out of the running)`);
  // A rival kept from the boards by the player (following them through his slot): his act stands, mark and all, with no music.
  const h = game(TALENT);
  const hs = h.sim.state;
  const hacts = tonight(h.sim);
  h.jump(1, 18, 45);
  hs.followers.push(hacts[0].who);
  while (hs.step < at(1, 19, NO_SHOW + 1)) h.step();
  check(acted(hs, 0) && !noShow(h.sim, 0) && actNow(h.sim) === 0 && !musicOn(h.sim), 'a performer the player keeps from the boards: his act stands (no music)');
  // Some acts on, one knocked out: placed among those that stood.
  const k = game(TALENT, CENTER_PERKS, 1);
  const kacts = tonight(k.sim);
  k.jump(1, 18, 45);
  const top = kacts.reduce((b, a, i) => (a.mark > kacts[b].mark ? i : b), 0);
  k.sim.state.inmates[kacts[top].who].ko = 120 * STEPS_PER_MINUTE;
  while (k.sim.state.step < at(1, 19, 50)) k.step();
  const stood = kacts.filter((_, i) => !noShow(k.sim, i));
  check(stood.length === kacts.length - 1 && noShow(k.sim, top), `the best act (${kacts[top].mark}%) out cold: a no-show, the rest stood`);
  const kr = playSong(0, 0, 2, 0, INSTRUMENT.DRUMS, 1, k);
  check(kr.done?.place === placeOf(kr.mark, stood), `placed among the acts that stood (${kr.mark}% → ${kr.done?.place} of ${stood.length + 1})`);
  console.log(`no-shows: all out cold, ${r.mark}% first at ${last.at + NO_SHOW}; the best of ${kacts.length} out cold, ${kr.mark}% placed ${kr.done?.place}`);
}

// ------------------------------------------------------------------ talent night: every performer called in time (2.5.1)
{
  // Left to themselves, every act's performer is on the boards in his slot, in every prison (2.5.0
  // left some lingering at a free-time spot through their act: 71–87% made it).
  let total = 0;
  let now = 0;
  let was = 0;
  for (const p of PRISONS)
    for (let seed = 1; seed <= 4; seed++)
      for (const old of [false, true]) {
        const { sim, step, jump } = game(TALENT, p, seed);
        sim.rules250 = old;
        const acts = tonight(sim);
        const st = stageOf(sim.world)!;
        const seen = new Set<number>();
        jump(1, 18, 0);
        while (sim.state.step < at(1, 20, 0)) {
          step();
          const m = (sim.state.step % DAY_STEPS) / STEPS_PER_MINUTE;
          acts.forEach((a, k) => {
            const b = sim.state.inmates[a.who].body;
            if (m >= a.at && m < a.until && Math.floor(b.x / UNIT) === st.x && Math.floor(b.z / UNIT) === st.z) seen.add(k);
          });
        }
        if (old) was += seen.size;
        else {
          total += acts.length;
          now += seen.size;
          check(acts.every((_, k) => acted(sim.state, k) === seen.has(k)), `${p.id} seed ${seed}: an act stood exactly when its performer took the boards`);
        }
      }
  check(now === total, `every performer on the boards in his slot (${now}/${total})`);
  console.log(`acts on the boards, 5 prisons × 4 nights: ${now}/${total} (2.5.0: ${was}/${total})`);
}

// ------------------------------------------------------------------ quiz night: the questions
{
  const lines: string[] = [];
  const show = (c: Choice) => JSON.stringify(c);
  for (const p of PRISONS) {
    const sim = new Sim(p, 3);
    let bad = 0;
    let local = 0;
    const kinds = new Set<string>();
    for (let day = 1; day <= 30; day++) {
      const qs = questionsOf(sim, day);
      if (qs.length !== QUIZ_QUESTIONS) bad++;
      if (new Set(qs.map((q) => q.id + (q.guard ?? '') + (q.items ?? []).join())).size !== qs.length) bad++;
      for (const q of qs) {
        kinds.add(q.id);
        if (q.choices.length !== 4 || new Set(q.choices.map(show)).size !== 4 || q.answer < 0 || q.answer > 3) bad++;
        const right = q.choices[q.answer];
        if (q.id.startsWith('h.')) {
          if (right.kind !== 'h' || right.k !== 0) bad++;
          continue;
        }
        local++;
        // True in the running game.
        const time = (id: string) => ROUTINE.find((r) => r.id === id)!.start;
        if (q.id === 'rollCall' && !(right.kind === 'time' && right.m === time('eveningRollCall'))) bad++;
        if (q.id === 'lightsOut' && !(right.kind === 'time' && right.m === time('lightsOut'))) bad++;
        if (q.id === 'breakfast' && !(right.kind === 'time' && right.m === time('breakfast'))) bad++;
        if (q.id === 'showers' && !(right.kind === 'time' && right.m === time('showers'))) bad++;
        if (q.id === 'delivery' && !(right.kind === 'time' && right.m === 14 * 60 + 30)) bad++;
        if (q.id === 'visiting' && !(right.kind === 'time' && right.m === 10 * 60)) bad++;
        if (q.id === 'cells' && !(right.kind === 'n' && right.n === p.cells.length && q.choices.every((c) => c.kind === 'n' && c.n > 0))) bad++;
        if (q.id === 'key' && !(right.kind === 'colour' && right.c === p.guards[q.guard!].key && q.choices.every((c) => c.kind === 'colour' && KEY_ITEM_COLORS.some(([k]) => k === c.c)))) bad++;
        if (q.id.startsWith('trait.')) {
          const trait = q.id.slice(6);
          if (!(right.kind === 'guard' && p.guards[right.k].trait === trait)) bad++;
          if (q.choices.some((c, i) => i !== q.answer && c.kind === 'guard' && (p.guards[c.k].trait ?? 'steady') === trait)) bad++;
          if (q.choices.some((c) => c.kind === 'guard' && !p.guards[c.k].name)) bad++;
        }
        if (q.id === 'recipe') {
          const key = (l: readonly string[]) => [...l].sort().join('+');
          const made = RECIPES.filter((r) => key(r.ingredients) === key(q.items!)).map((r) => r.result);
          if (!(right.kind === 'item' && made.includes(right.id))) bad++;
          if (q.choices.some((c, i) => i !== q.answer && c.kind === 'item' && made.includes(c.id))) bad++;
        }
      }
      // A quiz's answers aren't all in one place.
    }
    const where = new Map<number, number>();
    for (let day = 1; day <= 30; day++) for (const q of questionsOf(sim, day)) where.set(q.answer, (where.get(q.answer) ?? 0) + 1);
    check(bad === 0, `${p.id}: 30 nights' questions: eight, four different choices each, the right one true (${bad} wrong)`);
    check([0, 1, 2, 3].every((k) => (where.get(k) ?? 0) >= 30), `${p.id}: the right answer anywhere among the four (${[0, 1, 2, 3].map((k) => where.get(k) ?? 0).join('/')})`);
    check(local === 30 * (QUIZ_QUESTIONS - 4), `${p.id}: half about the prison`);
    lines.push(`${p.id}: ${kinds.size} kinds asked over 30 nights (${[...kinds].filter((k) => !k.startsWith('h.')).sort().join(' ')})`);
  }
  // The text: every question and its four answers in both languages.
  const keys = (d: Record<string, string>) => new Set(Object.keys(d));
  const ke = keys(en as Record<string, string>);
  const kf = keys(fr as Record<string, string>);
  const want = [...HISTORY.flatMap((h) => [`quiz.h.${h}`, ...[0, 1, 2, 3].map((k) => `quiz.h.${h}.${k}`)]), ...['rollCall', 'lightsOut', 'breakfast', 'showers', 'delivery', 'visiting', 'cells', 'key', 'recipe', 'trait.corrupt', 'trait.lazy', 'trait.strict'].map((k) => `quiz.${k}`)];
  const missing = want.filter((k) => !ke.has(k) || !kf.has(k));
  check(missing.length === 0, `every question in English and French (${missing.slice(0, 6).join(' ')})`);
  console.log(lines.join('\n'));
}

/** A quiz night played by a bot: each question answered `wait` steps in (right if `knows`, else a guess), or never (wait < 0). */
function playQuiz(seed: number, wait: number, knows: boolean) {
  const g = game(QUIZ, CENTER_PERKS, seed);
  const { sim } = g;
  const pl = quizOf(sim.world)!;
  g.jump(1, 19, 0);
  put(sim.state.player, pl.spots[0].x, pl.spots[0].z);
  g.ext(EXT.QUIZ, 0);
  if (!sim.state.quiz) return { g, end: undefined };
  let asked = -1;
  let put_ = 0;
  for (let k = 0; k < QUIZ_GATHER + QUIZ_QUESTIONS * (QUESTION_STEPS + 60) + 40 && sim.state.quiz; k++) {
    const o = sim.state.quiz;
    const q = questionNow(sim);
    if (q && o.q !== asked) {
      asked = o.q;
      put_ = sim.state.step;
    }
    if (q && wait >= 0 && !o.until && o.said[0] < 0 && sim.state.step - put_ >= wait) {
      const choice = knows ? q.answer : (q.answer + 1 + (sim.state.step % 3)) % 4;
      g.ext(EXT.ANSWER, choice);
    } else g.step();
  }
  return { g, end: of(g.seen, 'quiz').find((e) => e.what === 'won' || e.what === 'tie' || e.what === 'lost') };
}

// ------------------------------------------------------------------ quiz night: playing it
{
  const g = game(QUIZ);
  const { sim } = g;
  const pl = quizOf(sim.world)!;
  g.jump(1, 18, 30);
  put(sim.state.player, pl.spots[0].x, pl.spots[0].z);
  g.ext(EXT.QUIZ, 0);
  check(!sim.state.quiz && refusals(g.seen).includes('quizClosed'), 'before 19:00: not yet');
  g.jump(1, 19, 0);
  put(sim.state.player, pl.spots[0].x, pl.spots[0].z - 6);
  g.ext(EXT.QUIZ, 0);
  check(!sim.state.quiz && refusals(g.seen).includes('notAtQuiz'), 'away from the places: no');
  put(sim.state.player, pl.spots[1].x, pl.spots[1].z);
  g.ext(EXT.QUIZ, 0);
  const o = sim.state.quiz!;
  check(!!o && o.who.length === 3 && o.seats[0] === 1, 'joined at the second place: three contestants at the others');
  for (let k = 0; k < QUIZ_GATHER + 5 && sim.state.quiz!.q < 0; k++) g.step();
  const there = o.who.filter((k, j) => {
    const m = sim.state.inmates[k];
    return Math.floor(m.body.x / UNIT) === pl.spots[o.seats[j + 1]].x && Math.floor(m.body.z / UNIT) === pl.spots[o.seats[j + 1]].z;
  }).length;
  check(sim.state.quiz!.q === 0, `the first question once they're there (${sim.state.step - o.from} steps, ${there}/3 at their places)`);
  check(o.who.every((k) => sim.state.inmates[k].doing === DOING.QUIZ), 'the contestants at the buzzers');
  // A wrong answer: out of that question.
  const q = questionNow(sim)!;
  g.ext(EXT.ANSWER, (q.answer + 1) % 4);
  g.ext(EXT.ANSWER, q.answer);
  check(sim.state.quiz!.pts[0] === 0 && of(g.seen, 'quiz').filter((e) => e.what === 'wrong' && e.by === 0).length === 1, 'a wrong answer: out of that question, no second go');
  // Walking off: off.
  put(sim.state.player, pl.spots[1].x, pl.spots[1].z + 5);
  g.step();
  check(!sim.state.quiz && of(g.seen, 'quiz').some((e) => e.what === 'off'), 'away from the table: off');
  g.ext(EXT.QUIZ, 0);
  check(refusals(g.seen).includes('quizzed'), 'once a night');
  // Bots over 40 nights.
  const rate = (wait: number, knows: boolean) => {
    let won = 0;
    let tie = 0;
    let int = 0;
    let cash = 0;
    let played = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = playQuiz(seed, wait, knows);
      if (!r.end) continue;
      played++;
      if (r.end.what === 'won') won++;
      if (r.end.what === 'tie') tie++;
      int += r.end.int ?? 0;
      cash += r.end.prize ?? 0;
    }
    return { won, tie, played, int, cash };
  };
  const quick = rate(60, true);
  const mid = rate(100, true);
  const slow = rate(150, true);
  const guess = rate(30, false);
  const silent = rate(-1, true);
  check(quick.played === 40, `40 nights joined (${quick.played})`);
  check(quick.won >= 30, `knowing the answers, answering in 3 s: wins most nights (${quick.won}/40)`);
  check(mid.won < quick.won && mid.won >= 20, `knowing them, answering in 5 s: wins more often than not (${mid.won}/40)`);
  check(slow.won < mid.won, `knowing them, slow (7.5 s): wins less (${slow.won}/40)`);
  check(guess.won <= 4, `guessing: rarely wins (${guess.won}/40)`);
  check(silent.won === 0 && silent.tie === 0, 'never answering: never');
  const r = playQuiz(1, 60, true);
  check(r.end?.what === 'won' && r.end.prize === QUIZ_PRIZE && r.end.int === 2, `a win: $${QUIZ_PRIZE} and 2 Intellect`);
  console.log(`quiz bots over 40 nights: knows, 3 s: ${quick.won} won ${quick.tie} tied; knows, 5 s: ${mid.won} won ${mid.tie} tied; knows, 7.5 s: ${slow.won} won ${slow.tie} tied; guesses, 1.5 s: ${guess.won} won ${guess.tie} tied; silent: ${silent.won}`);
}

// ------------------------------------------------------------------ saves and logs
{
  // Mid-act.
  const a = playSong(1, 0);
  void a;
  const g = game(TALENT);
  const { sim } = g;
  const st = stageOf(sim.world)!;
  g.jump(1, 19, 45);
  put(sim.state.player, st.x, st.z);
  g.ext(EXT.STAGE, 1, 0);
  for (let k = 0; k < 200; k++) g.step();
  const saved = JSON.parse(JSON.stringify(sim.state));
  const back = new Sim(CENTER_PERKS, 5);
  back.state = loadState(back.world, CENTER_PERKS, saved);
  check(JSON.stringify(back.state) === JSON.stringify(sim.state), 'a save mid-act loads as it was');
  for (let k = 0; k < 100; k++) {
    const cmd = k % 7 === 0 ? command(0, OP_EXT, EXT.NOTE, k % 3) : 0;
    sim.step(cmd);
    back.step(cmd);
  }
  check(JSON.stringify(back.state) === JSON.stringify(sim.state) && markOf(sim.state.show!) === markOf(back.state.show!), 'and plays on the same');
  // Mid-quiz.
  const q = game(QUIZ);
  const pl = quizOf(q.sim.world)!;
  q.jump(1, 19, 0);
  put(q.sim.state.player, pl.spots[0].x, pl.spots[0].z);
  q.ext(EXT.QUIZ, 0);
  for (let k = 0; k < QUIZ_GATHER + 100; k++) q.step();
  const qs = JSON.parse(JSON.stringify(q.sim.state));
  const qb = new Sim(CENTER_PERKS, 5);
  qb.state = loadState(qb.world, CENTER_PERKS, qs);
  check(JSON.stringify(qb.state) === JSON.stringify(q.sim.state) && !!qb.state.quiz, 'a save mid-quiz loads as it was');
  const bad = JSON.parse(JSON.stringify(q.sim.state));
  bad.quiz.who = [0, 0, 1];
  bad.show = { song: 9, hits: [] };
  const fixed = loadState(qb.world, CENTER_PERKS, bad);
  check(fixed.quiz === null && fixed.show === null, 'a damaged act or quiz loads as none');
  // A save from before stage nights: the cards they took the places of, on the day it's loaded and the next.
  const plain = new Sim(CENTER_PERKS, 7);
  plain.state.calendar = [];
  let day = 2;
  while (dayPlan('center-perks', plain.state.salt, day).event !== 'talent' && day < 40) day++;
  plain.state.step = at(day, 12);
  const old = JSON.parse(JSON.stringify(plain.state));
  for (const k of ['show', 'stageDay', 'quiz', 'quizDay']) delete old[k];
  const loaded = loadState(plain.world, CENTER_PERKS, old);
  const was = DAY_BOOKS['center-perks'].beforeStage!;
  check(dayPlan('center-perks', loaded.salt, day, loaded.calendar).event === was.talent && loaded.show === null && loaded.stageDay === 0, `a save from before P30 on a talent night: ${was.talent} instead`);
  const fresh = loadState(plain.world, CENTER_PERKS, JSON.parse(JSON.stringify(plain.state)));
  check(dayPlan('center-perks', fresh.salt, day, fresh.calendar).event === 'talent', 'a save from after: the talent night stands');
  // A log from before stage nights.
  check(beforeStage('2.4.0') && beforeStage('1.20.3') && !beforeStage('2.5.0') && !beforeStage('3.0.1'), 'logs from before 2.5.0 are from before stage nights');
  const log = { v: 1 as const, prison: 'center-perks', seed: 7, game: '2.4.0', from: 0, steps: at(day + 1, 8), data: '', sums: [] as Array<[number, string]> };
  const set = prepareReplay(log, CENTER_PERKS);
  check(!!set && planOfDay(set.sim, day) === was.talent, 'a replay of a 2.4.0 run deals the old card that night');
  check(beforeFixes('2.5.0') && beforeFixes('2.4.9') && beforeFixes('1.22.1') && !beforeFixes('2.5.1') && !beforeFixes('2.6.0') && !beforeFixes('3.0.0'), 'logs from 2.5.0 and before are from before the P23–P30 fixes');
  const was250 = prepareReplay({ ...log, game: '2.5.0' }, CENTER_PERKS);
  const now251 = prepareReplay({ ...log, game: '2.5.1' }, CENTER_PERKS);
  check(!!was250 && was250.sim.rules250 && !!now251 && !now251.sim.rules250, 'a replay of a 2.5.0 run plays by its rules (no no-shows, no clocks), one from 2.5.1 by today\'s');
  console.log(`saves: mid-act and mid-quiz round trips ok; an old save's talent night (day ${day}) is ${was.talent} again`);
}
function planOfDay(sim: Sim, day: number) {
  return dayPlan(sim.prison.id, sim.state.salt, day, sim.state.calendar, sim.state.mods).event;
}

// ------------------------------------------------------------------ nothing happens without the player
{
  // A talent night and a quiz night played by nobody: the acts go on, the player's state is untouched.
  for (const card of [TALENT, QUIZ]) {
    const g = game(card);
    g.jump(1, 18, 50);
    for (let k = 0; k < 150 * STEPS_PER_MINUTE; k++) g.step();
    check(!g.sim.state.show && !g.sim.state.quiz && g.sim.state.stageDay === 0 && g.sim.state.quizDay === 0 && !of(g.seen, 'stage').length && !of(g.seen, 'quiz').length, `${DAY_EVENTS[card]} night untouched: nothing of the player's`);
  }
}

// ------------------------------------------------------------------ the reviews' cases
{
  // Every card dealt somewhere in the campaign (the new ones took no card's last place).
  const dealt = new Set(PRISONS.flatMap((p) => DAY_BOOKS[p.id].deck));
  const lost = DAY_EVENTS.filter((e) => !dealt.has(e));
  check(lost.length === 0, `every day card is still dealt in some prison (${lost.join(' ') || 'all'})`);
  // A poor act wins nothing, however few the acts.
  let two = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const r = playSong(2, 0, 0, 0, INSTRUMENT.DRUMS, seed);
    if (tonight(r.g.sim).length === 2) {
      two++;
      check(r.done?.prize === 0 && r.done.place === 2, `seed ${seed}: two acts, nothing played: third, and no prize`);
    }
  }
  check(two > 0, 'a night with two acts tried');
  // Given up: off, the night's turn used.
  const g = game(TALENT);
  const st = stageOf(g.sim.world)!;
  g.jump(1, 19, 45);
  const side = boardsOf(st)[3];
  put(g.sim.state.player, side % MAP_W, Math.floor(side / MAP_W));
  g.ext(EXT.STAGE, 0, 0);
  check(Math.floor(g.sim.state.player.x / UNIT) === st.x && Math.floor(g.sim.state.player.z / UNIT) === st.z, 'an act begun on the boards: on the performer\'s own tile');
  g.ext(EXT.STAGE, 255);
  check(!g.sim.state.show && of(g.seen, 'stage').some((e) => e.what === 'off'), 'an act given up: off');
  g.ext(EXT.STAGE, 0, 0);
  check(refusals(g.seen).includes('performed'), 'and the night\'s turn used');
  // On the stage, no talk, no seat, no strike: only the act's own commands.
  const h = game(TALENT);
  h.jump(1, 19, 45);
  put(h.sim.state.player, st.x, st.z);
  h.ext(EXT.STAGE, 0, 0);
  h.step(command(0, 1));
  check(h.sim.state.talk < 0 && h.sim.state.seat < 0 && !!h.sim.state.show, 'Interact on the stage does nothing');
  // A damaged act from the future, a quiz put ahead of now: none.
  const bad = JSON.parse(JSON.stringify(h.sim.state));
  bad.show.from = bad.step + 5000;
  check(loadState(h.sim.world, CENTER_PERKS, bad).show === null, 'an act begun after its save: none (never a player held still for ever)');
  // Late in the evening, no quiz.
  const q = game(QUIZ);
  const pl = quizOf(q.sim.world)!;
  q.jump(1, 20, 5);
  put(q.sim.state.player, pl.spots[0].x, pl.spots[0].z);
  q.ext(EXT.QUIZ, 0);
  check(!q.sim.state.quiz && refusals(q.seen).includes('quizLate'), 'after 20:00: too late to start the quiz');
  // Joined at the last minute: over before evening roll call, whatever happens.
  const latest = playQuizAt(19, 59, -1);
  check(latest.ended >= 0 && latest.ended < 22 * 60, `joined at 19:59: over by ${Math.floor(latest.ended / 60)}:${String(latest.ended % 60).padStart(2, '0')}`);
  // A contestant knocked out: off, never a win by default.
  const k = game(QUIZ);
  k.jump(1, 19, 0);
  put(k.sim.state.player, pl.spots[0].x, pl.spots[0].z);
  k.ext(EXT.QUIZ, 0);
  for (let j = 0; j < QUIZ_GATHER + 10; j++) k.step();
  k.sim.state.inmates[k.sim.state.quiz!.who[0]].ko = 200;
  k.step();
  check(!k.sim.state.quiz && of(k.seen, 'quiz').some((e) => e.what === 'off') && !of(k.seen, 'quiz').some((e) => e.what === 'won'), 'a contestant knocked out: the quiz is off');
  // Straight-Laced (P26): no question about who takes bribes or who dozes.
  const sl = new Sim(CENTER_PERKS, 3, ['straightLaced']);
  let asked = 0;
  for (let day = 1; day <= 30; day++) asked += questionsOf(sl, day).filter((x) => x.id === 'trait.corrupt' || x.id === 'trait.lazy').length;
  check(asked === 0, 'under Straight-Laced, no bribe or nap questions');
  console.log(`reviews: every card dealt; ${two} two-act nights pay nothing for nothing; give-up, the performer's tile, late join and knockouts checked`);
}

/** A quiz joined at a time, answered never (-1) or `wait` steps in: the minute of the prison clock it ended at. */
function playQuizAt(hour: number, minute: number, wait: number) {
  const g = game(QUIZ);
  const pl = quizOf(g.sim.world)!;
  g.jump(1, hour, minute);
  put(g.sim.state.player, pl.spots[0].x, pl.spots[0].z);
  g.ext(EXT.QUIZ, 0);
  let ended = -1;
  for (let k = 0; k < 4000 && g.sim.state.quiz; k++) {
    g.step();
    if (!g.sim.state.quiz) ended = (Math.floor((g.sim.state.step % DAY_STEPS) / STEPS_PER_MINUTE) + 480) % 1440;
  }
  void wait;
  return { ended };
}
