/**
 * City Escape's fights gone over (2.60, city/sim/dead.ts, content/dead.ts): the three new kinds of the
 * dead (when each is met and how often over twelve cities, what each is made of; a crawler's short
 * sight and the leg it holds; a screamer's call; a bloater's burst, on the player, on the dead beside
 * it, and not from a spear's length), the blow on one that isn't after anyone, what is said when one is
 * put down (the picture's falling body), what a save keeps; and the looks the picture gives them by
 * district and kind (render/horde.ts, a pure choice).
 */
import { check } from './assert';
import { BLOATER, BLOW, CRAWLER, DEAD, kindStats, SCREAMER, ZKIND } from '../src/city/content/dead';
import { KINDS } from '../src/city/content/districts';
import { cityItemNumber } from '../src/city/content/items';
import { lookOf } from '../src/city/render/horde';
import { City, COP, loadCity, type CityEvent } from '../src/city/sim/City';
import { populate, ZED, type Zed } from '../src/city/sim/dead';
import { nearestDir } from '../src/sim/ai/path';
import { command } from '../src/sim/command';
import { bodyAt } from '../src/sim/systems/movement';
import { UNIT } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/grid';

const lines: string[] = [];
const say = (s: string) => lines.push(s);
const MIN = 20;
const W = MAP_W;
const SEEDS = 12;
const NAMES = ['shamblers', 'runners', 'brutes', 'crawlers', 'screamers', 'bloaters'];
const zed = (c: City, tile: number, kind = 0, mode: number = ZED.IDLE): Zed => {
  const z: Zed = {
    body: bodyAt(tile % W, Math.floor(tile / W)),
    hp: kindStats(kind).health,
    mode,
    goal: -1,
    path: [],
    seen: -9999,
    last: -1,
    bit: -9999,
    reel: 0,
    near: 0,
    pace: 1000,
    ...(kind ? { kind } : {}),
  };
  c.state.zeds.push(z);
  return z;
};
/** A straight run of clear street tiles: its first, and the step along it. */
function street(c: City, len: number): { at: number; dir: number } {
  for (const i of c.zedPlaces.streets)
    for (const dir of [1, W]) {
      const run = Array.from({ length: len }, (_, k) => i + k * dir);
      const inside = (t: number) => t % W > 3 && t % W < W - 4 && Math.floor(t / W) > 3 && Math.floor(t / W) < W - 4;
      // (Well inside the district: a street's end on the border is a checkpoint.)
      if (
        run.every((t) => t < W * W && inside(t) && !c.grid[t] && c.zedStreet[t]) &&
        (dir === W || Math.floor(run[len - 1] / W) === Math.floor(i / W))
      )
        return { at: i, dir };
    }
  throw new Error('no straight street');
}
const stand = (c: City, tile: number, toward: number) => {
  c.state.player = bodyAt(
    tile % W,
    Math.floor(tile / W),
    nearestDir((toward % W) - (tile % W), Math.floor(toward / W) - Math.floor(tile / W)),
  );
};
const step = (c: City, cmd = 0): CityEvent[] => {
  c.step(cmd);
  return [...c.events];
};
/** A quiet city at an hour of a day, nobody about. */
function quiet(seed: number, day: number, minute: number): City {
  const c = new City(seed);
  c.peace = true;
  c.state.step = ((day - 1) * 1440 + minute - 390) * MIN;
  // (The district's own dead are put down on the first step in it: taken while nobody is.)
  c.step(0);
  c.state.zeds = [];
  return c;
}

// ------------------------------------------------------------------ who is met, and when
{
  const census = (day: number, minute: number) => {
    const n = [0, 0, 0, 0, 0, 0];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const c = new City(seed);
      for (let d = 0; d < 9; d++) {
        c.state.step = ((day - 1) * 1440 + minute - 390) * MIN;
        (c as unknown as { enter(d: number): void }).enter(d);
        for (let k = 0; k < 3; k++) {
          populate(c);
          for (const z of c.state.zeds) n[z.kind ?? 0]++;
        }
      }
    }
    return n;
  };
  const day1 = census(1, 12 * 60);
  const night1 = census(1, 23 * 60);
  check(day1.slice(1).every((v) => !v) && night1.slice(1).every((v) => !v), `the first day and night: ${day1.join()} / ${night1.join()}`);
  const day3 = census(3, 12 * 60);
  check(day3[ZKIND.CRAWLER] > 0 && day3[1] + day3[2] + day3[4] + day3[5] === 0, `day 3: ${day3.join()}`);
  const night2 = census(2, 23 * 60);
  check(night2[ZKIND.SCREAMER] > 0 && night2[ZKIND.BLOATER] === 0 && night2[ZKIND.CRAWLER] === 0, `night 2: ${night2.join()}`);
  const night6 = census(6, 23 * 60);
  check(night6[ZKIND.BLOATER] > 0 && night6[ZKIND.RUNNER] > 0 && night6[ZKIND.SCREAMER] > 0, `night 6: ${night6.join()}`);
  const share = (n: number[], k: number) => `${((100 * n[k]) / n.reduce((a, b) => a + b, 0)).toFixed(0)}%`;
  say(
    `${SEEDS} cities, every district put down three times: day 1 and night 1 shamblers only; day 3, ${share(day3, 3)} crawlers (the dark indoors); night 2, ${share(night2, 4)} screamers; night 6, ${NAMES.map((name, k) => `${share(night6, k)} ${name}`).join(', ')}`,
  );
  say(
    `what each is made of (health, pace after someone, bite): ${NAMES.map((name, k) => `${name} ${kindStats(k).health}/${kindStats(k).chase}/${kindStats(k).bite}`).join(', ')}; the player walks 184`,
  );
}

