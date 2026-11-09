/**
 * Meals at the serving counter (2.25, systems/canteen.ts): the tray taken, carried in both hands,
 * eaten at a table, carried back; what loses it; a table with no tray; older runs and a prison with
 * no counter as they were; and the inmates' own round in every prison.
 */
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { TRAINING } from '../src/content/prisons/training';
import { ROUTINE } from '../src/content/routine';
import { placesOf, type Spot } from '../src/sim/ai/places';
import { pathTo } from '../src/sim/ai/path';
import { OP } from '../src/sim/command';
import { RunRecorder, replayLog } from '../src/sim/runlog';
import { Sim, type Snapshot } from '../src/sim/Sim';
import { DECOR } from '../src/content/decor';
import { counterTray, eatingNow, handsBusy, mealOn, mealSteps, trayOffer, traysHere } from '../src/sim/systems/canteen';
import { DOING, stepInmates, TRAY } from '../src/sim/systems/inmates';
import { socialNow } from '../src/sim/systems/social';
import { itemOf, slot } from '../src/sim/systems/items';
import {
  CHASE_HEAT,
  MEAL_ENERGY,
  MEAL_STEPS,
  MEAL_STEPS_224,
  STEPS_PER_MINUTE,
  TRAY_GRACE_STEPS,
  TRAY_HEAT,
  UNIT,
} from '../src/sim/tuning';
import { containersOf } from '../src/sim/world/containers';
import { tileAt } from '../src/sim/world/grid';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';
import { Bot, n } from './bots';

const at = (bot: Bot, spot: Spot) => {
  const p = bot.st.player;
  p.x = (spot.tile % MAP_W) * UNIT + UNIT / 2;
  p.z = Math.floor(spot.tile / MAP_W) * UNIT + UNIT / 2;
  p.moving = false;
  p.facing = spot.face;
};
/** In the canteen at a meal, the crowd settled on its way. */
function atBreakfast(seed = 3, prison = CENTER_PERKS) {
  const bot = new Bot(prison, seed);
  check(bot.routineUntil(1, 9 * 60 + 2), 'breakfast');
  check(ROUTINE[bot.st.routine].id === 'breakfast', 'it is breakfast');
  return bot;
}
const counterOf = (bot: Bot) => containersOf(bot.sim.world).findIndex((c) => c.table === 'canteenCounter');
const freeSeat = (bot: Bot) =>
  placesOf(bot.sim.world).seats.find(
    (s) => !bot.st.inmates.some((m) => m.goal === s.tile || m.seat === s.tile || tileAt(m.body.x, m.body.z) === s.tile),
  )!;

