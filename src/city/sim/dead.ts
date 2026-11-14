import { findPath, nearestDir } from '../../sim/ai/path';
import { lineOfSight } from '../../sim/ai/sight';
import { DIR_X, DIR_Z } from '../../sim/command';
import { randomInt } from '../../sim/rng';
import { bodyAt, walk, type Body } from '../../sim/systems/movement';
import { NIGHT_FROM, NIGHT_TO, STEPS_PER_MINUTE, UNIT } from '../../sim/tuning';
import { centerX, centerZ, tileAt } from '../../sim/world/grid';
import { MAP_H, MAP_W } from '../../sim/world/World';
import { BLOW, BRUTE, DEAD, RUNNER, ZKIND } from '../content/dead';
import { ESCAPE_KINDS, isBuilding } from '../content/districts';
import { cityItem } from '../content/items';
import { districtX, districtZ } from '../gen/plan';
import { STORY } from '../content/story';
import { crowded, type City } from './City';
import { going } from './story';
import { torchLit, wayToDark } from './light';

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
}

const N = MAP_W * MAP_H;
const REACHED = 220;

export const nightAt = (minute: number) => minute >= NIGHT_FROM || minute < NIGHT_TO;

/** How bad a district is: its distance from the start in districts, and one more where a way out begins. */
export function danger(c: City, d: number): number {
  const far = Math.max(Math.abs(districtX(d) - districtX(c.plan.start)), Math.abs(districtZ(d) - districtZ(c.plan.start)));
  return far + (ESCAPE_KINDS.includes(c.plan.kinds[d]) ? 1 : 0);
}

/** How many there should be now: indoors and in the streets. */
export function quota(c: City): { indoors: number; streets: number } {
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
    return { indoors: Math.floor(all / 4), streets: all - Math.floor(all / 4) };
  }
  return { indoors: DEAD.dayBase + DEAD.dayPerDanger * dg + Math.min(DEAD.dayMost, DEAD.dayPerDay * (c.day - 1)), streets: dg };
}

