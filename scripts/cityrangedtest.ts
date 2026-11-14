/**
 * City Escape's weapons thrown or shot (2.55, city/sim/ranged.ts): an empty bottle thrown (where it
 * lands, who goes to look), a molotov (its fire's tiles, how long, what it does to the dead that stand
 * in it and walk through it, and to the thrower), the crossbow (who it shoots and who is struck
 * instead, a bolt's harm, its quiet, the bolts found again, its wear), what's refused, the three
 * recipes, and what a save keeps.
 */
import { check } from './assert';
import { BLOW, BRUTE, DEAD, ZKIND } from '../src/city/content/dead';
import { cityItem, cityItemNumber } from '../src/city/content/items';
import { RANGED } from '../src/city/content/ranged';
import { CITY_RECIPES } from '../src/city/content/recipes';
import { City, COP, loadCity, type CityEvent, type Stack } from '../src/city/sim/City';
import { ZED, type Zed } from '../src/city/sim/dead';
import { burning } from '../src/city/sim/ranged';
import { nearestDir } from '../src/sim/ai/path';
import { command } from '../src/sim/command';
import { fnv1a } from '../src/sim/rng';
import { bodyAt } from '../src/sim/systems/movement';
import { MAP_W, tileAt } from '../src/sim/world/grid';

