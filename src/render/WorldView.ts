import * as THREE from 'three';
import { KEY, TILE } from '../sim/world/tiles';
import { MAP_H, MAP_W, type World } from '../sim/world/World';
import { buildGround } from './ground';
import { box, cyl, kitMaterial, merge } from './kit';
import { Lights } from './lights';
import { seeThrough } from './occlusion';
import { propGeometry } from './props';
import { TEX } from './textures';

/** Wall height in tiles. Walls in front of the player are seen through (occlusion.ts). */
export const WALL_H = 1.4;

/** Door colors by key (GDD §4.0). */
export const KEY_COLORS: Record<number, number> = {
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
  [TILE.DIRT]: 'dirt',
  [TILE.DOOR]: 'concrete',
  [TILE.DETECTOR]: 'concrete',
  [TILE.FENCE]: 'grass',
  [TILE.ELECTRIC]: 'grass',
  [TILE.TOWER]: 'grass',
  // Under the walls: what a see-through cut reveals.
  [TILE.BRICK]: 'wallCore',
  [TILE.REINFORCED]: 'wallCore',
};

const isWall = (k: number) => k === TILE.BRICK || k === TILE.REINFORCED;
const isFence = (k: number) => k === TILE.FENCE || k === TILE.ELECTRIC;

interface DoorMesh {
  index: number;
  leaf: THREE.Object3D;
  /** The leaf's closed position and the direction it slides to open (into the wall). */
  home: THREE.Vector3;
  slide: THREE.Vector3;
  open: number;
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
  private wallMesh: THREE.InstancedMesh | null = null;
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

