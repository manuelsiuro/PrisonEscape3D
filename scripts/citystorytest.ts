/**
 * City Escape's story (C3): where its things lie (on many seeds: each in a piece of furniture that can
 * be stood beside, no two in one, the ways out's tiles open floor, a pier at the docks), the acts one
 * by one (the first day's doings, the radio mended from the kit and the pockets, the ways out scouted
 * and chosen, their things, each set going and taken, what is refused), the last nights' own rules
 * (the beacon's dead and torn boards, the generator's, the fog), what a fall and a save keep, and a
 * bot following the story to each way out on several cities.
 */
import { check } from './assert';
import { quester } from './citybots';
import { cityItemNumber } from '../src/city/content/items';
import { SEARCHED } from '../src/city/content/loot';
import { BEATS, FLAG, NOTES, STORY, THING_IN, THINGS, WAYS, thingBit } from '../src/city/content/story';
import { neighbour } from '../src/city/gen/plan';
import { BRUTE, RUNNER, ZKIND } from '../src/city/content/dead';
import { PEOPLE } from '../src/city/content/people';
import { CITY_RECIPES } from '../src/city/content/recipes';
import { reachFrom } from '../src/city/gen/district';
import { withRun, type CityRecord } from '../src/city/record';
import { START_MINUTE } from '../src/city/sim/City';
import { danger, populate } from '../src/city/sim/dead';
import { City, COP, loadCity, MODE, type CityEvent } from '../src/city/sim/City';
import { noise, quota, stepDead, ZED, type Zed } from '../src/city/sim/dead';
import { going, objectives } from '../src/city/sim/story';
import { nearestDir } from '../src/sim/ai/path';
import { command } from '../src/sim/command';
import { fnv1a } from '../src/sim/rng';
import { bodyAt } from '../src/sim/systems/movement';
import { MAP_W } from '../src/sim/world/grid';

const lines: string[] = [];
const say = (s: string) => lines.push(s);
const MIN = 20;
const BATTERY = cityItemNumber('battery');
const xz = (i: number) => bodyAt(i % MAP_W, Math.floor(i / MAP_W));
const far2 = (a: number, b: number) => Math.abs((a % MAP_W) - (b % MAP_W)) + Math.abs(Math.floor(a / MAP_W) - Math.floor(b / MAP_W));
/** Put somewhere in the city (the tests' own way about: no walking). */
const stand = (c: City, d: number, tile: number) => {
  if (d !== c.state.district) (c as unknown as { enter(d: number): void }).enter(d);
  c.state.player = xz(tile);
  c.step(0);
  return c.events;
};
const beside = (c: City, d: number, tiles: number[]) =>
  tiles.flatMap((i) => [i - 1, i + 1, i - MAP_W, i + MAP_W]).find((i) => !c.districtGrid(d)[i])!;
/** A step with a command, and what it reported. */
const press = (c: City, op: number, a = 0): CityEvent[] => {
  c.step(command(0, op, a));
  return c.events;
};
/** The furniture a thing lies in searched (stood beside it, the search waited out). */
function fetch(c: City, k: number): CityEvent[] {
  const sp = c.story.things[k];
  const dist = c.districtOf(sp.district);
  const p = dist.props[sp.prop];
  const tiles: number[] = [];
  for (let z = p.z; z < p.z + (p.d ?? 1); z++) for (let x = p.x; x < p.x + (p.w ?? 1); x++) tiles.push(z * MAP_W + x);
  const at = beside(c, sp.district, tiles);
  stand(c, sp.district, at);
  // (Turned to it: what's faced is what's searched.)
  const to = tiles.find((i) => far2(i, at) === 1)!;
  const dir = to === at - 1 ? 13 : to === at + 1 ? 5 : to === at - MAP_W ? 9 : 1;
  c.state.player.facing = dir;
  const all: CityEvent[] = [];
  // (Looked into before: a second look, at once.)
  if (c.searched(`${sp.prop}`)) all.push(...press(c, COP.ACT));
  else for (let k2 = 0; k2 < 60 && !c.searched(`${sp.prop}`); k2++) all.push(...press(c, k2 === 0 ? COP.ACT : 0));
  check(
    c.target()?.key === `${sp.prop}` || c.state.open === `${sp.prop}`,
    `seed ${c.state.seed}: ${THINGS[k]}'s furniture isn't what the button takes`,
  );
  press(c, COP.CLOSE);
  return all;
}
const ids = (c: City) =>
  objectives(c)
    .map((o) => `${o.done ? '✓' : '·'}${o.id}${o.of ? ` ${o.n}/${o.of}` : ''}`)
    .join(' ');

