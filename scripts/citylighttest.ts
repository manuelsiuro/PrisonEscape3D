/**
 * City Escape's light and fire (2.52): the torch (a battery's worth, on and off, seen further behind
 * it, out when it's dropped), a lantern made and set down (its pool stopped by walls, the dead that
 * aren't after anyone turned back at its edge and sent out of it, one that is coming on), a barrel lit
 * with fuel (a fire: it cooks, it burns out), a generator lighting its whole building (the dead indoors
 * leave), what's refused, the last stand's call stronger than any light (one sent looking stops at a
 * lantern's edge, and comes through it once the beacon is lit), how many first nights asleep in an open
 * house end bitten beside a lantern and without, and what a save keeps (a light out on a minute's turn,
 * a fall's morning).
 */
import { check } from './assert';
import { DEAD, ZKIND } from '../src/city/content/dead';
import { cityItem, cityItemNumber } from '../src/city/content/items';
import { LEVEL, LIGHT, LIGHT_KIND } from '../src/city/content/light';
import { CITY_RECIPES } from '../src/city/content/recipes';
import { DECO } from '../src/city/gen/district';
import { City, COP, FULL, loadCity, type CityEvent, type Stack } from '../src/city/sim/City';
import { ZED, type Zed } from '../src/city/sim/dead';
import { lightLevel, lightsHere, torchLit } from '../src/city/sim/light';
import { lineOfSight } from '../src/sim/ai/sight';
import { findPath, nearestDir } from '../src/sim/ai/path';
import { command } from '../src/sim/command';
import { bodyAt } from '../src/sim/systems/movement';
import { centerX, centerZ, MAP_W, tileAt } from '../src/sim/world/grid';

const lines: string[] = [];
const say = (s: string) => lines.push(s);
const MIN = 20;
const W = MAP_W;
const N = (id: string) => cityItemNumber(id);
const give = (c: City, list: Array<[string, number]>) => {
  for (const st of c.state.inv) st[0] = st[1] = 0;
  list.forEach(([id, n], k) => (c.state.inv[k] = [N(id), cityItem(N(id))?.wear ?? n] as Stack));
};
const slot = (c: City, id: string) => c.state.inv.findIndex((st) => st[0] === N(id));
const use = (c: City, id: string): CityEvent[] => {
  c.step(command(0, COP.USE, slot(c, id)));
  return c.events;
};
const stand = (c: City, tile: number) => {
  c.state.player = bodyAt(tile % W, Math.floor(tile / W));
  c.step(0);
};
const clock = (c: City, hour: number, minute = 0) => {
  c.state.step += ((hour * 60 + minute - c.minute + 1440) % 1440) * MIN;
};
const far = (a: number, b: number) => Math.max(Math.abs((a % W) - (b % W)), Math.abs(Math.floor(a / W) - Math.floor(b / W)));
const zed = (c: City, tile: number, mode: number = ZED.WANDER): Zed => {
  const z: Zed = {
    body: bodyAt(tile % W, Math.floor(tile / W)),
    hp: 30,
    mode,
    goal: -1,
    path: [],
    seen: -9999,
    last: -1,
    bit: -9999,
    reel: 0,
    near: 0,
    pace: 1000,
  };
  c.state.zeds.push(z);
  return z;
};
const refused = (ev: CityEvent[], why: string) => ev.some((e) => e.type === 'refused' && e.why === why);
/** A straight run of street: `n` open tiles in a row along x, nothing on them. */
const run = (c: City, n: number) =>
  c.zedPlaces.streets.find(
    (i) => (i % W) + n < W && Array.from({ length: n }, (_, k) => i + k).every((t) => !c.grid[t] && c.zedStreet[t]),
  )!;