  constructor(readonly world: World) {
    this.buildFloors();
    this.buildWalls();
    this.buildFences();
    this.buildDoors();
    this.buildDetectors();
    this.buildTowers();
    this.buildProps();
    this.group.add(buildGround(world));
    this.lights = new Lights(world);
    this.group.add(this.lights.group);
    this.buildSurroundings();
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
        const v = 0.95 + ((((x * 73856093) ^ (z * 19349663)) >>> 0) % 1000) / 1000 * 0.07;
        mesh.setColorAt(i, color.setScalar(v));
      }
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  private buildWalls() {
    const cells = this.cells(isWall);
    const geo = new THREE.BoxGeometry(1, WALL_H, 1);
    // The side faces' v runs 0..1 up the wall: repeat the brick so courses keep their size.
    const brick = TEX.brick().clone();
    brick.repeat.set(1, WALL_H);
    brick.needsUpdate = true;
    const side = seeThrough(new THREE.MeshStandardMaterial({ map: brick, roughness: 0.9 }));
    const top = seeThrough(new THREE.MeshStandardMaterial({ map: TEX.wallTop(), roughness: 0.85 }));
    // Box faces: +x, -x, +y, -y, +z, -z.
    const mesh = new THREE.InstancedMesh(geo, [side, side, top, top, side, side], cells.length / 2);
    for (let i = 0; i < cells.length / 2; i++) {
      this.matrix.makeTranslation(cells[i * 2] + 0.5, WALL_H / 2, cells[i * 2 + 1] + 0.5);
      mesh.setMatrixAt(i, this.matrix);
      this.wallAt[cells[i * 2 + 1] * MAP_W + cells[i * 2]] = i;
    }
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    this.wallMesh = mesh;
    this.keep(mesh);
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
        this.show(this.wallMesh, this.wallAt[i], k === TILE.BRICK || k === TILE.REINFORCED || k === TILE.HOLE_POSTER || k === TILE.HOLE_FAKE);
      }
      if (this.fenceAt[i] >= 0) {
        const f = this.fenceMeshes[this.fenceOf[i]];
        const on = kind[i] !== TILE.FENCE_CUT;
        this.show(f.panel, this.fenceAt[i], on);
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
      const mat = new THREE.MeshStandardMaterial({ map: tex, color: tint, emissive, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5 });
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, h), mat, cells.length / 2);
      const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, h + 0.15, 0.09), postMat, cells.length / 2);
      for (let i = 0; i < cells.length / 2; i++) {
        const x = cells[i * 2];
        const z = cells[i * 2 + 1];
        const ax = this.alongX(x, z, fenceLike);
        this.place(mesh, i, x + 0.5, h / 2, z + 0.5, ax ? 0 : Math.PI / 2);
        this.place(posts, i, ax ? x : x + 0.5, (h + 0.15) / 2, ax ? z + 0.5 : z);
        this.fenceAt[z * MAP_W + x] = i;
        this.fenceOf[z * MAP_W + x] = this.fenceMeshes.length;
      }
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

  private buildDoors() {
    const frameMat = seeThrough(new THREE.MeshStandardMaterial({ color: 0x4a515c, roughness: 0.55, metalness: 0.4 }));
    const steel = seeThrough(new THREE.MeshStandardMaterial({ color: 0x9aa2ad, roughness: 0.5, metalness: 0.45 }));
    const glassMat = seeThrough(new THREE.MeshStandardMaterial({ color: 0x24303d, roughness: 0.15, metalness: 0.6 }));
    const keyMats = new Map<number, THREE.MeshStandardMaterial>();
    const keyMat = (key: number, metal: boolean) => {
      const id = key * 2 + (metal ? 1 : 0);
      if (!keyMats.has(id)) keyMats.set(id, seeThrough(new THREE.MeshStandardMaterial({ color: KEY_COLORS[key] ?? 0x888888, roughness: metal ? 0.4 : 0.55, metalness: metal ? 0.5 : 0.1 })));
      return keyMats.get(id)!;
    };
    const wallLike = (k: number) => isWall(k) || k === TILE.DOOR || isFence(k);
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        if (this.kindAt(x, z) !== TILE.DOOR) continue;
        const i = z * MAP_W + x;
        const key = this.world.ground.key[i];
        const ax = this.alongX(x, z, wallLike);
        const inFence = [this.kindAt(x - 1, z), this.kindAt(x + 1, z), this.kindAt(x, z - 1), this.kindAt(x, z + 1)].some(isFence);
        const h = inFence ? 1.8 : WALL_H;
        const leafH = h * 0.86;
        const leaf = new THREE.Group();
        if (key === KEY.YELLOW || inFence) {
          // Cell doors and gates: bars in a frame.
          const parts = [box(0.96, 0.07, 0.07, 0xffffff, 0, 0, 0), box(0.96, 0.07, 0.07, 0xffffff, 0, leafH - 0.07, 0), box(0.96, 0.05, 0.05, 0xffffff, 0, leafH * 0.45, 0)];
          for (let b = 0; b < 6; b++) parts.push(cyl(0.025, leafH, 0xffffff, -0.4 + b * 0.16, 0, 0, 6));
          const bars = new THREE.Mesh(merge(parts), keyMat(key, true));
          bars.castShadow = true;
          leaf.add(bars);
        } else {
          // Work, utility and security doors: a steel slab, a window, a band of the key color.
          const slab = new THREE.Mesh(new THREE.BoxGeometry(0.96, leafH, 0.1), steel);
          slab.position.y = leafH / 2;
          slab.castShadow = true;
          const band = new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.16, 0.12), keyMat(key, false));
          band.position.y = leafH * 0.32;
          const glass = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.12), glassMat);
          glass.position.y = leafH * 0.72;
          leaf.add(slab, band, glass);
        }
        if (!ax) leaf.rotation.y = Math.PI / 2;
        const home = new THREE.Vector3(x + 0.5, 0, z + 0.5);
        leaf.position.copy(home);
        // A lintel over the gap.
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(ax ? 1 : 0.34, h - leafH, ax ? 0.34 : 1), frameMat);
        lintel.position.set(x + 0.5, leafH + (h - leafH) / 2, z + 0.5);
        lintel.castShadow = true;
        this.group.add(leaf, lintel);
        this.doors.push({ index: i, leaf, home, slide: new THREE.Vector3(ax ? 0.92 : 0, 0, ax ? 0 : 0.92), open: this.world.doorShut[i] ? 0 : 1 });
      }
    }
  }

  private buildDetectors() {
    const mat = seeThrough(new THREE.MeshStandardMaterial({ color: 0xb4bcc6, roughness: 0.35, metalness: 0.65 }));
    const light = new THREE.MeshStandardMaterial({ color: 0x3fb950, emissive: 0x2a9a3a, emissiveIntensity: 1.5 });
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        if (this.kindAt(x, z) !== TILE.DETECTOR) continue;
        const ax = this.alongX(x, z, (k) => isWall(k) || k === TILE.DETECTOR);
        const arch = new THREE.Group();
        for (const s of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.25, 0.24), mat);
          post.position.set(s * 0.44, 0.625, 0);
          post.castShadow = true;
          arch.add(post);
        }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(1, 0.16, 0.26), mat);
        beam.position.y = 1.3;
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.1), light);
        lamp.position.y = 1.41;
        arch.add(beam, lamp);
        arch.position.set(x + 0.5, 0, z + 0.5);
        if (!ax) arch.rotation.y = Math.PI / 2;
        this.group.add(arch);
      }
    }
  }

  private buildTowers() {
    const legMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.7 });
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0xc9b99a, roughness: 0.8 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.1, metalness: 0.6 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x6e3328, roughness: 0.8 });
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        if (this.kindAt(x, z) !== TILE.TOWER || this.kindAt(x - 1, z) === TILE.TOWER || this.kindAt(x, z - 1) === TILE.TOWER) continue;
        let w = 0;
        while (this.kindAt(x + w, z) === TILE.TOWER) w++;
        let d = 0;
        while (this.kindAt(x, z + d) === TILE.TOWER) d++;
        const tower = new THREE.Group();
        const H = 4.2;
        for (const [sx, sz] of [
          [0.3, 0.3],
          [w - 0.3, 0.3],
          [0.3, d - 0.3],
          [w - 0.3, d - 0.3],
        ]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, H, 0.25), legMat);
          leg.position.set(sx, H / 2, sz);
          leg.castShadow = true;
          tower.add(leg);
        }
        // Braces make it read as a structure, not a box on stilts.
        for (const y of [1.3, 2.8]) {
          const brace = new THREE.Mesh(new THREE.BoxGeometry(w - 0.4, 0.08, 0.08), legMat);
          brace.position.set(w / 2, y, d - 0.3);
          tower.add(brace);
        }
        const deck = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.15, d + 0.3), legMat);
        deck.position.set(w / 2, H, d / 2);
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 1.3, d - 0.2), cabinMat);
        cabin.position.set(w / 2, H + 0.72, d / 2);
        const glass = new THREE.Mesh(new THREE.BoxGeometry(w - 0.18, 0.5, d - 0.18), glassMat);
        glass.position.set(w / 2, H + 0.95, d / 2);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.82, 0.9, 4), roofMat);
        roof.rotation.y = Math.PI / 4;
        roof.position.set(w / 2, H + 1.82, d / 2);
        for (const m of [deck, cabin, roof]) m.castShadow = true;
        tower.add(deck, cabin, glass, roof);
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
    // Furniture is cut above waist height only: low pieces next to the player stay whole.
    const material = seeThrough(kitMaterial.clone(), 0.6);
    for (const [key, list] of groups) {
      const [kind, size] = key.split(':');
      const [w, d] = size.split('x').map(Number);
      const mesh = new THREE.InstancedMesh(propGeometry(kind as never, w, d), material, list.length);
      // rot: 0 front south (+z), 1 east, 2 north, 3 west.
      list.forEach((p, i) => this.place(mesh, i, p.x + p.w / 2, 0, p.z + p.d / 2, [0, Math.PI / 2, Math.PI, -Math.PI / 2][p.rot]));
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** Whether a fence tile runs along x (for the damage drawn on it). */
  fenceAlongX(x: number, z: number): boolean {
    return this.alongX(x, z, (k) => isFence(k) || k === TILE.DOOR || k === TILE.TOWER || k === TILE.FENCE_CUT || k === TILE.FENCE_FAKE);
  }

  /** Whether a wall tile runs along x (its long faces look north and south). */
  wallAlongX(x: number, z: number): boolean {
    return this.alongX(x, z, (k) => isWall(k) || k === TILE.DOOR || k === TILE.HOLE || k === TILE.HOLE_FAKE || k === TILE.HOLE_POSTER);
  }

  /** Fields and woods beyond the road, so the map's edge never shows the void. */
  private buildSurroundings() {
    const tex = TEX.grass().clone();
    tex.needsUpdate = true;
    tex.repeat.set(200, 200);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, color: 0xa9bd98, roughness: 1 }));
    ground.position.set(MAP_W / 2, -0.02, MAP_H / 2);
    ground.receiveShadow = true;
    this.group.add(ground);

    // Trees in a ring outside the road: a seeded scatter, one draw call.
    let s = 12345;
    const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const tree = merge([cyl(0.12, 0.7, 0x6b4a2f, 0, 0, 0, 6), cyl(0.55, 0.9, 0x3f7a3a, 0, 0.6, 0, 7), cyl(0.4, 0.7, 0x4c8c44, 0, 1.3, 0, 7), cyl(0.22, 0.5, 0x5a9c4f, 0, 1.85, 0, 6)]);
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
  update(dt: number, night: number, open?: ReadonlySet<number>) {
    for (const d of this.doors) {
      const target = this.world.doorShut[d.index] && !open?.has(d.index) ? 0 : 1;
      if (d.open !== target) d.open = target > d.open ? Math.min(target, d.open + dt * 3) : Math.max(target, d.open - dt * 3);
      // Eased, sliding into the wall.
      const e = d.open * d.open * (3 - 2 * d.open);
      d.leaf.position.copy(d.home).addScaledVector(d.slide, e);
    }
    this.lights.setNight(night);
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
