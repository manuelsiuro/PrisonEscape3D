/**
 * City Escape's dead (C2b, city/sim/dead.ts): how many a district has by the hour, the day and its
 * danger, and where they're put down; what one sees (by day, at night, a sleeper, through a wall); its
 * chase, slower than a walk; its lunge and bite; the player's blow with fists and with a bat; the noise
 * that draws the others; nightfall and dawn; the same commands the same city; a save carrying them.
 */
import { check } from './assert';
import { scavenger } from './citybots';
import { BLOW, DEAD } from '../src/city/content/dead';
import { cityItemNumber } from '../src/city/content/items';
import { City, COP, loadCity } from '../src/city/sim/City';
import { danger, quota, ZED, type Zed } from '../src/city/sim/dead';
import { nearestDir } from '../src/sim/ai/path';
import { command } from '../src/sim/command';
import { fnv1a } from '../src/sim/rng';
import { bodyAt } from '../src/sim/systems/movement';
import { UNIT } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/grid';

const lines: string[] = [];
const say = (s: string) => lines.push(s);
const MIN = 20;
const EAST = nearestDir(1, 0);
const WEST = nearestDir(-1, 0);

/** One of the dead put at a tile, standing idle. */
const zedAt = (tile: number, mode: number = ZED.IDLE): Zed => ({
  body: bodyAt(tile % MAP_W, Math.floor(tile / MAP_W)),
  hp: DEAD.health,
  mode,
  goal: -1,
  path: [],
  seen: -9999,
  last: -1,
  bit: -9999,
  reel: 0,
  near: 0,
  pace: 1000,
});
/** A city just begun, its dead taken away, the player on a long clear stretch of street: [city, the tiles along it]. */
function street(seed: number): [City, number[]] {
  const c = new City(seed);
  c.step(0);
  c.state.zeds = [];
  // The longest run of open street along a row.
  let best: number[] = [];
  for (let z = 1; z < 63; z++) {
    let run: number[] = [];
    for (let x = 1; x < 63; x++) {
      const i = z * MAP_W + x;
      if (c.zedStreet[i] && c.zedStreet[i + MAP_W]) run.push(i);
      else {
        if (run.length > best.length) best = run;
        run = [];
      }
    }
    if (run.length > best.length) best = run;
  }
  c.state.player = bodyAt(best[0] % MAP_W, Math.floor(best[0] / MAP_W));
  return [c, best];
}
const toMinute = (c: City, minute: number) => {
  c.state.step += ((minute - c.minute + 1440) % 1440) * MIN;
};

// ------------------------------------------------------------------ how many, and where
{
  const c = new City(1);
  c.step(0);
  const d0 = c.state.district;
  const q = quota(c);
  check(danger(c, d0) === 0 && q.indoors === DEAD.dayBase && q.streets === 0, `day 1 at the start: ${JSON.stringify(q)}`);
  check(c.state.zeds.length === q.indoors, `the start's dead: ${c.state.zeds.length}, wanted ${q.indoors}`);
  const here = c.tile;
  for (const z of c.state.zeds) {
    const t = Math.floor(z.body.z / UNIT) * MAP_W + Math.floor(z.body.x / UNIT);
    check(c.zedIndoor[t] === 1 && z.mode === ZED.IDLE, 'by day they stand indoors');
    check(
      Math.max(Math.abs((t % MAP_W) - (here % MAP_W)), Math.abs(Math.floor(t / MAP_W) - Math.floor(here / MAP_W))) >= DEAD.clear,
      'never put down near the player',
    );
  }
  const rows: string[] = [];
  for (const [day, minute] of [
    [1, 12 * 60],
    [1, 23 * 60],
    [4, 12 * 60],
    [4, 23 * 60],
    [9, 23 * 60],
  ]) {
    c.state.step = ((day - 1) * 1440 + minute - 390) * MIN;
    const at = quota(c);
    rows.push(`day ${day} ${minute < 1200 ? 'noon' : 'night'}: ${at.indoors} indoors + ${at.streets} in the streets`);
  }
  say(`the start's district (danger 0): ${rows.join('; ')}`);
  const far = c.plan.kinds.findIndex((_, d) => danger(c, d) === 3);
  say(`danger by district: ${c.plan.kinds.map((k, d) => `${k} ${danger(c, d)}`).join(', ')}${far >= 0 ? '' : ' (none at 3 in this city)'}`);
}

