/**
 * City Escape's cars searched (2.54, city/sim/cars.ts): every car and wreck of twelve cities can be
 * stood beside and is the action's target there (after furniture and a pile); a search by
 * ordinary commands (a moment the first time, at once after, the same things in the same city); what
 * cars and wrecks hold; the alarm (which cars, the dead that aren't after anyone called to it, how
 * long, never twice, not heard from the next district) and what a save keeps of it.
 */
import { check } from './assert';
import { cityItem, cityItemNumber } from '../src/city/content/items';
import { CARS, SEARCH_STEPS } from '../src/city/content/loot';
import { DECO } from '../src/city/gen/district';
import { alarmCars, alarmed, carTiles, isWreck } from '../src/city/sim/cars';
import { City, COP, loadCity, type CityEvent } from '../src/city/sim/City';
import { ZED, type Zed } from '../src/city/sim/dead';
import { command } from '../src/sim/command';
import { fnv1a } from '../src/sim/rng';
import { bodyAt } from '../src/sim/systems/movement';
import { MAP_W, tileAt } from '../src/sim/world/grid';

const lines: string[] = [];
const say = (s: string) => lines.push(s);
const MIN = 20;
const W = MAP_W;
const N = W * W;
const enter = (c: City, d: number) => (c as unknown as { enter(d: number): void }).enter(d);
const stand = (c: City, tile: number, facing = 0) => {
  c.state.player = bodyAt(tile % W, Math.floor(tile / W), facing || undefined);
  c.step(0);
};
const far = (a: number, b: number) => Math.max(Math.abs((a % W) - (b % W)), Math.abs(Math.floor(a / W) - Math.floor(b / W)));
const cars = (c: City) => Array.from({ length: N }, (_, i) => i).filter((i) => c.carAt[i] === i + 1);
/** The free tiles beside a car. */
const beside = (c: City, first: number) =>
  carTiles(c, first)
    .flatMap((t) => [t - W, t + 1, t + W, t - 1])
    .filter((t) => t >= 0 && t < N && !c.grid[t] && far(t, first) <= 2);
/** A car searched by the button: every event of it. */
function search(c: City): CityEvent[] {
  const all: CityEvent[] = [];
  c.step(command(0, COP.ACT));
  all.push(...c.events);
  for (let k = 0; k < SEARCH_STEPS + 2 && !c.state.open; k++) {
    c.step(0);
    all.push(...c.events);
  }
  return all;
}
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

