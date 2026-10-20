import * as THREE from 'three';
import type { Pitch } from '../content/prisons/types';
import { BALL_R, GOAL_HALF } from '../content/team';
import { UNIT } from '../sim/tuning';
import { box, cyl, merge } from './kit';

/**
 * What yard football (P29) shows: the pitch painted on the yard (its lines, the halfway line and
 * circle, a box before each goal), the two goals (posts, crossbar and a net) and the ball while a
 * match is on, rolling as it goes.
 */
export interface TeamFrame {
  /** The prison's pitch (null: none). */
  pitch: Pitch | null;
  /** The ball where it is between steps (tiles), null no match; on the move. */
  ball: { x: number; z: number; moving: boolean } | null;
}

const PAINT = 0xf2f0e6;
const POST = 0xf4f4ef;
const R = BALL_R / UNIT;

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
  const g = new THREE.IcosahedronGeometry(R, 2).toNonIndexed();
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
  private drawn = '';
  private last: { x: number; z: number } | null = null;
  private readonly axis = new THREE.Vector3();

  constructor() {
    this.ball = new THREE.Mesh(ballGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
    this.ball.castShadow = true;
    this.ball.visible = false;
    this.group.add(this.lines, this.ball);
  }

  /** The pitch's paint and goals, built once per map. */
  private build(p: Pitch) {
    for (const c of this.lines.children) {
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.lines.clear();
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
    /** A painted strip: centred at (a, l), da long and dl across. */
    const strip = (a: number, l: number, da: number, dl: number) => (along ? box(da, 0.004, dl, PAINT, a, 0, l) : box(dl, 0.004, da, PAINT, l, 0, a));
    const parts = [
      strip(ca, l0 + W / 2 + 0.04, len, W),
      strip(ca, l1 - W / 2 - 0.04, len, W),
      strip(a0 + W / 2, cl, W, wid - 0.08),
      strip(a1 - W / 2, cl, W, wid - 0.08),
      strip(ca, cl, W, wid - 0.08),
    ];
    // Boxes before the goals: a tile and a half deep, the mouth and a half-tile either side.
    const half = GOAL_HALF / UNIT + 0.5;
    const deep = 1.4;
    for (const [end, dir] of [[a0, 1], [a1, -1]] as const) {
      parts.push(strip(end + (dir * deep) / 2, mid - half, deep, W), strip(end + (dir * deep) / 2, mid + half, deep, W), strip(end + dir * deep, mid, W, half * 2 + W));
    }
    const paint = merge(parts, false);
    // The halfway circle.
    const ring = new THREE.RingGeometry(Math.min(1.1, wid / 2 - 0.4), Math.min(1.1, wid / 2 - 0.4) + W, 40);
    ring.rotateX(-Math.PI / 2);
    ring.translate(along ? ca : cl, 0.004, along ? cl : ca);
    const lineMat = new THREE.MeshLambertMaterial({ color: PAINT, transparent: true, opacity: 0.8, depthWrite: false });
    const paintMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false });
    const lines = new THREE.Mesh(paint, paintMat);
    const circle = new THREE.Mesh(ring, lineMat);
    for (const m of [lines, circle]) {
      m.position.y = 0.006;
      m.renderOrder = 0.2;
      m.receiveShadow = true;
      this.lines.add(m);
    }
    // The goals: posts and a crossbar on the goal line, the net behind them.
    const gh = GOAL_HALF / UNIT;
    const H = 0.78;
    const D = 0.7;
    for (const [end, dir] of [[a0, -1], [a1, 1]] as const) {
      const frame: THREE.BufferGeometry[] = [];
      const at = (a: number, l: number): [number, number] => (along ? [a, l] : [l, a]);
      for (const s of [-1, 1]) {
        const [x, z] = at(end, mid + s * gh);
        frame.push(cyl(0.035, H, POST, x, 0, z, 8));
        // (The back stays of the net's frame.)
        const [bx, bz] = at(end + dir * D, mid + s * gh);
        frame.push(cyl(0.02, H * 0.6, 0x9aa2ad, bx, 0, bz, 6));
      }
      const [cx, cz] = at(end, mid);
      frame.push(along ? box(0.07, 0.07, gh * 2 + 0.07, POST, cx, H - 0.035, cz) : box(gh * 2 + 0.07, 0.07, 0.07, POST, cx, H - 0.035, cz));
      const goal = new THREE.Mesh(merge(frame), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.2 }));
      goal.castShadow = true;
      this.lines.add(goal);
      // The net: its back, its roof sloping down to it, its sides (see-through).
      const net = new THREE.Group();
      const netMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
      const back = new THREE.PlaneGeometry(gh * 2, H * 0.6);
      const roof = new THREE.PlaneGeometry(gh * 2, Math.hypot(D, H * 0.4));
      const side = new THREE.BufferGeometry();
      // (A side: the post's top, its foot, the back stay's foot and top.)
      const sv = (s: number) => {
        const p = [
          [end, H, mid + s * gh],
          [end, 0, mid + s * gh],
          [end + dir * D, 0, mid + s * gh],
          [end + dir * D, H * 0.6, mid + s * gh],
        ].map(([a, y, l]) => (along ? [a, y, l] : [l, y, a]));
        return [...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]];
      };
      side.setAttribute('position', new THREE.Float32BufferAttribute([...sv(-1), ...sv(1)], 3));
      const mb = new THREE.Mesh(back, netMat);
      const mr = new THREE.Mesh(roof, netMat);
      const ms = new THREE.Mesh(side, netMat);
      // Turned to face along the field.
      const [bx, bz] = at(end + dir * D, mid);
      mb.position.set(bx, (H * 0.6) / 2, bz);
      mb.rotation.y = along ? Math.PI / 2 : 0;
      const [rx, rz] = at(end + (dir * D) / 2, mid);
      mr.position.set(rx, H * 0.8, rz);
      const tilt = Math.atan2(H * 0.4, D);
      if (along) {
        mr.rotation.set(0, Math.PI / 2, 0);
        mr.rotateX(-Math.PI / 2 + dir * tilt);
      } else mr.rotation.set(-Math.PI / 2 - dir * tilt, 0, 0);
      net.add(mb, mr, ms);
      for (const m of [mb, mr, ms]) m.renderOrder = 1;
      this.lines.add(net);
    }
  }

  update(f: TeamFrame | null, dt: number, onGround: boolean) {
    const p = f?.pitch ?? null;
    const key = p ? `${p.x},${p.z},${p.w},${p.d}` : '';
    if (key !== this.drawn) {
      this.drawn = key;
      if (p) this.build(p);
      else this.lines.clear();
    }
    this.lines.visible = !!p && onGround;
    const b = f?.ball ?? null;
    this.ball.visible = !!b && onGround;
    if (!b) {
      this.last = null;
      return;
    }
    // Rolled along the way it went (its spin about the axis across the way).
    if (this.last && dt > 0) {
      const dx = b.x - this.last.x;
      const dz = b.z - this.last.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4 && d < 2) {
        this.axis.set(dz / d, 0, -dx / d);
        this.ball.rotateOnWorldAxis(this.axis, d / R);
      }
    }
    this.last = { x: b.x, z: b.z };
    this.ball.position.set(b.x, R, b.z);
  }
}
