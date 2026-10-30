/** The holidays' models, built into the parts lists HolidaysView merges: garlands, the hose reel, baskets, the barbecue, lanterns, the tree, the snowman. */
import * as THREE from 'three';
import { box, cyl, paint, type Part } from './kit';
import { WALL_H } from './WorldView';
import { TABLE_TOP, type HolidayPiece } from './holidayDecor';

/** The holidays' colours: Easter's pastels, summer's brights, Halloween's, the Christmas lights. */
export const PASTEL = [0xf7b2c8, 0xb8e0f2, 0xfff1a8, 0xc8f0c0, 0xd8c4f2];
export const BRIGHT = [0xe5484d, 0xffd23f, 0x2fb6c8, 0x3fb950, 0xff7714];
export const SPOOKY = [0xff7714, 0x6b3fa0, 0x1d1a22];
export const LIGHTS = [0xff4d4d, 0xffd23f, 0x4dd2ff, 0x5aff8a, 0xff8ae0];

/** A garland along a north wall's face (or a side wall's: `side`): little flags (or bulbs that glow), dipping between pins. */
export function garland(out: Part[], g: HolidayPiece, colors: readonly number[], bulbs: boolean) {
  const y = WALL_H - 0.18;
  const side = g.side;
  const [s0, s1] = side ? [g.z, g.z1!] : [g.x, g.x1!];
  // (Its face: a little off the wall, into the room.)
  const face = side ? (side < 0 ? g.x + 0.06 : g.x + 1 - 0.06) : g.z + 0.06;
  const put = (geo: THREE.BufferGeometry, s: number, yy: number) => (side ? geo.rotateY(-Math.PI / 2).translate(face, yy, s) : geo.translate(s, yy, face));
  for (let s = s0 + 0.25, k = 0; s < s1 - 0.1; s += 0.5, k++) {
    const dip = Math.sin(((s - s0) / 1.5) * Math.PI) * 0.06;
    const c = colors[k % colors.length];
    if (bulbs) out.push(paint(put(new THREE.SphereGeometry(0.05, 6, 4), s, y - 0.06 - Math.abs(dip)), c));
    else out.push(paint(put(new THREE.ConeGeometry(0.11, 0.2, 3).rotateX(Math.PI), s, y - 0.12 - Math.abs(dip)), c));
  }
  // (The string itself, a thin dark line; the Christmas lights' wire drooping from bulb to bulb.)
  if (!bulbs) out.push(paint(put(new THREE.BoxGeometry(s1 - s0 - 0.2, 0.015, 0.015), (s0 + s1) / 2, y - 0.02 + 0.0075), 0x3a3a3a));
  else {
    const at = (s: number) => y - 0.03 - Math.abs(Math.sin(((s - s0) / 1.5) * Math.PI) * 0.06) - Math.sin(((s - s0) / 0.5) * Math.PI) ** 2 * 0.04;
    for (let s = s0 + 0.1; s < s1 - 0.1; s += 0.125) {
      const sb = Math.min(s + 0.125, s1 - 0.1);
      const ya = at(s);
      const yb = at(sb);
      const len = Math.hypot(sb - s, yb - ya);
      out.push(paint(put(new THREE.BoxGeometry(len, 0.012, 0.012).rotateZ(Math.atan2(yb - ya, sb - s)), (s + sb) / 2, (ya + yb) / 2), 0x2a3a2a));
    }
  }
}

/** Summer: the hose's tap and reel by the wall, the hose run out to its nozzle on a stake, aimed along its jet ([dx, dz]). */
export function hoseReel(out: Part[], x: number, z: number, dx: number, dz: number) {
  // (The tap on a standpipe at the wall behind, the reel on its frame beside it, the green hose looping to the nozzle.)
  const bx = x - dx * 0.36;
  const bz = z - dz * 0.36;
  const [sx, sz] = [-dz, dx];
  out.push(cyl(0.035, 0.7, 0x8a9096, bx, 0, bz, 8), box(0.1, 0.06, 0.1, 0xc0c4c8, bx, 0.62, bz), box(0.04, 0.04, 0.12, 0xd23f36, bx, 0.7, bz));
  const rx = bx + sx * 0.28;
  const rz = bz + sz * 0.28;
  // (Its drum facing out from the wall, its axle along the jet.)
  const reel = new THREE.CylinderGeometry(0.2, 0.2, 0.12, 14).rotateZ(Math.PI / 2).rotateY(Math.atan2(-dz, dx)).translate(rx, 0.28, rz);
  out.push(paint(reel, 0x3fb950), box(0.04, 0.3, 0.04, 0x2b3038, rx - dx * 0.08, 0, rz - dz * 0.08));
  // (The hose, low along the ground from the reel to the stake, then up it.)
  const len = Math.hypot(x - rx, z - rz);
  out.push(paint(new THREE.BoxGeometry(0.05, 0.05, len).rotateY(Math.atan2(x - rx, z - rz)).translate((x + rx) / 2, 0.04, (z + rz) / 2), 0x2f8a3a));
  out.push(cyl(0.02, 0.85, 0x6e4a2b, x, 0, z, 6), cyl(0.028, 0.8, 0x2f8a3a, x + dx * 0.04, 0.04, z + dz * 0.04, 6));
  // (The nozzle, pointing along the jet.)
  out.push(paint(new THREE.CylinderGeometry(0.025, 0.04, 0.16, 8).rotateX(Math.PI / 2).rotateY(Math.atan2(dx, dz)).translate(x + dx * 0.1, 0.85, z + dz * 0.1), 0xffd23f));
}

