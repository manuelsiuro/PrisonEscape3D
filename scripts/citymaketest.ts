/**
 * City Escape's shelters and making (C2c): every recipe (its parts found somewhere in the city, made
 * from the pockets, refused without them, without a workbench beside or a stove carried), a weapon's
 * blows running out, a street door barred with boards and taken down again, a building with every door
 * barred a shelter the dead neither walk into nor are put down in, a night slept in one against the
 * same night with its doors open, and a save carrying the barred doors.
 */
import { check } from './assert';
import { CITY_ITEMS, cityItem, cityItemNumber } from '../src/city/content/items';
import { LOOT_BY_PROP, LOOT_BY_USE } from '../src/city/content/loot';
import { CITY_RECIPES, recipeParts } from '../src/city/content/recipes';
import { BAR_STEPS, City, COP, FULL, loadCity, type Stack } from '../src/city/sim/City';
import { ZED } from '../src/city/sim/dead';
import { findPath, nearestDir } from '../src/sim/ai/path';
import { command } from '../src/sim/command';
import { bodyAt } from '../src/sim/systems/movement';
import { MAP_W } from '../src/sim/world/grid';

const lines: string[] = [];
const say = (s: string) => lines.push(s);
const MIN = 20;
const N = (id: string) => cityItemNumber(id);
const empty = (c: City) => {
  for (const st of c.state.inv) st[0] = st[1] = 0;
};
const give = (c: City, list: Array<[string, number]>) => {
  empty(c);
  list.forEach(([id, n], k) => (c.state.inv[k] = [N(id), cityItem(N(id))?.wear ?? n] as Stack));
};
const has = (c: City, id: string) => c.count(N(id));
const stand = (c: City, tile: number) => {
  c.state.player = bodyAt(tile % MAP_W, Math.floor(tile / MAP_W));
  c.step(0);
};
const beside = (c: City, tiles: number[]) => tiles.flatMap((i) => [i - 1, i + 1, i - MAP_W, i + MAP_W]).find((i) => !c.grid[i]);

// ------------------------------------------------------------------ the recipes
{
  const found = new Set<string>();
  for (const list of [...Object.values(LOOT_BY_USE), ...Object.values(LOOT_BY_PROP)]) for (const [id] of list ?? []) found.add(id);
  const made = new Set(CITY_RECIPES.map((r) => r.makes));
  for (const r of CITY_RECIPES) {
    check(!!cityItem(N(r.makes)), `${r.makes} is no item`);
    for (const [id, n] of r.from) {
      check(found.has(id) || made.has(id), `${r.makes} takes ${id}, found nowhere and made by nothing`);
      check(n >= 1 && n <= (cityItem(N(id))?.wear !== undefined ? 1 : cityItem(N(id))!.stack * 2), `${r.makes} takes ${n} ${id}`);
    }
    check(
      r.from.reduce((k, [, n]) => k + (cityItem(N(r.from[0][0]))?.wear !== undefined ? 1 : n), 0) <= 8,
      `${r.makes} takes more than the pockets hold`,
    );
  }
  for (const d of CITY_ITEMS) check(found.has(d.id) || made.has(d.id), `${d.id} is found nowhere and made by nothing`);

  const c = new City(2);
  c.peace = true;
  c.step(0);
  const bench = c.district.props.findIndex((p, k) => p.kind === 'workbench' && beside(c, c.tilesOf(k)) !== undefined);
  check(bench >= 0, 'seed 2 start: a workbench to stand beside');
  const atBench = beside(c, c.tilesOf(bench))!;
  const street = c.tile;
  const done: string[] = [];
  CITY_RECIPES.forEach((r, k) => {
    // Without its parts: refused, nothing taken.
    stand(c, street);
    give(
      c,
      r.from.slice(1).map(([id, n]) => [id, n]),
    );
    c.step(command(0, COP.MAKE, k));
    check(c.events.some((e) => e.type === 'cantMake' && e.why === 'parts') && !has(c, r.makes), `${r.makes} made without ${r.from[0][0]}`);
    // With them, but not what it needs beside: refused, the parts kept.
    give(
      c,
      r.from.map(([id, n]) => [id, n]),
    );
    if (r.bench || r.stove) {
      c.step(command(0, COP.MAKE, k));
      check(
        c.events.some((e) => e.type === 'cantMake' && e.why === (r.bench ? 'bench' : 'stove')) && r.from.every(([id]) => has(c, id) > 0),
        `${r.makes} made with no ${r.bench ? 'workbench' : 'stove'}`,
      );
    }
    if (r.bench) stand(c, atBench);
    if (r.stove) c.state.inv[7] = [N('stove'), 1];
    c.step(command(0, COP.MAKE, k));
    const { makes, from } = recipeParts(r);
    check(
      c.events.some((e) => e.type === 'made' && e.item === makes),
      `${r.makes} should be made: ${JSON.stringify(c.events)}`,
    );
    check(
      from.every(([item]) => item === makes || c.count(item) === 0),
      `${r.makes}: its parts should be gone`,
    );
    const got = c.state.inv.find((st) => st[0] === makes)!;
    check(!!got && got[1] === (cityItem(makes)?.wear ?? r.n), `${r.makes}: ${got?.[1]} in the pocket`);
    done.push(`${r.makes}${r.bench ? ' (bench)' : r.stove ? ' (stove)' : ''}`);
  });
  // Pockets full of what a recipe doesn't take: the thing made lies underfoot.
  stand(c, street);
  give(c, [
    ['cloth', 2],
    ['tape', 1],
    ['tin', 3],
    ['water', 3],
    ['soda', 3],
    ['fruit', 3],
    ['veg', 3],
    ['dried', 3],
  ]);
  c.state.inv[0][1] = 4;
  c.state.inv[1][1] = 2;
  c.step(command(0, COP.MAKE, 0));
  check(
    has(c, 'bandage') === 0 && c.state.boxes[`${c.state.district}:g${c.tile}`]?.some((st) => st[0] === N('bandage')),
    'made with no room: on the ground underfoot',
  );
  say(`${CITY_RECIPES.length} recipes, each refused without its parts and made with them: ${done.join(', ')}`);
  say('every part is found somewhere in the city or made; a thing made with no room in the pockets lies underfoot');
}

