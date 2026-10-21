/**
 * The sports grounds and gardens (P31): every rebuilt prison's places as data (the sports
 * ground, its track, court, weights and bleachers; the garden, its beds, the gardener's
 * planters, shed and crate; the gates), laps of the track (Speed as a treadmill set: in order,
 * one way round, on the lanes), the pull-up bar (Strength), the gates' hours, the gardener's
 * shift and the kitchen's fresh meals, inmates jogging the track at the exercise hour, and a
 * save from before a prison was rebuilt starting the run again there.
 */
import { cornersOf, onTrack } from '../src/content/grounds';
import { JOBS } from '../src/content/jobs';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { TRAINING } from '../src/content/prisons/training';
import type { PrisonDef } from '../src/content/prisons/types';
import { OPEN_HOURS, ROUTINE } from '../src/content/routine';
import { zoneIndex } from '../src/content/zones';
import { command, OP } from '../src/sim/command';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { DAY_STEPS, clockAt } from '../src/sim/systems/clock';
import { HOLDER, jobRooms } from '../src/sim/systems/economy';
import { DOING } from '../src/sim/systems/inmates';
import { quotaUp, settleWork } from '../src/sim/systems/jobs';
import { freshMeals } from '../src/sim/systems/grounds';
import { FRESH_ENERGY, FRESH_FOR, GYM_ENERGY, MEAL_ENERGY, STEPS_PER_MINUTE, TRAIN_GAIN, UNIT } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/World';
import { TILE } from '../src/sim/world/tiles';
import { slot } from '../src/sim/systems/items';
import { n } from './bots';
import { postable } from '../src/sim/systems/crew';
import { check } from './assert';

(globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, key: () => null, length: 0 };
const { rebuiltSince, saveFileOf } = await import('../src/game/saves');

/** A step count at a time: game day (from 1), hour, minute (days start at 08:00). */
const at = (day: number, hour: number, minute = 0) => (day - 1) * DAY_STEPS + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
const put = (b: { x: number; z: number }, x: number, z: number) => {
  b.x = x * UNIT + UNIT / 2;
  b.z = z * UNIT + UNIT / 2;
};

/** A game at a time of day (its routine block set to match), everyone kept calm; its events gathered. */
function arena(def: PrisonDef, step: number, seed = 5) {
  const sim = new Sim(def, seed);
  const st = sim.state;
  st.step = step;
  st.routine = ROUTINE.findIndex((_, k) => k === ROUTINE.length - 1 || ROUTINE[k + 1].start > clockAt(step).minuteOfDay);
  const seen: SimEvent[] = [];
  const stepOnce = (cmd = 0) => {
    st.attended = true;
    st.heat = 0;
    sim.step(cmd);
    seen.push(...sim.events);
  };
  return { sim, st, seen, step: stepOnce };
}

const REBUILT = [...PRISONS, TRAINING].filter((p) => (p.map ?? 0) > 0);

