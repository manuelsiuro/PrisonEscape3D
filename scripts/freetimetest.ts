/**
 * Free time (2.39): every prison's places for a gathering (clear floor, reachable), inmates gathering over many seeds
 * and both free times (what kinds, how many at once, who never comes), none on day 1, at the Training Block, in a
 * lockdown, on a film night or in a run from before; a game joined by real commands (walked up to, the press, the talk
 * on that game, a game played), a chat that goes on without the one talked to and two left alone parting; the walk to
 * roll call from the far places against the time the 21:50 warning leaves; what free time opens, by prison.
 */
import { HUDDLE, HUDDLE_FROM_DAY, HUDDLE_SLOTS } from '../src/content/huddles';
import { DAY_EVENTS, WEATHERS } from '../src/content/days';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { TRAINING } from '../src/content/prisons/training';
import { isFloor, placesOf } from '../src/sim/ai/places';
import { command, dirFromVector, OP, TALK } from '../src/sim/command';
import { crowdPlan } from '../src/sim/systems/calendar';
import { gameRefusal } from '../src/sim/systems/games';
import { huddleGameOf, huddleOf, huddlesNow, ringsOf, seatHuddle } from '../src/sim/systems/huddles';
import { staysPut } from '../src/sim/systems/vending';
import { ROLL_CALL_WARNING, STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';
import { Bot } from './bots';

/** Up to someone and the press, until a talk opens (as tutorialtest's). */
function talkTo(bot: Bot, body: { x: number; z: number }, limit = 1500): boolean {
  for (let k = 0; k < limit; k++) {
    const dx = body.x - bot.st.player.x;
    const dz = body.z - bot.st.player.z;
    if (Math.hypot(dx, dz) > 2 * UNIT) {
      bot.pilot.goTo(Math.floor(body.z / UNIT) * MAP_W + Math.floor(body.x / UNIT));
      bot.step(command(bot.pilot.dir(bot.st.player)));
      continue;
    }
    bot.step(command(dirFromVector(dx, dz)));
    if (Math.hypot(dx, dz) > 1.15 * UNIT) continue;
    bot.act();
    if (bot.st.talk >= 0) return true;
  }
  return false;
}

/** A model prisoner's day up to a minute, then the crowd's own (the player standing still) for `minutes`. */
function idleFrom(bot: Bot, minutes: number, each: () => void, every = STEPS_PER_MINUTE) {
  for (let k = 0; k < minutes * STEPS_PER_MINUTE; k++) {
    bot.step();
    if (k % every === 0) each();
  }
}

// ------------------------------------------------------------------ the places
for (const def of PRISONS) {
  const bot = new Bot(def, 3);
  const w = bot.sim.world;
  const rings = ringsOf(w);
  check(rings.length >= 3, `${def.id}: at least three places to gather (${rings.length})`);
  for (const r of rings) {
    let clear = true;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const t = (r.z + dz) * MAP_W + r.x + dx;
        if (
          !isFloor(w, r.x + dx, r.z + dz) ||
          w.props.some((p) => r.x + dx >= p.x && r.x + dx < p.x + p.w && r.z + dz >= p.z && r.z + dz < p.z + p.d)
        )
          clear = false;
        if (w.ground.zone[t] !== w.ground.zone[r.z * MAP_W + r.x]) clear = false;
      }
    check(clear, `${def.id}: the place at ${r.x},${r.z} is clear floor of one zone`);
  }
  // Each reached on foot in the evening's free time, from the player's cell.
  bot.routineUntil(2, 18 * 60 + 1);
  for (const r of rings) check(bot.walkTo(r.z * MAP_W + r.x, 3000), `${def.id}: the place at ${r.x},${r.z} reached on foot`);
  console.log(`${def.id}: ${rings.length} places (${rings.map((r) => `${r.x},${r.z} ${w.zoneAt(r.x, r.z)}`).join('; ')})`);
}

