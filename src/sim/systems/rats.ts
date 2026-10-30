/**
 * The pet rat (P20). A rat trap (a cup propped over potato, chocolate or jerky) left on the
 * floor catches a rat at 04:00: often in a kitchen, canteen or storeroom (TRAP_KITCHEN), more
 * often down a tunnel (TRAP_TUNNEL), never anywhere else. Fed twice (RAT_MEALS), the caught rat
 * is the player's: it rides on their shoulder from then on, through everything.
 *
 * - **Errands:** sent from the ground floor to a container that isn't the player's, or to the
 *   pockets of someone asleep or out cold, at most RAT_REACH tiles of its way (it runs under
 *   doors and along the ducts over walls), it brings back the most valuable small thing there
 *   (ItemDef.small) and any change, or leaves the small item the player had in hand. Back, it
 *   finds the player wherever they are on the ground floor (or waits for them there).
 * - **Let loose** among PANIC_PEOPLE people or more (in sight, close by), once a prison day:
 *   a panic for PANIC_STEPS. Inmates flee it; its squeaks carry SQUEAK_NOISE tiles and draw up
 *   to SQUEAK_GUARDS guards to look. A caught rat thrown into a crowd does the same, and is
 *   gone after. Dogs on shift go after any rat they see running (k9.ts).
 * - **Keys:** a guard who wakes (from his bed or a nap) without his key radios it in, as one
 *   coming round does (fights.ts wokeKeyless): the alarm. A key the rat took from a sleeper
 *   and put back before he woke is never missed.
 */
import { itemDef, itemNumber } from '../../content/items';
import { zoneIndex, type ZoneId } from '../../content/zones';
import { nearestDir } from '../ai/path';
import { centerX, centerZ, tileAt } from '../world/grid';
import { lineOfSight } from '../ai/sight';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import { PANIC_PEOPLE, PANIC_RANGE, PANIC_STEPS, RAT_HOME, RAT_MEALS, RAT_REACH, RAT_SPEED, SQUEAK_GUARDS, SQUEAK_NOISE, STEPS_PER_MINUTE, TRAP_KITCHEN, TRAP_MINUTE, TRAP_TUNNEL, UNIT } from '../tuning';
import { containersOf } from '../world/containers';
import { TILE, TILE_INFO } from '../world/tiles';
import { LAYER, layerOfKey, MAP_H, MAP_W, tileOfKey, type World } from '../world/World';
import { clockAt, prisonDay } from './clock';
import { awake, type Guard } from './guards';
import { DOING, type Inmate } from './inmates';
import { freeHotbar, giveSlot, guardKit, HOTBAR, itemOf, ownerOf, pocketOf, slot, usesOf } from './items';
import { makeNoise } from './noise';
import { RAT_START_SPEED } from '../../content/long';
import { playerAbout } from './presence';

/** What a rat is up to. Never renumber: saves store them. */
export const RAT = {
  /** On the player's shoulder, wherever they go. */
  SHOULDER: 0,
  /** Running its errand. */
  OUT: 1,
  /** Coming back to the player (with what it took, or what it couldn't leave). */
  BACK: 2,
  /** Let loose: darting about where it was let go, people fleeing it. */
  LOOSE: 3,
  /** Waiting where it is (out of sight) for the player to be about on the ground floor again. */
  WAIT: 4,
} as const;

/** A rat: the player's pet, or a caught one thrown loose (wild). Plain data, part of the simulation state. */
export interface Rat {
  mode: number;
  /** Where it is on the ground floor (units; on the shoulder, where it last got down) and its heading. */
  x: number;
  z: number;
  facing: number;
  /** Its way (tiles) and the one it's making for next. */
  path: number[];
  at: number;
  /** The errand's container (furniture, or someone's pockets: a containers index; -1 none), and whether it's to leave what it carries there. */
  target: number;
  leave: boolean;
  /** What it carries (a slot, 0 nothing) and the change it picked up. */
  carry: number;
  cash: number;
  /** Let loose: the tile it was let go on, and the step its panic is over. */
  tile: number;
  until: number;
  /** A caught rat thrown loose: gone once its panic is over. */
  wild: boolean;
  /** The prison day the pet last ran loose (once a day). */
  looseDay: number;
  /** P28 (races.ts): the pet's speed on the track (0–100), the prison day it was last fed (on the track), the step its laps there end. */
  speed?: number;
  fed?: number;
  lap?: number;
}

