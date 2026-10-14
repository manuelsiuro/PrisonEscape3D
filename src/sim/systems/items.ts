import { itemDef, itemNumber, ITEMS } from '../../content/items';
import { LOOT } from '../../content/loot';
import { choices, RECIPES } from '../../content/recipes';
import { DIR_X, DIR_Z, SLOT } from '../command';
import { randomInt } from '../rng';
import { UNIT } from '../tuning';
import { containersOf, type ContainerInfo } from '../world/containers';
import { MAP_W, type World } from '../world/World';
import type { Body } from './movement';

/**
 * Items in the simulation (GDD §6, §8). A slot is one number: the item (ITEMS order + 1)
 * in the low 8 bits, uses left above (tools and keys wear out). 0 is an empty slot. The
 * player carries 6 hotbar slots, a weapon slot and an outfit slot; containers (desks, beds,
 * toilets…) hold the rest; dropped items lie on the floor.
 */
export const slot = (item: number, uses = itemDef(item)?.uses ?? 0) => item | (uses << 8);
export const itemOf = (v: number) => v & 255;
export const usesOf = (v: number) => v >>> 8;

export const HOTBAR = 6;
/** Starting Intellect (GDD §3.2; training arrives in P6). */
export const START_INT = 40;
/** How close the player must be to use something (units from the body's middle to its footprint). */
export const REACH = Math.round(UNIT * 0.85);
const PICKUP_REACH = Math.round(UNIT * 0.8);

/** Everything about items in the state. */
export interface ItemState {
  /** Hotbar 0–5, weapon, outfit. */
  inv: number[];
  /** Hotbar slot held in hand. */
  hand: number;
  /** The open container (index into containersOf), -1 for none. */
  open: number;
  /** Each container's slots. */
  containers: number[][];
  /** Items on the floor: [tile index, slot]. */
  ground: Array<[number, number]>;
  /** Recipes crafted at least once (the handbook), by RECIPES index. */
  known: number[];
  int: number;
  /** Bumped whenever anything above changes (the UI redraws on it). */
  rev: number;
}

export type ItemEvent =
  | { type: 'pickup'; item: number }
  | { type: 'drop'; item: number }
  | { type: 'crafted'; item: number; recipe: number; first: boolean }
  | { type: 'open'; container: number }
  | { type: 'close' }
  | { type: 'restock' }
  | { type: 'full' };

export function startItems(w: World, rng: { rng: number }): ItemState {
  const list = containersOf(w);
  const s: ItemState = {
    inv: [0, 0, 0, 0, 0, 0, 0, slot(itemNumber('inmate_outfit'))],
    hand: 0,
    open: -1,
    containers: list.map((c) => new Array(c.slots).fill(0)),
    ground: [],
    known: [],
    int: START_INT,
    rev: 0,
  };
  // Day 1 stock, the player's bed included (nothing restocks it afterwards).
  list.forEach((c, i) => stock(c, s.containers[i], rng, true));
  return s;
}

/** Tops a container up from its table (only the standard slots; hidden ones are the owner's). */
function stock(c: ContainerInfo, slots: number[], rng: { rng: number }, first = false) {
  if (c.mine && !first) return;
  const t = LOOT[c.table];
  const free = () => {
    for (let k = c.hidden; k < slots.length; k++) if (!slots[k]) return k;
    return -1;
  };
  const count = () => slots.reduce((n, v) => n + (v ? 1 : 0), 0);
  for (const id of t.fixed ?? []) {
    const n = itemNumber(id);
    if (!slots.some((v) => itemOf(v) === n) && free() >= 0) slots[free()] = slot(n);
  }
  if (!t.items.length) return;
  const total = t.items.reduce((a, [, wt]) => a + wt, 0);
  const rolls = t.rolls[0] + randomInt(rng, t.rolls[1] - t.rolls[0] + 1);
  for (let r = 0; r < rolls && count() < t.max && free() >= 0; r++) {
    let pick = randomInt(rng, total);
    for (const [id, wt] of t.items) {
      pick -= wt;
      if (pick < 0) {
        slots[free()] = slot(itemNumber(id));
        break;
      }
    }
  }
}

