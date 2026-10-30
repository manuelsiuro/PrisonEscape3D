import { itemDef, itemNumber } from '../../content/items';
import { LOOT, POCKET_SLOTS } from '../../content/loot';
import { choices, RECIPES } from '../../content/recipes';
import { DIR_X, DIR_Z, SLOT } from '../command';
import { randomInt } from '../rng';
import { TALK_REACH, UNIT } from '../tuning';
import { containersOf, type ContainerInfo } from '../world/containers';
import { LAYER, layerOfKey, MAP_W, placeKey, tileOfKey, type World } from '../world/World';
import type { Body } from './movement';
import { seatSpot } from './rest';
import { lineOfSight } from '../ai/sight';
import { tileAt } from '../world/grid';

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
/** Starting Intellect (GDD §3.2; trained in the library). */
export const START_INT = 40;
/** How close the player must be to use something (units from the body's middle to its footprint). */
export const REACH = Math.round(UNIT * 0.85);
const PICKUP_REACH = Math.round(UNIT * 0.95);
/** How close to someone lying knocked out to go through their pockets (units, either axis). */
const POCKET_REACH = Math.round(UNIT * 1.2);
/** At most this many items lie on one tile (a pile); dropping more there is refused. */
export const PILE = 6;

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
  /** Items on the floor: [place (World placeKey: the tile, and its layer off the ground floor), slot]. */
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
  | { type: 'full' }
  /** The floor here already holds a full pile. */
  | { type: 'noRoom' };

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
  // Then everyone's pockets: the inmates' odds and ends, each guard's key, baton and uniform.
  s.containers.push(...startPockets(w, rng));
  return s;
}

/** The inmates (one per cell after the player's), then the guards, as Cast ids count them. */
const inmateCount = (w: World) => w.def.cells.length - 1;

/** The container index of a person's pockets (Cast id: inmates, then guards). */
export const pocketOf = (w: World, id: number) => containersOf(w).length + id;
/** Whose pockets a container index is (-1: furniture, not a person). */
export const ownerOf = (w: World, index: number) => (index >= containersOf(w).length ? index - containersOf(w).length : -1);

/** What a guard always has on it (GDD §10.2): its key, a baton, its uniform; P36: the strict one (the shakedown's), a blank release form too. */
export function guardKit(w: World, k: number): number[] {
  const kit = [itemNumber(`key_${w.def.guards[k].key}`), itemNumber('baton'), itemNumber('guard_outfit')];
  if (w.def.comms && w.def.guards[k].duties?.includes('shakedown')) kit.push(itemNumber('release_form'));
  return kit;
}

/** Fresh pockets for everyone (a new game, or a save from before pockets). */
export function startPockets(w: World, rng: { rng: number }): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < inmateCount(w); k++) {
    const p = new Array(POCKET_SLOTS).fill(0);
    stockSlots('pockets', 0, p, rng);
    out.push(p);
  }
  w.def.guards.forEach((_, k) => {
    const kit = guardKit(w, k);
    out.push([...kit.map((n) => slot(n)), ...new Array(POCKET_SLOTS - kit.length).fill(0)]);
  });
  return out;
}

/** Tops a container up from its table (only the standard slots; hidden ones are the owner's). */
function stock(c: ContainerInfo, slots: number[], rng: { rng: number }, first = false) {
  // The player's desk and bed are theirs; their toilet gets paper like any other.
  if (c.mine && c.prop.kind !== 'toilet' && !first) return;
  stockSlots(c.table, c.hidden, slots, rng);
}

