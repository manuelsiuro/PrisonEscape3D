/**
 * City Escape's survival (C2a, city/sim/City.ts): a scavenger bot lives a week in the start's district
 * and the next, by ordinary commands (it searches the nearest furniture not yet looked into, eats when
 * hungry, sleeps in a bed at night), on several seeds; what it found, ate and how it fared. Then the
 * rules one by one: hunger and starving, energy and sleep, a search's time, the pockets' stacks,
 * a box's draws the same every time, both ways of dying, and a save carrying all of it.
 */
import { check } from './assert';
import { CITY_ITEMS, cityItem, cityItemNumber } from '../src/city/content/items';
import { City, COP, FULL, loadCity, MODE, POCKETS, START_MINUTE } from '../src/city/sim/City';
import { scavenger } from './citybots';
import { nearestDir } from '../src/sim/ai/path';
import { command } from '../src/sim/command';
import { fnv1a } from '../src/sim/rng';
import { MAP_W } from '../src/sim/world/grid';

const lines: string[] = [];
const say = (s: string) => lines.push(s);
const MIN = 20;

interface Tally {
  searched: number;
  found: number;
  food: number;
  eaten: number;
  slept: number;
  starved: number;
  deaths: number;
  kills: number;
  bites: number;
}
const none = (): Tally => ({ searched: 0, found: 0, food: 0, eaten: 0, slept: 0, starved: 0, deaths: 0, kills: 0, bites: 0 });

const SEEDS = 10;
const DAYS = 7;
const per = (n: number) => (n / SEEDS).toFixed(1);
const total = none();
const rows: string[] = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  const c = new City(seed);
  const tally = none();
  const next = scavenger(c);
  // (A week by the city's own days: a fall skips to the next morning.)
  for (let step = 0; step < 3 * DAYS * 1440 * MIN && !c.state.over && c.day <= DAYS; step++) {
    c.step(next());
    for (const e of c.events) {
      if (e.type === 'open' && e.first) tally.searched++;
      if (e.type === 'took') {
        tally.found += e.n;
        if (cityItem(e.item)?.kind === 'food') tally.food += e.n;
      }
      if (e.type === 'used' && cityItem(e.item)?.kind === 'food') tally.eaten++;
      if (e.type === 'sleep' && e.on) tally.slept++;
      if (e.type === 'starving') tally.starved++;
      if (e.type === 'dead') tally.deaths++;
      if (e.type === 'bite') tally.bites++;
      if (e.type === 'swing' && e.dead) tally.kills++;
    }
  }
  // (It fights whatever comes within reach and never hides: a player does better. More than this, the dead are too many.)
  check(tally.deaths <= 5, `seed ${seed}: the scavenger fell ${tally.deaths} times in ${DAYS} days`);
  check(tally.slept >= DAYS - 2, `seed ${seed}: asleep only ${tally.slept} times in ${DAYS} days`);
  check(c.day >= DAYS, `seed ${seed}: only reached day ${c.day}`);
  for (const k of Object.keys(total) as Array<keyof Tally>) total[k] += tally[k];
  if (seed <= 4)
    rows.push(
      `  ${seed}: ${tally.searched} searched, ${tally.found} things (${tally.food} food), ${tally.eaten} eaten, ${tally.slept} times asleep, ${tally.kills} put down, ${tally.bites} bites, fell ${tally.deaths}, ${fnv1a(JSON.stringify(c.snapshot().state))}`,
    );
}
check(total.deaths <= SEEDS * 2.5, `the scavenger fell ${total.deaths} times in ${SEEDS} weeks: the dead are too many`);
check(total.kills >= SEEDS * 5, `the scavenger put down only ${total.kills} of the dead in ${SEEDS} weeks: where are they?`);
say(
  `${SEEDS} cities, a scavenger bot ${DAYS} days in each, the dead about: it fell ${per(total.deaths)} times a week (it fights what comes in reach and never hides)`,
);
say(
  `a week, on average: ${per(total.searched)} pieces searched, ${per(total.found)} things found (${per(total.food)} food), ${per(total.eaten)} eaten, asleep ${per(total.slept)} times, starving ${per(total.starved)} times, ${per(total.kills)} of the dead put down, ${per(total.bites)} bites taken`,
);
for (const r of rows) say(r);

// ------------------------------------------------------------------ the rules, one by one
const TIN = cityItemNumber('tin');
const BANDAGE = cityItemNumber('bandage');
const PLANK = cityItemNumber('plank');
const idle = (c: City, minutes: number) => {
  for (let k = 0; k < minutes * MIN; k++) c.step(0);
};