/** Easter: a basket of painted eggs on a table. */
export function basket(out: Part[], x: number, z: number) {
  out.push(cyl(0.16, 0.1, 0xb07a45, x, TABLE_TOP, z, 12), cyl(0.012, 0.22, 0x8a5a2e, x, TABLE_TOP + 0.1, z, 6));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    out.push(paint(new THREE.SphereGeometry(0.055, 8, 6).scale(1, 1.3, 1).translate(x + Math.cos(a) * 0.08, TABLE_TOP + 0.13, z + Math.sin(a) * 0.08), PASTEL[k % PASTEL.length]));
  }
}

/** Summer: a barbecue by the wall, its coals glowing. */
export function barbecue(out: Part[], glow: Part[], x: number, z: number) {
  out.push(box(0.7, 0.06, 0.4, 0x2b3038, x, 0.62, z), box(0.66, 0.16, 0.36, 0x3b4048, x, 0.46, z));
  for (const dx of [-0.3, 0.3]) for (const dz of [-0.14, 0.14]) out.push(box(0.04, 0.46, 0.04, 0x2b3038, x + dx, 0, z + dz));
  glow.push(box(0.6, 0.02, 0.3, 0xff6a1a, x, 0.6, z));
  for (let k = 0; k < 4; k++) out.push(box(0.12, 0.03, 0.05, k % 2 ? 0x8a3a1a : 0xd8a070, x - 0.2 + k * 0.13, 0.68, z));
}

/** Halloween: a jack-o'-lantern, its face lit. */
export function lantern(out: Part[], glow: Part[], x: number, y: number, z: number, size: number) {
  const r = 0.14 * size;
  out.push(paint(new THREE.SphereGeometry(r, 12, 8).scale(1, 0.78, 1).translate(x, y + r * 0.78, z), 0xf28c28), cyl(0.02 * size, 0.06 * size, 0x4f8a2e, x, y + r * 1.5, z, 6));
  const f = z + r * 0.95;
  glow.push(box(0.05 * size, 0.05 * size, 0.02, 0xffd23f, x - 0.05 * size, y + r * 0.95, f), box(0.05 * size, 0.05 * size, 0.02, 0xffd23f, x + 0.05 * size, y + r * 0.95, f), box(0.13 * size, 0.03 * size, 0.02, 0xffd23f, x, y + r * 0.5, f));
}

/** Christmas: a tree in tiers, a star, coloured lights; presents at its foot. */
export function tree(out: Part[], glow: Part[], x: number, z: number) {
  out.push(cyl(0.07, 0.25, 0x6e4a2b, x, 0, z, 8));
  const tiers: Array<[number, number, number]> = [
    [0.55, 0.6, 0.2],
    [0.43, 0.55, 0.62],
    [0.3, 0.5, 1.0],
  ];
  for (const [r, h, y] of tiers) out.push(paint(new THREE.ConeGeometry(r, h, 10).translate(x, y + h / 2, z), 0x2f7d3a));
  glow.push(paint(new THREE.OctahedronGeometry(0.1, 0).translate(x, 1.58, z), 0xffd23f));
  for (let k = 0; k < 14; k++) {
    const y = 0.3 + (k / 14) * 1.1;
    const r = 0.5 * (1 - (y - 0.2) / 1.4) + 0.04;
    const a = k * 2.3;
    glow.push(paint(new THREE.SphereGeometry(0.035, 6, 4).translate(x + Math.cos(a) * r, y, z + Math.sin(a) * r), LIGHTS[k % LIGHTS.length]));
  }
  const gifts: Array<[number, number, number, number]> = [
    [0.4, 0.25, 0xd23f36, 0xf4c542],
    [-0.38, 0.3, 0x2fb6c8, 0xffffff],
    [0.15, 0.45, 0x3fb950, 0xd23f36],
  ];
  for (const [dx, dz, c, rib] of gifts) out.push(box(0.22, 0.16, 0.2, c, x + dx, 0, z + dz), box(0.04, 0.165, 0.205, rib, x + dx, 0, z + dz));
}

/** Christmas: a snowman in the yard (in the desert, a sandman), in a Santa hat. */
export function snowman(out: Part[], x: number, z: number, sand: boolean) {
  const body = sand ? 0xd9b26a : 0xf4f6fa;
  out.push(
    paint(new THREE.SphereGeometry(0.32, 12, 8).translate(x, 0.3, z), body),
    paint(new THREE.SphereGeometry(0.22, 12, 8).translate(x, 0.78, z), body),
    paint(new THREE.SphereGeometry(0.15, 10, 8).translate(x, 1.12, z), body),
    paint(new THREE.ConeGeometry(0.035, 0.16, 6).rotateX(Math.PI / 2).translate(x, 1.12, z + 0.2), 0xff7714),
    box(0.04, 0.04, 0.02, 0x1d1a22, x - 0.05, 1.17, z + 0.135),
    box(0.04, 0.04, 0.02, 0x1d1a22, x + 0.05, 1.17, z + 0.135),
    // (A Santa hat: the red cone, its white brim and bobble.)
    cyl(0.15, 0.05, 0xffffff, x, 1.22, z, 12),
    paint(new THREE.ConeGeometry(0.14, 0.3, 10).translate(x, 1.42, z), 0xd23f36),
    paint(new THREE.SphereGeometry(0.045, 6, 4).translate(x, 1.58, z), 0xffffff),
  );
}
