/**
 * Noise and distractions (P14), rule by rule, at Center Perks:
 * - reach: walking tiles through wherever sight passes, never into a wall; a shut door costs
 *   4; a wall being chipped is heard on both sides of it;
 * - from below only the 3×3 tiles above hear it; from the vents, the floor within 2 tiles
 *   below; from a roof, the open ground around;
 * - tools: chip 6, cut 5, dig 3, unscrew and sharpen 2; plastic a tile less, sturdy, powered
 *   and multi a tile more;
 * - who comes: the guards awake within earshot hear it, the two nearest (by the walk; ties:
 *   the lower index) go and look where it came from for 8 s; nobody more where one is already
 *   looking; never one chasing; nobody asleep (but a bang wakes them, sends three, 12 s);
 *   noise costs no heat;
 * - throwing: six tiles (seven at Strength 70), a clear line, onto open floor, not while busy;
 *   a full pile spills onto the next tile; it lands at once with a thud by what it is (soft 2,
 *   hard 4, metal 6); an inmate hit thinks less of the player;
 * - the firecracker: lands lit, goes off 1.5 s later; saved and loaded mid-fuse it goes off
 *   the same; an old save loads with nothing burning;
 * - the alarm clock: wound 20 s a press, a minute at most; rings once a second for 8 s where
 *   it is (in the hand, in a desk); a press while it rings stops it;
 * - contraband thrown over a detector arch never meets the scanner;
 * - the ear on the tool button says a guard would hear exactly when the strike is heard.
 */
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { command, EXT, OP, tossArgs } from '../src/sim/command';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { GUARD, type Guard } from '../src/sim/systems/guards';
import { DOING } from '../src/sim/systems/inmates';
import { itemOf, PILE, slot, usesOf } from '../src/sim/systems/items';
import { earshot, hearers, makeNoise, strikeNoise, wouldHear } from '../src/sim/systems/noise';
import { ALARM_CLOCK, toolTarget } from '../src/sim/systems/structure';
import { BANG_LOOK, FUSE_STEPS, NOISE_LOOK, STEPS_PER_SECOND, UNIT, WIND_MAX } from '../src/sim/tuning';
import { containersOf } from '../src/sim/world/containers';
import { TILE_INFO } from '../src/sim/world/tiles';
import { LAYER, MAP_H, MAP_W } from '../src/sim/world/World';
import { check } from './assert';
import { n, tileOf } from './bots';
import { aimToss, throwItem } from '../src/sim/systems/throwing';

const EAST = 1;
const SOUTH = 5;
const NORTH = 13;

function put(b: { x: number; z: number }, x: number, z: number) {
  b.x = x * UNIT + UNIT / 2;
  b.z = z * UNIT + UNIT / 2;
}
function stand(sim: Sim, x: number, z: number, facing = EAST) {
  put(sim.state.player, x, z);
  sim.state.player.facing = facing;
  sim.state.layer = LAYER.GROUND;
}
function carry(sim: Sim, ...ids: string[]) {
  const it = sim.state.items;
  for (let k = 0; k < 6; k++) it.inv[k] = ids[k] ? slot(n(ids[k])) : 0;
  it.hand = 0;
}
/** Every guard asleep in a far corner, out of earshot and out of the way. */
function away(sim: Sim) {
  for (const g of sim.state.guards) {
    put(g.body, 60, 62);
    g.doing = DOING.SLEEP;
    g.wait = 1e6;
    g.mode = GUARD.DUTY;
  }
}
/** A guard awake on duty, standing still at a tile. */
function post(g: Guard, x: number, z: number) {
  put(g.body, x, z);
  g.doing = DOING.NOTHING;
  g.wait = 1e6;
  g.mode = GUARD.DUTY;
  g.ko = 0;
}
/** A throw at a tile across and down from the player's (the command carries the tile). */
function toss(sim: Sim, dx: number, dz: number): number {
  const p = sim.state.player;
  const [b, c] = tossArgs((Math.floor(p.z / UNIT) + dz) * MAP_W + Math.floor(p.x / UNIT) + dx);
  return command(0, OP.EXT, EXT.THROW, b, c);
}
function run(sim: Sim, steps: number, cmd = 0): SimEvent[] {
  const all: SimEvent[] = [];
  for (let k = 0; k < steps; k++) {
    sim.step(cmd);
    all.push(...sim.events);
  }
  return all;
}
const noiseOf = (ev: readonly SimEvent[], kind?: string) => ev.find((e): e is Extract<SimEvent, { type: 'noise' }> => e.type === 'noise' && (!kind || e.kind === kind));
const xz = (t: number) => `${t % MAP_W},${Math.floor(t / MAP_W)}`;
const opaque = (sim: Sim, t: number) => TILE_INFO[sim.world.ground.kind[t]].opaque;
/** The ground tiles within a square around a tile that pass a test. */
function square(sim: Sim, tile: number, span: number, ok: (t: number) => boolean): number[] {
  const out: number[] = [];
  for (let dz = -span; dz <= span; dz++)
    for (let dx = -span; dx <= span; dx++) {
      const x = (tile % MAP_W) + dx;
      const z = Math.floor(tile / MAP_W) + dz;
      if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
      if (ok(z * MAP_W + x)) out.push(z * MAP_W + x);
    }
  return out;
}
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && [...a].sort((p, q) => p - q).join() === [...b].sort((p, q) => p - q).join();

