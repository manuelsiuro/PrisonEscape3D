/**
 * City Escape's nights (2.68, C5 batch 3, city/sim/rush.ts and the traps in city/sim/dead.ts): the Rush every third night in a city
 * begun from 2.68 (none in one begun before), no sleep from 20:00, its four waves in twelve cities, each one finding the player, held
 * at 05:00 with supplies dropped beside them (better each Rush); its dead pounding through walls and boards, not shy of a light, half
 * the last wave following across a checkpoint; each trap by real commands (spikes, barbed wire, a snare, tin cans, a scarecrow, a
 * sentry crossbow loaded, shooting, taken down for its crossbow and bolts); a base left taking the nights (a Rush's three times,
 * nothing enclosed touched); a sleeper in a walled base found through the walls; a save keeping it all, a damaged one made sound.
 */
import { check } from './assert';
import { BUILD, PIECE, PIECES } from '../src/city/content/build';
import { cityItemNumber } from '../src/city/content/items';
import { RUSH, SUPPLIES, TRAP } from '../src/city/content/rush';
import { LIGHT_KIND } from '../src/city/content/light';
import { canBuild } from '../src/city/sim/build';
import { City, COP, FULL, loadCity, PIECE_OPS, START_MINUTE, type CityEvent } from '../src/city/sim/City';
import { ZED, type Zed } from '../src/city/sim/dead';
import { isRush, noSleep, waveSize } from '../src/city/sim/rush';
import { ZKIND } from '../src/city/content/dead';
import { nearestDir } from '../src/sim/ai/path';
import { command } from '../src/sim/command';
import { bodyAt } from '../src/sim/systems/movement';
import { STEPS_PER_MINUTE } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/grid';

const lines: string[] = [];
const say = (s: string) => lines.push(s);
const W = MAP_W;
const N = W * W;
const I = cityItemNumber;
const HAMMER = I('hammer');
const around = (t: number) => [t - W, t + 1, t + W, t - 1].filter((i) => i >= 0 && i < N && Math.abs((i % W) - (t % W)) <= 1);
const ring8 = (t: number) => [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1].map((d) => t + d);
const cheb = (a: number, b: number) => Math.max(Math.abs((a % W) - (b % W)), Math.abs(Math.floor(a / W) - Math.floor(b / W)));
const priv = (c: City) => c as unknown as { enter(d: number): void; cross(g: unknown): void; sleep(): void };
const stand = (c: City, tile: number, toward: number) => {
  c.state.zeds = [];
  c.state.player = bodyAt(
    tile % W,
    Math.floor(tile / W),
    nearestDir((toward % W) - (tile % W), Math.floor(toward / W) - Math.floor(tile / W)),
  );
  c.step(0);
};
/** Plenty of everything, and a hammer. */
const stock = (c: City, more: Array<[number, number]> = []) => {
  c.state.inv = c.state.inv.map(() => [0, 0]);
  [[HAMMER, 1], [I('plank'), 99], [I('nails'), 99], [I('scrap'), 99], [I('cloth'), 99], [I('wire'), 99], ...more].forEach(
    ([it, n], k) => (c.state.inv[k] = [it, n]),
  );
};
/** A piece put up on a tile from a free tile beside it (not one of `but`): the steps it took, or -1 refused. */
function buildAt(c: City, kind: number, tile: number, but: ReadonlySet<number> = new Set()): number {
  const from = around(tile).find((i) => !c.grid[i] && !c.zedGrid[i] && !but.has(i) && !c.pieceAt[i] && !c.carAt[i]);
  if (from === undefined) return -1;
  stand(c, from, tile);
  c.step(command(0, COP.BUILD, kind));
  if (c.events.some((e) => e.type === 'cantBuild')) return -1;
  let steps = 1;
  for (; steps < 400 && c.state.search; steps++) c.step(0);
  return c.pieceAt[tile] === kind + 1 ? steps - 1 : -1;
}
/** An open square (5 × 5) in the district, every tile buildable. */
function openSquare(c: City, from = 0): number {
  stock(c);
  for (let z = 4; z < W - 4; z++)
    for (let x = 4; x < W - 4; x++) {
      const mid = z * W + x;
      if (mid < from) continue;
      let ok = true;
      for (let dz = -2; dz <= 2 && ok; dz++)
        for (let dx = -2; dx <= 2 && ok; dx++) {
          const t = mid + dz * W + dx;
          if (c.grid[t] || c.zedGrid[t] || c.carAt[t] || c.pieceAt[t]) ok = false;
          else if (canBuild(c, PIECE.barricade, t) !== 'ok' && t !== c.tile) ok = false;
        }
      if (ok) return mid;
    }
  return -1;
}
/** A tile out of the dead's sight from `from` (twelve tiles or more), to stand the player on while a trap is watched. */
const farFrom = (c: City, from: number) => {
  // (Well inside the district: a street's end at its border is a checkpoint, crossed.)
  const gates = c.district.gates.flatMap((g) => g.tiles);
  for (let z = 6; z < W - 6; z++)
    for (let x = 6; x < W - 6; x++) {
      const t = z * W + x;
      if (!c.grid[t] && !c.carAt[t] && !c.pieceAt[t] && cheb(t, from) >= 12 && gates.every((g) => cheb(g, t) > 4)) return t;
    }
  return -1;
};
const away = (c: City, from: number) => {
  const t = farFrom(c, from);
  c.state.player = bodyAt(t % W, Math.floor(t / W));
};
const city = (seed: number) => {
  const c = new City(seed);
  c.peace = true;
  c.step(0);
  return c;
};
/** The city's clock set to a day and minute: the step before it, so the next step is that minute's turn. */
const at = (c: City, day: number, minute: number) => {
  c.state.step = ((day - 1) * 1440 + minute - START_MINUTE) * STEPS_PER_MINUTE - 1;
};
const zed = (c: City, tile: number, mode: number = ZED.CHASE, kind?: number): Zed => {
  const z: Zed = {
    body: bodyAt(tile % W, Math.floor(tile / W)),
    hp: kind === ZKIND.BRUTE ? 90 : 30,
    mode,
    goal: -1,
    path: [],
    seen: c.state.step,
    last: c.tile,
    bit: -9999,
    reel: 0,
    near: 0,
    pace: 1000,
    ...(kind !== undefined ? { kind } : {}),
  };
  c.state.zeds.push(z);
  return z;
};
/** Steps run, the meters kept up (only what's measured hurts), the events gathered. */
const run = (c: City, steps: number, keep = true): CityEvent[] => {
  const out: CityEvent[] = [];
  for (let k = 0; k < steps && !c.state.over; k++) {
    if (keep) {
      c.state.hunger = FULL;
      c.state.energy = FULL;
      c.state.health = 100;
      c.state.bleed = 0;
    }
    c.step(0);
    out.push(...c.events);
  }
  return out;
};
const rushes = (evs: CityEvent[]) => evs.filter((e): e is Extract<CityEvent, { type: 'rush' }> => e.type === 'rush');

