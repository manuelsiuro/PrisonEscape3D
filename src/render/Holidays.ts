import * as THREE from 'three';
import { HOLIDAY } from '../content/holidays';
import { floorOf } from '../sim/ai/places';
import { DECOR } from '../content/decor';
import { HEARINGS } from '../content/parole';
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
const WHITE = new THREE.Color(0xffffff);

/** A little hash for where decor goes (render only: never the sim's dice). */
const hash = (a: number, b = 0) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 1, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const FIREWORK_BURSTS = 6;
const SPARKS = 28;
/** A burst's flash at its heart, and each spark's trail: this many fading copies behind it. */
const TRAIL = 2;
const DROPS = 96;
/** A hose's splash where its jets land: this many of its drops. */
const SPLASH = 12;
/** A parasol's canopy faded under someone: so many shared steps from opaque down to CANOPY_SEE (one material each, one shader for all). */
const CANOPY_STEPS = 8;
const CANOPY_SEE = 0.22;

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
  private readonly sparkMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly dropMat = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 });
  private readonly sparks: THREE.InstancedMesh;
  private readonly flashes: THREE.InstancedMesh;
  private readonly drops: THREE.InstancedMesh;
  /**
   * Summer's parasols' canopies, seen from under too (both sides): one material for them all while
   * nobody's under one, and CANOPY_STEPS faded ones, shared (a material each, cloned, used to
   * compile a shader and its shadow afresh the first time they drew: a hitch). Warmed with the day.
   */
  private readonly canopyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });
  private readonly canopyFades = Array.from({ length: CANOPY_STEPS }, (_, k) => {
    const m = this.canopyMat.clone();
    m.transparent = true;
    m.depthWrite = false;
    m.opacity = 1 - ((k + 1) / CANOPY_STEPS) * (1 - CANOPY_SEE);
    return m;
  });
  /** A speck drawn with each shared material, shown only while the renderer compiles (warm). */
  private readonly warmers: THREE.Mesh[];
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
  private canopies: Array<{ mesh: THREE.Mesh; x: number; z: number; fade: number }> = [];

  constructor() {
    // (Each spark with TRAIL fading copies behind it, a little smaller: the bursts read as bursts from the game's camera.)
    this.sparks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.13, 0), this.sparkMat, FIREWORK_BURSTS * SPARKS * (1 + TRAIL));
    this.sparks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FIREWORK_BURSTS * SPARKS * (1 + TRAIL) * 3), 3);
    this.sparks.count = 0;
    this.sparks.frustumCulled = false;
    // (A burst's flash at its heart, for its first moment.)
    this.flashes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 1), this.sparkMat, FIREWORK_BURSTS);
    this.flashes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FIREWORK_BURSTS * 3), 3);
    this.flashes.count = 0;
    this.flashes.frustumCulled = false;
    this.drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.06, 0), this.dropMat, DROPS);
    this.drops.count = 0;
    this.drops.frustumCulled = false;
    this.drops.castShadow = false;
    // (Specks deep under the ground, always drawn, the canopy's casting a shadow: the shaders, faded too, and the two-sided shadow's compile with the prison, not the first time a parasol comes into view.)
    const speck = new THREE.PlaneGeometry(0.01, 0.01);
    this.warmers = [this.canopyMat, this.canopyFades[0], this.glowMat].map((m, k) => {
      const o = new THREE.Mesh(speck, m);
      o.castShadow = k === 0;
      o.frustumCulled = false;
      o.position.y = -50;
      return o;
    });
    this.group.add(this.sparks, this.flashes, this.drops, ...this.warmers);
  }

  /** How many meshes the view keeps whatever the holiday (the sprays, the sparks, the warmers). */
  get baseMeshes(): number {
    return 3 + this.warmers.length;
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
      if (d.what === 'garland') garland(kind === HOLIDAY.CHRISTMAS ? glow : parts, d, colors, kind === HOLIDAY.CHRISTMAS);
      else if (d.what === 'basket') basket(parts, d.x, d.z);
      else if (d.what === 'parasol') this.parasol(parts, d.x, d.z, d.turn);
      else if (d.what === 'barbecue') barbecue(parts, glow, d.x, d.z);
      else if (d.what === 'hose') {
        this.hoses.push({ x0: d.x, z0: d.z, x1: d.x1!, z1: d.z1! });
        hoseReel(parts, d.x, d.z, Math.sign(d.x1! - d.x), Math.sign(d.z1! - d.z));
      }
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
    const mesh = new THREE.Mesh(merge(canopy, false), this.canopyMat);
    mesh.castShadow = true;
    this.group.add(mesh);
    this.dressed.push(mesh);
    this.canopies.push({ mesh, x, z, fade: 1 });
  }

  private undress(later: Later) {
    const old = this.dressed;
    this.dressed = [];
    this.canopies = [];
    this.hoses = [];
    for (const o of old) this.group.remove(o);
    later(() => {
      for (const o of old) (o as THREE.Mesh).geometry.dispose();
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
      const goal = under(x, z) || guards.some((o) => under(o.x, o.z)) || inmates.some((o) => under(o.x, o.z)) ? CANOPY_SEE : 1;
      c.fade += (goal - c.fade) * Math.min(1, dt * 8);
      // (The shared step nearest its fade: none while it's all but opaque.)
      const step = Math.round(((1 - c.fade) / (1 - CANOPY_SEE)) * CANOPY_STEPS);
      c.mesh.material = step <= 0 ? this.canopyMat : this.canopyFades[Math.min(CANOPY_STEPS, step) - 1];
    }
    // The water fight's hoses: each a short fan of jets from the nozzle (three streams, swaying), and a splash where they land.
    let n = 0;
    if (f.water && motion && this.hoses.length) {
      const per = Math.floor(DROPS / this.hoses.length);
      const jets = per - SPLASH;
      this.hoses.forEach((hz, k) => {
        const dx = hz.x1 - hz.x0;
        const dz = hz.z1 - hz.z0;
        const sway = Math.sin(time * 1.3 + k) * HOSE_SWAY;
        for (let i = 0; i < jets; i++) {
          const jet = (i % 3) - 1;
          const u = (time * 1.4 + i / jets + k * 0.37) % 1;
          // (Fanned out a little either side of the jet's line, and swaying.)
          const a = jet * HOSE_FAN + sway;
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
    // (Each spark with its trail, dimmer and smaller the further behind; a flash at the burst's heart as it goes off. Added light: they fade to nothing. None with reduced motion.)
    let fl = 0;
    for (const b of this.bursts) {
      b.t += dt;
      if (b.t >= b.life || !motion) continue;
      for (let j = 0; j <= TRAIL; j++) {
        const k = Math.max(0, b.t - j * 0.07) / b.life;
        const r = 2.4 * Math.sqrt(k);
        this.c.setHex(b.color).multiplyScalar((1.8 * (1 - k) + 0.15) * (1 - j * 0.32));
        this.s.setScalar((1 - k * 0.55) * (1 - j * 0.25));
        for (let i = 0; i < SPARKS; i++) {
          const a = (i / SPARKS) * Math.PI * 2;
          const up = Math.sin(i * 2.399) * 0.9;
          this.p.set(b.x + Math.cos(a) * r * Math.sqrt(1 - up * up), b.y + up * r - k * k * 1.2, b.z + Math.sin(a) * r * Math.sqrt(1 - up * up) * 0.6);
          this.m.compose(this.p, this.q, this.s);
          this.sparks.setMatrixAt(s, this.m);
          this.sparks.setColorAt(s++, this.c);
        }
      }
      const f0 = b.t / 0.3;
      if (f0 < 1) {
        this.p.set(b.x, b.y, b.z);
        this.s.setScalar(0.6 + f0 * 1.2);
        this.m.compose(this.p, this.q, this.s);
        this.c.setHex(b.color).lerp(WHITE, 0.6).multiplyScalar(1.4 * (1 - f0) * (1 - f0));
        this.flashes.setMatrixAt(fl, this.m);
        this.flashes.setColorAt(fl++, this.c);
      }
    }
    this.sparks.count = s;
    this.sparks.instanceMatrix.needsUpdate = true;
    if (this.sparks.instanceColor) this.sparks.instanceColor.needsUpdate = true;
    this.flashes.count = fl;
    this.flashes.instanceMatrix.needsUpdate = true;
    if (this.flashes.instanceColor) this.flashes.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.undress(now);
    this.sparks.geometry.dispose();
    this.flashes.geometry.dispose();
    this.drops.geometry.dispose();
    this.warmers[0].geometry.dispose();
    this.canopyMat.dispose();
    for (const m of this.canopyFades) m.dispose();
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
  /**
   * A garland on a side wall (the west one -1, the east one 1), down column `x` from row `z` to `z1`;
   * else along the north wall of row `z`, from `x` to `x1`. Never on a south wall: the camera sees
   * only its back, and the garland would float across the see-through cut.
   */
  side?: -1 | 1;
  /** A parasol's deckchairs: the way they sit either side of it (radians; none without room). */
  turn?: number;
}

/**
 * Where a holiday's decor goes in a prison (pure, from the map; holidaytest checks every piece in
 * every prison): garlands along the canteen's north wall (its side walls where the north has no
 * room), broken round what hangs there (the menu board, the clock, posters) and where the parole
 * board sits in front of it; Easter's baskets and Halloween's lanterns on its tables; summer's
 * parasols, barbecue and hoses on the sports ground, where the exercise hour and the water fight
 * are; Halloween's lanterns along the yard's walls; Christmas's tree in a corner of the canteen and
 * the snowman out in the yard (where the yard is only a strip, the sports ground too). Nothing
 * stands on furniture, on the prison's own floor decor, on a pastime's ground (the pitch, the
 * track, the hoop's court, the garden, the rat track, the stage), by a doorway or an opening
 * between rooms, in a passage a tile wide or by a fence's wire; nothing by a wall stands just north
 * of a wall (it'd hide it from the camera); parasols keep PARASOL_GAP tiles apart and
 * PARASOL_CLEAR from a doorway, and a hose's jets clear of anything standing.
 */
export function holidayDecor(w: World, kind: number): HolidayPiece[] {
  const out: HolidayPiece[] = [];
  if (!kind) return out;
  const { things, grounds, edges } = holidayTaken(w);
  // (Out on the floor: on nothing, off the pastimes' ground, clear of the doorways and openings and out of line with them, out of the one-wide passages, off the fences' wire.)
  const ways = lanesOf(w, 0);
  const floorOk = (t: number) => !things.has(t) && !grounds.has(t) && !nearDoor(w, t, 1) && !ways.has(t) && !narrowAt(w, things, t) && !nearFence(w, t);
  const free = (t: number) => floorOk(t) && !edges.has(t);
  const canteen = canteenOf(w, things, grounds);
  const tables = w.props.filter((p) => p.kind === 'table' && w.zoneAt(p.x, p.z) === 'canteen');
  // (Out in the yard; where it has no room, Shankton's strip, the sports ground too.)
  const own = floorOf(w, ['yard']);
  const sports = floorOf(w, ['sports']);
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
  /** Free tiles of a ground by its edge: against a wall, or a tile in from a fence (edgeAt). */
  const byWallOf = (ground: readonly number[]) => ground.filter((t) => free(t) && edgeAt(w, t));
  const pick = (list: readonly number[], n: number, salt: number) => {
    const got: number[] = [];
    for (const t of [...list].sort((a, b) => hash(a, salt) - hash(b, salt) || a - b)) {
      if (got.length >= n) break;
      if (!used.has(t)) got.push(t);
    }
    return got;
  };
  /** `n` tiles of a list one at a time, each keeping the tiles round it before the next is picked (never two side by side). */
  const pickPlace = (list: readonly number[], n: number, salt: number) => {
    const got: number[] = [];
    while (got.length < n) {
      const t = pick(list, 1, salt)[0];
      if (t === undefined) break;
      got.push(t);
      place(t);
    }
    return got;
  };
  const yard = roomOf(own).length ? own : floorOf(w, ['yard', 'sports']);
  const at = (t: number) => ({ x: (t % MAP_W) + 0.5, z: Math.floor(t / MAP_W) + 0.5 });
  if (canteen) out.push(...canteen.walls);
  if (kind === HOLIDAY.EASTER) for (const p of tables) out.push({ what: 'basket', x: p.x + p.w / 2, z: p.z + p.d / 2, y: TABLE_TOP });
  else if (kind === HOLIDAY.SUMMER) {
    // (Where the sports ground has no room left by its pitch, track and court, Center Perks', out in the yard by it; well in from a doorway, off the way in.)
    const lanes = lanesOf(w);
    const roomy = (ground: readonly number[]) => roomOf(ground).filter((t) => !nearDoor(w, t, PARASOL_CLEAR) && !lanes.has(t));
    const room = roomy(sports).length ? roomy(sports) : roomy(own);
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
    // (A barbecue by the wall, or, where the running track's margin takes the whole wall, Center Perks', at the track's edge.)
    const hoseAt = sports.filter((t) => floorOk(t) && edgeAt(w, t));
    const bbq = pick(byWall, 1, 12)[0] ?? pick(hoseAt, 1, 12)[0];
    if (bbq !== undefined) {
      out.push({ what: 'barbecue', ...at(bbq) });
      place(bbq);
    }
    // (Each hose sprays a short jet, up to HOSE_REACH tiles out from its wall onto the sports ground, its fan clear of anything standing.)
    const onGround = new Set(sports);
    // (A hose by the wall may stand at a pastime's edge too, never on it: its jet points away from the wall.)
    // (Its jets clear of anything standing, and of the parasols, the barbecue and the other hose and the tiles round them.)
    const blocked = (k: number) => things.has(k) || used.has(k);
    const aimed = (list: readonly number[]) => list.filter((t) => hoseAim(w, blocked, onGround, t));
    // (One at a time: the second keeps clear of the first.)
    for (let k = 0; k < 2; k++) {
      const t = pick(aimed(byWall), 1, 13 + k)[0] ?? pick(aimed(hoseAt), 1, 13 + k)[0];
      if (t === undefined) break;
      const { dx, dz, reach } = hoseAim(w, blocked, onGround, t)!;
      const from = at(t);
      out.push({ what: 'hose', ...from, x1: from.x + dx * reach, z1: from.z + dz * reach });
      place(t);
    }
  } else if (kind === HOLIDAY.HALLOWEEN) {
    for (const p of tables) out.push({ what: 'lantern', x: p.x + p.w / 2, z: p.z + p.d / 2, y: TABLE_TOP });
    // (Along the yard's walls; where it has too few free, San Pancho's, the sports ground's too.)
    const got = pickPlace(byWallOf(yard), 4, 14);
    got.push(...pickPlace(byWallOf(floorOf(w, ['yard', 'sports'])), 4 - got.length, 14));
    for (const t of got) out.push({ what: 'lantern', ...at(t) });
  } else if (kind === HOLIDAY.CHRISTMAS) {
    if (canteen?.corner) out.push({ what: 'tree', x: canteen.corner[0], z: canteen.corner[1] });
    else {
      // (A canteen with no room for it anywhere, tables to every wall, San Pancho's: the tree out in the yard, or by the sports ground.)
      const clear = (ground: readonly number[]) => roomOf(ground).filter((u) => !nearDoor(w, u, 2));
      const t = pick(clear(yard), 1, 16)[0] ?? pick(clear(floorOf(w, ['yard', 'sports'])), 1, 16)[0];
      if (t !== undefined) {
        out.push({ what: 'tree', ...at(t) });
        place(t);
      }
    }
    // (The snowman out in the yard; with the tree there already and no more room, on the sports ground.)
    const spot = pick(roomOf(yard), 1, 15)[0] ?? pick(roomOf(floorOf(w, ['yard', 'sports'])), 1, 15)[0];
    if (spot !== undefined) out.push({ what: 'snowman', ...at(spot) });
  }
  return out;
}

/**
 * Where a hose by the wall at tile `t` sprays ([dx, dz] away from the wall, `reach` tiles): the
 * longest jet, 2 to HOSE_REACH tiles, whose whole fan (HOSE_FAN either side, HOSE_SWAY more) passes
 * over open floor with nothing standing on it (`blocked`: furniture, the other summer pieces) and
 * lands on the sports ground; null if none does.
 */
export function hoseAim(w: World, blocked: (t: number) => boolean, ground: ReadonlySet<number>, t: number): { dx: number; dz: number; reach: number } | null {
  const x = t % MAP_W;
  const z = Math.floor(t / MAP_W);
  const edge = edgeAt(w, t);
  if (!edge) return null;
  const [dx, dz] = edge;
  const wide = HOSE_FAN + HOSE_SWAY;
  for (let reach = HOSE_REACH; reach >= 2; reach--) {
    if (!ground.has(t + (dz * MAP_W + dx) * reach)) continue;
    let clear = true;
    for (const a of [-wide, 0, wide]) {
      const ex = (dx * Math.cos(a) - dz * Math.sin(a)) * reach;
      const ez = (dx * Math.sin(a) + dz * Math.cos(a)) * reach;
      for (let u = 0.15; u <= 1.001 && clear; u += 0.05) {
        const tx = Math.floor(x + 0.5 + ex * u);
        const tz = Math.floor(z + 0.5 + ez * u);
        const k = tz * MAP_W + tx;
        if (k !== t && (solidAt(w, tx, tz) || blocked(k))) clear = false;
      }
    }
    if (clear) return { dx, dz, reach };
  }
  return null;
}

/** How far a hose's jet reaches from its wall (tiles). */
export const HOSE_REACH = 3;
/** A hose's three jets fan out this far either side (radians), and the fan sways this much more. */
export const HOSE_FAN = 0.2;
export const HOSE_SWAY = 0.15;
/** A parasol stands more than this many tiles from a doorway or an opening (its canopy and deckchairs off the way in), and off its lane (lanesOf). */
export const PARASOL_CLEAR = 2;
/** The way in through a doorway: this many tiles straight on from it, a tile either side (lanesOf). */
export const LANE = 4;

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

/** A doorway (a door, a detector arch, or an opening between two rooms with no door: openingsOf) within this many tiles: kept clear for whoever comes through. */
export function nearDoor(w: World, t: number, r: number): boolean {
  const open = openingsOf(w);
  const x0 = t % MAP_W;
  const z0 = Math.floor(t / MAP_W);
  for (let z = z0 - r; z <= z0 + r; z++) {
    for (let x = x0 - r; x <= x0 + r; x++) {
      if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
      const k = w.ground.kind[z * MAP_W + x];
      if (k === TILE.DOOR || k === TILE.DETECTOR || open.has(z * MAP_W + x)) return true;
    }
  }
  return false;
}

const OPENINGS = new WeakMap<World, Set<number>>();

/**
 * The openings between rooms with no door in them (the gaps in a wall's line, up to OPENING_WIDE
 * tiles across, where the floor on one side is another zone's: Irongate's canteen's south opening,
 * Center Perks' yard's ways in): each tile of the gap. A doorway to the decor, like a door.
 */
export function openingsOf(w: World): ReadonlySet<number> {
  const had = OPENINGS.get(w);
  if (had) return had;
  const got = new Set<number>();
  const floor = (x: number, z: number) => x >= 0 && z >= 0 && x < MAP_W && z < MAP_H && !TILE_INFO[w.ground.kind[z * MAP_W + x]].solid;
  // (Across the gap: floor both sides, and a zone changing on the way through.)
  const through = (x: number, z: number, ax: number, az: number) => {
    if (!floor(x, z) || !floor(x - ax, z - az) || !floor(x + ax, z + az)) return false;
    const here = w.zoneAt(x, z);
    return w.zoneAt(x - ax, z - az) !== here || w.zoneAt(x + ax, z + az) !== here;
  };
  for (let z = 0; z < MAP_H; z++) {
    for (let x = 0; x < MAP_W; x++) {
      for (const [ax, az] of [[0, 1], [1, 0]]) {
        if (!through(x, z, ax, az)) continue;
        // (Along the wall's line, both ways, to the wall each side.)
        const [px, pz] = [az, ax];
        let a = 0;
        while (a <= OPENING_WIDE && through(x - px * (a + 1), z - pz * (a + 1), ax, az)) a++;
        let b = 0;
        while (b <= OPENING_WIDE && through(x + px * (b + 1), z + pz * (b + 1), ax, az)) b++;
        if (a + b + 1 > OPENING_WIDE) continue;
        if (solidAt(w, x - px * (a + 1), z - pz * (a + 1)) && solidAt(w, x + px * (b + 1), z + pz * (b + 1))) got.add(z * MAP_W + x);
      }
    }
  }
  OPENINGS.set(w, got);
  return got;
}

/**
 * The ways in: from each doorway (a door, a detector arch, an opening) straight on into the room
 * either side, LANE tiles deep (and `wide` tiles either side of it), where people walk in and out
 * and the guide's path runs: nothing stands in line with a doorway, nothing big beside that line.
 */
export function lanesOf(w: World, wide: 0 | 1 = 1): ReadonlySet<number> {
  const open = openingsOf(w);
  const got = new Set<number>();
  const floor = (x: number, z: number) => x >= 0 && z >= 0 && x < MAP_W && z < MAP_H && !TILE_INFO[w.ground.kind[z * MAP_W + x]].solid;
  for (let t = 0; t < w.ground.kind.length; t++) {
    const k = w.ground.kind[t];
    if (k !== TILE.DOOR && k !== TILE.DETECTOR && !open.has(t)) continue;
    const x = t % MAP_W;
    const z = Math.floor(t / MAP_W);
    for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!floor(x + ax, z + az) || !floor(x - ax, z - az)) continue;
      for (let d = 1; d <= LANE; d++) for (let j = -wide; j <= wide; j++) {
        const xx = x + ax * d + az * j;
        const zz = z + az * d + ax * j;
        if (floor(xx, zz)) got.add(zz * MAP_W + xx);
      }
    }
  }
  return got;
}

/** An opening this many tiles across at most is a way through a wall (wider, two spaces open to each other). */
export const OPENING_WIDE = 4;

/** A passage a tile wide (walls, or something standing, either side): nothing set down in it. */
export function narrowAt(w: World, things: ReadonlySet<number>, t: number): boolean {
  const x = t % MAP_W;
  const z = Math.floor(t / MAP_W);
  const shut = (xx: number, zz: number) => solidAt(w, xx, zz) || things.has(zz * MAP_W + xx);
  return (shut(x - 1, z) && shut(x + 1, z)) || (shut(x, z - 1) && shut(x, z + 1));
}

/** A fence (its wire, its razor coil) on any tile round this one: decor keeps a tile off. */
export function nearFence(w: World, t: number): boolean {
  const x0 = t % MAP_W;
  const z0 = Math.floor(t / MAP_W);
  for (let z = z0 - 1; z <= z0 + 1; z++) {
    for (let x = x0 - 1; x <= x0 + 1; x++) {
      if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
      if (FENCES.has(w.ground.kind[z * MAP_W + x])) return true;
    }
  }
  return false;
}

/**
 * A tile by the edge of a ground, and the way out from it ([dx, dz], away from the edge): against a
 * wall (brick, reinforced: what stands tall) west, east or north of it, or a tile in from a fence
 * (nothing touches the wire); null if neither, or if a wall stands just south of it (from the
 * camera, a wall south of a thing hides it; a fence is seen through).
 */
export function edgeAt(w: World, t: number): [number, number] | null {
  const x = t % MAP_W;
  const z = Math.floor(t / MAP_W);
  if (wallAt(w, x, z + 1)) return null;
  if (wallAt(w, x + 1, z)) return [-1, 0];
  if (wallAt(w, x - 1, z)) return [1, 0];
  if (wallAt(w, x, z - 1)) return [0, 1];
  const fence = (xx: number, zz: number) => xx >= 0 && zz >= 0 && xx < MAP_W && zz < MAP_H && FENCES.has(w.ground.kind[zz * MAP_W + xx]);
  if (fence(x + 2, z) && !solidAt(w, x + 1, z)) return [-1, 0];
  if (fence(x - 2, z) && !solidAt(w, x - 1, z)) return [1, 0];
  if (fence(x, z - 2) && !solidAt(w, x, z - 1)) return [0, 1];
  if (fence(x, z + 2) && !solidAt(w, x, z + 1)) return [0, -1];
  return null;
}

const FENCES: ReadonlySet<number> = new Set([TILE.FENCE, TILE.ELECTRIC, TILE.FENCE_CUT, TILE.FENCE_FAKE]);

function solidAt(w: World, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) return false;
  return TILE_INFO[w.ground.kind[z * MAP_W + x]].solid;
}

/** A wall that stands tall and hides what's behind it (brick, reinforced, a tower; a fence is seen through). */
export function wallAt(w: World, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) return false;
  const i = TILE_INFO[w.ground.kind[z * MAP_W + x]];
  return i.solid && i.opaque;
}

/**
 * The canteen: its garlands, runs of its north wall (or, where what hangs there leaves no room,
 * Irongate's with the odd jobs board, of its side walls), broken where something hangs on that
 * wall (a garland never crosses the menu board, the clock, a poster or the odd jobs board) and
 * where the parole board sits in front of it (their heads would cover it); and a tile for the
 * tree: free floor with nothing standing on any tile round it (a plant, the water cooler, a table,
 * the counter), against a wall (a corner first; never just north of one, which would hide it) or
 * else free in the room (clear of the counter's queue), no doorway or opening within two tiles.
 */
function canteenOf(w: World, things: ReadonlySet<number>, grounds: ReadonlySet<number>): { walls: HolidayPiece[]; corner: [number, number] | null } | null {
  const tiles: number[] = [];
  for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) if (w.zoneAt(x, z) === 'canteen' && !solidAt(w, x, z)) tiles.push(z * MAP_W + x);
  if (!tiles.length) return null;
  // (What hangs on the north wall, the west and the east: the floor tiles in front of it.)
  const hung = new Set<number>();
  const hungWest = new Set<number>();
  const hungEast = new Set<number>();
  for (const d of w.def.decor ?? []) {
    if (!DECOR[d.kind].wall) continue;
    const r = d.rot ?? 0;
    const [dw, dd] = [d.w ?? 1, d.d ?? 1];
    if (r === 0) for (let x = d.x; x < d.x + dw; x++) hung.add(d.z * MAP_W + x);
    if (r === 1) for (let z = d.z; z < d.z + dd; z++) hungWest.add(z * MAP_W + d.x);
    if (r === 3) for (let z = d.z; z < d.z + dd; z++) hungEast.add(z * MAP_W + d.x + dw - 1);
  }
  // (P40's cork board, on the wall its reader faces.)
  const board = w.def.board;
  if (board) ({ 13: hung, 9: hungWest, 1: hungEast } as Record<number, Set<number>>)[board.face]?.add(board.z * MAP_W + board.x);
  // (P39's parole board, seated in the canteen at its hearing: their heads in front of the wall a garland hangs on.)
  const hearing = HEARINGS[w.def.id];
  const heads = new Set(hearing?.zone === 'canteen' ? hearing.board.map((b) => b.z * MAP_W + b.x) : []);
  // (Nor along an opening in the room's walls: no wall there to hang it on, only the way through.)
  const gaps = openingsOf(w);
  const north: HolidayPiece[] = [];
  for (const t of tiles) {
    const [x, z] = [t % MAP_W, Math.floor(t / MAP_W)];
    if (!wallAt(w, x, z - 1) || hung.has(t) || gaps.has(t)) continue;
    const last = north.at(-1);
    if (last && last.z === z && last.x1 === x) last.x1 = x + 1;
    else north.push({ what: 'garland', x, x1: x + 1, z });
  }
  // (The side walls, down each column; never at a corner under what hangs on the north wall.)
  const sides: HolidayPiece[] = [];
  for (const side of [-1, 1] as const) {
    for (const t of [...tiles].sort((a, b) => (a % MAP_W) - (b % MAP_W) || a - b)) {
      const [x, z] = [t % MAP_W, Math.floor(t / MAP_W)];
      if (!wallAt(w, x + side, z) || (side < 0 ? hungWest : hungEast).has(t) || hung.has(t) || gaps.has(t)) continue;
      const last = sides.at(-1);
      if (last && last.side === side && last.x === x && last.z1 === z) last.z1 = z + 1;
      else sides.push({ what: 'garland', x, z, z1: z + 1, side });
    }
  }
  // (A single tile, between a doorway and the board say: left bare. Then broken where the parole board's heads would cover it, what's left either side kept.)
  const long = (g: HolidayPiece) => (g.side ? g.z1! - g.z : g.x1! - g.x) >= 2;
  const walls = (north.filter(long).length ? north.filter(long) : sides.filter(long)).flatMap((g) => {
    const out: HolidayPiece[] = [];
    const [s0, s1] = g.side ? [g.z, g.z1!] : [g.x, g.x1!];
    for (let s = s0; s < s1; s++) {
      if (heads.has(g.side ? s * MAP_W + g.x : g.z * MAP_W + s)) continue;
      const last = out.at(-1);
      if (last && (g.side ? last.z1 : last.x1) === s) {
        if (g.side) last.z1 = s + 1;
        else last.x1 = s + 1;
      } else out.push(g.side ? { ...g, z: s, z1: s + 1 } : { ...g, x: s, x1: s + 1 });
    }
    return out;
  });
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
  if (board) (board.face === 1 || board.face === 9 ? alongColumn : alongRow).add(board.z * MAP_W + board.x);
  const byBoard = (t: number) => [-1, 0, 1].some((k) => alongRow.has(t + k) || alongColumn.has(t + k * MAP_W));
  // (Nor under a garland: its boughs stand taller than the string hangs.)
  const underGarland = (t: number) => {
    const [x, z] = [t % MAP_W, Math.floor(t / MAP_W)];
    return walls.some((g) => (g.side ? g.x === x && z >= g.z - 1 && z <= g.z1! : g.z === z && x >= g.x - 1 && x <= g.x1!));
  };
  const bare = (t: number) => !things.has(t) && !grounds.has(t) && !nearDoor(w, t, 2) && !byBoard(t) && !underGarland(t) && !wallAt(w, t % MAP_W, Math.floor(t / MAP_W) + 1);
  // (Nothing standing on any tile round it: its boughs and presents, 0.6 or so out, never touch a table, the counter or a plant.)
  const roomy = (t: number) => [-1, 0, 1].every((dz) => [-1, 0, 1].every((dx) => !things.has(t + dz * MAP_W + dx)));
  // (Out in the room: canteen floor all round, off the pastimes' ground, and out of the way of the queue at a serving counter.)
  const inside = new Set(tiles);
  const queue = new Set<number>();
  for (const p of w.props) {
    if (p.kind !== 'counter' || w.zoneAt(p.x, p.z) !== 'canteen') continue;
    for (let z = p.z - 1; z < p.z + p.d + 1; z++) for (let x = p.x - 1; x < p.x + p.w + 1; x++) queue.add(z * MAP_W + x);
  }
  const doors: number[] = [];
  for (let t = 0; t < w.ground.kind.length; t++) if ((w.ground.kind[t] === TILE.DOOR || w.ground.kind[t] === TILE.DETECTOR || gaps.has(t)) && (inside.has(t) || [1, -1, MAP_W, -MAP_W].some((d) => inside.has(t + d)))) doors.push(t);
  const fromDoors = (t: number) => Math.min(99, ...doors.map((d) => Math.abs((d % MAP_W) - (t % MAP_W)) + Math.abs(Math.floor(d / MAP_W) - Math.floor(t / MAP_W))));
  const middle = (t: number) => !queue.has(t) && [-1, 0, 1].every((dz) => [-1, 0, 1].every((dx) => inside.has(t + dz * MAP_W + dx) && !grounds.has(t + dz * MAP_W + dx)));
  // (A corner with room round it first, then anywhere along a wall; else standing free in the room, nearest the north wall.)
  const c =
    tiles.find((t) => walled(t) >= 2 && bare(t) && roomy(t)) ??
    tiles.find((t) => walled(t) >= 1 && bare(t) && roomy(t)) ??
    tiles
      .filter((t) => walled(t) === 0 && bare(t) && roomy(t) && middle(t))
      // (Nearest the north wall's lights; then as far from a doorway, the way people come and go, as can be.)
      .sort((a, b) => Math.floor(a / MAP_W) - Math.floor(b / MAP_W) || fromDoors(b) - fromDoors(a) || a - b)[0];
  return { walls, corner: c === undefined ? null : [(c % MAP_W) + 0.5, Math.floor(c / MAP_W) + 0.5] };
}

