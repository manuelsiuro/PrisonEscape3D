/**
 * Smuggling (P21). The fixer (an inmate who likes the player: PHONE_OPINION) sells a burner
 * phone; with it in hand the player orders from the CATALOGUE, paid on the spot, and the order
 * comes one of two ways:
 * - By drone, on the first night it can (ORDER_LEAD minutes' notice; never in a storm): at a
 *   minute drawn for the night it lets the item fall over the prison's drop area, drifting
 *   downwind of its middle. Its buzz (DRONE_NOISE) sends guards to look, and a guard who sees it
 *   lying there takes it away (one bribed to look the other way leaves it be). The sirens on at
 *   that minute, it turns back and comes the next night.
 * - With a visitor, on the next visiting day (10:00–12:00): sat at a seat in the visiting room,
 *   across a counter or a table from where the visitor sits, the visitor comes after
 *   VISIT_STEPS with a gift ($10–20, every visiting day, order or not) and slips the order
 *   across. The room's ways out are detector arches while visiting hours last, and whoever is
 *   still in it at 12:00 is scanned on the way out. At Stalag Flucht nobody visits: a Red Cross
 *   parcel comes with the truck (14:45 on delivery day) into the player's desk, unless that
 *   day's search was thorough and the item is contraband.
 * When and where it all happens is pure (`arrival`, `droneMinute`, `dropTile`): what the phone
 * says is what happens, and the gossip can tell it.
 */
import { cakeAtVisit } from './phone';
import { birthdayAtVisit } from './oddjobs';
import { sightFor } from './football';
import { itemDef, itemNumber } from '../../content/items';
import type { Rect, SmugglingDef } from '../../content/prisons/types';
import { CATALOGUE, DRONE_GUARDS, DRONE_HOURS, DRONE_NOISE, FEES, GIFT_MAX, GIFT_MIN, LOOKAHEAD, ORDER_LEAD, PARCEL_MINUTE, VISIT_STEPS, WAY } from '../../content/smuggling';
import { canSee } from '../ai/sight';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import type { Refusal } from '../state';
import { STEPS_PER_MINUTE, UNIT } from '../tuning';
import { TILE, TILE_INFO } from '../world/tiles';
import { LAYER, MAP_H, MAP_W, placeKey, tileOfKey, type World } from '../world/World';
import { containersOf } from '../world/containers';
import { eventOn, planOf, today, TODAY } from './calendar';
import { dayMinute, prisonDay } from './clock';
import { awake } from './guards';
import { HOTBAR, itemOf, slot } from './items';
import { landable, makeNoise, pileRoom } from './noise';
import { frisk } from './power';
import { facingAt, seatSpot } from './rest';
import { lookingAway } from './ways';

export const PHONE = itemNumber('burner_phone');

/** The prison's smuggling (none in a relaxed prison: the Training Block has none anyway). */
export const smugglingOf = (sim: Pick<SimContext, 'world'>): SmugglingDef | undefined => (sim.world.def.rules?.relaxed ? undefined : sim.world.def.smuggling);

/** The fixer (Cast id), -1 where there's none. */
export function fixerOf(sim: Pick<SimContext, 'world' | 'state'>): number {
  const d = smugglingOf(sim);
  return d ? sim.state.inmates.findIndex((m) => m.cell === d.fixer) : -1;
}

/** An entry of the catalogue: its item number. */
export const catalogueItem = (k: number) => itemNumber(CATALOGUE[k].item);
/** What an order costs, the way it comes included. */
export const orderPrice = (k: number, way: number) => CATALOGUE[k].price + FEES[way];

/** Whether a way is open here: the drone everywhere smuggling is; a visitor where people visit, or a parcel comes instead. */
export function wayOpen(d: SmugglingDef | undefined, way: number): boolean {
  if (!d) return false;
  return way === WAY.DRONE || (way === WAY.VISITOR && (!!d.visits || !!d.parcel));
}

