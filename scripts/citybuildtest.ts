/**
 * City Escape's building a base (2.67, C5 batch 2, city/sim/build.ts): every piece put up by real commands with a hammer (what it
 * takes, how long, what it stops: everyone, only the dead, nobody); each refusal (no hammer, not enough, something in the way, by
 * a checkpoint, by a survivor, at the way out, in the tunnel, a district full); a chest's slots, a repair, a piece taken down for
 * half; the dead shut out by walls pounding through (a shambler, a brute four times as fast), going round where they can, held by a
 * door the player walks through; a sleeper's comfort (a Home gives energy back half again as fast); a campfire's light, its
 * cooking, a plank fed; a built workbench; a save keeping it all, a damaged one made sound, one from before 2.67; the story's
 * places never moved by building.
 */
import { check } from './assert';
import { BUILD, PIECE, PIECES } from '../src/city/content/build';
import { cityItemNumber } from '../src/city/content/items';
import { LIGHT_KIND } from '../src/city/content/light';
import { CITY_RECIPES } from '../src/city/content/recipes';
import { TUNNEL } from '../src/city/gen/tunnel';
import { canBuild, comfortAt, repairCost } from '../src/city/sim/build';
import { innerWall, peopleLots } from '../src/city/sim/salvage';
import { City, COP, FULL, loadCity, PIECE_OPS, type CityEvent } from '../src/city/sim/City';
import { ZED, type Zed } from '../src/city/sim/dead';
import { ZKIND } from '../src/city/content/dead';
const ZKIND_BRUTE = ZKIND.BRUTE;
import { nearestDir } from '../src/sim/ai/path';
import { command } from '../src/sim/command';
import { bodyAt } from '../src/sim/systems/movement';
import { MAP_W } from '../src/sim/world/grid';

