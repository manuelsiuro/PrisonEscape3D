import { NIGHT_FROM, STEPS_PER_MINUTE } from '../../sim/tuning';
import { neighbours4 } from '../../sim/world/grid';
import { MAP_H, MAP_W } from '../../sim/world/World';
import { DISTRICTS, type LotUse } from '../content/districts';
import { cityItemNumber } from '../content/items';
import { SEARCHED } from '../content/loot';
import { LOCKED, PEOPLE, type Errand } from '../content/people';
import { BEATS, FLAG, isBeat, NOTES, STORY, THING_IN, THINGS, thingBit, WAYS, wayOf, type Beat, type Thing } from '../content/story';
import type { District } from '../gen/district';
import { CITY_N, gateOpen, LANES, neighbour, streamOf } from '../gen/plan';
import type { City, Target } from './City';
import { nightAt, noise } from './dead';

/**
 * The story (C3), a part of the city's simulation: where the things it needs lie (from the city's
 * seed alone), what finding them brings, the acts and their objectives, Dispatch's lines, and the
 * three ways out with their last nights. City.step calls in at each search, each minute and each
 * tile walked onto.
 */

/** A piece of furniture somewhere in the city. */
export interface Spot {
  district: number;
  prop: number;
}

export interface StoryPlaces {
  /** Where each of THINGS lies, and each note. */
  things: Spot[];
  notes: Spot[];
  /** Per way out (its number − 1): its district, its landmark's lot there, and the tile it's set going from. */
  wayDistrict: number[];
  wayLot: number[];
  exits: number[];
  /** The end of the pier the boat leaves from (the docks; -1: no pier, the boathouse's own tile serves). */
  pier: number;
  /** Where each of PEOPLE stands: their district, the building they hold (its lot) and their tile. */
  people: Array<{ district: number; lot: number; tile: number }>;
}

const N = MAP_W * MAP_H;
const BATTERY = cityItemNumber('battery');
const far = (a: number, b: number) => Math.abs((a % MAP_W) - (b % MAP_W)) + Math.abs(Math.floor(a / MAP_W) - Math.floor(b / MAP_W));

/** The tiles a piece of furniture stands on. */
function tilesOf(d: District, prop: number): number[] {
  const p = d.props[prop];
  const out: number[] = [];
  for (let z = p.z; z < p.z + (p.d ?? 1); z++) for (let x = p.x; x < p.x + (p.w ?? 1); x++) out.push(z * MAP_W + x);
  return out;
}