// ------------------------------------------------------------------ when
{
  const c = city(1);
  const nights = Array.from({ length: 12 }, (_, k) => k + 1).filter((n) => isRush(c, n));
  check(nights.join() === '3,6,9,12', `the Rush every third night from the third (${nights})`);
  c.state.rev = 3;
  check(![3, 6, 9].some((n) => isRush(c, n)), 'a city begun before 2.68 has no Rush');
  c.state.rev = RUSH.rev;
  const asleep = (day: number, minute: number) => {
    at(c, day, minute);
    c.step(0);
    c.state.sleeping = false;
    c.state.hunger = FULL;
    priv(c).sleep();
    const ok = c.state.sleeping;
    c.state.sleeping = false;
    return ok;
  };
  const table = [
    [2, 20 * 60 + 30, true],
    [3, 18 * 60, true],
    [3, 20 * 60 + 1, false],
    [3, 23 * 60, false],
    [4, 4 * 60 + 30, false],
    [4, 5 * 60 + 1, true],
    [6, 21 * 60 + 30, false],
  ] as const;
  const wrong = table.filter(([d, m, ok]) => asleep(d, m) !== ok);
  check(!wrong.length, `sleep refused on the Rush's night only (wrong at ${wrong.map(([d, m]) => `${d} ${m}`)})`);
  at(c, 3, 21 * 60);
  c.step(0);
  check(noSleep(c), 'no sleep at 21:00 on the third night');
  say(
    `the Rush on nights ${nights}, none in a city begun before 2.68; sleep refused from 20:00 on a Rush's day to 05:00 (${table.length} times checked)`,
  );
}

