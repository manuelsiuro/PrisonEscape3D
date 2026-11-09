/**
 * Jobs and the Work Period (2.30, systems/jobs.ts, inmates.ts): every job in every prison done by following what the HUD
 * and the arrows say, how long that takes against when the warning comes; the mop from the pockets; inmates working
 * their stations; guards minding strangers in work rooms; saves, and older runs as they were.
 */
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';
import { itemNumber } from '../src/content/items';
import { J, JOB_LEN, KIND, LIFT } from '../src/content/oddjobs';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { TRAINING } from '../src/content/prisons/training';
import { ROUTINE } from '../src/content/routine';
import { nearestDir } from '../src/sim/ai/path';
import { placesOf } from '../src/sim/ai/places';
import { command } from '../src/sim/command';
import { RunRecorder, replayLog } from '../src/sim/runlog';
import { Sim } from '../src/sim/Sim';
import { HOLDER, jobRooms } from '../src/sim/systems/economy';
import { DOING, dutyCarry, dutyMachine } from '../src/sim/systems/inmates';
import { itemOf } from '../src/sim/systems/items';
import { nextWork, workWarningAt } from '../src/sim/systems/jobs';
import {
  CHASE_HEAT,
  LAST_WARNING,
  MAIL_WARNING,
  STEPS_PER_MINUTE,
  STRANGER_CAP,
  STRANGER_GRACE,
  STRANGER_HEAT,
  UNIT,
  WORK_WARNING,
} from '../src/sim/tuning';
import { tileAt } from '../src/sim/world/grid';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';
import { Bot } from './bots';

const WORK = 12 * 60;
const END = 15 * 60;
const minute = (sim: Sim) => sim.clock.minuteOfDay;
const tileOf = (b: { x: number; z: number }) => tileAt(b.x, b.z);
/** The job given to the player, from day 1, whoever had it (they move to the player's old one). */
function hire(sim: Sim, job: number) {
  const mine = sim.state.jobs.indexOf(HOLDER.PLAYER);
  if (mine === job) return;
  [sim.state.jobs[mine], sim.state.jobs[job]] = [sim.state.jobs[job], HOLDER.PLAYER];
}
const put = (bot: Bot, tile: number, facing = 5) => {
  const p = bot.st.player;
  p.x = (tile % MAP_W) * UNIT + UNIT / 2;
  p.z = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
  p.moving = false;
  p.facing = facing;
};
const beside = (bot: Bot, prop: number) => {
  const p = bot.sim.world.props[prop];
  const w = bot.sim.world;
  const round: number[] = [];
  for (let x = p.x; x < p.x + p.w; x++) round.push((p.z + p.d) * MAP_W + x, (p.z - 1) * MAP_W + x);
  for (let z = p.z; z < p.z + p.d; z++) round.push(z * MAP_W + p.x - 1, z * MAP_W + p.x + p.w);
  return round.filter((t) => t >= 0 && !w.npcBlock[t]);
};

/**
 * Does the job by nothing but nextWork, as someone follows the HUD's line and the arrows: walks to the station it
 * names, turns to it, presses. Returns the minute it was paid, -1 if it never was before the bell.
 */
