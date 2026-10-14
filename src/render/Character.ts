import * as THREE from 'three';

export interface Look {
  outfit: number;
  skin: number;
  hair: number;
  /** Shown when the character is hidden behind something (the player only). */
  silhouette?: number;
}

/** The orange jumpsuit (tech plan §6.2). */
export const INMATE_LOOK: Look = { outfit: 0xf2701c, skin: 0xe2ad84, hair: 0x3a2a1e, silhouette: 0xffa64d };

/** The player's pixels mark the stencil, so the silhouette is drawn only where they're hidden. */
const STENCIL_MARK: Partial<THREE.MeshStandardMaterialParameters> = {
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.AlwaysStencilFunc,
  stencilZPass: THREE.ReplaceStencilOp,
};

/**
 * A blocky character, a 3D take on the Escapists sprites: a big head with blinking eyes,
 * a jumpsuit with a number patch and rolled sleeves, arms and legs on pivots. Faces +z at
 * rotation 0; about 1.25 tiles tall. When given a silhouette color, it shows through walls
 * and furniture as a flat tint wherever something hides it (stencil-masked, so it never
 * tints itself).
 */
export class Character {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly eyes: THREE.Mesh[] = [];
  private readonly armL: THREE.Group;
  private readonly armR: THREE.Group;
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private phase = 0;
  private swing = 0;
  private blinkAt = 2;
  private idle = 0;
  private glance = 0;
  private glanceGoal = 0;

  constructor(look: Look) {
    const marks = look.silhouette !== undefined ? STENCIL_MARK : {};
    const mat = (color: number, rough = 0.8) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...marks });
    const outfit = mat(look.outfit);
    const outfitDark = mat(new THREE.Color(look.outfit).multiplyScalar(0.78).getHex());
    const skin = mat(look.skin, 0.75);
    const hair = mat(look.hair, 0.9);
    const white = mat(0xf2f2ee);
    const dark = mat(0x1b1b22, 0.4);
    const shoe = mat(0x2a2a30);

    const part = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // Legs: pivots at the hips.
    const leg = (x: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.4, 0);
      part(0.19, 0.34, 0.2, outfit, 0, -0.17, 0, pivot);
      part(0.21, 0.08, 0.27, shoe, 0, -0.36, 0.03, pivot);
      return pivot;
    };
    this.legL = leg(-0.11);
    this.legR = leg(0.11);

    // Torso: the jumpsuit, a white collar, the number patch.
    part(0.52, 0.42, 0.3, outfit, 0, 0.6, 0, this.body);
    part(0.53, 0.06, 0.31, outfitDark, 0, 0.42, 0, this.body);
    part(0.2, 0.06, 0.02, white, 0, 0.79, 0.152, this.body);
    part(0.13, 0.08, 0.02, white, 0.12, 0.66, 0.152, this.body);
    part(0.08, 0.015, 0.025, dark, 0.12, 0.665, 0.153, this.body);

    // Arms: pivots at the shoulders; sleeves rolled up to the elbow.
    const arm = (x: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.78, 0);
      part(0.15, 0.2, 0.16, outfit, 0, -0.1, 0, pivot);
      part(0.13, 0.15, 0.14, skin, 0, -0.27, 0, pivot);
      part(0.14, 0.09, 0.15, skin, 0, -0.38, 0, pivot);
      return pivot;
    };
    this.armL = arm(-0.34);
    this.armR = arm(0.34);

    // Head: a big block with eyes that blink, brows, a nose, a mouth, short hair.
    this.head.position.y = 0.8;
    part(0.46, 0.44, 0.44, skin, 0, 0.22, 0, this.head);
    for (const s of [-1, 1]) {
      this.eyes.push(part(0.065, 0.09, 0.02, dark, s * 0.1, 0.24, 0.222, this.head));
      part(0.11, 0.035, 0.02, hair, s * 0.1, 0.32, 0.222, this.head);
    }
    part(0.06, 0.07, 0.04, skin, 0, 0.18, 0.235, this.head);
    part(0.11, 0.025, 0.02, mat(0x8a4b3a), 0, 0.1, 0.222, this.head);
    part(0.48, 0.1, 0.46, hair, 0, 0.47, -0.01, this.head);
    part(0.48, 0.26, 0.08, hair, 0, 0.33, -0.21, this.head);
    part(0.05, 0.14, 0.4, hair, -0.23, 0.36, -0.02, this.head);
    part(0.05, 0.14, 0.4, hair, 0.23, 0.36, -0.02, this.head);

    this.body.add(this.legL, this.legR, this.armL, this.armR, this.head);
    this.root.add(this.body);

    if (look.silhouette !== undefined) this.addSilhouette(look.silhouette);
  }

  /** A flat copy of every part, drawn only where something stands in front of the character. */
  private addSilhouette(color: number) {
    const ghost = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      depthFunc: THREE.GreaterDepth,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
    });
    const meshes: THREE.Mesh[] = [];
    this.root.traverse((o) => o instanceof THREE.Mesh && meshes.push(o));
    for (const m of meshes) {
      const copy = new THREE.Mesh(m.geometry, ghost);
      copy.renderOrder = 20;
      m.add(copy);
    }
  }

  /**
   * Places and animates the character. `facing` in radians (0 = +z); `moving` swings the
   * limbs. Returns true on the frame a foot lands (for footstep sounds and dust).
   */
  pose(x: number, z: number, facing: number, moving: boolean, dt: number, time: number, motion = true): boolean {
    this.root.position.set(x, 0, z);
    // Turn the short way round, quickly.
    let d = facing - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * Math.min(1, dt * 14);
    this.swing += ((moving ? 1 : 0) - this.swing) * Math.min(1, dt * 10);
    let stepped = false;
    if (moving) {
      const before = Math.floor(this.phase / Math.PI);
      this.phase += dt * 11;
      stepped = Math.floor(this.phase / Math.PI) !== before;
    }
    const s = Math.sin(this.phase) * 0.75 * this.swing;
    this.legL.rotation.x = s;
    this.legR.rotation.x = -s;
    this.armL.rotation.x = -s * 0.85;
    this.armR.rotation.x = s * 0.85;
    // A bob and a little forward lean while walking, a slow breath while standing.
    this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.045 * this.swing + (motion ? Math.sin(time * 2.2) * 0.006 * (1 - this.swing) : 0);
    this.body.rotation.x = 0.08 * this.swing;

    // Blink every few seconds.
    this.blinkAt -= dt;
    const closed = this.blinkAt < 0.12;
    if (this.blinkAt < 0) this.blinkAt = 2 + Math.random() * 3.5;
    for (const e of this.eyes) e.scale.y = closed ? 0.15 : 1;

    // Standing still for a while: glance around now and then.
    this.idle = moving ? 0 : this.idle + dt;
    if (this.idle > 2.5 && motion && Math.random() < dt * 0.6) this.glanceGoal = (Math.random() - 0.5) * 1.1;
    if (this.idle === 0) this.glanceGoal = 0;
    this.glance += (this.glanceGoal - this.glance) * Math.min(1, dt * 5);
    this.head.rotation.y = this.glance;
    return stepped;
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
