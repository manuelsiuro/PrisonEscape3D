import * as THREE from 'three';
import type { Pitch } from '../content/prisons/types';
import { KEY, TILE, TILE_INFO } from '../sim/world/tiles';
import { MAP_H, MAP_W, type World } from '../sim/world/World';
import { buildGround } from './ground';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { batched, disposeTree, type Piece } from './batch';
import { box, cyl, kitMaterial, merge, paint } from './kit';
import { Lights } from './lights';
import { seeThrough } from './occlusion';
import { propGeometry } from './props';
import { TEX } from './textures';

/** A cone standing on y (a pine's tier): radius, height, color. */
const cone = (r: number, h: number, color: number, x: number, y: number) => paint(new THREE.ConeGeometry(r, h, 8).translate(x, y + h / 2, 0), color);

/** Wall height in tiles. Walls in front of the player are seen through (occlusion.ts). */
export const WALL_H = 1.4;

/** Door colors by key (GDD §4.0). */
const KEY_COLORS: Record<number, number> = {
  [KEY.YELLOW]: 0xe8b828,
  [KEY.CYAN]: 0x2fb6c8,
  [KEY.PURPLE]: 0x8e4fc4,
  [KEY.RED]: 0xd23f36,
  [KEY.GREEN]: 0x36a447,
};

/** Which floor texture each walkable tile shows (doors and detectors stand on concrete). */
const FLOOR_OF: Record<number, keyof typeof TEX> = {
  [TILE.GRASS]: 'grass',
  [TILE.ROAD]: 'road',
  [TILE.CONCRETE]: 'concrete',
  [TILE.TILED]: 'tiled',
  [TILE.WOOD]: 'wood',
  [TILE.ASPHALT]: 'asphalt',
  [TILE.DIRT]: 'trail',
  [TILE.DOOR]: 'concrete',
  [TILE.DETECTOR]: 'concrete',
  [TILE.FENCE]: 'grass',
  [TILE.ELECTRIC]: 'grass',
  [TILE.TOWER]: 'grass',
  [TILE.MINE]: 'minefield',
  [TILE.PIER]: 'pier',
  // Under the walls: what a see-through cut reveals.
  [TILE.BRICK]: 'wallCore',
  [TILE.REINFORCED]: 'wallCore',
};

const isWall = (k: number) => k === TILE.BRICK || k === TILE.REINFORCED;
const isFence = (k: number) => k === TILE.FENCE || k === TILE.ELECTRIC;

interface DoorMesh {
  index: number;
  /** The leaf's parts: instances of the doors' shared meshes (one draw call per part for every door). */
  parts: Array<[THREE.InstancedMesh, number]>;
  /** The leaf's closed position, the direction it slides to open (into the wall), its turn. */
  home: THREE.Vector3;
  slide: THREE.Vector3;
  angle: number;
  open: number;
  /** How far open it was last drawn (NaN: not yet). */
  drawn: number;
}

/**
 * A wall block whose faces are ordered sides first, then top and bottom: two material groups
 * (sides, top) instead of BoxGeometry's six, so a wall kind is two draw calls, not six.
 */
export function wallBlock(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, WALL_H, 1);
  const idx = Array.from(g.index!.array);
  // (BoxGeometry's faces, 6 indices each: +x, -x, +y, -y, +z, -z.)
  const sides: number[] = [];
  const caps: number[] = [];
  for (let f = 0; f < 6; f++) (f === 2 || f === 3 ? caps : sides).push(...idx.slice(f * 6, f * 6 + 6));
  g.setIndex([...sides, ...caps]);
  g.clearGroups();
  g.addGroup(0, sides.length, 0);
  g.addGroup(sides.length, caps.length, 1);
  return g;
}

/** Joins plain (unpainted) geometries into one, freeing the parts. */
function join(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  for (const p of parts) p.dispose();
  return g;
}