// ------------------------------------------------------------------ a Rush night, twelve cities
{
  const out: string[] = [];
  let found = 0;
  let held = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const c = city(seed);
    c.peace = false;
    at(c, 3, 5 * 60 + 55);
    c.state.zeds = [];
    c.state.arrive = 1;
    const evs = run(c, (23 * 60 + 10) * STEPS_PER_MINUTE);
    const r = rushes(evs);
    const waves = r.filter((e) => e.what === 'wave').map((e) => e.size);
    const warned = r.filter((e) => e.what === 'warn').length;
    const bites = evs.filter((e) => e.type === 'bite').length;
    if (bites) found++;
    const h = r.find((e) => e.what === 'held');
    const pile = h ? (c.state.boxes[`${c.state.district}:g${h.tile}`] ?? []).filter((st) => st[0]) : [];
    const want = SUPPLIES[0].every(([id, n]) => pile.some((st) => st[0] === I(id) && st[1] >= n));
    if (h && want && c.state.held === 1) held++;
    out.push(`${seed}:${waves.join('+')}${warned === 2 ? '' : ` warned ${warned}`}${bites ? '' : ' unfound'}`);
    check(waves.length === 4, `four waves in city ${seed} (${waves})`);
    check(warned === 2, `said at dawn and before dusk in city ${seed} (${warned})`);
  }
  check(found === 12, `the Rush finds the player in every city (${found} of 12)`);
  check(held === 12, `held: the supplies beside the player in every city (${held} of 12)`);
  say(`a Rush night stood out in the street, 12 cities, the waves: ${out.join(' ')}; found in ${found}, held with supplies in ${held}`);
  // Bigger each Rush, and later supplies better.
  const c = city(3);
  const sizes = [3, 6, 9].map((n) => RUSH.waves.map((_, k) => waveSize(c, n, k)).join('+'));
  check(waveSize(c, 6, 0) > waveSize(c, 3, 0) && waveSize(c, 9, 0) > waveSize(c, 6, 0), `bigger each Rush (${sizes})`);
  const tiers = SUPPLIES.map((t) => t.reduce((n, [, k]) => n + k, 0));
  check(tiers[1] > tiers[0] && tiers[2] > tiers[1], `supplies better each Rush held (${tiers})`);
  say(`the waves of the first three Rushes in the start district: ${sizes.join(', ')}; supplies of ${tiers.join(', ')} things`);
  // Its kinds: a brute in the second and the last wave from the second Rush, a bloater in each from the third.
  c.peace = false;
  at(c, 6, 22 * 60);
  c.state.zeds = [];
  c.state.arrive = 0;
  run(c, 2 * 60 * STEPS_PER_MINUTE + 1);
  const brutes = c.state.zeds.filter((z) => z.rush && z.kind === ZKIND.BRUTE).length;
  at(c, 9, 22 * 60);
  c.state.zeds = [];
  run(c, 1);
  const bloaters = c.state.zeds.filter((z) => z.rush && z.kind === ZKIND.BLOATER).length;
  check(
    brutes === 1 && bloaters === 1,
    `a brute in the second Rush's second wave (${brutes}), a bloater in the third's first (${bloaters})`,
  );
  say("a brute in the second Rush's second wave, a bloater in each of the third's");
  // A city begun before: the third night is a night.
  const old = city(3);
  old.state.rev = 3;
  old.peace = false;
  at(old, 3, 18 * 60);
  old.state.zeds = [];
  old.state.arrive = 1;
  const quiet = rushes(run(old, 12 * 60 * STEPS_PER_MINUTE)).length;
  check(quiet === 0, `no Rush in a city begun before 2.68 (${quiet} events)`);
}

