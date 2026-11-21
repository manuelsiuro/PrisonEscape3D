import { tileAt } from '../../sim/world/grid';
import { MAP_H, MAP_W } from '../../sim/world/World';
import { ALIVE_REV, HAPPEN, HAPPEN_LOOT, HAPPEN_WEIGHT, HAPPENINGS, RUNNER_TRADES, SKILL, SKILL_POINTS } from '../content/alive';
import { DISTRICTS, isBuilding, type LotUse } from '../content/districts';
import { cityItem, cityItemNumber } from '../content/items';
import { SEARCHED } from '../content/loot';
import { DECO } from '../gen/district';
import { CITY_N, streamOf } from '../gen/plan';
import { TUNNEL } from '../gen/tunnel';
import type { City, Stack, Target } from './City';
import { isDown, noise, putSome, ZED } from './dead';
import { skillUp } from './skills';
import { lockedLots } from './tools';
import { remark } from './story';

/**
 * The day's happenings (C5 batch 6, 2.71), a part of the city's simulation, in a city begun from then: one a day from day 2, two now
 * and then, said at dawn with the weather and marked on the map with their time, every one of them optional. A supply drop lands on
 * a street (heard, and the dead come for it); a stranger cries for help from a building full of the dead (cleared, they thank the
 * player); a horde crosses a district; a crashed army truck waits for a crowbar; the fence's runner sells manuals and seeds at the
 * market for the day; a note says where a stash lies. Planned from the city's seed and the day (no draw); what was planned is kept in
 * the save, with what has come of it.
 */

const N = MAP_W * MAP_H;
const CROWBAR = cityItemNumber('crowbar');
const K = Object.fromEntries(HAPPENINGS.map((k, i) => [k, i])) as Record<(typeof HAPPENINGS)[number], number>;
export const HAPPEN_KIND = K;

/** A happening as the save keeps it: [code (day × 2 + its place that day), kind, district, tile (a stash: the furniture), done, minute]. */
export type HappenEntry = number[];
/** Done: 0 not yet; 1 done (opened, answered, found, put down); 2 missed (the stranger lost, the crate gone). */
export const DONE = { NOT: 0, DONE: 1, MISSED: 2 } as const;

export const freshHappen = () => ({ happen: [] as number[][] });

/** A save's field made sound before the city is built from it. */
export function soundHappen(st: { happen?: unknown }) {
  const h = st.happen;
  st.happen = Array.isArray(h)
    ? h.filter(
        (e): e is number[] =>
          Array.isArray(e) &&
          e.length === 6 &&
          e.every(Number.isInteger) &&
          e[0] >= 0 &&
          e[1] >= 0 &&
          e[1] < HAPPENINGS.length &&
          e[2] >= 0 &&
          e[2] < CITY_N &&
          e[3] >= 0 &&
          e[3] < N &&
          e[4] >= 0 &&
          e[4] <= 2,
      )
    : [];
}

/** Whether the city has happenings (begun from 2.71). */
export const happenOn = (c: City) => c.state.rev >= ALIVE_REV;
/** The day the happenings run from: 06:00 to the next. */
const happenDay = (c: City) => (c.minute >= HAPPEN.said ? c.day : c.day - 1);
const cheb = (a: number, b: number) =>
  Math.max(Math.abs((a % MAP_W) - (b % MAP_W)), Math.abs(Math.floor(a / MAP_W) - Math.floor(b / MAP_W)));
const far = (a: number, b: number) => Math.abs((a % MAP_W) - (b % MAP_W)) + Math.abs(Math.floor(a / MAP_W) - Math.floor(b / MAP_W));

