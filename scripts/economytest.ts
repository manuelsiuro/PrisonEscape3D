/**
 * The economy and social life (GDD §3.2, §10.3–10.4, §11), driven through the real
 * simulation with ordinary commands:
 * - the economy validator: every job's room has its furniture and opens for the Work
 *   Period; wages, prices and favors add up (a day's wage buys anything a merchant sells
 *   within two days); merchants sell what the item table says they sell;
 * - the worker bot: the laundry, three days running, quota met and paid each day (no heat);
 * - the idle worker: fired at 15:00, the job goes on the board, an inmate takes it later;
 * - sabotage: the kitchen hand knocked out during work loses the job; the player takes it;
 * - the job board: only at the board, Intellect checked, taken during work counts tomorrow;
 * - training: alternate presses fill a set, +2 and the energy it costs; too tired, nothing;
 *   untrained attributes slip a point the next morning, never below the start; Speed walks
 *   faster;
 * - merchants: open in free time only, cheaper with opinion, never for someone they despise;
 * - gifts raise opinion, blows lower it; favors pay and please; a grudge jumps the player;
 * - followers: recruited from 80, at the player's heels, fighting a chasing guard; gone at
 *   Lights Out;
 * - a save restored in the middle of work plays on exactly the same.
 */
import { itemDef, itemNumber, ITEMS } from '../src/content/items';
import { JOBS } from '../src/content/jobs';
import { LOOT } from '../src/content/loot';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { PRISONS } from '../src/content/prisons';
import { ROUTINE } from '../src/content/routine';
import { ZONES } from '../src/content/zones';
import { Autopilot } from '../src/sim/ai/autopilot';
import { nearestDir } from '../src/sim/ai/path';
import { placesOf } from '../src/sim/ai/places';
import { command, OP, TALK } from '../src/sim/command';
import { RECIPES } from '../src/content/recipes';
import { TRAINING } from '../src/content/prisons/training';
import { obtainable } from '../src/sim/systems/recipes';
import { Sim, type SimEvent, type Snapshot } from '../src/sim/Sim';
import { clockAt, formatTime } from '../src/sim/systems/clock';
import { discountOf, FAVOR, FAVOR_STATE, HOLDER, jobRooms, priceOf, stationTarget } from '../src/sim/systems/economy';
import { GUARD, type Guard } from '../src/sim/systems/guards';
import type { Inmate } from '../src/sim/systems/inmates';
import { HOTBAR, itemOf, pocketOf, slot, usesOf } from '../src/sim/systems/items';
import { STEPS_PER_MINUTE, UNIT, walkSpeed } from '../src/sim/tuning';
import { reachableFrom } from '../src/sim/world/reach';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';

const n = (id: string) => itemNumber(id);
const DAY = 1440 * STEPS_PER_MINUTE;
const MIN = STEPS_PER_MINUTE;
const at = (step: number) => {
  const c = clockAt(step);
  return `day ${c.day} ${formatTime(c)}`;
};
/** Steps from the start to a time of day on a day (day 1 starts at 08:00). */
const stepAt = (day: number, h: number, m = 0) => ((day - 1) * 1440 + h * 60 + m - 8 * 60) * MIN;

// ------------------------------------------------------------------ the economy validator
for (const prison of PRISONS) {
  const sim = new Sim(prison);
  const w = sim.world;
  const rooms = jobRooms(w);
  const reach = reachableFrom(w, prison.spawn.x, prison.spawn.z);
  check(rooms.length === prison.jobs.length && rooms.length > 0, `${prison.id}: jobs on offer`);
  for (const r of rooms) {
    const d = r.def;
    const need = d.flow === 'machine' ? [r.take, r.put, r.machines[0] ?? -1] : d.flow === 'mail' ? [r.machines[0] ?? -1] : [r.take];
    check(need.every((i) => i >= 0), `${prison.id}: the ${d.id} room has its furniture`);
    if (d.flow === 'machine') check(r.take !== r.put, `${prison.id}: the ${d.id} job takes and puts at different places`);
    check(d.int >= 20 && d.int <= 100 && d.wage > 0 && d.quota > 0, `${prison.id}: ${d.id} pays and asks something sensible`);
    check(!!d.raw === (d.flow !== 'mail') && !!d.done === (d.flow !== 'mop'), `${prison.id}: ${d.id} names what it works with`);
  }
  // The rooms open for the Work Period: walkable from the cell then (the day's 12:00).
  const work = new Sim(prison);
  while (ROUTINE[work.state.routine].id !== 'work') {
    work.state.attended = true;
    work.step(0);
  }
  const open = reachableFrom(work.world, prison.spawn.x, prison.spawn.z);
  for (const r of rooms) {
    let shut = false;
    let walk = false;
    for (let i = 0; i < reach.length; i++) {
      if (w.ground.zone[i] !== r.zone) continue;
      if (reach[i]) shut = true;
      if (open[i]) walk = true;
    }
    check(walk, `${prison.id}: the ${r.def.id} room can be walked to during work`);
    if (r.def.zone !== 'woodshop') check(!shut, `${prison.id}: the ${r.def.id} room is locked outside work`);
  }
  // Who's who: names, merchants, the first holders.
  check(prison.names.length === prison.cells.length - 1, `${prison.id}: every inmate has a name`);
  check(prison.merchants.every((c) => c >= 2 && c <= prison.cells.length), `${prison.id}: merchants are inmates`);
  check(prison.jobs.filter((j) => j.cell === 1).length === 1, `${prison.id}: the player starts with one job`);
}
{
  // Merchants sell what items say merchants sell; prices against a day's pay.
  const table = LOOT.merchant.items.map(([id]) => id);
  const sellers = ITEMS.filter((d) => d.from.includes('merchant')).map((d) => d.id);
  check(sellers.every((id) => table.includes(id)) && table.every((id) => sellers.includes(id)), 'the merchant table is exactly the items sold by merchants');
  check(table.every((id) => itemDef(n(id)).value > 0), 'everything for sale has a price');
  const low = Math.min(...Object.values(JOBS).map((j) => j.wage));
  const priciest = Math.max(...table.map((id) => itemDef(n(id)).value));
  console.log(`wages $${Object.values(JOBS).map((j) => `${j.id} ${j.wage}`).join(', $')}; merchant prices $${Math.min(...table.map((id) => itemDef(n(id)).value))}–${priciest} (at 100 opinion $${priceOf(priciest, 100)})`);
  check(priciest <= 2 * low, `the priciest item (${priciest}) takes at most two days of the lowest wage (${low})`);
  check(priceOf(20, 50) === 20 && priceOf(20, 100) === 10 && priceOf(20, 0) === 20 && priceOf(1, 100) === 1, 'no discount at 50, half price at 100, never under $1');
  check(discountOf(75) === 0.25, 'the discount grows with opinion');
}

