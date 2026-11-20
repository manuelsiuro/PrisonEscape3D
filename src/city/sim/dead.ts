import { findPath, nearestDir } from '../../sim/ai/path';
import { canWork, facedBreak, startBreak } from './salvage';
import { builtHere, poundPiece, removePiece, wornStep, type Built } from './build';
import { PIECES, pieceOf, BUILD } from '../content/build';
import { RUSH, TRAP, BASE_SIEGE } from '../content/rush';
import { rushFollows, rushMinute } from './rush';
import { armourBite, hiddenBy, inSmoke } from './gear';
import { lineOfSight } from '../../sim/ai/sight';
import { DIR_X, DIR_Z } from '../../sim/command';
import { randomInt } from '../../sim/rng';
import { bodyAt, walk, type Body } from '../../sim/systems/movement';
import { NIGHT_FROM, NIGHT_TO, STEPS_PER_MINUTE, UNIT } from '../../sim/tuning';
import { centerX, centerZ, tileAt } from '../../sim/world/grid';
import { MAP_H, MAP_W } from '../../sim/world/World';
import { BLOATER, BLOW, BRUTE, CRAWLER, DEAD, DOWN, kindStats, RUNNER, SCREAMER, SIEGE, ZKIND } from '../content/dead';
import { ESCAPE_KINDS, isBuilding } from '../content/districts';
import { cityItem } from '../content/items';
import { districtX, districtZ } from '../gen/plan';
import { STORY } from '../content/story';
import { crowded, type City, type Stack } from './City';
import { going } from './story';
import { lampLit, torchLit, wayToDark } from './light';
import { PLACES, TUNNEL } from '../gen/tunnel';
import { shoot } from './ranged';

/**
 * The dead (C2b), a part of the city's simulation (City.step calls it after the player has moved):
 * who is in the district, what each is doing, what it sees and hears, its walk, its bite; and the
 * player's blow. Only the district the player is in has any: they are put down afresh each time it's
 * entered (by the hour, the day and how far it is from the start), so a checkpoint is a way out of a
 * chase, as a door isn't.
 */

/** What one of the dead is doing. Never renumber: saves store it. */
export const ZED = { IDLE: 0, WANDER: 1, SEEK: 2, CHASE: 3 } as const;

export interface Zed {
  body: Body;
  hp: number;
  mode: number;
  /** Where it's going (a tile; -1 nowhere) and the way there. */
  goal: number;
  path: number[];
  /** The step it last saw the player, and where; the step of its last bite; steps left reeling. */
  seen: number;
  last: number;
  bit: number;
  reel: number;
  /** Steps it has been in reach of the player (its lunge). */
  near: number;
  /** Its own pace, a little off the others' (thousandths). */
  pace: number;
  /** C3b, optional: what it is (ZKIND; none: a shambler), and a brute's steps at a barred door. */
  kind?: number;
  pound?: number;
  /** 2.61, optional: knocked down, the steps it lies before it gets up (finished meanwhile by any blow). */
  down?: number;
  /** 2.68, optional: one of the Rush's (1): after the player wherever they are, through boards and what's built, not shy of light. */
  rush?: number;
  /** 2.69, optional: blinded by smoke until this step (it sees nobody meanwhile). */
  blind?: number;
}

/** 2.61: one of the dead lying knocked down. */
export const isDown = (z: Zed) => (z.down ?? 0) > 0;

const N = MAP_W * MAP_H;
const REACHED = 220;

export const nightAt = (minute: number) => minute >= NIGHT_FROM || minute < NIGHT_TO;

/** How bad a district is: its distance from the start in districts, and one more where a way out begins. */
export function danger(c: City, d: number): number {
  // (2.56: under the city, as bad as anywhere above.)
  if (d === TUNNEL) return STORY.tunnelDanger;
  const far = Math.max(Math.abs(districtX(d) - districtX(c.plan.start)), Math.abs(districtZ(d) - districtZ(c.plan.start)));
  return far + (ESCAPE_KINDS.includes(c.plan.kinds[d]) ? 1 : 0);
}

/** How many there should be now: indoors and in the streets. */
export function quota(c: City): { indoors: number; streets: number } {
  // (2.56: the tunnel's own, whatever the hour: they stand along it in the dark.)
  if (c.state.district === TUNNEL) return { indoors: STORY.tunnelDead, streets: 0 };
  const dg = danger(c, c.state.district);
  // (A way out set going here: the night's count by day too, and more.)
  const set = going(c);
  if (nightAt(c.minute) || set === 1) {
    // (The night that began on day n is night n, through to its dawn.)
    // (A Survivor's falls count as nights more: the city doesn't wait for them.)
    const night = (c.minute < NIGHT_TO ? c.day - 1 : c.day) + c.state.deaths;
    const all =
      DEAD.nightBase +
      DEAD.nightPerDanger * dg +
      Math.min(DEAD.nightMost, DEAD.nightPerNight * Math.max(0, night - 1)) +
      (set ? STORY.extra : 0);
    return { indoors: indoorsOf(c, Math.floor(all / 4)), streets: all - Math.floor(all / 4) };
  }
  return {
    indoors: indoorsOf(c, DEAD.dayBase + DEAD.dayPerDanger * dg + Math.min(DEAD.dayMost, DEAD.dayPerDay * (c.day - 1))),
    streets: dg,
  };
}

/** 2.58: those indoors, less the share of the floors behind chained doors: nobody is in there, and the rest is no fuller for it. */
const indoorsOf = (c: City, n: number) => Math.round(n * c.zedShare);

/** A district's open tiles indoors and on its streets (worked out when it's entered). */
export function places(c: City): { indoors: number[]; streets: number[]; deep: number[] } {
  const d = c.district;
  const indoors: number[] = [];
  const streets: number[] = [];
  let shut = 0;
  for (let i = 0; i < N; i++) {
    // (2.67: what's built doesn't count: the places are the district's own, the same entered, forced or loaded.)
    if (c.grid[i] && !c.pieceAt[i]) continue;
    const ch = d.rows[Math.floor(i / MAP_W)][i % MAP_W];
    const lot = d.lotAt[i];
    if (ch === ',') streets.push(i);
    // (2.58: not in a locked building: nobody has been in.)
    else if (lot && isBuilding(d.lots[lot - 1].use) && (ch === 'w' || ch === ':' || ch === '_')) {
      if (c.lockedLot(lot - 1)) shut++;
      else indoors.push(i);
    }
  }
  c.zedShare = indoors.length + shut ? indoors.length / (indoors.length + shut) : 1;
  return { indoors, streets, deep: [] };
}

