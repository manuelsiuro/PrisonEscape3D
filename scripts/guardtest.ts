/**
 * Guards (GDD §5), driven through the real simulation:
 * - sight: the 60° cone, the range, walls and shut doors;
 * - heat rules: a contraband tool in hand, a restricted room, out of the cell at night, and
 *   the guard outfit (no alarm at night, recognized up close);
 * - wanted (80%+): a guard gives chase, loses the player and investigates, or catches them
 *   (the infirmary under 90%, solitary from 90%);
 * - solitary: confiscation (carried contraband, the desk's standard drawers, the outfit;
 *   never the hidden compartment), potato peeling for early release;
 * - the bed-dummy bot spends a night in the library and passes both bed checks; without
 *   the dummy the first check raises the alarm;
 * - the shakedown bot loses standard-drawer contraband and keeps hidden items;
 * - guards walk their rounds for days without getting stuck; saves restore mid-chase.
 */
import { ITEMS, itemNumber } from '../src/content/items';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { ROUTINE } from '../src/content/routine';
import { ZONES } from '../src/content/zones';
import { Autopilot } from '../src/sim/ai/autopilot';
import { placesOf } from '../src/sim/ai/places';
import { canSee } from '../src/sim/ai/sight';
import { command, OP, SLOT } from '../src/sim/command';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { clockAt, formatTime } from '../src/sim/systems/clock';
import { alertOf, ALERT, GUARD, type Guard } from '../src/sim/systems/guards';
import { itemOf, slot } from '../src/sim/systems/items';
import { bodyAt } from '../src/sim/systems/movement';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { containersOf } from '../src/sim/world/containers';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';

const DAY = 1440 * STEPS_PER_MINUTE;
const at = (sim: Sim) => `day ${sim.clock.day} ${formatTime(sim.clock)}`;
const minute = (sim: Sim) => clockAt(sim.state.step).minuteOfDay;
const n = (id: string) => itemNumber(id);
const TOOL = ITEMS.findIndex((d) => d.cat === 'tool' && d.contraband) + 1;

/** Puts a body in the middle of a tile. */
function put(b: { x: number; z: number }, x: number, z: number) {
  b.x = x * UNIT + UNIT / 2;
  b.z = z * UNIT + UNIT / 2;
}
/** A guard planted on a tile, looking one way, standing there for a long while. */
function plant(g: Guard, x: number, z: number, facing: number) {
  put(g.body, x, z);
  g.body.facing = g.face = facing;
  g.path = [];
  g.wait = 100000;
  g.mode = GUARD.DUTY;
  g.doing = 0;
}

