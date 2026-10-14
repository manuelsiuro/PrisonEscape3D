import * as THREE from 'three';
import { TEX } from './textures';

export interface Look {
  outfit: number;
  skin: string;
  hair: number;
  /** Trousers (defaults to the outfit's color). */
  legs?: number;
}

/** The orange jumpsuit (tech plan §6.2). */
export const INMATE_LOOK: Look = { outfit: 0xff7714, skin: '#e8b48a', hair: 0x3a2a1e };

/**
 * A blocky character (a 3D take on the Escapists sprites): head with a face, torso, arms
 * and legs on pivots so they can swing. Faces +z when its rotation is 0. About one tile tall.
 */
export class Character {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private phase = 0;
  private swing = 0;

  constructor(look: Look) {
    const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const outfit = mat(look.outfit);
    const legs = mat(look.legs ?? look.outfit);
    const skin = new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.8 });
    const face = new THREE.MeshStandardMaterial({ map: TEX.face(look.skin), roughness: 0.8 });
    const shoe = mat(0x2a2a30);

    const limb = (w: number, h: number, material: THREE.Material, x: number, y: number, foot?: THREE.Material) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), material);
      m.position.y = -h / 2;
      m.castShadow = true;
      pivot.add(m);
      if (foot) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.08, w + 0.06), foot);
        f.position.set(0, -h + 0.04, 0.03);
        pivot.add(f);
      }
      return pivot;
    };

    this.legL = limb(0.17, 0.36, legs, -0.1, 0.36, shoe);
    this.legR = limb(0.17, 0.36, legs, 0.1, 0.36, shoe);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.38, 0.28), outfit);
    torso.position.y = 0.36 + 0.19;
    torso.castShadow = true;
    this.armL = limb(0.14, 0.34, outfit, -0.31, 0.72);
    this.armR = limb(0.14, 0.34, outfit, 0.31, 0.72);
    for (const arm of [this.armL, this.armR]) {
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.13), skin);
      hand.position.y = -0.38;
      arm.add(hand);
    }
    // Head: the face texture on the front (+z) side only.
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 0.38), [skin, skin, skin, skin, face, skin]);
    head.position.y = 0.74 + 0.19;
    head.castShadow = true;
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.4), mat(look.hair));
    hair.position.y = 0.74 + 0.38 + 0.03;
    const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.08), mat(look.hair));
    fringe.position.set(0, 0.74 + 0.3, -0.17);
    this.body.add(this.legL, this.legR, torso, this.armL, this.armR, head, hair, fringe);
    this.root.add(this.body);
  }

  /** Places and animates the character. `facing` in radians (0 = +z); `moving` swings the limbs. */
  pose(x: number, z: number, facing: number, moving: boolean, dt: number, time: number) {
    this.root.position.set(x, 0, z);
    // Turn the short way round, quickly.
    let d = facing - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * Math.min(1, dt * 14);
    this.swing += ((moving ? 1 : 0) - this.swing) * Math.min(1, dt * 10);
    if (moving) this.phase += dt * 11;
    const s = Math.sin(this.phase) * 0.7 * this.swing;
    this.legL.rotation.x = s;
    this.legR.rotation.x = -s;
    this.armL.rotation.x = -s * 0.8;
    this.armR.rotation.x = s * 0.8;
    // A bob while walking, a slow breath while standing.
    this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.04 * this.swing + Math.sin(time * 2) * 0.006 * (1 - this.swing);
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) mat.dispose();
    });
  }
}