const farEnough = (c: City, tile: number, clear: number) => {
  const here = c.tile;
  return Math.max(Math.abs((tile % MAP_W) - (here % MAP_W)), Math.abs(Math.floor(tile / MAP_W) - Math.floor(here / MAP_W))) >= clear;
};

/** One more put down on a tile of `from` (`up`: out of the metro's tunnel, into its station whatever its doors, nearer by). */
function put(c: City, from: readonly number[], mode: number, up = false): boolean {
  if (!from.length) return false;
  for (let tries = 0; tries < 12; tries++) {
    const tile = from[randomInt(c.state, from.length)];
    if (!farEnough(c, tile, up ? DEAD.clearUp : DEAD.clear)) continue;
    // (2.67: not on a piece built since the district was entered.)
    if (c.pieceAt[tile]) continue;
    // (2.52: nor in strong light, unless called up by the generator.)
    if (!up && c.lit[tile]) continue;
    // (Never inside a shelter: its doors are barred against them.)
    const lot = c.district.lotAt[tile] - 1;
    if (!up && lot >= 0 && (c.shelter(lot) || c.safeLots.has(lot))) continue;
    // (C3b: at night, in the streets: a runner now and then from the third night, one brute from the fifth where it's bad. No draw before.)
    let kind: number = ZKIND.SHAMBLER;
    const nightNo = (c.minute < NIGHT_TO ? c.day - 1 : c.day) + c.state.deaths;
    if (mode === ZED.WANDER && nightAt(c.minute) && nightNo >= RUNNER.fromNight) {
      // (One brute a district a night: put down, it isn't followed by another before the next.)
      const stamp = c.state.district * 1000 + nightNo;
      if (nightNo >= BRUTE.fromNight && danger(c, c.state.district) >= BRUTE.danger && c.state.brute !== stamp) {
        kind = ZKIND.BRUTE;
        c.state.brute = stamp;
      } else if (randomInt(c.state, RUNNER.oneIn) === 0) kind = ZKIND.RUNNER;
    }
    // (2.60: a screamer from the second night, a bloater from the fourth; by day from the second, a crawler in the dark indoors. No draw before.)
    if (!kind && mode === ZED.WANDER && nightAt(c.minute)) {
      if (nightNo >= SCREAMER.fromNight && randomInt(c.state, SCREAMER.oneIn) === 0) kind = ZKIND.SCREAMER;
      else if (nightNo >= BLOATER.fromNight && randomInt(c.state, BLOATER.oneIn) === 0) kind = ZKIND.BLOATER;
    }
    if (
      !kind &&
      mode === ZED.IDLE &&
      !nightAt(c.minute) &&
      c.day >= CRAWLER.fromDay &&
      c.dim[tile] &&
      randomInt(c.state, CRAWLER.oneIn) === 0
    )
      kind = ZKIND.CRAWLER;
    c.state.zeds.push({
      body: bodyAt(tile % MAP_W, Math.floor(tile / MAP_W), 1 + randomInt(c.state, 16)),
      hp: kindStats(kind).health,
      mode,
      goal: -1,
      path: [],
      seen: -9999,
      last: -1,
      bit: -9999,
      reel: 0,
      near: 0,
      pace: 900 + randomInt(c.state, 200),
      ...(kind ? { kind } : {}),
    });
    return true;
  }
  return false;
}

/** 2.65: the dusk the night's dead came at last: its day (0, before the first). */
const duskOf = (c: City) => (c.minute >= NIGHT_FROM ? c.day : c.day - 1);

/** 2.65: how many of the dead were put down in a place (a district, the tunnel) since the last dusk. */
export function clearedIn(c: City, d = c.state.district): number {
  const cl = c.state.cleared;
  return cl.length && cl[0] === duskOf(c) ? (cl[1 + d] ?? 0) : 0;
}

/** 2.65: one more put down here: counted until the next dusk (the first since, the counts begin again). */
function countDown(c: City) {
  const s = c.state;
  const dusk = duskOf(c);
  if (s.cleared.length !== PLACES + 1 || s.cleared[0] !== dusk) s.cleared = [dusk, ...Array<number>(PLACES).fill(0)];
  s.cleared[1 + s.district]++;
}

/**
 * The district just entered: its dead put down for the hour it is. 2.65: less those put down there since the last dusk (indoors first):
 * ground cleared stays cleared until nightfall, when the night's come back a few at a time. Before, a checkpoint crossed twice put
 * every one of them back.
 */
export function populate(c: City) {
  c.state.zeds = [];
  const q = quota(c);
  const gone = clearedIn(c);
  // (By day with nothing set going nobody comes before nightfall: what is said of it holds.)
  const day = !nightAt(c.minute) && !going(c) && c.state.district !== TUNNEL;
  if (gone) {
    const less = Math.min(gone, q.indoors + q.streets);
    const inside = Math.min(q.indoors, less);
    q.indoors -= inside;
    q.streets -= less - inside;
    if (less && day) c.events.push({ type: 'quiet', n: less, all: q.indoors + q.streets === 0 });
  }
  const at = c.zedPlaces;
  // (2.53: by day they wait where daylight doesn't reach; after dark, anywhere indoors.)
  // (Only the dark they can stand in: not a shelter's, not a lit room's. No more than one to `darkEach` tiles of it: the rest indoors anywhere, as before.)
  const dark = nightAt(c.minute)
    ? []
    : at.deep.filter((i) => !c.lit[i] && !c.shelter(c.district.lotAt[i] - 1) && !c.safeLots.has(c.district.lotAt[i] - 1));
  const inDark = Math.min(q.indoors, Math.floor(dark.length / DEAD.darkEach));
  let short = 0;
  for (let k = 0; k < q.indoors; k++) if (!put(c, k < inDark ? dark : at.indoors, ZED.IDLE)) short++;
  for (let k = 0; k < q.streets; k++) if (!put(c, at.streets, ZED.WANDER)) short++;
  // (By day, one that found no place isn't put down at the next entry either: the district stays as it was seen.)
  if (day) for (let k = 0; k < short; k++) countDown(c);
  // (2.65: come back by the tunnel's stairs: the generator's din calls the station's dead, and the tunnel's heard the player.)
  if (c.climbed && (going(c) === 1 || c.state.district === TUNNEL)) noise(c, c.tile, MAP_W);
  if (c.state.district === TUNNEL) c.climbed = false;
  // (2.68: crossed into mid-Rush: half the last wave follows.)
  rushFollows(c);
}

