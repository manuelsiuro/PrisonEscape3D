import * as THREE from 'three';
import { canvasTexture } from './canvas';

const SPARKS = 64;

/**
 * Sparks: bright, glowing bits thrown out fast and pulled down hard, bouncing once on the floor
 * (metal on metal: cutting a fence, unscrewing a grate, the electric fence's bite, a bullet
 * on the ground). A fixed pool of instanced boxes, the oldest giving way; no allocation.
 */
export class Sparks {
  readonly mesh: THREE.InstancedMesh;
  private readonly life = new Float32Array(SPARKS);
  private readonly pos = new Float32Array(SPARKS * 3);
  private readonly vel = new Float32Array(SPARKS * 3);
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);
  private readonly c = new THREE.Color();

  constructor() {
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      SPARKS,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    for (let i = 0; i < SPARKS; i++) {
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, this.c.set(0xffffff));
    }
  }

  /** A burst at (x, y, z): `count` sparks, `speed` tiles a second, tinted. */
  burst(x: number, y: number, z: number, count = 8, color = 0xffc45a, speed = 3) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % SPARKS;
      this.life[i] = 0.6 + Math.random() * 0.5;
      this.pos.set([x, y, z], i * 3);
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.vel.set([Math.cos(a) * v, 1 + Math.random() * speed * 0.8, Math.sin(a) * v], i * 3);
      this.mesh.setColorAt(i, this.c.set(color).offsetHSL(0, 0, Math.random() * 0.2));
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number) {
    let any = false;
    for (let i = 0; i < SPARKS; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] = Math.max(0, this.life[i] - dt);
      const o = i * 3;
      this.vel[o + 1] -= dt * 14;
      for (let a = 0; a < 3; a++) this.pos[o + a] += this.vel[o + a] * dt;
      // One bounce off the floor, losing most of its speed.
      if (this.pos[o + 1] < 0.02 && this.vel[o + 1] < 0) {
        this.pos[o + 1] = 0.02;
        this.vel[o + 1] *= -0.3;
        this.vel[o] *= 0.5;
        this.vel[o + 2] *= 0.5;
      }
      // A streak along the way it flies, shrinking as it cools.
      this.dir.set(this.vel[o], this.vel[o + 1], this.vel[o + 2]);
      const len = Math.min(0.25, this.dir.length() * 0.03 + 0.03) * Math.min(1, this.life[i] * 2);
      this.q.setFromUnitVectors(Sparks.UP, this.dir.normalize());
      const w = 0.025 * Math.min(1, this.life[i] * 2);
      this.mesh.setMatrixAt(i, this.m.compose(this.p.set(this.pos[o], this.pos[o + 1], this.pos[o + 2]), this.q, this.s.set(w, len, w)));
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const ZS = 18;

/**
 * "Z"s rising from sleepers: each sleeper (a bed's spot, from the frame) breathes out a Z every
 * second and a half, which drifts up, sways, grows and fades. Sprites from one canvas texture.
 */
export class Snores {
  readonly group = new THREE.Group();
  private readonly sprites: THREE.Sprite[] = [];
  private readonly age = new Float32Array(ZS);
  private readonly base = new Float32Array(ZS * 3);
  private next = 0;
  private clock = 0;

  constructor() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.font = '900 52px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.strokeStyle = '#1b2230';
    g.strokeText('Z', 32, 34);
    g.fillStyle = '#e8f1ff';
    g.fillText('Z', 32, 34);
    const tex = canvasTexture(c);
    for (let i = 0; i < ZS; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      s.visible = false;
      this.sprites.push(s);
      this.group.add(s);
      this.age[i] = -1;
    }
  }

  /** Hides every Z (a new prison, a load). */
  clear() {
    this.age.fill(-1);
    for (const s of this.sprites) s.visible = false;
  }

  /** Every frame: `sleepers` are [x, y, z] of each sleeper's head (flat list); none hides them. */
  update(dt: number, sleepers: readonly number[], count: number, motion: boolean) {
    this.clock += dt;
    if (this.clock >= 1.5 && motion) {
      this.clock = 0;
      for (let k = 0; k < count; k++) {
        const i = this.next;
        this.next = (this.next + 1) % ZS;
        this.age[i] = 0;
        this.base[i * 3] = sleepers[k * 3];
        this.base[i * 3 + 1] = sleepers[k * 3 + 1];
        this.base[i * 3 + 2] = sleepers[k * 3 + 2];
      }
    }
    for (let i = 0; i < ZS; i++) {
      const s = this.sprites[i];
      if (this.age[i] < 0) continue;
      this.age[i] += dt;
      const t = this.age[i] / 2.6;
      if (t >= 1 || !count) {
        this.age[i] = -1;
        s.visible = false;
        continue;
      }
      s.visible = true;
      s.position.set(this.base[i * 3] + Math.sin(t * 6 + i) * 0.12 + t * 0.25, this.base[i * 3 + 1] + t * 1.1, this.base[i * 3 + 2] - t * 0.2);
      const size = 0.18 + t * 0.22;
      s.scale.set(size, size, 1);
      s.material.opacity = Math.min(1, t * 5) * (1 - t);
    }
  }
}