function followWork(bot: Bot): number {
  const sim = bot.sim;
  let guard = 0;
  while (ROUTINE[bot.st.routine].id === 'work' && !bot.st.paid && guard++ < 6000) {
    const next = nextWork(sim);
    if (!next) {
      sim.step(0);
      continue;
    }
    if (next.act === 'wait') {
      sim.step(0);
      continue;
    }
    if (next.act === 'mop') {
      const from = tileOf(bot.st.player);
      const near = [...bot.st.puddles].sort(
        (a, b) =>
          Math.abs((a % MAP_W) - (from % MAP_W)) +
          Math.abs(Math.floor(a / MAP_W) - Math.floor(from / MAP_W)) -
          (Math.abs((b % MAP_W) - (from % MAP_W)) + Math.abs(Math.floor(b / MAP_W) - Math.floor(from / MAP_W))),
      )[0];
      if (near === undefined || !bot.walkTo(near)) return -1;
      bot.act();
      continue;
    }
    if (next.act === 'deliver') {
      const m = bot.st.inmates[next.who];
      const dx = m.body.x - bot.st.player.x;
      const dz = m.body.z - bot.st.player.z;
      if (Math.max(Math.abs(dx), Math.abs(dz)) < UNIT * 1.2) {
        bot.st.player.facing = nearestDir(dx, dz) || bot.st.player.facing;
        bot.act();
        sim.step(0);
      } else {
        const t = tileOf(m.body);
        const to = [t + MAP_W, t - MAP_W, t + 1, t - 1].find((q) => q >= 0 && !sim.world.npcBlock[q]) ?? t;
        if (!bot.walkTo(to, 400)) sim.step(0);
      }
      continue;
    }
    const spots = beside(bot, next.prop);
    if (!spots.some((t) => bot.walkTo(t))) return -1;
    const p = sim.world.props[next.prop];
    const dir = nearestDir((p.x + p.w / 2) * UNIT - bot.st.player.x, (p.z + p.d / 2) * UNIT - bot.st.player.z);
    if (dir) sim.step(command(dir));
    bot.act();
    sim.step(0);
  }
  return bot.st.paid ? minute(sim) : -1;
}

// ------------------------------------------------------------------ every job, by what the HUD and the arrows say
const times: string[] = [];
for (const def of PRISONS) {
  def.jobs.forEach(({ id }, job) => {
    const bot = new Bot(def, 3);
    hire(bot.sim, job);
    check(bot.routineUntil(1, WORK + 1), `${def.id} ${id}: to work`);
    const paid = followWork(bot);
    check(paid > 0, `${def.id} ${id}: done by following the next step alone`);
    times.push(`${def.id} ${id} ${paid - WORK}`);
    // (The mail round's first warning is for a round not begun, and comes earlier than the time it takes.)
    if (jobRooms(bot.sim.world)[job].def.flow !== 'mail')
      check(paid < workWarningAt(jobRooms(bot.sim.world)[job].def), `${def.id} ${id}: done before the warning comes`);
    check(!bot.st.heat, `${def.id} ${id}: at no cost in heat`);
  });
}
console.log(`minutes from the bell to paid: ${times.join(', ')}`);

// From the cell, the warning just come: still time to do it, in every prison.
const left: string[] = [];
for (const def of PRISONS) {
  def.jobs.forEach(({ id }, job) => {
    let least = Infinity;
    for (const seed of [3, 11, 29]) {
      const bot = new Bot(def, seed);
      hire(bot.sim, job);
      const at = workWarningAt(jobRooms(bot.sim.world)[job].def);
      check(bot.routineUntil(1, at), `${def.id} ${id}: to the warning`);
      check(bot.sim.onDuty && bot.st.quota === 0, `${def.id} ${id}: nothing done yet`);
      const paid = followWork(bot);
      check(paid > 0, `${def.id} ${id} seed ${seed}: the warning leaves time to do it all from nothing`);
      least = Math.min(least, END - paid);
    }
    left.push(`${def.id} ${id} ${least}`);
  });
}
console.log(`minutes to spare, starting at the warning (least of 3 seeds): ${left.join(', ')}`);
check(
  LAST_WARNING === 14 * 60 + 30 && WORK_WARNING < LAST_WARNING && MAIL_WARNING < WORK_WARNING,
  'the warnings: the first in time for the whole job, a last call at 14:30',
);