/** A noise the dead hear: those within its reach (tiles) and not already after someone go and look. */
export function noise(c: City, tile: number, reach: number, again = false) {
  // (The docks' fog, the boat ready: sound carries.)
  if (going(c) === 2) reach *= STORY.fogHearing;
  for (const z of c.state.zeds) {
    if (z.mode === ZED.CHASE || isDown(z)) continue;
    // (2.58: one at a sleeper's boards isn't called off them by what it hears behind them.)
    if (z.pound !== undefined && z.kind !== ZKIND.BRUTE) continue;
    // (A noise that goes on, a car's alarm: one already on its way somewhere else, to ground at dawn or out of a light, isn't called back each minute.)
    if (again && z.mode === ZED.SEEK && z.goal !== tile) continue;
    const zt = tileAt(z.body.x, z.body.z);
    if (Math.max(Math.abs((zt % MAP_W) - (tile % MAP_W)), Math.abs(Math.floor(zt / MAP_W) - Math.floor(tile / MAP_W))) > reach) continue;
    z.mode = ZED.SEEK;
    z.goal = tile;
    z.path = [];
  }
}

/** The longest reach of the weapons carried, in tiles past the fists'. */
const longest = (c: City) => Math.max(0, ...c.state.inv.map((st) => (cityItem(st[0])?.attack ? (cityItem(st[0])?.reach ?? 0) : 0)));

/** A blow's harm with a weapon of this `attack` (0: fists): doubled on one that never saw it coming, halved worn out. */
const blowOf = (attack: number, unseen: boolean, tired: boolean) =>
  Math.ceil((BLOW.fists + attack * 2) / (tired ? 2 : 1)) * (unseen ? BLOW.unseen : 1);

/**
 * 2.65: the weapon that strikes this one of the dead, of those carried that reach it (null: fists), with no button to choose: one that
 * puts it down for good (a blade, or any on a crawler or a bloater), else one that knocks it down, else the strongest; of two alike, the
 * stronger, then the longer. One lying down is finished by any blow: a blade if there is one. Before, the strongest always struck, so a
 * knife carried with a nailed bat never did, nor a spear against a bloater from out of its burst.
 */
export function armFor(c: City, z: Zed, unseen: boolean, tired: boolean): Stack | null {
  const p = c.state.player;
  const d2 = (z.body.x - p.x) ** 2 + (z.body.z - p.z) ** 2;
  const lies = isDown(z);
  const forGood = z.kind === ZKIND.CRAWLER || z.kind === ZKIND.BLOATER;
  // (What a choice is worth: 2 puts it down for good, 1 knocks it down; then its harm, then its reach.)
  const worth = (st: Stack | null): number[] => {
    const it = cityItem(st?.[0] ?? 0);
    const harm = blowOf(it?.attack ?? 0, unseen, tired);
    const edge = it?.edge ? 1 : 0;
    if (lies) return [edge, harm, it?.reach ?? 0];
    const empties = harm >= z.hp;
    return [empties ? (edge || forGood ? 2 : 1) : 0, harm, it?.reach ?? 0];
  };
  let best: Stack | null = null;
  let bestW = d2 <= BLOW.reach * BLOW.reach ? worth(null) : [-1];
  for (const st of c.state.inv) {
    const it = cityItem(st[0]);
    if (!it?.attack) continue;
    const r = BLOW.reach + (it.reach ?? 0) * UNIT;
    if (d2 > r * r) continue;
    const w = worth(st);
    const k = w.findIndex((v, i) => v !== (bestW[i] ?? -1));
    if (k >= 0 && w[k] > (bestW[k] ?? -1)) [best, bestW] = [st, w];
  }
  return best;
}

/** The player's blow: the nearest of the dead ahead and in reach is struck; its noise carries either way. */
export function strike(c: City) {
  const s = c.state;
  // (2.55: a loaded crossbow shoots the one ahead that is out of arm's reach; the blow is for those in it.)
  // (2.65: as far as the longest carried reaches: the spear's one more tile is never lost behind a stronger weapon.)
  const reach = BLOW.reach + longest(c) * UNIT;
  if (shoot(c, reach)) return;
  if (s.step - s.swung < BLOW.every || s.sleeping) return;
  const tired = s.energy <= 0;
  const p = s.player;
  const fx = DIR_X[p.facing] ?? 0;
  const fz = DIR_Z[p.facing] ?? 0;
  let best = -1;
  let bestD = Infinity;
  // (2.64: none ahead, the nearest in reach on any side: the player turns to it. One at their side or back bit them unanswered.)
  let side = -1;
  let sideD = Infinity;
  s.zeds.forEach((z, k) => {
    const dx = z.body.x - p.x;
    const dz = z.body.z - p.z;
    // (2.61: one on its feet before one lying down: the blow goes where the danger is.)
    const d2 = dx * dx + dz * dz + (isDown(z) ? 1e9 : 0);
    if (dx * dx + dz * dz > reach * reach || !lineOfSight(c.world, p.x, p.z, z.body.x, z.body.z)) return;
    // (Ahead, or on top of them.)
    if (dx * dx + dz * dz > 400 * 400 && dx * fx + dz * fz <= 0) {
      if (d2 < sideD) [sideD, side] = [d2, k];
      return;
    }
    if (d2 < bestD) [bestD, best] = [d2, k];
  });
  // (And one lying ahead doesn't take the blow from one on its feet beside or behind: the blow goes where the danger is.)
  if (side >= 0 && (best < 0 || (isDown(s.zeds[best]) && !isDown(s.zeds[side])))) {
    best = side;
    p.facing = nearestDir(s.zeds[side].body.x - p.x, s.zeds[side].body.z - p.z);
  }
  // (2.66: none of the dead in reach, something faced that breaks: the blows go into it, a moment's work.)
  // (Not with one of the dead within three tiles: a swing to meet it is a swing. Nor what nothing carried breaks: a swing too.)
  if (best < 0 && !s.zeds.some((z) => !isDown(z) && Math.hypot(z.body.x - p.x, z.body.z - p.z) < 3 * UNIT)) {
    const work = facedBreak(c);
    if (work && canWork(c, work)) return startBreak(c, work);
  }
  s.swung = s.step;
  s.energy = Math.max(0, s.energy - BLOW.energy);
  noise(c, c.tile, BLOW.noise);
  if (best < 0) return void c.events.push({ type: 'swing', hit: false, dead: false });
  // (One of the dead struck: what was being broken is left.)
  if (s.search.startsWith('b')) s.search = '';
  const z = s.zeds[best];
  // (2.60: one that isn't after anyone never saw it coming.)
  const unseen = z.mode !== ZED.CHASE;
  // (2.65: the weapon for this one, of those that reach it: its blow, its edge, its wear.)
  const arm = armFor(c, z, unseen, tired);
  const held = cityItem(arm?.[0] ?? 0);
  c.struck = arm?.[0] ?? 0;
  // (2.61: one lying knocked down is finished by any blow.)
  if (isDown(z)) {
    c.events.push({ type: 'swing', hit: true, dead: true, x: z.body.x, z: z.body.z, left: 0 });
    c.wearWeapon(arm);
    return void putDown(c, [z]);
  }
  const harm = blowOf(held?.attack ?? 0, unseen, tired);
  const K = kindStats(z.kind);
  z.hp -= harm;
  z.reel = K.reel;
  z.near = 0;
  z.mode = ZED.CHASE;
  z.seen = s.step;
  z.last = c.tile;
  // (2.61: without an edge it is only knocked down, unless it lies low already or would burst.)
  const down = z.hp <= 0 && !held?.edge && z.kind !== ZKIND.CRAWLER && z.kind !== ZKIND.BLOATER;
  // Pushed back along the blow, as far as there's room (knocked down: it falls where it stood, in reach of the next).
  const dir = nearestDir(z.body.x - p.x, z.body.z - p.z);
  if (!down) walk(c.zedWorld, z.body, dir, K.shove);
  z.body.facing = nearestDir(p.x - z.body.x, p.z - z.body.z);
  const dead = z.hp <= 0 && !down;
  c.events.push({ type: 'swing', hit: true, dead, x: z.body.x, z: z.body.z, unseen, left: Math.max(0, z.hp) / K.health, down });
  c.wearWeapon(arm);
  if (down) {
    // (Followed through: the next blow comes at once, to finish it or to meet the next.)
    s.swung = s.step - BLOW.every + DOWN.follow;
    // (Lying, it is after nobody: the pack goes round or over it, and it isn't counted as a chaser.)
    z.mode = ZED.IDLE;
    z.hp = 0;
    z.down = DOWN.steps;
    z.reel = 0;
    z.near = 0;
    z.path = [];
    z.pound = undefined;
    z.body.moving = false;
  }
  if (dead) putDown(c, [z]);
}