/** The drone's hours here (minutes into the prison day). */
export const droneHours = (d: SmugglingDef) => d.droneHours ?? DRONE_HOURS;

/** The minute the drone comes on a night (minutes into the prison day): drawn in its hours. */
export function droneMinute(sim: Pick<SimContext, 'world' | 'state'>, day: number): number {
  const [from, to] = droneHours(sim.world.def.smuggling!);
  return from + rollInt(sim.state.salt, SALT.DRONE, day, 0, to - from);
}

/** Whether the drone flies on a day's night: never in a storm (a blizzard at Stalag Flucht). */
export const droneFlies = (sim: Pick<SimContext, 'prison' | 'state'>, day: number) => planOf(sim, day).weather !== 'storm';

/** The first prison day an order placed now may come: a drone tonight with notice enough (else tomorrow night), a visitor from tomorrow. */
export function firstDay(sim: Pick<SimContext, 'world' | 'state'>, way: number): number {
  const s = sim.state;
  const day = prisonDay(s.step);
  if (way !== WAY.DRONE) return day + 1;
  return dayMinute(s.step) + ORDER_LEAD <= droneMinute(sim, day) ? day : day + 1;
}

/**
 * When the order on its way will come, as things stand (pure): the drone's night and minute
 * (the next night it flies), the visiting day and its first minute, or the delivery day of
 * the Red Cross parcel and 14:45. Null with no order, or none in sight. A drone the sirens turn
 * back comes a night later (the order says so then).
 */
export function arrival(sim: Pick<SimContext, 'world' | 'prison' | 'state'>, order: readonly number[] = sim.state.order): { day: number; minute: number } | null {
  const d = smugglingOf(sim);
  if (!d || order.length < 3) return null;
  const s = sim.state;
  const now = prisonDay(s.step);
  const minute = dayMinute(s.step);
  const from = Math.max(order[2], now);
  for (let day = from; day < from + LOOKAHEAD; day++) {
    if (order[1] === WAY.DRONE) {
      if (!droneFlies(sim, day)) continue;
      const m = droneMinute(sim, day);
      if (day === now && m < minute) continue;
      return { day, minute: m };
    }
    const p = planOf(sim, day);
    // (Today only while there's still time to sit the visit out.)
    if (d.parcel ? p.event === 'delivery' : p.event === 'visiting' && (day > now || minute + VISIT_STEPS / STEPS_PER_MINUTE < p.until)) return { day, minute: d.parcel ? PARCEL_MINUTE : p.at };
  }
  return null;
}

/** The eight ways the wind can blow towards, from north clockwise: [dx, dz] in tiles. */
const EIGHTHS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

const inRect = (r: Rect, x: number, z: number) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3];

/**
 * Where the drone lets an order fall on a night (a ground tile): the drop area's middle,
 * carried downwind a tile for each step of the wind's strength, give or take a tile drawn for
 * the night; then the nearest open floor inside the area. Pure.
 */
export function dropTile(sim: Pick<SimContext, 'world' | 'prison' | 'state'>, day: number): number {
  const d = sim.world.def.smuggling!;
  const r = d.drop;
  const p = planOf(sim, day);
  const [vx, vz] = EIGHTHS[(p.wind + 4) % 8];
  const salt = sim.state.salt;
  const x = Math.max(r[0], Math.min(r[2], ((r[0] + r[2]) >> 1) + vx * p.windForce + rollInt(salt, SALT.DRONE, day, 1, 3) - 1));
  const z = Math.max(r[1], Math.min(r[3], ((r[1] + r[3]) >> 1) + vz * p.windForce + rollInt(salt, SALT.DRONE, day, 2, 3) - 1));
  return nearestLanding(sim.world, r, x, z);
}