// ------------------------------------------------------------------ the mop
{
  const def = CENTER_PERKS;
  const job = def.jobs.findIndex((j) => j.id === 'janitor');
  const bot = new Bot(def, 3);
  hire(bot.sim, job);
  check(bot.routineUntil(1, WORK + 1), 'the mop: to work');
  bot.st.items.inv[0] = itemNumber('soap');
  bot.st.items.hand = 0;
  const closet = jobRooms(bot.sim.world)[job].take;
  check(
    beside(bot, closet).some((t) => bot.walkTo(t)),
    'the mop: to the closet',
  );
  const p = bot.sim.world.props[closet];
  const d = nearestDir((p.x + p.w / 2) * UNIT - bot.st.player.x, (p.z + p.d / 2) * UNIT - bot.st.player.z);
  if (d) bot.sim.step(command(d));
  bot.act();
  bot.sim.step(0);
  const mop = itemNumber('mop');
  check(itemOf(bot.st.items.inv[bot.st.items.hand]) === mop, 'the mop goes straight into the hand, with something in the first slot');
  // Something else put in the hand: the puddle's still mopped, the mop coming back to hand.
  bot.st.items.hand = 0;
  put(bot, bot.st.puddles[0]);
  const before = bot.st.puddles.length;
  check(bot.sim.station()?.act === 'mop', 'on a puddle, the mop in the pockets: the button mops');
  bot.act();
  bot.sim.step(0);
  check(bot.st.puddles.length === before - 1, 'and the puddle goes');
  check(itemOf(bot.st.items.inv[bot.st.items.hand]) === mop, 'the mop in hand for it');
  // As it was.
  const old = new Bot(def, 3);
  old.sim.rules229 = true;
  old.sim.rules230 = true;
  old.sim.rules231 = true;
  old.sim.rules232 = true;
  old.sim.rules2331 = true;
  old.sim.rules233 = true;
  old.sim.rules234 = true;
  hire(old.sim, job);
  check(old.routineUntil(1, WORK + 1), 'the old mop: to work');
  old.st.items.inv[1] = itemNumber('mop');
  old.st.items.hand = 0;
  put(old, old.st.puddles[0]);
  check(old.sim.station() === null, 'the old rules: on a puddle, the mop in the pockets, nothing');
}

// ------------------------------------------------------------------ what lies in the hands and the bins
{
  const def = CENTER_PERKS;
  const bot = new Bot(def, 3);
  check(bot.routineUntil(1, WORK + 1), 'the laundry: to work');
  const room = jobRooms(bot.sim.world)[bot.st.jobs.indexOf(HOLDER.PLAYER)];
  bot.st.items.inv[0] = itemNumber('soap');
  bot.st.items.hand = 0;
  check(
    beside(bot, room.take).some((t) => bot.walkTo(t)),
    'to the dirty bin',
  );
  const q = bot.sim.world.props[room.take];
  const d = nearestDir((q.x + q.w / 2) * UNIT - bot.st.player.x, (q.z + q.d / 2) * UNIT - bot.st.player.z);
  if (d) bot.sim.step(command(d));
  bot.act();
  bot.sim.step(0);
  check(itemOf(bot.st.items.inv[bot.st.items.hand]) === itemNumber('dirty_laundry'), 'a load taken is carried in the hand');
  // The worker's own bin: a second press with a load in hand opens it. Their cover for what's in it.
  bot.act();
  bot.sim.step(0);
  check(bot.st.items.open >= 0, "a second press at the bin opens it: the job's stock is the worker's, quota or no quota");
}