// ------------------------------------------------------------------ helpers
type Bot = (sim: Sim) => number;
/** Puts a body in the middle of a tile. */
function put(b: { x: number; z: number; moving?: boolean }, x: number, z: number) {
  b.x = x * UNIT + UNIT / 2;
  b.z = z * UNIT + UNIT / 2;
  b.moving = false;
}
const tileOf = (b: { x: number; z: number }) => Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);

/**
 * Goes wherever the routine says (as routinetest's model prisoner), and with `work`, does
 * the job during the Work Period: walks to the station that comes next, faces it, presses
 * the action button.
 */
function worker(work: boolean): (sim: Sim) => Bot {
  return (sim) => {
    const pilot = new Autopilot(sim.world);
    const places = placesOf(sim.world);
    let want = '';
    let wait = 0;
    return (s) => {
      const st = s.state;
      const r = ROUTINE[st.routine];
      if (work && r.id === 'work' && s.jobActive() >= 0 && !st.paid && !st.lockdown) {
        const room = jobRooms(s.world)[s.jobActive()];
        // At a station that has something to do: do it (once the machine is done, take it out).
        const here = s.station();
        if (here && here.act !== 'running' && here.act !== 'full' && wait <= 0) {
          wait = 6;
          want = '';
          return command(0, OP.INTERACT);
        }
        wait--;
        // Where next: a load that's ready, the put bin with a finished one, a free machine with a raw one, the take bin.
        const inv = st.items.inv.slice(0, HOTBAR).map(itemOf);
        const raw = room.def.raw ? n(room.def.raw) : 0;
        const done = room.def.done ? n(room.def.done) : 0;
        const flow = room.def.flow;
        // The janitor: mop in hand, to the nearest puddle.
        if (flow === 'mop' && inv.includes(raw)) {
          if (inv[st.items.hand] !== raw) return command(0, OP.SELECT, inv.indexOf(raw));
          if (want !== 'puddle' || !pilot.active) {
            want = 'puddle';
            pilot.goToAny((i) => st.puddles.includes(i));
          }
          return command(pilot.dir(st.player));
        }
        // The mailman: a letter in the bag goes to its addressee (wherever they are now).
        const letter = flow === 'mail' ? st.items.inv.slice(0, HOTBAR).find((v) => itemOf(v) === done && st.mail.includes(usesOf(v) - 1)) : undefined;
        const ready = room.machines.find((i) => st.machines[i] !== undefined && st.machines[i] <= st.step);
        if (letter && ready === undefined) {
          const m = st.inmates[usesOf(letter) - 1];
          const dx = m.body.x - st.player.x;
          const dz = m.body.z - st.player.z;
          if (Math.max(Math.abs(dx), Math.abs(dz)) < UNIT * 1.2 && wait <= 0) {
            wait = 4;
            st.player.facing = nearestDir(dx, dz);
            return command(0, OP.INTERACT);
          }
          if (want !== 'mail' || st.step % 40 === 0) {
            want = 'mail';
            const t = tileOf(m.body);
            pilot.goToAny((i) => Math.abs((i % MAP_W) - (t % MAP_W)) + Math.abs(Math.floor(i / MAP_W) - Math.floor(t / MAP_W)) === 1);
          }
          return command(pilot.dir(st.player));
        }
        const free = room.machines.find((i) => st.machines[i] === undefined);
        const prop = flow === 'mail' ? (ready ?? free ?? room.machines[0]) : (ready ?? (done && inv.includes(done) ? room.put : raw && inv.includes(raw) ? free : room.take));
        const key = `prop${prop}`;
        if (prop === undefined || prop < 0) return 0;
        const p = s.world.props[prop];
        const near = (i: number) => {
          const x = i % MAP_W;
          const z = Math.floor(i / MAP_W);
          return x >= p.x - 1 && x <= p.x + p.w && z >= p.z - 1 && z <= p.z + p.d && !s.world.blocked(x, z);
        };
        if (key !== want) {
          want = key;
          pilot.goToAny(near);
        }
        const d = pilot.dir(st.player);
        if (d || pilot.active) return command(d);
        // There: turn to face it (a step into it).
        return command(nearestDir((p.x + p.w / 2) * UNIT - st.player.x, (p.z + p.d / 2) * UNIT - st.player.z));
      }
      const k = st.lockdown ? 'lockdown' : r.zones.length ? r.id : 'free';
      if (k !== want) {
        want = k;
        if (k === 'lockdown' || k === 'lightsOut') pilot.goTo(places.bedside[1]);
        else if (k === 'rollCall' || k === 'eveningRollCall') pilot.goTo(places.rollCall[0].tile);
        else if (r.zones.length) pilot.goToAny((i) => r.zones.includes(ZONES[s.world.ground.zone[i]]));
        else pilot.stop();
      }
      return command(pilot.dir(st.player));
    };
  };
}