// ------------------------------------------------------------------ the whole meal
{
  const bot = atBreakfast();
  const places = placesOf(bot.sim.world);
  const counter = counterOf(bot);
  check(counter >= 0 && places.counters.length > 0, 'Center Perks serves from a counter');
  check(traysHere(bot.sim) && mealSteps(bot.sim) === MEAL_STEPS, 'trays here, six seconds to eat');

  // A table with no tray: a rest, no meal.
  at(bot, freeSeat(bot));
  bot.st.energy = 20;
  bot.act();
  check(bot.st.seat >= 0, 'sat at a table with no tray');
  bot.until(() => false, MEAL_STEPS + 5);
  check(bot.st.eaten === 0 && bot.st.energy < 20 + MEAL_ENERGY, 'no tray, no meal');
  bot.act();

  // At the counter: the tray at the first press, the search at the next.
  at(bot, places.counters[0]);
  check(trayOffer(bot.sim, counter) === 'take', 'the counter offers a tray');
  bot.act();
  check(bot.st.tray === TRAY.FULL, 'the tray in both hands');
  check(bot.st.items.open < 0, 'taking a tray opens nothing');
  check(trayOffer(bot.sim, counter) === null, 'one tray at a time');
  const free = bot.st.items.inv.filter((v) => !v).length;
  bot.act();
  check(bot.st.items.open === counter, 'the counter searched at the next press');
  check(bot.st.items.inv.filter((v) => !v).length === free, 'the tray takes no slot');
  bot.close();

  // Carried to the table: eaten sitting down, in six seconds, once.
  at(bot, freeSeat(bot));
  bot.st.energy = 20;
  bot.act();
  check(bot.st.seat >= 0, 'sat down with the tray');
  const e0 = bot.st.energy;
  bot.until(() => bot.st.eaten >= MEAL_STEPS, MEAL_STEPS + 2);
  check(bot.st.eaten === MEAL_STEPS, `eaten in ${MEAL_STEPS} steps`);
  check(bot.st.tray === TRAY.EMPTY, 'the tray is empty');
  const gain = bot.st.energy - e0;
  check(gain >= MEAL_ENERGY + 9 && gain <= MEAL_ENERGY + 14, `+${gain} energy (the meal and the sit)`);
  const fed = bot.st.energy;
  bot.until(() => false, 26);
  check(bot.st.energy <= fed + 3, 'no second meal from the same tray');

  // Up, and back to the counter with it.
  bot.act();
  check(bot.st.seat < 0 && bot.st.tray === TRAY.EMPTY, 'up, the empty tray in hand');
  at(bot, places.counters[0]);
  check(trayOffer(bot.sim, counter) === 'return', 'the counter takes it back');
  bot.act();
  check(bot.st.tray === TRAY.NONE, 'the tray given back');
  check(trayOffer(bot.sim, counter) === null, 'one tray a meal');
  bot.act();
  check(bot.st.items.open === counter, 'the counter searched as ever');
  console.log(
    `a meal: no tray no meal; ${MEAL_STEPS / 20} s at the table, +${MEAL_ENERGY} energy; a tray at the first press, the search at the next; back to the counter empty`,
  );
}

// ------------------------------------------------------------------ what loses it
{
  const withTray = (seed: number) => {
    const bot = atBreakfast(seed);
    at(bot, placesOf(bot.sim.world).counters[0]);
    bot.act();
    check(bot.st.tray === TRAY.FULL, 'the tray in hand');
    return bot;
  };

  // Empty hands, a press of the tool button: nothing done, nothing dropped.
  const idle = withTray(11);
  idle.op(OP.USE, 1);
  check(idle.st.tray === TRAY.FULL, 'a press that does nothing keeps the tray');
  // Refused: nothing done with them.
  const full = withTray(18);
  full.st.items.inv[0] = slot(n('chocolate'));
  full.hold('chocolate');
  full.st.energy = 100;
  full.op(OP.USE, 1);
  check(
    full.st.tray === TRAY.FULL && itemOf(full.st.items.inv[0]) === n('chocolate'),
    'a press refused keeps the tray (chocolate at full energy)',
  );
  // A chocolate eaten: the hands were busy.
  const busy = withTray(12);
  busy.st.items.inv[0] = slot(n('chocolate'));
  busy.hold('chocolate');
  busy.st.energy = 50;
  busy.op(OP.USE, 1);
  check(busy.st.tray === TRAY.NONE, 'what the hands do with something else lets it fall');
  // Out of the door: left behind.
  const left = withTray(13);
  at(left, { tile: placesOf(left.sim.world).bedside[1], face: 5 });
  left.step();
  check(left.st.tray === TRAY.NONE, 'out of the canteen, the tray stays behind');
  // A knockout.
  const ko = withTray(14);
  ko.st.ko = 100;
  ko.step();
  check(ko.st.tray === TRAY.NONE, 'knocked out, the tray falls');
  // A lockdown stops the serving; so does the end of the meal.
  const down = withTray(15);
  down.st.lockdown = true;
  down.step();
  check(down.st.tray === TRAY.NONE, 'a lockdown takes it');
  const over = withTray(16);
  over.until(() => ROUTINE[over.st.routine].id !== 'breakfast', 60 * STEPS_PER_MINUTE);
  check(ROUTINE[over.st.routine].id !== 'breakfast' && over.st.tray === TRAY.NONE, "the meal's end takes it");
  console.log(
    'lost: a press that does something, leaving the canteen, a knockout, a lockdown, the end of the meal; kept by a press that does nothing',
  );

  // A new meal starts clean: a tray again.
  const next = withTray(17);
  const counter = counterOf(next);
  next.until(() => ROUTINE[next.st.routine].id === 'dinner', 10 * 60 * STEPS_PER_MINUTE);
  at(next, placesOf(next.sim.world).counters[0]);
  check(!next.st.lockdown ? trayOffer(next.sim, counter) === 'take' : true, 'dinner offers a tray again');
}