// ------------------------------------------------------------------ the blow on one that isn't after anyone
{
  const c = quiet(3, 2, 12 * 60);
  const { at, dir } = street(c, 6);
  c.state.inv[0] = [cityItemNumber('bat'), 40];
  stand(c, at, at + dir);
  const idle = zed(c, at + dir);
  // (Its back turned: it looks the other way, and the bot's blow comes before it has looked.)
  idle.body.facing = nearestDir(dir === 1 ? 1 : 0, dir === W ? 1 : 0);
  const ev = step(c, command(0, COP.HIT));
  const swing = ev.find((e) => e.type === 'swing');
  check(
    swing?.type === 'swing' && swing.hit && swing.unseen === true && swing.dead && ev.some((e) => e.type === 'fell') && c.state.kills === 1,
    `a bat on a shambler that isn't after anyone: ${JSON.stringify(swing)}`,
  );
  c.state.zeds = [];
  c.state.swung = -9999;
  const after = zed(c, at + dir, 0, ZED.CHASE);
  after.seen = c.state.step;
  const ev2 = step(c, command(0, COP.HIT));
  const swing2 = ev2.find((e) => e.type === 'swing');
  check(
    swing2?.type === 'swing' &&
      swing2.hit &&
      !swing2.unseen &&
      !swing2.dead &&
      Math.abs((swing2.left ?? 0) - (DEAD.health - 18) / DEAD.health) < 0.01,
    `a bat on one that is after them: ${JSON.stringify(swing2)}`,
  );
  say(
    `a blow on one that isn't after anyone does ${BLOW.unseen} times the harm (a bat puts a shambler down in one; two when it is after them); every one put down is said with where, which way and what it was`,
  );
}

// ------------------------------------------------------------------ a crawler
{
  const c = quiet(3, 2, 12 * 60);
  const { at, dir } = street(c, 8);
  c.peace = false;
  stand(c, at, at + dir);
  const z = zed(c, at + 5 * dir, ZKIND.CRAWLER);
  z.body.facing = nearestDir(dir === 1 ? -1 : 0, dir === W ? -1 : 0);
  for (let k = 0; k < 20; k++) step(c);
  check(z.mode === ZED.IDLE, 'a crawler five tiles off in daylight sees the player');
  z.body = bodyAt((at + 3 * dir) % W, Math.floor((at + 3 * dir) / W), z.body.facing);
  for (let k = 0; k < 20 && z.mode !== ZED.CHASE; k++) step(c);
  check(z.mode === ZED.CHASE, 'a crawler three tiles off sees nobody');
  let snared = false;
  let bite = 0;
  for (let k = 0; k < 400 && !snared; k++) {
    const ev = step(c);
    c.state.health = 100;
    snared = ev.some((e) => e.type === 'snared');
    const b = ev.find((e) => e.type === 'bite');
    if (b?.type === 'bite') bite = b.harm;
  }
  check(
    snared && bite === CRAWLER.bite && c.state.snare === c.state.step + CRAWLER.hold,
    `a crawler's bite: ${bite}, held ${c.state.snare - c.state.step}`,
  );
  // Held: a slower walk, then the usual one.
  c.state.zeds = [];
  const from = c.state.player.x + c.state.player.z;
  const back = nearestDir(dir === 1 ? -1 : 0, dir === W ? -1 : 0);
  stand(c, at + 3 * dir, at);
  const p0 = c.state.player.x + c.state.player.z;
  step(c, command(back));
  const slow = Math.abs(c.state.player.x + c.state.player.z - p0);
  c.state.snare = 0;
  const p1 = c.state.player.x + c.state.player.z;
  step(c, command(back));
  const usual = Math.abs(c.state.player.x + c.state.player.z - p1);
  check(slow > 0 && slow < usual && from !== undefined, `held by a crawler the player walks ${slow} a step, free ${usual}`);
  say(
    `a crawler: sees ${CRAWLER.sight} tiles, never further; its bite (${CRAWLER.bite}) holds a leg ${CRAWLER.hold / 20} seconds (${slow} units a step against ${usual})`,
  );
}

