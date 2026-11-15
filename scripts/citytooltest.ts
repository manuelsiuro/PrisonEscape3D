/**
 * City Escape's crowbar and bolt cutters, and the rules gone over with them (2.58, city/sim/tools.ts):
 * the chained buildings of twelve cities (which, never the story's, shut to the player and the dead,
 * what they hold), a door forced by ordinary commands; the fences that can be cut, one cut and walked
 * through from both sides, the journal's way taking it; what a save keeps of both and what one from
 * before them loads as; a sleeper's barred door found by the dead from the third night (woken first,
 * a light turning them back); what is eaten never kills; a boat made ready given up for another way,
 * and the lines let go at the pier's end.
 */
import { check } from './assert';
import { scavenger } from './citybots';
import { SIEGE } from '../src/city/content/dead';
import { cityItem, cityItemNumber } from '../src/city/content/items';
import { CITY_RECIPES } from '../src/city/content/recipes';
import { STORY, THINGS } from '../src/city/content/story';
import { City, COP, loadCity, MODE, type CityEvent } from '../src/city/sim/City';
import { ZED, type Zed } from '../src/city/sim/dead';
import { relight } from '../src/city/sim/light';
import { towards } from '../src/city/sim/story';
import { cutSpots, lockedLots, TOOLS } from '../src/city/sim/tools';
import { neighbour, OPPOSITE } from '../src/city/gen/plan';
import { nearestDir } from '../src/sim/ai/path';
import { command } from '../src/sim/command';
import { fnv1a } from '../src/sim/rng';
import { bodyAt } from '../src/sim/systems/movement';
import { MAP_W } from '../src/sim/world/grid';

const lines: string[] = [];
const say = (s: string) => lines.push(s);
const MIN = 20;
const W = MAP_W;
const N = W * W;
const SEEDS = 12;
const CROWBAR = cityItemNumber('crowbar');
const CUTTERS = cityItemNumber('cutters');
const enter = (c: City, d: number) => (c as unknown as { enter(d: number): void }).enter(d);
const stand = (c: City, tile: number, facing = 0) => {
  c.state.player = bodyAt(tile % W, Math.floor(tile / W), facing || undefined);
  c.step(0);
};
const around = (t: number) => [t - W, t + 1, t + W, t - 1].filter((i) => i >= 0 && i < N);
const press = (c: City, op: number = COP.ACT, a = 0): CityEvent[] => {
  c.step(command(0, op, a));
  return [...c.events];
};
/** The work the button began, to its end: every event of it. */
const work = (c: City, steps: number): CityEvent[] => {
  const all = press(c);
  for (let k = 0; k < steps + 2 && c.state.search; k++) {
    c.step(0);
    all.push(...c.events);
  }
  return all;
};
/** The tiles walked to from a tile. */
const reach = (c: City, from: number) => {
  const seen = new Uint8Array(N);
  seen[from] = 1;
  const queue = [from];
  for (let q = 0; q < queue.length; q++)
    for (const j of around(queue[q]))
      if (!seen[j] && !c.grid[j]) {
        seen[j] = 1;
        queue.push(j);
      }
  return seen;
};
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
const print = (c: City) => fnv1a(JSON.stringify(c.snapshot().state));

