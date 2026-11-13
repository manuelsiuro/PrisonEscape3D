/**
 * A penalty shootout's camera (2.44; P29's match before, src/render/pitchFrame.ts): on every
 * prison's pitch and every screen shape (desktop, a phone upright and sideways, a narrow phone),
 * the camera eased in as View eases it (zoom, look-ahead, target) holds the shootout's box (the
 * spot, the goal and its net: penalties.ts shootoutBox) with the player at either place, and keeps
 * the player on screen while walking on from as far as a shootout starts (PEN_RANGE tiles off the
 * pitch), without a look-ahead long enough to cut the camera back to him every frame.
 */
import { check } from './assert';
import { PRISONS } from '../src/content/prisons';
import { PEN_RANGE } from '../src/content/penalties';
import { PENS_ZOOM, PITCH_PULL, pitchFraming, screenTiles } from '../src/render/pitchFrame';
import { goalOf, keeperPlace, kickerPlace, shootoutBox } from '../src/sim/systems/penalties';
import { UNIT } from '../src/sim/tuning';

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
    const aim = pitchFraming(p, px, pz, ahead, zoom, aspect);
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
    // (viewCamera.ease: in or out to the box, no closer than PENS_ZOOM.)
    const to = Math.min(PENS_ZOOM, aim.fit);
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
  const b = shootoutBox(p);
  const g = goalOf(p);
  const row: string[] = [];
  for (const [name, w, h] of SCREENS) {
    const aspect = w / h;
    // At either place (behind the ball, on the line): the whole box in the picture.
    const places = [kickerPlace(g, { x: 0, z: 0 }), keeperPlace(g, { x: 0, z: 0 })].map((q) => [q.x / UNIT, q.z / UNIT]);
    let zoomOn = 0;
    for (const [px, pz] of places) {
      const r = settle(b, px, pz, aspect);
      zoomOn = Math.max(zoomOn, r.zoom);
      const all = r.sees(b.x, b.z) && r.sees(b.x + b.w, b.z) && r.sees(b.x, b.z + b.d) && r.sees(b.x + b.w, b.z + b.d);
      check(all, `${prison.id} ${name}: the player at ${px.toFixed(1)},${pz.toFixed(1)}, the spot and the goal in the picture`);
      check(r.sees(px, pz), `${prison.id} ${name}: the player at ${px.toFixed(1)},${pz.toFixed(1)} on screen`);
    }
    // Walking on from as far off the pitch as a shootout starts: the player stays on screen.
    let pull = 0;
    for (const [dx, dz] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, 1],
    ]) {
      const px = dx < 0 ? p.x - PEN_RANGE : dx > 0 ? p.x + p.w + PEN_RANGE : p.x + p.w / 2;
      const pz = dz < 0 ? p.z - PEN_RANGE : dz > 0 ? p.z + p.d + PEN_RANGE : p.z + p.d / 2;
      const r = settle(b, px, pz, aspect);
      pull = Math.max(pull, r.maxPull);
      check(
        r.sees(px - 0.5, pz - 0.5) && r.sees(px + 0.5, pz + 0.5),
        `${prison.id} ${name}: the player ${PEN_RANGE} tiles off the pitch (${px},${pz}) still on screen`,
      );
      check(
        r.maxPull <= PITCH_PULL + 1e-6,
        `${prison.id} ${name}: the look-ahead stays within ${PITCH_PULL} tiles (${r.maxPull.toFixed(2)})`,
      );
    }
    row.push(`${name} ${zoomOn.toFixed(2)}`);
  }
  lines.push(`${prison.id} box ${b.w}×${b.d}: zoom at the places ${row.join(', ')}`);
}
console.log(lines.join('\n'));
console.log(`the spot and the goal in the picture on every pitch and screen; the player on screen up to ${PEN_RANGE} tiles off the pitch`);
