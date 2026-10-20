import * as THREE from 'three';
import { PROPS } from '../content/props';
import { ROUTINE } from '../content/routine';
import { KEY, TILE } from '../sim/world/tiles';
import { MAP_H, MAP_W, type World } from '../sim/world/World';
import type { PrisonDef } from '../content/prisons/types';
import type { SimContext } from '../sim/context';
import { drillOn } from '../sim/systems/calendar';

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

/** (Floor decals draw under P17's fog veil, at renderOrder 0.5: orders below it, their own order kept.) */
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

  // Road: a dashed yellow center line along the ring (an island has no road round it).
  c.fillStyle = 'rgba(242, 194, 48, 0.85)';
  for (let i = 2; i < MAP_W - 2 && world.def.theme !== 'island'; i += 2) {
    c.fillRect(i * R + 2, 1 * R - 1, R - 4, 2);
    c.fillRect(i * R + 2, (MAP_H - 1) * R - 1, R - 4, 2);
    c.fillRect(1 * R - 1, i * R + 2, 2, R - 4);
    c.fillRect((MAP_W - 1) * R - 1, i * R + 2, 2, R - 4);
  }

  // Roll call: a painted border and a box per standing spot (P29: on its own layer where it would cross the football pitch).
  if (!rollCallOverPitch(world.def)) drawRollCall(c, world.def, 0, 0);

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
  return overlay(canvas, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 0.002, 0.1);
}

// ------------------------------------------------------------------ roll call over the pitch

/** The roll call's paint, its border round the zone and a box per standing spot, drawn with (ox, oz) as the canvas's corner (tiles). */
function drawRollCall(c: CanvasRenderingContext2D, def: PrisonDef, ox: number, oz: number) {
  const R = PAINT_RES;
  const yard = def.zones.find(([id]) => id === 'rollCall');
  if (yard) {
    const [, x0, z0, x1, z1] = yard;
    c.strokeStyle = 'rgba(242, 194, 48, 0.9)';
    c.lineWidth = 2;
    c.strokeRect((x0 - ox) * R + 6, (z0 - oz) * R + 6, (x1 - x0 + 1) * R - 12, (z1 - z0 + 1) * R - 12);
  }
  c.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  c.lineWidth = 2;
  for (const s of def.rollCall) {
    c.strokeRect((s.x - ox) * R + 3, (s.z - oz) * R + 3, R - 6, R - 6);
    c.fillStyle = 'rgba(255, 255, 255, 0.85)';
    c.fillRect((s.x - ox) * R + R / 2 - 1, (s.z - oz) * R + R / 2 - 1, 2, 2);
  }
}

/** The tiles the roll call's paint covers (its zone and its standing spots), null for none. */
function rollCallBounds(def: PrisonDef): { x0: number; z0: number; x1: number; z1: number } | null {
  const yard = def.zones.find(([id]) => id === 'rollCall');
  let b = yard ? { x0: yard[1], z0: yard[2], x1: yard[3], z1: yard[4] } : null;
  for (const s of def.rollCall) b = b ? { x0: Math.min(b.x0, s.x), z0: Math.min(b.z0, s.z), x1: Math.max(b.x1, s.x), z1: Math.max(b.z1, s.z) } : { x0: s.x, z0: s.z, x1: s.x, z1: s.z };
  return b;
}

/**
 * Whether the roll call's paint would cross the football pitch (P29: Stalag Flucht's and
 * Shankton's roll call squares are their pitches): it goes on a layer of its own then, shown for
 * roll call only, and the pitch's lines are left clean the rest of the day.
 */
export function rollCallOverPitch(def: PrisonDef): boolean {
  const p = def.leisure?.pitch;
  const b = rollCallBounds(def);
  return !!p && !!b && b.x0 < p.x + p.w && b.x1 >= p.x && b.z0 < p.z + p.d && b.z1 >= p.z;
}

/** How long before roll call its paint over the pitch shows (game minutes): time to find a box. */
export const ROLL_CALL_LEAD = 20;

/** Whether roll call is on (the routine's block `routine` is one), or starts within ROLL_CALL_LEAD of `minute`. */
export function rollCallSoon(routine: number, minute: number): boolean {
  const now = ROUTINE[routine];
  if (now?.zones.includes('rollCall')) return true;
  const next = ROUTINE[(routine + 1) % ROUTINE.length];
  return !!next?.zones.includes('rollCall') && (next.start - minute + 1440) % 1440 <= ROLL_CALL_LEAD;
}

/**
 * Whether the roll call's marks over a pitch show now: roll call and the minutes before it, and
 * a fire drill (P17), which musters everyone there outside the routine.
 */
export function rollCallShows(sim: Pick<SimContext, 'prison' | 'state'>, minute: number): boolean {
  return drillOn(sim) || rollCallSoon(sim.state.routine, minute);
}

/** That layer (null where the roll call keeps off the pitch): a decal over the roll call's tiles, faded in and out by its material's opacity. */
export function rollCallLayer(world: World): THREE.Mesh | null {
  const b = rollCallOverPitch(world.def) ? rollCallBounds(world.def) : null;
  if (!b) return null;
  const w = b.x1 - b.x0 + 1;
  const d = b.z1 - b.z0 + 1;
  const canvas = document.createElement('canvas');
  canvas.width = w * PAINT_RES;
  canvas.height = d * PAINT_RES;
  drawRollCall(canvas.getContext('2d')!, world.def, b.x0, b.z0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), material);
  mesh.position.set(b.x0 + w / 2, 0.012, b.z0 + d / 2);
  // (Over the pitch's lines while it shows, under the fog veil.)
  mesh.renderOrder = 0.3;
  mesh.visible = false;
  return mesh;
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
  // Broad, soft patches over the open ground (lusher and drier grass, worn sand, patched
  // asphalt), so the one-tile texture never reads as a grid. A fixed seed: the same every load.
  const tone = new Float32Array(W * H);
  let seed = 0x9e3779b9;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < W * H; i++) tone[i] = rand();
  blur(tone, W, H, 10, 3);
  let mean = 0;
  for (const t of tone) mean += t;
  mean /= tone.length;
  let sd = 0;
  for (const t of tone) sd += (t - mean) ** 2;
  sd = Math.sqrt(sd / tone.length) || 1;
  const OPEN = new Set<number>([TILE.GRASS, TILE.DIRT, TILE.ROAD, TILE.ASPHALT, TILE.MINE]);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d')!;
  const img = c.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    // White = untouched; darker toward walls and under furniture.
    const tile = Math.floor(i / W / AO_RES) * MAP_W + Math.floor((i % W) / AO_RES);
    // (Blurred noise has a narrow spread: two deviations either side stretched to 0..1.)
    const t = Math.min(1, Math.max(0, 0.5 + (tone[i] - mean) / (4 * sd)));
    const patch = OPEN.has(world.ground.kind[tile]) ? 1 - 0.2 * t : 1;
    const v = Math.round(255 * (1 - 0.72 * Math.min(1, cover[i] * 1.3)) * patch);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = Math.min(255, v + 6);
    img.data[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return overlay(canvas, material, 0.004, 0.2);
}
