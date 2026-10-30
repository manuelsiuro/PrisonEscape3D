/**
 * Noise and distractions (P14). A noise carries so many walking tiles from where it's made,
 * through wherever sight passes (a shut door counts DOOR_NOISE tiles): the guards up and about
 * on those tiles hear it, and the nearest (by that walk) go and look where it came from, as far
 * as a guard can walk towards it. Under the floor only the tiles just above hear it; from the
 * vents, the floor within 2 tiles below; from a roof, the open ground around. Noise itself
 * costs no heat: what the guards find when they get there does.
 *
 * What makes it: a tool at work, a thrown item landing (by its thud), a firecracker going off
 * when its fuse has burnt down, an alarm clock ringing once a second (wound, it counts down
 * wherever it is: in the pockets, in a desk, on the floor).
 */
import { twist } from './twists';
import { itemDef } from '../../content/items';
import { chebTiles, tileAt } from '../world/grid';
import type { SimContext } from '../context';
import type { NoiseKind } from '../events';
import { BANG_GUARDS, BANG_LOOK, BANG_NOISE, DOOR_NOISE, LOOK_NEAR, NAP_WAKE, NOISE_GUARDS, NOISE_LOOK, RING_NOISE, RING_SECONDS, STEPS_PER_SECOND, STRIKE_NOISE, WIND_MAX, WIND_SECONDS } from '../tuning';
import { containersOf } from '../world/containers';
import { TILE, TILE_INFO } from '../world/tiles';
import { LAYER, layerOfKey, MAP_H, MAP_W, tileOfKey, type World } from '../world/World';
import { awake, GUARD, rouse, sendToLook, type Guard } from './guards';
import { DOING } from './inmates';
import { itemOf, ownerOf, slot, usesOf } from './items';
import { tileOfBody } from './movement';
import { muffled } from './calendar';
import { ALARM_CLOCK, type ToolTarget } from './structure';

/** A noise: where it's made and how many tiles it carries. */
export interface NoiseAt {
  layer: number;
  tile: number;
  reach: number;
}

// ------------------------------------------------------------------ where a noise carries

/** Each ground tile's cost from the last noise worked out (-1: out of earshot), and the tiles reached. Refilled each time; not state. */
const cost = new Int16Array(MAP_W * MAP_H).fill(-1);
const reached: number[] = [];
/** Tiles waiting to spread the noise further, by their cost. */
const buckets: number[][] = Array.from({ length: 16 }, () => []);

function reach(t: number, c: number) {
  if (cost[t] >= 0 && cost[t] <= c) return;
  if (cost[t] < 0) reached.push(t);
  cost[t] = c;
  buckets[c].push(t);
}

/** Whether a noise passes through a ground tile (and what it costs): where sight passes, a shut door at a price. */
function through(w: World, t: number): number {
  const k = w.ground.kind[t];
  if (k === TILE.DOOR) return w.doorShut[t] ? DOOR_NOISE : 1;
  return TILE_INFO[k].opaque ? 0 : 1;
}

/**
 * Works out the ground tiles a noise reaches (`cost`, `reached`). On the ground floor it
 * spreads tile by tile (the tile it's made on may be a wall being chipped: it carries to both
 * sides); from below, above or a roof it's heard only on the tiles the rules say.
 */