// ------------------------------------------------------------------ through walls and boards, lights, a checkpoint
{
  // Ringed by plank walls: the waves pound through.
  const walled: string[] = [];
  for (const seed of [4, 5, 6]) {
    const c = city(seed);
    const mid = openSquare(c);
    stock(c);
    const ring = new Set(ring8(mid));
    for (const t of ring8(mid)) check(buildAt(c, PIECE.plankWall, t, new Set([mid, ...ring])) > 0, `walls round the player (${seed})`);
    c.state.player = bodyAt(mid % W, Math.floor(mid / W));
    c.peace = false;
    at(c, 3, 21 * 60 + 59);
    c.state.zeds = [];
    c.state.arrive = 0;
    const evs = run(c, 3 * 60 * STEPS_PER_MINUTE);
    const first = evs.findIndex((e) => e.type === 'pound');
    const down = evs.filter((e) => e.type === 'pieceDown').length;
    const bit = evs.some((e) => e.type === 'bite');
    check(
      first >= 0 && down > 0 && bit,
      `the Rush through plank walls in city ${seed} (pounded ${first >= 0}, ${down} down, bitten ${bit})`,
    );
    walled.push(`${seed}: ${down} down`);
  }
  say(`ringed by eight plank walls, the first wave pounds through them (${walled.join(', ')}) and gets to the player`);

  // In a shelter, every door barred: the boards are torn open.
  let breached = 0;
  for (const seed of [4, 5, 6]) {
    const c = city(seed);
    const d = c.state.district;
    const lot = c.district.lots.findIndex((l) => l.doors.length > 0 && l.doors.length <= 2 && l.use === 'house');
    const inside = c.district.lotAt.findIndex((v, i) => v === lot + 1 && !c.grid[i] && cheb(i, c.district.lots[lot].doors[0]) >= 2);
    c.state.bars[d] = [...c.district.lots[lot].doors];
    c.rebar();
    c.state.player = bodyAt(inside % W, Math.floor(inside / W));
    c.peace = false;
    at(c, 3, 21 * 60 + 59);
    c.state.zeds = [];
    c.state.arrive = 0;
    const evs = run(c, 3 * 60 * STEPS_PER_MINUTE);
    if (evs.some((e) => e.type === 'breach')) breached++;
  }
  check(breached === 3, `the Rush tears a shelter's boards open (${breached} of 3)`);
  say(`in a house with every door barred, the boards torn open by the first wave (${breached} of 3)`);

  // A lantern burning by the player: they come anyway.
  {
    const c = city(7);
    c.peace = false;
    at(c, 3, 21 * 60 + 59);
    c.state.zeds = [];
    c.state.arrive = 0;
    c.state.lights[c.state.district] = [[c.tile, LIGHT_KIND.LANTERN, c.state.step + 99999]];
    c.reenter();
    const evs = run(c, 90 * STEPS_PER_MINUTE);
    check(c.lit[c.tile] === 1 && evs.some((e) => e.type === 'bite'), `in a light, found anyway (lit ${c.lit[c.tile]})`);
    say("stood in a lantern's light, found anyway: the Rush is not shy of light");
  }

  // Across a checkpoint late in the night: every one of the Rush's about follows (the review: half the last wave let a crossing
  // shed the night), and again on the way back.
  {
    const c = city(8);
    c.peace = false;
    at(c, 3, 22 * 60);
    c.state.zeds = [];
    c.state.arrive = 0;
    // (The first two waves, nobody put down.)
    run(c, 2 * 60 * STEPS_PER_MINUTE + 5);
    const about = c.state.zeds.filter((z) => z.rush).length;
    const home = c.state.district;
    priv(c).cross(c.district.gates[0]);
    c.state.zeds = [];
    c.state.arrive = 1;
    run(c, 1);
    const came = c.state.zeds.filter((z) => z.rush).length;
    const back = c.district.gates.find((g) => g.to === home)!;
    priv(c).cross(back);
    c.state.arrive = 1;
    run(c, 1);
    const again = c.state.zeds.filter((z) => z.rush).length;
    check(about > 0 && came === about && again === came, `the Rush follows across a checkpoint and back (${about}, ${came}, ${again})`);
    say(`after two waves, ${about} of the Rush about: across a checkpoint ${came} follow, and back again ${again}`);
  }
  // In the tunnel, or on a way out's night, no wave comes: nothing held, no supplies.
  {
    const c = city(9);
    c.peace = false;
    at(c, 3, 20 * 60 + 50);
    run(c, 1);
    c.descend();
    const evs = run(c, (8 * 60 + 15) * STEPS_PER_MINUTE);
    const r = rushes(evs).map((e) => e.what);
    check(
      !r.includes('wave') && !r.includes('held') && !r.includes('begin') && c.state.held === 0,
      `a Rush night in the tunnel holds nothing (${r})`,
    );
    say("a Rush night spent in the metro's tunnel: no wave, nothing held, no supplies");
  }
}

