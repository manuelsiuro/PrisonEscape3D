import * as THREE from 'three';
import { HOLIDAY } from '../content/holidays';
import { floorOf } from '../sim/ai/places';
import { TILE_INFO } from '../sim/world/tiles';
import { MAP_H, MAP_W, type World } from '../sim/world/World';
import { now, type Later } from './batch';
import { box, cyl, kitMaterial, merge, paint, type Part } from './kit';
import { WALL_H } from './WorldView';

/** What the holidays look like this frame (P42): the holiday dressed for (0 none), the water fight on, New Year's fireworks going off. */
export interface HolidayFrame {
  kind: number;
  water: boolean;
  fireworks: boolean;
}
export const NO_HOLIDAY: HolidayFrame = { kind: 0, water: false, fireworks: false };

/** A canteen table's top (tiles), and a little above it. */
const TABLE_TOP = 0.52;
const PASTEL = [0xf7b2c8, 0xb8e0f2, 0xfff1a8, 0xc8f0c0, 0xd8c4f2];
const BRIGHT = [0xe5484d, 0xffd23f, 0x2fb6c8, 0x3fb950, 0xff7714];
const SPOOKY = [0xff7714, 0x6b3fa0, 0x1d1a22];
const LIGHTS = [0xff4d4d, 0xffd23f, 0x4dd2ff, 0x5aff8a, 0xff8ae0];
const FIRE = [0xff5f6d, 0xffd23f, 0x5fb3ff, 0x7ed957, 0xff9ec7, 0xffffff];

/** A little hash for where decor goes (render only: never the sim's dice). */
const hash = (a: number, b = 0) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 1, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const FIREWORK_BURSTS = 6;
const SPARKS = 28;
const DROPS = 48;

/**
 * Holidays in the picture (P42), drawn once per prison and holiday from the map, render only (nothing
 * solid, nothing the sim sees): bunting or lights along the canteen's north wall; Easter's baskets
 * of eggs on the canteen tables; summer's parasols, deckchairs and a barbecue in the yard; Halloween's
 * jack-o'-lanterns on the tables and along the yard's walls; Christmas's tree and presents in a
 * corner of the canteen, and a snowman in the yard (a sandman in the desert). The water fight's
 * sprays and New Year's fireworks while they're on.
 */
