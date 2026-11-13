/**
 * Free time's gatherings (2.39, docs/decisions/free-time.md): the crowd in company, where it used to stand about alone.
 *
 * - **What**: a ring of two to four for a chat, two at dice, two or three at cards (on open floor: a ring's place), two
 *   taking turns at the hoop (on its spots). A few at once (HUDDLE_SLOTS), each slot's one after another through the
 *   block, every time and place and kind by roll() (never the state's RNG). The nearest inmates free to come make it up.
 * - **When**: the free times, from the second day (the first plays as it always did), never in a lockdown, a drill or
 *   the day's event that takes the crowd elsewhere (a film, the acts); never at the Training Block (its lessons ask for
 *   inmates by name). Broken up a few minutes before the bell.
 * - **The player**: in reach of someone in an inmates' game, the action button joins it (a talk, its game offered:
 *   play/labels.ts); talking to anyone in one takes them out of it, and two left alone part. Standing by a chat, the
 *   player overhears something true (the director's, as at the water cooler).
 *
 * A run logged before 2.39 (Sim.rules238) has none of it. State: `state.huddle`, absent until day 2's first free time
 * begins, before any gathering forms (a run that never reaches it hashes as before).
 */
import {
  HOOPS_TURN_S,
  HUDDLE,
  HUDDLE_APART,
  HUDDLE_BREAK,
  HUDDLE_FIRST,
  HUDDLE_FIRST_SPREAD,
  HUDDLE_FROM_DAY,
  HUDDLE_GAP,
  HUDDLE_GAP_SPREAD,
  HUDDLE_LAST,
  HUDDLE_LENGTH,
  HUDDLE_LENGTH_SPREAD,
  HUDDLE_PLACES,
  HUDDLE_REACH,
  HUDDLE_SIZE,
  HUDDLE_SLOTS,
  HUDDLE_STALL_STEPS,
  HUDDLE_WEIGHTS,
} from '../../content/huddles';
import { ROUTINE } from '../../content/routine';
import { zoneIndex, type ZoneId } from '../../content/zones';
import { DOING, ON_MACHINE } from '../ai/doing';
import { placesOf } from '../ai/places';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import { STEPS_PER_MINUTE, STEPS_PER_SECOND, UNIT } from '../tuning';
import { MAP_W, type World } from '../world/World';
import { crowdPlan, dayMinute, drillOn, prisonDay } from './calendar';
import { gangOf, heldPiece } from './gangs';
import { bodyAt, type Body } from './movement';
import { blockNow, freeToGo, staysPut } from './vending';

/** The gatherings as the state holds them: a slot each (HUDDLE_SLOTS' larger), plain data. */
export interface HuddleState {
  /** The prison day and free time (0 morning, 1 evening) the slots were set for. */
  day: number;
  block: number;
  /** Per slot: its kind (HUDDLE), its place (a ring's index; the hoop: -1), how many it has formed this block. */
  kind: number[];
  place: number[];
  n: number[];
  /** Per slot: the minute of the prison day it breaks up, the minute the next forms (both dayMinute's). */
  until: number[];
  next: number[];
  /** Per slot, four places each (slot * 4 + k): who (an inmate's index, -1 nobody), the step they got there (0: on the way). */
  who: number[];
  there: number[];
  /** Per slot: the step it formed. */
  since: number[];
  /** Those who've been in one this block (a mask of inmates' indices under 31): the others are asked first. */
  done: number;
}

const SLOTS = Math.max(...HUDDLE_SLOTS);
const SEATS = 4;

export const newHuddles = (): HuddleState => ({
  day: 0,
  block: -1,
  kind: Array(SLOTS).fill(0),
  place: Array(SLOTS).fill(-1),
  n: Array(SLOTS).fill(0),
  until: Array(SLOTS).fill(0),
  next: Array(SLOTS).fill(0),
  who: Array(SLOTS * SEATS).fill(-1),
  there: Array(SLOTS * SEATS).fill(0),
  since: Array(SLOTS).fill(0),
  done: 0,
});

