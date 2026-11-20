/**
 * City Escape's survival with weight (2.70, C5 batch 5, city/sim/survival.ts): thirst in a city begun from 2.70 (none before), how
 * fast it goes awake, asleep, in the heat, queasy, and what it does run dry; each state (well fed, refreshed, rested, queasy,
 * soaked) brought on and what it changes; fresh food going off at dawn in the pockets, not in a chest; the weather drawn from the
 * seed (day 1 clear, the shares as weighed), the fog's sight, the rain's hearing; a drink at the park's pond and a cast with a rod;
 * a planter grown by watering and by rain, harvested; a rain barrel filled by rain, drunk from, a bottle filled; jerky at a smoker;
 * the manuals' recipes and pieces learnt; a save keeping it all, a damaged one made sound.
 */
import { check } from './assert';
import { PIECE } from '../src/city/content/build';
import { cityItem, cityItemNumber } from '../src/city/content/items';
import { CITY_RECIPES } from '../src/city/content/recipes';
import { FOG, MOOD, WEATHER, WEATHER_WEIGHT } from '../src/city/content/survival';
import { buildList, canBuild } from '../src/city/sim/build';
import { City, COP, FULL, loadCity, PIECE_OPS, START_MINUTE, type CityEvent } from '../src/city/sim/City';
import { ZED, type Zed } from '../src/city/sim/dead';
import { fogSight, moodOn, weatherOf } from '../src/city/sim/survival';
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
const MIN = STEPS_PER_MINUTE;
const priv = (c: City) => c as unknown as { enter(d: number): void; sleep(): void };
const city = (seed: number) => {
  const c = new City(seed);
  c.peace = true;
  c.step(0);
  return c;
};
const at = (c: City, day: number, minute: number) => {
  c.state.step = ((day - 1) * 1440 + minute - START_MINUTE) * MIN - 1;
};
const pockets = (c: City, list: Array<[string, number?]>) => {
  c.state.inv = c.state.inv.map(() => [0, 0]);
  list.forEach(([id, n], k) => (c.state.inv[k] = [I(id), n ?? cityItem(I(id))!.wear ?? 1]));
};
const run = (c: City, steps: number, cmd = 0, keep: Array<'hunger' | 'energy' | 'thirst' | 'health'> = ['hunger', 'energy', 'health']) => {
  const out: CityEvent[] = [];
  for (let k = 0; k < steps && !c.state.over; k++) {
    if (keep.includes('hunger')) c.state.hunger = FULL;
    if (keep.includes('energy')) c.state.energy = FULL;
    if (keep.includes('thirst')) c.state.thirst = FULL;
    if (keep.includes('health')) c.state.health = 100;
    c.step(k === 0 ? cmd : 0);
    out.push(...c.events);
  }
  return out;
};
const stand = (c: City, tile: number, toward = tile + 1) => {
  c.state.zeds = [];
  c.state.player = bodyAt(
    tile % W,
    Math.floor(tile / W),
    nearestDir((toward % W) - (tile % W), Math.floor(toward / W) - Math.floor(tile / W)),
  );
  c.step(0);
};
/** A day of the given weather in this city (after day 1). */
const dayOf = (c: City, kind: string) => {
  for (let d = 2; d < 400; d++) if (WEATHER[weatherOf(c, d)] === kind) return d;
  return -1;
};

