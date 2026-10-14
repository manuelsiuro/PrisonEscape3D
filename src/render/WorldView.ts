import * as THREE from 'three';
import { KEY, TILE } from '../sim/world/tiles';
import { MAP_H, MAP_W, type World } from '../sim/world/World';
import { kitMaterial } from './kit';
import { propGeometry } from './props';
import { TEX } from './textures';

/** Wall height in tiles: low enough that the angled camera sees into rooms. */
export const WALL_H = 1.25;

/** Door slab colors by key (GDD §4.0). */
export const KEY_COLORS: Record<number, number> = {
  [KEY.YELLOW]: 0xf2c230,
  [KEY.CYAN]: 0x35c7d8,
  [KEY.PURPLE]: 0x9b59d0,
  [KEY.RED]: 0xe0483e,
  [KEY.GREEN]: 0x3fb950,
};

/** Which floor texture each walkable tile shows (doors and detectors stand on concrete). */
const FLOOR_OF: Record<number, keyof typeof TEX> = {
  [TILE.GRASS]: 'grass',
  [TILE.ROAD]: 'road',
  [TILE.CONCRETE]: 'concrete',
  [TILE.TILED]: 'tiled',
  [TILE.WOOD]: 'wood',
  [TILE.ASPHALT]: 'asphalt',
  [TILE.DIRT]: 'dirt',
  [TILE.DOOR]: 'concrete',
  [TILE.DETECTOR]: 'concrete',
  [TILE.FENCE]: 'grass',
  [TILE.ELECTRIC]: 'grass',
  [TILE.TOWER]: 'grass',
};

interface DoorMesh {
  index: number;
  x: number;
  z: number;
  slab: THREE.Mesh;
  lintel: THREE.Mesh;
  /** Slab height when closed. */
  h: number;
  /** Cutaway factor, as for walls. */
  lift: number;
  /** The slab's closed position and the direction it slides to open. */
  home: THREE.Vector3;
  slide: THREE.Vector3;
  open: number;
}

/** Is a wall tile (center x, z) between the camera and the player at (px, pz)? */
function inFront(x: number, z: number, px: number, pz: number): boolean {
  const dz = z - pz;
  return dz > -0.2 && dz < 2.6 && Math.abs(x - px) < 2.2 - dz * 0.3;
}

/** Eases a wall's height factor: quick down to a stub when in front, back up when passed. */
function towardLift(cur: number, cut: boolean, dt: number): number {
  const goal = cut ? 0.18 : 1;
  if (cur === goal) return cur;
  return goal < cur ? Math.max(goal, cur - dt * 6) : Math.min(goal, cur + dt * 4);
}

/**
 * Draws a prison's tiles and furniture. Floors, walls and fences are one InstancedMesh per
 * kind (a tile change will update one instance); each furniture model is merged and
 * instanced. Reads the world, never changes it.
 */
export class WorldView {
  readonly group = new THREE.Group();
  private doors: DoorMesh[] = [];
  private readonly matrix = new THREE.Matrix4();
  private walls: THREE.InstancedMesh | null = null;
  private wallCells: number[] = [];
  /** Each wall's current height factor (1 = full, low when cut away in front of the player). */
  private wallLift = new Float32Array(0);

  constructor(readonly world: World) {
    this.buildFloors();
    this.buildWalls();
    this.buildFences();
    this.buildDoors();
    this.buildDetectors();
    this.buildTowers();
    this.buildProps();
    this.buildSurroundings();
  }

  private kindAt(x: number, z: number): number {
    return this.world.inside(x, z) ? this.world.ground.kind[z * MAP_W + x] : TILE.EMPTY;
  }

