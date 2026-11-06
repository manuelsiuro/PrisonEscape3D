import { HUNT } from '../../content/manhunt';
import { spotTile } from './world';
import { nearestDir } from '../ai/path';
import { canSee } from '../ai/sight';
import { rollInt, SALT } from '../rng';
import { chebTiles, tileAt } from '../world/grid';
import { UNIT } from '../tuning';
import { FOREVER, S, within } from './common';
import type { Hunt } from './Hunt';
import { HFEAT, HOUND, OVER, SEEK, type Searcher } from './state';
import { arrived, follow, route } from './walkers';

// The searchers (out of Hunt.ts, v2.34.2): their eyes and the notice meter, a chase and losing it,
// a look round where something was heard, the sweep, the beat; the radio; caught.

/** Standing still at a beat's stop (steps); turning to look round while looking (every this many steps). */
const STOP_STEPS = 2 * S;
const TURN_STEPS = 20;

/** Off to look at a tile (heard there, said on the radio, last seen there): the way there, then a look round. No way there: a look round where he stands. */
export function lookAt(hunt: Hunt, k: number, tile: number) {
  const m = hunt.state.searchers[k];
  m.mode = SEEK.LOOK;
  m.wait = HUNT.look;
  route(hunt, m, tile);
  if (!m.path.length && !arrived(m)) m.goal = -1;
}

export function backToBeat(hunt: Hunt, k: number) {
  const m = hunt.state.searchers[k];
  m.mode = SEEK.BEAT;
  m.goal = -1;
  m.path = [];
  m.notice = 0;
}

/** Spotted: after the player, and on the radio to the others (who come to look). */
export function spot(hunt: Hunt, k: number) {
  const s = hunt.state;
  const chasing = s.searchers.some((m) => m.mode === SEEK.CHASE);
  const m = s.searchers[k];
  m.mode = SEEK.CHASE;
  m.unseen = 0;
  m.last = hunt.tile;
  m.path = [];
  m.goal = -1;
  hunt.know(hunt.tile);
  if (!chasing) s.feats[HFEAT.spotted]++;
  hunt.events.push({ type: 'spotted', who: k });
  radio(hunt, k);
  // (A patrol that spots them before any alarm radios it in: the alarm is up now, the head start over.)
  if (s.step < s.alarmAt) s.alarmAt = s.step + 1;
}

/** The others within HUNT.radio tiles hear where the player is (none already after them, no officer leaves his roadblock). */
export function radio(hunt: Hunt, from: number) {
  const s = hunt.state;
  const t = hunt.tile;
  s.searchers.forEach((o, j) => {
    if (j === from || o.mode === SEEK.OFF || o.mode === SEEK.CHASE || hunt.isPost(j) || !within(o.body, s.player, HUNT.radio)) return;
    if (o.mode === SEEK.FOLLOW && o.dog >= 0 && s.dogs[o.dog].mode === HOUND.TRACK) return;
    lookAt(hunt, j, t);
  });
}

/** Whether a searcher's eyes find the player: never hidden; moving (or not yet settled) in cover only close by, the cover they stand in no veil. */
export function seesPlayer(hunt: Hunt, m: Searcher, range: number): boolean {
  const s = hunt.state;
  if (s.hidden) return false;
  const t = hunt.tile;
  const r = hunt.out.cover[t] ? Math.min(range, HUNT.coverSeen) : range;
  return canSee(hunt.world, m.body, s.player, r * UNIT, true, t);
}

export function searchersLook(hunt: Hunt) {
  const s = hunt.state;
  const p = s.player;
  const range = hunt.sight;
  const known = hunt.knownAt;
  const t = hunt.tile;
  const moving = s.still === 0;
  const inCover = hunt.out.cover[t] === 1;
  for (let k = 0; k < s.searchers.length; k++) {
    const m = s.searchers[k];
    m.sees = false;
    if (m.mode === SEEK.OFF) continue;
    // Eyes first.
    const sees = seesPlayer(hunt, m, range);
    m.sees = sees;
    if (sees) {
      if (m.mode === SEEK.CHASE) {
        m.unseen = 0;
        m.last = t;
        hunt.know(t);
      } else if (within(m.body, p, known)) {
        // (Moving through cover, a third of the pace.)
        if (!(inCover && moving && s.step % 3 !== 0)) m.notice += within(m.body, p, HUNT.near) ? 3 : 1;
        if (m.notice >= HUNT.spot) spot(hunt, k);
      }
    } else if (m.notice > 0) m.notice--;
    searcherMoves(hunt, k);
    if (s.over) return;
    // Caught: a chaser at arm's length in the open; in cover (he saw them go in), within reach of the hedge.
    if (m.mode === SEEK.CHASE && within(m.body, p, inCover ? HUNT.found : HUNT.catch)) return caught(hunt, k);
    // Found: a handler whose dog points at them in cover, hidden or not (in the open, his dog's find is a chase).
    if (inCover && m.dog >= 0 && s.dogs[m.dog].mode === HOUND.POINT && within(m.body, p, HUNT.found)) return caught(hunt, k);
  }
}