function describe(sim: Sim, e: SimEvent): string {
  switch (e.type) {
    case 'cash':
      return `${e.n > 0 ? '+' : ''}$${e.n} (${e.why})`;
    case 'quota':
      return `quota ${e.n}/${e.of}`;
    case 'job':
      return `${e.who === HOLDER.PLAYER ? 'player' : `inmate ${e.who}`} ${e.change}: ${sim.prison.jobs[e.job].id}`;
    case 'missed':
      return `missed ${ROUTINE[e.routine].id} +${e.heat}%`;
    case 'lockdown':
      return e.on ? 'LOCKDOWN' : '';
    case 'decay':
      return `decay ${e.attrs.join(' ')}`;
    default:
      return '';
  }
}

function run(bot: (sim: Sim) => Bot, steps: number, seed = 3, every?: (sim: Sim) => void, job = 0) {
  const sim = new Sim(CENTER_PERKS, seed);
  // Another job from day 1: the player takes it (its holder moves to the laundry).
  if (job > 0) [sim.state.jobs[0], sim.state.jobs[job]] = [sim.state.jobs[job], HOLDER.PLAYER];
  const play = bot(sim);
  const log: string[] = [];
  for (let i = 0; i < steps; i++) {
    sim.step(play(sim));
    for (const e of sim.events) {
      const d = describe(sim, e);
      if (d) log.push(`${at(sim.state.step)} ${d}`);
    }
    every?.(sim);
  }
  return { sim, log };
}

// ------------------------------------------------------------------ the worker bot: laundry, 3 days
{
  const { sim, log } = run(worker(true), 3 * DAY);
  const st = sim.state;
  console.log('worker bot (laundry, 3 days):');
  for (const l of log) console.log(`  ${l}`);
  const wage = JOBS.laundry.wage;
  check(log.filter((l) => l.includes('(wage)')).length === 3, 'the worker is paid three days running');
  check(st.cash >= 3 * wage, `the worker earned at least $${3 * wage} (has $${st.cash})`);
  check(sim.playerJob === 0, 'the worker still has the laundry job');
  check(st.heat === 0 && !log.some((l) => l.includes('LOCKDOWN')), 'the worker ends with no heat, no lockdown');
  check(!st.items.inv.some((v) => ['dirty_laundry', 'clean_laundry'].includes(itemDef(itemOf(v))?.id ?? '')), 'work items are handed back at 15:00');
}

// ------------------------------------------------------------------ every job can be done in a day
for (let job = 1; job < CENTER_PERKS.jobs.length; job++) {
  const id = CENTER_PERKS.jobs[job].id;
  const { sim, log } = run(worker(true), DAY, 3, undefined, job);
  const paid = log.find((l) => l.includes('(wage)'));
  console.log(`${id}: ${paid ?? 'not paid'}`);
  check(!!paid && sim.playerJob === job && sim.state.cash >= JOBS[id].wage, `the ${id} job can be done and paid in one work period`);
  check(sim.state.heat < 100, `doing the ${id} job raises no alarm`);
}

// ------------------------------------------------------------------ the idle worker: fired, the job goes to an inmate
{
  const { sim, log } = run(worker(false), 3 * DAY);
  console.log('idle worker (never works):');
  for (const l of log.filter((x) => x.includes('player') || x.includes('laundry'))) console.log(`  ${l}`);
  check(log.some((l) => l.startsWith('day 1 15:00') && l.includes('player fired: laundry')), 'missing the quota costs the job at 15:00');
  const holder = sim.state.jobs[0];
  check(holder >= 0, `an inmate took the laundry job two mornings later (holder ${holder})`);
  check(log.some((l) => l.startsWith('day 3 08:00') && l.includes('hired: laundry')), 'the vacancy is filled on day 3 at 08:00');
  check(sim.state.heat === 0, 'losing a job costs no heat');
}

// ------------------------------------------------------------------ an arena for the rest
function freeze(m: Inmate, x: number, z: number, facing = 5) {
  put(m.body, x, z);
  m.body.facing = facing;
  m.path = [];
  m.goal = -1;
  m.wait = 1_000_000;
}
function plant(g: Guard, x: number, z: number, facing: number) {
  put(g.body, x, z);
  g.body.facing = g.face = facing;
  g.path = [];
  g.wait = 1_000_000;
  g.mode = GUARD.DUTY;
  g.doing = 0;
}
/** Guards in the guard quarters facing the wall, inmates in their cells; the clock moved to a time. */
function arena(step = 0, seed = 5) {
  const sim = new Sim(CENTER_PERKS, seed);
  const st = sim.state;
  st.step = step;
  st.routine = ROUTINE.findIndex((_, k) => k === ROUTINE.length - 1 || ROUTINE[k + 1].start > clockAt(step).minuteOfDay);
  st.guards.forEach((g, k) => plant(g, 40 + k * 2, 40, 13));
  st.inmates.forEach((m) => freeze(m, sim.world.def.cells[m.cell - 1][0] + 1, sim.world.def.cells[m.cell - 1][1] + 1));
  const events: SimEvent[] = [];
  const stepOnce = (cmd = 0) => {
    st.attended = true;
    sim.step(cmd);
    events.push(...sim.events);
  };
  const op = (o: number, a = 0, b = 0) => stepOnce(command(0, o, a, b));
  const steps = (k: number) => {
    for (let i = 0; i < k; i++) stepOnce();
  };
  const has = (type: string, f: (e: SimEvent) => boolean = () => true) => events.some((e) => e.type === type && f(e));
  return { sim, st, events, step: stepOnce, op, steps, has };
}
/** Stand facing an inmate a tile away and talk. */
function talkTo(a: ReturnType<typeof arena>, who: number) {
  const m = a.st.inmates[who];
  // Wherever it's going (a bench, a hangout): until it stands still there.
  for (let k = 0; k < 600 && m.body.moving; k++) a.step();
  // A tile south of where it stands (it may have stopped between tiles, on its way to a seat).
  a.st.player.x = m.body.x;
  a.st.player.z = m.body.z + UNIT;
  a.st.player.facing = 13;
  a.op(OP.INTERACT);
  return a.st.talk === who;
}

