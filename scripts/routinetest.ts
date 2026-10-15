/**
 * The daily routine holds up over days of play, driven by bots through the real simulation:
 * - the model prisoner (goes wherever the routine says) ends 3 days with 0 heat;
 * - the truant (never leaves the cell) misses roll call and starts a lockdown: the guards
 *   come for it, and it serves its time in solitary;
 * - the night owl (out at Lights Out, home within the grace) finds its door waiting, and
 *   locked once home;
 * - all seven inmates make every mandatory block, and sleep in their cells at night.
 * Prints the event log of each run; the snapshot pins the timings.
 */
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { ROUTINE, routineAt } from '../src/content/routine';
import { ZONES } from '../src/content/zones';
import { Autopilot } from '../src/sim/ai/autopilot';
import { placesOf } from '../src/sim/ai/places';
import { reachableFrom } from '../src/sim/world/reach';
import { command } from '../src/sim/command';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { formatTime, clockAt } from '../src/sim/systems/clock';
import { DOING, inmateZone } from '../src/sim/systems/inmates';
import { tileOfBody } from '../src/sim/systems/movement';
import { STEPS_PER_MINUTE } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';

const DAY = 1440 * STEPS_PER_MINUTE;
const at = (step: number) => {
  const c = clockAt(step);
  return `day ${c.day} ${formatTime(c)}`;
};
const describe = (e: SimEvent) => {
  switch (e.type) {
    case 'routine':
      return `routine ${ROUTINE[e.routine].id}`;
    case 'attended':
      return `attended ${ROUTINE[e.routine].id}`;
    case 'missed':
      return `missed ${ROUTINE[e.routine].id} +${e.heat}% heat`;
    case 'lockdown':
      return e.on ? 'LOCKDOWN' : 'lockdown lifted';
    case 'cells':
      return e.locked ? 'cells locked' : 'cells unlocked';
    case 'caught':
      return `caught (${e.solitary ? 'solitary' : 'infirmary'})`;
    case 'solitary':
      return e.on ? 'into solitary' : 'out of solitary';
    case 'spotted':
      return `spotted: ${e.reason}`;
    default:
      return '';
  }
};

// ------------------------------------------------------------------ the schedule itself
check(ROUTINE.every((r, k) => k === 0 || r.start > ROUTINE[k - 1].start), 'routine blocks run in order');
check(ROUTINE[0].start === 8 * 60 && ROUTINE[ROUTINE.length - 1].id === 'lightsOut', 'the day runs 08:00 roll call to Lights Out');
check(routineAt(3 * 60) === ROUTINE.length - 1, 'before 08:00 it is still Lights Out');
check(ROUTINE.every((r) => (r.miss !== null) === (r.zones.length > 0 && r.id !== 'lightsOut')), 'every mandatory block but Lights Out has a penalty');
{
  const sim = new Sim(CENTER_PERKS);
  const reach = reachableFrom(sim.world, CENTER_PERKS.spawn.x, CENTER_PERKS.spawn.z);
  for (const r of ROUTINE) {
    for (const z of r.zones) {
      let ok = false;
      for (let i = 0; i < reach.length; i++) if (reach[i] && ZONES[sim.world.ground.zone[i]] === z) ok = true;
      check(ok, `${r.id}: ${z} can be walked to from the cell`);
    }
  }
  const p = placesOf(sim.world);
  check(p.seats.length >= 8, `the canteen seats everyone (${p.seats.length} seats)`);
  check(p.bedside.slice(1).every((t) => t >= 0), 'every cell has a free tile beside its bed');
  check(sim.world.cellDoor.slice(1).every((t) => t >= 0), 'every cell has a door');
  console.log(`places: ${p.seats.length} seats, ${p.showers.length} shower heads, ${p.rollCall.length} roll call spots`);
}

// ------------------------------------------------------------------ bots
type Bot = (sim: Sim) => number;

