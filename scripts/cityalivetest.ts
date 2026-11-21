/**
 * City Escape, a city that doesn't wait (2.71, C5 batch 6; city/sim/skills.ts, happen.ts, dog.ts, holdout.ts): skills learnt by doing
 * and what each level gives, in a city begun from 2.71 only; the day's happenings planned from the seed (none on day 1, one or two
 * a day, never two of a kind) and each played by real commands (a crate landing and opened, a truck forced, a stash found, a stranger
 * answered or lost, the runner's swaps, a horde come); the dog fed twice and following, barking, waking a sleeper, digging; the coop's
 * hens and eggs and the omelette; the survivors' third errand and fourth swap; Holdout (no story, the nights worse, a fall ends it)
 * and a bot proof that it can be held; saves keeping it all, damaged ones made sound, old cities without any of it.
 */
import { check } from './assert';
import { COOP, DOG, HAPPEN, HAPPENINGS, HOLDOUT, RUNNER_TRADES, SKILL, SKILLS } from '../src/city/content/alive';
import { PIECE } from '../src/city/content/build';
import { cityItem, cityItemNumber } from '../src/city/content/items';
import { PEOPLE } from '../src/city/content/people';
import { CITY_RECIPES } from '../src/city/content/recipes';
import { SEARCH_STEPS } from '../src/city/content/loot';
import { buildList } from '../src/city/sim/build';
import { City, COP, FULL, loadCity, MODE, PIECE_OPS, START_MINUTE, type CityEvent } from '../src/city/sim/City';
import { quota, ZED, type Zed } from '../src/city/sim/dead';
import { dogHome, dogTile, follows } from '../src/city/sim/dog';
import { HAPPEN_KIND, planDay, RUNNER, type HappenEntry } from '../src/city/sim/happen';
import { isHoldout, nightsHeld } from '../src/city/sim/holdout';
import { blowEnergy, level, levelAt, moodMinutes, pieceFrom, searchSteps, skillUp, wearSpared, workSteps } from '../src/city/sim/skills';
import { errandOf, objectives, storyTarget, tradesOf, wants } from '../src/city/sim/story';
import { coop } from '../src/city/sim/survival';
import { nearestDir } from '../src/sim/ai/path';
import { command } from '../src/sim/command';
import { fnv1a } from '../src/sim/rng';
import { bodyAt } from '../src/sim/systems/movement';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/grid';
import { DECO } from '../src/city/gen/district';
import { canBuild } from '../src/city/sim/build';

