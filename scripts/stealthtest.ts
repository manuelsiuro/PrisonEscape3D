/**
 * Fights, stealth and heat (2.35, the user's picks; `Sim.rules234` for older logs), in all five prisons:
 * - noticing: a guard who sees the player somewhere staff only takes a moment to be sure (sooner close up);
 *   out of its sight before then, no heat, and it comes to look where it last saw them; a guard hit knows at
 *   once; under the old rules, sure at once;
 * - the dark: at night a guard sees the player 4 tiles off, further only along lit tiles (a lamp's pool, a
 *   room with its lights on, none in a power cut); the cones' rays cut where the rule does;
 * - lying low: heat cools twice as fast where the routine wants the player, in a guard's sight too;
 * - the block: half the damage, half the pace; an inmate's blow locks on to them, a guard's doesn't.
 */
import { PRISONS } from '../src/content/prisons';
import { CELL_BLOCK, OPEN_AIR, RESTRICTED, ZONES, type ZoneId } from '../src/content/zones';
import { TILE_INFO } from '../src/sim/world/tiles';
import { darkReach, lampHead, litTile, seesInDark, type Dark } from '../src/sim/ai/light';
import { canSee, lineOfSight, sightReach } from '../src/sim/ai/sight';
import { command, EXT, OP } from '../src/sim/command';
import { Sim } from '../src/sim/Sim';
import { quietCalendar } from '../src/sim/systems/calendar';
import { blocking, hurt } from '../src/sim/systems/fights';
import { awake, GUARD, type Guard } from '../src/sim/systems/guards';
import { genFor } from '../src/sim/systems/power';
import { darkNow, lyingLow, noticeSteps } from '../src/sim/systems/stealth';
import { DARK_SIGHT, HEAT_DECAY_STEPS, LOW_COOL, START_MINUTE, STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { MAP_H, MAP_W, type World } from '../src/sim/world/World';
import { clockTo } from '../src/tutorial/kit';
import { check } from './assert';

/** The step at a minute of day 1 (from 08:00). */
const at = (minute: number) => (minute - START_MINUTE) * STEPS_PER_MINUTE;
const FREE_TIME = at(10 * 60 + 30);
const LATE = at(23 * 60 + 40);
const BREAKFAST = at(9 * 60 + 2);
/** East, south, west, north: a step on the map and the compass point facing it (1 east … 13 north). */
const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [0, 1, 5],
  [-1, 0, 9],
  [0, -1, 13],
];

function fresh(prison: (typeof PRISONS)[number], step: number, seed = 5, keep = 0): Sim {
  const sim = new Sim(prison, seed);
  sim.state.calendar = quietCalendar();
  // (The clock moved on with the block attended, as the lessons do: no roll call missed on the way.)
  clockTo(sim, step);
  // Every guard but the first out of the way (out cold for the test's length), the first on the spot.
  sim.state.guards.forEach((g, k) => {
    if (k !== keep) g.ko = 1_000_000;
  });
  // (And the cameras blinded: theirs is another rule, at once as ever.)
  sim.state.cams = sim.state.cams.map(() => 1_000_000);
  return sim;
}
const put = (b: { x: number; z: number }, x: number, z: number) => {
  b.x = x * UNIT + UNIT / 2;
  b.z = z * UNIT + UNIT / 2;
};
function plant(g: Guard, x: number, z: number, facing: number) {
  put(g.body, x, z);
  g.body.facing = g.face = facing;
  g.path = [];
  g.goal = -1;
  g.wait = 100000;
  g.mode = GUARD.DUTY;
  g.doing = 0;
  g.notice = 0;
}
const zoneAt = (w: World, i: number) => ZONES[w.ground.zone[i]] as ZoneId;
const free = (w: World, x: number, z: number) => x > 0 && z > 0 && x < MAP_W - 1 && z < MAP_H - 1 && !w.blocked(x, z);