// ------------------------------------------------------------------ the torch
{
  const c = new City(3);
  c.peace = true;
  c.step(0);
  const at = run(c, 8);
  stand(c, at);
  clock(c, 23);
  give(c, [['torch', 1]]);
  check(refused(use(c, 'torch'), 'noBattery') && !torchLit(c), 'the torch lit without a battery');
  check(lightLevel(c) === LEVEL.DARK, 'the street at night without a light is dark');
  give(c, [
    ['torch', 1],
    ['battery', 2],
  ]);
  const on = use(c, 'torch');
  check(on.some((e) => e.type === 'torch' && e.on) && torchLit(c) && c.count(N('battery')) === 1, 'the torch takes one battery and lights');
  check(c.state.torch === LIGHT.torchMinutes && lightLevel(c) === LEVEL.DIM, 'a full charge, a dim light');
  check(
    use(c, 'torch').some((e) => e.type === 'torch' && !e.on) && !torchLit(c) && c.count(N('battery')) === 1,
    'off again, the charge kept',
  );
  // Seen: one of the dead five tiles off down the street, the player standing still.
  const seenIn = (lit: boolean) => {
    const d = new City(3);
    d.step(0);
    stand(d, at);
    clock(d, 23);
    d.state.zeds = [];
    give(d, [
      ['torch', 1],
      ['battery', 1],
    ]);
    if (lit) use(d, 'torch');
    const z = zed(d, at + 5, ZED.IDLE);
    for (let k = 0; k < 10; k++) d.step(0);
    return z.mode === ZED.CHASE;
  };
  check(DEAD.sightNight < 5 && DEAD.sightDay >= 5, 'five tiles: past the night’s sight, within the day’s');
  check(!seenIn(false) && seenIn(true), 'behind a torch the player is seen as far as by day; in the dark, not');
  // It burns down, a game minute a minute, and goes out; a new battery is taken at the next press.
  use(c, 'torch');
  let spent = -1;
  for (let k = 0; k <= LIGHT.torchMinutes * MIN + MIN && spent < 0; k++) {
    c.step(0);
    c.state.hunger = FULL;
    if (c.events.some((e) => e.type === 'torch' && !e.on && e.spent)) spent = k;
  }
  check(
    spent > (LIGHT.torchMinutes - 2) * MIN && !torchLit(c) && c.state.torch === 0,
    `the torch burnt ${Math.round(spent / MIN)} game minutes`,
  );
  use(c, 'torch');
  check(torchLit(c) && c.count(N('battery')) === 0, 'the second battery taken');
  // Dropped: out.
  c.step(command(0, COP.DROP, slot(c, 'torch')));
  for (let k = 0; k < MIN; k++) c.step(0);
  check(!torchLit(c) && c.state.torchOn === 0, 'a torch dropped is out');
  say(`the torch: ${LIGHT.torchMinutes} game minutes a battery; seen at ${DEAD.sightDay} tiles behind it, ${DEAD.sightNight} in the dark`);
}