// ------------------------------------------------------------------ a weapon's blows
{
  const c = new City(4);
  c.step(0);
  c.state.zeds = [];
  give(c, [['bat', 1]]);
  check(c.state.inv[0][1] === cityItem(N('bat'))!.wear, 'a bat made or given has all its blows');
  c.state.inv[0][1] = 2;
  const p = c.state.player;
  const east = nearestDir(1, 0);
  p.facing = east;
  const zed = () => ({
    body: bodyAt((c.tile % MAP_W) + 1, Math.floor(c.tile / MAP_W)),
    hp: 500,
    mode: ZED.IDLE,
    goal: -1,
    path: [],
    seen: -9999,
    last: -1,
    bit: -9999,
    reel: 0,
    near: 0,
    pace: 1000,
  });
  c.state.zeds = [zed()];
  let broke = 0;
  let hits = 0;
  for (let k = 0; k < 60; k++) {
    c.state.zeds[0].body = zed().body;
    c.state.health = 100;
    c.step(command(0, COP.HIT));
    for (const e of c.events) {
      if (e.type === 'swing' && e.hit) hits++;
      if (e.type === 'broke') broke = hits;
    }
  }
  check(broke === 2 && c.state.inv[0][0] === 0, `a bat with two blows left breaks on the second: ${broke}`);
  // (Misses cost it nothing.)
  give(c, [['knife', 1]]);
  c.state.zeds = [];
  const before = c.state.inv[0][1];
  for (let k = 0; k < 40; k++) c.step(command(0, COP.HIT));
  check(c.state.inv[0][1] === before, 'a blow at the air wears nothing');
  say('a weapon loses a blow each time it lands and breaks at none; found, it has between half and all of them left');
}

