/**
 * City Escape's breaking things (2.66, C5 batch 1, city/sim/salvage.ts): what breaks in twelve cities' districts (never the
 * story's furniture, never a survivor's building; the inner walls only between two floors of an ordinary building); a table
 * broken by real commands (the blows, the pile where it stood, the floor walked on, a save keeping it); each tool's blows on wood
 * and on metal (bare hands refused on metal, the crowbar never worn, a tired arm half); a car stripped (it stays, emptied, its
 * metal at the player's feet; an alarmed one sounds); an inner wall broken through with a sledgehammer (the button, the way
 * through, a save keeping it, a damaged save's hole dropped); work left by walking off or by a blow at one of the dead; the dead
 * hearing it; and a save from before 2.66.
 */
import { check } from './assert';
import { cityItem, cityItemNumber } from '../src/city/content/items';
import { BREAK_NOISE, SALVAGE, WALL_WORK } from '../src/city/content/salvage';
import { BLOW } from '../src/city/content/dead';
import { City, COP, loadCity, type CityEvent } from '../src/city/sim/City';
import { ZED, type Zed } from '../src/city/sim/dead';
import { innerWall, peopleLots, propSalvage } from '../src/city/sim/salvage';
import { notePlaces } from '../src/city/sim/story';
import { carTiles, isWreck, alarmCars } from '../src/city/sim/cars';
import { nearestDir } from '../src/sim/ai/path';
import { command } from '../src/sim/command';
import { bodyAt } from '../src/sim/systems/movement';
import { MAP_W } from '../src/sim/world/grid';
import { TUNNEL } from '../src/city/gen/tunnel';

const lines: string[] = [];
const say = (s: string) => lines.push(s);
const W = MAP_W;
const N = W * W;
const SEEDS = 12;
const item = cityItemNumber;
const BAT = item('bat');
const AXE = item('axe');
const SLEDGE = item('sledgehammer');
const KNIFE = item('knife');
const CROWBAR = item('crowbar');
const PLANK = item('plank');
const SCRAP = item('scrap');
const enter = (c: City, d: number) => (c as unknown as { enter(d: number): void }).enter(d);
const around = (t: number) => [t - W, t + 1, t + W, t - 1].filter((i) => i >= 0 && i < N && Math.abs((i % W) - (t % W)) <= 1);
/** Stood on a tile, facing another beside it. */
const stand = (c: City, tile: number, toward: number) => {
  // (Nobody about: one of the dead within three tiles makes the blow's button a swing.)
  c.state.zeds = [];
  c.state.player = bodyAt(
    tile % W,
    Math.floor(tile / W),
    nearestDir((toward % W) - (tile % W), Math.floor(toward / W) - Math.floor(tile / W)),
  );
  c.step(0);
};
const carry = (c: City, ...things: Array<[number, number]>) => {
  c.state.inv = c.state.inv.map(() => [0, 0]);
  things.forEach(([it, n], k) => (c.state.inv[k] = [it, n]));
};
const press = (c: City, op: number = COP.HIT): CityEvent[] => {
  c.step(command(0, op, 0));
  return [...c.events];
};
/** The work a press began, to its end: every event of it, and the steps it took. */
const work = (c: City, op: number = COP.HIT): { events: CityEvent[]; steps: number } => {
  const events = press(c, op);
  let steps = 1;
  for (; steps < 2000 && c.state.search.startsWith('b'); steps++) {
    c.step(0);
    events.push(...c.events);
  }
  return { events, steps };
};
const chops = (ev: CityEvent[]) => ev.filter((e) => e.type === 'chop').length;
const pile = (c: City, tile: number) => c.state.boxes[`${c.state.district}:g${tile}`] ?? [];
const has = (list: Array<[number, number]>, it: number) => list.filter((st) => st[0] === it).reduce((n, st) => n + st[1], 0);
/** A piece of a kind that breaks, here, with a free floor tile beside it: [its number, its tile, the tile to stand on]. */
function findPiece(c: City, kinds: readonly string[], skip = new Set<number>()): [number, number, number] | null {
  for (let t = 0; t < N; t++) {
    const k = c.breakAt[t] - 1;
    if (k < 0 || skip.has(k) || !kinds.includes(c.district.props[k].kind)) continue;
    const at = around(t).find((i) => !c.grid[i] && !c.breakAt[i] && !c.carAt[i]);
    if (at !== undefined) return [k, t, at];
  }
  return null;
}
const city = (seed: number) => {
  const c = new City(seed);
  c.peace = true;
  c.step(0);
  c.state.energy = 90_000;
  return c;
};