// ------------------------------------------------------------------ sabotage, the job board
{
  // 12:10 on day 1: the kitchen hand (cell 5) is knocked out at work and loses the job at 15:00.
  const a = arena(stepAt(1, 11, 59));
  const { sim, st } = a;
  a.steps(MIN + 2);
  check(ROUTINE[st.routine].id === 'work', 'the work period began');
  const cook = st.jobs[2];
  check(cook === 3 && sim.prison.jobs[2].id === 'kitchen', 'the kitchen hand is the inmate in cell 5');
  // It's at work (in the kitchen), then knocked out there.
  const m = st.inmates[cook];
  freeze(m, 53, 17);
  a.steps(2);
  check(m.shift === 1, 'the kitchen hand clocked in');
  m.hp = 1;
  put(st.player, 52, 17);
  st.player.facing = 1;
  a.op(OP.LOCK, 2 + cook);
  a.op(OP.USE, 1);
  check(m.ko > 0 && m.shift === 2, 'knocked out on the job');
  while (ROUTINE[st.routine].id === 'work') a.step();
  check(a.has('job', (e) => e.type === 'job' && e.job === 2 && e.who === cook && e.change === 'fired'), 'knocked out at work: fired at 15:00');
  check(st.jobs[2] === HOLDER.NOBODY, 'the kitchen job is open');
  // The board: only at the board, Intellect checked.
  a.op(OP.JOB, 3);
  check(st.jobs[2] === HOLDER.NOBODY, 'no applying away from the board');
  put(st.player, 27, 22);
  st.player.facing = 13;
  a.op(OP.INTERACT);
  check(a.has('board'), 'the action button at the board opens it');
  a.op(OP.JOB, 5);
  check(st.jobs[4] !== HOLDER.PLAYER && a.has('refused', (e) => e.type === 'refused' && e.why === 'taken'), 'a job someone holds is refused');
  a.op(OP.JOB, 3);
  check(st.jobs[2] === HOLDER.PLAYER && st.jobs[0] === HOLDER.NOBODY, 'the player takes the kitchen job and leaves the laundry');
  check(st.jobDay === 2, 'taken after the work period began: it counts from tomorrow');
  // The woodshop is open but wants Intellect 40: at 30 it's refused.
  st.items.int = 30;
  a.op(OP.JOB, 4);
  check(st.jobs[3] === HOLDER.NOBODY && a.has('refused', (e) => e.type === 'refused' && e.why === 'int'), 'not enough Intellect: refused');
  // The player stood about instead of doing the laundry: fired too, at 15:00.
  check(a.events.some((e) => e.type === 'job' && e.who === HOLDER.PLAYER && e.change === 'fired' && e.job === 0), 'the player, idle at work, lost the laundry job');
  console.log(`sabotage: the kitchen hand fired at 15:00, the player hired for day ${st.jobDay}`);
}

// ------------------------------------------------------------------ the doors of the job rooms
{
  const a = arena(stepAt(1, 11, 58));
  const { sim, st } = a;
  const door = 24 * MAP_W + 53;
  check(sim.world.doorShut[door] === 1, 'the laundry door is shut before work');
  a.steps(3 * MIN);
  check(sim.world.doorShut[door] === 0, 'it stands open during work');
  put(st.player, 53, 26);
  while (ROUTINE[st.routine].id === 'work') a.step();
  a.step();
  check(sim.world.doorShut[door] === 0, 'still open at 15:00 while the player is inside');
  put(st.player, 53, 22);
  a.step();
  check(sim.world.doorShut[door] === 1, 'shut once nobody is inside');
}

// ------------------------------------------------------------------ training, decay and Speed
{
  const a = arena(stepAt(1, 10, 30));
  const { sim, st } = a;
  // The weights at (7, 28): stand south of them, facing north.
  put(st.player, 7, 29);
  st.player.facing = 13;
  a.op(OP.INTERACT);
  check(st.train >= 0 && sim.world.props[st.train].kind === 'weights' && a.has('train'), 'the action button at the weights starts training');
  // Pressing one side over and over fills nothing.
  for (let k = 0; k < 10; k++) a.op(OP.TRAIN, 1);
  check(st.reps <= 6, `the same side again doesn't count (bar ${st.reps})`);
  const e0 = st.energy;
  let sets = 0;
  for (let k = 0; k < 400 && sets < 3; k++) {
    a.op(OP.TRAIN, 1 + (k % 2));
    if (sim.events.some((e) => e.type === 'trained')) sets++;
  }
  console.log(`training: 3 sets of weights → STR ${st.str}, energy ${e0} → ${st.energy}`);
  check(st.str === 46 && st.energy <= e0 - 34 && st.energy >= e0 - 36, 'three sets: +6 Strength, 36 energy (less a point or two back while training)');
  check((st.trained & 1) === 1, 'Strength trained today');
  // Too tired: off the equipment, nothing more.
  st.energy = 9;
  a.op(OP.TRAIN, 3);
  a.op(OP.INTERACT);
  check(st.train < 0 && a.has('cantTrain', (e) => e.type === 'cantTrain' && e.why === 'tired'), 'under 10% energy: no training');
  // A step away ends a set.
  st.energy = 100;
  a.op(OP.INTERACT);
  a.step(command(5));
  check(st.train < 0, 'stepping away ends the training');
  // The library: study from the shelf's panel.
  put(st.player, 17, 31);
  st.player.facing = 13;
  a.op(OP.INTERACT);
  a.op(OP.TRAIN, 0);
  check(st.train >= 0 && sim.trainsOn(st.train) === 'int', 'a book from the library shelf: studying');
  for (let k = 0; k < 60 && st.items.int === 40; k++) a.op(OP.TRAIN, 1 + (k % 2));
  check(st.items.int === 42 && st.energy === 90, `a set of study: +2 Intellect, 10 energy (INT ${st.items.int}, energy ${st.energy})`);
  // The next morning: untrained Speed stays at 40 (the floor), trained ones keep; Strength trained yesterday.
  st.spd = 47;
  st.trained = 1;
  a.op(OP.TRAIN, 3);
  while (clockAt(st.step).day < 2 || ROUTINE[st.routine].id !== 'rollCall') a.step();
  check(st.str === 46 && st.items.int === 41 && st.spd === 46, `the next morning: untrained INT and SPD slip a point, STR (trained) keeps (STR ${st.str} SPD ${st.spd} INT ${st.items.int})`);
  // Speed walks faster.
  const pace = (spd: number) => {
    const b = new Sim(CENTER_PERKS, 1);
    b.state.spd = spd;
    put(b.state.player, 30, 26);
    const x0 = b.state.player.x;
    for (let k = 0; k < 20; k++) b.step(command(1));
    return (b.state.player.x - x0) / UNIT;
  };
  console.log(`speed: ${pace(40).toFixed(2)} tiles a second at SPD 40, ${pace(100).toFixed(2)} at 100`);
  check(walkSpeed(40) === 184 && pace(100) > pace(40), 'Speed 40 walks as before; more Speed walks faster');
}

