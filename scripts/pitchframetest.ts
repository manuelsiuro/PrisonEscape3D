/**
 * A match's camera (P29, src/render/pitchFrame.ts): on every prison's pitch and every screen
 * shape (desktop, a phone upright and sideways, a narrow phone), the camera eased in as View
 * eases it (zoom, look-ahead, target) frames both goals with the player on the pitch, and keeps
 * the player on screen when he strays off it (a match goes on PITCH_LEAVE tiles away), without
 * a look-ahead long enough to cut the camera back to him every frame.
 */
import { check } from './assert';
import { PRISONS } from '../src/content/prisons';
import { PITCH_LEAVE } from '../src/content/team';
import { PITCH_PULL, pitchFraming, screenTiles } from '../src/render/pitchFrame';

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.9;
/** The player's own zoom (the default). */
const GOAL = 1.25;
const SCREENS: Array<[string, number, number]> = [
  ['desktop', 1440, 900],
  ['upright', 412, 915],
  ['sideways', 915, 412],
  ['narrow', 360, 780],
];

/** Five seconds at 60 frames a second of View's easing, the player standing at (px, pz). */
function settle(p: { x: number; z: number; w: number; d: number }, px: number, pz: number, aspect: number) {
  let zoom = GOAL;
  const ahead = { x: 0, z: 0 };
  const target = { x: px, z: pz };
  let maxPull = 0;
  const dt = 1 / 60;
  for (let k = 0; k < 300; k++) {
    const aim = pitchFraming(p, px, pz, ahead, zoom, aspect, ZOOM_MIN, ZOOM_MAX);
    ahead.x += (aim.x - ahead.x) * Math.min(1, dt * 4);
    ahead.z += (aim.z - ahead.z) * Math.min(1, dt * 4);
    maxPull = Math.max(maxPull, Math.abs(ahead.x) + Math.abs(ahead.z));
    // (View: the target cuts back to the player past 10 tiles, else eases to player + look-ahead.)
    if (Math.abs(target.x - px) + Math.abs(target.z - pz) > 10) {
      target.x = px;
      target.z = pz;
    } else {
      target.x += (px + ahead.x - target.x) * Math.min(1, dt * 7);
      target.z += (pz + ahead.z - target.z) * Math.min(1, dt * 7);
    }
    const to = Math.min(GOAL, aim.fit);
    zoom += (to - zoom) * Math.min(1, dt * 3);
  }
  const { wide, deep } = screenTiles(aspect);
  const hw = wide / zoom / 2;
  const hd = deep / zoom / 2;
  const sees = (x: number, z: number) => Math.abs(x - target.x) <= hw + 1e-6 && Math.abs(z - target.z) <= hd + 1e-6;
  return { zoom, maxPull, sees };
}

const lines: string[] = [];
for (const prison of PRISONS) {
  const p = prison.leisure?.pitch;
  if (!p) continue;
  const row: string[] = [];
  for (const [name, w, h] of SCREENS) {
    const aspect = w / h;
    // On the pitch (the middle, each goal mouth): the whole pitch in the picture.
    const spots: Array<[number, number]> = [
      [p.x + p.w / 2, p.z + p.d / 2],
      [p.x + 0.5, p.z + p.d / 2],
      [p.x + p.w - 0.5, p.z + p.d / 2],
      [p.x + p.w / 2, p.z + 0.5],
      [p.x + p.w / 2, p.z + p.d - 0.5],
    ];
    let zoomOn = 0;
    for (const [px, pz] of spots) {
      const r = settle(p, px, pz, aspect);
      zoomOn = Math.max(zoomOn, r.zoom);
      const all = r.sees(p.x, p.z) && r.sees(p.x + p.w, p.z) && r.sees(p.x, p.z + p.d) && r.sees(p.x + p.w, p.z + p.d);
      check(all, `${prison.id} ${name}: the player at ${px},${pz} on the pitch, both goals in the picture`);
      check(r.sees(px, pz), `${prison.id} ${name}: the player at ${px},${pz} on screen`);
    }
    // Off the pitch, as far as a match goes on: the player stays on screen.
    let pull = 0;
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1]]) {
      const px = dx < 0 ? p.x - PITCH_LEAVE : dx > 0 ? p.x + p.w + PITCH_LEAVE : p.x + p.w / 2;
      const pz = dz < 0 ? p.z - PITCH_LEAVE : dz > 0 ? p.z + p.d + PITCH_LEAVE : p.z + p.d / 2;
      const r = settle(p, px, pz, aspect);
      pull = Math.max(pull, r.maxPull);
      check(r.sees(px - 0.5, pz - 0.5) && r.sees(px + 0.5, pz + 0.5), `${prison.id} ${name}: the player ${PITCH_LEAVE} tiles off the pitch (${px},${pz}) still on screen`);
      check(r.maxPull <= PITCH_PULL + 1e-6, `${prison.id} ${name}: the look-ahead stays within ${PITCH_PULL} tiles (${r.maxPull.toFixed(2)})`);
    }
    row.push(`${name} ${zoomOn.toFixed(2)}`);
  }
  lines.push(`${prison.id} ${p.w}×${p.d}: zoom on the pitch ${row.join(', ')}`);
}
console.log(lines.join('\n'));
console.log(`both goals in the picture on every pitch and screen; the player on screen up to ${PITCH_LEAVE} tiles off it`);
