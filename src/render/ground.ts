import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PROPS } from '../content/props';
import { ROUTINE } from '../content/routine';
import { KEY, TILE } from '../sim/world/tiles';
import { MAP_H, MAP_W, type World } from '../sim/world/World';
import type { Pitch, PrisonDef } from '../content/prisons/types';
import type { SimContext } from '../sim/context';
import { drillOn } from '../sim/systems/calendar';
import { seeded } from './rand';

/**
 * Two baked layers over the floors, drawn once per prison on canvases:
 * - paint: road dashes, the roll call box and its standing spots, hazard stripes at
 *   detectors and gates (alpha-blended);
 * - contact shadows: a blurred map of what stands on the floor (walls, furniture), multiplied
 *   over everything, so walls sit in soft corners and furniture on soft shadows (baked
 *   ambient occlusion, free at run time and on every phone).
 *
 * The two canvases (about 7 MB on the GPU) are kept for the last prison drawn and used again
 * while what they show is the same (P25: a replay's Watch again, Play again, the title's
 * backdrop of the same prison); drawing another prison's frees them. They are the cache's,
 * never the view's: a view's dispose leaves them (`groundTextures` lists them).
 */
export function buildGround(world: World, pitch: Pitch | null = world.def.leisure?.pitch ?? null): THREE.Group {
  const key = `${fingerprint(world)}:${pitch ? `${pitch.x},${pitch.z},${pitch.w},${pitch.d}` : '-'}`;
  if (cached?.key !== key) {
    cached?.paint.dispose();
    cached?.ao.dispose();
    cached = { key, paint: paintLayer(world, pitch), ao: contactShadows(world) };
  }
  const group = new THREE.Group();
  const shade = () => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  group.add(
    overlay(cached.paint, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 0.002, 0.1),
    overlay(cached.ao, shade(), 0.004, 0.2),
  );
  // (Past the edge: round the sea, and round the manhunt's outside, whose ground runs on out; a prison's own fields stay as they're tinted.)
  if (world.def.theme === 'island' || world.def.id.startsWith('outside-')) {
    const outer = shade();
    outer.vertexColors = true;
    group.add(outerShade(world, outer));
  }
  return group;
}

/** The last prison's canvases, and what they were drawn from. */
let cached: { key: string; paint: THREE.CanvasTexture; ao: THREE.CanvasTexture } | null = null;

/** The ground textures held for reuse (a view's dispose leaves these to the cache). */
export function groundTextures(): readonly THREE.Texture[] {
  return cached ? [cached.paint, cached.ao] : [];
}

/**
 * The contact shadows' layer carries on past the map's edge (P41 review: the manhunt's map, and
 * Irongate's sea, showed a hard rectangle where it stopped): the same multiplied layer, so the
 * same tone (the renderer's tone curve takes a little off even its white), and on open ground the
 * same average shade as its patches (sea and rivers none, as on the map). Four strips round the
 * map, a vertex at each tile's corner, its shade in the vertex colours (no canvas to keep).
 */
