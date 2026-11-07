/**
 * Gangs' turf painted on the floor (2.36, PrisonDef.gangs): each gang's canteen table and corner of the yard
 * outlined in its colour, dashed like a spray can's, with its tag (the Kitchen Crew's ladle, the Lifers' crown,
 * the Gym Rats' dumbbell) in a corner. Faint all day, bright while the gangs hold their turf (dinner and the
 * evening, once the player knows them: gangs.ts turfHeld). One flat layer over the ground, its own material.
 */
import * as THREE from 'three';
import { GANG_COLOR, type GangDef, type GangId } from '../content/gangs';
import type { World } from '../sim/world/World';
import { MAP_H, MAP_W } from '../sim/world/World';
import { canvasTexture } from './canvas';

const RES = 16;
/** How strong the paint is: faint while nobody holds the turf, bright while they do. */
const FAINT = 0.32;
const HELD = 0.85;

const rgba = (c: number, a: number) => `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`;

/** A gang's tag, about a tile across, centred on (x, y) in pixels. */
function tag(c: CanvasRenderingContext2D, id: GangId, x: number, y: number, width = true) {
  const r = RES * 0.42;
  if (width) c.lineWidth = 2.5;
  c.lineCap = 'round';
  c.beginPath();
  if (id === 'kitchen') {
    // A ladle: its bowl and its handle.
    c.arc(x - r * 0.25, y + r * 0.35, r * 0.45, 0, Math.PI * 2);
    c.moveTo(x - r * 0.25 + r * 0.32, y + r * 0.03);
    c.lineTo(x + r * 0.75, y - r * 0.85);
  } else if (id === 'lifers') {
    // A crown.
    c.moveTo(x - r, y + r * 0.6);
    c.lineTo(x - r, y - r * 0.5);
    c.lineTo(x - r * 0.45, y + r * 0.05);
    c.lineTo(x, y - r * 0.75);
    c.lineTo(x + r * 0.45, y + r * 0.05);
    c.lineTo(x + r, y - r * 0.5);
    c.lineTo(x + r, y + r * 0.6);
    c.closePath();
  } else {
    // A dumbbell.
    c.moveTo(x - r * 0.55, y);
    c.lineTo(x + r * 0.55, y);
    c.rect(x - r, y - r * 0.55, r * 0.4, r * 1.1);
    c.rect(x + r * 0.6, y - r * 0.55, r * 0.4, r * 1.1);
  }
  c.stroke();
}

/**
 * A rectangle of tiles outlined in dashes and the tag in its top-left tile: a corner's inset a little, a table's
 * a little outside it (its furniture covers the floor inside: the line runs round it, where it's seen).
 */
function paint(c: CanvasRenderingContext2D, g: GangDef, r: GangDef['table'], withTag: boolean, out = 0) {
  const col = GANG_COLOR[g.id];
  const x0 = r[0] * RES + 3 - out;
  const z0 = r[1] * RES + 3 - out;
  const w = (r[2] - r[0] + 1) * RES - 6 + out * 2;
  const d = (r[3] - r[1] + 1) * RES - 6 + out * 2;
  c.fillStyle = rgba(col, 0.12);
  c.fillRect(x0, z0, w, d);
  c.setLineDash([5, 3]);
  // (A dark edge under the colour: green on grass, blue in the dark, still read.)
  c.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  c.lineWidth = (out ? 3 : 2) + 2;
  c.strokeRect(x0, z0, w, d);
  c.strokeStyle = rgba(col, 0.95);
  c.lineWidth = out ? 3 : 2;
  c.strokeRect(x0, z0, w, d);
  c.setLineDash([]);
  if (withTag) {
    c.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    c.lineWidth = 4.5;
    tag(c, g.id, r[0] * RES + RES / 2, r[1] * RES + RES / 2, false);
    c.strokeStyle = rgba(col, 0.95);
    tag(c, g.id, r[0] * RES + RES / 2, r[1] * RES + RES / 2);
  }
}

/** The turf's layer for a prison (null without gangs). */
export function turfLayer(world: World): THREE.Mesh | null {
  const gangs = world.def.gangs;
  if (!gangs?.length) return null;
  const canvas = document.createElement('canvas');
  canvas.width = MAP_W * RES;
  canvas.height = MAP_H * RES;
  const c = canvas.getContext('2d')!;
  for (const g of gangs) {
    paint(c, g, g.table, false, 6);
    paint(c, g, g.corner, true);
  }
  const material = new THREE.MeshBasicMaterial({
    map: canvasTexture(canvas, 'sharp'),
    transparent: true,
    opacity: FAINT,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H).rotateX(-Math.PI / 2), material);
  mesh.position.set(MAP_W / 2, 0.011, MAP_H / 2);
  mesh.renderOrder = 0.3;
  mesh.visible = false;
  return mesh;
}

/** Shows the turf (0: not at all, a replay from before the gangs; 1 faint; 2 held), easing between. Returns the opacity now. */
export function showTurf(mesh: THREE.Mesh, state: number, shown: number, dt: number, reduced: boolean, ground: boolean): number {
  const goal = state === 2 ? HELD : state === 1 ? FAINT : 0;
  let now = shown + (goal - shown) * (reduced ? 1 : Math.min(1, dt * 2));
  if (Math.abs(goal - now) < 0.01) now = goal;
  (mesh.material as THREE.MeshBasicMaterial).opacity = now;
  mesh.visible = now > 0 && ground;
  return now;
}