  private buildFloors() {
    const byTex = new Map<keyof typeof TEX, number[]>();
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        const tex = FLOOR_OF[this.kindAt(x, z)];
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
        const v = 0.94 + (((x * 73856093) ^ (z * 19349663)) >>> 0) % 1000 / 1000 * 0.08;
        mesh.setColorAt(i, color.setScalar(v));
      }
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  private buildWalls() {
    const cells: number[] = [];
    for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) if (this.kindAt(x, z) === TILE.BRICK || this.kindAt(x, z) === TILE.REINFORCED) cells.push(x, z);
    const geo = new THREE.BoxGeometry(1, WALL_H, 1);
    const side = new THREE.MeshStandardMaterial({ map: TEX.brick(), roughness: 0.9 });
    const top = new THREE.MeshStandardMaterial({ map: TEX.wallTop(), roughness: 0.9 });
    // Box faces: +x, -x, +y, -y, +z, -z.
    const mesh = new THREE.InstancedMesh(geo, [side, side, top, top, side, side], cells.length / 2);
    for (let i = 0; i < cells.length / 2; i++) {
      this.matrix.makeTranslation(cells[i * 2] + 0.5, WALL_H / 2, cells[i * 2 + 1] + 0.5);
      mesh.setMatrixAt(i, this.matrix);
    }
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.walls = mesh;
    this.wallCells = cells;
    this.wallLift = new Float32Array(cells.length / 2).fill(1);
    this.group.add(mesh);
  }

  /**
   * Cutaway: walls just south of the player (between them and the camera) sink to a low
   * stub, so the player is never hidden behind a wall; they rise again once passed.
   */
  private cutWalls(px: number, pz: number, dt: number) {
    if (!this.walls) return;
    const cells = this.wallCells;
    let changed = false;
    for (let i = 0; i < this.wallLift.length; i++) {
      const x = cells[i * 2] + 0.5;
      const z = cells[i * 2 + 1] + 0.5;
      const cur = this.wallLift[i];
      const next = towardLift(cur, inFront(x, z, px, pz), dt);
      if (next === cur) continue;
      this.wallLift[i] = next;
      this.matrix.makeScale(1, next, 1).setPosition(x, (WALL_H * next) / 2, z);
      this.walls.setMatrixAt(i, this.matrix);
      changed = true;
    }
    if (changed) this.walls.instanceMatrix.needsUpdate = true;
  }

  /** Is the fence line here running along x (neighbors left or right are fence-like)? */
  private alongX(x: number, z: number, like: (k: number) => boolean): boolean {
    return like(this.kindAt(x - 1, z)) || like(this.kindAt(x + 1, z)) || !(like(this.kindAt(x, z - 1)) || like(this.kindAt(x, z + 1)));
  }

  private buildFences() {
    const fenceLike = (k: number) => k === TILE.FENCE || k === TILE.ELECTRIC || k === TILE.DOOR || k === TILE.TOWER;
    for (const [kind, tint, emissive] of [
      [TILE.FENCE, 0xffffff, 0x000000],
      [TILE.ELECTRIC, 0xfff0a0, 0x332a00],
    ] as const) {
      const cells: number[] = [];
      for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) if (this.kindAt(x, z) === kind) cells.push(x, z);
      if (!cells.length) continue;
      const tex = TEX.fence().clone();
      tex.needsUpdate = true;
      const mat = new THREE.MeshStandardMaterial({ map: tex, color: tint, emissive, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 });
      const h = 1.7;
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, h), mat, cells.length / 2);
      const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, h + 0.1, 0.08), new THREE.MeshStandardMaterial({ color: 0x8d949e, metalness: 0.5, roughness: 0.5 }), cells.length / 2);
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < cells.length / 2; i++) {
        const x = cells[i * 2];
        const z = cells[i * 2 + 1];
        const ax = this.alongX(x, z, fenceLike);
        q.setFromAxisAngle(up, ax ? 0 : Math.PI / 2);
        this.matrix.compose(new THREE.Vector3(x + 0.5, h / 2, z + 0.5), q, new THREE.Vector3(1, 1, 1));
        mesh.setMatrixAt(i, this.matrix);
        this.matrix.makeTranslation(ax ? x : x + 0.5, (h + 0.1) / 2, ax ? z + 0.5 : z);
        posts.setMatrixAt(i, this.matrix);
      }
      mesh.castShadow = true;
      posts.castShadow = true;
      this.group.add(mesh, posts);
    }
  }

  private buildDoors() {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x5b6470, roughness: 0.6, metalness: 0.3 });
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        if (this.kindAt(x, z) !== TILE.DOOR) continue;
        const i = z * MAP_W + x;
        const key = this.world.ground.key[i];
        const wallLike = (k: number) => k === TILE.BRICK || k === TILE.REINFORCED || k === TILE.DOOR || k === TILE.FENCE || k === TILE.ELECTRIC;
        const ax = this.alongX(x, z, wallLike);
        const fence = [this.kindAt(x - 1, z), this.kindAt(x + 1, z), this.kindAt(x, z - 1), this.kindAt(x, z + 1)].some((k) => k === TILE.FENCE || k === TILE.ELECTRIC);
        const h = fence ? 1.7 : WALL_H;
        const mat = new THREE.MeshStandardMaterial({ color: KEY_COLORS[key] ?? 0x888888, roughness: 0.5, metalness: 0.2 });
        const slab = new THREE.Mesh(new THREE.BoxGeometry(ax ? 0.96 : 0.12, h * 0.92, ax ? 0.12 : 0.96), mat);
        const home = new THREE.Vector3(x + 0.5, (h * 0.92) / 2, z + 0.5);
        slab.position.copy(home);
        slab.castShadow = true;
        // A lintel in the wall color above the gap, and a stripe of the key color on it.
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(ax ? 1 : 0.3, 0.12, ax ? 0.3 : 1), frameMat);
        lintel.position.set(x + 0.5, h - 0.06, z + 0.5);
        this.group.add(slab, lintel);
        this.doors.push({ index: i, x: x + 0.5, z: z + 0.5, slab, lintel, h: h * 0.92, lift: 1, home, slide: new THREE.Vector3(ax ? 0.9 : 0, 0, ax ? 0 : 0.9), open: this.world.block[i] ? 0 : 1 });
      }
    }
  }

  private buildDetectors() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.4, metalness: 0.6 });
    const light = new THREE.MeshStandardMaterial({ color: 0x3fb950, emissive: 0x2a8a3a, emissiveIntensity: 1.2 });
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        if (this.kindAt(x, z) !== TILE.DETECTOR) continue;
        const ax = this.alongX(x, z, (k) => k === TILE.BRICK || k === TILE.DETECTOR);
        const post = (dx: number, dz: number) => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.15, 0.2), mat);
          m.position.set(x + 0.5 + dx, 0.575, z + 0.5 + dz);
          m.castShadow = true;
          return m;
        };
        const beam = new THREE.Mesh(new THREE.BoxGeometry(ax ? 1 : 0.22, 0.14, ax ? 0.22 : 1), mat);
        beam.position.set(x + 0.5, 1.2, z + 0.5);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), light);
        lamp.position.set(x + 0.5, 1.3, z + 0.5);
        this.group.add(ax ? post(-0.44, 0) : post(0, -0.44), ax ? post(0.44, 0) : post(0, 0.44), beam, lamp);
      }
    }
  }

  private buildTowers() {
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        if (this.kindAt(x, z) !== TILE.TOWER || this.kindAt(x - 1, z) === TILE.TOWER || this.kindAt(x, z - 1) === TILE.TOWER) continue;
        let w = 0;
        while (this.kindAt(x + w, z) === TILE.TOWER) w++;
        let d = 0;
        while (this.kindAt(x, z + d) === TILE.TOWER) d++;
        const tower = new THREE.Group();
        const legMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.7 });
        const H = 4;
        for (const [sx, sz] of [[0.3, 0.3], [w - 0.3, 0.3], [0.3, d - 0.3], [w - 0.3, d - 0.3]]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, H, 0.25), legMat);
          leg.position.set(sx, H / 2, sz);
          leg.castShadow = true;
          tower.add(leg);
        }
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(w, 1.3, d), new THREE.MeshStandardMaterial({ color: 0xc9b99a, roughness: 0.8 }));
        cabin.position.set(w / 2, H + 0.65, d / 2);
        const glass = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.45, d + 0.02), new THREE.MeshStandardMaterial({ color: 0x2b3a4a, roughness: 0.2, metalness: 0.5 }));
        glass.position.set(w / 2, H + 0.85, d / 2);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.8, 0.9, 4), new THREE.MeshStandardMaterial({ color: 0x7a3b2e, roughness: 0.8 }));
        roof.rotation.y = Math.PI / 4;
        roof.position.set(w / 2, H + 1.75, d / 2);
        cabin.castShadow = roof.castShadow = true;
        tower.add(cabin, glass, roof);
        tower.position.set(x, 0, z);
        this.group.add(tower);
      }
    }
  }

  private buildProps() {
    const groups = new Map<string, Array<{ x: number; z: number; w: number; d: number; rot: number }>>();
    for (const p of this.world.props) {
      const turned = p.rot % 2 === 1;
      const key = `${p.kind}:${turned ? p.d : p.w}x${turned ? p.w : p.d}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    for (const [key, list] of groups) {
      const [kind, size] = key.split(':');
      const [w, d] = size.split('x').map(Number);
      const mesh = new THREE.InstancedMesh(propGeometry(kind as never, w, d), kitMaterial, list.length);
      list.forEach((p, i) => {
        // rot: 0 front south (+z), 1 east, 2 north, 3 west.
        q.setFromAxisAngle(up, [0, Math.PI / 2, Math.PI, -Math.PI / 2][p.rot]);
        this.matrix.compose(new THREE.Vector3(p.x + p.w / 2, 0, p.z + p.d / 2), q, one);
        mesh.setMatrixAt(i, this.matrix);
      });
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** Fields beyond the road, so the map's edge never shows the void. */
  private buildSurroundings() {
    const tex = TEX.grass().clone();
    tex.needsUpdate = true;
    tex.repeat.set(160, 160);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, color: 0xb8c8a8, roughness: 1 }));
    ground.position.set(MAP_W / 2, -0.02, MAP_H / 2);
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  /** Per frame: doors slide toward their state; walls in front of the focus point (tiles) sink. */
  update(dt: number, focus: { x: number; z: number } | null) {
    if (focus) this.cutWalls(focus.x, focus.z, dt);
    else this.cutWalls(-99, -99, dt);
    const fx = focus?.x ?? -99;
    const fz = focus?.z ?? -99;
    for (const d of this.doors) {
      const target = this.world.block[d.index] ? 0 : 1;
      if (d.open !== target) d.open = target > d.open ? Math.min(target, d.open + dt * 3) : Math.max(target, d.open - dt * 3);
      d.lift = towardLift(d.lift, inFront(d.x, d.z, fx, fz), dt);
      // An open door slides into the wall and shrinks with it, so a cut-away wall never shows it.
      const scale = Math.max(0.02, d.lift * (1 - 0.9 * d.open));
      d.slab.scale.y = scale;
      d.slab.position.copy(d.home).addScaledVector(d.slide, d.open);
      d.slab.position.y = (d.h * scale) / 2;
      d.lintel.visible = d.lift > 0.6;
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) if (mat !== kitMaterial) mat.dispose();
    });
  }
}
