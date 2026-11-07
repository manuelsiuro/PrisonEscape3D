/**
 * The model library's building kit: low-poly primitives, each placed in model space and painted with a
 * vertex colour, merged into one geometry per part layer.
 *
 * MANDATORY LOW-POLY FIRST PRINCIPLES:
 * - Low polygon counts are a FIRST-ORDER requirement for all procedural models.
 * - Flat-shaded low-poly aesthetics look cleaner, crisper, and render orders of magnitude faster on mobile.
 * - Primitives default to low radial segment counts:
 *   • Small details, rods, pipes, needles, screws, cables: 6 segments (or 4 for diamond/square cross-sections).
 *   • Cylinders, cones, dishes, wheels, mugs, barrels: 8 segments.
 *   • Large hero curves (tanks, silos, radar domes): 8 to 10 segments maximum.
 *   • NEVER use 16, 24, or 32 segments for procedural models.
 *
 * `paint`, `box`, `cyl`, `rod`, `disc` and `merge` keep the signatures and the baked foot shade of the
 * game's `src/render/kit.ts` (`mapviewertest` proves the output identical), so a library model can
 * move into the game by changing one import. The rest (`rotBox`, `frustum`, `cone`, `tubeZ`, `ring`,
 * `wedge`, `frame` and the repeaters) are additions. The kit depends on `three` only: copy the folder
 * to reuse it in another project.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Part } from './types';

export type { Part } from './types';

const tmp = new THREE.Color();

/** A parameter value as a 24-bit colour: a number as it is, a `'#rrggbb'` string parsed, else `fallback`. */
export function hexColor(value: string | number | boolean | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value.trim())) return parseInt(value.trim().replace('#', ''), 16);
  return fallback;
}

/** Paints every vertex of `g` one colour. */
export function paint(g: THREE.BufferGeometry, color: number | string): Part {
  tmp.set(color);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = tmp.r;
    c[i * 3 + 1] = tmp.g;
    c[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** A box `w × h × d` with its bottom face at `y`, centred on `(x, z)`. */
export function box(w: number, h: number, d: number, color: number | string, x = 0, y = 0, z = 0): Part {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return paint(g, color);
}

/** A box `w × h × d` turned by `(rx, ry, rz)` (radians, in that order) about its centre, then centred on `(x, y, z)`. */
export function rotBox(
  w: number,
  h: number,
  d: number,
  color: number | string,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): Part {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return paint(g, color);
}

/** An upright cylinder with its bottom at `y`. Low-poly default: 8 segments. */
export function cyl(r: number, h: number, color: number | string, x = 0, y = 0, z = 0, seg = 8): Part {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  g.translate(x, y + h / 2, z);
  return paint(g, color);
}

/** An upright tapered cylinder (radius `rTop` at the top, `rBot` at the bottom) with its bottom at `y`. Low-poly default: 8 segments. */
export function frustum(rTop: number, rBot: number, h: number, color: number | string, x = 0, y = 0, z = 0, seg = 8): Part {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  g.translate(x, y + h / 2, z);
  return paint(g, color);
}

/** An upright cone with its base at `y`. Low-poly default: 8 segments. */
export function cone(r: number, h: number, color: number | string, x = 0, y = 0, z = 0, seg = 8): Part {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(x, y + h / 2, z);
  return paint(g, color);
}

/** A cylinder lying along x (rods, axles), centred on `(x, y, z)`. Low-poly default: 6 segments. */
export function rod(r: number, len: number, color: number | string, x = 0, y = 0, z = 0, seg = 6): Part {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, color);
}

/** A cylinder lying along z (pipes, rails running front to back), centred on `(x, y, z)`. Low-poly default: 6 segments. */
export function tubeZ(r: number, len: number, color: number | string, x = 0, y = 0, z = 0, seg = 6): Part {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, color);
}

/** A round plate facing +z (a dial, a lens, a wheel seen from the front), centred on `(x, y, z)`. Low-poly default: 8 segments. */
export function disc(r: number, thick: number, color: number | string, x = 0, y = 0, z = 0, seg = 8): Part {
  const g = new THREE.CylinderGeometry(r, r, thick, seg);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, color);
}

/** A ring (torus) centred on `(x, y, z)`, its hole facing along `axis`. Low-poly default: 4-sided diamond profile, 8 segments. */
export function ring(
  radius: number,
  tube: number,
  color: number | string,
  x = 0,
  y = 0,
  z = 0,
  axis: 'x' | 'y' | 'z' = 'z',
  seg = 8,
): Part {
  const g = new THREE.TorusGeometry(radius, tube, 4, seg);
  if (axis === 'y') g.rotateX(Math.PI / 2);
  else if (axis === 'x') g.rotateY(Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, color);
}