// ------------------------------------------------------------------ doors barred, a shelter
{
  const c = new City(1);
  c.step(0);
  c.state.zeds = [];
  // A house with a bed.
  const lot = c.district.lots.findIndex(
    (l) =>
      l.use === 'house' &&
      l.doors.length > 0 &&
      c.district.props.some((p) => p.kind === 'bed' && c.district.lotAt[p.z * MAP_W + p.x] - 1 === c.district.lots.indexOf(l)),
  );
  const house = c.district.lots[lot];
  const door = house.doors[0];
  const inside = [door - 1, door + 1, door - MAP_W, door + MAP_W].find((i) => c.district.lotAt[i] - 1 === lot && !c.grid[i])!;
  const outside = [door - 1, door + 1, door - MAP_W, door + MAP_W].find((i) => c.district.lotAt[i] - 1 !== lot && !c.grid[i])!;
  stand(c, inside);
  c.state.player.facing = nearestDir((door % MAP_W) - (inside % MAP_W), Math.floor(door / MAP_W) - Math.floor(inside / MAP_W));
  empty(c);
  check(c.target()?.kind !== 'door', 'no boards: the door is no target');
  give(c, [['boards', house.doors.length]]);
  check(c.target()?.kind === 'door' && c.target()?.tile === door, `with boards, the door beside is: ${JSON.stringify(c.target())}`);
  c.step(command(0, COP.ACT));
  check(
    c.events.some((e) => e.type === 'barring' && e.on),
    'the work begins',
  );
  let steps = 0;
  while (!c.events.some((e) => e.type === 'barred') && steps++ < 200) c.step(0);
  check(
    steps === BAR_STEPS && c.bars.includes(door) && has(c, 'boards') === house.doors.length - 1,
    `barred in ${steps} steps, a set of boards spent`,
  );
  check(!c.grid[door] && c.zedGrid[door] === 1, 'the player still walks through their door; the dead do not');
  check(
    findPath(c.world, outside, (i) => i === inside, inside, 4096, undefined, c.zedGrid) === null || house.doors.length > 1,
    'no way in for the dead through a barred door',
  );
  // The other doors, each from inside.
  for (const d of house.doors.slice(1)) {
    const by = [d - 1, d + 1, d - MAP_W, d + MAP_W].find((i) => c.district.lotAt[i] - 1 === lot && !c.grid[i])!;
    stand(c, by);
    c.state.player.facing = nearestDir((d % MAP_W) - (by % MAP_W), Math.floor(d / MAP_W) - Math.floor(by / MAP_W));
    c.step(command(0, COP.ACT));
    for (let k = 0; k <= BAR_STEPS; k++) c.step(0);
  }
  check(c.shelter(lot) && c.lot === lot, 'every door barred: a shelter');
  check(
    findPath(c.world, outside, (i) => i === inside, inside, 4096, undefined, c.zedGrid) === null,
    'the dead have no way into a shelter',
  );
  // A save carries them; taken down, the boards come back.
  const loaded = loadCity(JSON.parse(JSON.stringify(c.snapshot())))!;
  check(loaded.shelter(lot) && loaded.zedGrid[door] === 1, 'a save carries the barred doors');
  stand(c, inside);
  c.state.player.facing = nearestDir((door % MAP_W) - (inside % MAP_W), Math.floor(door / MAP_W) - Math.floor(inside / MAP_W));
  const had = has(c, 'boards');
  check(c.target()?.kind === 'door', 'a barred door is a target with no boards in hand too');
  c.step(command(0, COP.ACT));
  for (let k = 0; k <= BAR_STEPS; k++) c.step(0);
  check(
    !c.bars.includes(door) && has(c, 'boards') === had + 1 && !c.shelter(lot),
    'taken down: the boards back in the pockets, no shelter any more',
  );
  say(
    `a street door is barred in ${BAR_STEPS / 20} seconds with a set of boards (the player still walks through, the dead don't); every door barred makes a shelter; taken down, the boards come back; a save carries it`,
  );
}

