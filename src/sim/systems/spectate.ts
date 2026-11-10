/**
 * A crowd at the player's game (2.40, the side games' polish; the user's pick): while the player arm-wrestles, plays a
 * hand of Cheat, a shootout at the hoop or the old-timer's checkers in the games' hours, a few inmates nearby who've
 * nothing better to do drift over and watch, either side of the two (at the court, either side of it), arms folded,
 * facing the game. Once it's over they stay a moment (LINGER: cheering or groaning) and go back to what they were doing.
 * Those watching are the ones `watchers` (games.ts) already counts for a win's cheer (+2 opinion each, once a day), so a
 * crowd makes a win worth more.
 *
 * Chosen once a second from the nearest who are free (never the one playing, a merchant, the fixer, the librarian, the
 * gathered, the crew, anyone talking, queuing, sat down, at the gym, reading, jogging, on their way to any of those, or
 * busy at a game of their own), kept while they stay free, at most WATCH_MAX and never more than there are places for,
 * from WATCH_REACH tiles. State: `state.watch` (absent until the first game is watched), `state.watchEnd` (the step it
 * ended, while they linger). A run logged before 2.40 (Sim.rules239) has none of it; nor the Training Block. No draw
 * from the state's RNG: who comes is by distance.
 */
import { DOING, ON_MACHINE } from '../ai/doing';
import { nearestDir } from '../ai/path';
import { isFloor } from '../ai/places';
import type { SimContext } from '../context';
import type { SimState } from '../state';
import { UNIT } from '../tuning';
import { MAP_W } from '../world/grid';
import { LAYER } from '../world/World';
import { elderOf } from './checkers';
import { gamesOpen } from './games';
import { courtOf, rimOf } from './hoops';
import { huddleOf } from './huddles';
import { bodyAt, type Body } from './movement';
import { freeToGo, staysPut } from './vending';
import { RACE_GATHER, RIVALS } from '../../content/long';
import { HUDDLE } from '../../content/huddles';
import { gangOf, heldPiece } from './gangs';
import { DIR_X, DIR_Z } from '../command';
import { hostSpot, quizMiddle, quizOf } from './quiz';
import { RACE, rivals, trackOf, trackTiles } from './races';
import { clockAt, prisonDay } from './clock';
import type { World } from '../world/World';

/** How many come to watch at most, from how far (tiles), how far either side of the two they stand (tiles; the court's: further out). */
export const WATCH_MAX = 4;
/** 2.41: at a race, the rats' owners as well (at the start): at most this many in `state.watch`. */
export const WATCH_ALL = WATCH_MAX + RIVALS;
/** 2.41: a rat's owner comes to the start from this far (tiles). */
const OWNER_REACH = 40;
/** 2.41: quiz night's and a race's crowd come from this far (tiles): a night out, not a game come across. */
const SCENE_REACH = 30;
export const WATCH_REACH = 9;
const SIDE = 1.6;
const COURT_SIDE = 3.2;
/** Two a side, this far apart along the line between the two (tiles). */
const ALONG = 1.1;
/** Once it's over, those watching stay this long (steps: 3 s) to cheer or groan, then go. */
export const LINGER = 60;

/** The game the player's in that draws a crowd: who they're up against, and the line it's played along (units). */
export function watchedGame(sim: SimContext): { who: number; ax: number; az: number; bx: number; bz: number; side: number } | null {
  const s = sim.state;
  const p = s.player;
  let who = -1;
  if (s.bout.length) who = s.bout[0];
  else if (s.cheat) who = s.cheat.who;
  else if (s.board?.seated) who = elderOf(sim);
  else if (s.shootout) {
    // (At the hoop: along the court, from the rim out to its middle spot, the crowd either side of it.)
    const c = courtOf(sim);
    if (!c || !c.spots.length) return null;
    const r = rimOf(c);
    const q = c.spots[Math.floor(c.spots.length / 2)];
    return { who: s.shootout.who, ax: r.x, az: r.z, bx: q.x * UNIT + UNIT / 2, bz: q.z * UNIT + UNIT / 2, side: COURT_SIDE };
  }
  const m = who >= 0 ? s.inmates[who] : undefined;
  if (!m) return null;
  return { who, ax: p.x, az: p.z, bx: m.body.x, bz: m.body.z, side: SIDE };
}

