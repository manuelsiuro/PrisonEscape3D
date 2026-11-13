/**
 * The long games polished (2.43), through the real simulation:
 * - the garden's produce eaten from the hand (fruit, a vegetable), refused when it would do nothing, never in a run
 *   from before 2.43 (Sim.rules242);
 * - the neighbours in the garden, in every prison: nobody until the player plants a bed (nor in a run from before);
 *   then over three days of the routine on several seeds, each visit set off, reached on the tile in front of his bed
 *   and tended there, crouched with a cup, at most GARDEN_PER_BLOCK a free time, none in a free time's last minutes,
 *   the neighbours' beds never more than their share and never one the player planted; every bed's place to tend it
 *   from is open garden floor;
 * - the player and a neighbour's bed: never planted, his ripe crop taken only with an empty hand, a theft he sees
 *   costing his opinion (none unseen), a bed watered when it wanted it a favour once a day (none on a rainy day);
 * - the rat's training as a timing game, in every prison: the laps' time, a press on every pass, none, mashing,
 *   late, a pass missed, the count-in, given up or walked away from, knocked out; once a day; saved and loaded
 *   mid-session; a run from before 2.43 trained at once as it was.
 * P28's rules otherwise: longtest.
 */
import { itemNumber } from '../src/content/items';
import {
  CROP,
  GARDEN_FAVOR,
  GARDEN_LATE,
  GARDEN_PER_BLOCK,
  GARDEN_SHARE,
  GARDEN_THEFT,
  GROWN,
  RAT_LAPS,
  RAT_WINDOW,
  RAT_START_SPEED,
} from '../src/content/long';
import { WEATHERS } from '../src/content/days';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { TRAINING } from '../src/content/prisons/training';
import { ROUTINE, routineEnd } from '../src/content/routine';
import { placesOf } from '../src/sim/ai/places';
import { DOING } from '../src/sim/ai/doing';
import { command, OP } from '../src/sim/command';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { clockAt, DAY_STEPS } from '../src/sim/systems/clock';
import { bedCount, bedOwner, bedTarget, bedTile, GB, newGardenBy, standFor } from '../src/sim/systems/garden';
import { itemOf, slot } from '../src/sim/systems/items';
import { ratGain, ratLap, RR, trackGain } from '../src/sim/systems/races';
import { newRat } from '../src/sim/systems/rats';
import { toolTarget } from '../src/sim/systems/structure';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { LAYER, MAP_W } from '../src/sim/world/World';
import { check } from './assert';
import { Bot, DIR } from './bots';

const n = itemNumber;
const at = (day: number, hour: number, minute = 0) => (day - 1) * DAY_STEPS + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
const put = (b: { x: number; z: number }, t: number) => {
  b.x = (t % MAP_W) * UNIT + UNIT / 2;
  b.z = Math.floor(t / MAP_W) * UNIT + UNIT / 2;
};
const minutesLeft = (sim: Sim) => (((routineEnd(sim.state.routine) - clockAt(sim.state.step).minuteOfDay) % 1440) + 1440) % 1440;
const garden = (seen: SimEvent[], what: string) =>
  seen.filter((e): e is Extract<SimEvent, { type: 'garden' }> => e.type === 'garden' && e.what === what);
const track = (seen: SimEvent[], what: string) =>
  seen.filter((e): e is Extract<SimEvent, { type: 'track' }> => e.type === 'track' && e.what === what);

/** A game straight to a moment, with nothing in the way: the blocks skipped aren't missed, no heat, no lockdown. */
function game(def = CENTER_PERKS, seed = 5) {
  const sim = new Sim(def, seed);
  const seen: SimEvent[] = [];
  const step = (cmd = 0) => {
    sim.step(cmd);
    seen.push(...sim.events);
    sim.state.heat = 0;
    sim.state.lockdown = false;
  };
  const jump = (day: number, hour: number, minute = 0) => {
    sim.state.step = at(day, hour, minute) - 1;
    sim.state.attended = true;
    sim.state.excused = true;
    step();
  };
  const hold = (item: string) => {
    sim.state.items.inv[0] = item ? slot(n(item)) : 0;
    sim.state.items.hand = 0;
    sim.state.items.rev++;
  };
  return { sim, seen, step, jump, hold, use: () => step(command(0, OP.USE, 1)), press: (a = 1) => step(command(0, OP.TRAIN, a)) };
}

