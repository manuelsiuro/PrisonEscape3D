import * as THREE from 'three';

const POOL = 48;

/**
 * Little puffs at the feet: a fixed pool of instanced cubes (the oldest gives way), each
 * rising, drifting and shrinking away. No allocation per puff.
 */
export class Dust {
  readonly mesh: THREE.InstancedMesh;
  private readonly life = new Float32Array(POOL);
  private readonly pos = new Float32Array(POOL * 3);
  private readonly vel = new Float32Array(POOL * 3);
  private readonly size = new Float32Array(POOL);
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();

  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 1 }), POOL);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < POOL; i++) {
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, this.c.set(0xffffff));
    }
  }

  /** A few puffs at (x, z) (y above the floor), tinted like the ground or what was struck. */
  puff(x: number, z: number, color: number, count = 3, y = 0.04) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % POOL;
      this.life[i] = 1;
      this.pos.set([x + (Math.random() - 0.5) * 0.25, y, z + (Math.random() - 0.5) * 0.25], i * 3);
      this.vel.set([(Math.random() - 0.5) * 0.5, 0.35 + Math.random() * 0.35, (Math.random() - 0.5) * 0.5], i * 3);
      this.size[i] = 0.06 + Math.random() * 0.05;
      this.mesh.setColorAt(i, this.c.set(color));
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number) {
    let any = false;
    for (let i = 0; i < POOL; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] = Math.max(0, this.life[i] - dt * 1.8);
      for (let a = 0; a < 3; a++) this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
      this.vel[i * 3 + 1] -= dt * 0.6;
      const s = this.size[i] * this.life[i];
      this.mesh.setMatrixAt(i, this.m.makeScale(s, s, s).setPosition(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]));
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