/** When a happening ends (game minutes of its day; a truck and a stash wait: never). */
export function endsAt(e: HappenEntry): number {
  const kind = e[1];
  if (kind === K.drop) return 24 * 60 + HAPPEN.said;
  if (kind === K.cry) return HAPPEN.cryTo;
  if (kind === K.horde) return e[5] + HAPPEN.hordeFor;
  if (kind === K.runner) return HAPPEN.runnerTo;
  return Infinity;
}
/** Minutes since its day's 06:00 (the clock past midnight counts on). */
const sinceDawn = (c: City, e: HappenEntry) => {
  const day = e[0] >> 1;
  return (c.day - day) * 24 * 60 + c.minute;
};
/** On now: begun, not ended, not done. */
export const happening = (c: City, e: HappenEntry) => !e[4] && sinceDawn(c, e) >= e[5] && sinceDawn(c, e) < endsAt(e);
/** Still to come or on (for the map and the journal). */
export const ahead = (c: City, e: HappenEntry) => !e[4] && sinceDawn(c, e) < endsAt(e);

// ------------------------------------------------------------------ the plan

/** The street tiles of a district where something can stand: bare street, clear of its checkpoints, the story's places, what's built. */
function streetSpots(c: City, d: number, two: boolean): number[] {
  const dist = c.districtOf(d);
  const grid = c.districtGrid(d);
  const built = new Set((c.state.built[d] ?? []).map((p) => p[0]));
  const open = (i: number) =>
    i >= 0 &&
    i < N &&
    dist.rows[Math.floor(i / MAP_W)][i % MAP_W] === ',' &&
    dist.deco[i] === DECO.NONE &&
    !grid[i] &&
    !built.has(i) &&
    !c.state.boxes[`${d}:g${i}`];
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    const x = i % MAP_W;
    const z = Math.floor(i / MAP_W);
    if (x < 2 || z < 2 || x >= MAP_W - 3 || z >= MAP_H - 2) continue;
    if (!open(i) || (two && !open(i + 1))) continue;
    // (Room all round: never the only way along a street.)
    if (![i - MAP_W, i + MAP_W, i - 1, i + (two ? 2 : 1)].every((j) => open(j) || (two && j === i + 1))) continue;
    if (two && !(open(i + 1 - MAP_W) && open(i + 1 + MAP_W))) continue;
    if (dist.gates.some((g) => g.tiles.some((t) => cheb(t, i) <= HAPPEN.gateClear))) continue;
    if (cheb(dist.spawn.z * MAP_W + dist.spawn.x, i) <= 2) continue;
    out.push(i);
  }
  return out;
}

/** The buildings a stranger can be shut in: ordinary ones, not locked, not a survivor's, not where a way out begins. */
const CRY_IN: readonly LotUse[] = ['house', 'shop', 'office', 'clinic', 'warehouse'];
function cryLots(c: City, d: number): Array<{ lot: number; tile: number }> {
  const dist = c.districtOf(d);
  const grid = c.districtGrid(d);
  const shut = new Set(lockedLots(c, d));
  const P = c.story;
  const out: Array<{ lot: number; tile: number }> = [];
  dist.lots.forEach((l, lot) => {
    if (!CRY_IN.includes(l.use) || !l.doors.length || shut.has(lot)) return;
    // (The review: never the player's home, a building with anything built in it, nor the one the player is in.)
    if (c.state.home[0] === d && dist.lotAt[c.state.home[1]] === lot + 1) return;
    if (c.state.district === d && dist.lotAt[c.tile] === lot + 1) return;
    if ((c.state.built[d] ?? []).some((p) => dist.lotAt[p[0]] === lot + 1)) return;
    if (P.people.some((p) => p.district === d && p.lot === lot)) return;
    if (P.wayDistrict.some((w, k) => w === d && P.wayLot[k] === lot)) return;
    // (A floor with floor all round, nearest the middle: where the stranger stands.)
    const floor = (i: number) => {
      const ch = dist.rows[Math.floor(i / MAP_W)][i % MAP_W];
      return !grid[i] && dist.lotAt[i] === lot + 1 && (ch === 'w' || ch === ':' || ch === '_');
    };
    const mid = Math.floor((l.z0 + l.z1) / 2) * MAP_W + Math.floor((l.x0 + l.x1) / 2);
    let best = -1;
    for (let z = l.z0 + 1; z < l.z1; z++)
      for (let x = l.x0 + 1; x < l.x1; x++) {
        const i = z * MAP_W + x;
        if (!floor(i)) continue;
        let n = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (floor(i + dz * MAP_W + dx)) n++;
        if (n === 9 && (best < 0 || far(i, mid) < far(best, mid))) best = i;
      }
    if (best >= 0) out.push({ lot, tile: best });
  });
  return out;
}

