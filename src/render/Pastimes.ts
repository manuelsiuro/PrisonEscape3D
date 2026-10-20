import * as THREE from 'three';
import type { World } from '../sim/world/World';
import type { Court, Pitch } from '../content/prisons/types';

/**
 * What card sharks (P27) show this frame: the court's lit spot, the ball (up in the hands, in
 * flight, coming down), the cards on the ground between the two players, the old-timer's board.
 */
export interface PastimesFrame {
  /** The spot lit on the court (its place in the list, -1 none). */
  spot: number;
  /** A shot shown: who threw it, from where (tiles), how it went, short or long; seconds since it left the hand. */
  ball: { show: { by: number; fromX: number; fromZ: number; result: 'swish' | 'in' | 'rim' | 'air'; short: boolean; at: number }; t: number; fromY: number } | null;
  /** The ball held up for a shot (the marker 0–1: the arms dip and rise with it), the way to the rim (a unit vector: it's held a little that way). */
  holding: { who: number; power: number; dx: number; dz: number } | null;
  /** Cards between the player and the inmate: the middle, the way from the player to them, face-down cards on the pile, a call's cards face up. */
  cards: { x: number; z: number; angle: number; pile: number; reveal: number[] | null } | null;
  /** The old-timer's board between him and the player: its middle, the way from the player to him, its squares (PIECE), the last move's squares. */
  board: { x: number; z: number; angle: number; sq: number[]; last: number[] } | null;
}

/** The rim's height and radius (the decor's hoop: render/decor.ts), the board's face behind it, the ball's radius, where it's held over the head (between the hands, clear of the head: Character's SHOOT). */
const RIM_Y = 2.32;
const RIM_R = 0.2;
const BOARD_FACE = 0.2;
const BALL_R = 0.1;
const HOLD_Y = 1.45;
const HOLD_AHEAD = 0.1;
/** The ball comes to rest this long after it's let go (s; reduced motion: there at once). */
const REST_T = 2;
/** The flight's time (play/pastimes.ts FLIGHT_S) and the ground. */
const FLIGHT = 0.9;
/** The spots: a painted disc each, and the ring over the lit one. */
const SPOT_R = 0.3;
/** The spots' paint (lit like the pitch's lines, under the fog veil at renderOrder 0.5). */
const SPOT_PAINT = 0xf4f1e6;
const SPOT_OPACITY = 0.55;
/** Spots on the football pitch (P29) show only within this far of the rim (tiles; the farthest spot is 4 out), never in a match. */
const COURT_NEAR = 5.5;