export const RAT_TRAP = itemNumber('rat_trap');
export const CAUGHT_RAT = itemNumber('caught_rat');
/** What a caught rat eats (the first found in the hotbar, in this order) and a trap is baited with. */
const BAIT: readonly number[] = ['potato', 'chocolate', 'jerky'].map(itemNumber);
/** Where rats come to a trap on the ground floor (TRAP_KITCHEN). */
export const RAT_ROOMS: readonly ZoneId[] = ['kitchen', 'canteen', 'storeroom'];
const ROOMS = new Set(RAT_ROOMS.map(zoneIndex));
const OUTSIDE = zoneIndex('outside');

/** The player's own rat, if they have tamed one. */
export const petOf = (s: { rats: readonly Rat[] }): Rat | undefined => s.rats.find((r) => !r.wild);

/** The chance (percent) a rat trap left here catches a rat at 04:00: a placeKey's layer and tile. */
export function trapChance(w: World, layer: number, tile: number): number {
  if (layer === LAYER.UNDER) return TRAP_TUNNEL;
  return layer === LAYER.GROUND && ROOMS.has(w.ground.zone[tile]) ? TRAP_KITCHEN : 0;
}

/** Where a rat can run on the ground floor: any floor, under any door, over a wall or fence where a duct runs above it; never outside the walls. */
function ratWay(w: World, t: number): boolean {
  if (w.ground.zone[t] === OUTSIDE) return false;
  const k = w.ground.kind[t];
  if (k === TILE.DOOR || !TILE_INFO[k].solid) return k !== TILE.WATER;
  const v = w.layers[LAYER.VENTS].kind[t];
  return v === TILE.DUCT || v === TILE.GRATE || v === TILE.GRATE_OPEN || v === TILE.GRATE_FAKE || v === TILE.LADDER;
}

/** In a duct over a wall (the view lifts it there), not on the floor. */
export const inDuct = (w: World, t: number) => TILE_INFO[w.ground.kind[t]].solid && w.ground.kind[t] !== TILE.DOOR;

// ------------------------------------------------------------------ its way

/** Each tile's distance along a rat's way from the last search's start (-1 not reached), the tiles reached, and the way back. Refilled; not state. */
const dist = new Int16Array(MAP_W * MAP_H).fill(-1);
const prev = new Int32Array(MAP_W * MAP_H);
const queue: number[] = [];

/** A breadth-first search along a rat's way from a tile, `limit` tiles at most (stopping early at `goal`, if given; `floor`: never into a duct over a wall). Fills `dist`. */
function search(w: World, from: number, limit: number, goal = -1, floor = false) {
  for (const t of queue) dist[t] = -1;
  queue.length = 0;
  if (from < 0) return;
  dist[from] = 0;
  queue.push(from);
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i];
    if (t === goal) return;
    if (dist[t] >= limit) continue;
    const x = t % MAP_W;
    const z = Math.floor(t / MAP_W);
    for (let d = 0; d < 4; d++) {
      const nx = x + (d === 1 ? 1 : d === 3 ? -1 : 0);
      const nz = z + (d === 2 ? 1 : d === 0 ? -1 : 0);
      if (nx < 0 || nz < 0 || nx >= MAP_W || nz >= MAP_H) continue;
      const n = nz * MAP_W + nx;
      if (dist[n] >= 0 || !ratWay(w, n) || (floor && inDuct(w, n))) continue;
      dist[n] = dist[t] + 1;
      prev[n] = t;
      queue.push(n);
    }
  }
}