/** A restricted tile and a spot `d` tiles off in a straight line that sees it (the guard's), or null. */
function staffSpot(w: World, d: number): { t: [number, number]; s: [number, number]; face: number } | null {
  for (let z = 1; z < MAP_H - 1; z++)
    for (let x = 1; x < MAP_W - 1; x++) {
      // (Not the minefield: the test is the guard's eye, not a mine.)
      const zone = zoneAt(w, z * MAP_W + x);
      if (!RESTRICTED.includes(zone) || zone === 'minefield' || !free(w, x, z)) continue;
      for (const [dx, dz, face] of DIRS) {
        const sx = x - dx * d;
        const sz = z - dz * d;
        // (The guard where nothing it stands on is staff only either: the test is the player's room.)
        if (!free(w, sx, sz)) continue;
        if (!lineOfSight(w, sx * UNIT + UNIT / 2, sz * UNIT + UNIT / 2, x * UNIT + UNIT / 2, z * UNIT + UNIT / 2)) continue;
        // Somewhere out of its sight behind it, to slip off to.
        const bx = sx - dx * 2;
        const bz = sz - dz * 2;
        if (!free(w, bx, bz)) continue;
        return { t: [x, z], s: [sx, sz], face };
      }
    }
  return null;
}

/** Steps until a 'spotted' for the reason (0: never within `max`). */
function stepsTo(sim: Sim, reason: string, max: number): number {
  for (let k = 1; k <= max; k++) {
    sim.step(0);
    if (sim.events.some((e) => e.type === 'spotted' && e.reason === reason)) return k;
  }
  return 0;
}

const report: string[] = [];

// ------------------------------------------------------------------ noticing
for (const prison of PRISONS) {
  const row: string[] = [];
  for (const d of [2, 6]) {
    const spot = staffSpot(new Sim(prison, 5).world, d);
    if (!spot) {
      row.push(`${d} tiles: no spot`);
      continue;
    }
    const sim = fresh(prison, FREE_TIME);
    const g = sim.state.guards[0];
    plant(g, ...spot.s, spot.face);
    put(sim.state.player, ...spot.t);
    const need = noticeSteps(sim, g);
    const n = stepsTo(sim, 'restricted', 60);
    check(n > 1, `${prison.id}: seen ${d} tiles off somewhere staff only, sure at once (${n})`);
    check(n >= need - 1 && n <= need + 2, `${prison.id}: ${d} tiles off, sure in ${n} steps (${need} to be sure)`);
    check(sim.state.lockdown && sim.state.heat === 100, `${prison.id}: once sure, the lockdown as before`);
    row.push(`${d} tiles ${(n / 20).toFixed(2)} s`);
    // Gone before it's sure: no heat, and it comes to look where it last saw the player.
    if (d === 6) {
      const s2 = fresh(prison, FREE_TIME);
      const g2 = s2.state.guards[0];
      plant(g2, ...spot.s, spot.face);
      put(s2.state.player, ...spot.t);
      for (let k = 0; k < 8; k++) s2.step(0);
      check((g2.notice ?? 0) > 0 && s2.state.heat === 0, `${prison.id}: the "?" filling, no heat yet (${g2.notice}, ${s2.state.heat}%)`);
      const [dx, dz] = DIRS.find((x) => x[2] === spot.face)!;
      put(s2.state.player, spot.s[0] - dx * 2, spot.s[1] - dz * 2);
      s2.step(0);
      check(
        s2.state.heat === 0 && g2.mode === GUARD.INVESTIGATE && g2.target === spot.t[1] * MAP_W + spot.t[0] && !g2.notice,
        `${prison.id}: out of sight first: no heat, it goes to look where it saw them (mode ${g2.mode}, ${s2.state.heat}%)`,
      );
      // A guard bribed to look the other way lets a staff room pass: nothing fills, nothing's said.
      const paid = fresh(prison, FREE_TIME);
      const g3 = paid.state.guards[0];
      plant(g3, ...spot.s, spot.face);
      g3.bribed = paid.state.step + 100_000;
      put(paid.state.player, ...spot.t);
      check(stepsTo(paid, 'restricted', 60) === 0 && !g3.notice, `${prison.id}: a bribed guard lets a staff room pass`);
      // Hidden away (the delivery's vehicle) while it fills: the "?" empties.
      const hid = fresh(prison, FREE_TIME);
      const g4 = hid.state.guards[0];
      plant(g4, ...spot.s, spot.face);
      put(hid.state.player, ...spot.t);
      for (let k = 0; k < 8; k++) hid.step(0);
      hid.state.stowed = true;
      hid.step(0);
      check(!g4.notice, `${prison.id}: hidden, the "?" empties (${g4.notice})`);
      // Under the old rules: sure at once.
      const old = fresh(prison, FREE_TIME);
      old.rules234 = true;
      plant(old.state.guards[0], ...spot.s, spot.face);
      put(old.state.player, ...spot.t);
      check(stepsTo(old, 'restricted', 5) === 1, `${prison.id}: an old run's guard is sure at once`);
    }
  }
  report.push(`${prison.id}: noticing ${row.join(', ')}`);
}