/** Where the story's things are, for a city: worked out once from its seed (every district generated to ask). */
export function storyPlaces(c: City): StoryPlaces {
  const plan = c.plan;
  const used = new Set<string>();
  const grids = new Map<number, Uint8Array>();
  const gridOf = (d: number) => grids.get(d) ?? (grids.set(d, c.districtGrid(d)), grids.get(d)!);
  // The furniture of a district that can be searched and stood beside (in one lot, or anywhere: lot -1).
  const pieces = (d: number, lot: number): number[] => {
    const dist = c.districtOf(d);
    const grid = gridOf(d);
    const out: number[] = [];
    dist.props.forEach((p, k) => {
      if (SEARCHED[p.kind] === undefined || used.has(`${d}:${k}`)) return;
      if (lot >= 0 && dist.lotAt[p.z * MAP_W + p.x] !== lot + 1) return;
      if (tilesOf(dist, k).some((t) => neighbours4(t).some(([j, ok]) => ok && !grid[j]))) out.push(k);
    });
    return out;
  };
  const pickIn = (d: number, lot: number, what: number, but?: (k: number) => boolean): Spot => {
    let from = pieces(d, lot);
    if (but && from.some((k) => !but(k))) from = from.filter((k) => !but(k));
    if (!from.length) from = pieces(d, -1);
    if (!from.length) throw new Error(`city ${plan.seed}: nowhere in district ${d} for the story's thing ${what}`);
    const prop = from[Math.floor(streamOf(plan.seed, 9100 + what)() * from.length)];
    used.add(`${d}:${prop}`);
    return { district: d, prop };
  };
  const lotOf = (d: number, use: LotUse) => c.districtOf(d).lots.findIndex((l) => l.use === use);
  const landmarkOf = (d: number) => lotOf(d, DISTRICTS[plan.kinds[d]].landmark);

  const things = THINGS.map((id, k): Spot => {
    const where = THING_IN[id];
    if (where === 'home') {
      // The nearest house to where the city starts with a bed in it: its furniture, the bed last.
      const dist = c.districtOf(plan.start);
      const sp = dist.spawn.z * MAP_W + dist.spawn.x;
      let best = -1;
      let bestD = Infinity;
      dist.lots.forEach((l, lot) => {
        if (l.use !== 'house' || !pieces(plan.start, lot).some((p) => dist.props[p].kind === 'bed')) return;
        const d = far(sp, Math.floor((l.z0 + l.z1) / 2) * MAP_W + Math.floor((l.x0 + l.x1) / 2));
        if (d < bestD) {
          bestD = d;
          best = lot;
        }
      });
      return pickIn(plan.start, best, k, (p) => dist.props[p].kind === 'bed');
    }
    if (where === 'near') {
      // The landmark of a district beside the start (one a street crosses to, if any does).
      const sides = [0, 1, 2, 3].filter((s) => neighbour(plan.start, s) >= 0);
      const open = sides.filter((s) => Array.from({ length: LANES }, (_, l) => gateOpen(plan, plan.start, s, l)).some(Boolean));
      const d = neighbour(plan.start, (open.length ? open : sides)[0]);
      return pickIn(d, landmarkOf(d), k);
    }
    const d = plan.kinds.findIndex((kind) => DISTRICTS[kind].landmark === where);
    return pickIn(d, lotOf(d, where), k);
  });
  const notes = Array.from({ length: NOTES }, (_, n): Spot => {
    const d = n < plan.kinds.length ? n : Math.floor(streamOf(plan.seed, 9300 + n)() * plan.kinds.length);
    return pickIn(d, -1, 100 + n);
  });

  const wayDistrict = WAYS.map((w) => plan.kinds.indexOf(w.kind));
  const wayLot = wayDistrict.map((d) => landmarkOf(d));
  // The tile a way out is set going from: a floor in its landmark, in the middle, clear of furniture and doors.
  const exits = wayDistrict.map((d, w) => {
    const dist = c.districtOf(d);
    const grid = gridOf(d);
    const lot = dist.lots[wayLot[w]];
    const busy = new Uint8Array(N);
    dist.props.forEach((p, k) => {
      if (SEARCHED[p.kind] !== undefined) for (const t of tilesOf(dist, k)) busy[t] = 1;
    });
    for (const l of dist.lots) for (const t of l.doors) busy[t] = 1;
    const mid = Math.floor((lot.z0 + lot.z1) / 2) * MAP_W + Math.floor((lot.x0 + lot.x1) / 2);
    let best = -1;
    let bestD = Infinity;
    for (let z = lot.z0; z <= lot.z1; z++)
      for (let x = lot.x0; x <= lot.x1; x++) {
        const i = z * MAP_W + x;
        const ch = dist.rows[z][x];
        if (grid[i] || dist.lotAt[i] !== wayLot[w] + 1 || (ch !== 'w' && ch !== ':' && ch !== '_')) continue;
        const beside = busy[i] || neighbours4(i).some(([j, ok]) => ok && busy[j]);
        const score = far(i, mid) + (beside ? 1000 : 0);
        if (score < bestD) {
          bestD = score;
          best = i;
        }
      }
    if (best < 0) throw new Error(`city ${plan.seed}: no floor in the ${lot.use}`);
    return best;
  });
  // The pier's end: the plank furthest on foot from the boathouse.
  const docks = wayDistrict[1];
  const dd = c.districtOf(docks);
  const dgrid = gridOf(docks);
  const steps = new Int32Array(N).fill(-1);
  steps[exits[1]] = 0;
  const queue = [exits[1]];
  let pier = -1;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    if (dd.rows[Math.floor(i / MAP_W)][i % MAP_W] === 'P' && (pier < 0 || steps[i] > steps[pier])) pier = i;
    for (const [j, ok] of neighbours4(i))
      if (ok && steps[j] < 0 && !dgrid[j]) {
        steps[j] = steps[i] + 1;
        queue.push(j);
      }
  }
  // The survivors: each in the first building of theirs the city has, on a floor with open floor all round (nothing is cut off by them).
  const people = PEOPLE.map((who) => {
    for (const use of who.uses)
      for (let d = 0; d < plan.kinds.length; d++) {
        const lot = lotOf(d, use);
        if (lot < 0) continue;
        const dist = c.districtOf(d);
        const grid = gridOf(d);
        const l = dist.lots[lot];
        const floor = (i: number) => {
          const ch = dist.rows[Math.floor(i / MAP_W)][i % MAP_W];
          return !grid[i] && dist.lotAt[i] === lot + 1 && (ch === 'w' || ch === ':' || ch === '_');
        };
        const mid = Math.floor((l.z0 + l.z1) / 2) * MAP_W + Math.floor((l.x0 + l.x1) / 2);
        let best = -1;
        let bestD = Infinity;
        for (let z = l.z0 + 1; z < l.z1; z++)
          for (let x = l.x0 + 1; x < l.x1; x++) {
            const i = z * MAP_W + x;
            if (!floor(i) || exits.some((e, w) => wayDistrict[w] === d && far(e, i) <= 2)) continue;
            let open = 0;
            for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (floor(i + dz * MAP_W + dx)) open++;
            if (open < 9) continue;
            const score = far(i, mid);
            if (score < bestD) {
              bestD = score;
              best = i;
            }
          }
        if (best >= 0) return { district: d, lot, tile: best };
      }
    throw new Error(`city ${plan.seed}: nowhere for the ${who.id}`);
  });
  return { things, notes, wayDistrict, wayLot, exits, pier, people };
}