/** The nearest tile to (x, z) inside a rectangle where something can land (rings outwards, north-west first); -1 none. */
function nearestLanding(w: World, r: Rect, x: number, z: number): number {
  for (let ring = 0; ring < MAP_W; ring++) {
    let any = false;
    for (let dz = -ring; dz <= ring; dz++)
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const tx = x + dx;
        const tz = z + dz;
        if (!inRect(r, tx, tz) || tx < 0 || tz < 0 || tx >= MAP_W || tz >= MAP_H) continue;
        any = true;
        if (landable(w, tz * MAP_W + tx)) return tz * MAP_W + tx;
      }
    if (!any) return -1;
  }
  return -1;
}

// ------------------------------------------------------------------ the visiting room

/** Whether a ground tile of the map as built can be walked onto (a door too: keyed or not, it's a way out). Never the tiles as they are now: the arches are the same whether a game was loaded or played straight through. */
const walkable = (w: World, t: number) => w.ground.base[t] === TILE.DOOR || !TILE_INFO[w.ground.base[t]].solid;
const detector = (w: World, t: number) => w.ground.base[t] === TILE.DETECTOR;

/** The visiting room's ways out: its floor tiles beside floor outside it (the arches stand there); not where a detector arch stands already, in it or just beyond it. */
const exits = new WeakMap<World, ReadonlySet<number>>();
export function visitExits(w: World): ReadonlySet<number> {
  let set = exits.get(w);
  if (set) return set;
  const out = new Set<number>();
  const r = w.def.smuggling?.visits;
  if (r)
    for (let z = r[1]; z <= r[3]; z++)
      for (let x = r[0]; x <= r[2]; x++) {
        const t = z * MAP_W + x;
        if (!walkable(w, t) || detector(w, t)) continue;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= MAP_W || nz >= MAP_H || inRect(r, nx, nz) || !walkable(w, nz * MAP_W + nx)) continue;
          // (Nor where a detector arch stands just beyond the way out: a door, then the arch.)
          const fx = nx + dx;
          const fz = nz + dz;
          const beyond = fx >= 0 && fz >= 0 && fx < MAP_W && fz < MAP_H && detector(w, fz * MAP_W + fx);
          if (detector(w, nz * MAP_W + nx) || beyond) {
            out.delete(t);
            break;
          }
          out.add(t);
        }
      }
  set = out;
  exits.set(w, set);
  return set;
}

/** Visiting hours are on, in a prison with a visiting room: its arches are up. */
export const archesUp = (sim: Pick<SimContext, 'world' | 'prison' | 'state'>) => !!smugglingOf(sim)?.visits && eventOn(sim, 'visiting');

/** A ground tile is one of the visiting room's arches now. */
export const visitArch = (sim: Pick<SimContext, 'world' | 'prison' | 'state'>, tile: number) => archesUp(sim) && visitExits(sim.world).has(tile);

/** Whether a prop of some kinds covers a ground tile. */
function propAt(w: World, x: number, z: number, kinds: ReadonlySet<string>): boolean {
  return w.props.some((p) => kinds.has(p.kind) && x >= p.x && x < p.x + p.w && z >= p.z && z < p.z + p.d);
}
const ACROSS = new Set(['table', 'counter']);
const SEATS = new Set(['seat', 'chair']);
/** The way a seat faces (1 east, 5 south, 9 west, 13 north) as a step in tiles. */
const STEP: Record<number, readonly [number, number]> = { 1: [1, 0], 5: [0, 1], 9: [-1, 0], 13: [0, -1] };

/** The seat across the counter or table from a seat's tile facing that way, in the visiting room (a ground tile; -1 none). */
function acrossFrom(w: World, r: Rect, x: number, z: number, facing: number): number {
  const step = STEP[facing];
  if (!step || !inRect(r, x, z)) return -1;
  const gx = x + step[0] * 2;
  const gz = z + step[1] * 2;
  if (!inRect(r, gx, gz) || !propAt(w, x + step[0], z + step[1], ACROSS) || !propAt(w, gx, gz, SEATS)) return -1;
  return gz * MAP_W + gx;
}