/** Goes wherever the routine says: its roll call spot, the nearest tile of the block's zone, its bed at night. */
function modelPrisoner(sim: Sim): Bot {
  const pilot = new Autopilot(sim.world);
  const places = placesOf(sim.world);
  let want = '';
  return (s) => {
    const st = s.state;
    const r = ROUTINE[st.routine];
    const key = st.lockdown ? 'lockdown' : r.zones.length ? r.id : 'free';
    if (key !== want) {
      want = key;
      if (key === 'lockdown' || key === 'lightsOut') pilot.goTo(places.bedside[1]);
      else if (key === 'rollCall' || key === 'eveningRollCall') pilot.goTo(places.rollCall[0].tile);
      else if (r.zones.length) pilot.goToAny((i) => r.zones.includes(ZONES[s.world.ground.zone[i]]));
      else pilot.stop();
    }
    return command(pilot.dir(st.player));
  };
}

/** Runs a bot for a number of steps; returns the event log and the inmates' attendance. */
function run(bot: (sim: Sim) => Bot, steps: number, seed = 3, every?: (sim: Sim) => void) {
  const sim = new Sim(CENTER_PERKS, seed);
  const play = bot(sim);
  const log: string[] = [];
  let worst = 0;
  for (let i = 0; i < steps; i++) {
    const t0 = performance.now();
    sim.step(play(sim));
    worst = Math.max(worst, performance.now() - t0);
    for (const e of sim.events) if (describe(e)) log.push(`${at(sim.state.step)} ${describe(e)}`);
    every?.(sim);
  }
  return { sim, log, worst };
}

// The model prisoner, 3 days, with the inmates watched block by block.
const MANDATORY = ROUTINE.map((r, k) => k).filter((k) => ROUTINE[k].zones.length > 0);
let blocks = 0;
const inmateMisses: string[] = [];
let seen = new Set<number>();
let sleepers = 0;
const model = run(modelPrisoner, 3 * DAY, 3, (sim) => {
  const st = sim.state;
  const r = ROUTINE[st.routine];
  // An inmate counts as there once it stands in the block's zone (its own cell at night).
  st.inmates.forEach((m, k) => {
    const z = inmateZone(sim.world, m);
    const t = tileOfBody(m.body);
    const home = sim.world.cellOf[t.z * MAP_W + t.x] === m.cell;
    if (r.id === 'lightsOut' ? home : r.zones.includes(z)) seen.add(k);
  });
  // The last step of a block: everyone made it?
  const next = clockAt(st.step + 1);
  if (routineAt(next.minuteOfDay) !== st.routine) {
    if (MANDATORY.includes(st.routine)) {
      blocks++;
      for (let k = 0; k < st.inmates.length; k++) if (!seen.has(k)) inmateMisses.push(`${at(st.step)} inmate ${k + 2} missed ${r.id}`);
    }
    seen = new Set();
  }
  // 03:00: everyone asleep, cells locked.
  const c = clockAt(st.step);
  if (c.hour === 3 && c.minute === 0 && st.step % STEPS_PER_MINUTE === 0) {
    const asleep = st.inmates.filter((m) => m.doing === DOING.SLEEP).length;
    check(asleep === st.inmates.length, `${at(st.step)}: all inmates asleep (${asleep})`);
    check(sim.world.lockedCells === 0b111111110, `${at(st.step)}: every cell locked (${sim.world.lockedCells.toString(2)})`);
    sleepers += asleep;
  }
});
console.log('== model prisoner, 3 days');
for (const l of model.log) console.log(l);
const attended = model.log.filter((l) => l.includes('attended')).length;
check(model.sim.state.heat === 0, `the model prisoner ends with no heat (${model.sim.state.heat}%)`);
check(!model.log.some((l) => l.includes('missed') || l.includes('LOCKDOWN')), 'the model prisoner misses nothing');
check(attended === 3 * MANDATORY.length, `the model prisoner checks in to every block (${attended})`);
check(inmateMisses.length === 0, `the inmates make every block:\n  ${inmateMisses.join('\n  ')}`);
console.log(`inmates: ${blocks} blocks watched, ${inmateMisses.length} missed, ${sleepers} asleep at 03:00 over 3 nights`);
// A loose budget (CI machines are slow and noisy, and npm test runs every suite at once, so
// one step can wait behind a garbage collection or another process): checked, never printed.
check(model.worst < 150, `the worst step stays under budget (${model.worst.toFixed(1)} ms)`);

// The same run again: the same state.
check(run(modelPrisoner, DAY, 3).sim.hash() === run(modelPrisoner, DAY, 3).sim.hash(), 'a day of play is deterministic');

