import * as THREE from 'three';
import { cornersOf } from '../content/grounds';
import type { Court, Ring } from '../content/prisons/types';
import type { World } from '../sim/world/World';
import { disposeTree, type Later, now } from './batch';
import { box, merge, paint, type Part } from './kit';

/** The running track's rubber, its lane lines and the court's paint (P31). */
const RUBBER = 0xb0553f;
const LINE = 0xf4f1e6;
const COURT = 0x3f6f8f;
const KEY = 0x9a4a3a;
const W = 0.05;
/** The planters' crops: leaves and what's ripening in them. */
const LEAF = 0x4f8a2e;
const LEAF_DARK = 0x3c6e24;
const VEG = [0xe8862e, 0xd23f36, 0xe8d23a];

/**
 * The sports ground and the garden (P31), drawn once per map from its data: the running
 * track (rubber lanes round the pitch, a lane line down the middle, the start line by its
 * first corner), the basketball court's paint where its hoop stands on the sports ground (the
 * key, the free-throw circle, the three-point arc), and crops growing in the gardener's
 * planters. Under the fog veil with the pitch's lines (renderOrder 0.2).
 */
export class GroundsView {
  readonly group = new THREE.Group();
  private readonly planters = new Map<number, { leaves: THREE.Mesh; veg: THREE.Mesh }>();