/** The morning restock (08:00). */
export function restock(w: World, s: ItemState, rng: { rng: number }) {
  containersOf(w).forEach((c, i) => stock(c, s.containers[i], rng));
  s.rev++;
}

/** Distance (units) from a point to a prop's footprint. */
function reachTo(c: ContainerInfo, x: number, z: number): number {
  const p = c.prop;
  const dx = Math.max(p.x * UNIT - x, 0, x - (p.x + p.w) * UNIT);
  const dz = Math.max(p.z * UNIT - z, 0, z - (p.z + p.d) * UNIT);
  return Math.max(dx, dz);
}

/** What the player would use by interacting now. */
export type Target = { kind: 'ground'; index: number; item: number } | { kind: 'container'; index: number } | { kind: 'sleep'; index: number } | null;

/**
 * The nearest thing within reach, the one the player faces winning ties: items on the floor
 * first, then furniture. A bed in the player's cell means sleep at Lights Out.
 */
export function interactTarget(w: World, s: ItemState, b: Body, lightsOut: boolean): Target {
  const fx = DIR_X[b.facing] ?? 0;
  const fz = DIR_Z[b.facing] ?? 0;
  // Facing it is worth a third of a tile.
  const score = (dist: number, tx: number, tz: number) => dist - (fx * (tx - b.x) + fz * (tz - b.z) > 0 ? UNIT / 3 : 0);
  let best: Target = null;
  let bestScore = Infinity;
  s.ground.forEach(([tile, v], index) => {
    const tx = (tile % MAP_W) * UNIT + UNIT / 2;
    const tz = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
    const d = Math.max(Math.abs(tx - b.x), Math.abs(tz - b.z));
    if (d > PICKUP_REACH) return;
    const sc = score(d, tx, tz) - UNIT;
    if (sc < bestScore) {
      bestScore = sc;
      best = { kind: 'ground', index, item: itemOf(v) };
    }
  });
  containersOf(w).forEach((c, index) => {
    const d = reachTo(c, b.x, b.z);
    if (d > REACH) return;
    const p = c.prop;
    const sc = score(d, (p.x + p.w / 2) * UNIT, (p.z + p.d / 2) * UNIT);
    if (sc < bestScore) {
      bestScore = sc;
      best = c.mine && p.kind === 'bed' && lightsOut ? { kind: 'sleep', index } : { kind: 'container', index };
    }
  });
  return best;
}

/** Whether the open container is still within reach. */
export function stillInReach(w: World, s: ItemState, b: Body): boolean {
  const c = containersOf(w)[s.open];
  return !!c && reachTo(c, b.x, b.z) <= REACH + UNIT / 4;
}

/** The first free hotbar slot, -1 when full. */
const freeHotbar = (s: ItemState) => s.inv.slice(0, HOTBAR).indexOf(0);

export function pickUp(s: ItemState, index: number, events: ItemEvent[]) {
  const k = freeHotbar(s);
  if (k < 0) {
    events.push({ type: 'full' });
    return;
  }
  const [, v] = s.ground[index];
  s.ground.splice(index, 1);
  s.inv[k] = v;
  events.push({ type: 'pickup', item: itemOf(v) });
}

/** Whether an item may sit in a slot address (weapon and outfit slots are picky). */
function fits(addr: number, v: number): boolean {
  if (!v) return true;
  const cat = itemDef(itemOf(v)).cat;
  if (addr === SLOT.WEAPON) return cat === 'weapon';
  if (addr === SLOT.OUTFIT) return cat === 'outfit';
  return true;
}

/** Reads or writes a slot by address; null when the address means nothing now. */
function cell(s: ItemState, addr: number): { get: () => number; set: (v: number) => void } | null {
  if (addr < SLOT.CONTAINER) return { get: () => s.inv[addr], set: (v) => (s.inv[addr] = v) };
  const box = s.containers[s.open];
  const k = addr - SLOT.CONTAINER;
  if (!box || k >= box.length) return null;
  return { get: () => box[k], set: (v) => (box[k] = v) };
}

