/**
 * City Escape's metro tunnel (2.56, city/gen/tunnel.ts): a tenth map. Its shape on many cities (one
 * way from the stairs to the ladder, three tiles wide, nothing across it, every room and thing in it
 * reached); how it is entered (the gates open, not before), what it is like down there (dark at any
 * hour, the lamp's light, the dead that stand along it), how it ends (the ladder, or a fall and the
 * generator to start again), and what a save keeps.
 */
import { check } from './assert';
import { DEAD } from '../src/city/content/dead';
import { LEVEL } from '../src/city/content/light';
import { FLAG, STORY, THINGS } from '../src/city/content/story';
import { DECO, decoSolid } from '../src/city/gen/district';
import { cityPlan } from '../src/city/gen/plan';
import { generateTunnel, PLACES, TUNNEL } from '../src/city/gen/tunnel';
import { City, COP, loadCity, MODE } from '../src/city/sim/City';
import { quota, ZED } from '../src/city/sim/dead';
import { quester } from './citybots';
import { cityItemNumber } from '../src/city/content/items';
import { lampLit, lightLevel, murky } from '../src/city/sim/light';
import { gatesOpen, going, objectives } from '../src/city/sim/story';
import { nearestDir } from '../src/sim/ai/path';
import { command } from '../src/sim/command';
import { fnv1a } from '../src/sim/rng';
import { bodyAt } from '../src/sim/systems/movement';
import { MAP_H, MAP_W, tileAt } from '../src/sim/world/grid';

const lines: string[] = [];
const say = (s: string) => lines.push(s);
const W = MAP_W;
const N = W * MAP_H;
const MIN = 20;