// ------------------------------------------------------------------ the traps
{
  const c = city(2);
  const mid = openSquare(c);
  stock(c, [
    [I('crossbow'), 30],
    [I('bolt'), 20],
  ]);
  const blows0 = c.state.inv.find((st) => st[0] === I('crossbow'))![1];
  const out: string[] = [];
  const kinds = ['spikes', 'barbedWire', 'snare', 'cans', 'scarecrow', 'sentry'].map((id) => PIECE[id]);
  for (const k of kinds) check(PIECES[k].trap !== undefined, `${PIECES[k].id} is a trap`);
  // Spikes: one of the dead stood on them goes down.
  const spikes = mid - 2;
  check(buildAt(c, PIECE.spikes, spikes) > 0, 'spikes put up');
  away(c, spikes);
  c.peace = false;
  at(c, 1, 12 * 60);
  c.state.zeds = [];
  c.state.arrive = 0;
  zed(c, spikes, ZED.IDLE);
  let steps = 0;
  for (; steps < 200 && c.state.zeds.length; steps++) run(c, 1);
  const worn = PIECES[PIECE.spikes].hp - (c.state.built[c.state.district].find((p) => p[0] === spikes)?.[2] ?? 0);
  check(!c.state.zeds.length && worn === 6, `a shambler stood on spikes put down (${steps} steps, the spikes worn ${worn})`);
  out.push(`spikes put down a shambler stood on them in ${steps} steps (worn ${worn})`);
  // Barbed wire: walked through more slowly.
  const cross = (wire: boolean) => {
    const d = new City(2);
    d.peace = true;
    d.step(0);
    const m = openSquare(d);
    stock(d);
    if (wire) for (const t of [m - 1, m, m + 1]) check(buildAt(d, PIECE.barbedWire, t, new Set([m - 2, m + 2])) > 0, 'wire put up');
    stand(d, m + 3, m);
    d.peace = false;
    at(d, 1, 12 * 60);
    d.state.zeds = [];
    d.state.arrive = 0;
    const z = zed(d, m - 3);
    let n = 0;
    for (; n < 2000 && Math.abs(z.body.x - d.state.player.x) > 1400; n++) {
      z.seen = d.state.step;
      run(d, 1);
    }
    return { n, hp: z.hp };
  };
  const plain = cross(false);
  const wired = cross(true);
  check(
    wired.n > plain.n * 1.6 && wired.hp < 30,
    `slowed and torn by barbed wire (${wired.n} steps against ${plain.n}, health ${wired.hp})`,
  );
  out.push(`three tiles of barbed wire crossed in ${wired.n} steps against ${plain.n}, health 30 → ${wired.hp}`);
  // A snare: held, worn a catch.
  {
    const snare = mid + 2 * W;
    check(buildAt(c, PIECE.snare, snare) > 0, 'a snare put up');
    stand(c, snare + 2 * W, snare);
    c.peace = false;
    c.state.zeds = [];
    const z = zed(c, snare - 3 * W);
    let held = 0;
    for (let k = 0; k < 400; k++) {
      z.seen = c.state.step;
      const evs = run(c, 1);
      if (evs.some((e) => e.type === 'trap' && e.what === 'snare')) held = z.reel;
      if (evs.some((e) => e.type === 'bite')) break;
    }
    const left = c.state.built[c.state.district].find((p) => p[0] === snare)?.[2];
    check(held === TRAP.snareHold && left === 2, `a snare holds one ${held} steps, a catch worn (${left} left)`);
    out.push(`a snare held one ${held} steps (${left} catches left)`);
    // (A brute tears free.)
    c.state.zeds = [];
    const b = zed(c, snare - 3 * W, ZED.CHASE, ZKIND.BRUTE);
    let caught = false;
    for (let k = 0; k < 300 && !caught; k++) {
      b.seen = c.state.step;
      caught = run(c, 1).some((e) => e.type === 'trap' && e.what === 'snare');
    }
    check(!caught, "a brute isn't held by a snare");
  }
  // Tin cans: one of the dead near them wakes a sleeper.
  {
    const cans = mid + 2;
    check(buildAt(c, PIECE.cans, cans) > 0, 'cans put up');
    stand(c, mid - 3 * W, mid);
    c.peace = false;
    c.state.zeds = [];
    c.state.sleeping = true;
    const z = zed(c, cans + 2 * W, ZED.IDLE);
    z.body.x += 0;
    const evs = run(c, 10);
    const woke = evs.find((e) => e.type === 'sleep' && !e.on) as Extract<CityEvent, { type: 'sleep' }> | undefined;
    check(evs.some((e) => e.type === 'trap' && e.what === 'cans') === false, 'cans quiet with nothing within a tile');
    z.body = bodyAt((cans + W) % W, Math.floor((cans + W) / W));
    const evs2 = run(c, 10);
    const woke2 = evs2.find((e) => e.type === 'sleep' && !e.on) as Extract<CityEvent, { type: 'sleep' }> | undefined;
    check(!woke && woke2?.why === 'rattle', `the cans rattle and wake the sleeper (${woke2?.why})`);
    c.state.sleeping = false;
    out.push('tin cans rattled by one of the dead beside them woke the sleeper');
  }
  // A scarecrow: one wandering near goes to it at night.
  {
    const d = city(2);
    const m = openSquare(d);
    stock(d);
    check(buildAt(d, PIECE.scarecrow, m) > 0, 'a scarecrow put up');
    stand(d, m + 20 * W > N ? m - 20 * W : m, m);
    d.state.player = bodyAt(2, 2);
    d.peace = false;
    at(d, 2, 23 * 60 - 1);
    d.state.zeds = [];
    d.state.arrive = 0;
    const z = zed(d, m + 6, ZED.WANDER);
    run(d, 3 * STEPS_PER_MINUTE);
    const near = cheb(Math.floor(z.body.z / 1024) * W + Math.floor(z.body.x / 1024), m);
    check(near <= 2, `a wanderer six tiles off goes to the scarecrow (${near} tiles from it)`);
    out.push(`a wanderer six tiles off went to the scarecrow (${near === 1 ? 'a tile' : `${near} tiles`} from it after three minutes)`);
  }
  // A sentry: loaded, it shoots; taken down, the crossbow and the bolts back.
  {
    const sentry = mid - 2 * W;
    stand(c, mid, mid);
    stock(c, [
      [I('crossbow'), 30],
      [I('bolt'), 20],
    ]);
    check(buildAt(c, PIECE.sentry, sentry) > 0, 'a sentry put up');
    check(c.count(I('crossbow')) === 0, 'the crossbow went into it');
    // Open its card (the action button on it) and load it.
    c.step(command(0, COP.ACT, 0));
    check(c.state.open === `p${sentry}`, `its card open (${c.state.open})`);
    c.step(command(0, COP.BUILD, PIECE_OPS + 2));
    const p = c.state.built[c.state.district].find((q) => q[0] === sentry)!;
    check(
      p[4] % BUILD.sentryWear === TRAP.sentryMost && c.count(I('bolt')) === 20 - TRAP.sentryMost,
      `loaded with ${p[4] % BUILD.sentryWear} bolts`,
    );
    c.peace = false;
    c.state.zeds = [];
    // (Four tiles off it, in the open square.)
    const z = zed(c, mid + 2 * W + 2, ZED.IDLE);
    const evs = run(c, TRAP.sentryEvery * 2 + 2);
    const shots = evs.filter((e) => e.type === 'trap' && e.what === 'sentry').length;
    check(shots >= 1 && z.hp <= 30 - TRAP.sentryHarm, `the sentry shot one of the dead four tiles off (${shots} shots)`);
    c.state.zeds = [];
    c.peace = true;
    const left = p[4] % BUILD.sentryWear;
    // (The review: a repair takes scrap and wire, never a crossbow.)
    p[2] = 40;
    c.state.inv[6] = [I('crossbow'), 25];
    stand(c, sentry + W, sentry);
    if (c.state.open !== `p${sentry}`) c.step(command(0, COP.ACT, 0));
    c.step(command(0, COP.BUILD, PIECE_OPS));
    run(c, BUILD.repairSteps + 2, false);
    check(
      p[2] === PIECES[PIECE.sentry].hp && c.count(I('crossbow')) === 1,
      `a sentry repaired without a crossbow (${p[2]}, ${c.count(I('crossbow'))})`,
    );
    c.state.inv[6] = [0, 0];
    // (Its card open again, from beside it, and taken down.)
    stand(c, sentry + W, sentry);
    // (Still open from the loading: a press would shut it.)
    if (c.state.open !== `p${sentry}`) c.step(command(0, COP.ACT, 0));
    // (Room in the pockets: the test's stacks of 99 fill them.)
    const carried = c.count(I('bolt'));
    c.state.inv = c.state.inv.map(() => [0, 0]);
    c.state.inv[0] = [HAMMER, 1];
    c.state.inv[1] = [I('bolt'), carried];
    c.step(command(0, COP.BUILD, PIECE_OPS + 1));
    run(c, BUILD.downSteps + 2, false);
    const back = c.state.inv.find((st) => st[0] === I('crossbow'));
    check(
      back?.[1] === blows0 && c.count(I('bolt')) === 20 - TRAP.sentryMost + left,
      `taken down: the crossbow (${back?.[1]} blows) and ${left} bolts back`,
    );
    out.push(
      `a sentry loaded with ${TRAP.sentryMost} bolts shot one of the dead (${shots} shots), taken down for its crossbow (${back?.[1]} blows, as it went in) and its bolts`,
    );
  }
  say(out.join('; '));
}