/** Whether the crowd gathers at the player's games here (not in a run from before 2.40, nor at the Training Block). */
export const spectatorsHere = (sim: Pick<SimContext, 'rules239' | 'world'>) => !sim.rules239 && !sim.world.def.rules?.relaxed;

/** What keeps an inmate from coming to watch: sat down, asleep, at the gym, reading, jogging (or on the way to it). */
const BUSY: ReadonlySet<number> = new Set([
  DOING.SIT,
  DOING.SIT_READ,
  DOING.EAT,
  DOING.SLEEP,
  DOING.READ,
  DOING.EXERCISE,
  DOING.JOG,
  ...ON_MACHINE,
]);

/** Free to come and watch: up and about, nothing of their own on (freeToGo's), not one who stays put, not gathered (2.41: for quiz night or a race, a chat left for it). */
function free(sim: SimContext, k: number, playing: number, scene = false): boolean {
  const s = sim.state;
  const m = s.inmates[k];
  // (freeToGo's as for one already waiting: watching isn't a reason not to (that's this), talking, a drink, the vending
  // machine's queue, a gathering are.)
  if (!m || k === playing || s.talk === k || s.cooler.who.includes(k) || s.vend.line.includes(k) || staysPut(sim, k)) return false;
  if (!freeToGo(sim, k, true)) return false;
  const g = huddleOf(sim, k);
  if (g >= 0 && !(scene && s.huddle?.kind[g] === HUDDLE.CHAT)) return false;
  // (2.41: quiz night's or a race's crowd never takes a gang's man off its corner, as a gathering doesn't.)
  if (scene && atCorner(sim, k)) return false;
  // (A job held isn't work now: the games' hours are nobody's shift.)
  return !BUSY.has(m.doing) && !BUSY.has(m.then);
}

const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

/**
 * 2.41: a rat's owner free to come to the start: his rat's racing, so a stall, a chair, a book or the gym is left for it;
 * not asleep, out, after the player, talking to them, queuing, nor at an inmates' game of his own.
 */
function ownerFree(sim: SimContext, k: number): boolean {
  const s = sim.state;
  if (!s.inmates[k] || s.talk === k || s.vend.line.includes(k) || s.cooler.who.includes(k) || !freeToGo(sim, k, true)) return false;
  if (atCorner(sim, k)) return false;
  const g = huddleOf(sim, k);
  return g < 0 || s.huddle?.kind[g] === HUDDLE.CHAT;
}

/** 2.41: one of a gang while its corner's held now (the evening's turf): kept there, as huddles.ts's canJoin keeps them. */
const atCorner = (sim: SimContext, k: number) => heldPiece(sim, sim.state.routine) === 'corner' && gangOf(sim, k) >= 0;

/**
 * Each step: who's watching the player's game (kept while free, never more than there are places; once a second, the
 * nearest free fill the places left). Once it's over, they stay LINGER steps, then go.
 */
