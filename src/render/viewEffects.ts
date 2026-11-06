import * as THREE from 'three';
import { canvasTexture } from './canvas';
import { MAP_W, LAYER } from '../sim/world/World';
import type { Character } from './Character';
import type { Dust } from './Dust';
import type { Sparks } from './Particles';
import { LAYER_Y } from './Structure';
import type { CameraRig } from './viewCamera';
import type { Frame } from './viewFrame';

// What lands and flies (out of View.ts, v2.34.2): a strike's chips, a blow's burst, a bang, a blast,
// the fence's bite, a sniper's warning shot; the cup of chocolate thrown, the lock-on ring, the
// janitor's puddles.

/** The lock-on ring under the target: a bright band with four ticks, drawn over the floor. */
function lockRing(): THREE.Mesh {
  const g = new THREE.RingGeometry(0.46, 0.56, 40).rotateX(-Math.PI / 2);
  const ticks: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const t = new THREE.PlaneGeometry(0.08, 0.2)
      .rotateX(-Math.PI / 2)
      .translate(0, 0, -0.68)
      .rotateY((k * Math.PI) / 2);
    ticks.push(t);
  }
  const all = [g, ...ticks].map((x) => x.toNonIndexed());
  const pos: number[] = [];
  for (const x of all) pos.push(...(x.getAttribute('position').array as Float32Array));
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  for (const x of [g, ...ticks, ...all]) x.dispose();
  // Depth-tested (walls and the target's own legs stand in front of it), nudged toward the camera over the floor.
  const m = new THREE.Mesh(
    merged,
    new THREE.MeshBasicMaterial({
      color: 0xffb02e,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
  );
  m.renderOrder = 8;
  m.visible = false;
  return m;
}

/** 2.35: the locked-on person's health over their head, in BAR_LEVELS steps (a texture each, drawn once). */
const BAR_LEVELS = 20;
const barTextures: THREE.CanvasTexture[] = [];
function barTexture(level: number): THREE.CanvasTexture {
  const had = barTextures[level];
  if (had) return had;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 20;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(20, 14, 10, 0.82)';
  g.beginPath();
  g.roundRect(1, 1, 126, 18, 9);
  g.fill();
  const f = level / BAR_LEVELS;
  if (level > 0) {
    g.fillStyle = f > 0.6 ? '#4cc27a' : f > 0.3 ? '#f2b33d' : '#e5484d';
    g.beginPath();
    g.roundRect(4, 4, Math.max(8, 120 * f), 12, 6);
    g.fill();
  }
  g.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(1, 1, 126, 18, 9);
  g.stroke();
  const t = canvasTexture(c);
  barTextures[level] = t;
  return t;
}

export class Effects {
  /** 2.35: the bar over the locked-on person's head (its level shown now). */
  readonly bar = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
  private barLevel = -1;
  /** The lock-on ring, and the cup of molten chocolate in flight (from, to, 0–1 along the way). */
  readonly ring = lockRing();
  readonly cup = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x5a3018, roughness: 0.35, emissive: 0x2a1006 }),
  );
  private readonly cupFrom = new THREE.Vector3();
  private readonly cupTo = new THREE.Vector3();
  private cupT = 1;
  private cupWho = -1;
  /** Puddles for the janitor to mop (GDD §11): flat glossy pools, one instance each. */
  readonly puddles = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.46, 20).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0x7cc4f5,
      emissive: 0x2a6a96,
      roughness: 0.2,
      metalness: 0,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    16,
  );
  private puddlesRev = -1;
  private readonly m4 = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();

  constructor(
    private readonly dust: Dust,
    private readonly sparks: Sparks,
    private readonly cam: CameraRig,
    /** Someone by Cast id (-1 the player), the player now, motion off, the layer drawn. */
    private readonly who: (id: number) => Character | undefined,
    private readonly player: () => Character,
    private readonly reduced: () => boolean,
    private readonly layer: () => number,
  ) {
    this.cup.visible = false;
    this.bar.visible = false;
    this.bar.renderOrder = 31;
    this.bar.scale.set(0.9, 0.14, 1);
    this.puddles.count = 0;
    this.puddles.renderOrder = 0.15;
    // Instances spread over the whole map: the mesh's own bounds (at the origin) would cull them.
    this.puddles.frustumCulled = false;
  }

  /** Behind the title: no ring, no cup in flight. */
  clear() {
    this.ring.visible = false;
    this.cup.visible = false;
    this.cupT = 1;
  }

  /**
   * A tool strike landed at a tile (tiles, the layer struck): the arm swings, the material
   * flies, the camera jolts a little; harder when the tile gives way.
   */
  impact(action: string, tile: number, layer: number, broke: boolean) {
    this.player().strike();
    const x = tile >= 0 ? (tile % MAP_W) + 0.5 : this.player().root.position.x;
    const z = tile >= 0 ? Math.floor(tile / MAP_W) + 0.5 : this.player().root.position.z;
    // Struck from the near side: the chips fly from the face, not the middle of the tile.
    const px = this.player().root.position.x;
    const pz = this.player().root.position.z;
    const fx = action === 'unscrew' || action === 'digUp' ? px : x + (px - x) * 0.45;
    const fz = action === 'unscrew' || action === 'digUp' ? pz : z + (pz - z) * 0.45;
    const y =
      action === 'unscrew'
        ? layer === LAYER.VENTS
          ? LAYER_Y[LAYER.VENTS]
          : 1.3
        : action === 'chip'
          ? 0.6
          : action === 'cut' || action === 'sharpen'
            ? 0.8
            : LAYER_Y[this.layer()];
    const color =
      action === 'chip' ? 0xa0533e : action === 'cut' || action === 'unscrew' ? 0xffd27a : action === 'sharpen' ? 0xd8cfc0 : 0x8a6644;
    // Sharpening is a scrape, not a blow: a little grit, no jolt.
    if (action === 'sharpen') {
      if (!this.reduced()) this.dust.puff(fx, fz, color, broke ? 6 : 2, y);
      return;
    }
    if (!this.reduced()) {
      this.dust.puff(fx, fz, color, broke ? 14 : 4, y);
      // Steel on steel: sparks off the fence or the grate.
      if (action === 'cut' || action === 'unscrew') this.sparks.burst(fx, y, fz, broke ? 16 : 6, 0xffc45a, broke ? 3.4 : 2.4);
      if (broke && action === 'chip') this.dust.puff(fx, fz, 0x8f8a80, 8, y);
      this.cam.jolt(broke ? 1 : 0.35);
    }
  }

  /**
   * A blow lands (`by` hits `on`, Cast ids, -1 the player): the hitter's arm goes, the one hit
   * flinches, a burst at the point of contact; the player's own blows jolt the camera a touch,
   * harder for a knockout.
   */
  blow(by: number, on: number, ko: boolean) {
    const a = this.who(by);
    const b = this.who(on);
    a?.punch();
    b?.flinch();
    if (!a || !b || this.reduced()) return;
    const x = (a.root.position.x + b.root.position.x * 2) / 3;
    const z = (a.root.position.z + b.root.position.z * 2) / 3;
    this.dust.puff(x, z, 0xfff2c8, ko ? 12 : 6, 0.9);
    if (by < 0) this.cam.jolt(ko ? 0.8 : 0.3);
  }

  /** A firecracker going off (P14): a flash of sparks and smoke, the camera jolted. */
  bang(tile: number) {
    if (this.reduced()) return;
    const x = (tile % MAP_W) + 0.5;
    const z = Math.floor(tile / MAP_W) + 0.5;
    this.sparks.burst(x, 0.3, z, 22, 0xffd27a, 4);
    this.sparks.burst(x, 0.4, z, 10, 0xff5a3a, 3);
    this.dust.puff(x, z, 0xd8d2c8, 14, 0.5);
    this.cam.jolt(0.9);
  }

  /** A cup of molten chocolate thrown at someone (Cast id): it arcs over, then splashes. */
  throwAt(on: number) {
    const b = this.who(on);
    if (!b) return;
    this.player().punch();
    this.cupFrom.copy(this.player().root.position).setY(this.player().root.position.y + 1.1);
    this.cupTo.copy(b.root.position).setY(b.root.position.y + 0.9);
    this.cupT = 0;
    this.cupWho = on;
  }

  /** A sniper's shot (GDD §5.6): dust where a warning shot lands, a jolt when it hits (the tracer and flash: Security). */
  shot(x: number, z: number, hit: boolean) {
    if (this.reduced()) return;
    if (hit) this.cam.jolt(0.8);
    else {
      this.dust.puff(x + 0.9, z + 0.6, 0x9a8a6a, 10, 0.8);
      this.sparks.burst(x + 0.9, 0.05, z + 0.6, 7, 0xffe2a0, 2.6);
    }
  }

  /** The janitor's puddles, placed when they change; a slow shimmer. */
  drawPuddles(f: Frame, time: number) {
    const mesh = this.puddles;
    mesh.visible = f.layer === LAYER.GROUND && f.puddles.length > 0;
    if (f.puddlesRev !== this.puddlesRev) {
      this.puddlesRev = f.puddlesRev;
      mesh.count = Math.min(f.puddles.length, 16);
      for (let k = 0; k < mesh.count; k++) {
        const t = f.puddles[k];
        // Each its own shape: stretched and turned by where it lies.
        const sx = 0.85 + ((t * 7) % 5) * 0.08;
        const sz = 0.7 + ((t * 3) % 4) * 0.08;
        this.m4
          .makeRotationY((t % 7) * 0.45)
          .scale(this.v.set(sx, 1, sz))
          .setPosition((t % MAP_W) + 0.5, 0.02, Math.floor(t / MAP_W) + 0.5);
        mesh.setMatrixAt(k, this.m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (mesh.visible) (mesh.material as THREE.MeshStandardMaterial).opacity = 0.74 + (this.reduced() ? 0 : Math.sin(time * 2.2) * 0.06);
  }

  /** A landmine goes off (P11): a fireball of sparks, a column of sand and smoke, the hardest jolt. */
  blast(tile: number) {
    const x = (tile % MAP_W) + 0.5;
    const z = Math.floor(tile / MAP_W) + 0.5;
    this.cam.jolt(1.8);
    if (this.reduced()) return;
    this.sparks.burst(x, 0.3, z, 40, 0xffa53a, 6.5);
    this.sparks.burst(x, 0.5, z, 18, 0xfff0c0, 4.5);
    this.dust.puff(x, z, 0xc8a36a, 34, 0.3);
    this.dust.puff(x, z, 0x5b4a3a, 18, 1.1);
  }

  /** The electric fence bites (GDD §5.5): a shower of blue-white sparks off the player and a hard jolt. */
  shock() {
    const p = this.player().root.position;
    this.cam.jolt(1);
    if (this.reduced()) return;
    this.sparks.burst(p.x, 0.9, p.z, 22, 0x9fd8ff, 4);
    this.sparks.burst(p.x, 1.2, p.z, 10, 0xffffff, 3);
  }

  /** The ring under the locked-on target (pulsing), and the thrown cup's flight. */
  drawLock(f: Frame, dt: number, time: number) {
    const id = f.lock;
    const target = id < 0 ? null : id < f.inmates.length ? f.inmates[id] : f.guards[id - f.inmates.length];
    this.ring.visible = !!target && f.layer === LAYER.GROUND;
    if (target) {
      const pulse = this.reduced() ? 1 : 1 + Math.sin(time * 6) * 0.06;
      this.ring.position.set(target.x, 0.03, target.z);
      const mat = this.ring.material as THREE.MeshBasicMaterial;
      mat.color.setHex(f.lockHostile ? 0xff4a3a : 0xffb02e);
      mat.opacity = f.lockFar ? 0.45 : 0.92;
      this.ring.scale.setScalar(pulse);
      this.ring.rotation.y = this.reduced() ? 0 : time * 0.8;
    }
    // 2.35: their health over their head (above a "?" or "!").
    this.bar.visible = this.ring.visible;
    if (target) {
      const level = Math.max(0, Math.min(BAR_LEVELS, Math.ceil(f.lockHealth * BAR_LEVELS)));
      if (level !== this.barLevel) {
        this.barLevel = level;
        this.bar.material.map = barTexture(level);
        this.bar.material.needsUpdate = true;
      }
      this.bar.position.set(target.x, 2.45, target.z);
    }
    if (this.cupT < 1) {
      this.cupT = Math.min(1, this.cupT + dt / 0.32);
      const t = this.cupT;
      this.cup.visible = true;
      this.cup.position.lerpVectors(this.cupFrom, this.cupTo, t);
      this.cup.position.y += Math.sin(t * Math.PI) * 0.9;
      if (t >= 1) {
        this.cup.visible = false;
        const b = this.who(this.cupWho);
        b?.flinch();
        if (!this.reduced()) {
          this.dust.puff(this.cupTo.x, this.cupTo.z, 0x6b3d22, 16, 1);
          this.dust.puff(this.cupTo.x, this.cupTo.z, 0xd9a066, 8, 1.2);
          this.cam.jolt(0.6);
        }
      }
    }
  }
}