const lines: string[] = [];
const say = (s: string) => lines.push(s);
const W = MAP_W;
const I = cityItemNumber;
const MIN = STEPS_PER_MINUTE;
const priv = (c: City) => c as unknown as { enter(d: number): void; sleep(): void };
const city = (seed: number, mode: number = MODE.SURVIVOR) => {
  const c = new City(seed, mode);
  c.peace = true;
  c.step(0);
  return c;
};
/** The clock set to a moment (the next step is its first). */
const at = (c: City, day: number, minute: number) => {
  c.state.step = ((day - 1) * 1440 + minute - START_MINUTE) * MIN - 1;
};
const pockets = (c: City, list: Array<[string, number?]>) => {
  c.state.inv = c.state.inv.map(() => [0, 0]);
  list.forEach(([id, n], k) => (c.state.inv[k] = [I(id), n ?? cityItem(I(id))!.wear ?? 1]));
};
const run = (c: City, steps: number, cmd = 0) => {
  const out: CityEvent[] = [];
  for (let k = 0; k < steps && !c.state.over; k++) {
    c.state.hunger = c.state.energy = c.state.thirst = FULL;
    c.state.health = 100;
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
const into = (c: City, d: number) => {
  if (c.state.district !== d) priv(c).enter(d);
};
const happens = (ev: CityEvent[], what: string) => ev.filter((e) => e.type === 'happen' && e.what === what);
/** A free tile beside a tile (not blocked, not one of the happening's). */
const besideOf = (c: City, tile: number) => [tile - W, tile + W, tile - 1, tile + 1].find((t) => !c.grid[t]) ?? -1;
/** A day of this city with a happening of a kind (and the entry), from day 2. */
function dayWith(c: City, kind: number, from = 2): { day: number; e: HappenEntry } | null {
  for (let day = from; day < from + 200; day++) {
    const e = planDay(c, day).find((x) => x[1] === kind);
    if (e) return { day, e };
  }
  return null;
}
/** The city brought to a happening's day at dawn, planned as the clock would: the entry as the state holds it. */
function toDay(c: City, day: number, minute: number, kind: number): HappenEntry {
  at(c, day, HAPPEN.said - 1);
  c.state.happen = [];
  run(c, MIN + 2);
  const e = c.state.happen.find((x) => x[1] === kind && x[0] >> 1 === day)!;
  if (minute > HAPPEN.said) {
    const tgt = ((day - 1) * 1440 + minute - START_MINUTE) * MIN - 1;
    c.state.step = tgt;
  }
  return e;
}

// ------------------------------------------------------------------ skills
{
  const c = city(1);
  check(c.state.skills.join() === '0,0,0,0' && SKILLS.every((_, k) => level(c, k) === 1), 'a new city: every skill at level 1');
  // (Points by doing: a first search.)
  const d = c.state.district;
  const prop = c.district.props.findIndex((p, k) => {
    const t = c.tilesOf(k)[0];
    return p.kind === 'shelf' && besideOf(c, t) >= 0 && !c.searched(`${k}`);
  });
  const t0 = c.tilesOf(prop)[0];
  stand(c, besideOf(c, t0), t0);
  const ev = run(c, SEARCH_STEPS + 4, command(0, COP.ACT));
  check(
    ev.some((e) => e.type === 'open') && c.state.skills[SKILL.SCAVENGER] === 1,
    `a first search: a Scavenger's point (${c.state.skills})`,
  );
  // (A level reached is said.)
  c.state.skills[SKILL.FIGHTER] = levelAt(SKILL.FIGHTER, 2) - 1;
  c.events = [];
  skillUp(c, SKILL.FIGHTER, 1);
  check(
    c.events.some((e) => e.type === 'skill' && e.skill === SKILL.FIGHTER && e.level === 2),
    'a level reached is said',
  );
  // (What each level gives: measured at 1 and 5.)
  const top = (k: number) => (c.state.skills[k] = levelAt(k, 5));
  const low = () => (c.state.skills = [0, 0, 0, 0]);
  low();
  const s1 = searchSteps(c, SEARCH_STEPS);
  const w1 = workSteps(c, 60);
  const b1 = blowEnergy(c);
  const m1 = moodMinutes(c, 'wellFed', 360);
  const q1 = moodMinutes(c, 'queasy', 240);
  const barricade1 = pieceFrom(c, { ...PIECES_OF('barricade') });
  for (const k of [0, 1, 2, 3]) top(k);
  const s5 = searchSteps(c, SEARCH_STEPS);
  const w5 = workSteps(c, 60);
  const b5 = blowEnergy(c);
  const m5 = moodMinutes(c, 'wellFed', 360);
  const q5 = moodMinutes(c, 'queasy', 240);
  const barricade5 = pieceFrom(c, { ...PIECES_OF('barricade') });
  let spared = 0;
  for (let k = 0; k < 3000; k++) {
    c.state.step++;
    if (wearSpared(c)) spared++;
  }
  check(s5 < s1 && w5 < w1 && b5 < b1 && m5 > m1 && q5 < q1, 'each skill at level 5 gives what it says');
  check(barricade5[0][1] === barricade1[0][1] - 1, `a Handy level 3 piece takes one plank fewer (${barricade1} → ${barricade5})`);
  check(spared > 3000 / 3.5 && spared < 3000 / 2.5, `a Fighter level 5: one blow in three spares the weapon (${spared} of 3000)`);
  // (Measured by a search's real steps at level 5.)
  const prop2 = c.district.props.findIndex(
    (p, k) => p.kind === 'shelf' && k !== prop && besideOf(c, c.tilesOf(k)[0]) >= 0 && !c.searched(`${k}`),
  );
  if (prop2 >= 0) {
    const t2 = c.tilesOf(prop2)[0];
    stand(c, besideOf(c, t2), t2);
    let steps = 0;
    c.step(command(0, COP.ACT));
    while (c.state.search && steps < 200) {
      c.step(0);
      steps++;
    }
    check(steps === s5, `a level 5 Scavenger's search, ${steps} steps (${s5})`);
  }
  // (An old city: no skills, whatever is done.)
  const old = city(2);
  old.state.rev = 6;
  skillUp(old, SKILL.HANDY, 50);
  check(old.state.skills[SKILL.HANDY] === 0 && level(old, SKILL.HANDY) === 1, 'a city begun before 2.71: no skills');
  void d;
  say(
    `skills: a point for each thing done of its kind, a level said; at level 5 a search ${s1} → ${s5} steps, building ${w1} → ${w5}, a blow's energy ${b1} → ${b5} thousandths, well fed ${m1} → ${m5} min, queasy ${q1} → ${q5}; Handy 3 a barricade one plank fewer; Fighter 5 spares the weapon ${((spared / 3000) * 100).toFixed(0)}% of blows; none in a city begun before`,
  );
}
function PIECES_OF(id: string) {
  return buildDefs.find((p) => p.id === id)!;
}
import { PIECES as buildDefs } from '../src/city/content/build';

// ------------------------------------------------------------------ the plan
{
  const counts = HAPPENINGS.map(() => 0);
  let days = 0;
  let two = 0;
  let bad = 0;
  const wrong: string[] = [];
  for (let seed = 1; seed <= 12; seed++) {
    const c = city(seed);
    check(planDay(c, 1).length === 0, `seed ${seed}: nothing on day 1`);
    for (let day = 2; day <= 31; day++) {
      const a = planDay(c, day);
      const b = planDay(c, day);
      const fault = (why: string) => {
        bad++;
        wrong.push(`${seed}/${day}: ${why}`);
      };
      if (JSON.stringify(a) !== JSON.stringify(b)) fault('not the same twice');
      days++;
      if (a.length === 2) two++;
      if (a.length < 1 || a.length > 2 || (a.length === 2 && (a[0][1] === a[1][1] || a[0][2] === a[1][2]))) fault(JSON.stringify(a));
      for (const e of a) {
        counts[e[1]]++;
        const dist = c.districtOf(e[2]);
        if (e[1] === HAPPEN_KIND.drop || e[1] === HAPPEN_KIND.horde || e[1] === HAPPEN_KIND.truck) {
          const ok = (t: number) => dist.rows[Math.floor(t / W)][t % W] === ',' && dist.deco[t] === DECO.NONE && !c.districtGrid(e[2])[t];
          if (!ok(e[3]) || (e[1] === HAPPEN_KIND.truck && !ok(e[3] + 1))) {
            bad++;
            wrong.push(`${seed}/${day} ${e}: not bare street`);
          }
          if (
            dist.gates.some((g) =>
              g.tiles.some(
                (t) => Math.max(Math.abs((t % W) - (e[3] % W)), Math.abs(Math.floor(t / W) - Math.floor(e[3] / W))) <= HAPPEN.gateClear,
              ),
            )
          ) {
            bad++;
            wrong.push(`${seed}/${day} ${e}: by a gate`);
          }
        }
        if (e[1] === HAPPEN_KIND.cry && !(dist.lotAt[e[3]] > 0)) fault('a cry outside');
        if (e[1] === HAPPEN_KIND.runner && c.plan.kinds[e[2]] !== 'market') fault('a runner away from the market');
        if (e[1] === HAPPEN_KIND.stash && !dist.props[e[3]]) fault('a stash in nothing');
      }
    }
  }
  check(bad === 0, `${bad} days planned wrong: ${wrong.join('; ')}`);
  check(two > days * 0.25 && two < days * 0.55, `two happenings on ${two} of ${days} days`);
  check(
    counts.every((n) => n > 0),
    `every kind comes (${counts})`,
  );
  say(
    `12 cities, days 2 to 31: nothing on day 1; ${(((days + two) / days) * 1).toFixed(2)} happenings a day (two on ${two} of ${days} days), never two of a kind or in one district, the same each time asked; ${HAPPENINGS.map((h, k) => `${h} ${counts[k]}`).join(', ')}; each on bare street clear of the checkpoints, in a building, at the market or in furniture as it should`,
  );
}

// ------------------------------------------------------------------ a crate
{
  const c = city(3);
  const w = dayWith(c, HAPPEN_KIND.drop)!;
  const e = toDay(c, w.day, HAPPEN.said, HAPPEN_KIND.drop);
  check(!!e && e[5] >= HAPPEN.dropFrom && e[5] <= HAPPEN.dropTo, `a drop planned at dawn, landing at ${e?.[5]}`);
  into(c, e[2]);
  stand(c, besideOf(c, e[3]), e[3]);
  // (Before it lands, nothing stands there.)
  check(!c.grid[e[3]], 'nothing on its tile before it lands');
  at(c, w.day, e[5] - 1);
  const ev = run(c, MIN + 2);
  check(happens(ev, 'landed').length === 1 && c.grid[e[3]] === 1, 'it lands at its time, and stands in the way');
  stand(c, besideOf(c, e[3]), e[3]);
  check(c.target()?.key === `e${e[0]}` && c.target()?.prop === 'drop', `the button takes the crate (${c.target()?.key})`);
  const opened = run(c, SEARCH_STEPS + 4, command(0, COP.ACT));
  const box = c.box();
  check(
    happens(opened, 'found').length === 1 && box.filter((st) => st[0]).length >= 3,
    `opened: ${box.map((st) => `${cityItem(st[0])?.id}×${st[1]}`).join(', ')}`,
  );
  check(c.state.happen.find((x) => x[0] === e[0])![4] === 1, 'the drop done');
  // (The next dawn lets it go: the crate and what's left in it.)
  at(c, w.day + 1, HAPPEN.said - 1);
  run(c, MIN + 2);
  check(!c.state.happen.some((x) => x[0] === e[0]) && !c.grid[e[3]] && !c.state.boxes[`${e[2]}:e${e[0]}`], 'gone the next dawn');
  say(
    `a supply drop: planned and said at dawn, landing at its half hour (heard), standing in the street; searched, it holds ${box.filter((st) => st[0]).length} things; gone the next dawn`,
  );
}

// ------------------------------------------------------------------ a truck, a stash
{
  const c = city(4);
  const w = dayWith(c, HAPPEN_KIND.truck)!;
  const e = toDay(c, w.day, 9 * 60, HAPPEN_KIND.truck);
  into(c, e[2]);
  stand(c, e[3] - 1, e[3]);
  pockets(c, []);
  const no = run(c, 3, command(0, COP.ACT));
  check(
    no.some((x) => x.type === 'refused' && x.why === 'truckCrowbar'),
    'a truck: refused without a crowbar',
  );
  pockets(c, [['crowbar']]);
  run(c, 1, command(0, COP.ACT));
  let steps = 0;
  while (c.state.search && steps < 400) {
    c.step(0);
    steps++;
  }
  check(steps + 1 >= HAPPEN.truckSteps - 2 && c.state.open === `e${e[0]}`, `forced in ${steps + 1} steps, its box open`);
  check(
    c.box().some((st) => st[0] === I('bolt')),
    'army kit inside: bolts',
  );
  check(c.grid[e[3]] === 1 && c.grid[e[3] + 1] === 1, 'the truck stays, across two tiles');
  // (A stash.)
  const s2 = city(5);
  const ws = dayWith(s2, HAPPEN_KIND.stash)!;
  const es = toDay(s2, ws.day, 9 * 60, HAPPEN_KIND.stash);
  into(s2, es[2]);
  const t = s2.tilesOf(es[3])[0];
  stand(s2, besideOf(s2, t), t);
  const before = s2.searched(`${es[3]}`);
  const ev = run(s2, SEARCH_STEPS + 4, command(0, COP.ACT));
  check(
    happens(ev, 'found').length === 1 && s2.box().some((st) => st[0] === I('tin')),
    `the stash found in its ${s2.district.props[es[3]].kind}`,
  );
  say(
    `a truck: forced with a crowbar (${HAPPEN.truckSteps} steps, heard), army kit inside, it stays; a stash: found in the furniture the note names (searched before: ${before})`,
  );
}

// ------------------------------------------------------------------ a stranger, the runner, a horde
{
  const c = city(6);
  const w = dayWith(c, HAPPEN_KIND.cry)!;
  const e = toDay(c, w.day, 9 * 60, HAPPEN_KIND.cry);
  into(c, e[2]);
  pockets(c, []);
  // (Inside its building, nobody about: answered.)
  stand(c, e[3] + 1, e[3]);
  run(c, 2);
  check(
    c.state.happen.find((x) => x[0] === e[0])![4] === 1 && c.state.inv.some((st) => st[0] === I('bandage')),
    'a stranger answered: thanks, and a bandage',
  );
  // (Another, nobody comes: lost at dusk.)
  const c2 = city(6);
  const e2 = toDay(c2, w.day, HAPPEN.cryTo - 1, HAPPEN_KIND.cry);
  const lost = run(c2, MIN * 2);
  check(happens(lost, 'lost').length === 1 && c2.state.happen.find((x) => x[0] === e2[0])![4] === 2, 'nobody came: lost at nightfall');
  // (With the dead about: they're in the building, and it isn't answered while they are.)
  const c3 = city(6);
  const e3 = toDay(c3, w.day, 9 * 60, HAPPEN_KIND.cry);
  c3.peace = false;
  c3.state.arrive = 1;
  into(c3, e3[2]);
  const lot = c3.district.lotAt[e3[3]];
  // (Stood well away: the dead are never put down near the player.)
  stand(c3, c3.district.spawn.z * W + c3.district.spawn.x);
  c3.state.arrive = 1;
  run(c3, 2);
  const inside = c3.state.zeds.filter(
    (z) => c3.district.lotAt[Math.floor(z.body.z / UNIT) * W + Math.floor(z.body.x / UNIT)] === lot,
  ).length;
  check(inside >= HAPPEN.cryDead, `the dead in the stranger's building: ${inside}`);
  // (The runner.)
  const r = city(7);
  const wr = dayWith(r, HAPPEN_KIND.runner)!;
  const er = toDay(r, wr.day, HAPPEN.runnerFrom - 1, HAPPEN_KIND.runner);
  into(r, er[2]);
  stand(r, besideOf(r, er[3]), er[3]);
  check(r.target()?.kind !== 'npc', 'before ten, no runner');
  run(r, MIN + 2);
  stand(r, besideOf(r, er[3]), er[3]);
  check(r.target()?.key === `r${er[0]}` && r.grid[er[3]] === 1, 'from ten, the runner stands there, and the button talks to them');
  const card = run(r, 1, command(0, COP.ACT));
  check(happens(card, 'runner').length === 1, 'the button opens their card');
  pockets(r, [['scrap', 4]]);
  run(r, 1, command(0, COP.TRADE, RUNNER * 4 + 0));
  check(r.count(I(RUNNER_TRADES[0][1][0])) === 1 && r.count(I('scrap')) === 0, 'a swap made: scrap for the weapons manual');
  at(r, wr.day, HAPPEN.runnerTo - 1);
  run(r, MIN + 2);
  check(r.grid[er[3]] === 0 && r.target()?.key !== `r${er[0]}`, 'at four, gone, the street walked again');
  // (A horde.)
  const h = city(8);
  const wh = dayWith(h, HAPPEN_KIND.horde)!;
  const eh = toDay(h, wh.day, 9 * 60, HAPPEN_KIND.horde);
  h.peace = false;
  into(h, eh[2]);
  stand(h, h.district.spawn.z * W + h.district.spawn.x);
  h.state.zeds = [];
  at(h, wh.day, eh[5] - 1);
  const hev = run(h, MIN + 2);
  const seeking = h.state.zeds.filter((z) => z.mode === ZED.SEEK).length;
  check(happens(hev, 'horde').length === 1 && seeking >= HAPPEN.hordeDead - 2, `a horde come at its hour: ${seeking} walking across`);
  say(
    `a stranger: answered once the building is clear (the dead put in it first), thanked with what they had; lost at ${HAPPEN.cryTo / 60}:00; the runner at the market from ${HAPPEN.runnerFrom / 60} to ${HAPPEN.runnerTo / 60}, swaps beside them; a horde: ${HAPPEN.hordeDead} walking across the district at its hour`,
  );
}

// ------------------------------------------------------------------ the dog
{
  const homes: number[] = [];
  for (let seed = 1; seed <= 12; seed++) homes.push(dogHome(city(seed)));
  check(
    homes.every((h) => h >= 0),
    'a stray in every city with a park',
  );
  const c = city(9);
  const g = c.state.dog;
  check(g.length === 5 && c.plan.kinds[g[1]] === 'park' && g[0] === 0, 'a new city: the stray waits in the park');
  into(c, g[1]);
  const t = dogTile(c);
  stand(c, besideOf(c, t), t);
  check(c.target()?.kind === 'dog', 'the button beside it feeds it');
  pockets(c, []);
  const none = run(c, 1, command(0, COP.ACT));
  check(
    none.some((e) => e.type === 'refused' && e.why === 'noDogFood'),
    'nothing it eats: said',
  );
  pockets(c, [['jerky', 2]]);
  const fed = run(c, 1, command(0, COP.ACT));
  run(c, 1, command(0, COP.ACT));
  check(fed.some((e) => e.type === 'dog' && e.what === 'fed') && follows(c) && c.count(I('jerky')) === 0, 'fed twice, it follows');
  check(c.target()?.kind !== 'dog', 'following, it never takes the button');
  // (It keeps near as the player walks.)
  const start = c.tile;
  for (let k = 0; k < 200; k++) {
    c.state.hunger = c.state.thirst = c.state.energy = FULL;
    c.step(command(k < 100 ? nearestDir(1, 0) : nearestDir(0, 1)));
  }
  const gap = Math.max(Math.abs((dogTile(c) % W) - (c.tile % W)), Math.abs(Math.floor(dogTile(c) / W) - Math.floor(c.tile / W)));
  check(gap <= DOG.heel + 2 && c.tile !== start, `it keeps near (${gap} tiles off)`);
  // (Into another district with the player.)
  const other = (c.state.district + 1) % 9;
  priv(c).enter(other);
  check(c.state.dog[1] === other, 'into another district with the player');
  // (It barks at one of the dead it sees; a sleeper woken by one near the bed.)
  stand(c, c.district.spawn.z * W + c.district.spawn.x);
  run(c, 30);
  const z: Zed = {
    body: bodyAt((dogTile(c) % W) + 3, Math.floor(dogTile(c) / W)),
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
  // (Standing about near the bed: a bark, the sleeper left asleep. Coming for them: woken.)
  const listen = () => {
    const out: CityEvent[] = [];
    for (let k = 0; k < DOG.barkEvery + 1; k++) {
      z.body.x = (dogTile(c) % W) * UNIT + 3 * UNIT + UNIT / 2;
      z.body.z = Math.floor(dogTile(c) / W) * UNIT + UNIT / 2;
      c.step(0);
      out.push(...c.events);
    }
    return out;
  };
  c.state.sleeping = true;
  c.state.zeds = [z];
  const idle = listen();
  check(
    idle.some((e) => e.type === 'dog' && e.what === 'bark') && !idle.some((e) => e.type === 'sleep' && !e.on) && c.state.sleeping,
    'it barks at one of the dead standing about, and lets the sleeper sleep',
  );
  z.mode = ZED.CHASE;
  const chase = listen();
  check(
    chase.some((e) => e.type === 'sleep' && !e.on && e.why === 'barked'),
    'one coming for the sleeper: the dog wakes them',
  );
  // (Once a day, out of doors, it digs something up.)
  c.state.zeds = [];
  const c2 = city(10);
  c2.state.dog[0] = DOG.fed;
  into(c2, c2.state.dog[1]);
  stand(c2, dogTile(c2) + 1);
  at(c2, 2, DOG.digFrom - 1);
  const dug = run(c2, (DOG.digTo - DOG.digFrom + 2) * MIN);
  const more = run(c2, 60 * MIN);
  check(
    dug.filter((e) => e.type === 'dog' && e.what === 'dug').length === 1 && !more.some((e) => e.type === 'dog' && e.what === 'dug'),
    'it digs once a day',
  );
  // (A save keeps it; an old city has none.)
  const back = loadCity(JSON.parse(JSON.stringify(c.snapshot())))!;
  check(back.state.dog.join() === c.state.dog.join() && follows(back), 'a save keeps the dog');
  const bad = JSON.parse(JSON.stringify(c.snapshot()));
  bad.state.dog = [9, 99];
  check(loadCity(bad)!.state.dog.length === 0, 'a damaged dog made sound (none)');
  say(
    `the dog: a stray in every city's park, fed twice (jerky, a tin…) it follows, ${gap} tiles off at a walk, into the next district; it barks at the dead it sees, wakes a sleeper when one within ${DOG.wakes} tiles is coming for them, digs something up once a day out of doors; never the button's once it follows; a save keeps it`,
  );
}

// ------------------------------------------------------------------ hens, the omelette
{
  const c = city(11);
  c.state.manuals = 63;
  check(buildList(c)[PIECE.coop] !== 'none', 'the coop in a new city');
  // (Built on an open tile from the pockets.)
  let spot = -1;
  for (let i = W * 6; i < W * (W - 6) && spot < 0; i++)
    if (!c.grid[i] && !c.grid[i + 1] && !c.grid[i + 2] && canBuild(c, PIECE.coop, i + 1) !== 'blocked') spot = i;
  pockets(c, [['hammer'], ['plank', 4], ['nails', 2], ['wire', 1], ['hen', 1], ['hen', 1], ['hen', 1]]);
  stand(c, spot, spot + 1);
  c.step(command(0, COP.BUILD, PIECE.coop));
  for (let k = 0; k < 200 && c.state.search; k++) c.step(0);
  check(c.pieceAt[spot + 1] === PIECE.coop + 1, 'a coop built');
  run(c, 1, command(0, COP.ACT));
  const hen = () => run(c, 1, command(0, COP.BUILD, PIECE_OPS + 8));
  hen();
  hen();
  const third = hen();
  const p = c.state.built[c.state.district].find((q) => q[0] === spot + 1)!;
  check(
    coop(c, p, false).hens === COOP.hens && third.some((e) => e.type === 'refused' && e.why === 'coopFull'),
    'two hens in, a third refused',
  );
  const none = run(c, 1, command(0, COP.BUILD, PIECE_OPS + 9));
  check(
    none.some((e) => e.type === 'refused' && e.why === 'noEggs'),
    'no eggs the day they go in',
  );
  c.state.step += 1440 * MIN;
  run(c, 1, command(0, COP.BUILD, PIECE_OPS + 9));
  check(c.count(I('egg')) === COOP.hens, `the next dawn, an egg each: ${c.count(I('egg'))}`);
  c.state.step += 5 * 1440 * MIN;
  check(coop(c, p, false).eggs === COOP.eggs, 'eggs kept up to six');
  // (Taken down: the hens back.)
  pockets(c, [['hammer']]);
  run(c, 1, command(0, COP.BUILD, PIECE_OPS + 1));
  for (let k = 0; k < 200 && c.state.search; k++) c.step(0);
  check(c.count(I('hen')) === COOP.hens, `taken down, the hens back (${c.count(I('hen'))})`);
  // (The omelette.)
  const r = CITY_RECIPES.findIndex((x) => x.makes === 'omelette');
  pockets(c, [['egg', 2], ['herbs', 1], ['stove']]);
  run(c, 1, command(0, COP.MAKE, r));
  check(c.count(I('omelette')) === 1, 'an omelette made: two eggs, herbs, the stove');
  const old = city(11);
  old.state.rev = 6;
  check(buildList(old)[PIECE.coop] === 'none' && old.canMake(r) === 'none', 'a city begun before: no coop, no omelette');
  say(
    `hens: a coop holds ${COOP.hens}, an egg a day each from the next dawn, ${COOP.eggs} kept at most, the hens back when it's taken down; two eggs and herbs make an omelette on a stove; none of it in a city begun before`,
  );
}

// ------------------------------------------------------------------ the survivors
{
  const c = city(12);
  const k = PEOPLE.findIndex((p) => p.id === 'mechanic');
  c.state.met |= 1 << k;
  c.state.errand[k] = 2;
  const e = errandOf(c, k);
  check(e?.build === 'rainBarrel' && wants(c, k)?.have === 0, "the mechanic's third errand: a rain barrel built");
  c.state.built[3] = [[100, PIECE.rainBarrel, 60, 1, 0]];
  check(wants(c, k)?.have === 1, 'built anywhere, it counts');
  const p = c.story.people[k];
  into(c, p.district);
  stand(c, p.tile + 1, p.tile);
  run(c, 1, command(0, COP.GIVE, k));
  check(c.state.errand[k] === 3 && c.count(I('scrap_armour')) === 1 && !errandOf(c, k), 'handed in: paid, no more errands');
  check(tradesOf(c, k).length === 4, 'a fourth swap');
  const old = city(12);
  old.state.rev = 6;
  old.state.met |= 1 << k;
  old.state.errand[k] = 2;
  check(!errandOf(old, k) && tradesOf(old, k).length === 3, 'a city begun before: two errands, three swaps');
  say(
    'the survivors: a third errand (two noisemakers, two poultices, a rain barrel built anywhere, two jerky for two hens) and a fourth swap each, in a city begun from 2.71',
  );
}

// ------------------------------------------------------------------ Holdout
{
  const c = city(13, MODE.HOLDOUT);
  check(isHoldout(c) && c.state.rev >= 7, 'a Holdout city');
  const radio = c.story.things[0];
  into(c, radio.district);
  const t = c.tilesOf(radio.prop)[0];
  stand(c, besideOf(c, t), t);
  const ev = run(c, SEARCH_STEPS + 4, command(0, COP.ACT));
  check(!ev.some((e) => e.type === 'found'), "no radio: the story isn't there");
  check(
    storyTarget(c) === null &&
      objectives(c)
        .map((o) => o.id)
        .join() === 'holdNight,holdRush',
    `the goal: the night, the next Rush (${objectives(c).map((o) => o.id)})`,
  );
  // (Nights worse each time.)
  const s = city(13);
  at(s, 6, 23 * 60);
  at(c, 6, 23 * 60);
  s.step(0);
  c.step(0);
  const more = quota(c).streets + quota(c).indoors - (quota(s).streets + quota(s).indoors);
  check(more === Math.min(HOLDOUT.most, HOLDOUT.perNight * 5), `night 6: ${more} more of the dead than a story's`);
  check(nightsHeld(c) === 5, `on night 6, ${nightsHeld(c)} nights held`);
  // (A fall ends it.)
  c.hurt(200, 'z0');
  check(c.state.over === 1 && c.events.some((e) => e.type === 'dead' && e.final), 'a fall ends it');
  const saved = city(14, MODE.HOLDOUT);
  const back = loadCity(JSON.parse(JSON.stringify(saved.snapshot())));
  check(back?.state.mode === MODE.HOLDOUT, 'a save keeps Holdout');
  say(
    `Holdout: no story (the radio's furniture holds no radio), the goal the night and the next Rush; ${HOLDOUT.perNight} more of the dead each night held (${HOLDOUT.most} at most); a fall ends it; a save keeps it`,
  );
}

// ------------------------------------------------------------------ Holdout held: a bot proof
{
  /**
   * A player ready for it, as cityrushtest's: a pocket of plank walls, a barricade, spikes and wire before it, a bat and three
   * bandages; stood in it from 21:00 to 05:00, striking what comes in reach. By day they mend the walls, find another bat and
   * bandages, eat and drink (the day isn't played). Nights held until the first fall, nine at most.
   */
  const holdout = (seed: number): number => {
    const c = city(seed, MODE.HOLDOUT);
    const d = c.state.district;
    let mid = -1;
    for (let z = 6; z < W - 6 && mid < 0; z++)
      for (let x = 6; x < W - 6 && mid < 0; x++) {
        const m = z * W + x;
        let ok = true;
        for (let dz = -3; dz <= 3 && ok; dz++)
          for (let dx = -3; dx <= 3 && ok; dx++) {
            const t = m + dz * W + dx;
            ok =
              (!c.grid[t] && !c.carAt[t] && canBuild(c, PIECE.barricade, t) !== 'blocked' && canBuild(c, PIECE.barricade, t) !== 'gate') ||
              t === c.tile;
          }
        if (ok) mid = m;
      }
    if (mid < 0) return -1;
    const E = nearestDir(1, 0);
    const S = nearestDir(0, 1);
    const base = (): Array<[number, number, number, number, number]> => {
      const built: Array<[number, number, number, number, number]> = [];
      for (const o of [-W - 1, -W, -W + 1, -1, W - 1, W, W + 1]) built.push([mid + o, PIECE.metalWall, 250, Math.abs(o) === 1 ? E : S, 0]);
      built.push([mid + 1, PIECE.barricade, 60, E, 0]);
      for (const t of [mid + 2, mid + W + 2, mid - W + 2]) built.push([t, PIECE.spikes, 30, E, 0]);
      built.push([mid + 3, PIECE.barbedWire, 40, E, 0]);
      return built;
    };
    c.peace = false;
    for (let n = 1; n <= 9; n++) {
      c.state.built[d] = base();
      c.reenter();
      c.state.inv = c.state.inv.map(() => [0, 0]);
      c.state.inv[0] = [I('spear'), 35];
      c.state.inv[1] = [I('bandage'), 3];
      c.state.inv[2] = [I('bat'), 40];
      c.state.player = bodyAt(mid % W, Math.floor(mid / W), E);
      at(c, n, 21 * 60);
      Object.assign(c.state, { health: 100, hunger: FULL, thirst: FULL, energy: 80_000, bleed: 0, zeds: [], arrive: 1 });
      for (let k = 0; k < 8 * 60 * MIN; k++) {
        const s = c.state;
        let near = -1;
        let nd = (2.2 * 1024) ** 2;
        s.zeds.forEach((z, i) => {
          const dd = (z.body.x - s.player.x) ** 2 + (z.body.z - s.player.z) ** 2;
          if (dd < nd) {
            nd = dd;
            near = i;
          }
        });
        const slot = s.inv.findIndex((st) => st[0] === I('bandage'));
        const cmd =
          (s.health < 45 || s.bleed > 6) && slot >= 0 && near < 0
            ? command(0, COP.USE, slot)
            : near >= 0
              ? command(nearestDir(s.zeds[near].body.x - s.player.x, s.zeds[near].body.z - s.player.z), COP.HIT)
              : c.tile !== mid
                ? command(nearestDir((mid % W) - (c.tile % W), Math.floor(mid / W) - Math.floor(c.tile / W)))
                : 0;
        c.step(cmd);
        if (c.state.over) return n - 1;
      }
    }
    return 9;
  };
  const held: number[] = [];
  for (let seed = 1; seed <= 12; seed++) {
    const n = holdout(seed);
    if (n >= 0) held.push(n);
  }
  const mean = held.reduce((a, b) => a + b, 0) / Math.max(1, held.length);
  check(held.length >= 9 && mean >= 3, `Holdout held ${mean.toFixed(1)} nights on average (${held})`);
  check(
    held.some((n) => n < 9),
    `Holdout ends: none held nine (${held})`,
  );
  say(
    `Holdout, a ready player (metal walls, spikes and wire, a spear, a bat, three bandages, mended and restocked by day) on ${held.length} cities: ${held.join(', ')} nights held (${mean.toFixed(1)} on average)`,
  );
}

// ------------------------------------------------------------------ saves
{
  const c = city(15);
  c.state.skills = [40, 12, 7, 3];
  c.state.happen = [[4, 0, 2, 900, 0, 600]];
  const snap = JSON.parse(JSON.stringify(c.snapshot()));
  const back = loadCity(snap)!;
  check(
    back.state.skills.join() === '40,12,7,3' && JSON.stringify(back.state.happen) === JSON.stringify(c.state.happen),
    'a save keeps the skills and the happenings',
  );
  const bad = JSON.parse(JSON.stringify(snap));
  bad.state.skills = [1, 2];
  bad.state.happen = [[1, 99, 0, 0, 0, 0], 'x', [4, 0, 2, 900, 0, 600]];
  const m = loadCity(bad)!;
  check(m.state.skills.join() === '0,0,0,0' && m.state.happen.length === 1, 'a damaged save made sound');
  const older = JSON.parse(JSON.stringify(snap));
  delete older.state.skills;
  delete older.state.happen;
  delete older.state.dog;
  older.state.rev = 6;
  const o = loadCity(older)!;
  check(
    o.state.skills.join() === '0,0,0,0' && o.state.happen.length === 0 && o.state.dog.length === 0,
    'a save from before 2.71 loads with none of it',
  );
  // (A city of 2.70 runs a week with nothing of 2.71's.)
  const w = city(16);
  w.state.rev = 6;
  w.state.dog = [];
  const ev = run(w, 3 * 1440 * MIN);
  check(!ev.some((e) => e.type === 'happen' || e.type === 'skill' || e.type === 'dog'), 'an old city: no happenings, no skills, no dog');
  say(
    `a save keeps the skills, the happenings and the dog; a damaged one made sound; one from before 2.71 loads with none, and its days stay as they were (${fnv1a(JSON.stringify(w.state.happen))})`,
  );
}

console.log(lines.join('\n'));