// ------------------------------------------------------------------ the crowd gathering
for (const def of PRISONS) {
  const kinds = [0, 0, 0, 0];
  let formed = 0;
  let most = 0;
  let wrongful = 0;
  let samples = 0;
  let gathered = 0;
  let stalled = 0;
  for (const seed of [3, 4, 5]) {
    for (const [day, minute, length] of [
      [2, 10 * 60 + 1, 118],
      [2, 18 * 60 + 1, 238],
      [3, 18 * 60 + 1, 238],
    ] as const) {
      const bot = new Bot(def, seed);
      // (A quiet day: nothing taking the crowd elsewhere.)
      bot.st.calendar = [[day, DAY_EVENTS.indexOf('none'), WEATHERS.indexOf('clear')]];
      bot.routineUntil(day, minute);
      const seen = new Set<string>();
      const joined = new Map<string, number>();
      idleFrom(bot, length, () => {
        samples++;
        const v = huddlesNow(bot.sim);
        let now = 0;
        for (const g of v) {
          const key = `${g.slot}:${g.since}`;
          if (!seen.has(key)) {
            seen.add(key);
            formed++;
            kinds[g.kind]++;
            joined.set(key, bot.st.huddle!.who.slice(g.slot * 4, g.slot * 4 + 4).filter((k) => k >= 0).length);
          }
          now += g.who.length;
          for (const k of g.who) if (staysPut(bot.sim, k)) wrongful++;
        }
        gathered += now;
        most = Math.max(most, now);
        check(
          now <= Math.ceil(bot.st.inmates.filter((_, k) => !staysPut(bot.sim, k)).length / 2),
          `${def.id}: never more than half of those free to gather (${now})`,
        );
        check(v.length <= HUDDLE_SLOTS[minute < 18 * 60 ? 0 : 1], `${def.id}: no more gatherings than slots`);
      });
      // (Those sent who never got there: given up on.)
      for (const [, n] of joined) stalled += n < 2 ? 1 : 0;
    }
  }
  check(formed > 0, `${def.id}: inmates gather`);
  check(stalled === 0, `${def.id}: everyone sent gets to their place (${stalled} gave up)`);
  check(wrongful === 0, `${def.id}: no merchant, fixer or librarian leaves their post for one`);
  console.log(
    `${def.id}: ${formed} gatherings over 9 free times (chat ${kinds[0]}, dice ${kinds[1]}, cards ${kinds[2]}, hoops ${kinds[3]}), ${(gathered / samples).toFixed(1)} gathered on average, ${most} at most`,
  );
}

// ------------------------------------------------------------------ when there are none
{
  const day1 = new Bot(CENTER_PERKS, 3);
  day1.routineUntil(1, 21 * 60 + 59);
  check(!day1.st.huddle, `none before day ${HUDDLE_FROM_DAY} (the escape bots' day)`);
  const train = new Bot(TRAINING, 3);
  train.routineUntil(2, 21 * 60);
  check(!train.st.huddle, 'none at the Training Block');
  const old = new Bot(CENTER_PERKS, 3);
  old.sim.rules238 = true;
  old.routineUntil(2, 21 * 60);
  check(!old.st.huddle, 'none in a run from before 2.39 (Sim.rules238)');
  const film = new Bot(CENTER_PERKS, 3);
  film.st.calendar = [[2, DAY_EVENTS.indexOf('movie'), WEATHERS.indexOf('clear')]];
  film.routineUntil(2, 18 * 60 + 1);
  let during = 0;
  let shown = 0;
  idleFrom(film, 200, () => {
    if (crowdPlan(film.sim, film.st.routine) === film.st.routine) return;
    shown++;
    during += huddlesNow(film.sim).length;
  });
  check(shown > 0 && during === 0, `none while a film is on (the crowd at the screen: ${shown} minutes)`);
  const locked = new Bot(CENTER_PERKS, 4);
  locked.st.calendar = [[2, DAY_EVENTS.indexOf('none'), WEATHERS.indexOf('clear')]];
  locked.routineUntil(2, 18 * 60 + 1);
  seatHuddle(
    locked.sim,
    0,
    HUDDLE.CHAT,
    0,
    locked.st.inmates
      .map((_, k) => k)
      .filter((k) => !staysPut(locked.sim, k))
      .slice(0, 3),
  );
  locked.st.lockdown = true;
  locked.step();
  check(huddlesNow(locked.sim).length === 0, 'a lockdown breaks them up at once');
  console.log('none on day 1, at the Training Block, in an older run, on a film night or in a lockdown');
}