// ------------------------------------------------------------------ the places, as data
{
  check(REBUILT.length === 2 && REBUILT.every((p) => p.map === 1), 'rebuilt so far (P31): Center Perks and the Training Block, map 1');
  const lines: string[] = [];
  for (const p of REBUILT) {
    const sim = new Sim(p, 1);
    const w = sim.world;
    const l = p.leisure!;
    const r = l.track!;
    // The track: every lane tile open sports floor, nothing standing on it, round the pitch.
    const lanes: string[] = [];
    for (let z = r.z; z < r.z + r.d; z++)
      for (let x = r.x; x < r.x + r.w; x++) {
        if (!onTrack(r, x, z)) continue;
        const decor = (p.decor ?? []).some((d) => !d.y && x >= d.x && x < d.x + (d.w ?? 1) && z >= d.z && z < d.z + (d.d ?? 1));
        if (w.zoneAt(x, z) !== 'sports' || w.blocked(x, z) || decor) lanes.push(`${x},${z}`);
      }
    check(lanes.length === 0, `${p.id}: the track's lanes are open sports floor (${lanes.join(' ')})`);
    const pt = l.pitch;
    check(pt.x === r.x + 1 && pt.z === r.z + 1 && pt.w === r.w - 2 && pt.d === r.d - 2, `${p.id}: the pitch fills the track's middle`);
    check(w.zoneAt(l.hoop.x, l.hoop.z) === 'sports' && l.hoop.spots.every((q) => w.zoneAt(q.x, q.z) === 'sports'), `${p.id}: the court on the sports ground`);
    const g = l.garden;
    let beds = 0;
    for (let z = g.z; z < g.z + g.d; z++) for (let x = g.x; x < g.x + g.w; x++) if (w.zoneAt(x, z) === 'garden') beds++;
    check(beds === g.w * g.d && beds === 12, `${p.id}: twelve beds in the garden (${beds})`);
    const inSports = (k: string) => w.props.some((q) => q.kind === k && w.zoneAt(q.x, q.z) === 'sports');
    check(inSports('pullup') && inSports('weights') && inSports('bleachers') && inSports('lamp'), `${p.id}: the weights corner, a pull-up bar, bleachers and a lamp on the sports ground`);
    // The gates: doors that open by the hour, into each place, and no other door into it.
    for (const zone of Object.keys(OPEN_HOURS)) {
      const z = zoneIndex(zone as 'sports');
      let gates = 0;
      for (let i = 0; i < MAP_W * MAP_W; i++) if (w.doorRoom[i] === z) gates++;
      check(gates === 2, `${p.id}: the ${zone}'s gate (2 tiles: ${gates})`);
    }
    const job = p.jobs.findIndex((j) => j.id === 'gardener');
    if (p.jobs.length) {
      check(job >= 0, `${p.id}: the gardener's job is on the board`);
      const room = jobRooms(w)[job];
      check(room.take >= 0 && room.put >= 0 && room.machines.length >= JOBS.gardener.quota, `${p.id}: the shed, the crate and a planter for each crate of the quota (${room.machines.length})`);
    }
    lines.push(`${p.id}: track ${r.w}×${r.d} (${2 * (r.w + r.d) - 4} lanes), pitch ${pt.w}×${pt.d}, ${beds} beds, ${job >= 0 ? `${jobRooms(w)[job].machines.length} planters` : 'no gardener'}`);
  }
  console.log(lines.join('\n'));
  // Prisons not rebuilt yet keep their yards as they were: no track, no new zones.
  for (const p of PRISONS.filter((q) => !q.map)) check(!p.leisure?.track && !p.zones.some(([z]) => z === 'sports' || z === 'garden'), `${p.id}: not rebuilt yet, its yard as it was`);
}

