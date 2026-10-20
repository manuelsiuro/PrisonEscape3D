import * as THREE from 'three';
import { TILE_INFO } from '../sim/world/tiles';
import { MAP_W, type World } from '../sim/world/World';
import { LAMP_ARM, LAMP_BULB_Y } from './props';

/** Zones lit by daylight only (open sky); every other zone gets ceiling lights at night. */
const OPEN_AIR = new Set(['outside', 'perimeter', 'rollCall', 'yard', 'none']);

/** A soft round glow, white in the middle and fading out: one for every prison (made once, never freed with a view). */
let glow: THREE.CanvasTexture | null = null;
function glowTexture(): THREE.CanvasTexture {
  return (glow ??= drawGlow());
}

function drawGlow(): THREE.CanvasTexture {
  const n = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const c = canvas.getContext('2d')!;
  const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, n, n);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Night lighting without dozens of real lights: lamp bulbs that glow, and light pools on the
 * ground (additive decals), warm sodium under the lamps, cool fluorescent in the rooms. Both
 * fade with `setNight` (0 day … 1 night).
 */
export class Lights {
  readonly group = new THREE.Group();
  private readonly bulbs: THREE.MeshBasicMaterial;
  private readonly warm: THREE.MeshBasicMaterial | null;
  private readonly cool: THREE.MeshBasicMaterial | null;

  constructor(world: World) {
    const tex = glowTexture();
    const lamps = world.props.filter((p) => p.kind === 'lamp');
    // Bulbs.
    this.bulbs = new THREE.MeshBasicMaterial({ color: 0x555555 });
    const bulbs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.05, 0.22), this.bulbs, Math.max(1, lamps.length));
    const m = new THREE.Matrix4();
    lamps.forEach((p, i) => bulbs.setMatrixAt(i, m.makeTranslation(p.x + 0.5, LAMP_BULB_Y - 0.03, p.z + 0.5 + LAMP_ARM)));
    bulbs.count = lamps.length;
    this.group.add(bulbs);

    // Warm pools under the lamps.
    this.warm = this.addPools(
      lamps.map((p) => [p.x + 0.5, p.z + 0.5 + LAMP_ARM, 7]),
      0xffb35c,
      tex,
    );

    // Cool pools in every room, about one per 5×5 tiles, only on walkable indoor floor.
    const spots: Array<[number, number, number]> = [];
    for (const [id, x0, z0, x1, z1] of world.def.zones) {
      if (OPEN_AIR.has(id)) continue;
      const nx = Math.max(1, Math.round((x1 - x0 + 1) / 5));
      const nz = Math.max(1, Math.round((z1 - z0 + 1) / 5));
      for (let a = 0; a < nx; a++) {
        for (let b = 0; b < nz; b++) {
          const x = x0 + ((a + 0.5) * (x1 - x0 + 1)) / nx;
          const z = z0 + ((b + 0.5) * (z1 - z0 + 1)) / nz;
          if (TILE_INFO[world.ground.kind[Math.floor(z) * MAP_W + Math.floor(x)]].solid) continue;
          spots.push([x, z, Math.min(6, Math.max(3.5, Math.min(x1 - x0 + 1, z1 - z0 + 1) * 1.1))]);
        }
      }
    }
    for (const [x0, z0, x1, z1] of world.def.cells) spots.push([(x0 + x1 + 1) / 2, (z0 + z1 + 1) / 2, 3.6]);
    this.cool = this.addPools(spots, 0xcfe6ff, tex);
  }

  private addPools(spots: Array<[number, number, number]>, color: number, map: THREE.Texture): THREE.MeshBasicMaterial | null {
    if (!spots.length) return null;
    const mat = new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, z, size], i) => mesh.setMatrixAt(i, m.makeScale(size, 1, size).setPosition(x, 0.008, z)));
    mesh.renderOrder = 0.32;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mat;
  }

  /** 0 in daylight, 1 at night; `power` 0–1 (the generator off: every lamp and room light goes dark, GDD §5.5). */
  setNight(night: number, power = 1) {
    const lit = night * power;
    this.bulbs.color.setRGB(0.33 + lit * 0.67, 0.33 + lit * 0.55, 0.33 + lit * 0.2);
    night = lit;
    for (const [mat, peak] of [
      [this.warm, 0.42],
      [this.cool, 0.3],
    ] as const) {
      if (!mat) continue;
      mat.opacity = night * peak;
      mat.visible = night > 0.01;
    }
  }
}