// ------------------------------------------------------------------ the produce eaten
{
  const g = game();
  const s = g.sim.state;
  g.jump(1, 10, 30);
  s.energy = 50;
  s.health = 40;
  g.hold('fruit');
  g.use();
  const fruit = s.energy;
  check(fruit === 62 && !s.items.inv[0], `fruit eaten: energy 50 → ${fruit}`);
  g.hold('vegetable');
  g.use();
  check(s.energy === 72 && s.health === 50 && !s.items.inv[0], `a vegetable eaten: energy ${s.energy}, health ${s.health}`);
  s.energy = 100;
  g.hold('fruit');
  g.use();
  check(itemOf(s.items.inv[0]) === n('fruit'), 'fruit kept at full energy');
  // (A vegetable at full energy still mends.)
  g.hold('vegetable');
  g.use();
  check(!s.items.inv[0] && s.health === 60, 'a vegetable eaten at full energy for its health');
  const old = game();
  old.sim.rules242 = true;
  old.jump(1, 10, 30);
  old.sim.state.energy = 50;
  old.hold('fruit');
  old.use();
  check(old.sim.state.energy === 50 && itemOf(old.sim.state.items.inv[0]) === n('fruit'), 'a run from before 2.43: fruit not eaten');
  check(
    toolTarget(old.sim.world, LAYER.GROUND, old.sim.state.player, n('vegetable'), [])?.action !== 'eat',
    'nor a vegetable offered for eating',
  );
  console.log(`produce: fruit +12 energy, a vegetable +10 energy +10 health, kept when it would do nothing; not before 2.43`);
}

// ------------------------------------------------------------------ the place to tend each bed from
{
  const rows: string[] = [];
  for (const def of [...PRISONS, TRAINING]) {
    const sim = new Sim(def, 1);
    const w = sim.world;
    const beds = bedCount(w);
    let onTop = 0;
    for (let k = 0; k < beds; k++) {
      const at = standFor(w, k);
      const x = at.tile % MAP_W;
      const z = Math.floor(at.tile / MAP_W);
      check(!w.npcBlock[at.tile] && w.zoneAt(x, z) === 'garden', `${def.id}: bed ${k} tended from ${x},${z}, not open garden floor`);
      if (at.tile === bedTile(w, k)) onTop++;
    }
    rows.push(`${def.id} ${beds - onTop} of ${beds}`);
  }
  // (Where a wall or the gardener's planters close the plot's edge, from the bed itself, as the player can.)
  console.log(`beds tended from the floor in front of them (else from the bed itself): ${rows.join(', ')}`);
}

