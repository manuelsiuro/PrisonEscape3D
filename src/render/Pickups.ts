import * as THREE from 'three';
import { itemDef } from '../content/items';
import { itemGeometry } from './itemModels';
import { kitMaterial } from './kit';

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
  private readonly frame = new THREE.Group();
  private readonly frameMat = new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  private shown = 0;
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

  update(items: readonly GroundItem[], focus: Focus | null, dt: number, time: number, motion: boolean) {
    while (this.pool.length < items.length) {
      const m = new THREE.Mesh(undefined, kitMaterial);
      m.castShadow = true;
      this.pool.push(m);
      this.group.add(m);
    }
    this.pool.forEach((m, k) => {
      const it = items[k];
      m.visible = !!it;
      if (!it) return;
      m.geometry = itemGeometry(itemDef(it.item));
      // Several on one tile fan out; each lies at its own angle.
      const spin = (it.item * 2.4 + k * 1.7) % (Math.PI * 2);
      const fan = items.slice(0, k).filter((o) => o.x === it.x && o.z === it.z).length;
      m.position.set(it.x + Math.cos(spin) * 0.18 * Math.min(fan, 2), 0.01, it.z + Math.sin(spin) * 0.18 * Math.min(fan, 2));
      m.rotation.y = spin;
    });

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

  dispose() {
    this.frameMat.dispose();
    (this.frame.children[0].children[0] as THREE.Mesh).geometry.dispose();
  }
}
