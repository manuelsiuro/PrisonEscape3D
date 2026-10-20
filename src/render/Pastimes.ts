import * as THREE from 'three';
import type { World } from '../sim/world/World';
import type { Court } from '../content/prisons/types';

/**
 * What card sharks (P27) show this frame: the court's lit spot, the ball (up in the hands, in
 * flight, coming down), the cards on the ground between the two players, the old-timer's board.
 */
export interface PastimesFrame {
  /** The spot lit on the court (its place in the list, -1 none). */
  spot: number;
  /** A shot shown: who threw it, from where (tiles), how it went, short or long; seconds since it left the hand. */
  ball: { show: { by: number; fromX: number; fromZ: number; result: 'swish' | 'in' | 'rim' | 'air'; short: boolean; at: number }; t: number; fromY: number } | null;
  /** The ball held up for a shot (the marker 0–1: the arms dip and rise with it). */
  holding: { who: number; power: number } | null;
  /** Cards between the player and the inmate: the middle, the way from the player to them, face-down cards on the pile, a call's cards face up. */
  cards: { x: number; z: number; angle: number; pile: number; reveal: number[] | null } | null;
  /** The old-timer's board between him and the player: its middle, the way from the player to him, its squares (PIECE), the last move's squares. */
  board: { x: number; z: number; angle: number; sq: number[]; last: number[] } | null;
}

/** The rim's height and radius (the decor's hoop: render/decor.ts), the ball's radius, where it's held over the head. */
const RIM_Y = 2.15;
const RIM_R = 0.2;
const BALL_R = 0.1;
const HOLD_Y = 1.25;
/** The flight's time (play/pastimes.ts FLIGHT_S) and the ground. */
const FLIGHT = 0.9;
/** The spots: a painted disc each, and the ring over the lit one. */
const SPOT_R = 0.3;
/** A playing card (tiles), the checkers board's side and a piece. */
const CARD_W = 0.15;
const CARD_H = 0.21;
const BOARD = 0.62;
const PIECE_R = 0.03;

/** The ball's leather: orange with dark seams. */
function ballTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8742c';
  g.fillRect(0, 0, 128, 64);
  g.strokeStyle = '#3a1d0e';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 32);
  g.lineTo(128, 32);
  g.moveTo(32, 0);
  g.lineTo(32, 64);
  g.moveTo(96, 0);
  g.lineTo(96, 64);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The cards' atlas: a back, then a King, a Queen, an Ace and a Joker (5 across). */
function cardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 96;
  const g = c.getContext('2d')!;
  const marks = ['', 'K', 'Q', 'A', '★'];
  for (let k = 0; k < 5; k++) {
    const x0 = k * 64;
    g.fillStyle = k === 0 ? '#9a2a2a' : '#f7f3e8';
    g.fillRect(x0 + 2, 2, 60, 92);
    if (k === 0) {
      g.strokeStyle = '#f2d6a0';
      g.lineWidth = 3;
      g.strokeRect(x0 + 8, 8, 48, 80);
      continue;
    }
    g.fillStyle = k === 4 ? '#7a43ab' : k === 2 ? '#c8302a' : '#1d2026';
    g.font = 'bold 40px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(marks[k], x0 + 32, 50);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A card's quad, its UVs on a cell of the atlas. */
function cardGeometry(cell: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(CARD_W, CARD_H).rotateX(-Math.PI / 2);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, (cell + uv.getX(i)) / 5);
  uv.needsUpdate = true;
  return g;
}

/** The checkers board's squares: light and dark, with a wooden rim. */
function boardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 136;
  c.height = 136;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5a3a1e';
  g.fillRect(0, 0, 136, 136);
  for (let r = 0; r < 8; r++)
    for (let k = 0; k < 8; k++) {
      g.fillStyle = (r + k) % 2 ? '#2f4a2c' : '#e9dcb8';
      g.fillRect(4 + k * 16, 4 + r * 16, 16, 16);
    }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Card sharks in the picture (P27): the court's painted spots (the lit one ringed), the ball,
 * the cards on the ground between two players, the checkers board between the player and the
 * old-timer. (The hoop is the decor's; the poses are Character's.)
 */
