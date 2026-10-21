import { zoneIndex } from '../content/zones';
import * as THREE from 'three';
import type { World } from '../sim/world/World';
import { DECOR } from '../content/decor';
import { LAYER, MAP_H, MAP_W } from '../sim/world/World';
import { TILE, TILE_INFO } from '../sim/world/tiles';
import { now, type Later } from './batch';
import { onTrack } from '../content/grounds';

/** What the side games show this frame (P22). */
export interface GamesFrame {
  /** An arm-wrestle: the inmate (index), how it's going for the player (−1 losing … 1 winning), the inmate surging. */
  bout: { who: number; strain: number; surge: boolean } | null;
  /**
   * Dice on the ground between the player and the inmate (`x`, `z`), each pair thrown from a
   * hand (`fromX`, `fromZ` the player's, the inmate's at `oppX`, `oppZ`): the faces (0: that pair
   * not thrown yet), seconds since each die left the hand (the player's two, then the inmate's;
   * negative: not yet).
   */
  dice: { who: number; x: number; z: number; fromX: number; fromZ: number; oppX: number; oppZ: number; mine: [number, number]; theirs: [number, number]; t: [number, number, number, number]; seed: number } | null;
  /** Taps at a lock and throws of the dice so far (the arm twitches at each new one). */
  taps: number;
  /** Sports day: bunting strung over the yard. */
  sports: boolean;
  /** The lock being picked: its door tile's middle (the player leans in to it), null none. */
  lock: { x: number; z: number } | null;
}

/** How long a die takes from the hand to rest. */
const FLIGHT = 0.55;
/** Where a die leaves the hand: ahead of the thrower, to its right, this high (tiles). */
const HAND_AHEAD = 0.5;
const HAND_SIDE = 0.29;
const HAND_Y = 0.6;
/** A die's size (a tile is 1). */
const DIE = 0.17;
/** Pennants on the bunting at most, and its poles. */
const MAX_FLAGS = 320;
const MAX_POLES = 40;
/** The longest a stretch of bunting hangs between two poles (tiles): longer runs get poles along them. */
const SPAN = 14;
/** How high a pole stands (tiles), and the shortest stretch of open yard worth a line. */
const POLE_H = 2.6;
const STRETCH = 5;
/** Bunting's colours (bright, cheerful; none of them a guard's navy). */
const FLAGS = [0xff5f6d, 0xffc145, 0x3fc79a, 0x5fa8e8, 0xa77bff, 0xff9ec7, 0xf2701c, 0xf4f4ef];

/** The atlas: faces 1–6 in a 3 × 2 grid (white with dark pips, the one red). */
function diceTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = 256;
  const g = c.getContext('2d')!;
  const pips: Record<number, Array<[number, number]>> = {
    1: [[0.5, 0.5]],
    2: [[0.27, 0.27], [0.73, 0.73]],
    3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
    4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
    5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
    6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
  };
  for (let n = 1; n <= 6; n++) {
    const x0 = ((n - 1) % 3) * 128;
    const y0 = Math.floor((n - 1) / 3) * 128;
    g.fillStyle = '#f6f3ea';
    g.fillRect(x0, y0, 128, 128);
    // A soft edge so the cube reads rounded.
    g.strokeStyle = 'rgba(120,110,90,0.35)';
    g.lineWidth = 8;
    g.strokeRect(x0 + 4, y0 + 4, 120, 120);
    g.fillStyle = n === 1 ? '#c8302a' : '#1d2026';
    for (const [px, py] of pips[n]) {
      g.beginPath();
      g.arc(x0 + px * 128, y0 + py * 128, n === 1 ? 17 : 12, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** The faces of the box (+x, −x, +y, −y, +z, −z) show these numbers (opposite faces add up to 7). */
const FACE_OF = [3, 4, 1, 6, 2, 5];

/** A die: a cube whose six faces map into the atlas. */
function dieGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(DIE, DIE, DIE);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let face = 0; face < 6; face++) {
    const n = FACE_OF[face];
    const u0 = ((n - 1) % 3) / 3;
    const v0 = 1 - (Math.floor((n - 1) / 3) + 1) / 2;
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      uv.setXY(i, u0 + uv.getX(i) / 3, v0 + uv.getY(i) / 2);
    }
  }
  uv.needsUpdate = true;
  return g;
}