/** Tops slots up from a loot table, from slot `hidden` on. */
export function stockSlots(table: string, hidden: number, slots: number[], rng: { rng: number }) {
  const t = LOOT[table];
  const free = () => {
    for (let k = hidden; k < slots.length; k++) if (!slots[k]) return k;
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

/** The morning restock (08:00): furniture, and the inmates' pockets. */
export function restock(w: World, s: ItemState, rng: { rng: number }) {
  containersOf(w).forEach((c, i) => stock(c, s.containers[i], rng));
  for (let k = 0; k < inmateCount(w); k++) stockSlots('pockets', 0, s.containers[pocketOf(w, k)], rng);
  s.rev++;
}

/** Distance (units) from a point to a prop's footprint. */
function reachTo(c: ContainerInfo, x: number, z: number): number {
  const p = c.prop;
  const dx = Math.max(p.x * UNIT - x, 0, x - (p.x + p.w) * UNIT);
  const dz = Math.max(p.z * UNIT - z, 0, z - (p.z + p.d) * UNIT);
  return Math.max(dx, dz);
}

/** What the player would use by interacting now ('pockets': a knocked-out person's, by container index and Cast id). */
export type Target =
  | { kind: 'ground'; index: number; item: number }
  | { kind: 'container'; index: number }
  | { kind: 'sleep'; index: number }
  | { kind: 'pockets'; index: number; who: number }
  /** An inmate up and about: talk (trade, gifts, favors, recruiting), or hand over their letter. */
  | { kind: 'person'; who: number }
  /** The job board, gym equipment (prop index). */
  | { kind: 'fixture'; index: number; use: FixtureUse }
  | null;

/**
 * Furniture used by standing at it: the job board, the weights (Strength), the treadmill
 * (Speed), the generator (the power, GDD §5.5); seats, benches and chairs to sit on, the
 * infirmary's beds to rest on (GDD §3.1); Irongate's helipad, to board the helicopter (P12).
 */
export type FixtureUse = 'board' | 'weights' | 'treadmill' | 'generator' | 'sit' | 'rest' | 'helicopter' | 'pullup';
const FIXTURES: Partial<Record<string, FixtureUse>> = { jobBoard: 'board', weights: 'weights', treadmill: 'treadmill', generator: 'generator', seat: 'sit', bench: 'sit', chair: 'sit', helipad: 'helicopter', pullup: 'pullup', bleachers: 'sit' };

/** What a prop is used for by standing at it (an infirmary bed is for resting; a cell bed is a container). */
export function fixtureUse(w: World, p: { kind: string; x: number; z: number }): FixtureUse | undefined {
  return FIXTURES[p.kind] ?? (p.kind === 'bed' && w.zoneAt(p.x, p.z) === 'infirmary' ? 'rest' : undefined);
}

/** Someone whose pockets can be gone through: lying knocked out (GDD §10.2). */
export interface Lootable {
  body: Body;
  ko: number;
  /** Fighting the player (inmates): no talking now. */
  angry?: number;
}

/**
 * The nearest thing within reach, the one the player faces winning ties: items on the floor
 * (of the player's layer) first, then furniture (on the ground floor). A bed in the player's
 * cell means sleep at Lights Out.
 */
/** Someone the player can talk to from here: up, not fighting, within reach and in sight. */
function canTalkTo(w: World, b: Body, o: Lootable): boolean {
  if (o.ko > 0 || (o.angry ?? 0) > 0) return false;
  const d = Math.max(Math.abs(o.body.x - b.x), Math.abs(o.body.z - b.z));
  return d <= TALK_REACH && lineOfSight(w, b.x, b.z, o.body.x, o.body.z);
}

/** Whether a tile is on a seat, bench, chair or infirmary bed (someone there is sitting or lying on it). */
function onSeat(w: World, x: number, z: number): boolean {
  return w.props.some((p) => x >= p.x && x < p.x + p.w && z >= p.z && z < p.z + p.d && (fixtureUse(w, p) === 'sit' || fixtureUse(w, p) === 'rest'));
}

/**
 * A seat (or bed) gives way to someone sitting the player could talk to: on the spot the player
 * would take (sitting there is refused anyway), or in front of the player (within 45°) more
 * squarely than that spot.
 */
function seatGivesWay(w: World, index: number, b: Body, fx: number, fz: number, people: readonly Lootable[], talkers: number, faced: Faced | null): boolean {
  const spot = seatSpot(w, index, b);
  for (let who = 0; who < talkers && who < people.length; who++) {
    const o = people[who];
    if (Math.floor(o.body.x / UNIT) === spot.x && Math.floor(o.body.z / UNIT) === spot.z && canTalkTo(w, b, o)) return true;
  }
  if (!faced) return false;
  const sx = spot.x * UNIT + UNIT / 2 - b.x;
  const sz = spot.z * UNIT + UNIT / 2 - b.z;
  const toSpot = fx * sx + fz * sz;
  return toSpot <= 0 || faced.ahead * faced.ahead * (sx * sx + sz * sz) >= toSpot * toSpot * faced.d2;
}

/** The seated person the player looks at most squarely (how far ahead, and their distance squared). */
interface Faced {
  ahead: number;
  d2: number;
}

export function interactTarget(w: World, s: ItemState, b: Body, lightsOut: boolean, layer: number = LAYER.GROUND, people: readonly Lootable[] = [], talkers = 0, chat?: (guard: number) => boolean): Target {
  const fx = DIR_X[b.facing] ?? 0;
  const fz = DIR_Z[b.facing] ?? 0;
  // Facing it is worth a third of a tile.
  const score = (dist: number, tx: number, tz: number) => dist - (fx * (tx - b.x) + fz * (tz - b.z) > 0 ? UNIT / 3 : 0);
  let best: Target = null;
  let bestScore = Infinity;
  s.ground.forEach(([key, v], index) => {
    if (layerOfKey(key) !== layer) return;
    const tile = tileOfKey(key);
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
  if (layer !== LAYER.GROUND) return best;
  // Someone out cold: their pockets (they lie a little ahead of where they stood).
  people.forEach((o, who) => {
    if (o.ko <= 0) return;
    const d = Math.max(Math.abs(o.body.x - b.x), Math.abs(o.body.z - b.z));
    // Within reach, and nothing between (never through a wall's corner).
    if (d > POCKET_REACH || !lineOfSight(w, b.x, b.z, o.body.x, o.body.z)) return;
    const sc = score(d, o.body.x, o.body.z) - UNIT / 2;
    if (sc < bestScore) {
      bestScore = sc;
      best = { kind: 'pockets', index: pocketOf(w, who), who };
    }
  });
  // Someone to talk to (inmates up and about, not fighting; guards who'd talk, P15: `chat`, by guard index), a little behind furniture in reach.
  let faced: Faced | null = null;
  for (let who = 0; who < people.length; who++) {
    if (who >= talkers && !chat?.(who - talkers)) continue;
    const o = people[who];
    if (!canTalkTo(w, b, o)) continue;
    const d = Math.max(Math.abs(o.body.x - b.x), Math.abs(o.body.z - b.z));
    // Someone the player looks straight at wins over furniture at their elbow.
    const dx = o.body.x - b.x;
    const dz = o.body.z - b.z;
    const ahead = fx * dx + fz * dz;
    const straight = ahead > 0 && ahead * ahead * 2 >= (dx * dx + dz * dz) * 1024 * 1024;
    const sc = score(d, o.body.x, o.body.z) + UNIT / 4 - (straight ? UNIT : 0);
    const d2 = dx * dx + dz * dz;
    // Sitting, and looked at most squarely so far: seats give way to them (below).
    if (straight && (!faced || ahead * ahead * faced.d2 > faced.ahead * faced.ahead * d2) && onSeat(w, Math.floor(o.body.x / UNIT), Math.floor(o.body.z / UNIT))) faced = { ahead, d2 };
    if (sc < bestScore) {
      bestScore = sc;
      best = { kind: 'person', who };
    }
  }
  w.props.forEach((p, index) => {
    const use = fixtureUse(w, p);
    if (!use) return;
    const dx = Math.max(p.x * UNIT - b.x, 0, b.x - (p.x + p.w) * UNIT);
    const dz = Math.max(p.z * UNIT - b.z, 0, b.z - (p.z + p.d) * UNIT);
    const d = Math.max(dx, dz);
    if (d > REACH) return;
    // Seats and beds give way to anything else in reach (a chair stands where the desk is
    // searched from), unless the seat is the tile straight ahead: the player sits by facing it.
    let sc = score(d, (p.x + p.w / 2) * UNIT, (p.z + p.d / 2) * UNIT);
    if (use === 'sit' || use === 'rest') {
      // (Directions are scaled to a tile: three quarters of one ahead.)
      const ax = Math.floor((b.x + (fx * UNIT * 0.75) / 1024) / UNIT);
      const az = Math.floor((b.z + (fz * UNIT * 0.75) / 1024) / UNIT);
      const ahead = ax >= p.x && ax < p.x + p.w && az >= p.z && az < p.z + p.d;
      // Someone on the tile ahead the player could talk to: they're who the player faces, not the seat.
      if (ahead && people.some((o, who) => who < talkers && canTalkTo(w, b, o) && Math.floor(o.body.x / UNIT) === ax && Math.floor(o.body.z / UNIT) === az)) return;
      if (seatGivesWay(w, index, b, fx, fz, people, talkers, faced)) return;
      sc += ahead ? -UNIT / 2 : UNIT / 4;
    }
    if (sc < bestScore) {
      bestScore = sc;
      best = { kind: 'fixture', index, use };
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

/** Whether the open container is still within reach (pockets: their owner still out cold). */
export function stillInReach(w: World, s: ItemState, b: Body, people: readonly Lootable[] = []): boolean {
  const who = ownerOf(w, s.open);
  if (who >= 0) {
    const o = people[who];
    return !!o && o.ko > 0 && Math.max(Math.abs(o.body.x - b.x), Math.abs(o.body.z - b.z)) <= POCKET_REACH + UNIT / 4;
  }
  const c = containersOf(w)[s.open];
  return !!c && reachTo(c, b.x, b.z) <= REACH + UNIT / 4;
}

/** The first free hotbar slot, -1 when full. */
/** The first empty hotbar slot, -1 when it's full. */
export const freeHotbar = (inv: readonly number[]) => inv.slice(0, HOTBAR).indexOf(0);
/** The first hotbar slot holding the item, -1 for none. */
export const hotbarSlotOf = (inv: readonly number[], item: number) => inv.slice(0, HOTBAR).findIndex((v) => itemOf(v) === item);

export function pickUp(s: ItemState, index: number, events: ItemEvent[]) {
  const k = freeHotbar(s.inv);
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

/** Drops an item on the floor where the player stands (on their layer). */
export function dropItem(s: ItemState, from: number, b: Body, events: ItemEvent[], layer: number = LAYER.GROUND) {
  const a = cell(s, from);
  if (!a || !a.get()) return;
  const key = placeKey(layer, tileAt(b.x, b.z));
  if (s.ground.filter(([t]) => t === key).length >= PILE) {
    events.push({ type: 'noRoom' });
    return;
  }
  const v = a.get();
  a.set(0);
  s.ground.push([key, v]);
  events.push({ type: 'drop', item: itemOf(v) });
}

/**
 * Puts an item in the first free hotbar slot, or on the floor at the player's feet when the
 * hands are full (dirt from a dig, a chunk of wall). Returns false if even the floor is full.
 */
export function give(s: ItemState, item: number, b: Body, layer: number): boolean {
  return giveSlot(s, slot(item), b, layer);
}

/** give() for a slot as it is (its wear kept: what the rat brings back, P20). */
export function giveSlot(s: ItemState, v: number, b: Body, layer: number): boolean {
  const k = freeHotbar(s.inv);
  if (k >= 0) {
    s.inv[k] = v;
    return true;
  }
  const key = placeKey(layer, tileAt(b.x, b.z));
  if (s.ground.filter(([t]) => t === key).length >= PILE) return false;
  s.ground.push([key, v]);
  return true;
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

/** A set of carried slots as a bit mask (bit k = slot k, 0–7), and back. */
export const maskOf = (slots: readonly number[]) => slots.reduce((m, k) => m | (1 << k), 0);
const slotsOf = (mask: number) => [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => (mask >> k) & 1);

/** What the slots on the workbench would make: the recipe (or -1) and whether it can be made now. */
export function benchCheck(s: ItemState, mask: number): { recipe: number; check: CraftCheck } {
  const used = slotsOf(mask);
  if (!used.length || used.some((k) => !s.inv[k])) return { recipe: -1, check: 'missing' };
  const recipe = recipeFor(used.map((k) => itemOf(s.inv[k])));
  if (recipe < 0) return { recipe, check: 'missing' };
  return { recipe, check: s.int >= RECIPES[recipe].int ? 'ok' : 'int' };
}

/**
 * Crafts from exactly the carried slots the player put on the workbench (a mask) — only if
 * they still make the `expected` recipe, when given (the preview the player saw): those
 * ingredients go, kept items (a guard key) come back, and the result takes a freed slot: the
 * outfit or weapon slot if it came from there and fits, else a freed hotbar slot.
 */
export function craft(s: ItemState, mask: number, events: ItemEvent[], expected = -1) {
  const { recipe, check } = benchCheck(s, mask);
  // The workbench says what it previewed: if the slots changed meanwhile, nothing happens.
  if (check !== 'ok' || (expected >= 0 && recipe !== expected)) return;
  const r = RECIPES[recipe];
  const used = slotsOf(mask);
  const kept = (r.keep ?? []).map(itemNumber);
  for (const k of used) {
    const back = kept.indexOf(itemOf(s.inv[k]));
    if (back >= 0) kept.splice(back, 1);
    else s.inv[k] = 0;
  }
  const result = itemNumber(r.result);
  const made = slot(result);
  const freed = used.filter((k) => !s.inv[k]);
  // Every recipe frees a slot the result fits (itemtest proves it), so this always finds one.
  const target = freed.find((k) => (k === SLOT.OUTFIT || k === SLOT.WEAPON) && fits(k, made)) ?? freed.find((k) => k < HOTBAR) ?? freed.find((k) => fits(k, made)) ?? freeHotbar(s.inv);
  if (target < 0) return;
  s.inv[target] = made;
  const first = !s.known.includes(recipe);
  if (first) s.known.push(recipe);
  events.push({ type: 'crafted', item: result, recipe, first });
}

/**
 * The recipe a set of items makes (in any order), -1 for none: the workbench preview. Each
 * ingredient must be matched by a different item, and nothing may be left over.
 */
function recipeFor(items: readonly number[]): number {
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