// Hunger: a full bar lasts about 30 hours awake; at nothing, health goes; food brings it back.
{
  const c = new City(3);
  c.peace = true;
  c.state.hunger = FULL;
  c.state.energy = FULL;
  idle(c, 600);
  const after10h = c.state.hunger;
  check(after10h > FULL * 0.62 && after10h < FULL * 0.72, `ten hours awake should cost about a third of the bar: ${after10h}`);
  c.state.hunger = 100;
  idle(c, 30);
  check(c.state.hunger === 0 && c.state.health < 100, `starving should cost health: ${c.state.health}`);
  const hurt = c.state.health;
  c.state.inv[0] = [TIN, 2];
  c.step(command(0, COP.USE, 0));
  check(
    c.state.hunger === 30_000 && c.state.inv[0][1] === 1 && c.events.some((e) => e.type === 'used'),
    `a tin is 30 points: ${c.state.hunger}`,
  );
  c.state.hunger = FULL;
  c.step(command(0, COP.USE, 0));
  check(c.state.inv[0][1] === 1 && c.events.some((e) => e.type === 'refused'), 'a full stomach wastes nothing');
  c.state.inv[1] = [BANDAGE, 1];
  c.step(command(0, COP.USE, 1));
  check(c.state.health === Math.min(100, hurt + 28) && c.state.inv[1][0] === 0, `a bandage mends 28: ${c.state.health}`);
  c.state.inv[2] = [PLANK, 1];
  c.step(command(0, COP.USE, 2));
  check(c.state.inv[2][1] === 1 && c.events.some((e) => e.type === 'refused' && e.why === 'noUse'), 'a plank is not eaten');
  say(
    'hunger: a third of the bar in ten hours awake; at nothing, health goes; a tin is 30 points, a bandage 28 health; nothing wasted on a full bar',
  );
}

// Both ways of dying.
{
  const c = new City(5, MODE.SURVIVOR);
  c.peace = true;
  c.state.inv[0] = [TIN, 3];
  for (let k = 0; k < 200; k++) c.step(command(9));
  const fell = c.tile;
  const day = c.day;
  c.hurt(500);
  check(c.state.health === 40 && !c.state.over && c.state.deaths === 1, `a Survivor wakes with 40 health: ${c.state.health}`);
  check(
    c.tile === c.state.home[1] && c.minute === START_MINUTE && c.day === day + 1,
    `at home, the next morning: tile ${c.tile}, day ${c.day}, ${c.minute}`,
  );
  check(
    c.state.inv.every((st) => !st[0]) && c.state.boxes[`${c.state.district}:g${fell}`]?.[0]?.[1] === 3,
    'what they carried lies where they fell',
  );
  const h = new City(5, MODE.HARDCORE);
  h.hurt(500);
  check(h.state.over === 1 && h.events.some((e) => e.type === 'dead' && e.final), 'Hardcore: the city is lost');
  const step = h.state.step;
  h.step(command(9));
  check(h.state.step === step, 'a lost city takes no more steps');
  say('a Survivor who falls wakes at home the next morning with 40 health, their things where they fell; in Hardcore the city is lost');
}

// A box: its draws the same every time; the pockets' stacks; a save carrying all of it.
{
  const stockOf = (seed: number) => {
    const c = new City(seed);
    c.peace = true;
    const next = scavenger(c);
    const got: string[] = [];
    for (let k = 0; k < 4000 && got.length < 6; k++) {
      c.step(next());
      for (const e of c.events)
        if (e.type === 'open' && e.first)
          got.push(
            `${e.key}=${
              c
                .box()
                .map((st) => `${CITY_ITEMS[st[0] - 1]?.id ?? '-'}×${st[1]}`)
                .join('+') || 'empty'
            }`,
          );
    }
    return { c, got };
  };
  const a = stockOf(2);
  const b = stockOf(2);
  check(a.got.join() === b.got.join() && a.got.length === 6, `the same city, the same finds: ${a.got.join(' ')}`);
  say(`seed 2's first six searches: ${a.got.join(', ')}`);
  const c = a.c;
  const loaded = loadCity(JSON.parse(JSON.stringify(c.snapshot())));
  check(
    !!loaded && JSON.stringify(loaded.state.inv) === JSON.stringify(c.state.inv) && loaded.state.hunger === c.state.hunger,
    'a save carries the pockets and the meters',
  );
  check(Object.keys(loaded!.state.boxes).length === Object.keys(c.state.boxes).length, 'and every box looked into');
  // A save from before survival (C1): loads with full pockets' worth of nothing and the meters fresh.
  const old = JSON.parse(JSON.stringify(c.snapshot()));
  for (const k of ['health', 'hunger', 'energy', 'inv', 'boxes', 'open', 'search', 'searchLeft', 'sleeping', 'home', 'deaths', 'over'])
    delete old.state[k];
  const from1 = loadCity(old);
  check(
    !!from1 && from1.state.health === 100 && from1.state.inv.length === POCKETS && from1.state.home[0] === from1.plan.start,
    'a save from stage 1 loads, the meters fresh',
  );
  const bad = JSON.parse(JSON.stringify(c.snapshot()));
  bad.state.inv[0] = [999, 1];
  check(loadCity(bad) === null, 'a pocket with a thing that is not is refused');
  say(
    'a save carries the pockets, the meters and every box looked into; one from stage 1 loads with the meters fresh; a thing that is not is refused',
  );
}