// ------------------------------------------------------------------ the chained buildings
{
  let all = 0;
  let most = 0;
  let none = 0;
  let pieces = 0;
  let inside = 0;
  let insideN = 0;
  let outside = 0;
  let outsideN = 0;
  const looked = (c: City, k: number) => {
    stand(
      c,
      c
        .tilesOf(k)
        .flatMap(around)
        .find((i) => !c.grid[i])!,
    );
    const t = c.tilesOf(k);
    const by = t.find((i) => around(i).includes(c.tile))!;
    c.state.player.facing = nearestDir((by % W) - (c.tile % W), Math.floor(by / W) - Math.floor(c.tile / W));
    (c as unknown as { openBox(key: string, first: boolean): void }).openBox(`${k}`, true);
    const n = c.box().reduce((sum, st) => sum + (st[0] ? (cityItem(st[0])?.wear === undefined ? st[1] : 1) : 0), 0);
    c.step(command(0, COP.CLOSE));
    return n;
  };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const c = new City(seed);
    c.peace = true;
    const P = c.story;
    for (let d = 0; d < 9; d++) {
      enter(c, d);
      const dist = c.district;
      const locked = lockedLots(c, d);
      all += locked.length;
      most = Math.max(most, locked.length);
      if (!locked.length) none++;
      const here = `seed ${seed}, district ${d}`;
      const lotOf = (prop: number) => dist.lotAt[dist.props[prop].z * W + dist.props[prop].x] - 1;
      for (const sp of [...P.things, ...P.notes])
        if (sp.district === d) check(!locked.includes(lotOf(sp.prop)), `${here}: something of the story's is behind a chain`);
      for (const p of P.people) if (p.district === d) check(!locked.includes(p.lot), `${here}: a survivor is chained in`);
      P.wayDistrict.forEach((w, k) => w === d && check(!locked.includes(P.wayLot[k]), `${here}: a way out's building is chained`));
      const seen = reach(c, dist.spawn.z * W + dist.spawn.x);
      for (const lot of locked) {
        const l = dist.lots[lot];
        check(
          c.lockedLot(lot) && l.doors.every((i) => c.locked[i] === 1 && c.grid[i] === 1 && c.zedGrid[i] === 1),
          `${here}: lot ${lot} isn't shut`,
        );
        for (let z = l.z0; z <= l.z1; z++)
          for (let x = l.x0; x <= l.x1; x++) {
            check(!seen[z * W + x], `${here}: lot ${lot} is walked into at ${x},${z}`);
            check(!c.zedIndoor[z * W + x], `${here}: the dead may stand in lot ${lot}`);
          }
        // (From the street: the button is the chain's, whatever is in the pockets.)
        const out = l.doors.flatMap(around).find((i) => seen[i]);
        check(out !== undefined, `${here}: lot ${lot}'s doors can't be walked up to`);
        if (out === undefined) continue;
        stand(c, out);
        check(c.target()?.kind === 'lock', `${here}: at lot ${lot}'s door the button is ${c.target()?.kind}`);
      }
      // (The story's furniture, the beds: got to as before.)
      for (const sp of P.things)
        if (sp.district === d)
          check(
            c
              .tilesOf(sp.prop)
              .flatMap(around)
              .some((i) => seen[i]),
            `${here}: a thing of the story's can't be got to`,
          );
      check(
        c.zedShare > 0.5 && c.zedShare <= 1 && c.zedShare < 1 === locked.length > 0,
        `${here}: the share of open floors is ${c.zedShare}`,
      );
      // What the furniture holds, behind a chain and elsewhere (the first city's every district).
      if (seed > 3) continue;
      for (const lot of locked) (c.state.forced[d] ??= []).push(lot);
      c.reenter();
      c.peace = true;
      dist.props.forEach((_, k) => {
        if (
          !c
            .tilesOf(k)
            .flatMap(around)
            .some((i) => !c.grid[i])
        )
          return;
        const lot = lotOf(k);
        if (lot < 0 || P.things.some((sp) => sp.district === d && sp.prop === k)) return;
        const was = locked.includes(lot);
        try {
          const n = looked(c, k);
          pieces++;
          if (was) {
            inside += n;
            insideN++;
          } else {
            outside += n;
            outsideN++;
          }
        } catch {
          // (Not searched: a chair, a lamp.)
        }
      });
    }
  }
  say(
    `${SEEDS} cities: ${(all / SEEDS).toFixed(1)} buildings chained shut a city (${most} at the most in a district, none in ${none} of ${SEEDS * 9}), never the story's, a survivor's or a way out's; nobody walks in, none of the dead stand inside, the button at their door is the chain's`,
  );
  say(
    `what's inside (3 cities, ${pieces} pieces): ${(inside / insideN).toFixed(2)} things a piece behind a chain (${insideN}), ${(outside / outsideN).toFixed(2)} elsewhere (${outsideN})`,
  );
  check(inside / insideN > 1.5 * (outside / outsideN), 'a chained building holds no more than another');
}

