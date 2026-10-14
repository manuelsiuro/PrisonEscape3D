import * as THREE from 'three';
import { PROPS } from '../content/props';
import { KEY, TILE } from '../sim/world/tiles';
import { MAP_H, MAP_W, type World } from '../sim/world/World';

/**
 * Two baked layers over the floors, drawn once per prison on canvases:
 * - paint: road dashes, the roll call box and its standing spots, hazard stripes at
 *   detectors and gates (alpha-blended);
 * - contact shadows: a blurred map of what stands on the floor (walls, furniture), multiplied
 *   over everything, so walls sit in soft corners and furniture on soft shadows (baked
 *   ambient occlusion, free at run time and on every phone).
 */
export function buildGround(world: World): THREE.Group {
  const group = new THREE.Group();
  group.add(paintLayer(world), contactShadows(world));
  return group;
}

function overlay(canvas: HTMLCanvasElement, material: THREE.MeshBasicMaterial, y: number, order: number): THREE.Mesh {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  material.map = tex;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H).rotateX(-Math.PI / 2), material);
  mesh.position.set(MAP_W / 2, y, MAP_H / 2);
  mesh.renderOrder = order;
  return mesh;
}

// ------------------------------------------------------------------ paint
const PAINT_RES = 16;

function paintLayer(world: World): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_W * PAINT_RES;
  canvas.height = MAP_H * PAINT_RES;
  const c = canvas.getContext('2d')!;
  const R = PAINT_RES;
  const kind = (x: number, z: number) => (world.inside(x, z) ? world.ground.kind[z * MAP_W + x] : TILE.EMPTY);

  // Road: a dashed yellow center line along the ring.
  c.fillStyle = 'rgba(242, 194, 48, 0.85)';
  for (let i = 2; i < MAP_W - 2; i += 2) {
    c.fillRect(i * R + 2, 1 * R - 1, R - 4, 2);
    c.fillRect(i * R + 2, (MAP_H - 1) * R - 1, R - 4, 2);
    c.fillRect(1 * R - 1, i * R + 2, 2, R - 4);
    c.fillRect((MAP_W - 1) * R - 1, i * R + 2, 2, R - 4);
  }

  // Roll call: a painted border and a box per standing spot.
  const yard = world.def.zones.find(([id]) => id === 'rollCall');
  if (yard) {
    const [, x0, z0, x1, z1] = yard;
    c.strokeStyle = 'rgba(242, 194, 48, 0.9)';
    c.lineWidth = 2;
    c.strokeRect(x0 * R + 6, z0 * R + 6, (x1 - x0 + 1) * R - 12, (z1 - z0 + 1) * R - 12);
  }
  c.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  c.lineWidth = 2;
  for (const s of world.def.rollCall) {
    c.strokeRect(s.x * R + 3, s.z * R + 3, R - 6, R - 6);
    c.fillStyle = 'rgba(255, 255, 255, 0.85)';
    c.fillRect(s.x * R + R / 2 - 1, s.z * R + R / 2 - 1, 2, 2);
  }

  // Hazard stripes under detector arches and gates.
  for (let z = 0; z < MAP_H; z++) {
    for (let x = 0; x < MAP_W; x++) {
      const k = kind(x, z);
      if (k !== TILE.DETECTOR && !(k === TILE.DOOR && world.ground.key[z * MAP_W + x] === KEY.GREEN)) continue;
      c.save();
      c.beginPath();
      c.rect(x * R, z * R, R, R);
      c.clip();
      c.fillStyle = 'rgba(25, 25, 25, 0.75)';
      c.fillRect(x * R, z * R, R, R);
      c.fillStyle = 'rgba(242, 194, 48, 0.9)';
      for (let k2 = -R; k2 < R * 2; k2 += 6) {
        c.beginPath();
        c.moveTo(x * R + k2, z * R);
        c.lineTo(x * R + k2 + 3, z * R);
        c.lineTo(x * R + k2 + 3 - R, z * R + R);
        c.lineTo(x * R + k2 - R, z * R + R);
        c.fill();
      }
      c.restore();
    }
  }
  return overlay(canvas, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 0.002, 1);
}

// ------------------------------------------------------------------ contact shadows
const AO_RES = 8;

/** Separable box blur, in place, `passes` times (three passes ≈ a gaussian). */
function blur(a: Float32Array, w: number, h: number, radius: number, passes: number) {
  const tmp = new Float32Array(a.length);
  const span = radius * 2 + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += a[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / span;
        sum += a[y * w + Math.min(w - 1, x + radius + 1)] - a[y * w + Math.max(0, x - radius)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / span;
        sum += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x];
      }
    }
  }
}

function contactShadows(world: World): THREE.Mesh {
  const W = MAP_W * AO_RES;
  const H = MAP_H * AO_RES;
  const cover = new Float32Array(W * H);
  const fill = (x0: number, z0: number, x1: number, z1: number, v: number) => {
    for (let y = Math.max(0, Math.floor(z0 * AO_RES)); y < Math.min(H, Math.ceil(z1 * AO_RES)); y++)
      for (let x = Math.max(0, Math.floor(x0 * AO_RES)); x < Math.min(W, Math.ceil(x1 * AO_RES)); x++) cover[y * W + x] = Math.max(cover[y * W + x], v);
  };
  for (let z = 0; z < MAP_H; z++) {
    for (let x = 0; x < MAP_W; x++) {
      const k = world.ground.kind[z * MAP_W + x];
      if (k === TILE.BRICK || k === TILE.REINFORCED || k === TILE.TOWER) fill(x, z, x + 1, z + 1, 1);
      else if (k === TILE.FENCE || k === TILE.ELECTRIC) fill(x + 0.35, z + 0.35, x + 0.65, z + 0.65, 0.5);
    }
  }
  for (const p of world.props) {
    const strength = PROPS[p.kind].solid ? 0.85 : 0.3;
    fill(p.x + 0.08, p.z + 0.08, p.x + p.w - 0.08, p.z + p.d - 0.08, strength);
  }
  blur(cover, W, H, 4, 3);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d')!;
  const img = c.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    // White = untouched; darker toward walls and under furniture.
    const v = Math.round(255 * (1 - 0.72 * Math.min(1, cover[i] * 1.3)));
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = Math.min(255, v + 6);
    img.data[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return overlay(canvas, material, 0.004, 2);
}