// ------------------------------------------------------------------ a night in a shelter, and the same with the doors open
{
  const night = (seed: number, barred: boolean) => {
    const c = new City(seed);
    c.step(0);
    const lots = c.district.lots;
    const lot = lots.findIndex(
      (l, k) =>
        l.use === 'house' &&
        l.doors.length > 0 &&
        c.district.props.some((p) => p.kind === 'bed' && c.district.lotAt[p.z * MAP_W + p.x] - 1 === k),
    );
    const bed = c.district.props.findIndex(
      (p, k) => p.kind === 'bed' && c.district.lotAt[p.z * MAP_W + p.x] - 1 === lot && beside(c, c.tilesOf(k)) !== undefined,
    );
    if (barred) c.state.bars[c.state.district] = [...lots[lot].doors];
    c.rebar();
    // To 20:55, into bed (the dead already indoors there, if any, put out: the player cleared the house).
    c.state.step += ((20 * 60 + 55 - c.minute + 1440) % 1440) * MIN;
    c.state.zeds = c.state.zeds.filter(
      (z) => c.district.lotAt[Math.floor(z.body.z / 1024) * MAP_W + Math.floor(z.body.x / 1024)] - 1 !== lot,
    );
    c.state.boxes[`${c.state.district}:${bed}`] = [];
    stand(c, beside(c, c.tilesOf(bed))!);
    c.state.hunger = FULL;
    c.state.energy = 30_000;
    const tiles = c.tilesOf(bed);
    const at = tiles.find(
      (i) => Math.abs((i % MAP_W) - (c.tile % MAP_W)) + Math.abs(Math.floor(i / MAP_W) - Math.floor(c.tile / MAP_W)) === 1,
    )!;
    c.state.player.facing = nearestDir((at % MAP_W) - (c.tile % MAP_W), Math.floor(at / MAP_W) - Math.floor(c.tile / MAP_W));
    c.step(command(0, COP.ACT));
    let bites = 0;
    let woken = 0;
    let most = 0;
    for (let k = 0; k < 9 * 60 * MIN && c.minute !== 6 * 60 + 5; k++) {
      // (Woken by a bite, they go back to sleep: the night is counted whole.)
      c.step(c.state.sleeping ? 0 : command(0, COP.ACT));
      c.state.health = 100;
      most = Math.max(most, c.state.zeds.length);
      for (const e of c.events) {
        if (e.type === 'bite') bites++;
        if (e.type === 'sleep' && e.why === 'attacked') woken++;
      }
    }
    return { bites, woken, most };
  };
  let safe = 0;
  let open = 0;
  let wokenOpen = 0;
  let most = 0;
  const SEEDS = 12;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const a = night(seed, true);
    check(a.bites === 0 && a.woken === 0, `seed ${seed}: bitten ${a.bites} times in a shelter`);
    if (!a.bites) safe++;
    const b = night(seed, false);
    open += b.bites;
    wokenOpen += b.woken ? 1 : 0;
    most = Math.max(most, a.most);
  }
  say(
    `a first night asleep in a house, ${SEEDS} cities: its doors barred, bitten in ${SEEDS - safe} (up to ${most} of the dead about); its doors open, woken by a bite in ${wokenOpen}, ${open} bites in all`,
  );
}