// ------------------------------------------------------------------ how far a noise carries
{
  const sim = new Sim(CENTER_PERKS, 1);
  const w = sim.world;
  const chip = earshot(sim, { layer: LAYER.GROUND, tile: tileOf(30, 22), reach: 6 });
  const has = (list: number[], x: number, z: number) => list.includes(tileOf(x, z));
  check(has(chip, 36, 22) && !has(chip, 37, 22), 'six walking tiles along the corridor, not seven');
  check(has(chip, 30, 28) && !has(chip, 30, 29), 'and round into the yard through its opening');
  check(chip.every((t) => !opaque(sim, t)), 'never into a wall');
  // A shut door counts 4: from beside the laundry's door, 3 tiles reach past it open, not shut; 6 do.
  const door = tileOf(10, 24);
  const from = { layer: LAYER.GROUND, tile: tileOf(10, 23), reach: 3 };
  w.doorShut[door] = 0;
  const open = earshot(sim, from);
  w.doorShut[door] = 1;
  const shut = earshot(sim, from);
  const shut6 = earshot(sim, { ...from, reach: 6 });
  w.doorShut[door] = 0;
  check(has(open, 10, 26) && !has(shut, 10, 25) && has(shut6, 10, 26), 'a shut door counts four tiles');
  // A wall being chipped: heard on both sides of it.
  const wall = earshot(sim, { layer: LAYER.GROUND, tile: tileOf(8, 24), reach: 2 });
  check(has(wall, 8, 23) && has(wall, 8, 25), 'a wall at work is heard on both sides');
  // Below, above, on a roof.
  const src = tileOf(30, 22);
  const under = earshot(sim, { layer: LAYER.UNDER, tile: src, reach: 3 });
  check(same(under, square(sim, src, 1, (t) => !opaque(sim, t))), 'from a tunnel: only the 3×3 tiles above');
  const vents = earshot(sim, { layer: LAYER.VENTS, tile: src, reach: 2 });
  check(same(vents, square(sim, src, 2, (t) => !opaque(sim, t))), 'from the vents: the floor within 2 tiles below');
  const roofTile = tileOf(12, 13);
  const roof = earshot(sim, { layer: LAYER.ROOF, tile: roofTile, reach: 7 });
  check(roof.length > 0 && same(roof, square(sim, roofTile, 7, (t) => !opaque(sim, t) && TILE_INFO[w.ground.kind[t]].outdoor)), 'from a roof: the open ground around, nothing indoors');
  const [g0, g1] = sim.state.guards;
  away(sim);
  post(g0, 31, 23);
  post(g1, 32, 22);
  check(hearers(sim, { layer: LAYER.UNDER, tile: src, reach: 3 }).join() === '0', 'a guard standing over the dig hears it; two tiles off, not');
  // Sent to a noise on a roof from the open ground diagonally off it: he walks towards it.
  const outside = roof.filter((t) => !sim.world.guardBlock[t]).sort((a, b) => Math.abs((b % MAP_W) - 12) + Math.abs(Math.floor(b / MAP_W) - 13) - (Math.abs((a % MAP_W) - 12) + Math.abs(Math.floor(a / MAP_W) - 13)))[0];
  away(sim);
  post(g0, outside % MAP_W, Math.floor(outside / MAP_W));
  sim.events = [];
  makeNoise(sim, 'ring', LAYER.ROOF, roofTile, 7);
  const md = (t: number) => Math.abs((t % MAP_W) - 12) + Math.abs(Math.floor(t / MAP_W) - 13);
  check(g0.mode === GUARD.INVESTIGATE && md(g0.target) < md(outside), `sent to a roof noise, a guard walks towards it (from ${xz(outside)} to ${xz(g0.target)})`);
  // Tools: chip 6, cut 5, dig 3, unscrew 2; plastic −1, sturdy, powered and multi +1.
  const reachOf = (action: string, id: string, layer: number = LAYER.GROUND) => strikeNoise(layer, { action: action as 'chip', layer, tile: 0, fits: true, hp: 1 }, n(id))?.reach;
  const tools = [reachOf('chip', 'plastic_fork'), reachOf('chip', 'flimsy_pickaxe'), reachOf('chip', 'sturdy_pickaxe'), reachOf('cut', 'light_cutters'), reachOf('dig', 'plastic_spoon', LAYER.UNDER), reachOf('dig', 'multitool', LAYER.UNDER), reachOf('unscrew', 'nail_file'), reachOf('unscrew', 'powered_screwdriver'), reachOf('sharpen', 'plastic_comb')];
  check(tools.join() === '5,6,7,5,2,4,2,3,2', `tool noise by tool and tier (${tools.join()})`);
  console.log(`reach: a chip in the corridor reaches ${chip.length} tiles; a door shut ${shut.length} vs open ${open.length}; under ${under.length}, vents ${vents.length}, roof ${roof.length}; tools ${tools.join(' ')}`);
}