// ------------------------------------------------------------------ a base left
{
  const leave = (rush: boolean) => {
    const c = city(9);
    const mid = openSquare(c);
    stock(c);
    const ring = new Set(ring8(mid));
    for (const t of ring8(mid)) buildAt(c, PIECE.plankWall, t, new Set([mid, ...ring]));
    // (A rug inside: walled in, the dead can't get at it.)
    c.state.built[c.state.district].push([mid, PIECE.rug, PIECES[PIECE.rug].hp, 1, 0]);
    c.reenter();
    if (!rush) c.state.rev = 3;
    const home = c.state.district;
    stand(c, c.district.gates[0].tiles[0] - (c.district.gates[0].side === 0 ? -W : 0), mid);
    at(c, 2, 12 * 60);
    c.step(0);
    const gate = c.district.gates[0];
    priv(c).cross(gate);
    // Two nights away (the second and the third), then back.
    at(c, 4, 12 * 60);
    c.step(0);
    const back = c.district.gates.find((g) => g.to === home)!;
    priv(c).cross(back);
    const ev = c.events.find((e) => e.type === 'baseHeld') as Extract<CityEvent, { type: 'baseHeld' }> | undefined;
    const list = c.state.built[home];
    const walls = list.filter((p) => p[1] === PIECE.plankWall);
    const rug = list.find((p) => p[1] === PIECE.rug);
    return { ev, worn: walls.reduce((n, p) => n + PIECES[p[1]].hp - p[2], 0), rug: rug?.[2] === PIECES[PIECE.rug].hp };
  };
  const quiet = leave(false);
  const rushed = leave(true);
  // (The review: nights counted by the midnights away, not the 21:00s crossed.)
  const brief = (from: [number, number], to: [number, number]) => {
    const c = city(9);
    const mid = openSquare(c);
    stock(c);
    buildAt(c, PIECE.barricade, mid + 1);
    const home = c.state.district;
    stand(c, mid - 1, mid);
    at(c, ...from);
    c.step(0);
    priv(c).cross(c.district.gates[0]);
    at(c, ...to);
    c.step(0);
    priv(c).cross(c.district.gates.find((g) => g.to === home)!);
    const ev = c.events.find((e) => e.type === 'baseHeld') as Extract<CityEvent, { type: 'baseHeld' }> | undefined;
    return ev?.nights ?? 0;
  };
  const twoMinutes = brief([3, 20 * 60 + 59], [3, 21 * 60 + 1]);
  const theNight = brief([3, 21 * 60 + 1], [4, 4 * 60 + 58]);
  check(
    twoMinutes === 0 && theNight === 3,
    `two minutes away across 21:00 no night (${twoMinutes}); the Rush's night away three (${theNight})`,
  );
  check(
    !!quiet.ev && quiet.ev.nights === 2 && quiet.ev.damaged === 8 && quiet.rug,
    `two nights away: the eight walls worn, the rug inside whole (${JSON.stringify(quiet.ev)})`,
  );
  check(
    !!rushed.ev && rushed.ev.nights === 4 && rushed.worn > quiet.worn * 1.6,
    `a Rush's night counts three times (${rushed.worn} against ${quiet.worn})`,
  );
  say(`two minutes away across 21:00 is no night; away from 21:01 to 04:58 on the Rush's, three`);
  say(
    `a base left two nights: the eight walls facing out worn ${quiet.worn} in all, the rug walled in untouched; with the Rush's night among them, ${rushed.worn}${rushed.ev?.lost ? `, ${rushed.ev.lost} lost` : ''}`,
  );
}