// A door forced by ordinary commands; what a save keeps; a city from before the chains.
{
  const c = new City(3);
  c.peace = true;
  const d = c.state.district;
  const lot = lockedLots(c, d)[0];
  const l = c.district.lots[lot];
  const from = reach(c, c.tile);
  const out = l.doors.flatMap(around).find((i) => from[i])!;
  const door = l.doors.find((i) => around(i).includes(out))!;
  stand(c, out);
  check(press(c).some((e) => e.type === 'refused' && e.why === 'crowbar') && !c.state.search, 'a chained door pressed with no crowbar');
  c.state.inv[0] = [CROWBAR, 1];
  const z = zed(c, out + (out - door) * 5 >= 0 && !c.grid[out + (out - door) * 5] ? out + (out - door) * 5 : out, ZED.WANDER);
  const ev = work(c, TOOLS.forceSteps);
  check(ev[0]?.type === 'forcing' && ev.some((e) => e.type === 'forced'), `forcing a door: ${ev.map((e) => e.type).join()}`);
  check(z.mode === ZED.SEEK, 'the crowbar at work is heard');
  c.state.zeds = [];
  check(c.state.inv[0][0] === CROWBAR && c.state.forced[d]?.includes(lot), 'the crowbar is kept, the building is forced');
  check(!c.lockedLot(lot) && l.doors.every((i) => !c.locked[i] && !c.grid[i] && !c.zedGrid[i]), 'every door of it stands open');
  const now = reach(c, c.tile);
  let floors = 0;
  for (let zz = l.z0; zz <= l.z1; zz++) for (let x = l.x0; x <= l.x1; x++) if (now[zz * W + x]) floors++;
  check(
    floors > 4 && c.zedIndoor.some((v, i) => v === 1 && c.district.lotAt[i] === lot + 1),
    'the forced building is walked into, by the dead too',
  );
  stand(c, out);
  check(c.target()?.kind !== 'lock', 'a forced door is still the chain’s');
  const back = loadCity(JSON.parse(JSON.stringify(c.snapshot())))!;
  check(!back.lockedLot(lot) && back.state.forced[d].includes(lot) && back.state.locks === 1, 'a save forgets the door forced');
  const other = lockedLots(c, d).find((k) => k !== lot);
  if (other !== undefined) check(back.lockedLot(other), 'a save opens the other chained doors');
  // Played on from the save as the live city.
  const a = scavenger(c);
  const b = scavenger(back);
  c.peace = back.peace = false;
  for (let k = 0; k < 2000; k++) {
    c.step(a());
    back.step(b());
  }
  check(print(c) === print(back), 'a save with a forced door plays on otherwise');
  // A city begun before 2.58: no chain anywhere, its furniture as it was.
  const old = JSON.parse(JSON.stringify(new City(3).snapshot()));
  for (const k of ['locks', 'forced', 'cuts']) delete old.state[k];
  const was = loadCity(old)!;
  let chained = 0;
  for (let dd = 0; dd < 9; dd++) chained += lockedLots(was, dd).length;
  check(
    was.state.locks === 0 && chained === 0 && was.locked.every((v) => !v) && was.zedShare === 1,
    'a city from before the chains has some',
  );
  say(
    `a chained door: refused without a crowbar (said), forced in ${TOOLS.forceSteps / 20} seconds with one (heard as a blow is, the crowbar kept), every door of the building open for good, to the dead too; a save keeps it and plays on as the live city; a city begun before has none`,
  );
}

