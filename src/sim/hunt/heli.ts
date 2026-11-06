import { HUNT } from '../../content/manhunt';
import { rollInt, SALT } from '../rng';
import { UNIT } from '../tuning';
import { centerX, centerZ, chebTiles } from '../world/grid';
import { dist2, DRAW, isqrt, S, within } from './common';
import type { Hunt } from './Hunt';
import { HFEAT, SEEK } from './state';
import { lookAt } from './searchers';

// The helicopter (out of Hunt.ts, v2.34.2): its round, then over the cover nearest where the player
// is reckoned to be once the search widens; its light, and everyone called to what it lights.

/** The helicopter calls the player in every this many steps while it holds them lit. */
const HELI_CALL = S;
/** The search widened: the helicopter picks its next place among this many of the nearest not yet swept. */
const HELI_PICK = 6;

export function heliSweeps(hunt: Hunt) {
  const s = hunt.state;
  const h = s.heli;
  if (!h.on) return;
  const { ox, oz } = hunt.out;
  const route = hunt.def.heli.route;
  let tx: number;
  let tz: number;
  let pace: number;
  const searching = s.heat > 0 && hunt.sweepPts.length > 0;
  if (h.hold > 0) {
    tx = s.player.x;
    tz = s.player.z;
    pace = Math.floor((HUNT.heliChase * HUNT.pace) / 100);
    h.hold--;
  } else if (searching) {
    // The search widened: over the cover nearest where the player was last known.
    if ((h.aim ?? -1) < 0) h.aim = heliAim(hunt);
    tx = centerX(h.aim!);
    tz = centerZ(h.aim!);
    pace = Math.floor((HUNT.heliSpeed * HUNT.pace) / 100);
  } else {
    const stop = route[h.k];
    tx = (stop.x + ox) * UNIT + UNIT / 2;
    tz = (stop.z + oz) * UNIT + UNIT / 2;
    pace = Math.floor((HUNT.heliSpeed * HUNT.pace) / 100);
  }
  const dx = tx - h.x;
  const dz = tz - h.z;
  const d = isqrt(dx * dx + dz * dz);
  if (d <= pace) {
    h.x = tx;
    h.z = tz;
    if (h.hold <= 0) {
      if (searching) h.aim = -1;
      else h.k = (h.k + 1) % route.length;
    }
  } else {
    h.x += Math.trunc((dx * pace) / d);
    h.z += Math.trunc((dz * pace) / d);
  }
  // Its light: someone in the open under it; someone moving in cover only under its middle; someone hidden never.
  const reach = hunt.out.cover[hunt.tile] ? HUNT.heliCover : HUNT.heliLight;
  const lit = !s.hidden && within(h, s.player, reach);
  if (lit) {
    h.hold = HUNT.heliHold;
    hunt.know(hunt.tile);
    if (!h.lit || s.step % HELI_CALL === 0) {
      // The light on them: every searcher out within the radio's reach comes running (a chaser keeps on); none that near, the nearest comes all the same.
      const t = hunt.tile;
      let nearest = -1;
      let near = Infinity;
      let came = false;
      s.searchers.forEach((m, j) => {
        if (m.mode === SEEK.OFF || hunt.isPost(j)) return;
        if (m.mode === SEEK.CHASE) return void (came = true);
        const d = dist2(m.body, s.player);
        if (d < near) {
          near = d;
          nearest = j;
        }
        if (!within(m.body, s.player, HUNT.radio)) return;
        lookAt(hunt, j, t);
        came = true;
      });
      if (!came && nearest >= 0) lookAt(hunt, nearest, t);
    }
  }
  if (lit !== h.lit) {
    h.lit = lit;
    if (lit) s.feats[HFEAT.lit]++;
    hunt.events.push({ type: 'lit', on: lit });
  }
}

/** The helicopter's next place to search: one of the few nearest where the search reckons the player has got to, not yet swept on foot. */
export function heliAim(hunt: Hunt): number {
  const s = hunt.state;
  const aim = hunt.guess();
  const near = hunt.sweepPts
    .filter((t) => !s.swept.includes(t))
    .map((t) => [chebTiles(t, aim), t] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .slice(0, HELI_PICK);
  if (!near.length) return hunt.sweepPts[rollInt(s.salt, SALT.HUNT, DRAW.AIM, s.step, hunt.sweepPts.length)];
  return near[rollInt(s.salt, SALT.HUNT, DRAW.AIM, s.step, near.length)][1];
}