// ------------------------------------------------------------------ a lantern
{
  const c = new City(5);
  c.peace = true;
  c.step(0);
  const k = CITY_RECIPES.findIndex((r) => r.makes === 'lantern');
  give(c, [
    ['bottle', 1],
    ['cloth', 1],
    ['fuel', 1],
  ]);
  c.step(command(0, COP.MAKE, k));
  check(c.count(N('lantern')) === 1 && !c.count(N('fuel')), 'a lantern made by hand from a bottle, cloth and fuel');
  const at = run(c, 12) + 6;
  stand(c, at);
  clock(c, 22);
  c.state.zeds = [];
  const ev = use(c, 'lantern');
  check(
    ev.some((e) => e.type === 'lit' && e.kind === LIGHT_KIND.LANTERN && e.tile === at) && !c.count(N('lantern')),
    'set down where the player stands',
  );
  check(c.anyLight && lightsHere(c).length === 1 && lightLevel(c) === LEVEL.LIT, 'the district has a light; the player stands in it');
  let lit = 0;
  let wrong = 0;
  for (let i = 0; i < W * W; i++) {
    if (!c.lit[i]) continue;
    lit++;
    if (far(i, at) > LIGHT.lanternReach || (i !== at && !lineOfSight(c.world, centerX(at), centerZ(at), centerX(i), centerZ(i)))) wrong++;
  }
  check(lit >= 9 && wrong === 0, `a lantern's pool: ${lit} tiles, ${wrong} past its reach or behind a wall`);
  give(c, [['lantern', 1]]);
  check(refused(use(c, 'lantern'), 'alreadyLit') && c.count(N('lantern')) === 1, 'no second lantern on the same tile');
  // One of the dead wandering towards it: turned back at the edge. One after the player: comes on.
  c.peace = false;
  stand(c, at);
  c.state.zeds = [];
  const walker = zed(c, at - 6);
  walker.path = findPath(c.world, at - 6, (i) => i === at + 5, at + 5, 900, undefined, c.zedGrid) ?? [];
  // (Asleep on the lantern's tile is not this test: the player is out of sight, round the pool's far side.)
  c.state.player = bodyAt((at % W) + 30 < W ? (at % W) + 30 : (at % W) - 30, Math.floor(at / W));
  let inLight = 0;
  for (let n = 0; n < 400; n++) {
    walker.mode = ZED.WANDER;
    c.step(0);
    c.state.hunger = FULL;
    if (c.lit[tileAt(walker.body.x, walker.body.z)]) inLight++;
  }
  check(inLight === 0 && walker.path.length === 0, `a wanderer walked into the light for ${inLight} steps`);
  c.state.zeds = [];
  stand(c, at);
  const hunter = zed(c, at - 6, ZED.CHASE);
  hunter.seen = c.state.step;
  hunter.last = at;
  let came = false;
  for (let n = 0; n < 200 && !came; n++) {
    c.step(0);
    c.state.health = 100;
    came = c.lit[tileAt(hunter.body.x, hunter.body.z)] === 1;
  }
  check(came, 'one after the player comes on into the light');
  // A brute doesn't mind it.
  c.state.zeds = [];
  c.state.player = bodyAt((at % W) + 30 < W ? (at % W) + 30 : (at % W) - 30, Math.floor(at / W));
  const brute = zed(c, at - 6);
  brute.kind = ZKIND.BRUTE;
  brute.path = findPath(c.world, at - 6, (i) => i === at + 5, at + 5, 900, undefined, c.zedGrid) ?? [];
  let through = false;
  for (let n = 0; n < 400 && !through; n++) {
    c.step(0);
    c.state.hunger = FULL;
    through = c.lit[tileAt(brute.body.x, brute.body.z)] === 1;
  }
  check(through, 'a brute walks through the light');
  c.state.zeds = [];
  stand(c, at);
  // Caught in a light just lit: they leave it.
  const f = new City(5);
  f.step(0);
  stand(f, at);
  clock(f, 22);
  f.state.zeds = [];
  const there = [zed(f, at - 2), zed(f, at + 2)];
  give(f, [['lantern', 1]]);
  use(f, 'lantern');
  f.state.player = bodyAt((at % W) + 30 < W ? (at % W) + 30 : (at % W) - 30, Math.floor(at / W));
  let left = -1;
  for (let n = 0; n < 300 && left < 0; n++) {
    f.step(0);
    if (there.every((z) => !f.lit[tileAt(z.body.x, z.body.z)])) left = n;
  }
  check(left >= 0 && there.length === 2, `the dead caught in a lantern's light left it in ${left} steps`);
  // It burns out.
  let out = -1;
  for (let n = 0; n <= LIGHT.lanternMinutes * MIN + MIN && out < 0; n++) {
    c.step(0);
    c.state.hunger = FULL;
    c.state.health = 100;
    if (c.events.some((x) => x.type === 'burnt' && x.kind === LIGHT_KIND.LANTERN)) out = n;
  }
  check(out > 0 && !c.anyLight && c.lit.every((v) => !v), 'the lantern burnt out, and the dark is back');
  say(`a lantern: ${lit} tiles lit on a street, ${LIGHT.lanternMinutes} game minutes; the dead caught in it gone in ${left} steps`);
}