  setWorld(world: World, later: Later = now) {
    const old = [...this.group.children] as THREE.Mesh[];
    this.group.clear();
    later(() => {
      for (const m of old) disposeTree(m, () => false);
    });
    const leisure = world.def.leisure;
    const sports = world.def.zones.some(([z]) => z === 'sports');
    const paintParts: Part[] = [];
    const rubber: Part[] = [];
    if (leisure?.track) this.track(leisure.track, rubber, paintParts);
    if (leisure && sports && world.zoneAt(leisure.hoop.x, leisure.hoop.z) === 'sports') this.court(leisure.hoop, rubber, paintParts);
    const flat = (parts: Part[], opacity: number, order: number) => {
      if (!parts.length) return;
      const mesh = new THREE.Mesh(merge(parts, false), new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false }));
      mesh.position.y = 0.004;
      mesh.renderOrder = order;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    flat(rubber, 0.92, 0.15);
    flat(paintParts, 0.8, 0.2);
    // The crops in the gardener's planters: clumps of leaves along each, a ripe one here and there (one mesh a planter: update() grows what's planted).
    this.planters.clear();
    world.props.forEach((p, i) => {
      if (p.kind !== 'planter') return;
      const crops: Part[] = [];
      const ripe: Part[] = [];
      const along = (p.rot ?? 0) % 2 === 0;
      const len = along ? p.w : p.d;
      const cx = p.x + p.w / 2;
      const cz = p.z + p.d / 2;
      for (let k = 0; k < len * 2; k++) {
        const t = (k + 0.5) / 2 - len / 2;
        const x = along ? t : 0;
        const z = along ? 0 : t;
        const h = 0.12 + ((i * 7 + k * 3) % 5) * 0.025;
        crops.push(box(0.28, h, 0.26, k % 2 ? LEAF : LEAF_DARK, x, 0, z), box(0.18, h * 0.8, 0.34, LEAF, x, 0, z));
        if ((i + k) % 3 === 0) ripe.push(box(0.12, 0.1, 0.12, VEG[(i + k) % VEG.length], x + 0.06, h * 0.5, z + 0.05));
      }
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
      const leaves = new THREE.Mesh(merge(crops), mat);
      const veg = new THREE.Mesh(merge(ripe), mat.clone());
      for (const m of [leaves, veg]) {
        m.position.set(cx, 0.38, cz);
        m.castShadow = true;
        m.receiveShadow = true;
        this.group.add(m);
      }
      this.planters.set(i, { leaves, veg });
    });
  }

  /** The planters at work (prop index → grown 0–1): seedlings coming up, their crop showing once ripe; the others grown. */
  update(growing: ReadonlyMap<number, number>) {
    for (const [i, { leaves, veg }] of this.planters) {
      const g = growing.get(i);
      const s = g === undefined ? 1 : 0.2 + 0.8 * g;
      leaves.scale.set(0.5 + 0.5 * s, s, 0.5 + 0.5 * s);
      veg.visible = g === undefined || g >= 1;
    }
  }

  /** The track: rubber on its lanes, white edges in and out, a dashed lane line down its middle, the start line across by the first corner. */
  private track(r: Ring, rubber: Part[], lines: Part[]) {
    const x0 = r.x;
    const z0 = r.z;
    const x1 = r.x + r.w;
    const z1 = r.z + r.d;
    // The four straights (tiles' edges), as rectangles: north, south (full width), west, east (between them).
    const straights: Array<[number, number, number, number]> = [
      [x0, z0, x1, z0 + 1],
      [x0, z1 - 1, x1, z1],
      [x0, z0 + 1, x0 + 1, z1 - 1],
      [x1 - 1, z0 + 1, x1, z1 - 1],
    ];
    for (const [a, b, c, d] of straights) rubber.push(box(c - a, 0.002, d - b, RUBBER, (a + c) / 2, 0, (b + d) / 2));
    // Edges: the outer rectangle and the inner one.
    const frame = (ax: number, az: number, bx: number, bz: number) => {
      lines.push(box(bx - ax, 0.003, W, LINE, (ax + bx) / 2, 0.001, az + W / 2), box(bx - ax, 0.003, W, LINE, (ax + bx) / 2, 0.001, bz - W / 2));
      lines.push(box(W, 0.003, bz - az - 2 * W, LINE, ax + W / 2, 0.001, (az + bz) / 2), box(W, 0.003, bz - az - 2 * W, LINE, bx - W / 2, 0.001, (az + bz) / 2));
    };
    frame(x0 + 0.03, z0 + 0.03, x1 - 0.03, z1 - 0.03);
    frame(x0 + 0.97, z0 + 0.97, x1 - 0.97, z1 - 0.97);
    // The lane line: dashes down the middle of each straight.
    const dash = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.floor(len / 0.5);
      for (let k = 0; k < n; k += 2) {
        const t = (k + 0.5) / n;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        lines.push(ax === bx ? box(W * 0.8, 0.003, 0.25, LINE, x, 0.001, z) : box(0.25, 0.003, W * 0.8, LINE, x, 0.001, z));
      }
    };
    dash(x0 + 0.5, z0 + 0.5, x1 - 0.5, z0 + 0.5);
    dash(x0 + 0.5, z1 - 0.5, x1 - 0.5, z1 - 0.5);
    dash(x0 + 0.5, z0 + 0.5, x0 + 0.5, z1 - 0.5);
    dash(x1 - 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5);
    // The start line: across the north straight a tile on from the first corner.
    const c = cornersOf(r)[0];
    lines.push(box(0.09, 0.003, 0.94, LINE, c.x + 1.5, 0.001, c.z + 0.5));
  }

  /** The court's paint round a hoop on its post: the half court's surface, its key and free-throw circle, the three-point arc through the spots. */
  private court(c: Court, surface: Part[], lines: Part[]) {
    const [ax, az] = c.face === 1 ? [1, 0] : c.face === 5 ? [0, 1] : c.face === 9 ? [-1, 0] : [0, -1];
    const [sx, sz] = [-az, ax];
    const cx = c.x + 0.5;
    const cz = c.z + 0.5;
    /** A point in the court's terms (a: into it from the rim's tile middle, s: across it). */
    const at = (a: number, s: number): [number, number] => [cx + ax * a + sx * s, cz + az * a + sz * s];
    /** A strip from (a0, s0) to (a1, s1), w wide. */
    const strip = (a0: number, s0: number, a1: number, s1: number, w: number, color: number, into: Part[]) => {
      const [x0, z0] = at(a0, s0);
      const [x1, z1] = at(a1, s1);
      const len = Math.hypot(x1 - x0, z1 - z0);
      const g = new THREE.BoxGeometry(len, 0.003, w).rotateY(-Math.atan2(z1 - z0, x1 - x0)).translate((x0 + x1) / 2, 0.0015, (z0 + z1) / 2);
      into.push(paint(g, color));
    };
    // The half court (from the baseline behind the rim, 5 deep and 5 across).
    strip(-0.5, 0, 4.5, 0, 5, COURT, surface);
    // The key, painted, and its lines; the free-throw circle at its top.
    strip(-0.5, 0, 2.4, 0, 1.9, KEY, surface);
    strip(-0.5, -0.95, 2.4, -0.95, W, LINE, lines);
    strip(-0.5, 0.95, 2.4, 0.95, W, LINE, lines);
    strip(2.4, -0.95, 2.4, 0.95, W, LINE, lines);
    const arc = (a0: number, r: number, from: number, to: number, n: number) => {
      for (let k = 0; k < n; k++) {
        const t0 = from + ((to - from) * k) / n;
        const t1 = from + ((to - from) * (k + 1)) / n;
        strip(a0 + Math.cos(t0) * r, Math.sin(t0) * r, a0 + Math.cos(t1) * r, Math.sin(t1) * r, W, LINE, lines);
      }
    };
    arc(2.4, 0.9, -Math.PI / 2, Math.PI / 2, 10);
    // The three-point arc round the rim, inside the half court's sides (the spots 3 and 4 out beyond it).
    const R3 = 2.9;
    const T3 = 1.0;
    arc(0, R3, -T3, T3, 18);
    for (const sd of [-1, 1]) strip(-0.5, sd * R3 * Math.sin(T3), R3 * Math.cos(T3), sd * R3 * Math.sin(T3), W, LINE, lines);
    // The baseline and the court's sides.
    strip(-0.5, -2.5, -0.5, 2.5, W, LINE, lines);
    strip(-0.5, -2.5, 4.5, -2.5, W, LINE, lines);
    strip(-0.5, 2.5, 4.5, 2.5, W, LINE, lines);
  }
}
