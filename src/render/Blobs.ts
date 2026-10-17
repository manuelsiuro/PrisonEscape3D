import * as THREE from 'three';
import type { Character } from './Character';

/** At most this many characters at once (the player, every inmate and guard). */
const MAX = 64;

/** A soft round shadow, dark in the middle and gone at the rim. */
function blobTexture(): THREE.CanvasTexture {
  const n = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const c = canvas.getContext('2d')!;
  const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.75)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, n, n);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Contact shadows: a soft dark disc under everyone's feet, every frame where they stand. It
 * grounds them on every quality tier (the lowest has no shadow map at all), in one draw call.
 */
export class Blobs {
  readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();

  constructor() {
    const material = new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x0b1018, transparent: true, opacity: 0.34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material, MAX);
    this.mesh.count = 0;
    // Under the fog veil (P17: 0.5), over the floor's decals.
    this.mesh.renderOrder = 0.3;
    // Instances spread over the whole map: the mesh's own bounds (at the origin) would cull them.
    this.mesh.frustumCulled = false;
  }

  /** One disc under each character shown (not someone lying down: the bed or the floor has them). */
  update(people: readonly Character[]) {
    let n = 0;
    for (const c of people) {
      if (n >= MAX) break;
      if (!c.root.visible || !c.root.parent || c.lying > 0.5) continue;
      c.root.getWorldPosition(this.p);
      this.p.y += 0.012;
      this.s.set(0.82, 1, 0.82);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
