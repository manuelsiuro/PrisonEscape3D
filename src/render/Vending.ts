import * as THREE from 'three';
import { GOODS } from '../content/vending';
import type { World } from '../sim/world/World';
import { canvasTexture } from './canvas';
import { now, type Later } from './batch';
import { box, kitMaterial, merge, type Part } from './kit';
import { glowTexture } from './lights';
import { seeThrough } from './occlusion';

/** What the vending machine (2.32) shows this frame. */
export interface VendFrame {
  /** Lit: it has power. */
  on: boolean;
  /** How many each row has left; the row turning (-1 none) and how far (0–1); something stuck (-1 none). */
  left: readonly number[];
  coil: number;
  turn: number;
  jam: number;
  /** Bumped by each thump. */
  thumps: number;
}

/** The goods' colours on the shelves, by row. */
const COLORS: readonly number[] = [0x6b3d22, 0xd8342c, 0xf1e6d2, 0xe8b52c, 0xffffff, 0xf6c6d8, 0xf4f0e6];
const LABELS: readonly number[] = [0xd23f36, 0xe8e8ea, 0x4a2c17, 0xc0392b, 0x3a6fd8, 0xe8a9c0, 0x8fb8e8];
/** The front of the cabinet (z, from the tile's middle), the window's size and where it sits. */
const FRONT = 0.285;
const SHELF_X = [-0.3, -0.1, 0.1];
const SHELF_Y = [1.15, 0.86, 0.57];
const SHAKE_SECS = 0.26;

/**
 * The vending machine's front, up close to the camera: a lit window with its shelves of goods, as many as are left in
 * each row, the sign over it, the money slot and keypad, the flap at the bottom. A row turning pushes its front one
 * out and it drops; a thump shakes the whole thing; a power cut puts it all out. The cabinet is the prop's. Reduced
 * motion: the goods just go, nothing shakes.
 */
export class VendingView {
  readonly group = new THREE.Group();
  private readonly lit = seeThrough(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  private readonly goodsMat = seeThrough(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  private readonly glassMat = seeThrough(new THREE.MeshBasicMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0.14, depthWrite: false, toneMapped: false }));
  private readonly dark = seeThrough(kitMaterial.clone());
  private readonly signMat = seeThrough(new THREE.MeshBasicMaterial({ map: signTexture(), toneMapped: false }));
  private readonly ledMat = seeThrough(new THREE.MeshBasicMaterial({ color: 0x38e07a, toneMapped: false }));
  private readonly poolMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xfff0c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  private body: THREE.Group | null = null;
  /** Each row's goods, front first. */
  private rows: THREE.Mesh[][] = [];
  private dropping: THREE.Mesh | null = null;
  private restX = 0;
  private shake = 0;
  private thumps = -1;

  /** The machine of a prison, if it has one. */
  setWorld(world: World, later: Later = now) {
    this.clear();
    const def = world.def.vending;
    const prop = def && world.props.find((p) => p.kind === 'vending' && p.x === def.x && p.z === def.z);
    if (!prop) return;
    later(() => this.build(prop.x + 0.5, prop.z + 0.5));
  }