/**
 * 2.60: these of the dead are put down for good (a blow, a bolt, a fire): counted, said (`fell`: where and what, for the picture), and
 * a bloater bursts: the player near it is hurt, each of the dead near it too, and those that fall to it are put down in their turn.
 */
export function putDown(c: City, list: Zed[]) {
  const s = c.state;
  const queue = [...list];
  for (let q = 0; q < queue.length; q++) {
    const z = queue[q];
    const at = s.zeds.indexOf(z);
    if (at < 0) continue;
    s.zeds.splice(at, 1);
    s.kills++;
    countDown(c);
    c.events.push({ type: 'fell', x: z.body.x, z: z.body.z, facing: z.body.facing, kind: z.kind ?? 0, seed: z.pace, lying: isDown(z) });
    if (z.kind !== ZKIND.BLOATER) continue;
    // (2.61: a wall between stops it.)
    const near = (b: { x: number; z: number }) =>
      (b.x - z.body.x) ** 2 + (b.z - z.body.z) ** 2 <= BLOATER.within * BLOATER.within &&
      lineOfSight(c.world, z.body.x, z.body.z, b.x, b.z);
    for (const o of s.zeds) {
      if (!near(o.body)) continue;
      o.hp -= BLOATER.dead;
      if (o.hp <= 0) queue.push(o);
    }
    const hit = near(s.player);
    c.events.push({ type: 'burst', x: z.body.x, z: z.body.z, harm: hit ? BLOATER.harm : 0 });
    noise(c, tileAt(z.body.x, z.body.z), BLOATER.noise);
    if (hit) {
      if (s.sleeping) c.wakeNow('attacked');
      c.hurt(BLOATER.harm, 'burst');
      // (Fallen to it: a Survivor is carried home, the district's dead left behind.)
      if (s.over || c.events.some((e) => e.type === 'dead')) return;
    }
  }
  // (2.65: the last of them here, by day and nothing set going: nothing more comes before nightfall. Said after any burst.)
  if (list.length && !s.zeds.length && !nightAt(c.minute) && !going(c) && s.district !== TUNNEL) c.events.push({ type: 'cleared' });
}

/**
 * 2.58: a sleeper behind boards is found, now and then: on the hour, from the third night, one of the dead in the streets near by
 * (not in a light) makes for where they lie, by the barred door, and pounds it until the boards give. A draw only when someone
 * sleeps in a shelter at night: nothing else is moved by it.
 */