// ------------------------------------------------------------------ thirst
{
  const drained = (rev: number, sleeping: boolean, day = 1) => {
    const c = city(1);
    c.state.rev = rev;
    at(c, day, 9 * 60);
    c.step(0);
    c.state.thirst = FULL;
    c.state.sleeping = sleeping;
    for (let k = 0; k < 600 * MIN; k++) {
      c.state.hunger = FULL;
      c.state.energy = FULL;
      c.state.sleeping = sleeping;
      c.step(0);
    }
    return Math.round((100 * (FULL - c.state.thirst)) / FULL);
  };
  const awake = drained(6, false);
  const asleep = drained(6, true);
  const old = drained(5, false);
  const hot = (() => {
    const c = city(1);
    return drained(6, false, dayOf(c, 'heat'));
  })();
  check(awake === 42 && asleep === 18 && old === 0, `ten hours: ${awake}% awake, ${asleep}% asleep, ${old}% in a city begun before`);
  check(hot === 63, `ten hours in the heat: ${hot}%`);
  // Run dry: health goes, the walk slows.
  const c = city(2);
  c.state.thirst = 0;
  c.state.health = 100;
  for (let k = 0; k < 40 * MIN; k++) {
    c.state.hunger = FULL;
    c.step(0);
  }
  const lost = 100 - c.state.health;
  check(lost === 10, `forty minutes with no water: ${lost} health`);
  const walk = (thirst: number) => {
    const d = city(2);
    d.state.thirst = thirst;
    const x0 = d.state.player.x;
    const dir = nearestDir(1, 0);
    for (let k = 0; k < 10; k++) d.step(command(dir));
    return d.state.player.x - x0;
  };
  const slow = walk(FULL / 5);
  const fast = walk(FULL);
  check(slow < fast, `thirsty, a slower walk (${slow} against ${fast})`);
  say(
    `thirst in ten hours: ${awake}% awake, ${asleep}% asleep, ${hot}% in the heat, none in a city begun before 2.70; run dry, ${lost} health in forty minutes and a slower walk`,
  );
}

// ------------------------------------------------------------------ the states
{
  const c = city(3);
  // Water drunk; dirty water: queasy (hunger twice as fast); tea settles it.
  c.state.thirst = FULL / 2;
  pockets(c, [
    ['water', 1],
    ['dirty_water', 1],
    ['tea', 1],
  ]);
  run(c, 1, command(0, COP.USE, 0));
  // (A bottle's 40, less the minute's drain if a minute turned meanwhile.)
  check(c.state.thirst > FULL / 2 + 49_000, `water drunk (${c.state.thirst})`);
  c.state.thirst = FULL / 2;
  run(c, 1, command(0, COP.USE, 1));
  check(moodOn(c, MOOD.QUEASY), 'dirty water: queasy');
  const h0 = c.state.hunger;
  c.state.hunger = FULL / 2;
  for (let k = 0; k < 10 * MIN; k++) c.step(0);
  const queasyHunger = FULL / 2 - c.state.hunger;
  run(c, 1, command(0, COP.USE, 2));
  check(!moodOn(c, MOOD.QUEASY) && moodOn(c, MOOD.REFRESHED), 'tea: settled, and refreshed');
  c.state.hunger = FULL / 2;
  for (let k = 0; k < 10 * MIN; k++) c.step(0);
  const plainHunger = FULL / 2 - c.state.hunger;
  check(queasyHunger === plainHunger * 2, `queasy, hunger twice as fast (${queasyHunger} against ${plainHunger}) (${h0})`);
  // Refreshed: energy half as fast.
  c.state.energy = FULL / 2;
  for (let k = 0; k < 10 * MIN; k++) c.step(0);
  const fresh = FULL / 2 - c.state.energy;
  c.state.moods[MOOD.REFRESHED] = 0;
  c.state.energy = FULL / 2;
  for (let k = 0; k < 10 * MIN; k++) c.step(0);
  const tired = FULL / 2 - c.state.energy;
  check(fresh * 2 === tired, `refreshed, energy half as fast (${fresh} against ${tired})`);
  // Well fed: health back twice as often.
  const mended = (fed: boolean) => {
    const d = city(3);
    d.state.health = 50;
    d.state.hunger = FULL;
    if (fed) {
      pockets(d, [['stew', 1]]);
      d.state.hunger = FULL / 2 + 10_000;
      run(d, 1, command(0, COP.USE, 0), []);
    }
    const h = d.state.health;
    for (let k = 0; k < 60 * MIN; k++) {
      d.state.hunger = FULL;
      d.step(0);
    }
    return d.state.health - h;
  };
  const fedBack = mended(true);
  const plainBack = mended(false);
  check(fedBack >= plainBack * 2 - 1 && fedBack > plainBack, `well fed, an hour: ${fedBack} health back against ${plainBack}`);
  // Rested after a night in a bed: a blow costs half.
  const r = city(4);
  r.state.sleeping = true;
  at(r, 2, 5 * 60 + 58);
  for (let k = 0; k < 4 * MIN && r.state.sleeping; k++) r.step(0);
  check(moodOn(r, MOOD.RESTED), 'woken in the morning: rested');
  r.state.energy = FULL;
  r.state.swung = -9999;
  r.step(command(0, COP.HIT, 0));
  check(FULL - r.state.energy === 750, `rested, a blow costs ${FULL - r.state.energy}`);
  // Soaked out in the rain; dried by a fire.
  const s = city(5);
  const rainDay = dayOf(s, 'rain');
  at(s, rainDay, 12 * 60);
  s.state.zeds = [];
  run(s, 2 * MIN);
  const outside = s.district.lotAt[s.tile] === 0;
  check(!outside || moodOn(s, MOOD.SOAKED), `out in the rain: soaked (outside ${outside})`);
  pockets(s, [['raincoat']]);
  run(s, 1, command(0, COP.USE, 0));
  s.state.moods[MOOD.SOAKED] = 0;
  run(s, 2 * MIN);
  check(!moodOn(s, MOOD.SOAKED), 'in a raincoat: dry');
  say(
    `water drunk; dirty water queasy (hunger ${queasyHunger / plainHunger}× as fast), tea settles it and refreshes (energy half as fast); a stew: ${fedBack} health back in an hour against ${plainBack}; a night slept: rested, a blow ${FULL - r.state.energy} energy; out in the rain soaked, in a raincoat not`,
  );
}