/** A rat's way from one tile to another (both included), `limit` tiles at most; null without one. */
export function ratPath(w: World, from: number, to: number, limit: number, floor = false): number[] | null {
  search(w, from, limit, to, floor);
  if (to < 0 || dist[to] < 0) return null;
  const out: number[] = [];
  for (let t = to; t !== from; t = prev[t]) out.push(t);
  out.push(from);
  return out.reverse();
}

// ------------------------------------------------------------------ errands

/** Somewhere the rat can be sent: a container (furniture, or the pockets of `who`, a Cast id, -1 furniture), the tile it runs to, how far. */
export interface RatTarget {
  container: number;
  who: number;
  tile: number;
  dist: number;
}

/** Asleep (in bed, dozing at a nap stop) or out cold: someone whose pockets a rat can go through. */
function sleeper(s: { inmates: readonly Inmate[]; guards: readonly Guard[] }, who: number): boolean {
  const n = s.inmates.length;
  if (who < n) {
    const m = s.inmates[who];
    return !!m && (m.ko > 0 || m.doing === DOING.SLEEP);
  }
  const g = s.guards[who - n];
  return !!g && !awake(g);
}

/** The player up and about on the ground floor (not hidden, out cold, in solitary). */

/** Where the player stands (a ground tile). */
const playerTile = (sim: SimContext) => tileAt(sim.state.player.x, sim.state.player.z);

/**
 * Where the rat on the player's shoulder could be sent now (nearest first; the same order every
 * time): containers that aren't the player's, the pockets of anyone asleep or out cold, each
 * within RAT_REACH tiles of its way. Empty while it can't be sent (no rat, out already, the
 * player not up and about on the ground floor).
 */
export function ratTargets(sim: SimContext, out: RatTarget[] = []): RatTarget[] {
  out.length = 0;
  const s = sim.state;
  const pet = petOf(s);
  if (!pet || pet.mode !== RAT.SHOULDER || !playerAbout(sim) || s.sleeping) return out;
  const w = sim.world;
  search(w, playerTile(sim), RAT_REACH);
  containersOf(w).forEach((c, i) => {
    if (c.mine) return;
    const p = c.prop;
    let best = -1;
    for (let z = p.z; z < p.z + p.d; z++)
      for (let x = p.x; x < p.x + p.w; x++) {
        const t = z * MAP_W + x;
        if (dist[t] >= 0 && (best < 0 || dist[t] < dist[best])) best = t;
      }
    if (best >= 0) out.push({ container: i, who: -1, tile: best, dist: dist[best] });
  });
  const people = s.inmates.length + s.guards.length;
  for (let who = 0; who < people; who++) {
    if (!sleeper(s, who)) continue;
    const b = who < s.inmates.length ? s.inmates[who].body : s.guards[who - s.inmates.length].body;
    const t = tileAt(b.x, b.z);
    if (dist[t] >= 0) out.push({ container: pocketOf(w, who), who, tile: t, dist: dist[t] });
  }
  out.sort((a, b) => a.dist - b.dist || a.container - b.container);
  return out;
}

const targetScratch: RatTarget[] = [];

/** Why the rat couldn't be sent or let loose (i18n `rat.<why>`). */
export type RatRefusal = 'far' | 'big' | 'few' | 'tired' | 'awake';

/**
 * The rat sent on an errand (OP.EXT RAT_FETCH, RAT_LEAVE): to a container within its reach,
 * to fetch, or to leave the small item in the player's hand there.
 */
