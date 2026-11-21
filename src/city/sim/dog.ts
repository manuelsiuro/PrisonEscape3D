import { findPath, nearestDir } from '../../sim/ai/path';
import { lineOfSight } from '../../sim/ai/sight';
import { bodyAt, walk, type Body } from '../../sim/systems/movement';
import { STEPS_PER_MINUTE, UNIT, WALK_SPEED } from '../../sim/tuning';
import { centerX, centerZ, tileAt } from '../../sim/world/grid';
import { MAP_H, MAP_W } from '../../sim/world/World';
import { ALIVE_REV, DOG, DOG_DIGS, DOG_FOOD } from '../content/alive';
import { isBuilding } from '../content/districts';
import { cityItemNumber } from '../content/items';
import { CITY_N, streamOf } from '../gen/plan';
import { PLACES } from '../gen/tunnel';
import type { City, Target } from './City';
import { isDown, ZED } from './dead';
import { remark } from './story';

/**
 * The dog (C5 batch 6, 2.71), a part of the city's simulation, in a city begun from then: a hungry stray in the park. Fed twice from
 * the pockets, it follows the player everywhere (across checkpoints, home after a fall, into the tunnel). It barks at the dead it
 * sees, and wakes a sleeper when one comes near the bed; once a day, out of doors, it digs something up. It never fights, the dead
 * pay it no mind, and it can't die. Nothing is drawn: where it waits is the city's seed, what it digs the seed and the day.
 */

const N = MAP_W * MAP_H;
/** The save's part, index by index: how many times fed, its district, where it is (units), the day it last dug. */
const FED = 0;
const D = 1;
const X = 2;
const Z = 3;
const DUG = 4;

export const freshDog = () => ({ dog: [] as number[] });

/** A save's field made sound before the city is built from it (damaged: put back where it waits, as it was fed). */
export function soundDog(st: { dog?: unknown }) {
  const g = st.dog;
  const ok =
    Array.isArray(g) &&
    g.length === 5 &&
    g.every(Number.isInteger) &&
    g[FED] >= 0 &&
    g[FED] <= DOG.fed &&
    g[D] >= 0 &&
    g[D] < PLACES &&
    g[X] >= 0 &&
    g[Z] >= 0 &&
    g[X] < MAP_W * UNIT &&
    g[Z] < MAP_H * UNIT &&
    g[DUG] >= 0;
  st.dog = ok ? g : [];
}

export const dogOn = (c: City) => c.state.rev >= ALIVE_REV && c.state.dog.length === 5;
/** It follows the player (fed enough). */
export const follows = (c: City) => dogOn(c) && c.state.dog[FED] >= DOG.fed;

/** Where it waits, hungry: a floor of the park's green, open all round, from the seed (-1: the city has no park). */
export function dogHome(c: City): number {
  const d = c.plan.kinds.indexOf('park');
  if (d < 0) return -1;
  const dist = c.baseOf(d);
  const grid = c.storyGrid(d);
  const can: number[] = [];
  for (let i = 0; i < N; i++) {
    const lot = dist.lotAt[i] - 1;
    if (lot < 0 || dist.lots[lot].use !== 'green' || grid[i]) continue;
    let open = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!grid[i + dz * MAP_W + dx]) open++;
    if (
      open === 9 &&
      !dist.gates.some((g) =>
        g.tiles.some((t) => Math.abs((t % MAP_W) - (i % MAP_W)) + Math.abs(Math.floor(t / MAP_W) - Math.floor(i / MAP_W)) < 6),
      )
    )
      can.push(i);
  }
  return can.length ? d * N + can[Math.floor(streamOf(c.plan.seed, 16_000)() * can.length)] : -1;
}

/** A new city (from 2.71): the dog put where it waits. */
export function placeDog(c: City) {
  if (c.state.rev < ALIVE_REV || c.state.dog.length) return;
  const at = dogHome(c);
  if (at < 0) return;
  const t = at % N;
  c.state.dog = [0, Math.floor(at / N), centerX(t), centerZ(t), 0];
}

/** The dog's body for walking, its way and its last bark: the city's, not saved (a load puts it down where the save has it). */
export interface Pup {
  body: Body | null;
  path: number[];
}
const dogBody = (c: City): Body => {
  const g = c.state.dog;
  const p = c.pup;
  if (!p.body || p.body.x !== g[X] || p.body.z !== g[Z]) {
    const facing = p.body?.facing ?? 1;
    p.body = bodyAt(0, 0, facing);
    p.body.x = g[X];
    p.body.z = g[Z];
    p.path = [];
  }
  return p.body;
};
/** Which way it faces (for the view: it turns as it walks). */
export const dogFacing = (c: City) => (dogOn(c) ? dogBody(c).facing : 1);
export const dogMoving = (c: City) => (dogOn(c) ? dogBody(c).moving : false);

/** In the district the player is in. */
export const dogHere = (c: City) => dogOn(c) && c.state.dog[D] === c.state.district;
export const dogTile = (c: City) => tileAt(c.state.dog[X], c.state.dog[Z]);

/** Into a district with the player (a checkpoint, the tunnel, home after a fall): beside them. */
export function dogAlong(c: City) {
  if (!follows(c)) return;
  const g = c.state.dog;
  const here = c.tile;
  const grid = c.grid;
  const beside = [here - MAP_W, here + MAP_W, here - 1, here + 1, here].find((t) => t >= 0 && t < N && !grid[t]) ?? here;
  g[D] = c.state.district;
  g[X] = centerX(beside);
  g[Z] = centerZ(beside);
  c.pup.body = null;
}