// ------------------------------------------------------------------ every car of twelve cities
let withAlarm: { seed: number; d: number; first: number } | null = null;
let plain: { seed: number; d: number; first: number } | null = null;
let wreckAt: { seed: number; d: number; first: number } | null = null;
{
  let nCars = 0;
  let nWrecks = 0;
  let alarms = 0;
  let cut = 0;
  let things = 0;
  let empty = 0;
  const found = new Map<string, number>();
  const CITIES = 12;
  for (let seed = 1; seed <= CITIES; seed++) {
    const c = new City(seed);
    c.peace = true;
    c.step(0);
    for (let d = 0; d < 9; d++) {
      if (d !== c.state.district) enter(c, d);
      for (const first of cars(c)) {
        const wreck = isWreck(c, first);
        if (wreck) nWrecks++;
        else nCars++;
        check(
          carTiles(c, first).length === 2,
          `seed ${seed} district ${d}: the car at ${first} stands on ${carTiles(c, first).length} tiles`,
        );
        check(c.district.deco[first] === DECO.CAR || wreck, `seed ${seed} district ${d}: ${first} is no car`);
        const at = beside(c, first);
        if (!at.length) {
          cut++;
          continue;
        }
        if (alarmed(c, first)) {
          alarms++;
          check(!wreck, `seed ${seed} district ${d}: a wreck with an alarm`);
          withAlarm ??= { seed, d, first };
        } else if (wreck) wreckAt ??= { seed, d, first };
        else plain ??= { seed, d, first };
        // (What it holds: looked at through the button, from a tile beside it, its alarm aside.)
        stand(c, at[0]);
        const t = c.target();
        if (t?.key !== `c${first}`) continue;
        search(c);
        const box = c.box().filter((st) => st[0]);
        if (!box.length) empty++;
        for (const st of box) {
          const n = cityItem(st[0])?.wear === undefined ? st[1] : 1;
          things += n;
          found.set(cityItem(st[0])!.id, (found.get(cityItem(st[0])!.id) ?? 0) + n);
        }
        c.step(command(0, COP.CLOSE));
        c.state.alarm = [];
      }
    }
  }
  const all = nCars + nWrecks;
  check(cut <= all / 50, `${cut} of ${all} cars can't be stood beside`);
  check(alarms > nCars / 8 && alarms < nCars / 5, `${alarms} of ${nCars} cars have an alarm`);
  const top = [...found.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  say(
    `${CITIES} cities: ${nCars} cars and ${nWrecks} wrecks, ${cut} with no tile to stand beside; ${alarms} cars with an alarm (one in ${CARS.alarmOneIn}), no wreck`,
  );
  say(
    `searched, all of them (${CARS.draws} draw a car, ${CARS.wreckDraws} a wreck): ${things} things (${(things / all).toFixed(2)} each, ${Math.round((100 * empty) / all)}% empty); the most found: ${top
      .slice(0, 6)
      .map(([id, n]) => `${id} ${n}`)
      .join(', ')}`,
  );
  check((found.get('fuel') ?? 0) > 0 && (found.get('scrap') ?? 0) > 0, 'fuel and scrap are found in them');
}

// ------------------------------------------------------------------ a search, by the button
{
  check(!!plain && !!wreckAt, 'a car without an alarm and a wreck to search');
  const open = (at: { seed: number; d: number; first: number }) => {
    const c = new City(at.seed);
    c.peace = true;
    c.step(0);
    if (at.d !== c.state.district) enter(c, at.d);
    stand(c, beside(c, at.first)[0]);
    return c;
  };
  const c = open(plain!);
  const t = c.target();
  check(t?.kind === 'box' && t.key === `c${plain!.first}` && t.prop === 'car', `beside a car the button is ${JSON.stringify(t)}`);
  check(!c.searched(`c${plain!.first}`), 'not searched yet');
  c.step(command(0, COP.ACT));
  check(c.state.search === `c${plain!.first}` && !c.state.open, 'a first search takes a moment');
  let steps = 0;
  const ev: CityEvent[] = [];
  while (!c.state.open && steps++ < 100) {
    c.step(0);
    ev.push(...c.events);
  }
  check(steps === SEARCH_STEPS, `the search took ${steps} steps`);
  check(
    ev.some((e) => e.type === 'open' && e.first) && !ev.some((e) => e.type === 'alarm'),
    'opened, and no alarm from a car that has none',
  );
  const held = JSON.stringify(c.box());
  c.step(command(0, COP.TAKE_ALL));
  c.step(command(0, COP.CLOSE));
  c.step(command(0, COP.ACT));
  check(c.state.open === `c${plain!.first}` && c.searched(`c${plain!.first}`), 'a second look is at once');
  c.step(command(0, COP.CLOSE));
  // Walked away from mid-search: nothing opened, nothing drawn.
  const w = open(plain!);
  w.step(command(0, COP.ACT));
  stand(w, beside(w, plain!.first)[0] === w.tile ? w.zedPlaces.streets.find((i) => far(i, plain!.first) > 6)! : w.tile);
  for (let k = 0; k < SEARCH_STEPS + 5; k++) w.step(0);
  check(!w.searched(`c${plain!.first}`) && !w.state.open, 'walked away from: not searched');
  // The same city, the same car: the same things.
  const again = open(plain!);
  search(again);
  check(JSON.stringify(again.box()) === held, 'the same car of the same city holds the same things');
  // A wreck: named as one.
  const k = open(wreckAt!);
  check(k.target()?.prop === 'wreck', `beside a wreck the button is ${JSON.stringify(k.target())}`);
  // A pile underfoot comes first; picked clean, the press that shuts it doesn't start on the car.
  const o = open(plain!);
  const here = o.tile;
  o.state.inv[0] = [cityItemNumber('tin'), 1];
  o.step(command(0, COP.DROP, 0));
  check(o.target()?.kind === 'pile' && o.target()?.key === `g${here}`, `a pile underfoot beside a car: the button is ${o.target()?.kind}`);
  o.step(command(0, COP.ACT));
  o.step(command(0, COP.TAKE_ALL));
  check(o.state.open === `g${here}` && o.target()?.key === `c${plain!.first}`, 'the pile emptied and still open, the car beside');
  o.step(command(0, COP.ACT));
  check(!o.state.open && !o.state.search, `the press that shuts the emptied pile starts no search: ${o.state.search}`);
  // Furniture beside comes before a car beside, wherever the two stand round one tile (cars stand outdoors: nowhere, in these cities).
  let both = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const f = new City(seed);
    f.peace = true;
    f.step(0);
    const propAt = () => (f as unknown as { propAt: Int16Array }).propAt;
    for (let d = 0; d < 9; d++) {
      if (d !== f.state.district) enter(f, d);
      for (const first of cars(f))
        for (const t of beside(f, first)) {
          if (![t - W, t + 1, t + W, t - 1].some((n) => n >= 0 && n < N && propAt()[n])) continue;
          stand(f, t);
          const tg = f.target();
          both++;
          check(
            tg?.prop !== 'car' && tg?.prop !== 'wreck',
            `seed ${seed} district ${d}: beside furniture and a car at ${t}, the button is the car`,
          );
        }
    }
  }
  // Things put in a car stay in it: a stash like any furniture.
  const st = open(plain!);
  search(st);
  st.step(command(0, COP.TAKE_ALL));
  st.state.inv[7] = [cityItemNumber('tin'), 2];
  st.step(command(0, COP.STORE, 7));
  st.step(command(0, COP.CLOSE));
  const back = loadCity(JSON.parse(JSON.stringify(st.snapshot())))!;
  check(
    (back.state.boxes[`${plain!.d}:c${plain!.first}`] ?? []).some((x) => x[0] === cityItemNumber('tin') && x[1] === 2),
    'two tins stored in a car are there after a save',
  );
  say(
    `a car beside: searched in ${SEARCH_STEPS} steps the first time, at once after; walked away from, nothing; the same car of the same city holds the same; a wreck is named a wreck; a pile underfoot comes first, and shutting it emptied starts no search; a tile beside both a car and furniture: ${both} in 12 cities (there furniture comes first); what is stored in a car stays`,
  );
}