export function sendRat(sim: SimContext, container: number, leave: boolean) {
  const s = sim.state;
  const it = s.items;
  const pet = petOf(s);
  if (!pet || pet.mode !== RAT.SHOULDER || !playerAbout(sim) || s.sleeping) return;
  const held = it.inv[it.hand];
  if (leave && (it.hand >= HOTBAR || !held || !itemDef(itemOf(held)).small)) return refuse(sim, 'big');
  const to = ratTargets(sim, targetScratch).find((x) => x.container === container);
  // (Someone's pockets, but they're up now: that, not the distance.)
  const owner = ownerOf(sim.world, container);
  if (!to) return refuse(sim, owner >= 0 && !sleeper(s, owner) ? 'awake' : 'far');
  const p = s.player;
  const path = ratPath(sim.world, playerTile(sim), to.tile, RAT_REACH);
  if (!path) return refuse(sim, 'far');
  pet.mode = RAT.OUT;
  pet.x = p.x;
  pet.z = p.z;
  pet.facing = p.facing;
  pet.path = path;
  pet.at = 1;
  pet.target = container;
  pet.leave = leave;
  pet.cash = 0;
  if (leave) {
    pet.carry = held;
    it.inv[it.hand] = 0;
    it.rev++;
  }
  sim.events.push({ type: 'rat', what: 'sent', item: leave ? itemOf(held) : 0, who: to.who, container });
}

function refuse(sim: SimContext, why: RatRefusal, n?: number) {
  sim.events.push({ type: 'rat', what: 'refused', why, n });
}

/** Everyone awake within PANIC_RANGE of a tile, in sight of it: who a rat let loose there would scare. */
export function crowdAt(sim: SimContext, tile: number): number {
  const s = sim.state;
  const w = sim.world;
  const x = centerX(tile);
  const z = centerZ(tile);
  let n = 0;
  const near = (bx: number, bz: number) => (bx - x) ** 2 + (bz - z) ** 2 <= PANIC_RANGE * PANIC_RANGE && lineOfSight(w, x, z, bx, bz);
  for (const m of s.inmates) if (m.ko <= 0 && m.doing !== DOING.SLEEP && near(m.body.x, m.body.z)) n++;
  for (const g of s.guards) if (awake(g) && near(g.body.x, g.body.z)) n++;
  return n;
}

/** Why the rat on the player's shoulder can't be let loose here now (null: it can). */
export function looseCheck(sim: SimContext): { why: RatRefusal | null; n: number } {
  const s = sim.state;
  const n = crowdAt(sim, playerTile(sim));
  const pet = petOf(s);
  if (pet && pet.looseDay === prisonDay(s.step)) return { why: 'tired', n };
  return { why: n < PANIC_PEOPLE ? 'few' : null, n };
}

/** The rat on the player's shoulder let loose at their feet (OP.EXT RAT_LOOSE): a panic, among enough people, once a prison day. */
export function looseRat(sim: SimContext) {
  const s = sim.state;
  const pet = petOf(s);
  if (!pet || pet.mode !== RAT.SHOULDER || !playerAbout(sim) || s.sleeping) return;
  const { why, n } = looseCheck(sim);
  if (why) return refuse(sim, why, n);
  pet.looseDay = prisonDay(s.step);
  panic(sim, pet, playerTile(sim), s.player.x, s.player.z, n);
}

/**
 * A caught rat thrown (noise.ts throwItem): loose where it lands, a panic there among enough
 * people; either way, gone for good once it's over (it never comes to anyone).
 */
export function throwRat(sim: SimContext, tile: number) {
  const n = crowdAt(sim, tile);
  if (n < PANIC_PEOPLE) {
    sim.events.push({ type: 'rat', what: 'gone', n });
    return;
  }
  const r = newRat(true, centerX(tile), centerZ(tile));
  sim.state.rats.push(r);
  panic(sim, r, tile, r.x, r.z, n);
}

export function newRat(wild: boolean, x: number, z: number): Rat {
  const r: Rat = { mode: RAT.SHOULDER, x, z, facing: 5, path: [], at: 0, target: -1, leave: false, carry: 0, cash: 0, tile: -1, until: 0, wild, looseDay: 0 };
  // (P28: a pet's racing form, from the start.)
  return wild ? r : Object.assign(r, { speed: RAT_START_SPEED, fed: 0, lap: 0 });
}