// ------------------------------------------------------------------ laps of the track
{
  const r = CENTER_PERKS.leisure!.track!;
  /** The lane tiles from a corner, round one way (1 clockwise, -1 the other), n of them. */
  const round = (from: number, way: number, n: number) => {
    const ring: Array<[number, number]> = [];
    for (let x = r.x; x < r.x + r.w; x++) ring.push([x, r.z]);
    for (let z = r.z + 1; z < r.z + r.d; z++) ring.push([r.x + r.w - 1, z]);
    for (let x = r.x + r.w - 2; x >= r.x; x--) ring.push([x, r.z + r.d - 1]);
    for (let z = r.z + r.d - 2; z > r.z; z--) ring.push([r.x, z]);
    const c = cornersOf(r)[from];
    const k0 = ring.findIndex(([x, z]) => x === c.x && z === c.z);
    return Array.from({ length: n }, (_, k) => ring[(((k0 + way * k) % ring.length) + ring.length) % ring.length]);
  };
  const lanes = 2 * (r.w + r.d) - 4;
  const a = arena(CENTER_PERKS, at(1, 15, 10));
  const walk = (tiles: Array<[number, number]>) => {
    for (const [x, z] of tiles) {
      put(a.st.player, x, z);
      a.step();
    }
  };
  const laps = () => a.seen.filter((e) => e.type === 'lap').length;
  const s0 = a.st.spd;
  const e0 = a.st.energy;
  walk(round(0, 1, lanes + 1));
  check(laps() === 1 && a.st.spd === s0 + TRAIN_GAIN && (a.st.trained & 2) === 2, `a lap clockwise: +${TRAIN_GAIN} Speed, Speed trained today`);
  check(a.st.energy <= e0 - GYM_ENERGY + 2 && a.st.energy >= e0 - GYM_ENERGY, `a lap costs a set's energy (${e0} → ${a.st.energy})`);
  walk(round(2, -1, lanes + 1));
  check(laps() === 2, 'a lap the other way round counts too');
  // Turned back halfway: no lap until a whole one from there.
  walk(round(0, 1, Math.floor(lanes / 2)));
  walk(round(0, 1, Math.floor(lanes / 2)).reverse());
  check(laps() === 2, 'turning back halfway: no lap');
  // A step off the lanes (onto the pitch) breaks the lap.
  const half = round(0, 1, Math.floor(lanes / 2));
  walk(half);
  put(a.st.player, r.x + 3, r.z + 3);
  a.step();
  walk(round(0, 1, lanes + 1).slice(Math.floor(lanes / 2)));
  check(laps() === 2 && a.st.lap.length === 4, 'stepping off the track breaks the lap (it begins again from the next corner)');
  // Too tired: the lap counts, the Speed doesn't.
  a.st.energy = 5;
  const s1 = a.st.spd;
  walk(round(0, 1, lanes + 1));
  check(laps() === 3 && a.st.spd === s1 && a.seen.some((e) => e.type === 'cantTrain' && e.why === 'tired'), 'too tired: a lap, no Speed');
  console.log(`laps: ${lanes} lane tiles a lap at Center Perks; +${TRAIN_GAIN} Speed and ${GYM_ENERGY} energy each, either way round; turned back or off the lanes, none`);
}

// ------------------------------------------------------------------ the pull-up bar
{
  const a = arena(CENTER_PERKS, at(1, 15, 10));
  const bar = a.sim.world.props.find((q) => q.kind === 'pullup')!;
  put(a.st.player, bar.x, bar.z - 1);
  a.st.player.facing = 5;
  a.step(command(0, OP.INTERACT));
  check(a.st.train >= 0 && a.sim.world.props[a.st.train].kind === 'pullup', 'the action button at the pull-up bar starts a set');
  const str = a.st.str;
  for (let k = 0; k < 200 && a.st.str === str; k++) a.step(command(0, OP.TRAIN, 1 + (k % 2)));
  check(a.st.str === str + TRAIN_GAIN, `a set of pull-ups: +${TRAIN_GAIN} Strength`);
}

// ------------------------------------------------------------------ the gates' hours
{
  const a = arena(CENTER_PERKS, at(1, 8, 0));
  const w = a.sim.world;
  const gate = (zone: 'sports' | 'garden') => w.doorRoom.findIndex((z) => z === zoneIndex(zone));
  const sports = gate('sports');
  const garden = gate('garden');
  const open = (t: number) => w.doorShut[t] === 0;
  const seen: string[] = [];
  for (const [h, m] of [
    [8, 30],
    [10, 30],
    [12, 30],
    [15, 30],
    [16, 30],
    [18, 30],
    [22, 30],
    [23, 30],
  ]) {
    const to = at(1, h, m) + (h < 8 ? DAY_STEPS : 0);
    while (a.st.step < to) {
      // (Nobody inside to hold them open: the player and the inmates kept at the cell block.)
      put(a.st.player, 9, 13);
      for (const q of a.st.inmates) put(q.body, 20, 13);
      a.step();
    }
    seen.push(`${ROUTINE[a.st.routine].id} ${open(sports) ? 'S' : '-'}${open(garden) ? 'G' : '-'}`);
  }
  // (The garden is the gardener's room too: open for the Work Period.)
  check(seen.join() === 'rollCall --,freeTime SG,work -G,exercise SG,showers --,eveningFreeTime SG,eveningRollCall --,lightsOut --', `the gates by the hour (${seen.join(', ')})`);
  // A lockdown shuts them; someone still inside keeps theirs open until they're out.
  const b = arena(CENTER_PERKS, at(1, 10, 30));
  b.step();
  check(open(gate('sports')) || b.sim.world.doorShut[gate('sports')] === 0, 'open in free time');
  b.st.lockdown = true;
  b.step();
  check(b.sim.world.doorShut[gate('sports')] === 1, 'shut in a lockdown');
  b.st.lockdown = false;
  const c = arena(CENTER_PERKS, at(1, 11, 59));
  put(c.st.player, 16, 51);
  for (let k = 0; k < 3 * STEPS_PER_MINUTE; k++) c.step();
  check(ROUTINE[c.st.routine].id === 'work' && c.sim.world.doorShut[gate('sports')] === 0, 'the player still on the sports ground at noon: its gate waits for them');
  console.log(`gates: ${seen.join(', ')}`);
}