export function spectate(sim: SimContext) {
  const s = sim.state;
  if (!spectatorsHere(sim)) return;
  const here = s.layer === LAYER.GROUND && !sim.away;
  const g = here && gamesOpen(sim) ? watchedGame(sim) : null;
  // (2.41: quiz night's table, a race the player's in on.)
  const sc = !g && here ? sceneNow(sim) : null;
  if (sc) return gatherFor(sim, sc);
  if (!g) {
    if (!s.watch?.length) return;
    // (Over: a moment more there, then off. Anyone called away meanwhile goes at once.)
    if (!s.watchEnd) s.watchEnd = s.step;
    const w = s.watch;
    for (let i = w.length - 1; i >= 0; i--) if (!free(sim, w[i], -1)) w.splice(i, 1);
    if (s.step - s.watchEnd >= LINGER || !w.length) {
      s.watch = [];
      s.watchEnd = 0;
    }
    return;
  }
  if (s.watchEnd) s.watchEnd = 0;
  const w = (s.watch ??= []);
  const room = placesFor(sim, g).length;
  for (let i = w.length - 1; i >= 0; i--) if (!free(sim, w[i], g.who) || i >= room) w.splice(i, 1);
  if (w.length >= room || s.step % 20 !== 0) return;
  const mid = { x: (g.ax + g.bx) / 2, z: (g.az + g.bz) / 2 };
  const near: number[] = [];
  s.inmates.forEach((m, k) => {
    if (!w.includes(k) && dist2(m.body, mid) <= (WATCH_REACH * UNIT) ** 2 && free(sim, k, g.who)) near.push(k);
  });
  near.sort((a, b) => dist2(s.inmates[a].body, mid) - dist2(s.inmates[b].body, mid) || a - b);
  for (const k of near) {
    if (w.length >= room) break;
    w.push(k);
  }
}

// ------------------------------------------------------------------ 2.41: quiz night and the races

type Place = { x: number; z: number; face: number };

/** A scene of the player's that draws a crowd without being a game: who's in it (not to be taken), the crowd's places, the owners and theirs. */
export interface Scene {
  kind: 'quiz' | 'race';
  keep: readonly number[];
  mid: { x: number; z: number };
  spots: readonly Place[];
  owners: readonly number[];
  ownerSpots: readonly Place[];
}

const NONE: readonly number[] = [];
const quizScene: Scene = { kind: 'quiz', keep: [], mid: { x: 0, z: 0 }, spots: [], owners: NONE, ownerSpots: [] };
const raceScene: Scene = { kind: 'race', keep: NONE, mid: { x: 0, z: 0 }, spots: [], owners: [], ownerSpots: [] };

/**
 * 2.41: the scene now: quiz night's table once the player's joined (its contestants and host in it), or tonight's race
 * from RACE_GATHER to its finish with the player's bet or pet in it (its rats' owners at the start). Never in a run from
 * before (Sim.rules240).
 */
export function sceneNow(sim: SimContext): Scene | null {
  const s = sim.state;
  if (sim.rules240) return null;
  const o = s.quiz;
  if (o) {
    const at = quizPlaces(sim.world);
    if (!at) return null;
    const keep = quizScene.keep as number[];
    keep.length = 0;
    keep.push(...o.who);
    if (o.host !== undefined && o.host >= 0) keep.push(o.host);
    quizScene.mid = at.mid;
    quizScene.spots = at.spots;
    return quizScene;
  }
  const r = s.race;
  const day = prisonDay(s.step);
  if (!r.length || r[RACE.DAY] !== day || (r[RACE.LANE] < 0 && !r[RACE.ENTERED]) || s.lockdown) return null;
  if (!r[RACE.ON] && clockAt(s.step).minuteOfDay < RACE_GATHER) return null;
  const at = racePlaces(sim.world);
  if (!at) return null;
  const owners = raceScene.owners as number[];
  owners.length = 0;
  for (const e of rivals(s, day)) owners.push(e.owner);
  raceScene.mid = at.mid;
  raceScene.spots = at.spots;
  raceScene.ownerSpots = at.owners;
  return raceScene;
}

/** A tile's middle as a place (units), facing a point (units). */
const placeAt = (x: number, z: number, to: { x: number; z: number }): Place => {
  const px = x * UNIT + UNIT / 2;
  const pz = z * UNIT + UNIT / 2;
  return { x: px, z: pz, face: nearestDir(to.x - px, to.z - pz) };
};

/** Open floor an inmate can stand on (not a prop's tile). */
const open = (w: World, x: number, z: number) => x >= 0 && z >= 0 && x < MAP_W && isFloor(w, x, z) && !w.npcBlock[z * MAP_W + x];

const quizCache = new WeakMap<World, { mid: { x: number; z: number }; spots: Place[] } | null>();
/**
 * Quiz night's crowd (worked out once a prison): the nearest open floor of the library round the table, never one of
 * the four places, the host's, nor between the places and the host; facing the middle of it all.
 */