/** A garland along a north wall's face (or a side wall's: `side`): little flags (or bulbs that glow), dipping between pins. */
function garland(out: Part[], g: HolidayPiece, colors: readonly number[], bulbs: boolean) {
  const y = WALL_H - 0.18;
  const side = g.side;
  const [s0, s1] = side ? [g.z, g.z1!] : [g.x, g.x1!];
  // (Its face: a little off the wall, into the room.)
  const face = side ? (side < 0 ? g.x + 0.06 : g.x + 1 - 0.06) : g.z + 0.06;
  const put = (geo: THREE.BufferGeometry, s: number, yy: number) => (side ? geo.rotateY(-Math.PI / 2).translate(face, yy, s) : geo.translate(s, yy, face));
  for (let s = s0 + 0.25, k = 0; s < s1 - 0.1; s += 0.5, k++) {
    const dip = Math.sin(((s - s0) / 1.5) * Math.PI) * 0.06;
    const c = colors[k % colors.length];
    if (bulbs) out.push(paint(put(new THREE.SphereGeometry(0.05, 6, 4), s, y - 0.06 - Math.abs(dip)), c));
    else out.push(paint(put(new THREE.ConeGeometry(0.11, 0.2, 3).rotateX(Math.PI), s, y - 0.12 - Math.abs(dip)), c));
  }
  // (The string itself, a thin dark line; the Christmas lights' wire drooping from bulb to bulb.)
  if (!bulbs) out.push(paint(put(new THREE.BoxGeometry(s1 - s0 - 0.2, 0.015, 0.015), (s0 + s1) / 2, y - 0.02 + 0.0075), 0x3a3a3a));
  else {
    const at = (s: number) => y - 0.03 - Math.abs(Math.sin(((s - s0) / 1.5) * Math.PI) * 0.06) - Math.sin(((s - s0) / 0.5) * Math.PI) ** 2 * 0.04;
    for (let s = s0 + 0.1; s < s1 - 0.1; s += 0.125) {
      const sb = Math.min(s + 0.125, s1 - 0.1);
      const ya = at(s);
      const yb = at(sb);
      const len = Math.hypot(sb - s, yb - ya);
      out.push(paint(put(new THREE.BoxGeometry(len, 0.012, 0.012).rotateZ(Math.atan2(yb - ya, sb - s)), (s + sb) / 2, (ya + yb) / 2), 0x2a3a2a));
    }
  }
}

