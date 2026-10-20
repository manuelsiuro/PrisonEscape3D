import * as THREE from 'three';
import type { Pitch } from '../content/prisons/types';
import { BALL_R, GOAL_HALF } from '../content/team';
import { UNIT } from '../sim/tuning';
import { now, type Later } from './batch';
import { box, cyl, merge, paint } from './kit';

/**
 * What yard football (P29) shows: the pitch painted on the yard (its lines, the halfway line and
 * circle, a box before each goal), the two goals (posts, crossbar and a net) and the ball while a
 * match is on, rolling as it goes.
 */
export interface TeamFrame {
  /** The prison's pitch (null: none), and its theme (the paint stands out on the snow too). */
  pitch: Pitch | null;
  theme: string;
  /** The ball where it is between steps (tiles), null no match; on the move. */
  ball: { x: number; z: number; moving: boolean } | null;
  /** The match's players (inmate indexes): the player's side's two, the other side's three. */
  mates: readonly number[];
  rivals: readonly number[];
}

/** The paint: white on grass and sand and concrete, blue on the snow. */
const PAINT = 0xf2f0e6;
const PAINT_SNOW = 0x3a6fb0;
const POST = 0xf4f4ef;
const R = BALL_R / UNIT;
/** The sides' rings under the players' feet: the player's side green, the other red. */
const MATE = 0x3fc79a;
const RIVAL = 0xe5484d;