// The truant never leaves the cell.
const truant = run(() => () => 0, DAY);
console.log('== truant, 1 day');
for (const l of truant.log) console.log(l);
check(truant.log.some((l) => l === 'day 1 09:00 LOCKDOWN'), 'missing roll call starts a lockdown at 09:00');
check(truant.log.some((l) => l.startsWith('day 1 09:') && l.endsWith('caught (solitary)')), 'the guards come into the cell for the truant');
check(truant.log.some((l) => l.endsWith('out of solitary')), 'the truant serves its time');
check(truant.log.some((l) => l.endsWith('missed showers +25% heat')), 'missing showers costs heat');
console.log(`truant heat at the end of day 1: ${truant.sim.state.heat}%`);

// The night owl: a model prisoner until evening roll call, out in the cell block at Lights Out, home by 23:10 (within the grace).
const owl = run(
  (sim) => {
    const pilot = new Autopilot(sim.world);
    const places = placesOf(sim.world);
    const good = modelPrisoner(sim);
    let leg = 0;
    return (s) => {
      const m = clockAt(s.state.step).minuteOfDay;
      if (leg === 0 && m < 22 * 60 + 50) return good(s);
      if (leg === 0) {
        leg = 1;
        pilot.goTo(13 * MAP_W + 20);
      }
      if (leg === 1 && m >= 23 * 60 + 5) {
        leg = 2;
        pilot.goTo(places.bedside[1]);
      }
      return command(pilot.dir(s.state.player));
    };
  },
  DAY,
  3,
  (sim) => {
    const m = clockAt(sim.state.step).minuteOfDay;
    if (m === 23 * 60 + 4 && sim.state.step % STEPS_PER_MINUTE === 0) {
      check(sim.playerZone === 'cellBlock', 'the owl is out at 23:04');
      check(!sim.world.blocked(8, 11), "the owl's cell door waits open");
    }
    if (m === 23 * 60 + 20 && sim.state.step % STEPS_PER_MINUTE === 0) {
      check(sim.playerZone === 'playerCell', 'the owl is home at 23:20');
      check(sim.world.blocked(8, 11), 'the door locked behind the owl');
      check(sim.world.blocked(13, 11), 'the next cell is locked');
    }
  },
);
console.log('== night owl');
for (const l of owl.log.filter((l) => l.includes('day 1 2') || l.includes('cells'))) console.log(l);
check(!owl.log.some((l) => l.includes('LOCKDOWN')), 'home within the grace: no trouble');

// The visitor: in someone else's cell when a lockdown starts, never locked in; the guards come for it there.
{
  const sim = new Sim(CENTER_PERKS, 3);
  // Wait for roll call to empty the cells, then step into cell 3.
  for (let i = 0; i < 20 * 20; i++) sim.step(0);
  sim.state.player.x = 17 * 1024 + 512;
  sim.state.player.z = 9 * 1024 + 512;
  // Roll call missed at 09:00: lockdown, everyone else goes home.
  while (!sim.state.lockdown) sim.step(0);
  for (let i = 0; i < 20 * 20; i++) sim.step(0);
  const t = tileOfBody(sim.state.player);
  check(sim.world.cellOf[t.z * MAP_W + t.x] === 3, 'the visitor is in cell 3');
  check(!sim.world.blocked(18, 11), 'cell 3 stays open while a visitor is inside');
  let steps = 0;
  while (sim.state.lockdown && steps++ < 3 * 60 * 20) sim.step(0);
  check(sim.state.ko > 0, `the guards catch the visitor (${at(sim.state.step)})`);
  console.log(`== visitor: caught at ${at(sim.state.step)}`);
}

// Saves can be taken at any step: a snapshot restored into a fresh simulation is the same
// state, and plays on the same (doors included, since they are settled at the end of a step).
{
  const a = new Sim(CENTER_PERKS, 5);
  const play = modelPrisoner(a);
  let checked = 0;
  for (let i = 0; i < DAY; i++) {
    a.step(play(a));
    if (i % 997 !== 0) continue;
    const b = new Sim(CENTER_PERKS, 5);
    b.restore(a.snapshot());
    if (b.hash() !== a.hash()) check(false, `restore at step ${a.state.step} gives the same state`);
    checked++;
  }
  console.log(`== saves: ${checked} snapshots restored into fresh simulations, all identical`);
}