/** The gatherings as a save holds them. */
export function huddlesOk(o: HuddleState | undefined, inmates: number): boolean {
  if (!o || typeof o !== 'object') return false;
  const ints = (a: unknown, len: number, ok: (x: number) => boolean) =>
    Array.isArray(a) && a.length === len && a.every((x) => Number.isInteger(x) && ok(x));
  return (
    Number.isInteger(o.day) &&
    o.day >= 0 &&
    Number.isInteger(o.block) &&
    o.block >= -1 &&
    o.block <= 1 &&
    ints(o.kind, SLOTS, (x) => x >= 0 && x <= HUDDLE.HOOPS) &&
    ints(o.place, SLOTS, (x) => x >= -1 && x < HUDDLE_PLACES) &&
    ints(o.n, SLOTS, (x) => x >= 0) &&
    ints(o.until, SLOTS, (x) => x >= 0) &&
    ints(o.next, SLOTS, (x) => x >= 0) &&
    ints(o.who, SLOTS * SEATS, (k) => k >= -1 && k < inmates) &&
    ints(o.there, SLOTS * SEATS, (x) => x >= 0) &&
    ints(o.since, SLOTS, (x) => x >= 0) &&
    Number.isInteger(o.done)
  );
}

/** Gatherings here at all: a run from 2.39 on, and not the Training Block. */
export const huddlesHere = (sim: Pick<SimContext, 'rules238' | 'world'>) => !sim.rules238 && !sim.world.def.rules?.relaxed;

/** A ring's place: the middle tile left open, where a game's dice or cards lie. */
export interface Ring {
  x: number;
  z: number;
}

/** Where a ring forms, where each stands in it (tiles from the middle tile's centre) and the way they face. */
const STAND: ReadonlyArray<{ dx: number; dz: number; face: number }> = [
  { dx: -0.7, dz: 0, face: 1 },
  { dx: 0.7, dz: 0, face: 9 },
  { dx: 0, dz: -0.7, face: 5 },
  { dx: 0, dz: 0.7, face: 13 },
];

/** Where people gather (open floor in these zones, a 3×3 square clear of everything with a use). */
const RING_ZONES: readonly ZoneId[] = ['yard', 'cellBlock', 'rollCall', 'sports', 'canteen', 'corridor'];

const ringCache = new WeakMap<World, Ring[]>();

/** A tile's scattered order: a pure hash of its index, so the rings spread over the map rather than filling its top. */
const scatter = (i: number) => Math.imul(i ^ 0x5bd1e995, 0x27d4eb2d) >>> 0;

/**
 * The prison's ring places, worked out once from its map: a middle tile whose 3×3 square is free floor of one zone,
 * none of it a place with a use (a seat, a roll call square, a guard's stop, the court, the pitch, a queue…),
 * HUDDLE_APART apart, HUDDLE_PLACES at most.
 */
