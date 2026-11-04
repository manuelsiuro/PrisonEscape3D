import * as THREE from 'three';
import type { Prop } from '../sim/world/World';

/** Drops falling from one head. */
const DROPS = 12;
/** Soft clouds of steam rising from one. */
const STEAM = 3;
/** The head's height, and where its water lands. */
const HEAD_Y = 1.62;
const FLOOR_Y = 0.014;
/** The water coming on and going off (per second), and the floor getting wet and drying. */
const FLOW_RATE = 5;
const WET_RATE = 0.35;
const DRY_RATE = 0.06;
/** A head's rose stands this far forward of the tile's middle, in the prop's own frame. */
const ROSE_Z = -0.05;

function softPuff(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

interface Head {
  tile: number;
  x: number;
  z: number;
  /** 0–1: how much water falls. */
  flow: number;
  /** 0–1: how wet its floor is. */
  wet: number;
  /** Where its drops and clouds are in their cycles. */
  seed: number;
}

/**
 * The water at the shower heads (2.26). It belongs to the head, not to whoever stands under it, and runs
 * while someone washes there: drops and a faint cone from the rose, a wet patch that spreads and slowly
 * dries, steam rising. Everything's instanced in one group: a few draw calls however many are running.
 * With reduced motion the drops and the steam hold still rather than vanish, since they say the water's on.
 */
export class ShowerWater {
  readonly group = new THREE.Group();
  private heads: Head[] = [];
  private readonly drops: THREE.InstancedMesh;
  private readonly cones: THREE.InstancedMesh;
  private readonly wetFloor: THREE.InstancedMesh;
  private readonly steam: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private readonly c = new THREE.Color();

  constructor() {
    const water = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    const most = 16;
    this.drops = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, 0.3, 0.04), water(0xeefaff, 0.95), most * DROPS);
    this.cones = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.36, HEAD_Y, 14, 1, true).translate(0, -HEAD_Y / 2, 0), water(0xcfeeff, 0.34), most);
    // (A soft edge: a wet floor has no rim.)
    const puff = softPuff();
    this.wetFloor = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: puff, color: 0x1c2a36, transparent: true, opacity: 0.5, depthWrite: false }), most);
    this.steam = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: puff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      most * STEAM,
    );
    this.steam.setColorAt(0, this.c.set(0));
    for (const mesh of [this.wetFloor, this.cones, this.drops, this.steam]) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      this.group.add(mesh);
    }
    this.wetFloor.renderOrder = 1;
    this.group.visible = false;
  }

  /** A new world's heads, dry and off. */
  setWorld(props: readonly Prop[], mapW: number) {
    this.heads = props
      .filter((p) => p.kind === 'shower')
      .map((p, k) => {
        const turn = ((p.rot ?? 0) * Math.PI) / 2;
        return { tile: p.z * mapW + p.x, x: p.x + 0.5 + ROSE_Z * Math.sin(turn), z: p.z + 0.5 + ROSE_Z * Math.cos(turn), flow: 0, wet: 0, seed: (k * 0.37) % 1 };
      })
      .slice(0, 16);
  }

  /** Per frame: `running` holds the tiles of the heads someone's washing under; `camera` is what the steam turns to. */
  update(dt: number, time: number, motion: boolean, running: ReadonlySet<number>, camera: THREE.Camera) {
    let drop = 0;
    let shown = 0;
    let wetShown = 0;
    let puff = 0;
    this.q.copy(camera.quaternion);
    for (const h of this.heads) {
      const on = running.has(h.tile);
      h.flow = motion ? Math.max(0, Math.min(1, h.flow + (on ? 1 : -1) * dt * FLOW_RATE)) : on ? 1 : 0;
      h.wet = Math.max(0, Math.min(1, h.wet + (on ? WET_RATE : -DRY_RATE) * dt));
      if (h.wet > 0.01) {
        const r = 1 + h.wet * 0.9;
        this.wetFloor.setMatrixAt(wetShown++, this.m.compose(this.p.set(h.x, FLOOR_Y, h.z), this.flat, this.s.set(r, r, 1)));
      }
      if (h.flow <= 0.01) continue;
      const f = h.flow;
      this.cones.setMatrixAt(shown++, this.m.makeScale(f, 1, f).setPosition(h.x, HEAD_Y, h.z));
      for (let k = 0; k < DROPS; k++) {
        const a = (k * 2.399 + h.seed * 6.28) % 6.283;
        const spread = 0.2 + ((k * 0.618) % 1) * 0.2;
        const fall = motion ? (time * 2.4 + h.seed + k / DROPS) % 1 : (k + 0.5) / DROPS;
        this.m.makeTranslation(h.x + Math.cos(a) * spread * (0.3 + fall), HEAD_Y - 0.12 - fall * (HEAD_Y - 0.2), h.z + Math.sin(a) * spread * (0.3 + fall));
        this.drops.setMatrixAt(drop++, this.m);
      }
      for (let k = 0; k < STEAM; k++) {
        const age = motion ? (time * 0.16 + h.seed + k / STEAM) % 1 : (k + 0.5) / STEAM;
        const size = (0.7 + age * 0.9) * f;
        const a = h.seed * 6.28 + k * 2.1;
        this.p.set(h.x + Math.cos(a) * (0.12 + age * 0.3), 0.8 + age * 1.15, h.z + Math.sin(a) * (0.12 + age * 0.3));
        this.steam.setMatrixAt(puff, this.m.compose(this.p, this.q, this.s.set(size, size, 1)));
        // (Added light: how strong a cloud is, faded in and out by its colour.)
        this.steam.setColorAt(puff++, this.c.setScalar(0.07 * f * Math.sin(age * Math.PI)));
      }
    }
    for (const [mesh, n] of [[this.drops, drop], [this.cones, shown], [this.wetFloor, wetShown], [this.steam, puff]] as const) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.steam.instanceColor!.needsUpdate = true;
    this.group.visible = wetShown > 0 || shown > 0;
  }
}
