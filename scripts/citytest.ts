/**
 * City Escape's simulation (C1, city/sim/City.ts): a bot walks every district of a city by ordinary
 * commands, through the checkpoints (the nearest district not yet seen, by the plan), on several seeds;
 * the same commands give the same city; a city saved and loaded is the same, and plays on the same; the
 * map fills in as it's walked; a damaged save is refused; the clock.
 */
import { check } from './assert';
import { CITY_N, neighbour, OPPOSITE } from '../src/city/gen/plan';
import { City, loadCity, MODE, START_MINUTE } from '../src/city/sim/City';
import { Autopilot } from '../src/sim/ai/autopilot';
import { command } from '../src/sim/command';
import { fnv1a } from '../src/sim/rng';
import { MAP_H, MAP_W } from '../src/sim/world/grid';

const lines: string[] = [];
const say = (s: string) => lines.push(s);

/** The next district on the shortest way (in districts) from `from` to one not visited yet; -1: all seen. */
function nextHop(c: City, visited: Set<number>): number {
  const from = c.state.district;
  const prev = new Map<number, number>([[from, -1]]);
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const d = queue[q];
    if (!visited.has(d)) {
      let at = d;
      while (prev.get(at) !== from) at = prev.get(at)!;
      return at;
    }
    for (let s = 0; s < 4; s++) {
      const n = neighbour(d, s);
      if (n >= 0 && c.plan.gates[d][s] && !prev.has(n)) {
        prev.set(n, d);
        queue.push(n);
      }
    }
  }
  return -1;
}

/** Walks the whole city; the commands sent, for the replay. */
function tour(c: City): { cmds: number[]; ok: boolean } {
  const cmds: number[] = [];
  const visited = new Set([c.state.district]);
  for (let hops = 0; hops < 40; hops++) {
    const to = nextHop(c, visited);
    if (to < 0) return { cmds, ok: true };
    const gate = c.district.gates.find((g) => g.to === to)!;
    const pilot = new Autopilot(c.world, () => c.grid);
    pilot.goTo(gate.tiles[0]);
    const from = c.state.district;
    for (let n = 0; c.state.district === from && n < 8000; n++) {
      const cmd = command(pilot.dir(c.state.player));
      cmds.push(cmd);
      c.step(cmd);
      // (Across: where the gate leads, a tile in from the border on the same street, facing in.)
      for (const e of c.events) {
        check(
          e.type === 'travel' && e.from === from && e.to === to && e.side === OPPOSITE[gate.side],
          `seed ${c.state.seed}: crossed ${from}→${to}, the event says ${JSON.stringify(e)}`,
        );
        check(!c.grid[c.tile], `seed ${c.state.seed}: across into ${to}, standing in something`);
        check(
          !c.district.gates.some((g) => g.tiles.includes(c.tile)),
          `seed ${c.state.seed}: across into ${to}, standing on its gate (it would cross straight back)`,
        );
      }
    }
    if (c.state.district === from) return { cmds, ok: false };
    visited.add(c.state.district);
  }
  return { cmds, ok: false };
}