/** The story's fields of a new city (and of a save from before them). */
export function freshStory() {
  return {
    act: 1,
    flags: 0,
    kit: 0,
    scouted: 0,
    way: 0,
    notes: 0,
    ready: 0,
    readyAt: 0,
    won: 0,
    heard: [] as Beat[],
    met: 0,
    errand: PEOPLE.map(() => 0),
    mark: PEOPLE.map(() => 0),
    brute: -1,
  };
}

/** Whether a save's story is sound; if not, it starts again (the city itself is kept). */
export function soundStory(c: City) {
  const s = c.state;
  const whole = [s.act, s.flags, s.kit, s.scouted, s.way, s.notes, s.ready, s.readyAt, s.won].every(Number.isInteger);
  const ok =
    whole &&
    s.act >= 1 &&
    s.act <= 5 &&
    s.flags >= 0 &&
    s.flags < 16 &&
    Number.isInteger(s.met) &&
    s.met >= 0 &&
    s.met < 1 << PEOPLE.length &&
    Array.isArray(s.errand) &&
    s.errand.length === PEOPLE.length &&
    s.errand.every((e) => e === 0 || e === 1 || e === 2) &&
    Array.isArray(s.mark) &&
    s.mark.length === PEOPLE.length &&
    s.mark.every((m) => Number.isInteger(m) && m >= 0) &&
    Number.isInteger(s.brute) &&
    s.brute >= -1 &&
    s.kit >= 0 &&
    s.kit < 1 << THINGS.length &&
    s.scouted >= 0 &&
    s.scouted < 8 &&
    s.way >= 0 &&
    s.way <= WAYS.length &&
    s.notes >= 0 &&
    s.notes < 1 << NOTES &&
    (s.ready === 0 || (s.ready === 1 && s.way > 0)) &&
    s.readyAt >= 0 &&
    s.readyAt <= s.step &&
    s.won === 0 &&
    Array.isArray(s.heard) &&
    s.heard.length <= BEATS.length &&
    s.heard.every(isBeat) &&
    new Set(s.heard).size === s.heard.length;
  if (!ok) Object.assign(s, freshStory());
  // (A pile left where a survivor now stands, a save from before them: beside them.)
  c.story.people.forEach((p) => {
    const at = `${p.district}:g${p.tile}`;
    if (!s.boxes[at]) return;
    (s.boxes[`${p.district}:g${p.tile + 1}`] ??= []).push(...s.boxes[at]);
    delete s.boxes[at];
  });
  // (A save from before the story, or one started again: what lies in furniture already searched is found, or it never could be.)
  c.story.things.forEach((sp, k) => {
    if (s.boxes[`${sp.district}:${sp.prop}`] !== undefined && !shut(c, k)) s.kit |= 1 << k;
  });
  c.story.notes.forEach((sp, n) => {
    if (s.boxes[`${sp.district}:${sp.prop}`] !== undefined) s.notes |= 1 << n;
  });
  s.act = actOf(c);
}