/** Summer: the hose's tap and reel by the wall, the hose run out to its nozzle on a stake, aimed along its jet ([dx, dz]). */
function hoseReel(out: Part[], x: number, z: number, dx: number, dz: number) {
  // (The tap on a standpipe at the wall behind, the reel on its frame beside it, the green hose looping to the nozzle.)
  const bx = x - dx * 0.36;
  const bz = z - dz * 0.36;
  const [sx, sz] = [-dz, dx];
  out.push(cyl(0.035, 0.7, 0x8a9096, bx, 0, bz, 8), box(0.1, 0.06, 0.1, 0xc0c4c8, bx, 0.62, bz), box(0.04, 0.04, 0.12, 0xd23f36, bx, 0.7, bz));
  const rx = bx + sx * 0.28;
  const rz = bz + sz * 0.28;
  // (Its drum facing out from the wall, its axle along the jet.)
  const reel = new THREE.CylinderGeometry(0.2, 0.2, 0.12, 14).rotateZ(Math.PI / 2).rotateY(Math.atan2(-dz, dx)).translate(rx, 0.28, rz);
  out.push(paint(reel, 0x3fb950), box(0.04, 0.3, 0.04, 0x2b3038, rx - dx * 0.08, 0, rz - dz * 0.08));
  // (The hose, low along the ground from the reel to the stake, then up it.)
  const len = Math.hypot(x - rx, z - rz);
  out.push(paint(new THREE.BoxGeometry(0.05, 0.05, len).rotateY(Math.atan2(x - rx, z - rz)).translate((x + rx) / 2, 0.04, (z + rz) / 2), 0x2f8a3a));
  out.push(cyl(0.02, 0.85, 0x6e4a2b, x, 0, z, 6), cyl(0.028, 0.8, 0x2f8a3a, x + dx * 0.04, 0.04, z + dz * 0.04, 6));
  // (The nozzle, pointing along the jet.)
  out.push(paint(new THREE.CylinderGeometry(0.025, 0.04, 0.16, 8).rotateX(Math.PI / 2).rotateY(Math.atan2(dx, dz)).translate(x + dx * 0.1, 0.85, z + dz * 0.1), 0xffd23f));
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
