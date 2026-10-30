import * as THREE from 'three';
import { sideX, sideZ } from '../sim/command';
import { towers } from '../sim/systems/security';
import { BEAM_RADIUS, CAMERA_RANGE, UNIT } from '../sim/tuning';
import { TILE } from '../sim/world/tiles';
import { MAP_W, type World } from '../sim/world/World';
import { Cones, type ConeFrame } from './Cones';
import { ALERT } from '../sim/systems/guards';
import { WALL_H } from './WorldView';

/** What the view needs of security each frame (filled by the game, reused). */
export interface SecurityFrame {
  /** The lights' generator running (the only one, or Irongate's GEN-2): lamps and room lights. */
  power: boolean;
  /** The electric fence live, the detector arches on (Irongate: each on its own generator). */
  fence: boolean;
  arches: boolean;
  /** Each generator running (its lamp: green, or red and blinking). */
  gens: boolean[];
  /** Each camera: its heading (radians, the view's convention: 0 = +z) and whether it watches (power, no tape); whether it sees the player. */
  cams: Array<{ facing: number; on: boolean; sees: boolean; taped: boolean }>;
  /** Each searchlight's pool (tiles), or null while off (by day, or the power out). */
  beams: Array<{ x: number; z: number }> | null;
  /** The tower whose sniper has the player in its sights (-1: none). */
  aim: number;
  /** The player's position (tiles), where the laser and shots go. */
  px: number;
  pz: number;
  /** A grapnel ready to throw from a roof's edge: where it would land the player (tiles), else null. */
  /** The grapnel's landing (y: on a roof, or the ground). */
  hook: { x: number; y: number; z: number } | null;
}

/** A soft round pool of light (additive), shared by the searchlights. */
let poolTex: THREE.CanvasTexture | null = null;
export function pool(): THREE.CanvasTexture {
  if (poolTex) return poolTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  poolTex = new THREE.CanvasTexture(c);
  poolTex.colorSpace = THREE.SRGBColorSpace;
  return poolTex;
}

interface Camera {
  head: THREE.Group;
  led: THREE.MeshBasicMaterial;
  tape: THREE.Mesh;
  /** Where its eye is (tiles). */
  x: number;
  z: number;
}

interface Beam {
  pool: THREE.Mesh;
  shaft: THREE.Mesh;
  /** The lamp on its tower (tiles; y up). */
  from: THREE.Vector3;
  shown: number;
}

interface Shot {
  line: THREE.Line;
  flash: THREE.Mesh;
  life: number;
}

/**
 * Security on screen (GDD §5.4–5.6): cameras on their brackets sweeping a pale cone (red while
 * they see the player, dark when taped or the power is out), the towers' searchlights at
 * night (a shaft from the tower and a pool on the ground, where the rules put it), a sniper's
 * laser and the crack of its shots by day, sparks on the live electric fence, and the
 * generator's lamp. Reads the world and the frame, never changes them.
 */