/** A football: an icosphere, white with the dark patches round its twelve points. */
function ballGeometry(): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const points: THREE.Vector3[] = [];
  const pos0 = ico.attributes.position;
  for (let k = 0; k < pos0.count; k++) {
    const p = new THREE.Vector3().fromBufferAttribute(pos0, k).normalize();
    if (!points.some((q) => q.distanceTo(p) < 0.01)) points.push(p);
  }
  ico.dispose();
  const g = new THREE.IcosahedronGeometry(R, 2);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Vector3();
  for (let f = 0; f < pos.count; f += 3) {
    c.set(0, 0, 0);
    for (let j = 0; j < 3; j++) c.add(new THREE.Vector3().fromBufferAttribute(pos, f + j));
    c.normalize();
    const dark = points.some((q) => q.dot(c) > 0.94);
    for (let j = 0; j < 3; j++) colors.set(dark ? [0.13, 0.14, 0.16] : [0.97, 0.97, 0.95], (f + j) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

export class TeamView {
  readonly group = new THREE.Group();
  private readonly lines = new THREE.Group();
  private readonly ball: THREE.Mesh;
  /** The sides' rings, one instanced mesh (one draw call): the shown ones first, the rest not drawn. */
  private readonly rings: THREE.InstancedMesh;
  private readonly at = new THREE.Matrix4();
  private readonly tint = new THREE.Color();
  private drawn = '';
  private readonly last = { x: 0, z: 0, set: false };
  private readonly axis = new THREE.Vector3();

  constructor() {
    this.ball = new THREE.Mesh(ballGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
    this.ball.castShadow = true;
    this.ball.visible = false;
    this.group.add(this.lines, this.ball);
    const ring = new THREE.RingGeometry(0.3, 0.4, 28);
    ring.rotateX(-Math.PI / 2);
    // (White, tinted per ring: the player's side, the other.)
    this.rings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false }), 5);
    this.rings.renderOrder = 0.3;
    // (They follow the players over the pitch.)
    this.rings.frustumCulled = false;
    // (Tinted from the start: one shader before and after the first match.)
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(5 * 3).fill(1), 3);
    this.rings.count = 0;
    this.group.add(this.rings);
  }

  /** When to free the last pitch's meshes (setWorld: after the next prison's first frame, its shaders in use by then). */
  private later: Later = now;

  /**
   * A prison staged (View.setWorld): its pitch built now, before the view warms its shaders, the
   * last one's freed `later` (so the shaders they share are never compiled twice).
   */
  setWorld(pitch: Pitch | null, theme: string, later: Later) {
    this.later = later;
    const key = pitch ? `${pitch.x},${pitch.z},${pitch.w},${pitch.d},${theme}` : '';
    if (key === this.drawn) return;
    if (pitch) this.build(pitch, theme);
    else this.clear();
    this.drawn = key;
  }

  /** Lets go of the pitch's meshes (their geometries and materials). */
  private clear() {
    const old = [...this.lines.children];
    this.lines.clear();
    this.later(() => {
      for (const o of old)
        o.traverse((c) => {
          const m = c as THREE.Mesh;
          if (!m.isMesh) return;
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        });
    });
  }

  /** The pitch's paint, goals and nets, built once per map: three meshes. */
  private build(p: Pitch, theme: string) {
    this.clear();
    const along = p.w >= p.d;
    // The field in its own terms (tiles): the long way a, across it l; then turned into x, z.
    const a0 = along ? p.x + 1 : p.z + 1;
    const a1 = along ? p.x + p.w - 1 : p.z + p.d - 1;
    const l0 = along ? p.z : p.x;
    const l1 = along ? p.z + p.d : p.x + p.w;
    const mid = (along ? p.z : p.x) + Math.floor((along ? p.d : p.w) / 2);
    const len = a1 - a0;
    const wid = l1 - l0;
    const ca = (a0 + a1) / 2;
    const cl = (l0 + l1) / 2;
    const W = 0.06;
    const colour = theme === 'alpine' ? PAINT_SNOW : PAINT;
    /** A painted strip: centred at (a, l), da long and dl across. */
    const strip = (a: number, l: number, da: number, dl: number) => (along ? box(da, 0.004, dl, colour, a, 0, l) : box(dl, 0.004, da, colour, l, 0, a));
    const parts = [strip(ca, l0 + W / 2 + 0.04, len, W), strip(ca, l1 - W / 2 - 0.04, len, W), strip(a0 + W / 2, cl, W, wid - 0.08), strip(a1 - W / 2, cl, W, wid - 0.08), strip(ca, cl, W, wid - 0.08)];
    // Boxes before the goals: a tile and a half deep, the mouth and a half-tile either side.
    const half = GOAL_HALF / UNIT + 0.5;
    const deep = 1.4;
    for (const [end, dir] of [[a0, 1], [a1, -1]] as const) parts.push(strip(end + (dir * deep) / 2, mid - half, deep, W), strip(end + dir * deep, mid, W, half * 2 + W), strip(end + (dir * deep) / 2, mid + half, deep, W));
    // The halfway circle.
    const r = Math.min(1.1, wid / 2 - 0.4);
    const ring = new THREE.RingGeometry(r, r + W, 40);
    ring.rotateX(-Math.PI / 2);
    ring.translate(along ? ca : cl, 0.004, along ? cl : ca);
    parts.push(paint(ring, colour));
    const lines = new THREE.Mesh(merge(parts, false), new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }));
    lines.position.y = 0.006;
    lines.renderOrder = 0.2;
    lines.receiveShadow = true;
    // The goals: posts and a crossbar on each goal line, the net's back stays behind them.
    const gh = GOAL_HALF / UNIT;
    const H = 0.78;
    const D = 0.7;
    const B = H * 0.6;
    const at = (a: number, l: number): [number, number] => (along ? [a, l] : [l, a]);
    const frame: THREE.BufferGeometry[] = [];
    const net: number[] = [];
    /** A quad of the net (four corners as [a, y, l], in order round it): two triangles. */
    const quad = (...c: Array<[number, number, number]>) => {
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const [a, y, l] = c[k];
        net.push(along ? a : l, y, along ? l : a);
      }
    };
    for (const [end, dir] of [[a0, -1], [a1, 1]] as const) {
      const back = end + dir * D;
      for (const sd of [-1, 1]) {
        const [x, z] = at(end, mid + sd * gh);
        frame.push(cyl(0.035, H, POST, x, 0, z, 8));
        const [bx, bz] = at(back, mid + sd * gh);
        frame.push(cyl(0.02, B, 0x9aa2ad, bx, 0, bz, 6));
      }
      const [cx, cz] = at(end, mid);
      frame.push(along ? box(0.07, 0.07, gh * 2 + 0.07, POST, cx, H - 0.035, cz) : box(gh * 2 + 0.07, 0.07, 0.07, POST, cx, H - 0.035, cz));
      // The net: its back, its roof from the crossbar down to the back, its two sides.
      quad([back, 0, mid - gh], [back, 0, mid + gh], [back, B, mid + gh], [back, B, mid - gh]);
      quad([end, H, mid - gh], [end, H, mid + gh], [back, B, mid + gh], [back, B, mid - gh]);
      for (const sd of [-1, 1]) quad([end, 0, mid + sd * gh], [back, 0, mid + sd * gh], [back, B, mid + sd * gh], [end, H, mid + sd * gh]);
    }
    const goals = new THREE.Mesh(merge(frame), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.2 }));
    goals.castShadow = true;
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(net, 3));
    ng.computeVertexNormals();
    // (Lit like everything else: dim at night, not a glowing panel.)
    const nets = new THREE.Mesh(ng, new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
    nets.renderOrder = 1;
    this.lines.add(lines, goals, nets);
  }

  update(f: TeamFrame | null, inmates: ReadonlyArray<{ x: number; z: number }>, dt: number, shown: boolean) {
    const p = f?.pitch ?? null;
    const key = p ? `${p.x},${p.z},${p.w},${p.d},${f!.theme}` : '';
    if (key !== this.drawn) {
      if (p) this.build(p, f!.theme);
      else this.clear();
      this.drawn = key;
    }
    this.lines.visible = !!p && shown;
    // Who's on which side: a ring under each.
    const mates = f?.mates.length ?? 0;
    let n = 0;
    for (let k = 0; k < 5; k++) {
      const id = k < 2 ? f?.mates[k] : f?.rivals[k - 2];
      const m = id === undefined ? undefined : inmates[id];
      if (!m || !shown || (k < 2 && k >= mates)) continue;
      this.rings.setMatrixAt(n, this.at.makeTranslation(m.x, 0.012, m.z));
      this.rings.setColorAt(n, this.tint.setHex(k < 2 ? MATE : RIVAL));
      n++;
    }
    this.rings.count = n;
    if (n) {
      this.rings.instanceMatrix.needsUpdate = true;
      this.rings.instanceColor!.needsUpdate = true;
    }
    const b = f?.ball ?? null;
    this.ball.visible = !!b && shown;
    if (!b) {
      this.last.set = false;
      return;
    }
    // Rolled along the way it went (its spin about the axis across the way).
    if (this.last.set && dt > 0) {
      const dx = b.x - this.last.x;
      const dz = b.z - this.last.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4 && d < 2) {
        this.axis.set(dz / d, 0, -dx / d);
        this.ball.rotateOnWorldAxis(this.axis, d / R);
      }
    }
    this.last.x = b.x;
    this.last.z = b.z;
    this.last.set = true;
    this.ball.position.set(b.x, R, b.z);
  }
}
