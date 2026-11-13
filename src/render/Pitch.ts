import * as THREE from 'three';
import type { Pitch } from '../content/prisons/types';
import { MOUTH_HALF, PEN_BALL_R, SPOT_OUT } from '../content/penalties';
import { UNIT } from '../sim/tuning';
import { disposeTree, type Later, now } from './batch';
import { box, cyl, merge, paint } from './kit';

/**
 * The yard's pitch (P29; 2.44: penalties): painted on the yard (its lines, the halfway line and
 * circle, a box before each goal, the penalty spot before the far one), the two goals (posts,
 * crossbar and a net), and the ball while a penalty is taken, in flight from the spot.
 */
export interface PitchFrame {
  /** The prison's pitch (null: none), and its theme (the paint stands out on the snow too). */
  pitch: Pitch | null;
  theme: string;
  /** The penalty spot (tiles), null without a pitch. */
  spot: { x: number; z: number } | null;
  /** The ball (tiles; y off the ground), null when none is down. */
  ball: { x: number; y: number; z: number } | null;
  /** The keeper diving: who (-1 the player, an inmate), how far down (0–1), the way across the world (x, z: -1, 0 or 1). */
  keeper: { who: number; dive: number; x: number; z: number } | null;
  /** In a shootout: the box the camera keeps in the picture (the spot, the goal and the net behind it), null otherwise. */
  frame: Pitch | null;
}

/** The paint: white on grass and sand and concrete, blue on the snow. */
const PAINT = 0xf2f0e6;
const PAINT_SNOW = 0x3a6fb0;
const POST = 0xf4f4ef;
const R = PEN_BALL_R / UNIT;

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

export class PitchView {
  readonly group = new THREE.Group();
  private readonly lines = new THREE.Group();
  private readonly ball: THREE.Mesh;
  private drawn = '';
  private readonly last = { x: 0, y: 0, z: 0, set: false };
  private readonly axis = new THREE.Vector3();

  constructor() {
    this.ball = new THREE.Mesh(ballGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
    this.ball.castShadow = true;
    this.ball.visible = false;
    this.group.add(this.lines, this.ball);
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
      for (const o of old) disposeTree(o, () => false);
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
    const strip = (a: number, l: number, da: number, dl: number) =>
      along ? box(da, 0.004, dl, colour, a, 0, l) : box(dl, 0.004, da, colour, l, 0, a);
    const parts = [
      strip(ca, l0 + W / 2 + 0.04, len, W),
      strip(ca, l1 - W / 2 - 0.04, len, W),
      strip(a0 + W / 2, cl, W, wid - 0.08),
      strip(a1 - W / 2, cl, W, wid - 0.08),
      strip(ca, cl, W, wid - 0.08),
    ];
    // Boxes before the goals: a tile and a half deep, the mouth and a half-tile either side.
    const half = MOUTH_HALF / UNIT + 0.5;
    const deep = 1.4;
    for (const [end, dir] of [
      [a0, 1],
      [a1, -1],
    ] as const)
      parts.push(
        strip(end + (dir * deep) / 2, mid - half, deep, W),
        strip(end + dir * deep, mid, W, half * 2 + W),
        strip(end + (dir * deep) / 2, mid + half, deep, W),
      );
    // The halfway circle.
    const r = Math.min(1.1, wid / 2 - 0.4);
    const ring = new THREE.RingGeometry(r, r + W, 40);
    ring.rotateX(-Math.PI / 2);
    ring.translate(along ? ca : cl, 0.004, along ? cl : ca);
    parts.push(paint(ring, colour));
    // (2.44: the penalty spot before the far goal, SPOT_OUT out, and its arc.)
    const spotA = a1 - SPOT_OUT / UNIT;
    const dot = new THREE.CircleGeometry(0.09, 16);
    dot.rotateX(-Math.PI / 2);
    dot.translate(along ? spotA : mid, 0.004, along ? mid : spotA);
    parts.push(paint(dot, colour));
    const arc = new THREE.RingGeometry(0.85, 0.85 + W, 24, 1, Math.PI * 0.62, Math.PI * 0.76);
    arc.rotateX(-Math.PI / 2);
    // (Facing out of the box, toward the halfway line.)
    arc.rotateY(along ? 0 : -Math.PI / 2);
    arc.translate(along ? spotA : mid, 0.004, along ? mid : spotA);
    parts.push(paint(arc, colour));
    const lines = new THREE.Mesh(
      merge(parts, false),
      new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    lines.position.y = 0.006;
    lines.renderOrder = 0.2;
    lines.receiveShadow = true;
    // The goals: posts and a crossbar on each goal line, the net's back stays behind them.
    const gh = MOUTH_HALF / UNIT;
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
    for (const [end, dir] of [
      [a0, -1],
      [a1, 1],
    ] as const) {
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
    const nets = new THREE.Mesh(
      ng,
      new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
    );
    nets.renderOrder = 1;
    this.lines.add(lines, goals, nets);
  }

  /** The frame: the pitch, the ball in flight. */
  update(f: PitchFrame | null, dt: number, shown: boolean) {
    const p = f?.pitch ?? null;
    const key = p ? `${p.x},${p.z},${p.w},${p.d},${f!.theme}` : '';
    if (key !== this.drawn) {
      if (p) this.build(p, f!.theme);
      else this.clear();
      this.drawn = key;
    }
    this.lines.visible = !!p && shown;
    const b = f?.ball ?? null;
    this.ball.visible = !!b && shown;
    if (!b) {
      this.last.set = false;
      return;
    }
    // Spun along the way it went (about the axis across the way): rolled on the ground, driven in the air.
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
    this.last.y = b.y;
    this.last.z = b.z;
    this.last.set = true;
    this.ball.position.set(b.x, R + b.y, b.z);
  }
}