function siege(c: City) {
  const s = c.state;
  const lot = c.lot;
  // (2.68: or a base: a sleeper with pieces built round them, inside walls of their own or not.)
  const shelter = lot >= 0 && c.shelter(lot);
  const base = !shelter && c.anyBuilt() && builtHere(c).some(([t]) => cheb(t, c.tile) <= BUILD.comfortReach);
  if (!shelter && !base) return;
  const nightNo = (c.minute < NIGHT_TO ? c.day - 1 : c.day) + s.deaths;
  // (2.68: asleep in a light, a few chances more: a fire in the open is seen.)
  // (Only for a base: a shelter's odds are as they were, in every city.)
  const lit = base && c.lit[c.tile] ? BASE_SIEGE.litMore : 0;
  const odds = Math.min(SIEGE.most, (nightNo - SIEGE.fromNight + 1) * SIEGE.perNight) + (odds0(nightNo) ? lit : 0);
  if (odds <= 0 || randomInt(s, 100) >= odds) return;
  const here = c.tile;
  let best: Zed | null = null;
  let bestD = SIEGE.near + 1;
  for (const z of s.zeds) {
    const zt = tileAt(z.body.x, z.body.z);
    if (z.mode === ZED.CHASE || z.pound !== undefined || z.kind === ZKIND.BRUTE || isDown(z) || !c.zedStreet[zt] || c.lit[zt]) continue;
    const d = Math.max(Math.abs((zt % MAP_W) - (here % MAP_W)), Math.abs(Math.floor(zt / MAP_W) - Math.floor(here / MAP_W)));
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  if (!best) return;
  // (Its way goes by the boards: only a locked door stops it. 2.68: and through what's built, pounded on the way.)
  const from = tileAt(best.body.x, best.body.z);
  const path = c.anyBuilt()
    ? throughPath(c, from, here, true, false)
    : findPath(c.world, from, (i) => i === here, here, 2500, undefined, c.lockGrid);
  if (!path?.length) return;
  best.mode = ZED.SEEK;
  best.goal = here;
  best.path = path;
  best.pound = 0;
}

/** Whether a night is one the dead look for sleepers on at all (the third on). */
const odds0 = (nightNo: number) => nightNo >= SIEGE.fromNight;

const cheb = (a: number, b: number) =>
  Math.max(Math.abs((a % MAP_W) - (b % MAP_W)), Math.abs(Math.floor(a / MAP_W) - Math.floor(b / MAP_W)));

/**
 * 2.68: a wave of the Rush: so many put down in the streets, out of sight, each one after the player wherever they are (it looks
 * where they are now and then: `RUSH.retarget`). A brute in the second and the last from the second Rush, a bloater from the third.
 * How many were put down (fewer where the streets are short of room).
 */
export function rushWave(c: City, size: number, rush: number, wave: number): number {
  const s = c.state;
  let put0 = 0;
  for (let j = 0; j < size && s.zeds.length < 180; j++) {
    if (!put(c, c.zedPlaces.streets, ZED.WANDER)) continue;
    const z = s.zeds[s.zeds.length - 1];
    const kind =
      j === 0 && rush >= RUSH.bruteFrom && (wave === 1 || wave === 3)
        ? ZKIND.BRUTE
        : j === 1 && rush >= RUSH.bloaterFrom
          ? ZKIND.BLOATER
          : (z.kind ?? 0);
    if (kind === ZKIND.BRUTE || kind === ZKIND.BLOATER) {
      z.kind = kind;
      z.hp = kindStats(kind).health;
    }
    z.rush = 1;
    z.mode = ZED.SEEK;
    z.goal = -1;
    z.path = [];
    put0++;
  }
  return put0;
}

/**
 * 2.68: the way through what's built (and, with `boards`, the barred doors) when there's none round it: the cheapest, each piece in
 * it weighing by the blows it takes (a barricade before a plank wall, a plank wall before a metal one: the dead go for the weak
 * point, where the traps are), no step slipped diagonally past a piece or a wall. Before (2.67), the shortest, as if nothing stood.
 */
const PER_BLOW = 4;
const BOARDS_COST = 240;
const tcost = new Int32Array(N);
const tfrom = new Int32Array(N);
const tseen = new Uint32Array(N);
let tsearch = 0;
export function throughPath(c: City, start: number, goal: number, boards: boolean, brute: boolean): number[] | null {
  if (start === goal || start < 0 || goal < 0) return null;
  const grid = boards ? c.lockGrid : c.zedGrid;
  const list = builtHere(c);
  const hpAt = new Map<number, number>();
  for (const p of list) if (stops(c, p[0])) hpAt.set(p[0], p[2]);
  const open = (i: number) => !grid[i] || hpAt.has(i);
  // (What it costs to step onto a tile: a piece's blows, the boards' while they hold.)
  const extra = (i: number) => {
    const hp = hpAt.get(i);
    if (hp !== undefined) return Math.ceil(hp / (brute ? BUILD.bruteHarm : 1)) * PER_BLOW;
    return boards && c.zedGrid[i] && !c.lockGrid[i] ? (brute ? BOARDS_COST / 4 : BOARDS_COST) : 0;
  };
  tsearch++;
  // A plain binary heap of [cost, tile] packed: cost × N + tile.
  const heap: number[] = [];
  const push = (v: number) => {
    heap.push(v);
    let k = heap.length - 1;
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (heap[up] <= heap[k]) break;
      [heap[up], heap[k]] = [heap[k], heap[up]];
      k = up;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l] < heap[m]) m = l;
        if (r < heap.length && heap[r] < heap[m]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  tcost[start] = 0;
  tseen[start] = tsearch;
  tfrom[start] = -1;
  push(start);
  let explored = 0;
  while (heap.length && explored++ < 4500) {
    const v = pop();
    const i = v % N;
    const g = (v - i) / N;
    if (g > tcost[i]) continue;
    if (i === goal) {
      const path: number[] = [];
      for (let k = i; k !== start; k = tfrom[k]) path.push(k);
      return path.reverse();
    }
    const x = i % MAP_W;
    const z = (i - x) / MAP_W;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= MAP_W || nz >= MAP_H) continue;
        const j = nz * MAP_W + nx;
        if (!open(j)) continue;
        // (Diagonally only between two clear tiles: nothing, built or not, at either corner.)
        if (dx && dz && (grid[i + dx] || grid[i + dz * MAP_W])) continue;
        const ng = g + (dx && dz ? 14 : 10) + extra(j);
        if (tseen[j] === tsearch && tcost[j] <= ng) continue;
        tseen[j] = tsearch;
        tcost[j] = ng;
        tfrom[j] = i;
        push(ng * N + j);
      }
  }
  return null;
}

/** 2.68: the way to the player for one of the Rush's: round what's built when it can, else through it (the boards too). */
function rushWay(c: City, from: number, here: number, brute: boolean): number[] {
  return (
    findPath(c.world, from, (i) => i === here, here, 2500, undefined, brute ? c.lockGrid : c.zedGrid) ??
    throughPath(c, from, here, true, brute) ??
    []
  );
}

