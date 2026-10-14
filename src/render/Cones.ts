import * as THREE from 'three';
import { SIGHT_HALF_ANGLE, SIGHT_RANGE, sightReach } from '../sim/ai/sight';
import { ALERT } from '../sim/systems/guards';
import { UNIT } from '../sim/tuning';
import type { World } from '../sim/world/World';

/** Rays per cone: enough for walls to cut clean edges. */
const RAYS = 28;
const RANGE = SIGHT_RANGE / UNIT;
/** Yellow (calm), orange (investigating), red (chasing): GDD §5.1. */
const COLORS: Record<number, number> = { [ALERT.CALM]: 0xffe066, [ALERT.SUSPICIOUS]: 0xff9a2e, [ALERT.HOSTILE]: 0xff3b30 };

/** Brighter near the guard, fading out toward the edge of sight (a 1D gradient along v). */
let fadeTexture: THREE.CanvasTexture | null = null;
function fade(): THREE.CanvasTexture {
  if (fadeTexture) return fadeTexture;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0.08)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  fadeTexture = new THREE.CanvasTexture(c);
  fadeTexture.colorSpace = THREE.SRGBColorSpace;
  return fadeTexture;
}

export interface ConeFrame {
  x: number;
  z: number;
  /** Radians, 0 = facing +z (the view's convention). */
  facing: number;
  /** ALERT (sim/systems/guards.ts): NONE hides the cone. */
  alert: number;
}

interface Cone {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  positions: Float32Array;
  uvs: Float32Array;
  /** The angle drawn (eased toward the guard's heading) and the color. */
  angle: number;
  color: THREE.Color;
  shown: number;
}

/**
 * Guards' vision cones on the floor (GDD §5.1): a fan of rays from each guard, each cut
 * where sight stops (walls, shut doors; the same test the rules use), tinted by alert.
 * Buffers are made once per guard and refilled every frame. The angle eases so a guard
 * glancing around sweeps its cone instead of snapping it.
 */
export class Cones {
  readonly group = new THREE.Group();
  private cones: Cone[] = [];
  world: World | null = null;

  /** One cone per guard. */
  setCount(n: number) {
    for (const c of this.cones) {
      this.group.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.material.dispose();
    }
    this.cones = [];
    for (let k = 0; k < n; k++) {
      const positions = new Float32Array((RAYS + 2) * 3);
      const uvs = new Float32Array((RAYS + 2) * 2);
      const index: number[] = [];
      for (let r = 0; r < RAYS; r++) index.push(0, r + 2, r + 1);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2).setUsage(THREE.DynamicDrawUsage));
      geometry.setIndex(index);
      const material = new THREE.MeshBasicMaterial({ map: fade(), transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 1;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.cones.push({ mesh, material, positions, uvs, angle: NaN, color: new THREE.Color(), shown: 0 });
    }
  }

  /** Redraws every cone; `night` (0–1) makes them a little stronger in the dark. */
  update(guards: readonly ConeFrame[], dt: number, night: number, motion: boolean) {
    const w = this.world;
    this.cones.forEach((c, k) => {
      const g = guards[k];
      const on = !!g && !!w && g.alert !== ALERT.NONE;
      c.shown += ((on ? 1 : 0) - c.shown) * Math.min(1, dt * 6);
      c.mesh.visible = c.shown > 0.02;
      if (!c.mesh.visible || !g || !w) return;
      // Ease toward the heading the short way round (in the sim's angle: 0 = +x).
      const goal = Math.PI / 2 - g.facing;
      if (Number.isNaN(c.angle) || !motion) c.angle = goal;
      else {
        const d = Math.atan2(Math.sin(goal - c.angle), Math.cos(goal - c.angle));
        c.angle += d * Math.min(1, dt * 18);
      }
      const p = c.positions;
      const uv = c.uvs;
      p[0] = g.x;
      p[1] = 0.05;
      p[2] = g.z;
      uv[0] = 0.5;
      uv[1] = 1;
      for (let r = 0; r <= RAYS; r++) {
        const a = c.angle - SIGHT_HALF_ANGLE + (2 * SIGHT_HALF_ANGLE * r) / RAYS;
        const reach = sightReach(w, g.x, g.z, a);
        p[(r + 1) * 3] = g.x + Math.cos(a) * reach;
        p[(r + 1) * 3 + 1] = 0.05;
        p[(r + 1) * 3 + 2] = g.z + Math.sin(a) * reach;
        uv[(r + 1) * 2] = 0.5;
        uv[(r + 1) * 2 + 1] = 1 - reach / RANGE;
      }
      c.mesh.geometry.attributes.position.needsUpdate = true;
      c.mesh.geometry.attributes.uv.needsUpdate = true;
      c.mesh.geometry.computeBoundingSphere();
      c.color.set(COLORS[g.alert] ?? COLORS[ALERT.CALM]);
      c.material.color.copy(c.color);
      const strength = g.alert === ALERT.HOSTILE ? 0.44 : g.alert === ALERT.SUSPICIOUS ? 0.38 : 0.32;
      c.material.opacity = c.shown * (strength + night * 0.12);
    });
  }

  dispose() {
    this.setCount(0);
  }
}