// ------------------------------------------------------------------ a tray not brought back
{
  const leave = (bot: Bot) => {
    at(bot, { tile: placesOf(bot.sim.world).bedside[1], face: 5 });
    bot.step();
  };
  const taken = (seed: number) => {
    const bot = atBreakfast(seed);
    at(bot, placesOf(bot.sim.world).counters[0]);
    bot.act();
    bot.st.heat = 0;
    return bot;
  };
  const eaten = (seed: number) => {
    const bot = taken(seed);
    bot.st.eaten = MEAL_STEPS;
    bot.st.tray = TRAY.EMPTY;
    bot.st.trayDone = bot.st.step;
    return bot;
  };
  // Walked out with it, full or empty.
  const full = taken(91);
  leave(full);
  check(
    full.st.tray === TRAY.NONE && full.st.heat === 0,
    `out with it full (it came with a search of the counter): nothing (${full.st.heat})`,
  );
  const empty = eaten(92);
  leave(empty);
  check(empty.st.heat === TRAY_HEAT, `out with it empty: +${TRAY_HEAT}% (${empty.st.heat})`);
  // Brought back: nothing owed, wherever they go next.
  const good = eaten(93);
  at(good, placesOf(good.sim.world).counters[0]);
  good.act();
  check(good.st.tray === TRAY.NONE, 'brought back');
  leave(good);
  check(good.st.heat === 0, 'brought back: no heat');
  // The meal's end: an empty tray held on.
  const lastBell = (bot: Bot) => {
    bot.until(() => !mealOn(bot.sim), 70 * STEPS_PER_MINUTE);
    return bot.st.heat;
  };
  const held = eaten(94);
  held.st.heat = 0;
  const heldHeat = lastBell(held);
  check(heldHeat >= TRAY_HEAT - 1 && heldHeat <= TRAY_HEAT, `still in hand at the meal's end: +${TRAY_HEAT}% (${heldHeat})`);
  // A full tray at the end (no time to eat it), and one finished with no time to walk it back: let off.
  const late = taken(95);
  check(lastBell(late) === 0, "a full tray at the meal's end: nothing");
  const finished = eaten(96);
  finished.until(
    () => ROUTINE[finished.st.routine].id === 'breakfast' && finished.sim.clock.minuteOfDay >= 9 * 60 + 58,
    70 * STEPS_PER_MINUTE,
  );
  finished.st.trayDone = finished.st.step;
  finished.st.heat = 0;
  check(lastBell(finished) === 0, "eaten in the meal's last minutes: let off");
  // Dropped: no bill. A lockdown: none either.
  const dropped = taken(97);
  dropped.st.ko = 100;
  dropped.step();
  check(dropped.st.heat === 0, 'knocked out with it: nothing');
  const down = eaten(98);
  down.st.lockdown = true;
  down.st.heat = 0;
  down.step();
  check(down.st.tray === TRAY.NONE && down.st.heat === 0, 'a lockdown: nothing');
  // Never what starts a chase.
  const high = eaten(99);
  high.st.heat = CHASE_HEAT - 3;
  leave(high);
  check(high.st.heat === CHASE_HEAT - 1 && !high.st.lockdown, `near the line it stops short of a chase (${high.st.heat})`);
  const over = eaten(100);
  over.st.heat = CHASE_HEAT + 5;
  leave(over);
  check(over.st.heat === CHASE_HEAT + 5, 'already past the line: nothing added');
  for (const text of [en['help.meals.warn'], fr['help.meals.warn']])
    check(new RegExp(`\\+${TRAY_HEAT}\\s?%`).test(text ?? ''), 'How to play says what it costs');
  console.log(
    `not brought back: +${TRAY_HEAT}% heat for walking out with it eaten or holding it at the end; let off when full, dropped, finished in the last ${TRAY_GRACE_STEPS / STEPS_PER_MINUTE} minutes or in a lockdown; never past ${CHASE_HEAT - 1}%`,
  );
}