function spread(w: World, n: NoiseAt) {
  for (const t of reached) cost[t] = -1;
  reached.length = 0;
  const { layer, tile } = n;
  const r = Math.min(n.reach, buckets.length - 1);
  if (tile < 0 || r <= 0) return;
  const x0 = tile % MAP_W;
  const z0 = Math.floor(tile / MAP_W);
  if (layer === LAYER.GROUND) {
    reach(tile, 0);
    for (let c = 0; c <= r; c++) {
      const list = buckets[c];
      for (let k = 0; k < list.length; k++) {
        const t = list[k];
        if (cost[t] !== c) continue;
        const x = t % MAP_W;
        const z = Math.floor(t / MAP_W);
        for (let d = 0; d < 4; d++) {
          const nx = x + (d === 1 ? 1 : d === 3 ? -1 : 0);
          const nz = z + (d === 2 ? 1 : d === 0 ? -1 : 0);
          if (nx < 0 || nz < 0 || nx >= MAP_W || nz >= MAP_H) continue;
          const nt = nz * MAP_W + nx;
          const step = through(w, nt);
          if (step && c + step <= r) reach(nt, c + step);
        }
      }
      list.length = 0;
    }
    return;
  }
  // Below: the 3×3 tiles above; the vents: the floor within 2 tiles below; a roof: the open ground
  // around. Each costs its distance across and down, so a guard sent there can walk towards it.
  const span = layer === LAYER.UNDER ? 1 : layer === LAYER.VENTS ? 2 : r;
  for (let dz = -span; dz <= span; dz++)
    for (let dx = -span; dx <= span; dx++) {
      const x = x0 + dx;
      const z = z0 + dz;
      if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
      const t = z * MAP_W + x;
      const info = TILE_INFO[w.ground.kind[t]];
      if (info.opaque || (layer === LAYER.ROOF && !info.outdoor)) continue;
      cost[t] = Math.abs(dx) + Math.abs(dz);
      reached.push(t);
    }
}

/** The ground tile a guard stands on. */
const tileOfGuard = (g: Guard) => tileAt(g.body.x, g.body.z);

/**
 * Whether a guard dozing at its nap stop (P15) wakes to the last noise worked out: a bang
 * anywhere in earshot, anything else NAP_WAKE tiles short of its reach.
 */
const stirs = (g: Guard, n: number, bang: boolean) => g.doze > 0 && g.ko <= 0 && cost[tileOfGuard(g)] >= 0 && (bang || cost[tileOfGuard(g)] <= n - spare);

/** The tiles to spare a noise needs to wake a dozing guard: NAP_WAKE, none on a Light Sleepers Daily (P26). Set from the state as each noise is worked out. */
let spare = NAP_WAKE;
const spareFor = (sim: SimContext) => (spare = twist(sim.state, 'lightSleepers') ? 0 : NAP_WAKE);

/**
 * The guards awake within earshot of the last noise worked out (guard indexes), nearest first
 * (ties: the lower index), with those a noise this loud would wake from a doze; with `wake`,
 * those asleep too (a bang wakes them).
 */
function listeners(guards: readonly Guard[], out: number[], n: number, wake = false): number[] {
  out.length = 0;
  guards.forEach((g, k) => {
    if ((awake(g) || (wake && g.ko <= 0) || stirs(g, n, wake)) && cost[tileOfGuard(g)] >= 0) out.push(k);
  });
  out.sort((a, b) => cost[tileOfGuard(guards[a])] - cost[tileOfGuard(guards[b])] || a - b);
  return out;
}

/** Where a guard who heard the last noise goes to look: back along the way it came, as far as a guard can walk. */
function lookSpot(w: World, from: number): number {
  let at = from;
  for (;;) {
    const x = at % MAP_W;
    const z = Math.floor(at / MAP_W);
    let best = -1;
    let bestCost = cost[at];
    for (let d = 0; d < 4; d++) {
      const nx = x + (d === 1 ? 1 : d === 3 ? -1 : 0);
      const nz = z + (d === 2 ? 1 : d === 0 ? -1 : 0);
      if (nx < 0 || nz < 0 || nx >= MAP_W || nz >= MAP_H) continue;
      const nt = nz * MAP_W + nx;
      if (cost[nt] >= 0 && cost[nt] < bestCost && !w.guardBlock[nt]) {
        best = nt;
        bestCost = cost[nt];
      }
    }
    if (best < 0) return at;
    at = best;
  }
}

const heardScratch: number[] = [];