// ------------------------------------------------------------------ the neighbours, in every prison
/** A model prisoner's day 1 up to the morning's free time, then a bed planted (seeds in hand, facing it). */
function planted(def: (typeof PRISONS)[number], seed: number, old = false) {
  const bot = new Bot(def, seed);
  if (old) bot.sim.rules242 = true;
  bot.routineUntil(1, 10 * 60 + 5);
  const w = bot.sim.world;
  const bed = 0;
  const from = standFor(w, bed);
  const ok = bot.walkTo(from.tile);
  bot.sim.state.items.inv[0] = slot(n('veg_seeds'));
  bot.op(OP.SELECT, 0);
  bot.face(from.tile < bedTile(w, bed) ? DIR.SOUTH : DIR.NORTH);
  bot.use();
  check(ok && bot.sim.state.plots[bed]?.[0] === CROP.VEG, `${def.id}: the player's bed not planted`);
  return bot;
}
for (const def of PRISONS) {
  let goes = 0;
  let tended = 0;
  let off = 0;
  let late = 0;
  let notCrouched = 0;
  let notThere = 0;
  let overShare = 0;
  let playersTaken = 0;
  let deaths = 0;
  let slowest = 0;
  const perBlock = new Map<string, number>();
  for (const seed of [3, 5, 9]) {
    // (Never planted: nobody in the beds.)
    const idle = new Bot(def, seed);
    idle.routineUntil(3, 12 * 60);
    check(idle.sim.state.gardenBy === undefined, `${def.id}: neighbours though the player never planted`);
    const bot = planted(def, seed);
    const sim = bot.sim;
    const s = sim.state;
    check(Array.isArray(s.gardenBy), `${def.id}: planting didn't start the neighbours`);
    const share = Math.floor(bedCount(sim.world) / GARDEN_SHARE);
    let setOff = 0;
    const step = bot.step.bind(bot);
    (bot as unknown as { step: (c?: number) => void }).step = (c = 0) => {
      step(c);
      const g = s.gardenBy!;
      for (const e of sim.events) {
        if (e.type !== 'garden') continue;
        if (e.what === 'neighbourGoes') {
          goes++;
          setOff = s.step;
          const key = `${seed}:${Math.floor(s.step / DAY_STEPS)}:${ROUTINE[s.routine].id}`;
          perBlock.set(key, (perBlock.get(key) ?? 0) + 1);
          if (minutesLeft(sim) < GARDEN_LATE) late++;
          // (Only ever a bed nobody had planted, or his own.)
          if (e.bed === 0) playersTaken++;
        }
        if (e.what === 'neighbourWatered') {
          tended++;
          slowest = Math.max(slowest, s.step - setOff);
          const m = s.inmates[e.who!];
          if (Math.floor(m.body.x / UNIT) + Math.floor(m.body.z / UNIT) * MAP_W !== standFor(sim.world, e.bed).tile) notThere++;
        }
        if (e.what === 'neighbourOff') off++;
        if (e.what === 'died' && bedOwner(s, e.bed) >= 0) deaths++;
      }
      const who = g[GB.WHO];
      if (who >= 0 && g[GB.UNTIL] > 0 && s.inmates[who].doing !== DOING.GARDEN) notCrouched++;
      if (g.slice(GB.OWNERS).filter((o) => o >= 0).length > share) overShare++;
      // (Bed 0 the player's, marked as planted: never a neighbour's, planted, picked or dead.)
      if (g[GB.OWNERS] !== -2) playersTaken++;
    };
    bot.keepRoutine(() => sim.clock.day >= 5, 4 * 24 * 60 * STEPS_PER_MINUTE);
  }
  const most = Math.max(0, ...perBlock.values());
  check(goes > 0 && tended > 0, `${def.id}: nobody tended a bed in three days`);
  check(most <= GARDEN_PER_BLOCK, `${def.id}: ${most} visits in one free time`);
  check(late === 0, `${def.id}: ${late} set off with under ${GARDEN_LATE} minutes left`);
  check(notThere === 0, `${def.id}: ${notThere} watered a bed from somewhere else`);
  check(notCrouched <= 2 * STEPS_PER_MINUTE, `${def.id}: a neighbour at his bed not crouched for ${notCrouched} steps`);
  check(overShare === 0 && playersTaken === 0, `${def.id}: the neighbours' beds over their share (${overShare}) or the player's taken`);
  check(deaths === 0, `${def.id}: ${deaths} of the neighbours' beds died`);
  console.log(
    `${def.id}: 3 seeds, days 1–4: ${goes} set off, ${tended} tended, ${off} gave up or called away, at most ${most} a free time, the slowest there in ${Math.round(slowest / STEPS_PER_MINUTE)} min`,
  );
}
{
  const bot = planted(CENTER_PERKS, 5, true);
  bot.keepRoutine(() => bot.sim.clock.day >= 3, 2 * 24 * 60 * STEPS_PER_MINUTE);
  check(bot.sim.state.gardenBy === undefined, 'a run from before 2.43 had neighbours in the garden');
  console.log('before 2.43: nobody but the player in the beds');
}