// ------------------------------------------------------------------ merchants, gifts, opinion
{
  const a = arena(stepAt(1, 10, 30));
  const { sim, st } = a;
  const who = st.inmates.findIndex((m) => m.cell === CENTER_PERKS.merchants[0]);
  check(talkTo(a, who), 'the action button on an inmate starts a talk');
  const shop = st.shops[0];
  const k = shop.findIndex((v) => v);
  const item = itemOf(shop[k]);
  const price = priceOf(itemDef(item).value, st.inmates[who].opinion);
  a.op(OP.TALK, TALK.BUY, k);
  check(shop[k] !== 0 && a.has('refused', (e) => e.type === 'refused' && e.why === 'cash'), 'no cash, no sale');
  st.cash = 100;
  st.inmates[who].opinion = 100;
  const cheap = priceOf(itemDef(item).value, 100);
  a.op(OP.TALK, TALK.BUY, k);
  check(shop[k] === 0 && st.items.inv.some((v) => itemOf(v) === item) && st.cash === 100 - cheap, `bought at half price ($${cheap} instead of $${price})`);
  // A grudge: no deals.
  st.inmates[who].opinion = 20;
  const k2 = shop.findIndex((v) => v);
  if (k2 >= 0) {
    a.op(OP.TALK, TALK.BUY, k2);
    check(shop[k2] !== 0 && a.has('refused', (e) => e.type === 'refused' && e.why === 'grudge'), 'a merchant who despises the player won\'t sell');
  }
  // Gifts: an item worth $15 is +8, $10 cash +6.
  st.inmates[who].opinion = 50;
  st.items.inv[0] = slot(n('lighter'));
  a.op(OP.TALK, TALK.GIFT, 0);
  check(st.inmates[who].opinion === 58 && !st.items.inv[0], 'a lighter given: +8 opinion');
  const cash = st.cash;
  a.op(OP.TALK, TALK.GIFT_CASH, 10);
  check(st.inmates[who].opinion === 64 && st.cash === cash - 10, '$10 given: +6 opinion');
  st.items.inv[0] = slot(n('dirty_laundry'));
  a.op(OP.TALK, TALK.GIFT, 0);
  check(st.items.inv[0] !== 0 && a.has('refused', (e) => e.type === 'refused' && e.why === 'worthless'), 'work items make no gift');
  st.items.inv[0] = 0;
  // Shops close outside free time.
  st.inmates[who].opinion = 60;
  a.op(OP.CLOSE);
  check(st.talk < 0, 'closing ends the talk');
  while (ROUTINE[st.routine].id !== 'work') a.step();
  talkTo(a, who);
  const k3 = shop.findIndex((v) => v);
  if (k3 >= 0) {
    a.op(OP.TALK, TALK.BUY, k3);
    check(shop[k3] !== 0 && a.has('refused', (e) => e.type === 'refused' && e.why === 'closed'), 'shops shut outside free time');
  }
  // A blow costs opinion; the talk is over.
  const before = st.inmates[who].opinion;
  a.op(OP.LOCK, 2 + who);
  a.op(OP.USE, 1);
  check(st.inmates[who].opinion === before - 8 && st.talk < 0, 'a punch: -8 opinion, the talk is over');
  console.log(`merchant: sold ${itemDef(item).id} at $${price}, $${cheap} to a friend`);
}