// ------------------------------------------------------------------ what the review found (2.47)
{
  // A save made on the step of a crossing, of a new city's start, of a fall: loaded, it plays on as the live city does.
  // (2.53: by day the dead wait in the dark, away from the start's homes: a first fall takes a third day.)
  const live = new City(1);
  const next = scavenger(live);
  const saves: Array<{ at: number; snap: unknown; why: string }> = [
    { at: 0, snap: JSON.parse(JSON.stringify(live.snapshot())), why: 'start' },
  ];
  const cmds: number[] = [];
  for (let k = 0; k < 3 * 1440 * MIN && saves.length < 8; k++) {
    const cmd = next();
    cmds.push(cmd);
    live.step(cmd);
    for (const e of live.events)
      if (e.type === 'travel' || e.type === 'dead')
        saves.push({ at: cmds.length, snap: JSON.parse(JSON.stringify(live.snapshot())), why: e.type });
  }
  const end = fnv1a(JSON.stringify(live.snapshot().state));
  let same = 0;
  for (const sv of saves) {
    const c = loadCity(sv.snap)!;
    for (let k = sv.at; k < cmds.length; k++) c.step(cmds[k]);
    if (fnv1a(JSON.stringify(c.snapshot().state)) === end) same++;
    else check(false, `a save made at a ${sv.why} (step ${sv.at}) played on differently`);
  }
  check(
    saves.some((sv) => sv.why === 'travel'),
    'the bot should have crossed a checkpoint in three days',
  );
  say(`saves made at the start and at ${saves.length - 1} crossings and falls: ${same} of ${saves.length} play on as the live city did`);

  // A bed with something in it is looked into again, not slept in; empty, it's slept in.
  const c = new City(1);
  c.peace = true;
  /** An open tile beside a piece of furniture (whichever of its tiles has one). */
  const besideOf = (prop: number) =>
    c
      .tilesOf(prop)
      .flatMap((i) => [i - 1, i + 1, i - MAP_W, i + MAP_W])
      .find((i) => !c.grid[i]);
  const bed = c.district.props.findIndex((p, k) => p.kind === 'bed' && besideOf(k) !== undefined);
  const beside = besideOf(bed)!;
  // (Turned to the bed: what's faced is what's meant, whatever else stands beside.)
  const bedTile = c
    .tilesOf(bed)
    .find((i) => Math.abs((i % MAP_W) - (beside % MAP_W)) + Math.abs(Math.floor(i / MAP_W) - Math.floor(beside / MAP_W)) === 1)!;
  c.state.player.facing = nearestDir((bedTile % MAP_W) - (beside % MAP_W), Math.floor(bedTile / MAP_W) - Math.floor(beside / MAP_W));
  c.state.player.x = (beside % MAP_W) * 1024 + 512;
  c.state.player.z = Math.floor(beside / MAP_W) * 1024 + 512;
  c.state.boxes[`${c.state.district}:${bed}`] = [[TIN, 1]];
  c.step(0);
  check(c.target()?.kind === 'box' && c.target()?.key === `${bed}`, 'a bed holding something is looked into');
  c.step(command(0, COP.ACT));
  c.step(command(0, COP.TAKE_ALL));
  c.step(command(0, COP.CLOSE));
  check(c.target()?.kind === 'bed' && c.target()?.key === `${bed}` && c.state.inv[0][0] === TIN, 'emptied, it is slept in');
  // Pressed again during a first search, the search goes on.
  const desk = c.district.props.findIndex(
    (p, k) => ['desk', 'shelf', 'table'].includes(p.kind) && !c.searched(`${k}`) && besideOf(k) !== undefined,
  );
  const by = besideOf(desk)!;
  c.state.player.x = (by % MAP_W) * 1024 + 512;
  c.state.player.z = Math.floor(by / MAP_W) * 1024 + 512;
  c.step(0);
  c.step(command(0, COP.ACT));
  for (let k = 0; k < 10; k++) c.step(0);
  const left = c.state.searchLeft;
  c.step(command(0, COP.ACT));
  check(
    c.state.search !== '' && c.state.searchLeft === left - 1,
    `a second press mid-search starts nothing over: ${left} then ${c.state.searchLeft}`,
  );
  // Medicine isn't used up at full health; a fall with empty pockets leaves no pile; hunger isn't mended by a fall.
  c.state.search = '';
  c.state.inv[1] = [BANDAGE, 1];
  c.state.health = 100;
  c.step(command(0, COP.USE, 1));
  check(c.state.inv[1][1] === 1 && c.events.some((e) => e.type === 'refused' && e.why === 'noNeed'), 'a bandage at full health is kept');
  for (const st of c.state.inv) st[0] = st[1] = 0;
  const piles = () => Object.keys(c.state.boxes).filter((k) => k.includes(':g')).length;
  const before = piles();
  c.state.hunger = 0;
  c.hurt(500);
  check(piles() === before, 'a fall with empty pockets leaves no pile');
  check(c.state.hunger === 15_000, `a fall mends hunger only to 15: ${c.state.hunger}`);
  say(
    'a bed holding something is looked into before it is slept in; a second press mid-search starts nothing over; medicine is kept at full health; an empty-handed fall leaves no pile and mends hunger only to 15',
  );
}

console.log(lines.join('\n'));