// ------------------------------------------------------------------ the gardener and the kitchen
{
  const a = arena(CENTER_PERKS, at(1, 12, 10));
  const job = CENTER_PERKS.jobs.findIndex((j) => j.id === 'gardener');
  const old = a.st.jobs.indexOf(HOLDER.PLAYER);
  if (old >= 0) a.st.jobs[old] = HOLDER.NOBODY;
  a.st.jobs[job] = HOLDER.PLAYER;
  check(a.sim.jobActive() === job, 'the player is the gardener');
  const cash = a.st.cash;
  for (let k = 0; k < JOBS.gardener.quota; k++) quotaUp(a.sim);
  check(a.st.paid && a.st.cash === cash + JOBS.gardener.wage, `the crates filled: $${JOBS.gardener.wage}`);
  check(freshMeals(a.sim), 'the produce in the kitchen: the meals are fresh');
  // Dinner on a seat in the canteen: a fresh meal's energy and health.
  while (ROUTINE[a.st.routine].id !== 'dinner') a.step();
  const seat = a.sim.world.props.findIndex((q) => q.kind === 'seat' && a.sim.world.zoneAt(q.x, q.z) === 'canteen');
  const p = a.sim.world.props[seat];
  put(a.st.player, p.x, p.z);
  a.st.seat = seat;
  a.st.energy = 20;
  a.st.health = 40;
  for (let k = 0; k < 5 * STEPS_PER_MINUTE && !a.seen.some((e) => e.type === 'meal'); k++) a.step();
  const meal = a.seen.find((e) => e.type === 'meal');
  check(!!meal && meal.type === 'meal' && !!meal.fresh && a.st.energy >= 20 + MEAL_ENERGY + FRESH_ENERGY - 1, `a fresh dinner: +${MEAL_ENERGY + FRESH_ENERGY} energy, health up (energy ${a.st.energy}, health ${a.st.health})`);
  // A day on: the kitchen's back to the usual.
  a.st.step += FRESH_FOR;
  check(!freshMeals(a.sim), 'a day after, the meals are as ever');
  // An inmate gardener's shift: his own crates, no fresh meals (they're the player's to earn).
  const b = arena(CENTER_PERKS, at(1, 14, 59));
  const who = b.st.jobs[job];
  check(who >= 0, 'an inmate holds the gardener\'s job on day 1');
  b.st.inmates[who].shift = 1;
  settleWork(b.sim);
  check(!freshMeals(b.sim) && b.st.jobs[job] === who, 'an inmate gardener at work all shift: the job kept, no fresh meals for it');
  console.log(`gardener: quota ${JOBS.gardener.quota} crates, $${JOBS.gardener.wage}; fresh meals +${FRESH_ENERGY} energy and health for a day`);
}

// ------------------------------------------------------------------ inmates at the exercise hour
{
  const a = arena(CENTER_PERKS, at(1, 14, 59), 3);
  const r = CENTER_PERKS.leisure!.track!;
  let jogging = 0;
  let out = 0;
  for (let k = 0; k < 40 * STEPS_PER_MINUTE; k++) {
    a.step();
    for (const m of a.st.inmates) {
      const x = Math.floor(m.body.x / UNIT);
      const z = Math.floor(m.body.z / UNIT);
      if (m.then === DOING.JOG && m.body.moving && onTrack(r, x, z)) jogging++;
      if (a.sim.world.zoneAt(x, z) === 'sports') out++;
    }
  }
  check(jogging > 0 && out > jogging, `the exercise hour: inmates out on the sports ground, some jogging the track (${out} inmate-steps out, ${jogging} jogging)`);
  console.log(`exercise hour: ${out} inmate-steps on the sports ground, ${jogging} of them jogging the track`);
}