// ------------------------------------------------------------------ a sleeper in a walled base
{
  let found = 0;
  const nights = [4, 5, 7, 8, 10, 11];
  for (const seed of [10, 11]) {
    const c = city(seed);
    const mid = openSquare(c);
    stock(c);
    const ring = new Set(ring8(mid));
    for (const t of ring8(mid)) buildAt(c, PIECE.plankWall, t, new Set([mid, ...ring]));
    c.state.player = bodyAt(mid % W, Math.floor(mid / W));
    c.peace = false;
    for (const n of nights) {
      at(c, n, 21 * 60 + 30);
      c.state.zeds = [];
      c.state.arrive = 1;
      run(c, 2);
      // (Asleep the night through, woken or not: a night the walls were pounded is a night they were found.)
      let night = false;
      for (let h = 0; h < 7 * 60 * STEPS_PER_MINUTE; h++) {
        c.state.sleeping = true;
        c.state.health = 100;
        c.state.hunger = FULL;
        c.step(0);
        if (c.events.some((e) => e.type === 'sleep' && !e.on && e.why === 'pounding')) night = true;
        if (c.state.over) break;
      }
      if (night) found++;
    }
  }
  check(found > 0 && found < 12, `a sleeper ringed by walls found now and then (${found} nights of 12)`);
  say(`asleep inside eight plank walls, nights 4 to 11 but the Rush's, two cities: found and woken by pounding on ${found} nights of 12`);
}

