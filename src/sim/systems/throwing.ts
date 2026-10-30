/**
 * Throwing: what lands where, the aim (in range, a clear arc, room to land) and the
 * throw itself, its thud heard where it lands.
 */
import { itemDef } from '../../content/items';
import { nearestDir } from '../ai/path';
import { centerX, centerZ, tileAt } from '../world/grid';
import { lineOfSight } from '../ai/sight';
import type { SimContext } from '../context';
import type { TossRefusal } from '../events';
import { FUSE_STEPS, THUD_NOISE, TOSS_OPINION, TOSS_RANGE, TOSS_RANGE_STRONG, TOSS_STRONG } from '../tuning';
import { TILE } from '../world/tiles';
import { LAYER, MAP_H, MAP_W, placeKey, type World } from '../world/World';
import { itemOf, PILE } from './items';
import { tileOfBody } from './movement';
import { changeOpinion } from './social';
import { FIRECRACKER } from './structure';
import { catchTreat } from './k9';
import { CAUGHT_RAT, throwRat } from './rats';
import { makeNoise } from './noise';

/** Whether something thrown can land on a ground tile: open floor (not a doorway, a hole or the water). */
export function landable(w: World, t: number): boolean {
  const k = w.ground.kind[t];
  return !w.blocked(t % MAP_W, Math.floor(t / MAP_W)) && k !== TILE.DOOR && k !== TILE.SHAFT && k !== TILE.HOLE && k !== TILE.WATER;
}

export function pileRoom(sim: SimContext, t: number): boolean {
  const key = placeKey(LAYER.GROUND, t);
  let n = 0;
  for (const [k] of sim.state.items.ground) if (k === key) n++;
  return n < PILE;
}

/** The neighbours a full pile spills onto, in order. */
const SPILL: ReadonlyArray<[number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

/** How far the player throws (tiles): farther once strong. */
export const tossRange = (str: number) => (str >= TOSS_STRONG ? TOSS_RANGE_STRONG : TOSS_RANGE);

/** A throw aimed at a tile (tiles across and down from the player's): where it would land, or why it can't go. */
export interface TossAim {
  why: TossRefusal | null;
  /** The tile it lands on (a full pile there: the next with room), -1 when it can't go. */
  to: number;
}

/**
 * Whether the item in hand can be thrown at a tile now, and where it would land: on the
 * ground floor, up and about (not sitting, training, talking or in a container), within range
 * with nothing in the way, onto open floor. The aim on screen asks the same.
 */
export function aimToss(sim: SimContext, dx: number, dz: number, out: TossAim = { why: null, to: -1 }): TossAim {
  const s = sim.state;
  const w = sim.world;
  const it = s.items;
  out.to = -1;
  out.why = null;
  const r = tossRange(s.str);
  if (!itemOf(it.inv[it.hand])) out.why = 'nothing';
  else if (s.layer !== LAYER.GROUND || s.sleeping || s.ko > 0 || s.solitary > 0 || s.seat >= 0 || s.train >= 0 || s.talk >= 0 || it.open >= 0) out.why = 'busy';
  else if (dx * dx + dz * dz > r * r || dx < -8 || dx > 7 || dz < -8 || dz > 7) out.why = 'far';
  if (out.why) return out;
  const p = s.player;
  const at = tileOfBody(p);
  const x = at.x + dx;
  const z = at.z + dz;
  if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H || !landable(w, z * MAP_W + x)) {
    out.why = 'there';
    return out;
  }
  const t = z * MAP_W + x;
  if (!lineOfSight(w, p.x, p.z, centerX(t), centerZ(t))) {
    out.why = 'line';
    return out;
  }
  if (pileRoom(sim, t)) {
    out.to = t;
    return out;
  }
  for (const [ox, oz] of SPILL) {
    const nx = x + ox;
    const nz = z + oz;
    if (nx < 0 || nz < 0 || nx >= MAP_W || nz >= MAP_H) continue;
    const nt = nz * MAP_W + nx;
    if (landable(w, nt) && pileRoom(sim, nt)) {
      out.to = nt;
      return out;
    }
  }
  out.why = 'there';
  return out;
}

const aim: TossAim = { why: null, to: -1 };

/**
 * The item in hand thrown at a ground tile (OP.EXT THROW): it lands at once (the view draws
 * its flight), on whoever stands there (an inmate hit thinks less of the player), with a thud
 * the guards may hear. A firecracker lands lit: it goes off when its fuse has burnt down.
 * Thrown over a detector arch, nothing scans it.
 */
export function throwItem(sim: SimContext, tile: number) {
  const s = sim.state;
  const it = s.items;
  const p = s.player;
  const here = tileOfBody(p);
  aimToss(sim, (tile % MAP_W) - here.x, Math.floor(tile / MAP_W) - here.z, aim);
  if (aim.why) {
    sim.events.push({ type: 'cantThrow', why: aim.why });
    return;
  }
  const to = aim.to;
  const v = it.inv[it.hand];
  const item = itemOf(v);
  it.inv[it.hand] = 0;
  it.rev++;
  const dx = centerX(to) - p.x;
  const dz = centerZ(to) - p.z;
  if (dx || dz) p.facing = nearestDir(dx, dz);
  if (item === FIRECRACKER) s.fuses.push([placeKey(LAYER.GROUND, to), s.step + FUSE_STEPS]);
  // (P20: a caught rat lands loose and runs.)
  else if (item === CAUGHT_RAT) throwRat(sim, to);
  // (P19: a treat or pepper landing by a dog is the dog's.)
  else if (!catchTreat(sim, item, to)) it.ground.push([placeKey(LAYER.GROUND, to), v]);
  const hit = s.inmates.findIndex((m) => tileAt(m.body.x, m.body.z) === to);
  sim.events.push({ type: 'tossed', item, from: here.z * MAP_W + here.x, to, hit });
  if (hit >= 0) changeOpinion(sim, hit, -TOSS_OPINION);
  makeNoise(sim, 'thud', LAYER.GROUND, to, THUD_NOISE[itemDef(item).thud ?? 0]);
}