export class PastimesView {
  readonly group = new THREE.Group();
  private readonly spots: THREE.InstancedMesh;
  private readonly ring: THREE.Mesh;
  private readonly ball: THREE.Mesh;
  private readonly backs: THREE.InstancedMesh;
  private readonly faces: THREE.InstancedMesh[];
  private readonly board: THREE.Mesh;
  private readonly mine: THREE.InstancedMesh;
  private readonly his: THREE.InstancedMesh;
  private court: Court | null = null;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  constructor() {
    const paint = new THREE.MeshBasicMaterial({ color: 0xf4f1e6, transparent: true, opacity: 0.55, depthWrite: false });
    this.spots = new THREE.InstancedMesh(new THREE.RingGeometry(SPOT_R * 0.62, SPOT_R, 24).rotateX(-Math.PI / 2), paint, 5);
    this.spots.count = 0;
    this.spots.frustumCulled = false;
    this.spots.renderOrder = 1;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(SPOT_R * 0.9, SPOT_R * 1.25, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffc23d, transparent: true, opacity: 0.85, depthWrite: false }));
    this.ring.renderOrder = 2;
    this.ring.visible = false;
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 16, 12), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.7 }));
    this.ball.castShadow = true;
    this.ball.visible = false;
    const cards = new THREE.MeshStandardMaterial({ map: cardTexture(), roughness: 0.8 });
    this.backs = new THREE.InstancedMesh(cardGeometry(0), cards, 14);
    this.backs.count = 0;
    this.backs.frustumCulled = false;
    this.faces = [1, 2, 3, 4].map((k) => {
      const mesh = new THREE.InstancedMesh(cardGeometry(k), cards, 3);
      mesh.count = 0;
      mesh.frustumCulled = false;
      return mesh;
    });
    this.board = new THREE.Mesh(new THREE.BoxGeometry(BOARD, 0.025, BOARD), [new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 0.8 }), new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.75 }), new THREE.MeshStandardMaterial({ color: 0x5a3a1e }), new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 0.8 })]);
    this.board.castShadow = true;
    this.board.receiveShadow = true;
    this.board.visible = false;
    const piece = new THREE.CylinderGeometry(PIECE_R, PIECE_R, 0.014, 14);
    this.mine = new THREE.InstancedMesh(piece, new THREE.MeshStandardMaterial({ color: 0xf2e6c8, roughness: 0.5 }), 24);
    this.his = new THREE.InstancedMesh(piece, new THREE.MeshStandardMaterial({ color: 0xa8322a, roughness: 0.5 }), 24);
    for (const x of [this.mine, this.his]) {
      x.count = 0;
      x.frustumCulled = false;
    }
    this.group.add(this.spots, this.ring, this.ball, this.backs, ...this.faces, this.board, this.mine, this.his);
  }

  /** A prison: its court's spots painted on the ground. */
  setWorld(world: World) {
    this.court = world.def.leisure?.hoop ?? null;
    const c = this.court;
    this.spots.count = c ? c.spots.length : 0;
    c?.spots.forEach((q, k) => {
      this.p.set(q.x + 0.5, 0.012, q.z + 0.5);
      this.m.compose(this.p, this.q.identity(), this.s.set(1, 1, 1));
      this.spots.setMatrixAt(k, this.m);
    });
    this.spots.instanceMatrix.needsUpdate = true;
  }

  /** The ball where a shot has it `t` seconds in: up from the hands, the arc, then whatever its end is (through the net, off the rim, short or long), and rolling to rest. */
  private ballAt(b: NonNullable<PastimesFrame['ball']>, out: THREE.Vector3) {
    const c = this.court!;
    const { fromX, fromZ, result, short } = b.show;
    const rx = c.x + 0.5;
    const rz = c.z + 0.5;
    const dx = rx - fromX;
    const dz = rz - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const t = b.t;
    // Where the arc comes down: the rim's middle (a basket), its near edge (a rim-out, in off the rim), short or past it (an airball).
    const end = result === 'swish' ? 0 : result === 'in' || result === 'rim' ? -RIM_R * 0.8 : short ? -0.7 : 0.45;
    const endY = result === 'air' ? RIM_Y - 0.35 : RIM_Y + (result === 'swish' ? 0.02 : 0.03);
    const ex = rx + ux * end;
    const ez = rz + uz * end;
    if (t <= FLIGHT) {
      const e = t / FLIGHT;
      const apex = Math.max(b.fromY, endY) + 0.9;
      // A parabola through the hands, the apex and the end.
      const y = (1 - e) * (1 - e) * b.fromY + 2 * (1 - e) * e * (2 * apex - (b.fromY + endY) / 2) + e * e * endY;
      out.set(fromX + (ex - fromX) * e, y, fromZ + (ez - fromZ) * e);
      return;
    }
    const a = t - FLIGHT;
    // Down through the net and onto the ground under the rim, a bounce or two.
    const fall = (x: number, z: number, y0: number, vx: number, vz: number) => {
      const g = 9;
      const tHit = Math.sqrt((2 * (y0 - BALL_R)) / g);
      if (a < tHit) {
        out.set(x + vx * a, y0 - 0.5 * g * a * a, z + vz * a);
        return;
      }
      const b2 = a - tHit;
      const up = 2.2;
      const h = Math.max(0, up * b2 - 0.5 * g * b2 * b2);
      out.set(x + vx * tHit + vx * 0.5 * b2, BALL_R + (b2 < (2 * up) / g ? h : 0), z + vz * tHit + vz * 0.5 * b2);
    };
    if (result === 'swish' || result === 'in') fall(rx, rz, RIM_Y, -ux * 0.15, -uz * 0.15);
    else if (result === 'rim') fall(ex, ez, RIM_Y + 0.05, -ux * 0.9 + uz * 0.4, -uz * 0.9 - ux * 0.4);
    else fall(ex, ez, endY, short ? -ux * 0.4 : ux * -0.6, short ? -uz * 0.4 : uz * -0.6);
  }

  update(f: PastimesFrame | null, px: number, pz: number, time: number, motion: boolean, ground: boolean) {
    const on = !!f && ground;
    this.spots.visible = ground && this.spots.count > 0;
    // The lit spot: a gold ring, breathing.
    const c = this.court;
    if (on && c && f.spot >= 0 && c.spots[f.spot]) {
      const q = c.spots[f.spot];
      this.ring.position.set(q.x + 0.5, 0.014, q.z + 0.5);
      const k = motion ? 1 + Math.sin(time * 4) * 0.06 : 1;
      this.ring.scale.set(k, 1, k);
      this.ring.visible = true;
    } else this.ring.visible = false;
    // The ball: in flight (or coming down), else up in the player's hands.
    if (on && c && f.ball) {
      this.ballAt(f.ball, this.p);
      this.ball.position.copy(this.p);
      this.ball.rotation.x = motion ? -f.ball.t * 9 : 0;
      this.ball.visible = true;
    } else if (on && f.holding) {
      // (Down a little at the bottom of the marker's sweep, up at the top: the knees and arms work it.)
      this.ball.position.set(px, HOLD_Y + f.holding.power * 0.12, pz);
      this.ball.rotation.x = 0;
      this.ball.visible = true;
    } else this.ball.visible = false;
    // The cards: the pile face down (a little scattered), a call's cards face up beside it.
    const cd = on ? f.cards : null;
    let n = 0;
    const counts = [0, 0, 0, 0];
    if (cd) {
      const fx = Math.sin(cd.angle);
      const fz = Math.cos(cd.angle);
      const pile = Math.min(14, cd.pile - (cd.reveal?.length ?? 0));
      for (let k = 0; k < pile; k++) {
        const j = Math.sin(k * 12.9898) * 43758.5453;
        const jx = (j - Math.floor(j) - 0.5) * 0.08;
        const jz = (Math.sin(k * 7.13) * 0.5) * 0.06;
        // (The pile a little toward the inmate: the turned-up cards toward the player.)
        this.p.set(cd.x + jx + fx * 0.1, 0.004 + k * 0.002, cd.z + jz + fz * 0.1);
        this.q.setFromAxisAngle(this.yAxis, cd.angle + Math.sin(k * 3.7) * 0.5);
        this.m.compose(this.p, this.q, this.s.set(1, 1, 1));
        this.backs.setMatrixAt(n++, this.m);
      }
      (cd.reveal ?? []).forEach((card, k) => {
        const mesh = this.faces[card - 1];
        if (!mesh) return;
        // In a row across the line between the two (the player's right: (−fz, fx)).
        const off = (k - ((cd.reveal?.length ?? 1) - 1) / 2) * (CARD_W + 0.025);
        this.p.set(cd.x - fx * 0.12 - fz * off, 0.006, cd.z - fz * 0.12 + fx * off);
        this.q.setFromAxisAngle(this.yAxis, cd.angle);
        this.m.compose(this.p, this.q, this.s.set(1, 1, 1));
        mesh.setMatrixAt(counts[card - 1]++, this.m);
      });
    }
    this.backs.count = n;
    this.backs.visible = n > 0;
    this.backs.instanceMatrix.needsUpdate = true;
    this.faces.forEach((mesh, k) => {
      mesh.count = counts[k];
      mesh.visible = counts[k] > 0;
      mesh.instanceMatrix.needsUpdate = true;
    });
    // The board: square to the two, the player's side nearest them; the pieces on their squares (a king stacked two high).
    const b = on ? f.board : null;
    this.board.visible = !!b;
    let nm = 0;
    let nh = 0;
    if (b) {
      this.board.position.set(b.x, 0.0125, b.z);
      this.board.rotation.set(0, b.angle, 0);
      const fx = Math.sin(b.angle);
      const fz = Math.cos(b.angle);
      // (From the player's side: the far row toward the old-timer, columns left to right as the player sees them.)
      const cell = (BOARD - 0.04) / 8;
      for (let i = 0; i < 32; i++) {
        const p = b.sq[i];
        if (!p) continue;
        const r = i >> 2;
        const col = r % 2 === 0 ? 2 * (i & 3) + 1 : 2 * (i & 3);
        const along = (3.5 - r) * cell;
        const across = (col - 3.5) * cell;
        // (The player's right as they face him: (−fz, fx).)
        const x = b.x + fx * along - fz * across;
        const z = b.z + fz * along + fx * across;
        const king = p === 2 || p === 4;
        for (let h = 0; h < (king ? 2 : 1); h++) {
          this.p.set(x, 0.032 + h * 0.015, z);
          this.m.compose(this.p, this.q.identity(), this.s.set(1, 1, 1));
          if (p <= 2) this.mine.setMatrixAt(nm++, this.m);
          else this.his.setMatrixAt(nh++, this.m);
        }
      }
    }
    this.mine.count = Math.min(24, nm);
    this.his.count = Math.min(24, nh);
    this.mine.visible = nm > 0;
    this.his.visible = nh > 0;
    this.mine.instanceMatrix.needsUpdate = true;
    this.his.instanceMatrix.needsUpdate = true;
  }

  /** Shown for a moment while the renderer compiles their shaders (a new game), then hidden again. */
  warm(on: boolean) {
    this.ball.visible = on;
    this.board.visible = on;
    this.backs.visible = on;
    this.backs.count = on ? 1 : 0;
    this.mine.visible = this.his.visible = on;
    this.mine.count = this.his.count = on ? 1 : 0;
    for (const f of this.faces) {
      f.visible = on;
      f.count = on ? 1 : 0;
    }
    this.ring.visible = on;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats as THREE.MeshStandardMaterial[]) {
        mat.map?.dispose();
        mat.dispose();
      }
    });
  }
}