/**
 * Where the visitor sits across from a seat in the visiting room (a ground tile): the seat on
 * the other side of the counter or table it faces. -1 when it isn't a visiting seat.
 */
export function guestSpot(sim: Pick<SimContext, 'world' | 'state'>, seat: number = sim.state.seat): number {
  const d = smugglingOf(sim);
  const w = sim.world;
  if (!d?.visits || seat < 0 || !SEATS.has(w.props[seat]?.kind)) return -1;
  const sp = seatSpot(w, seat, sim.state.player);
  return acrossFrom(w, d.visits, sp.x, sp.z, sp.facing);
}

/** Every visiting seat's tile, the guest's across from it, and the way the seat faces (the view seats visitors there). */
export interface VisitPair {
  seat: number;
  guest: number;
  facing: number;
}
const pairsOf = new WeakMap<World, readonly VisitPair[]>();
export function visitPairs(w: World): readonly VisitPair[] {
  let list = pairsOf.get(w);
  if (list) return list;
  const out: VisitPair[] = [];
  const r = w.def.smuggling?.visits;
  if (r)
    for (const p of w.props) {
      if (!SEATS.has(p.kind)) continue;
      for (let z = p.z; z < p.z + p.d; z++)
        for (let x = p.x; x < p.x + p.w; x++) {
          const facing = facingAt(w, p, x, z);
          const guest = acrossFrom(w, r, x, z, facing);
          if (guest >= 0) out.push({ seat: z * MAP_W + x, guest, facing });
        }
    }
  list = out;
  pairsOf.set(w, list);
  return list;
}

/** The player is sat at a visiting seat in visiting hours, not visited yet today: the visitor is on the way. */
export function awaitingVisit(sim: SimContext): boolean {
  const s = sim.state;
  return archesUp(sim) && s.layer === LAYER.GROUND && !s.lockdown && !sim.away && !(s.eventFlags & TODAY.VISITED) && guestSpot(sim) >= 0;
}

// ------------------------------------------------------------------ the phone

const refuse = (sim: SimContext, why: Refusal) => {
  sim.events.push({ type: 'refused', why });
};

/**
 * An order on the burner phone in hand (OP.EXT ORDER): paid on the spot, one at a time, the
 * way it comes open here.
 */
export function placeOrder(sim: SimContext, k: number, way: number) {
  const s = sim.state;
  const d = smugglingOf(sim);
  if (!d || k >= CATALOGUE.length || !wayOpen(d, way) || itemOf(s.items.inv[s.items.hand]) !== PHONE) return;
  if (s.order.length) return refuse(sim, 'ordered');
  // (Nothing coming that way in the weeks ahead: no money taken.)
  if (!arrival(sim, [k, way, firstDay(sim, way)])) return refuse(sim, 'noWay');
  const cost = orderPrice(k, way);
  if (s.cash < cost) return refuse(sim, 'cash');
  s.cash -= cost;
  s.order = [k, way, firstDay(sim, way)];
  sim.events.push({ type: 'cash', n: -cost, why: 'order' }, { type: 'smuggle', what: 'ordered', item: catalogueItem(k), way });
}

// ------------------------------------------------------------------ each step

/**
 * Smuggling's step (after the guards have looked): on a minute's first step the drone's drop
 * (or its turning back), the Red Cross parcel, the frisk at the end of visiting hours; every
 * step the visitor coming to a player sat waiting, and what the drone dropped: seized by a
 * guard who sees it, or picked up by the player.
 */
export function smuggle(sim: SimContext) {
  const d = smugglingOf(sim);
  const s = sim.state;
  if (!d) return;
  if (s.step % STEPS_PER_MINUTE === 0) minute(sim, d);
  // The visitor, after VISIT_STEPS sat waiting.
  if (awaitingVisit(sim)) {
    if (++s.visit >= VISIT_STEPS) visit(sim);
  } else s.visit = 0;
  if (s.drops.length) watchDrops(sim);
}