/** One step of the dead: the night's come and the day's go, each one looks, walks and bites. */
export function stepDead(c: City) {
  const s = c.state;
  const p = s.player;
  const night = nightAt(c.minute);
  const here = c.tile;
  // The hour's turns, on the minute.
  if (s.step % STEPS_PER_MINUTE === 0) {
    const m = c.minute;
    // (2.56: under the ground no hour turns: no dusk, no nightfall, no dawn, and those standing in the tunnel stand on.)
    const above = s.district !== TUNNEL;
    if (above && (m === 19 * 60 || m === 20 * 60 + 30)) c.events.push({ type: 'dusk', soon: m === 19 * 60 ? 120 : 30 });
    if (above && m === NIGHT_FROM) {
      c.events.push({ type: 'night', on: true });
      // Those indoors come out.
      for (const z of s.zeds) if (z.mode === ZED.IDLE) z.mode = ZED.WANDER;
    }
    if (above && m === NIGHT_TO) {
      c.events.push({ type: 'night', on: false });
      // Daylight: those in the streets go to ground (the nearest floor indoors), all but the day's few.
      let keep = going(c) === 1 ? s.zeds.length : quota(c).streets;
      for (const z of s.zeds) {
        if (z.mode === ZED.CHASE || !c.zedStreet[tileAt(z.body.x, z.body.z)]) continue;
        if (keep-- > 0) continue;
        z.mode = ZED.SEEK;
        z.goal = -2;
        z.path = [];
      }
    }
    // (2.58: boards hold, but not unnoticed for ever: from the third night one of the dead near by may find a sleeper's barred door.)
    if (above && night && m % 60 === 0 && s.sleeping) siege(c);
    // (2.68: the Rush: said, begun, its waves, held.)
    rushMinute(c);
    if (s.over) return;
    // (2.68: a scarecrow draws those near it who are after nobody, each minute of the night.)
    if (above && night) scare(c);
    // The night's come a few at a time, out of sight.
    const set = going(c);
    if ((night || set === 1) && m % (set ? STORY.trickle : DEAD.trickle) === 0) {
      const q = quota(c);
      // (The generator running: up out of the tunnel, into the station itself. Either way they make for the way out.)
      const up = set === 1 && s.way === 3 && s.step % (2 * STORY.trickle * STEPS_PER_MINUTE) === 0;
      const from = up ? c.zedPlaces.indoors.filter((i) => c.district.lotAt[i] === c.story.wayLot[2] + 1) : c.zedPlaces.streets;
      if (s.zeds.length < q.indoors + q.streets && put(c, from, ZED.WANDER, up) && set === 1) {
        const z = s.zeds[s.zeds.length - 1];
        z.mode = ZED.SEEK;
        // (They make for whoever set it going, wherever in the district they are.)
        z.goal = here;
      }
    }
  }
  const fog = going(c) === 2;
  // (2.52: at night, someone in strong light or behind a torch is seen as far as by day.)
  // (2.53: by day too, deep in a building: in the dark there they see no further than at night.)
  const shown = night && c.anyLight ? c.lit[here] === 1 : false;
  const dark = (night ? !shown : c.dim[here] === 1 && !c.lit[here]) && !torchLit(c) && !lampLit(c);
  // (Asleep in strong light, they lie in plain view: seen as far as anyone is at night.)
  const seen0 = s.sleeping ? (shown ? DEAD.sightNight : DEAD.sightAsleep) : fog ? STORY.fogSight : dark ? DEAD.sightNight : DEAD.sightDay;
  // (2.69: a poncho worn, awake: seen a tile less, never under two.)
  const sight = Math.max(Math.min(seen0, 2), seen0 - (s.sleeping ? 0 : hiddenBy(c))) * UNIT;
  // (2.69: in a smoke cloud, nobody is seen, and nobody sees out of it.)
  const smoked = s.smoke.length > 0;
  // (The beacon's and the generator's call is stronger than any light.)
  const shy = c.anyLight && going(c) !== 1;
  for (let k = s.zeds.length - 1; k >= 0; k--) {
    const z = s.zeds[k];
    const b = z.body;
    // (2.61: knocked down, it lies there; its time up, it gets up after them with a third of its health.)
    if (isDown(z)) {
      b.moving = false;
      if (--z.down! > 0) continue;
      z.down = undefined;
      z.hp = Math.ceil(kindStats(z.kind).health * DOWN.rise);
      z.mode = ZED.CHASE;
      z.seen = s.step;
      z.last = here;
      z.path = [];
      z.near = 0;
      c.events.push({ type: 'rose', x: b.x, z: b.z });
      continue;
    }
    if (z.reel > 0) {
      z.reel--;
      b.moving = false;
      continue;
    }
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    const d2 = dx * dx + dz * dz;
    // It looks (every fifth step, each on its own): the player in sight is gone after.
    // (2.60: a crawler sees no further than its three tiles.)
    const far = z.kind === ZKIND.CRAWLER ? Math.min(sight, CRAWLER.sight * UNIT) : sight;
    if (
      (s.step + k) % 5 === 0 &&
      d2 <= far * far &&
      !(z.blind !== undefined && z.blind > s.step) &&
      !(smoked && inSmoke(c, here)) &&
      lineOfSight(c.world, b.x, b.z, p.x, p.z, c.tile)
    ) {
      if (z.mode !== ZED.CHASE) {
        c.events.push({ type: 'spotted', zed: k });
        // (2.60: a screamer says so to every one of them near.)
        if (z.kind === ZKIND.SCREAMER) {
          c.events.push({ type: 'scream', x: b.x, z: b.z });
          z.mode = ZED.CHASE;
          noise(c, here, SCREAMER.reach);
        }
      }
      z.mode = ZED.CHASE;
      z.seen = s.step;
      z.last = here;
    }
    const brute = z.kind === ZKIND.BRUTE;
    // (2.68: one of the Rush's knows where the player is: it looks again now and then, and comes the way through what's in the way.)
    if (z.rush && z.mode !== ZED.CHASE && (s.step + k) % RUSH.retarget === 0 && (z.goal !== here || !z.path.length)) {
      z.mode = ZED.SEEK;
      z.goal = here;
      z.path = rushWay(c, tileAt(b.x, b.z), here, brute);
      z.pound ??= 0;
    }
    let speed: number = DEAD.wander;
    // (A brute goes by the doors as if nothing barred them, and pounds its way through.)
    const grid = brute ? c.lockGrid : c.zedGrid;
    if (z.mode === ZED.CHASE) {
      // (2.58: after someone, it goes round as any of them does: the boards are a brute's to pound. 2.68: and the Rush's.)
      if (!brute && !z.rush) z.pound = undefined;
      speed = kindStats(z.kind).chase;
      if (s.step - z.seen > DEAD.lose) {
        z.mode = ZED.SEEK;
        z.goal = z.last;
        z.path = [];
        z.pound = undefined;
      } else {
        // On them: a bite, as often as it can.
        // (2.67: the tile the player stands on never hides them: a doorway, their own barred door or one they built, is no shelter from a bite.)
        if (d2 <= DEAD.reach * DEAD.reach && lineOfSight(c.world, b.x, b.z, p.x, p.z, c.tile)) {
          b.moving = false;
          b.facing = nearestDir(dx, dz);
          if (++z.near >= kindStats(z.kind).lunge && s.step - z.bit >= DEAD.biteEvery) {
            z.bit = s.step;
            // (2.69: what's worn takes its share, and wears.)
            const harm = armourBite(c, kindStats(z.kind).bite);
            c.events.push({ type: 'bite', harm });
            // (2.60: a crawler's bite holds a leg.)
            if (z.kind === ZKIND.CRAWLER) {
              s.snare = s.step + CRAWLER.hold;
              c.events.push({ type: 'snared' });
            }
            if (s.sleeping) c.wakeNow('attacked');
            c.hurt(harm, `z${z.kind ?? 0}`);
            if (s.over || c.events.some((e) => e.type === 'dead')) return;
            // (2.61: and it bleeds.)
            c.bleedFor(harm);
          }
          continue;
        }
        z.near = 0;
        // Straight at them in the open, else the way round (looked for now and then).
        if (z.goal !== here || (!z.path.length && (s.step + k) % 12 === 0)) {
          z.goal = here;
          z.path = findPath(c.world, tileAt(b.x, b.z), (i) => i === here, here, 900, undefined, grid) ?? [];
          // (2.67: no way round what's built: the way through it, to pound the first piece in it. 2.68: the Rush's, the boards too.)
          if (!z.path.length && (c.anyBuilt() || z.rush)) z.path = throughPath(c, tileAt(b.x, b.z), here, brute || !!z.rush, brute) ?? [];
        }
      }
    }
    if (z.mode === ZED.SEEK) {
      speed = DEAD.chase - 20;
      if (z.goal === -2) {
        // (To ground: the nearest floor indoors, out of any light; 2.53: out of the daylight too, where there's such a place near.)
        const from = tileAt(b.x, b.z);
        const deep =
          c.zedPlaces.deep.length && !c.dim[from]
            ? findPath(c.world, from, (i) => c.dim[i] === 1 && c.zedIndoor[i] === 1 && !c.lit[i], -1, 2500, undefined, c.zedGrid)
            : null;
        // (Only a dark room near by: the night's many don't all end the day in the district's one dark shop.)
        z.path =
          (deep && deep.length <= DEAD.darkNear ? deep : null) ??
          findPath(c.world, from, (i) => c.zedIndoor[i] === 1 && !c.lit[i], -1, 2500, undefined, c.zedGrid) ??
          [];
        z.goal = z.path.length ? z.path[z.path.length - 1] : -1;
      } else if (z.goal === -3) {
        // (2.52: out of a light just lit, to the nearest dark.)
        z.path = wayToDark(c, tileAt(b.x, b.z));
        z.goal = z.path.length ? z.path[z.path.length - 1] : -1;
      } else if (z.goal >= 0 && !z.path.length && tileAt(b.x, b.z) !== z.goal) {
        z.path = findPath(c.world, tileAt(b.x, b.z), (i) => i === z.goal, z.goal, 900, undefined, c.zedGrid) ?? [];
        // (2.68: no way round what's built: through it, for those called (the Rush, a way out set going) and one at a sleeper's door.)
        if (!z.path.length && c.anyBuilt() && (z.rush || z.pound !== undefined || going(c) === 1))
          z.path = throughPath(c, tileAt(b.x, b.z), z.goal, z.pound !== undefined, brute) ?? [];
        if (!z.path.length) z.goal = -1;
      }
      if (z.goal < 0 || tileAt(b.x, b.z) === z.goal) {
        z.mode = c.zedIndoor[tileAt(b.x, b.z)] && !night ? ZED.IDLE : ZED.WANDER;
        z.goal = -1;
        z.path = [];
        if (!brute && !z.rush) z.pound = undefined;
      }
    }
    if (z.mode === ZED.WANDER && !z.path.length && (s.step + k * 7) % 40 === 0) {
      // Somewhere else on the streets by night (now and then through a door); a few steps off by day.
      // (2.53: by day, somewhere in the dark where the district has any.)
      const from =
        night && randomInt(s, 5) ? c.zedPlaces.streets : !night && c.zedPlaces.deep.length ? c.zedPlaces.deep : c.zedPlaces.indoors;
      const to = from.length ? from[randomInt(s, from.length)] : -1;
      if (
        to >= 0 &&
        !c.lit[to] &&
        Math.abs((to % MAP_W) - (tileAt(b.x, b.z) % MAP_W)) + Math.abs(Math.floor(to / MAP_W) - Math.floor(tileAt(b.x, b.z) / MAP_W)) <
          (night ? 24 : 6)
      )
        z.path = findPath(c.world, tileAt(b.x, b.z), (i) => i === to, to, 700, undefined, c.zedGrid) ?? [];
    }
    if (z.mode === ZED.IDLE || !z.path.length) {
      b.moving = false;
      continue;
    }
    // Along its way.
    const next = z.path[0];
    // (2.52: one that isn't after anyone won't step out of the dark into strong light: it turns back.)
    if (shy && !brute && !z.rush && z.mode !== ZED.CHASE && c.lit[next] && !c.lit[tileAt(b.x, b.z)]) {
      z.path = [];
      z.pound = undefined;
      if (z.mode === ZED.SEEK) {
        z.mode = c.zedIndoor[tileAt(b.x, b.z)] && !night ? ZED.IDLE : ZED.WANDER;
        z.goal = -1;
      }
      b.moving = false;
      continue;
    }
    const wx = centerX(next) - b.x;
    const wz = centerZ(next) - b.z;
    if (Math.abs(wx) + Math.abs(wz) < REACHED) {
      z.path.shift();
      continue;
    }
    const bx = b.x;
    const bz = b.z;
    // (2.68: in barbed wire, slowed.)
    const wired = c.pieceAt[tileAt(b.x, b.z)] === WIRE + 1;
    walk(c.zedWorld, b, nearestDir(wx, wz), Math.trunc((speed * z.pace * (wired ? TRAP.wireSlow : 1000)) / 1_000_000));
    // (Bodies don't pass through each other: a step into the player isn't taken, nor one of a pack's into another of it.)
    const pd = (p.x - b.x) ** 2 + (p.z - b.z) ** 2;
    if (
      (z.mode === ZED.CHASE && crowded(s.zeds, bx, bz, b.x, b.z, k, ZED.CHASE)) ||
      (pd < 560 * 560 && pd < (p.x - bx) ** 2 + (p.z - bz) ** 2)
    ) {
      b.x = bx;
      b.z = bz;
      // (Held up behind another: it waits its turn; only the world in its way sends it looking again.)
      continue;
    }
    // (Against something that wasn't there when the way was found: looked for again.)
    // (A brute at a barred door: it pounds, and the boards give.)
    if (b.x === bx && b.z === bz) {
      if ((brute || z.pound !== undefined || z.rush) && c.bars.includes(next)) {
        z.pound = (z.pound ?? 0) + 1;
        if (z.pound % 16 === 1) {
          c.events.push({ type: 'pound', tile: next });
          // (2.58: heard through the boards: nobody sleeps through it.)
          if (s.sleeping) c.wakeNow('pounding');
        }
        // (At the boards, it knows where they went: the chase isn't given up while it pounds.)
        z.seen = s.step;
        if (z.pound >= (brute ? BRUTE.pound : SIEGE.pound)) {
          z.pound = brute || z.rush ? 0 : undefined;
          c.breach(next);
        }
      } else if ((z.mode === ZED.CHASE || z.rush || z.pound !== undefined || going(c) === 1) && inWay(c, tileAt(bx, bz), next) >= 0) {
        // (2.67: a piece built in its way: pounded until it gives, the chase kept up meanwhile.)
        // (2.68: a corner cut between two pieces, the way through them has it: one of the two.)
        const at = inWay(c, tileAt(bx, bz), next);
        z.seen = s.step;
        b.facing = nearestDir(centerX(at) - b.x, centerZ(at) - b.z);
        poundPiece(c, at, brute, s.step + k);
      } else {
        z.path = [];
        if (!brute && !z.rush) z.pound = undefined;
      }
    }
  }
  // (2.68: the traps, once everyone has moved.)
  if (!s.over) stepTraps(c);
}

