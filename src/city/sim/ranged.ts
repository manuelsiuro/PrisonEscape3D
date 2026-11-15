import { nearestDir } from '../../sim/ai/path';
import { lineOfSight } from '../../sim/ai/sight';
import { DIR_X, DIR_Z } from '../../sim/command';
import { randomInt } from '../../sim/rng';
import { UNIT } from '../../sim/tuning';
import { centerX, centerZ, tileAt } from '../../sim/world/grid';
import { MAP_H, MAP_W } from '../../sim/world/World';
import { kindStats } from '../content/dead';
import { cityItemNumber } from '../content/items';
import { RANGED } from '../content/ranged';
import type { City } from './City';
import { noise, putDown, ZED, type Zed } from './dead';

/**
 * Weapons thrown or shot (2.55), a part of the city's simulation. Thrown from the pockets (Use): an
 * empty bottle, heard where it breaks; a molotov, whose fire burns whoever stands in it, the dead and
 * the thrower alike. Shot with the blow's own button: a crossbow carried with a bolt shoots the nearest
 * of the dead ahead that is out of arm's reach (one in reach is struck as before). What burns is in
 * the state for the district the player is in, and gone on leaving it.
 */

const N = MAP_W * MAP_H;
const BOTTLE = cityItemNumber('bottle');
const MOLOTOV = cityItemNumber('molotov');
const CROSSBOW = cityItemNumber('crossbow');
const BOLT = cityItemNumber('bolt');

/** What burns in the district the player is in: [tile, the step it goes out]. */
export const freshRanged = () => ({ fires: [] as number[][] });

/** The nearest of the dead ahead of the player, within `reach` tiles and a clear line (-1: none), no nearer than `from` units. */
function ahead(c: City, reach: number, from = 0): number {
  const p = c.state.player;
  const fx = DIR_X[p.facing] ?? 0;
  const fz = DIR_Z[p.facing] ?? 0;
  const fl2 = fx * fx + fz * fz || 1;
  let best = -1;
  let bestD = Infinity;
  c.state.zeds.forEach((z, k) => {
    const dx = z.body.x - p.x;
    const dz = z.body.z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > (reach * UNIT) ** 2 || d2 <= from * from || d2 >= bestD) return;
    // (Integers only: the cosine's square against the aim's, no root taken.)
    const dot = dx * fx + dz * fz;
    if (dot <= 0 || dot * dot * RANGED.aimOf < RANGED.aim * d2 * fl2) return;
    if (!lineOfSight(c.world, p.x, p.z, z.body.x, z.body.z)) return;
    bestD = d2;
    best = k;
  });
  return best;
}

/** Where a thing thrown lands: on the nearest of the dead ahead, else as far as it goes the way faced (-1: a wall in the thrower's face). */
function landing(c: City): number {
  const k = ahead(c, RANGED.throwReach);
  if (k >= 0) return tileAt(c.state.zeds[k].body.x, c.state.zeds[k].body.z);
  const p = c.state.player;
  const fx = DIR_X[p.facing] ?? 0;
  const fz = DIR_Z[p.facing] ?? 0;
  const fl = Math.sqrt(fx * fx + fz * fz) || 1;
  let last = -1;
  for (let n = 1; n <= RANGED.throwReach * 2; n++) {
    const x = Math.floor((p.x + Math.trunc((fx * n * UNIT) / (2 * fl))) / UNIT);
    const z = Math.floor((p.z + Math.trunc((fz * n * UNIT) / (2 * fl))) / UNIT);
    // (A wall, what stands in the way, a barred door: it goes no further.)
    if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H || c.grid[z * MAP_W + x] || c.bars.includes(z * MAP_W + x)) break;
    if (z * MAP_W + x !== c.tile) last = z * MAP_W + x;
  }
  return last;
}

/** A molotov broken on a tile: the fire there and on the open tiles round it, with a clear line. */
function setFire(c: City, at: number) {
  const s = c.state;
  const until = s.step + RANGED.fireSteps;
  const r = RANGED.fireSpread;
  for (let dz = -r; dz <= r; dz++)
    for (let dx = -r; dx <= r; dx++) {
      const x = (at % MAP_W) + dx;
      const z = Math.floor(at / MAP_W) + dz;
      if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
      const i = z * MAP_W + x;
      // (Not on a barred door: the boards stop it as they stop the throw.)
      if (c.grid[i] || c.bars.includes(i) || (i !== at && !lineOfSight(c.world, centerX(at), centerZ(at), centerX(i), centerZ(i))))
        continue;
      const old = s.fires.find((f) => f[0] === i);
      if (old) old[1] = until;
      else s.fires.push([i, until]);
    }
  while (s.fires.length > RANGED.fireMost) s.fires.shift();
  c.firesRev++;
}