function minute(sim: SimContext, d: SmugglingDef) {
  const s = sim.state;
  const day = prisonDay(s.step);
  const m = dayMinute(s.step);
  const o = s.order;
  if (o.length === 3 && o[2] <= day) {
    if (o[1] === WAY.DRONE && droneFlies(sim, day) && m === droneMinute(sim, day)) {
      // The sirens on, or a guard looking right where it would land (P21 review: it would be seized as it fell):
      // it turns back, and tries again tomorrow night.
      const watcher = s.lockdown ? -1 : watching(sim, landingTile(sim, day));
      if (s.lockdown || watcher >= 0) {
        s.order = [o[0], o[1], day + 1];
        sim.events.push(watcher >= 0 ? { type: 'smuggle', what: 'turnedBack', item: catalogueItem(o[0]), guard: watcher } : { type: 'smuggle', what: 'turnedBack', item: catalogueItem(o[0]) });
      } else drop(sim, day);
    }
    if (o[1] === WAY.VISITOR && d.parcel && m >= PARCEL_MINUTE && today(sim).event === 'delivery') parcel(sim, m);
  }
  // 12:00: whoever is still in the visiting room is scanned on the way out.
  const p = today(sim);
  if (d.visits && p.event === 'visiting' && m === p.until && s.layer === LAYER.GROUND && !sim.away && !s.stowed) {
    const x = Math.floor(s.player.x / UNIT);
    const z = Math.floor(s.player.z / UNIT);
    // (Not twice: one stood in an arch was scanned as they stepped into it.)
    if (inRect(d.visits, x, z) && !visitExits(sim.world).has(z * MAP_W + x)) frisk(sim, z * MAP_W + x);
  }
}

/**
 * Where the drone's order lands on a night, as things lie now: its drop tile, or (a full pile
 * there) the nearest tile beside it in the drop area with room. The view drops the parcel there too.
 */
export function landingTile(sim: SimContext, day: number): number {
  const t = dropTile(sim, day);
  if (t < 0 || pileRoom(sim, t)) return t;
  const r = sim.world.def.smuggling!.drop;
  const x = t % MAP_W;
  const z = Math.floor(t / MAP_W);
  for (const [dx, dz] of EIGHTHS) {
    const n = (z + dz) * MAP_W + x + dx;
    if (inRect(r, x + dx, z + dz) && landable(sim.world, n) && pileRoom(sim, n)) return n;
  }
  return t;
}

/** The drone lets the order fall where it lands and buzzes off; guards hear it. */
function drop(sim: SimContext, day: number) {
  const s = sim.state;
  const item = catalogueItem(s.order[0]);
  const t = landingTile(sim, day);
  if (t < 0) return;
  const key = placeKey(LAYER.GROUND, t);
  s.items.ground.push([key, slot(item)]);
  s.items.rev++;
  s.drops.push([key, item, s.step]);
  s.order = [];
  sim.events.push({ type: 'smuggle', what: 'dropped', item, tile: t });
  makeNoise(sim, 'buzz', LAYER.GROUND, t, DRONE_NOISE, DRONE_GUARDS);
}

/**
 * What the drone dropped, each step: gone from where it fell (the player picked it up), or
 * seen there by a guard awake and not looking the other way, who takes it.
 */
function watchDrops(sim: SimContext) {
  const s = sim.state;
  const ground = s.items.ground;
  for (let k = s.drops.length - 1; k >= 0; k--) {
    const [key, item] = s.drops[k];
    const tile = tileOfKey(key);
    const at = ground.findIndex(([g, v]) => g === key && itemOf(v) === item);
    if (at < 0) {
      s.drops.splice(k, 1);
      sim.events.push({ type: 'smuggle', what: 'collected', item, tile });
      continue;
    }
    const guard = watching(sim, tile);
    if (guard < 0) continue;
    ground.splice(at, 1);
    s.items.rev++;
    s.drops.splice(k, 1);
    sim.events.push({ type: 'smuggle', what: 'seized', item, tile, guard });
  }
}