// ------------------------------------------------------------------ held: a bot proof
{
  /**
   * A player ready for it: a pocket of seven plank walls and a barricade, spikes and barbed wire before the barricade, a bat and
   * three bandages; stood in it from 21:00, striking whatever comes in reach, a bandage when low. Nothing kept up: a fall is a fall.
   */
  const hold = (seed: number, n: number): boolean | null => {
    const c = city(seed);
    const d = c.state.district;
    stock(c);
    let mid = -1;
    for (let z = 6; z < W - 6 && mid < 0; z++)
      for (let x = 6; x < W - 6 && mid < 0; x++) {
        const m = z * W + x;
        let ok = true;
        for (let dz = -3; dz <= 3 && ok; dz++)
          for (let dx = -3; dx <= 3 && ok; dx++) {
            const t = m + dz * W + dx;
            ok = (!c.grid[t] && !c.carAt[t] && canBuild(c, PIECE.barricade, t) === 'ok') || t === c.tile;
          }
        if (ok) mid = m;
      }
    if (mid < 0) return null;
    const E = nearestDir(1, 0);
    const S = nearestDir(0, 1);
    const built: Array<[number, number, number, number, number]> = [];
    for (const o of [-W - 1, -W, -W + 1, -1, W - 1, W, W + 1]) built.push([mid + o, PIECE.plankWall, 120, Math.abs(o) === 1 ? E : S, 0]);
    built.push([mid + 1, PIECE.barricade, 60, E, 0]);
    for (const t of [mid + 2, mid + W + 2, mid - W + 2]) built.push([t, PIECE.spikes, 30, E, 0]);
    built.push([mid + 3, PIECE.barbedWire, 40, E, 0]);
    c.state.built[d] = built;
    c.reenter();
    c.state.inv = c.state.inv.map(() => [0, 0]);
    c.state.inv[0] = [I('bat'), 40];
    c.state.inv[1] = [I('bandage'), 3];
    c.state.player = bodyAt(mid % W, Math.floor(mid / W), E);
    c.peace = false;
    at(c, n, 21 * 60);
    Object.assign(c.state, { health: 100, hunger: FULL, energy: 80_000, bleed: 0, zeds: [], arrive: 1 });
    for (let k = 0; k < 8 * 60 * STEPS_PER_MINUTE; k++) {
      const s = c.state;
      let near = -1;
      let nd = (1.5 * 1024) ** 2;
      s.zeds.forEach((z, i) => {
        const dd = (z.body.x - s.player.x) ** 2 + (z.body.z - s.player.z) ** 2;
        if (dd < nd) {
          nd = dd;
          near = i;
        }
      });
      const slot = s.inv.findIndex((st) => st[0] === I('bandage'));
      const cmd =
        (s.health < 45 || s.bleed > 6) && slot >= 0 && near < 0
          ? command(0, COP.USE, slot)
          : near >= 0
            ? command(nearestDir(s.zeds[near].body.x - s.player.x, s.zeds[near].body.z - s.player.z), COP.HIT)
            : c.tile !== mid
              ? command(nearestDir((mid % W) - (c.tile % W), Math.floor(mid / W) - Math.floor(c.tile / W)))
              : 0;
      c.step(cmd);
      if (c.events.some((e) => e.type === 'dead')) return false;
    }
    return true;
  };
  let held = 0;
  let all = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const r = hold(seed, 3);
    if (r === null) continue;
    all++;
    if (r) held++;
  }
  // (On 22 others, 18 held; 22 of 22 with metal walls, a spear and five bandages, and the second Rush 14 of 22.)
  check(all >= 16 && held >= all * 0.65, `ready for it, the first Rush held in ${held} of ${all} cities`);
  say(
    `ready for it (a pocket of walls, spikes and wire before its barricade, a bat, three bandages), the first Rush held in ${held} of ${all} cities`,
  );
}

// ------------------------------------------------------------------ a fall the night before a Rush
{
  const c = city(11);
  c.peace = false;
  at(c, 2, 23 * 60);
  c.step(0);
  c.state.health = 1;
  c.hurt(5, 'hunger');
  const warned = rushes(c.events).some((e) => e.what === 'warn');
  check(c.day === 3 && warned, `woken on a Rush's day after a fall, it is said (day ${c.day}, ${warned})`);
  say('a fall the night before a Rush: woken at home on its day, the Rush said then (the 06:00 warning was slept through)');
}

// ------------------------------------------------------------------ the save
{
  const c = city(12);
  c.state.held = 2;
  c.state.left = [0, 5, 0, 0, 0, 0, 0, 0, 0, 0];
  c.peace = false;
  at(c, 3, 22 * 60);
  c.state.zeds = [];
  c.state.arrive = 0;
  run(c, 1);
  const snap = JSON.parse(JSON.stringify(c.snapshot()));
  const back = loadCity(snap)!;
  check(
    back.state.held === 2 &&
      back.state.left[1] === 5 &&
      back.state.zeds.filter((z) => z.rush).length === c.state.zeds.filter((z) => z.rush).length,
    "a save keeps the Rushes held, the steps left, the Rush's dead",
  );
  const bad = JSON.parse(JSON.stringify(snap));
  bad.state.held = -4;
  bad.state.left = [1, 2];
  bad.state.waves = [3, 9, 1];
  bad.state.follow = -2;
  const mended = loadCity(bad)!;
  check(
    mended.state.held === 0 && mended.state.left.length === 0 && mended.state.waves.length === 0 && mended.state.follow === 0,
    'a damaged save made sound',
  );
  check(back.state.waves.join() === c.state.waves.join() && back.state.waves[1] === 1, `a save keeps the waves come (${back.state.waves})`);
  const odd = JSON.parse(JSON.stringify(snap));
  odd.state.zeds[0].rush = 7;
  check(loadCity(odd)?.state.zeds.some((z) => z.rush === 7) !== true, "one of the dead with a bad mark isn't loaded as it is");
  const older = JSON.parse(JSON.stringify(snap));
  delete older.state.held;
  delete older.state.left;
  delete older.state.rev;
  const o = loadCity(older)!;
  check(o.state.held === 0 && o.state.rev === 0, 'a save from before 2.68 loads, with no Rush');
  say(
    "a save keeps the Rushes held, where each district was left and the Rush's dead; a damaged one is made sound; one from before has no Rush",
  );
}

console.log(lines.join('\n'));