// ------------------------------------------------------------------ the player and a neighbour's bed
{
  const g = game();
  const { sim, seen } = g;
  const s = sim.state;
  const w = sim.world;
  g.jump(2, 10, 30);
  s.gardenBy = newGardenBy(bedCount(w));
  const mine = 0;
  const his = 1;
  const who = 2;
  s.gardenBy[GB.OWNERS + his] = who;
  while (s.plots.length < bedCount(w)) s.plots.push([CROP.NONE, 0, 0, 0]);
  const face = (bed: number) => {
    const from = standFor(w, bed);
    put(s.player, from.tile);
    s.player.facing = from.tile < bedTile(w, bed) ? 5 : 13;
  };
  // Never planted by the player, though empty.
  face(his);
  g.hold('veg_seeds');
  check(bedTarget(w, LAYER.GROUND, s.player, n('veg_seeds'), s.plots, s.gardenBy)?.action !== 'plant', "a neighbour's empty bed planted");
  face(mine);
  check(bedTarget(w, LAYER.GROUND, s.player, n('veg_seeds'), s.plots, s.gardenBy)?.action === 'plant', "the player's own still planted");
  // His ripe crop: never taken with a cup (or a tool) in hand; with an empty hand, taken.
  s.plots[his] = [CROP.FRUIT, GROWN, 0, 0];
  face(his);
  check(!bedTarget(w, LAYER.GROUND, s.player, n('plastic_cup'), s.plots, s.gardenBy), 'his ripe bed taken with a cup in hand');
  check(!bedTarget(w, LAYER.GROUND, s.player, n('light_shovel'), s.plots, s.gardenBy), 'his ripe bed taken with a shovel in hand');
  // (Seen: he stands beside the player.)
  const m = s.inmates[who];
  put(m.body, standFor(w, his).tile + 1);
  const was = m.opinion;
  g.hold('');
  g.use();
  const stolen = garden(seen, 'stolen').at(-1);
  check(
    !!stolen && stolen.seen === true && m.opinion === Math.max(0, was + GARDEN_THEFT) && s.plots[his][0] === CROP.NONE,
    `taken while he looks on: opinion ${was} → ${m.opinion}`,
  );
  // (Taken, not harvested: no Green Thumb for it, nor the parole board's garden.)
  check(!garden(seen, 'harvested').length, "his crop counted as the player's harvest");
  check(itemOf(s.items.inv[0]) === n('fruit') || s.items.inv.some((v) => itemOf(v) === n('fruit')), 'his fruit in the pockets');
  check(bedOwner(s, his) === who, 'and the bed still his');
  // (Unseen: he's in his cell.)
  s.plots[his] = [CROP.VEG, GROWN, 0, 0];
  put(m.body, placesOf(w).bedside[m.cell]);
  const was2 = m.opinion;
  s.items.inv.fill(0);
  g.hold('');
  g.use();
  check(m.opinion === was2 && garden(seen, 'stolen').at(-1)?.seen === false, 'taken unseen: nothing');
  // (Seen by one who already thinks nothing of the player: still seen.)
  s.plots[his] = [CROP.VEG, GROWN, 0, 0];
  put(m.body, standFor(w, his).tile + 1);
  const keep = m.opinion;
  m.opinion = 0;
  s.items.inv.fill(0);
  g.hold('');
  g.use();
  check(garden(seen, 'stolen').at(-1)?.seen === true, 'seen by one at 0: still seen');
  m.opinion = keep;
  // The player's own bed, once picked, stays theirs: never a neighbour's to take.
  face(mine);
  g.hold('veg_seeds');
  g.use();
  check(s.gardenBy[GB.OWNERS + mine] === -2, "the player's bed marked theirs as planted");
  s.plots[mine] = [CROP.VEG, GROWN, 0, 0];
  s.items.inv.fill(0);
  g.hold('');
  g.use();
  check(s.plots[mine][0] === CROP.NONE && s.gardenBy[GB.OWNERS + mine] === -2, "picked: still the player's");
  // A favour: his bed watered when it wanted it, once a day; not when it didn't.
  face(his);
  s.plots[his] = [CROP.VEG, 1, 0, 0];
  const before = m.opinion;
  g.hold('plastic_cup');
  g.use();
  check(
    m.opinion === Math.min(100, before + GARDEN_FAVOR) && garden(seen, 'favour').length === 1,
    `his bed watered: opinion ${before} → ${m.opinion}`,
  );
  g.use();
  check(garden(seen, 'favour').length === 1, 'watered again: no second favour');
  s.plots[3] = [CROP.VEG, 1, 0, 0];
  s.gardenBy[GB.OWNERS + 3] = who;
  face(3);
  g.use();
  check(garden(seen, 'favour').length === 1, 'his other bed the same day: no second favour');
  console.log(
    `a neighbour's bed: never planted, his ripe crop taken only empty-handed (${GARDEN_THEFT} seen, nothing unseen), watered when it wanted it +${GARDEN_FAVOR} once a day`,
  );
}
{
  // A rainy day: his bed wanted nothing; watered all the same, no favour.
  const g = game();
  const { sim, seen } = g;
  const s = sim.state;
  s.calendar = [[0, 0, WEATHERS.indexOf('rain')]];
  g.jump(2, 10, 30);
  s.gardenBy = newGardenBy(bedCount(sim.world));
  s.gardenBy[GB.OWNERS + 1] = 2;
  while (s.plots.length < bedCount(sim.world)) s.plots.push([CROP.NONE, 0, 0, 0]);
  s.plots[1] = [CROP.VEG, 1, 0, 0];
  const from = standFor(sim.world, 1);
  put(s.player, from.tile);
  s.player.facing = from.tile < bedTile(sim.world, 1) ? 5 : 13;
  g.hold('plastic_cup');
  g.use();
  check(garden(seen, 'watered').length === 1 && garden(seen, 'favour').length === 0, 'a rainy day: his bed watered, no favour');
  console.log('a rainy day: no favour for watering what the rain already has');
}