// A guard hit knows at once who it was.
{
  const prison = PRISONS[0];
  const sim = fresh(prison, FREE_TIME);
  const g = sim.state.guards[0];
  const spot = staffSpot(sim.world, 2)!;
  plant(g, ...spot.s, (spot.face + 8) % 16 || 16);
  // The player at its elbow, behind it (where it doesn't see), in the open.
  const [dx, dz] = DIRS.find((x) => x[2] === spot.face)!;
  put(sim.state.player, spot.s[0] - dx, spot.s[1] - dz);
  sim.state.lock = sim.state.inmates.length;
  let steps = 0;
  sim.step(command(0, OP.USE, 1));
  for (; steps < 3 && !sim.state.lockdown; steps++) sim.step(0);
  check(sim.state.lockdown, `a guard hit from behind knows who it was: the alarm (${steps} steps after)`);
  report.push(`a guard hit: the alarm ${steps ? `${steps} steps after the blow` : 'with the blow'}`);
}

// ------------------------------------------------------------------ the dark
/** An open-air tile and a guard's spot `d` off in a line, every tile between dark (or lit, as asked), in sight. */
function darkPair(sim: Sim, dark: Dark, d: number, lit: boolean): { t: [number, number]; s: [number, number]; face: number } | null {
  const w = sim.world;
  for (let z = 1; z < MAP_H - 1; z++)
    for (let x = 1; x < MAP_W - 1; x++) {
      const i = z * MAP_W + x;
      if (!OPEN_AIR.has(zoneAt(w, i)) || zoneAt(w, i) === 'outside' || !free(w, x, z)) continue;
      for (const [dx, dz, face] of DIRS) {
        const sx = x - dx * d;
        const sz = z - dz * d;
        if (!free(w, sx, sz)) continue;
        // (Open ground all the way: no door between, which the night would shut.)
        let open = true;
        for (let k = 0; k <= d; k++) {
          const j = (sz + dz * k) * MAP_W + sx + dx * k;
          if (!OPEN_AIR.has(zoneAt(w, j)) || zoneAt(w, j) === 'none') open = false;
        }
        if (!open) continue;
        const ax = sx * UNIT + UNIT / 2;
        const az = sz * UNIT + UNIT / 2;
        const bx = x * UNIT + UNIT / 2;
        const bz = z * UNIT + UNIT / 2;
        if (!canSee(w, { x: ax, z: az, facing: face, moving: false }, { x: bx, z: bz })) continue;
        if (seesInDark(w, dark, ax, az, bx, bz) !== lit) continue;
        // (Nearer, 3 tiles: in sight too.)
        if (!free(w, sx + dx * 3, sz + dz * 3)) continue;
        return { t: [x, z], s: [sx, sz], face };
      }
    }
  return null;
}

let rays = 0;
let disagree = 0;
/** A guard on the night round at 23:40 (the others are in bed). */
function nightGuard(prison: (typeof PRISONS)[number]): number {
  const sim = fresh(prison, LATE, 5, -1);
  sim.state.guards.forEach((g) => (g.ko = 0));
  for (let k = 0; k < 40; k++) sim.step(0);
  return sim.state.guards.findIndex((g) => awake(g) && g.mode === GUARD.DUTY);
}

