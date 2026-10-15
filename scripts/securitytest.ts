/**
 * Security (GDD §5.4–5.6, §12), rule by rule, through the real simulation:
 * - the generator: switched off at the action button, the power is out 45 s (the electric
 *   fence safe to cut, detectors, cameras and searchlights dead), a guard sent to it, then
 *   back on; switched back on by the player sooner;
 * - detectors: contraband through the canteen arch trips it (+50%, guards sent); a pouch
 *   shields it (a pass worn off it), clean pockets pass, a pass counts once, no power no scan;
 * - cameras: work on a wall in a camera's eye is the alarm; tape over the lens blinds it for
 *   60 s; the uniform passes in a restricted room; no power, no camera;
 * - searchlights: at night the beam adds heat and sends guards; not in a uniform, not by
 *   day, not without power;
 * - snipers: by day, wanted out in the yard: aim, a warning shot, then hits until the player
 *   drops (solitary); cutting the fence in a tower's reach is seen; off duty at night;
 * - the takeover: all five guards out cold opens the gates; one coming round shuts them;
 * - the grapnel: refused without a sheet rope, over the fence with one; a live electric
 *   fence shocks;
 * - a save from before P7 loads with the power on and an empty tally.
 */
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { ROUTINE, routineAt } from '../src/content/routine';
import { command, OP, SLOT } from '../src/sim/command';
import { ESCAPES, HURT_BY, Sim, type SimEvent, type Snapshot } from '../src/sim/Sim';
import { GUARD } from '../src/sim/systems/guards';
import { itemOf, slot, usesOf } from '../src/sim/systems/items';
import { beamAt, cameraFacing, sniperOn, towers } from '../src/sim/systems/security';
import { BEAM_RADIUS, CAMERA_BLIND_STEPS, DETECTOR_HEAT, KO_STEPS, POWER_OFF_STEPS, STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { TILE } from '../src/sim/world/tiles';
import { LAYER, MAP_W } from '../src/sim/world/World';
import { n, tileOf } from './bots';
import { check } from './assert';

const EAST = 1;
const SOUTH = 5;
const WEST = 9;
const NORTH = 13;

function put(b: { x: number; z: number }, x: number, z: number) {
  b.x = x * UNIT + UNIT / 2;
  b.z = z * UNIT + UNIT / 2;
}
function stand(sim: Sim, x: number, z: number, facing: number, layer: number = LAYER.GROUND) {
  put(sim.state.player, x, z);
  sim.state.player.facing = facing;
  sim.state.layer = layer;
}
function carry(sim: Sim, ...ids: string[]) {
  const it = sim.state.items;
  for (let k = 0; k < 6; k++) it.inv[k] = ids[k] ? slot(n(ids[k])) : 0;
  it.hand = 0;
}
/** Every guard asleep in a far corner (out of the way), unless kept. */
function quiet(sim: Sim, keep: number[] = []) {
  sim.state.guards.forEach((g, k) => {
    if (keep.includes(k)) return;
    put(g.body, 60, 62);
    g.wait = 1e6;
    g.doing = 1;
  });
}
function run(sim: Sim, steps: number, cmd = 0): SimEvent[] {
  const all: SimEvent[] = [];
  for (let k = 0; k < steps && !sim.state.escaped; k++) {
    sim.step(cmd);
    all.push(...sim.events);
  }
  return all;
}
/** To a minute of day 1 (or the next morning, past midnight). */
function clockTo(sim: Sim, minute: number) {
  const m = minute < 8 * 60 ? minute + 1440 : minute;
  sim.state.step = (m - 8 * 60) * STEPS_PER_MINUTE - 1;
  // The blocks skipped are nobody's business here.
  sim.state.routine = routineAt(minute % 1440);
  sim.state.attended = true;
  sim.step(0);
}
const kind = (sim: Sim, x: number, z: number) => sim.world.ground.kind[tileOf(x, z)];

// ------------------------------------------------------------------ the generator
{
  const sim = new Sim(CENTER_PERKS, 21);
  const st = sim.state;
  quiet(sim, [4]);
  // Night (no snipers on the cut), every other guard asleep.
  clockTo(sim, 23 * 60 + 30);
  st.guards[4].doing = 0;
  st.guards[4].wait = 0;
  st.items.inv[SLOT.OUTFIT] = slot(n('guard_outfit'));
  stand(sim, 8, 41, SOUTH);
  sim.step(command(0, OP.INTERACT));
  const off = sim.events.find((e) => e.type === 'power');
  check(!!off && !sim.power && st.powerOff === POWER_OFF_STEPS, 'the action button switches the generator off');
  check(st.guards[4].mode === GUARD.INVESTIGATE, 'a guard is sent to put it right');
  const g = st.guards[4];
  const target = g.target;
  // The electric fence is safe to cut now.
  stand(sim, 27, 60, SOUTH);
  carry(sim, 'sturdy_cutters');
  const ev = run(sim, 60, command(0, OP.USE, 1));
  check(!ev.some((e) => e.type === 'shocked') && kind(sim, 27, 61) === TILE.FENCE_CUT, 'the dead electric fence cuts like any other');
  const back = run(sim, POWER_OFF_STEPS);
  const on = back.find((e) => e.type === 'power');
  check(sim.power && on?.type === 'power' && on.by === 'guard', 'back on 45 s later (the maintenance guard)');
  console.log(`generator: off for ${POWER_OFF_STEPS / 20} s; the east guard sent to ${target % MAP_W},${Math.floor(target / MAP_W)}, there at ${Math.floor(g.body.x / UNIT)},${Math.floor(g.body.z / UNIT)}; the fence ${TILE.FENCE_CUT === kind(sim, 27, 61) ? 'cut' : 'whole'}`);
  // Off and back on by hand.
  stand(sim, 8, 41, SOUTH);
  sim.step(command(0, OP.INTERACT));
  sim.step(command(0, OP.INTERACT));
  const by = sim.events.find((e) => e.type === 'power');
  check(sim.power && by?.type === 'power' && by.by === 'player', 'switched back on by the player');
  // With the power on, the electric fence knocks the player out.
  stand(sim, 26, 60, SOUTH);
  carry(sim, 'sturdy_cutters');
  sim.step(command(0, OP.USE, 1));
  check(sim.events.some((e) => e.type === 'shocked'), 'a live electric fence still shocks');
}

// ------------------------------------------------------------------ detectors
{
  // The canteen arch at 43–44, 20 (from the corridor, north into the canteen).
  const pass = (setup: (sim: Sim) => void) => {
    const sim = new Sim(CENTER_PERKS, 22);
    quiet(sim, [0, 1]);
    stand(sim, 44, 22, NORTH);
    setup(sim);
    const ev = run(sim, 40, command(NORTH));
    // Stand in it a while: one pass, one scan.
    return { sim, ev };
  };
  const dirty = pass((s) => carry(s, 'nail_file'));
  const tripped = dirty.ev.filter((e) => e.type === 'scanned');
  check(tripped.length === 1 && tripped[0].type === 'scanned' && tripped[0].tripped && dirty.sim.state.heat >= DETECTOR_HEAT, 'contraband through the arch trips it (+50%)');
  check(dirty.ev.some((e) => e.type === 'spotted' && e.reason === 'detector'), 'and is announced');
  check(dirty.sim.state.guards.some((g) => g.mode === GUARD.INVESTIGATE), 'guards sent to look');
  const shielded = pass((s) => carry(s, 'nail_file', 'pouch'));
  const sh = shielded.ev.find((e) => e.type === 'scanned');
  check(sh?.type === 'scanned' && !sh.tripped && sh.pouch === 19 && shielded.sim.state.heat === 0, 'a pouch shields it (19 passes left)');
  check(usesOf(shielded.sim.state.items.inv[1]) === 19, 'the pass is worn off the pouch');
  const clean = pass((s) => carry(s, 'toothpaste'));
  check(!clean.ev.some((e) => e.type === 'scanned') && clean.sim.state.heat === 0, 'clean pockets pass');
  const dark = pass((s) => (s.state.powerOff = POWER_OFF_STEPS));
  check(!dark.ev.some((e) => e.type === 'scanned'), 'no power, no scan');
  // Back and forth: a scan each pass.
  const twice = pass((s) => carry(s, 'nail_file', 'pouch'));
  run(twice.sim, 30, command(SOUTH));
  run(twice.sim, 30, command(NORTH));
  check(usesOf(twice.sim.state.items.inv[1]) === 18, 'every pass counts');
  // The last pass wears the pouch out.
  const worn = pass((s) => {
    carry(s, 'nail_file', 'pouch');
    s.state.items.inv[1] = slot(n('pouch'), 1);
  });
  check(!worn.sim.state.items.inv[1] && worn.ev.some((e) => e.type === 'broke'), 'the pouch wears out on its last pass');
  console.log(`detectors: a nail file → +${dirty.sim.state.heat}% and guards sent; with a pouch → shielded (${sh?.type === 'scanned' ? sh.pouch : '?'} left); clean or no power → nothing`);
}

// ------------------------------------------------------------------ cameras
{
  // The woodshop camera (39, 25) sweeps south-east over the room.
  const cam = CENTER_PERKS.cameras![1];
  const sim = new Sim(CENTER_PERKS, 23);
  const st = sim.state;
  quiet(sim);
  // Chipping the woodshop's back wall in its eye.
  const watch = (cmd: number, steps: number) => run(sim, steps, cmd);
  // Wait until it looks this way: its heading points at 42, 28 (south-east).
  stand(sim, 41, 29, SOUTH);
  carry(sim, 'sturdy_pickaxe');
  let ev: SimEvent[] = [];
  for (let k = 0; k < 400 && !st.lockdown; k++) {
    sim.step(command(0, OP.USE, 1));
    ev.push(...sim.events);
  }
  check(st.lockdown && ev.some((e) => e.type === 'spotted' && e.reason === 'camera'), 'work on a wall in a camera’s eye: the alarm');
  console.log(`camera: chipping in the woodshop → ${st.lockdown ? 'LOCKDOWN' : 'nothing'} (facing ${cameraFacing(cam.face, 1, st.step)})`);
  // Taped: blind for a minute, the same work unseen.
  const sim2 = new Sim(CENTER_PERKS, 23);
  const st2 = sim2.state;
  quiet(sim2);
  stand(sim2, 40, 25, WEST);
  carry(sim2, 'duct_tape', 'sturdy_pickaxe');
  sim2.step(command(0, OP.USE, 1));
  const taped = sim2.events.find((e) => e.type === 'camera');
  check(taped?.type === 'camera' && taped.blind && st2.cams[1] > 0 && !st2.items.inv[0], 'tape over the lens: blind (the tape used up)');
  stand(sim2, 41, 29, SOUTH);
  sim2.step(command(0, OP.SELECT, 1));
  ev = [];
  for (let k = 0; k < 400; k++) {
    sim2.step(command(0, OP.USE, 1));
    ev.push(...sim2.events);
  }
  check(!st2.lockdown, 'a blind camera sees nothing');
  const seenBlind = st2.lockdown;
  ev = run(sim2, CAMERA_BLIND_STEPS);
  check(ev.some((e) => e.type === 'camera' && !e.blind) && st2.cams[1] === 0, 'and watches again a minute later');
  console.log(`camera taped: ${seenBlind ? 'seen' : 'unseen'} for ${CAMERA_BLIND_STEPS / 20} s, then watching again`);
  // The control room camera: a guard's uniform passes; an inmate outfit is the alarm; no power, no camera.
  const room = (outfit: string, power = true) => {
    const s3 = new Sim(CENTER_PERKS, 24);
    quiet(s3);
    s3.state.items.inv[SLOT.OUTFIT] = slot(n(outfit));
    if (!power) s3.state.powerOff = POWER_OFF_STEPS;
    stand(s3, 52, 41, SOUTH);
    run(s3, 400);
    return s3.state.lockdown;
  };
  check(!room('guard_outfit') && room('inmate_outfit') && !room('inmate_outfit', false), 'uniform passes, an inmate is seen, no power no camera');
  console.log(`control room camera: uniform ${room('guard_outfit') ? 'seen' : 'passes'}, inmate ${room('inmate_outfit') ? 'LOCKDOWN' : 'unseen'}, power off ${room('inmate_outfit', false) ? 'seen' : 'unseen'}`);
}

// ------------------------------------------------------------------ searchlights
{
  const lit = (opts: { night?: boolean; outfit?: string; power?: boolean }) => {
    const sim = new Sim(CENTER_PERKS, 25);
    const st = sim.state;
    quiet(sim, [3]);
    clockTo(sim, opts.night === false ? 13 * 60 : 23 * 60 + 30);
    if (opts.outfit) st.items.inv[SLOT.OUTFIT] = slot(n(opts.outfit));
    if (opts.power === false) st.powerOff = POWER_OFF_STEPS;
    // Follow the west beam for a second, standing where it is.
    const path = CENTER_PERKS.searchlights![0];
    const at = { x: 0, z: 0 };
    const ev: SimEvent[] = [];
    for (let k = 0; k < 20; k++) {
      beamAt(path, st.step + 1, at);
      st.player.x = at.x;
      st.player.z = at.z;
      st.layer = LAYER.GROUND;
      sim.step(0);
      ev.push(...sim.events);
    }
    return { heat: st.heat, ev, sent: st.guards.filter((g) => g.mode === GUARD.INVESTIGATE).length };
  };
  const night = lit({});
  check(night.heat >= 30 && night.heat <= 40 && night.ev.some((e) => e.type === 'spotted' && e.reason === 'searchlight'), 'a second in the beam at night: about +35%');
  check(night.sent >= 1, 'and a guard is sent');
  check(lit({ outfit: 'guard_outfit' }).heat === 0, 'not in a uniform');
  check(lit({ night: false }).heat === 0, 'not by day');
  check(lit({ power: false }).heat === 0, 'not without power');
  console.log(`searchlight: a second in the beam → +${night.heat}%, ${night.sent} guard(s) sent; uniform, day, no power → 0`);
  // The beam stays in the open and away from the towers' feet.
  const w = new Sim(CENTER_PERKS, 1).world;
  const at = { x: 0, z: 0 };
  let ok = true;
  for (const path of CENTER_PERKS.searchlights!) {
    for (let s = 0; s < 4000; s += 7) {
      beamAt(path, s, at);
      const t = Math.floor(at.z / UNIT) * MAP_W + Math.floor(at.x / UNIT);
      if (w.ground.zone[t] === 0 && w.ground.kind[t] !== TILE.GRASS && w.ground.kind[t] !== TILE.DIRT) ok = false;
    }
  }
  check(ok && BEAM_RADIUS > 0, 'beams sweep the open ground');
}

// ------------------------------------------------------------------ snipers
{
  const sim = new Sim(CENTER_PERKS, 26);
  const st = sim.state;
  quiet(sim);
  clockTo(sim, 13 * 60);
  // Wanted, out in the south yard near the west tower.
  stand(sim, 12, 52, SOUTH);
  st.heat = 95;
  st.lockdown = true;
  check(sniperOn(sim.world, st.player, LAYER.GROUND) >= 0, 'in a tower’s reach');
  const ev = run(sim, 40 * 20);
  const shots = ev.filter((e) => e.type === 'shot');
  const hits = shots.filter((e) => e.type === 'shot' && e.hit);
  check(ev.some((e) => e.type === 'aim') && shots.length > 0 && shots[0].type === 'shot' && !shots[0].hit, 'it takes aim, then a warning shot');
  check(hits.length >= 3 && ev.some((e) => e.type === 'hurt' && e.by === HURT_BY.SNIPER), 'then hits');
  check(ev.some((e) => e.type === 'caught' && e.solitary), 'until the player drops: solitary');
  console.log(`sniper: ${shots.length} shots (${hits.length} hits, ${hits[0]?.type === 'shot' ? hits[0].dmg : 0} each) → ${ev.some((e) => e.type === 'caught') ? 'down, solitary' : 'still up'}; towers at ${towers(sim.world).map((t) => `${(t.x / UNIT).toFixed(1)},${(t.z / UNIT).toFixed(1)}`).join(' ')}`);
  // Off duty at night.
  const night = new Sim(CENTER_PERKS, 26);
  quiet(night);
  clockTo(night, 23 * 60 + 30);
  stand(night, 12, 52, SOUTH);
  night.state.heat = 95;
  check(!run(night, 200).some((e) => e.type === 'shot'), 'no shots at night');
  // Cutting the fence by day within reach: seen.
  const cut = new Sim(CENTER_PERKS, 27);
  quiet(cut);
  clockTo(cut, 13 * 60);
  stand(cut, 12, 60, SOUTH);
  carry(cut, 'sturdy_cutters');
  cut.step(command(0, OP.USE, 1));
  check(cut.events.some((e) => e.type === 'spotted' && e.reason === 'sniper') && cut.state.lockdown, 'cutting the fence by day in a tower’s reach is seen');
  // Out of reach (the north fence): nothing.
  const far = new Sim(CENTER_PERKS, 27);
  quiet(far);
  clockTo(far, 13 * 60);
  stand(far, 12, 3, NORTH);
  carry(far, 'sturdy_cutters');
  far.step(command(0, OP.USE, 1));
  check(!far.state.lockdown, 'the north fence is out of the towers’ reach');
}

// ------------------------------------------------------------------ the takeover
{
  const sim = new Sim(CENTER_PERKS, 28);
  const st = sim.state;
  stand(sim, 30, 46, SOUTH);
  check(sim.world.blocked(30, 61), 'the perimeter gate is shut');
  st.guards.forEach((g, k) => {
    if (k < 4) g.ko = KO_STEPS;
  });
  sim.step(0);
  check(!st.takeover, 'four of five down is not enough');
  st.guards[4].ko = KO_STEPS;
  sim.step(0);
  check(st.takeover && sim.events.some((e) => e.type === 'takeover' && e.on), 'all five out cold: the takeover');
  check(!sim.world.blocked(30, 61) && !sim.world.blocked(10, 38), 'every door and gate opens for the player');
  // The first to come round ends it.
  run(sim, KO_STEPS - 1);
  check(!st.takeover && sim.world.blocked(30, 61), 'one guard up again: the gates shut');
  console.log(`takeover: 5/5 down → gates open; one comes round → shut`);
}

// ------------------------------------------------------------------ the grapnel
{
  const sim = new Sim(CENTER_PERKS, 29);
  const st = sim.state;
  quiet(sim);
  stand(sim, 6, 20, WEST, LAYER.ROOF);
  carry(sim, 'grapnel');
  sim.step(command(0, OP.USE, 1));
  check(sim.events.some((e) => e.type === 'cantStrike' && e.why === 'noRope') && !!st.items.inv[0], 'no sheet rope: refused, the grapnel kept');
  carry(sim, 'grapnel', 'sheet_rope');
  sim.step(command(0, OP.USE, 1));
  check(st.escaped > 0 && ESCAPES[st.via] === 'roof' && !st.items.inv[0] && !st.items.inv[1], 'over the fence and down the rope: out (both left behind)');
  // Not from the middle of a roof.
  const mid = new Sim(CENTER_PERKS, 29);
  quiet(mid);
  stand(mid, 9, 20, WEST, LAYER.ROOF);
  carry(mid, 'grapnel', 'sheet_rope');
  mid.step(command(0, OP.USE, 1));
  check(!mid.state.escaped, 'only from a roof’s edge');
  console.log(`grapnel: without a rope refused; with one → ${st.escaped ? `out (${ESCAPES[st.via]})` : 'still up'}`);
}

// ------------------------------------------------------------------ an old save
{
  const sim = new Sim(CENTER_PERKS, 30);
  run(sim, 100);
  const snap = sim.snapshot();
  const old = structuredClone(snap) as Snapshot;
  for (const k of ['powerOff', 'scanned', 'cams', 'sniperAt', 'shots', 'lit', 'takeover', 'tally', 'via']) delete (old.state as unknown as Record<string, unknown>)[k];
  const b = new Sim(CENTER_PERKS, 1);
  b.restore(old);
  check(b.hash() === sim.hash(), 'a save from before P7 loads as the same state');
  check(b.power && b.state.tally.join() === '0,0,0,0' && b.state.cams.length === 3, 'power on, nothing tallied');
  console.log(`old save: ${b.hash() === sim.hash() ? 'same state' : 'DIFFERENT'}`);
}

void EAST;
void ROUTINE;
void itemOf;