const has = (c: City, id: Thing) => (c.state.kit & thingBit(id)) !== 0;
const missing = (c: City, way: number) => (wayOf(way)?.needs ?? []).filter((id) => !has(c, id));

/** A thing kept in the police armoury, its key not yet had. */
const shut = (c: City, k: number) => LOCKED.includes(THINGS[k]) && !(c.state.flags & FLAG.KEY);

/** Whether a piece of furniture of this district still holds a thing of the story not yet had (a bed that does is looked into, not slept in). */
export const holds = (c: City, prop: number) =>
  c.story.things.some((sp, k) => sp.district === c.state.district && sp.prop === prop && !(c.state.kit & (1 << k)));

/** Dispatch says a line, once (only with the radio found to hear her on). */
function say(c: City, beat: Beat) {
  const s = c.state;
  if (!has(c, 'radio') || s.heard.includes(beat)) return;
  s.heard.push(beat);
  c.events.push({ type: 'say', beat });
}

/** The act the story is at, from what's been done. */
function actOf(c: City): number {
  const s = c.state;
  if (s.ready || s.won) return 5;
  if (s.way) return 4;
  if (s.flags & FLAG.FIXED) return 3;
  if (has(c, 'radio') && s.flags & FLAG.ATE && s.flags & FLAG.SLEPT) return 2;
  return 1;
}
function refreshAct(c: City) {
  const act = actOf(c);
  if (act === c.state.act) return;
  c.state.act = act;
  c.events.push({ type: 'act', act });
}

/** A way out set going in the district the player is in: 1 the beacon or the generator (the dead come for it), 2 the docks' fog; 0 none. */
export function going(c: City): number {
  const s = c.state;
  if (!s.ready || s.district !== c.story.wayDistrict[s.way - 1]) return 0;
  return s.way === 2 ? (nightAt(c.minute) ? 2 : 0) : 1;
}

/** Game minutes since the way out was set going. */
const since = (c: City) => Math.floor((c.state.step - c.state.readyAt) / STEPS_PER_MINUTE);
/** The metro's gates are open. */
export const gatesOpen = (c: City) => c.state.ready === 1 && c.state.way === 3 && since(c) >= STORY.metroHold;

/** A piece of furniture looked into: what the story hid in it (the armoury's, only with its key). */
export function storyFound(c: City, prop: number) {
  const s = c.state;
  const at = (sp: Spot) => sp.district === s.district && sp.prop === prop;
  const k = c.story.things.findIndex(at);
  if (k >= 0 && !(s.kit & (1 << k)) && shut(c, k)) {
    c.events.push({ type: 'refused', why: 'locked' });
    say(c, 'locked');
  } else if (k >= 0 && !(s.kit & (1 << k))) {
    s.kit |= 1 << k;
    c.events.push({ type: 'found', thing: k });
    say(c, k === 0 ? 'radio' : (`got.${THINGS[k]}` as Beat));
    if (s.way && wayOf(s.way)!.needs.includes(THINGS[k]) && !missing(c, s.way).length) say(c, `all${s.way}` as Beat);
    fix(c);
  }
  const n = c.story.notes.findIndex(at);
  if (n >= 0 && !(s.notes & (1 << n))) {
    s.notes |= 1 << n;
    c.events.push({ type: 'note', n });
  }
  refreshAct(c);
}

/** The radio mended: the aerial fitted, two batteries out of the pockets. */
function fix(c: City) {
  const s = c.state;
  if (s.flags & FLAG.FIXED || !has(c, 'radio') || !has(c, 'aerial') || c.count(BATTERY) < STORY.batteries) return;
  c.spend(BATTERY, STORY.batteries);
  s.flags |= FLAG.FIXED;
  c.events.push({ type: 'fixed' });
  say(c, 'fixed');
  say(c, 'people');
}