// ------------------------------------------------------------------ its shape, on many cities
{
  const CITIES = 60;
  let ways = 0;
  let shortest = Infinity;
  let longest = 0;
  let bare = 0;
  let things = 0;
  let turns = 0;
  for (let seed = 1; seed <= CITIES; seed++) {
    const t = generateTunnel(cityPlan(seed));
    const d = t.district;
    const again = generateTunnel(cityPlan(seed));
    check(d.rows.join() === again.district.rows.join() && again.end === t.end, `seed ${seed}: not the same tunnel twice`);
    check(d.index === TUNNEL && d.gates.length === 0 && d.lots.length === 1 && d.lots[0].doors.length === 0, `seed ${seed}: its record`);
    const floor = (i: number) => d.rows[Math.floor(i / W)][i % W] === '_';
    const solid = (i: number) => !floor(i) || decoSolid(d.deco[i]) || d.props.some((p) => p.z * W + p.x === i);
    // The border is rock; the way is on floor, each tile beside the last, from the west side to the east.
    for (let i = 0; i < N; i++) {
      const x = i % W;
      const z = Math.floor(i / W);
      if ((x === 0 || z === 0 || x === W - 1 || z === MAP_H - 1) && floor(i))
        check(false, `seed ${seed}: open at the map's edge (${x}, ${z})`);
      if (!floor(i) && d.rows[z][x] !== '#') check(false, `seed ${seed}: a strange tile '${d.rows[z][x]}'`);
    }
    check(t.way[0] === t.start && t.way[t.way.length - 1] === t.end, `seed ${seed}: the way's ends`);
    check(t.start % W === 8 && t.end % W === W - 9, `seed ${seed}: from ${t.start % W} to ${t.end % W}`);
    t.way.forEach((i, k) => {
      if (solid(i)) check(false, `seed ${seed}: something on the middle of the way at ${i}`);
      if (k && Math.abs((i % W) - (t.way[k - 1] % W)) + Math.abs(Math.floor(i / W) - Math.floor(t.way[k - 1] / W)) !== 1)
        check(false, `seed ${seed}: the way jumps at ${k}`);
      if (k > 1 && i - t.way[k - 1] !== t.way[k - 1] - t.way[k - 2]) turns++;
      // (Three tiles wide: open either side of the middle, across the way it runs.)
      const nx = t.way[k + 1] ?? i + (i - t.way[k - 1]);
      const across = Math.abs(nx - i) === 1 ? W : 1;
      if (!floor(i - across) || !floor(i + across)) check(false, `seed ${seed}: narrower than three at ${i}`);
    });
    // Everything open is walked to from the stairs, round what stands in it; every crate and bin has a tile beside it that is.
    const seen = new Uint8Array(N);
    const queue = [t.start];
    seen[t.start] = 1;
    while (queue.length) {
      const i = queue.pop()!;
      for (const j of [i - W, i + 1, i + W, i - 1])
        if (!seen[j] && !solid(j)) {
          seen[j] = 1;
          queue.push(j);
        }
    }
    for (let i = 0; i < N; i++) if (floor(i) && !solid(i) && !seen[i]) check(false, `seed ${seed}: floor at ${i} can't be walked to`);
    check(seen[t.end] === 1, `seed ${seed}: the ladder can't be walked to`);
    for (const p of d.props) {
      const i = p.z * W + p.x;
      check(floor(i), `seed ${seed}: a ${p.kind} in the rock`);
      check(
        [i - W, i + 1, i + W, i - 1].some((j) => seen[j]),
        `seed ${seed}: the ${p.kind} at ${i} can't be stood beside`,
      );
      things++;
    }
    for (let i = 0; i < N; i++) {
      if (!d.deco[i]) continue;
      check(floor(i) && d.deco[i] !== DECO.PART, `seed ${seed}: something standing in the rock at ${i}`);
    }
    if (!d.props.length) bare++;
    // Two abreast can be walked all the way: on every tile of the way two of its three across are clear, and between one tile and the next the same two.
    t.way.forEach((i, k) => {
      const nx = t.way[k + 1];
      if (nx === undefined || nx - i !== i - (t.way[k - 1] ?? i - (nx - i))) return;
      const across = Math.abs(nx - i) === 1 ? W : 1;
      const open = [-across, across].filter((o) => !solid(i + o) && !solid(nx + o)).length;
      if (open < 1) check(false, `seed ${seed}: only the middle is open between ${i} and ${nx}`);
    });
    ways += t.way.length;
    shortest = Math.min(shortest, t.way.length);
    longest = Math.max(longest, t.way.length);
  }
  say(
    `${CITIES} tunnels: one way from the stairs in the west to the ladder in the east, three tiles wide all along, nothing on its middle, every open tile and every crate or bin walked to; ${Math.round(ways / CITIES)} tiles long on average (${shortest} to ${longest}), ${(turns / CITIES).toFixed(1)} turns, ${(things / CITIES).toFixed(1)} rooms with something to search (${bare} tunnels with none); two abreast can walk it all the way`,
  );
}