/** A panic: the rat darting about where it was let go, its squeaks bringing guards to look. */
function panic(sim: SimContext, r: Rat, tile: number, x: number, z: number, n: number) {
  const s = sim.state;
  r.mode = RAT.LOOSE;
  r.x = x;
  r.z = z;
  r.tile = tile;
  r.until = s.step + PANIC_STEPS;
  r.path = [];
  r.at = 0;
  sim.events.push({ type: 'rat', what: 'loose', n, wild: r.wild });
  makeNoise(sim, 'squeak', LAYER.GROUND, tile, SQUEAK_NOISE, SQUEAK_GUARDS, PANIC_STEPS);
}

/**
 * A caught rat fed (the 'feed' tool action, the caught rat in hand): the first bait in the
 * hotbar eaten; at its RAT_MEALS-th meal, tame: on the player's shoulder from now on.
 */
export function feedRat(sim: SimContext) {
  const s = sim.state;
  const it = s.items;
  if (itemOf(it.inv[it.hand]) !== CAUGHT_RAT) return;
  if (petOf(s)) {
    sim.events.push({ type: 'rat', what: 'haveOne' });
    return;
  }
  const k = baitSlot(it.inv);
  if (k < 0) {
    sim.events.push({ type: 'rat', what: 'hungry' });
    return;
  }
  const food = itemOf(it.inv[k]);
  it.inv[k] = 0;
  const meals = usesOf(it.inv[it.hand]) + 1;
  it.rev++;
  if (meals < RAT_MEALS) {
    it.inv[it.hand] = slot(CAUGHT_RAT, meals);
    sim.events.push({ type: 'rat', what: 'fed', item: food, n: meals });
    return;
  }
  it.inv[it.hand] = 0;
  s.rats.unshift(newRat(false, s.player.x, s.player.z));
  sim.events.push({ type: 'rat', what: 'tamed', item: food });
}

/** The hotbar slot whose bait a caught rat would eat (-1: none there). */
export function baitSlot(inv: readonly number[]): number {
  for (const n of BAIT)
    for (let k = 0; k < HOTBAR; k++) if (itemOf(inv[k]) === n) return k;
  return -1;
}

// ------------------------------------------------------------------ each step

/**
 * The rats' step (after the dogs): at 04:00 the traps left out are checked; each rat out runs
 * its way, does its errand, comes back, darts about in its panic or waits for the player.
 */
export function rats(sim: SimContext) {
  const s = sim.state;
  if (s.step % STEPS_PER_MINUTE === 0 && clockAt(s.step).minuteOfDay === TRAP_MINUTE) traps(sim);
  for (let k = 0; k < s.rats.length; ) {
    if (stepRat(sim, s.rats[k])) s.rats.splice(k, 1);
    else k++;
  }
}

/** 04:00: every rat trap on a floor may have caught a rat (drawn with roll(): never the RNG). */
function traps(sim: SimContext) {
  const s = sim.state;
  const ground = s.items.ground;
  const day = prisonDay(s.step);
  for (let k = 0; k < ground.length; k++) {
    const [key, v] = ground[k];
    if (itemOf(v) !== RAT_TRAP) continue;
    // (Two traps on one tile each have their own chance.)
    let nth = 0;
    for (let j = 0; j < k; j++) if (ground[j][0] === key && itemOf(ground[j][1]) === RAT_TRAP) nth++;
    const chance = trapChance(sim.world, layerOfKey(key), tileOfKey(key));
    if (rollInt(s.salt, SALT.TRAPS, day, key * 8 + nth, 100) >= chance) continue;
    ground[k][1] = slot(CAUGHT_RAT, 0);
    s.items.rev++;
    sim.events.push({ type: 'rat', what: 'caught', at: key });
  }
}

