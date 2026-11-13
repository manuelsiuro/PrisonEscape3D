/**
 * City Escape's generator (C1, city/gen/): over many seeds, a city's plan (one district of each kind,
 * downtown in the middle, the start in a corner with no way out beside it, every district joined to
 * the rest, the sea on the docks' outer side) and each of its districts (a legal 64 × 64 map the World
 * takes, streets meeting the neighbour's at the border, every gate, door and open tile walked to from
 * where the player comes in, every building with a street door, its landmark standing), and the same
 * seed giving the same city.
 */
import { check } from './assert';
import { ESCAPE_KINDS, KINDS, DISTRICTS, isBuilding } from '../src/city/content/districts';
import { DECO, decoSolid, generateDistrict, reachFrom, type District } from '../src/city/gen/district';
import { CITY_N, cityPlan, gateOpen, LANES, laneAt, neighbour, OPPOSITE, SIDE } from '../src/city/gen/plan';
import { districtWorld } from '../src/city/sim/world';
import { fnv1a } from '../src/sim/rng';
import { MAP_H, MAP_W } from '../src/sim/world/grid';

const SEEDS = 60;
const N = MAP_W * MAP_H;
const lines: string[] = [];
const say = (s: string) => lines.push(s);
const text = (d: District) => d.rows.join('\n') + '|' + Array.from(d.deco).join('') + '|' + JSON.stringify(d.props);

let buildings = 0;
let doors = 0;
let props = 0;
let wrecks = 0;
let open = 0;
let gates = 0;
let sealed = 0;
const starts = new Set<number>();
const hashes: string[] = [];