export class HolidaysView {
  readonly group = new THREE.Group();
  private world: World | null = null;
  private kind = -1;
  private readonly glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private readonly sparkMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false });
  private readonly dropMat = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 });
  private readonly sparks: THREE.InstancedMesh;
  private readonly drops: THREE.InstancedMesh;
  private readonly bursts = Array.from({ length: FIREWORK_BURSTS }, () => ({ t: 99, life: 1.6, x: 0, y: 0, z: 0, color: 0 }));
  private burstClock = 0;
  /** The yard's hoses: where each spray comes from and lands. */
  private hoses: Array<{ x0: number; z0: number; x1: number; z1: number }> = [];
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private dressed: THREE.Object3D[] = [];

  constructor() {
    this.sparks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.07, 0), this.sparkMat, FIREWORK_BURSTS * SPARKS);
    this.sparks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FIREWORK_BURSTS * SPARKS * 3), 3);
    this.sparks.count = 0;
    this.sparks.frustumCulled = false;
    this.drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.06, 0), this.dropMat, DROPS);
    this.drops.count = 0;
    this.drops.frustumCulled = false;
    this.drops.castShadow = false;
    this.group.add(this.sparks, this.drops);
  }

  /** A prison: its decor is built afresh for the holiday next shown. The last one's freed `later`. */
  setWorld(world: World, later: Later = now) {
    this.world = world;
    this.undress(later);
    this.kind = -1;
  }

  /** Dresses the prison for a holiday (0 none); nothing happens if it already is. */
  dress(kind: number, later: Later = now) {
    if (kind === this.kind || !this.world) return;
    this.undress(later);
    this.kind = kind;
    if (!kind) return;
    const w = this.world;
    const parts: Part[] = [];
    const glow: Part[] = [];
    const canteen = canteenOf(w);
    const tables = w.props.filter((p) => p.kind === 'table' && w.zoneAt(p.x, p.z) === 'canteen').slice(0, 6);
    const yard = floorOf(w, ['yard']);
    const byWall = yard.filter((t) => solidAt(w, (t % MAP_W) + 1, Math.floor(t / MAP_W)) || solidAt(w, (t % MAP_W) - 1, Math.floor(t / MAP_W)) || solidAt(w, t % MAP_W, Math.floor(t / MAP_W) - 1));
    const pick = (list: readonly number[], n: number, salt: number) => [...list].sort((a, b) => hash(a, salt) - hash(b, salt)).slice(0, n);
    const at = (t: number) => [(t % MAP_W) + 0.5, Math.floor(t / MAP_W) + 0.5] as const;
    if (canteen) {
      const colors = kind === HOLIDAY.EASTER ? PASTEL : kind === HOLIDAY.SUMMER ? BRIGHT : kind === HOLIDAY.HALLOWEEN ? SPOOKY : LIGHTS;
      for (const [x0, x1, z] of canteen.walls) garland(kind === HOLIDAY.CHRISTMAS ? glow : parts, x0, x1, z, colors, kind === HOLIDAY.CHRISTMAS);
    }
    if (kind === HOLIDAY.EASTER) {
      for (const p of tables) basket(parts, p.x + p.w / 2, p.z + p.d / 2);
    } else if (kind === HOLIDAY.SUMMER) {
      for (const t of pick(yard, 3, 11)) parasol(parts, ...at(t), hash(t, 3) * Math.PI * 2);
      const bbq = pick(byWall, 1, 12)[0];
      if (bbq !== undefined) barbecue(parts, glow, ...at(bbq));
      this.hoses = pick(byWall, 2, 13).map((t, k) => {
        const [x, z] = at(t);
        const [tx, tz] = at(yard[Math.floor(hash(t, k + 5) * yard.length)] ?? t);
        return { x0: x, z0: z, x1: tx, z1: tz };
      });
    } else if (kind === HOLIDAY.HALLOWEEN) {
      for (const p of tables) lantern(parts, glow, p.x + p.w / 2, TABLE_TOP, p.z + p.d / 2, 0.8);
      for (const t of pick(byWall, 4, 14)) lantern(parts, glow, ...xz3(at(t)), 1.2);
    } else if (kind === HOLIDAY.CHRISTMAS) {
      if (canteen?.corner) tree(parts, glow, canteen.corner[0], canteen.corner[1]);
      const spot = pick(yard, 1, 15)[0];
      if (spot !== undefined) snowman(parts, ...at(spot), w.def.theme === 'desert');
    }
    const lit = parts.length ? new THREE.Mesh(merge(parts, false), kitMaterial) : null;
    if (lit) {
      lit.castShadow = true;
      lit.receiveShadow = true;
      this.group.add(lit);
      this.dressed.push(lit);
    }
    const bright = glow.length ? new THREE.Mesh(merge(glow, false), this.glowMat) : null;
    if (bright) {
      this.group.add(bright);
      this.dressed.push(bright);
    }
  }

  private undress(later: Later) {
    const old = this.dressed;
    this.dressed = [];
    this.hoses = [];
    for (const o of old) this.group.remove(o);
    later(() => {
      for (const o of old) (o as THREE.Mesh).geometry.dispose();
    });
  }

  /**
   * A frame: the water fight's sprays arcing over the yard, New Year's bursts over the player (`x`,
   * `z`), the lights' glow with the power (`lit`, 0–1). Still with reduced motion: no sprays, no
   * bursts (the decor stays).
   */
  update(f: HolidayFrame, dt: number, time: number, x: number, z: number, motion: boolean, lit = 1) {
    this.glowMat.color.setScalar(0.25 + 0.75 * lit);
    // The water fight's hoses: droplets along each arc, a stream of them.
    let n = 0;
    if (f.water && motion && this.hoses.length) {
      const per = Math.floor(DROPS / this.hoses.length);
      this.hoses.forEach((hz, k) => {
        for (let i = 0; i < per; i++) {
          const u = (time * 0.6 + i / per + k * 0.37) % 1;
          const wob = Math.sin(time * 1.3 + k) * 0.8;
          this.p.set(hz.x0 + (hz.x1 - hz.x0 + wob) * u, 0.9 + Math.sin(u * Math.PI) * 1.6, hz.z0 + (hz.z1 - hz.z0) * u);
          this.m.makeTranslation(this.p.x, this.p.y, this.p.z);
          this.drops.setMatrixAt(n++, this.m);
        }
      });
    }
    this.drops.count = n;
    this.drops.instanceMatrix.needsUpdate = true;
    // New Year's fireworks: a burst every so often over the player, sparks flying out and falling.
    let s = 0;
    if (f.fireworks && motion) {
      this.burstClock -= dt;
      if (this.burstClock <= 0) {
        this.burstClock = 0.35 + Math.random() * 0.5;
        const b = this.bursts.reduce((a, c) => (c.t > a.t ? c : a));
        Object.assign(b, { t: 0, life: 1.4 + Math.random() * 0.6, x: x + (Math.random() - 0.5) * 12, y: 4 + Math.random() * 2.5, z: z - 3 - Math.random() * 6, color: FIRE[Math.floor(Math.random() * FIRE.length)] });
      }
    }
    for (const b of this.bursts) {
      b.t += dt;
      if (b.t >= b.life) continue;
      const k = b.t / b.life;
      const r = 2.2 * Math.sqrt(k);
      this.c.setHex(b.color).multiplyScalar(1.6 * (1 - k) + 0.2);
      for (let i = 0; i < SPARKS; i++) {
        const a = (i / SPARKS) * Math.PI * 2;
        const up = Math.sin(i * 2.399) * 0.9;
        this.p.set(b.x + Math.cos(a) * r * Math.sqrt(1 - up * up), b.y + up * r - k * k * 1.2, b.z + Math.sin(a) * r * Math.sqrt(1 - up * up) * 0.6);
        this.s.setScalar(1 - k * 0.6);
        this.m.compose(this.p, this.q, this.s);
        this.sparks.setMatrixAt(s, this.m);
        this.sparks.setColorAt(s++, this.c);
      }
    }
    this.sparks.count = s;
    this.sparks.instanceMatrix.needsUpdate = true;
    if (this.sparks.instanceColor) this.sparks.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.undress(now);
    this.sparks.geometry.dispose();
    this.drops.geometry.dispose();
    this.glowMat.dispose();
    this.sparkMat.dispose();
    this.dropMat.dispose();
  }
}