/** The dog beside the player, not yet following: the button feeds it. */
export function dogTarget(c: City): Target | null {
  if (!dogHere(c) || follows(c)) return null;
  const t = dogTile(c);
  const here = c.tile;
  if (Math.abs((t % MAP_W) - (here % MAP_W)) + Math.abs(Math.floor(t / MAP_W) - Math.floor(here / MAP_W)) !== 1) return null;
  return { kind: 'dog', key: 'D', tile: t, prop: null };
}

/** Fed from the pockets (what it likes best first); fed enough, it follows. Without anything it eats: said. */
export function feedDog(c: City) {
  const g = c.state.dog;
  const food = DOG_FOOD.map((id) => cityItemNumber(id)).find((item) => c.count(item) > 0);
  if (!food) return void c.events.push({ type: 'refused', why: 'noDogFood' });
  c.spend(food, 1);
  g[FED]++;
  c.events.push({ type: 'dog', what: g[FED] >= DOG.fed ? 'follows' : 'fed' });
  if (g[FED] >= DOG.fed) remark(c, 'dog');
}

/** A step: following, it keeps near; it barks at the dead it sees; a sleeper is woken by one near; once a day it digs. */
export function stepDog(c: City) {
  if (!dogHere(c)) return;
  const s = c.state;
  const g = s.dog;
  const b = dogBody(c);
  const dt = tileAt(b.x, b.z);
  // (The dead it sees: a bark now and then, and a sleeper woken before a bite. On the clock's beat, not from a bark kept in
  // memory: a save loaded plays on as the live city did.)
  const p = c.pup;
  if (s.step % DOG.barkEvery === 0) {
    const near = s.zeds.find((z) => {
      if (isDown(z)) return false;
      const zt = tileAt(z.body.x, z.body.z);
      return (
        Math.max(Math.abs((zt % MAP_W) - (dt % MAP_W)), Math.abs(Math.floor(zt / MAP_W) - Math.floor(dt / MAP_W))) <= DOG.sees &&
        lineOfSight(c.world, b.x, b.z, z.body.x, z.body.z)
      );
    });
    if (near) {
      c.events.push({ type: 'dog', what: 'bark' });
      // (The review: only for one coming for the sleeper, near the bed: after them, at their door, or making for them. Before,
      // any it saw near the bed woke them, four times a night and more, for nothing.)
      const pt = c.tile;
      const coming = s.zeds.some((z) => {
        if (isDown(z)) return false;
        const zt = tileAt(z.body.x, z.body.z);
        const by = Math.max(Math.abs((zt % MAP_W) - (pt % MAP_W)), Math.abs(Math.floor(zt / MAP_W) - Math.floor(pt / MAP_W)));
        const goal =
          z.goal >= 0
            ? Math.max(Math.abs((z.goal % MAP_W) - (pt % MAP_W)), Math.abs(Math.floor(z.goal / MAP_W) - Math.floor(pt / MAP_W)))
            : 99;
        return by <= DOG.wakes && (z.mode === ZED.CHASE || z.pound !== undefined || (z.mode === ZED.SEEK && goal <= 2));
      });
      if (s.sleeping && follows(c) && coming) c.wakeNow('barked');
    }
  }
  if (!follows(c) || s.sleeping) {
    b.moving = false;
    return;
  }
  // (Following: to heel when it's further than that; lost, or a wall between with no way round, straight beside the player.)
  const pt = c.tile;
  const gap = Math.max(Math.abs((pt % MAP_W) - (dt % MAP_W)), Math.abs(Math.floor(pt / MAP_W) - Math.floor(dt / MAP_W)));
  if (gap > DOG.lost) return dogAlong(c);
  if (gap <= DOG.heel) {
    b.moving = false;
    p.path = [];
  } else {
    // (Its way worked out afresh each step, from where it is: nothing kept that a save hasn't.)
    p.path =
      findPath(
        c.world,
        dt,
        (i) => Math.abs((i % MAP_W) - (pt % MAP_W)) + Math.abs(Math.floor(i / MAP_W) - Math.floor(pt / MAP_W)) <= 1,
        pt,
        900,
      ) ?? [];
    if (!p.path.length) return dogAlong(c);
    const next = p.path[0];
    const wx = centerX(next) - b.x;
    const wz = centerZ(next) - b.z;
    if (Math.abs(wx) + Math.abs(wz) < 220) p.path.shift();
    else walk(c.world, b, nearestDir(wx, wz), Math.trunc((WALK_SPEED * DOG.pace) / 1000));
  }
  g[X] = b.x;
  g[Z] = b.z;
  digs(c);
}

/** Once a day, out of doors, near the player, from a minute of its own: something dug up, on the ground where it dug. */
function digs(c: City) {
  const s = c.state;
  const g = s.dog;
  if (s.step % STEPS_PER_MINUTE !== 0 || g[DUG] >= c.day) return;
  const m = c.minute;
  const at = DOG.digFrom + ((c.salt(17_000 + c.day) >>> 0) % (DOG.digTo - DOG.digFrom));
  if (m < at || m >= DOG.digTo) return;
  const t = dogTile(c);
  const lot = c.district.lotAt[t] - 1;
  if ((lot >= 0 && isBuilding(c.district.lots[lot].use)) || c.state.district >= CITY_N) return;
  const [id, n] = DOG_DIGS[(c.salt(17_500 + c.day) >>> 0) % DOG_DIGS.length];
  g[DUG] = c.day;
  c.drop(t, cityItemNumber(id), n);
  c.events.push({ type: 'dog', what: 'dug', tile: t });
}

/** The way it faces the player, for one standing still. */
export const dogTowards = (c: City) => {
  const g = c.state.dog;
  return nearestDir(c.state.player.x - g[X], c.state.player.z - g[Z]);
};