// ------------------------------------------------------------------ saves
{
  const bot = atBreakfast(21);
  at(bot, placesOf(bot.sim.world).counters[0]);
  bot.act();
  const snap = JSON.parse(JSON.stringify(bot.sim.snapshot())) as Snapshot;
  const back = new Sim(CENTER_PERKS, 9);
  back.restore(snap);
  check(back.state.tray === TRAY.FULL, 'a save holds the tray');
  check(back.hash() === bot.sim.hash(), 'and hashes the same');
  // From before the counter: no tray in hand, nobody's seat kept.
  const old = JSON.parse(JSON.stringify(snap)) as { state: Record<string, unknown> & { inmates: Array<Record<string, unknown>> } };
  delete old.state.tray;
  for (const m of old.state.inmates) {
    delete m.tray;
    delete m.seat;
    delete m.seatFace;
  }
  const was = new Sim(CENTER_PERKS, 9);
  old.state.eaten = MEAL_STEPS_224;
  was.restore(old as unknown as Snapshot);
  check(was.state.eaten === MEAL_STEPS, 'a meal eaten before the save stays eaten');
  check(
    was.state.tray === TRAY.NONE && was.state.inmates.every((m) => m.tray === TRAY.NONE && m.seat === -1),
    'a save from before loads with none',
  );
  for (let k = 0; k < 40; k++) was.step(0);
  console.log('saves: the tray kept; a save from before loads with none');
}

// ------------------------------------------------------------------ older runs, and a prison with no counter
{
  const bot = new Bot(CENTER_PERKS, 31);
  bot.sim.rules224 = true;
  check(bot.routineUntil(1, 9 * 60 + 25), 'breakfast');
  check(!traysHere(bot.sim) && mealSteps(bot.sim) === MEAL_STEPS_224, 'older runs: no trays, three seconds');
  check(
    bot.st.inmates.every((m) => m.tray === TRAY.NONE && m.seat === -1),
    'older runs: no inmate fetches one',
  );
  check(
    bot.st.inmates.some((m) => m.doing === DOING.EAT),
    'older runs: straight to their seats',
  );
  at(bot, freeSeat(bot));
  bot.act();
  bot.until(() => bot.st.eaten >= MEAL_STEPS_224, MEAL_STEPS_224 + 2);
  check(bot.st.eaten === MEAL_STEPS_224 && bot.st.tray === TRAY.NONE, 'older runs: the tray is just there');

  // A run saved before 2.25 and played on: a log of its own from here, since it plays on under the new rules.
  const old = new RunRecorder(new Sim(CENTER_PERKS, 32), { seed: 32, game: '2.24.0' });
  for (let k = 0; k < 40; k++) old.step(0);
  const log = old.toLog();
  check(new RunRecorder(old.sim, { log, game: '2.36.0' }).toLog().seed === -1, 'a log from 2.24 is not carried on');
  const now = new RunRecorder(new Sim(CENTER_PERKS, 33), { seed: 33, game: '2.37.0' });
  for (let k = 0; k < 40; k++) now.step(0);
  check(new RunRecorder(now.sim, { log: now.toLog(), game: '2.37.0' }).toLog().seed === 33, 'a log from today is');
  // (Played under today's rules, a log of today's replays whole.)
  const again = replayLog(now.toLog(), CENTER_PERKS);
  check(!!again?.ok, 'and replays whole');

  const sim = new Sim(TRAINING, 1);
  check(!traysHere(sim), 'Training has no counter: its table serves');
  console.log('as they were: runs logged before 2.25; Training has no counter');
}