/** The furniture a stash can lie in: searchable, beside open floor, not the story's, not in a chained building. */
function stashProps(c: City, d: number): number[] {
  const dist = c.districtOf(d);
  const grid = c.districtGrid(d);
  const shut = new Set(lockedLots(c, d));
  const P = c.story;
  const taken = new Set([...P.things, ...P.notes, ...c.busNotes].filter((sp) => sp.district === d).map((sp) => sp.prop));
  const out: number[] = [];
  dist.props.forEach((p, k) => {
    // (The review: never a bed: one searched and emptied is slept in, and the stash in it could never be found.)
    if (SEARCHED[p.kind] === undefined || p.kind === 'bin' || p.kind === 'bed' || taken.has(k) || (c.state.broken[d] ?? []).includes(k))
      return;
    const lot = dist.lotAt[p.z * MAP_W + p.x] - 1;
    if (lot >= 0 && shut.has(lot)) return;
    const t = p.z * MAP_W + p.x;
    if ([t - MAP_W, t + 1, t + MAP_W, t - 1].some((j) => j >= 0 && j < N && !grid[j])) out.push(k);
  });
  return out;
}

/** Where the runner stands: a bare street tile nearest the market's landmark's door. */
function runnerSpot(c: City, d: number): number {
  const dist = c.districtOf(d);
  const lm = dist.lots.find((l) => l.use === DISTRICTS[c.plan.kinds[d]].landmark);
  const door = lm?.doors[0] ?? dist.spawn.z * MAP_W + dist.spawn.x;
  const spots = streetSpots(c, d, false);
  let best = -1;
  for (const i of spots) if (best < 0 || far(i, door) < far(best, door)) best = i;
  return best;
}

/** The happenings of a day: drawn from the city's seed and the day (no draw from the state), placed as the city stands now. */
export function planDay(c: City, day: number): HappenEntry[] {
  if (day < HAPPEN.fromDay) return [];
  const many = (c.salt(13_000 + day) >>> 0) % 100 < HAPPEN.twoIn ? 2 : 1;
  const out: HappenEntry[] = [];
  const kinds: number[] = [];
  const market = c.plan.kinds.indexOf('market');
  for (let k = 0; k < many; k++) {
    const rnd = streamOf(c.plan.seed, 13_100 + day * 4 + k);
    // (Never two of a kind in a day.)
    // (The runner only where there's a market, and not where the day's other happening is.)
    const noRunner = market < 0 || out.some((e) => e[2] === market);
    const weights: number[] = HAPPEN_WEIGHT.map((w, i) => (kinds.includes(i) || (i === K.runner && noRunner) ? 0 : w));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = rnd() * total;
    const kind = weights.findIndex((w) => (roll -= w) < 0);
    if (kind < 0) continue;
    kinds.push(kind);
    const code = day * 2 + k;
    // (Never in the same district as the other of the day, nor in the tunnel.)
    const used = out.map((e) => e[2]);
    const districts = Array.from({ length: CITY_N }, (_, d) => d).filter((d) => !used.includes(d));
    const pickD = () => districts[Math.floor(rnd() * districts.length)];
    let d = kind === K.runner ? market : pickD();
    let tile = -1;
    let minute = HAPPEN.said;
    for (let tries = 0; tries < 6 && tile < 0; tries++) {
      if (tries) d = kind === K.runner ? market : pickD();
      if (kind === K.drop || kind === K.horde || kind === K.truck) {
        const spots = streetSpots(c, d, kind === K.truck);
        if (spots.length) tile = spots[Math.floor(rnd() * spots.length)];
      } else if (kind === K.cry) {
        const lots = cryLots(c, d);
        if (lots.length) tile = lots[Math.floor(rnd() * lots.length)].tile;
      } else if (kind === K.runner) tile = runnerSpot(c, d);
      else {
        const props = stashProps(c, d);
        if (props.length) tile = props[Math.floor(rnd() * props.length)];
      }
    }
    if (tile < 0) continue;
    if (kind === K.drop) minute = HAPPEN.dropFrom + 30 * Math.floor(rnd() * ((HAPPEN.dropTo - HAPPEN.dropFrom) / 30 + 1));
    else if (kind === K.horde) minute = HAPPEN.hordeFrom + 60 * Math.floor(rnd() * ((HAPPEN.hordeTo - HAPPEN.hordeFrom) / 60 + 1));
    else if (kind === K.runner) minute = HAPPEN.runnerFrom;
    out.push([code, kind, d, tile, DONE.NOT, minute]);
  }
  return out;
}