/** Goes wherever the routine says (its roll call spot, the block's zone, its bed at night). */
function modelPrisoner(sim: Sim) {
  const pilot = new Autopilot(sim.world);
  const places = placesOf(sim.world);
  let want = '';
  return (s: Sim) => {
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

const describe = (e: SimEvent): string => {
  switch (e.type) {
    case 'spotted':
      return `spotted: ${e.reason}`;
    case 'lockdown':
      return e.on ? 'LOCKDOWN' : 'lockdown over';
    case 'caught':
      return `caught → ${e.solitary ? 'solitary' : 'infirmary'}`;
    case 'solitary':
      return e.on ? `into solitary (${e.taken} taken)` : 'out of solitary';
    case 'infirmary':
      return `wakes in the infirmary (${e.taken} taken)`;
    case 'bedCheck':
      return `bed check: ${e.result}`;
    case 'shakedown':
      return `shakedown: cells ${e.cells.join(' and ')}`;
    case 'searched':
      return `cell ${e.cell} searched (${e.taken} taken)`;
    case 'missed':
      return `missed ${ROUTINE[e.routine].id}`;
    default:
      return '';
  }
};
/** Steps with a command source until a test passes (or a limit); returns the log of guard events. */
function run(sim: Sim, cmd: (s: Sim) => number, until: (s: Sim) => boolean, limit: number, log: string[] = []) {
  for (let i = 0; i < limit && !until(sim); i++) {
    sim.step(cmd(sim));
    for (const e of sim.events) if (describe(e)) log.push(`${at(sim)} ${describe(e)}`);
  }
  return log;
}
const idle = () => 0;

/** A day played by the model prisoner up to 10:00 (free time, 0 heat), every guard then planted out of the way. */
function morning(seed: number): Sim {
  const sim = new Sim(CENTER_PERKS, seed);
  const play = modelPrisoner(sim);
  run(sim, play, (s) => minute(s) >= 10 * 60, DAY);
  sim.state.guards.forEach((g, k) => plant(g, 40 + k, 50, 5));
  return sim;
}

// ------------------------------------------------------------------ sight
{
  const w = new Sim(CENTER_PERKS).world;
  const b = (x: number, z: number, f = 5) => bodyAt(x, z, f);
  check(canSee(w, b(28, 13, 1), b(33, 13)), 'a guard sees straight ahead');
  check(!canSee(w, b(28, 13, 9), b(33, 13)), '…not behind it');
  check(canSee(w, b(30, 13, 9), { ...b(30, 13), x: 30 * UNIT + 512 + 800 }), '…unless the player is touching it');
  check(canSee(w, b(28, 13, 1), b(32, 15)) && !canSee(w, b(28, 13, 1), b(32, 16)), 'the cone is 60° wide (27° in, 37° out)');
  check(canSee(w, b(28, 13, 1), b(35, 13)) && !canSee(w, b(28, 13, 1), b(36, 13)), 'sight reaches 7 tiles');
  check(!canSee(w, b(14, 13, 13), b(14, 8)), 'walls block sight');
  check(canSee(w, b(13, 13, 13), b(13, 9)), 'an open cell door does not');
  w.setLockedCells(1 << 2);
  check(!canSee(w, b(13, 13, 13), b(13, 9)), 'a shut one does');
  console.log('sight: 60° cone, 7 tiles, walls and shut doors block it');
}

// ------------------------------------------------------------------ heat rules
{
  // A contraband tool in hand in front of a guard: +40% a second, then the lockdown.
  const sim = morning(2);
  plant(sim.state.guards[0], 28, 13, 1);
  put(sim.state.player, 32, 13);
  sim.state.items.inv[0] = slot(TOOL);
  sim.state.items.hand = 0;
  const from = sim.state.step;
  const log = run(sim, idle, (s) => s.state.lockdown, 200);
  check(log[0]?.endsWith('spotted: contraband'), `a contraband tool in hand is spotted (${log[0]})`);
  check(sim.state.lockdown, 'and heat climbs to a lockdown');
  // Out of sight it doesn't count.
  const quiet = morning(2);
  plant(quiet.state.guards[0], 28, 13, 9);
  put(quiet.state.player, 32, 13);
  quiet.state.items.inv[0] = slot(TOOL);
  run(quiet, idle, () => false, 100);
  check(quiet.state.heat === 0, 'behind the guard: no heat');
  console.log(`contraband in hand (${ITEMS[TOOL - 1].id}): lockdown after ${sim.state.step - from} steps in sight`);

  // Seen in the guard quarters: 100% at once; in a guard outfit: nothing.
  for (const disguised of [false, true]) {
    const s2 = morning(2);
    plant(s2.state.guards[4], 40, 41, 1);
    put(s2.state.player, 45, 41);
    if (disguised) s2.state.items.inv[SLOT.OUTFIT] = slot(n('guard_outfit'));
    const l2 = run(s2, idle, () => false, 10);
    if (!disguised) check(l2[0]?.endsWith('spotted: restricted') && l2[1]?.endsWith('LOCKDOWN'), 'seen in the guard quarters: 100% heat, a lockdown');
    else check(s2.state.heat === 0, 'in a guard outfit the guard quarters raise nothing');
  }
  console.log('restricted rooms: 100% heat when seen, unless disguised');
}

// ------------------------------------------------------------------ night: out of the cell, the disguise
{
  /** A model day up to 23:30 (in bed by then), then out into the cell block corridor. */
  const night = (seed: number) => {
    const sim = new Sim(CENTER_PERKS, seed);
    const play = modelPrisoner(sim);
    run(sim, play, (s) => minute(s) === 23 * 60 + 30, DAY);
    check(sim.state.heat === 0 && sim.playerZone === 'playerCell', 'the model prisoner is in its cell at 23:30');
    return sim;
  };
  // Undisguised in the corridor: the night guard sees, lockdown, caught, solitary.
  const sim = night(4);
  const desk = containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'desk');
  const box = sim.state.items.containers[desk];
  box.fill(0);
  box[0] = slot(n('metal_file')); // hidden: safe
  box[6] = slot(n('screwdriver')); // standard drawer: taken
  box[7] = slot(n('toothpaste')); // legal: kept
  const inv = sim.state.items.inv;
  inv[0] = slot(TOOL);
  inv[1] = slot(n('toothpaste'));
  inv[SLOT.OUTFIT] = slot(n('cushioned_outfit'));
  put(sim.state.player, 16, 13);
  const log = run(sim, idle, (s) => s.state.solitary > 0, 2 * 60 * STEPS_PER_MINUTE);
  console.log('== out at night, no disguise');
  for (const l of log) console.log(l);
  check(log.some((l) => l.endsWith('spotted: night')), 'out of the cell at night is spotted');
  check(log.some((l) => l.endsWith('caught → solitary')), 'and ends in solitary');
  check(itemOf(inv[0]) === 0 && itemOf(inv[1]) === n('toothpaste'), 'carried contraband is taken, legal items kept');
  check(itemOf(inv[SLOT.OUTFIT]) === n('inmate_outfit'), 'the outfit is swapped for an inmate outfit');
  check(itemOf(box[0]) === n('metal_file') && itemOf(box[6]) === 0 && itemOf(box[7]) === n('toothpaste'), 'the desk: hidden kept, standard contraband taken, legal kept');
  check(sim.state.heat === 0, 'heat is settled at 0');
  // Potato peeling: 5 presses a potato, 10 minutes each.
  const left = sim.state.solitary;
  let presses = 0;
  run(sim, (s) => (presses++, command(0, OP.INTERACT)), (s) => s.state.solitary === 0, 200);
  check(sim.state.solitary === 0 && presses <= 61, `peeling 12 potatoes buys release (${presses} presses, ${Math.round(left / STEPS_PER_MINUTE)} minutes were left)`);
  check(sim.playerZone === 'playerCell', 'released at night: back in the cell');
  console.log(`solitary: ${presses} presses to get out, back in the cell at ${at(sim)}`);

  // In a guard outfit: seen at night, no alarm; too close for too long, recognized.
  const d = night(4);
  d.state.items.inv[SLOT.OUTFIT] = slot(n('guard_outfit'));
  d.state.guards.forEach((g, k) => plant(g, 40 + k, 50, 5));
  plant(d.state.guards[0], 10, 13, 1);
  put(d.state.player, 13, 13);
  run(d, idle, () => false, 100);
  check(d.state.seen && d.state.heat === 0, 'disguised, seen 3 tiles away at night: nothing');
  put(d.state.player, 12, 13);
  const l2 = run(d, idle, () => false, 39);
  check(d.state.heat === 0 && !l2.length, 'up close, under 2 seconds: still nothing');
  const l3 = run(d, idle, () => false, 21);
  check(l3[0]?.endsWith('spotted: recognized') && d.state.heat >= 40, `up close past 2 seconds: recognized (+50%/s, heat ${d.state.heat}%)`);
}

// ------------------------------------------------------------------ wanted: chase, lose them, catch
{
  const sim = morning(6);
  sim.state.heat = 85;
  const g = sim.state.guards[0];
  plant(g, 28, 10, 1);
  g.wait = 0;
  put(sim.state.player, 33, 10);
  run(sim, idle, () => false, 2);
  check(g.mode === GUARD.CHASE && alertOf(g) === ALERT.HOSTILE, 'at 85% heat a guard who sees the player gives chase (red)');
  // Gone: into the library, out of sight.
  put(sim.state.player, 16, 31);
  run(sim, idle, () => false, 2);
  check(g.mode === GUARD.INVESTIGATE && alertOf(g) === ALERT.SUSPICIOUS, 'lost: it investigates where it last saw them (orange)');
  run(sim, idle, (s) => g.mode === GUARD.DUTY, 60 * 20);
  check(g.mode === GUARD.DUTY, `then goes back to its round (${at(sim)})`);
  // Seen again, and this time the player stands there: caught, the infirmary under 90%.
  Object.assign(sim.state, { heat: 85 });
  plant(g, 28, 10, 1);
  g.wait = 0;
  put(sim.state.player, 33, 10);
  sim.state.items.inv[0] = slot(n('metal_file'));
  const log = run(sim, idle, (s) => s.state.ko === 0 && s.events.some((e) => e.type === 'infirmary'), 2000);
  console.log('== wanted at 85%');
  for (const l of log) console.log(l);
  check(log.some((l) => l.endsWith('caught → infirmary')), 'caught under 90%: the infirmary');
  check(sim.playerZone === 'infirmary' && itemOf(sim.state.items.inv[0]) === 0, 'woken in the infirmary, the file taken');
}

// ------------------------------------------------------------------ the bed dummy
{
  /** Model prisoner; 22:40 off to the library (dummy in bed or not) until 08:00. */
  const sneak = (dummy: boolean) => {
    const sim = new Sim(CENTER_PERKS, 8);
    const good = modelPrisoner(sim);
    const pilot = new Autopilot(sim.world);
    const bed = containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'bed');
    let leg = 0;
    const play = (s: Sim) => {
      const m = minute(s);
      if (leg === 0 && m === 22 * 60 + 40) {
        leg = 1;
        if (dummy) s.state.items.containers[bed][0] = slot(n('bed_dummy'));
        pilot.goTo(31 * MAP_W + 16);
      }
      if (leg === 1 && m === 8 * 60) leg = 2;
      return leg === 1 ? command(pilot.dir(s.state.player)) : good(s);
    };
    const log = run(sim, play, (s) => s.clock.day === 2 && minute(s) === 9 * 60, 2 * DAY);
    return { sim, log };
  };
  const ok = sneak(true);
  console.log('== bed dummy: a night in the library');
  for (const l of ok.log) console.log(l);
  check(ok.log.filter((l) => l.endsWith('bed check: pass')).length === 2, 'both bed checks pass with the dummy in bed');
  check(!ok.log.some((l) => l.includes('spotted') || l.includes('LOCKDOWN')), 'the night passes unseen');
  const bad = sneak(false);
  console.log('== no dummy');
  for (const l of bad.log.filter((l) => !l.includes('shakedown') && !l.includes('searched'))) console.log(l);
  check(bad.log.find((l) => / bed check: (pass|fail)/.test(l))?.endsWith('fail'), 'without it the first check finds the bed empty');
  check(bad.log.some((l) => l.endsWith('caught → solitary')), 'and the guards come for the player');
}

