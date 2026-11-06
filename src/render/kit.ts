import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Low-poly models from parts: each part is a primitive placed in the model's space and
 * painted with a vertex color; `merge` joins them into one geometry, so a whole model is one
 * draw call (and many copies are one InstancedMesh).
 */
export type Part = THREE.BufferGeometry;

const tmp = new THREE.Color();

export function paint(g: THREE.BufferGeometry, color: number | string): THREE.BufferGeometry {
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

/** A box w×h×d with its bottom face at y, centered on (x, z). */
export function box(w: number, h: number, d: number, color: number | string, x = 0, y = 0, z = 0): Part {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return paint(g, color);
}

/** An upright cylinder with its bottom at y. */
export function cyl(r: number, h: number, color: number | string, x = 0, y = 0, z = 0, seg = 10): Part {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  g.translate(x, y + h / 2, z);
  return paint(g, color);
}

/** A cylinder lying along x (rods, barbells), centered on (x, y, z). */
export function rod(r: number, len: number, color: number | string, x = 0, y = 0, z = 0, seg = 8): Part {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, color);
}

/** A round plate facing +z (a washer's door, a dial), centered on (x, y, z). */
export function disc(r: number, thick: number, color: number | string, x = 0, y = 0, z = 0, seg = 14): Part {
  const g = new THREE.CylinderGeometry(r, r, thick, seg);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, color);
}

/**
 * Joins parts into one geometry (all parts must be built by this kit), shaded toward its foot
 * (furniture, buildings); `shade` false for characters' limbs and held items, which have no floor.
 */
export function merge(parts: Part[], shade = true): THREE.BufferGeometry {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  for (const p of parts) p.dispose();
  if (shade) occlude(g);
  return g;
}

/** How dark a model is at its foot, and how high (world units) the shade fades out. */
const FOOT_SHADE = 0.74;
const FOOT_FADE = 0.55;

/**
 * Baked ambient occlusion: a model darkens toward its foot, where light from the sky is
 * blocked by the floor and the model itself (free at run time). Flat things (a rug, a mat)
 * are left as painted.
 */
function occlude(g: THREE.BufferGeometry) {
  const pos = g.attributes.position;
  const col = g.attributes.color;
  if (!col) return;
  g.computeBoundingBox();
  const lo = g.boundingBox!.min.y;
  if (g.boundingBox!.max.y - lo < 0.2) return;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, (pos.getY(i) - lo) / FOOT_FADE);
    const k = FOOT_SHADE + (1 - FOOT_SHADE) * t * (2 - t);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  col.needsUpdate = true;
}

/** The material for kit models: lit, colored by the vertices. */
export const kitMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