const xz3 = ([x, z]: readonly [number, number]) => [x, 0, z] as const;

function solidAt(w: World, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) return false;
  return TILE_INFO[w.ground.kind[z * MAP_W + x]].solid;
}

/** The canteen: runs of its north wall ([x0, x1, z] with the wall behind row z), and a corner tile for the tree (free floor, walls north and to a side). */
function canteenOf(w: World): { walls: Array<[number, number, number]>; corner: [number, number] | null } | null {
  const tiles: number[] = [];
  for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) if (w.zoneAt(x, z) === 'canteen' && !solidAt(w, x, z)) tiles.push(z * MAP_W + x);
  if (!tiles.length) return null;
  const walls: Array<[number, number, number]> = [];
  let corner: [number, number] | null = null;
  for (const t of tiles) {
    const x = t % MAP_W;
    const z = Math.floor(t / MAP_W);
    if (!solidAt(w, x, z - 1)) continue;
    const last = walls.at(-1);
    if (last && last[2] === z && last[1] === x) last[1] = x + 1;
    else walls.push([x, x + 1, z]);
    const free = w.propSolid[t] === 0 && !w.props.some((p) => x >= p.x && x < p.x + p.w && z >= p.z && z < p.z + p.d);
    if (!corner && free && (solidAt(w, x - 1, z) || solidAt(w, x + 1, z))) corner = [x + 0.5, z + 0.5];
  }
  // (Short runs over a doorway or a notch: left bare.)
  return { walls: walls.filter(([a, b]) => b - a >= 3), corner };
}