// ------------------------------------------------------------------ who comes
{
  const sim = new Sim(CENTER_PERKS, 2);
  const st = sim.state;
  away(sim);
  const [g0, g1, g2, g3, g4] = st.guards;
  post(g0, 32, 22);
  post(g1, 26, 22);
  post(g2, 35, 22);
  post(g3, 28, 22);
  post(g4, 40, 22);
  sim.events = [];
  makeNoise(sim, 'strike', LAYER.GROUND, tileOf(30, 22), 6);
  const e = noiseOf(sim.events)!;
  check(e.heard.join() === '0,3,1,2', `heard within six tiles, nearest first, ties to the lower index (${e.heard.join()})`);
  check(e.sent.join() === '0,3', 'the two nearest go and look');
  check(g0.mode === GUARD.INVESTIGATE && g0.target === tileOf(30, 22) && g0.timer === NOISE_LOOK && g3.target === tileOf(30, 22), 'where it came from, for 8 s');
  check(g1.mode === GUARD.DUTY && g2.mode === GUARD.DUTY, 'the others keep to their duty');
  check(st.heat === 0, 'noise itself costs no heat');
  sim.events = [];
  makeNoise(sim, 'strike', LAYER.GROUND, tileOf(31, 22), 6);
  const again = noiseOf(sim.events)!;
  check(again.heard.length === 4 && again.sent.length === 0, 'where a guard is already looking, nobody more is sent');
  // Looking around there, then back to duty.
  g0.wait = g3.wait = 0;
  run(sim, NOISE_LOOK + 6 * STEPS_PER_SECOND);
  check(g0.mode !== GUARD.INVESTIGATE && g3.mode !== GUARD.INVESTIGATE, 'and back to duty after the look');
  // Chasing, asleep.
  const s2 = new Sim(CENTER_PERKS, 3);
  away(s2);
  const [h0, h1, h2] = s2.state.guards;
  post(h0, 31, 22);
  h0.mode = GUARD.CHASE;
  post(h1, 33, 22);
  post(h2, 32, 22);
  h2.doing = DOING.SLEEP;
  s2.events = [];
  makeNoise(s2, 'strike', LAYER.GROUND, tileOf(30, 22), 6);
  const c = noiseOf(s2.events)!;
  check(c.heard.join() === '0,1' && c.sent.join() === '1', 'a chasing guard hears but keeps chasing; a sleeping one hears nothing');
  // A bang: the sleeper wakes, three go, 12 s.
  const s3 = new Sim(CENTER_PERKS, 4);
  away(s3);
  const [k0, k1, k2, k3] = s3.state.guards;
  post(k0, 32, 22);
  k0.doing = DOING.SLEEP;
  post(k1, 34, 22);
  post(k2, 36, 22);
  post(k3, 38, 22);
  s3.events = [];
  makeNoise(s3, 'bang', LAYER.GROUND, tileOf(30, 22), 10);
  const b = noiseOf(s3.events)!;
  check(k0.doing === DOING.NOTHING && b.heard.join() === '0,1,2,3', 'a bang wakes the guards asleep within earshot');
  check(b.sent.join() === '0,1,2' && k0.timer === BANG_LOOK && k3.mode === GUARD.DUTY, 'and sends three, looking 12 s');
  console.log(`responders: heard ${e.heard.join(' ')}, sent ${e.sent.join(' ')} to ${xz(g0.target)}; a bang sent ${b.sent.join(' ')}`);
}