// ------------------------------------------------------------------ the shakedown
{
  const sim = new Sim(CENTER_PERKS, 12);
  const play = modelPrisoner(sim);
  const desk = containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'desk');
  const box = () => sim.state.items.containers[desk];
  const log: string[] = [];
  let days = 0;
  let searched = false;
  const times: string[] = [];
  while (!searched && days < 15) {
    // Before each morning: a file hidden, a screwdriver and a sheet in the standard drawers.
    run(sim, play, (s) => minute(s) === 7 * 60 + 50, DAY, log);
    box().fill(0);
    box()[1] = slot(n('metal_file'));
    box()[8] = slot(n('screwdriver'));
    box()[9] = slot(n('bed_sheet'));
    const start = log.length;
    run(sim, play, (s) => minute(s) === 9 * 60, DAY, log);
    for (const l of log.slice(start)) if (l.includes('searched')) times.push(l);
    searched = log.slice(start).some((l) => / cell 1 searched/.test(l));
    days++;
  }
  console.log('== shakedowns');
  for (const l of log.filter((l) => l.includes('shakedown') || l.includes('searched'))) console.log(l);
  check(searched, 'within 15 mornings the player\'s cell is searched');
  check(itemOf(box()[1]) === n('metal_file'), 'the hidden file is never found');
  check(itemOf(box()[8]) === 0, 'the screwdriver in a standard drawer is taken');
  check(itemOf(box()[9]) === n('bed_sheet'), 'a legal bed sheet stays');
  check(times.every((l) => / 08:/.test(l)), 'every search is done during roll call');
  check(sim.state.heat === 0, 'the model prisoner keeps 0 heat through it all');
}

