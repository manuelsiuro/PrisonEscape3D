import * as THREE from 'three';
import { itemDef } from '../content/items';
import { itemGeometry } from './itemModels';
import { kitMaterial } from './kit';
import { MAP_W } from '../sim/world/World';

/** A soft warm glow, drawn once and shared, so items on the floor catch the eye. */
let glowTexture: THREE.CanvasTexture | null = null;
function glow(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255, 236, 170, 0.95)');
  grad.addColorStop(0.45, 'rgba(255, 210, 110, 0.45)');
  grad.addColorStop(1, 'rgba(255, 200, 90, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

/** How much bigger an item lies on the floor than its model (it has to read from the camera). */
const FLOOR_SCALE = 1.35;

/** An item lying on the floor (tile coordinates of its middle). */
export interface GroundItem {
  x: number;
  z: number;
  item: number;
}

/** Where the player can interact: a footprint (tiles) to frame on the floor. */
export interface Focus {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/**
 * Items on the floor (a pool of meshes, each turned and nudged a little so a pile looks
 * dropped, not placed) and the focus frame: four glowing corner brackets around whatever
 * the player would use by pressing the action button.
 */
export class Pickups {
  readonly group = new THREE.Group();
  private readonly pool: THREE.Mesh[] = [];
  private readonly glows: THREE.Mesh[] = [];
  private readonly glowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly glowMat = new THREE.MeshBasicMaterial({ map: glow(), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
  private readonly frame = new THREE.Group();
  private readonly frameMat = new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  private shown = 0;
  private rev = -1;
  private count = 0;
  private readonly box = { x0: 0, z0: 0, x1: 1, z1: 1 };

  constructor() {
    // Each bracket: two thin bars meeting at a corner, lying on the floor.
    const bar = new THREE.BoxGeometry(0.28, 0.02, 0.06);
    for (let k = 0; k < 4; k++) {
      const corner = new THREE.Group();
      const a = new THREE.Mesh(bar, this.frameMat);
      a.position.set(0.11, 0, 0);
      const b = new THREE.Mesh(bar, this.frameMat);
      b.rotation.y = Math.PI / 2;
      b.position.set(0, 0, 0.11);
      corner.add(a, b);
      corner.rotation.y = (-k * Math.PI) / 2;
      this.frame.add(corner);
    }
    this.frame.renderOrder = 3;
    this.group.add(this.frame);
  }

  /**
   * Lays out the floor items again when they change (`rev`), and animates every frame.
   * Each item's angle comes from its tile and kind (not its place in the list), so a pile
   * doesn't shuffle when one is picked up; items sharing a tile fan out around it.
   */
  update(items: readonly GroundItem[], rev: number, focus: Focus | null, dt: number, time: number, motion: boolean) {
    if (rev !== this.rev || items.length !== this.count) this.layout(items, rev);
    if (motion) for (let k = 0; k < this.count; k++) this.glows[k].scale.setScalar(0.95 + Math.sin(time * 2.4 + k * 1.3) * 0.12);
    // The focus frame eases in, breathes, and snaps to the new target.
    this.shown += ((focus ? 1 : 0) - this.shown) * Math.min(1, dt * 10);
    this.frame.visible = this.shown > 0.02;
    if (focus) Object.assign(this.box, focus);
    if (!this.frame.visible) return;
    const pad = 0.1 + (motion ? Math.sin(time * 5) * 0.04 : 0);
    const { x0, z0, x1, z1 } = this.box;
    const corners: Array<[number, number]> = [
      [x0 - pad, z0 - pad],
      [x1 + pad, z0 - pad],
      [x1 + pad, z1 + pad],
      [x0 - pad, z1 + pad],
    ];
    this.frame.children.forEach((c, k) => c.position.set(corners[k][0], 0.035, corners[k][1]));
    this.frameMat.opacity = this.shown * 0.95;
  }

  private layout(items: readonly GroundItem[], rev: number) {
    this.rev = rev;
    this.count = items.length;
    while (this.pool.length < items.length) {
      const m = new THREE.Mesh(undefined, kitMaterial);
      m.castShadow = true;
      m.scale.setScalar(FLOOR_SCALE);
      const halo = new THREE.Mesh(this.glowGeometry, this.glowMat);
      halo.renderOrder = 2;
      this.pool.push(m);
      this.glows.push(halo);
      this.group.add(m, halo);
    }
    const onTile = new Map<number, number>();
    this.pool.forEach((m, k) => {
      const it = items[k];
      const halo = this.glows[k];
      m.visible = halo.visible = !!it;
      if (!it) return;
      m.geometry = itemGeometry(itemDef(it.item));
      const tile = Math.floor(it.z) * MAP_W + Math.floor(it.x);
      const nth = onTile.get(tile) ?? 0;
      onTile.set(tile, nth + 1);
      const spin = (tile * 0.61 + it.item * 2.4) % (Math.PI * 2);
      // The first lies in the middle, the next ones around it.
      const around = nth === 0 ? 0 : 0.2;
      const at = nth * 2.1;
      m.position.set(it.x + Math.cos(at) * around, 0.01, it.z + Math.sin(at) * around);
      m.rotation.y = spin + nth;
      halo.position.set(m.position.x, 0.02, m.position.z);
      halo.scale.setScalar(1);
    });
  }

  dispose() {
    this.frameMat.dispose();
    this.glowMat.dispose();
    this.glowGeometry.dispose();
    (this.frame.children[0].children[0] as THREE.Mesh).geometry.dispose();
  }
}