export function ringsOf(w: World): Ring[] {
  const had = ringCache.get(w);
  if (had) return had;
  const places = placesOf(w);
  const def = w.def;
  const busy = new Set<number>();
  const mark = (x: number, z: number, pad = 0) => {
    for (let dz = -pad; dz <= pad; dz++) for (let dx = -pad; dx <= pad; dx++) busy.add((z + dz) * MAP_W + x + dx);
  };
  const markTile = (i: number, pad = 0) => mark(i % MAP_W, Math.floor(i / MAP_W), pad);
  const rect = (x: number, z: number, wd: number, d: number, pad = 0) => {
    for (let zz = z - pad; zz < z + d + pad; zz++) for (let xx = x - pad; xx < x + wd + pad; xx++) busy.add(zz * MAP_W + xx);
  };
  // (Not the roll call's squares: nobody gathers on them but in free time, when they're bare floor.)
  for (const list of [places.seats, places.counters, places.showers, places.rests, places.machines, places.shelves, places.readSeats])
    for (const q of list) markTile(q.tile);
  for (const t of [...places.bedside, ...places.deskside, ...places.doorstep]) if (t >= 0) markTile(t);
  for (const g of def.guards) for (const q of [...g.beat, ...(g.night ?? []), ...Object.values(g.posts ?? {})]) if (q) mark(q.x, q.z);
  const l = def.leisure;
  if (l) {
    mark(l.hoop.x, l.hoop.z, 1);
    for (const q of l.hoop.spots) mark(q.x, q.z, 1);
    // (The pitch's goals, not its middle: a ring there parts when a penalty shootout starts.)
    for (const gx of [l.pitch.x, l.pitch.x + l.pitch.w - 1]) mark(gx, l.pitch.z + (l.pitch.d >> 1), 2);
    rect(l.garden.x, l.garden.z, l.garden.w, l.garden.d, 1);
    // (The track's lanes, its edge tiles: the ground inside it is the pitch's, outside it open.)
    const t = l.track;
    if (t)
      for (let z = t.z; z < t.z + t.d; z++)
        for (let x = t.x; x < t.x + t.w; x++) if (x === t.x || z === t.z || x === t.x + t.w - 1 || z === t.z + t.d - 1) mark(x, z, 1);
    if (l.stage) mark(l.stage.x, l.stage.z, 2);
    for (const q of l.quiz?.spots ?? []) mark(q.x, q.z, 1);
    if (l.librarian) mark(l.librarian.x, l.librarian.z, 1);
    const r = l.race;
    for (let k = 0; k < r.len; k++) {
      const dx = r.dir === 1 ? k : r.dir === 9 ? -k : 0;
      const dz = r.dir === 5 ? k : r.dir === 13 ? -k : 0;
      mark(r.x + dx, r.z + dz, 1);
    }
  }
  if (def.cooler) {
    mark(def.cooler.x, def.cooler.z, 1);
    for (const q of def.cooler.spots) mark(q.x, q.z, 1);
  }
  if (def.vending) {
    mark(def.vending.x, def.vending.z, 1);
    for (const q of def.vending.line) mark(q.x, q.z, 1);
  }
  if (def.comms) {
    mark(def.comms.phone.x, def.comms.phone.z, 1);
    for (const q of def.comms.line) mark(q.x, q.z, 1);
    mark(def.comms.kiosk.x, def.comms.kiosk.z, 1);
    for (const q of def.comms.release.at) mark(q.x, q.z, 1);
  }
  // (Read from in front: the menu board, the odd jobs board, the job board.)
  if (def.menu) rect(def.menu.x, def.menu.z, def.menu.w, 1, 1);
  if (def.board) mark(def.board.x, def.board.z, 2);
  for (const g of def.gangs ?? []) rect(g.corner[0], g.corner[1], g.corner[2] - g.corner[0] + 1, g.corner[3] - g.corner[1] + 1, 1);
  for (const p of w.props) rect(p.x, p.z, p.w, p.d, p.kind === 'jobBoard' ? 1 : 0);
  const out: Ring[] = [];
  const candidates: number[] = [];
  for (const zone of RING_ZONES) {
    const z = zoneIndex(zone);
    const floor = new Set(places.floor[z] ?? []);
    for (const i of floor) {
      let ok = true;
      for (let dz = -1; dz <= 1 && ok; dz++)
        for (let dx = -1; dx <= 1 && ok; dx++) {
          const t = i + dz * MAP_W + dx;
          if (!floor.has(t) || busy.has(t)) ok = false;
        }
      if (ok) candidates.push(i);
    }
  }
  // (Corridors last: a ring there stands in everyone's way.)
  const corridor = zoneIndex('corridor');
  const late = (i: number) => (w.ground.zone[i] === corridor ? 1 : 0);
  candidates.sort((a, b) => late(a) - late(b) || scatter(a) - scatter(b) || a - b);
  for (const i of candidates) {
    if (out.length >= HUDDLE_PLACES) break;
    const x = i % MAP_W;
    const z = Math.floor(i / MAP_W);
    if (out.some((r) => Math.max(Math.abs(r.x - x), Math.abs(r.z - z)) < HUDDLE_APART)) continue;
    out.push({ x, z });
  }
  ringCache.set(w, out);
  return out;
}

/** Where the k-th of a gathering stands (units) and the way it faces. */
function standOf(sim: SimContext, kind: number, place: number, k: number): { x: number; z: number; face: number } | null {
  if (kind === HUDDLE.HOOPS) {
    const c = sim.world.def.leisure?.hoop;
    if (!c || c.spots.length < 2) return null;
    // (Two spots of the five, the nearer two to the rim: a turn each.)
    const q = c.spots[k % 2];
    return { x: q.x * UNIT + UNIT / 2, z: q.z * UNIT + UNIT / 2, face: faceTo(q, c) };
  }
  const r = ringsOf(sim.world)[place];
  if (!r) return null;
  const st = STAND[k];
  return { x: Math.round((r.x + 0.5 + st.dx) * UNIT), z: Math.round((r.z + 0.5 + st.dz) * UNIT), face: st.face };
}

