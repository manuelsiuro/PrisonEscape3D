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

/** How many come to watch at most, from how far (tiles), how far either side of the two they stand (tiles; the court's: further out). */
export const WATCH_MAX = 4;
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

/** Free to come and watch: up and about, nothing of their own on (freeToGo's), not one who stays put, not gathered. */
function free(sim: SimContext, k: number, playing: number): boolean {
  const s = sim.state;
  const m = s.inmates[k];
  // (freeToGo's as for one already waiting: watching isn't a reason not to (that's this), talking, a drink, the vending
  // machine's queue, a gathering are.)
  if (!m || k === playing || s.talk === k || s.cooler.who.includes(k) || s.vend.line.includes(k) || staysPut(sim, k)) return false;
  if (!freeToGo(sim, k, true) || huddleOf(sim, k) >= 0) return false;
  // (A job held isn't work now: the games' hours are nobody's shift.)
  return !BUSY.has(m.doing) && !BUSY.has(m.then);
}

const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

/**
 * Each step: who's watching the player's game (kept while free, never more than there are places; once a second, the
 * nearest free fill the places left). Once it's over, they stay LINGER steps, then go.
 */
export function spectate(sim: SimContext) {
  const s = sim.state;
  if (!spectatorsHere(sim)) return;
  const g = s.layer === LAYER.GROUND && !sim.away && gamesOpen(sim) ? watchedGame(sim) : null;
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

/** The places either side of the two (k: 0 and 2 on one side, 1 and 3 on the other): on open floor, else none. */
const marks: Body[] = Array.from({ length: WATCH_MAX }, () => bodyAt(0, 0));

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

type Place = { x: number; z: number; face: number };
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
  const spots = g ? placesFor(sim, g) : null;
  taken.fill(false);
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