const WIRE = PIECES.findIndex((p) => p.trap === 'wire');
/** 2.68: a piece on a tile that stops the dead (a wall, a barricade, a door; not a trap or a rug walked over). */
const stops = (c: City, tile: number) => {
  const def = c.pieceAt[tile] ? pieceOf(c.pieceAt[tile] - 1) : undefined;
  return !!def && (def.solid || !!def.door);
};

/**
 * 2.68: the piece in the way of a step from one tile to the next: on the next, or (a diagonal step, which no body takes between two
 * things) on one of the two corners beside it. -1: none.
 */
function inWay(c: City, from: number, next: number): number {
  if (stops(c, next)) return next;
  const dx = (next % MAP_W) - (from % MAP_W);
  const dz = Math.floor(next / MAP_W) - Math.floor(from / MAP_W);
  if (!dx || !dz) return -1;
  if (stops(c, from + dx)) return from + dx;
  if (stops(c, from + dz * MAP_W)) return from + dz * MAP_W;
  return -1;
}

/** 2.68: a trap worn by its work: a point less; at none, gone (said as a piece the dead broke). */
function wearTrap(c: City, p: Built) {
  const was = wornStep(p);
  p[2]--;
  if (wornStep(p) !== was) c.piecesRev++;
  if (p[2] > 0) return;
  removePiece(c, p);
  c.events.push({ type: 'pieceDown', kind: p[1], tile: p[0], spent: true });
}