/**
 * A right-angled wedge `w × h × d` with its bottom face at `y`, centred on `(x, z)`: full height on one
 * side, sloping down to nothing on the side named by `low` (`'z+'` is the front).
 */
export function wedge(
  w: number,
  h: number,
  d: number,
  color: number | string,
  x = 0,
  y = 0,
  z = 0,
  low: 'z+' | 'z-' | 'x+' | 'x-' = 'z+',
): Part {
  const alongZ = low === 'z+' || low === 'z-';
  const span = alongZ ? d : w;
  const depth = alongZ ? w : d;
  // Drawn in the xy plane with its low edge at +x, extruded along z, then turned so the low edge faces `low`.
  const shape = new THREE.Shape();
  shape.moveTo(-span / 2, 0);
  shape.lineTo(span / 2, 0);
  shape.lineTo(-span / 2, h);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  if (low === 'z+') g.rotateY(-Math.PI / 2);
  else if (low === 'z-') g.rotateY(Math.PI / 2);
  else if (low === 'x-') g.rotateY(Math.PI);
  g.translate(x, y, z);
  return paint(g, color);
}

/** A rectangular frame (four bars `border` thick) round an opening, `w × h` facing +z and `d` deep, bottom at `y`. */
export function frame(w: number, h: number, d: number, border: number, color: number | string, x = 0, y = 0, z = 0): Part[] {
  return [
    box(w, border, d, color, x, y, z),
    box(w, border, d, color, x, y + h - border, z),
    box(border, h - border * 2, d, color, x - (w - border) / 2, y + border, z),
    box(border, h - border * 2, d, color, x + (w - border) / 2, y + border, z),
  ];
}

const many = (out: Part[], res: Part | Part[]) => {
  if (Array.isArray(res)) out.push(...res);
  else out.push(res);
};

/** The parts `fn` builds at `x = -xAbs` and at `x = +xAbs` (left and right of a symmetric model). */
export function mirrorX(xAbs: number, fn: (x: number, sign: -1 | 1) => Part | Part[]): Part[] {
  const out: Part[] = [];
  many(out, fn(-xAbs, -1));
  many(out, fn(xAbs, 1));
  return out;
}

/** The parts `fn` builds at the four corners `(±xAbs, ±zAbs)` (legs, wheels, stilts). */
export function mirrorXZ(xAbs: number, zAbs: number, fn: (x: number, z: number, sx: -1 | 1, sz: -1 | 1) => Part | Part[]): Part[] {
  const out: Part[] = [];
  for (const sx of [-1, 1] as const) for (const sz of [-1, 1] as const) many(out, fn(sx * xAbs, sz * zAbs, sx, sz));
  return out;
}

/** The parts `fn` builds `count` times, given the index and `t` from 0 to 1 (slats, rungs, buttons). */
export function repeatLinear(count: number, fn: (index: number, t: number) => Part | Part[]): Part[] {
  const out: Part[] = [];
  for (let i = 0; i < count; i++) many(out, fn(i, count > 1 ? i / (count - 1) : 0));
  return out;
}

/** The parts `fn` builds round the origin, turned to `count` angles round the y axis and moved to `(cx, cz)`. */
export function repeatRadial(count: number, cx: number, cz: number, fn: (index: number, angle: number) => Part | Part[]): Part[] {
  const out: Part[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const built: Part[] = [];
    many(built, fn(i, angle));
    for (const p of built) out.push(p.rotateY(angle).translate(cx, 0, cz));
  }
  return out;
}

/** How dark a model is at its foot, and how high (world units) the shade fades out: the game's values. */
const FOOT_SHADE = 0.74;
const FOOT_FADE = 0.55;

/**
 * Bakes the game's ambient occlusion: darker toward the foot, where the floor blocks the sky. `footY`
 * is the model's foot (by default this geometry's lowest point); things under 0.2 high stay as painted.
 */
function occlude(g: THREE.BufferGeometry, footY?: number) {
  const pos = g.attributes.position;
  const col = g.attributes.color;
  if (!col) return;
  g.computeBoundingBox();
  const lo = footY ?? g.boundingBox!.min.y;
  if (g.boundingBox!.max.y - g.boundingBox!.min.y < 0.2 && footY === undefined) return;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - lo) / FOOT_FADE));
    const k = FOOT_SHADE + (1 - FOOT_SHADE) * t * (2 - t);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  col.needsUpdate = true;
}

/**
 * Joins parts into one geometry and disposes them; `shade` bakes the foot shade (false for lights,
 * glass and anything without a floor). `footY` shades from a given foot, so the layers of one model
 * all darken toward the same floor.
 */
export function merge(parts: Part[], shade = true, footY?: number): THREE.BufferGeometry {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  for (const p of parts) p.dispose();
  if (shade) occlude(g, footY);
  return g;
}

/** The material for matte layers, as the game's `kitMaterial`: lit, coloured by the vertices. */
export const kitMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