function outerShade(world: World, material: THREE.MeshBasicMaterial): THREE.Mesh {
  const island = world.def.theme === 'island';
  const open = new THREE.Color().setRGB(OUTER_OPEN, OUTER_OPEN, Math.min(1, OUTER_OPEN + 6 / 255), THREE.SRGBColorSpace);
  const white = new THREE.Color(1, 1, 1);
  const strips: THREE.BufferGeometry[] = [];
  const strip = (x0: number, z0: number, x1: number, z1: number, across: boolean) => {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      const x = Math.round(pos.getX(k));
      const z = Math.round(pos.getZ(k));
      // (Straight out from an edge tile, north or south (`across`), west or east: its kind, a river carrying on; off a corner: the fields.)
      const corner = across ? x < 0 || x > MAP_W : z < 0 || z > MAP_H;
      const edge = corner ? TILE.GRASS : world.ground.kind[Math.min(MAP_H - 1, Math.max(0, z)) * MAP_W + Math.min(MAP_W - 1, Math.max(0, x))];
      (island || edge === TILE.WATER ? white : open).toArray(colors, k * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    strips.push(g);
  };
  strip(-OUTER, -OUTER, MAP_W + OUTER, 0, true);
  strip(-OUTER, MAP_H, MAP_W + OUTER, MAP_H + OUTER, true);
  strip(-OUTER, 0, 0, MAP_H, false);
  strip(MAP_W, 0, MAP_W + OUTER, MAP_H, false);
  const mesh = new THREE.Mesh(mergeGeometries(strips), material);
  for (const g of strips) g.dispose();
  mesh.position.y = 0.004;
  mesh.renderOrder = 0.2;
  return mesh;
}

/** How far past the map's edge the outer shade reaches (tiles), each way. */
const OUTER = MAP_W;
/** Open ground's patches' average shade on the map (contactShadows: 1 − 0.2 × a tone about ½ on average). */
const OUTER_OPEN = 0.9;

/** What the canvases show depends on: the prison, its ground floor's tiles and keys (a save's dug walls), the furniture (and the pitch in use: buildGround). */
function fingerprint(world: World): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => (h = Math.imul(h ^ v, 0x01000193));
  for (const a of [world.ground.kind, world.ground.key]) for (let i = 0; i < a.length; i++) mix(a[i]);
  for (const p of world.props) {
    mix(p.x);
    mix(p.z);
    mix(p.w * 16 + p.d);
    mix(p.kind.length);
  }
  return `${world.def.id}:${world.props.length}:${(h >>> 0).toString(36)}`;
}

/** (Floor decals draw under P17's fog veil, at renderOrder 0.5: orders below it, their own order kept.) */
function overlay(tex: THREE.Texture, material: THREE.MeshBasicMaterial, y: number, order: number): THREE.Mesh {
  material.map = tex;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H).rotateX(-Math.PI / 2), material);
  mesh.position.set(MAP_W / 2, y, MAP_H / 2);
  mesh.renderOrder = order;
  return mesh;
}

/** A canvas as a texture (`mipmaps` off for a blurred one: never shrunk enough on screen to need them). */
function canvasTexture(canvas: HTMLCanvasElement, mipmaps: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (mipmaps) tex.anisotropy = 4;
  else {
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
  }
  return tex;
}

// ------------------------------------------------------------------ paint
const PAINT_RES = 16;

function paintLayer(world: World, pitch: Pitch | null): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_W * PAINT_RES;
  canvas.height = MAP_H * PAINT_RES;
  const c = canvas.getContext('2d')!;
  const R = PAINT_RES;
  const kind = (x: number, z: number) => (world.inside(x, z) ? world.ground.kind[z * MAP_W + x] : TILE.EMPTY);

  // Road: a dashed yellow center line along the ring (an island has no road round it, nor the manhunt's outside, P41).
  c.fillStyle = 'rgba(242, 194, 48, 0.85)';
  for (let i = 2; i < MAP_W - 2 && world.def.theme !== 'island' && !world.def.id.startsWith('outside-'); i += 2) {
    c.fillRect(i * R + 2, 1 * R - 1, R - 4, 2);
    c.fillRect(i * R + 2, (MAP_H - 1) * R - 1, R - 4, 2);
    c.fillRect(1 * R - 1, i * R + 2, 2, R - 4);
    c.fillRect((MAP_W - 1) * R - 1, i * R + 2, 2, R - 4);
  }

  // Roll call: a painted border and a box per standing spot (P29: on its own layer where it would cross the football pitch).
  if (!rollCallOverPitch(world.def, pitch)) drawRollCall(c, world.def, 0, 0);

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
  return canvasTexture(canvas, true);
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
 * roll call only, and the pitch's lines are left clean the rest of the day. `p`: the pitch in use
 * (a 2.5.0 replay's is the one it had then: football.ts pitchOf).
 */
export function rollCallOverPitch(def: PrisonDef, p: Pitch | null | undefined = def.leisure?.pitch): boolean {
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
export function rollCallLayer(world: World, pitch: Pitch | null = world.def.leisure?.pitch ?? null): THREE.Mesh | null {
  const b = rollCallOverPitch(world.def, pitch) ? rollCallBounds(world.def) : null;
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

function contactShadows(world: World): THREE.CanvasTexture {
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
  const rand = seeded(0x9e3779b9);
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
  return canvasTexture(canvas, false);
}