/** The way from a tile to another (1 east, 5 south, 9 west, 13 north). */
function faceTo(from: { x: number; z: number }, to: { x: number; z: number }): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.abs(dx) >= Math.abs(dz)) return dx > 0 ? 1 : 9;
  return dz > 0 ? 5 : 13;
}

/** The free time's first and last minute (dayMinute's) for block b. */
function blockSpan(b: number): [number, number] {
  const at = ROUTINE.findIndex((r) => r.id === (b ? 'eveningFreeTime' : 'freeTime'));
  return [ROUTINE[at].start - 8 * 60, ROUTINE[at + 1].start - 8 * 60];
}

/** A draw for slot g's n-th gathering of a block (what: which number it is), by roll(). */
const draw = (sim: SimContext, day: number, b: number, g: number, n: number, what: number, range: number) =>
  rollInt(sim.state.salt, SALT.HUDDLE, (day * 2 + b) * 8 + g, n * 16 + what, range);

/** Squared distance (units²) from a point in units to a tile's middle: whole numbers, the same on every engine (no Math.hypot). */
const dist2 = (x: number, z: number, tx: number, tz: number) => {
  const dx = x - (tx * UNIT + UNIT / 2);
  const dz = z - (tz * UNIT + UNIT / 2);
  return dx * dx + dz * dz;
};

/**
 * Whether the hoop is free for an inmates' game: a court, nobody at a game there with the player, the player not taking
 * a shot. To start one, the player is away from it too (over 7 tiles: not under their nose); one under way goes on as
 * the player walks up (to join it, across its spots too), and makes way once they shoot.
 */
function hoopFree(sim: SimContext, starting: boolean): boolean {
  const s = sim.state;
  const c = sim.world.def.leisure?.hoop;
  if (!c || c.spots.length < 2 || s.shootout || (s.pens && s.pens.who >= 0) || s.shot.length) return false;
  return !starting || dist2(s.player.x, s.player.z, c.x, c.z) > 49 * UNIT * UNIT;
}

/** A ring on the pitch (its place in ringsOf): parted when a penalty shootout starts (2.44; a football match before). */
function onPitch(sim: SimContext, place: number): boolean {
  const p = sim.world.def.leisure?.pitch;
  const r = ringsOf(sim.world)[place];
  return !!p && !!r && r.x + 1 >= p.x && r.x - 1 < p.x + p.w && r.z + 1 >= p.z && r.z - 1 < p.z + p.d;
}

/** The slot an inmate is gathered in, -1 none. */
export function huddleOf(sim: Pick<SimContext, 'state'>, k: number): number {
  const h = sim.state.huddle;
  if (!h || k < 0) return -1;
  const at = h.who.indexOf(k);
  return at < 0 ? -1 : Math.floor(at / SEATS);
}

/** Everyone in slot g got to their place (a game is on only then). */
function allThere(h: HuddleState, g: number): boolean {
  let n = 0;
  for (let k = 0; k < SEATS; k++) {
    const i = g * SEATS + k;
    if (h.who[i] < 0) continue;
    if (!h.there[i]) return false;
    n++;
  }
  return n >= 2;
}

/** The game (HUDDLE kind: DICE, CARDS or HOOPS) an inmate is playing with others, all of them there; -1 none (a chat, on the way, or none). */
export function huddleGameOf(sim: Pick<SimContext, 'state'>, k: number): number {
  const g = huddleOf(sim, k);
  const h = sim.state.huddle;
  if (g < 0 || !h || h.kind[g] === HUDDLE.CHAT) return -1;
  return allThere(h, g) ? h.kind[g] : -1;
}

/** What the view and the director see of the gatherings under way: kind, its middle (tiles), who's there, since when. */
export interface HuddleView {
  slot: number;
  kind: number;
  x: number;
  z: number;
  who: number[];
  since: number;
  on: boolean;
}

export function huddlesNow(sim: SimContext, out: HuddleView[] = []): HuddleView[] {
  const h = sim.state.huddle;
  let n = 0;
  if (h && huddlesHere(sim))
    for (let g = 0; g < SLOTS; g++) {
      if (!active(h, g)) continue;
      const r = h.kind[g] === HUDDLE.HOOPS ? sim.world.def.leisure?.hoop : ringsOf(sim.world)[h.place[g]];
      if (!r) continue;
      // (Refilled in place: the view asks every frame.)
      const v = (out[n++] ??= { slot: 0, kind: 0, x: 0, z: 0, who: [], since: 0, on: false });
      v.slot = g;
      v.kind = h.kind[g];
      v.x = r.x;
      v.z = r.z;
      v.since = h.since[g];
      v.on = allThere(h, g);
      v.who.length = 0;
      for (let k = 0; k < SEATS; k++) if (h.who[g * SEATS + k] >= 0 && h.there[g * SEATS + k]) v.who.push(h.who[g * SEATS + k]);
    }
  out.length = n;
  return out;
}