/** The last day planned (0: none yet). */
const plannedDay = (c: City) => c.state.happen.reduce((m, e) => Math.max(m, e[0] >> 1), 0);

// ------------------------------------------------------------------ a minute

/**
 * A game minute (City's, after the weather): a new day's happenings planned and said (those of the days before that are over let
 * go), a crate landing, the runner come and gone, a horde come, a stranger lost at nightfall or answered.
 */
export function happenMinute(c: City) {
  if (!happenOn(c) || c.state.district === TUNNEL || c.state.over) return;
  const s = c.state;
  const today = happenDay(c);
  if (today >= HAPPEN.fromDay && plannedDay(c) < today) {
    // (What's over of the days before is let go; a truck and a stash wait to be found; an opened truck stays where it lies.)
    const kept = s.happen.filter((e) => (e[1] === K.truck ? true : e[1] === K.stash ? !e[4] : ahead(c, e)));
    for (const e of s.happen) if (!kept.includes(e) && e[1] === K.drop) delete s.boxes[`${e[2]}:e${e[0]}`];
    s.happen = kept;
    const fresh = planDay(c, today);
    s.happen.push(...fresh);
    for (const e of fresh) c.events.push({ type: 'happen', what: 'said', kind: e[1], code: e[0] });
    if (fresh.length) remark(c, 'happen');
    c.happenRev++;
    // (The district as it now stands: what's let go walked on again, what's new here with the dead it brings.)
    here(
      c,
      fresh.some((e) => e[2] === s.district),
    );
  }
  for (const e of s.happen) {
    const at = sinceDawn(c, e);
    if (e[4]) continue;
    // (A crate lands: heard round it; the dead about come for it.)
    if (e[1] === K.drop && at === e[5]) {
      c.happenRev++;
      if (e[2] === s.district) {
        noise(c, e[3], HAPPEN.dropHeard);
        here(c, false);
      }
      c.events.push({ type: 'happen', what: 'landed', kind: e[1], code: e[0] });
    }
    // (The runner comes, and goes: the street put up again without them.)
    if (e[1] === K.runner && (at === e[5] || at === endsAt(e))) {
      c.happenRev++;
      if (e[2] === s.district) here(c, false);
    }
    // (A horde comes into the district the player is in.)
    if (e[1] === K.horde && at === e[5] && e[2] === s.district) hordeCrosses(c, e);
    // (Nightfall: the stranger nobody came for is gone.)
    if (e[1] === K.cry && at >= endsAt(e)) {
      e[4] = DONE.MISSED;
      c.happenRev++;
      if (e[2] === s.district) here(c, false);
      c.events.push({ type: 'happen', what: 'lost', kind: e[1], code: e[0] });
    }
  }
  cryAnswered(c);
}