/** Something eaten, a bed slept in, a shelter made: the first act's doings, and what Dispatch says of them. */
export function storyDid(c: City, what: 'ate' | 'slept' | 'shelter') {
  if (what === 'shelter') return say(c, 'shelter');
  c.state.flags |= what === 'ate' ? FLAG.ATE : FLAG.SLEPT;
  refreshAct(c);
}

/** Onto another tile: a way out's landmark walked into is scouted; a beacon or a generator walked away from goes out. */
export function storyMoved(c: City) {
  const s = c.state;
  const lot = c.lot;
  for (let w = 1; w <= WAYS.length; w++) {
    if (s.scouted & (1 << (w - 1)) || s.district !== c.story.wayDistrict[w - 1] || lot !== c.story.wayLot[w - 1]) continue;
    s.scouted |= 1 << (w - 1);
    c.events.push({ type: 'scouted', way: w });
    if (s.flags & FLAG.FIXED) say(c, `scout${w}` as Beat);
  }
  if (s.ready && s.way !== 2 && s.district !== c.story.wayDistrict[s.way - 1]) stop(c, 'lost');
  arrived(c);
}

/** The way out set going comes to nothing (walked away from, or fallen): the things are kept, another night will do. */
function stop(c: City, beat: Beat) {
  const s = c.state;
  s.ready = 0;
  c.events.push({ type: 'ready', way: s.way, on: false });
  say(c, beat);
  refreshAct(c);
}

/** A Survivor fell. */
export function storyFell(c: City) {
  if (c.state.ready && c.state.way !== 2) stop(c, 'fell');
  else say(c, 'fell');
}

/** The helicopter is due and the player at the hospital: away. */
function arrived(c: City) {
  const s = c.state;
  if (s.ready && s.way === 1 && since(c) >= STORY.heliHold && s.district === c.story.wayDistrict[0] && c.lot === c.story.wayLot[0]) win(c);
}

function win(c: City) {
  const s = c.state;
  s.won = s.way;
  s.over = 2;
  s.act = 5;
  say(c, `win${s.way}` as Beat);
  c.events.push({ type: 'escaped', way: s.way });
}

/** A game minute: the radio mended once its parts are in hand, the first night said, a way out's clock. */
export function storyMinute(c: City) {
  const s = c.state;
  fix(c);
  if (c.minute === NIGHT_FROM) say(c, 'night');
  if (s.ready && going(c) === 1) {
    const m = since(c);
    if (s.way === 3 && m === STORY.metroHold) {
      c.events.push({ type: 'gates' });
      say(c, 'gates');
    }
    // The beacon lit, the generator running: boards don't hold for long, anywhere in the district (the building the player is in first).
    if (m > 0 && m % STORY.breachEvery === 0 && c.bars.length) {
      const mine = c.lot >= 0 ? c.district.lots[c.lot].doors.filter((t) => c.bars.includes(t)) : [];
      c.breach(mine[0] ?? Math.min(...c.bars));
    }
    arrived(c);
  }
  refreshAct(c);
}

/** What the action button would do for the story here: the way out's own tile, in reach. */
export function storyTarget(c: City): Target | null {
  const s = c.state;
  if (!s.way || s.over || s.district !== c.story.wayDistrict[s.way - 1]) return null;
  if (s.ready && (s.way === 1 || (s.way === 3 && !gatesOpen(c)))) return null;
  const tile = s.ready && s.way === 2 && c.story.pier >= 0 ? c.story.pier : c.story.exits[s.way - 1];
  return far(c.tile, tile) <= 1 ? { kind: 'way', key: 'w', tile, prop: null } : null;
}