// ------------------------------------------------------------------ the fences cut
{
  let spots = 0;
  let none = 0;
  let joins = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const c = new City(seed);
    c.peace = true;
    let here = 0;
    for (let d = 0; d < 9; d++) {
      const list = cutSpots(c, d);
      here += list.length;
      for (const f of list) {
        // (The same place from the other side.)
        check(
          cutSpots(c, f.to).some((g) => g.to === d && g.lane === f.lane && g.side === OPPOSITE[f.side]),
          `seed ${seed}: district ${d}'s fence at side ${f.side}, lane ${f.lane} can't be cut from the other side`,
        );
        if (!c.plan.gates[d][f.side]) joins++;
      }
    }
    spots += here / 2;
    if (!here) none++;
  }
  say(
    `${SEEDS} cities: ${(spots / SEEDS).toFixed(1)} places a city where the fence can be cut (a street up to it on both sides, clear), ${none} cities with none; ${(joins / 2 / SEEDS).toFixed(1)} of them a city between two districts no checkpoint joins`,
  );

  // One cut by ordinary commands, walked through both ways.
  const c = new City(2);
  c.peace = true;
  let d = -1;
  let spot = cutSpots(c, 0)[0];
  for (let k = 0; k < 9 && d < 0; k++) {
    const f = cutSpots(c, k).find((g) => !c.plan.gates[k][g.side]);
    if (f) {
      d = k;
      spot = f;
    }
  }
  check(d >= 0, 'seed 2: no fence to cut between two districts not joined');
  enter(c, d);
  const before = towards(c, d, spot.to);
  const by = spot.tiles.flatMap(around).find((i) => !c.grid[i])!;
  stand(c, by);
  check(c.target()?.kind === 'fence', `at the fence the button is ${c.target()?.kind}`);
  check(press(c).some((e) => e.type === 'refused' && e.why === 'cutters') && !c.state.search, 'the fence pressed with no cutters');
  c.state.inv[0] = [CUTTERS, 1];
  const world = c.world;
  const ev = work(c, TOOLS.cutSteps);
  check(ev[0]?.type === 'forcing' && ev.some((e) => e.type === 'cut'), `cutting the fence: ${ev.map((e) => e.type).join()}`);
  check(c.world !== world && c.state.district === d && c.tile === by, 'the district is put up again round the player');
  const gate = c.district.gates.find((g) => g.cut && g.to === spot.to);
  check(!!gate && gate.tiles.every((i) => !c.grid[i]) && c.target()?.kind !== 'fence', 'the cut is no crossing');
  check(
    c.state.inv[0][0] === CUTTERS && cutSpots(c, d).every((f) => f.tiles[0] !== spot.tiles[0]),
    'the cutters are kept; the fence is cut once',
  );
  check(before !== spot.to && towards(c, d, spot.to) === spot.to, `the journal's way: ${before} before, ${towards(c, d, spot.to)} after`);
  // Through it, and back.
  stand(c, gate!.tiles[0]);
  check(c.state.district === spot.to && !c.grid[c.tile], `through the cut: in district ${c.state.district}`);
  const home = c.district.gates.find((g) => g.cut && g.to === d);
  check(!!home && neighbour(spot.to, home.side) === d, 'the cut is not there from the other side');
  stand(c, home!.tiles[1]);
  check(c.state.district === d && !c.grid[c.tile], 'back through the cut');
  const snap = JSON.parse(JSON.stringify(c.snapshot()));
  const back = loadCity(JSON.parse(JSON.stringify(snap)))!;
  check(back.state.cuts.length === 1 && back.district.gates.some((g) => g.cut), 'a save forgets the cut');
  // A cut that never could be (a damaged save): dropped.
  snap.state.cuts = [snap.state.cuts[0], 107, -4, 'x'];
  const mended = loadCity(snap)!;
  check(
    mended.state.cuts.length <= 2 && mended.state.cuts.every((code: number) => Number.isInteger(code)),
    `a damaged save's cuts: ${mended.state.cuts.join()}`,
  );
  say(
    `the fence: refused without bolt cutters (said), cut in ${TOOLS.cutSteps / 20} seconds with them (heard, the cutters kept); the street runs through from both sides, a crossing as a checkpoint is, and the journal's way takes it; a save keeps it, a cut that never could be is dropped`,
  );
}