// ------------------------------------------------------------------ throwing
{
  const sim = new Sim(CENTER_PERKS, 5);
  const st = sim.state;
  away(sim);
  stand(sim, 30, 22);
  carry(sim, 'sock');
  const aim = (dx: number, dz: number) => aimToss(sim, dx, dz, { why: null, to: -1 });
  check(aim(3, 0).why === null && aim(3, 0).to === tileOf(33, 22), 'three tiles off: it lands there');
  check(aim(6, 0).why === null && aim(7, 0).why === 'far' && aim(5, 4).why === 'far', 'six tiles at most (a radius)');
  st.str = 70;
  check(aim(7, 0).why === null, 'seven once strong (Strength 70)');
  st.str = 40;
  stand(sim, 8, 22, SOUTH);
  check(aim(0, 4).why === 'line', 'never through a wall');
  check(aim(0, 2).why === 'there', 'never onto one');
  stand(sim, 30, 22);
  carry(sim);
  check(aim(2, 0).why === 'nothing', 'nothing in hand, nothing to throw');
  carry(sim, 'sock');
  st.talk = 0;
  const talking = aim(2, 0).why;
  st.talk = -1;
  st.layer = LAYER.VENTS;
  const vents = aim(2, 0).why;
  st.layer = LAYER.GROUND;
  check(talking === 'busy' && vents === 'busy', 'not while talking, not off the ground floor');
  for (let k = 0; k < PILE; k++) st.items.ground.push([tileOf(33, 22), slot(n('sock'))]);
  check(aim(3, 0).to === tileOf(33, 21), 'onto a full pile: the next tile with room');
  st.items.ground.length = 0;
  // Through the real command: it lands at once, out of the hand, with a soft thud.
  sim.step(toss(sim, 3, 0));
  const tossed = sim.events.find((e) => e.type === 'tossed');
  const soft = noiseOf(sim.events, 'thud');
  check(tossed?.type === 'tossed' && tossed.to === tileOf(33, 22) && st.items.inv[0] === 0 && st.items.ground.some(([k, v]) => k === tileOf(33, 22) && itemOf(v) === n('sock')), 'thrown: it lands at once, out of the hand');
  const far = (list: number[], from: number) => Math.max(...list.map((t) => Math.abs((t % MAP_W) - (from % MAP_W)) + Math.abs(Math.floor(t / MAP_W) - Math.floor(from / MAP_W))));
  check(!!soft && far(soft.tiles, tileOf(33, 22)) === 2, 'a sock lands soft (2 tiles)');
  carry(sim, 'potato', 'crowbar');
  sim.step(toss(sim, 2, 0));
  const hard = noiseOf(sim.events, 'thud');
  st.items.hand = 1;
  sim.step(toss(sim, 2, 0));
  const metal = noiseOf(sim.events, 'thud');
  check(!!hard && !!metal && far(hard.tiles, tileOf(32, 22)) === 4 && far(metal.tiles, tileOf(32, 22)) === 6, 'a potato lands hard (4), a crowbar metal (6)');
  // Sent while walking: it lands on the tile aimed at, not a tile further on.
  stand(sim, 30, 22);
  st.player.x = 31 * UNIT - 40;
  carry(sim, 'sock');
  const aimedAt = tileOf(34, 22);
  const [tb, tc] = tossArgs(aimedAt);
  sim.step(command(EAST, OP.EXT, EXT.THROW, tb, tc));
  const walked = sim.events.find((e) => e.type === 'tossed');
  check(Math.floor(st.player.x / UNIT) === 31 && walked?.type === 'tossed' && walked.to === aimedAt, 'thrown on the move: it lands where it was aimed');
  // On someone: they think less of the player.
  const m = st.inmates[0];
  put(m.body, 33, 22);
  m.opinion = 50;
  carry(sim, 'sock');
  sim.events = [];
  throwItem(sim, tileOf(33, 22));
  const hit = sim.events.find((e) => e.type === 'tossed');
  check(hit?.type === 'tossed' && hit.hit === 0 && m.opinion === 48, 'an inmate hit thinks less of the player (−2)');
  console.log(`throwing: a sock reaches ${soft?.tiles.length} tiles, a potato ${hard?.tiles.length}, a crowbar ${metal?.tiles.length}`);
}