/** Slot g broken up: everyone free to go; the next forms after a wait. */
function part(sim: SimContext, h: HuddleState, g: number, minute: number) {
  for (let k = 0; k < SEATS; k++) {
    h.who[g * SEATS + k] = -1;
    h.there[g * SEATS + k] = 0;
  }
  h.place[g] = -1;
  h.since[g] = 0;
  h.until[g] = 0;
  h.next[g] = minute + HUDDLE_GAP + draw(sim, prisonDay(sim.state.step), h.block, g, h.n[g], 0, HUDDLE_GAP_SPREAD + 1);
}

const active = (h: HuddleState, g: number) => {
  for (let k = 0; k < SEATS; k++) if (h.who[g * SEATS + k] >= 0) return true;
  return false;
};

/** Every slot broken up at once (the block over, a lockdown, a drill, the crowd elsewhere). */
function partAll(h: HuddleState) {
  h.who.fill(-1);
  h.there.fill(0);
  h.place.fill(-1);
  h.since.fill(0);
  h.until.fill(0);
}

/** Who may join a gathering now: free to go, nobody people come looking for, not on a machine, not reading, not at a gang's corner. */
function canJoin(sim: SimContext, k: number, corners: boolean): boolean {
  const s = sim.state;
  const m = s.inmates[k];
  if (!freeToGo(sim, k) || staysPut(sim, k) || huddleOf(sim, k) >= 0 || s.vend.line.includes(k)) return false;
  if (ON_MACHINE.includes(m.doing) || m.book > 0 || m.then === DOING.SIT_READ || m.doing === DOING.SIT_READ) return false;
  if (m.plan !== s.routine) return false;
  if (corners && gangOf(sim, k) >= 0) return false;
  return true;
}

/** Slot g's next gathering formed now, if its kind has a place free and enough come. */
function form(sim: SimContext, h: HuddleState, g: number, day: number, b: number, minute: number, end: number) {
  const s = sim.state;
  const n = h.n[g]++;
  let r = draw(sim, day, b, g, n, 1, 10);
  let kind = 0;
  while (kind < HUDDLE_WEIGHTS.length - 1 && r >= HUDDLE_WEIGHTS[kind]) r -= HUDDLE_WEIGHTS[kind++];
  const hoopTaken = Array.from({ length: SLOTS }, (_, q) => q).some((q) => q !== g && active(h, q) && h.kind[q] === HUDDLE.HOOPS);
  if (kind === HUDDLE.HOOPS && (hoopTaken || !hoopFree(sim, true))) kind = HUDDLE.CHAT;
  let place = -1;
  let cx = 0;
  let cz = 0;
  if (kind === HUDDLE.HOOPS) {
    const c = sim.world.def.leisure!.hoop;
    cx = c.x;
    cz = c.z;
  } else {
    const rings = ringsOf(sim.world);
    const free = rings
      .map((_, i) => i)
      .filter((i) => !h.place.some((p, q) => q !== g && active(h, q) && p === i) && !(s.pens && s.pens.who >= 0 && onPitch(sim, i)));
    if (!free.length) return part(sim, h, g, minute);
    place = free[draw(sim, day, b, g, n, 2, free.length)];
    cx = rings[place].x;
    cz = rings[place].z;
  }
  const [lo, hi] = HUDDLE_SIZE[kind];
  const size = lo + draw(sim, day, b, g, n, 3, hi - lo + 1);
  const corners = heldPiece(sim, s.routine) === 'corner';
  const near: Array<{ k: number; d: number }> = [];
  for (let k = 0; k < s.inmates.length; k++) {
    if (!canJoin(sim, k, corners)) continue;
    const m = s.inmates[k].body;
    const d = dist2(m.x, m.z, cx, cz);
    if (d <= HUDDLE_REACH * HUDDLE_REACH * UNIT * UNIT) near.push({ k, d });
  }
  // (Those not yet in one this block first, then the nearest; never more than half the crowd gathered at once.)
  const been = (k: number) => (k < 31 && h.done & (1 << k) ? 1 : 0);
  near.sort((a, c) => been(a.k) - been(c.k) || a.d - c.d || a.k - c.k);
  // (Half of those free to gather at all: a merchant, the fixer and the librarian stay at their posts.)
  let free = 0;
  for (let k = 0; k < s.inmates.length; k++) if (!staysPut(sim, k)) free++;
  const gathered = h.who.filter((k) => k >= 0).length;
  const room = Math.ceil(free / 2) - gathered;
  if (near.length < 2 || room < 2) return part(sim, h, g, minute);
  const len = HUDDLE_LENGTH + draw(sim, day, b, g, n, 4, HUDDLE_LENGTH_SPREAD + 1);
  h.kind[g] = kind;
  h.place[g] = place;
  h.since[g] = s.step;
  h.until[g] = Math.min(minute + len, end - HUDDLE_BREAK);
  near.slice(0, Math.min(size, room)).forEach(({ k }, q) => {
    if (k < 31) h.done |= 1 << k;
    h.who[g * SEATS + q] = k;
    h.there[g * SEATS + q] = 0;
    s.inmates[k].path = [];
  });
}