/** The turn that puts a number on top. */
const UP: THREE.Quaternion[] = (() => {
  const x = new THREE.Vector3(1, 0, 0);
  const z = new THREE.Vector3(0, 0, 1);
  const q = (axis: THREE.Vector3, a: number) => new THREE.Quaternion().setFromAxisAngle(axis, a);
  return [new THREE.Quaternion(), new THREE.Quaternion(), q(x, -Math.PI / 2), q(z, Math.PI / 2), q(z, -Math.PI / 2), q(x, Math.PI / 2), q(x, Math.PI)];
})();

/** A number in [0, 1) for a die's scatter (the same each frame). */
const jit = (seed: number, k: number) => (Math.abs(Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1);

/**
 * The side games in the picture (P22): the dice thrown between the player and the inmate,
 * tumbling from the hand to rest on the faces the sim threw; sports day's bunting over the yard.
 * (The arm-wrestle and the lockpick are poses: Character.)
 */
export class GamesView {
  readonly group = new THREE.Group();
  private readonly dice: THREE.InstancedMesh;
  private readonly flags: THREE.InstancedMesh;
  private readonly poles: THREE.InstancedMesh;
  private strings: THREE.LineSegments | null = null;
  private flagCount = 0;
  /** Where each pennant hangs (x, y, z, its heading), and its sway's phase. */
  private flagAt = new Float32Array(0);
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly axis = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.dice = new THREE.InstancedMesh(dieGeometry(), new THREE.MeshStandardMaterial({ map: diceTexture(), roughness: 0.45 }), 4);
    this.dice.count = 0;
    this.dice.frustumCulled = false;
    this.dice.castShadow = true;
    const tri = new THREE.BufferGeometry();
    // A pennant hanging from its top edge (along x), pointing down.
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.13, 0, 0, 0.13, 0, 0, 0, -0.3, 0], 3));
    tri.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    this.flags = new THREE.InstancedMesh(tri, new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide }), MAX_FLAGS);
    this.flags.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLAGS * 3), 3);
    this.flags.count = 0;
    this.flags.frustumCulled = false;
    this.flags.visible = false;
    this.poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.05, POLE_H, 6), new THREE.MeshStandardMaterial({ color: 0x6a5a48, roughness: 0.8 }), MAX_POLES);
    this.poles.count = 0;
    this.poles.frustumCulled = false;
    this.poles.castShadow = true;
    this.poles.visible = false;
    this.dice.receiveShadow = true;
    this.group.add(this.dice, this.flags, this.poles);
  }

  /**
   * A prison: bunting strung over its yard under open sky only (never through a roof, a tree, a
   * flagpole or a bush): the longest stretches of open yard (at least STRETCH), a line from a pole
   * to a pole each, sagging between them, its pennants a palm apart.
   */
  setWorld(world: World, later: Later = now) {
    const strings = this.strings;
    if (strings) {
      this.group.remove(strings);
      later(() => {
        strings.geometry.dispose();
        (strings.material as THREE.Material).dispose();
      });
      this.strings = null;
    }
    this.flagCount = 0;
    this.poles.count = 0;
    const roof = world.layers[LAYER.ROOF].kind;
    // Open yard: the yard's floor with nothing overhead, a tile and a bit from any tree or
    // flagpole, a step from anything else standing there (a bush, a hoop: no pole in it).
    const decor = (world.def.decor ?? []).filter((d) => !DECOR[d.kind].wall);
    // (P31: over the sports ground where there is one, the games' place.)
    const over = world.ground.zone.includes(zoneIndex('sports')) ? 'sports' : 'yard';
    const open = (x: number, z: number) => {
      if (!world.inside(x, z) || world.zoneAt(x, z) !== over) return false;
      const i = z * MAP_W + x;
      if (TILE_INFO[world.ground.kind[i]].solid || world.propSolid[i] || roof[i] !== TILE.EMPTY) return false;
      return !decor.some((d) => {
        const r = d.kind === 'tree' || d.kind === 'flagpole' ? 1.4 : 1;
        return x + 0.5 > d.x - r + 0.5 && x + 0.5 < d.x + (d.w ?? 1) + r - 0.5 && z + 0.5 > d.z - r + 0.5 && z + 0.5 < d.z + (d.d ?? 1) + r - 0.5;
      });
    };
    // (P32 review: a pole never on the pitch or the track's lanes, where the games are played, nor in a doorway's mouth.)
    const lei = world.def.leisure;
    const poleOK = (x: number, z: number) => {
      const pt = over === 'sports' ? lei?.pitch : null;
      if (pt && x >= pt.x && x < pt.x + pt.w && z >= pt.z && z < pt.z + pt.d) return false;
      if (over === 'sports' && lei?.track && onTrack(lei.track, x, z)) return false;
      return ![-1, 1, -MAP_W, MAP_W].some((d) => world.ground.kind[z * MAP_W + x + d] === TILE.DOOR);
    };
    const poleAt = (along: boolean, c: number, a: number) => poleOK(along ? Math.floor(a) : c, along ? c : Math.floor(a));
    // Every row and column's stretches of open yard; the best strung (long, near the middle), then
    // the next best running the same way at least 3 tiles off it (two lines at most: more would hide the yard's
    // people from the steep camera).
    const runs: Array<{ along: boolean; c: number; a0: number; a1: number }> = [];
    for (const along of [true, false])
      for (let c = 0; c < (along ? MAP_H : MAP_W); c++) {
        let run = -1;
        for (let a = 0; a <= (along ? MAP_W : MAP_H); a++) {
          const ok = a < (along ? MAP_W : MAP_H) && open(along ? a : c, along ? c : a);
          if (ok && run < 0) run = a;
          if (ok || run < 0) continue;
          // (Its ends drawn in to where a pole may stand.)
          let a0 = run;
          let a1 = a;
          while (a0 < a1 && !poleAt(along, c, a0 + 0.3)) a0++;
          while (a1 > a0 && !poleAt(along, c, a1 - 0.3)) a1--;
          if (a1 - a0 >= STRETCH) runs.push({ along, c, a0, a1 });
          run = -1;
        }
      }
    // (Long enough is long enough: then the nearer the middle of the open yard, where the games are, the better.)
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (let z = 0; z < MAP_H; z++)
      for (let x = 0; x < MAP_W; x++)
        if (open(x, z)) {
          sx += x;
          sz += z;
          n++;
        }
    const cx = sx / Math.max(1, n);
    const cz = sz / Math.max(1, n);
    const score = (r: (typeof runs)[number]) => {
      const mid = (r.a0 + r.a1) / 2;
      // (Strung along x it faces the camera; along z its pennants are seen edge on.)
      return Math.min(r.a1 - r.a0, 20) + (r.along ? 3 : 0) - 0.6 * (r.along ? Math.hypot(mid - cx, r.c - cz) : Math.hypot(r.c - cx, mid - cz));
    };
    runs.sort((p, q) => score(q) - score(p) || p.c - q.c);
    const chosen: typeof runs = [];
    for (const r of runs) {
      if (chosen.length >= 2) break;
      const first = chosen[0];
      if (first && (first.along !== r.along || Math.abs(first.c - r.c) < 3)) continue;
      chosen.push(r);
    }
    const at: number[] = [];
    const seg: number[] = [];
    const poles: number[] = [];
    const color = new THREE.Color();
    chosen.forEach((r, l) => {
      // (A long run: a pole every SPAN tiles or so, each span sagging on its own.)
      const a0 = r.a0 + 0.3;
      const a1 = r.a1 - 0.3;
      // (The poles between spans moved, a tile or two at most, off where a pole mayn't stand; one long span if they can't be.)
      const spans = Math.ceil((a1 - a0) / SPAN);
      const stops = [a0];
      for (let k = 1; k < spans; k++) {
        const want = a0 + ((a1 - a0) * k) / spans;
        const near = [0, 1, -1, 2, -2, 3, -3].map((d) => want + d).find((a) => a > stops[stops.length - 1] + 2 && a < a1 - 2 && poleAt(r.along, r.c, a));
        if (near !== undefined) stops.push(near);
      }
      stops.push(a1);
      for (let k = 0; k + 1 < stops.length; k++) this.string(r.along, r.c + 0.5, stops[k], stops[k + 1], l * 5 + k, at, seg, poles, color);
    });
    this.flagAt = new Float32Array(at);
    this.flagCount = Math.min(MAX_FLAGS, at.length / 5);
    this.flags.instanceColor!.needsUpdate = true;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    this.strings = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2b3038 }));
    this.strings.visible = false;
    this.group.add(this.strings);
    // The poles at each end (one where two spans meet).
    let count = 0;
    for (let k = 0; k < poles.length / 2 && count < MAX_POLES; k++) {
      const x = poles[k * 2];
      const z = poles[k * 2 + 1];
      let twin = false;
      for (let j = 0; j < k && !twin; j++) twin = Math.abs(poles[j * 2] - x) < 0.01 && Math.abs(poles[j * 2 + 1] - z) < 0.01;
      if (twin) continue;
      this.p.set(x, POLE_H / 2, z);
      this.m.compose(this.p, this.q.identity(), this.s.set(1, 1, 1));
      this.poles.setMatrixAt(count++, this.m);
    }
    this.poles.count = count;
    this.poles.instanceMatrix.needsUpdate = true;
    this.placeFlags(0, false);
  }

  /** One line of bunting along x (or z), across at `c`, from pole `a0` to pole `a1`: its sag, its pennants, its poles. */
  private string(along: boolean, c: number, a0: number, a1: number, l: number, at: number[], seg: number[], poles: number[], color: THREE.Color) {
    const len = a1 - a0;
    const sag = Math.min(0.6, len * 0.05);
    const n = Math.max(2, Math.floor(len / 0.42));
    const point = (u: number) => {
      const a = a0 + u * len;
      return [along ? a : c, POLE_H - 0.05 - sag * 4 * u * (1 - u), along ? c : a] as const;
    };
    let prev = point(0);
    for (let k = 1; k <= n; k++) {
      const p = point(k / n);
      seg.push(prev[0], prev[1], prev[2], p[0], p[1], p[2]);
      prev = p;
    }
    for (let k = 0; k < n && at.length / 5 < MAX_FLAGS; k++) {
      const m = point((k + 0.5) / n);
      at.push(m[0], m[1], m[2], along ? 0 : Math.PI / 2, (l * 7 + k) * 0.7);
      this.flags.setColorAt(at.length / 5 - 1, color.setHex(FLAGS[(k + l * 3) % FLAGS.length]));
    }
    const [ax, , az] = point(0);
    const [bx, , bz] = point(1);
    poles.push(ax, az, bx, bz);
  }

  /** The pennants where they hang, swaying a little in the breeze. */
  private placeFlags(time: number, motion: boolean) {
    const a = this.flagAt;
    for (let k = 0; k < this.flagCount; k++) {
      const sway = motion ? Math.sin(time * 2.2 + a[k * 5 + 4]) * 0.28 : 0.1;
      this.p.set(a[k * 5], a[k * 5 + 1], a[k * 5 + 2]);
      this.q.setFromAxisAngle(this.yAxis, a[k * 5 + 3]);
      this.axis.set(1, 0, 0).applyQuaternion(this.q);
      this.q2.setFromAxisAngle(this.axis, sway);
      this.q.premultiply(this.q2);
      this.m.compose(this.p, this.q, this.s);
      this.flags.setMatrixAt(k, this.m);
    }
    this.flags.count = this.flagCount;
    this.flags.instanceMatrix.needsUpdate = true;
  }

  update(f: GamesFrame | null, time: number, motion: boolean, ground: boolean) {
    // Sports day: the bunting, seen from the ground floor and the roofs.
    const bunting = !!f?.sports && ground && this.flagCount > 0;
    this.flags.visible = bunting;
    this.poles.visible = bunting && this.poles.count > 0;
    if (this.strings) this.strings.visible = bunting;
    if (bunting && motion) this.placeFlags(time, true);
    // The dice.
    const d = f?.dice;
    let n = 0;
    if (d && ground) {
      for (let k = 0; k < 4; k++) {
        const mine = k < 2;
        const face = mine ? d.mine[k] : d.theirs[k - 2];
        const t = d.t[k];
        if (!face || t < 0) continue;
        // Where it comes to rest: either side of the middle (each pair a little toward its thrower,
        // clear of the reaching hands), from the thrower's hand (forward of the body, on its right).
        const len = Math.hypot(d.oppX - d.fromX, d.oppZ - d.fromZ) || 1;
        const fx = (d.oppX - d.fromX) / len;
        const fz = (d.oppZ - d.fromZ) / len;
        const off = (k % 2 === 0 ? -1 : 1) * (0.13 + jit(d.seed, k) * 0.05);
        const toward = (mine ? -0.13 : 0.13) + (jit(d.seed, k + 4) - 0.5) * 0.05;
        // (Along the camera's depth the throwers' backs would hide them: a little to the side.)
        const cx = d.x + (Math.abs(fz) > Math.abs(fx) ? 0.3 : 0);
        const rx = cx + fz * off + fx * toward;
        const rz = d.z - fx * off + fz * toward;
        // (A body's right, the throwing hand's side: the player's (fz, −fx), the inmate's the opposite.)
        const sgn = mine ? 1 : -1;
        const hx = (mine ? d.fromX : d.oppX) + sgn * (fx * HAND_AHEAD + fz * HAND_SIDE);
        const hz = (mine ? d.fromZ : d.oppZ) + sgn * (fz * HAND_AHEAD - fx * HAND_SIDE);
        const e = motion ? Math.min(1, t / FLIGHT) : 1;
        // From the hand in an arc, a little bounce at the end.
        const arc = Math.sin(Math.min(1, e / 0.8) * Math.PI) * 0.28 + (e > 0.8 ? Math.sin(((e - 0.8) / 0.2) * Math.PI) * 0.05 : 0);
        const h = (HAND_Y - DIE / 2) * (1 - Math.min(1, e / 0.8));
        this.p.set(hx + (rx - hx) * Math.min(1, e / 0.8), DIE / 2 + arc + h, hz + (rz - hz) * Math.min(1, e / 0.8));
        // Tumbling, settling onto its face (the last turn about the upright is its own).
        this.q.copy(UP[face]);
        this.q2.setFromAxisAngle(this.yAxis, jit(d.seed, k + 8) * Math.PI * 2);
        this.q.premultiply(this.q2);
        if (e < 1) {
          this.axis.set(jit(d.seed, k + 12) - 0.5, 0.3, jit(d.seed, k + 16) - 0.5).normalize();
          this.q2.setFromAxisAngle(this.axis, (1 - e) * (1 - e) * 14);
          this.q.premultiply(this.q2);
        }
        this.m.compose(this.p, this.q, this.s);
        this.dice.setMatrixAt(n++, this.m);
      }
    }
    this.dice.count = n;
    this.dice.visible = n > 0;
    if (n) this.dice.instanceMatrix.needsUpdate = true;
  }

  /** Shown for a moment while the renderer compiles their shaders (a new game), then hidden again. */
  warm(on: boolean) {
    this.dice.visible = on;
    this.dice.count = on ? 1 : 0;
    this.flags.visible = on && this.flagCount > 0;
    this.poles.visible = on && this.poles.count > 0;
    if (this.strings) this.strings.visible = on;
  }

  dispose() {
    this.dice.geometry.dispose();
    const dm = this.dice.material as THREE.MeshStandardMaterial;
    dm.map?.dispose();
    dm.dispose();
    this.flags.geometry.dispose();
    (this.flags.material as THREE.Material).dispose();
    this.poles.geometry.dispose();
    (this.poles.material as THREE.Material).dispose();
    if (this.strings) {
      this.strings.geometry.dispose();
      (this.strings.material as THREE.Material).dispose();
    }
  }
}