export function searcherMoves(hunt: Hunt, k: number) {
  const s = hunt.state;
  const m = s.searchers[k];
  const beat = hunt.beatOf(k);
  const { ox, oz } = hunt.out;
  // (A handler whose dog is on the trail or pointing goes after it, whatever he was doing but a chase.)
  if (m.dog >= 0 && (m.mode === SEEK.LOOK || m.mode === SEEK.BEAT || m.mode === SEEK.SWEEP)) {
    const dm = s.dogs[m.dog].mode;
    if (dm === HOUND.TRACK || dm === HOUND.POINT) {
      m.mode = SEEK.FOLLOW;
      m.path = [];
      m.goal = -1;
      return;
    }
  }
  switch (m.mode) {
    case SEEK.CHASE: {
      // (In the helicopter's light the chase never loses them: it says on the radio where they are.)
      const shown = m.sees || s.heli.lit;
      if (s.heli.lit) m.last = hunt.tile;
      m.unseen = shown ? 0 : m.unseen + 1;
      if (m.unseen >= HUNT.lose) {
        s.feats[HFEAT.lost]++;
        hunt.events.push({ type: 'lost', who: k });
        lookAt(hunt, k, m.last);
        return;
      }
      const target = shown ? hunt.tile : m.last;
      if (m.goal !== target && (s.step % HUNT.replan === 0 || !m.path.length)) route(hunt, m, target, hunt.chaseGrid);
      follow(hunt, m, HUNT.chase, true, hunt.chaseGrid);
      return;
    }
    case SEEK.LOOK: {
      if (m.goal >= 0 && !arrived(m)) {
        if (m.path.length) return void follow(hunt, m, HUNT.hurry);
        // (The way lost: a look round here.)
        m.goal = -1;
      }
      lookRound(hunt, m, k);
      if (--m.wait <= 0) backToBeat(hunt, k);
      return;
    }
    case SEEK.SWEEP: {
      // The cover nearest where the player was last known, one place after another, a look round at each.
      if (m.goal < 0) {
        nextSweep(hunt, m);
        m.wait = HUNT.sweepLook;
        if (m.goal < 0) return backToBeat(hunt, k);
      }
      if (!arrived(m)) {
        if (m.path.length) return void follow(hunt, m, HUNT.hurry);
        m.goal = -1;
        return;
      }
      lookRound(hunt, m, k);
      if (--m.wait <= 0) m.goal = -1;
      return;
    }
    case SEEK.FOLLOW: {
      const d = s.dogs[m.dog];
      if (!d || (d.mode !== HOUND.TRACK && d.mode !== HOUND.POINT)) return backToBeat(hunt, k);
      // (Its dog pointing: to what it points at, the player, into cover if that's where they are.)
      const pointing = d.mode === HOUND.POINT;
      const target = pointing ? hunt.tile : tileAt(d.body.x, d.body.z);
      if (chebTiles(target, tileAt(m.body.x, m.body.z)) <= (pointing ? 0 : 1)) {
        m.body.moving = false;
        m.body.facing = nearestDir(d.body.x - m.body.x, d.body.z - m.body.z) || m.body.facing;
        return;
      }
      const grid = pointing ? hunt.chaseGrid : hunt.npcGrid;
      if (m.goal !== target && (s.step % HUNT.replan === 0 || !m.path.length)) route(hunt, m, target, grid);
      follow(hunt, m, HUNT.hurry, true, grid);
      return;
    }
    case SEEK.BEAT: {
      const stop = beat[m.k];
      const goal = spotTile(stop, ox, oz);
      if (m.goal !== goal) {
        route(hunt, m, goal);
        m.wait = beat.length > 1 ? STOP_STEPS : FOREVER;
      }
      if (!arrived(m)) {
        if (m.path.length) return void follow(hunt, m, HUNT.walk);
        // (No way to that stop now: on to the next.)
        if (beat.length > 1) m.k = (m.k + 1) % beat.length;
        return;
      }
      m.body.moving = false;
      if (stop.face) m.body.facing = stop.face;
      if (--m.wait <= 0) m.k = (m.k + 1) % beat.length;
    }
  }
}

/** Standing, turning this way and that. */
export function lookRound(hunt: Hunt, m: Searcher, k: number) {
  m.body.moving = false;
  if (m.wait % TURN_STEPS === 0) m.body.facing = 1 + rollInt(hunt.state.salt, SALT.HUNT, hunt.state.step, k, 16);
}

/** The next place to sweep (the nearest not yet swept to where the search reckons the player has got to, or once it has widened, for the dog teams every other time, to where they were last known; then nearest him), marked swept (sniffed, for a dog team); every one done, round again. */
export function nextSweep(hunt: Hunt, m: Searcher) {
  const s = hunt.state;
  const pts = hunt.sweepPts;
  if (!pts.length) return;
  // (The dog teams keep their own list: only a nose finds someone hidden, so a place an eye has swept is still to be sniffed.)
  const dog = m.dog >= 0;
  if (dog) s.sniffed ??= [];
  const done = dog ? s.sniffed! : s.swept;
  if (done.length >= pts.length) done.length = 0;
  const here = tileAt(m.body.x, m.body.z);
  // (Once the search widens, the dog teams work back where the player was last known every other time it widens.)
  const turns = s.heat > 0 ? Math.floor((s.step - s.alarmAt - hunt.rampAt) / HUNT.rampEvery) : 0;
  const back = s.heat > 0 && m.dog >= 0 && turns % 2 === 0;
  const aim = back ? s.known : hunt.guess();
  let best = -1;
  let bestD = Infinity;
  for (const t of pts) {
    if (done.includes(t)) continue;
    const d = 2 * chebTiles(t, aim) + chebTiles(t, here);
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  if (best < 0) return;
  done.push(best);
  route(hunt, m, best);
  if (!m.path.length && !arrived(m)) m.goal = -1;
}

export function caught(hunt: Hunt, k: number) {
  const s = hunt.state;
  s.over = OVER.CAUGHT;
  s.overAt = s.step;
  s.by = k;
  s.player.moving = false;
  hunt.events.push({ type: 'caught', by: k });
}
