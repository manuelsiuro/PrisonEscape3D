import * as THREE from 'three';
import { itemDef } from '../content/items';
import { box, merge, paint, type Part } from './kit';

/** What the view needs of a rat (P20), interpolated like everyone else. */
export interface RatFrame {
  x: number;
  z: number;
  /** Radians, 0 = facing +z. */
  facing: number;
  /** On the player's shoulder, running (an errand, coming back), darting about loose, out of sight (waiting, or in a duct over a wall). */
  mode: 'shoulder' | 'run' | 'loose' | 'hidden';
  /** What it carries in its teeth (an item number, 0 nothing). */
  carry: number;
}

const FUR = 0x6e5d52;
const PINK = 0xe2a0ae;
const TAIL = 0xd89aa0;
const EYE = 0x141414;
const RIM = 0xd9cabd;
/** The most rats on screen at once: the pet and a few thrown loose. */
const MAX_RATS = 4;
/** Its size on the floor, and on a shoulder (a little smaller: it curls up). */
const SIZE = 1.5;
const PERCHED = 1.1;

/** A ball scaled into an ellipsoid (rx, ry, rz) with its middle at (x, y, z). */
function blob(rx: number, ry: number, rz: number, color: number, x = 0, y = 0, z = 0, seg = 10): Part {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, seg - 2));
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return paint(g, color);
}

/** The body and head, nose along +z, feet on y = 0 (one geometry: one draw call a rat). */
function bodyGeometry(): THREE.BufferGeometry {
  const head = new THREE.ConeGeometry(0.042, 0.12, 9);
  head.rotateX(Math.PI / 2);
  head.translate(0, 0.075, 0.165);
  return merge(
    [
      blob(0.072, 0.062, 0.13, FUR, 0, 0.068, 0),
      paint(head, FUR),
      blob(0.014, 0.014, 0.014, PINK, 0, 0.074, 0.227, 6),
      // Ears lying back on the head, round from above.
      blob(0.028, 0.01, 0.024, PINK, -0.035, 0.112, 0.105, 8),
      blob(0.028, 0.01, 0.024, PINK, 0.035, 0.112, 0.105, 8),
      blob(0.011, 0.011, 0.011, EYE, -0.022, 0.09, 0.155, 6),
      blob(0.011, 0.011, 0.011, EYE, 0.022, 0.09, 0.155, 6),
      // Four little feet, tucked under the body.
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.022, 0.02, 0.03, PINK, sx * 0.04, 0, sz * 0.055))),
    ],
    false,
  );
}

/** The tail, from its root at the origin out along −z (wagged on its own). */
function tailGeometry(): THREE.BufferGeometry {
  // (Thick at its root, which rotateX sends to +z.)
  const g = new THREE.CylinderGeometry(0.013, 0.004, 0.26, 6);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, -0.13);
  return merge([paint(g, TAIL)], false);
}

interface Rig {
  root: THREE.Group;
  tail: THREE.Mesh;
  carry: THREE.Mesh;
  carried: number;
  /** Its running phase, how fast it runs now (0–1, eased), and its heading as drawn (eased round its way's corners). */
  gait: number;
  run: number;
  yaw: number;
}

/**
 * The rats (P20): the player's pet on their shoulder or out on its errands, and caught ones
 * thrown loose. Each a body (it casts a shadow) with a pale rim, a tail that wags and whatever it
 * carries in its teeth; three or four draw calls a rat on screen, none for one out of sight. Its material marks
 * the stencil as the player's does: perched, the player's see-through silhouette never paints it.
 */
export class Rats {
  readonly group = new THREE.Group();
  private readonly rigs: Rig[] = [];

  constructor() {
    const body = bodyGeometry();
    const tail = tailGeometry();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
    // A pale rim round the body (its back faces, a little larger): the dark rat reads on light floors, the rim on dark ones (grass, carpet).
    const rim = new THREE.SphereGeometry(1, 10, 8);
    rim.scale(0.082, 0.07, 0.142);
    rim.translate(0, 0.068, -0.005);
    const rimMat = new THREE.MeshBasicMaterial({ color: RIM, side: THREE.BackSide, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
    const carry = new THREE.BoxGeometry(0.07, 0.04, 0.07);
    for (let k = 0; k < MAX_RATS; k++) {
      const root = new THREE.Group();
      const b = new THREE.Mesh(body, material);
      b.castShadow = true;
      const t = new THREE.Mesh(tail, material);
      t.position.set(0, 0.05, -0.11);
      const c = new THREE.Mesh(carry, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 }));
      c.position.set(0, 0.055, 0.24);
      c.visible = false;
      root.add(b, new THREE.Mesh(rim, rimMat), t, c);
      root.visible = false;
      this.group.add(root);
      this.rigs.push({ root, tail: t, carry: c, carried: 0, gait: 0, run: 0, yaw: 0 });
    }
  }

  /**
   * Each frame: every rat where the sim has it (on the floor, or perched on the shoulder the
   * view gives, facing the way the player does), scurrying with its tail going, darting about
   * when loose; `floor` false: the player is off the ground floor (only a perched rat shows).
   */
  update(rats: readonly RatFrame[], shoulder: THREE.Vector3 | null, playerFacing: number, dt: number, time: number, motion: boolean, floor: boolean) {
    for (let k = 0; k < MAX_RATS; k++) {
      const r = rats[k];
      const rig = this.rigs[k];
      const perched = r?.mode === 'shoulder';
      const show = !!r && r.mode !== 'hidden' && (perched ? !!shoulder : floor);
      rig.root.visible = show;
      if (!show || !r) continue;
      const root = rig.root;
      const running = r.mode === 'run' || r.mode === 'loose';
      rig.run += ((running ? 1 : 0) - rig.run) * Math.min(1, dt * 10);
      rig.gait += dt * (r.mode === 'loose' ? 26 : 20);
      if (perched && shoulder) {
        // Along the shoulder, nose forward, swaying a little with each step.
        root.position.copy(shoulder);
        rig.yaw = playerFacing;
        root.rotation.set(0, playerFacing, 0);
        root.scale.setScalar(PERCHED);
        if (motion) root.position.y += Math.sin(time * 2.2) * 0.008;
      } else {
        root.position.set(r.x, 0, r.z);
        // (Round its way's corners in a quick ease, never a snap.)
        let d = r.facing - rig.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        rig.yaw += d * Math.min(1, dt * (motion ? 16 : 60));
        root.rotation.set(0, rig.yaw, 0);
        root.scale.setScalar(SIZE);
        // A scurry: a quick bob and a body wiggle.
        if (motion && rig.run > 0.05) {
          root.position.y = Math.abs(Math.sin(rig.gait)) * 0.018 * rig.run;
          root.rotation.y += Math.sin(rig.gait * 0.5) * 0.12 * rig.run;
        }
      }
      // The tail: a lazy sway perched, a quick wag running.
      rig.tail.rotation.y = motion ? Math.sin(perched ? time * 1.6 : rig.gait * 0.9) * (perched ? 0.35 : 0.5) : 0;
      rig.tail.rotation.x = perched ? -0.95 : -0.1;
      // What it carries: a little block in its item's colour.
      if (r.carry !== rig.carried) {
        rig.carried = r.carry;
        rig.carry.visible = r.carry > 0;
        if (r.carry > 0) (rig.carry.material as THREE.MeshStandardMaterial).color.set(itemDef(r.carry)?.color ?? 0xffffff);
      }
    }
  }
}