// ------------------------------------------------------------------ what breaks, in twelve cities
{
  const kinds = new Map<string, number>();
  let story = 0;
  let safe = 0;
  let walls = 0;
  let wallsBad = 0;
  let cars = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const c = city(seed);
    for (let d = 0; d < 9; d++) {
      enter(c, d);
      const seen = new Set<number>();
      for (let t = 0; t < N; t++) {
        const k = c.breakAt[t] - 1;
        if (k < 0 || seen.has(k)) continue;
        seen.add(k);
        const kind = c.district.props[k].kind;
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
        check(SALVAGE[kind] !== undefined, `a ${kind} breaks but has no salvage`);
      }
      // (Never the story's furniture, nor a note's, nor anything in a survivor's building.)
      for (const sp of [...c.story.things, ...notePlaces(c)])
        if (sp.district === d) {
          story++;
          check(!c.tilesOf(sp.prop).some((t) => c.breakAt[t]), `the story's furniture breaks (${seed}, ${d})`);
        }
      for (const lot of c.safeLots)
        c.district.props.forEach((p, k) => {
          if (c.district.lotAt[p.z * W + p.x] - 1 !== lot) return;
          safe++;
          check(!c.tilesOf(k).some((t) => c.breakAt[t]), `a survivor's furniture breaks (${seed}, ${d})`);
        });
      for (let t = 0; t < N; t++) {
        if (c.carAt[t] - 1 === t) cars++;
        if (!innerWall(c.district, t, c.safeLots)) continue;
        walls++;
        // (Between two floors of the one building: never its outside, never a door.)
        const lot = c.district.lotAt[t];
        const ok = (i: number) => c.district.lotAt[i] === lot && !'#y'.includes(c.district.rows[Math.floor(i / W)][i % W]);
        const x = t % W;
        if (!((x > 0 && x < W - 1 && ok(t - 1) && ok(t + 1)) || (ok(t - W) && ok(t + W)))) wallsBad++;
      }
    }
  }
  check(wallsBad === 0, `${wallsBad} inner walls not between two floors of one building`);
  check(story > 0 && safe > 0, 'the census saw the story and the survivors');
  const list = [...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`);
  say(
    `what breaks in ${SEEDS} cities (108 districts): ${list.join(', ')}; ${cars} cars and wrecks; ${walls} inner walls, every one between two floors of one building; none of the story's ${story} pieces nor of the ${safe} in survivors' buildings`,
  );
}

// ------------------------------------------------------------------ a table, by hand, by real commands
{
  const c = city(3);
  const found = findPiece(c, ['table']);
  check(!!found, 'a table in the start district');
  const [k, t, at] = found!;
  carry(c);
  stand(c, at, t);
  check(c.grid[t] === 1, 'a table stands in the way');
  const { events, steps } = work(c);
  const done = events.find((e) => e.type === 'wrecked');
  check(chops(events) === SALVAGE.table!.work, `bare hands: ${chops(events)} blows on a table`);
  check(!!done && done.type === 'wrecked' && done.what === 'prop' && done.tile === t, 'the table broken up');
  check(c.grid[t] === 0 && c.breakAt[t] === 0, 'its tile walked on');
  check((c.state.broken[c.state.district] ?? []).includes(k), 'kept as broken');
  check(has(pile(c, t), PLANK) >= 2 && c.state.open === `g${t}`, 'two planks where it stood, the pile open');
  check(c.state.boxes[`${c.state.district}:${k}`] === undefined, 'no box left of it');
  check(c.target()?.key !== String(k), 'the button no longer takes it');
  const back = loadCity(JSON.parse(JSON.stringify(c.snapshot())));
  check(
    !!back && back.grid[t] === 0 && back.breakAt[t] === 0 && (back.state.broken[back.state.district] ?? []).includes(k),
    'a save keeps it gone',
  );
  // (The noise: each blow heard as a blow is.)
  say(
    `a table broken with bare hands by the blow's button: ${chops(events)} blows in ${(steps / 20).toFixed(1)} s, two planks and what it held where it stood (${pile(
      c,
      t,
    )
      .filter((st) => st[0])
      .map(([it, n]) => `${cityItem(it)!.id}×${n}`)
      .join(' ')}), its tile walked on, a save keeping it gone`,
  );
}

// ------------------------------------------------------------------ the tools: blows on wood and on metal
{
  const c = city(5);
  const out: string[] = [];
  const skip = new Set<number>();
  /** Blows to break the first piece of these kinds, carrying this (a refusal: -1). */
  const blows = (kinds: string[], things: Array<[number, number]>, energy = 90_000): number => {
    for (let d = 0; d < 9; d++) {
      if (c.state.district !== d) enter(c, d);
      const f = findPiece(c, kinds, skip);
      if (!f) continue;
      skip.add(f[0]);
      carry(c, ...things);
      stand(c, f[2], f[1]);
      c.state.energy = energy;
      // (The piece's Break: the blow's button only swings at what nothing carried can break.)
      const { events } = work(c, COP.BREAK);
      if (events.some((e) => e.type === 'refused' && e.why === 'tooHard')) return -1;
      check(
        events.some((e) => e.type === 'wrecked'),
        `${kinds[0]} broken`,
      );
      return chops(events);
    }
    check(false, `no ${kinds.join('/')} anywhere`);
    return 0;
  };
  const wood = ['table'];
  const metal = ['freezer'];
  const cases: Array<[string, string[], Array<[number, number]>, number, number?]> = [
    ['fists, a table', wood, [], 4],
    ['a knife, a table', wood, [[KNIFE, 30]], 4],
    ['a bat, a table', wood, [[BAT, 40]], 2],
    ['an axe, a table', wood, [[AXE, 45]], 1],
    ['a sledgehammer, a table', wood, [[SLEDGE, 50]], 2],
    ['an axe tired, a table', wood, [[AXE, 45]], 2, 0],
    ['fists, a freezer', metal, [], -1],
    ['a knife, a freezer', metal, [[KNIFE, 30]], -1],
    ['a bat, a freezer', metal, [[BAT, 40]], 8],
    ['a crowbar, a freezer', metal, [[CROWBAR, 1]], 4],
    ['a sledgehammer, a freezer', metal, [[SLEDGE, 50]], 2],
    [
      'a bat and a sledgehammer, a freezer',
      metal,
      [
        [BAT, 40],
        [SLEDGE, 50],
      ],
      2,
    ],
  ];
  for (const [name, kinds, things, want, energy] of cases) {
    const n = blows(kinds, things, energy);
    check(n === want, `${name}: ${n} blows, ${want} wanted`);
    out.push(`${name} ${n < 0 ? 'refused' : n}`);
  }
  // (What strikes wears, a blow a blow; the crowbar never.)
  carry(c, [AXE, 45]);
  const f = findPiece(c, ['chair', 'table', 'crate', 'shelf', 'desk'], skip)!;
  stand(c, f[2], f[1]);
  work(c);
  check(c.state.inv[0][1] < 45, `the axe worn: ${c.state.inv[0][1]}`);
  const wore = 45 - c.state.inv[0][1];
  carry(c, [CROWBAR, 1]);
  const g = findPiece(c, ['chair', 'table', 'crate', 'shelf', 'desk'], new Set([...skip, f[0]]))!;
  stand(c, g[2], g[1]);
  work(c);
  check(c.state.inv[0][0] === CROWBAR && c.state.inv[0][1] === 1, 'the crowbar unworn');
  say(`blows to break: ${out.join('; ')}; the axe worn ${wore} by a piece, the crowbar never`);
}

// ------------------------------------------------------------------ a car stripped
{
  const c = city(7);
  let done = '';
  for (let d = 0; d < 9 && !done; d++) {
    enter(c, d);
    const alarmed = new Set(alarmCars(c));
    for (let t = 0; t < N && !done; t++) {
      if (c.carAt[t] - 1 !== t || isWreck(c, t)) continue;
      const tiles = carTiles(c, t);
      const at = tiles.flatMap(around).find((i) => !c.grid[i] && !tiles.includes(i) && !c.carAt[i]);
      if (at === undefined) continue;
      const beside = tiles.find((i) => around(at).includes(i))!;
      carry(c, [SLEDGE, 50]);
      stand(c, at, beside);
      const { events } = work(c);
      check(chops(events) === Math.ceil(SALVAGE.car!.work / 4), `a car: ${chops(events)} blows of a sledgehammer`);
      check((c.state.stripped[d] ?? []).includes(t), 'kept as stripped');
      check(
        tiles.every((i) => c.grid[i] === 1),
        'a stripped car still stands in the way',
      );
      check(has(pile(c, c.tile), SCRAP) >= 2, 'its scrap at the player’s feet');
      check((c.state.boxes[`${d}:c${t}`] ?? [1]).length === 0, 'its box searched and empty');
      check(alarmed.has(t) === events.some((e) => e.type === 'alarm' && e.on), 'an alarmed car sounds as it is broken into');
      // (Nothing more to break off it: the blow goes into the air.)
      c.close();
      stand(c, at, beside);
      c.state.swung = -9999;
      const again = press(c);
      check(!c.state.search && again.some((e) => e.type === 'swing'), 'a stripped car breaks no more');
      const back = loadCity(JSON.parse(JSON.stringify(c.snapshot())));
      check(!!back && (back.state.stripped[d] ?? []).includes(t), 'a save keeps it stripped');
      done = `a car stripped by a sledgehammer: ${chops(events)} blows, scrap and wire at the player's feet with what it held, still standing in the street, searched and empty, a save keeping it`;
    }
  }
  check(!!done, 'a car to strip');
  say(done);
}