/** Which of a court's spots lie on the prison's football pitch (their paint kept off it but for a game of hoops). */
export function spotsOnPitch(c: Court, p: Pitch | null | undefined): boolean[] {
  return c.spots.map((q) => !!p && q.x >= p.x && q.x < p.x + p.w && q.z >= p.z && q.z < p.z + p.d);
}
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
  /** The spots on the football pitch (P29): chalked in only near the court, out of a match. */
  private readonly pitchSpots: THREE.InstancedMesh;
  private pitchChalk = 0;
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
  /** Face-up cards of each kind this frame (refilled). */
  private readonly counts = [0, 0, 0, 0];

  constructor() {
    // (Paint lit like the pitch's lines: dim at night, under the fog veil; the lit spot's gold ring stays a bright cue.)
    const spot = new THREE.RingGeometry(SPOT_R * 0.62, SPOT_R, 24).rotateX(-Math.PI / 2);
    const paint = () => new THREE.MeshLambertMaterial({ color: SPOT_PAINT, transparent: true, opacity: SPOT_OPACITY, depthWrite: false });
    this.spots = new THREE.InstancedMesh(spot, paint(), 5);
    this.pitchSpots = new THREE.InstancedMesh(spot, paint(), 5);
    for (const s of [this.spots, this.pitchSpots]) {
      s.count = 0;
      s.frustumCulled = false;
      s.receiveShadow = true;
      s.renderOrder = 0.25;
    }
    this.pitchSpots.visible = false;
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
    // (The wooden board, and the squares on its top: two draws.)
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 0.8 });
    const top = new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.75 });
    this.board = new THREE.Mesh(new THREE.BoxGeometry(BOARD, 0.025, BOARD), wood);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(BOARD, BOARD).rotateX(-Math.PI / 2).translate(0, 0.0126, 0), top);
    face.receiveShadow = true;
    this.board.add(face);
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
    this.group.add(this.spots, this.pitchSpots, this.ring, this.ball, this.backs, ...this.faces, this.board, this.mine, this.his);
  }

  /** A prison: its court's spots painted on the ground (those on the football pitch apart). */
  setWorld(world: World, pitch: Pitch | null = world.def.leisure?.pitch ?? null) {
    this.court = world.def.leisure?.hoop ?? null;
    const c = this.court;
    const onPitch = c ? spotsOnPitch(c, pitch) : [];
    this.spots.count = this.pitchSpots.count = 0;
    c?.spots.forEach((q, k) => {
      this.p.set(q.x + 0.5, 0.012, q.z + 0.5);
      this.m.compose(this.p, this.q.identity(), this.s.set(1, 1, 1));
      const mesh = onPitch[k] ? this.pitchSpots : this.spots;
      mesh.setMatrixAt(mesh.count++, this.m);
    });
    this.spots.instanceMatrix.needsUpdate = true;
    this.pitchSpots.instanceMatrix.needsUpdate = true;
    this.pitchChalk = 0;
  }

  /**
   * The ball where a shot has it `t` seconds in: up from the hands in an arc to its end (the
   * rim's middle for a swish; its near edge for a basket off the rim or a rim-out; short of it, or
   * on the board's face for a long airball), then on with the speed it arrived with (damped by
   * what it met): down through the net, off the rim and away, back off the board, a bounce or two.
   */
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
    const long = result === 'air' && !short;
    const end = result === 'swish' ? 0 : result === 'in' || result === 'rim' ? -RIM_R * 0.7 : long ? BOARD_FACE - BALL_R : -0.7;
    const endY = result === 'air' ? (long ? RIM_Y + 0.25 : RIM_Y - 0.35) : RIM_Y + 0.03;
    const ex = rx + ux * end;
    const ez = rz + uz * end;
    // The arc: a quadratic through the hands, up past the apex, to the end.
    const ctrl = 2 * (Math.max(b.fromY, endY) + 0.9) - (b.fromY + endY) / 2;
    if (t <= FLIGHT) {
      const e = t / FLIGHT;
      out.set(fromX + (ex - fromX) * e, (1 - e) * (1 - e) * b.fromY + 2 * (1 - e) * e * ctrl + e * e * endY, fromZ + (ez - fromZ) * e);
      return;
    }
    // Its speed as it arrives (tiles a second): along the shot, and down.
    const vAlong = len / FLIGHT;
    const vDown = (2 * (endY - ctrl)) / FLIGHT;
    // Then what it meets: the net (through, slowed), the rim (up and back out), the board (back off it), nothing (on its way).
    const [vx, vz, vy] =
      result === 'swish' ? [ux * 0.1, uz * 0.1, vDown * 0.35] : result === 'in' ? [ux * 0.6, uz * 0.6, vDown * 0.3] : result === 'rim' ? [-ux * 0.9 + uz * 0.35, -uz * 0.9 - ux * 0.35, 1.2] : long ? [-ux * vAlong * 0.35, -uz * vAlong * 0.35, 0.4] : [ux * vAlong * 0.5, uz * vAlong * 0.5, vDown * 0.6];
    this.fall(ex, endY, ez, vx, vy, vz, t - FLIGHT, out);
  }

  /** A ball let go at a point with a speed (tiles a second, y up): falling, a bounce or two, rolling to rest. */
  private fall(x: number, y: number, z: number, vx: number, vy: number, vz: number, a: number, out: THREE.Vector3) {
    const g = 9;
    // (When it first meets the ground: y + vy·t − g·t²/2 = the ball's radius.)
    const tHit = (vy + Math.sqrt(vy * vy + 2 * g * Math.max(0, y - BALL_R))) / g;
    if (a < tHit) {
      out.set(x + vx * a, y + vy * a - 0.5 * g * a * a, z + vz * a);
      return;
    }
    const b2 = a - tHit;
    const up = Math.min(2.4, Math.abs(vy - g * tHit) * 0.45);
    const h = b2 < (2 * up) / g ? up * b2 - 0.5 * g * b2 * b2 : 0;
    // (Along the ground it slows to a stop.)
    const roll = 1 - Math.exp(-b2 * 1.5);
    out.set(x + vx * tHit + vx * 0.6 * roll, BALL_R + Math.max(0, h), z + vz * tHit + vz * 0.6 * roll);
  }

  /** A frame; `match`: a football match is on (P29: the pitch's paint alone then), `dt` for the chalk's fade. */
  update(f: PastimesFrame | null, px: number, pz: number, time: number, motion: boolean, ground: boolean, match = false, dt = 0) {
    const on = !!f && ground;
    this.spots.visible = ground && this.spots.count > 0;
    const c = this.court;
    // The spots on the pitch: chalked in walking up to the court (or in a game of hoops), never in a match.
    const near = on && !match && !!c && (f.spot >= 0 || !!f.ball || !!f.holding || Math.hypot(px - c.x - 0.5, pz - c.z - 0.5) <= COURT_NEAR);
    const k = motion ? Math.min(1, dt * 3) : 1;
    this.pitchChalk += ((near ? 1 : 0) - this.pitchChalk) * k;
    if (this.pitchChalk < 0.01 && !near) this.pitchChalk = 0;
    this.pitchSpots.visible = ground && this.pitchSpots.count > 0 && this.pitchChalk > 0;
    (this.pitchSpots.material as THREE.MeshLambertMaterial).opacity = SPOT_OPACITY * this.pitchChalk;
    // The lit spot: a gold ring, breathing.
    if (on && c && f.spot >= 0 && c.spots[f.spot]) {
      const q = c.spots[f.spot];
      this.ring.position.set(q.x + 0.5, 0.014, q.z + 0.5);
      const k = motion ? 1 + Math.sin(time * 4) * 0.06 : 1;
      this.ring.scale.set(k, 1, k);
      this.ring.visible = true;
    } else this.ring.visible = false;
    // The ball: in flight (or coming down), else up in the player's hands.
    if (on && c && f.ball) {
      // (Reduced motion: straight to where it comes to rest.)
      const t = f.ball.t;
      if (!motion) f.ball.t = REST_T;
      this.ballAt(f.ball, this.p);
      f.ball.t = t;
      this.ball.position.copy(this.p);
      this.ball.rotation.x = motion ? -f.ball.t * 9 : 0;
      this.ball.visible = true;
    } else if (on && f.holding) {
      // (Over the head, a little toward the rim; down at the bottom of the marker's sweep, up at the top: the knees and arms work it.)
      const h = f.holding;
      this.ball.position.set(px + h.dx * HOLD_AHEAD, HOLD_Y + h.power * 0.1, pz + h.dz * HOLD_AHEAD);
      this.ball.rotation.x = 0;
      this.ball.visible = true;
    } else this.ball.visible = false;
    // The cards: the pile face down (a little scattered), a call's cards face up in a row beside it, turned to the camera.
    const cd = on ? f.cards : null;
    let n = 0;
    const counts = this.counts;
    counts.fill(0);
    if (cd) {
      const pile = Math.min(14, cd.pile - (cd.reveal?.length ?? 0));
      for (let k = 0; k < pile; k++) {
        const j = Math.sin(k * 12.9898) * 43758.5453;
        const jx = (j - Math.floor(j) - 0.5) * 0.08;
        const jz = Math.sin(k * 7.13) * 0.5 * 0.06;
        this.p.set(cd.x + jx, 0.004 + k * 0.002, cd.z + jz - 0.06);
        this.q.setFromAxisAngle(this.yAxis, cd.angle + Math.sin(k * 3.7) * 0.5);
        this.m.compose(this.p, this.q, this.s.set(1, 1, 1));
        this.backs.setMatrixAt(n++, this.m);
      }
      const shown = cd.reveal ?? [];
      for (let k = 0; k < shown.length; k++) {
        const card = shown[k];
        const mesh = this.faces[card - 1];
        if (!mesh || counts[card - 1] >= 3) continue;
        // (On top of the pile's height, toward the camera, across the screen.)
        this.p.set(cd.x + (k - (shown.length - 1) / 2) * (CARD_W + 0.025), 0.034, cd.z + 0.14);
        this.q.identity();
        this.m.compose(this.p, this.q, this.s.set(1, 1, 1));
        mesh.setMatrixAt(counts[card - 1]++, this.m);
      }
    }
    if (n !== this.backs.count || n) {
      this.backs.count = n;
      this.backs.instanceMatrix.needsUpdate = true;
    }
    this.backs.visible = n > 0;
    for (let k = 0; k < this.faces.length; k++) {
      const mesh = this.faces[k];
      if (counts[k] !== mesh.count || counts[k]) {
        mesh.count = counts[k];
        mesh.instanceMatrix.needsUpdate = true;
      }
      mesh.visible = counts[k] > 0;
    }
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
        for (let h = 0; h < (king ? 2 : 1) && (p <= 2 ? nm : nh) < 24; h++) {
          this.p.set(x, 0.032 + h * 0.015, z);
          this.m.compose(this.p, this.q.identity(), this.s.set(1, 1, 1));
          if (p <= 2) this.mine.setMatrixAt(nm++, this.m);
          else this.his.setMatrixAt(nh++, this.m);
        }
      }
    }
    for (const [mesh, k] of [
      [this.mine, nm],
      [this.his, nh],
    ] as const) {
      if (mesh.count !== k || k) {
        mesh.count = k;
        mesh.instanceMatrix.needsUpdate = true;
      }
      mesh.visible = k > 0;
    }
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
