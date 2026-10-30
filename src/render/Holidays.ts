import * as THREE from 'three';
import { HOLIDAY } from '../content/holidays';
import { type World } from '../sim/world/World';
import { now, type Later } from './batch';
import { box, cyl, kitMaterial, merge, paint, type Part } from './kit';
import { HOSE_FAN, HOSE_SWAY, holidayDecor } from './holidayDecor';
import { barbecue, basket, BRIGHT, garland, hoseReel, lantern, LIGHTS, PASTEL, snowman, SPOOKY, tree } from './holidayModels';

/** What the holidays look like this frame (P42): the holiday dressed for (0 none), the water fight on, New Year's fireworks going off. */
export interface HolidayFrame {
  kind: number;
  water: boolean;
  fireworks: boolean;
}
export const NO_HOLIDAY: HolidayFrame = { kind: 0, water: false, fireworks: false };

const FIRE = [0xff5f6d, 0xffd23f, 0x5fb3ff, 0x7ed957, 0xff9ec7, 0xffffff];
const WHITE = new THREE.Color(0xffffff);


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
