import * as THREE from 'three';
import { TILE } from '../sim/world/tiles';
import { MAP_H, MAP_W, type World } from '../sim/world/World';
import { hash01 } from './rand';
import { canvasTexture } from './canvas';

/** A tile's own small numbers (stable between loads): where its mine sits, how it's turned. */

/** A scorch: dark in the middle, fading out, a few flecks thrown round it. */
function scorchTexture(): THREE.CanvasTexture {
  const n = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const c = canvas.getContext('2d')!;
  const g = c.createRadialGradient(n / 2, n / 2, 2, n / 2, n / 2, n / 2);
  g.addColorStop(0, 'rgba(24,16,10,0.95)');
  g.addColorStop(0.45, 'rgba(48,34,22,0.85)');
  g.addColorStop(0.75, 'rgba(92,68,44,0.45)');
  g.addColorStop(1, 'rgba(120,92,60,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, n, n);
  c.fillStyle = 'rgba(30,20,12,0.7)';
  for (let k = 0; k < 14; k++) {
    const a = hash01(k, 7) * Math.PI * 2;
    const r = n * (0.3 + hash01(k, 9) * 0.18);
    c.fillRect(Math.round(n / 2 + Math.cos(a) * r), Math.round(n / 2 + Math.sin(a) * r), 2, 2);
  }
  return canvasTexture(canvas);
}

const MAX_CRATERS = 24;

/**
 * The minefield (P11, GDD §4.4), drawn: a low mound of disturbed sand over every buried mine,
 * the olive lid of one showing through here and there (enough to read the field as mined,
 * never a safe-looking gap), and the scorched craters of mines set off today.
 */
export class Minefield {
  readonly group = new THREE.Group();
  private readonly mounds: THREE.InstancedMesh | null = null;
  private readonly lids: THREE.InstancedMesh | null = null;
  private readonly craters: THREE.InstancedMesh;
  /** Each mine tile's mound and lid instance (-1 none), to hide them under a crater. */
  private readonly moundOf = new Map<number, number>();
  private readonly lidOf = new Map<number, number>();
  private readonly hidden: number[] = [];
  /** The instances as laid (copies of their matrices), to put back the morning after. */
  private readonly moundsLaid: Float32Array | null = null;
  private readonly lidsLaid: Float32Array | null = null;
  private rev = -1;
  private readonly m4 = new THREE.Matrix4();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(world: World) {
    const tiles: number[] = [];
    for (let i = 0; i < MAP_W * MAP_H; i++) if (world.ground.kind[i] === TILE.MINE) tiles.push(i);
    const lidTiles = tiles.filter((i) => hash01(i, 1) < 0.42);
    if (tiles.length) {
      this.mounds = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.15, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xb8915e, roughness: 1 }),
        tiles.length,
      );
      tiles.forEach((i, k) => {
        this.moundOf.set(i, k);
        const s = 0.85 + hash01(i, 2) * 0.35;
        this.m4
          .makeRotationY(hash01(i, 3) * Math.PI)
          .scale(new THREE.Vector3(s * 1.1, 0.3, s))
          .setPosition((i % MAP_W) + 0.3 + hash01(i, 4) * 0.4, 0, Math.floor(i / MAP_W) + 0.3 + hash01(i, 5) * 0.4);
        this.mounds!.setMatrixAt(k, this.m4);
      });
      this.mounds.receiveShadow = true;
      this.mounds.frustumCulled = false;
      this.lids = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.1, 0.12, 0.05, 12),
        new THREE.MeshStandardMaterial({ color: 0x4d5330, roughness: 0.55, metalness: 0.35 }),
        lidTiles.length,
      );
      lidTiles.forEach((i, k) => {
        this.lidOf.set(i, k);
        const at = this.m4.identity();
        this.mounds!.getMatrixAt(this.moundOf.get(i)!, at);
        const p = new THREE.Vector3().setFromMatrixPosition(at);
        this.m4.makeRotationZ((hash01(i, 6) - 0.5) * 0.25).setPosition(p.x, 0.045, p.z);
        this.lids!.setMatrixAt(k, this.m4);
      });
      this.lids.castShadow = true;
      this.lids.frustumCulled = false;
      this.group.add(this.mounds, this.lids);
      this.moundsLaid = Float32Array.from(this.mounds.instanceMatrix.array);
      this.lidsLaid = Float32Array.from(this.lids.instanceMatrix.array);
    }
    this.craters = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.62, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      MAX_CRATERS,
    );
    this.craters.count = 0;
    this.craters.renderOrder = 0.14;
    this.craters.frustumCulled = false;
    this.group.add(this.craters);
  }

  /** Today's craters (state.craters): scorches where their mines were, the mounds gone. */
  update(craters: readonly number[]) {
    const rev = craters.length * 4096 + (craters[craters.length - 1] ?? 0);
    if (rev === this.rev) return;
    this.rev = rev;
    // Last night's mines are back: their mounds and lids show again.
    for (const i of this.hidden) this.show(i, true);
    this.hidden.length = 0;
    this.craters.count = Math.min(craters.length, MAX_CRATERS);
    for (let k = 0; k < this.craters.count; k++) {
      const i = craters[craters.length - 1 - k];
      this.m4.makeRotationY(hash01(i, 8) * Math.PI * 2).setPosition((i % MAP_W) + 0.5, 0.025, Math.floor(i / MAP_W) + 0.5);
      this.craters.setMatrixAt(k, this.m4);
    }
    this.craters.instanceMatrix.needsUpdate = true;
    for (const i of craters) {
      this.show(i, false);
      this.hidden.push(i);
    }
  }

  /** A mine tile's mound and lid shown (as laid), or flattened out of sight. */
  private show(i: number, on: boolean) {
    for (const [mesh, of, laid] of [
      [this.mounds, this.moundOf, this.moundsLaid],
      [this.lids, this.lidOf, this.lidsLaid],
    ] as const) {
      const k = of.get(i);
      if (!mesh || !laid || k === undefined) continue;
      if (on) mesh.instanceMatrix.array.set(laid.subarray(k * 16, k * 16 + 16), k * 16);
      else mesh.setMatrixAt(k, this.zero);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const m of [this.mounds, this.lids, this.craters]) {
      if (!m) continue;
      m.geometry.dispose();
      const mat = m.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
  }
}