function quizPlaces(w: World): { mid: { x: number; z: number }; spots: Place[] } | null {
  if (quizCache.has(w)) return quizCache.get(w)!;
  const pl = quizOf(w);
  let out: { mid: { x: number; z: number }; spots: Place[] } | null = null;
  if (pl) {
    const m = quizMiddle(pl);
    const h = hostSpot(w);
    const c = h ? { x: (m.x + h.x + 0.5) / 2, z: (m.z + h.z + 0.5) / 2 } : m;
    const mid = { x: c.x * UNIT, z: c.z * UNIT };
    const zone = w.zoneAt(pl.spots[0].x, pl.spots[0].z);
    const xs = pl.spots.map((q) => q.x);
    const zs = pl.spots.map((q) => q.z);
    const between = (x: number, z: number) => {
      if (!h) return false;
      const inX = x >= Math.min(...xs, h.x) && x <= Math.max(...xs, h.x);
      const inZ = z >= Math.min(...zs, h.z) && z <= Math.max(...zs, h.z);
      return inX && inZ;
    };
    const cand: Array<{ x: number; z: number; d: number }> = [];
    for (let z = Math.floor(c.z) - 3; z <= Math.floor(c.z) + 3; z++)
      for (let x = Math.floor(c.x) - 4; x <= Math.floor(c.x) + 4; x++) {
        if (!open(w, x, z) || w.zoneAt(x, z) !== zone || between(x, z)) continue;
        if (pl.spots.some((q) => q.x === x && q.z === z) || (h && h.x === x && h.z === z)) continue;
        cand.push({ x, z, d: (x + 0.5 - c.x) ** 2 + (z + 0.5 - c.z) ** 2 });
      }
    cand.sort((a, b) => a.d - b.d || a.z - b.z || a.x - b.x);
    out = { mid, spots: cand.slice(0, WATCH_MAX).map((q) => placeAt(q.x, q.z, mid)) };
  }
  quizCache.set(w, out);
  return out;
}

const raceCache = new WeakMap<World, { mid: { x: number; z: number }; spots: Place[]; owners: Place[] } | null>();
/**
 * A race's crowd (worked out once a prison): the owners beside and behind the start, facing down the track; the others
 * beside the track, the nearest its middle first, facing it. Never on the track.
 */
function racePlaces(w: World): { mid: { x: number; z: number }; spots: Place[]; owners: Place[] } | null {
  if (raceCache.has(w)) return raceCache.get(w)!;
  const t = trackOf(w);
  let out: { mid: { x: number; z: number }; spots: Place[]; owners: Place[] } | null = null;
  if (t) {
    const tiles = trackTiles(t);
    const sx = Math.sign(DIR_X[t.dir]);
    const sz = Math.sign(DIR_Z[t.dir]);
    const on = (x: number, z: number) => tiles.includes(z * MAP_W + x);
    const mt = tiles[tiles.length >> 1];
    const mid = { x: (mt % MAP_W) * UNIT + UNIT / 2, z: Math.floor(mt / MAP_W) * UNIT + UNIT / 2 };
    const used = new Set<number>();
    const owners: Place[] = [];
    // (Beside the start, then behind it: facing the way the rats run.)
    for (const [a, b] of [
      [0, 1],
      [0, -1],
      [-1, 0],
      [-1, 1],
      [-1, -1],
      [-2, 0],
    ]) {
      const x = t.x + sx * a - sz * b;
      const z = t.z + sz * a + sx * b;
      if (owners.length >= RIVALS || !open(w, x, z) || on(x, z)) continue;
      used.add(z * MAP_W + x);
      const p = placeAt(x, z, { x: 0, z: 0 });
      owners.push({ ...p, face: t.dir });
    }
    const cand: Array<{ x: number; z: number; d: number; to: number }> = [];
    for (const i of tiles)
      for (const side of [1, -1, 2, -2]) {
        const x = (i % MAP_W) - sz * side;
        const z = Math.floor(i / MAP_W) + sx * side;
        if (!open(w, x, z) || on(x, z) || used.has(z * MAP_W + x) || cand.some((q) => q.x === x && q.z === z)) continue;
        cand.push({ x, z, d: Math.abs(side) * 100 + (x - (mt % MAP_W)) ** 2 + (z - Math.floor(mt / MAP_W)) ** 2, to: i });
      }
    cand.sort((a, b) => a.d - b.d || a.z - b.z || a.x - b.x);
    const spots = cand
      .slice(0, WATCH_MAX)
      .map((q) => placeAt(q.x, q.z, { x: (q.to % MAP_W) * UNIT + UNIT / 2, z: Math.floor(q.to / MAP_W) * UNIT + UNIT / 2 }));
    out = { mid, spots, owners };
  }
  raceCache.set(w, out);
  return out;
}