/** A garland along a north wall's face: little flags (or bulbs that glow), dipping between pins. */
function garland(out: Part[], x0: number, x1: number, z: number, colors: readonly number[], bulbs: boolean) {
  const y = WALL_H - 0.18;
  const zf = z + 0.06;
  for (let x = x0 + 0.25, k = 0; x < x1 - 0.1; x += 0.5, k++) {
    const dip = Math.sin(((x - x0) / 1.5) * Math.PI) * 0.06;
    const c = colors[k % colors.length];
    if (bulbs) out.push(paint(new THREE.SphereGeometry(0.05, 6, 4).translate(x, y - 0.06 - Math.abs(dip), zf), c));
    else out.push(paint(new THREE.ConeGeometry(0.11, 0.2, 3).rotateX(Math.PI).translate(x, y - 0.12 - Math.abs(dip), zf), c));
  }
  // (The string itself, a thin dark line.)
  if (!bulbs) out.push(box(x1 - x0 - 0.2, 0.015, 0.015, 0x3a3a3a, (x0 + x1) / 2, y - 0.02, zf));
}

/** Easter: a basket of painted eggs on a table. */
function basket(out: Part[], x: number, z: number) {
  out.push(cyl(0.16, 0.1, 0xb07a45, x, TABLE_TOP, z, 12), cyl(0.012, 0.22, 0x8a5a2e, x, TABLE_TOP + 0.1, z, 6));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    out.push(paint(new THREE.SphereGeometry(0.055, 8, 6).scale(1, 1.3, 1).translate(x + Math.cos(a) * 0.08, TABLE_TOP + 0.13, z + Math.sin(a) * 0.08), PASTEL[k % PASTEL.length]));
  }
}

/** Summer: a striped parasol over two deckchairs. */
function parasol(out: Part[], x: number, z: number, turn: number) {
  out.push(cyl(0.025, 1.3, 0xe8e0d0, x, 0, z, 6));
  for (let k = 0; k < 6; k++) {
    const g = new THREE.ConeGeometry(0.8, 0.28, 6, 1, true, (k * Math.PI) / 3, Math.PI / 3);
    out.push(paint(g.translate(x, 1.42, z), k % 2 ? 0xffffff : 0xe5484d));
  }
  for (const side of [-1, 1]) {
    const cx = x + Math.cos(turn) * 0.45 * side;
    const cz = z + Math.sin(turn) * 0.45 * side;
    out.push(box(0.32, 0.04, 0.6, 0x2fb6c8, cx, 0.22, cz), box(0.32, 0.36, 0.04, 0x2fb6c8, cx, 0.22, cz - 0.3));
  }
}

/** Summer: a barbecue by the wall, its coals glowing. */
function barbecue(out: Part[], glow: Part[], x: number, z: number) {
  out.push(box(0.7, 0.06, 0.4, 0x2b3038, x, 0.62, z), box(0.66, 0.16, 0.36, 0x3b4048, x, 0.46, z));
  for (const dx of [-0.3, 0.3]) for (const dz of [-0.14, 0.14]) out.push(box(0.04, 0.46, 0.04, 0x2b3038, x + dx, 0, z + dz));
  glow.push(box(0.6, 0.02, 0.3, 0xff6a1a, x, 0.6, z));
  for (let k = 0; k < 4; k++) out.push(box(0.12, 0.03, 0.05, k % 2 ? 0x8a3a1a : 0xd8a070, x - 0.2 + k * 0.13, 0.68, z));
}