/** The action at the way out: set going (every thing it takes in the kit), or taken. */
export function storyAct(c: City) {
  const s = c.state;
  if (!s.ready) {
    if (missing(c, s.way).length) return void c.events.push({ type: 'refused', why: 'parts' });
    if (s.way === 1 && !nightAt(c.minute)) return void c.events.push({ type: 'refused', why: 'notNight' });
    s.ready = 1;
    s.readyAt = s.step;
    c.events.push({ type: 'ready', way: s.way, on: true });
    say(c, `ready${s.way}` as Beat);
    // (The beacon's light, the generator's din: everything in the district turns to it.)
    if (s.way !== 2) noise(c, c.tile, MAP_W);
    return refreshAct(c);
  }
  if (s.way === 2 && !(c.minute >= STORY.tideFrom || c.minute < STORY.tideTo)) return void c.events.push({ type: 'refused', why: 'tide' });
  win(c);
}

/** A way out chosen (the journal's button): one already scouted, once the radio works, until it's set going. */
export function choose(c: City, way: number) {
  const s = c.state;
  if (!wayOf(way) || !(s.flags & FLAG.FIXED) || !(s.scouted & (1 << (way - 1))) || s.ready || s.way === way) return;
  s.way = way;
  c.events.push({ type: 'chose', way });
  // (Seen before the radio worked: what it takes is said now.)
  say(c, `scout${way}` as Beat);
  say(c, `way${way}` as Beat);
  if (!missing(c, way).length) say(c, `all${way}` as Beat);
  refreshAct(c);
}

/** One line of the act's list: what's asked, whether it's done, how far along, where on the map, the game minutes left. */
export interface Objective {
  id: string;
  done: boolean;
  n?: number;
  of?: number;
  at?: { district: number; tile: number };
  left?: number;
}

/** What the story asks now. */
export function objectives(c: City): Objective[] {
  const s = c.state;
  const P = c.story;
  const spot = (k: number) => {
    const sp = P.things[k];
    const p = c.districtOf(sp.district).props[sp.prop];
    return { district: sp.district, tile: p.z * MAP_W + p.x };
  };
  const thing = (id: Thing, name = `kit.${id}`): Objective => {
    const done = has(c, id);
    return { id: name, done, at: done ? undefined : spot(THINGS.indexOf(id)) };
  };
  const exit = (w: number) => ({ district: P.wayDistrict[w - 1], tile: P.exits[w - 1] });
  if (s.act === 1)
    return [{ id: 'eat', done: (s.flags & FLAG.ATE) !== 0 }, { id: 'sleep', done: (s.flags & FLAG.SLEPT) !== 0 }, thing('radio', 'radio')];
  if (s.act === 2)
    return [
      { id: 'batteries', done: c.count(BATTERY) >= STORY.batteries, n: Math.min(STORY.batteries, c.count(BATTERY)), of: STORY.batteries },
      thing('aerial'),
    ];
  if (s.act === 3)
    return [
      ...WAYS.map((_, k): Objective => {
        const done = (s.scouted & (1 << k)) !== 0;
        return { id: `scout${k + 1}`, done, at: done ? undefined : exit(k + 1) };
      }),
      { id: 'choose', done: false },
    ];
  const w = s.way;
  if (s.act === 4) {
    const ready = !missing(c, w).length;
    const key = (s.flags & FLAG.KEY) !== 0;
    // (A thing in the armoury: the fence's key first, and no place for the thing until it's had.)
    const needsKey = wayOf(w)!.needs.some((id) => LOCKED.includes(id) && !has(c, id));
    const fence = P.people[0];
    return [
      ...(needsKey || (key && wayOf(w)!.needs.some((id) => LOCKED.includes(id)))
        ? [{ id: 'key', done: key, at: key ? undefined : { district: fence.district, tile: fence.tile } }]
        : []),
      ...wayOf(w)!.needs.map((id) => {
        const o = thing(id);
        return LOCKED.includes(id) && !key ? { ...o, at: undefined } : o;
      }),
      { id: `begin${w}`, done: false, at: ready ? exit(w) : undefined },
    ];
  }
  if (s.won) return [];
  if (w === 1) return [{ id: 'hold1', done: false, left: Math.max(0, STORY.heliHold - since(c)), at: exit(1) }];
  if (w === 3)
    return gatesOpen(c)
      ? [{ id: 'down3', done: false, at: exit(3) }]
      : [{ id: 'hold3', done: false, left: Math.max(0, STORY.metroHold - since(c)), at: exit(3) }];
  return [{ id: 'pier2', done: false, at: { district: P.wayDistrict[1], tile: P.pier >= 0 ? P.pier : P.exits[1] } }];
}