// ------------------------------------------------------------------ what the review found (2.47)
{
  const c = new City(1);
  c.step(0);
  c.state.zeds = [];
  const lot = c.district.lots.findIndex((l) => l.use === 'house' && l.doors.length === 1);
  const door = c.district.lots[lot].doors[0];
  const inside = [door - 1, door + 1, door - MAP_W, door + MAP_W].find((i) => c.district.lotAt[i] - 1 === lot && !c.grid[i])!;
  const outside = [door - 1, door + 1, door - MAP_W, door + MAP_W].find((i) => c.district.lotAt[i] - 1 !== lot && !c.grid[i])!;
  const face = () =>
    (c.state.player.facing = nearestDir((door % MAP_W) - (inside % MAP_W), Math.floor(door / MAP_W) - Math.floor(inside / MAP_W)));
  // A press on the very step the work ends doesn't begin the opposite.
  stand(c, inside);
  face();
  give(c, [['boards', 1]]);
  c.step(command(0, COP.ACT));
  for (let k = 0; k < BAR_STEPS - 1; k++) c.step(0);
  c.step(command(0, COP.ACT));
  check(
    c.events.some((e) => e.type === 'barred') && !c.events.some((e) => e.type === 'barring') && c.state.search === '',
    'a press on the step the door is barred begins nothing',
  );
  for (let k = 0; k < BAR_STEPS + 2; k++) c.step(0);
  check(c.bars.includes(door), 'and the door stays barred');
  // The dead don't see through a barred door.
  const z = {
    body: bodyAt(outside % MAP_W, Math.floor(outside / MAP_W)),
    hp: 30,
    mode: ZED.IDLE,
    goal: -1,
    path: [],
    seen: -9999,
    last: -1,
    bit: -9999,
    reel: 0,
    near: 0,
    pace: 1000,
  };
  c.state.zeds = [z];
  for (let k = 0; k < 60; k++) c.step(0);
  check(c.state.zeds[0].mode !== ZED.CHASE, 'one of the dead outside a barred door does not see the player behind it');
  // Nothing is barred with one of them standing in the doorway.
  c.state.bars[c.state.district] = [];
  c.rebar();
  c.state.zeds = [{ ...z, body: bodyAt(door % MAP_W, Math.floor(door / MAP_W)), hp: 9999 }];
  give(c, [['boards', 1]]);
  face();
  c.step(command(0, COP.ACT));
  let refused = false;
  for (let k = 0; k <= BAR_STEPS; k++) {
    c.state.zeds[0].body = bodyAt(door % MAP_W, Math.floor(door / MAP_W));
    c.state.zeds[0].mode = ZED.IDLE;
    c.state.health = 100;
    c.step(0);
    if (c.events.some((e) => e.type === 'refused' && e.why === 'doorway')) refused = true;
  }
  check(refused && !c.bars.includes(door) && has(c, 'boards') === 1, 'one of the dead in the doorway: nothing barred, the boards kept');

  // One weapon strikes: the strongest; a spear beside it lends no reach and takes no wear.
  c.state.zeds = [];
  give(c, [
    ['nail_bat', 1],
    ['spear', 1],
  ]);
  const east = nearestDir(1, 0);
  const [d2, run] = (() => {
    const w = new City(4);
    w.step(0);
    w.state.zeds = [];
    let best: number[] = [];
    for (let zz = 1; zz < 63; zz++) {
      let r: number[] = [];
      for (let x = 1; x < 63; x++) {
        const i = zz * MAP_W + x;
        if (w.zedStreet[i]) r.push(i);
        else {
          if (r.length > best.length) best = r;
          r = [];
        }
      }
    }
    return [w, best] as const;
  })();
  const blow = (weapons: Array<[string, number]>, tiles: number) => {
    stand(d2, run[0]);
    d2.state.zeds = [{ ...z, body: bodyAt(run[tiles] % MAP_W, Math.floor(run[tiles] / MAP_W)), hp: 9999, mode: ZED.IDLE }];
    give(d2, weapons);
    d2.state.player.facing = east;
    d2.state.swung = -9999;
    d2.step(command(0, COP.HIT));
    return d2.events.some((e) => e.type === 'swing' && e.hit);
  };
  check(
    !blow([['nail_bat', 1]], 2) &&
      !blow(
        [
          ['nail_bat', 1],
          ['spear', 1],
        ],
        2,
      ),
    'a spear in the pockets lends the nailed bat no reach',
  );
  check(blow([['spear', 1]], 2), 'a spear alone reaches two tiles');
  blow(
    [
      ['nail_bat', 1],
      ['spear', 1],
    ],
    1,
  );
  check(
    d2.state.inv[0][1] === 49 && d2.state.inv[1][1] === 35,
    `the weapon that strikes wears, the other doesn't: ${d2.state.inv[0][1]} and ${d2.state.inv[1][1]}`,
  );
  // Of two bats, the nailed bat is made from the most worn.
  give(c, [
    ['bat', 1],
    ['bat', 1],
    ['nails', 2],
    ['tape', 1],
  ]);
  c.state.inv[0][1] = 38;
  c.state.inv[1][1] = 1;
  c.step(command(0, COP.MAKE, 2));
  check(
    c.state.inv.some((st) => st[0] === N('bat') && st[1] === 38) && has(c, 'nail_bat') === 1,
    'the nailed bat is made from the more worn of two bats',
  );
  // A save from before wear: its weapons have their blows.
  const old = JSON.parse(JSON.stringify(c.snapshot()));
  delete old.state.bars;
  old.state.inv[0] = [N('knife'), 1];
  const from = loadCity(old)!;
  check(
    from.state.inv[0][1] === cityItem(N('knife'))!.wear,
    `a weapon in a save from before wear has all its blows: ${from.state.inv[0][1]}`,
  );
  // Damaged bars: not doors, twice, not a record.
  const bad = JSON.parse(JSON.stringify(c.snapshot()));
  bad.state.bars = { [c.state.district]: [door, door, 5], x: [1] };
  check(
    JSON.stringify(loadCity(bad)!.state.bars) === JSON.stringify({ [c.state.district]: [door] }),
    'a save keeps barred only what are street doors, once each',
  );
  bad.state.bars = null;
  check(!!loadCity(bad) && Object.keys(loadCity(bad)!.state.bars).length === 0, 'bars that are no record: none, the save still loads');
  say(
    'a press as the work ends begins nothing; boards stop sight; nothing is barred with one of the dead in the doorway; one weapon strikes (the strongest), alone to wear; the nailed bat takes the more worn bat; old and damaged saves load sound',
  );
}

console.log(lines.join('\n'));