// ------------------------------------------------------------------ where the story's things lie
{
  const SEEDS = 60;
  let pierWalk = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const c = new City(seed);
    const P = c.story;
    const at = `seed ${seed}`;
    const taken = new Set<string>();
    [...P.things, ...P.notes].forEach((sp, k) => {
      const what = k < THINGS.length ? THINGS[k] : `note ${k - THINGS.length}`;
      const dist = c.districtOf(sp.district);
      const p = dist.props[sp.prop];
      check(!!p && SEARCHED[p.kind] !== undefined, `${at}: ${what} lies in nothing that's searched`);
      check(!taken.has(`${sp.district}:${sp.prop}`), `${at}: ${what} shares its furniture`);
      taken.add(`${sp.district}:${sp.prop}`);
      const grid = c.districtGrid(sp.district);
      let open = false;
      for (let z = p.z; z < p.z + (p.d ?? 1); z++)
        for (let x = p.x; x < p.x + (p.w ?? 1); x++)
          for (const j of [z * MAP_W + x - 1, z * MAP_W + x + 1, (z - 1) * MAP_W + x, (z + 1) * MAP_W + x]) if (!grid[j]) open = true;
      check(open, `${at}: ${what}'s furniture can't be stood beside`);
    });
    check(P.things[0].district === c.plan.start, `${at}: the radio isn't where the city starts`);
    const near = [0, 1, 2, 3].map((s) => neighbour(c.plan.start, s));
    check(near.includes(P.things[1].district), `${at}: the aerial isn't in a district beside the start`);
    for (let k = 2; k < THINGS.length; k++) {
      const dist = c.districtOf(P.things[k].district);
      const p = dist.props[P.things[k].prop];
      const lot = dist.lotAt[p.z * MAP_W + p.x];
      check(!!lot && dist.lots[lot - 1].use === THING_IN[THINGS[k]], `${at}: ${THINGS[k]} isn't in the ${THING_IN[THINGS[k]]}`);
    }
    WAYS.forEach((w, k) => {
      const d = P.wayDistrict[k];
      check(c.plan.kinds[d] === w.kind, `${at}: the ${w.id}'s district`);
      const dist = c.districtOf(d);
      check(
        !c.districtGrid(d)[P.exits[k]] && dist.lotAt[P.exits[k]] === P.wayLot[k] + 1,
        `${at}: the ${w.id}'s tile isn't open floor in its landmark`,
      );
    });
    const docks = c.districtOf(P.wayDistrict[1]);
    check(P.pier >= 0 && docks.rows[Math.floor(P.pier / MAP_W)][P.pier % MAP_W] === 'P', `${at}: no pier's end at the docks`);
    pierWalk += far2(P.pier, P.exits[1]);
    // (Twice the same.)
    check(JSON.stringify(new City(seed).story) === JSON.stringify(P), `${at}: the story's places differ on a second making`);
  }
  say(
    `${SEEDS} cities: ${THINGS.length} things and ${NOTES} notes each in furniture of its own that can be stood beside, the radio at the start, the aerial next door, every way out's tile open floor in its landmark, a pier's end ${(pierWalk / SEEDS).toFixed(0)} tiles from the boathouse on average`,
  );
}

// ------------------------------------------------------------------ the acts, one by one
{
  const c = new City(3);
  c.peace = true;
  c.step(0);
  const s = c.state;
  check(s.act === 1 && ids(c) === '·eat ·sleep ·radio', `a new city's first act: ${ids(c)}`);
  // Nothing is heard without the radio; the kit is not the pockets.
  s.inv[0] = [cityItemNumber('tin'), 1];
  s.hunger = 50_000;
  press(c, COP.USE, 0);
  check((s.flags & FLAG.ATE) !== 0, 'eating is not marked');
  let ev = fetch(c, 0);
  check(
    ev.some((e) => e.type === 'found' && e.thing === 0) && ev.some((e) => e.type === 'say' && e.beat === 'radio'),
    'the radio found and heard',
  );
  check(s.act === 1 && s.inv.every((st) => st[0] !== 0 || st[1] === 0), 'the radio takes no pocket');
  s.flags |= FLAG.SLEPT;
  c.step(0);
  for (let k = 0; k < MIN; k++) c.step(0);
  check(s.act === 2 && ids(c) === '·batteries 0/2 ·kit.aerial', `the second act: ${ids(c)}`);
  // The aerial without batteries mends nothing; with them, the radio works and they're spent.
  ev = fetch(c, 1);
  check(ev.some((e) => e.type === 'say' && e.beat === 'got.aerial') && !(s.flags & FLAG.FIXED), 'the aerial alone mends the radio');
  s.inv[1] = [BATTERY, 3];
  for (let k = 0; k < MIN + 1; k++) c.step(0);
  check(
    (s.flags & FLAG.FIXED) !== 0 && c.count(BATTERY) === 1 && s.act === 3,
    `the radio mended, two batteries spent (${c.count(BATTERY)} left, act ${s.act})`,
  );
  check(ids(c) === '·scout1 ·scout2 ·scout3 ·choose', `the third act: ${ids(c)}`);
  // A way out not scouted isn't chosen; scouted, it is; another until one is set going.
  press(c, COP.CHOOSE, 1);
  check(s.way === 0, 'a way out chosen unseen');
  ev = [...stand(c, c.story.wayDistrict[0], c.story.exits[0])];
  check((s.scouted & 1) === 1 && ev.some((e) => e.type === 'say' && e.beat === 'scout1'), 'the hospital walked into is scouted');
  press(c, COP.CHOOSE, 1);
  check(s.way === 1 && s.act === 4, 'the helicopter chosen');
  check(ids(c) === '·key ·kit.beacon ·kit.avgas ·kit.flare ·begin1', `the fourth act: ${ids(c)}`);
  // The flare gun is in the police armoury: looked at without the key, it stays there; with the key, a second look has it.
  ev = fetch(c, THINGS.indexOf('flare'));
  check(ev.some((e) => e.type === 'refused' && e.why === 'locked') && !(s.kit & thingBit('flare')), 'the armoury opened without its key');
  check(
    objectives(c).find((o) => o.id === 'kit.flare')?.at === undefined && !!objectives(c).find((o) => o.id === 'key')?.at,
    'the list points at the flare gun before the key',
  );
  s.flags |= FLAG.KEY;
  check(ids(c).startsWith('✓key') && !!objectives(c).find((o) => o.id === 'kit.flare')?.at, `with the key: ${ids(c)}`);
  stand(c, c.story.wayDistrict[0], c.story.exits[0]);
  // Set going without its things: refused.
  check(c.target()?.kind === 'way', 'the way out is not what the button takes at its tile');
  check(
    press(c, COP.ACT).some((e) => e.type === 'refused' && e.why === 'parts'),
    'the beacon lit with nothing',
  );
  for (const id of WAYS[0].needs) fetch(c, THINGS.indexOf(id));
  check(s.heard.includes('all1'), 'Dispatch says nothing when the last thing is found');
  // By day: refused. After dark: lit.
  stand(c, c.story.wayDistrict[0], c.story.exits[0]);
  check(
    press(c, COP.ACT).some((e) => e.type === 'refused' && e.why === 'notNight'),
    'the beacon lit by day',
  );
  while (c.minute !== 21 * 60 + 5) c.step(0);
  check(
    press(c, COP.ACT).some((e) => e.type === 'ready' && e.on),
    'the beacon is not lit after dark',
  );
  check(s.act === 5 && going(c) === 1 && c.target() === null, 'the last night: nothing more to press');
  check(objectives(c)[0].id === 'hold1' && objectives(c)[0].left === STORY.heliHold, `the last night's line: ${ids(c)}`);
  // Walked out of the district: the beacon goes out, the things are kept, the way stays chosen.
  const snap = JSON.stringify(c.snapshot());
  const gate = c.district.gates[0];
  ev = [...stand(c, c.state.district, gate.tiles[0])];
  check(
    !s.ready && s.act === 4 && ev.some((e) => e.type === 'ready' && !e.on) && s.heard.includes('lost'),
    'the beacon stays lit behind the player',
  );
  check(
    WAYS[0].needs.every((id) => s.kit & thingBit(id)),
    'the things are lost with the beacon',
  );
  // The same night held (from the save): away at the hour, at the hospital.
  const held = loadCity(JSON.parse(snap))!;
  held.peace = true;
  check(held.state.ready === 1 && held.state.act === 5, 'a save loses the way out set going');
  let steps = 0;
  while (!held.state.over && steps++ < (STORY.heliHold + 2) * MIN) held.step(0);
  check(held.state.over === 2 && held.state.won === 1 && held.events.some((e) => e.type === 'escaped'), 'the helicopter never comes');
  check(Math.abs(steps - STORY.heliHold * MIN) <= MIN, `the helicopter comes after ${steps / MIN} minutes`);
  held.step(command(1));
  check(held.events.length === 0, 'a city left still steps');
  say(
    `the acts: eat, sleep and the radio; the aerial and two batteries from the pockets mend it; a way out is chosen only once scouted; set going only with its three things, the beacon only after dark; walked away from, it goes out and the things are kept; held ${STORY.heliHold} minutes, away`,
  );
  say(`Dispatch, in order: ${held.state.heard.join(' ')}`);
}