for (const prison of PRISONS) {
  const night = nightGuard(prison);
  check(night >= 0, `${prison.id}: a guard on the night round`);
  const sim = fresh(prison, LATE, 5, night);
  const dark = darkNow(sim);
  check(!!dark && dark.blockDark, `${prison.id}: 23:40 is dark, the cell block's lights out (${JSON.stringify(dark)})`);
  if (!dark) continue;
  const w = sim.world;
  // What's lit: every room with lights, the lamps' pools; none of it in a power cut.
  let lamp = 0;
  let room = 0;
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    const x = i % MAP_W;
    const z = Math.floor(i / MAP_W);
    if (w.blocked(x, z)) continue;
    if (!litTile(w, dark, x, z)) continue;
    if (OPEN_AIR.has(zoneAt(w, i))) lamp++;
    else room++;
    check(!litTile(w, { power: false, blockDark: true }, x, z), `${prison.id}: ${x},${z} lit in a power cut`);
  }
  check(lamp > 0 && room > 0, `${prison.id}: lit at night: ${lamp} tiles under lamps, ${room} in rooms`);
  const row = [`${lamp} tiles lit by lamps, ${room} in rooms`];
  // 2.36 (session 14): a lamp lights only what its head sees. Checked against a line of its own (floats, a
  // thirty-second of a tile): every tile lit by a lamp is seen clear by one in reach; a cell behind a wall
  // from every lamp in reach is dark after Lights Out, and was lit under the old rules (Sim.rules235).
  check(dark.walls === true, `${prison.id}: today's runs stop lamps at walls`);
  const old: Dark = { ...dark, walls: false };
  const lampsNear = (x: number, z: number) =>
    w.props
      .filter((p) => p.kind === 'lamp')
      .map((p) => lampHead(p).map((v) => v / 100))
      .filter(([hx, hz]) => (x + 0.5 - hx) ** 2 + (z + 0.5 - hz) ** 2 <= 2.5 * 2.5);
  const clear = ([hx, hz]: number[], x: number, z: number) => {
    for (let k = 1; k < 128; k++) {
      const sx = Math.floor(hx + ((x + 0.5 - hx) * k) / 128);
      const sz = Math.floor(hz + ((z + 0.5 - hz) * k) / 128);
      if ((sx !== x || sz !== z) && TILE_INFO[w.ground.base[sz * MAP_W + sx]].opaque) return false;
    }
    return true;
  };
  let walledCells = 0;
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    const x = i % MAP_W;
    const z = Math.floor(i / MAP_W);
    if (TILE_INFO[w.ground.base[i]].opaque) continue;
    const near = lampsNear(x, z);
    if (!near.length) continue;
    const seen = near.some((h) => clear(h, x, z));
    if (OPEN_AIR.has(zoneAt(w, i)))
      check(litTile(w, dark, x, z) === seen, `${prison.id}: ${x},${z} outdoors lit ${litTile(w, dark, x, z)}, a lamp sees it ${seen}`);
    if (!CELL_BLOCK.has(zoneAt(w, i)) || seen) continue;
    walledCells++;
    check(!litTile(w, dark, x, z), `${prison.id}: cell tile ${x},${z} lit through a wall after Lights Out`);
    check(litTile(w, old, x, z), `${prison.id}: cell tile ${x},${z} not lit under the old rules`);
  }
  const was = fresh(prison, LATE, 5, night);
  was.rules235 = true;
  check(darkNow(was)?.walls === false, `${prison.id}: older runs' lamps light through walls`);
  row.push(`${walledCells} cell tiles behind a wall from the lamps, dark`);
  // Out in the dark 6 tiles off: unseen; 3 tiles: seen.
  const g = sim.state.guards[night];
  const pair = darkPair(sim, dark, 6, false);
  check(!!pair, `${prison.id}: somewhere dark 6 tiles from a guard`);
  if (pair) {
    plant(g, ...pair.s, pair.face);
    put(sim.state.player, ...pair.t);
    sim.step(0);
    sim.step(0);
    check(awake(g) && !g.sees, `${prison.id}: in the dark 6 tiles off, unseen (awake: ${awake(g)})`);
    const [dx, dz] = DIRS.find((x) => x[2] === pair.face)!;
    plant(g, ...pair.s, pair.face);
    put(sim.state.player, pair.s[0] + dx * 3, pair.s[1] + dz * 3);
    sim.step(0);
    sim.step(0);
    check(g.sees, `${prison.id}: in the dark 3 tiles off, seen`);
    // Under the old rules, 6 tiles off is seen.
    const old = fresh(prison, LATE, 5, night);
    old.rules234 = true;
    plant(old.state.guards[night], ...pair.s, pair.face);
    put(old.state.player, ...pair.t);
    old.step(0);
    old.step(0);
    check(old.state.guards[night].sees, `${prison.id}: an old run's guard sees 6 tiles off in the dark`);
  }
  // Under a lamp 6 tiles off: seen.
  const litPair = darkPair(sim, dark, 6, true);
  if (litPair) {
    const s2 = fresh(prison, LATE, 5, night);
    plant(s2.state.guards[night], ...litPair.s, litPair.face);
    put(s2.state.player, ...litPair.t);
    s2.step(0);
    s2.step(0);
    check(s2.state.guards[night].sees, `${prison.id}: lit all the way 6 tiles off, seen`);
    row.push('seen 6 tiles off along a lamp');
  } else row.push('no lamp 6 tiles from a guard');
  // A power cut: the lamps' pools and the rooms dark.
  const gen = genFor(w, 'lights');
  check(gen === 0 || gen === 1, `${prison.id}: the lights on a generator`);
  // The cones' rays and the rule: a target short of the ray's reach is seen, one past it isn't.
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let k = 0; k < 400; k++) {
    const x = 2 + Math.floor(rnd() * (MAP_W - 4));
    const z = 2 + Math.floor(rnd() * (MAP_H - 4));
    if (w.blocked(x, z)) continue;
    const gx = x + 0.5;
    const gz = z + 0.5;
    const a = rnd() * Math.PI * 2;
    const wall = sightReach(w, gx, gz, a, 7);
    const reach = darkReach(w, dark, gx, gz, a, wall);
    // (Points off the quarter-tile samples: a point on one is a tie between floats and the rule's whole units.)
    for (let t = 0.31; t < wall - 0.05; t += 0.37) {
      rays++;
      const seen = seesInDark(
        w,
        dark,
        gx * UNIT,
        gz * UNIT,
        Math.round((gx + Math.cos(a) * t) * UNIT),
        Math.round((gz + Math.sin(a) * t) * UNIT),
      );
      // (Within DARK_SIGHT, its edge included, always seen; beyond, short of where the ray stops.)
      if (seen !== (t <= DARK_SIGHT || t < reach)) disagree++;
    }
  }
  report.push(`${prison.id}: at night ${row.join('; ')}`);
}
check(disagree / rays < 0.005, `the cones and the rule disagree on ${disagree} of ${rays} points`);
report.push(
  `the cones' rays and the rule: ${disagree < rays * 0.005 ? 'agree' : 'disagree'} (${rays > 10000 ? 'over 10,000' : rays} points along rays)`,
);