// ------------------------------------------------------------------ an inner wall
{
  const c = city(9);
  let done = '';
  for (let d = 0; d < 9 && !done; d++) {
    if (d === TUNNEL) continue;
    enter(c, d);
    for (let t = 0; t < N && !done; t++) {
      if (!innerWall(c.district, t)) continue;
      // (Stood where nothing else takes the button: the wall comes after everything else.)
      carry(c, [SLEDGE, 50]);
      const at = around(t).find((i) => {
        if (c.grid[i]) return false;
        stand(c, i, t);
        return c.target()?.kind === 'wall';
      });
      if (at === undefined) continue;
      carry(c);
      stand(c, at, t);
      const without = c.target();
      carry(c, [SLEDGE, 50]);
      stand(c, at, t);
      const tg = c.target();
      // (A blow swung at the air never starts on a wall.)
      c.state.swung = -9999;
      press(c);
      check(!c.state.search, 'the blow never starts on a wall');
      stand(c, at, t);
      check(without?.kind !== 'wall', 'without a sledgehammer, no wall to break');
      check(tg?.kind === 'wall' && tg.tile === t, `with one, the button breaks the wall: ${tg?.kind}`);
      const { events } = work(c, COP.ACT);
      check(chops(events) === WALL_WORK / 4, `a wall: ${chops(events)} blows`);
      check(
        events.some((e) => e.type === 'wrecked' && e.what === 'wall'),
        'the wall through',
      );
      check(c.grid[t] === 0 && (c.state.holes[d] ?? []).includes(t), 'walked through, kept');
      check(c.state.inv[0][1] === 50 - WALL_WORK / 4, 'the sledgehammer worn a blow a blow');
      const back = loadCity(JSON.parse(JSON.stringify(c.snapshot())));
      check(!!back && back.grid[t] === 0, 'a save keeps the hole');
      // (A hole where no inner wall stands, a damaged save: dropped.)
      const bad = JSON.parse(JSON.stringify(c.snapshot()));
      const outer = c.district.lots.find((l) => l.doors.length)!;
      bad.state.holes[d] = [t, outer.z0 * W + outer.x0];
      const healed = loadCity(bad);
      check(!!healed && healed.state.holes[d].length === 1 && healed.state.holes[d][0] === t, 'a damaged save keeps only true holes');
      done = `an inner wall: the action button breaks it with a sledgehammer carried (not without, never the blow's button), ${chops(events)} blows, walked through and kept; a save's hole in an outer wall dropped`;
    }
  }
  check(!!done, 'an inner wall to break');
  say(done);
}