// ------------------------------------------------------------------ down, through, out
/** A city with the metro chosen and its three things held, the player at the stairs. */
function atStairs(seed: number, mode: number = MODE.SURVIVOR): City {
  const c = new City(seed, mode);
  c.peace = true;
  c.step(0);
  const s = c.state;
  // (The fourth day: the hold's minutes are behind them when the tests set the gates open.)
  s.step += 3 * 1440 * MIN;
  Object.assign(s, { kit: (1 << THINGS.length) - 1, flags: FLAG.ATE | FLAG.SLEPT | FLAG.FIXED | FLAG.KEY, scouted: 7, way: 3, act: 4 });
  const d = c.story.wayDistrict[2];
  if (d !== s.district) (c as unknown as { enter(d: number): void }).enter(d);
  const exit = c.story.exits[2];
  s.player = bodyAt(exit % W, Math.floor(exit / W));
  c.step(0);
  return c;
}
const press = (c: City) => {
  c.step(command(0, COP.ACT));
  return [...c.events];
};
const walkTo = (c: City, t: number, most = 60) => {
  for (let k = 0; k < most && c.tile !== t && !c.state.over; k++)
    c.step(command(nearestDir((t % W) - (c.tile % W), Math.floor(t / W) - Math.floor(c.tile / W))));
};
{
  const c = atStairs(2);
  const s = c.state;
  press(c);
  check(s.ready === 1 && going(c) === 1, 'the generator started');
  // Before the gates open the button does nothing; after, it takes the stairs.
  press(c);
  check(s.district !== TUNNEL && !gatesOpen(c), 'the gates shut: nobody goes down');
  s.readyAt = s.step - STORY.metroHold * MIN;
  const ev = press(c);
  // (2.65: a step in from the stairs' foot, whose tile is the way back up.)
  check(s.district === TUNNEL && c.tile === c.tunnel.way[1], `down the stairs: in ${s.district} at ${c.tile}`);
  check(
    ev.some((e) => e.type === 'travel' && e.to === TUNNEL && e.first),
    'said as a crossing is',
  );
  check(s.ready === 1 && !s.over && going(c) === 0, 'the way out still going, the generator left behind');
  check(
    ((s.visited >> TUNNEL) & 1) === 1 && c.district.index === TUNNEL && c.district.gates.length === 0,
    'in the tunnel, and no checkpoint out of it',
  );
  // Dark at any hour; the lamp is the light; nothing to press.
  for (const hour of [3, 12, 22]) {
    s.step += ((hour * 60 - c.minute + 1440) % 1440) * MIN;
    c.step(0);
    check(murky(c, c.tile) && lampLit(c) && lightLevel(c) === LEVEL.DIM, `at ${hour}:00 down there: dark, by the lamp (${lightLevel(c)})`);
  }
  check(
    c.dim.every((v, i) => v === (c.district.rows[Math.floor(i / W)][i % W] === '_' ? 1 : 0)),
    'every open tile of it is out of the daylight',
  );
  check(c.target() === null, 'nothing for the button a step in from the stairs');
  check(
    objectives(c).length === 1 && objectives(c)[0].id === 'through3' && objectives(c)[0].at?.tile === c.tunnel.end,
    'the journal points to the ladder',
  );
  // The dead: as many as it says, standing in it, none near the stairs; they see the lamp's holder at the day's reach.
  c.peace = false;
  s.arrive = 1;
  c.step(0);
  const q = quota(c);
  check(q.indoors === STORY.tunnelDead && q.streets === 0, `its dead: ${JSON.stringify(q)}`);
  check(s.zeds.length >= STORY.tunnelDead - 1 && s.zeds.length <= STORY.tunnelDead, `${s.zeds.length} of the dead put down`);
  // No hour turns down there: no dusk, no nightfall, no dawn, and they stand on through it.
  {
    const n = new City(2);
    n.step(0);
    (n as unknown as { enter(d: number): void }).enter(TUNNEL);
    n.state.player = bodyAt(n.tunnel.start % W, Math.floor(n.tunnel.start / W));
    n.state.step += ((18 * 60 + 50 - n.minute + 1440) % 1440) * MIN;
    const hours: string[] = [];
    for (let k = 0; k < 12 * 60 * MIN; k++) {
      n.state.health = 100;
      n.state.hunger = n.state.energy = 90_000;
      n.step(0);
      for (const e of n.events) if (e.type === 'dusk' || e.type === 'night') hours.push(e.type);
    }
    check(hours.length === 0, `from 18:50 to 06:50 in the tunnel: ${hours}`);
    check(n.state.zeds.length > 0 && n.state.zeds.every((z) => z.mode !== ZED.WANDER), 'those standing in it stand on through the night');
  }
  const nearest = Math.min(
    ...s.zeds.map((z) =>
      Math.max(
        Math.abs((tileAt(z.body.x, z.body.z) % W) - (c.tile % W)),
        Math.abs(Math.floor(tileAt(z.body.x, z.body.z) / W) - Math.floor(c.tile / W)),
      ),
    ),
  );
  check(
    nearest >= DEAD.clear &&
      s.zeds.every((z) => z.mode === ZED.IDLE && c.district.rows[Math.floor(z.body.z / 1024)][Math.floor(z.body.x / 1024)] === '_'),
    `none within ${DEAD.clear} tiles of the stairs (${nearest}), all standing on its floor`,
  );
  const put = s.zeds.length;
  // (One five tiles along the way: it sees the lamp.)
  s.zeds = [];
  const five = c.tunnel.way[5];
  s.zeds.push({
    body: bodyAt(five % W, Math.floor(five / W)),
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
  });
  for (let k = 0; k < 12; k++) c.step(0);
  check(s.zeds[0].mode === ZED.CHASE, `one five tiles off sees the lamp's holder (${DEAD.sightDay} tiles): ${s.zeds[0].mode}`);
  // Walked to its end: out.
  s.zeds = [];
  c.peace = true;
  s.health = 100;
  let steps = 0;
  for (const t of c.tunnel.way) {
    const before = s.step;
    walkTo(c, t);
    steps += s.step - before;
  }
  check(s.over === 2 && s.won === 3, `the ladder reached: over ${s.over}`);
  check(
    c.events.some((e) => e.type === 'escaped' && e.way === 3),
    'said as an escape by the metro',
  );
  say(
    `down: only once the gates are open; in the tunnel it is dark at any hour and no hour turns (no dusk, no night, no dawn), the ranger's lamp its light (seen at ${DEAD.sightDay} tiles); ${put} of the dead stand along it, none within ${DEAD.clear} tiles of the stairs; ${c.tunnel.way.length} tiles walked in ${steps} steps to the ladder, and out`,
  );
}