/** The guards awake who would hear a noise made now (guard indexes, nearest first), in `out`; a bang's (`wake`) wakes those asleep too. */
export function hearers(sim: SimContext, n: NoiseAt | null, out: number[] = [], wake = false): number[] {
  out.length = 0;
  if (!n) return out;
  spareFor(sim);
  const reach = muffled(sim, n.layer, n.tile, n.reach);
  spread(sim.world, { layer: n.layer, tile: n.tile, reach });
  return listeners(sim.state.guards, out, reach, wake);
}

/** Whether a guard awake would hear a noise made now (the ear on the tool button). */
export const wouldHear = (sim: SimContext, n: NoiseAt | null) => hearers(sim, n, heardScratch).length > 0;

/** The ground tiles a noise made now would reach (the aim's preview), in `out`. */
export function earshot(sim: SimContext, n: NoiseAt | null, out: number[] = []): number[] {
  out.length = 0;
  if (!n) return out;
  spread(sim.world, { layer: n.layer, tile: n.tile, reach: muffled(sim, n.layer, n.tile, n.reach) });
  for (const t of reached) out.push(t);
  return out;
}

/**
 * A noise made: the guards awake within earshot hear it, and the nearest (not already chasing
 * the player) go and look, unless one is already looking close by. A bang first wakes the
 * guards asleep within earshot, sends more of them, whoever is looking already, and keeps them
 * looking longer. (`send` and `look`, P20: how many guards a noise sends at most, and how long
 * they look; 0 as the kind says.)
 */
export function makeNoise(sim: SimContext, kind: NoiseKind, layer: number, tile: number, loud: number, send = 0, look = 0) {
  if (tile < 0 || loud <= 0) return;
  spareFor(sim);
  // (P17: the rain, a storm, the film's soundtrack drown it.)
  const n = muffled(sim, layer, tile, loud);
  const w = sim.world;
  const guards = sim.state.guards;
  spread(w, { layer, tile, reach: n });
  const bang = kind === 'bang';
  if (bang) for (const g of guards) if (g.doing === DOING.SLEEP && g.ko <= 0 && cost[tileOfGuard(g)] >= 0) g.doing = DOING.NOTHING;
  // Dozing at a nap stop (P15): loud enough and close enough, it wakes.
  guards.forEach((g, k) => {
    if (stirs(g, n, bang) && rouse(g)) sim.events.push({ type: 'nap', guard: k, on: false });
  });
  const heard = listeners(guards, [], n);
  const sent: number[] = [];
  // A guard already looking close by is enough for a strike, a thud or a ring (a bang brings them all the same).
  const looking = !bang && guards.some((g) => g.mode === GUARD.INVESTIGATE && g.target >= 0 && chebTiles(g.target, tile) <= LOOK_NEAR);
  if (!looking) {
    for (const k of heard) {
      if (sent.length >= (send || (bang ? BANG_GUARDS : NOISE_GUARDS))) break;
      const g = guards[k];
      if (g.mode === GUARD.CHASE) continue;
      sendToLook(g, lookSpot(w, tileOfGuard(g)), look || (bang ? BANG_LOOK : NOISE_LOOK));
      sent.push(k);
    }
  }
  sim.events.push({ type: 'noise', kind, layer, tile, reach: n, tiles: reached.slice(), heard, sent });
}

// ------------------------------------------------------------------ tools at work

/**
 * The noise a strike makes (null: none): how far it carries by what the tool does, a tile less
 * for plastic and one more for a sturdy, powered or multi tool; heard from the floor broken
 * open from below, and from wherever the player works a grate.
 */
export function strikeNoise(layer: number, target: ToolTarget | null, held: number): NoiseAt | null {
  if (!target) return null;
  const base = (STRIKE_NOISE as Record<string, number>)[target.action];
  if (!base) return null;
  const tool = held ? itemDef(held) : null;
  const tier = tool?.tool ? (tool.id.startsWith('plastic_') ? -1 : tool.tool.tier >= 3 ? 1 : 0) : 0;
  const at = target.action === 'digUp' ? LAYER.GROUND : target.action === 'unscrew' ? layer : target.layer;
  return { layer: at, tile: target.tile, reach: base + tier };
}