const lines: string[] = [];
const say = (s: string) => lines.push(s);
const W = MAP_W;
const N = (id: string) => cityItemNumber(id);
const EAST = nearestDir(1, 0);
const give = (c: City, list: Array<[string, number]>) => {
  for (const st of c.state.inv) st[0] = st[1] = 0;
  list.forEach(([id, n], k) => (c.state.inv[k] = [N(id), n] as Stack));
};
const slot = (c: City, id: string) => c.state.inv.findIndex((st) => st[0] === N(id));
const count = (c: City, id: string) => c.state.inv.reduce((n, st) => n + (st[0] === N(id) ? st[1] : 0), 0);
const use = (c: City, id: string): CityEvent[] => {
  c.step(command(0, COP.USE, slot(c, id)));
  return [...c.events];
};
const hit = (c: City): CityEvent[] => {
  c.step(command(0, COP.HIT));
  return [...c.events];
};
const stand = (c: City, tile: number, facing = EAST) => {
  c.state.player = bodyAt(tile % W, Math.floor(tile / W), facing);
  c.step(0);
};
const far = (a: number, b: number) => Math.max(Math.abs((a % W) - (b % W)), Math.abs(Math.floor(a / W) - Math.floor(b / W)));
const zed = (c: City, tile: number, mode: number = ZED.IDLE, kind = 0): Zed => {
  const z: Zed = {
    body: bodyAt(tile % W, Math.floor(tile / W)),
    hp: kind === ZKIND.BRUTE ? BRUTE.health : DEAD.health,
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
/** A straight run of street: `n` open tiles in a row along x with open street above and below, nothing on them. */
const run = (c: City, n: number) =>
  c.zedPlaces.streets.find(
    (i) =>
      (i % W) + n < W &&
      Array.from({ length: n }, (_, k) => i + k).every((t) => !c.grid[t] && c.zedStreet[t] && !c.grid[t - W] && !c.grid[t + W]),
  )!;
/** A city at noon with nobody about, the player at the west end of a long clear street, facing along it. */
function street(seed = 3, n = 14): [City, number] {
  const c = new City(seed);
  c.peace = true;
  c.step(0);
  c.state.step += ((12 * 60 - c.minute + 1440) % 1440) * 20;
  c.state.zeds = [];
  const at = run(c, n);
  stand(c, at);
  return [c, at];
}

// ------------------------------------------------------------------ a bottle thrown
{
  const [c, at] = street();
  give(c, [['bottle', 2]]);
  // Nobody ahead: as far as it goes, the way faced.
  const near = zed(c, at + RANGED.throwReach + 3 - W, ZED.WANDER);
  const beyond = zed(c, at + RANGED.throwReach + RANGED.bottleNoise + 2, ZED.WANDER);
  const busy = zed(c, at + RANGED.throwReach + 2 + W, ZED.CHASE);
  const ev = use(c, 'bottle');
  const thrown = ev.find((e) => e.type === 'thrown');
  check(
    thrown?.type === 'thrown' && thrown.to === at + RANGED.throwReach && thrown.from === at,
    `thrown to ${JSON.stringify(thrown)} from ${at}`,
  );
  check(count(c, 'bottle') === 1, 'one bottle less');
  check(near.mode === ZED.SEEK && near.goal === at + RANGED.throwReach, `one near where it breaks goes to look: ${near.mode} ${near.goal}`);
  check(busy.mode === ZED.CHASE, 'one after somebody keeps after them');
  check(beyond.mode !== ZED.SEEK, 'one out of hearing does not');
  check(c.state.fires.length === 0, 'a bottle lights nothing');
  // One of the dead ahead: it lands on them.
  c.state.zeds = [];
  const target = zed(c, at + 4);
  const ev2 = use(c, 'bottle');
  check(
    ev2.some((e) => e.type === 'thrown' && e.to === at + 4) && target.hp === DEAD.health,
    'thrown at the one ahead: it lands there and harms nobody',
  );
  // A wall in the face: refused, nothing thrown.
  const wall = Array.from({ length: W * W }, (_, i) => i).find(
    (i) => !c.grid[i] && i % W < W - 1 && c.district.rows[Math.floor(i / W)][(i % W) + 1] === '#',
  )!;
  c.state.zeds = [];
  give(c, [['bottle', 1]]);
  stand(c, wall);
  const ev3 = use(c, 'bottle');
  check(
    ev3.some((e) => e.type === 'refused' && e.why === 'noRoom') && count(c, 'bottle') === 1,
    `a wall in the way: ${JSON.stringify(ev3)}`,
  );
  say(
    `a bottle: thrown ${RANGED.throwReach} tiles the way faced, or onto the nearest of the dead ahead; heard ${RANGED.bottleNoise} tiles round where it breaks by those not after anyone; a wall in the face: refused, the bottle kept`,
  );
}

// ------------------------------------------------------------------ a molotov
{
  const [c, at] = street();
  give(c, [['molotov', 2]]);
  const to = at + RANGED.throwReach;
  const ev = use(c, 'molotov');
  check(
    ev.some((e) => e.type === 'thrown' && e.to === to),
    'thrown as a bottle is',
  );
  const tiles = c.state.fires.map((f) => f[0]).sort((a, b) => a - b);
  check(tiles.length === 9 && tiles.every((t) => far(t, to) <= 1 && !c.grid[t]), `nine open tiles burn round it: ${tiles}`);
  check(burning(c, to) && !burning(c, to + 2), 'burning there, not two tiles on');
  // One standing in it; a brute; one walking through; one outside.
  const inIt = zed(c, to);
  const brute = zed(c, to + 1, ZED.IDLE, ZKIND.BRUTE);
  const out = zed(c, to + 3);
  let steps = 0;
  let fell = -1;
  let scorched = 0;
  c.peace = true;
  while (c.state.fires.length && steps < 1000) {
    c.step(0);
    steps++;
    for (const e of c.events) if (e.type === 'scorched') scorched += e.dead;
    if (fell < 0 && !c.state.zeds.includes(inIt)) fell = steps;
  }
  const out2 = c.events.filter((e) => e.type === 'fireOut').length;
  check(steps === RANGED.fireSteps && out2 === 1, `it burnt ${steps} steps, said out ${out2} time`);
  const need = Math.ceil(DEAD.health / RANGED.burnDead) * RANGED.burnEvery;
  check(fell > 0 && fell <= need, `one standing in it is put down in ${fell} steps (${need} at the most)`);
  // (A brute standing in it the whole time falls too: three times as long.)
  check(
    !c.state.zeds.includes(brute) && scorched === 2 && c.state.kills === 2,
    `a brute standing in it falls too: ${scorched} put down, ${c.state.kills} counted`,
  );
  check(out.hp === DEAD.health, 'one outside it is unharmed');
  // The thrower in their own fire is burnt; out of it, not.
  const [p, pat] = street();
  give(p, [['molotov', 1]]);
  use(p, 'molotov');
  const before = p.state.health;
  for (let k = 0; k < 2 * RANGED.burnEvery; k++) p.step(0);
  check(p.state.health === before, 'the thrower, six tiles off, is not burnt');
  stand(p, pat + RANGED.throwReach);
  let burns = 0;
  for (let k = 0; k < 3 * RANGED.burnEvery; k++) {
    p.step(0);
    burns += p.events.filter((e) => e.type === 'burn').length;
  }
  check(
    burns >= 2 && p.state.health === before - burns * RANGED.burnPlayer,
    `standing in it: burnt ${burns} times, ${p.state.health} health`,
  );
  // One of the dead after the player walks through it and is burnt on the way.
  const [w, wat] = street(3, 14);
  give(w, [['molotov', 1]]);
  const chaser = zed(w, wat + 11, ZED.CHASE);
  chaser.seen = w.state.step;
  chaser.last = wat;
  w.state.inv[0] = [N('molotov'), 1];
  // (Thrown short of it: at the tile six ahead, the chaser five beyond.)
  w.state.zeds = [];
  use(w, 'molotov');
  w.state.zeds = [chaser];
  w.peace = false;
  let hp = chaser.hp;
  for (let k = 0; k < 200 && w.state.zeds.includes(chaser) && far(tileAt(chaser.body.x, chaser.body.z), wat) > 1; k++) {
    w.state.health = 100;
    chaser.seen = w.state.step;
    w.step(0);
    hp = chaser.hp;
  }
  check(hp < DEAD.health, `one coming through the fire is burnt on its way: ${hp} of ${DEAD.health} left`);
  // A second molotov on the same place burns no more tiles, only longer; no more than the most at once.
  const [m, mat] = street();
  give(m, [['molotov', 3]]);
  use(m, 'molotov');
  const first = m.state.fires[0][1];
  for (let k = 0; k < 40; k++) m.step(0);
  use(m, 'molotov');
  check(
    m.state.fires.length === 9 && m.state.fires.every((f) => f[1] === first + 41),
    `a second on the same place: the same tiles, burning from now: ${m.state.fires.map((f) => f[1] - first)}`,
  );
  for (let k = 0; k < 8; k++) {
    stand(m, mat + k, k % 2 ? EAST : nearestDir(0, 1));
    m.state.inv[0] = [N('molotov'), 1];
    use(m, 'molotov');
  }
  check(m.state.fires.length <= RANGED.fireMost, `${m.state.fires.length} tiles burning at the most`);
  // Leaving the district, or falling: nothing burns on.
  (m as unknown as { enter(d: number): void }).enter(m.district.gates[0].to);
  check(m.state.fires.length === 0, 'through a checkpoint: no fire');
  // A barred door stops it: it breaks before the boards, and what burns is on the thrower's side.
  const [d, dat] = street();
  give(d, [['molotov', 1]]);
  d.state.bars[d.state.district] = [dat + 3];
  d.rebar();
  const behind = zed(d, dat + 4);
  const evd = use(d, 'molotov');
  const landed = evd.find((e) => e.type === 'thrown');
  check(
    landed?.type === 'thrown' && landed.to === dat + 2,
    `thrown at boards three tiles ahead, it lands at ${landed?.type === 'thrown' ? landed.to - dat : '?'}`,
  );
  // (Boards put across an open street for the check: the tiles beside them burn, as a wall's wouldn't.)
  check(
    d.state.fires.every((f) => f[0] !== dat + 3 && f[0] % W <= (dat + 3) % W),
    'nothing burns on the boards or beyond them',
  );
  for (let k = 0; k < 60; k++) d.step(0);
  check(behind.hp === DEAD.health, 'one behind the boards is unharmed');
  // Asleep in it: it burns on, wakes them, and goes out in its time.
  const [a, aat] = street();
  give(a, [['molotov', 1]]);
  use(a, 'molotov');
  stand(a, aat + RANGED.throwReach);
  a.state.health = 100;
  a.state.sleeping = true;
  let woke = false;
  for (let k = 0; k < RANGED.burnEvery + 1; k++) {
    a.step(0);
    if (a.events.some((e) => e.type === 'burn')) woke = true;
  }
  check(
    woke && !a.state.sleeping && a.state.health < 100,
    `asleep in a fire: burnt and woken (${a.state.health} health, asleep ${a.state.sleeping})`,
  );
  const [z2, zat] = street();
  give(z2, [['molotov', 1]]);
  use(z2, 'molotov');
  const stood = zed(z2, zat + RANGED.throwReach);
  z2.state.sleeping = true;
  for (let k = 0; k < RANGED.fireSteps + 5; k++) z2.step(0);
  check(!z2.state.zeds.includes(stood) && z2.state.fires.length === 0, 'while the player sleeps the fire burns the dead and goes out');
  // A Survivor burnt down by their own fire falls; nothing burns on behind them.
  const [f, fat] = street();
  give(f, [['molotov', 1]]);
  use(f, 'molotov');
  stand(f, fat + RANGED.throwReach);
  f.state.health = RANGED.burnPlayer;
  let fallen = false;
  for (let k = 0; k < 2 * RANGED.burnEvery && !fallen; k++) {
    f.step(0);
    fallen = f.events.some((e) => e.type === 'dead');
  }
  check(
    fallen && f.state.deaths === 1 && f.state.fires.length === 0,
    `burnt down in their own fire: fell ${f.state.deaths}, ${f.state.fires.length} tiles still burning`,
  );
  say(
    `a molotov: nine tiles burn ${RANGED.fireSteps} steps; one of the dead standing in it is put down in ${fell} steps, a brute, three times as long; one coming through it loses ${DEAD.health - hp}; the thrower is burnt ${RANGED.burnPlayer} every ${RANGED.burnEvery} steps in it and not out of it; ${RANGED.fireMost} tiles at the most; gone on leaving the district or falling; stopped by a barred door; it burns on while the player sleeps, and wakes them in it`,
  );
}

// ------------------------------------------------------------------ the crossbow
{
  const [c, at] = street();
  give(c, [
    ['crossbow', cityItem(N('crossbow'))!.wear!],
    ['bolt', 6],
    ['bat', 40],
  ]);
  // One five tiles ahead: shot, not struck.
  const z = zed(c, at + 5);
  // (One four tiles behind the shooter: in a blow's hearing, out of a shot's, and nowhere near the bolt's way.)
  const heard = zed(c, at - 4, ZED.WANDER);
  check(far(at - 4, at) > RANGED.shotNoise && far(at - 4, at) <= BLOW.noise, 'placed between the two hearings');
  const ev = hit(c);
  const shot = ev.find((e) => e.type === 'shot');
  check(!!shot && !ev.some((e) => e.type === 'swing'), `one five tiles off is shot: ${JSON.stringify(ev)}`);
  check(z.hp === DEAD.health - RANGED.shotHarm && z.mode === ZED.CHASE, `a bolt takes ${RANGED.shotHarm}: ${z.hp} left, and it knows`);
  check(count(c, 'bolt') === 5 && count(c, 'crossbow') === cityItem(N('crossbow'))!.wear! - 1, 'a bolt and a shot spent');
  check(
    heard.mode !== ZED.SEEK,
    `one ${far(tileAt(heard.body.x, heard.body.z), at)} tiles off hears nothing (a blow carries ${BLOW.noise}, a shot ${RANGED.shotNoise})`,
  );
  // Pressed again at once: not ready, no bolt spent, and no blow either.
  const ev2 = hit(c);
  check(!ev2.some((e) => e.type === 'shot' || e.type === 'swing') && count(c, 'bolt') === 5, 'pressed again at once: nothing');
  for (let k = 0; k < RANGED.shotEvery; k++) c.step(0);
  const ev3 = hit(c);
  check(
    ev3.some((e) => e.type === 'shot' && e.dead) && c.state.kills === 1 && !c.state.zeds.includes(z),
    `the second bolt puts a shambler down: ${JSON.stringify(ev3)}`,
  );
  // One in arm's reach: struck with the bat, no bolt spent.
  c.state.zeds = [];
  for (let k = 0; k < RANGED.shotEvery; k++) c.step(0);
  const close = zed(c, at + 1);
  const bolts = count(c, 'bolt');
  const ev4 = hit(c);
  check(
    ev4.some((e) => e.type === 'swing' && e.hit) && count(c, 'bolt') === bolts && close.hp < DEAD.health,
    `one in arm's reach is struck: ${JSON.stringify(ev4)}`,
  );
  // Nobody ahead, behind a wall, behind the player, or beyond its reach: the blow as always, no bolt spent.
  c.state.zeds = [];
  for (let k = 0; k < RANGED.shotEvery; k++) c.step(0);
  zed(c, at + RANGED.shotReach + 2);
  const behind = c.grid[at - 3] ? -1 : at - 3;
  if (behind >= 0) zed(c, behind);
  const ev5 = hit(c);
  check(
    ev5.some((e) => e.type === 'swing' && !e.hit) && count(c, 'bolt') === bolts,
    `nobody to shoot (too far, or behind): the blow in the air: ${JSON.stringify(ev5)}`,
  );
  // One in arm's reach behind the player doesn't take the shot away: the blow wouldn't land on it.
  c.state.zeds = [];
  for (let k = 0; k < RANGED.shotEvery; k++) c.step(0);
  stand(c, at + 1);
  zed(c, at);
  const ahead5 = zed(c, at + 6);
  const ev6 = hit(c);
  check(
    ev6.some((e) => e.type === 'shot') && ahead5.hp === DEAD.health - RANGED.shotHarm,
    `one behind in reach, one ahead out of it: ${JSON.stringify(ev6)}`,
  );
  stand(c, at);
  // A shot costs no energy.
  const energy = c.state.energy;
  c.state.zeds = [];
  for (let k = 0; k < RANGED.shotEvery; k++) c.step(0);
  const spent = c.state.energy;
  zed(c, at + 5);
  hit(c);
  check(c.state.energy >= spent - (energy - spent) / RANGED.shotEvery - 1, `a shot costs no energy: ${spent} to ${c.state.energy}`);
  // No bolt: the blow.
  c.state.zeds = [];
  for (let k = 0; k < RANGED.shotEvery; k++) c.step(0);
  c.state.inv[slot(c, 'bolt')] = [0, 0];
  zed(c, at + 5);
  check(
    hit(c).some((e) => e.type === 'swing'),
    'no bolt: the blow',
  );
  // Bolts found again; the crossbow wears out and breaks.
  const [b, bat] = street(4);
  let back = 0;
  let shots = 0;
  let broke = false;
  give(b, [
    ['crossbow', cityItem(N('crossbow'))!.wear!],
    ['bolt', 6],
  ]);
  for (let k = 0; k < 60 && !broke; k++) {
    b.state.zeds = [];
    zed(b, bat + 4, ZED.IDLE, ZKIND.BRUTE).hp = 9999;
    b.state.inv[1] = [N('bolt'), 6];
    for (let w = 0; w < RANGED.shotEvery; w++) b.step(0);
    const e = hit(b);
    if (e.some((x) => x.type === 'shot')) shots++;
    if (e.some((x) => x.type === 'broke')) broke = true;
  }
  back = (b.state.boxes[`${b.state.district}:g${bat + 4}`] ?? []).reduce((n, st) => n + (st[0] === N('bolt') ? st[1] : 0), 0);
  check(shots === cityItem(N('crossbow'))!.wear && broke && count(b, 'crossbow') === 0, `the crossbow broke after ${shots} shots`);
  check(back > shots / 4 && back < (3 * shots) / 4, `${back} of ${shots} bolts found again where they struck`);
  say(
    `the crossbow: one out of arm's reach and within ${RANGED.shotReach} tiles ahead is shot (${RANGED.shotHarm} a bolt: two for a shambler), every ${RANGED.shotEvery} steps, heard ${RANGED.shotNoise} tiles off; one in reach is struck as before; nobody to shoot, or no bolt: the blow; one in reach behind doesn't take the shot; no energy spent; ${back} of ${shots} bolts found again; broken after ${shots} shots`,
  );
}

// ------------------------------------------------------------------ made, and saved
{
  const made = CITY_RECIPES.filter((r) => ['molotov', 'crossbow', 'bolt'].includes(r.makes));
  check(
    made.length === 3 && !made[0].bench && made[1].bench === true && made[2].bench === true && made[2].n === 3,
    'three recipes: a molotov by hand, the crossbow and three bolts at a bench',
  );
  check(
    made.every((r) => r.from.every(([id]) => cityItemNumber(id) > 0)),
    'made of things that exist',
  );
  const [live] = street(5);
  give(live, [['molotov', 2]]);
  live.peace = false;
  use(live, 'molotov');
  for (let k = 0; k < 30; k++) live.step(0);
  const snap = JSON.parse(JSON.stringify(live.snapshot()));
  const loaded = loadCity(JSON.parse(JSON.stringify(snap)))!;
  check(
    JSON.stringify(loaded.state.fires) === JSON.stringify(live.state.fires) && loaded.state.fires.length === 9,
    'what burns is kept by a save',
  );
  let differ = -1;
  for (let k = 0; k < 400 && differ < 0; k++) {
    if (k % 20 === 0 && fnv1a(JSON.stringify(live.snapshot().state)) !== fnv1a(JSON.stringify(loaded.snapshot().state))) differ = k;
    live.step(0);
    loaded.step(0);
  }
  check(differ < 0 && live.state.fires.length === 0, `a save made while it burns plays on as the live city does (differs at ${differ})`);
  const old = JSON.parse(JSON.stringify(snap));
  delete old.state.fires;
  check(loadCity(old)?.state.fires.length === 0, 'a save from before fires has none');
  let bad = 0;
  for (const fires of [
    'x',
    [[1]],
    [[-1, 5]],
    [[W * W, 5]],
    [[3, 1e12]],
    [[1.5, 2]],
    { 0: 1 },
    null,
    Array.from({ length: 99 }, () => [1, 1]),
  ]) {
    const s2 = JSON.parse(JSON.stringify(snap));
    s2.state.fires = fires;
    const got = loadCity(s2);
    if (got && got.state.fires.length === 0) bad++;
  }
  check(bad === 9, `${bad} of 9 damaged fires loaded as none`);
  say(
    `made: a molotov by hand, the crossbow and three bolts at a workbench; saves: what burns is kept and plays on the same, none from before, ${bad} damaged ones loaded as none`,
  );
}
console.log(lines.join('\n'));