/** A box w×h×d centered on (x, y, z) (unpainted). */
function placedBox(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

/**
 * Draws a prison: floors, walls and fences as one InstancedMesh per kind, furniture merged
 * and instanced per model, doors that slide, the baked ground layer (paint and contact
 * shadows), night lights and the scenery beyond the road. Reads the world, never changes it.
 */
export class WorldView {
  readonly group = new THREE.Group();
  private doors: DoorMesh[] = [];
  /** Per tile, the wall or fence instance standing there (-1 for none): damage hides them (refreshTiles). */
  private readonly wallAt = new Int32Array(MAP_W * MAP_H).fill(-1);
  private readonly fenceAt = new Int32Array(MAP_W * MAP_H).fill(-1);
  /** A junction's second panel (a fence meeting another across it: P32 review), -1 none. */
  private readonly fenceAt2 = new Int32Array(MAP_W * MAP_H).fill(-1);
  private wallMesh: THREE.InstancedMesh | null = null;
  /** Window glass, lit at night. */
  private readonly windows: THREE.MeshStandardMaterial[] = [];
  private readonly fenceMeshes: Array<{ panel: THREE.InstancedMesh; posts: THREE.InstancedMesh; kind: number }> = [];
  private readonly fenceOf = new Int32Array(MAP_W * MAP_H).fill(-1);
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly kept = new Map<THREE.InstancedMesh, THREE.Matrix4[]>();
  private readonly lights: Lights;
  private readonly matrix = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  /** Textures made for this view (the wall, fence and grass map clones): freed with it; the shared TEX ones and the ground's cached canvases are not. */
  private readonly ownMaps = new Set<THREE.Texture>();

  constructor(
    readonly world: World,
    /** The football pitch in use (its lines kept clean of the roll call's paint: ground.ts). */
    pitch: Pitch | null = world.def.leisure?.pitch ?? null,
    /** Seen from outside (P41 review: the prison behind the manhunt's wall): no baked ground (its cache is the scene's own prison's) and no fields round it. */
    backdrop = false,
  ) {
    this.buildFloors();
    this.buildWalls();
    this.buildFences();
    this.buildDoors();
    this.buildDetectors();
    this.buildTowers();
    this.buildProps();
    // (The ground's canvases are its cache's: kept for the same prison staged again.)
    if (!backdrop) this.group.add(buildGround(world, pitch));
    this.lights = new Lights(world);
    this.group.add(this.lights.group);
    if (!backdrop) this.buildSurroundings();
    this.refreshTiles();
  }

  /** The map's own tile (what is built); damage is drawn over it (refreshTiles, Structure). */
  private kindAt(x: number, z: number): number {
    return this.world.inside(x, z) ? this.world.ground.base[z * MAP_W + x] : TILE.EMPTY;
  }

  /** Tiles of the kinds asked for, as flat [x, z, x, z…]. */
  private cells(test: (k: number) => boolean): number[] {
    const out: number[] = [];
    for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) if (test(this.kindAt(x, z))) out.push(x, z);
    return out;
  }

  /** Does a line of these tiles run along x here (neighbors east or west), rather than along z? */
  private alongX(x: number, z: number, like: (k: number) => boolean): boolean {
    return like(this.kindAt(x - 1, z)) || like(this.kindAt(x + 1, z)) || !(like(this.kindAt(x, z - 1)) || like(this.kindAt(x, z + 1)));
  }

  /** Sets an instance's transform: position, a turn about y, a scale. */
  private place(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, angle = 0, sx = 1, sy = 1, sz = 1) {
    this.q.setFromAxisAngle(this.up, angle);
    this.matrix.compose(this.pos.set(x, y, z), this.q, this.scale.set(sx, sy, sz));
    mesh.setMatrixAt(i, this.matrix);
  }

  /** The floor a tile shows: its own kind's, but a gate in a fence stands on the ground either side of it (P31's sports ground gates: grass, not a slab of concrete). */
  private floorOf(x: number, z: number): keyof typeof TEX | undefined {
    const k = this.kindAt(x, z);
    const nextTo = (x: number, z: number, f: (k: number) => boolean) => [this.kindAt(x - 1, z), this.kindAt(x + 1, z), this.kindAt(x, z - 1), this.kindAt(x, z + 1)].some(f);
    // (A gate's second leaf touches only the first, the fence beyond it: P32 review, Stalag's garden gate.)
    const inFence = (x: number, z: number) => nextTo(x, z, isFence) || [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dz]) => this.kindAt(x + dx, z + dz) === TILE.DOOR && nextTo(x + dx, z + dz, isFence));
    if (k === TILE.DOOR && inFence(x, z)) {
      // (Grass first where either side has it: a gate from the roll-call asphalt into the garden stands on the garden's grass.)
      let found: keyof typeof TEX | undefined;
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const n = this.kindAt(x + dx, z + dz);
        if (n !== TILE.DOOR && !isFence(n) && TILE_INFO[n]?.outdoor && !TILE_INFO[n].solid && FLOOR_OF[n]) {
          if (n === TILE.GRASS) return FLOOR_OF[n];
          found ??= FLOOR_OF[n];
        }
      }
      if (found) return found;
    }
    return FLOOR_OF[k];
  }

  private buildFloors() {
    const byTex = new Map<keyof typeof TEX, number[]>();
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        const tex = this.floorOf(x, z);
        if (!tex) continue;
        if (!byTex.has(tex)) byTex.set(tex, []);
        byTex.get(tex)!.push(x, z);
      }
    }
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const color = new THREE.Color();
    for (const [tex, cells] of byTex) {
      const mat = new THREE.MeshStandardMaterial({ map: (TEX[tex] as () => THREE.Texture)(), roughness: 0.95 });
      const mesh = new THREE.InstancedMesh(geo, mat, cells.length / 2);
      for (let i = 0; i < cells.length / 2; i++) {
        const x = cells[i * 2];
        const z = cells[i * 2 + 1];
        this.matrix.makeTranslation(x + 0.5, 0, z + 0.5);
        mesh.setMatrixAt(i, this.matrix);
        // A faint per-tile shade so big floors don't look printed.
        const v = 0.95 + ((((x * 73856093) ^ (z * 19349663)) >>> 0) % 1000) / 1000 * 0.07;
        mesh.setColorAt(i, color.setScalar(v));
      }
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** Brick walls (chipped through, they hide: `wallAt`), and reinforced concrete in its own panels, which nothing breaks. */
  private buildWalls() {
    const geo = wallBlock();
    const brickTop = seeThrough(new THREE.MeshStandardMaterial({ map: TEX.wallTop(), roughness: 0.85 }));
    // Reinforced concrete is concrete on top too: from above, the walls no tool chips read as such (San Pancho's sand all round them).
    const concreteTop = seeThrough(new THREE.MeshStandardMaterial({ map: TEX.reinforced(), color: 0xc4c4c4, roughness: 0.95 }));
    for (const [kind, tex, roughness] of [
      [TILE.BRICK, TEX.brick(), 0.9],
      [TILE.REINFORCED, TEX.reinforced(), 0.95],
    ] as const) {
      // (The manhunt's outside: its buildings are houses, HuntView's own; only its prison wall is drawn here.)
      const cells = kind === TILE.BRICK && this.world.def.id.startsWith('outside-') ? [] : this.cells((k) => k === kind);
      if (!cells.length) continue;
      // The side faces' v runs 0..1 up the wall: repeat the texture so courses keep their size.
      const map = tex.clone();
      map.repeat.set(1, WALL_H);
      map.needsUpdate = true;
      this.ownMaps.add(map);
      const side = seeThrough(new THREE.MeshStandardMaterial({ map, roughness }));
      // (wallBlock's groups: the sides, then the top and bottom.)
      const top = kind === TILE.REINFORCED ? concreteTop : brickTop;
      const mesh = new THREE.InstancedMesh(geo, [side, top], cells.length / 2);
      for (let i = 0; i < cells.length / 2; i++) {
        this.matrix.makeTranslation(cells[i * 2] + 0.5, WALL_H / 2, cells[i * 2 + 1] + 0.5);
        mesh.setMatrixAt(i, this.matrix);
        if (kind === TILE.BRICK) this.wallAt[cells[i * 2 + 1] * MAP_W + cells[i * 2]] = i;
      }
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      if (kind === TILE.BRICK) {
        this.wallMesh = mesh;
        this.keep(mesh);
      }
    }
  }

  /** Remembers an instanced mesh's matrices, so hidden instances can come back. */
  private keep(mesh: THREE.InstancedMesh) {
    const list: THREE.Matrix4[] = [];
    for (let i = 0; i < mesh.count; i++) {
      const m = new THREE.Matrix4();
      mesh.getMatrixAt(i, m);
      list.push(m);
    }
    this.kept.set(mesh, list);
  }

  private show(mesh: THREE.InstancedMesh, i: number, on: boolean) {
    mesh.setMatrixAt(i, on ? this.kept.get(mesh)![i] : this.hidden);
    mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * After tiles change (a wall chipped through, a fence cut, a cover put on or taken off, a
   * repair): walls and fences stand where the tile still looks like one.
   */
  refreshTiles() {
    const kind = this.world.ground.kind;
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      if (this.wallAt[i] >= 0 && this.wallMesh) {
        const k = kind[i];
        this.show(this.wallMesh, this.wallAt[i], k === TILE.BRICK || k === TILE.HOLE_POSTER || k === TILE.HOLE_FAKE);
      }
      if (this.fenceAt[i] >= 0) {
        const f = this.fenceMeshes[this.fenceOf[i]];
        const on = kind[i] !== TILE.FENCE_CUT;
        this.show(f.panel, this.fenceAt[i], on);
        if (this.fenceAt2[i] >= 0) this.show(f.panel, this.fenceAt2[i], on);
      }
    }
  }

  private buildFences() {
    const fenceLike = (k: number) => isFence(k) || k === TILE.DOOR || k === TILE.TOWER;
    const h = 1.8;
    const postMat = new THREE.MeshStandardMaterial({ color: 0x7d858f, metalness: 0.6, roughness: 0.45 });
    for (const [kind, tint, emissive] of [
      [TILE.FENCE, 0xffffff, 0x000000],
      [TILE.ELECTRIC, 0xffeb8a, 0x2a2200],
    ] as const) {
      const cells = this.cells((k) => k === kind);
      if (!cells.length) continue;
      const tex = TEX.fence().clone();
      tex.needsUpdate = true;
      this.ownMaps.add(tex);
      const mat = new THREE.MeshStandardMaterial({ map: tex, color: tint, emissive, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5 });
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, h), mat, cells.length);
      const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, h + 0.15, 0.09), postMat, cells.length / 2);
      let panels = 0;
      for (let i = 0; i < cells.length / 2; i++) {
        const x = cells[i * 2];
        const z = cells[i * 2 + 1];
        const ax = this.alongX(x, z, fenceLike);
        const t = z * MAP_W + x;
        this.fenceOf[t] = this.fenceMeshes.length;
        // A junction (P32 review: Stalag's fence along z44 meeting the inner fence and the perimeter): the line
        // running through it whole, and a half panel toward the one that ends there, not a whole one sticking out past it.
        const w = fenceLike(this.kindAt(x - 1, z));
        const e = fenceLike(this.kindAt(x + 1, z));
        const n = fenceLike(this.kindAt(x, z - 1));
        const so = fenceLike(this.kindAt(x, z + 1));
        if ((w || e) && (n || so) && (w !== e || n !== so)) {
          const throughX = w && e;
          const half = (dx: number, dz: number) => this.place(mesh, panels, x + 0.5 + dx * 0.25, h / 2, z + 0.5 + dz * 0.25, dx ? 0 : Math.PI / 2, 0.5);
          if (throughX) this.place(mesh, panels, x + 0.5, h / 2, z + 0.5, 0);
          else if (n && so) this.place(mesh, panels, x + 0.5, h / 2, z + 0.5, Math.PI / 2);
          else half(w ? -1 : 1, 0);
          this.fenceAt[t] = panels++;
          if (throughX) half(0, n ? -1 : 1);
          else half(n && so ? (w ? -1 : 1) : 0, n && so ? 0 : n ? -1 : 1);
          this.fenceAt2[t] = panels++;
          this.place(posts, i, x + 0.5, (h + 0.15) / 2, z + 0.5);
          continue;
        }
        this.place(mesh, panels, x + 0.5, h / 2, z + 0.5, ax ? 0 : Math.PI / 2);
        this.place(posts, i, ax ? x : x + 0.5, (h + 0.15) / 2, ax ? z + 0.5 : z);
        this.fenceAt[t] = panels++;
      }
      mesh.count = panels;
      mesh.castShadow = posts.castShadow = true;
      this.group.add(mesh, posts);
      this.fenceMeshes.push({ panel: mesh, posts, kind });
      this.keep(mesh);
    }
    // Razor wire coiled along the top of every fence: rings across the line, tilted so they read as a spiral.
    const fences = this.cells(isFence);
    const wire = new THREE.InstancedMesh(new THREE.TorusGeometry(0.17, 0.014, 3, 9), new THREE.MeshStandardMaterial({ color: 0xb8c0ca, metalness: 0.8, roughness: 0.3 }), Math.max(1, fences.length));
    const tilt = new THREE.Euler();
    let n = 0;
    for (let i = 0; i < fences.length / 2; i++) {
      const x = fences[i * 2];
      const z = fences[i * 2 + 1];
      const ax = this.alongX(x, z, fenceLike);
      this.q.setFromEuler(tilt.set(0.35, ax ? Math.PI / 2 : 0, 0, 'YXZ'));
      for (let k = 0; k < 2; k++) {
        const t = (k + 0.5) / 2;
        this.matrix.compose(this.pos.set(ax ? x + t : x + 0.5, h + 0.12, ax ? z + 0.5 : z + t), this.q, this.one);
        wire.setMatrixAt(n++, this.matrix);
      }
    }
    wire.count = n;
    this.group.add(wire);
  }

  /**
   * Doors: every leaf and lintel is an instance of a few shared meshes (bars by height, steel
   * slabs, their key bands and windows, lintels), so 36 doors draw in a handful of calls.
   */
  private buildDoors() {
    const wallLike = (k: number) => isWall(k) || k === TILE.DOOR || isFence(k);
    interface Spec { x: number; z: number; i: number; key: number; ax: boolean; h: number; leafH: number; bars: boolean }
    const specs: Spec[] = [];
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        if (this.kindAt(x, z) !== TILE.DOOR) continue;
        const i = z * MAP_W + x;
        const key = this.world.ground.key[i];
        const inFence = [this.kindAt(x - 1, z), this.kindAt(x + 1, z), this.kindAt(x, z - 1), this.kindAt(x, z + 1)].some(isFence);
        const h = inFence ? 1.8 : WALL_H;
        // Cell doors and gates: bars in a frame. Work, utility and security doors: a steel slab, a window, a band of the key color.
        specs.push({ x, z, i, key, ax: this.alongX(x, z, wallLike), h, leafH: h * 0.86, bars: key === KEY.YELLOW || inFence });
      }
    }
    if (!specs.length) return;
    const frameMat = seeThrough(new THREE.MeshStandardMaterial({ color: 0x4a515c, roughness: 0.55, metalness: 0.4 }));
    const steel = seeThrough(new THREE.MeshStandardMaterial({ color: 0x9aa2ad, roughness: 0.5, metalness: 0.45 }));
    const glassMat = seeThrough(new THREE.MeshStandardMaterial({ color: 0x24303d, roughness: 0.15, metalness: 0.6, emissive: 0xffc27a, emissiveIntensity: 0 }));
    this.windows.push(glassMat);
    // (White, tinted per door in its key's color.)
    const barsMat = seeThrough(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.5 }));
    const bandMat = seeThrough(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.1 }));
    const color = new THREE.Color();
    const tint = (key: number) => color.setHex(KEY_COLORS[key] ?? 0x888888);
    const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow: boolean, moving: boolean) => {
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.castShadow = shadow;
      // (The leaves slide: their bounds would go stale; they're spread over the whole map anyway.)
      mesh.frustumCulled = !moving;
      this.group.add(mesh);
      return mesh;
    };
    // Bars, one mesh per leaf height (walls', fences').
    const barsOf = new Map<number, { mesh: THREE.InstancedMesh; n: number }>();
    for (const leafH of new Set(specs.filter((d) => d.bars).map((d) => d.leafH))) {
      const parts = [box(0.96, 0.07, 0.07, 0xffffff, 0, 0, 0), box(0.96, 0.07, 0.07, 0xffffff, 0, leafH - 0.07, 0), box(0.96, 0.05, 0.05, 0xffffff, 0, leafH * 0.45, 0)];
      for (let b = 0; b < 6; b++) parts.push(cyl(0.025, leafH, 0xffffff, -0.4 + b * 0.16, 0, 0, 6));
      barsOf.set(leafH, { mesh: instanced(merge(parts), barsMat, specs.filter((d) => d.bars && d.leafH === leafH).length, true, true), n: 0 });
    }
    // Slabs (only in walls: one height).
    const slabs = specs.filter((d) => !d.bars).length;
    const slabH = WALL_H * 0.86;
    const slab = slabs ? instanced(new THREE.BoxGeometry(0.96, slabH, 0.1).translate(0, slabH / 2, 0), steel, slabs, true, true) : null;
    const band = slabs ? instanced(new THREE.BoxGeometry(0.97, 0.16, 0.12).translate(0, slabH * 0.32, 0), bandMat, slabs, false, true) : null;
    const glass = slabs ? instanced(new THREE.BoxGeometry(0.3, 0.22, 0.12).translate(0, slabH * 0.72, 0), glassMat, slabs, false, true) : null;
    // Lintels over the gaps: a unit-high block, scaled to the gap over the leaf.
    const lintels = instanced(new THREE.BoxGeometry(1, 1, 0.34), frameMat, specs.length, true, false);
    let s = 0;
    specs.forEach((d, k) => {
      const parts: Array<[THREE.InstancedMesh, number]> = [];
      if (d.bars) {
        const b = barsOf.get(d.leafH)!;
        b.mesh.setColorAt(b.n, tint(d.key));
        parts.push([b.mesh, b.n++]);
      } else {
        band!.setColorAt(s, tint(d.key));
        parts.push([slab!, s], [band!, s], [glass!, s]);
        s++;
      }
      const angle = d.ax ? 0 : Math.PI / 2;
      this.place(lintels, k, d.x + 0.5, d.leafH + (d.h - d.leafH) / 2, d.z + 0.5, angle, 1, d.h - d.leafH, 1);
      this.doors.push({ index: d.i, parts, home: new THREE.Vector3(d.x + 0.5, 0, d.z + 0.5), slide: new THREE.Vector3(d.ax ? 0.92 : 0, 0, d.ax ? 0 : 0.92), angle, open: this.world.doorShut[d.i] ? 0 : 1, drawn: NaN });
    });
    this.moveDoors(0, undefined, false);
  }

  /** The arches' lamps (P21: the visiting room's portable arches share it). */
  readonly archLight = new THREE.MeshStandardMaterial({ color: 0x3fb950, emissive: 0x2a9a3a, emissiveIntensity: 1.5 });
  private archFlash = 0;

  /** The detector arches, all in one mesh (the lamps in another: they light and flash). */
  private buildDetectors() {
    const frames: THREE.BufferGeometry[] = [];
    const lamps: THREE.BufferGeometry[] = [];
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        if (this.kindAt(x, z) !== TILE.DETECTOR) continue;
        const a = this.alongX(x, z, (k) => isWall(k) || k === TILE.DETECTOR) ? 0 : Math.PI / 2;
        const at = (g: THREE.BufferGeometry) => g.rotateY(a).translate(x + 0.5, 0, z + 0.5);
        for (const s of [-1, 1]) frames.push(at(placedBox(0.12, 1.25, 0.24, s * 0.44, 0.625, 0)));
        frames.push(at(placedBox(1, 0.16, 0.26, 0, 1.3, 0)));
        lamps.push(at(placedBox(0.14, 0.06, 0.1, 0, 1.41, 0)));
      }
    }
    if (!frames.length) return;
    const arch = new THREE.Mesh(join(frames), seeThrough(new THREE.MeshStandardMaterial({ color: 0xb4bcc6, roughness: 0.35, metalness: 0.65 })));
    arch.castShadow = true;
    this.group.add(arch, new THREE.Mesh(join(lamps), this.archLight));
  }

  /** The watchtowers, every one in four meshes (legs and decks, cabins, windows, roofs). */
  private buildTowers() {
    const legs: THREE.BufferGeometry[] = [];
    const cabins: THREE.BufferGeometry[] = [];
    const panes: THREE.BufferGeometry[] = [];
    const roofs: THREE.BufferGeometry[] = [];
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        if (this.kindAt(x, z) !== TILE.TOWER || this.kindAt(x - 1, z) === TILE.TOWER || this.kindAt(x, z - 1) === TILE.TOWER) continue;
        let w = 0;
        while (this.kindAt(x + w, z) === TILE.TOWER) w++;
        let d = 0;
        while (this.kindAt(x, z + d) === TILE.TOWER) d++;
        const H = 4.2;
        for (const [sx, sz] of [
          [0.3, 0.3],
          [w - 0.3, 0.3],
          [0.3, d - 0.3],
          [w - 0.3, d - 0.3],
        ])
          legs.push(placedBox(0.25, H, 0.25, x + sx, H / 2, z + sz));
        // Braces make it read as a structure, not a box on stilts.
        for (const y of [1.3, 2.8]) legs.push(placedBox(w - 0.4, 0.08, 0.08, x + w / 2, y, z + d - 0.3));
        legs.push(placedBox(w + 0.3, 0.15, d + 0.3, x + w / 2, H, z + d / 2));
        cabins.push(placedBox(w - 0.2, 1.3, d - 0.2, x + w / 2, H + 0.72, z + d / 2));
        panes.push(placedBox(w - 0.18, 0.5, d - 0.18, x + w / 2, H + 0.95, z + d / 2));
        roofs.push(new THREE.ConeGeometry(Math.max(w, d) * 0.82, 0.9, 4).rotateY(Math.PI / 4).translate(x + w / 2, H + 1.82, z + d / 2));
      }
    }
    if (!legs.length) return;
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.1, metalness: 0.6, emissive: 0xffc27a, emissiveIntensity: 0 });
    this.windows.push(glassMat);
    const parts: Array<[THREE.BufferGeometry[], THREE.Material, boolean]> = [
      [legs, new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.7 }), true],
      [cabins, new THREE.MeshStandardMaterial({ color: 0xc9b99a, roughness: 0.8 }), true],
      [panes, glassMat, false],
      [roofs, new THREE.MeshStandardMaterial({ color: 0x6e3328, roughness: 0.8 }), true],
    ];
    for (const [list, mat, shadow] of parts) {
      const mesh = new THREE.Mesh(join(list), mat);
      mesh.castShadow = shadow;
      this.group.add(mesh);
    }
  }

  /** The furniture: one shape per kind and size, every piece in one batched mesh (one draw call, each piece culled on its own). */
  private buildProps() {
    const pieces: Piece[] = this.world.props.map((p) => {
      const turned = p.rot % 2 === 1;
      const w = turned ? p.d : p.w;
      const d = turned ? p.w : p.d;
      // rot: 0 front south (+z), 1 east, 2 north, 3 west.
      this.q.setFromAxisAngle(this.up, [0, Math.PI / 2, Math.PI, -Math.PI / 2][p.rot]);
      const matrix = new THREE.Matrix4().compose(this.pos.set(p.x + p.w / 2, 0, p.z + p.d / 2), this.q, this.one);
      return { key: `${p.kind}:${w}x${d}`, make: () => propGeometry(p.kind, w, d), matrix };
    });
    // Furniture is cut above waist height only: low pieces next to the player stay whole.
    const mesh = batched(seeThrough(kitMaterial.clone(), 0.6), pieces);
    if (!mesh) return;
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** Whether a fence tile runs along x (for the damage drawn on it). */
  fenceAlongX(x: number, z: number): boolean {
    return this.alongX(x, z, (k) => isFence(k) || k === TILE.DOOR || k === TILE.TOWER || k === TILE.FENCE_CUT || k === TILE.FENCE_FAKE);
  }

  /** Whether a wall tile runs along x (its long faces look north and south). */
  wallAlongX(x: number, z: number): boolean {
    return this.alongX(x, z, (k) => isWall(k) || k === TILE.DOOR || k === TILE.HOLE || k === TILE.HOLE_FAKE || k === TILE.HOLE_POSTER);
  }

  /** Fields and woods beyond the road, so the map's edge never shows the void (an island's sea is the Island view's). */
  private buildSurroundings() {
    if (this.world.def.theme === 'island') return;
    const tex = TEX.grass().clone();
    tex.needsUpdate = true;
    tex.repeat.set(200, 200);
    this.ownMaps.add(tex);
    const theme = this.world.def.theme ?? 'suburban';
    const alpine = theme === 'alpine';
    // (The manhunt's outside, P41 review: its ground runs on out as the map's own grass, the same shade as its floors, no seam at the edge; its woods and roads past the edge are the HuntView's, clear of each other.)
    const outside = this.world.def.id.startsWith('outside-');
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: tex, color: outside ? new THREE.Color().setScalar(0.985) : alpine ? 0xe6edf5 : theme === 'industrial' ? 0xa7a298 : theme === 'desert' ? 0xe8d2ae : 0xa9bd98, roughness: outside ? 0.95 : 1 }),
    );
    ground.position.set(MAP_W / 2, -0.02, MAP_H / 2);
    ground.receiveShadow = true;
    this.group.add(ground);
    if (outside) return;

    // Trees in a ring outside the road: a seeded scatter, one draw call.
    let s = 12345;
    const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const tree = sceneryTree(theme);
    const spots: Array<[number, number, number]> = [];
    for (let k = 0; k < 1500 && spots.length < 280; k++) {
      const x = -24 + rand() * (MAP_W + 48);
      const z = -24 + rand() * (MAP_H + 48);
      if (x > -2 && x < MAP_W + 2 && z > -2 && z < MAP_H + 2) continue;
      if (spots.some(([a, b]) => (a - x) ** 2 + (b - z) ** 2 < 2.2)) continue;
      spots.push([x, z, 0.8 + rand() * 0.9]);
    }
    const trees = new THREE.InstancedMesh(tree, kitMaterial, spots.length);
    spots.forEach(([x, z, sc], i) => this.place(trees, i, x, 0, z, rand() * Math.PI, sc, sc * (0.9 + rand() * 0.3), sc));
    trees.castShadow = true;
    this.group.add(trees);
  }

  /**
   * Per frame: doors slide toward their state (open too where a guard walks through, or the
   * player with a key, in `open`); lights follow the time of day (0 day … 1 night).
   */
  update(dt: number, night: number, open?: ReadonlySet<number>, power = 1, riot = false, arches = power) {
    this.moveDoors(dt, open, riot);
    this.lights.setNight(night, power);
    // Lit from inside after dark (the tower cabins, the doors' windows); dark with the power out.
    for (const m of this.windows) m.emissiveIntensity = night * power * 0.85;
    // Detector arches: green while powered, a red flash when one trips, dark with the power out.
    if (this.archFlash > 0) this.archFlash = Math.max(0, this.archFlash - dt);
    const flash = this.archFlash > 0 && Math.floor(this.archFlash * 8) % 2 === 0;
    this.archLight.color.setHex(flash ? 0xff2a1a : arches > 0.5 ? 0x3fb950 : 0x1d2229);
    this.archLight.emissive.setHex(flash ? 0xff2a1a : arches > 0.5 ? 0x2a9a3a : 0x000000);
  }

  /** The doors slide toward their state; a leaf's instances are written only when it moved. */
  private moveDoors(dt: number, open: ReadonlySet<number> | undefined, riot: boolean) {
    for (const d of this.doors) {
      // A takeover (GDD §12): every door stands open.
      const target = this.world.doorShut[d.index] && !open?.has(d.index) && !riot ? 0 : 1;
      if (d.open !== target) d.open = target > d.open ? Math.min(target, d.open + dt * 3) : Math.max(target, d.open - dt * 3);
      // Eased, sliding into the wall.
      const e = d.open * d.open * (3 - 2 * d.open);
      if (e === d.drawn) continue;
      d.drawn = e;
      this.q.setFromAxisAngle(this.up, d.angle);
      this.matrix.compose(this.pos.copy(d.home).addScaledVector(d.slide, e), this.q, this.one);
      for (const [mesh, i] of d.parts) {
        mesh.setMatrixAt(i, this.matrix);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /**
   * The same prison staged again (P25: a replay's Watch again): the doors stand at once as the
   * restored state has them, no arch still flashing. (Walls and fences follow the tiles at the
   * next refreshTiles, which the view's damage redraw calls.)
   */
  reset() {
    this.archFlash = 0;
    this.moveDoors(Infinity, undefined, this.world.riot);
  }

  /** A detector arch tripped (GDD §5.4): its lamps flash red a moment. */
  tripArch() {
    this.archFlash = 1.6;
  }

  /** Frees the view's buffers, materials and its own textures (the map clones); the shared TEX ones and the ground's cached canvases are not. */
  dispose() {
    disposeTree(this.group, (t) => this.ownMaps.has(t), new Set([kitMaterial]));
  }
}

/**
 * A tree of the scenery (and P41's outside), by the prison's look: leafy trees in the suburbs; in
 * the Alps, tall dark pines with snow on their tiers; by the state highway, scrub: dusty olive
 * bushes on thin stems; in the desert, saguaros.
 */
export function sceneryTree(theme: string): THREE.BufferGeometry {
  const alpine = theme === 'alpine';
  return theme === 'desert'
    ? merge([
        cyl(0.15, 1.5, 0x5f7f3d, 0, 0, 0, 8),
        cyl(0.15, 0.08, 0x6d8d48, 0, 1.5, 0, 8),
        cyl(0.09, 0.14, 0x5f7f3d, 0.18, 0.62, 0, 7),
        cyl(0.1, 0.55, 0x5f7f3d, 0.3, 0.66, 0, 7),
        cyl(0.09, 0.12, 0x5f7f3d, -0.17, 0.86, 0, 7),
        cyl(0.09, 0.42, 0x5f7f3d, -0.28, 0.9, 0, 7),
      ])
    : theme === 'industrial'
    ? merge([cyl(0.07, 0.35, 0x5e5243, 0, 0, 0, 5), cyl(0.42, 0.45, 0x6b6e4c, 0, 0.3, 0, 6), cyl(0.3, 0.35, 0x7a7d58, 0.12, 0.62, 0.05, 6)])
    : alpine
    ? merge([
        cyl(0.1, 0.5, 0x5a3c24, 0, 0, 0, 6),
        cone(0.62, 0.9, 0x24503a, 0, 0.4),
        cone(0.5, 0.18, 0xf2f6fb, 0, 0.98),
        cone(0.48, 0.8, 0x2b5c43, 0, 1.0),
        cone(0.38, 0.16, 0xf2f6fb, 0, 1.52),
        cone(0.34, 0.7, 0x316a4c, 0, 1.55),
        cone(0.22, 0.32, 0xf7fafd, 0, 2.0),
      ])
    : merge([cyl(0.12, 0.7, 0x6b4a2f, 0, 0, 0, 6), cyl(0.55, 0.9, 0x3f7a3a, 0, 0.6, 0, 7), cyl(0.4, 0.7, 0x4c8c44, 0, 1.3, 0, 7), cyl(0.22, 0.5, 0x5a9c4f, 0, 1.85, 0, 6)]);
}