// ------------------------------------------------------------------ lying low
for (const prison of PRISONS) {
  const sim = fresh(prison, BREAKFAST);
  const w = sim.world;
  const s = sim.state;
  // In the canteen at breakfast, a guard looking on: twice as fast.
  let inCanteen = -1;
  let outside = -1;
  for (let i = 0; i < MAP_W * MAP_H && (inCanteen < 0 || outside < 0); i++) {
    const x = i % MAP_W;
    const z = Math.floor(i / MAP_W);
    if (w.blocked(x, z)) continue;
    if (inCanteen < 0 && zoneAt(w, i) === 'canteen') inCanteen = i;
    if (outside < 0 && zoneAt(w, i) === 'yard') outside = i;
  }
  if (inCanteen < 0) continue;
  put(s.player, inCanteen % MAP_W, Math.floor(inCanteen / MAP_W));
  s.heat = 40;
  check(lyingLow(sim), `${prison.id}: in the canteen at breakfast, lying low`);
  const g = s.guards[0];
  g.ko = 0;
  plant(g, inCanteen % MAP_W, Math.floor(inCanteen / MAP_W) + 1, 13);
  const minutes = 10;
  for (let k = 0; k < minutes * STEPS_PER_MINUTE; k++) {
    sim.step(0);
    g.body.facing = g.face = 13;
  }
  const low = 40 - s.heat;
  const want = Math.floor((minutes * STEPS_PER_MINUTE) / Math.floor(HEAT_DECAY_STEPS / LOW_COOL));
  check(Math.abs(low - want) <= 1, `${prison.id}: lying low, ${low}% off in ${minutes} minutes (${want} wanted)`);
  // In the yard at breakfast, unseen: the usual pace.
  let off = -1;
  if (outside >= 0) {
    const s2 = fresh(prison, BREAKFAST);
    put(s2.state.player, outside % MAP_W, Math.floor(outside / MAP_W));
    s2.state.heat = 40;
    check(!lyingLow(s2), `${prison.id}: in the yard at breakfast, not lying low`);
    for (let k = 0; k < minutes * STEPS_PER_MINUTE; k++) s2.step(0);
    off = 40 - s2.state.heat;
  }
  // Old rules: never.
  const old = fresh(prison, BREAKFAST);
  old.rules234 = true;
  put(old.state.player, inCanteen % MAP_W, Math.floor(inCanteen / MAP_W));
  old.state.heat = 40;
  check(!lyingLow(old), `${prison.id}: an old run never lies low`);
  report.push(
    `${prison.id}: in ${minutes} minutes heat falls ${low}% at breakfast in the canteen in a guard's sight, ${off}% in the yard unseen`,
  );
}