/** One step of a rat. Returns true once it's gone (a wild rat after its panic). */
function stepRat(sim: SimContext, r: Rat): boolean {
  const s = sim.state;
  switch (r.mode) {
    case RAT.OUT:
      if (run(r, RAT_SPEED)) errand(sim, r);
      return false;
    case RAT.BACK: {
      if (!playerAbout(sim)) {
        r.mode = RAT.WAIT;
        return false;
      }
      // The player moved on: a new way to them now and then.
      const goal = playerTile(sim);
      if (s.step % 10 === 0 && r.path[r.path.length - 1] !== goal) headHome(sim, r);
      if (r.mode === RAT.BACK && run(r, RAT_SPEED)) {
        const p = s.player;
        if ((p.x - r.x) ** 2 + (p.z - r.z) ** 2 <= (UNIT * 3) ** 2 / 4) home(sim, r);
        else headHome(sim, r);
      }
      return false;
    }
    case RAT.WAIT:
      if (s.step % 20 === 0 && playerAbout(sim)) headHome(sim, r);
      return false;
    case RAT.LOOSE:
      if (s.step >= r.until) {
        sim.events.push({ type: 'rat', what: 'calm', wild: r.wild });
        if (r.wild) return true;
        headHome(sim, r);
        return false;
      }
      scurry(sim, r);
      return false;
  }
  return false;
}

/**
 * Runs along its way at a pace (units a step), from where it is to each tile's middle in turn.
 * Returns true once it's at the end.
 */
function run(r: Rat, speed: number): boolean {
  let left = speed;
  while (left > 0 && r.at < r.path.length) {
    const t = r.path[r.at];
    const dx = centerX(t) - r.x;
    const dz = centerZ(t) - r.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 0) r.facing = nearestDir(dx, dz);
    if (d <= left) {
      r.x = centerX(t);
      r.z = centerZ(t);
      left -= d;
      r.at++;
    } else {
      r.x += Math.trunc((dx * left) / d);
      r.z += Math.trunc((dz * left) / d);
      left = 0;
    }
  }
  return r.at >= r.path.length;
}

/**
 * At the errand's container: what it carries left in a free slot (the furniture's own, never a
 * hidden compartment), or the most valuable small thing there taken (the first of equals) and
 * any change. Someone's pockets only while they're still asleep or out cold. Then back.
 */
function errand(sim: SimContext, r: Rat) {
  const s = sim.state;
  const w = sim.world;
  const c = r.target;
  const who = ownerOf(w, c);
  r.target = -1;
  if (who >= 0 && !sleeper(s, who)) {
    sim.events.push({ type: 'rat', what: 'woke', who, item: itemOf(r.carry) });
    return headHome(sim, r);
  }
  const slots = s.items.containers[c];
  const from = who >= 0 ? 0 : containersOf(w)[c].hidden;
  if (r.leave) {
    const free = slots.indexOf(0, from);
    if (free < 0) sim.events.push({ type: 'rat', what: 'full', item: itemOf(r.carry), who, container: c });
    else {
      // A guard's own key back in the pockets it went missing from, while he sleeps: a heist (not one he had a spare of, nor one knocked out).
      const g = who >= s.inmates.length ? s.guards[who - s.inmates.length] : null;
      const own = !!g && itemOf(r.carry) === guardKit(w, who - s.inmates.length)[0];
      const heist = own && g!.ko <= 0 && !slots.some((v) => itemOf(v) === itemOf(r.carry));
      slots[free] = r.carry;
      sim.events.push({ type: 'rat', what: 'left', item: itemOf(r.carry), who, container: c, heist });
      r.carry = 0;
      s.items.rev++;
    }
    return headHome(sim, r);
  }
  let best = -1;
  for (let k = from; k < slots.length; k++) {
    const d = itemDef(itemOf(slots[k]));
    if (d?.small && (best < 0 || d.value > itemDef(itemOf(slots[best])).value)) best = k;
  }
  if (best >= 0) {
    r.carry = slots[best];
    slots[best] = 0;
    s.items.rev++;
  }
  const cash = s.coins[c] ?? 0;
  if (cash) {
    delete s.coins[c];
    r.cash = cash;
  }
  sim.events.push(best >= 0 || cash ? { type: 'rat', what: 'took', item: itemOf(r.carry), cash, who, container: c } : { type: 'rat', what: 'empty', who, container: c });
  headHome(sim, r);
}