// ------------------------------------------------------------------ hands, a film, and an inmate out of the round
{
  const withTray = (seed: number) => {
    const bot = atBreakfast(seed);
    at(bot, placesOf(bot.sim.world).counters[0]);
    bot.act();
    return bot;
  };
  // Whatever takes both hands.
  const st0 = withTray(51).st;
  check(!handsBusy(st0), 'hands free with a tray');
  const busy = {
    dice: [0, 0, 1, 1],
    bout: [0, 50, 1, 0],
    pick: [1, 0, 0],
    shot: [0, 0],
    train: 3,
    cheat: {},
    shootout: {},
    board: { seated: true },
    match: {},
    ink: {},
    show: {},
    quiz: {},
    call: {},
  };
  for (const [field, value] of Object.entries(busy))
    check(handsBusy({ ...st0, [field]: value } as typeof st0), `${field}: both hands busy`);
  // Talking keeps it; so does the panel.
  const chat = withTray(53);
  chat.st.talk = 0;
  chat.step();
  check(chat.st.tray === TRAY.FULL, 'a talk keeps the tray');
  // An inmate knocked out or led off gives its seat up.
  const out = atBreakfast(54);
  out.until(() => out.st.inmates.some((m) => m.seat >= 0), 400);
  const m = out.st.inmates.find((q) => q.seat >= 0)!;
  m.ko = 200;
  out.step();
  check(m.seat === -1 && m.tray === TRAY.NONE, 'out cold: its seat is free, its tray gone');
  // Recruited at the table: off at once, not when its tray would have been done.
  const led = atBreakfast(56);
  led.until(() => led.st.inmates.some((q) => q.doing === DOING.EAT && q.wait > 40), 900);
  const r = led.st.inmates.find((q) => q.doing === DOING.EAT && q.wait > 40)!;
  r.opinion = 100;
  led.st.followers = [led.st.inmates.indexOf(r)];
  led.step();
  check(r.wait === 0 && r.tray === TRAY.NONE, 'a recruit at the table leaves at once');
  // Picking a fight, then calmed from outside (the player down, or caught): the meal fetched afresh, nobody left standing at the counter.
  const fight = atBreakfast(55);
  fight.until(() => fight.st.inmates.some((q) => q.tray === TRAY.FULL), 800);
  const f = fight.st.inmates.find((q) => q.tray === TRAY.FULL)!;
  f.angry = 100;
  fight.step();
  check(f.tray === TRAY.NONE && f.seat === -1, 'angry: the tray gone');
  f.angry = 0;
  fight.until(() => f.tray === TRAY.FULL && f.seat >= 0, 600);
  check(f.tray === TRAY.FULL && f.seat >= 0, 'calm again: a tray fetched afresh');
}
{
  // On film and talent nights the crowd sits down on dinner's plan: no meal, no tray, nobody at the counter.
  const bot = new Bot(CENTER_PERKS, 61);
  bot.routineUntil(1, 18 * 60 + 5);
  const dinner = ROUTINE.findIndex((r) => r.id === 'dinner');
  const social = { follow: [], gap: [], talk: -1, work: [], seat: -1, scare: [], doing: [], serve: socialNow(bot.sim).serve };
  check(!mealOn(bot.sim) && !social.serve, 'after dinner the counter is shut');
  for (let k = 0; k < 40 * STEPS_PER_MINUTE; k++) stepInmates(bot.sim.world, bot.st.inmates, dinner, bot.st, [], bot.st.step, null, social);
  check(
    bot.st.inmates.every((m) => m.tray === TRAY.NONE && m.seat === -1),
    'a film night fetches no trays',
  );
  check(bot.st.inmates.filter((m) => m.doing === DOING.EAT).length >= bot.st.inmates.length - 1, 'they sit down all the same');
  console.log('a film or the acts: the crowd sits down with no tray');
}