// ------------------------------------------------------------------ a screamer
{
  const c = quiet(3, 3, 23 * 60);
  const { at, dir } = street(c, 6);
  c.peace = false;
  stand(c, at, at + dir);
  const far = c.zedPlaces.streets.filter((i) => {
    const d = Math.max(Math.abs((i % W) - (at % W)), Math.abs(Math.floor(i / W) - Math.floor(at / W)));
    return d >= 8 && d <= SCREAMER.reach;
  });
  const beyond = c.zedPlaces.streets.filter(
    (i) => Math.max(Math.abs((i % W) - (at % W)), Math.abs(Math.floor(i / W) - Math.floor(at / W))) > SCREAMER.reach + 2,
  );
  const near = [far[0], far[Math.floor(far.length / 2)], far[far.length - 1]].map((i) => zed(c, i, 0, ZED.WANDER));
  const out = zed(c, beyond[0], 0, ZED.WANDER);
  const s = zed(c, at + 3 * dir, ZKIND.SCREAMER, ZED.WANDER);
  s.body.facing = nearestDir(dir === 1 ? -1 : 0, dir === W ? -1 : 0);
  let screamed = 0;
  for (let k = 0; k < 12; k++) screamed += step(c).filter((e) => e.type === 'scream').length;
  check(screamed === 1 && s.mode === ZED.CHASE, `a screamer that sees the player screams ${screamed} times`);
  check(
    near.every((z) => z.mode === ZED.SEEK || z.mode === ZED.CHASE) && out.mode === ZED.WANDER,
    `called by it: ${near.map((z) => z.mode).join()}; one beyond: ${out.mode}`,
  );
  say(`a screamer: once as it sees the player, the dead within ${SCREAMER.reach} tiles of them come, those beyond don't`);
}

// ------------------------------------------------------------------ a bloater
{
  const c = quiet(3, 5, 12 * 60);
  const { at, dir } = street(c, 8);
  // Struck down at arm's length: it bursts on the player and on the dead beside it.
  c.state.inv[0] = [cityItemNumber('cleaver'), 60];
  stand(c, at, at + dir);
  const b = zed(c, at + dir, ZKIND.BLOATER);
  b.hp = 10;
  const beside = zed(c, at + 2 * dir);
  beside.hp = 10;
  const whole = zed(c, at + 2 * dir);
  whole.body.x += dir === 1 ? 0 : 300;
  whole.body.z += dir === 1 ? 300 : 0;
  const far = zed(c, at + 5 * dir);
  const ev = step(c, command(0, COP.HIT));
  const burst = ev.find((e) => e.type === 'burst');
  check(
    burst?.type === 'burst' && burst.harm === BLOATER.harm && c.state.health === 100 - BLOATER.harm,
    `a bloater put down at arm's length: ${JSON.stringify(burst)}`,
  );
  check(
    !c.state.zeds.includes(beside) && c.state.zeds.includes(far) && far.hp === DEAD.health && whole.hp === DEAD.health - BLOATER.dead,
    `beside it: the hurt one ${c.state.zeds.includes(beside) ? 'stands' : 'falls'}, the whole one has ${whole.hp}, the far one ${far.hp}`,
  );
  check(
    ev.filter((e) => e.type === 'fell').length === 2 && c.state.kills === 2,
    `fallen to it: ${ev.filter((e) => e.type === 'fell').length}`,
  );
  // From a spear's length: safe.
  const d = quiet(3, 5, 12 * 60);
  d.state.inv[0] = [cityItemNumber('spear'), 35];
  const run = street(d, 8);
  stand(d, run.at, run.at + run.dir);
  const b2 = zed(d, run.at + 2 * run.dir, ZKIND.BLOATER);
  b2.hp = 10;
  const ev2 = step(d, command(0, COP.HIT));
  const burst2 = ev2.find((e) => e.type === 'burst');
  check(
    burst2?.type === 'burst' && burst2.harm === 0 && d.state.health === 100,
    `a bloater put down from a spear's length: ${JSON.stringify(burst2)}`,
  );
  // Two side by side: one's burst puts the other down, which bursts too.
  const e = quiet(3, 5, 12 * 60);
  e.state.inv[0] = [cityItemNumber('spear'), 35];
  const r3 = street(e, 8);
  stand(e, r3.at, r3.at + r3.dir);
  const first = zed(e, r3.at + 2 * r3.dir, ZKIND.BLOATER);
  first.hp = 10;
  zed(e, r3.at + 3 * r3.dir, ZKIND.BLOATER).hp = BLOATER.dead;
  const ev3 = step(e, command(0, COP.HIT));
  check(
    ev3.filter((x) => x.type === 'burst').length === 2 && e.state.zeds.length === 0,
    `two bloaters side by side: ${ev3.filter((x) => x.type === 'burst').length} bursts`,
  );
  // A Hardcore city is lost to it, once: one of the dead with its bite ready doesn't take a second life.
  const h = new City(3, 1);
  h.peace = true;
  h.step(0);
  h.peace = false;
  h.state.zeds = [];
  h.state.health = 5;
  h.state.inv[0] = [cityItemNumber('cleaver'), 60];
  const r4 = street(h, 4);
  stand(h, r4.at + r4.dir, r4.at + 2 * r4.dir);
  zed(h, r4.at + 2 * r4.dir, ZKIND.BLOATER).hp = 5;
  const behind = zed(h, r4.at, 0, ZED.CHASE);
  Object.assign(behind, { near: DEAD.lunge, seen: h.state.step });
  const ev4 = step(h, command(0, COP.HIT));
  check(
    h.state.over === 1 && h.state.deaths === 1 && ev4.filter((x) => x.type === 'dead').length === 1 && !ev4.some((x) => x.type === 'bite'),
    `a bloater bursting on a Hardcore player at 5 health: ${ev4.map((x) => x.type).join()}, ${h.state.deaths} deaths`,
  );
  say(
    `a bloater: put down, it bursts ${(BLOATER.within / UNIT).toFixed(1)} tiles round: ${BLOATER.harm} to the player, ${BLOATER.dead} to each of the dead there (those that fall to it are put down, another bloater bursting in its turn); from a spear's length the player is clear of it`,
  );
}

