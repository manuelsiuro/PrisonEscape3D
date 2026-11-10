import * as THREE from 'three';
import { showTurf } from './Turf';
import type { LongFrame } from './Long';
import type { Pitch } from '../content/prisons/types';
import { MAP_H, MAP_W, type World } from '../sim/world/World';
import { skipEmpty } from './batch';
import type { Dust } from './Dust';
import type { Guide } from './Guide';
import type { Island } from './Island';
import type { River } from './River';
import type { Security } from './Security';
import type { ShowerWater } from './ShowerWater';
import { CAMERA_OFFSET, type CameraRig } from './viewCamera';
import type { Lighting } from './viewLight';
import type { DayPieces } from './viewPieces';
import { WALL_H } from './WorldView';

// The map viewer's "In game" picture (out of View.ts, v2.34.2; dev tools only: scripts/dev/mapimage.ts,
// mapshot.ts): the whole prison in one frame, from the view's own parts.

/** What of the view the picture is taken with (View.mapShot hands them over). */
export interface MapShotParts {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  cam: CameraRig;
  lighting: Lighting;
  pieces: DayPieces;
  dust: Dust;
  guide: Guide;
  showerWater: ShowerWater;
  island: Island | null;
  river: River | null;
  security: Security | null;
  pitch: Pitch | null;
  world: World | null;
  /** 2.36: the gangs' turf painted on the floor (Turf.ts), faint in the photo. */
  turf: THREE.Group | null;
  /** The drawing size and the camera put back as the window has them. */
  resize(): void;
}

/**
 * Dev tool (scripts/dev/mapimage.ts, the map viewer's "In game" picture): the whole prison at
 * the classic angle in one frame, as drawn behind the title (nobody in it, at 10:00). The
 * camera is orthographic, so the floor stays a regular grid: a tile `px` wide and `px * rows`
 * deep, the floor's north edge `top` pixels down. Drawn `ss` times over and scaled down; the
 * camera, the shadow box and the drawing size are put back after. `dress`: a prison's photo for
 * the map viewer, with what stands there every day though the title screen hides it.
 */
export function mapShot(v: MapShotParts, px = 40, ss = 2, dress = false): { canvas: HTMLCanvasElement; top: number; rows: number } {
  const off = CAMERA_OFFSET.clone().normalize();
  const rows = off.y; // a floor tile's depth on screen, in tiles (the view's tilt)
  const lift = Math.hypot(off.x, off.z); // a unit of height on screen, in tiles
  const pad = WALL_H * 2 * lift + 0.5;
  const half = (MAP_H / 2) * rows;
  const w = MAP_W * px;
  const h = Math.ceil((half * 2 + pad + 0.5) * px);
  const target = new THREE.Vector3(MAP_W / 2, 0, MAP_H / 2);
  const kept = { target: v.cam.target.clone(), shadow: v.lighting.sun.shadow.mapSize.x, ratio: v.renderer.getPixelRatio() };
  const cam = v.cam.camera;
  cam.left = -MAP_W / 2;
  cam.right = MAP_W / 2;
  cam.top = half + pad;
  cam.bottom = cam.top - h / px;
  cam.updateProjectionMatrix();
  cam.position.copy(target).add(CAMERA_OFFSET);
  cam.lookAt(target);
  // The shadows over the whole map, finer.
  v.cam.target.copy(target);
  v.cam.shadowHalf = 50;
  const s = v.lighting.sun.shadow.camera;
  s.left = s.bottom = -v.cam.shadowHalf;
  s.right = s.top = v.cam.shadowHalf;
  s.updateProjectionMatrix();
  const resize = (n: number) => {
    v.lighting.sun.shadow.mapSize.set(n, n);
    v.lighting.sun.shadow.map?.dispose();
    v.lighting.sun.shadow.map = null;
  };
  if (v.lighting.sun.castShadow) resize(4096);
  v.lighting.placeSun(600, v.cam.target, v.cam.shadowHalf);
  // (P42: nor a holiday's decor: the map viewer's pictures never depend on the date.)
  const hidden = [
    v.pieces.snow.points,
    v.pieces.leaves.points,
    v.pieces.weather.group,
    v.dust.mesh,
    v.showerWater.group,
    v.guide.group,
    v.pieces.holidaysView.group,
  ].filter((o) => o.visible);
  for (const o of hidden) o.visible = false;
  // The pay phone, the kiosk and the odd jobs board hang on their walls in game, but the title screen behind the shot hides their groups.
  const shown = [v.pieces.phoneView.group, v.pieces.kioskView.group, v.pieces.oddJobsView.group, v.pieces.releaseView.group].filter(
    (o) => !o.visible,
  );
  for (const o of shown) o.visible = true;
  const undress = dress ? dressForMap(v) : null;
  v.renderer.setPixelRatio(ss);
  v.renderer.setSize(w, h, false);
  skipEmpty(v.scene);
  v.renderer.render(v.scene, cam);
  // Read at once, before the browser lets the drawing buffer go.
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  // (The whole drawing buffer: a browser may cap its size below w·ss × h·ss.)
  const el = v.renderer.domElement;
  g.drawImage(el, 0, 0, el.width, el.height, 0, 0, w, h);
  for (const o of hidden) o.visible = true;
  for (const o of shown) o.visible = false;
  undress?.();
  if (v.lighting.sun.castShadow) resize(kept.shadow);
  v.renderer.setPixelRatio(kept.ratio);
  v.cam.target.copy(kept.target);
  v.resize();
  return { canvas, top: Math.round(pad * px), rows };
}