// ------------------------------------------------------------------ a fire barrel, and cooking on it
{
  let found: { c: City; barrel: number; at: number } | null = null;
  for (let seed = 1; seed <= 12 && !found; seed++) {
    const c = new City(seed);
    c.peace = true;
    c.step(0);
    for (let d = 0; d < 9 && !found; d++) {
      const dist = c.districtOf(d);
      const grid = c.districtGrid(d);
      for (let i = W; i < W * (W - 1) && !found; i++) {
        if (dist.deco[i] !== DECO.BARREL) continue;
        const at = [i - 1, i + 1, i - W, i + W].find((t) => !grid[t]);
        if (at === undefined) continue;
        if (d !== c.state.district) (c as unknown as { enter(d: number): void }).enter(d);
        found = { c, barrel: i, at };
      }
    }
  }
  check(!!found, 'a barrel to stand beside in twelve cities');
  const { c, barrel, at } = found!;
  stand(c, at);
  c.state.player.facing = nearestDir((barrel % W) - (at % W), Math.floor(barrel / W) - Math.floor(at / W));
  const stew = CITY_RECIPES.findIndex((r) => r.makes === 'stew');
  give(c, [
    ['tin', 1],
    ['veg', 1],
    ['water', 1],
    ['fuel', 2],
  ]);
  check(c.canMake(stew) === 'stove', 'no stew without a stove or a fire');
  const ev = use(c, 'fuel');
  check(
    ev.some((e) => e.type === 'lit' && e.kind === LIGHT_KIND.FIRE && e.tile === barrel) && c.count(N('fuel')) === 1,
    'a can of fuel lights the barrel',
  );
  check(refused(use(c, 'fuel'), 'alreadyLit') && c.count(N('fuel')) === 1, 'a barrel burning takes no more fuel');
  check(c.canMake(stew) === 'ok', 'beside the fire, stew is made without a stove');
  c.step(command(0, COP.MAKE, stew));
  check(c.count(N('stew')) === 1, 'stew cooked on the fire');
  let lit = 0;
  for (let i = 0; i < W * W; i++) if (c.lit[i]) lit++;
  // Away from any barrel or generator: nothing to light.
  const open = run(c, 3) + 1;
  const lone = [open - 1, open + 1, open - W, open + W, open - W - 1, open - W + 1, open + W - 1, open + W + 1].every(
    (t) => c.district.deco[t] !== DECO.BARREL,
  );
  check(lone, 'a stretch of street with no barrel beside it');
  stand(c, open);
  check(refused(use(c, 'fuel'), 'noFire') && c.count(N('fuel')) === 1, 'fuel used with nothing to light is kept');
  let out = -1;
  for (let n = 0; n <= LIGHT.fireMinutes * MIN + MIN && out < 0; n++) {
    c.step(0);
    c.state.hunger = FULL;
    if (c.events.some((x) => x.type === 'burnt' && x.kind === LIGHT_KIND.FIRE)) out = n;
  }
  check(out > (LIGHT.fireMinutes - 2) * MIN && !c.anyLight, `the fire burnt ${Math.round(out / MIN)} game minutes`);
  say(`a fire barrel: ${lit} tiles lit, ${LIGHT.fireMinutes} game minutes a can; stew cooked beside it`);
}

// ------------------------------------------------------------------ a generator
{
  let found: { c: City; gen: number; at: number; lot: number } | null = null;
  let seen = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const c = new City(seed);
    for (let d = 0; d < 9; d++) {
      const dist = c.districtOf(d);
      const grid = c.districtGrid(d);
      for (const p of dist.props) {
        if (p.kind !== 'generator') continue;
        seen++;
        const i = p.z * W + p.x;
        const at = [i - 1, i + 1, i - W, i + W].find((t) => !grid[t] && dist.lotAt[t] === dist.lotAt[i]);
        if (at === undefined || found) continue;
        c.step(0);
        if (d !== c.state.district) (c as unknown as { enter(d: number): void }).enter(d);
        found = { c, gen: i, at, lot: dist.lotAt[i] };
      }
    }
  }
  check(!!found, 'a generator to stand beside in twelve cities');
  const { c, gen, at, lot } = found!;
  c.step(0);
  clock(c, 11);
  c.state.zeds = [];
  // (The dead indoors by day, standing in the building.)
  const inside = c.zedPlaces.indoors.filter((i) => c.district.lotAt[i] === lot && far(i, at) >= 3).slice(0, 4);
  const idle = inside.map((i) => zed(c, i, ZED.IDLE));
  stand(c, at);
  c.state.player.facing = nearestDir((gen % W) - (at % W), Math.floor(gen / W) - Math.floor(at / W));
  give(c, [['fuel', 1]]);
  c.peace = true;
  const ev = use(c, 'fuel');
  check(
    ev.some((e) => e.type === 'lit' && e.kind === LIGHT_KIND.POWER && e.tile === gen),
    'a can of fuel starts the generator',
  );
  let all = 0;
  let litIn = 0;
  let litOut = 0;
  for (let i = 0; i < W * W; i++) {
    if (c.district.lotAt[i] === lot) {
      all++;
      if (c.lit[i]) litIn++;
    } else if (c.lit[i]) litOut++;
  }
  check(all > 0 && litIn === all && litOut === 0, `the generator lights its building: ${litIn} of ${all} tiles, ${litOut} outside`);
  // The dead indoors leave it (the player kept out of their sight: gone from the district's corner of the map).
  c.peace = false;
  c.state.player = bodyAt(1, 1);
  let left = -1;
  for (let n = 0; n < 1500 && left < 0; n++) {
    (c as unknown as { peace: boolean }).peace = false;
    c.state.player = bodyAt(1, 1);
    c.step(0);
    c.state.health = 100;
    if (idle.every((z) => !c.lit[tileAt(z.body.x, z.body.z)])) left = n;
  }
  check(idle.length > 0 && left >= 0, `${idle.length} of the dead indoors left the lit building in ${left} steps`);
  say(
    `a generator (${seen} in twelve cities): its building's ${all} tiles lit, ${LIGHT.powerMinutes} game minutes a can; ${idle.length} of the dead indoors out in ${left} steps`,
  );
}