// ------------------------------------------------------------------ favors
{
  const a = arena(stepAt(1, 10, 30), 7);
  const { st } = a;
  check(st.favors.length > 0 && st.favors.every((f) => f.state === FAVOR_STATE.OFFERED && f.reward >= 20 && f.reward <= 50), `day 1 brings favors on offer (${st.favors.length}), $20–50 each`);
  // A scavenge favor, set up by hand: accept, bring the item, hand it in.
  st.favors = [{ by: 0, kind: FAVOR.SCAVENGE, item: n('magazine'), target: -1, reward: 30, state: FAVOR_STATE.OFFERED }];
  talkTo(a, 0);
  a.op(OP.TALK, TALK.ACCEPT);
  a.op(OP.TALK, TALK.HAND_IN);
  check(st.favors[0].state === FAVOR_STATE.TAKEN && a.has('refused', (e) => e.type === 'refused' && e.why === 'missing'), 'handing in without the item: refused');
  st.items.inv[2] = slot(n('magazine'));
  const op0 = st.inmates[0].opinion;
  a.op(OP.TALK, TALK.HAND_IN);
  check(st.favors.length === 0 && st.cash === 30 && st.inmates[0].opinion === op0 + 15 && !st.items.inv[2], 'scavenge favor: the item goes, $30 and +15 opinion');
  // Retrieval: the stolen item turns up in the thief's pockets when it's taken on.
  st.favors = [{ by: 1, kind: FAVOR.RETRIEVE, item: n('soap'), target: 4, reward: 25, state: FAVOR_STATE.OFFERED }];
  talkTo(a, 1);
  a.op(OP.TALK, TALK.ACCEPT);
  check(st.items.containers[pocketOf(a.sim.world, 4)].some((v) => itemOf(v) === n('soap')), 'retrieval favor: the thief has it');
  // Beatdown: done when the target is knocked out.
  st.favors = [{ by: 2, kind: FAVOR.BEATDOWN, item: 0, target: 5, reward: 40, state: FAVOR_STATE.OFFERED }];
  talkTo(a, 2);
  a.op(OP.TALK, TALK.ACCEPT);
  a.op(OP.TALK, TALK.HAND_IN);
  check(a.has('refused', (e) => e.type === 'refused' && e.why === 'notDone'), 'beatdown not done yet: refused');
  a.op(OP.CLOSE);
  const t = st.inmates[5];
  t.hp = 1;
  put(st.player, Math.floor(t.body.x / UNIT), Math.floor(t.body.z / UNIT) + 1);
  a.op(OP.LOCK, 2 + 5);
  a.op(OP.USE, 1);
  check(t.ko > 0 && st.favors[0].state === FAVOR_STATE.DONE, 'the target knocked out: the beatdown favor is done');
  talkTo(a, 2);
  a.op(OP.TALK, TALK.HAND_IN);
  check(st.favors.length === 0 && st.cash === 70, 'handed in: $40 more');
}

// ------------------------------------------------------------------ a grudge
{
  const a = arena(stepAt(1, 8, 59), 9);
  const { st } = a;
  a.steps(MIN + 2);
  check(ROUTINE[st.routine].id === 'breakfast', 'breakfast');
  const m = st.inmates[0];
  m.opinion = 10;
  freeze(m, 45, 15);
  put(st.player, 46, 16);
  let when = -1;
  for (let k = 0; k < 4 * MIN * 60 && when < 0; k++) {
    a.step();
    if (a.has('ambush')) when = k;
  }
  check(when >= 0 && m.angry > 0, `an inmate who despises the player jumps them at a meal (after ${when} steps)`);
}

// ------------------------------------------------------------------ followers
{
  const a = arena(stepAt(1, 10, 30), 11);
  const { sim, st } = a;
  const who = 2;
  const m = st.inmates[who];
  talkTo(a, who);
  a.op(OP.TALK, TALK.RECRUIT);
  check(!st.followers.length && a.has('refused', (e) => e.type === 'refused' && e.why === 'opinion'), 'recruiting needs opinion 80');
  m.opinion = 85;
  a.op(OP.TALK, TALK.RECRUIT);
  check(st.followers.includes(who), 'recruited at 85');
  a.op(OP.CLOSE);
  m.wait = 0;
  // The player walks off across the corridor: the follower keeps up.
  put(st.player, 10, 22);
  a.steps(60);
  const pilot = new Autopilot(sim.world);
  pilot.goTo(22 * MAP_W + 40);
  let far = 0;
  for (let k = 0; k < 20 * 20; k++) {
    a.step(command(pilot.dir(st.player)));
    if (k > 100) far = Math.max(far, Math.hypot(m.body.x - st.player.x, m.body.z - st.player.z) / UNIT);
  }
  console.log(`follower: at most ${far.toFixed(1)} tiles behind on a walk down the corridor`);
  check(far < 4, 'a follower keeps up with the player');
  // A guard comes for the player: the follower goes for it.
  const g = st.guards[0];
  put(g.body, 44, 22);
  g.wait = 0;
  g.mode = GUARD.CHASE;
  st.heat = 85;
  let hits = 0;
  for (let k = 0; k < 400 && !st.ko; k++) {
    a.step();
    hits += sim.events.filter((e) => e.type === 'allyHit').length;
  }
  check(hits > 0, `the follower fights a chasing guard (${hits} blows)`);
  // Lights Out: followers go to bed.
  const b = arena(stepAt(1, 22, 58), 11);
  b.st.followers = [1];
  b.steps(3 * MIN);
  check(b.st.followers.length === 0 && b.has('recruit', (e) => e.type === 'recruit' && !e.on), 'followers go to bed at Lights Out');
}