// ------------------------------------------------------------------ every prison, every place, walked
for (const prison of PRISONS) {
  const places0 = placesOf(new Sim(prison, 1).world);
  // The places along the counter, and nothing standing on them.
  const onFloor = new Set<number>();
  for (const d of prison.decor ?? []) {
    if (DECOR[d.kind].wall) continue;
    for (let z = d.z; z < d.z + (d.d ?? 1); z++) for (let x = d.x; x < d.x + (d.w ?? 1); x++) onFloor.add(z * MAP_W + x);
  }
  const blocked = places0.counters.filter((q) => onFloor.has(q.tile));
  check(!blocked.length, `${prison.id}: nothing stands on a place at the counter (${blocked.map((q) => q.tile)})`);

  // Each place at the counter serves: faced, the action button takes a tray; each seat eats.
  const early = new Bot(prison, 71);
  check(early.routineUntil(1, 9 * 60), `${prison.id}: to breakfast`);
  const counter = counterOf(early);
  let served = 0;
  for (const q of placesOf(early.sim.world).counters) {
    at(early, q);
    if (trayOffer(early.sim, counter) !== 'take' || counterTray(early.sim) !== 'take') continue;
    early.act();
    if (early.st.tray === TRAY.FULL) served++;
    early.st.tray = TRAY.NONE;
  }
  check(served === places0.counters.length, `${prison.id}: every place at the counter serves (${served}/${places0.counters.length})`);
  let sat = 0;
  let kept = 0;
  early.st.tray = TRAY.FULL;
  for (const q of placesOf(early.sim.world).seats) {
    if (early.st.inmates.some((m) => m.seat === q.tile || m.goal === q.tile || tileAt(m.body.x, m.body.z) === q.tile)) {
      kept++;
      continue;
    }
    at(early, q);
    early.st.eaten = 0;
    early.act();
    if (early.st.seat >= 0 && eatingNow(early.sim)) sat++;
    early.st.player.moving = false;
    early.st.seat = -1;
  }
  check(sat + kept === places0.seats.length, `${prison.id}: every seat at a table eats (${sat} + ${kept} kept/${places0.seats.length})`);

  // The whole meal, walked through the crowd by the real commands, from wherever roll call ends.
  const bot = new Bot(prison, 81);
  check(bot.routineUntil(1, 9 * 60), `${prison.id}: walking to breakfast`);
  const w = bot.sim.world;
  const places = placesOf(w);
  const near = (from: number, spots: readonly Spot[]) =>
    [...spots].sort(
      (a, b) =>
        Math.abs((a.tile % MAP_W) - (from % MAP_W)) +
        Math.abs(Math.floor(a.tile / MAP_W) - Math.floor(from / MAP_W)) -
        (Math.abs((b.tile % MAP_W) - (from % MAP_W)) + Math.abs(Math.floor(b.tile / MAP_W) - Math.floor(from / MAP_W))),
    );
  const t0 = bot.st.step;
  const goTo = (spot: Spot, why: string) => {
    check(bot.walkTo(spot.tile), `${prison.id}: ${why}: walked to tile ${spot.tile}`);
    bot.face(spot.face);
  };
  const pick = near(bot.tile, places.counters)[0];
  goTo(pick, 'to the counter');
  bot.act();
  check(bot.st.tray === TRAY.FULL, `${prison.id}: a tray taken in the crowd`);
  const seatFree = () =>
    near(bot.tile, places.seats).find(
      (q) => !bot.st.inmates.some((m) => m.seat === q.tile || m.goal === q.tile || tileAt(m.body.x, m.body.z) === q.tile),
    )!;
  goTo(seatFree(), 'to a table');
  check(bot.st.tray === TRAY.FULL, `${prison.id}: the tray carried across the room`);
  bot.act();
  // (Someone came and took the seat on the way: the next.)
  for (let k = 0; k < 4 && bot.st.seat < 0; k++) {
    goTo(seatFree(), 'to another table');
    bot.act();
  }
  check(bot.st.seat >= 0, `${prison.id}: sat down with it`);
  const before = bot.st.energy;
  bot.until(() => bot.st.tray === TRAY.EMPTY, MEAL_STEPS + 4);
  check(bot.st.tray === TRAY.EMPTY && bot.st.energy >= Math.min(100, before + MEAL_ENERGY), `${prison.id}: eaten`);
  bot.act();
  goTo(near(bot.tile, places.counters)[0], 'back to the counter');
  check(bot.st.tray === TRAY.EMPTY && !!counterTray(bot.sim), `${prison.id}: at the counter with it empty`);
  bot.act();
  check(bot.st.tray === TRAY.NONE, `${prison.id}: given back`);
  check(ROUTINE[bot.st.routine].id === 'breakfast', `${prison.id}: all within the hour`);
  console.log(
    `${prison.id}: ${places.counters.length} places at the counter, ${places.seats.length} seats; the meal walked in ${Math.round((bot.st.step - t0) / STEPS_PER_MINUTE)} of its 60 minutes`,
  );
}