// ------------------------------------------------------------------ what one sees
{
  const sees = (minute: number, tiles: number, asleep = false) => {
    const [c, run] = street(2);
    toMinute(c, minute);
    c.state.sleeping = asleep;
    c.state.zeds = [zedAt(run[tiles])];
    for (let k = 0; k < 6; k++) c.step(0);
    return c.state.zeds[0].mode === ZED.CHASE;
  };
  check(sees(12 * 60, 5) && !sees(12 * 60, 8), 'by day one sees six tiles, not eight');
  check(sees(23 * 60, 3) && !sees(23 * 60, 5), 'at night four tiles, not five');
  check(sees(23 * 60, 1, true) && !sees(23 * 60, 3, true), 'a sleeper is seen only from two tiles');
  // Through a wall: never.
  const c = new City(2);
  c.step(0);
  c.state.zeds = [];
  let wall = -1;
  for (let i = MAP_W; i < MAP_W * 63 && wall < 0; i++)
    if (c.district.rows[Math.floor(i / MAP_W)][i % MAP_W] === '#' && !c.grid[i - 1] && !c.grid[i + 1]) wall = i;
  c.state.player = bodyAt((wall - 1) % MAP_W, Math.floor(wall / MAP_W));
  c.state.zeds = [zedAt(wall + 1)];
  for (let k = 0; k < 40; k++) c.step(0);
  check(c.state.zeds[0].mode !== ZED.CHASE, 'a wall between them: not seen, two tiles off');
  say('sight, with a clear line: six tiles by day, four at night, two for a sleeper; never through a wall');
}

// ------------------------------------------------------------------ the chase, the lunge, the bite
{
  const [c, run] = street(3);
  toMinute(c, 12 * 60);
  c.state.zeds = [zedAt(run[4])];
  for (let k = 0; k < 6; k++) c.step(0);
  check(c.state.zeds[0].mode === ZED.CHASE && c.events.length === 0, 'seen');
  c.state.player = bodyAt(run[0] % MAP_W, Math.floor(run[0] / MAP_W));
  c.state.zeds[0].body = bodyAt(run[3] % MAP_W, Math.floor(run[3] / MAP_W));
  // (Standing: it comes on, lunges, and bites after its wind-up, then every so often.)
  let first = -1;
  let bites = 0;
  let inReach = -1;
  for (let k = 0; k < 200; k++) {
    c.step(0);
    if (inReach < 0 && c.state.zeds[0].near > 0) inReach = k;
    for (const e of c.events)
      if (e.type === 'bite') {
        bites++;
        if (first < 0) first = k;
      }
  }
  check(
    first - inReach >= DEAD.lunge - 1 && first - inReach <= DEAD.lunge + 1,
    `the first bite ${first - inReach} steps after it's in reach, its lunge is ${DEAD.lunge}`,
  );
  check(
    Math.abs(c.state.health - (100 - bites * DEAD.bite)) <= 2 && bites >= 5 && bites <= 8,
    `${bites} bites in ten seconds, health ${c.state.health}`,
  );
  const walked = (() => {
    const [w, r2] = street(3);
    toMinute(w, 12 * 60);
    w.state.player = bodyAt(r2[12] % MAP_W, Math.floor(r2[12] / MAP_W));
    w.state.zeds = [zedAt(r2[15])];
    for (let k = 0; k < 6; k++) w.step(0);
    const g0 = (w.state.zeds[0].body.x - w.state.player.x) / UNIT;
    // (West, away from it, along the street.)
    for (let k = 0; k < 40; k++) w.step(command(WEST));
    return [g0, (w.state.zeds[0].body.x - w.state.player.x) / UNIT];
  })();
  say(
    `one in reach lunges ${DEAD.lunge} steps, then bites (${DEAD.bite} health) every ${DEAD.biteEvery}; walked away from, it falls behind (${walked[0].toFixed(1)} tiles to ${walked[1].toFixed(1)} in two seconds)`,
  );
  check(Math.abs(walked[1]) >= Math.abs(walked[0]), 'a walk outpaces a shambler');
}

