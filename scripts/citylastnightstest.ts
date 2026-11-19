/**
 * City Escape's fair last nights and real choices (2.65, the 2026-11-19 review's third batch): the weapon that suits the one
 * struck (a blade to finish, the spear's reach, the strongest else), a molotov never broken where its fire reaches the thrower,
 * ground cleared staying cleared till the next dusk, a checkpoint held back once while the beacon or the generator runs, a bed by
 * day a rest till dusk, the boat's tide waking a sleeper, and the tunnel's stairs climbed back up.
 */
import { check } from './assert';
import { BLOATER, DOWN, kindStats, ZKIND } from '../src/city/content/dead';
import { cityItemNumber } from '../src/city/content/items';
import { RANGED } from '../src/city/content/ranged';
import { FLAG, STORY, THINGS } from '../src/city/content/story';
import { TUNNEL } from '../src/city/gen/tunnel';
import { City, COP, loadCity, type CityEvent } from '../src/city/sim/City';
import { clearedIn, putDown, quota, ZED, type Zed } from '../src/city/sim/dead';
import { gatesOpen, going } from '../src/city/sim/story';
import { burning } from '../src/city/sim/ranged';
import { nearestDir } from '../src/sim/ai/path';
import { command } from '../src/sim/command';
import { bodyAt } from '../src/sim/systems/movement';
import { MAP_W } from '../src/sim/world/grid';

const lines: string[] = [];
const say = (s: string) => lines.push(s);
const MIN = 20;
const W = MAP_W;
const KNIFE = cityItemNumber('knife');
const NAIL_BAT = cityItemNumber('nail_bat');
const BAT = cityItemNumber('bat');
const SPEAR = cityItemNumber('spear');
const MOLOTOV = cityItemNumber('molotov');
const BOTTLE = cityItemNumber('bottle');