/** One of the pockets' things thrown (Use): true when it was one, whatever came of it. */
export function useThrown(c: City, item: number, slot: number): boolean {
  if (item !== BOTTLE && item !== MOLOTOV) return false;
  const s = c.state;
  const to = landing(c);
  if (to < 0) return (c.events.push({ type: 'refused', why: 'noRoom' }), true);
  const st = s.inv[slot];
  if (--st[1] <= 0) st[0] = st[1] = 0;
  c.events.push({ type: 'thrown', item, from: c.tile, to });
  if (item === BOTTLE) noise(c, to, RANGED.bottleNoise);
  else {
    setFire(c, to);
    noise(c, to, RANGED.fireNoise);
  }
  return true;
}

/** The crossbow carried with a bolt for it. */
export const loaded = (c: City) => c.count(CROSSBOW) > 0 && c.count(BOLT) > 0;

/**
 * The blow's button with a loaded crossbow: one of the dead ahead and out of arm's reach is shot
 * (true: the press was a shot, or the crossbow isn't ready yet); none there, or one in reach: false,
 * and the blow goes as it always did.
 */
export function shoot(c: City, armsReach: number): boolean {
  if (!loaded(c)) return false;
  const s = c.state;
  if (nearIn(c, armsReach)) return false;
  const k = ahead(c, RANGED.shotReach, armsReach);
  if (k < 0) return false;
  if (s.step - s.swung < RANGED.shotEvery || s.sleeping) return true;
  s.swung = s.step;
  c.spend(BOLT, 1);
  const z = s.zeds[k];
  const at = tileAt(z.body.x, z.body.z);
  z.hp -= RANGED.shotHarm;
  z.reel = kindStats(z.kind).reel;
  z.near = 0;
  z.mode = ZED.CHASE;
  z.seen = s.step;
  z.last = c.tile;
  z.body.facing = nearestDir(s.player.x - z.body.x, s.player.z - z.body.z);
  const dead = z.hp <= 0;
  noise(c, c.tile, RANGED.shotNoise);
  // (The bolt: found again where it struck, one time in a few.)
  if (randomInt(s, RANGED.boltBack) === 0) c.leave(at, BOLT, 1);
  c.events.push({ type: 'shot', from: c.tile, x: z.body.x, z: z.body.z, dead });
  c.wearItem(CROSSBOW);
  if (dead) putDown(c, [z]);
  return true;
}

/** One of the dead the blow would land on (dead.ts's `strike`: in arm's reach, ahead or on top of the player, a clear line). */
function nearIn(c: City, reach: number): boolean {
  const p = c.state.player;
  const fx = DIR_X[p.facing] ?? 0;
  const fz = DIR_Z[p.facing] ?? 0;
  return c.state.zeds.some((z: Zed) => {
    const dx = z.body.x - p.x;
    const dz = z.body.z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > reach * reach || (d2 > 400 * 400 && dx * fx + dz * fz <= 0)) return false;
    return lineOfSight(c.world, p.x, p.z, z.body.x, z.body.z);
  });
}

/** Whether a tile burns. */
export const burning = (c: City, tile: number) => c.state.fires.some((f) => f[0] === tile);

/** One step of the fires: out when their time is up; every few steps whoever stands in one is burnt. */
export function stepFires(c: City) {
  const s = c.state;
  if (!s.fires.length) return;
  if (s.fires.some((f) => f[1] <= s.step)) {
    s.fires = s.fires.filter((f) => f[1] > s.step);
    c.firesRev++;
    if (!s.fires.length) return void c.events.push({ type: 'fireOut' });
  }
  if (s.step % RANGED.burnEvery) return;
  const gone: Zed[] = [];
  for (let k = s.zeds.length - 1; k >= 0; k--) {
    const z = s.zeds[k];
    if (!burning(c, tileAt(z.body.x, z.body.z))) continue;
    z.hp -= RANGED.burnDead;
    if (z.hp <= 0) gone.push(z);
  }
  if (gone.length) {
    c.events.push({ type: 'scorched', dead: gone.length });
    putDown(c, gone);
    if (s.over || c.events.some((e) => e.type === 'dead')) return;
  }
  if (burning(c, c.tile)) {
    c.events.push({ type: 'burn', harm: RANGED.burnPlayer });
    if (s.sleeping) c.wakeNow('attacked');
    c.hurt(RANGED.burnPlayer);
  }
}

/** A save's fires made sound before the city is built from it (none: a save from before them; damaged: none). */
export function soundRanged(s: { step?: unknown; fires?: unknown }) {
  if (s.fires === undefined) return;
  const step = Number.isInteger(s.step) ? (s.step as number) : 0;
  const f = s.fires;
  const ok =
    Array.isArray(f) &&
    f.length <= RANGED.fireMost &&
    f.every(
      (x) =>
        Array.isArray(x) &&
        x.length === 2 &&
        x.every(Number.isInteger) &&
        x[0] >= 0 &&
        x[0] < N &&
        x[1] >= 0 &&
        x[1] <= step + RANGED.fireSteps,
    );
  if (!ok) s.fires = [];
}