// ------------------------------------------------------------------ the alarm clock and the firecracker

/**
 * An alarm clock's slot carries its state in its uses: 0 stopped, 1–60 the seconds before it
 * rings, above that ringing (the seconds of it left, over 60).
 */
export const clockSecs = (v: number) => (usesOf(v) <= WIND_MAX ? usesOf(v) : 0);
export const clockRinging = (v: number) => usesOf(v) > WIND_MAX;

/** The alarm clock in hand wound (20 s a press, a minute at most); ringing, a press stops it. */
export function wind(sim: SimContext) {
  const it = sim.state.items;
  const v = it.inv[it.hand];
  const secs = clockRinging(v) ? 0 : Math.min(WIND_MAX, usesOf(v) + WIND_SECONDS);
  it.inv[it.hand] = slot(ALARM_CLOCK, secs);
  it.rev++;
  sim.events.push({ type: 'wound', secs });
}

/** A second of an alarm clock's life where it is (layer, tile): counting down, starting to ring, ringing. Returns its slot. */
function tick(sim: SimContext, v: number, layer: number, tile: number): number {
  let left = usesOf(v);
  if (left <= WIND_MAX) {
    if (--left > 0) return slot(ALARM_CLOCK, left);
    left = WIND_MAX + RING_SECONDS;
  }
  sim.events.push({ type: 'ringing', layer, tile, left: left - WIND_MAX });
  makeNoise(sim, 'ring', layer, tile, RING_NOISE);
  left--;
  return slot(ALARM_CLOCK, left === WIND_MAX ? 0 : left);
}

const ticking = (v: number) => itemOf(v) === ALARM_CLOCK && usesOf(v) > 0;

/**
 * Before anyone moves, each step: a firecracker whose fuse has burnt down goes off; once a
 * second, every alarm clock wound counts down (or rings) wherever it is: the player's pockets,
 * furniture, someone's pockets, the floor.
 */
export function noisemakers(sim: SimContext) {
  const s = sim.state;
  for (let k = 0; k < s.fuses.length; ) {
    const [key, at] = s.fuses[k];
    if (s.step < at) {
      k++;
      continue;
    }
    s.fuses.splice(k, 1);
    sim.events.push({ type: 'bang', tile: tileOfKey(key) });
    makeNoise(sim, 'bang', layerOfKey(key), tileOfKey(key), BANG_NOISE);
  }
  if (s.step % STEPS_PER_SECOND !== 0) return;
  // (No item revision bump: a clock's countdown changes nothing to redraw; the item bar shows its face in place.)
  const it = s.items;
  const w = sim.world;
  const here = tileOfBody(s.player);
  for (let k = 0; k < it.inv.length; k++) {
    if (ticking(it.inv[k])) it.inv[k] = tick(sim, it.inv[k], s.layer, here.z * MAP_W + here.x);
  }
  const furniture = containersOf(w);
  it.containers.forEach((slots, c) => {
    for (let k = 0; k < slots.length; k++) {
      if (!ticking(slots[k])) continue;
      const owner = ownerOf(w, c);
      const body = owner < 0 ? null : owner < s.inmates.length ? s.inmates[owner].body : s.guards[owner - s.inmates.length]?.body;
      const prop = furniture[c]?.prop;
      const tile = body ? tileAt(body.x, body.z) : prop ? prop.z * MAP_W + prop.x : -1;
      slots[k] = tick(sim, slots[k], LAYER.GROUND, tile);
    }
  });
  for (const g of it.ground) if (ticking(g[1])) g[1] = tick(sim, g[1], layerOfKey(g[0]), tileOfKey(g[0]));
}
