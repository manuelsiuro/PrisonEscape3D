/**
 * Roll call (2.27, systems/rollcall.ts): counted on the player's own square in every prison, the warden
 * walking the line and calling them first, "Here!" and what a missed call costs, what a menu or an
 * interruption does to it; older runs as they were.
 */
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { TRAINING } from '../src/content/prisons/training';
import { BLOCK, ROUTINE } from '../src/content/routine';
import { floorOf, placesOf } from '../src/sim/ai/places';
import { RunRecorder, replayLog } from '../src/sim/runlog';
import { Sim, type Snapshot } from '../src/sim/Sim';
import { GUARD, sendToLook } from '../src/sim/systems/guards';
import { tileAt } from '../src/sim/world/grid';
import { canAnswer, onOwnSquare, squareNeeded, wardenOf } from '../src/sim/systems/rollcall';
import { CHASE_HEAT, COUNT_HEAT, MISSED_ROUTINE_HEAT, STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';
import { Bot } from './bots';

const MORNING = 8 * 60;
const EVENING = 22 * 60;
const put = (bot: Bot, tile: number, facing = 13) => {
  const p = bot.st.player;
  p.x = (tile % MAP_W) * UNIT + UNIT / 2;
  p.z = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
  p.moving = false;
  p.facing = facing;
};
const square = (bot: Bot) => placesOf(bot.sim.world).rollCall[0].tile;
/** A tile of the yard that isn't anyone's square. */
const offSquare = (bot: Bot) => {
  const squares = new Set(placesOf(bot.sim.world).rollCall.map((s) => s.tile));
  return floorOf(bot.sim.world, ['rollCall']).find(
    (t) => !squares.has(t) && !placesOf(bot.sim.world).countStops.some((s) => s.tile === t),
  )!;
};
/** A silent player at the morning's roll call on day 2, stood on their square as the block begins. */
function atMorning(seed = 3, prison = CENTER_PERKS) {
  const bot = new Bot(prison, seed);
  check(bot.routineUntil(2, MORNING), 'the morning roll call');
  check(ROUTINE[bot.st.routine].id === 'rollCall', 'it is roll call');
  // (From here on: yesterday's roll calls are answered and out of the way.)
  bot.silent = true;
  bot.events.length = 0;
  return bot;
}
/** Steps until the warden calls the player (false if the block ends first). */
const untilCalled = (bot: Bot) => bot.until(() => bot.st.calling > 0, 60 * STEPS_PER_MINUTE);

// ------------------------------------------------------------------ every square, every stop, every prison
for (const def of PRISONS) {
  const bot = new Bot(def, 3);
  const places = placesOf(bot.sim.world);
  check(places.rollCall.length >= def.cells.length, `${def.id}: a square for everyone`);
  check(places.countStops.length === places.rollCall.length, `${def.id}: a stop for every square`);
  const squares = new Set(places.rollCall.map((s) => s.tile));
  places.countStops.forEach((s, k) => {
    check(!bot.sim.world.guardBlock[s.tile], `${def.id}: the warden can stand at stop ${k}`);
    check(!squares.has(s.tile), `${def.id}: stop ${k} isn't someone's square`);
    const q = places.rollCall[k].tile;
    check(
      Math.abs((q % MAP_W) - (s.tile % MAP_W)) + Math.abs(Math.floor(q / MAP_W) - Math.floor(s.tile / MAP_W)) === 1,
      `${def.id}: stop ${k} is beside its square`,
    );
  });
  check(wardenOf(bot.sim) >= 0, `${def.id}: someone takes roll call`);
  check(
    bot.sim.world.zoneAt(places.rollCall[0].tile % MAP_W, Math.floor(places.rollCall[0].tile / MAP_W)) === 'rollCall',
    `${def.id}: the player's square is in the yard`,
  );
  check(
    !bot.st.inmates.some((m) => places.rollCall[m.cell - 1]?.tile === places.rollCall[0].tile),
    `${def.id}: no inmate is sent to the player's square`,
  );
  console.log(`${def.id}: ${places.rollCall.length} squares, a stop beside each, the warden ${def.guards[wardenOf(bot.sim)].name}`);
}

// ------------------------------------------------------------------ the whole block by the model prisoner, morning and evening
for (const def of PRISONS) {
  for (const [name, day, start] of [
    ['morning', 2, MORNING],
    ['evening', 1, EVENING],
  ] as const) {
    for (const seed of [41, 42, 43]) {
      const bot = new Bot(def, seed);
      check(bot.routineUntil(day, start), `${def.id}: to ${name}`);
      const t0 = bot.st.step;
      const end = t0 + 59 * STEPS_PER_MINUTE;
      let you = -1;
      let answered = -1;
      let called = 0;
      let missed = 0;
      let over = -1;
      let counted = -1;
      const w = bot.st.guards[wardenOf(bot.sim)];
      bot.keepRoutine(() => {
        const at = (bot.st.step - t0) / STEPS_PER_MINUTE;
        for (const e of bot.sim.events) {
          if (e.type !== 'count') continue;
          if (e.what === 'called') called++;
          if (e.what === 'you') you = at;
          if (e.what === 'answered') answered = at;
          if (e.what === 'missed') missed++;
        }
        if (over < 0 && bot.st.countDone && w.mode !== GUARD.COUNT && w.tasks.length === 0) over = at;
        if (counted < 0 && bot.st.attended) counted = at;
        return bot.st.step >= end;
      }, 60 * STEPS_PER_MINUTE);
      const n = placesOf(bot.sim.world).rollCall.length - 1;
      check(you > 0 && answered >= you && missed === 0, `${def.id} ${name} #${seed}: called and answered`);
      check(called === n, `${def.id} ${name} #${seed}: all ${n} others called (${called})`);
      check(you < counted, `${def.id} ${name} #${seed}: called before the badge is full`);
      check(over > 0 && over < 58, `${def.id} ${name} #${seed}: the walk ends in time (${over})`);
      check(onOwnSquare(bot.sim) || bot.st.attended, `${def.id} ${name} #${seed}: on the square`);
      check(bot.st.attended && bot.st.heat === 0, `${def.id} ${name} #${seed}: counted, no heat`);
      if (seed === 41)
        console.log(
          `${def.id} ${name}: called at minute ${Math.round(you)}, counted at ${Math.round(counted)}, the walk over at ${Math.round(over)} of 60`,
        );
    }
  }
}

// ------------------------------------------------------------------ only on the square
{
  const bot = atMorning(5);
  check(squareNeeded(bot.sim), 'the square matters at roll call');
  put(bot, offSquare(bot));
  bot.until(() => false, 200);
  check(bot.st.present === 0 && bot.st.yardSeen, 'in the yard off the square: seen, not counting');
  const before = bot.st.present;
  put(bot, square(bot));
  bot.until(() => false, 40);
  check(bot.st.present === before + 40, 'on the square the badge fills');
  const was = bot.st.present;
  put(bot, offSquare(bot));
  bot.until(() => false, 40);
  check(bot.st.present === was, 'stepping off pauses it');

  // Off the square all block: the heat of leaving early, no lockdown.
  const off = atMorning(6);
  put(off, offSquare(off));
  off.until(() => ROUTINE[off.st.routine].id !== 'rollCall', 62 * STEPS_PER_MINUTE);
  check(!off.st.lockdown, 'off the square to the end: no lockdown');
  check(
    off.events.some((e) => e.type === 'missed' && e.heat === MISSED_ROUTINE_HEAT && !!e.early && !!e.offSquare),
    `and +${MISSED_ROUTINE_HEAT}% heat, told it's the square`,
  );
  check(off.st.blocks[0] === BLOCK.LEFT, 'put down as left before counted');

  // Nowhere near it: the lockdown as ever.
  const gone = atMorning(7);
  put(gone, placesOf(gone.sim.world).seats[0].tile);
  gone.until(() => ROUTINE[gone.st.routine].id !== 'rollCall', 62 * STEPS_PER_MINUTE);
  check(
    gone.events.some((e) => e.type === 'missed' && e.heat === 100 && !e.early),
    'not in the yard at all: 100% heat, a lockdown',
  );
  console.log(
    `the square: the badge fills only there; off it to the end +${MISSED_ROUTINE_HEAT}% heat, no lockdown; not in the yard, a lockdown`,
  );
}

// ------------------------------------------------------------------ "Here!"
{
  const bot = atMorning(8);
  put(bot, square(bot));
  check(untilCalled(bot) && bot.st.calling > 0, 'called');
  check(canAnswer(bot.sim), 'the button says Here!');
  const heat = bot.st.heat;
  bot.act();
  check(bot.st.calling === 0 && bot.st.heat === heat, 'answered: no heat');
  check(bot.st.items.open < 0, 'the press does nothing else');
  const w = bot.st.guards[wardenOf(bot.sim)];
  bot.until(() => w.tasks[0] !== 0, 40);
  check(w.tasks[0] !== 0, 'the warden moves on at the answer');

  // No answer: +5%, once.
  const quiet = atMorning(9);
  put(quiet, square(quiet));
  quiet.st.heat = 0;
  check(untilCalled(quiet), 'called');
  quiet.until(() => quiet.st.calling === 0, 200);
  const misses = quiet.events.filter((e) => e.type === 'count' && e.what === 'missed');
  check(
    misses.length === 1 && quiet.st.heat >= COUNT_HEAT - 2 && quiet.st.heat <= COUNT_HEAT,
    `no answer: +${COUNT_HEAT}% (${quiet.st.heat})`,
  );
  quiet.until(() => false, 200);
  check(quiet.events.filter((e) => e.type === 'count' && e.what === 'missed').length === 1, 'once a block');

  // Off the square when called: 5 s to step on and answer.
  const late = atMorning(10);
  put(late, offSquare(late));
  check(untilCalled(late), 'called, in the yard');
  check(!canAnswer(late.sim), 'off the square: nothing to answer from');
  put(late, square(late));
  check(canAnswer(late.sim), 'stepped onto it in time: Here!');
  late.act();
  check(late.st.calling === 0 && !late.events.some((e) => e.type === 'count' && e.what === 'missed'), 'answered in time');

  // Not in the yard: the warden moves on, no heat for it.
  const away = atMorning(11);
  put(away, placesOf(away.sim.world).seats[0].tile);
  away.st.heat = 0;
  const w2 = away.st.guards[wardenOf(away.sim)];
  away.until(() => w2.mode === GUARD.COUNT && w2.tasks[0] !== 0, 60 * STEPS_PER_MINUTE);
  check(
    w2.tasks[0] !== 0 && away.st.calling === 0 && !away.events.some((e) => e.type === 'count' && (e.what === 'you' || e.what === 'missed')),
    'not in the yard when reached: not called on',
  );

  // Called, then gone from the yard: no charge for the call.
  const off = atMorning(12);
  put(off, square(off));
  check(untilCalled(off), 'called');
  put(off, placesOf(off.sim.world).seats[0].tile);
  off.until(() => false, 120);
  check(
    off.st.calling === 0 && !off.events.some((e) => e.type === 'count' && e.what === 'missed'),
    'gone from the yard: no heat for the call',
  );

  // Never tips into a chase.
  const hot = atMorning(13);
  put(hot, square(hot));
  check(untilCalled(hot), 'called');
  hot.st.heat = CHASE_HEAT - 2;
  hot.until(() => hot.st.calling === 0, 200);
  check(hot.st.heat < CHASE_HEAT, `a missed call stops short of a chase (${hot.st.heat})`);
  // With no room left under a chase: nothing added, nothing said.
  const top = atMorning(24);
  put(top, square(top));
  check(untilCalled(top), 'called');
  top.st.heat = CHASE_HEAT - 1;
  // (2.35: on the square, lying low, the heat cools while the call waits: kept at the top.)
  top.until(() => {
    top.st.heat = CHASE_HEAT - 1;
    return top.st.calling === 0;
  }, 200);
  check(!top.events.some((e) => e.type === 'count' && e.what === 'missed'), 'at the very top: not a +0%');

  // A box open when called: closed, so the button is there.
  const box = atMorning(14);
  put(box, square(box));
  box.until(() => box.st.guards[wardenOf(box.sim)].mode === GUARD.COUNT, 30 * STEPS_PER_MINUTE);
  box.st.items.open = 0;
  check(untilCalled(box), 'called with a box open');
  check(box.st.items.open < 0 && box.st.talk < 0, 'whatever was open is closed');

  // A knockout or a lockdown while called: no charge.
  const out = atMorning(15);
  put(out, square(out));
  check(untilCalled(out), 'called');
  out.st.ko = 400;
  out.until(() => false, 120);
  check(out.st.calling === 0 && !out.events.some((e) => e.type === 'count' && e.what === 'missed'), 'out cold when called: no charge');
  const shut = atMorning(16);
  put(shut, square(shut));
  check(untilCalled(shut), 'called');
  shut.st.lockdown = true;
  shut.until(() => false, 5);
  check(shut.st.calling === 0, 'a lockdown ends the call');
  console.log(
    `Here!: answered, no heat; unanswered +${COUNT_HEAT}%, once, short of a chase; 5 s to step on; not there, not called on; panels closed; nothing charged out cold, gone or in a lockdown`,
  );
}

// ------------------------------------------------------------------ the warden, interrupted
{
  // Out cold when it's due: no count, no charge.
  const down = atMorning(17);
  put(down, square(down));
  const k = wardenOf(down.sim);
  down.st.guards[k].ko = 2000;
  down.until(() => false, 59 * STEPS_PER_MINUTE);
  check(!down.events.some((e) => e.type === 'count'), 'the warden out cold: no count');
  check(down.st.attended && !down.st.lockdown, 'the player is still counted by the badge');

  // Sent to look at a noise mid-walk: back to the line afterwards, nobody called twice, off at the bell.
  const chased = atMorning(18);
  put(chased, square(chased));
  const w = chased.st.guards[k];
  const squares = placesOf(chased.sim.world).rollCall.length;
  chased.until(() => w.mode === GUARD.COUNT && w.tasks.length < squares - 2, 60 * STEPS_PER_MINUTE);
  check(w.mode === GUARD.COUNT, 'on the count');
  const left = w.tasks.length;
  sendToLook(w, tileAt(w.body.x, w.body.z));
  check(w.mode === GUARD.INVESTIGATE && w.resume === GUARD.COUNT, 'called off to look');
  chased.until(() => w.mode === GUARD.COUNT || ROUTINE[chased.st.routine].id !== 'rollCall', 20 * STEPS_PER_MINUTE);
  check(w.mode === GUARD.COUNT && w.tasks.length <= left, 'back to the line afterwards');
  chased.until(() => ROUTINE[chased.st.routine].id !== 'rollCall', 62 * STEPS_PER_MINUTE);
  chased.until(() => false, 20);
  const calls = chased.events.filter((e) => e.type === 'count' && (e.what === 'called' || e.what === 'you'));
  check(
    calls.length <= squares && new Set(calls.map((e) => (e.type === 'count' ? e.who : 0))).size === calls.length,
    `nobody called twice (${calls.length})`,
  );
  check(
    w.mode !== GUARD.COUNT &&
      chased.st.countDone === false &&
      chased.st.calling === 0 &&
      chased.st.yardSeen === false &&
      chased.st.countAt === 0,
    "the bell ends it: a new block's slate clean",
  );

  // Called away while the player is being called: the call lapses, nothing charged, not called again.
  const lapse = atMorning(19);
  put(lapse, square(lapse));
  check(untilCalled(lapse), 'called');
  const lw = lapse.st.guards[k];
  sendToLook(lw, tileAt(lw.body.x, lw.body.z));
  lapse.until(() => false, 300);
  check(
    lapse.st.calling === 0 && !lapse.events.some((e) => e.type === 'count' && e.what === 'missed'),
    'the warden called away: no charge',
  );
  check(lapse.events.filter((e) => e.type === 'count' && e.what === 'you').length === 1, 'and no second call');
  // Knocked out while calling: the same.
  const kod = atMorning(20);
  put(kod, square(kod));
  check(untilCalled(kod), 'called');
  kod.st.guards[k].ko = 200;
  kod.until(() => false, 400);
  check(!canAnswer(kod.sim) && !kod.events.some((e) => e.type === 'count' && e.what === 'missed'), 'the warden knocked out: no charge');
  check(kod.events.filter((e) => e.type === 'count' && e.what === 'you').length === 1, 'and no second call when it wakes');

  // Counted already: free to go, nothing to answer.
  const free = atMorning(23);
  put(free, square(free));
  free.st.guards[k].ko = 700;
  free.until(() => free.st.attended, 40 * STEPS_PER_MINUTE);
  check(free.st.attended, 'counted, the warden still out');
  put(free, offSquare(free));
  free.until(() => free.st.calling > 0 || ROUTINE[free.st.routine].id !== 'rollCall', 30 * STEPS_PER_MINUTE);
  check(
    free.st.calling === 0 && !free.events.some((e) => e.type === 'count' && (e.what === 'you' || e.what === 'missed')),
    'counted: not called on',
  );

  // A hole dug at a stop: on to the next, not held there.
  const holed = atMorning(26);
  const stop = placesOf(holed.sim.world).countStops[2].tile;
  holed.sim.world.guardBlock[stop] = 1;
  const hw = holed.st.guards[k];
  holed.until(() => holed.st.countDone && hw.mode !== GUARD.COUNT, 58 * STEPS_PER_MINUTE);
  check(hw.mode !== GUARD.COUNT, "a stop that can't be reached is passed over");
  holed.sim.world.guardBlock[stop] = 0;
  console.log(
    'the warden: out cold, no count and nothing charged; called away, back to the line with nobody called twice; a stop out of reach passed over; off with the bell, the slate clean',
  );
}

// ------------------------------------------------------------------ saves and older runs
{
  const bot = atMorning(21);
  put(bot, square(bot));
  check(untilCalled(bot), 'called');
  const snap: Snapshot = bot.sim.snapshot();
  const back = new Sim(CENTER_PERKS, 1);
  back.restore(snap);
  check(
    back.state.calling > 0 && back.state.countDone && back.state.guards[wardenOf(back)].mode === GUARD.COUNT,
    'a save keeps the call and the walk',
  );
  const old = JSON.parse(JSON.stringify(snap)) as Snapshot;
  for (const f of ['calling', 'countDone', 'yardSeen', 'countAt']) delete (old.state as unknown as Record<string, unknown>)[f];
  const was = new Sim(CENTER_PERKS, 1);
  was.restore(old);
  check(was.state.calling === 0 && was.state.countDone === false && was.state.yardSeen === false, 'a save from before loads with none');
  for (let k = 0; k < 40; k++) was.step(0);

  // Older runs: anywhere in the yard counts, the warden at the post, nobody called.
  const then = new Bot(CENTER_PERKS, 22);
  then.sim.rules226 = true;
  then.silent = true;
  check(then.routineUntil(2, MORNING), 'an older run');
  check(!squareNeeded(then.sim), 'older runs: no square needed');
  put(then, offSquare(then));
  then.until(() => false, 200);
  check(then.st.present > 0, 'older runs: anywhere in the yard counts');
  then.until(() => ROUTINE[then.st.routine].id !== 'rollCall', 62 * STEPS_PER_MINUTE);
  check(!then.events.some((e) => e.type === 'count') && then.st.calling === 0, 'older runs: nobody called');

  const was226 = new Sim(CENTER_PERKS, 24);
  was226.rules225 = false;
  was226.rules226 = true;
  was226.rules227 = true;
  was226.rules228 = true;
  was226.rules229 = true;
  was226.rules230 = true;
  was226.rules231 = true;
  was226.rules232 = true;
  was226.rules2331 = true;
  was226.rules233 = true;
  was226.rules234 = true;
  const prev = new RunRecorder(was226, { seed: 24, game: '2.26.0' });
  for (let k = 0; k < (1440 + 30) * STEPS_PER_MINUTE; k++) prev.step(0);
  check(new RunRecorder(prev.sim, { log: prev.toLog(), game: '2.35.0' }).toLog().seed === -1, 'a log from 2.26 is not carried on');
  const replayed = replayLog(prev.toLog(), CENTER_PERKS);
  check(!!replayed?.ok && replayed.sim.rules226 === true, 'and replays whole under the old rules');
  const now = new RunRecorder(new Sim(CENTER_PERKS, 25), { seed: 25, game: '2.35.0' });
  for (let k = 0; k < (1440 + 30) * STEPS_PER_MINUTE; k++) now.step(0);
  check(new RunRecorder(now.sim, { log: now.toLog(), game: '2.35.1' }).toLog().seed === 25, "a log of today's is carried on");
  const again = replayLog(now.toLog(), CENTER_PERKS);
  check(!!again?.ok && again.sim.rules226 === false, "and replays under today's");

  // Training is relaxed: its roll call asks nothing new.
  const t = new Bot(TRAINING, 1);
  t.routineUntil(2, MORNING);
  check(!squareNeeded(t.sim), 'Training needs no square');
  t.until(() => false, 60 * STEPS_PER_MINUTE);
  check(!t.events.some((e) => e.type === 'count'), 'Training has no count');
  console.log(
    'saves and older runs: the call kept; a save from before loads with none; a 2.26 log replays as it was and is not carried on; Training unchanged',
  );
}

// ------------------------------------------------------------------ text
for (const [name, k] of [
  ['en', en],
  ['fr', fr],
] as const) {
  for (const key of [
    'act.here',
    'routine.yourSquare',
    'routine.shakedown',
    'routine.shakedownYou',
    'toast.countCall',
    'toast.countMissed',
    'hint.rollCall',
  ] as const)
    check(!!k[key], `${name}: ${key}`);
  check((k['help.rollcall.steps'] ?? '').split('\n').length === 3, `${name}: three steps`);
}
