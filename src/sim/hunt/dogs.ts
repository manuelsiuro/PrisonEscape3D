import { HUNT } from '../../content/manhunt';
import { nearestDir } from '../ai/path';
import { centerX, centerZ, tileAt } from '../world/grid';
import { S, within } from './common';
import type { Hunt } from './Hunt';
import { HOUND, SEEK, type HuntDog } from './state';
import { spot } from './searchers';
import { arrived, follow, route } from './walkers';

// The dogs (out of Hunt.ts, v2.34.2): at the heel, on a fresh trail, pointing and barking at the
// player under their nose, calmed, dazed or asleep from a treat.

/** A dog this far from its handler (tiles) runs to catch up; its pace then. */
const DOG_CATCH_UP = 3;
const DOG_RUN = 200;
/** A dog that lost a trail picks one up again only after this long (steps); a pointing dog holds this long, barking every BARK_EVERY. */
const TRAIL_REST = 10 * S;
const POINT_HOLD = 3 * S;
const BARK_EVERY = 30;

export function dogsSniff(hunt: Hunt) {
  const s = hunt.state;
  s.dogs.forEach((d, k) => {
    const h = s.searchers[d.handler];
    if (h.mode === SEEK.OFF) return;
    switch (d.mode) {
      case HOUND.ASLEEP:
        d.body.moving = false;
        return;
      case HOUND.CALM:
      case HOUND.DAZED:
        d.body.moving = false;
        if (s.step >= d.until) d.mode = HOUND.HEEL;
        return;
      case HOUND.POINT: {
        d.body.moving = false;
        d.body.facing = nearestDir(s.player.x - d.body.x, s.player.z - d.body.z) || d.body.facing;
        if ((s.step - d.until + POINT_HOLD) % BARK_EVERY === 0) hunt.noise(tileAt(d.body.x, d.body.z), HUNT.bark, 'bark', d.handler);
        // (Out in the open, its handler is after them.)
        if (!hunt.out.cover[hunt.tile] && h.mode !== SEEK.CHASE && within(d.body, s.player, HUNT.nose)) spot(hunt, d.handler);
        if (s.step < d.until) return;
        if (within(d.body, s.player, HUNT.nose)) d.until = s.step + POINT_HOLD;
        else nextScent(hunt, d, k);
        return;
      }
      case HOUND.TRACK: {
        if (within(d.body, s.player, HUNT.nose)) return point(hunt, d, k);
        if (arrived(d)) nextScent(hunt, d, k);
        else follow(hunt, d, HUNT.dogTrack, false);
        return;
      }
      default: {
        // At the heel: the player under its nose, it points; a fresh trail close by puts it on it. At a place swept, it casts about round its handler for anyone hidden in the cover there.
        if (within(d.body, s.player, HUNT.nose)) return point(hunt, d, k);
        if (s.hidden && h.mode === SEEK.SWEEP && h.goal >= 0 && arrived(h) && within(h.body, s.player, HUNT.nose + HUNT.cast))
          return point(hunt, d, k);
        if (s.step >= d.rest) {
          for (let j = s.trail.length - 1; j >= 0; j--) {
            const [t, at] = s.trail[j];
            if (at <= d.trail) break;
            if (within(d.body, { x: centerX(t), z: centerZ(t) }, HUNT.sniff)) {
              d.mode = HOUND.TRACK;
              d.trail = at;
              route(hunt, d, t);
              hunt.events.push({ type: 'track', dog: k });
              return;
            }
          }
        }
        const far = !within(d.body, h.body, DOG_CATCH_UP);
        if (within(d.body, h.body, 1)) {
          d.body.moving = false;
          return;
        }
        const target = tileAt(h.body.x, h.body.z);
        if (d.goal !== target && (s.step % HUNT.replan === 0 || !d.path.length)) route(hunt, d, target);
        follow(hunt, d, far ? DOG_RUN : HUNT.dogHeel, false);
      }
    }
  });
}

/** On along the trail: the next fresher scent tile, or the end of it (the player there: it points; else the trail's lost). */
export function nextScent(hunt: Hunt, d: HuntDog, k: number) {
  const s = hunt.state;
  const next = s.trail.find(([, at]) => at > d.trail);
  if (next) {
    d.mode = HOUND.TRACK;
    d.trail = next[1];
    route(hunt, d, next[0]);
    return;
  }
  if (within(d.body, s.player, HUNT.nose)) return point(hunt, d, k);
  dogLost(hunt, d);
}

/** It has them: it points and barks; in the open its handler is after them (a chase), in cover he comes to where it points. */
export function point(hunt: Hunt, d: HuntDog, k: number) {
  const s = hunt.state;
  d.mode = HOUND.POINT;
  d.until = s.step + POINT_HOLD;
  d.path = [];
  d.goal = -1;
  hunt.know(hunt.tile);
  hunt.events.push({ type: 'point', dog: k });
  hunt.noise(tileAt(d.body.x, d.body.z), HUNT.bark, 'bark', d.handler);
  const h = s.searchers[d.handler];
  if (h.mode === SEEK.CHASE) return;
  if (!hunt.out.cover[hunt.tile]) return spot(hunt, d.handler);
  h.mode = SEEK.FOLLOW;
  h.path = [];
  h.goal = -1;
}

export function dogLost(hunt: Hunt, d: HuntDog) {
  d.mode = HOUND.HEEL;
  d.rest = hunt.state.step + TRAIL_REST;
  d.trail = hunt.state.step;
  d.path = [];
  d.goal = -1;
}