// ------------------------------------------------------------------ the alarm
{
  check(!!withAlarm, 'a car with an alarm in twelve cities');
  const { seed, d, first } = withAlarm!;
  const c = new City(seed);
  c.step(0);
  if (d !== c.state.district) enter(c, d);
  c.state.zeds = [];
  c.state.step += ((12 * 60 - c.minute + 1440) % 1440) * MIN;
  const at = beside(c, first)[0];
  stand(c, at);
  check(alarmCars(c).includes(first), 'its red light is on before');
  // Three of the dead on the streets: one near, one at the alarm's edge, one beyond it; and one after somebody.
  const ring = (a: number, b: number) => c.zedPlaces.streets.filter((i) => far(i, at) >= a && far(i, at) <= b && !c.grid[i]);
  const near = zed(c, ring(7, 9)[0]);
  const edge = zed(c, ring(CARS.alarmReach - 1, CARS.alarmReach)[0]);
  const beyond = zed(c, ring(CARS.alarmReach + 3, CARS.alarmReach + 12)[0]);
  const busy = zed(c, ring(8, 10).pop()!, ZED.CHASE);
  busy.seen = c.state.step + 100_000;
  busy.last = busy.goal = tileAt(busy.body.x, busy.body.z);
  c.peace = false;
  // (They don't see the player meanwhile: the search is what's measured.)
  const hush = () => {
    for (const z of [near, edge, beyond]) if (z.mode === ZED.CHASE) z.mode = ZED.WANDER;
  };
  const ev: CityEvent[] = [];
  c.step(command(0, COP.ACT));
  for (let k = 0; k < SEARCH_STEPS + 2 && !c.state.open; k++) {
    hush();
    c.step(0);
    ev.push(...c.events);
  }
  check(
    ev.some((e) => e.type === 'alarm' && e.on && e.tile === first),
    'the alarm goes off as the car is opened',
  );
  check(
    c.state.alarm[0] === at && c.state.alarm[1] === c.state.step + CARS.alarmMinutes * MIN,
    `the alarm: ${c.state.alarm} at ${c.state.step}`,
  );
  check(near.mode === ZED.SEEK && near.goal === at, `one seven tiles off comes: ${near.mode} to ${near.goal}`);
  check(edge.mode === ZED.SEEK && edge.goal === at, `one at ${CARS.alarmReach} tiles comes: ${edge.mode}`);
  check(beyond.mode !== ZED.SEEK, 'one beyond its reach does not hear it');
  check(busy.mode === ZED.CHASE, 'one after somebody keeps after them');
  check(!alarmCars(c).includes(first), 'its light is out once searched');
  // It sounds for its minutes, then stops, said once.
  c.peace = true;
  c.state.zeds = [];
  let offs = 0;
  let minutes = 0;
  const from = c.state.step;
  while (c.state.alarm.length && minutes < 100) {
    for (let k = 0; k < MIN; k++) {
      c.step(0);
      for (const e of c.events) if (e.type === 'alarm' && !e.on) offs++;
    }
    minutes++;
  }
  check(
    // (It stops on a minute's turn: its twenty minutes, and what was left of the minute it began in.)
    offs === 1 && minutes >= CARS.alarmMinutes && minutes <= CARS.alarmMinutes + 1 && c.state.step - from <= (CARS.alarmMinutes + 1) * MIN,
    `it sounded ${minutes} minutes, stopped ${offs} time`,
  );
  // Searched again: no alarm.
  c.step(command(0, COP.CLOSE));
  const twice = search(c);
  check(!twice.some((e) => e.type === 'alarm') && !c.state.alarm.length, 'looked into again: no alarm');
  // One of the dead that comes while it sounds is called every minute, wherever it has got to.
  const c2 = new City(seed);
  c2.step(0);
  if (d !== c2.state.district) enter(c2, d);
  c2.state.zeds = [];
  c2.peace = true;
  stand(c2, at);
  search(c2);
  const late = zed(c2, ring(7, 9)[0], ZED.IDLE);
  for (let k = 0; k < MIN + 1; k++) c2.step(0);
  check(
    late.mode === ZED.SEEK && late.goal === c2.state.alarm[0],
    `one put down after it went off hears it on the next minute: ${late.mode}`,
  );
  // One already on its way somewhere else (to ground at dawn, to another noise) isn't called off it by the next minute's alarm.
  const going = zed(c2, ring(7, 9)[1], ZED.SEEK);
  going.goal = ring(10, 11)[0];
  for (let k = 0; k < MIN + 1; k++) c2.step(0);
  check(going.goal !== c2.state.alarm[0], 'one going somewhere else keeps going');
  // A Survivor's fall: nobody left to hear it.
  const f = new City(seed);
  f.step(0);
  if (d !== f.state.district) enter(f, d);
  f.peace = true;
  stand(f, at);
  search(f);
  f.step(command(0, COP.CLOSE));
  check(f.state.alarm.length === 2, 'sounding before the fall');
  f.hurt(1000);
  f.step(0);
  check(f.state.deaths === 1 && f.state.alarm.length === 0, `after a fall the alarm is ${f.state.alarm}`);
  // Not heard from the next district; back, the car stays searched and silent.
  const gate = c2.district.gates[0];
  enter(c2, gate.to);
  check(!c2.state.alarm.length, 'through a checkpoint: no alarm there');
  enter(c2, d);
  check(!c2.state.alarm.length && c2.searched(`c${first}`) && !alarmCars(c2).includes(first), 'back: searched, silent');
  say(
    `the alarm: off as the car is opened, heard ${CARS.alarmReach} tiles round the searcher (not beyond, not by one already after somebody), ${CARS.alarmMinutes} game minutes, said to stop once; never a second time; not heard from the next district nor after a fall; one of the dead going elsewhere isn't called off`,
  );
}