/** Back to the player along its way (RAT_HOME tiles at most), or waiting where it is for them. */
function headHome(sim: SimContext, r: Rat) {
  if (!playerAbout(sim)) {
    r.mode = RAT.WAIT;
    return;
  }
  const from = tileAt(r.x, r.z);
  const path = ratPath(sim.world, from, playerTile(sim), RAT_HOME);
  if (!path) {
    r.mode = RAT.WAIT;
    r.path = [];
    return;
  }
  r.mode = RAT.BACK;
  r.path = path;
  r.at = path.length > 1 ? 1 : 0;
}

/** Back on the player's shoulder: what it brought into the hotbar (else at their feet), the change into their pocket. */
function home(sim: SimContext, r: Rat) {
  const s = sim.state;
  const item = itemOf(r.carry);
  // (A full hotbar: at their feet, and the toast says so.)
  const floor = !!r.carry && freeHotbar(s.items.inv) < 0;
  if (r.carry) {
    // (A full pile at their feet too: it drops it there all the same.)
    if (!giveSlot(s.items, r.carry, s.player, s.layer)) s.items.ground.push([tileAt(s.player.x, s.player.z), r.carry]);
    s.items.rev++;
  }
  const cash = r.cash;
  if (cash) {
    s.cash += cash;
    s.tally[3] += cash;
    sim.events.push({ type: 'cash', n: cash, why: 'loot' });
  }
  r.carry = 0;
  r.cash = 0;
  r.mode = RAT.SHOULDER;
  r.path = [];
  r.at = 0;
  sim.events.push({ type: 'rat', what: 'home', item, cash, floor });
}

/** Loose: darting from one spot to another on the floor within 2 tiles of its way from where it was let go (never through a wall). */
function scurry(sim: SimContext, r: Rat) {
  const s = sim.state;
  const w = sim.world;
  if (r.at >= r.path.length) {
    // (Spots on the floor within 2 steps of it, by floor alone: never through a wall's duct into the next room.)
    const spots: number[] = [r.tile];
    for (let k = 0; k < spots.length; k++) {
      const t = spots[k];
      const d = Math.abs((t % MAP_W) - (r.tile % MAP_W)) + Math.abs(Math.floor(t / MAP_W) - Math.floor(r.tile / MAP_W));
      if (d >= 2) continue;
      for (const n of [t - MAP_W, t + 1, t + MAP_W, t - 1]) if (n >= 0 && n < MAP_W * MAP_H && Math.abs((n % MAP_W) - (t % MAP_W)) <= 1 && !spots.includes(n) && ratWay(w, n) && !inDuct(w, n)) spots.push(n);
    }
    const to = spots.length ? spots[rollInt(s.salt, SALT.SCURRY, s.step, r.tile, spots.length)] : r.tile;
    r.path = ratPath(w, tileAt(r.x, r.z), to, 8, true) ?? [tileAt(r.x, r.z)];
    r.at = r.path.length > 1 ? 1 : 0;
  }
  run(r, (RAT_SPEED * 3) >> 2);
}

/**
 * A dog after a rat (k9.ts): on its errand, it gives it up and bolts back to the player with
 * whatever it carries (a rat loose keeps darting about: the panic goes on).
 */
export function chaseOff(sim: SimContext, r: Rat) {
  if (r.mode !== RAT.OUT) return;
  r.target = -1;
  // (What it was to leave comes back with it.)
  sim.events.push({ type: 'rat', what: 'chased', item: itemOf(r.carry) });
  headHome(sim, r);
}

/** Rats running loose or on an errand (in sight of anyone: not on a shoulder, not waiting out of sight). */
export const ratOut = (r: Rat) => r.mode === RAT.OUT || r.mode === RAT.BACK || r.mode === RAT.LOOSE;