// ------------------------------------------------------------------ the last nights
{
  // The beacon: more of the dead, by day's count too, and boards torn off one door at a time.
  const c = new City(5);
  c.step(0);
  const s = c.state;
  s.kit = (1 << THINGS.length) - 1;
  s.flags = FLAG.ATE | FLAG.SLEPT | FLAG.FIXED;
  s.scouted = 7;
  const d = c.story.wayDistrict[0];
  c.peace = true;
  stand(c, d, c.story.exits[0]);
  press(c, COP.CHOOSE, 1);
  while (c.minute !== 22 * 60) c.step(0);
  const before = quota(c);
  const doors = c.district.lots[c.story.wayLot[0]].doors;
  s.bars[d] = [...doors];
  c.rebar();
  check(c.shelter(c.story.wayLot[0]), 'the hospital barred is a shelter');
  press(c, COP.ACT);
  const after = quota(c);
  check(
    after.indoors + after.streets === before.indoors + before.streets + STORY.extra,
    `the beacon brings ${after.indoors + after.streets - before.indoors - before.streets} more`,
  );
  let torn = 0;
  for (let k = 0; k < STORY.breachEvery * MIN * doors.length + MIN; k++) {
    c.step(0);
    torn += c.events.filter((e) => e.type === 'breach').length;
  }
  check(torn === doors.length && c.bars.length === 0, `${torn} of ${doors.length} barred doors torn open`);
  // Another building boarded up and stood in: its doors are torn open first.
  const other = c.district.lots.findIndex(
    (l, k) => k !== c.story.wayLot[0] && l.doors.length > 0 && c.zedPlaces.indoors.some((i) => c.district.lotAt[i] === k + 1),
  );
  s.bars[d] = [...c.district.lots[other].doors, doors[0]];
  c.rebar();
  stand(
    c,
    d,
    c.zedPlaces.indoors.find((i) => c.district.lotAt[i] === other + 1)!,
  );
  let first = -1;
  for (let k = 0; k < STORY.breachEvery * MIN + MIN && first < 0; k++) {
    c.step(0);
    for (const e of c.events) if (e.type === 'breach') first = e.tile;
  }
  check(c.district.lots[other].doors.includes(first), 'boarded into another building, the beacon lit: its doors hold');
  stand(c, d, c.story.exits[0]);
  // The dead on: they come for it, a few at a time, and the count is the night's.
  c.peace = false;
  s.health = 100;
  let most = 0;
  let seek = 0;
  for (let k = 0; k < 40 * MIN && !s.over && s.ready; k++) {
    c.step(0);
    s.health = 100;
    most = Math.max(most, s.zeds.length);
    seek += s.zeds.filter((z) => z.mode === ZED.SEEK || z.mode === ZED.CHASE).length ? 1 : 0;
  }
  check(most > 6 && seek > 0, `the beacon lit 40 minutes: ${most} of the dead at the most, ${seek} steps with one making for it`);
  say(
    `the beacon: ${STORY.extra} more of the dead than the night's, one arriving every ${STORY.trickle} minutes and making for whoever lit it; a barred door torn open (the building stood in first) every ${STORY.breachEvery} minutes (${doors.length} of ${doors.length})`,
  );
}
{
  // The generator: any hour; the gates open after the wait and not before; the dead come up inside the station.
  const c = new City(5);
  c.step(0);
  const s = c.state;
  s.kit = (1 << THINGS.length) - 1;
  s.flags = FLAG.ATE | FLAG.SLEPT | FLAG.FIXED;
  s.scouted = 7;
  const d = c.story.wayDistrict[2];
  stand(c, d, c.story.exits[2]);
  press(c, COP.CHOOSE, 3);
  s.zeds = [];
  check(
    press(c, COP.ACT).some((e) => e.type === 'ready' && e.on),
    'the generator started by day',
  );
  check(c.target() === null, 'the gates taken before they open');
  let inside = 0;
  let gates = -1;
  for (let k = 0; k <= (STORY.metroHold + 1) * MIN; k++) {
    c.step(0);
    s.health = 100;
    if (c.events.some((e) => e.type === 'gates')) gates = k;
    inside = Math.max(
      inside,
      s.zeds.filter((z) => c.district.lotAt[Math.floor(z.body.z / 1024) * MAP_W + Math.floor(z.body.x / 1024)] === c.story.wayLot[2] + 1)
        .length,
    );
  }
  check(Math.abs(gates - STORY.metroHold * MIN) <= MIN, `the gates open after ${gates / MIN} minutes`);
  check(inside > 0, 'none of the dead in the station with the generator running');
  s.zeds = [];
  c.peace = true;
  stand(c, d, c.story.exits[2]);
  check(c.target()?.kind === 'way' && objectives(c)[0].id === 'down3', `the gates open: ${ids(c)}`);
  press(c, COP.ACT);
  check(s.over === 2 && s.won === 3, 'the tunnel not taken');
  say(
    `the generator: started at any hour, the gates open ${STORY.metroHold} minutes on, the dead up into the station meanwhile (${inside} in it at the most)`,
  );
}
{
  // The boat: fitted at any hour, taken only on the tide, from the pier's end; the fog (a short sight, sound carrying).
  const c = new City(5);
  c.peace = true;
  c.step(0);
  const s = c.state;
  s.kit = (1 << THINGS.length) - 1;
  s.flags = FLAG.ATE | FLAG.SLEPT | FLAG.FIXED;
  s.scouted = 7;
  const d = c.story.wayDistrict[1];
  stand(c, d, c.story.exits[1]);
  press(c, COP.CHOOSE, 2);
  press(c, COP.ACT);
  check(s.ready === 1 && going(c) === 0, 'the engine fitted by day: no fog yet');
  check(c.target() === null, 'the boat taken from the boathouse');
  stand(c, d, c.story.pier);
  check(
    press(c, COP.ACT).some((e) => e.type === 'refused' && e.why === 'tide'),
    'the boat taken at low tide',
  );
  // Walked out and back: the engine stays fitted.
  const out = neighbour(
    d,
    [0, 1, 2, 3].find((side) => c.plan.gates[d][side])!,
  );
  stand(c, out, c.districtOf(out).spawn.z * MAP_W + c.districtOf(out).spawn.x);
  check(s.ready === 1, 'the engine comes out when the docks are left');
  stand(c, d, c.story.pier);
  while (c.minute !== STORY.tideFrom) c.step(0);
  check(going(c) === 2, 'no fog on the docks at night with the boat ready');
  // The fog: one of the dead three tiles off down a clear plank doesn't see the player (four by a clear night); a blow is heard at twice the reach.
  const zed = (tile: number): Zed => ({
    body: xz(tile),
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
  const line = [1, -1, MAP_W, -MAP_W].find((dd) => [1, 2, 3].every((k) => !c.grid[c.story.pier + dd * k]))!;
  check(line !== undefined, 'seed 5: three clear tiles off the pier end');
  s.zeds = [zed(c.story.pier + line * 3)];
  for (let k = 0; k < 10; k++) stepDead(c);
  check(s.zeds[0].mode !== ZED.CHASE, 'seen from three tiles in the fog');
  s.ready = 0;
  s.zeds = [zed(c.story.pier + line * 3)];
  for (let k = 0; k < 10; k++) stepDead(c);
  check(s.zeds[0].mode === ZED.CHASE, 'not seen from three tiles on a clear night');
  const off = (n: number) =>
    zed(
      c.zedPlaces.streets.find(
        (i) => Math.max(Math.abs((i % MAP_W) - (c.tile % MAP_W)), Math.abs(Math.floor(i / MAP_W) - Math.floor(c.tile / MAP_W))) === n,
      )!,
    );
  s.zeds = [off(12)];
  noise(c, c.tile, 7);
  check(s.zeds[0].mode !== ZED.SEEK, 'a blow heard twelve tiles off on a clear night');
  s.ready = 1;
  noise(c, c.tile, 7);
  check(s.zeds[0].mode === ZED.SEEK, 'a blow not heard twelve tiles off in the fog');
  s.zeds = [];
  // A fall on the pier's end (a Survivor): the engine stays fitted, and back on the tile the button is the boat, not the pile.
  s.inv[0] = [cityItemNumber('tin'), 2];
  c.hurt(200);
  check(s.ready === 1 && s.way === 2 && !s.over, 'a fall with the engine fitted takes it out');
  stand(c, d, c.story.pier);
  check(c.target()?.kind === 'way', `on the pier's end with a pile underfoot the button is ${c.target()?.kind}`);
  while (c.minute !== STORY.tideFrom) {
    s.hunger = 90_000;
    c.step(0);
  }
  press(c, COP.ACT);
  check(s.over === 2 && s.won === 2, 'the boat not taken on the tide');
  say(
    `the boat: fitted at any hour and left fitted, taken from the pier's end between ${STORY.tideFrom / 60}:00 and 0${STORY.tideTo / 60}:00 only, in fog (the dead see two tiles, a blow carries twice as far); a fall keeps the engine fitted, and a pile on the pier's end doesn't take the button`,
  );
}

// ------------------------------------------------------------------ a fall, a save
{
  const c = new City(7, MODE.SURVIVOR);
  c.peace = true;
  c.step(0);
  const s = c.state;
  s.kit = (1 << THINGS.length) - 1;
  s.flags = FLAG.ATE | FLAG.SLEPT | FLAG.FIXED;
  s.scouted = 7;
  s.notes = 5;
  stand(c, c.story.wayDistrict[2], c.story.exits[2]);
  press(c, COP.CHOOSE, 3);
  press(c, COP.ACT);
  c.hurt(200);
  check(
    !s.over && !s.ready && s.way === 3 && s.kit === (1 << THINGS.length) - 1 && s.act === 4,
    'a Survivor fell: the kit and the way kept, the generator stopped',
  );
  // Lit and fallen: the beacon out too. Asleep, a way out is still chosen from the journal.
  {
    const b = new City(7, MODE.SURVIVOR);
    b.peace = true;
    b.step(0);
    Object.assign(b.state, { kit: (1 << THINGS.length) - 1, flags: 7, scouted: 7 });
    stand(b, b.story.wayDistrict[0], b.story.exits[0]);
    b.state.sleeping = true;
    press(b, COP.CHOOSE, 1);
    check(b.state.way === 1, 'a way out chosen in bed is dropped');
    b.state.sleeping = false;
    while (b.minute !== 22 * 60) b.step(0);
    press(b, COP.ACT);
    check(b.state.ready === 1, 'the beacon lit');
    b.hurt(200);
    check(!b.state.ready && b.state.way === 1 && b.state.heard.includes('fell'), 'a fall leaves the beacon lit');
  }
  const again = loadCity(JSON.parse(JSON.stringify(c.snapshot())))!;
  check(
    again.state.kit === s.kit && again.state.way === 3 && again.state.notes === 5 && again.state.act === 4 && again.state.scouted === 7,
    'a save loses the story',
  );
  // One from before the story: its first act. A story that makes no sense: started again, the city kept.
  const old = JSON.parse(JSON.stringify(c.snapshot()));
  for (const k of ['act', 'flags', 'kit', 'scouted', 'way', 'notes', 'ready', 'readyAt', 'won', 'heard']) delete old.state[k];
  const from = loadCity(old)!;
  check(!!from && from.state.act === 1 && from.state.kit === 0 && from.state.heard.length === 0, 'a save from before the story');
  // One whose player had already searched the radio's furniture and a note's: both are found, or they never could be.
  const looted = JSON.parse(JSON.stringify(old));
  const r0 = c.story.things[0];
  const n3 = c.story.notes[3];
  looted.state.boxes[`${r0.district}:${r0.prop}`] = [];
  looted.state.boxes[`${n3.district}:${n3.prop}`] = [];
  const kept = loadCity(looted)!;
  check(
    kept.state.kit === 1 && kept.state.notes === 8,
    `a save that had searched the radio's furniture: kit ${kept.state.kit}, notes ${kept.state.notes}`,
  );
  const over = JSON.parse(JSON.stringify(c.snapshot()));
  over.state.over = 2;
  check(loadCity(over) === null, 'a save of a city that is over loads');
  const bad: Array<[string, unknown]> = [
    ['kit', 1 << 20],
    ['way', 9],
    ['heard', ['nonsense']],
    ['ready', 1],
    ['won', 2],
    ['notes', -1],
    ['act', 2.5],
  ];
  for (const [k, v] of bad) {
    const snap = JSON.parse(JSON.stringify(c.snapshot()));
    snap.state[k] = v;
    if (k === 'ready') snap.state.way = 0;
    const got = loadCity(snap);
    check(
      !!got && got.state.kit === 0 && got.state.way === 0 && got.state.step === s.step,
      `a save with ${k} = ${JSON.stringify(v)} isn't started again`,
    );
  }
  const hard = new City(7, MODE.HARDCORE);
  hard.peace = true;
  hard.step(0);
  hard.state.kit = 3;
  hard.hurt(200);
  check(hard.state.over === 1 && hard.state.won === 0, 'Hardcore: a fall is not the end');
  say(
    `a Survivor's fall keeps the kit and the way chosen and stops what was set going; a save carries the story; one from before it starts at the first act with what its searched furniture held; ${bad.length} damaged stories start again with the city kept`,
  );
  check(new Set(BEATS).size === BEATS.length, 'a line of Dispatch named twice');
}

// ------------------------------------------------------------------ the survivors (C3b)
{
  const SEEDS = 60;
  const where: Record<string, number> = {};
  for (let seed = 1; seed <= SEEDS; seed++) {
    const c = new City(seed);
    const at = `seed ${seed}`;
    c.story.people.forEach((p, k) => {
      const who = PEOPLE[k];
      const dist = c.districtOf(p.district);
      const use = dist.lots[p.lot].use;
      where[`${who.id} ${use}`] = (where[`${who.id} ${use}`] ?? 0) + 1;
      check(who.uses.includes(use) && dist.lotAt[p.tile] === p.lot + 1, `${at}: the ${who.id} isn't in a building of theirs (${use})`);
      check(
        !c.story.things.some(
          (t) =>
            t.district === p.district &&
            c.districtOf(t.district).props[t.prop].z * MAP_W + c.districtOf(t.district).props[t.prop].x === p.tile,
        ),
        `${at}: the ${who.id} stands on a thing`,
      );
      // Standing there, they cut nothing off: every tile walked to before still is.
      const open = c.districtGrid(p.district);
      const sp = dist.spawn.z * MAP_W + dist.spawn.x;
      const before = reachFrom(sp, (i) => !open[i]);
      const after = reachFrom(sp, (i) => !open[i] && i !== p.tile);
      let lost = 0;
      for (let i = 0; i < before.length; i++) if (before[i] && !after[i] && i !== p.tile) lost++;
      check(lost === 0, `${at}: the ${who.id} cuts ${lost} tiles off`);
    });
  }
  say(
    `${SEEDS} cities: four survivors each in a building of theirs, on open floor, cutting nothing off (${Object.entries(where)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ')})`,
  );

  const c = new City(3);
  c.peace = true;
  c.step(0);
  const s = c.state;
  const N = (id: string) => cityItemNumber(id);
  const by = (k: number) => {
    const p = c.story.people[k];
    stand(c, p.district, p.tile + 1);
    c.state.player.facing = nearestDir(-1, 0);
    c.step(0);
  };
  // The fence: met, a word, then three bits of cloth for the armoury's key and two tins.
  by(0);
  check(c.target()?.kind === 'npc' && c.grid[c.story.people[0].tile] === 1, `beside the fence the button is ${c.target()?.kind}`);
  let ev = press(c, COP.ACT);
  check(s.met === 1 && ev.some((e) => e.type === 'talk' && e.what === 'met'), 'the fence met');
  ev = press(c, COP.ACT);
  check(ev.some((e) => e.type === 'talk' && e.what === 'chat') && !(s.flags & FLAG.KEY), 'an errand paid with nothing brought');
  // Talk hands nothing over (the radio's batteries are safe in the pockets): his card's button does.
  s.inv[0] = [N('cloth'), 4];
  ev = press(c, COP.ACT);
  check(
    ev.some((e) => e.type === 'talk' && e.what === 'chat') && c.count(N('cloth')) === 4 && s.errand[0] === 0,
    'a word hands the errand over',
  );
  ev = press(c, COP.GIVE, 0);
  check(
    ev.some((e) => e.type === 'talk' && e.what === 'done') &&
      (s.flags & FLAG.KEY) !== 0 &&
      c.count(N('cloth')) === 1 &&
      c.count(N('tin')) === 2 &&
      s.errand[0] === 1,
    `the fence's first errand: key ${s.flags & FLAG.KEY}, cloth ${c.count(N('cloth'))}, tins ${c.count(N('tin'))}`,
  );
  // His swaps: refused without the things, made with them, and only beside him.
  ev = press(c, COP.TRADE, 1);
  check(
    ev.some((e) => e.type === 'refused' && e.why === 'noTrade'),
    'a swap with nothing to give',
  );
  s.inv[3] = [N('scrap'), 2];
  ev = press(c, COP.TRADE, 1);
  check(ev.some((e) => e.type === 'traded') && c.count(N('scrap')) === 0 && c.count(N('nails')) === 1, 'two scrap for nails');
  s.inv[3] = [N('scrap'), 2];
  stand(
    c,
    c.story.people[0].district,
    c.districtOf(c.story.people[0].district).spawn.z * MAP_W + c.districtOf(c.story.people[0].district).spawn.x,
  );
  press(c, COP.TRADE, 1);
  check(c.count(N('scrap')) === 2, 'a swap from across the district');
  // The nurse: her recipe unknown until her first errand; her second counts the dead put down since it was asked.
  const medkit = CITY_RECIPES.findIndex((r) => r.makes === 'medkit');
  check(c.canMake(medkit) === 'unknown', 'the medkit known before the nurse shows it');
  ev = press(c, COP.MAKE, medkit);
  check(
    ev.some((e) => e.type === 'cantMake' && e.why === 'unknown'),
    'the medkit made unknown',
  );
  by(1);
  press(c, COP.ACT);
  s.inv[4] = [N('bottle'), 2];
  press(c, COP.GIVE, 1);
  check(s.errand[1] === 1 && c.canMake(medkit) !== 'unknown' && c.count(N('bandage')) === 2, "the nurse's first errand teaches the medkit");
  s.kills += 9;
  press(c, COP.GIVE, 1);
  check(s.errand[1] === 1, 'nine put down pays for ten');
  s.kills += 1;
  // (Her pay with the pockets full: on the ground underfoot, said, and she is still who the button means.)
  for (const st of s.inv)
    if (!st[0]) {
      st[0] = N('scrap');
      st[1] = 4;
    }
  ev = press(c, COP.GIVE, 1);
  check(
    s.errand[1] === 2 && ev.some((e) => e.type === 'full') && c.target()?.kind === 'npc',
    `paid with full pockets: the button is ${c.target()?.kind}`,
  );
  press(c, COP.GIVE, 1);
  check(s.errand[1] === 2, 'an errand handed over twice');
  ev = press(c, COP.ACT);
  check(
    ev.some((e) => e.type === 'talk' && e.what === 'chat'),
    'a third errand',
  );
  // A save carries them; nonsense in them starts the story again.
  const again = loadCity(JSON.parse(JSON.stringify(c.snapshot())))!;
  check(
    again.state.met === 3 && again.state.errand.join() === '1,2,0,0' && (again.state.flags & FLAG.KEY) !== 0,
    'a save loses the survivors',
  );
  const bad = JSON.parse(JSON.stringify(c.snapshot()));
  bad.state.errand = [3, 0, 0, 0];
  check(loadCity(bad)!.state.met === 0, 'an errand past its last is kept');
  // None of the dead are put down in a building one of them holds.
  // (Counted from across the district, by day, when they stand indoors; with the rule off they are there.)
  c.peace = false;
  const nurse = c.story.people[1];
  stand(c, nurse.district, c.districtOf(nurse.district).spawn.z * MAP_W + c.districtOf(nurse.district).spawn.x);
  s.step = ((2 - 1) * 1440 + 12 * 60 - START_MINUTE) * MIN;
  const count = () => {
    let n = 0;
    for (let k = 0; k < 60; k++) {
      populate(c);
      n += s.zeds.filter(
        (z) => c.district.lotAt[Math.floor(z.body.z / 1024) * MAP_W + Math.floor(z.body.x / 1024)] === nurse.lot + 1,
      ).length;
    }
    return n;
  };
  const inside = count();
  const kept = c.safeLots;
  c.safeLots = new Set();
  const without = count();
  c.safeLots = kept;
  check(inside === 0 && without > 0, `${inside} of the dead put down in the nurse's building (${without} with the rule off)`);
  say(
    `the survivors: met, then an errand each in turn (things brought, or the dead put down since it was asked); the fence's first pays the armoury's key, the others' teach a recipe; swaps only beside them and only with the things; a word hands nothing over, their card's button does; pay that doesn't fit lies underfoot and they keep the button; none of the dead put down in their buildings; a save carries them`,
  );
}

// ------------------------------------------------------------------ runners and brutes (C3b)
{
  const c = new City(4);
  c.step(0);
  const s = c.state;
  const far = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((d) => danger(c, d) >= BRUTE.danger)!;
  stand(c, far, c.districtOf(far).spawn.z * MAP_W + c.districtOf(far).spawn.x);
  const census = (night: number) => {
    s.step = ((night - 1) * 1440 + 23 * 60 - START_MINUTE) * MIN;
    let runners = 0;
    let brutes = 0;
    let most = 0;
    for (let k = 0; k < 30; k++) {
      populate(c);
      runners += s.zeds.filter((z) => z.kind === ZKIND.RUNNER).length;
      const b = s.zeds.filter((z) => z.kind === ZKIND.BRUTE).length;
      brutes += b;
      most = Math.max(most, b);
    }
    return { runners, brutes, most, all: 30 };
  };
  const n2 = census(2);
  const n3 = census(RUNNER.fromNight);
  const n5 = census(BRUTE.fromNight);
  check(n2.runners === 0 && n2.brutes === 0, `night 2: ${n2.runners} runners, ${n2.brutes} brutes`);
  check(n3.runners > 0 && n3.brutes === 0, `night 3: ${n3.runners} runners, ${n3.brutes} brutes`);
  check(
    n5.brutes === 1 && n5.most === 1 && n5.runners > 0,
    `night 5: ${n5.brutes} brutes over 30 puttings down in one night (one a district a night), ${n5.runners} runners`,
  );
  s.step = ((5 - 1) * 1440 + 12 * 60 - START_MINUTE) * MIN;
  populate(c);
  check(!s.zeds.some((z) => z.kind), 'runners or brutes by day');
  // A brute at a barred door pounds it open; a shambler stands there all night.
  const lot = c.district.lots.findIndex((l, k) => l.doors.length === 1 && c.zedPlaces.indoors.some((i) => c.district.lotAt[i] === k + 1));
  const door = c.district.lots[lot].doors[0];
  const inTile = c.zedPlaces.indoors.filter((i) => c.district.lotAt[i] === lot + 1).sort((a, b) => far2(a, door) - far2(b, door))[0];
  const out = [door - 1, door + 1, door - MAP_W, door + MAP_W].find((i) => !c.grid[i] && c.district.lotAt[i] !== lot + 1)!;
  const siege = (kind: number) => {
    s.step = ((5 - 1) * 1440 + 23 * 60 - START_MINUTE) * MIN;
    s.bars[far] = [door];
    c.rebar();
    stand(c, far, inTile);
    s.zeds = [
      {
        body: xz(out),
        hp: 90,
        mode: ZED.CHASE,
        goal: -1,
        path: [],
        seen: s.step,
        last: inTile,
        bit: -9999,
        reel: 0,
        near: 0,
        pace: 1000,
        ...(kind ? { kind } : {}),
      },
    ];
    for (let k = 0; k < BRUTE.pound * 4; k++) {
      s.health = 100;
      s.zeds.length = Math.min(1, s.zeds.length);
      c.step(0);
      if (c.events.some((e) => e.type === 'breach')) return k;
    }
    return -1;
  };
  const shambler = siege(0);
  const brute = siege(ZKIND.BRUTE);
  check(shambler < 0, 'a shambler broke a barred door');
  // A thing of the armoury's in a bed looked into and emptied before the key was had: still looked into after, never slept in.
  {
    let seed = 1;
    while (seed < 80) {
      const t = new City(seed);
      const sp = t.story.things[THINGS.indexOf('flare')];
      if (t.districtOf(sp.district).props[sp.prop].kind === 'bed') break;
      seed++;
    }
    const t = new City(seed);
    t.peace = true;
    t.step(0);
    fetch(t, THINGS.indexOf('flare'));
    const sp = t.story.things[THINGS.indexOf('flare')];
    for (const st of t.state.boxes[`${sp.district}:${sp.prop}`]) st[0] = st[1] = 0;
    t.step(0);
    check(t.target()?.kind === 'box', `seed ${seed}: the armoury's bed, emptied, is a ${t.target()?.kind}`);
    t.state.flags |= FLAG.KEY;
    const got = fetch(t, THINGS.indexOf('flare'));
    check(got.some((e) => e.type === 'found') && t.target()?.kind === 'bed', `seed ${seed}: the flare gun out of its bed with the key`);
  }
  check(brute >= BRUTE.pound - 1, `a brute at a barred door: ${brute} steps`);
  say(
    `runners from night ${RUNNER.fromNight} and one brute from night ${BRUTE.fromNight} where the danger is ${BRUTE.danger} or more, at night only; a brute at a barred door pounds it open in ${BRUTE.pound} steps without seeing through it, a shambler never; one brute a district a night; a thing of the armoury's in an emptied bed is still looked into`,
  );
}

// ------------------------------------------------------------------ the records (C3b)
{
  const none: CityRecord = { v: 1, wins: [0, 0, 0], best: 0, feats: [] };
  const a = withRun(none, { way: 2, day: 9, hardcore: false, deaths: 2, kills: 12, notes: 4, errands: 3 });
  check(a.fresh.join() === 'boat' && a.record.wins.join() === '0,1,0' && a.record.best === 9, `a first way out: ${a.fresh.join()}`);
  const b = withRun(a.record, { way: 1, day: 5, hardcore: true, deaths: 0, kills: 44, notes: 10, errands: 8 });
  check(b.fresh.join() === 'heli,hardcore,swift,reader,friend,clean,hunter' && b.record.best === 5, `a second: ${b.fresh.join()}`);
  const d = withRun(b.record, { way: 3, day: 20, hardcore: false, deaths: 1, kills: 0, notes: 0, errands: 0 });
  check(d.fresh.join() === 'metro,three' && d.record.feats.length === 10 && d.record.best === 5, `a third: ${d.fresh.join()}`);
  check(
    withRun(d.record, { way: 3, day: 2, hardcore: true, deaths: 0, kills: 99, notes: 10, errands: 8 }).fresh.length === 0,
    'a feat had twice',
  );
  say('the records: a way out counted, the quickest kept, ten feats each had once');
}

// ------------------------------------------------------------------ a bot to each way out
{
  const CITIES = [1, 2, 3, 4];
  const DAYS = 14;
  const rows: string[] = [];
  const days = [0, 0, 0];
  let won = 0;
  for (const seed of CITIES)
    for (let way = 1; way <= 3; way++) {
      const c = new City(seed, MODE.SURVIVOR);
      c.peace = true;
      const bot = quester(c, way);
      let steps = 0;
      while (!c.state.over && steps++ < DAYS * 1440 * MIN) c.step(bot());
      const ok = c.state.over === 2 && c.state.won === way;
      check(ok, `seed ${seed}: the bot never left by the ${WAYS[way - 1].id} (act ${c.state.act}, ${ids(c)}, day ${c.day})`);
      if (ok) {
        won++;
        days[way - 1] += c.day;
      }
      rows.push(`  ${seed} ${WAYS[way - 1].id}: day ${c.day}, ${fnv1a(JSON.stringify(c.state))}`);
    }
  say(
    `a bot follows the story to each way out on ${CITIES.length} cities (the dead away): ${won} of ${CITIES.length * 3} left, by day ${(days[0] / CITIES.length).toFixed(1)} (helicopter), ${(days[1] / CITIES.length).toFixed(1)} (boat), ${(days[2] / CITIES.length).toFixed(1)} (metro) on average`,
  );
  for (const r of rows) say(r);
}
{
  // The holds alone, the dead about: a bot with a bat and three bandages on the first night, never standing still.
  const tally = [0, 0];
  for (const way of [1, 3])
    for (let seed = 1; seed <= 6; seed++) {
      const c = new City(seed);
      c.peace = true;
      c.step(0);
      const s = c.state;
      Object.assign(s, { kit: (1 << THINGS.length) - 1, flags: 7, scouted: 7 });
      s.inv[0] = [cityItemNumber('bat'), 40];
      s.inv[1] = [cityItemNumber('bandage'), 3];
      s.inv[2] = [cityItemNumber('tin'), 3];
      stand(c, c.story.wayDistrict[way - 1], c.story.exits[way - 1]);
      press(c, COP.CHOOSE, way);
      while (c.minute !== 21 * 60 + 30) c.step(0);
      s.hunger = s.energy = 90_000;
      c.peace = false;
      s.arrive = 1;
      const bot = quester(c, way);
      for (let k = 0; k < 260 * MIN && !s.over && !s.deaths; k++) c.step(bot());
      if (s.over === 2) tally[way === 1 ? 0 : 1]++;
    }
  check(tally[0] >= 4 && tally[1] >= 4, `the holds with the dead about: the helicopter ${tally[0]} of 6, the metro ${tally[1]} of 6`);
  say(
    `the holds alone with the dead about (a bat, three bandages, the first night, a bot that keeps moving): the helicopter ${tally[0]} of 6, the metro ${tally[1]} of 6`,
  );
}
{
  // The same with the dead about, as a Survivor: told, not required (a bot that fights what comes and never hides).
  const rows: string[] = [];
  let won = 0;
  let falls = 0;
  for (const seed of [1, 2])
    for (let way = 1; way <= 3; way++) {
      const c = new City(seed, MODE.SURVIVOR);
      const bot = quester(c, way);
      let steps = 0;
      while (!c.state.over && c.day <= 12 && steps++ < 12 * 1440 * MIN) c.step(bot());
      if (c.state.over === 2) won++;
      falls += c.state.deaths;
      rows.push(
        `  ${seed} ${WAYS[way - 1].id}: ${c.state.over === 2 ? `left on day ${c.day}` : `still there on day ${c.day} (act ${c.state.act})`}, fell ${c.state.deaths}, ${c.state.kills} put down`,
      );
    }
  say(
    `with the dead about, a Survivor bot that scavenges, fights what reaches it and never hides, 12 days at the most: ${won} of 6 left, ${falls} falls in all`,
  );
  for (const r of rows) say(r);
}

console.log(lines.join('\n'));