/** Each step: the slots set for the block, gatherings formed, arrivals, those who can't stay, the end. */
export function huddles(sim: SimContext) {
  if (!huddlesHere(sim)) return;
  const s = sim.state;
  const day = prisonDay(s.step);
  const b = blockNow(sim);
  const off = b < 0 || day < HUDDLE_FROM_DAY || s.lockdown || drillOn(sim) || crowdPlan(sim, s.routine) !== s.routine;
  if (off) {
    if (s.huddle && s.huddle.who.some((k) => k >= 0)) partAll(s.huddle);
    return;
  }
  const h = (s.huddle ??= newHuddles());
  const [from, end] = blockSpan(b);
  const minute = dayMinute(s.step);
  if (h.day !== day || h.block !== b) {
    partAll(h);
    h.day = day;
    h.block = b;
    h.n.fill(0);
    h.done = 0;
    for (let g = 0; g < SLOTS; g++) h.next[g] = from + HUDDLE_FIRST + draw(sim, day, b, g, 0, 5, HUDDLE_FIRST_SPREAD + 1);
  }
  const onMinute = s.step % STEPS_PER_MINUTE === 0;
  for (let g = 0; g < SLOTS; g++) {
    if (active(h, g)) {
      // Those who can't stay go: a fight, the player's talk or crew, a queue joined, out cold.
      let left = 0;
      for (let k = 0; k < SEATS; k++) {
        const i = g * SEATS + k;
        const who = h.who[i];
        if (who < 0) continue;
        if (!freeToGo(sim, who, true) || s.talk === who || s.vend.line.includes(who)) {
          // (Talked to at a game under way: the player's joining it.)
          if (s.talk === who && h.kind[g] !== HUDDLE.CHAT && allThere(h, g))
            sim.events.push({ type: 'huddle', what: 'joined', who, kind: h.kind[g] });
          h.who[i] = -1;
          h.there[i] = 0;
          continue;
        }
        // (Taken off somewhere else meanwhile, an odd job's digger to his bed, an act to the stage: no longer in it.)
        const placed = standOf(sim, h.kind[g], h.place[g], k);
        const body = s.inmates[who].body;
        if (h.there[i] && placed && Math.max(Math.abs(body.x - placed.x), Math.abs(body.z - placed.z)) > 2 * UNIT) {
          h.who[i] = -1;
          h.there[i] = 0;
          continue;
        }
        if (!h.there[i]) {
          const at = placed;
          const m = body;
          if (at && !m.moving && Math.max(Math.abs(m.x - at.x), Math.abs(m.z - at.z)) <= UNIT / 2) h.there[i] = s.step;
          else if (s.step - h.since[g] > HUDDLE_STALL_STEPS) {
            h.who[i] = -1;
            continue;
          }
        }
        left++;
      }
      const hoopGone = h.kind[g] === HUDDLE.HOOPS ? !hoopFree(sim, false) : !!s.pens && s.pens.who >= 0 && onPitch(sim, h.place[g]);
      if (left < 2 || hoopGone || (onMinute && minute >= h.until[g])) part(sim, h, g, minute);
      continue;
    }
    if (!onMinute || g >= HUDDLE_SLOTS[b] || minute < h.next[g]) continue;
    if (minute > end - HUDDLE_LAST) {
      h.next[g] = end;
      continue;
    }
    form(sim, h, g, day, b, minute, end);
  }
}