// ------------------------------------------------------------------ a sleeper's barred door
{
  /** A night asleep behind boards in a one-door house of the start, on a given night: who came to the door. */
  const night = (seed: number, n: number, lantern: boolean) => {
    const c = new City(seed);
    c.step(0);
    const dist = c.district;
    const lot = dist.lots.findIndex(
      (l, k) =>
        l.use === 'house' &&
        !c.lockedLot(k) &&
        l.doors.length === 1 &&
        dist.props.some(
          (p, q) =>
            p.kind === 'bed' &&
            dist.lotAt[p.z * W + p.x] - 1 === k &&
            c
              .tilesOf(q)
              .flatMap(around)
              .some((i) => !c.grid[i]),
        ),
    );
    if (lot < 0) return null;
    const bed = dist.props.findIndex((p) => p.kind === 'bed' && dist.lotAt[p.z * W + p.x] - 1 === lot);
    const door = dist.lots[lot].doors[0];
    c.state.bars[c.state.district] = [door];
    c.rebar();
    c.state.step = ((n - 1) * 1440 + 20 * 60 + 55 - 390) * MIN;
    (c as unknown as { enter(d: number): void }).enter(c.state.district);
    c.state.bars[c.state.district] = [door];
    c.rebar();
    if (lantern) {
      // (Burning on the step outside the door.)
      const out = around(door).find((i) => dist.lotAt[i] !== lot + 1 && !c.grid[i])!;
      c.state.lights = { [c.state.district]: [[out, 1, c.state.step + 20 * 60 * MIN]] };
      relight(c);
    }
    c.state.boxes[`${c.state.district}:${bed}`] = [];
    stand(
      c,
      c
        .tilesOf(bed)
        .flatMap(around)
        .find((i) => !c.grid[i] && dist.lotAt[i] === lot + 1)!,
    );
    c.state.hunger = 100_000;
    c.state.energy = 30_000;
    const at = c.tilesOf(bed).find((i) => around(i).includes(c.tile))!;
    c.state.player.facing = nearestDir((at % W) - (c.tile % W), Math.floor(at / W) - Math.floor(c.tile / W));
    c.step(command(0, COP.ACT));
    if (!c.state.sleeping) return null;
    let pounds = 0;
    let breach = 0;
    let woke = -1;
    let broke = -1;
    for (let k = 0; k < 9 * 60 * MIN && c.minute !== 6 * 60 + 5; k++) {
      // (Woken, they lie awake a while and go back to sleep: the night is counted whole.)
      c.step(c.state.sleeping || k % 400 ? 0 : command(0, COP.ACT));
      c.state.health = 100;
      for (const e of c.events) {
        if (e.type === 'pound') pounds++;
        if (e.type === 'sleep' && e.why === 'pounding' && woke < 0) woke = k;
        if (e.type === 'breach') {
          breach++;
          if (broke < 0) broke = k;
          // (Barred again for the rest of the night.)
          c.state.bars[c.state.district] = [door];
          c.rebar();
        }
      }
    }
    return { pounds, breach, woke, broke };
  };
  const tally = (n: number, lantern: boolean) => {
    let nights = 0;
    let came = 0;
    let through = 0;
    let warned = 0;
    let lead = Infinity;
    for (let seed = 1; seed <= 24; seed++) {
      const r = night(seed, n, lantern);
      if (!r) continue;
      nights++;
      if (r.pounds) came++;
      if (r.breach) {
        through++;
        if (r.woke >= 0 && r.woke < r.broke) warned++;
        lead = Math.min(lead, r.broke - r.woke);
      }
    }
    return { nights, came, through, warned, lead };
  };
  const early = [1, 2].map((n) => tally(n, false));
  check(
    early.every((r) => r.came === 0),
    `the first two nights behind boards: the dead at the door on ${early.map((r) => r.came).join(' and ')}`,
  );
  const third = tally(3, false);
  const late = tally(9, false);
  const lit = tally(9, true);
  check(
    late.came > third.came && late.came >= 3 && late.came <= late.nights * 0.7,
    `night 9 behind boards: the dead at the door on ${late.came} of ${late.nights}`,
  );
  check(
    late.through === late.warned && late.lead >= SIEGE.pound - 20,
    `boards torn off a sleeper unwarned (${late.warned} of ${late.through}, ${late.lead} steps)`,
  );
  check(lit.through === 0, `a lantern on the step, night 9: the boards went on ${lit.through} nights`);
  say(
    `asleep behind boards in a one-door house, 24 cities: nights 1 and 2 nobody comes; night 3 the dead are at the door on ${third.came} of ${third.nights}, night 9 on ${late.came} of ${late.nights} (the boards gone on ${late.through}), the sleeper woken ${(late.lead / 20).toFixed(0)} seconds or more before they give; with a lantern on the step, on ${lit.came} (gone on ${lit.through})`,
  );
}