/** The happenings of the district the player is in. */
export const happenHere = (c: City) => (happenOn(c) ? c.state.happen.filter((e) => e[2] === c.state.district) : []);

/** The tiles a happening stands on (a truck two, a crate one, the runner one; a stash and a cry none: the furniture, the floor). */
export function happenTiles(c: City, e: HappenEntry): number[] {
  if (e[1] === K.truck) return [e[3], e[3] + 1];
  if (e[1] === K.drop) return sinceDawn(c, e) >= e[5] || e[4] ? [e[3]] : [];
  if (e[1] === K.runner) return happening(c, e) ? [e[3]] : [];
  return [];
}
/** Whether a drop's crate is down and still there (opened or not, until the next dawn's plan lets it go). */
const crateDown = (c: City, e: HappenEntry) => e[1] === K.drop && e[4] !== DONE.MISSED && sinceDawn(c, e) >= e[5];

/**
 * The district the player is in, as its happenings stand: what stands in the way (a truck, a crate, the runner) and, `arriving`, the
 * dead a happening brings (round a crate, in the stranger's building). City.enter and populate call it.
 */
export function here(c: City, arriving: boolean) {
  for (const e of happenHere(c)) {
    for (const t of happenTiles(c, e)) c.happenAt[t] = 1;
    if (!arriving) continue;
    if (crateDown(c, e) && !e[4]) aroundCrate(c, e);
    if (e[1] === K.cry && happening(c, e)) inCry(c, e);
    if (e[1] === K.horde && happening(c, e)) hordeCrosses(c, e);
  }
  c.blockHappen();
}

/** The dead about a crate on the ground: so many, round it in the street. */
function aroundCrate(c: City, e: HappenEntry) {
  if (c.peace) return;
  const near: number[] = [];
  for (const i of c.zedPlaces.streets) if (cheb(i, e[3]) <= 5 && cheb(i, e[3]) >= 2) near.push(i);
  putSome(c, near, ZED.IDLE, HAPPEN.dropDead);
}
/** The dead in the stranger's building. */
function inCry(c: City, e: HappenEntry) {
  if (c.peace) return;
  const lot = c.district.lotAt[e[3]];
  const floor = c.zedPlaces.indoors.filter((i) => c.district.lotAt[i] === lot && cheb(i, e[3]) >= 2);
  putSome(c, floor, ZED.IDLE, HAPPEN.cryDead);
}
/** A horde: so many, in the streets at one side of the district, walking to the other. Once a happening. */
function hordeCrosses(c: City, e: HappenEntry) {
  if (e[4] || c.peace) return;
  e[4] = DONE.DONE;
  const west = e[3] % MAP_W < MAP_W / 2;
  const from = c.zedPlaces.streets.filter((i) => (west ? i % MAP_W < 10 : i % MAP_W >= MAP_W - 10));
  const to = c.zedPlaces.streets.filter((i) => (west ? i % MAP_W >= MAP_W - 10 : i % MAP_W < 10));
  const before = c.state.zeds.length;
  putSome(c, from.length ? from : c.zedPlaces.streets, ZED.WANDER, HAPPEN.hordeDead);
  c.state.zeds.slice(before).forEach((z, k) => {
    if (!to.length) return;
    z.mode = ZED.SEEK;
    z.goal = to[(k * 7 + e[0]) % to.length];
    z.path = [];
  });
  c.events.push({ type: 'happen', what: 'horde', kind: e[1], code: e[0] });
}