// ------------------------------------------------------------------ change in pockets, and a save mid-work
{
  const a = arena(stepAt(1, 10, 30), 13);
  const { sim, st } = a;
  const k = Object.keys(st.coins).map(Number).find((i) => i >= pocketOf(sim.world, 0));
  check(k !== undefined, 'some inmates carry change');
  if (k !== undefined) {
    const who = k - pocketOf(sim.world, 0);
    const v = st.coins[k];
    const t = st.inmates[who];
    t.ko = 600;
    put(st.player, Math.floor(t.body.x / UNIT), Math.floor(t.body.z / UNIT) + 1);
    st.player.facing = 13;
    a.op(OP.INTERACT);
    check(st.cash === v && st.coins[k] === undefined, `going through their pockets: $${v} found`);
  }
}
{
  // The worker bot to 12:40 on day 1, saved, then both runs go on to 15:00: the same state.
  const sim = new Sim(CENTER_PERKS, 3);
  const play = worker(true)(sim);
  while (sim.state.step < stepAt(1, 12, 40)) sim.step(play(sim));
  check(Object.keys(sim.state.machines).length > 0 || sim.state.quota > 0, 'mid-work: machines running or loads done');
  const snap = sim.snapshot();
  const copy = new Sim(CENTER_PERKS, 99);
  copy.restore(snap);
  check(copy.hash() === sim.hash(), 'restored mid-work: the same state');
  const play2 = worker(true)(copy);
  for (let k = 0; k < 60 * MIN; k++) {
    sim.step(play(sim));
    copy.step(play2(copy));
  }
  check(copy.hash() === sim.hash(), 'an hour on: still the same');
  // An old save (before P6) loads with the starting economy.
  const old = sim.snapshot();
  const raw = old.state as unknown as Record<string, unknown>;
  for (const key of ['cash', 'coins', 'jobs', 'jobOpen', 'jobDay', 'quota', 'paid', 'machines', 'puddles', 'mail', 'train', 'reps', 'repSide', 'trained', 'talk', 'followers', 'favors', 'shops']) delete raw[key];
  for (const m of old.state.inmates as unknown as Array<Record<string, unknown>>) {
    delete m.opinion;
    delete m.shift;
  }
  const back = new Sim(CENTER_PERKS, 1);
  back.restore(old);
  check(back.state.cash === 0 && back.playerJob === 0 && back.state.jobDay > back.today && back.state.inmates.every((m) => m.opinion === 50), 'a save from before P6 loads: no cash, the laundry from tomorrow, opinions at 50');
  for (let k = 0; k < DAY / 2; k++) back.step(0);
  check(true, 'and plays on');
}

// Every station of every job is something the action button can do (the station logic is total).
{
  const sim = new Sim(CENTER_PERKS);
  const ws = { job: 0, onDuty: true, machines: {}, puddles: [], step: 0, inv: [0, 0, 0, 0, 0, 0, 0, 0], hand: 0 };
  const room = jobRooms(sim.world)[0];
  const p = sim.world.props[room.take];
  const b = { x: (p.x + 0.5) * UNIT, z: (p.z - 0.5) * UNIT, facing: 5, moving: false };
  check(stationTarget(sim.world, ws, b)?.act === 'take', 'at the dirty bin with empty hands: take a load');
}

// ------------------------------------------------------------------ review: lockdowns excuse work, scuffles, the mail desk
{
  // A lockdown through the Work Period: inmates were in their cells, the player in the yard: nobody is fired.
  const a = arena(stepAt(1, 11, 59), 17);
  const { st } = a;
  a.steps(MIN + 2);
  st.heat = 100;
  st.lockdown = true;
  st.excused = true;
  while (ROUTINE[st.routine].id === 'work') a.step();
  const fired = a.events.filter((e) => e.type === 'job' && e.change === 'fired');
  check(!fired.length, 'a lockdown during work: nobody loses a job');
}
{
  // An inmate jumps the player; hitting back in a guard's sight is a scuffle (a little heat), not the alarm.
  const a = arena(stepAt(1, 10, 30), 19);
  const { sim, st } = a;
  const m = st.inmates[0];
  freeze(m, 30, 22);
  m.angry = 400;
  put(st.player, 30, 23);
  const g = st.guards[1];
  put(g.body, 30, 26);
  g.body.facing = g.face = 13;
  a.op(OP.LOCK, 2);
  a.op(OP.USE, 1);
  check(st.selfDefense && st.heat > 0 && st.heat <= 10 && !st.lockdown && a.has('spotted', (e) => e.type === 'spotted' && e.reason === 'brawl'), `hitting back, seen: a scuffle (${st.heat}% heat)`);
  // Hitting someone calm in sight: the alarm, as before.
  const b = arena(stepAt(1, 10, 30), 19);
  freeze(b.st.inmates[0], 30, 22);
  put(b.st.player, 30, 23);
  const g2 = b.st.guards[1];
  put(g2.body, 30, 26);
  g2.body.facing = g2.face = 13;
  b.op(OP.LOCK, 2);
  b.op(OP.USE, 1);
  check(!b.st.selfDefense && b.st.lockdown, 'attacking a calm inmate in sight: lockdown');
  void sim;
}
{
  // The mail desk sorts only as many letters as there are inmates waiting; dropped work items go back at 15:00.
  const a = arena(stepAt(1, 11, 59), 23);
  const { sim, st } = a;
  [st.jobs[0], st.jobs[4]] = [st.jobs[4], HOLDER.PLAYER];
  a.steps(MIN + 2);
  check(st.mail.length === 3, 'three letters to deliver');
  const desk = jobRooms(sim.world)[4].machines[0];
  const p = sim.world.props[desk];
  put(st.player, p.x, p.z + 1);
  st.player.facing = 13;
  let sorted = 0;
  for (let k = 0; k < 12; k++) {
    a.op(OP.INTERACT);
    a.steps(4 * 20);
    sorted = st.items.inv.filter((v) => itemOf(v) === n('letter')).length;
  }
  check(sorted === 3 && Object.keys(st.machines).length === 0, `no more letters than addressees (${sorted})`);
  check(new Set(st.items.inv.filter((v) => itemOf(v) === n('letter')).map(usesOf)).size === 3, 'each letter for a different inmate');
  a.op(OP.DROP, st.items.inv.findIndex((v) => itemOf(v) === n('letter')));
  while (ROUTINE[st.routine].id === 'work') a.step();
  check(!st.items.ground.some(([, v]) => itemOf(v) === n('letter')) && !st.items.inv.some((v) => itemOf(v) === n('letter')), 'letters go back at 15:00, dropped ones too');
}
{
  // How long a step takes with the economy running (the worker bot, a day).
  const sim = new Sim(CENTER_PERKS, 3);
  const play = worker(true)(sim);
  const t0 = performance.now();
  for (let k = 0; k < DAY; k++) sim.step(play(sim));
  const us = ((performance.now() - t0) * 1000) / DAY;
  check(us < 400, `a step stays cheap (${us < 400 ? 'under 400' : Math.round(us)} µs)`);
}
{
  // Quitting mid-shift: the loads in the machines and the puddles go with the job.
  const a = arena(stepAt(1, 11, 59), 29);
  const { sim, st } = a;
  [st.jobs[0], st.jobs[1]] = [st.jobs[1], HOLDER.PLAYER];
  a.steps(MIN + 2);
  check(st.puddles.length === 6, 'the janitor has six puddles');
  st.machines[jobRooms(sim.world)[0].machines[0]] = st.step + 100;
  put(st.player, 27, 22);
  st.player.facing = 13;
  a.op(OP.JOB, 0);
  check(sim.playerJob < 0 && st.puddles.length === 0 && Object.keys(st.machines).length === 0, 'quitting clears the work on the go');
}