const SEEDS = 12;
let steps = 0;
let most = 0;
const prints: string[] = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  const c = new City(seed);
  check(c.state.district === c.plan.start && !c.grid[c.tile], `seed ${seed}: the start`);
  const before = c.seenShare(c.state.district);
  const { cmds, ok } = tour(c);
  check(ok, `seed ${seed}: the bot didn't get round the city (in district ${c.state.district} after ${cmds.length} steps)`);
  check(c.state.visited === (1 << CITY_N) - 1, `seed ${seed}: visited ${c.state.visited.toString(2)}`);
  check(c.seenShare(c.plan.start) > before, `seed ${seed}: the map didn't fill in`);
  steps += cmds.length;
  most = Math.max(most, cmds.length);
  // The same commands, the same city.
  const again = new City(seed);
  for (const cmd of cmds) again.step(cmd);
  const a = JSON.stringify(c.snapshot());
  check(a === JSON.stringify(again.snapshot()), `seed ${seed}: the same commands gave another city`);
  // Saved half way and loaded: the rest played on it ends the same.
  const half = new City(seed);
  const mid = Math.floor(cmds.length / 2);
  for (let k = 0; k < mid; k++) half.step(cmds[k]);
  const loaded = loadCity(JSON.parse(JSON.stringify(half.snapshot())));
  check(!!loaded, `seed ${seed}: its own save refused`);
  if (loaded) {
    for (let k = mid; k < cmds.length; k++) loaded.step(cmds[k]);
    check(JSON.stringify(loaded.snapshot()) === a, `seed ${seed}: a city saved and loaded played on differently`);
  }
  if (seed <= 4) prints.push(`${seed}: ${cmds.length} steps · ${fnv1a(a)}`);
}
say(
  `${SEEDS} cities walked end to end by a bot: all nine districts each, ${Math.round(steps / SEEDS)} steps on average (${Math.round(steps / SEEDS / 20 / 60)} game hours), ${most} at most`,
);
say('the same commands give the same city; saved half way and loaded, it ends the same');
for (const p of prints) say(`  ${p}`);

// ------------------------------------------------------------------ the clock, the modes, the map
const c = new City(7, MODE.HARDCORE);
check(c.minute === START_MINUTE && c.day === 1, `a city starts on day 1 at ${START_MINUTE}: ${c.day}, ${c.minute}`);
for (let k = 0; k < 20 * 60; k++) c.step(0);
check(c.minute === START_MINUTE + 60, `an hour of steps is an hour: ${c.minute}`);
for (let k = 0; k < 20 * 60 * 18; k++) c.step(0);
check(c.day === 2 && c.minute === START_MINUTE + 60 * 19 - 1440, `past midnight it's day 2: ${c.day}, ${c.minute}`);
check(loadCity(JSON.parse(JSON.stringify(c.snapshot())))?.state.mode === MODE.HARDCORE, 'the mode is kept by a save');
const seenAtStart = c.seen[c.state.district].reduce((n, v) => n + v, 0);
check(seenAtStart > 100 && seenAtStart < 200, `standing still, the tiles round the player are seen: ${seenAtStart}`);
check(
  c.seen.every((s, d) => d === c.state.district || s.every((v) => v === 0)),
  'a district not walked into is not seen',
);
say(
  `the clock: 20 steps a game minute from ${Math.floor(START_MINUTE / 60)}:${String(START_MINUTE % 60).padStart(2, '0')}; standing still, ${seenAtStart} tiles seen`,
);

// ------------------------------------------------------------------ damaged saves
const good = JSON.parse(JSON.stringify(c.snapshot()));
const broken: Array<[string, (s: typeof good) => void]> = [
  ['no state', (s) => delete s.state],
  ['a district that is not', (s) => (s.state.district = 9)],
  ['a place off the map', (s) => (s.state.player.x = MAP_W * 1024 + 5)],
  ['a place that is not a number', (s) => (s.state.player.z = 'here')],
  ['a later layout', (s) => (s.state.v = 2)],
  ['no map', (s) => delete s.seen],
  ['a negative step', (s) => (s.state.step = -4)],
];
for (const [what, harm] of broken) {
  const s = JSON.parse(JSON.stringify(good));
  harm(s);
  check(loadCity(s) === null, `a save with ${what} should be refused`);
}
check(loadCity(null) === null && loadCity('city') === null && loadCity({}) === null, 'nothing, text and an empty record are no saves');
// (A place in a wall, the map changed under an old save: back to where the district is come into.)
const moved = JSON.parse(JSON.stringify(good));
moved.state.player.x = 512;
moved.state.player.z = 512;
const back = loadCity(moved);
check(!!back && !back.grid[back.tile], 'a save standing in a wall is put where the district is come into');
check(MAP_H === 64, 'a district is 64 tiles');
say(`damaged saves refused: ${broken.map(([w]) => w).join(', ')}; one standing in a wall is put back on the street`);

console.log(lines.join('\n'));