// ------------------------------------------------------------------ the last stand's call is stronger
{
  // One of the dead sent looking (a noise, the beacon's call) down a street to a lantern, the player out of its sight:
  // turned back at the light's edge; with the beacon lit in this district, it comes on.
  const called = (ready: boolean) => {
    const c = new City(4);
    c.peace = true;
    c.step(0);
    (c as unknown as { enter(d: number): void }).enter(c.story.wayDistrict[0]);
    const at = run(c, 14) + 7;
    stand(c, at);
    clock(c, 22);
    give(c, [['lantern', 1]]);
    use(c, 'lantern');
    if (ready) Object.assign(c.state, { way: 1, ready: 1, readyAt: c.state.step });
    c.state.zeds = [];
    const z = zed(c, at - 7, ZED.SEEK);
    z.goal = at;
    c.peace = false;
    // (Far off behind buildings: never seen, so never chased.)
    const hide = c.zedPlaces.indoors.find((i) => far(i, at) > 20)!;
    let inLight = false;
    let chased = false;
    for (let n = 0; n < 500 && !inLight; n++) {
      c.state.player = bodyAt(hide % W, Math.floor(hide / W));
      c.step(0);
      c.state.health = 100;
      c.state.zeds.length = 1;
      chased ||= z.mode === ZED.CHASE;
      inLight = c.lit[tileAt(z.body.x, z.body.z)] === 1;
    }
    return { inLight, chased };
  };
  const quiet = called(false);
  const lit = called(true);
  check(!quiet.chased && !lit.chased, 'the one sent looking never saw the player');
  check(!quiet.inLight, 'sent looking on an ordinary night, it stops at the lantern’s edge');
  check(lit.inLight, 'the beacon lit: it comes on through the lantern’s light');
  say('one of the dead sent to a lantern: stopped at its edge on an ordinary night, through it once the beacon is lit');
}

// ------------------------------------------------------------------ a night in an open house: beside a lantern, and without
{
  const night = (seed: number, lantern: boolean) => {
    const c = new City(seed);
    c.step(0);
    const lots = c.district.lots;
    const lot = lots.findIndex(
      (l, k) =>
        l.use === 'house' &&
        l.doors.length > 0 &&
        c.district.props.some((p) => p.kind === 'bed' && c.district.lotAt[p.z * W + p.x] - 1 === k),
    );
    const bed = c.district.props.findIndex(
      (p, k) =>
        p.kind === 'bed' &&
        c.district.lotAt[p.z * W + p.x] - 1 === lot &&
        [...c.tilesOf(k)].flatMap((i) => [i - 1, i + 1, i - W, i + W]).some((i) => !c.grid[i]),
    );
    clock(c, 20, 55);
    c.state.zeds = c.state.zeds.filter((z) => c.district.lotAt[tileAt(z.body.x, z.body.z)] - 1 !== lot);
    c.state.boxes[`${c.state.district}:${bed}`] = [];
    const tiles = c.tilesOf(bed);
    const by = tiles.flatMap((i) => [i - 1, i + 1, i - W, i + W]).find((i) => !c.grid[i])!;
    stand(c, by);
    c.state.hunger = FULL;
    c.state.energy = 30_000;
    if (lantern) {
      give(c, [['lantern', 1]]);
      use(c, 'lantern');
    }
    const at = tiles.find((i) => Math.abs((i % W) - (by % W)) + Math.abs(Math.floor(i / W) - Math.floor(by / W)) === 1)!;
    c.state.player.facing = nearestDir((at % W) - (by % W), Math.floor(at / W) - Math.floor(by / W));
    c.step(command(0, COP.ACT));
    // (The night up to the first bite: bitten or not.)
    let bitten = false;
    for (let k = 0; k < 9 * 60 * MIN && c.minute !== 6 * 60 + 5 && !bitten; k++) {
      c.step(c.state.sleeping ? 0 : command(0, COP.ACT));
      bitten = c.events.some((e) => e.type === 'bite');
    }
    return bitten;
  };
  const SEEDS = 12;
  let dark = 0;
  let lit = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    if (night(seed, false)) dark++;
    if (night(seed, true)) lit++;
  }
  check(lit <= dark, `a lantern by the bed: bitten on ${lit} nights against ${dark} without`);
  say(`a first night asleep in a house with its doors open, ${SEEDS} cities: bitten on ${dark} in the dark, on ${lit} beside a lantern`);
}

