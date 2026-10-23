import * as THREE from 'three';
import { HOLIDAY } from '../content/holidays';
import { floorOf } from '../sim/ai/places';
import { DECOR } from '../content/decor';
import { TILE, TILE_INFO } from '../sim/world/tiles';
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
const DROPS = 96;
/** A hose's splash where its jets land: this many of its drops. */
const SPLASH = 12;

/**
 * Holidays in the picture (P42), drawn once per prison and holiday from the map, render only (nothing
 * solid, nothing the sim sees): bunting or lights along the canteen's north wall; Easter's baskets
 * of eggs on the canteen tables; summer's parasols, deckchairs and a barbecue on the sports ground; Halloween's
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
  /** The sports ground's hoses: where each jet comes from and lands (HOSE_REACH tiles on). */
  private hoses: Array<{ x0: number; z0: number; x1: number; z1: number }> = [];
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private dressed: THREE.Object3D[] = [];
  /** Summer's parasols' canopies, each its own mesh: faded while someone stands under one (the camera looks down). */
  private canopies: Array<{ mat: THREE.Material; x: number; z: number; fade: number }> = [];

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
    const parts: Part[] = [];
    const glow: Part[] = [];
    const colors = kind === HOLIDAY.EASTER ? PASTEL : kind === HOLIDAY.SUMMER ? BRIGHT : kind === HOLIDAY.HALLOWEEN ? SPOOKY : LIGHTS;
    for (const d of holidayDecor(this.world, kind)) {
      if (d.what === 'garland') garland(kind === HOLIDAY.CHRISTMAS ? glow : parts, d.x, d.x1!, d.z, colors, kind === HOLIDAY.CHRISTMAS, !!d.south);
      else if (d.what === 'basket') basket(parts, d.x, d.z);
      else if (d.what === 'parasol') this.parasol(parts, d.x, d.z, d.turn);
      else if (d.what === 'barbecue') barbecue(parts, glow, d.x, d.z);
      else if (d.what === 'hose') this.hoses.push({ x0: d.x, z0: d.z, x1: d.x1!, z1: d.z1! });
      else if (d.what === 'lantern') lantern(parts, glow, d.x, d.y ?? 0, d.z, d.y ? 0.8 : 1.2);
      else if (d.what === 'tree') tree(parts, glow, d.x, d.z);
      else if (d.what === 'snowman') snowman(parts, d.x, d.z, this.world.def.theme === 'desert');
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

  /** Summer: a striped parasol, its deckchairs either side (`turn`; none without room), the canopy apart so it can fade. */
  private parasol(out: Part[], x: number, z: number, turn: number | undefined) {
    out.push(cyl(0.025, 1.3, 0xe8e0d0, x, 0, z, 6));
    if (turn !== undefined) {
      for (const side of [-1, 1]) {
        const cx = x + Math.cos(turn) * 0.45 * side;
        const cz = z + Math.sin(turn) * 0.45 * side;
        out.push(box(0.32, 0.04, 0.6, 0x2fb6c8, cx, 0.22, cz), box(0.32, 0.36, 0.04, 0x2fb6c8, cx, 0.22, cz - 0.3));
      }
    }
    const canopy: Part[] = [];
    for (let k = 0; k < 6; k++) {
      const g = new THREE.ConeGeometry(0.8, 0.28, 6, 1, true, (k * Math.PI) / 3, Math.PI / 3);
      canopy.push(paint(g.translate(x, 1.42, z), k % 2 ? 0xffffff : 0xe5484d));
    }
    const mat = kitMaterial.clone();
    mat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(merge(canopy, false), mat);
    mesh.castShadow = true;
    this.group.add(mesh);
    this.dressed.push(mesh);
    this.canopies.push({ mat, x, z, fade: 1 });
  }

  private undress(later: Later) {
    const old = this.dressed;
    const mats = this.canopies.map((c) => c.mat);
    this.dressed = [];
    this.canopies = [];
    this.hoses = [];
    for (const o of old) this.group.remove(o);
    later(() => {
      for (const o of old) (o as THREE.Mesh).geometry.dispose();
      for (const m of mats) m.dispose();
    });
  }

  /**
   * A frame: the water fight's sprays arcing over the sports ground, New Year's bursts just above
   * and ahead of the player (`x`, `z`: in view on a phone too), the lights' glow with the power
   * (`lit`, 0–1), the parasols' canopies faded over whoever's under one (the player, `guards`,
   * `inmates`). Still with reduced motion: no sprays, no bursts (the decor stays).
   */
  update(f: HolidayFrame, dt: number, time: number, x: number, z: number, motion: boolean, lit = 1, guards: ReadonlyArray<{ x: number; z: number }> = [], inmates: ReadonlyArray<{ x: number; z: number }> = []) {
    this.glowMat.color.setScalar(0.25 + 0.75 * lit);
    // A parasol's canopy fades while the player or anyone else stands under it, as the walls cut away.
    for (const c of this.canopies) {
      const under = (px: number, pz: number) => Math.abs(px - c.x) < 1.1 && Math.abs(pz - c.z) < 1.1;
      const goal = under(x, z) || guards.some((o) => under(o.x, o.z)) || inmates.some((o) => under(o.x, o.z)) ? 0.22 : 1;
      c.fade += (goal - c.fade) * Math.min(1, dt * 8);
      const see = c.fade < 0.98;
      if (c.mat.transparent !== see) {
        c.mat.transparent = see;
        c.mat.depthWrite = !see;
        c.mat.needsUpdate = true;
      }
      c.mat.opacity = see ? c.fade : 1;
    }
    // The water fight's hoses: each a short fan of jets from the nozzle (three streams, swaying), and a splash where they land.
    let n = 0;
    if (f.water && motion && this.hoses.length) {
      const per = Math.floor(DROPS / this.hoses.length);
      const jets = per - SPLASH;
      this.hoses.forEach((hz, k) => {
        const dx = hz.x1 - hz.x0;
        const dz = hz.z1 - hz.z0;
        const sway = Math.sin(time * 1.3 + k) * 0.25;
        for (let i = 0; i < jets; i++) {
          const jet = (i % 3) - 1;
          const u = (time * 1.4 + i / jets + k * 0.37) % 1;
          // (Fanned out a little either side of the jet's line, and swaying.)
          const a = jet * 0.28 + sway;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const ex = dx * ca - dz * sa;
          const ez = dx * sa + dz * ca;
          this.p.set(hz.x0 + ex * u, 0.85 + Math.sin(u * Math.PI) * 0.55 - u * 0.75, hz.z0 + ez * u);
          this.m.makeTranslation(this.p.x, this.p.y, this.p.z);
          this.drops.setMatrixAt(n++, this.m);
        }
        for (let i = 0; i < SPLASH; i++) {
          const u = (time * 2 + i / SPLASH) % 1;
          const a = (i / SPLASH) * Math.PI * 2 + k;
          this.p.set(hz.x1 + Math.cos(a) * 0.45 * u, 0.05 + Math.sin(u * Math.PI) * 0.3, hz.z1 + Math.sin(a) * 0.45 * u);
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
        Object.assign(b, { t: 0, life: 1.4 + Math.random() * 0.6, x: x + (Math.random() - 0.5) * 6, y: 3.6 + Math.random() * 1.8, z: z - 1 - Math.random() * 3, color: FIRE[Math.floor(Math.random() * FIRE.length)] });
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

/** A piece of a holiday's decor where it goes (tiles; `x1`/`z1` a garland's or a hose's other end, `y` on a table). */
export interface HolidayPiece {
  what: 'garland' | 'basket' | 'parasol' | 'barbecue' | 'hose' | 'lantern' | 'tree' | 'snowman';
  x: number;
  z: number;
  y?: number;
  x1?: number;
  z1?: number;
  /** A garland on the south wall of its row (else the north). */
  south?: boolean;
  /** A parasol's deckchairs: the way they sit either side of it (radians; none without room). */
  turn?: number;
}

/**
 * Where a holiday's decor goes in a prison (pure, from the map; holidaytest checks every piece in
 * every prison): garlands along the canteen's north wall, broken round what hangs there (the menu
 * board, the clock, posters); Easter's baskets and Halloween's lanterns on its tables; summer's
 * parasols, barbecue and hoses on the sports ground, where the exercise hour and the water fight
 * are; Halloween's lanterns along the yard's walls; Christmas's tree in a corner of the canteen and
 * the snowman out in the yard (where the yard is only a strip, the sports ground too). Nothing
 * stands on furniture, on the prison's own floor decor, on a pastime's ground (the pitch, the
 * track, the hoop's court, the garden, the rat track, the stage) or by a door; parasols keep
 * PARASOL_GAP tiles apart.
 */
export function holidayDecor(w: World, kind: number): HolidayPiece[] {
  const out: HolidayPiece[] = [];
  if (!kind) return out;
  const { things, grounds, edges } = holidayTaken(w);
  const free = (t: number) => !things.has(t) && !grounds.has(t) && !edges.has(t) && !nearDoor(w, t, 1);
  const canteen = canteenOf(w, things, grounds);
  const tables = w.props.filter((p) => p.kind === 'table' && w.zoneAt(p.x, p.z) === 'canteen').slice(0, 6);
  // (Out in the yard; where it has no room, Shankton's strip, the sports ground too.)
  const own = floorOf(w, ['yard']);
  const sports = floorOf(w, ['sports']);
  const xz = (t: number) => [t % MAP_W, Math.floor(t / MAP_W)] as const;
  const near = [-1, 0, 1].flatMap((dz) => [-1, 0, 1].map((dx) => dz * MAP_W + dx)).filter((d) => d !== 0);
  // (Each piece out on the ground keeps the tiles round it to itself.)
  const used = new Set<number>();
  const place = (t: number) => {
    used.add(t);
    for (const d of near) used.add(t + d);
  };
  /** Free tiles of a ground with nothing standing round them (a pitch's paint may be: what spreads over it, a canopy, a snowman's girth, doesn't touch it). */
  const roomOf = (ground: readonly number[]) => {
    const on = new Set(ground);
    return ground.filter((t) => free(t) && !used.has(t) && near.every((d) => on.has(t + d) && !things.has(t + d)));
  };
  const byWallOf = (ground: readonly number[]) =>
    ground.filter((t) => {
      const [x, z] = xz(t);
      return free(t) && (solidAt(w, x + 1, z) || solidAt(w, x - 1, z) || solidAt(w, x, z - 1) || solidAt(w, x, z + 1));
    });
  const pick = (list: readonly number[], n: number, salt: number) => {
    const got: number[] = [];
    for (const t of [...list].sort((a, b) => hash(a, salt) - hash(b, salt) || a - b)) {
      if (got.length >= n) break;
      if (!used.has(t)) got.push(t);
    }
    return got;
  };
  const yard = roomOf(own).length ? own : floorOf(w, ['yard', 'sports']);
  const at = (t: number) => ({ x: (t % MAP_W) + 0.5, z: Math.floor(t / MAP_W) + 0.5 });
  if (canteen) for (const [x0, x1, z, south] of canteen.walls) out.push({ what: 'garland', x: x0, x1, z, ...(south ? { south } : {}) });
  if (kind === HOLIDAY.EASTER) for (const p of tables) out.push({ what: 'basket', x: p.x + p.w / 2, z: p.z + p.d / 2, y: TABLE_TOP });
  else if (kind === HOLIDAY.SUMMER) {
    // (Where the sports ground has no room left by its pitch, track and court, Center Perks', out in the yard by it.)
    const room = roomOf(sports).length ? roomOf(sports) : roomOf(own);
    const spots: number[] = [];
    for (const t of pick(room, room.length, 11)) {
      if (spots.length >= 3) break;
      if (spots.every((u) => chebyshev(t, u) >= PARASOL_GAP)) spots.push(t);
    }
    for (const t of spots) {
      // (The deckchairs either side, along whichever way has free floor both sides; none where neither has.)
      const turn = free(t + 1) && free(t - 1) ? 0 : free(t + MAP_W) && free(t - MAP_W) ? Math.PI / 2 : undefined;
      out.push({ what: 'parasol', ...at(t), turn });
      place(t);
    }
    const byWall = byWallOf(sports);
    const bbq = pick(byWall, 1, 12)[0];
    if (bbq !== undefined) {
      out.push({ what: 'barbecue', ...at(bbq) });
      place(bbq);
    }
    // (Each hose sprays a short jet, HOSE_REACH tiles out from its wall onto the sports ground.)
    const onGround = new Set(sports);
    // (A hose by the wall may stand at a pastime's edge, never on it: its jet points away from the wall.)
    const hoseAt = sports.filter((t) => {
      const [x, z] = xz(t);
      return !things.has(t) && !grounds.has(t) && !nearDoor(w, t, 1) && (solidAt(w, x + 1, z) || solidAt(w, x - 1, z) || solidAt(w, x, z - 1) || solidAt(w, x, z + 1));
    });
    // (One at a time: the second keeps clear of the first.)
    for (let k = 0; k < 2; k++) {
      const t = pick(byWall, 1, 13 + k)[0] ?? pick(hoseAt, 1, 13 + k)[0];
      if (t === undefined) break;
      const [x, z] = xz(t);
      const [dx, dz] = solidAt(w, x + 1, z) ? [-1, 0] : solidAt(w, x - 1, z) ? [1, 0] : solidAt(w, x, z - 1) ? [0, 1] : [0, -1];
      let reach = HOSE_REACH;
      while (reach > 1 && !onGround.has(t + (dz * MAP_W + dx) * reach)) reach--;
      const from = at(t);
      out.push({ what: 'hose', ...from, x1: from.x + dx * reach, z1: from.z + dz * reach });
      place(t);
    }
  } else if (kind === HOLIDAY.HALLOWEEN) {
    for (const p of tables) out.push({ what: 'lantern', x: p.x + p.w / 2, z: p.z + p.d / 2, y: TABLE_TOP });
    // (Along the yard's walls; where it has hardly any free, San Pancho's, the sports ground's too.)
    const walls = byWallOf(yard);
    for (const t of pick(walls.length >= 4 ? walls : byWallOf(floorOf(w, ['yard', 'sports'])), 4, 14)) {
      out.push({ what: 'lantern', ...at(t) });
      place(t);
    }
  } else if (kind === HOLIDAY.CHRISTMAS) {
    if (canteen?.corner) out.push({ what: 'tree', x: canteen.corner[0], z: canteen.corner[1] });
    const spot = pick(roomOf(yard), 1, 15)[0];
    if (spot !== undefined) out.push({ what: 'snowman', ...at(spot) });
  }
  return out;
}

/** How far a hose's jet reaches from its wall (tiles). */
export const HOSE_REACH = 3;

/** Parasols stand this many tiles apart at least (their canopies and deckchairs clear of each other). */
export const PARASOL_GAP = 3;

const chebyshev = (a: number, b: number) => Math.max(Math.abs((a % MAP_W) - (b % MAP_W)), Math.abs(Math.floor(a / MAP_W) - Math.floor(b / MAP_W)));

/**
 * The tiles a holiday's decor keeps off: `things` that stand there (furniture, the prison's own
 * floor decor: plants, bins, the water cooler, trees and bushes, the hoop's pole) and the pastimes'
 * `grounds` (the football pitch, the running track's rectangle, the hoop's tile and its shooting
 * spots, the garden's beds, the rat track and its lanes, the stage and its boards, quiz night's
 * places). Nothing goes on either; what spreads over its neighbours (a canopy, a tree's boughs)
 * may reach over a pitch's paint, never a thing.
 */
export function holidayTaken(w: World): { things: Set<number>; grounds: Set<number>; edges: Set<number> } {
  const things = new Set<number>();
  const grounds = new Set<number>();
  const edges = new Set<number>();
  const rect = (out: Set<number>, x: number, z: number, wd: number, d: number) => {
    for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + wd; xx++) if (xx >= 0 && zz >= 0 && xx < MAP_W && zz < MAP_H) out.add(zz * MAP_W + xx);
  };
  for (const p of w.props) rect(things, p.x, p.z, p.w, p.d);
  for (const d of w.def.decor ?? []) if (!DECOR[d.kind].wall) rect(things, d.x, d.z, d.w ?? 1, d.d ?? 1);
  const l = w.def.leisure;
  if (l) {
    rect(grounds, l.pitch.x, l.pitch.z, l.pitch.w, l.pitch.d);
    if (l.track) rect(grounds, l.track.x, l.track.z, l.track.w, l.track.d);
    rect(grounds, l.hoop.x, l.hoop.z, 1, 1);
    for (const sp of l.hoop.spots) rect(grounds, sp.x, sp.z, 1, 1);
    // (The half court's painted surface, as render/Grounds.ts lays it: from behind the rim 5 deep and 5 across.)
    const [cx, cz, cw, cd] = courtRect(l.hoop);
    rect(grounds, cx, cz, cw, cd);
    // (A tile's margin round the track and the court: nothing set down right at their edge, corners included.)
    if (l.track) rect(edges, l.track.x - 1, l.track.z - 1, l.track.w + 2, l.track.d + 2);
    rect(edges, cx - 1, cz - 1, cw + 2, cd + 2);
    rect(grounds, l.garden.x, l.garden.z, l.garden.w, l.garden.d);
    const r = l.race;
    const [dx, dz] = r.dir === 1 ? [1, 0] : r.dir === 5 ? [0, 1] : r.dir === 9 ? [-1, 0] : [0, -1];
    for (let k = 0; k < r.len; k++) for (const side of [-1, 0, 1]) rect(grounds, r.x + dx * k + dz * side, r.z + dz * k + dx * side, 1, 1);
    if (l.stage) rect(grounds, l.stage.x - 1, l.stage.z - 1, 3, 3);
    for (const q of l.quiz?.spots ?? []) rect(grounds, q.x, q.z, 1, 1);
  }
  return { things, grounds, edges };
}

/** The tiles the basketball court's paint covers ([x, z, w, d]): render/Grounds.ts court(), 5 deep from half a tile behind the rim's tile and 5 across. */
export function courtRect(c: { x: number; z: number; face: number }): [number, number, number, number] {
  const [ax, az] = c.face === 1 ? [1, 0] : c.face === 5 ? [0, 1] : c.face === 9 ? [-1, 0] : [0, -1];
  const [sx, sz] = [-az, ax];
  const xs: number[] = [];
  const zs: number[] = [];
  for (const a of [-0.5, 4.5]) for (const s of [-2.5, 2.5]) {
    xs.push(c.x + 0.5 + ax * a + sx * s);
    zs.push(c.z + 0.5 + az * a + sz * s);
  }
  const x0 = Math.floor(Math.min(...xs) + 0.01);
  const z0 = Math.floor(Math.min(...zs) + 0.01);
  return [x0, z0, Math.ceil(Math.max(...xs) - 0.01) - x0, Math.ceil(Math.max(...zs) - 0.01) - z0];
}

/** A doorway (a door or a detector arch) within this many tiles: kept clear for whoever comes through. */
export function nearDoor(w: World, t: number, r: number): boolean {
  const x0 = t % MAP_W;
  const z0 = Math.floor(t / MAP_W);
  for (let z = z0 - r; z <= z0 + r; z++) {
    for (let x = x0 - r; x <= x0 + r; x++) {
      if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
      const k = w.ground.kind[z * MAP_W + x];
      if (k === TILE.DOOR || k === TILE.DETECTOR) return true;
    }
  }
  return false;
}

function solidAt(w: World, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) return false;
  return TILE_INFO[w.ground.kind[z * MAP_W + x]].solid;
}

/**
 * The canteen: runs of its north wall ([x0, x1, z] with the wall behind row z), broken where
 * something hangs on that wall (a garland never crosses the menu board, the clock, a poster or the
 * odd jobs board);
 * and a tile for the tree: free floor against a wall (a corner first), nothing standing beside
 * it (a plant, the water cooler, a table), no doorway within two tiles.
 */
function canteenOf(w: World, things: ReadonlySet<number>, grounds: ReadonlySet<number>): { walls: Array<[number, number, number, boolean]>; corner: [number, number] | null } | null {
  const tiles: number[] = [];
  for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) if (w.zoneAt(x, z) === 'canteen' && !solidAt(w, x, z)) tiles.push(z * MAP_W + x);
  if (!tiles.length) return null;
  // (What hangs on a north wall, and on a south one: the floor tiles in front of it.)
  const hung = new Set<number>();
  const hungSouth = new Set<number>();
  for (const d of w.def.decor ?? []) {
    const r = d.rot ?? 0;
    if (!DECOR[d.kind].wall || (r !== 0 && r !== 2)) continue;
    for (let x = d.x; x < d.x + (d.w ?? 1); x++) (r === 0 ? hung : hungSouth).add((r === 0 ? d.z : d.z + (d.d ?? 1) - 1) * MAP_W + x);
  }
  // (P40's cork board, on the north wall when its reader faces north, the south one when south.)
  const board = w.def.board;
  if (board && board.face === 13) hung.add(board.z * MAP_W + board.x);
  if (board && board.face === 5) hungSouth.add(board.z * MAP_W + board.x);
  const runs = (south: boolean) => {
    const out: Array<[number, number, number, boolean]> = [];
    for (const t of tiles) {
      const x = t % MAP_W;
      const z = Math.floor(t / MAP_W);
      if (!solidAt(w, x, south ? z + 1 : z - 1) || (south ? hungSouth : hung).has(t)) continue;
      const last = out.at(-1);
      if (last && last[2] === z && last[1] === x) last[1] = x + 1;
      else out.push([x, x + 1, z, south]);
    }
    // (A single tile, between a doorway and the board say: left bare.)
    return out.filter(([a, b]) => b - a >= 2);
  };
  // (The north wall, facing the camera; where what hangs there leaves no room, Irongate's with the odd jobs board, the south wall.)
  const north = runs(false);
  const walls = north.length ? north : runs(true);
  const walled = (t: number) => {
    const [x, z] = [t % MAP_W, Math.floor(t / MAP_W)];
    return [solidAt(w, x - 1, z), solidAt(w, x + 1, z), solidAt(w, x, z - 1), solidAt(w, x, z + 1)].filter(Boolean).length;
  };
  // (Nor under anything hung on a wall, the odd jobs board too, nor at its sides: the boughs and the star would cover it.)
  // (A piece on a north or south wall: its row, a tile either side; on a side wall, its column, a tile above or below.)
  const alongRow = new Set<number>();
  const alongColumn = new Set<number>();
  for (const d of w.def.decor ?? []) {
    if (!DECOR[d.kind].wall) continue;
    const r = d.rot ?? 0;
    for (let z = d.z; z < d.z + (d.d ?? 1); z++) for (let x = d.x; x < d.x + (d.w ?? 1); x++) (r === 0 || r === 2 ? alongRow : alongColumn).add(z * MAP_W + x);
  }
  if (board) alongRow.add(board.z * MAP_W + board.x);
  const byBoard = (t: number) => [-1, 0, 1].some((k) => alongRow.has(t + k) || alongColumn.has(t + k * MAP_W));
  // (Nor under a garland: its boughs stand taller than the string hangs.)
  const underGarland = (t: number) => walls.some(([a, b, z]) => z === Math.floor(t / MAP_W) && t % MAP_W >= a - 1 && t % MAP_W <= b);
  const bare = (t: number) => !things.has(t) && !grounds.has(t) && !nearDoor(w, t, 2) && !byBoard(t) && !underGarland(t);
  const roomy = (t: number) => [-1, 0, 1].every((dz) => [-1, 0, 1].every((dx) => !things.has(t + dz * MAP_W + dx)));
  const crowd = (t: number) => [-1, 0, 1].reduce((n, dz) => n + [-1, 0, 1].filter((dx) => things.has(t + dz * MAP_W + dx)).length, 0);
  const elbow = (t: number) => [1, -1, MAP_W, -MAP_W].every((d) => !things.has(t + d));
  // (A corner with room round it first, then anywhere along a wall; in a crowded canteen, nothing standing right beside it.)
  const c =
    tiles.find((t) => walled(t) >= 2 && bare(t) && roomy(t)) ??
    tiles.find((t) => walled(t) >= 1 && bare(t) && roomy(t)) ??
    tiles.find((t) => walled(t) >= 2 && bare(t) && elbow(t)) ??
    tiles.find((t) => walled(t) >= 1 && bare(t) && elbow(t)) ??
    // (Stalag Flucht's little hall, tables to the walls: the corner with the least beside it.)
    tiles.filter((t) => walled(t) >= 2 && bare(t)).sort((a, b) => crowd(a) - crowd(b) || a - b)[0] ??
    // (Center Perks', its walls hung with the menu, the clock, a poster, the odd jobs board: along a wall, the least beside it.)
    tiles.filter((t) => walled(t) >= 1 && bare(t)).sort((a, b) => crowd(a) - crowd(b) || a - b)[0];
  return { walls, corner: c === undefined ? null : [(c % MAP_W) + 0.5, Math.floor(c / MAP_W) + 0.5] };
}

/** A garland along a north wall's face (or a south one's): little flags (or bulbs that glow), dipping between pins. */
function garland(out: Part[], x0: number, x1: number, z: number, colors: readonly number[], bulbs: boolean, south = false) {
  const y = WALL_H - 0.18;
  const zf = south ? z + 1 - 0.06 : z + 0.06;
  for (let x = x0 + 0.25, k = 0; x < x1 - 0.1; x += 0.5, k++) {
    const dip = Math.sin(((x - x0) / 1.5) * Math.PI) * 0.06;
    const c = colors[k % colors.length];
    if (bulbs) out.push(paint(new THREE.SphereGeometry(0.05, 6, 4).translate(x, y - 0.06 - Math.abs(dip), zf), c));
    else out.push(paint(new THREE.ConeGeometry(0.11, 0.2, 3).rotateX(Math.PI).translate(x, y - 0.12 - Math.abs(dip), zf), c));
  }
  // (The string itself, a thin dark line; the Christmas lights' wire drooping from bulb to bulb.)
  if (!bulbs) out.push(box(x1 - x0 - 0.2, 0.015, 0.015, 0x3a3a3a, (x0 + x1) / 2, y - 0.02, zf));
  else {
    const at = (x: number) => y - 0.03 - Math.abs(Math.sin(((x - x0) / 1.5) * Math.PI) * 0.06) - Math.sin(((x - x0) / 0.5) * Math.PI) ** 2 * 0.04;
    for (let x = x0 + 0.1; x < x1 - 0.1; x += 0.125) {
      const xb = Math.min(x + 0.125, x1 - 0.1);
      const ya = at(x);
      const yb = at(xb);
      const len = Math.hypot(xb - x, yb - ya);
      out.push(paint(new THREE.BoxGeometry(len, 0.012, 0.012).rotateZ(Math.atan2(yb - ya, xb - x)).translate((x + xb) / 2, (ya + yb) / 2, zf), 0x2a3a2a));
    }
  }
}

/** Easter: a basket of painted eggs on a table. */
function basket(out: Part[], x: number, z: number) {
  out.push(cyl(0.16, 0.1, 0xb07a45, x, TABLE_TOP, z, 12), cyl(0.012, 0.22, 0x8a5a2e, x, TABLE_TOP + 0.1, z, 6));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    out.push(paint(new THREE.SphereGeometry(0.055, 8, 6).scale(1, 1.3, 1).translate(x + Math.cos(a) * 0.08, TABLE_TOP + 0.13, z + Math.sin(a) * 0.08), PASTEL[k % PASTEL.length]));
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