/** The first guard (awake, not looking the other way) who sees a ground tile's middle now; -1 none. */
function watching(sim: SimContext, tile: number): number {
  const s = sim.state;
  if (tile < 0) return -1;
  const point = sim.scratch.point;
  point.x = (tile % MAP_W) * UNIT + UNIT / 2;
  point.z = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
  return s.guards.findIndex((g) => awake(g) && !lookingAway(g, s.step) && canSee(sim.world, g.body, point, sightFor(sim, g, point.x, point.z)));
}

/** The visitor sits down across from the player: the gift, and the order slipped across (no room in the hotbar: kept for next time). */
function visit(sim: SimContext) {
  const s = sim.state;
  const it = s.items;
  const day = prisonDay(s.step);
  s.visit = 0;
  s.eventFlags |= TODAY.VISITED;
  const gift = GIFT_MIN + rollInt(s.salt, SALT.VISIT, day, 0, GIFT_MAX - GIFT_MIN + 1);
  s.cash += gift;
  s.tally[3] += gift;
  sim.events.push({ type: 'cash', n: gift, why: 'visit' });
  let item = 0;
  let kept = 0;
  const o = s.order;
  if (o.length === 3 && o[1] === WAY.VISITOR && o[2] <= day) {
    const n = catalogueItem(o[0]);
    const free = it.inv.slice(0, HOTBAR).indexOf(0);
    if (free >= 0) {
      it.inv[free] = slot(n);
      it.rev++;
      s.order = [];
      item = n;
    } else {
      // (Kept for the next visiting day.)
      kept = n;
      s.order = [o[0], o[1], day + 1];
    }
  }
  sim.events.push({ type: 'smuggle', what: 'visit', cash: gift, item });
  if (kept) sim.events.push({ type: 'smuggle', what: 'noRoom', item: kept });
  // P34: Lou's cake, if one's coming.
  cakeAtVisit(sim);
  // (P40: an odd job's birthday cake.)
  birthdayAtVisit(sim);
}

/** The player's desk (a container index; -1 none). */
const desks = new WeakMap<World, number>();
function myDesk(w: World): number {
  let k = desks.get(w);
  if (k === undefined) desks.set(w, (k = containersOf(w).findIndex((c) => c.mine && c.prop.kind === 'desk')));
  return k;
}

/**
 * The Red Cross parcel (Stalag Flucht), from 14:45 on delivery day: seized if the day's search
 * was thorough and it's contraband, else into the player's desk (full: it waits for room until the day is out).
 */
function parcel(sim: SimContext, m: number) {
  const s = sim.state;
  const item = catalogueItem(s.order[0]);
  if (s.eventFlags & TODAY.SEARCHED_CLOSE && itemDef(item).contraband) {
    s.order = [];
    sim.events.push({ type: 'smuggle', what: 'parcelSeized', item });
    return;
  }
  const desk = myDesk(sim.world);
  const box = desk >= 0 ? s.items.containers[desk] : null;
  // (In the desk's open slots: never put away in its hidden compartment for the player.)
  const free = box ? box.indexOf(0, containersOf(sim.world)[desk].hidden) : -1;
  if (!box || free < 0) {
    if (m === PARCEL_MINUTE) sim.events.push({ type: 'smuggle', what: 'deskFull', item });
    return;
  }
  box[free] = slot(item);
  s.items.rev++;
  s.order = [];
  sim.events.push({ type: 'smuggle', what: 'parcel', item });
}

/** The visiting room's rectangle here (null none): for the view and the help. */
export const visitRoom = (sim: Pick<SimContext, 'world'>): Rect | null => smugglingOf(sim)?.visits ?? null;

/** A ground tile is inside a rectangle. */
export { inRect };

/** How long the visitor takes to come (steps), for the card on screen. */
export { VISIT_STEPS };