// ------------------------------------------------------------------ the block, the lock on an inmate who struck
{
  const sim = fresh(PRISONS[0], FREE_TIME);
  const s = sim.state;
  const hp = s.health;
  hurt(sim, 20, 0);
  const plain = hp - s.health;
  check(s.lock === 0, `an inmate's blow locks on to them (${s.lock})`);
  s.lock = -1;
  hurt(sim, 1, s.inmates.length);
  check(s.lock === -1, `a guard's blow locks on to nobody (${s.lock})`);
  sim.step(command(0, OP.EXT, EXT.BLOCK));
  check(blocking(sim), 'the block held');
  // (Held, it changes no item: the hotbar isn't redrawn every step.)
  const rev = s.items.rev;
  for (let k = 0; k < 10; k++) sim.step(command(0, OP.EXT, EXT.BLOCK));
  check(s.items.rev === rev, `the block held redraws no item (rev ${rev} → ${s.items.rev})`);
  const before = s.health;
  hurt(sim, 20, 0);
  const held = before - s.health;
  check(plain === 20 && held === 10, `a blow of 20 blocked does ${held} (${plain} not)`);
  // Half the pace while it's held: in the open yard, a step's way east, then with the block held.
  const w = sim.world;
  let open = -1;
  for (let i = 0; i < MAP_W * MAP_H && open < 0; i++) {
    const x = i % MAP_W;
    const z = Math.floor(i / MAP_W);
    if (zoneAt(w, i) === 'yard' && [0, 1, 2, 3, 4].every((k) => free(w, x + k, z) && free(w, x + k, z - 1) && free(w, x + k, z + 1)))
      open = i;
  }
  put(s.player, open % MAP_W, Math.floor(open / MAP_W));
  s.blockAt = -1000;
  const x0 = s.player.x;
  sim.step(command(1));
  const walked = s.player.x - x0;
  sim.step(command(1, OP.EXT, EXT.BLOCK));
  const x1 = s.player.x;
  sim.step(command(1, OP.EXT, EXT.BLOCK));
  const guarded = s.player.x - x1;
  check(walked > 0 && Math.abs(guarded * 2 - walked) <= 2, `blocking, ${guarded} units a step (${walked} walking)`);
  // Under the old rules: no block, no lock.
  const old = fresh(PRISONS[0], FREE_TIME);
  old.rules234 = true;
  old.step(command(0, OP.EXT, EXT.BLOCK));
  const h0 = old.state.health;
  hurt(old, 20, 0);
  check(!blocking(old) && h0 - old.state.health === 20 && old.state.lock === -1, 'an old run: no block, no lock by a blow');
  report.push(
    `the block: a blow of 20 does ${held}, ${Math.round((guarded / walked) * 100)}% of the walk; an inmate's blow locks on, a guard's doesn't`,
  );
}

// ------------------------------------------------------------------ saves
{
  const sim = fresh(PRISONS[0], FREE_TIME);
  const st = JSON.parse(JSON.stringify(sim.state));
  delete st.blockAt;
  for (const g of st.guards) {
    delete g.notice;
    delete g.noticeNeed;
  }
  const back = new Sim(PRISONS[0], 5);
  back.restore({ v: 1, prison: PRISONS[0].id, state: st });
  check(back.state.blockAt === -1000 && !blocking(back), 'a save from before the block loads with none held');
}

for (const line of report) console.log(line);
console.log(`dark sight ${DARK_SIGHT} tiles; noticing ${'0.30'}–${'1.50'} s; lying low ×${LOW_COOL}`);