for (let seed = 1; seed <= SEEDS; seed++) {
  const plan = cityPlan(seed);
  const at = `seed ${seed}`;
  // ---------------------------------------------------------------- the plan
  check([...plan.kinds].sort().join() === [...KINDS].sort().join(), `${at}: one district of each kind, got ${plan.kinds.join(' ')}`);
  check(plan.kinds[4] === 'downtown', `${at}: downtown should be in the middle`);
  check([0, 2, 6, 8].includes(plan.start) && plan.kinds[plan.start] === 'suburbs', `${at}: the start should be the suburbs, in a corner`);
  starts.add(plan.start);
  for (let s = 0; s < 4; s++) {
    const n = neighbour(plan.start, s);
    if (n >= 0) check(!ESCAPE_KINDS.includes(plan.kinds[n]), `${at}: a way out (${plan.kinds[n]}) beside the start`);
  }
  const docks = plan.kinds.indexOf('docks');
  check(neighbour(docks, plan.sea) < 0, `${at}: the docks' sea should be on the city's edge`);
  for (const lanes of [...plan.lanesX, ...plan.lanesZ])
    check(
      lanes.every((l, k) => l >= 8 && l <= 53 && (k === 0 || l - lanes[k - 1] >= 12)),
      `${at}: lanes ${lanes} too close to each other or to the border`,
    );
  // Every district joined to the rest; a border open one way is open the other.
  const reached = new Set([plan.start]);
  const queue = [plan.start];
  for (let q = 0; q < queue.length; q++)
    for (let s = 0; s < 4; s++) {
      const n = neighbour(queue[q], s);
      const mask = plan.gates[queue[q]][s];
      if (n < 0) {
        check(mask === 0, `${at}: a gate through the city's wall (district ${queue[q]}, side ${s})`);
        continue;
      }
      check(mask === plan.gates[n][OPPOSITE[s]], `${at}: the border ${queue[q]}–${n} isn't the same from both sides`);
      if (mask) gates++;
      else sealed++;
      if (mask && !reached.has(n)) {
        reached.add(n);
        queue.push(n);
      }
    }
  check(reached.size === CITY_N, `${at}: only ${reached.size} of ${CITY_N} districts can be walked to`);

  // ---------------------------------------------------------------- its districts
  const made: District[] = [];
  for (let d = 0; d < CITY_N; d++) {
    const dist = generateDistrict(plan, d);
    made.push(dist);
    const here = `${at} district ${d} (${dist.kind})`;
    check(text(dist) === text(generateDistrict(plan, d)), `${here}: generated twice, two districts`);
    // (The World takes it: every row 64 wide, every character the prisons' legend's.)
    const world = districtWorld(plan, d, dist);
    const spawn = dist.spawn.z * MAP_W + dist.spawn.x;
    check(!world.block[spawn], `${here}: the player comes in somewhere they can't stand`);
    const seen = reachFrom(spawn, (i) => !world.block[i]);
    let shut = 0;
    for (let i = 0; i < N; i++) if (!world.block[i] && !seen[i]) shut++;
    check(shut === 0, `${here}: ${shut} open tiles can't be walked to`);
    open += seen.reduce((n, v) => n + v, 0);
    // The gates: where the plan has them, on the border, open, walked to; the street the neighbour's own.
    let planned = 0;
    for (let s = 0; s < 4; s++) for (let k = 0; k < LANES; k++) if (gateOpen(plan, d, s, k)) planned++;
    check(dist.gates.length === planned, `${here}: ${dist.gates.length} gates, the plan has ${planned}`);
    for (const g of dist.gates) {
      const first = laneAt(plan, d, g.side, g.lane);
      const want =
        g.side === SIDE.N
          ? first
          : g.side === SIDE.S
            ? (MAP_H - 1) * MAP_W + first
            : g.side === SIDE.W
              ? first * MAP_W
              : first * MAP_W + MAP_W - 1;
      check(g.tiles[0] === want && g.to === neighbour(d, g.side), `${here}: a gate off its lane (side ${g.side}, lane ${g.lane})`);
      for (const tile of g.tiles)
        check(
          seen[tile] === 1 && dist.rows[Math.floor(tile / MAP_W)][tile % MAP_W] === ',',
          `${here}: a gate's tile ${tile} isn't open street`,
        );
    }
    // The border: wall on the city's edge (the sea on the docks'), fence between districts, but for the gates.
    for (let k = 0; k < MAP_W; k++)
      for (const i of [k, (MAP_H - 1) * MAP_W + k, k * MAP_W, k * MAP_W + MAP_W - 1]) {
        const c = dist.rows[Math.floor(i / MAP_W)][i % MAP_W];
        const gate = dist.gates.some((g) => g.tiles.includes(i));
        if (!gate) check(c === '@' || c === '=' || c === '~', `${here}: the border is open at ${i} ('${c}')`);
      }
    // Its lots: the landmark standing, every building with a street door and a floor.
    check(
      dist.lots.some((l) => l.use === DISTRICTS[dist.kind].landmark),
      `${here}: no ${DISTRICTS[dist.kind].landmark}`,
    );
    for (const l of dist.lots) {
      if (!isBuilding(l.use)) continue;
      buildings++;
      doors += l.doors.length;
      check(l.doors.length > 0, `${here}: a ${l.use} at ${l.x0},${l.z0} has no street door`);
      for (const door of l.doors) check(seen[door] === 1, `${here}: a ${l.use}'s door at ${door} can't be walked to`);
    }
    props += dist.props.length;
    for (const p of dist.props) {
      const c = dist.rows[p.z][p.x];
      check(c === 'w' || c === ':' || c === '_', `${here}: a ${p.kind} at ${p.x},${p.z} isn't on a floor ('${c}')`);
    }
    for (let i = 0; i < N; i++) if (dist.deco[i] === DECO.CAR || dist.deco[i] === DECO.WRECK) wrecks++;
    for (let i = 0; i < N; i++)
      if (decoSolid(dist.deco[i])) check(world.block[i] === 1, `${here}: something stands at ${i} and can be walked through`);
    check(d !== plan.start || dist.deco.includes(DECO.BUS), `${here}: the bus isn't where the player starts`);
  }
  if (seed <= 6) hashes.push(`${seed}: ${plan.kinds.join(' ')} · start ${plan.start} · ${fnv1a(made.map(text).join('#'))}`);
}

say(`${SEEDS} cities, ${SEEDS * CITY_N} districts: every one a legal map, every open tile, gate and street door walked to`);
say(`starts: corners ${[...starts].sort((a, b) => a - b).join(' ')}`);
say(`borders between districts: ${gates / 2} open, ${sealed / 2} sealed (of ${SEEDS * 12})`);
say(
  `a district, on average: ${(buildings / (SEEDS * CITY_N)).toFixed(1)} buildings, ${(doors / (SEEDS * CITY_N)).toFixed(1)} street doors, ${(props / (SEEDS * CITY_N)).toFixed(0)} pieces of furniture, ${(wrecks / (SEEDS * CITY_N)).toFixed(1)} cars, ${Math.round(open / (SEEDS * CITY_N))} open tiles`,
);
say('the first cities (their districts, the start, a fingerprint of all nine maps):');
for (const h of hashes) say(`  ${h}`);

console.log(lines.join('\n'));