/**
 * Each step of a scene: those watching kept while free (never one in it); once a second, the owners come from up to
 * OWNER_REACH tiles, then the nearest free fill the crowd's places left.
 */
function gatherFor(sim: SimContext, sc: Scene) {
  const s = sim.state;
  if (s.watchEnd) s.watchEnd = 0;
  const w = (s.watch ??= []);
  for (let i = w.length - 1; i >= 0; i--) {
    const k = w[i];
    if (sc.keep.includes(k) || !(sc.owners.includes(k) ? ownerFree(sim, k) : free(sim, k, -1, true))) w.splice(i, 1);
  }
  let crowd = 0;
  for (let i = 0; i < w.length; i++) {
    if (sc.owners.includes(w[i])) continue;
    if (++crowd > sc.spots.length) w.splice(i--, 1);
  }
  if (s.step % 20 !== 0) return;
  for (const k of sc.owners) {
    const m = s.inmates[k];
    if (m && !w.includes(k) && !sc.keep.includes(k) && dist2(m.body, sc.mid) <= (OWNER_REACH * UNIT) ** 2 && ownerFree(sim, k)) w.push(k);
  }
  crowd = w.filter((k) => !sc.owners.includes(k)).length;
  if (crowd >= sc.spots.length) return;
  const near: number[] = [];
  s.inmates.forEach((m, k) => {
    if (w.includes(k) || sc.keep.includes(k) || sc.owners.includes(k)) return;
    if (dist2(m.body, sc.mid) <= (SCENE_REACH * UNIT) ** 2 && free(sim, k, -1, true)) near.push(k);
  });
  near.sort((a, b) => dist2(s.inmates[a].body, sc.mid) - dist2(s.inmates[b].body, sc.mid) || a - b);
  for (const k of near) {
    if (crowd >= sc.spots.length) break;
    w.push(k);
    crowd++;
  }
}

/** The places either side of the two (k: 0 and 2 on one side, 1 and 3 on the other): on open floor, else none. */
const marks: Body[] = Array.from({ length: WATCH_ALL }, () => bodyAt(0, 0));

function placeOf(
  sim: SimContext,
  g: NonNullable<ReturnType<typeof watchedGame>>,
  k: number,
): { x: number; z: number; face: number } | null {
  const dx = g.bx - g.ax;
  const dz = g.bz - g.az;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const mx = (g.ax + g.bx) / 2;
  const mz = (g.az + g.bz) / 2;
  const side = k % 2 === 0 ? 1 : -1;
  const along = (Math.floor(k / 2) - 0.5) * ALONG * UNIT;
  // (Out from the line, then a little nearer if that's in a wall: never on the far side of one. The middle of a tile an
  // inmate can walk onto, so a body gets there whatever stands beside it; never the tile either of the two stands on.)
  const p = sim.state.player;
  const pt = Math.floor(p.z / UNIT) * MAP_W + Math.floor(p.x / UNIT);
  const ot = Math.floor(g.bz / UNIT) * MAP_W + Math.floor(g.bx / UNIT);
  for (const out of [g.side, g.side - 0.5, g.side + 0.6]) {
    const tx = Math.floor((mx - uz * side * out * UNIT + ux * along) / UNIT);
    const tz = Math.floor((mz + ux * side * out * UNIT + uz * along) / UNIT);
    const tile = tz * MAP_W + tx;
    if (tx < 0 || tz < 0 || tx >= MAP_W || !isFloor(sim.world, tx, tz) || sim.world.npcBlock[tile] || tile === pt || tile === ot) continue;
    const x = tx * UNIT + UNIT / 2;
    const z = tz * UNIT + UNIT / 2;
    return { x, z, face: nearestDir(mx - x, mz - z) };
  }
  return null;
}