  private build(x: number, z: number) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    this.restX = x;
    // The lit back of the window and its shelf edges.
    const back: Part[] = [box(0.66, 1.0, 0.01, 0xfff3c4, -0.1, 0.46, FRONT + 0.002)];
    for (const y of SHELF_Y) back.push(box(0.66, 0.02, 0.05, 0xc8ccd2, -0.1, y - 0.015, FRONT));
    g.add(new THREE.Mesh(merge(back, false), this.lit));
    // The goods, as many as a row can hold; each drawn or not as the stock has it.
    this.rows = GOODS.map((good, k) => {
      const col = k % 3;
      const row = Math.floor(k / 3);
      const n = Math.min(5, good.stock + 1);
      const list: THREE.Mesh[] = [];
      for (let j = 0; j < n; j++) {
        const geom = merge([box(0.13, 0.17, 0.05, COLORS[k], 0, 0, 0), box(0.13, 0.05, 0.051, LABELS[k], 0, 0.06, 0)], false);
        const m = new THREE.Mesh(geom, this.goodsMat);
        // (Stood one behind the next along the coil, so that the front one reads.)
        m.position.set(SHELF_X[col], SHELF_Y[row], FRONT + 0.02 - j * 0.012);
        g.add(m);
        list.push(m);
      }
      return list;
    });
    // The glass, the keypad's panel, the flap, the sign.
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 1.02), this.glassMat);
    glass.position.set(-0.1, 0.97, FRONT + 0.075);
    g.add(glass);
    const panel: Part[] = [
      box(0.17, 1.0, 0.03, 0x2b3038, 0.325, 0.46, FRONT + 0.0),
      box(0.13, 0.08, 0.01, 0x10141a, 0.325, 1.22, FRONT + 0.02),
      box(0.07, 0.03, 0.01, 0xd8b04a, 0.325, 1.1, FRONT + 0.02),
      box(0.58, 0.2, 0.03, 0x1b1e24, -0.1, 0.1, FRONT + 0.0),
      box(0.48, 0.11, 0.01, 0x0b0d10, -0.1, 0.14, FRONT + 0.02),
      box(0.3, 0.02, 0.012, 0x8d949e, -0.1, 0.22, FRONT + 0.025),
    ];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) panel.push(box(0.03, 0.03, 0.01, 0xd9dde3, 0.285 + c * 0.04, 0.68 + r * 0.05, FRONT + 0.02));
    g.add(new THREE.Mesh(merge(panel), this.dark));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.15), this.signMat);
    sign.position.set(0, 1.545, FRONT + 0.012);
    g.add(sign);
    const led = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.04), this.ledMat);
    led.position.set(0.325, 1.22, FRONT + 0.027);
    g.add(led);
    // Its glow on the floor, after dark.
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.8), this.poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.02, 0.9);
    g.add(pool);
    g.traverse((o) => {
      if (o !== pool && o !== glass) (o as THREE.Mesh).castShadow = false;
    });
    this.body = g;
    this.group.add(g);
  }

  update(f: VendFrame | null, dt: number, time: number, motion: boolean, night: number, shown: boolean) {
    this.group.visible = shown && !!this.body;
    const g = this.body;
    if (!g) return;
    const on = f?.on ?? true;
    const level = on ? 1 : 0.1;
    this.lit.color.setScalar(level);
    this.goodsMat.color.setScalar(on ? 1 : 0.22);
    this.signMat.color.setScalar(on ? 1 : 0.14);
    this.poolMat.opacity = on ? 0.32 * night : 0;
    // Its little light: green; red with something stuck, blinking; out without power.
    const jam = (f?.jam ?? -1) >= 0;
    this.ledMat.color.setHex(!on ? 0x101214 : jam ? ((motion ? time % 0.6 < 0.3 : true) ? 0xff3b30 : 0x401010) : 0x38e07a);
    const left = f?.left ?? GOODS.map((q) => q.stock);
    this.rows.forEach((list, k) => {
      const n = left[k] ?? 0;
      // (A row turning has already taken its front one out of the count: drawn here as it drops.)
      list.forEach((m, j) => (m.visible = j < n));
    });
    // What's coming down: pushed off the shelf, then falling to the flap.
    const coil = f?.coil ?? -1;
    if (coil >= 0 && motion && this.rows[coil]) {
      const m = (this.dropping ??= new THREE.Mesh(this.rows[coil][0].geometry, this.goodsMat));
      m.geometry = this.rows[coil][0].geometry;
      if (!m.parent) g.add(m);
      const t = f?.turn ?? 0;
      const fall = Math.max(0, (t - 0.7) / 0.3);
      const y0 = SHELF_Y[Math.floor(coil / 3)];
      m.visible = true;
      m.position.set(SHELF_X[coil % 3], y0 - (y0 - 0.14) * fall * fall, FRONT + 0.02 + Math.min(1, t / 0.7) * 0.04);
      m.rotation.x = fall * 1.1;
    } else if (this.dropping) this.dropping.visible = false;
    // A thump shakes it, a moment.
    const th = f?.thumps ?? 0;
    if (this.thumps >= 0 && th !== this.thumps) this.shake = SHAKE_SECS;
    this.thumps = th;
    this.shake = Math.max(0, this.shake - dt);
    g.position.x = this.restX + (motion && this.shake > 0 ? Math.sin(time * 70) * 0.025 * (this.shake / SHAKE_SECS) : 0);
  }

  clear() {
    // (Every geometry here is its own; the materials stay for the next prison.)
    this.group.traverse((m) => (m as THREE.Mesh).geometry?.dispose());
    this.group.clear();
    this.body = null;
    this.rows = [];
    this.dropping = null;
    this.thumps = -1;
  }
}

/** The sign across its top. */
function signTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 46;
  const c = canvas.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, 0, 46);
  g.addColorStop(0, '#ff5a48');
  g.addColorStop(1, '#c62a22');
  c.fillStyle = g;
  c.fillRect(0, 0, 256, 46);
  c.fillStyle = '#fff6d8';
  c.font = '900 34px system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('SNAX', 128, 25);
  return canvasTexture(canvas, 'sharp');
}