// ------------------------------------------------------------------ learning recipes (P8+)
{
  const a = arena(stepAt(1, 10, 30), 31);
  const { sim, st } = a;
  // Whatever passes through the pockets is something carried (the handbook's mysteries show it).
  st.items.inv[0] = slot(n('magazine'));
  a.step();
  check(st.carried.includes(n('magazine')), 'an item in the pockets is remembered as carried');
  // Studying past a multiple of five: the simplest recipe within reach, told.
  put(st.player, 17, 31);
  st.player.facing = 13;
  st.items.int = 44;
  st.energy = 100;
  a.op(OP.INTERACT);
  a.op(OP.TRAIN, 0);
  for (let k = 0; k < 60 && st.items.int === 44; k++) a.op(OP.TRAIN, 1 + (k % 2));
  const first = st.tips[0];
  check(st.items.int === 46 && st.tips.length === 1 && RECIPES[first].int <= 46 && a.has('tip', (e) => e.type === 'tip' && e.who === -1), `studying past 45 tells a recipe (${RECIPES[first]?.result})`);
  check(!RECIPES.some((r, k) => r.int < RECIPES[first].int && !st.items.known.includes(k)), 'the simplest one first');
  a.op(OP.TRAIN, 3);
  // An inmate who likes the player: a recipe once a day.
  const who = 0;
  st.inmates[who].opinion = 50;
  check(talkTo(a, who), 'talking for a tip');
  a.op(OP.TALK, TALK.TIP);
  check(st.tips.length === 1 && a.has('refused', (e) => e.type === 'refused' && e.why === 'tipOpinion'), 'under 60 opinion: no tip');
  st.inmates[who].opinion = 70;
  a.op(OP.TALK, TALK.TIP);
  check(st.tips.length === 2 && a.has('tip', (e) => e.type === 'tip' && e.who === who), 'at 70: a recipe tip');
  a.op(OP.TALK, TALK.TIP);
  check(st.tips.length === 2 && a.has('refused', (e) => e.type === 'refused' && e.why === 'tipToday'), 'once a day');
  // Saved and loaded: what was carried and told stays.
  const back = new Sim(CENTER_PERKS, 9);
  back.restore(JSON.parse(JSON.stringify(sim.snapshot())) as Snapshot);
  check(back.state.tips.join() === st.tips.join() && back.state.carried.join() === st.carried.join() && back.state.tipDay[who] === 1, 'tips survive a save');
  // A save from before (no such fields): empty lists.
  const old = JSON.parse(JSON.stringify(sim.snapshot())) as Snapshot;
  delete (old.state as Partial<typeof old.state>).carried;
  delete (old.state as Partial<typeof old.state>).tips;
  delete (old.state as Partial<typeof old.state>).tipDay;
  back.restore(old);
  check(back.state.tips.length === 0 && back.state.carried.length === 0, 'an older save loads with nothing told');
  console.log(`recipes: studying told ${RECIPES[first].result}, an inmate told ${RECIPES[st.tips[1]].result}`);
}
{
  // A mark lost overnight and studied back pays nothing again; marks never reached before do.
  const a = arena(stepAt(1, 10, 30), 32);
  const { st } = a;
  put(st.player, 17, 31);
  st.player.facing = 13;
  st.items.int = 44;
  st.energy = 100;
  a.op(OP.INTERACT);
  a.op(OP.TRAIN, 0);
  const set = () => {
    const was = st.items.int;
    for (let k = 0; k < 60 && st.items.int === was; k++) a.op(OP.TRAIN, 1 + (k % 2));
  };
  set();
  check(st.tips.length === 1, 'studying to 46: a tip');
  st.items.int = 44;
  st.energy = 100;
  set();
  check(st.tips.length === 1, 'back to 44 overnight, studied to 46 again: no second tip for the same mark');
  st.energy = 100;
  set();
  set();
  check(st.items.int === 50 && st.tips.length === 2, `on to 50: the next tip (INT ${st.items.int}, ${st.tips.length} tips)`);
  // Copying keys is never told; what a prison can't make is never told nor shown.
  check(st.tips.every((k) => !RECIPES[k].keep && !RECIPES[k].ingredients.some((i) => i.startsWith('mold_'))), 'no key mold is ever told');
  const training = new Sim(TRAINING, 3);
  const here = obtainable(training.world);
  check(here.has(n('key_red')) && !here.has(n('key_yellow')) && here.has(n('mold_red')) && !here.has(n('mold_yellow')), 'the Training Block: only its guard\'s key and mold can be had');
  check(['key_yellow', 'key_cyan', 'key_purple', 'key_green', 'key_red'].every((id) => obtainable(new Sim(CENTER_PERKS, 1).world).has(n(id))), 'Center Perks: every guard key can be had');
}