// ------------------------------------------------------------------ the player joining
{
  const bot = new Bot(CENTER_PERKS, 6);
  bot.st.calendar = [[2, DAY_EVENTS.indexOf('none'), WEATHERS.indexOf('clear')]];
  bot.routineUntil(2, 18 * 60 + 1);
  const free = bot.st.inmates.map((_, k) => k).filter((k) => !staysPut(bot.sim, k));
  const [a, b] = free;
  for (const k of [a, b]) bot.st.inmates[k].opinion = 55;
  bot.st.cash = 20;
  seatHuddle(bot.sim, 0, HUDDLE.DICE, 0, [a, b]);
  bot.step();
  check(huddleGameOf(bot.sim, a) === HUDDLE.DICE && huddleGameOf(bot.sim, b) === HUDDLE.DICE, 'two at dice: a game on');
  check(gameRefusal(bot.sim, a) === null, '…and one of them will play the player');
  const e0 = bot.events.length;
  check(talkTo(bot, bot.st.inmates[a].body) && bot.st.talk === a, 'walked up to one and pressed: a talk');
  const joined = bot.events.slice(e0).find((e) => e.type === 'huddle');
  check(joined?.type === 'huddle' && joined.kind === HUDDLE.DICE && joined.who === a, '…that joins their game (the talk offers dice)');
  bot.step();
  check(huddleOf(bot.sim, a) < 0 && huddleOf(bot.sim, b) < 0, 'the one talked to leaves it, and the other, alone, goes too');
  bot.op(OP.TALK, TALK.DICE, 0);
  check(bot.st.dice.length > 0, 'and a game of dice with them starts');
  bot.op(OP.TALK, TALK.REROLL, 0);
  bot.close();
  // A chat of three goes on without the one talked to.
  const [c, d, e] = free.slice(2, 5).length === 3 ? free.slice(2, 5) : free.slice(0, 3);
  seatHuddle(bot.sim, 1, HUDDLE.CHAT, 1, [c, d, e]);
  bot.step();
  const e1 = bot.events.length;
  check(talkTo(bot, bot.st.inmates[c].body) && bot.st.talk === c, 'up to someone in a chat: a talk');
  bot.step();
  check(huddleOf(bot.sim, c) < 0 && huddleOf(bot.sim, d) === 1 && huddleOf(bot.sim, e) === 1, 'the chat goes on without them');
  check(!bot.events.slice(e1).some((ev) => ev.type === 'huddle'), "a chat isn't a game joined");
  bot.close();
  console.log('a game joined by walking up and pressing, a game of dice played; a chat goes on without the one talked to');
}

// ------------------------------------------------------------------ joining at the hoop
for (const def of PRISONS) {
  // Walked up to from across the yard (the game goes on as the player comes: it's joined, not broken up by the walk).
  const bot = new Bot(def, 6);
  bot.st.calendar = [[2, DAY_EVENTS.indexOf('none'), WEATHERS.indexOf('clear')]];
  bot.routineUntil(2, 18 * 60 + 1);
  const [a, b] = bot.st.inmates.map((_, k) => k).filter((k) => !staysPut(bot.sim, k));
  for (const k of [a, b]) bot.st.inmates[k].opinion = 55;
  seatHuddle(bot.sim, 0, HUDDLE.HOOPS, -1, [a, b]);
  bot.step();
  check(huddleGameOf(bot.sim, a) === HUDDLE.HOOPS, `${def.id}: two at the hoop: a game on`);
  const e0 = bot.events.length;
  check(talkTo(bot, bot.st.inmates[a].body) && bot.st.talk === a, `${def.id}: walked up to one at the hoop: a talk`);
  const joined = bot.events.slice(e0).find((e) => e.type === 'huddle');
  check(joined?.type === 'huddle' && joined.kind === HUDDLE.HOOPS, `${def.id}: …that joins the game at the hoop`);
  bot.close();
}
{
  console.log('the hoop: walked up to and joined in every prison');
}

// ------------------------------------------------------------------ the walk to roll call after the warning
{
  // From 21:50, the player must be on their square long enough by 23:00 (30 of its 60 minutes): by 22:30.
  const left = (22 * 60 + 30 - ROLL_CALL_WARNING) * STEPS_PER_MINUTE;
  const rows: string[] = [];
  for (const def of PRISONS) {
    const bot = new Bot(def, 3);
    bot.st.calendar = [[2, DAY_EVENTS.indexOf('none'), WEATHERS.indexOf('clear')]];
    bot.routineUntil(2, 18 * 60 + 1);
    const square = placesOf(bot.sim.world).rollCall[0].tile;
    // From each place to gather, and the first and last free floor tile of every zone.
    const fl = placesOf(bot.sim.world).floor;
    const starts = [
      ...ringsOf(bot.sim.world).map((r) => r.z * MAP_W + r.x),
      ...fl.flatMap((list) => (list.length ? [list[0], list[list.length - 1]] : [])),
    ];
    let worst = 0;
    const snap = bot.sim.snapshot();
    for (const t of starts) {
      bot.sim.restore(snap);
      const p = bot.st.player;
      p.x = (t % MAP_W) * UNIT + UNIT / 2;
      p.z = Math.floor(t / MAP_W) * UNIT + UNIT / 2;
      const from = bot.st.step;
      if (!bot.walkTo(square, 3000)) continue;
      worst = Math.max(worst, bot.st.step - from);
    }
    check(worst < left, `${def.id}: from anywhere free time goes, the square in time after the warning (${worst} of ${left} steps)`);
    rows.push(`${def.id} ${Math.round(worst / STEPS_PER_MINUTE)} min`);
  }
  console.log(`the walk to roll call at worst (of ${left / STEPS_PER_MINUTE} game minutes from the warning): ${rows.join(', ')}`);
}

console.log('free time ok');