/** The next district on the shortest way from one to another through the checkpoints (-1: there, or no way). */
export function towards(c: City, from: number, to: number): number {
  if (from === to) return -1;
  // (Back from the goal: each district's step toward it.)
  const next = new Array<number>(CITY_N).fill(-1);
  const queue = [to];
  const seen = new Set([to]);
  for (let q = 0; q < queue.length; q++)
    for (let side = 0; side < 4; side++) {
      const n = neighbour(queue[q], side);
      if (n < 0 || seen.has(n) || !c.plan.gates[queue[q]][side]) continue;
      seen.add(n);
      next[n] = queue[q];
      queue.push(n);
    }
  return next[from];
}

/** Where the act's unfinished lines point in the district the player is in: the place itself, or the checkpoint on the way to it. */
export function marks(c: City, list: readonly Objective[] = objectives(c)): number[] {
  const out: number[] = [];
  const here = c.state.district;
  for (const o of list) {
    if (o.done || !o.at) continue;
    let tile = o.at.tile;
    if (o.at.district !== here) {
      const to = towards(c, here, o.at.district);
      const gate = c.district.gates.find((g) => g.to === to);
      if (!gate) continue;
      tile = gate.tiles[0];
    }
    if (!out.includes(tile)) out.push(tile);
  }
  return out;
}

// ------------------------------------------------------------------ the survivors (C3b)
/** The errand a survivor has open (null: not met, or both done). */
export function errandOf(c: City, k: number): Errand | null {
  const s = c.state;
  return s.met & (1 << k) && s.errand[k] < 2 ? PEOPLE[k].errands[s.errand[k]] : null;
}

/** What a survivor's open errand still wants: how many, and how many are in hand (things in the pockets, or the dead put down since). */
export function wants(c: City, k: number): { item: number; n: number; have: number } | null {
  const e = errandOf(c, k);
  if (!e) return null;
  if (e.bring) {
    const item = cityItemNumber(e.bring[0]);
    return { item, n: e.bring[1], have: Math.min(e.bring[1], c.count(item)) };
  }
  return { item: 0, n: e.kills ?? 0, have: Math.max(0, Math.min(e.kills ?? 0, c.state.kills - c.state.mark[k])) };
}

/** The action at a survivor: met the first time (their first errand asked), else a word. Nothing is handed over by it. */
export function meet(c: City, k: number) {
  const s = c.state;
  if (s.met & (1 << k)) return void c.events.push({ type: 'talk', who: k, what: 'chat' });
  s.met |= 1 << k;
  s.mark[k] = s.kills;
  say(c, 'met');
  c.events.push({ type: 'talk', who: k, what: 'met' });
}

/** The open errand of the survivor beside the player handed over (their card's button) and paid; nothing happens short of what it asks. */
export function giveErrand(c: City, k: number) {
  const s = c.state;
  if (c.target()?.key !== `n${k}`) return;
  const e = errandOf(c, k);
  const w = wants(c, k);
  if (!e || !w || w.have < w.n) return;
  if (e.bring) c.spend(w.item, w.n);
  for (const [id, n] of e.gives) c.hand(cityItemNumber(id), n);
  if (e.key) {
    s.flags |= FLAG.KEY;
    say(c, 'key');
  }
  s.errand[k]++;
  s.mark[k] = s.kills;
  c.events.push({ type: 'talk', who: k, what: 'done' });
}

/** A swap with the survivor beside the player: refused without the things. */
export function trade(c: City, k: number, offer: number) {
  const t = PEOPLE[k]?.trades[offer];
  if (!t || !(c.state.met & (1 << k)) || c.target()?.key !== `n${k}`) return;
  const give = cityItemNumber(t[0][0]);
  if (c.count(give) < t[0][1]) return void c.events.push({ type: 'refused', why: 'noTrade' });
  c.spend(give, t[0][1]);
  c.hand(cityItemNumber(t[1][0]), t[1][1]);
  c.events.push({ type: 'traded', who: k, item: cityItemNumber(t[1][0]) });
}