// ------------------------------------------------------------------ saves, and the looks
{
  const c = quiet(5, 6, 23 * 60);
  c.peace = false;
  const { at, dir } = street(c, 8);
  stand(c, at, at + dir);
  for (const k of [1, 2, 3, 4, 5]) zed(c, at + (k + 1) * dir, k, ZED.WANDER);
  c.state.snare = c.state.step + 30;
  const snap = JSON.parse(JSON.stringify(c.snapshot()));
  const back = loadCity(JSON.parse(JSON.stringify(snap)))!;
  check(
    back.state.zeds.map((z) => z.kind ?? 0).join() === '1,2,3,4,5' && back.state.snare === c.state.snare,
    `a save's dead: ${back.state.zeds.map((z) => z.kind ?? 0).join()}`,
  );
  for (let k = 0; k < 600; k++) {
    c.step(0);
    back.step(0);
    c.state.health = back.state.health = 100;
  }
  check(JSON.stringify(c.snapshot().state) === JSON.stringify(back.snapshot().state), 'a save with every kind about plays on otherwise');
  // (A kind there is none of: the district's dead put down afresh. A save from before: no leg held.)
  snap.state.zeds[0].kind = 9;
  delete snap.state.snare;
  const mended = loadCity(snap)!;
  check(mended.state.zeds.every((z) => (z.kind ?? 0) <= 5) && mended.state.snare === 0, 'a damaged kind is kept');
  // The looks: a kind's own, a district's own, the bus's orange only where the city starts.
  const worn = KINDS.map((place) => new Set(Array.from({ length: 200 }, (_, k) => lookOf(0, 900 + k, place, false))).size);
  const own = [2, 4, 5].map((kind) => new Set(KINDS.map((place) => lookOf(kind, 950, place, false))).size);
  const orange = (start: boolean) =>
    Array.from({ length: 200 }, (_, k) => lookOf(0, 900 + k, 'suburbs', start)).filter((l) => l === 6).length;
  check(worn.every((n) => n >= 3) && own.every((n) => n === 1), `looks a district: ${worn.join()}; a kind's own: ${own.join()}`);
  check(
    orange(true) > 10 && orange(false) === 0,
    `the bus's orange: ${orange(true)} of 200 where the city starts, ${orange(false)} elsewhere`,
  );
  check(
    lookOf(1, 933, 'docks', false) === lookOf(0, 933, 'docks', false) && lookOf(3, 933, null, false) === lookOf(0, 933, null, false),
    'a runner or a crawler dressed otherwise than a shambler',
  );
  say(
    `a save keeps every kind and the leg held, and plays on as the live city; in the picture ${worn.reduce((a, b) => Math.min(a, b))} to ${worn.reduce((a, b) => Math.max(a, b))} looks a district by what it is, a brute's, a screamer's and a bloater's their own everywhere, the bus's orange only where the city starts (${orange(true)} in 200)`,
  );
}

console.log(lines.join('\n'));