// ------------------------------------------------------------------ inmates at work
const work: string[] = [];
for (const def of PRISONS) {
  const places = placesOf(new Sim(def, 3).world);
  const w = new Sim(def, 3).world;
  jobRooms(w).forEach((r, j) => {
    const d = places.duties[j];
    if (r.def.flow === 'machine') {
      check(d.take?.prop === r.take && d.put?.prop === r.put, `${def.id} ${r.def.id}: inmates use the same bins as the player`);
      check(d.machines.length > 0 && d.machines.every((m) => r.machines.includes(m.prop)), `${def.id} ${r.def.id}: and the same machines`);
    }
    if (r.def.flow === 'mail') check(d.machines.length > 0, `${def.id}: the mail desk`);
    if (r.def.flow === 'mop')
      check(d.take?.prop === r.take && d.round.length >= 8, `${def.id}: the janitor's closet and round (${d.round.length})`);
    for (const s of [d.take, d.put, ...d.machines])
      if (s) check(!w.npcBlock[s.tile] && w.ground.zone[s.tile] === r.zone, `${def.id} ${r.def.id}: a stop on the room's floor`);
  });
  for (const seed of [3, 11, 29, 47]) {
    const sim = new Sim(def, seed);
    while (ROUTINE[sim.state.routine].id !== 'work') {
      sim.state.attended = true;
      sim.step(0);
    }
    const rooms = jobRooms(sim.world);
    const moved = new Map<number, number>();
    const last = new Map<number, string>();
    const longest = new Map<number, number>();
    const legs = new Map<number, number>();
    const held = new Map<number, Set<string>>();
    const ran = new Map<number, Set<number>>();
    while (ROUTINE[sim.state.routine].id === 'work') {
      sim.state.attended = true;
      sim.step(0);
      sim.state.jobs.forEach((who, j) => {
        if (who < 0) return;
        const m = sim.state.inmates[who];
        const at = `${m.body.x},${m.body.z}`;
        moved.set(who, last.get(who) === at ? (moved.get(who) ?? 0) + 1 : 0);
        longest.set(who, Math.max(longest.get(who) ?? 0, moved.get(who)!));
        last.set(who, at);
        legs.set(who, Math.max(legs.get(who) ?? 0, m.duty));
        const c = dutyCarry(sim.world, m, j);
        if (c) (held.get(who) ?? held.set(who, new Set()).get(who)!).add(c);
        const on = dutyMachine(sim.world, m, j);
        if (on) (ran.get(who) ?? ran.set(who, new Set()).get(who)!).add(on.prop);
      });
    }
    sim.state.jobs.forEach((who, j) => {
      if (who < 0) return;
      const r = rooms[j].def;
      const tag = `${def.id} ${seed} ${r.id}`;
      check(sim.state.inmates[who].shift === 1 || sim.state.inmates[who].shift === 0, `${tag}: on shift`);
      check((legs.get(who) ?? 0) >= (r.flow === 'mail' ? 5 : 12), `${tag}: works its way through the period (${legs.get(who)} legs)`);
      check((longest.get(who) ?? 0) <= 25 * 20, `${tag}: never stands still long (${Math.round((longest.get(who) ?? 0) / 20)} s)`);
      const carried = held.get(who) ?? new Set();
      if (r.flow === 'machine') check(carried.has(r.raw!) && carried.has(r.done!), `${tag}: carries what goes in and what comes out`);
      if (r.flow === 'mop') check(carried.has('mop'), `${tag}: carries the mop`);
      if (r.flow === 'mail') check(carried.has('letter'), `${tag}: carries letters`);
      if (r.flow !== 'mop') check((ran.get(who)?.size ?? 0) > 0, `${tag}: runs a machine`);
      if (seed === 3) work.push(`${def.id} ${r.id} ${legs.get(who)}`);
    });
  }
}
console.log(`legs in a Work Period (seed 3): ${work.join(', ')}`);
{
  // The janitor mops along a round of the corridors.
  const def = CENTER_PERKS;
  const sim = new Sim(def, 3);
  while (minute(sim) < WORK + 50) {
    sim.state.attended = true;
    sim.step(0);
  }
  const job = def.jobs.findIndex((j) => j.id === 'janitor');
  const who = sim.state.jobs[job];
  let mopped = 0;
  for (let k = 0; k < 40 * 20; k++) {
    sim.step(0);
    if (sim.state.inmates[who].doing === DOING.MOP) mopped++;
  }
  check(mopped > 0, 'the janitor mops');
  // After the bell, it's all put down.
  while (ROUTINE[sim.state.routine].id === 'work') sim.step(0);
  sim.step(0);
  check(sim.state.inmates[who].duty === 0, 'the bell: back to the first stop tomorrow');
  // No work at the Training Block, whose lessons ask for people by name.
  const t = new Sim(TRAINING, 3);
  while (ROUTINE[t.state.routine].id !== 'work') {
    t.state.attended = true;
    t.step(0);
  }
  for (let k = 0; k < 40 * 20; k++) t.step(0);
  check(
    t.state.inmates.every((m) => m.duty === 0),
    'the Training Block: nobody on a round',
  );
}
{
  // A lockdown stops work, out cold stops work, and its job goes as ever.
  const def = CENTER_PERKS;
  const sim = new Sim(def, 3);
  while (minute(sim) < WORK + 20) {
    sim.state.attended = true;
    sim.step(0);
  }
  const who = sim.state.jobs[def.jobs.findIndex((j) => j.id === 'kitchen')];
  // (As a knockout at work does, fights.ts, whether it had got there yet or not.)
  sim.state.inmates[who].ko = 100000;
  sim.state.inmates[who].shift = 2;
  while (ROUTINE[sim.state.routine].id === 'work') {
    sim.state.attended = true;
    sim.step(0);
  }
  check(!sim.state.jobs.includes(who), 'knocked out at work: the job lost at 15:00, as ever');
}