export class Security {
  readonly group = new THREE.Group();
  private readonly cones = new Cones({ range: CAMERA_RANGE / UNIT, colors: { [ALERT.CALM]: 0x8fdcff, [ALERT.HOSTILE]: 0xffb02e } });
  private readonly cams: Camera[] = [];
  private readonly beams: Beam[] = [];
  private readonly towersAt: THREE.Vector3[] = [];
  private readonly laser: THREE.Line;
  private readonly laserMat: THREE.LineBasicMaterial;
  private laserOn = 0;
  /** The laser's red dot on the player. */
  private readonly dot: THREE.Mesh;
  private readonly shots: Shot[] = [];
  private readonly sparks: THREE.InstancedMesh;
  private readonly sparkMat: THREE.MeshBasicMaterial;
  private readonly fence: Array<[number, number]> = [];
  private readonly genLamps: THREE.MeshBasicMaterial[] = [];
  private readonly coneFrames: ConeFrame[] = [];
  /** The grapnel's throw: an arc from the roof's edge over the fence, a ring where it lands. */
  private readonly arc: THREE.Line;
  private readonly arcMat: THREE.LineDashedMaterial;
  private readonly ring: THREE.Mesh;
  private hookShown = 0;
  private power = 1;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(world: World) {
    this.cones.world = world;
    this.group.add(this.cones.group);
    // Cameras: a bracket on the wall behind the tile, a body that pans, a lens and a red light.
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.45, metalness: 0.3 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.4, metalness: 0.5 });
    const tapeMat = new THREE.MeshStandardMaterial({ color: 0x9aa2ad, roughness: 0.9 });
    (world.def.cameras ?? []).forEach((c) => {
      // Against the wall behind it (snapped to the nearer side).
      const bx = -sideX(c.face);
      const bz = -sideZ(c.face);
      const x = c.x + 0.5 + bx * 0.42;
      const z = c.z + 0.5 + bz * 0.42;
      const y = WALL_H - 0.18;
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.24), darkMat);
      bracket.position.set(x - bx * 0.08, y + 0.08, z - bz * 0.08);
      bracket.rotation.y = Math.atan2(bx, bz);
      const head = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.34), bodyMat);
      body.position.z = 0.1;
      const hood = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.4), bodyMat);
      hood.position.set(0, 0.085, 0.12);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12).rotateX(Math.PI / 2), darkMat);
      lens.position.z = 0.28;
      const led = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
      const ledMesh = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), led);
      ledMesh.position.set(0.05, 0.04, 0.27);
      const tape = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.09, 0.02), tapeMat);
      tape.position.z = 0.305;
      tape.rotation.z = 0.25;
      tape.visible = false;
      head.add(body, hood, lens, ledMesh, tape);
      // Pans (y) and looks down a little (x, in its own frame).
      head.rotation.order = 'YXZ';
      head.rotation.x = 0.35;
      head.scale.setScalar(1.45);
      head.position.set(x, y, z);
      this.group.add(bracket, head);
      this.cams.push({ head, led, tape, x: c.x + 0.5, z: c.z + 0.5 });
    });
    this.cones.setCount(this.cams.length);
    for (let k = 0; k < this.cams.length; k++) this.coneFrames.push({ x: 0, z: 0, facing: 0, alert: ALERT.NONE });
    // Searchlights: one per path, on the tower nearest its start.
    const ts = towers(world).map((t) => new THREE.Vector3(t.x / UNIT, 5.1, t.z / UNIT));
    this.towersAt.push(...ts);
    const r = BEAM_RADIUS / UNIT;
    for (const path of world.def.searchlights ?? []) {
      const from = ts.length ? ts.reduce((a, b) => (a.distanceToSquared(new THREE.Vector3(path[0].x, 5.1, path[0].z)) <= b.distanceToSquared(new THREE.Vector3(path[0].x, 5.1, path[0].z)) ? a : b)) : new THREE.Vector3(path[0].x, 5.1, path[0].z);
      const poolMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(r * 2.3, r * 2.3).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: pool(), color: 0xfff6d8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      );
      poolMesh.renderOrder = 3;
      poolMesh.frustumCulled = false;
      // A shaft of light: a cone from the lamp, opening onto the pool.
      const shaft = new THREE.Mesh(
        new THREE.ConeGeometry(r * 0.95, 1, 20, 1, true).translate(0, -0.5, 0),
        new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
      );
      shaft.frustumCulled = false;
      shaft.renderOrder = 4;
      this.group.add(poolMesh, shaft);
      this.beams.push({ pool: poolMesh, shaft, from, shown: 0 });
    }
    // The sniper's laser sight.
    this.laserMat = new THREE.LineBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0, depthWrite: false });
    this.laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), this.laserMat);
    this.laser.frustumCulled = false;
    this.laser.renderOrder = 6;
    this.group.add(this.laser);
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, depthTest: false, toneMapped: false }));
    this.dot.renderOrder = 9;
    this.group.add(this.dot);
    // The grapnel's arc and landing ring.
    this.arcMat = new THREE.LineDashedMaterial({ color: 0xffd27a, dashSize: 0.22, gapSize: 0.14, transparent: true, opacity: 0, depthTest: false });
    this.arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 25 }, () => new THREE.Vector3())), this.arcMat);
    this.arc.frustumCulled = false;
    this.arc.renderOrder = 9;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.4, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false }));
    this.ring.renderOrder = 9;
    this.group.add(this.arc, this.ring);
    // Sparks on the live fence: a few small flashes at a time.
    const k = world.ground.kind;
    for (let i = 0; i < k.length; i++) if (k[i] === TILE.ELECTRIC) this.fence.push([i % MAP_W, Math.floor(i / MAP_W)]);
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.sparks = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.06, 0), this.sparkMat, 10);
    this.sparks.frustumCulled = false;
    this.sparks.count = 0;
    this.group.add(this.sparks);
    // Each generator's lamp: green while it runs, red when it's off.
    for (const gen of world.props.filter((p) => p.kind === 'generator')) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x3fdc5a, toneMapped: false });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mat);
      lamp.position.set(gen.x + gen.w - 0.25, 1.05, gen.z + 0.25);
      this.group.add(lamp);
      this.genLamps.push(mat);
    }
  }

  /** A sniper's shot from a tower: a tracer to the player (or the ground beside them) and a muzzle flash. */
  shot(tower: number, px: number, pz: number, hit: boolean) {
    const from = this.towersAt[tower];
    if (!from) return;
    const to = new THREE.Vector3(px + (hit ? 0 : 0.9), hit ? 0.9 : 0.02, pz + (hit ? 0 : 0.6));
    const mat = new THREE.LineBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 1, depthWrite: false });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from.clone(), to]), mat);
    line.frustumCulled = false;
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 1, toneMapped: false }));
    flash.position.copy(from);
    this.group.add(line, flash);
    this.shots.push({ line, flash, life: 1 });
  }

  update(f: SecurityFrame, dt: number, time: number, night: number, motion: boolean) {
    this.power += ((f.power ? 1 : 0) - this.power) * Math.min(1, dt * 4);
    // Cameras pan; their cones show while they watch.
    this.cams.forEach((c, k) => {
      const cf = f.cams[k];
      const cone = this.coneFrames[k];
      if (!cf) return;
      c.head.rotation.y = cf.facing;
      c.tape.visible = cf.taped;
      c.led.color.setHex(cf.on ? (cf.sees || Math.sin(time * 4 + k) > 0.2 ? 0xff2a1a : 0x5a0a06) : 0x1a1a1a);
      cone.x = c.x;
      cone.z = c.z;
      cone.facing = cf.facing;
      cone.alert = cf.on ? (cf.sees ? ALERT.HOSTILE : ALERT.CALM) : ALERT.NONE;
    });
    this.cones.update(this.coneFrames, dt, night * 0.5, motion);
    // Searchlights: shafts and pools where the rules have them.
    this.beams.forEach((b, k) => {
      const p = f.beams?.[k];
      b.shown += ((p ? 1 : 0) - b.shown) * Math.min(1, dt * 3);
      const on = b.shown > 0.01 && !!p;
      b.pool.visible = b.shaft.visible = on;
      if (!on || !p) return;
      b.pool.position.set(p.x, 0.02, p.z);
      (b.pool.material as THREE.MeshBasicMaterial).opacity = 0.55 * b.shown;
      // The shaft: from the lamp to the pool, its wide end on the ground.
      this.v.set(p.x, 0, p.z).sub(b.from);
      const len = this.v.length();
      this.q.setFromUnitVectors(this.s.set(0, -1, 0), this.v.normalize());
      b.shaft.position.copy(b.from);
      b.shaft.quaternion.copy(this.q);
      b.shaft.scale.set(1, len, 1);
      (b.shaft.material as THREE.MeshBasicMaterial).opacity = 0.09 * b.shown;
    });
    // The sniper's laser, flickering on the player.
    this.laserOn += ((f.aim >= 0 ? 1 : 0) - this.laserOn) * Math.min(1, dt * 6);
    this.laser.visible = this.laserOn > 0.02 && f.aim >= 0;
    if (this.laser.visible) {
      const from = this.towersAt[f.aim];
      const pos = this.laser.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, from.x, from.y, from.z);
      const tx = f.px + (motion ? Math.sin(time * 9) * 0.06 : 0);
      const tz = f.pz + (motion ? Math.cos(time * 7) * 0.06 : 0);
      pos.setXYZ(1, tx, 0.95, tz);
      pos.needsUpdate = true;
      this.laserMat.opacity = this.laserOn * (0.85 + (motion ? Math.sin(time * 20) * 0.15 : 0));
      this.dot.position.set(tx, 0.95, tz);
      this.dot.scale.setScalar(motion ? 1 + Math.sin(time * 14) * 0.25 : 1);
    }
    this.dot.visible = this.laser.visible;
    // The grapnel's throw, previewed while it's ready.
    this.hookShown += ((f.hook ? 1 : 0) - this.hookShown) * Math.min(1, dt * 8);
    this.arc.visible = this.ring.visible = this.hookShown > 0.02 && !!f.hook;
    if (f.hook && this.arc.visible) {
      const pos = this.arc.geometry.attributes.position as THREE.BufferAttribute;
      const y0 = WALL_H + 0.55 + 0.9;
      for (let i = 0; i <= 24; i++) {
        const u = i / 24;
        pos.setXYZ(i, f.px + (f.hook.x - f.px) * u, y0 * (1 - u) + (f.hook.y + 0.05) * u + Math.sin(u * Math.PI) * 1.6, f.pz + (f.hook.z - f.pz) * u);
      }
      pos.needsUpdate = true;
      this.arc.computeLineDistances();
      this.arcMat.opacity = 0.9 * this.hookShown;
      this.ring.position.set(f.hook.x, f.hook.y + 0.04, f.hook.z);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.85 * this.hookShown;
      this.ring.scale.setScalar(motion ? 1 + Math.sin(time * 5) * 0.08 : 1);
    }
    // Shots fade out.
    for (let k = this.shots.length - 1; k >= 0; k--) {
      const s = this.shots[k];
      s.life -= dt * 4;
      (s.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, s.life);
      (s.flash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, s.life * 1.5 - 0.5);
      s.flash.scale.setScalar(1 + (1 - s.life) * 1.5);
      if (s.life <= 0) {
        this.group.remove(s.line, s.flash);
        s.line.geometry.dispose();
        (s.line.material as THREE.Material).dispose();
        s.flash.geometry.dispose();
        (s.flash.material as THREE.Material).dispose();
        this.shots.splice(k, 1);
      }
    }
    // Sparks crackle along the live fence (none with the power out, none with reduced motion).
    let n = 0;
    if (f.fence && motion && this.fence.length) {
      const slot = Math.floor(time * 14);
      for (let k = 0; k < 10; k++) {
        // A few random fence tiles each moment (a cheap hash of the moment and the slot).
        const h = Math.abs(Math.sin((slot + k * 7.13) * 12.9898) * 43758.5453) % 1;
        if (h > 0.45) continue;
        const [x, z] = this.fence[Math.floor(h * 2.2 * this.fence.length) % this.fence.length];
        const along = Math.abs(Math.sin((slot + k) * 78.233) * 9.7) % 1;
        this.m.makeScale(1, 1.6, 1).setPosition(x + along, 0.3 + (h * 2.4) % 0.9, z + 0.5);
        this.sparks.setMatrixAt(n++, this.m);
      }
    }
    this.sparks.count = n;
    if (n) this.sparks.instanceMatrix.needsUpdate = true;
    this.genLamps.forEach((m, k) => m.color.setHex(f.gens[k] ?? f.power ? 0x3fdc5a : Math.sin(time * 6) > 0 ? 0xff2a1a : 0x4a0a06));
    this.arches += ((f.arches ? 1 : 0) - this.arches) * Math.min(1, dt * 4);
  }

  /** How far the detector arches' power is on (eased 0–1). */
  arches = 1;

  /** How far the power is on (eased 0–1): lamps and room lights follow it. */
  get powerLevel() {
    return this.power;
  }

  dispose() {
    this.cones.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) mat.dispose();
    });
  }
}