// ------------------------------------------------------------------ the rat's training, a timing game
/** Evening free time on day 1 in the player's cell, a tame rat at `speed`, the track in hand and bait in the pockets. */
function trainer(def = CENTER_PERKS, speed = RAT_START_SPEED, seed = 5) {
  const g = game(def, seed);
  const s = g.sim.state;
  g.jump(1, 18, 30);
  put(s.player, placesOf(g.sim.world).bedside[1]);
  const pet = newRat(false, s.player.x, s.player.z);
  pet.speed = speed;
  s.rats = [pet];
  g.hold('rat_track');
  s.items.inv[1] = slot(n('potato'));
  return { ...g, pet };
}
/** The laps run out: a press `late` steps after each pass (but those in `skip`), `mash`: a press every step. */
function runLaps(g: ReturnType<typeof trainer>, o: { late?: number; skip?: number[]; mash?: boolean; stopAt?: number } = {}) {
  const s = g.sim.state;
  g.use();
  const start = s.step;
  check(
    s.ratRun?.length === 5,
    `the laps begun (${g.seen
      .filter((e) => e.type === 'track')
      .map((e) => (e as { what: string }).what)
      .join()})`,
  );
  for (let k = 0; k < 800 && s.ratRun?.length; k++) {
    const r = s.ratRun;
    if (o.stopAt !== undefined && s.step - start >= o.stopAt) {
      g.press(3);
      break;
    }
    const lap = ratLap(r[RR.SPEED]);
    const t = s.step + 1 - r[RR.FROM];
    const pass = Math.round((t - (o.late ?? 0)) / lap);
    const due = t - (o.late ?? 0) === pass * lap && pass >= 0 && pass < RAT_LAPS && !(o.skip ?? []).includes(pass);
    g.step(o.mash || due ? command(0, OP.TRAIN, 1) : 0);
  }
  const done = track(g.seen, 'trained').at(-1);
  return { hits: done?.hits ?? -1, gain: done?.gain ?? 0, steps: s.step - start };
}
for (const def of PRISONS) {
  const g = trainer(def);
  const r = runLaps(g);
  check(
    r.hits === RAT_LAPS && g.pet.speed === RAT_START_SPEED + ratGain(RAT_START_SPEED, RAT_LAPS),
    `${def.id}: every pass caught (${r.hits}, speed ${g.pet.speed})`,
  );
  check(g.pet.fed === 1 && !g.sim.state.items.inv[1], `${def.id}: fed today, the bait eaten`);
  check(!g.sim.state.ratRun?.length, `${def.id}: the laps over`);
}
{
  const rows: string[] = [];
  for (const speed of [RAT_START_SPEED, 60, 95]) {
    const out: string[] = [];
    const cases: Array<[string, Parameters<typeof runLaps>[1]]> = [
      ['every pass', {}],
      ['2 steps late', { late: 2 }],
      [`${RAT_WINDOW + 1} late`, { late: RAT_WINDOW + 1 }],
      ['one missed', { skip: [2] }],
      ['none', { skip: [0, 1, 2, 3, 4, 5] }],
      ['mashing', { mash: true }],
    ];
    for (const [name, o] of cases) {
      const g = trainer(CENTER_PERKS, speed);
      const r = runLaps(g, o);
      out.push(`${name} ${r.hits}/${RAT_LAPS} +${r.gain}`);
      if (name === 'every pass') {
        check(r.gain === ratGain(speed, RAT_LAPS) && r.gain >= trackGain(speed), `${speed}: a full session gives at least the old gain`);
        const end = r.steps;
        check(Math.abs(end - (ratLap(speed) * RAT_LAPS + (ratLap(speed) >> 1))) <= 2, `${speed}: the laps take ${end} steps`);
        out.push(`${(end / 20).toFixed(1)} s`);
      }
      if (name === '2 steps late') check(r.hits === RAT_LAPS, `${speed}: two steps late still catches every pass`);
      if (name === `${RAT_WINDOW + 1} late`)
        check(r.hits === 0 && r.gain >= 1, `${speed}: a press past the window catches nothing, still +1 at least`);
      if (name === 'one missed') check(r.hits === RAT_LAPS - 1 && r.gain === ratGain(speed, RAT_LAPS - 1), `${speed}: five of six`);
      if (name === 'none') check(r.hits === 0 && r.gain === ratGain(speed, 0) && r.gain >= 1, `${speed}: nothing pressed, the least`);
      if (name === 'mashing') check(r.hits <= 1, `${speed}: mashing caught ${r.hits} (only the first press of each lap counts)`);
    }
    rows.push(`speed ${speed} (a lap ${(ratLap(speed) / 20).toFixed(2)} s): ${out.join(', ')}`);
  }
  for (const row of rows) console.log(`laps: ${row}`);
  // Given up, walked away from, knocked out: what was caught so far counts.
  const lap = ratLap(RAT_START_SPEED);
  const gave = trainer();
  const g1 = runLaps(gave, { stopAt: lap * 3 + 2 });
  check(g1.hits === 2 || g1.hits === 3, `given up after three laps: ${g1.hits} caught`);
  check(
    !gave.sim.state.ratRun?.length && gave.pet.speed === RAT_START_SPEED + ratGain(RAT_START_SPEED, g1.hits),
    'and the speed it earned kept',
  );
  const walked = trainer();
  walked.use();
  for (let k = 0; k < lap * 2; k++) walked.step();
  walked.step(command(DIR.SOUTH));
  walked.step(command(DIR.SOUTH));
  check(!walked.sim.state.ratRun?.length && track(walked.seen, 'trained').length === 1, 'walked away: over, the least kept');
  const ko = trainer();
  ko.use();
  ko.step();
  ko.sim.state.ko = 100;
  ko.step();
  check(!ko.sim.state.ratRun?.length, 'knocked out: over');
  // The count-in: a press before the first pass counts for nothing and spends nothing.
  const early = trainer();
  early.use();
  early.press();
  check(early.sim.state.ratRun![RR.LAST] === -1 && track(early.seen, 'tap').length === 0, 'a press in the count-in: nothing');
  // Once a day, and nothing new started while it runs.
  const twice = trainer();
  twice.use();
  twice.sim.state.items.inv[2] = slot(n('potato'));
  twice.use();
  check(!!twice.sim.state.items.inv[2], 'the track again mid-session: nothing');
  runLaps(twice, {});
  console.log('laps: given up, walked away from or knocked out, what was caught counts; nothing in the count-in; once a day');
}
{
  // Saved and loaded mid-session: the same game.
  const g = trainer();
  const s = g.sim.state;
  g.use();
  for (let k = 0; k < 40; k++) g.step();
  g.press();
  const loaded = new Sim(CENTER_PERKS, 1);
  loaded.restore(JSON.parse(JSON.stringify(g.sim.snapshot())));
  check(loaded.hash() === g.sim.hash() && loaded.state.ratRun?.length === 5, 'saved mid-session: loads the same');
  for (let k = 0; k < 300; k++) {
    g.sim.step(0);
    loaded.step(0);
  }
  check(loaded.hash() === g.sim.hash() && !s.ratRun?.length, 'and plays on the same to the end');
  // A damaged one: none running; a garden's: set afresh.
  const bad = JSON.parse(JSON.stringify(g.sim.snapshot()));
  bad.state.ratRun = [1, 2];
  bad.state.gardenBy = [1, 2, 3];
  const back = new Sim(CENTER_PERKS, 1);
  back.restore(bad);
  check(back.state.ratRun?.length === 0, 'a damaged session: none running');
  check(
    back.state.gardenBy?.length === GB.OWNERS + bedCount(back.world) && back.state.gardenBy[GB.WHO] === -1,
    "a damaged neighbours' garden: set afresh",
  );
  const none = JSON.parse(JSON.stringify(g.sim.snapshot()));
  delete none.state.ratRun;
  delete none.state.gardenBy;
  const plain = new Sim(CENTER_PERKS, 1);
  plain.restore(none);
  check(plain.state.ratRun === undefined && plain.state.gardenBy === undefined, 'a save from before: neither');
  console.log('saves: mid-session loads and plays on the same; damaged ones set afresh; older ones have neither');
}
{
  // A run from before 2.43: the press and a watch, the gain at once.
  const g = trainer();
  g.sim.rules242 = true;
  g.use();
  check(
    !g.sim.state.ratRun?.length && g.pet.speed === RAT_START_SPEED + trackGain(RAT_START_SPEED),
    'before 2.43: trained at once, as it was',
  );
  console.log('before 2.43: the rat trained at once');
}