// ------------------------------------------------------------------ saves
{
  const c = new City(6);
  c.peace = true;
  c.step(0);
  const at = run(c, 6) + 2;
  stand(c, at);
  give(c, [
    ['lantern', 1],
    ['torch', 1],
    ['battery', 1],
  ]);
  use(c, 'lantern');
  use(c, 'torch');
  const snap = JSON.parse(JSON.stringify(c.snapshot()));
  const again = loadCity(JSON.parse(JSON.stringify(snap)))!;
  check(
    !!again && again.anyLight && again.lit[at] === 1 && torchLit(again) && again.state.torch === c.state.torch,
    'a save keeps the lantern and the torch',
  );
  // From before light: none, and the city loads.
  const old = JSON.parse(JSON.stringify(snap));
  delete old.state.torch;
  delete old.state.torchOn;
  delete old.state.lights;
  const before = loadCity(old)!;
  check(!!before && !before.anyLight && before.state.torch === 0 && !torchLit(before), 'a save from before light loads with none');
  // Damaged: dropped, the city loads.
  const here = String(c.state.district);
  const later = c.state.step + 100 * MIN;
  for (const bad of [
    { lights: { [here]: [[99999, 1, later]] } },
    { lights: 'x' },
    { lights: { [here]: [[at, 7, later]] } },
    { lights: { [here]: [[at, 1, 1e15]] } },
    { lights: { 9: [[at, 1, later]] } },
    { torch: -4, torchOn: 1 },
    { torch: 1.5 },
  ]) {
    const hurt = JSON.parse(JSON.stringify(snap));
    Object.assign(hurt.state, bad);
    const got = loadCity(hurt);
    check(
      !!got && (('lights' in bad && !got.anyLight && Object.keys(got.state.lights).length === 0) || ('torch' in bad && !torchLit(got))),
      `a damaged save (${JSON.stringify(bad)}) loads without it`,
    );
  }
  // Burnt out on a minute's turn: a save made just after loads to the same dark, and the fall's morning too.
  {
    const e = new City(6);
    e.peace = true;
    e.step(0);
    for (let k = 0; k < 7; k++) e.step(0);
    stand(e, at);
    give(e, [['lantern', 1]]);
    use(e, 'lantern');
    const until = lightsHere(e)[0][2];
    check(until % MIN === 0, 'a light goes out on a minute’s turn');
    e.state.step = until - 3;
    for (let k = 0; k < 6; k++) e.step(0);
    const re = loadCity(JSON.parse(JSON.stringify(e.snapshot())))!;
    check(!e.anyLight && !re.anyLight && e.lit[at] === re.lit[at], 'just after it burns out, the city and its save agree');
    // A Survivor falls with a lantern burning that is out by morning: the morning's city has none.
    give(e, [['lantern', 1]]);
    use(e, 'lantern');
    clock(e, 23);
    e.state.lights[e.state.district][0][2] = e.state.step + 60 * MIN;
    e.hurt(1000);
    check(!e.anyLight && e.lit.every((v) => !v), 'after a fall, what burnt out in the night is out');
  }
  // Another district's burn on while the player is away, and are gone when they've burnt out.
  const d0 = c.state.district;
  const other = (d0 + 1) % 9;
  (c as unknown as { enter(d: number): void }).enter(other);
  check(!c.anyLight && c.lit.every((v) => !v), 'another district is dark');
  (c as unknown as { enter(d: number): void }).enter(d0);
  check(c.anyLight && c.lit[at] === 1, 'back: the lantern still burns');
  (c as unknown as { enter(d: number): void }).enter(other);
  c.state.step += (LIGHT.lanternMinutes + 5) * MIN;
  (c as unknown as { enter(d: number): void }).enter(d0);
  check(!c.anyLight && c.state.lights[d0] === undefined, 'back after it burnt out: gone');
  // No more than the most at once.
  for (let k = 0; k < LIGHT.most + 3; k++) {
    stand(c, c.zedPlaces.streets[k * 7]);
    give(c, [['lantern', 1]]);
    use(c, 'lantern');
  }
  check(lightsHere(c).length === LIGHT.most, `${lightsHere(c).length} lights at the most in a district`);
  check(
    c.events.some((e) => e.type === 'burnt'),
    'one more than the most: the oldest is said to go out',
  );
  say(
    `saves: the lantern and the torch kept, none from before, seven damaged ones loaded without; ${LIGHT.most} lights a district at the most`,
  );
}
console.log(lines.join('\n'));