// ------------------------------------------------------------------ the player's blow
{
  const fight = (weapon: string | null) => {
    const [c, run] = street(4);
    toMinute(c, 12 * 60);
    if (weapon) c.state.inv[0] = [cityItemNumber(weapon), 40];
    c.state.zeds = [zedAt(run[1], ZED.CHASE), zedAt(run[7])];
    c.state.zeds[0].seen = c.state.step;
    c.state.player.facing = EAST;
    let swings = 0;
    let bites = 0;
    let heard = false;
    for (let k = 0; k < 400 && c.state.zeds.length > 1; k++) {
      c.step(command(0, COP.HIT));
      for (const e of c.events) {
        if (e.type === 'swing' && e.hit) swings++;
        if (e.type === 'bite') bites++;
      }
      if (c.state.zeds.at(-1)!.mode !== ZED.IDLE) heard = true;
    }
    return { swings, bites, heard, kills: c.state.kills, energy: c.state.energy };
  };
  const fists = fight(null);
  const bat = fight('bat');
  check(fists.kills === 1 && fists.swings === Math.ceil(DEAD.health / BLOW.fists), `fists: ${fists.swings} blows, ${fists.kills} down`);
  check(bat.kills === 1 && bat.swings === Math.ceil(DEAD.health / (BLOW.fists + 12)), `a bat: ${bat.swings} blows`);
  check(fists.bites === 0, `one alone, struck as it comes, never lands a bite: ${fists.bites}`);
  check(fists.heard, 'the fight is heard by one seven tiles off, out of sight');
  say(
    `the blow: ${fists.swings} with fists to put one down, ${bat.swings} with a bat; one alone, struck as it comes, lands no bite; the noise carries ${BLOW.noise} tiles`,
  );
}

// ------------------------------------------------------------------ bodies
{
  // The player doesn't walk through one of the dead (a doorway is held); two of a pack don't stand in one place.
  const [c, run] = street(4);
  toMinute(c, 12 * 60);
  c.state.zeds = [zedAt(run[3], ZED.CHASE)];
  c.state.zeds[0].seen = c.state.step;
  for (let k = 0; k < 120; k++) {
    c.step(command(EAST));
    c.state.health = 100;
    c.state.zeds[0].seen = c.state.step;
  }
  check(
    c.state.player.x < c.state.zeds[0].body.x,
    `walking at one of the dead, the player stays on their side of it: ${c.state.player.x} and ${c.state.zeds[0].body.x}`,
  );
  const [d, r2] = street(4);
  toMinute(d, 12 * 60);
  d.state.zeds = [zedAt(r2[4], ZED.CHASE), zedAt(r2[5], ZED.CHASE), zedAt(r2[6], ZED.CHASE)];
  for (let k = 0; k < 100; k++) {
    d.step(0);
    d.state.health = 100;
    for (const z of d.state.zeds) z.seen = d.state.step;
  }
  const xs = d.state.zeds.map((z) => z.body.x).sort((a, b) => a - b);
  check(xs[1] - xs[0] > 300 && xs[2] - xs[1] > 300, `a pack coming along a street stays in file: ${xs}`);
  say('bodies: the player does not walk through one of the dead, and a pack along a street stays in file');
}