// ------------------------------------------------------------------ saves
{
  const { seed, d, first } = withAlarm!;
  const live = new City(seed);
  live.step(0);
  if (d !== live.state.district) enter(live, d);
  live.step(0);
  stand(live, beside(live, first)[0]);
  search(live);
  live.step(command(0, COP.CLOSE));
  for (let k = 0; k < 3 * MIN; k++) live.step(0);
  check(live.state.alarm.length === 2, 'an alarm sounding to save');
  const snap = JSON.parse(JSON.stringify(live.snapshot()));
  const loaded = loadCity(JSON.parse(JSON.stringify(snap)))!;
  check(JSON.stringify(loaded.state.alarm) === JSON.stringify(live.state.alarm), 'the alarm is kept by a save');
  check(loaded.searched(`c${first}`) && !alarmCars(loaded).includes(first), 'the car searched stays searched');
  // (The dead about and called by it; the two compared every game minute, from the first step.)
  let differ = -1;
  for (let k = 0; k < 30 * MIN && differ < 0; k++) {
    if (k % MIN === 0 && fnv1a(JSON.stringify(live.snapshot().state)) !== fnv1a(JSON.stringify(loaded.snapshot().state))) differ = k;
    live.step(0);
    loaded.step(0);
  }
  check(differ < 0, `a save made while it sounds plays on as the live city does (differs at ${differ})`);
  // A save from before cars; damaged ones.
  const old = JSON.parse(JSON.stringify(snap));
  delete old.state.alarm;
  delete old.state.boxes[`${d}:c${first}`];
  const fromOld = loadCity(old)!;
  check(
    !!fromOld && fromOld.state.alarm.length === 0 && alarmCars(fromOld).includes(first),
    'a save from before cars: none searched, no alarm',
  );
  let bad = 0;
  for (const alarm of ['x', [1], [-1, 5], [N, 5], [3, 1e12], [1.5, 2], { 0: 1 }, null]) {
    const s2 = JSON.parse(JSON.stringify(snap));
    s2.state.alarm = alarm;
    const got = loadCity(s2);
    if (got && got.state.alarm.length === 0) bad++;
  }
  check(bad === 8, `${bad} of 8 damaged alarms loaded as none`);
  say(
    `saves: an alarm sounding is kept and plays on the same; a save from before cars has none searched; ${bad} damaged alarms loaded as none`,
  );
}
console.log(lines.join('\n'));