/**
 * 2.68: the traps at work. Spikes and barbed wire hurt the dead on them (the wire slows them: `stepDead`'s walk), a snare holds one,
 * cans on a wire rattle (heard, and a sleeper near woken), a sentry crossbow shoots the nearest it sees while it has bolts. Each wears
 * with use. The player walks over them unharmed: they know where they are.
 */
function stepTraps(c: City) {
  const s = c.state;
  if (!c.anyBuilt() || !s.zeds.length) return;
  const fallen: Zed[] = [];
  const hit = (z: Zed, harm: number) => {
    if (z.hp <= 0) return;
    z.hp -= harm;
    if (z.hp <= 0) fallen.push(z);
  };
  // On a trap's tile.
  for (let k = 0; k < s.zeds.length; k++) {
    const z = s.zeds[k];
    if (isDown(z)) continue;
    const zt = tileAt(z.body.x, z.body.z);
    const kind = c.pieceAt[zt] - 1;
    const trap = kind >= 0 ? PIECES[kind]?.trap : undefined;
    if (!trap) continue;
    const p = builtHere(c).find((q) => q[0] === zt);
    if (!p) continue;
    if (trap === 'spikes' && (s.step + k) % TRAP.spikesEvery === 0) {
      hit(z, TRAP.spikesHarm);
      c.events.push({ type: 'trap', what: 'spikes', tile: zt });
      wearTrap(c, p);
    } else if (trap === 'wire' && (s.step + k) % TRAP.wireEvery === 0) {
      hit(z, TRAP.wireHarm);
      c.events.push({ type: 'trap', what: 'wire', tile: zt });
      wearTrap(c, p);
    } else if (trap === 'snare' && p[4] <= s.step && z.reel <= 0) {
      // (Held where it stands: not a brute, which tears free.)
      if (z.kind === ZKIND.BRUTE) continue;
      z.reel = TRAP.snareHold;
      z.body.moving = false;
      p[4] = s.step + TRAP.snareHold + TRAP.snareRearm;
      c.events.push({ type: 'trap', what: 'snare', tile: zt });
      wearTrap(c, p);
    }
  }
  // The pieces that look about them: cans (every fifth step), and sentries (each on its own beat).
  for (const p of [...builtHere(c)]) {
    const trap = PIECES[p[1]]?.trap;
    if (trap === 'cans' && (s.step + p[0]) % 5 === 0 && p[4] <= s.step) {
      const near = s.zeds.some((z) => !isDown(z) && cheb(tileAt(z.body.x, z.body.z), p[0]) <= TRAP.cansReach);
      if (!near) continue;
      p[4] = s.step + TRAP.cansRearm;
      c.events.push({ type: 'trap', what: 'cans', tile: p[0] });
      // (Heard: by the dead near, and by a sleeper within reach, who wakes in time.)
      noise(c, p[0], TRAP.cansHeard);
      if (s.sleeping && cheb(p[0], c.tile) <= TRAP.cansWake) c.wakeNow('rattle');
      wearTrap(c, p);
    } else if (trap === 'sentry' && p[4] % BUILD.sentryWear > 0 && (s.step + p[0]) % TRAP.sentryEvery === 0) {
      const sx = centerX(p[0]);
      const sz = centerZ(p[0]);
      let best: Zed | null = null;
      let bestD = (TRAP.sentryReach * UNIT) ** 2 + 1;
      for (const z of s.zeds) {
        if (isDown(z) || z.hp <= 0) continue;
        const d = (z.body.x - sx) ** 2 + (z.body.z - sz) ** 2;
        if (d < bestD && lineOfSight(c.world, sx, sz, z.body.x, z.body.z, p[0])) {
          bestD = d;
          best = z;
        }
      }
      if (!best) continue;
      p[4]--;
      hit(best, TRAP.sentryHarm);
      c.events.push({ type: 'trap', what: 'sentry', tile: p[0], x: best.body.x, z: best.body.z });
      noise(c, p[0], 2);
    }
  }
  if (fallen.length) putDown(c, fallen);
}

/** 2.68: each minute of the night, a scarecrow draws those within reach who are after nobody (not the Rush's: they know better). */
function scare(c: City) {
  const s = c.state;
  if (!c.anyBuilt()) return;
  for (const p of builtHere(c)) {
    if (PIECES[p[1]]?.trap !== 'scare') continue;
    // (To a tile beside it: it stands in the way itself.)
    const x = p[0] % MAP_W;
    const by = [p[0] + MAP_W, p[0] - MAP_W, x < MAP_W - 1 ? p[0] + 1 : -1, x > 0 ? p[0] - 1 : -1].find(
      (t) => t >= 0 && t < N && !c.zedGrid[t],
    );
    if (by === undefined) continue;
    for (const z of s.zeds) {
      if (z.mode === ZED.CHASE || z.rush || z.pound !== undefined || isDown(z) || z.goal === by) continue;
      const zt = tileAt(z.body.x, z.body.z);
      if (cheb(zt, p[0]) > TRAP.scareReach || cheb(zt, p[0]) <= 1) continue;
      z.mode = ZED.SEEK;
      z.goal = by;
      z.path = [];
    }
  }
}