/** The stranger's building cleared, the player in it: thanked, and handed what they had. */
function cryAnswered(c: City) {
  const s = c.state;
  for (const e of happenHere(c)) {
    if (e[1] !== K.cry || !happening(c, e)) continue;
    const lot = c.district.lotAt[e[3]];
    if (!lot || c.district.lotAt[c.tile] !== lot) continue;
    if (s.zeds.some((z) => !isDown(z) && c.district.lotAt[tileAt(z.body.x, z.body.z)] === lot)) continue;
    e[4] = DONE.DONE;
    c.happenRev++;
    for (const [item, n] of loot(c, e)) {
      if (cityItem(item)?.wear !== undefined) c.handWorn(item, n);
      else c.hand(item, n);
    }
    skillUp(c, SKILL.SCAVENGER, SKILL_POINTS.find);
    c.events.push({ type: 'happen', what: 'thanks', kind: e[1], code: e[0] });
  }
}
/** A tile walked onto: a stranger's building cleared is answered at once. */
export const happenMoved = (c: City) => {
  if (happenOn(c)) cryAnswered(c);
};

// ------------------------------------------------------------------ the button

/** What a happening holds: what it always has, and one of a list (the city's seed and the happening). */
function loot(c: City, e: HappenEntry): Stack[] {
  const kind = HAPPENINGS[e[1]] as 'drop' | 'truck' | 'stash' | 'cry';
  const L = HAPPEN_LOOT[kind];
  const rnd = streamOf(c.plan.seed, 15_000 + e[0]);
  const one = L.one[Math.floor(rnd() * L.one.length)];
  return [...L.always, one].map(([id, n]) => [cityItemNumber(id), n] as Stack);
}

/** The happening the button would take (a crate, a truck, the runner) beside the player. */
export function happenTarget(c: City): Target | null {
  const here = c.tile;
  for (const e of happenHere(c)) {
    const tiles = happenTiles(c, e);
    if (!tiles.some((t) => far(t, here) === 1)) continue;
    if (e[1] === K.runner) return { kind: 'npc', key: `r${e[0]}`, tile: e[3], prop: null };
    if (e[1] === K.truck && !e[4]) return { kind: 'event', key: `e${e[0]}`, tile: e[3], prop: 'truck' };
    return { kind: 'box', key: `e${e[0]}`, tile: e[3], prop: e[1] === K.truck ? 'truck' : 'drop' };
  }
  return null;
}
/** The tiles of a happening's key (`e` a crate or a truck; `r` the runner), for what's in reach. */
export function happenKeyTiles(c: City, key: string): number[] {
  const code = Number(key.slice(1));
  const e = c.state.happen.find((x) => x[0] === code && x[2] === c.state.district);
  return e ? happenTiles(c, e) : [];
}

/** The button at a truck: forced with a crowbar (the work, heard); without one, said. */
export function happenAct(c: City, key: string) {
  const s = c.state;
  if (s.search === key) return;
  if (!c.count(CROWBAR)) return void c.events.push({ type: 'refused', why: 'truckCrowbar' });
  c.close();
  s.search = key;
  s.searchLeft = HAPPEN.truckSteps;
  noise(c, c.tile, HAPPEN.truckHeard);
  c.events.push({ type: 'forcing', what: 'truck' });
}

/** A crate or a truck's box opened the first time: what it holds, and the happening done. True if it was one. */
export function happenOpened(c: City, key: string, box: Stack[]): boolean {
  if (!key.startsWith('e')) return false;
  const code = Number(key.slice(1));
  const e = c.state.happen.find((x) => x[0] === code && x[2] === c.state.district);
  if (!e || e[4]) return false;
  e[4] = DONE.DONE;
  // (The review: as a search finds things, stacked to their size, not pushed in raw.)
  for (const [item, n] of loot(c, e)) c.stow(box, item, n);
  c.happenRev++;
  skillUp(c, SKILL.SCAVENGER, SKILL_POINTS.find);
  c.events.push({ type: 'happen', what: 'found', kind: e[1], code: e[0] });
  return true;
}