// ------------------------------------------------------------------ work left, and heard
{
  const c = city(11);
  const f = findPiece(c, ['table', 'shelf', 'desk', 'bed', 'crate', 'counter'])!;
  carry(c);
  stand(c, f[2], f[1]);
  press(c);
  for (let k = 0; k < 15; k++) c.step(0);
  check(c.state.search.startsWith('b'), 'at work');
  c.step(command(nearestDir((f[2] % W) - (f[1] % W), Math.floor(f[2] / W) - Math.floor(f[1] / W)), 0, 0));
  check(!c.state.search && c.breakAt[f[1]] > 0, 'walked off: the work left, the piece still there');
  // (A blow at one of the dead in reach: the work is left for it.)
  c.peace = false;
  c.state.zeds = [];
  stand(c, f[2], f[1]);
  press(c);
  c.step(0);
  const z: Zed = {
    body: bodyAt(f[2] % W, Math.floor(f[2] / W)),
    hp: 30,
    mode: ZED.WANDER,
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
  c.state.swung = -9999;
  press(c);
  check(!c.state.search, 'a blow at one of the dead leaves the work');
  // (Heard: one wandering within reach goes to look.)
  c.state.zeds = [];
  stand(c, f[2], f[1]);
  const far = f[2] + 5;
  const y: Zed = { ...z, body: bodyAt(far % W, Math.floor(far / W)), mode: ZED.WANDER, goal: -1 };
  c.state.zeds.push(y);
  c.state.swung = -9999;
  press(c);
  c.step(0);
  c.peace = true;
  check(y.mode === ZED.SEEK && y.goal === c.tile, `one of the dead five tiles off comes to look: mode ${y.mode}`);
  say(
    `walking off leaves the work and the piece; a blow at one of the dead leaves it too; every blow heard (${BREAK_NOISE.wood} tiles on wood, ${BREAK_NOISE.metal} on metal, ${BREAK_NOISE.wall} a wall; a blow at the dead ${BLOW.noise})`,
  );
}

// ------------------------------------------------------------------ what the review found (2.66)
{
  // (A hole in every inner wall and every piece broken that can be: the story's things and notes stay where they were.)
  let moved = 0;
  let cities = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const c = city(seed);
    const before = JSON.stringify([c.story.things, c.story.notes, c.busNotes]);
    for (let d = 0; d < 9; d++) {
      const base = c.baseOf(d);
      const safe = peopleLots(c, d);
      const holes: number[] = [];
      for (let t = 0; t < N; t++) if (innerWall(base, t, safe)) holes.push(t);
      c.state.holes[d] = holes;
      c.state.broken[d] = base.props.map((_, k) => k).filter((k) => propSalvage(c, k, d) !== null);
    }
    const back = loadCity(JSON.parse(JSON.stringify(c.snapshot())))!;
    if (JSON.stringify([back.story.things, back.story.notes, back.busNotes]) !== before) moved++;
    cities++;
  }
  check(moved === 0, `the story's places moved in ${moved} cities of ${cities} by what was broken`);
  // (Never a survivor's walls.)
  let theirs = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const c = city(seed);
    for (const p of c.story.people) {
      const dist = c.baseOf(p.district);
      for (let t = 0; t < N; t++) if (dist.lotAt[t] - 1 === p.lot && innerWall(dist, t, peopleLots(c, p.district))) theirs++;
    }
  }
  check(theirs === 0, `${theirs} inner walls breakable in survivors' buildings`);
  // (The tunnel's broken things stay broken over a load.)
  const c = city(4);
  c.state.broken[TUNNEL] = [0, 1];
  const back = loadCity(JSON.parse(JSON.stringify(c.snapshot())))!;
  check(
    JSON.stringify(back.state.broken[TUNNEL]) === '[0,1]',
    `the tunnel's broken pieces over a load: ${JSON.stringify(back.state.broken[TUNNEL])}`,
  );
  // (A home on a broken piece's tile, the player gone to another district, kept over a load.)
  const h = city(6);
  const f = findPiece(h, ['table', 'desk', 'crate', 'shelf'])!;
  carry(h);
  stand(h, f[2], f[1]);
  work(h);
  const d0 = h.state.district;
  h.state.home = [d0, f[1]];
  enter(h, d0 === 0 ? 1 : 0);
  const hb = loadCity(JSON.parse(JSON.stringify(h.snapshot())))!;
  check(hb.state.home[0] === d0 && hb.state.home[1] === f[1], `a home where a piece stood kept: ${hb.state.home}`);
  // (A damaged save that lists the story's furniture as broken: it stands.)
  const sp = c.story.things[0];
  const bad = JSON.parse(JSON.stringify(c.snapshot()));
  bad.state.broken = { [sp.district]: [sp.prop] };
  check(!(loadCity(bad)!.state.broken[sp.district] ?? []).includes(sp.prop), 'the story furniture never hidden by a save');
  // (The blow's button: one of the dead two tiles off, or nothing that can break it carried: a swing, nothing begun, nothing said.)
  const g = city(8);
  const q = findPiece(g, ['freezer', 'bin', 'vending'])!;
  carry(g);
  stand(g, q[2], q[1]);
  g.state.swung = -9999;
  const ev = press(g);
  check(!g.state.search && !ev.some((e) => e.type === 'refused') && ev.some((e) => e.type === 'swing'), 'bare hands at metal: a swing');
  const t2 = findPiece(g, ['table', 'desk', 'crate', 'shelf', 'chair'])!;
  stand(g, t2[2], t2[1]);
  g.state.zeds = [];
  const zx = (t2[2] % W) + (t2[2] % W > 2 ? -2 : 2);
  g.state.zeds.push({
    body: bodyAt(zx, Math.floor(t2[2] / W)),
    hp: 30,
    mode: ZED.WANDER,
    goal: -1,
    path: [],
    seen: -9999,
    last: -1,
    bit: -9999,
    reel: 0,
    near: 0,
    pace: 1000,
  });
  g.state.swung = -9999;
  press(g);
  check(!g.state.search, 'one of the dead two tiles off: a swing to meet it');
  say(
    `breaking every piece and every inner wall moves none of the story's places (${cities} cities); no survivor's wall breaks; the tunnel's broken things and a home where a piece stood kept over a load; a save can't hide the story's furniture; the blow's button swings with one of the dead within three tiles, or at what nothing carried breaks`,
  );
}

// ------------------------------------------------------------------ a save from before 2.66
{
  const c = city(2);
  const old = JSON.parse(JSON.stringify(c.snapshot()));
  delete old.state.broken;
  delete old.state.stripped;
  delete old.state.holes;
  const back = loadCity(old);
  check(
    !!back && JSON.stringify([back.state.broken, back.state.stripped, back.state.holes]) === '[{},{},{}]',
    'an old save loads with nothing broken',
  );
  const odd = JSON.parse(JSON.stringify(c.snapshot()));
  odd.state.broken = { 0: [-1, 'x', 3], x: [1] };
  check(JSON.stringify(loadCity(odd)?.state.broken) === '{"0":[3]}', 'a damaged list made sound');
  say('a save from before 2.66 loads with nothing broken; a damaged one is made sound');
}

console.log(lines.join('\n'));