/** Halloween: a jack-o'-lantern, its face lit. */
function lantern(out: Part[], glow: Part[], x: number, y: number, z: number, size: number) {
  const r = 0.14 * size;
  out.push(paint(new THREE.SphereGeometry(r, 12, 8).scale(1, 0.78, 1).translate(x, y + r * 0.78, z), 0xf28c28), cyl(0.02 * size, 0.06 * size, 0x4f8a2e, x, y + r * 1.5, z, 6));
  const f = z + r * 0.95;
  glow.push(box(0.05 * size, 0.05 * size, 0.02, 0xffd23f, x - 0.05 * size, y + r * 0.95, f), box(0.05 * size, 0.05 * size, 0.02, 0xffd23f, x + 0.05 * size, y + r * 0.95, f), box(0.13 * size, 0.03 * size, 0.02, 0xffd23f, x, y + r * 0.5, f));
}

/** Christmas: a tree in tiers, a star, coloured lights; presents at its foot. */
function tree(out: Part[], glow: Part[], x: number, z: number) {
  out.push(cyl(0.07, 0.25, 0x6e4a2b, x, 0, z, 8));
  const tiers: Array<[number, number, number]> = [
    [0.55, 0.6, 0.2],
    [0.43, 0.55, 0.62],
    [0.3, 0.5, 1.0],
  ];
  for (const [r, h, y] of tiers) out.push(paint(new THREE.ConeGeometry(r, h, 10).translate(x, y + h / 2, z), 0x2f7d3a));
  glow.push(paint(new THREE.OctahedronGeometry(0.1, 0).translate(x, 1.58, z), 0xffd23f));
  for (let k = 0; k < 14; k++) {
    const y = 0.3 + (k / 14) * 1.1;
    const r = 0.5 * (1 - (y - 0.2) / 1.4) + 0.04;
    const a = k * 2.3;
    glow.push(paint(new THREE.SphereGeometry(0.035, 6, 4).translate(x + Math.cos(a) * r, y, z + Math.sin(a) * r), LIGHTS[k % LIGHTS.length]));
  }
  const gifts: Array<[number, number, number, number]> = [
    [0.4, 0.25, 0xd23f36, 0xf4c542],
    [-0.38, 0.3, 0x2fb6c8, 0xffffff],
    [0.15, 0.45, 0x3fb950, 0xd23f36],
  ];
  for (const [dx, dz, c, rib] of gifts) out.push(box(0.22, 0.16, 0.2, c, x + dx, 0, z + dz), box(0.04, 0.165, 0.205, rib, x + dx, 0, z + dz));
}

/** Christmas: a snowman in the yard (in the desert, a sandman), in a Santa hat. */
function snowman(out: Part[], x: number, z: number, sand: boolean) {
  const body = sand ? 0xd9b26a : 0xf4f6fa;
  out.push(
    paint(new THREE.SphereGeometry(0.32, 12, 8).translate(x, 0.3, z), body),
    paint(new THREE.SphereGeometry(0.22, 12, 8).translate(x, 0.78, z), body),
    paint(new THREE.SphereGeometry(0.15, 10, 8).translate(x, 1.12, z), body),
    paint(new THREE.ConeGeometry(0.035, 0.16, 6).rotateX(Math.PI / 2).translate(x, 1.12, z + 0.2), 0xff7714),
    box(0.04, 0.04, 0.02, 0x1d1a22, x - 0.05, 1.17, z + 0.135),
    box(0.04, 0.04, 0.02, 0x1d1a22, x + 0.05, 1.17, z + 0.135),
    // (A Santa hat: the red cone, its white brim and bobble.)
    cyl(0.15, 0.05, 0xffffff, x, 1.22, z, 12),
    paint(new THREE.ConeGeometry(0.14, 0.3, 10).translate(x, 1.42, z), 0xd23f36),
    paint(new THREE.SphereGeometry(0.045, 6, 4).translate(x, 1.58, z), 0xffffff),
  );
}