/** A piece of furniture opened (or broken up): the stash a note spoke of, if it lies there. */
export function stashIn(c: City, prop: number, box: Stack[]) {
  if (!happenOn(c)) return;
  for (const e of happenHere(c)) {
    if (e[1] !== K.stash || e[4] || e[3] !== prop) continue;
    e[4] = DONE.DONE;
    for (const [item, n] of loot(c, e)) c.stow(box, item, n);
    c.happenRev++;
    skillUp(c, SKILL.SCAVENGER, SKILL_POINTS.find);
    c.events.push({ type: 'happen', what: 'found', kind: e[1], code: e[0] });
  }
}

/** The runner's swap (the card's buttons): refused without the things. */
export function runnerTrade(c: City, offer: number) {
  const t = RUNNER_TRADES[offer];
  const e = happenHere(c).find((x) => x[1] === K.runner && happening(c, x));
  if (!t || !e || c.target()?.key !== `r${e[0]}`) return;
  const give = cityItemNumber(t[0][0]);
  if (c.count(give) < t[0][1]) return void c.events.push({ type: 'refused', why: 'noTrade' });
  c.spend(give, t[0][1]);
  const got = cityItemNumber(t[1][0]);
  if (cityItem(got)?.wear !== undefined) c.handWorn(got, t[1][1]);
  else c.hand(got, t[1][1]);
  c.events.push({ type: 'traded', who: RUNNER, item: got });
}
/** The runner's number where a survivor's would be (the trade command's, the card's). */
export const RUNNER = 15;

/** 2.71, the review: the street tiles of this district a happening stands on now or will (nothing is built there meanwhile). */
export function happenSpotsHere(c: City): number[] {
  const out: number[] = [];
  for (const e of happenHere(c)) {
    if (e[1] === K.truck) out.push(e[3], e[3] + 1);
    else if ((e[1] === K.drop && e[4] !== DONE.MISSED && (ahead(c, e) || crateDown(c, e))) || (e[1] === K.runner && ahead(c, e)))
      out.push(e[3]);
  }
  return out;
}

/** What the view draws of the district's happenings: a crate down (opened or not), a truck, the runner, a stranger calling. */
export function happenView(c: City): Array<{ kind: 'drop' | 'truck' | 'runner' | 'cry'; tile: number; open: boolean }> {
  const out: Array<{ kind: 'drop' | 'truck' | 'runner' | 'cry'; tile: number; open: boolean }> = [];
  for (const e of happenHere(c)) {
    if (e[1] === K.drop && crateDown(c, e)) out.push({ kind: 'drop', tile: e[3], open: e[4] === DONE.DONE });
    else if (e[1] === K.truck) out.push({ kind: 'truck', tile: e[3], open: e[4] === DONE.DONE });
    else if (e[1] === K.runner && happening(c, e)) out.push({ kind: 'runner', tile: e[3], open: false });
    else if (e[1] === K.cry && happening(c, e)) out.push({ kind: 'cry', tile: e[3], open: false });
  }
  return out;
}

/** The day's happenings for the map and the journal: on or to come, and those done today. */
export const happenList = (c: City): HappenEntry[] =>
  happenOn(c) ? c.state.happen.filter((e) => ahead(c, e) || e[0] >> 1 === happenDay(c) || (e[1] === K.truck && !e[4])) : [];

/** Whether a district is a building's floor (for the stash's words): what the furniture is and where. */
export function stashWhere(c: City, e: HappenEntry): { prop: string; use: LotUse | 'none' } {
  const dist = c.districtOf(e[2]);
  const p = dist.props[e[3]];
  const lot = p ? dist.lotAt[p.z * MAP_W + p.x] - 1 : -1;
  return { prop: p?.kind ?? 'shelf', use: lot >= 0 && isBuilding(dist.lots[lot].use) ? dist.lots[lot].use : 'none' };
}
/** The tile a happening is marked at on the map (a stash: its furniture's). */
export function happenSpot(c: City, e: HappenEntry): number {
  if (e[1] !== K.stash) return e[3];
  const p = c.districtOf(e[2]).props[e[3]];
  return p ? p.z * MAP_W + p.x : 0;
}