// ------------------------------------------------------------------ guards mind strangers
/** The player in a room, a guard beside them in the room, looking at them. */
function watched(def: typeof CENTER_PERKS, zone: string, seed = 3, job = -1, rules = false) {
  const bot = new Bot(def, seed);
  if (rules) {
    bot.sim.rules229 = true;
    bot.sim.rules230 = true;
    bot.sim.rules231 = true;
    bot.sim.rules232 = true;
    bot.sim.rules2331 = true;
    bot.sim.rules233 = true;
    bot.sim.rules234 = true;
  }
  if (job >= 0) hire(bot.sim, job);
  check(bot.routineUntil(1, WORK + 5), `${def.id}: to work`);
  const room = jobRooms(bot.sim.world).find((r) => r.def.zone === zone)!;
  const w = bot.sim.world;
  const floor = placesOf(w).floor[room.zone].filter((t) => !w.npcBlock[t]);
  const a = floor[Math.floor(floor.length / 2)];
  const b =
    floor.find((t) => t !== a && Math.abs((t % MAP_W) - (a % MAP_W)) + Math.abs(Math.floor(t / MAP_W) - Math.floor(a / MAP_W)) === 2) ??
    floor[0];
  put(bot, a);
  const g = bot.st.guards[0];
  g.body.x = (b % MAP_W) * UNIT + UNIT / 2;
  g.body.z = Math.floor(b / MAP_W) * UNIT + UNIT / 2;
  g.wait = 100000;
  g.path = [];
  const hold = () => {
    g.body.x = (b % MAP_W) * UNIT + UNIT / 2;
    g.body.z = Math.floor(b / MAP_W) * UNIT + UNIT / 2;
    g.body.facing = nearestDir(bot.st.player.x - g.body.x, bot.st.player.z - g.body.z) || g.body.facing;
  };
  return { bot, hold, room };
}
const spottedAs = (sim: Sim, reason: string) => sim.events.some((e) => e.type === 'spotted' && e.reason === reason);
for (const def of PRISONS) {
  const rooms = jobRooms(new Sim(def, 3).world);
  // (San Pancho starts the player as its janitor, who has business everywhere: a machine job in another room, to be a stranger.)
  for (const r of rooms.filter((q) => q.def.id !== 'gardener')) {
    const job = rooms.findIndex((q) => q.def.flow === 'machine' && q.def.id !== 'gardener' && q.zone !== r.zone);
    const { bot, hold } = watched(def, r.def.zone, 3, job);
    check(bot.sim.playerZone === r.def.zone, `${def.id} ${r.def.zone}: stood in it`);
    hold();
    let told = false;
    let peak = 0;
    let duringGrace = 0;
    let spottedEarly = false;
    for (let k = 0; k < STRANGER_GRACE - 4; k++) {
      hold();
      bot.sim.step(0);
      if (bot.sim.events.some((e) => e.type === 'toldOff')) told = true;
      if (spottedAs(bot.sim, 'stranger')) spottedEarly = true;
      duringGrace = bot.st.heat;
    }
    check(told, `${def.id} ${r.def.zone}: a guard tells a stranger to go`);
    check(duringGrace === 0 && !spottedEarly, `${def.id} ${r.def.zone}: no heat while walking out, and not counted as spotted`);
    for (let k = 0; k < 90 * 20 && ROUTINE[bot.st.routine].id === 'work'; k++) {
      hold();
      bot.sim.step(0);
      peak = Math.max(peak, bot.st.heat);
    }
    check(peak >= STRANGER_HEAT, `${def.id} ${r.def.zone}: staying costs a little (${peak}%)`);
    check(peak <= STRANGER_CAP && peak < CHASE_HEAT, `${def.id} ${r.def.zone}: and never a chase`);
  }
}
{
  const def = CENTER_PERKS;
  const mopper = def.jobs.findIndex((j) => j.id === 'janitor');
  const postie = def.jobs.findIndex((j) => j.id === 'mailman');
  const cook = def.jobs.findIndex((j) => j.id === 'kitchen');
  const stays = (zone: string, job: number, rules = false) => {
    const { bot, hold } = watched(def, zone, 3, job, rules);
    for (let k = 0; k < 40 * 20; k++) {
      hold();
      bot.sim.step(0);
    }
    return bot.st.heat;
  };
  check(stays('laundry', -1) === 0, 'in your own work room: nothing');
  check(stays('kitchen', -1) > 0, "someone else's: minded");
  check(stays('kitchen', cook) === 0, 'the kitchen, as its cook: nothing');
  check(stays('kitchen', mopper) === 0, 'the janitor has business everywhere');
  check(stays('kitchen', postie) === 0, 'and the mailman, with people to hand letters to');
  check(stays('kitchen', -1, true) === 0, 'the old rules: nobody minded');
  // Walking through: told, and out in time: nothing.
  const { bot, hold } = watched(def, 'kitchen');
  for (let k = 0; k < STRANGER_GRACE - 10; k++) {
    hold();
    bot.sim.step(0);
  }
  check(bot.st.strayed.length === 2, 'told');
  check(bot.st.spotted === 0, 'being told is not being spotted (the Ghost, the commendation)');
  put(bot, placesOf(bot.sim.world).bedside[1]);
  for (let k = 0; k < 20; k++) bot.sim.step(0);
  check(bot.st.heat === 0 && bot.st.strayed.length === 0, 'out in time: nothing, and it starts afresh next time');
  // Outside the Work Period: nobody minds.
  const late = watched(def, 'kitchen');
  while (ROUTINE[late.bot.st.routine].id === 'work') late.bot.sim.step(0);
  late.bot.st.heat = 0;
  for (let k = 0; k < 20 * 20; k++) {
    late.hold();
    late.bot.sim.step(0);
  }
  check(
    !late.bot.sim.events.some((e) => e.type === 'spotted' && e.reason === 'stranger') && late.bot.st.strayed.length === 0,
    'after 15:00: not the same thing',
  );
  // Sent there: a pumpkin to carve, the fixer's mug in the freezer.
  const carving = watched(def, 'kitchen');
  carving.bot.st.items.inv[0] = itemNumber('pumpkin');
  for (let k = 0; k < 20 * 20; k++) {
    carving.hold();
    carving.bot.sim.step(0);
  }
  check(carving.bot.st.heat === 0 && carving.bot.st.strayed.length === 0, 'a pumpkin to carve in the kitchen: not minded');
  const mug = watched(def, 'kitchen');
  mug.bot.st.oddjob = Array.from({ length: JOB_LEN }, () => 0);
  mug.bot.st.oddjob[J.KIND] = KIND.LIFT;
  mug.bot.st.oddjob[J.VAR] = LIFT.MUG;
  mug.bot.st.oddjob[J.ENDS] = 1e9;
  mug.bot.st.oddjob[J.GIVER] = 0;
  for (let k = 0; k < 10 * 20; k++) {
    mug.hold();
    mug.bot.sim.step(0);
  }
  check(mug.bot.st.heat === 0, "the fixer's mug in the freezer: not minded");
  // Wanted: the chase says so, not this.
  const wanted = watched(def, 'kitchen');
  wanted.bot.st.heat = CHASE_HEAT + 5;
  wanted.hold();
  let chaseSaid = false;
  for (let k = 0; k < 40 && !chaseSaid; k++) {
    wanted.hold();
    wanted.bot.sim.step(0);
    chaseSaid = spottedAs(wanted.bot.sim, 'wanted');
  }
  check(chaseSaid, 'wanted, in a work room: the guard is coming for you, and it says that');
  // A word with whoever works there: the clock waits.
  const talking = watched(def, 'kitchen');
  const worker = talking.bot.st.inmates[0];
  const here = tileOf(talking.bot.st.player);
  const next = [here + 1, here - 1, here + MAP_W, here - MAP_W].find((t) => !talking.bot.sim.world.npcBlock[t])!;
  const standBy = () => {
    worker.body.x = (next % MAP_W) * UNIT + UNIT / 2;
    worker.body.z = Math.floor(next / MAP_W) * UNIT + UNIT / 2;
    worker.path = [];
    worker.wait = 100000;
    worker.ko = 0;
    worker.angry = 0;
  };
  standBy();
  talking.bot.st.talk = 0;
  let stayed = 0;
  for (let k = 0; k < 20 * 20; k++) {
    talking.hold();
    standBy();
    talking.bot.sim.step(0);
    if (talking.bot.st.talk === 0) stayed++;
  }
  check(stayed === 400, 'the talk goes on');
  check(talking.bot.st.heat === 0, 'talking to someone there: no heat while it lasts');
  // Already hot: it doesn't add to it.
  const hot = watched(def, 'kitchen');
  hot.bot.st.heat = STRANGER_CAP + 10;
  for (let k = 0; k < 15 * 20; k++) {
    hot.hold();
    hot.bot.sim.step(0);
  }
  check(hot.bot.st.heat <= STRANGER_CAP + 10, 'already hot: this adds nothing');
}