// ------------------------------------------------------------------ the review's holes (P31): the fences, lookouts, lockdowns, the courtyard
{
  // The fences round Center Perks' sports ground and garden are live: cutting out by day knocks the player flat (the power off first, as for the perimeter).
  const a = arena(CENTER_PERKS, at(1, 10, 35));
  const w = a.sim.world;
  const live = new Set<number>();
  for (const [x0, z0, x1, z1] of [
    [5, 46, 5, 56],
    [27, 46, 27, 56],
    [5, 56, 27, 56],
    [35, 46, 35, 56],
    [57, 46, 57, 56],
    [35, 56, 57, 56],
  ])
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (w.ground.kind[z * MAP_W + x] === TILE.ELECTRIC) live.add(z * MAP_W + x);
  check(live.size === 86, `Center Perks: the new places' fences are electric all round (${live.size} tiles)`);
  put(a.st.player, 6, 50);
  a.st.player.facing = 9;
  a.st.items.inv[0] = slot(n('sturdy_cutters'));
  a.st.items.hand = 0;
  for (let k = 0; k < 400 && !a.seen.some((e) => e.type === 'shocked'); k++) a.step(command(0, OP.USE, 1));
  check(a.seen.some((e) => e.type === 'shocked') && w.ground.kind[50 * MAP_W + 5] === TILE.ELECTRIC, 'cutting the sports ground\'s fence with the power on: shocked, the fence stands');
  // A lookout can't be posted on the sports ground or in the garden (he'd hold the gate open all night).
  for (const [x, z] of [
    [16, 51],
    [46, 50],
  ])
    check(!postable(w, z * MAP_W + x), `no lookout post at ${x},${z} (${w.zoneAt(x, z)})`);
  // No laps in a lockdown.
  const b = arena(CENTER_PERKS, at(1, 15, 10));
  b.st.lockdown = true;
  const r = CENTER_PERKS.leisure!.track!;
  for (const c of [...cornersOf(r), cornersOf(r)[0]]) {
    put(b.st.player, c.x, c.z);
    b.step();
  }
  check(!b.seen.some((e) => e.type === 'lap') && !b.st.lap.length, 'in a lockdown, no lap');
  // The exercise hour: the gym or the sports ground, not the quiet courtyard (no guard posted there).
  const c = arena(CENTER_PERKS, at(1, 15, 1));
  c.step();
  check(c.sim.dutyZones.join() === 'gym,sports', `Center Perks' exercise hour: ${c.sim.dutyZones.join(', ')}`);
  const d = arena(PRISONS.find((q) => q.id === 'stalag-flucht')!, at(1, 15, 1));
  d.step();
  check(d.sim.dutyZones.join() === 'gym,yard,sports', 'a prison not rebuilt: the exercise hour as it was');
  console.log(`holes: ${live.size} live fence tiles round Center Perks' places; no lookout posts in them; no laps in a lockdown; exercise at Center Perks: ${c.sim.dutyZones.join(', ')}`);
}

// ------------------------------------------------------------------ saves from before the rebuild
{
  const sim = new Sim(CENTER_PERKS, 1);
  const now = saveFileOf(sim, 0, 'test');
  check(now.map === 1 && !rebuiltSince(now), 'a save written now carries the map it was made on');
  const before = { ...now };
  delete before.map;
  check(rebuiltSince(before), 'a Center Perks save from 2.6: its prison has been rebuilt since (the run starts again)');
  const stalag = saveFileOf(new Sim(PRISONS.find((p) => p.id === 'stalag-flucht')!, 1), 0, 'test');
  check(stalag.map === undefined && !rebuiltSince(stalag), 'a save of a prison not rebuilt loads as ever');
  console.log('saves: from before a rebuild, the run starts again there; others load as ever');
}