// ------------------------------------------------------------------ rounds, and saves mid-chase
{
  const sim = new Sim(CENTER_PERKS, 3);
  const play = modelPrisoner(sim);
  const legs = sim.state.guards.map(() => 0);
  const last = sim.state.guards.map((g) => g.leg);
  let bedChecks = 0;
  let checkStart = 0;
  let longest = 0;
  for (let i = 0; i < 3 * DAY; i++) {
    sim.step(play(sim));
    sim.state.guards.forEach((g, k) => {
      if (g.leg !== last[k]) legs[k]++;
      last[k] = g.leg;
    });
    for (const e of sim.events) {
      if (e.type === 'bedCheck' && e.result === 'start') checkStart = sim.state.step;
      if (e.type === 'bedCheck' && e.result !== 'start') {
        bedChecks++;
        longest = Math.max(longest, sim.state.step - checkStart);
      }
    }
  }
  console.log(`rounds over 3 days: ${legs.join(', ')} stops; ${bedChecks} bed checks, the longest ${Math.round(longest / STEPS_PER_MINUTE)} game minutes`);
  check(legs.every((l) => l >= 60), 'every guard keeps walking its round');
  check(bedChecks === 6 && longest < 45 * STEPS_PER_MINUTE, 'two bed checks a night, each done within 45 minutes');
  check(sim.state.heat === 0, 'the model prisoner ends 3 days with 0 heat among guards');

  // A save in the middle of a chase restores to the same state and plays on the same.
  const a = new Sim(CENTER_PERKS, 9);
  run(a, idle, (s) => s.state.lockdown, DAY);
  run(a, idle, () => false, 40);
  const b = new Sim(CENTER_PERKS, 9);
  b.restore(a.snapshot());
  check(a.hash() === b.hash(), 'restored mid-chase: the same state');
  for (let i = 0; i < 3000; i++) {
    a.step(0);
    b.step(0);
  }
  check(a.hash() === b.hash() && a.state.solitary > 0, 'and it plays on the same (into solitary)');
}