// ------------------------------------------------------------------ the first day's guide, the text
for (const k of ['toast.workWarning', 'work.wait', 'spotted.stranger', 'hint.workRoom', 'help.work.steps'] as const) {
  check(!!en[k] && !!fr[k], `${k}: in both languages`);
}
check(en['help.work.steps'].split('\n').length === (fr['help.work.steps'] ?? '').split('\n').length, 'help: as many lines in French');

// ------------------------------------------------------------------ saves and older runs
{
  const sim = new Sim(CENTER_PERKS, 3);
  while (minute(sim) < WORK + 30) {
    sim.state.attended = true;
    sim.step(0);
  }
  const snap = sim.snapshot();
  check(
    snap.state.inmates.some((m) => m.duty > 0),
    'a save at work holds how far through inmates are',
  );
  const bare = structuredClone(snap);
  for (const m of bare.state.inmates) delete (m as { duty?: number }).duty;
  delete (bare.state as { strayed?: number[] }).strayed;
  const old = new Sim(CENTER_PERKS, 3);
  old.restore(bare);
  check(
    old.state.inmates.every((m) => m.duty === 0),
    'a save from before: nobody partway',
  );
  check(Array.isArray(old.state.strayed) && old.state.strayed.length === 0, 'a save from before: nobody told');
  for (let k = 0; k < 40 * 20; k++) old.step(0);
  check(
    old.state.inmates.some((m) => m.duty > 0),
    'and on they work',
  );
}
{
  // A 2.29 run through the Work Period replays as it was.
  const was = new Sim(CENTER_PERKS, 24);
  was.rules229 = true;
  was.rules230 = true;
  was.rules231 = true;
  was.rules232 = true;
  was.rules2331 = true;
  was.rules233 = true;
  was.rules234 = true;
  const prev = new RunRecorder(was, { seed: 24, game: '2.29.0' });
  for (let k = 0; k < (WORK + 60 - 8 * 60) * STEPS_PER_MINUTE; k++) prev.step(0);
  check(
    prev.sim.state.inmates.every((m) => m.duty === 0),
    'the old rules: nobody on a round',
  );
  const replayed = replayLog(prev.toLog(), CENTER_PERKS);
  check(!!replayed?.ok && replayed.sim.rules229 === true, 'a 2.29 log through work replays whole under the old rules');
  check(!replayLog({ ...prev.toLog(), game: '2.36.0' }, CENTER_PERKS)?.ok, 'and would not under the new ones: the test can fail');
  check(new RunRecorder(prev.sim, { log: prev.toLog(), game: '2.36.0' }).toLog().seed === -1, 'and is not carried on');
  const now = new RunRecorder(new Sim(CENTER_PERKS, 24), { seed: 24, game: '2.36.1' });
  for (let k = 0; k < (WORK + 60 - 8 * 60) * STEPS_PER_MINUTE; k++) now.step(0);
  check(!!replayLog(now.toLog(), CENTER_PERKS)?.ok, "a log of today's replays");
  check(new RunRecorder(now.sim, { log: now.toLog(), game: '2.36.1' }).toLog().seed === 24, 'and is carried on');
}