/** Moves an item between slots (hotbar, weapon, outfit, the open container), swapping when the target is taken. */
export function moveItem(s: ItemState, from: number, to: number) {
  const a = cell(s, from);
  const b = cell(s, to);
  if (!a || !b || from === to || !a.get()) return;
  const va = a.get();
  const vb = b.get();
  if (!fits(to, va) || !fits(from, vb)) return;
  a.set(vb);
  b.set(va);
}

/** Drops an item on the floor where the player stands. */
export function dropItem(s: ItemState, from: number, b: Body, events: ItemEvent[]) {
  const a = cell(s, from);
  if (!a || !a.get()) return;
  const v = a.get();
  a.set(0);
  s.ground.push([Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT), v]);
  events.push({ type: 'drop', item: itemOf(v) });
}

/** Puts a weapon or outfit from the hotbar on (and what was on into its place). */
export function equip(s: ItemState, from: number) {
  const v = s.inv[from];
  if (!v || from >= HOTBAR) return;
  const cat = itemDef(itemOf(v)).cat;
  if (cat === 'weapon') moveItem(s, from, SLOT.WEAPON);
  if (cat === 'outfit') moveItem(s, from, SLOT.OUTFIT);
}

/**
 * Which carried slots a recipe would use (hotbar first, then the weapon and outfit slots),
 * or null when something is missing. Each slot is used once.
 */
export function ingredientSlots(s: ItemState, recipe: number): number[] | null {
  const used: number[] = [];
  for (const ing of RECIPES[recipe].ingredients) {
    const ok = choices(ing).map(itemNumber);
    let found = -1;
    for (let k = 0; k < s.inv.length && found < 0; k++) if (!used.includes(k) && ok.includes(itemOf(s.inv[k]))) found = k;
    if (found < 0) return null;
    used.push(found);
  }
  return used;
}

export type CraftCheck = 'ok' | 'missing' | 'int';

export function canCraft(s: ItemState, recipe: number): CraftCheck {
  const r = RECIPES[recipe];
  if (!r) return 'missing';
  if (!ingredientSlots(s, recipe)) return 'missing';
  return s.int >= r.int ? 'ok' : 'int';
}

/**
 * Crafts a recipe from what the player carries: the ingredients go, the result takes the
 * first freed slot it fits (a crafted outfit stays on), kept items (a guard key) come back.
 */
export function craft(s: ItemState, recipe: number, events: ItemEvent[]) {
  if (canCraft(s, recipe) !== 'ok') return;
  const r = RECIPES[recipe];
  const used = ingredientSlots(s, recipe)!;
  const kept = (r.keep ?? []).map(itemNumber);
  for (const k of used) {
    const item = itemOf(s.inv[k]);
    const back = kept.indexOf(item);
    if (back >= 0) kept.splice(back, 1);
    else s.inv[k] = 0;
  }
  const result = itemNumber(r.result);
  const made = slot(result);
  // A crafted outfit stays worn; otherwise the first freed hotbar slot, then any freed slot it fits.
  const freed = used.filter((k) => !s.inv[k]);
  const target = freed.find((k) => k === SLOT.OUTFIT && fits(k, made)) ?? freed.find((k) => k < HOTBAR) ?? freed.find((k) => fits(k, made)) ?? freeHotbar(s);
  if (target < 0) return;
  s.inv[target] = made;
  const first = !s.known.includes(recipe);
  if (first) s.known.push(recipe);
  events.push({ type: 'crafted', item: result, recipe, first });
}

/** Every item number, for tests and tools. */
export const ALL_ITEMS = ITEMS.map((_, i) => i + 1);

/**
 * The recipe a set of items makes (in any order), -1 for none: the workbench preview. Each
 * ingredient must be matched by a different item, and nothing may be left over.
 */
export function recipeFor(items: readonly number[]): number {
  return RECIPES.findIndex((r) => {
    if (r.ingredients.length !== items.length) return false;
    const left = [...items];
    // Narrow ingredients first, so 'comb|toothbrush' doesn't take a comb another one needs.
    const ings = [...r.ingredients].sort((a, b) => choices(a).length - choices(b).length);
    for (const ing of ings) {
      const ok = choices(ing).map(itemNumber);
      const k = left.findIndex((n) => ok.includes(n));
      if (k < 0) return false;
      left.splice(k, 1);
    }
    return true;
  });
}
