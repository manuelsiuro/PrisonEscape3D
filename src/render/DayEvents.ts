import * as THREE from 'three';
import { itemDef, itemNumber } from '../content/items';
import type { World } from '../sim/world/World';
import { MAP_H, MAP_W } from '../sim/world/World';
import { TILE_INFO } from '../sim/world/tiles';
import { Character, type Look } from './Character';
import type { Later } from './batch';
import { itemGeometry } from './itemModels';
import { WALL_H } from './WorldView';

/** What the day's events look like this frame (P17). */
export interface EventsFrame {
  movie: boolean;
  foodFight: boolean;
  inspection: boolean;
}

/** The inspectors: a charcoal suit and bowler, a tweed suit and glasses (never a guard's navy, never an inmate's orange). */
const INSPECTORS: Look[] = [
  { outfit: 0x34383f, trousers: 0x2a2d33, skin: 0xe2ad84, hair: 0x8a8a8a, hairStyle: 0, hat: 8, hatColor: 0x1d1f24, size: 1.02 },
  { outfit: 0x7a6650, trousers: 0x4a3e32, skin: 0xa86e48, hair: 0x1d1612, hairStyle: 1, glasses: 1, glassesColor: 0x2a2a2e, size: 0.97 },
];
/** Food in the air: mash, peas, ketchup, stew, jelly. */
const SEPIA = '#d6c49e';
const FOOD = [0xf3e6c4, 0x7cbf4a, 0xd8332a, 0x8a5a32, 0xf07aa8];
const BLOBS = 24;
/** How far behind the guard they walk (seconds of its trail), sampled this often, kept this long. */
const TRAIL = [0.9, 1.6];
const TRAIL_HZ = 30;
const TRAIL_SAMPLES = 90;

/**
 * The day's events in the picture (P17): movie night's screen over the canteen's north wall
 * (a flickering silent film) and the projector's beam; a food fight's food flying between
 * the tables, splatting where it lands; the inspectors from the ministry trailing a guard on
 * its round. Built for a prison, shown only while their event is on.
 */