const places: Place[] = [];

/** The places for a game now: each on its own tile (two that fall on one are one), at most WATCH_MAX. */
export function placesFor(sim: SimContext, g: NonNullable<ReturnType<typeof watchedGame>>): readonly Place[] {
  places.length = 0;
  for (let k = 0; k < WATCH_MAX; k++) {
    const at = placeOf(sim, g, k);
    if (at && !places.some((q) => q.x === at.x && q.z === at.z)) places.push(at);
  }
  return places;
}

const taken: boolean[] = Array(WATCH_MAX).fill(false);

/**
 * socialNow's: those watching to their places either side of the game, facing it, arms folded once they're there. Each
 * takes the nearest place still free (in a corridor, never across the two playing to the far side), in the order they
 * came; standing still within three quarters of a tile of it is there. Once it's over, they stay where they are a
 * moment, arms folded, facing as they were.
 */
export function watchTargets(sim: SimContext, so: { follow: Array<Body | null>; gap: number[]; doing: number[]; face: number[] }) {
  const s = sim.state;
  const w = s.watch;
  if (!w?.length || !spectatorsHere(sim)) return;
  const g = s.watchEnd ? null : watchedGame(sim);
  const sc = s.watchEnd || g ? null : sceneNow(sim);
  const spots = g ? placesFor(sim, g) : sc ? sc.spots : null;
  taken.fill(false);
  // (2.41: at quiz night or a race, never the place the player's standing on.)
  if (sc && spots) {
    const pt = Math.floor(s.player.z / UNIT) * MAP_W + Math.floor(s.player.x / UNIT);
    spots.forEach((q, j) => {
      if (Math.floor(q.z / UNIT) * MAP_W + Math.floor(q.x / UNIT) === pt) taken[j] = true;
    });
  }
  w.forEach((who, k) => {
    const m = s.inmates[who];
    if (!m) return;
    const mark = marks[k];
    if (!spots) {
      // (Lingering, or the game gone this very step: stood still where they are.)
      mark.x = m.body.x;
      mark.z = m.body.z;
      m.wait = 0;
      so.follow[who] = mark;
      so.gap[who] = 0;
      so.face[who] = m.body.facing;
      so.doing[who] = DOING.WATCH;
      return;
    }
    // (2.41: a race's owner to his own place at the start.)
    const own = sc ? sc.owners.indexOf(who) : -1;
    if (sc && own >= 0 && sc.ownerSpots[own]) {
      const at = sc.ownerSpots[own];
      m.wait = 0;
      mark.x = at.x;
      mark.z = at.z;
      so.follow[who] = mark;
      so.gap[who] = 0;
      so.face[who] = at.face;
      so.doing[who] = !m.body.moving && dist2(m.body, at) <= ((UNIT * 3) / 4) ** 2 ? DOING.WATCH : DOING.NOTHING;
      return;
    }
    let best = -1;
    let bd = Infinity;
    for (let q = 0; q < spots.length; q++) {
      if (taken[q]) continue;
      const d = dist2(m.body, spots[q]);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    if (best < 0) return;
    taken[best] = true;
    const at = spots[best];
    m.wait = 0;
    mark.x = at.x;
    mark.z = at.z;
    so.follow[who] = mark;
    so.gap[who] = 0;
    so.face[who] = at.face;
    so.doing[who] = !m.body.moving && bd <= ((UNIT * 3) / 4) ** 2 ? DOING.WATCH : DOING.NOTHING;
  });
}

/** Watching the player's game now (the play layer's cheers). */
export const watching = (s: Pick<SimState, 'watch'>, k: number) => !!s.watch?.includes(k);