// ------------------------------------------------------------------ nightfall and dawn
{
  const c = new City(5);
  c.step(0);
  toMinute(c, 20 * 60 + 58);
  const day = c.state.zeds.length;
  const seen: string[] = [];
  for (let k = 0; k < 5 * MIN; k++) {
    c.step(0);
    for (const e of c.events) if (e.type === 'night' || e.type === 'dusk') seen.push(e.type);
  }
  check(
    seen.join() === 'night' && c.state.zeds.every((z) => z.mode !== ZED.IDLE),
    `at 21:00 night falls and those indoors come out: ${seen}`,
  );
  // (The night's come a few at a time; the player kept on their feet to count them.)
  for (let k = 0; k < 6 * 60 * MIN; k++) {
    c.step(0);
    c.state.health = 100;
  }
  const q = quota(c);
  say(
    `a night at the start: ${day} by day, ${c.state.zeds.length} by 03:00 (the night's ${q.indoors + q.streets}), one more every ${DEAD.trickle} minutes`,
  );
  check(c.state.zeds.length > day, 'more of them by night');
  toMinute(c, 4 * 60 + 59);
  c.state.health = 100;
  // (The player out of everyone's sight, indoors and far off, and every chase called off: what dawn does to the rest.)
  const tileOf = (z: Zed) => Math.floor(z.body.z / UNIT) * MAP_W + Math.floor(z.body.x / UNIT);
  const apart = (a: number, b: number) =>
    Math.max(Math.abs((a % MAP_W) - (b % MAP_W)), Math.abs(Math.floor(a / MAP_W) - Math.floor(b / MAP_W)));
  const hide = c.zedPlaces.indoors
    .map((i) => [i, Math.min(...c.state.zeds.map((z) => apart(i, tileOf(z))))])
    .sort((a, b) => b[1] - a[1])[0][0];
  c.state.player = bodyAt(hide % MAP_W, Math.floor(hide / MAP_W));
  for (const z of c.state.zeds) {
    z.mode = ZED.WANDER;
    z.path = [];
    z.seen = -9999;
  }
  const out = () => c.state.zeds.filter((z) => c.zedStreet[tileOf(z)]).length;
  const atDawn = out();
  // (Each of those, followed: one indoors may still cross a street on its way to another room.)
  const were = c.state.zeds.filter((z) => c.zedStreet[tileOf(z)]);
  for (let k = 0; k < 90 * MIN; k++) {
    c.step(0);
    c.state.health = 100;
  }
  const still = were.filter((z) => c.state.zeds.includes(z) && c.zedStreet[tileOf(z)]).length;
  check(atDawn > 0 && still === 0, `by 06:30 those in the streets at dawn have gone to ground: ${still} of ${atDawn} still out`);
  say(`dawn: ${atDawn} in the streets at 05:00, ${still} of them still out by 06:30`);
}

// ------------------------------------------------------------------ the same commands, the same city; a save
{
  const play = (seed: number) => {
    const c = new City(seed);
    const next = scavenger(c);
    const cmds: number[] = [];
    for (let k = 0; k < 18 * 60 * MIN; k++) {
      const cmd = next();
      cmds.push(cmd);
      c.step(cmd);
    }
    return { c, cmds };
  };
  const a = play(6);
  const b = new City(6);
  for (const cmd of a.cmds) b.step(cmd);
  const print = (c: City) => fnv1a(JSON.stringify(c.snapshot().state));
  check(print(a.c) === print(b), 'the same commands, the same dead in the same places');
  const half = new City(6);
  const mid = a.cmds.length >> 1;
  for (let k = 0; k < mid; k++) half.step(a.cmds[k]);
  const loaded = loadCity(JSON.parse(JSON.stringify(half.snapshot())));
  check(!!loaded && loaded.state.zeds.length === half.state.zeds.length, 'a save carries the dead');
  if (loaded) {
    for (let k = mid; k < a.cmds.length; k++) loaded.step(a.cmds[k]);
    check(print(loaded) === print(a.c), 'saved half way and loaded, the day ends the same');
  }
  const bad = JSON.parse(JSON.stringify(half.snapshot()));
  bad.state.zeds.push({ body: { x: -5, z: 3, facing: 1, moving: false } });
  const mended = loadCity(bad);
  check(!!mended && mended.state.zeds.every((z) => z.hp > 0), 'a save whose dead are damaged loads, the district put down afresh');
  say(
    `a bot's first 18 hours, ${a.c.state.kills} put down, ${a.c.state.zeds.length} about at the end: ${print(a.c)}; saved half way, the same; damaged dead put down afresh`,
  );
}

console.log(lines.join('\n'));