// ------------------------------------------------------------------ a fall, Hardcore, saves
{
  // A Survivor who falls down there wakes at home: the generator is to start again, the things are kept.
  const c = atStairs(3);
  const s = c.state;
  press(c);
  s.readyAt = s.step - STORY.metroHold * MIN;
  press(c);
  walkTo(c, c.tunnel.way[6]);
  const fellAt = c.tile;
  s.inv[0] = [1, 2];
  c.hurt(1000, 'z0');
  c.step(0);
  check(
    s.deaths === 1 && s.district === s.home[0] && s.district !== TUNNEL && s.ready === 0 && !s.over,
    `fallen in the tunnel: in ${s.district}, ready ${s.ready}`,
  );
  check(s.kit === (1 << THINGS.length) - 1 && s.way === 3, 'the things and the choice kept');
  check(
    s.boxes[`${TUNNEL}:g${fellAt}`] === undefined &&
      // (2.57: beside the stairs, never on their tile, where the button is the generator's.)
      s.boxes[`${c.story.wayDistrict[2]}:g${c.story.exits[2]}`] === undefined &&
      [W, -W, 1, -1].some((o) =>
        (s.boxes[`${c.story.wayDistrict[2]}:g${c.story.exits[2] + o}`] ?? []).some((st) => st[0] === 1 && st[1] === 2),
      ),
    'what they carried lies beside the top of the metro’s stairs, not in the tunnel',
  );
  // Hardcore: the city is lost.
  const h = atStairs(3, MODE.HARDCORE);
  press(h);
  h.state.readyAt = h.state.step - STORY.metroHold * MIN;
  press(h);
  h.hurt(1000, 'z0');
  check(h.state.over === 1, 'Hardcore: fallen in the tunnel, the city is lost');
  // A save made down there loads down there and plays on the same; one from before the tunnel loads.
  const live = atStairs(4);
  press(live);
  live.state.readyAt = live.state.step - STORY.metroHold * MIN;
  press(live);
  // (The dead put down and about: the save carries them, their ways and the draws.)
  live.peace = false;
  live.state.arrive = 1;
  live.step(0);
  check(live.state.zeds.length >= STORY.tunnelDead - 1, `the dead about before the save: ${live.state.zeds.length}`);
  walkTo(live, live.tunnel.way[4]);
  const snap = JSON.parse(JSON.stringify(live.snapshot()));
  check(
    snap.seen.length === PLACES && snap.state.district === TUNNEL,
    `a save in the tunnel: ${snap.seen.length} maps seen, in ${snap.state.district}`,
  );
  const loaded = loadCity(JSON.parse(JSON.stringify(snap)))!;
  check(
    !!loaded && loaded.state.district === TUNNEL && loaded.tile === live.tile && loaded.district.index === TUNNEL,
    'loaded in the tunnel',
  );
  check(
    loaded.seen[TUNNEL].some((v) => v === 1) && loaded.dim.every((v, i) => v === live.dim[i]),
    'what was seen of it is kept, and its dark is the same',
  );
  let differ = -1;
  const way = live.tunnel.way;
  for (let k = 0; k < 300 && differ < 0 && !live.state.over; k++) {
    if (k % 20 === 0 && fnv1a(JSON.stringify(live.snapshot().state)) !== fnv1a(JSON.stringify(loaded.snapshot().state))) differ = k;
    const t = way[Math.min(way.length - 1, 5 + Math.floor(k / 12))];
    const cmd = command(nearestDir((t % W) - (live.tile % W), Math.floor(t / W) - Math.floor(live.tile / W)), k % 15 === 0 ? COP.HIT : 0);
    live.step(cmd);
    loaded.step(cmd);
  }
  check(
    differ < 0 && fnv1a(JSON.stringify(live.snapshot().state)) === fnv1a(JSON.stringify(loaded.snapshot().state)),
    `a save made in the tunnel plays on as the live city does (differs at ${differ})`,
  );
  const old = JSON.parse(JSON.stringify(atStairs(4).snapshot()));
  old.seen.length = 9;
  const fromOld = loadCity(old);
  check(
    !!fromOld && fromOld.seen.length === PLACES && fromOld.seen[TUNNEL].every((v) => v === 0),
    'a save from before the tunnel: nine maps seen, loaded with the tenth unseen',
  );
  const bad = JSON.parse(JSON.stringify(snap));
  bad.state.district = PLACES;
  check(loadCity(bad) === null, 'a save in a place that is not is refused');
  const homeless = JSON.parse(JSON.stringify(snap));
  homeless.state.home = [TUNNEL, 5];
  check(loadCity(homeless) === null, 'nobody lives in the tunnel: such a save is refused');
  // In the tunnel with no business there (another way out, the generator not running, a story that isn't sound): back up at the stairs.
  let up = 0;
  const wrong: Array<(st: Record<string, unknown>) => void> = [
    (st) => (st.way = 1),
    (st) => (st.way = 2),
    (st) => (st.ready = 0),
    (st) => (st.act = 99),
  ];
  for (const spoil of wrong) {
    const sp = JSON.parse(JSON.stringify(snap));
    spoil(sp.state);
    const got = loadCity(sp);
    if (got && got.state.district === got.story.wayDistrict[2] && got.tile === got.story.exits[2] && !got.state.over) up++;
  }
  check(up === wrong.length, `${up} of ${wrong.length} saves with no business in the tunnel loaded at the metro's stairs`);
  // With the dead about: a bot with a bat and three bandages, put at the foot of the stairs, on twelve cities.
  let out = 0;
  let fell = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const b = atStairs(seed);
    press(b);
    b.state.readyAt = b.state.step - STORY.metroHold * MIN;
    press(b);
    b.state.inv[0] = [cityItemNumber('bat'), 40];
    b.state.inv[1] = [cityItemNumber('bandage'), 3];
    b.state.hunger = b.state.energy = 90_000;
    b.peace = false;
    b.state.arrive = 1;
    const bot = quester(b, 3);
    for (let k = 0; k < 180 * MIN && !b.state.over && !b.state.deaths; k++) b.step(bot());
    if (b.state.over === 2) out++;
    else if (b.state.deaths) fell++;
  }
  check(out >= 10, `with a bat and three bandages: ${out} of 12 out of the tunnel, ${fell} fell`);
  say(
    'a Survivor fallen in the tunnel wakes at home, the generator to start again, their things lying at the top of the stairs; in Hardcore the city is lost; a save made down there loads there and plays on the same; one from before the tunnel loads; a home in the tunnel is refused, and a save with no business down there loads at the stairs; with a bat and three bandages a bot gets through on ' +
      out +
      ' of 12 cities',
  );
}
console.log(lines.join('\n'));