export class DayEvents {
  readonly group = new THREE.Group();
  private screen: THREE.Mesh | null = null;
  private beam: THREE.Mesh | null = null;
  private film: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; t: number; frame: number; vignette?: CanvasGradient } | null = null;
  /** The canteen's floor box (tiles), for the food. */
  private canteen: { x0: number; z0: number; x1: number; z1: number } | null = null;
  private readonly blobs: THREE.InstancedMesh;
  private readonly flying: Array<{ on: boolean; t: number; dur: number; x0: number; z0: number; x1: number; z1: number; color: number; spin: number }> = [];
  private throwClock = 0;
  private inspectors: Character[] = [];
  private readonly trail = new Float32Array(TRAIL_SAMPLES * 2);
  private trailClock = 0;
  private readonly p0 = { x: 0, z: 0 };
  private readonly p1 = { x: 0, z: 0 };
  private readonly shown: Character[] = [];
  private trailAt = 0;
  private trailLen = 0;
  private trailGuard = -1;
  private readonly spot = [{ x: 0, z: 0, set: false }, { x: 0, z: 0, set: false }];
  private world: World | null = null;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly axis = new THREE.Vector3(1, 0.4, 0.2).normalize();
  /** A dollop landed (where, its colour): the view puffs it, the play layer hears it. */
  onSplat: (x: number, z: number, color: number) => void = () => {};

  constructor() {
    this.blobs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.1, 1), new THREE.MeshStandardMaterial({ roughness: 0.55 }), BLOBS);
    this.blobs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BLOBS * 3), 3);
    this.blobs.count = 0;
    this.blobs.frustumCulled = false;
    this.blobs.castShadow = false;
    for (let k = 0; k < BLOBS; k++) this.flying.push({ on: false, t: 0, dur: 1, x0: 0, z0: 0, x1: 0, z1: 0, color: 0, spin: 0 });
    this.group.add(this.blobs);
  }

  /** A prison: where its canteen is (the screen goes up over its north wall). The last one's parts are freed `later`. */
  setWorld(world: World, later?: Later) {
    this.clear(later);
    this.world = world;
    // The inspectors made now, hidden (not in the middle of a day the first time they're needed).
    this.inspectorCast();
    let x0 = MAP_W;
    let z0 = MAP_H;
    let x1 = -1;
    let z1 = -1;
    for (let z = 0; z < MAP_H; z++)
      for (let x = 0; x < MAP_W; x++) {
        if (world.zoneAt(x, z) !== 'canteen' || TILE_INFO[world.ground.kind[z * MAP_W + x]].solid) continue;
        x0 = Math.min(x0, x);
        z0 = Math.min(z0, z);
        x1 = Math.max(x1, x);
        z1 = Math.max(z1, z);
      }
    if (x1 < 0) return;
    this.canteen = { x0, z0, x1, z1 };
    // The screen: over the north wall (its middle), facing the room and the camera.
    // Centred on the tables (the canteen also has its counter and kitchen side).
    const seats = world.props.filter((q) => (q.kind === 'seat' || q.kind === 'table') && world.zoneAt(q.x, q.z) === 'canteen');
    const sx0 = seats.length ? Math.min(...seats.map((q) => q.x)) : x0;
    const sx1 = seats.length ? Math.max(...seats.map((q) => q.x + q.w)) : x1 + 1;
    const width = Math.min(4.4, sx1 - sx0 + 0.4);
    const height = width * 0.56;
    const cx = (sx0 + sx1) / 2;
    // The room's north edge over the tables (not a notch elsewhere in the canteen).
    let top = MAP_H;
    for (let z = z0; z <= z1 && top === MAP_H; z++)
      for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) if (world.zoneAt(x, z) === 'canteen' && !TILE_INFO[world.ground.kind[z * MAP_W + x]].solid) top = z;
    if (top === MAP_H) top = z0;
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 108;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // Redrawn 12 times a second: no mipmaps to rebuild each time.
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    this.film = { canvas, tex, t: 0, frame: -1 };
    // (Drawn after the fog too, like the film: the veil never cuts across the frame.)
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.16, height + 0.16), new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.8, transparent: true }));
    frame.position.z = -0.01;
    frame.renderOrder = 0.59;
    // (Transparent so it draws after the fog veil, over it: no seam where the veil cuts across the film.)
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true }));
    this.screen.renderOrder = 0.6;
    this.screen.add(frame);
    this.screen.position.set(cx, WALL_H + 0.08 + height / 2, top - 0.45);
    this.screen.visible = false;
    // The projector's beam: from the back of the room to the screen's corners, faint and flickering.
    const back = new THREE.Vector3(cx, WALL_H + 0.25, z1 + 0.6);
    const g = new THREE.BufferGeometry();
    const sx = this.screen.position;
    g.setAttribute('position', new THREE.Float32BufferAttribute([back.x, back.y, back.z, sx.x - width / 2, sx.y - height / 2, sx.z + 0.02, sx.x + width / 2, sx.y - height / 2, sx.z + 0.02, back.x, back.y, back.z, sx.x + width / 2, sx.y - height / 2, sx.z + 0.02, sx.x + width / 2, sx.y + height / 2, sx.z + 0.02, back.x, back.y, back.z, sx.x + width / 2, sx.y + height / 2, sx.z + 0.02, sx.x - width / 2, sx.y + height / 2, sx.z + 0.02, back.x, back.y, back.z, sx.x - width / 2, sx.y + height / 2, sx.z + 0.02, sx.x - width / 2, sx.y - height / 2, sx.z + 0.02], 3));
    this.beam = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0.03, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true }));
    this.beam.visible = false;
    this.beam.renderOrder = 7;
    this.group.add(this.screen, this.beam);
  }

  /** The inspectors, made with the prison (hidden until an inspection: no draw call). */
  private inspectorCast(): Character[] {
    if (!this.inspectors.length) {
      const clipboard = itemNumber('magazine');
      this.inspectors = INSPECTORS.map((look, k) => {
        const c = new Character(look);
        if (k === 0) c.hold(clipboard, itemGeometry(itemDef(clipboard)));
        c.root.visible = false;
        this.group.add(c.root);
        return c;
      });
    }
    return this.inspectors;
  }

  /**
   * A frame. `guards`: where each guard is (and whether it's up and about: the inspectors
   * trail the first one that is); `inmates`: where everyone is (the food flies between them);
   * `ground`: the player is on the ground floor (at px, pz); `about`: anywhere above the tunnels
   * (the ground floor's people are drawn from the vents and the roofs too); `power`: the lights' level (a cut dims the film).
   */
  update(f: EventsFrame, dt: number, time: number, guards: ReadonlyArray<{ x: number; z: number; awake: boolean }>, inmates: ReadonlyArray<{ x: number; z: number }>, ground: boolean, motion: boolean, splat: boolean, px = 0, pz = 0, about = ground, power = 1): Character[] {
    // Movie night: the screen stands over the wall only while the player is in or by the canteen (elsewhere it would hide the rooms north of it).
    const box = this.canteen;
    const near = !!box && px >= box.x0 - 3 && px <= box.x1 + 4 && pz >= box.z0 - 2 && pz <= box.z1 + 4;
    const movie = f.movie && ground && near && !!this.screen;
    if (this.screen) {
      this.screen.visible = movie;
      // The projector runs on the mains: a power cut dims the film to a ghost.
      if (movie) (this.screen.material as THREE.MeshBasicMaterial).color.setScalar(0.15 + 0.85 * power);
    }
    if (this.beam) {
      this.beam.visible = movie && power > 0.2;
      if (movie) (this.beam.material as THREE.MeshBasicMaterial).opacity = (motion ? 0.03 + 0.012 * Math.sin(time * 23) * Math.sin(time * 7.3) : 0.03) * power;
    }
    if (movie) this.roll(dt, motion);
    // The food fight.
    this.food(f.foodFight && ground && motion, dt, inmates, splat);
    // The inspectors, a few steps behind a guard on its round.
    const shown = this.shown;
    shown.length = 0;
    if (f.inspection && about) {
      // The guard they follow, as long as it's there (knocked out, they wait by it); else the first one up and about.
      let k = this.trailGuard >= 0 && this.trailGuard < guards.length ? this.trailGuard : -1;
      for (let i = 0; i < guards.length && k < 0; i++) if (guards[i].awake) k = i;
      if (k >= 0) {
        const cast = this.inspectorCast();
        const g = guards[k];
        if (k !== this.trailGuard) {
          this.trailGuard = k;
          this.trailLen = 0;
          this.trailClock = 0;
          for (const o of this.spot) o.set = false;
        }
        // Where the guard was, sampled on a fixed clock (whatever the screen's frame rate).
        if (this.trailLen === 0) this.sample(g.x, g.z);
        this.trailClock += dt;
        while (this.trailClock >= 1 / TRAIL_HZ) {
          this.trailClock -= 1 / TRAIL_HZ;
          this.sample(g.x, g.z);
        }
        const frac = this.trailClock * TRAIL_HZ;
        for (let j = 0; j < cast.length; j++) {
          const c = cast[j];
          const back = TRAIL[j] * TRAIL_HZ;
          this.trailPoint(back - frac, this.p0);
          this.trailPoint(back - frac + 4, this.p1);
          const x = this.p0.x;
          const z = this.p0.z;
          let moving = Math.hypot(x - this.p1.x, z - this.p1.z) > 0.02;
          let facing = moving ? Math.atan2(x - this.p1.x, z - this.p1.z) : c.root.rotation.y;
          // Side by side behind it, a little apart.
          const side = j === 0 ? 0.42 : -0.42;
          let tx = x + Math.cos(facing) * side;
          let tz = z - Math.sin(facing) * side;
          // Side by side only where there's room (a corridor, a doorway: single file).
          if (!this.walkable(tx, tz)) {
            tx = x;
            tz = z;
          }
          // Never on its heels: where it stops, they wait a pace or so back (taking notes).
          const was = this.spot[j];
          if (Math.hypot(tx - g.x, tz - g.z) < 1.4) {
            // (Arriving on a guard standing still: a pace behind it if there's floor there, else where the trail is.)
            const bx = g.x + side * 1.6;
            const bz = g.z + 1.4;
            tx = was.set ? was.x : this.walkable(bx, bz) ? bx : tx;
            tz = was.set ? was.z : this.walkable(bx, bz) ? bz : tz;
            moving = false;
            facing = Math.atan2(g.x - tx, g.z - tz);
          }
          // Eased onto the spot (no jumps when the trail starts again or the guard moves off).
          if (was.set && motion) {
            const e = Math.min(1, dt * 6);
            tx = was.x + (tx - was.x) * e;
            tz = was.z + (tz - was.z) * e;
          }
          was.x = tx;
          was.z = tz;
          was.set = true;
          c.root.visible = true;
          c.pose(tx, tz, facing, moving, dt, time, motion);
          shown.push(c);
        }
        return shown;
      }
    }
    for (const c of this.inspectors) c.root.visible = false;
    this.trailGuard = -1;
    return shown;
  }

  /** Shown for a moment while the renderer compiles their shaders (a new game), then hidden again. */
  warm(on: boolean) {
    for (const m of [this.blobs, this.screen, this.beam]) if (m) m.visible = on;
    this.blobs.count = on ? 1 : 0;
  }

  /** Whether someone can stand at a point (not in a wall, not in furniture). */
  private walkable(x: number, z: number): boolean {
    const w = this.world;
    if (!w) return true;
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (!w.inside(tx, tz)) return false;
    const i = tz * MAP_W + tx;
    return !TILE_INFO[w.ground.kind[i]].solid && !w.propSolid[i];
  }

  /** A point of the guard's trail. */
  private sample(x: number, z: number) {
    this.trail[this.trailAt * 2] = x;
    this.trail[this.trailAt * 2 + 1] = z;
    this.trailAt = (this.trailAt + 1) % TRAIL_SAMPLES;
    this.trailLen = Math.min(TRAIL_SAMPLES, this.trailLen + 1);
  }

  /** Where the guard was `back` samples ago (fractional: between two samples), into `out`. */
  private trailPoint(back: number, out: { x: number; z: number }) {
    const b = Math.max(0, Math.min(this.trailLen - 1, back));
    const k0 = Math.floor(b);
    const k1 = Math.min(this.trailLen - 1, k0 + 1);
    const f = b - k0;
    const i0 = (this.trailAt - 1 - k0 + TRAIL_SAMPLES * 2) % TRAIL_SAMPLES;
    const i1 = (this.trailAt - 1 - k1 + TRAIL_SAMPLES * 2) % TRAIL_SAMPLES;
    out.x = this.trail[i0 * 2] + (this.trail[i1 * 2] - this.trail[i0 * 2]) * f;
    out.z = this.trail[i0 * 2 + 1] + (this.trail[i1 * 2 + 1] - this.trail[i0 * 2 + 1]) * f;
  }

  /** The film: a silent comedy, an inmate chased round by a guard, in sepia with scratches (12 frames a second). */
  private roll(dt: number, motion: boolean) {
    const film = this.film!;
    film.t += dt;
    const frame = motion ? Math.floor(film.t * 12) : 0;
    if (frame === film.frame) return;
    film.frame = frame;
    const c = film.canvas.getContext('2d')!;
    const w = film.canvas.width;
    const h = film.canvas.height;
    const t = frame / 12;
    // The projector's flicker: the sepia stays put, a dark veil over it comes and goes.
    c.fillStyle = SEPIA;
    c.fillRect(0, 0, w, h);
    if (motion) {
      c.globalAlpha = 0.12 * Math.abs(Math.sin(frame * 2.3) * Math.sin(frame * 0.7));
      c.fillStyle = '#000';
      c.fillRect(0, 0, w, h);
      c.globalAlpha = 1;
    }
    // The ground and a lamp post.
    c.fillStyle = 'rgba(70,52,34,0.85)';
    c.fillRect(0, h * 0.78, w, h * 0.22);
    c.fillRect(w * 0.82, h * 0.25, 4, h * 0.55);
    c.beginPath();
    c.arc(w * 0.82 + 2, h * 0.24, 7, 0, Math.PI * 2);
    c.fill();
    // The chase: round and round (the guard always a step behind), a hop now and then.
    const lap = (t * 0.22) % 1;
    const hop = Math.abs(Math.sin(t * 6)) * 6;
    const xr = -20 + lap * (w + 60);
    runner(c, h, t, xr, 'rgba(40,30,20,0.92)', false, hop);
    runner(c, h, t, xr - 34 - Math.sin(t * 3) * 6, 'rgba(25,20,15,0.95)', true, 0);
    // Scratches and dust.
    if (motion) {
      c.strokeStyle = 'rgba(40,30,20,0.35)';
      c.lineWidth = 1;
      const sx = ((frame * 37) % w) + 0.5;
      c.beginPath();
      c.moveTo(sx, 0);
      c.lineTo(sx + 3, h);
      c.stroke();
      c.fillStyle = 'rgba(30,22,14,0.5)';
      for (let k = 0; k < 4; k++) c.fillRect((frame * (53 + k * 29)) % w, (frame * (31 + k * 17)) % h, 2, 2);
    }
    // A vignette round the edges (its gradient made once).
    film.vignette ??= (() => {
      const v = c.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.6);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(20,12,4,0.55)');
      return v;
    })();
    c.fillStyle = film.vignette;
    c.fillRect(0, 0, w, h);
    film.tex.needsUpdate = true;
  }

  /** Someone standing in the canteen (an index into `inmates`, -1 if a few tries find nobody). */
  private someoneIn(box: { x0: number; z0: number; x1: number; z1: number }, inmates: ReadonlyArray<{ x: number; z: number }>): number {
    for (let tries = 0; tries < 6 && inmates.length; tries++) {
      const k = Math.floor(Math.random() * inmates.length);
      const p = inmates[k];
      if (p.x >= box.x0 && p.x <= box.x1 + 1 && p.z >= box.z0 && p.z <= box.z1 + 1) return k;
    }
    return -1;
  }

  /** Food flying in arcs between people in the canteen (and splatting where it lands). */
  private food(on: boolean, dt: number, inmates: ReadonlyArray<{ x: number; z: number }>, splat: boolean) {
    const box = this.canteen;
    if (on && box) {
      this.throwClock += dt * 7;
      while (this.throwClock >= 1) {
        this.throwClock -= 1;
        let free: (typeof this.flying)[number] | null = null;
        for (const b of this.flying) if (!b.on) free = b;
        if (!free) break;
        // From someone in the canteen (a few tries at random), to someone else or a spot between the tables.
        const from = this.someoneIn(box, inmates);
        const to = Math.random() < 0.7 ? this.someoneIn(box, inmates) : -1;
        free.on = true;
        free.t = 0;
        free.dur = 0.55 + Math.random() * 0.35;
        free.x0 = from >= 0 ? inmates[from].x : box.x0 + Math.random() * (box.x1 - box.x0 + 1);
        free.z0 = from >= 0 ? inmates[from].z : box.z0 + Math.random() * (box.z1 - box.z0 + 1);
        free.x1 = (to >= 0 ? inmates[to].x : box.x0 + 0.5 + Math.random() * (box.x1 - box.x0)) + (Math.random() - 0.5) * 0.6;
        free.z1 = (to >= 0 ? inmates[to].z : box.z0 + 0.5 + Math.random() * (box.z1 - box.z0)) + (Math.random() - 0.5) * 0.6;
        free.color = FOOD[Math.floor(Math.random() * FOOD.length)];
        free.spin = Math.random() * 6;
      }
    }
    let n = 0;
    for (const b of this.flying) {
      if (!b.on) continue;
      b.t += dt / b.dur;
      if (b.t >= 1) {
        b.on = false;
        if (splat) this.onSplat(b.x1, b.z1, b.color);
        continue;
      }
      const e = b.t;
      this.p.set(b.x0 + (b.x1 - b.x0) * e, 0.9 + Math.sin(e * Math.PI) * 1.1 - e * 0.75, b.z0 + (b.z1 - b.z0) * e);
      this.q.setFromAxisAngle(this.axis, b.spin + e * 9);
      this.s.set(1.15, 0.85, 1);
      this.m.compose(this.p, this.q, this.s);
      this.blobs.setMatrixAt(n, this.m);
      this.blobs.setColorAt(n, this.c.setHex(b.color));
      n++;
    }
    this.blobs.count = n;
    this.blobs.visible = n > 0;
    if (n) {
      this.blobs.instanceMatrix.needsUpdate = true;
      this.blobs.instanceColor!.needsUpdate = true;
    }
  }

  /** A new prison (or none): the screen and the inspectors go. */
  private clear(later: Later = (dispose) => dispose()) {
    const screen = this.screen;
    if (screen) {
      this.group.remove(screen);
      later(() => {
        screen.geometry.dispose();
        (screen.material as THREE.Material).dispose();
        const frame = screen.children[0] as THREE.Mesh | undefined;
        frame?.geometry.dispose();
        (frame?.material as THREE.Material | undefined)?.dispose();
      });
      this.screen = null;
    }
    const beam = this.beam;
    if (beam) {
      this.group.remove(beam);
      later(() => {
        beam.geometry.dispose();
        (beam.material as THREE.Material).dispose();
      });
      this.beam = null;
    }
    const film = this.film;
    if (film) later(() => film.tex.dispose());
    this.film = null;
    for (const c of this.inspectors) {
      this.group.remove(c.root);
      later(() => c.dispose());
    }
    this.inspectors = [];
    this.trailGuard = -1;
    for (const b of this.flying) b.on = false;
    this.blobs.count = 0;
    this.canteen = null;
  }

  dispose() {
    this.clear();
    this.blobs.geometry.dispose();
    (this.blobs.material as THREE.Material).dispose();
  }
}

/** A runner in the film (its body, head, scissoring legs, a guard's cap) on a canvas `h` high at film time `t`. */
function runner(c: CanvasRenderingContext2D, h: number, t: number, x: number, color: string, hat: boolean, y: number) {
  c.fillStyle = color;
  c.fillRect(x - 5, h * 0.78 - 26 - y, 10, 16);
  c.beginPath();
  c.arc(x, h * 0.78 - 32 - y, 6, 0, Math.PI * 2);
  c.fill();
  const s = Math.sin(t * 18) * 4;
  c.fillRect(x - 4 + s, h * 0.78 - 10 - y, 3, 10);
  c.fillRect(x + 1 - s, h * 0.78 - 10 - y, 3, 10);
  if (hat) c.fillRect(x - 7, h * 0.78 - 40 - y, 14, 4);
}