const zed = (c: City, tile: number, kind = 0, mode: number = ZED.CHASE): Zed => {
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
/** A straight run of clear street tiles well inside the district: its first, and the step along it. */
function street(c: City, len: number): { at: number; dir: number } {
  for (const i of c.zedPlaces.streets)
    for (const dir of [1, W]) {
      const run = Array.from({ length: len }, (_, k) => i + k * dir);
      const inside = (t: number) => t % W > 3 && t % W < W - 4 && Math.floor(t / W) > 3 && Math.floor(t / W) < W - 4;
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
  c.step(0);
  c.state.zeds = [];
  return c;
}
const pockets = (c: City, ...items: [number, number][]) => {
  c.state.inv = c.state.inv.map(() => [0, 0]);
  items.forEach((it, k) => (c.state.inv[k] = [...it]));
};
const count = (c: City, item: number) => c.state.inv.filter((st) => st[0] === item).reduce((n, st) => n + st[1], 0);
/** The blow, then the steps till another can be struck. */
const hit = (c: City): CityEvent[] => {
  const ev = step(c, command(0, COP.HIT));
  for (let k = 0; k < 14; k++) c.step(0);
  return ev;
};

// ------------------------------------------------------------------ the weapon for the one struck
{
  // A knife and a nailed bat, one after the player: the bat's blow first (neither empties it), then the knife finishes it for good.
  const c = quiet(3, 2, 10 * 60);
  const { at, dir } = street(c, 6);
  stand(c, at, at + dir);
  pockets(c, [NAIL_BAT, 50], [KNIFE, 30]);
  const z = zed(c, at + dir);
  const one = hit(c);
  check(c.struck === NAIL_BAT && count(c, NAIL_BAT) === 49 && count(c, KNIFE) === 30, `seen, the nailed bat first: ${c.struck}`);
  check(one.some((e) => e.type === 'swing' && e.hit && !e.dead && !e.down) && z.hp === 4, `left with ${z.hp}`);
  z.body = bodyAt((at + dir) % W, Math.floor((at + dir) / W));
  const two = hit(c);
  check(
    c.struck === KNIFE && count(c, KNIFE) === 29 && two.some((e) => e.type === 'swing' && e.dead && !e.down) && !c.state.zeds.includes(z),
    'then the knife, and it stays down',
  );
  // One that never saw it coming: the knife puts it down for good at once (the bat would only knock it down).
  const u = zed(c, at + dir, 0, ZED.IDLE);
  const three = hit(c);
  check(c.struck === KNIFE && three.some((e) => e.type === 'swing' && e.dead && !e.down) && !c.state.zeds.includes(u), 'unseen: the knife');
  // One lying knocked down: finished by the blade, which is the one worn.
  pockets(c, [BAT, 30], [KNIFE, 30]);
  const d = zed(c, at + dir, 0, ZED.IDLE);
  d.hp = 0;
  d.down = DOWN.steps;
  hit(c);
  check(!c.state.zeds.includes(d) && count(c, KNIFE) === 29 && count(c, BAT) === 30, 'one lying down: the knife finishes it');
  // Only the strongest reaches: as before.
  pockets(c, [BAT, 30], [NAIL_BAT, 50]);
  const s2 = zed(c, at + dir);
  hit(c);
  check(c.struck === NAIL_BAT && s2.hp === kindStats(0).health - 26, `bat and nailed bat: the nailed bat (${s2.hp})`);
  c.state.zeds = [];
  say(
    'the weapon for the one struck: a nailed bat then a knife on one after the player (26, then the blade finishes 4), the knife at once on one unseen, the knife on one lying down, the stronger of two blunt ones; only the weapon that struck wears',
  );
}
{
  // A bloater two tiles off, a spear and a nailed bat carried: the spear reaches it, and its burst doesn't reach the player.
  const c = quiet(5, 5, 23 * 60);
  const { at, dir } = street(c, 6);
  stand(c, at, at + dir);
  pockets(c, [NAIL_BAT, 50], [SPEAR, 35]);
  const b = zed(c, at + 2 * dir, ZKIND.BLOATER);
  let burst: CityEvent | undefined;
  for (let k = 0; k < 6 && c.state.zeds.includes(b); k++) {
    b.body = bodyAt((at + 2 * dir) % W, Math.floor((at + 2 * dir) / W));
    burst = hit(c).find((e) => e.type === 'burst') ?? burst;
    check(c.struck === SPEAR, `the spear strikes the bloater: ${c.struck}`);
  }
  check(
    !c.state.zeds.includes(b) && burst?.type === 'burst' && burst.harm === 0 && c.state.health === 100,
    'put down from out of its burst',
  );
  check(2 * 1024 > BLOATER.within, 'two tiles is out of the burst');
  say(
    `a bloater two tiles off with a spear and a nailed bat carried: the spear strikes it (before, the nailed bat struck and missed), its burst short of the player`,
  );
}

// ------------------------------------------------------------------ a molotov never at the thrower's feet
{
  const c = quiet(3, 3, 23 * 60);
  const { at, dir } = street(c, 7);
  stand(c, at, at + dir);
  pockets(c, [MOLOTOV, 2], [BOTTLE, 1]);
  zed(c, at + dir);
  const far = zed(c, at + 4 * dir);
  const ev = step(c, command(0, COP.USE, 0));
  const thrown = ev.find((e) => e.type === 'thrown');
  check(
    thrown?.type === 'thrown' && thrown.to === at + 4 * dir && !burning(c, c.tile) && count(c, MOLOTOV) === 1,
    `one at arm's length and one four tiles off: over the near one (${thrown?.type === 'thrown' ? thrown.to - at : 'none'})`,
  );
  check(far.hp <= kindStats(0).health, 'the far one in the fire');
  // Only the near one, and a wall two tiles ahead: not thrown, and said.
  let wall = -1;
  let way = 0;
  for (const i of c.zedPlaces.streets)
    for (const d of [1, -1, W, -W])
      if (
        wall < 0 &&
        !c.grid[i + d] &&
        c.grid[i + 2 * d] &&
        i % W > 3 &&
        i % W < W - 4 &&
        Math.floor(i / W) > 3 &&
        Math.floor(i / W) < W - 4
      ) {
        wall = i;
        way = d;
      }
  c.state.zeds = [];
  c.state.fires = [];
  stand(c, wall, wall + way);
  zed(c, wall + way);
  const ev2 = step(c, command(0, COP.USE, 0));
  check(
    ev2.some((e) => e.type === 'refused' && e.why === 'tooNear') && count(c, MOLOTOV) === 1 && !c.state.fires.length,
    'a wall in the face: refused, kept',
  );
  // A bottle isn't fire: it still lands there.
  const ev3 = step(c, command(0, COP.USE, 1));
  check(
    ev3.some((e) => e.type === 'thrown' && e.item === BOTTLE),
    'a bottle still thrown at arm’s length',
  );
  say(
    `a molotov with one of the dead at arm's length: thrown over it onto one four tiles off; with a wall two tiles ahead, refused ("too near") and kept; a bottle thrown as before (the fire spreads ${RANGED.fireSpread} tile)`,
  );
}

// ------------------------------------------------------------------ ground cleared stays cleared till dusk
{
  const c = new City(4);
  c.step(0);
  const s = c.state;
  // Day 2, 10:00, in the start district.
  s.step = (1440 + 600 - 390) * MIN;
  s.arrive = 1;
  c.step(0);
  const q = quota(c);
  const first = s.zeds.length;
  const three = s.zeds.slice(0, 3);
  putDown(c, three);
  check(clearedIn(c) === 3, `three counted: ${clearedIn(c)}`);
  s.zeds = [];
  s.arrive = 1;
  const ev = step(c);
  check(
    ev.some((e) => e.type === 'quiet' && e.n === 3 && !e.all),
    'said on coming back',
  );
  check(s.zeds.length <= q.indoors + q.streets - 3 && s.zeds.length >= first - 3 - 2, `back: ${s.zeds.length} of ${first}`);
  // The rest put down: the last of them said; back again, none, and said so.
  const evAll: CityEvent[] = [];
  putDown(c, [...s.zeds]);
  evAll.push(...c.events);
  check(
    evAll.some((e) => e.type === 'cleared'),
    'the last of them said',
  );
  s.arrive = 1;
  const ev2 = step(c);
  check(s.zeds.length === 0 && ev2.some((e) => e.type === 'quiet' && e.all), `cleared: ${s.zeds.length} on coming back`);
  // The next dusk: counted afresh, and the night's put down in full.
  s.step += (21 * 60 + 5 - c.minute) * MIN;
  check(clearedIn(c) === 0, 'forgotten at 21:00');
  s.arrive = 1;
  const ev3 = step(c);
  check(!ev3.some((e) => e.type === 'quiet') && s.zeds.length > 0, `the night's: ${s.zeds.length}`);
  // Put down at night and come back: fewer, but nothing said (the night's trickle fills it again).
  putDown(c, s.zeds.slice(0, 2));
  s.zeds = [];
  s.arrive = 1;
  const ev4 = step(c);
  check(!ev4.some((e) => e.type === 'quiet' || e.type === 'cleared'), 'nothing promised at night');
  // A save keeps the count.
  const back = loadCity(c.snapshot())!;
  check(
    clearedIn(back) === clearedIn(c) && clearedIn(c) >= 2 && JSON.stringify(back.state.cleared) === JSON.stringify(s.cleared),
    'a save keeps it',
  );
  const old = c.snapshot();
  delete (old.state as { cleared?: number[] }).cleared;
  check(loadCity(old)?.state.cleared.length === 0, 'a save from before: none');
  say(
    `ground cleared: ${first} put down by day in the start district, three put down and the district left and entered again: three fewer and said; all of them: none, and said; at 21:00 the count begins again; a save keeps it`,
  );
}

// ------------------------------------------------------------------ a checkpoint held back during a last night
{
  const c = new City(6);
  c.peace = true;
  c.step(0);
  const s = c.state;
  s.step += 3 * 1440 * MIN + (22 * 60 - c.minute) * MIN;
  Object.assign(s, { kit: (1 << THINGS.length) - 1, flags: FLAG.ATE | FLAG.SLEPT | FLAG.FIXED | FLAG.KEY, scouted: 7, way: 1, act: 4 });
  const d = c.story.wayDistrict[0];
  if (d !== s.district) (c as unknown as { enter(d: number): void }).enter(d);
  s.ready = 1;
  s.readyAt = s.step;
  const g = c.district.gates[0];
  // (The tile beside it, on the map and off the checkpoint's own two.)
  const inward = [1, -1, W, -W]
    .map((k) => g.tiles[0] + k)
    .find(
      (i) =>
        i >= 0 &&
        i < W * W &&
        Math.abs((i % W) - (g.tiles[0] % W)) <= 1 &&
        !c.grid[i] &&
        !c.district.gates.some((o) => o.tiles.includes(i)),
    )!;
  stand(c, inward, g.tiles[0]);
  const toward = command(nearestDir((g.tiles[0] % W) - (inward % W), Math.floor(g.tiles[0] / W) - Math.floor(inward / W)));
  const said: CityEvent[] = [];
  for (let k = 0; k < 40; k++) said.push(...step(c, toward));
  check(
    going(c) === 1 && s.district === d && said.filter((e) => e.type === 'leaving').length === 1,
    `pushed on for two seconds: held, said once (${said.filter((e) => e.type === 'leaving').length})`,
  );
  step(c, 0);
  const crossed: CityEvent[] = [];
  for (let k = 0; k < 20 && s.district === d; k++) crossed.push(...step(c, toward));
  check(
    s.district !== d && s.ready === 0 && crossed.some((e) => e.type === 'ready' && !e.on),
    'let go and walked on: across, and the beacon out',
  );
  // Held, let go, walked off along the street and back onto it within the ten seconds: warned again, not crossed.
  {
    (c as unknown as { enter(d: number): void }).enter(d);
    s.ready = 1;
    s.readyAt = s.step;
    stand(c, inward, g.tiles[0]);
    const first: CityEvent[] = [];
    for (let k = 0; k < 6; k++) first.push(...step(c, toward));
    check(s.district === d && first.some((e) => e.type === 'leaving'), 'back in the district, a checkpoint warned again');
    step(c, 0);
    const back = command(nearestDir((inward % W) - (g.tiles[0] % W), Math.floor(inward / W) - Math.floor(g.tiles[0] / W)));
    for (let k = 0; k < 12; k++) step(c, back);
    const again: CityEvent[] = [];
    for (let k = 0; k < 30 && s.district === d; k++) again.push(...step(c, toward));
    check(s.district === d && s.ready === 1 && again.some((e) => e.type === 'leaving'), 'walked off and back: warned again');
  }
  say(
    'a checkpoint while the beacon burns: held back and said once while the stick is held; let go and walked on from where it was held, crossed, and the night over; walked off and back, warned again',
  );
}

// ------------------------------------------------------------------ a bed by day: a rest till dusk; the tide
{
  const c = quiet(2, 2, 9 * 60);
  const s = c.state;
  s.energy = 90_000;
  s.hunger = 90_000;
  (c as unknown as { sleep(): void }).sleep();
  check(s.sleeping && c.restsTillDusk, 'not tired, by day: resting');
  check((s.flags & FLAG.SLEPT) === 0, 'a rest by day is not the first act’s night in a bed');
  let woke: CityEvent | undefined;
  for (let k = 0; k < 13 * 60 * MIN && !woke; k++) woke = step(c).find((e) => e.type === 'sleep' && !e.on);
  check(
    woke?.type === 'sleep' && woke.why === 'dusk' && c.minute === 20 * 60,
    `woke at ${c.minute} (${woke?.type === 'sleep' ? woke.why : ''})`,
  );
  // The boat made ready: woken for the tide wherever they sleep.
  Object.assign(s, { way: 2, ready: 1 });
  s.step += 30 * MIN;
  (c as unknown as { sleep(): void }).sleep();
  check(s.sleeping && !c.restsTillDusk, 'a night’s sleep from 20:30');
  woke = undefined;
  for (let k = 0; k < 4 * 60 * MIN && !woke; k++) woke = step(c).find((e) => e.type === 'sleep' && !e.on);
  check(woke?.type === 'sleep' && woke.why === 'tide' && c.minute === STORY.tideFrom - 30, `woke for the tide at ${c.minute}`);
  say('a bed by day, not tired: a rest till 20:00; the boat ready, a sleeper woken at 22:30 for its tide');
}

// ------------------------------------------------------------------ the tunnel's stairs climbed back up
{
  const c = new City(2);
  c.peace = true;
  c.step(0);
  const s = c.state;
  s.step += 3 * 1440 * MIN;
  Object.assign(s, { kit: (1 << THINGS.length) - 1, flags: FLAG.ATE | FLAG.SLEPT | FLAG.FIXED | FLAG.KEY, scouted: 7, way: 3, act: 4 });
  const d = c.story.wayDistrict[2];
  if (d !== s.district) (c as unknown as { enter(d: number): void }).enter(d);
  const exit = c.story.exits[2];
  s.player = bodyAt(exit % W, Math.floor(exit / W));
  c.step(0);
  c.step(command(0, COP.ACT));
  s.readyAt = s.step - STORY.metroHold * MIN;
  c.step(command(0, COP.ACT));
  check(s.district === TUNNEL && c.tile === c.tunnel.way[1] && c.target() === null, 'down, a step in from the stairs: nothing to press');
  for (let k = 0; k < 20 && c.tile !== c.tunnel.start; k++) {
    const to = c.tunnel.start;
    c.step(command(nearestDir((to % W) - (c.tile % W), Math.floor(to / W) - Math.floor(c.tile / W))));
  }
  check(c.target()?.key === 'u', 'on the stairs’ foot, the way back up');
  const up = step(c, command(0, COP.ACT));
  check(
    s.district === d &&
      c.tile === exit &&
      s.ready === 1 &&
      gatesOpen(c) &&
      going(c) === 1 &&
      up.some((e) => e.type === 'travel' && e.from === TUNNEL),
    'back up in the station, the generator running and the gates open',
  );
  c.peace = false;
  s.arrive = 1;
  c.step(0);
  // (Those with no way to the stairs stay where they are, as when it was started.)
  const called = s.zeds.filter((z) => z.mode === ZED.SEEK || z.mode === ZED.CHASE).length;
  check(called * 2 > s.zeds.length, `up there, the generator calls them: ${called} of ${s.zeds.length}`);
  c.peace = true;
  s.zeds = [];
  s.player = bodyAt(exit % W, Math.floor(exit / W));
  c.step(command(0, COP.ACT));
  check(s.district === TUNNEL, 'and down again');
  c.peace = false;
  s.arrive = 1;
  c.step(0);
  check(
    s.zeds.length > 0 && s.zeds.every((z) => z.mode === ZED.SEEK || z.mode === ZED.CHASE),
    'down again, the tunnel’s dead heard the player',
  );
  c.peace = true;
  s.zeds = [];
  s.player = bodyAt(c.tunnel.start % W, Math.floor(c.tunnel.start / W));
  c.leave(c.tunnel.start, cityItemNumber('bolt'), 1);
  c.step(0);
  check(c.target()?.kind === 'pile', `a pile on the stairs' foot first: ${c.target()?.kind}`);
  say(
    'the tunnel: at the foot of its stairs the button climbs back up into the station, the generator running, the gates open and its dead all called; down again, the tunnel’s come for the player; a pile on the stairs’ foot picked up first',
  );
}

console.log(lines.join('\n'));