/** A district's open tiles indoors and on its streets (worked out when it's entered). */
export function places(c: City): { indoors: number[]; streets: number[]; deep: number[] } {
  const d = c.district;
  const indoors: number[] = [];
  const streets: number[] = [];
  for (let i = 0; i < N; i++) {
    if (c.grid[i]) continue;
    const ch = d.rows[Math.floor(i / MAP_W)][i % MAP_W];
    const lot = d.lotAt[i];
    if (ch === ',') streets.push(i);
    else if (lot && isBuilding(d.lots[lot - 1].use) && (ch === 'w' || ch === ':' || ch === '_')) indoors.push(i);
  }
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
    c.state.zeds.push({
      body: bodyAt(tile % MAP_W, Math.floor(tile / MAP_W), 1 + randomInt(c.state, 16)),
      hp: kind === ZKIND.BRUTE ? BRUTE.health : kind === ZKIND.RUNNER ? RUNNER.health : DEAD.health,
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

/** The district just entered: its dead put down for the hour it is. */
export function populate(c: City) {
  c.state.zeds = [];
  const q = quota(c);
  const at = c.zedPlaces;
  // (2.53: by day they wait where daylight doesn't reach; after dark, anywhere indoors.)
  // (Only the dark they can stand in: not a shelter's, not a lit room's. No more than one to `darkEach` tiles of it: the rest indoors anywhere, as before.)
  const dark = nightAt(c.minute)
    ? []
    : at.deep.filter((i) => !c.lit[i] && !c.shelter(c.district.lotAt[i] - 1) && !c.safeLots.has(c.district.lotAt[i] - 1));
  const inDark = Math.min(q.indoors, Math.floor(dark.length / DEAD.darkEach));
  for (let k = 0; k < q.indoors; k++) put(c, k < inDark ? dark : at.indoors, ZED.IDLE);
  for (let k = 0; k < q.streets; k++) put(c, at.streets, ZED.WANDER);
}

/** A noise the dead hear: those within its reach (tiles) and not already after someone go and look. */
export function noise(c: City, tile: number, reach: number) {
  // (The docks' fog, the boat ready: sound carries.)
  if (going(c) === 2) reach *= STORY.fogHearing;
  for (const z of c.state.zeds) {
    if (z.mode === ZED.CHASE) continue;
    const zt = tileAt(z.body.x, z.body.z);
    if (Math.max(Math.abs((zt % MAP_W) - (tile % MAP_W)), Math.abs(Math.floor(zt / MAP_W) - Math.floor(tile / MAP_W))) > reach) continue;
    z.mode = ZED.SEEK;
    z.goal = tile;
    z.path = [];
  }
}

/** The player's blow: the nearest of the dead ahead and in reach is struck; its noise carries either way. */
export function strike(c: City) {
  const s = c.state;
  if (s.step - s.swung < BLOW.every || s.sleeping) return;
  s.swung = s.step;
  // (One weapon strikes: its blow, its reach, its wear.)
  const held = cityItem(c.weapon()?.[0] ?? 0);
  const weapon = held?.attack ?? 0;
  const long = held?.reach ?? 0;
  const tired = s.energy <= 0;
  s.energy = Math.max(0, s.energy - BLOW.energy);
  const harm = Math.ceil((BLOW.fists + weapon * 2) / (tired ? 2 : 1));
  const reach = BLOW.reach + long * UNIT;
  const p = s.player;
  const fx = DIR_X[p.facing] ?? 0;
  const fz = DIR_Z[p.facing] ?? 0;
  let best = -1;
  let bestD = Infinity;
  s.zeds.forEach((z, k) => {
    const dx = z.body.x - p.x;
    const dz = z.body.z - p.z;
    const d2 = dx * dx + dz * dz;
    // (Ahead, or on top of them.)
    if (d2 > reach * reach || (d2 > 400 * 400 && dx * fx + dz * fz <= 0)) return;
    if (d2 < bestD && lineOfSight(c.world, p.x, p.z, z.body.x, z.body.z)) {
      bestD = d2;
      best = k;
    }
  });
  noise(c, c.tile, BLOW.noise);
  if (best < 0) return void c.events.push({ type: 'swing', hit: false, dead: false });
  const z = s.zeds[best];
  z.hp -= harm;
  z.reel = z.kind === ZKIND.BRUTE ? BRUTE.reel : DEAD.reel;
  z.near = 0;
  z.mode = ZED.CHASE;
  z.seen = s.step;
  z.last = c.tile;
  // Pushed back along the blow, as far as there's room.
  const dir = nearestDir(z.body.x - p.x, z.body.z - p.z);
  walk(c.zedWorld, z.body, dir, z.kind === ZKIND.BRUTE ? BRUTE.shove : DEAD.shove);
  z.body.facing = nearestDir(p.x - z.body.x, p.z - z.body.z);
  const dead = z.hp <= 0;
  if (dead) {
    s.zeds.splice(best, 1);
    s.kills++;
  }
  c.events.push({ type: 'swing', hit: true, dead, x: z.body.x, z: z.body.z });
  c.wearWeapon();
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
    if (m === 19 * 60 || m === 20 * 60 + 30) c.events.push({ type: 'dusk', soon: m === 19 * 60 ? 120 : 30 });
    if (m === NIGHT_FROM) {
      c.events.push({ type: 'night', on: true });
      // Those indoors come out.
      for (const z of s.zeds) if (z.mode === ZED.IDLE) z.mode = ZED.WANDER;
    }
    if (m === NIGHT_TO) {
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
  const dark = (night ? !shown : c.dim[here] === 1 && !c.lit[here]) && !torchLit(c);
  // (Asleep in strong light, they lie in plain view: seen as far as anyone is at night.)
  const sight =
    (s.sleeping ? (shown ? DEAD.sightNight : DEAD.sightAsleep) : fog ? STORY.fogSight : dark ? DEAD.sightNight : DEAD.sightDay) * UNIT;
  // (The beacon's and the generator's call is stronger than any light.)
  const shy = c.anyLight && going(c) !== 1;
  for (let k = s.zeds.length - 1; k >= 0; k--) {
    const z = s.zeds[k];
    const b = z.body;
    if (z.reel > 0) {
      z.reel--;
      b.moving = false;
      continue;
    }
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    const d2 = dx * dx + dz * dz;
    // It looks (every fifth step, each on its own): the player in sight is gone after.
    if ((s.step + k) % 5 === 0 && d2 <= sight * sight && lineOfSight(c.world, b.x, b.z, p.x, p.z)) {
      if (z.mode !== ZED.CHASE) c.events.push({ type: 'spotted', zed: k });
      z.mode = ZED.CHASE;
      z.seen = s.step;
      z.last = here;
    }
    let speed: number = DEAD.wander;
    const brute = z.kind === ZKIND.BRUTE;
    // (A brute goes by the doors as if nothing barred them, and pounds its way through.)
    const grid = brute ? c.world.npcBlock : c.zedGrid;
    if (z.mode === ZED.CHASE) {
      speed = brute ? BRUTE.chase : z.kind === ZKIND.RUNNER ? RUNNER.chase : DEAD.chase;
      if (s.step - z.seen > DEAD.lose) {
        z.mode = ZED.SEEK;
        z.goal = z.last;
        z.path = [];
        z.pound = undefined;
      } else {
        // On them: a bite, as often as it can.
        if (d2 <= DEAD.reach * DEAD.reach && lineOfSight(c.world, b.x, b.z, p.x, p.z)) {
          b.moving = false;
          b.facing = nearestDir(dx, dz);
          if (++z.near >= DEAD.lunge && s.step - z.bit >= DEAD.biteEvery) {
            z.bit = s.step;
            const harm = brute ? BRUTE.bite : z.kind === ZKIND.RUNNER ? RUNNER.bite : DEAD.bite;
            c.events.push({ type: 'bite', harm });
            if (s.sleeping) c.wakeNow('attacked');
            c.hurt(harm);
            if (s.over || c.events.some((e) => e.type === 'dead')) return;
          }
          continue;
        }
        z.near = 0;
        // Straight at them in the open, else the way round (looked for now and then).
        if (z.goal !== here || (!z.path.length && (s.step + k) % 12 === 0)) {
          z.goal = here;
          z.path = findPath(c.world, tileAt(b.x, b.z), (i) => i === here, here, 900, undefined, grid) ?? [];
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
        if (!z.path.length) z.goal = -1;
      }
      if (z.goal < 0 || tileAt(b.x, b.z) === z.goal) {
        z.mode = c.zedIndoor[tileAt(b.x, b.z)] && !night ? ZED.IDLE : ZED.WANDER;
        z.goal = -1;
        z.path = [];
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
    if (shy && !brute && z.mode !== ZED.CHASE && c.lit[next] && !c.lit[tileAt(b.x, b.z)]) {
      z.path = [];
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
    walk(c.zedWorld, b, nearestDir(wx, wz), Math.trunc((speed * z.pace) / 1000));
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
      if (brute && c.bars.includes(next)) {
        z.pound = (z.pound ?? 0) + 1;
        if (z.pound % 16 === 1) c.events.push({ type: 'pound', tile: next });
        // (At the boards, it knows where they went: the chase isn't given up while it pounds.)
        z.seen = s.step;
        if (z.pound >= BRUTE.pound) {
          z.pound = 0;
          c.breach(next);
        }
      } else z.path = [];
    }
  }
}