// One at the boards isn't called off by a noise behind them; a door forced beside a survivor loads as it stands (the review's).
{
  const c = new City(9);
  c.step(0);
  const dist = c.district;
  const lot = dist.lots.findIndex((l, k) => l.use === 'house' && !c.lockedLot(k) && l.doors.length === 1);
  const door = dist.lots[lot].doors[0];
  const out = around(door).find((i) => dist.lotAt[i] !== lot + 1 && !c.grid[i])!;
  const inside = around(door).find((i) => dist.lotAt[i] === lot + 1 && !c.grid[i])!;
  c.state.bars[c.state.district] = [door];
  c.rebar();
  c.state.step = (9 * 1440 + 23 * 60 - 390) * MIN;
  c.state.zeds = [];
  stand(c, inside);
  c.state.zeds = [];
  const z = zed(c, out, ZED.SEEK);
  Object.assign(z, { goal: inside, path: [door, inside], pound: 0 });
  for (let k = 0; k < 40; k++) c.step(k === 20 ? command(0, COP.HIT) : 0);
  check(z.pound !== undefined && z.pound > 20 && z.path.length === 2, `a blow struck indoors calls it off the boards (pound ${z.pound})`);
  let gone = false;
  for (let k = 0; k < SIEGE.pound + 40 && !gone; k++) {
    c.step(0);
    c.state.health = 100;
    gone = c.events.some((e) => e.type === 'breach');
  }
  check(gone, 'the boards never give');
  let same = 0;
  let tried = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const f = new City(seed);
    f.peace = true;
    const d = f.story.people.map((p) => p.district).find((pd) => lockedLots(f, pd).length > 0);
    if (d === undefined) continue;
    enter(f, d);
    tried++;
    (f as unknown as { force(tile: number): void }).force(f.district.lots[lockedLots(f, d)[0]].doors[0]);
    const back = loadCity(JSON.parse(JSON.stringify(f.snapshot())))!;
    if (back.zedPlaces.indoors.length === f.zedPlaces.indoors.length && back.zedShare === f.zedShare) same++;
  }
  check(
    tried > 0 && same === tried,
    `a door forced in a survivor's district: ${same} of ${tried} saves load to the same places for the dead`,
  );
  say(
    `one of the dead at the boards isn't called off by a blow struck behind them; a door forced in a survivor's district loads as it stands (${same} of ${tried})`,
  );
}

// ------------------------------------------------------------------ what is eaten never kills
{
  const c = new City(4, MODE.HARDCORE);
  c.peace = true;
  c.state.health = 3;
  c.state.hunger = 20_000;
  c.state.inv[0] = [cityItemNumber('fish'), 2];
  const ev = press(c, COP.USE, 0);
  check(
    ev.some((e) => e.type === 'used') && c.state.health === 1 && !c.state.over,
    `raw fish at 3 health: ${c.state.health}, over ${c.state.over}`,
  );
  press(c, COP.USE, 0);
  check(c.state.health === 1 && !c.state.over, 'a second raw fish at 1 health');
  c.state.health = 100;
  c.state.energy = 60_000;
  c.state.inv[1] = [cityItemNumber('medkit'), 1];
  check(
    press(c, COP.USE, 1).some((e) => e.type === 'refused' && e.why === 'noNeed') && c.state.inv[1][1] === 1,
    'a medkit is used up at full health',
  );
  const item = (id: string) => cityItem(cityItemNumber(id))!.use!;
  const parts = (id: string, what: 'hunger' | 'health' | 'energy') =>
    CITY_RECIPES.find((r) => r.makes === id)!.from.reduce((n, [part, k]) => n + (cityItem(cityItemNumber(part))?.use?.[what] ?? 0) * k, 0);
  check(item('stew').hunger! >= parts('stew', 'hunger') * 1.4, 'a stew is worth little more than what goes in');
  check(item('medkit').health! >= parts('medkit', 'health') * 1.4, 'a medkit is worth little more than what goes in');
  say(
    `raw fish takes health down to 1 at the worst (a Hardcore city isn't lost to a meal); a stew gives ${item('stew').hunger} hunger, ${item('stew').health} health and ${item('stew').energy} energy (its parts eaten as they are: ${parts('stew', 'hunger')}, ${parts('stew', 'health')}, ${parts('stew', 'energy')}); a medkit ${item('medkit').health} health (its parts: ${parts('medkit', 'health')}), kept at full health`,
  );
}