/**
 * A gathering set up at once, everyone already in their place (a lesson's scene, a test's): slot g, its kind, its place
 * (a ring's index; the hoop: -1), who's in it, lasting `minutes`. The block's slots set for now, the others to come.
 */
export function seatHuddle(sim: SimContext, g: number, kind: number, place: number, who: readonly number[], minutes = 120) {
  const s = sim.state;
  const b = blockNow(sim);
  if (b < 0) return;
  const h = (s.huddle ??= newHuddles());
  const day = prisonDay(s.step);
  const [from, end] = blockSpan(b);
  const minute = dayMinute(s.step);
  if (h.day !== day || h.block !== b) {
    partAll(h);
    h.day = day;
    h.block = b;
    h.n.fill(0);
    h.done = 0;
    for (let q = 0; q < SLOTS; q++) h.next[q] = from + HUDDLE_FIRST + draw(sim, day, b, q, 0, 5, HUDDLE_FIRST_SPREAD + 1);
  }
  h.kind[g] = kind;
  h.place[g] = place;
  h.since[g] = s.step;
  h.until[g] = Math.min(minute + minutes, end - HUDDLE_BREAK);
  who.forEach((k, q) => {
    const at = standOf(sim, kind, place, q);
    const m = s.inmates[k];
    if (!at || !m) return;
    h.who[g * SEATS + q] = k;
    h.there[g * SEATS + q] = s.step;
    if (k < 31) h.done |= 1 << k;
    m.body.x = at.x;
    m.body.z = at.z;
    m.body.moving = false;
    m.path = [];
  });
}

const marks: Body[] = Array.from({ length: SLOTS * SEATS }, () => bodyAt(0, 0));

/** Those gathered, where they stand (socialNow): each to its place, facing the middle (the hoop: the rim), its pose once there. */
export function huddleTargets(sim: SimContext, so: { follow: Array<Body | null>; gap: number[]; doing: number[]; face: number[] }) {
  const h = sim.state.huddle;
  if (!h || !huddlesHere(sim)) return;
  const s = sim.state;
  for (let g = 0; g < SLOTS; g++) {
    if (!active(h, g)) continue;
    const on = allThere(h, g);
    for (let k = 0; k < SEATS; k++) {
      const i = g * SEATS + k;
      const who = h.who[i];
      if (who < 0) continue;
      const m = s.inmates[who];
      if (!m || m.ko > 0 || m.angry > 0) continue;
      const at = standOf(sim, h.kind[g], h.place[g], k);
      if (!at) continue;
      m.wait = 0;
      const mark = marks[i];
      mark.x = at.x;
      mark.z = at.z;
      so.follow[who] = mark;
      so.gap[who] = 0;
      so.face[who] = at.face;
      so.doing[who] = !h.there[i] ? DOING.NOTHING : poseOf(h, g, k, on, s.step);
    }
  }
}

/** Steps a hoops turn lasts, and the shot's part of it (the ball up and away). */
const TURN = HOOPS_TURN_S * STEPS_PER_SECOND;
const SHOT = Math.round(1.2 * STEPS_PER_SECOND);

/** Whose turn it is at the hoop (0 or 1, the place in the gathering) and how far into it (steps), from when it formed. */
export function hoopsTurn(since: number, step: number): { k: number; into: number; n: number } {
  const t = Math.max(0, step - since);
  const n = Math.floor(t / TURN);
  return { k: n % 2, into: t - n * TURN, n };
}

/** The pose of the k-th there: a chat's, the game's once all are there (at the hoop, the one whose turn it is shoots). */
function poseOf(h: HuddleState, g: number, k: number, on: boolean, step: number): number {
  const kind = h.kind[g];
  if (kind === HUDDLE.CHAT) return DOING.CHAT;
  if (!on) return DOING.NOTHING;
  if (kind === HUDDLE.DICE) return DOING.DICE;
  if (kind === HUDDLE.CARDS) return DOING.CARDS;
  const turn = hoopsTurn(h.since[g], step);
  return turn.k === k && turn.into < SHOT ? DOING.SHOOT : DOING.NOTHING;
}