// ------------------------------------------------------------------ the firecracker
{
  const sim = new Sim(CENTER_PERKS, 7);
  const st = sim.state;
  away(sim);
  const [g0, g1, g2, g3, g4] = st.guards;
  stand(sim, 30, 22);
  carry(sim, 'firecracker');
  // Landing at 33,22: asleep 3 tiles off, awake 5, 7, 7 and 8 off (none within the thud's 2).
  post(g0, 36, 22);
  g0.doing = DOING.SLEEP;
  post(g2, 38, 22);
  post(g1, 26, 22);
  post(g3, 40, 22);
  post(g4, 41, 22);
  sim.step(toss(sim, 3, 0));
  const thrownAt = st.step;
  const landed = noiseOf(sim.events, 'thud');
  check(st.fuses.length === 1 && !st.items.ground.length && st.items.inv[0] === 0 && landed?.sent.length === 0, 'a firecracker lands lit: no item, a fuse burning');
  // Saved mid-fuse and loaded: it goes off just the same.
  run(sim, 10);
  const snap = sim.snapshot();
  const copy = new Sim(CENTER_PERKS, 7);
  copy.restore(snap);
  const old = sim.snapshot();
  delete (old.state as Partial<typeof old.state>).fuses;
  const older = new Sim(CENTER_PERKS, 7);
  older.restore(old);
  check(copy.state.fuses.length === 1 && older.state.fuses.length === 0, 'a save holds the fuse; one from before P14 loads with nothing burning');
  let bangAt = -1;
  let boom: Extract<SimEvent, { type: 'noise' }> | undefined;
  let copyBang = -1;
  for (let k = 0; k < FUSE_STEPS + 5; k++) {
    sim.step(0);
    copy.step(0);
    const b = sim.events.find((e) => e.type === 'bang');
    if (b?.type === 'bang') {
      bangAt = st.step;
      boom = noiseOf(sim.events, 'bang');
      check(b.tile === tileOf(33, 22), 'where it landed');
    }
    if (copy.events.some((e) => e.type === 'bang')) copyBang = copy.state.step;
  }
  check(bangAt === thrownAt + FUSE_STEPS, `it goes off 1.5 s after landing (${bangAt - thrownAt} steps)`);
  check(copyBang === bangAt && copy.hash() === sim.hash(), 'loaded mid-fuse, it goes off the same');
  check(!!boom && boom.heard.join() === '0,2,1,3,4' && boom.sent.join() === '0,2,1', `the sleeper wakes; three of those who heard go (${boom?.sent.join()})`);
  check(g0.mode === GUARD.INVESTIGATE && g0.target === tileOf(33, 22) && st.fuses.length === 0, 'to where it went off; nothing left burning');
  console.log(`firecracker: off ${bangAt - thrownAt} steps after landing, heard by ${boom?.heard.length} guards, ${boom?.sent.length} sent, ${boom?.tiles.length} tiles`);
}