// ------------------------------------------------------------------ fresh food goes off
{
  const c = city(6);
  pockets(c, [
    ['fish', 3],
    ['veg', 2],
    ['tin', 3],
  ]);
  at(c, 2, 6 * 60);
  const evs = run(c, 2);
  const spoiled = evs.find((e) => e.type === 'spoiled') as Extract<CityEvent, { type: 'spoiled' }> | undefined;
  check(
    c.count(I('fish')) === 1 && c.count(I('veg')) === 1 && c.count(I('tin')) === 3 && spoiled?.n === 3,
    `at dawn, half of each fresh stack gone, rounded up (${c.count(I('fish'))} fish, ${c.count(I('veg'))} veg, tins kept)`,
  );
  // (A single one gone altogether: its slot freed, not left holding none.)
  pockets(c, [['fruit', 1]]);
  at(c, 3, 6 * 60);
  run(c, 2);
  check(c.state.inv[0][0] === 0 && c.state.inv[0][1] === 0, `a single fruit gone off: its slot empty (${c.state.inv[0]})`);
  say(
    'at 06:00, half of each fresh stack in the pockets goes off, rounded up (3 fish → 1, 2 vegetables → 1; a single fruit gone, its slot free); tins keep',
  );
}

// ------------------------------------------------------------------ the weather
{
  const c = city(7);
  const tally = WEATHER.map(() => 0);
  for (let d = 2; d < 1002; d++) tally[weatherOf(c, d)]++;
  check(weatherOf(c, 1) === 0, 'day 1 clear');
  const share = tally.map((n) => Math.round(n / 10));
  check(
    share.every((p, k) => Math.abs(p - WEATHER_WEIGHT[k]) <= 5),
    `the shares as weighed (${share})`,
  );
  const old = city(7);
  old.state.rev = 5;
  check(
    [2, 3, 4, 5, 6].every((d) => weatherOf(old, d) === 0),
    'a city begun before: always clear',
  );
  // Fog: one of the dead five tiles off sees nobody before eleven.
  const fogDay = dayOf(c, 'fog');
  at(c, fogDay, 8 * 60);
  c.step(0);
  check(fogSight(c) === FOG.sight, `in the morning fog, sight ${fogSight(c)}`);
  at(c, fogDay, 12 * 60);
  c.step(0);
  check(fogSight(c) === 0, 'the fog lifted by noon');
  // Rain: a blow heard half as far.
  const heard = (rain: boolean) => {
    const d = city(8);
    d.peace = false;
    at(d, rain ? dayOf(d, 'rain') : dayOf(d, 'clear'), 12 * 60);
    d.step(0);
    d.state.zeds = [];
    const t = d.tile;
    const far = [t + 6, t - 6, t + 6 * W, t - 6 * W].find((i) => i >= 0 && i < N && !d.grid[i])!;
    const z: Zed = {
      body: bodyAt(far % W, Math.floor(far / W)),
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
    d.state.zeds.push(z);
    d.state.swung = -9999;
    d.step(command(0, COP.HIT, 0));
    return z.mode === ZED.SEEK;
  };
  const dryHeard = heard(false);
  const wetHeard = heard(true);
  check(dryHeard && !wetHeard, `a blow six tiles off: heard dry (${dryHeard}), not in the rain (${wetHeard})`);
  say(
    `the weather over 1000 days: ${WEATHER.map((w, k) => `${w} ${share[k]}%`).join(', ')}; day 1 clear; none in a city begun before; the fog to 3 tiles till 11:00; a blow 6 tiles off heard dry, not in the rain`,
  );
}

// ------------------------------------------------------------------ the park's pond: a drink, a cast
{
  const c = city(9);
  const park = c.plan.kinds.indexOf('park');
  priv(c).enter(park);
  c.step(0);
  // A tile beside the pond.
  let beside = -1;
  let pond = -1;
  for (let t = 0; t < N && beside < 0; t++) {
    if (c.grid[t]) continue;
    const w = [t - W, t + 1, t + W, t - 1].find((u) => u >= 0 && u < N && c.district.rows[Math.floor(u / W)][u % W] === '~');
    if (w !== undefined) {
      beside = t;
      pond = w;
    }
  }
  check(beside >= 0, 'a pond in the park');
  stand(c, beside, pond);
  check(c.target()?.kind === 'water', `the button at the pond: ${c.target()?.kind}`);
  c.state.thirst = FULL / 2;
  run(c, 1, command(0, COP.ACT, 0));
  check(c.state.thirst > FULL / 2 + 20_000 && moodOn(c, MOOD.QUEASY), 'a drink of pond water: thirst, and queasy');
  pockets(c, [['fishing_rod']]);
  let fish = 0;
  let casts = 0;
  for (let k = 0; k < 20; k++) {
    stand(c, beside, pond);
    // (Kept from thirst: thirsty, the button drinks.)
    const evs = run(c, 200, command(0, COP.ACT, 0), ['hunger', 'energy', 'health', 'thirst']);
    const e = evs.find((x) => x.type === 'fished') as Extract<CityEvent, { type: 'fished' }> | undefined;
    if (e) {
      casts++;
      fish += e.n;
    }
    if (!c.count(I('fishing_rod'))) pockets(c, [['fishing_rod'], ['fish', c.count(I('fish'))]]);
  }
  check(casts === 20 && fish >= 4 && fish <= 16, `twenty casts, ${fish} fish`);
  say(`at the park's pond: a drink (queasy); twenty casts with a rod, ${fish} fish`);
}

// ------------------------------------------------------------------ a planter, a rain barrel, a smoker
{
  const c = city(10);
  c.state.manuals = 63;
  // An open spot, a planter, a barrel and a smoker put up there.
  let mid = -1;
  for (let t = 8 * W + 8; t < N - 8 * W && mid < 0; t++)
    if ([0, 1, -1, W, -W, 2, -2].every((o) => !c.grid[t + o] && canBuild(c, PIECE.barricade, t + o) !== 'blocked')) mid = t;
  const d = c.state.district;
  c.state.built[d] = [
    [mid + 1, PIECE.planter, 40, 1, 0],
    [mid - 1, PIECE.smoker, 60, 1, 0],
    [mid - W, PIECE.rainBarrel, 60, 1, 0],
  ];
  c.reenter();
  const card = (tile: number) => {
    stand(c, mid, tile);
    if (c.state.open !== `p${tile}`) c.step(command(0, COP.ACT, 0));
  };
  // Planted, watered three days running, harvested.
  pockets(c, [
    ['seeds', 2],
    ['water', 3],
  ]);
  at(c, dayOf(c, 'clear'), 12 * 60);
  const start = c.day;
  card(mid + 1);
  run(c, 1, command(0, COP.BUILD, PIECE_OPS + 3));
  let days = 0;
  for (let dd = 0; dd < 3; dd++) {
    at(c, start + dd, 12 * 60);
    c.step(0);
    card(mid + 1);
    const evs = run(c, 1, command(0, COP.BUILD, PIECE_OPS + 4));
    if (evs.some((e) => e.type === 'grow' && e.what === 'watered')) days++;
    const twice = run(c, 1, command(0, COP.BUILD, PIECE_OPS + 4)).some((e) => e.type === 'refused' && e.why === 'watered');
    check(twice || dd === 2, `watered twice a day: refused (day ${dd + 1})`);
  }
  card(mid + 1);
  pockets(c, []);
  const got = run(c, 1, command(0, COP.BUILD, PIECE_OPS + 5)).some((e) => e.type === 'grow' && e.what === 'harvested');
  check(
    got && c.count(I('veg')) >= 2 && c.count(I('herbs')) === 1 && c.count(I('seeds')) === 1,
    `harvested after three days watered (${c.count(I('veg'))} veg)`,
  );
  // Rain waters it: planted on a rainy day, ready three rainy days on without a drop from the pockets.
  const rains: number[] = [];
  for (let dd = 2; dd < 300 && rains.length < 3; dd++)
    if (WEATHER[weatherOf(c, dd)] === 'rain' || WEATHER[weatherOf(c, dd)] === 'storm') rains.push(dd);
  pockets(c, [['seeds', 1]]);
  at(c, rains[0], 12 * 60);
  c.step(0);
  card(mid + 1);
  run(c, 1, command(0, COP.BUILD, PIECE_OPS + 3));
  at(c, rains[2], 12 * 60);
  c.step(0);
  card(mid + 1);
  const byRain = run(c, 1, command(0, COP.BUILD, PIECE_OPS + 5)).some((e) => e.type === 'grow' && e.what === 'harvested');
  check(byRain, 'three rainy days grow it, nobody watering');
  // The barrel: filled by the rain, drunk from, a bottle filled.
  card(mid - W);
  c.state.thirst = FULL / 2;
  const drank = run(c, 1, command(0, COP.BUILD, PIECE_OPS + 6)).some((e) => e.type === 'drank' && !e.dirty);
  pockets(c, [['bottle', 1]]);
  const filled = run(c, 1, command(0, COP.BUILD, PIECE_OPS + 7)).some((e) => e.type === 'grow' && e.what === 'filled');
  check(drank && filled && c.count(I('water')) === 1, 'a barrel filled by rain: drunk from, a bottle filled');
  // Jerky wants the smoker.
  const jerky = CITY_RECIPES.findIndex((r) => r.makes === 'jerky');
  pockets(c, [['fish', 2]]);
  stand(c, mid + 2 * W, mid);
  const far = c.canMake(jerky);
  stand(c, mid, mid - 1);
  const near = c.canMake(jerky);
  check(far === 'smoker' && near === 'ok', `jerky away from the smoker: ${far}, beside it: ${near}`);
  say(
    'a planter watered three days running harvested (vegetables, herbs, a seed back), watering twice a day refused; three rainy days grow it unwatered; a rain barrel drunk from and a bottle filled; jerky only beside a smoker',
  );
}

// ------------------------------------------------------------------ the manuals
{
  const c = city(11);
  const fromManual = CITY_RECIPES.map((r, k) => [r, k] as const).filter(([r]) => r.manual !== undefined && r.manual >= 3);
  check(
    fromManual.every(([, k]) => c.canMake(k) === 'unknown'),
    "the three manuals' recipes unknown in a new city",
  );
  const pieces = buildList(c);
  check(pieces[PIECE.planter] === 'unknown' && pieces[PIECE.smoker] === 'unknown', 'the planter and the smoker unknown');
  const old = city(11);
  old.state.rev = 5;
  // (The review: nothing in a city begun before makes them work (no weather, no seeds): hidden, not known.)
  check(
    fromManual.every(([, k]) => old.canMake(k) === 'none') && buildList(old)[PIECE.planter] === 'none',
    'hidden in a city begun before 2.70',
  );
  const boil = CITY_RECIPES.findIndex((r) => r.makes === 'water' && r.from[0][0] === 'dirty_water');
  pockets(c, [
    ['dirty_water', 1],
    ['stove', 1],
  ]);
  check(c.canMake(boil) === 'ok', 'boiled water known to all, with a stove');
  say(
    `${fromManual.length} recipes and the planter, the barrel and the smoker from three manuals, hidden in a city begun before; boiled water known to all`,
  );
}

// ------------------------------------------------------------------ the review's cases
{
  // Parched: no sleep; asleep, woken as thirst runs out.
  const c = city(13);
  c.state.thirst = 0;
  c.state.hunger = FULL;
  priv(c).sleep();
  check(!c.state.sleeping && c.events.some((e) => e.type === 'refused' && e.why === 'tooThirsty'), 'too thirsty to sleep');
  c.state.thirst = 2000;
  priv(c).sleep();
  let woke: string | undefined;
  for (let k = 0; k < 120 * MIN && c.state.sleeping; k++) {
    c.state.hunger = FULL;
    c.step(0);
    const e = c.events.find((x) => x.type === 'sleep' && !x.on) as Extract<CityEvent, { type: 'sleep' }> | undefined;
    if (e) woke = e.why;
  }
  check(woke === 'parched', `asleep as thirst runs out: woken (${woke})`);
  // Two minutes in bed before six: not rested.
  const r = city(14);
  at(r, 2, 5 * 60 + 58);
  r.step(0);
  r.state.hunger = FULL;
  priv(r).sleep();
  for (let k = 0; k < 5 * MIN && r.state.sleeping; k++) r.step(0);
  check(!moodOn(r, MOOD.RESTED), 'two minutes in bed: not rested');
  // The rod put away mid-cast: the cast over, nothing caught.
  const f = city(9);
  priv(f).enter(f.plan.kinds.indexOf('park'));
  f.step(0);
  let beside = -1;
  let pond = -1;
  for (let t = 0; t < N && beside < 0; t++) {
    if (f.grid[t]) continue;
    const w = [t - W, t + 1, t + W, t - 1].find((u) => u >= 0 && u < N && f.district.rows[Math.floor(u / W)][u % W] === '~');
    if (w !== undefined) {
      beside = t;
      pond = w;
    }
  }
  pockets(f, [['fishing_rod']]);
  stand(f, beside, pond);
  run(f, 1, command(0, COP.ACT, 0));
  const begun = f.state.search.startsWith('F');
  f.state.inv[0] = [0, 0];
  const after = run(f, 200);
  check(begun && !after.some((e) => e.type === 'fished') && !f.state.search, 'the rod put away mid-cast: over, nothing caught');
  // A rod carried and thirsty: the button drinks.
  pockets(f, [['fishing_rod']]);
  f.state.thirst = FULL / 3;
  stand(f, beside, pond);
  const drunk = run(f, 1, command(0, COP.ACT, 0), []).some((e) => e.type === 'drank');
  check(drunk && !f.state.search, 'thirsty with a rod: a drink first');
  say(
    'too thirsty to sleep; asleep as thirst runs out, woken; two minutes in bed not rested; the rod put away mid-cast ends it; thirsty with a rod, the button drinks',
  );
}

// ------------------------------------------------------------------ the save
{
  const c = city(12);
  c.state.thirst = 33_000;
  c.state.moods = [0, c.state.step + 500, 0, c.state.step + 900, 0];
  const snap = JSON.parse(JSON.stringify(c.snapshot()));
  const back = loadCity(snap)!;
  check(back.state.thirst === 33_000 && back.state.moods.join() === c.state.moods.join(), 'a save keeps thirst and the states');
  const bad = JSON.parse(JSON.stringify(snap));
  bad.state.thirst = -5;
  bad.state.moods = [1, 2];
  const m = loadCity(bad)!;
  check(m.state.thirst === FULL && m.state.moods.every((v) => v === 0), 'a damaged save made sound');
  const older = JSON.parse(JSON.stringify(snap));
  delete older.state.thirst;
  delete older.state.moods;
  check(loadCity(older)?.state.thirst === FULL, 'a save from before 2.70 loads, thirst full');
  say('a save keeps thirst and the states; a damaged one made sound; one from before loads with thirst full');
}

console.log(lines.join('\n'));