/**
 * What the title screen takes away and a prison has every day: the cameras and searchlights, the
 * pitch's lines and goals, the garden's beds, the rat track; Irongate's drawbridge up. Nothing
 * that comes only with an event. Returns how to take them away again (the drawbridge stays up: it
 * is, in play).
 */
function dressForMap(v: MapShotParts): () => void {
  const w = v.world;
  const def = w?.def;
  if (!w || !def) return () => {};
  const tile = (x: number, z: number) => z * MAP_W + x;
  const sec = v.security;
  if (sec) {
    sec.group.visible = true;
    sec.update(
      {
        power: true,
        fence: true,
        arches: true,
        gens: [true, true],
        // (As the frame turns them, at the middle of their sweep; off, so that no cone hides the floor.)
        cams: (def.cameras ?? []).map((c) => ({
          facing: Math.PI / 2 - ((c.face - 1) * Math.PI * 2) / 16,
          on: false,
          sees: false,
          taped: false,
        })),
        // (Each lamp's pool halfway along its sweep.)
        beams: (def.searchlights ?? []).map((line) => {
          const q = line[Math.floor(line.length / 2)];
          return { x: q.x + 0.5, z: q.z + 0.5 };
        }),
        aim: -1,
        px: 0,
        pz: 0,
        hook: null,
      },
      // (A short step eases the searchlights only part of the way on: a faint pool by day, not a glare over the floor.)
      0.12,
      0,
      0,
      false,
    );
  }
  const ls = def.leisure;
  if (v.pitch) v.pieces.teamView.update({ pitch: v.pitch, theme: def.theme ?? 'suburban', ball: null, mates: [], rivals: [] }, [], 0, true);
  if (ls) {
    const beds: LongFrame['beds'] = [];
    for (let z = ls.garden.z; z < ls.garden.z + ls.garden.d; z++)
      for (let x = ls.garden.x; x < ls.garden.x + ls.garden.w; x++)
        beds.push({ tile: tile(x, z), crop: 0, grown: 0, wilted: false, watered: false, ripe: false, hole: false });
    const a = ((ls.race.dir - 1) * Math.PI) / 8;
    const track = Array.from({ length: ls.race.len }, (_, k) =>
      tile(ls.race.x + Math.round(Math.cos(a)) * k, ls.race.z + Math.round(Math.sin(a)) * k),
    );
    v.pieces.longView.update({ beds, track, rats: [], laps: null, tipsy: false, flash: 0 }, 0, false, true);
  }
  // (Its one piece never otherwise moved behind the title: up, as in a day's play; the helicopter away at 10:00.)
  v.island?.update(100, 0, 600, false, false);
  v.river?.update(0, 0, false);
  // (2.36: the gangs' turf, painted there every day: faint, as at 10:00.)
  if (v.turf) showTurf(v.turf, 1, [1, 1], 0, true, true);
  return () => {
    if (v.turf) for (const m of v.turf.children) m.visible = false;
    if (sec) sec.group.visible = false;
    v.pieces.teamView.update(null, [], 0, false);
    v.pieces.longView.update(null, 0, false, false);
  };
}