// ------------------------------------------------------------------ the alarm clock
{
  const sim = new Sim(CENTER_PERKS, 8);
  const st = sim.state;
  away(sim);
  const g = st.guards[1];
  post(g, 35, 22);
  stand(sim, 30, 22);
  carry(sim, 'alarm_clock');
  const wound: number[] = [];
  for (let k = 0; k < 4; k++) {
    sim.step(command(0, OP.USE, 1));
    for (const e of sim.events) if (e.type === 'wound') wound.push(e.secs);
  }
  const woundAt = st.step;
  check(wound.join() === '20,40,60,60', `wound 20 s a press, a minute at most (${wound.join()})`);
  const rings: Array<{ step: number; left: number; tile: number }> = [];
  let firstSent: number[] | null = null;
  for (let k = 0; k < 75 * STEPS_PER_SECOND; k++) {
    sim.step(0);
    for (const e of sim.events) if (e.type === 'ringing') rings.push({ step: st.step, left: e.left, tile: e.tile });
    const r = noiseOf(sim.events, 'ring');
    if (r && !firstSent) firstSent = r.sent;
  }
  const first = rings[0];
  check(!!first && first.step - woundAt > 59 * STEPS_PER_SECOND && first.step - woundAt <= 60 * STEPS_PER_SECOND, `it rings a minute later (${first ? (first.step - woundAt) / STEPS_PER_SECOND : '-'} s)`);
  check(rings.length === 8 && rings.every((r, k) => r.left === 8 - k && r.step - first.step === k * STEPS_PER_SECOND && r.tile === tileOf(30, 22)), 'once a second for 8 s, where it is (in hand)');
  check(usesOf(st.items.inv[0]) === 0 && itemOf(st.items.inv[0]) === ALARM_CLOCK, 'then it stops');
  check(firstSent?.join() === '1', 'the guard within earshot comes');
  // In a desk: it rings there. A press while it rings stops it.
  const s2 = new Sim(CENTER_PERKS, 9);
  away(s2);
  const desk = containersOf(s2.world).findIndex((c) => c.prop.kind === 'desk');
  const prop = containersOf(s2.world)[desk].prop;
  s2.state.items.containers[desk][0] = slot(ALARM_CLOCK, 1);
  const ev = run(s2, STEPS_PER_SECOND);
  const inDesk = ev.find((e) => e.type === 'ringing');
  check(inDesk?.type === 'ringing' && inDesk.tile === prop.z * MAP_W + prop.x && inDesk.layer === LAYER.GROUND, 'wound in a desk, it rings at the desk');
  stand(s2, 30, 22);
  s2.state.items.inv[0] = slot(ALARM_CLOCK, WIND_MAX + 5);
  s2.state.items.hand = 0;
  s2.step(command(0, OP.USE, 1));
  const stop = s2.events.find((e) => e.type === 'wound');
  check(stop?.type === 'wound' && stop.secs === 0 && usesOf(s2.state.items.inv[0]) === 0, 'a press while it rings stops it');
  console.log(`alarm clock: wound ${wound.join(' ')}; rang ${rings.length} times from ${first ? (first.step - woundAt) / STEPS_PER_SECOND : '-'} s; in a desk at ${xz(prop.z * MAP_W + prop.x)}`);
}

// ------------------------------------------------------------------ over the detector arch
{
  // The canteen arch at 43–44, 20: thrown over it, the nail file never meets the scanner.
  const sim = new Sim(CENTER_PERKS, 10);
  const st = sim.state;
  away(sim);
  stand(sim, 44, 22, NORTH);
  carry(sim, 'nail_file');
  const over = [[0, -4], [0, -3], [-1, -4], [1, -4], [0, -5], [-1, -3]].find(([dx, dz]) => aimToss(sim, dx, dz).why === null);
  check(!!over, 'somewhere to throw it beyond the arch');
  if (over) sim.step(toss(sim, over[0], over[1]));
  const ev = run(sim, 60, command(NORTH));
  const lies = st.items.ground.find(([, v]) => itemOf(v) === n('nail_file'));
  check(!ev.some((e) => e.type === 'scanned' && e.tripped) && st.heat === 0 && Math.floor(st.player.z / UNIT) < 20, 'walked through clean: nothing tripped');
  check(!!lies && Math.floor(lies[0] / MAP_W) < 20, 'and the file lies beyond the arch');
  console.log(`arch: thrown over to ${lies ? xz(lies[0]) : '-'}, through clean`);
}

// ------------------------------------------------------------------ the ear on the tool button
{
  let seed = 12345;
  const rnd = (k: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % k;
  };
  let agree = 0;
  let heard = 0;
  const trials = 60;
  for (let k = 0; k < trials; k++) {
    const sim = new Sim(CENTER_PERKS, 12);
    const st = sim.state;
    away(sim);
    stand(sim, 8, 23, SOUTH);
    carry(sim, ['plastic_fork', 'flimsy_pickaxe', 'sturdy_pickaxe'][k % 3]);
    post(st.guards[0], 3 + rnd(20), 20 + rnd(10));
    post(st.guards[1], 3 + rnd(20), 20 + rnd(10));
    const held = itemOf(st.items.inv[0]);
    const ui = wouldHear(sim, strikeNoise(st.layer, toolTarget(sim.world, st.layer, st.player, held, [], st.items.inv), held));
    sim.step(command(0, OP.USE, 1));
    const e = noiseOf(sim.events, 'strike');
    const real = !!e && e.heard.length > 0;
    if (ui === real && !!e) agree++;
    if (real) heard++;
  }
  check(agree === trials, `the ear says a guard would hear exactly when the strike is heard (${agree}/${trials})`);
  console.log(`ear badge: ${agree}/${trials} agree with the sim (${heard} heard)`);
}