// ------------------------------------------------------------------ the inmates' round
const SEEDS = [41, 42, 43];
for (const prison of PRISONS)
  for (const seed of SEEDS) {
    const bot = new Bot(prison, seed);
    const w = bot.sim.world;
    const places = placesOf(w);
    check(places.counters.length > 0, `${prison.id}: a serving counter to fetch from`);
    // The food shows on it, the place along it can be walked to from the door.
    const food = (prison.decor ?? []).filter((d) => d.kind === 'trays');
    check(food.length === 1, `${prison.id}: its trays on one counter (${food.length})`);
    check(
      food.every((d) => w.props.some((p) => p.kind === 'counter' && p.x === d.x && p.z === d.z && w.zoneAt(p.x, p.z) === 'canteen')),
      `${prison.id}: the food stands on the canteen's serving counter`,
    );
    const from = places.seats[0].tile;
    for (const s of places.counters)
      check(pathTo(w, from, s.tile, undefined, w.npcBlock) !== null, `${prison.id}: tile ${s.tile} by the counter in reach`);
    // Watched through a meal, from wherever the player is (they keep the routine).
    check(bot.routineUntil(1, 9 * 60), `${prison.id}: to breakfast`);
    const n = bot.st.inmates.length;
    const fetched = new Set<number>();
    const ate = new Set<number>();
    const back = new Set<number>();
    let overlapped = 0;
    let pressed = 0;
    let lastBack = 0;
    const start = bot.st.step;
    bot.keepRoutine(() => {
      bot.st.inmates.forEach((m, k) => {
        if (m.doing === DOING.SERVE && m.tray === TRAY.NONE) fetched.add(k);
        if (m.doing === DOING.EAT && m.tray === TRAY.FULL) ate.add(k);
        if (m.doing === DOING.SIT && m.tray === TRAY.NONE && ate.has(k) && !back.has(k)) {
          back.add(k);
          lastBack = bot.st.step;
        }
      });
      const onSpot = bot.st.inmates.filter((m) => m.doing === DOING.SERVE).map((m) => tileAt(m.body.x, m.body.z));
      if (new Set(onSpot).size < onSpot.length) overlapped++;
      // People on their feet in each other's bodies.
      const up = bot.st.inmates.filter(
        (q) =>
          q.doing !== DOING.EAT &&
          q.doing !== DOING.SIT &&
          bot.sim.world.zoneAt(Math.floor(q.body.x / UNIT), Math.floor(q.body.z / UNIT)) === 'canteen',
      );
      for (let i = 0; i < up.length; i++)
        for (let j = 0; j < i; j++) if (Math.abs(up[i].body.x - up[j].body.x) + Math.abs(up[i].body.z - up[j].body.z) < UNIT / 3) pressed++;
      return ROUTINE[bot.st.routine].id !== 'breakfast';
    }, 70 * STEPS_PER_MINUTE);
    check(fetched.size === n, `${prison.id}: all fetched a tray (${fetched.size}/${n})`);
    check(ate.size === n, `${prison.id}: all ate at a table (${ate.size}/${n})`);
    check(back.size >= n - 1, `${prison.id}: and took it back (${back.size}/${n})`);
    check(overlapped <= 10, `${prison.id}: the crowd keeps its places at the counter (${overlapped} steps two at one)`);
    bot.until(() => false, 200);
    check(
      bot.st.inmates.every((m) => m.tray === TRAY.NONE && m.seat === -1),
      `${prison.id}: no tray left after the meal`,
    );
    console.log(
      `${prison.id} #${seed}: of ${n} inmates ${fetched.size} fetched, ${ate.size} ate, ${back.size} took it back, the last at ${Math.round((lastBack - start) / STEPS_PER_MINUTE)} minutes; ${overlapped} steps two at one place, ${pressed} pressed together`,
    );
  }