// ------------------------------------------------------------------ the boat
{
  const c = new City(5);
  c.peace = true;
  const s = c.state;
  Object.assign(s, { kit: (1 << THINGS.length) - 1, flags: 15, scouted: 7, way: 2, act: 4 });
  const d = c.story.wayDistrict[1];
  enter(c, d);
  stand(c, c.story.exits[1]);
  check(press(c).some((e) => e.type === 'ready' && e.on) && s.ready === 1, 'the engine fitted');
  // Another way chosen with the engine in: it comes out, the things kept.
  const ev = press(c, COP.CHOOSE, 1);
  check(
    s.ready === 0 &&
      s.way === 1 &&
      ev.some((e) => e.type === 'ready' && !e.on) &&
      ev.some((e) => e.type === 'chose') &&
      s.kit === (1 << THINGS.length) - 1,
    `the helicopter chosen with the boat ready: ready ${s.ready}, way ${s.way}`,
  );
  press(c, COP.CHOOSE, 2);
  stand(c, c.story.exits[1]);
  press(c);
  check(s.ready === 1 && s.way === 2, 'the boat chosen and made ready again');
  // The lines let go at the pier's end: stood still through it, on the tide.
  s.step = (23 * 60 + 10 - 390) * MIN;
  stand(c, c.story.pier);
  const start = press(c);
  check(
    start.some((e) => e.type === 'casting') && !s.over && s.search === 'w',
    `the boat pressed on the tide: ${start.map((e) => e.type).join()}`,
  );
  // (A step away: begun again.)
  const off = around(c.story.pier).find((i) => !c.grid[i])!;
  c.step(command(nearestDir((off % W) - (c.story.pier % W), Math.floor(off / W) - Math.floor(c.story.pier / W))));
  check(!s.search && !s.over, 'walking off the pier’s end goes on casting off');
  stand(c, c.story.pier);
  press(c);
  // (Begun in the tide's last minutes, it is away all the same.)
  s.step = (1440 + 60 + 55 - 390) * MIN;
  press(c);
  let steps = 0;
  while (!s.over && steps++ < STORY.castSteps + 5) c.step(steps % 7 ? 0 : command(0, COP.ACT));
  check(s.over === 2 && s.won === 2 && steps >= STORY.castSteps - 1, `cast off after ${steps} steps: over ${s.over}`);
  // A beacon lit is not given up from the journal.
  const h = new City(5);
  h.peace = true;
  Object.assign(h.state, { kit: (1 << THINGS.length) - 1, flags: 15, scouted: 7, way: 1, act: 4 });
  h.state.step = (22 * 60 - 390) * MIN;
  enter(h, h.story.wayDistrict[0]);
  stand(h, h.story.exits[0]);
  press(h);
  press(h, COP.CHOOSE, 2);
  check(h.state.ready === 1 && h.state.way === 1, 'the beacon lit is given up from the journal');
  say(
    `the boat: with its engine in, another way chosen takes it out again (the things kept; a beacon lit or a generator running is walked away from, as before); on the tide the lines are let go at the pier's end, ${STORY.castSteps / 20} seconds stood still, heard a little way off, begun again if walked away from`,
  );
}

// ------------------------------------------------------------------ somebody's clothes (2.59)
{
  let found = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const c = new City(seed);
    c.peace = true;
    const k = c.clothes;
    if (k < 0) continue;
    const dist = c.district;
    const p = dist.props[k];
    const lot = dist.lotAt[p.z * W + p.x] - 1;
    const from = reach(c, c.tile);
    check(
      dist.lots[lot]?.use === 'house' &&
        !c.lockedLot(lot) &&
        c
          .tilesOf(k)
          .flatMap(around)
          .some((i) => from[i]),
      `seed ${seed}: the clothes can't be got to (a ${dist.lots[lot]?.use})`,
    );
    check(
      !c.story.things.some((sp) => sp.district === c.state.district && sp.prop === k),
      `seed ${seed}: the clothes lie with a thing of the story's`,
    );
    stand(
      c,
      c
        .tilesOf(k)
        .flatMap(around)
        .find((i) => from[i])!,
    );
    const by = c.tilesOf(k).find((i) => around(i).includes(c.tile))!;
    c.state.player.facing = nearestDir((by % W) - (c.tile % W), Math.floor(by / W) - Math.floor(c.tile / W));
    const ev = work(c, 40);
    check(
      ev.some((e) => e.type === 'clothes') && c.state.outfit === 1,
      `seed ${seed}: the clothes' furniture searched: ${ev.map((e) => e.type).join()}`,
    );
    const snap = JSON.parse(JSON.stringify(c.snapshot()));
    check(loadCity(JSON.parse(JSON.stringify(snap)))!.state.outfit === 1, `seed ${seed}: a save forgets the clothes`);
    // (A save from before them, that furniture already searched: found.)
    delete snap.state.outfit;
    check(loadCity(snap)!.state.outfit === 1, `seed ${seed}: an older save with the furniture searched has no clothes`);
    found++;
  }
  check(found >= SEEDS - 1, `the clothes lie in ${found} of ${SEEDS} cities`);
  say(
    `somebody's clothes: in a house of the start's district in ${found} of ${SEEDS} cities (never chained, never the story's furniture), put on when found, kept by a save; nothing in the rules reads them`,
  );
}

console.log(lines.join('\n'));