const lines: string[] = [];
const say = (s: string) => lines.push(s);
const W = MAP_W;
const N = W * W;
const I = cityItemNumber;
const HAMMER = I('hammer');
const around = (t: number) => [t - W, t + 1, t + W, t - 1].filter((i) => i >= 0 && i < N && Math.abs((i % W) - (t % W)) <= 1);
const ring8 = (t: number) => [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1].map((d) => t + d);
const enter = (c: City, d: number) => (c as unknown as { enter(d: number): void }).enter(d);
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
const stock = (c: City) => {
  c.state.inv = c.state.inv.map(() => [0, 0]);
  [
    [HAMMER, 1],
    [I('plank'), 99],
    [I('nails'), 99],
    [I('scrap'), 99],
    [I('cloth'), 99],
    [I('wire'), 99],
  ].forEach(([it, n], k) => (c.state.inv[k] = [it, n]));
};
const run = (c: City, steps: number): CityEvent[] => {
  const out: CityEvent[] = [];
  for (let k = 0; k < steps; k++) {
    c.step(0);
    out.push(...c.events);
  }
  return out;
};
/** A piece put up on a tile from a free tile beside it (not one of `but`): the steps it took, or -1 refused. */
function buildAt(c: City, kind: number, tile: number, but: ReadonlySet<number> = new Set()): number {
  const from = around(tile).find((i) => !c.grid[i] && !c.zedGrid[i] && !but.has(i) && !c.pieceAt[i] && !c.carAt[i]);
  if (from === undefined) return -1;
  // (2.71: a Handy player's level would make it quicker and cheaper: measured at the first.)
  c.state.skills = [0, 0, 0, 0];
  stand(c, from, tile);
  c.step(command(0, COP.BUILD, kind));
  if (c.events.some((e) => e.type === 'cantBuild')) return -1;
  let steps = 1;
  for (; steps < 400 && c.state.search; steps++) c.step(0);
  return c.pieceAt[tile] === kind + 1 ? steps - 1 : -1;
}
/** An open square of street or floor (5 × 5, and a row more below it: 2.71) in the district, every tile buildable, clear of the survivors and the checkpoints. */
function openSquare(c: City): number {
  stock(c);
  for (let z = 4; z < W - 4; z++)
    for (let x = 4; x < W - 4; x++) {
      const mid = z * W + x;
      let ok = true;
      for (let dz = -2; dz <= 3 && ok; dz++)
        for (let dx = -2; dx <= 2 && ok; dx++) {
          const t = mid + dz * W + dx;
          if (c.grid[t] || c.zedGrid[t] || c.carAt[t] || c.pieceAt[t]) ok = false;
          else if (canBuild(c, PIECE.barricade, t) !== 'ok' && t !== c.tile) ok = false;
        }
      if (ok) return mid;
    }
  return -1;
}
const city = (seed: number) => {
  const c = new City(seed);
  c.peace = true;
  c.step(0);
  return c;
};
const zed = (c: City, tile: number, kind?: number): Zed => {
  const z: Zed = {
    body: bodyAt(tile % W, Math.floor(tile / W)),
    hp: kind === ZKIND_BRUTE ? 90 : 30,
    mode: ZED.CHASE,
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

// ------------------------------------------------------------------ every piece, by real commands
{
  const c = city(2);
  const mid = openSquare(c);
  check(mid >= 0, 'an open square to build on');
  stock(c);
  // (2.68: a sentry takes a crossbow.)
  c.state.inv[6] = [I('crossbow'), 30];
  // (2.69: a workshop takes the toolkit. 2.70: the manuals read, for what's built from them.)
  c.state.inv[7] = [I('toolkit'), 1];
  c.state.manuals = 63;
  const before = new Map(c.state.inv.map(([it]) => [it, c.count(it)]));
  const out: string[] = [];
  // (2.68: the traps on the rest of the square's edge.)
  const tiles = [
    ...[-2 * W - 2, -2 * W, -2 * W + 2, -2, 2, 2 * W - 2, 2 * W, 2 * W + 2, -W - 2, W + 2, 0],
    ...[-2 * W - 1, -2 * W + 1, 2 * W - 1, 2 * W + 1, -W + 2, W - 2],
    // (2.69: the workshop inside the square's edge; 2.70: the planter, the barrel, the smoker.)
    -W - 1,
    -W + 1,
    W - 1,
    W + 1,
    // (2.71: the coop, in the row below.)
    3 * W,
  ].map((d) => mid + d);
  PIECES.forEach((def, kind) => {
    const t = tiles[kind];
    const steps = buildAt(c, kind, t);
    check(steps === BUILD.steps, `${def.id}: up in ${steps} steps`);
    // (What it stops: the player's grid and the dead's.)
    const stops = c.grid[t] ? 'everyone' : c.zedGrid[t] ? 'the dead' : 'nobody';
    check(stops === (def.solid ? 'everyone' : def.door ? 'the dead' : 'nobody'), `${def.id} stops ${stops}`);
    out.push(`${def.id} (${def.from.map(([id, n]) => `${n} ${id}`).join(', ')}; ${def.hp}; stops ${stops})`);
  });
  // (What they took, all of it.)
  for (const def of PIECES) for (const [id, n] of def.from) before.set(I(id), (before.get(I(id)) ?? 0) - n);
  check(
    [...before].every(([it, n]) => c.count(it) === n),
    'what the pieces took, spent exactly',
  );
  check(c.count(HAMMER) === 1, 'the hammer kept');
  say(`every piece put up by the action button in ${BUILD.steps / 20} s: ${out.join('; ')}`);
  // (A door walked through by the player.)
  const door = tiles[PIECE.door];
  const side = around(door).find((i) => !c.grid[i] && !c.pieceAt[i])!;
  const far = door + (door - side);
  stand(c, side, door);
  const dir = nearestDir((door % W) - (side % W), Math.floor(door / W) - Math.floor(side / W));
  for (let k = 0; k < 40 && c.tile !== far; k++) c.step(command(dir, 0, 0));
  check(c.tile === far || c.tile === door, `the player walks through their own door (${c.tile} for ${far})`);
  // (A save keeps every piece, the grids as they were; a damaged list made sound; one from before 2.67 loads with none.)
  const back = loadCity(JSON.parse(JSON.stringify(c.snapshot())))!;
  check(
    PIECES.every((_, k) => back.pieceAt[tiles[k]] === k + 1) && back.grid[tiles[PIECE.plankWall]] === 1 && back.zedGrid[door] === 1,
    'a save keeps them',
  );
  const bad = JSON.parse(JSON.stringify(c.snapshot()));
  bad.state.built[c.state.district].push([5, 99, 10, 1, 0], [tiles[0], 0, 10, 1, 0], [6, 0, 999, 1, 0], 'x');
  check(loadCity(bad)!.state.built[c.state.district].length === PIECES.length, 'a damaged list made sound');
  const old = JSON.parse(JSON.stringify(c.snapshot()));
  delete old.state.built;
  check(JSON.stringify(loadCity(old)!.state.built) === '{}', 'a save from before 2.67 loads with nothing built');
  say('the player walks through their own door; a save keeps every piece; a damaged one made sound; one from before 2.67 loads with none');
}

// ------------------------------------------------------------------ what's refused
{
  const c = city(3);
  const mid = openSquare(c);
  stock(c);
  const why = (kind: number, tile: number) => canBuild(c, kind, tile);
  const t = mid + 1;
  const res: string[] = [];
  c.state.inv[0] = [0, 0];
  res.push(`no hammer: ${why(PIECE.plankWall, t)}`);
  stock(c);
  c.state.inv[1] = [I('plank'), 1];
  res.push(`a plank short: ${why(PIECE.plankWall, t)}`);
  stock(c);
  stand(c, mid, t);
  res.push(`on the player: ${why(PIECE.barricade, mid)}`);
  const car = Array.from(c.carAt.keys()).find((i) => c.carAt[i]) ?? -1;
  res.push(`on a car: ${why(PIECE.barricade, car)}`);
  const gate = c.district.gates[0].tiles[0];
  const byGate = [gate + W, gate - W, gate + 1, gate - 1, gate + 2 * W, gate - 2 * W, gate + 2, gate - 2].find(
    (i) => i >= 0 && i < N && !c.grid[i] && !c.carAt[i],
  )!;
  res.push(`by a checkpoint: ${why(PIECE.barricade, byGate)}`);
  // (Beside a survivor and at the way out: the district they're in.)
  const P = c.story;
  const person = P.people[0];
  enter(c, person.district);
  stock(c);
  const byPerson = around(person.tile).find((i) => !c.grid[i] && !c.carAt[i]);
  res.push(`beside a survivor: ${byPerson === undefined ? 'none free' : why(PIECE.barricade, byPerson)}`);
  enter(c, P.wayDistrict[0]);
  stock(c);
  const byWay = [P.exits[0], ...around(P.exits[0])].find((i) => !c.grid[i] && !c.carAt[i] && !c.zedGrid[i]);
  res.push(`at the way out: ${byWay === undefined ? 'none free' : why(PIECE.barricade, byWay)}`);
  enter(c, TUNNEL);
  stock(c);
  res.push(`in the tunnel: ${why(PIECE.barricade, around(c.tile).find((i) => !c.grid[i]) ?? -1)}`);
  const want = ['hammer', 'parts', 'blocked', 'blocked', 'gate', 'people', 'story', 'here'];
  res.forEach((r, k) => check(r.endsWith(want[k]), `refused: ${r}, ${want[k]} wanted`));
  // (A district full: 120 pieces.)
  const d = city(4);
  const m = openSquare(d);
  d.state.built[d.state.district] = Array.from({ length: BUILD.most }, (_, k) => [k, PIECE.rug, 20, 1, 0]);
  stock(d);
  res.push(`a district with ${BUILD.most}: ${canBuild(d, PIECE.barricade, m + 1)}`);
  check(res[res.length - 1].endsWith('most'), 'a full district refused');
  // (The press refused says why, and starts nothing.)
  const e = city(5);
  const n = openSquare(e);
  e.state.inv = e.state.inv.map(() => [0, 0]);
  stand(e, n, n + 1);
  e.step(command(0, COP.BUILD, PIECE.barricade));
  check(
    e.events.some((v) => v.type === 'cantBuild' && v.why === 'hammer') && !e.state.search,
    'a press with no hammer: said, nothing begun',
  );
  say(`refused, and said: ${res.join('; ')}`);
}

// ------------------------------------------------------------------ a chest, a repair, taken down
{
  const c = city(6);
  const mid = openSquare(c);
  stock(c);
  const t = mid + 1;
  buildAt(c, PIECE.chest, t);
  stand(c, mid, t);
  c.step(command(0, COP.ACT, 0));
  check(c.state.open === `p${t}`, `the chest opens: ${c.state.open}`);
  // (Twelve slots: twelve different things stored, a thirteenth refused.)
  const things = ['tin', 'dried', 'water', 'soda', 'fruit', 'veg', 'chocolate', 'bandage', 'pills', 'tape', 'battery', 'bottle', 'fuel'];
  let stored = 0;
  for (const id of things) {
    c.state.inv[7] = [I(id), 1];
    c.step(command(0, COP.STORE, 7));
    if (c.events.some((e) => e.type === 'stored')) stored++;
  }
  check(stored === BUILD.chestSlots, `${stored} things in a chest of ${BUILD.chestSlots}`);
  // (Damaged, a repair: whole again for half of what it took, for the share worn away.)
  const p = c.state.built[c.state.district].find((q) => q[0] === t)!;
  p[2] = 10;
  const cost = repairCost(PIECES[PIECE.chest], 10);
  const planks = c.count(I('plank'));
  c.step(command(0, COP.BUILD, PIECE_OPS));
  run(c, BUILD.repairSteps + 1);
  check(p[2] === PIECES[PIECE.chest].hp && c.count(I('plank')) === planks - cost[0][1], `repaired to ${p[2]}, ${cost[0][1]} planks spent`);
  // (Never dearer than building it again.)
  check(
    PIECES.every((def) => repairCost(def, 1).every(([id, n]) => n <= (def.from.find(([j]) => j === id)?.[1] ?? 0))),
    'a repair never dearer than the piece',
  );
  // (Taken down: half of what it took, less for the damage; its things on the ground.)
  c.step(command(0, COP.ACT, 0));
  if (c.state.open !== `p${t}`) c.step(command(0, COP.ACT, 0));
  // (Room in the pockets for what comes back: the thirteenth thing refused by the chest is put away.)
  c.state.inv[7] = [0, 0];
  const nails = c.count(I('nails'));
  c.step(command(0, COP.BUILD, PIECE_OPS + 1));
  const ev = run(c, BUILD.downSteps + 1);
  check(ev.some((e) => e.type === 'unbuilt') && !c.pieceAt[t], 'taken down');
  const pile = c.state.boxes[`${c.state.district}:g${t}`] ?? [];
  check(pile.filter((st) => st[0]).length === BUILD.chestSlots, `its ${BUILD.chestSlots} things on the ground (${pile.length})`);
  check(c.count(I('nails')) === nails + Math.floor((2 * p[2]) / PIECES[PIECE.chest].hp / 2), 'half back, less for the damage');
  say(
    `a chest holds ${BUILD.chestSlots} things; a repair makes it whole for half of what it took for the share worn, never dearer than a new one; taken down, half of it back (less as worn) and its things on the ground`,
  );
}

// ------------------------------------------------------------------ the dead and what's built
{
  /** The player shut in by eight walls of a kind; one of the dead after them, four tiles off: the steps until it is through. */
  const shutIn = (seed: number, kind: number, brute: boolean, door = false): { steps: number; hp: number; pounded: boolean } => {
    const c = city(seed);
    const mid = openSquare(c);
    stock(c);
    const ring = new Set(ring8(mid));
    for (const t of ring8(mid)) {
      const k = door && t === mid + 1 ? PIECE.door : kind;
      check(buildAt(c, k, t, new Set([mid, ...ring])) > 0, `walls round the player (${t})`);
    }
    c.state.player = bodyAt(mid % W, Math.floor(mid / W));
    c.step(0);
    c.peace = false;
    c.state.zeds = [];
    const start = mid + 4;
    zed(c, start, brute ? ZKIND_BRUTE : undefined);
    c.state.energy = FULL;
    let pounded = false;
    let steps = 0;
    for (; steps < 6000; steps++) {
      c.state.zeds.forEach((z) => (z.seen = c.state.step));
      c.step(0);
      if (c.events.some((e) => e.type === 'pound')) pounded = true;
      if (c.events.some((e) => e.type === 'pieceDown')) break;
      // (Nothing else put down meanwhile: the one being measured alone.)
      c.state.zeds.splice(1);
    }
    return { steps, hp: PIECES[kind].hp, pounded };
  };
  const shambler = shutIn(7, PIECE.plankWall, false);
  const brute = shutIn(7, PIECE.plankWall, true);
  const barricade = shutIn(8, PIECE.barricade, false);
  const door = shutIn(9, PIECE.metalWall, false, true);
  check(shambler.pounded && shambler.steps < 6000, `a shambler pounds through a plank wall (${shambler.steps} steps)`);
  check(brute.steps < shambler.steps / 3, `a brute four times as fast (${brute.steps} against ${shambler.steps})`);
  check(barricade.steps < shambler.steps, `a barricade gives sooner (${barricade.steps})`);
  check(door.steps < 6000, `the weakest way in, a door among metal walls (${door.steps})`);
  // (A way round: it goes round, nothing pounded.)
  const c = city(10);
  const mid = openSquare(c);
  stock(c);
  for (const t of [mid - W - 1, mid - W, mid - W + 1]) buildAt(c, PIECE.plankWall, t, new Set([mid]));
  c.state.player = bodyAt(mid % W, Math.floor(mid / W));
  c.step(0);
  c.peace = false;
  c.state.zeds = [];
  zed(c, mid - 3 * W);
  let bitten = false;
  let pounded = false;
  for (let k = 0; k < 800 && !bitten; k++) {
    c.step(0);
    c.state.zeds.splice(1);
    if (c.events.some((e) => e.type === 'bite')) bitten = true;
    if (c.events.some((e) => e.type === 'pound')) pounded = true;
  }
  check(bitten && !pounded, `with a way round: round it (bitten ${bitten}, pounded ${pounded})`);
  say(
    `shut in by plank walls, one of the dead after them pounds through in ${(shambler.steps / 20).toFixed(0)} s (a brute ${(brute.steps / 20).toFixed(0)} s); a barricade ${(barricade.steps / 20).toFixed(0)} s; among metal walls, through the door in ${(door.steps / 20).toFixed(0)} s; with a way round, it goes round`,
  );
}

// ------------------------------------------------------------------ comfort, the campfire, a bench
{
  const c = city(11);
  const mid = openSquare(c);
  stock(c);
  const level = () => comfortAt(c, mid).level;
  const steps: string[] = [`nothing: ${level()}`];
  buildAt(c, PIECE.cot, mid + 1, new Set([mid]));
  steps.push(`a camp bed: ${level()}`);
  buildAt(c, PIECE.campfire, mid - 2, new Set([mid]));
  steps.push(`a campfire: ${level()}`);
  buildAt(c, PIECE.table, mid + 2 * W, new Set([mid]));
  buildAt(c, PIECE.rug, mid - 2 * W, new Set([mid]));
  steps.push(`a table and a rug: ${level()}`);
  check(level() === 2, 'a camp bed, a campfire, a table and a rug: a Home');
  // (Asleep: energy back faster in a Home than in the open.)
  const gain = (cc: City, at: number) => {
    cc.state.player = bodyAt(at % W, Math.floor(at / W));
    cc.state.energy = FULL / 4;
    cc.state.sleeping = true;
    cc.state.hunger = FULL;
    const was = cc.state.energy;
    run(cc, 20 * 60);
    cc.state.sleeping = false;
    return cc.state.energy - was;
  };
  const home = gain(c, mid);
  const bare = city(11);
  const open = gain(bare, openSquare(bare));
  check(home === Math.round(open * 1.5), `an hour asleep in a Home: ${home} against ${open}`);
  // (The campfire: a light that cooks, fed a plank.)
  const fire = (c.state.lights[c.state.district] ?? []).find((l) => l[0] === mid - 2);
  check(!!fire && fire[1] === LIGHT_KIND.CAMP, 'the campfire burns');
  stand(c, mid - 1, mid - 2);
  c.state.inv[6] = [I('tin'), 1];
  c.state.inv[7] = [I('veg'), 1];
  c.state.inv[5] = [I('water'), 1];
  const stew = CITY_RECIPES.findIndex((r) => r.makes === 'stew');
  check(c.canMake(stew) === 'ok', `a stew cooked at it: ${c.canMake(stew)}`);
  const was = fire![2];
  c.step(command(0, COP.ACT, 0));
  c.step(command(0, COP.BUILD, PIECE_OPS + 2));
  check(fire![2] === was + BUILD.feedMinutes * 20, 'a plank fed: four hours more');
  // (A workbench built works as any.)
  stand(c, mid + W, mid + 2 * W);
  const spear = CITY_RECIPES.findIndex((r) => r.makes === 'spear');
  check(c.canMake(spear) === 'bench' || c.canMake(spear) === 'parts', 'no bench yet');
  buildAt(c, PIECE.workbench, mid + W + 1, new Set([mid]));
  stand(c, mid + W, mid + W + 1);
  c.state.inv[5] = [I('pipe'), 1];
  c.state.inv[6] = [I('blade'), 1];
  c.state.inv[7] = [I('tape'), 1];
  check(c.canMake(spear) === 'ok', `a spear at the bench built: ${c.canMake(spear)}`);
  say(
    `comfort round a bed: ${steps.join(', ')} (0 the open, 1 a Hideout, 2 a Home); an hour asleep in a Home gives ${home / 1000} energy, in the open ${open / 1000}; a campfire cooks and takes a plank for four hours more; a workbench built works`,
  );
}

// ------------------------------------------------------------------ what the review found (2.67)
{
  const c = city(12);
  const mid = openSquare(c);
  stock(c);
  // (Standing in a doorway built, one of the dead at it: bitten as anywhere.)
  buildAt(c, PIECE.door, mid, new Set([mid + 1]));
  c.state.player = bodyAt(mid % W, Math.floor(mid / W));
  c.step(0);
  c.peace = false;
  c.state.zeds = [];
  zed(c, mid + 1);
  let bites = 0;
  for (let k = 0; k < 400; k++) {
    c.state.zeds.forEach((z) => (z.seen = c.state.step));
    c.step(0);
    c.state.zeds.splice(1);
    if (c.events.some((e) => e.type === 'bite')) bites++;
    if (c.state.over || c.events.some((e) => e.type === 'dead')) break;
  }
  c.peace = true;
  check(bites > 0, `in a doorway built: bitten ${bites} times`);
  // (A table or a barricade stops bodies, not sight; a wall stops both.)
  const d = city(13);
  const m = openSquare(d);
  stock(d);
  buildAt(d, PIECE.table, m + 1, new Set([m]));
  buildAt(d, PIECE.plankWall, m - 1, new Set([m]));
  const w = d.world as unknown as { parked: Uint8Array; propSolid: Uint8Array };
  check(
    d.grid[m + 1] === 1 && !w.parked[m + 1] && d.grid[m - 1] === 1 && w.parked[m - 1] === 1,
    'a table stops bodies, not sight; a wall both',
  );
  // (Never on a home tile, the district's own spot, or a chair.)
  const e = city(14);
  stock(e);
  const sp = e.district.spawn.z * W + e.district.spawn.x;
  const chair = Array.from(e.breakAt.keys()).find((i) => e.breakAt[i] && e.district.props[e.breakAt[i] - 1].kind === 'chair' && !e.grid[i]);
  e.state.home = [e.state.district, sp + 2];
  const refused = [
    canBuild(e, PIECE.barricade, sp),
    canBuild(e, PIECE.barricade, sp + 2),
    chair === undefined ? 'blocked' : canBuild(e, PIECE.chest, chair),
  ];
  check(
    refused.every((r) => r === 'blocked'),
    `on the spawn, home, a chair: ${refused.join(', ')}`,
  );
  // (A building forced with pieces built about: the dead's places as a load works them out.)
  const f = city(1);
  const fm = openSquare(f);
  stock(f);
  for (const t of [fm - 1, fm + 1, fm - W, fm + W]) buildAt(f, PIECE.barricade, t, new Set([fm]));
  const lock = Array.from(f.locked.keys()).find((i) => f.locked[i]);
  if (lock !== undefined) (f as unknown as { force(t: number): void }).force(lock);
  const back = loadCity(JSON.parse(JSON.stringify(f.snapshot())))!;
  check(
    back.zedPlaces.streets.length === f.zedPlaces.streets.length && back.zedPlaces.indoors.length === f.zedPlaces.indoors.length,
    `the dead's places as a load has them (${f.zedPlaces.streets.length}, ${back.zedPlaces.streets.length})`,
  );
  say(
    `in a doorway built, bitten as anywhere; a table or a barricade stops bodies, not sight, a wall both; nothing on the district's own spot, a home tile or a chair; a building forced with pieces about, the dead's places as a load has them`,
  );
}

// ------------------------------------------------------------------ the story's places
{
  let moved = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const c = city(seed);
    const before = JSON.stringify([c.story.things, c.story.notes, c.busNotes]);
    // (A rug on every open floor tile of the start district, walls on every tenth.)
    const d = c.state.district;
    c.state.built[d] = [];
    // (And walls broken through, a wall built in each hole.)
    const holes: number[] = [];
    for (let t = 0; t < N && holes.length < 30; t++) if (innerWall(c.baseOf(d), t, peopleLots(c, d))) holes.push(t);
    c.state.holes[d] = holes;
    for (const t of holes) c.state.built[d].push([t, PIECE.plankWall, 120, 1, 0]);
    for (let t = 0; t < N && c.state.built[d].length < BUILD.most; t += 3)
      if (!c.grid[t] && !c.carAt[t] && !holes.includes(t)) c.state.built[d].push([t, t % 2 ? PIECE.plankWall : PIECE.rug, 20, 1, 0]);
    const back = loadCity(JSON.parse(JSON.stringify(c.snapshot())))!;
    if (JSON.stringify([back.story.things, back.story.notes, back.busNotes]) !== before) moved++;
  }
  check(moved === 0, `the story's places moved by building in ${moved} cities`);
  say("building moves none of the story's places (8 cities, 120 pieces each, 30 of them in walls broken through)");
}

console.log(lines.join('\n'));
