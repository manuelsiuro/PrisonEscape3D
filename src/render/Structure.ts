import * as THREE from 'three';
import { isGrate, TILE } from '../sim/world/tiles';
import { LAYER, layerOfKey, MAP_H, MAP_W, tileOfKey, type World } from '../sim/world/World';
import { underMyDesk } from '../sim/systems/structure';
import { box, kitMaterial, merge, rod, type Part } from './kit';
import { seeThrough } from './occlusion';
import { TEX } from './textures';
import { WALL_H, type WorldView } from './WorldView';

/** The vents run on top of the walls; the roofs sit over the vents. */
export const DUCT_Y = WALL_H;
const DUCT_H = 0.42;
/** A duct is this wide (tiles): room to crawl, narrow enough to read as a duct. */
const DUCT_W = 0.6;
export const ROOF_Y = WALL_H + 0.55;
/** The height the player stands at on each layer (the tunnels are drawn on their own, at 0). */
export const LAYER_Y = [0, 0, DUCT_Y + 0.03, ROOF_Y];

const SUB = 5;

/** Brick for the lintel left over a hole (0.4 of a wall's height: courses the same size). */
function lintelBrick(): THREE.Texture {
  const t = TEX.brick().clone();
  t.repeat.set(1, 0.4);
  t.needsUpdate = true;
  return t;
}
const S = 1 / SUB;

/**
 * Everything built above and into the ground floor (GDD §1.2, §9): the ductwork over the
 * rooms (its lid off while the player crawls inside), the grates under it (shut, unscrewed
 * or behind a fake cover), the roofs (only while the player is up there), and the damage
 * on the ground floor: holes through walls, cracks, posters, cut fences, tunnel entrances,
 * dug-at floors. Damage is rebuilt from the state when it changes; the rest is built once.
 */
export class Structure {
  /** Ductwork, grates and damage: with the ground floor. */
  readonly group = new THREE.Group();
  /** Roofs: shown while the player is on them. */
  readonly roofs = new THREE.Group();
  private readonly lid: THREE.Mesh;
  /** The ducts' inside floor: only seen from inside (from below it would hide the rooms). */
  private floorMesh: THREE.Mesh | null = null;
  private readonly ducts = new THREE.Group();
  private readonly damage = new THREE.Group();
  private readonly mats: Record<string, THREE.Material>;
  private mode = -1;

  constructor(
    private readonly world: World,
    private readonly view: WorldView,
  ) {
    const ductTex = TEX.duct();
    this.mats = {
      duct: seeThrough(new THREE.MeshStandardMaterial({ map: ductTex, metalness: 0.45, roughness: 0.5, transparent: true })),
      wallTop: seeThrough(new THREE.MeshStandardMaterial({ map: TEX.wallTop(), roughness: 0.85 })),
      ductInside: new THREE.MeshStandardMaterial({ color: 0x6b737c, metalness: 0.3, roughness: 0.7, emissive: 0x1c2026 }),
      grille: seeThrough(new THREE.MeshStandardMaterial({ map: TEX.grille(), metalness: 0.4, roughness: 0.5 })),
      dark: seeThrough(new THREE.MeshBasicMaterial({ color: 0x07090c })),
      glow: new THREE.MeshBasicMaterial({ color: 0xffe6a8, transparent: true, opacity: 0.35, depthWrite: false }),
      brick: seeThrough(new THREE.MeshStandardMaterial({ map: lintelBrick(), roughness: 0.9 })),
      kit: seeThrough(kitMaterial.clone(), 0.6),
      cracks: seeThrough(new THREE.MeshStandardMaterial({ map: TEX.cracks(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 1 })),
      poster: seeThrough(new THREE.MeshStandardMaterial({ map: TEX.poster(), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 })),
      fence: new THREE.MeshStandardMaterial({ map: TEX.fence(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5 }),
      hole: new THREE.MeshBasicMaterial({ color: 0x0b0806, polygonOffset: true, polygonOffsetFactor: -2 }),
      dirt: new THREE.MeshStandardMaterial({ map: TEX.dirt(), roughness: 1, transparent: true, polygonOffset: true, polygonOffsetFactor: -1 }),
    };
    const { body, lid } = this.buildDucts();
    this.ducts.add(body);
    this.lid = lid;
    this.ducts.add(lid);
    this.group.add(this.ducts, this.damage);
    this.buildRoofs();
    this.roofs.visible = false;
  }

  private ventKind(x: number, z: number): number {
    return this.world.inside(x, z) ? this.world.layers[LAYER.VENTS].kind[z * MAP_W + x] : TILE.EMPTY;
  }

  private isDuct(x: number, z: number): boolean {
    const k = this.ventKind(x, z);
    return k === TILE.DUCT || k === TILE.LADDER || isGrate(k);
  }

  /**
   * The ductwork as one model: each duct tile is a square with arms to its duct neighbours,
   * laid out on a fine grid (fifths of a tile) so the outer walls follow every bend.
   */
  private buildDucts(): { body: THREE.Group; lid: THREE.Mesh } {
    const N = MAP_W * SUB;
    const sub = new Uint8Array(N * MAP_H * SUB);
    const lo = Math.round((1 - DUCT_W) / 2 / S);
    const hi = SUB - lo;
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        if (!this.isDuct(x, z)) continue;
        const mark = (a0: number, a1: number, b0: number, b1: number) => {
          for (let b = b0; b < b1; b++) for (let a = a0; a < a1; a++) sub[(z * SUB + b) * N + x * SUB + a] = 1;
        };
        mark(lo, hi, lo, hi);
        if (this.isDuct(x + 1, z)) mark(hi, SUB, lo, hi);
        if (this.isDuct(x - 1, z)) mark(0, lo, lo, hi);
        if (this.isDuct(x, z + 1)) mark(lo, hi, hi, SUB);
        if (this.isDuct(x, z - 1)) mark(lo, hi, 0, lo);
      }
    }
    const at = (a: number, b: number) => a >= 0 && b >= 0 && a < N && b < MAP_H * SUB && sub[b * N + a] === 1;
    const floor: Part[] = [];
    const walls: Part[] = [];
    const lids: Part[] = [];
    const T = 0.035;
    for (let b = 0; b < MAP_H * SUB; b++) {
      for (let a = 0; a < N; a++) {
        if (!at(a, b)) continue;
        const cx = (a + 0.5) * S;
        const cz = (b + 0.5) * S;
        floor.push(box(S, 0.03, S, 0xffffff, cx, DUCT_Y, cz));
        lids.push(box(S, T, S, 0xffffff, cx, DUCT_Y + DUCT_H, cz));
        if (!at(a - 1, b)) walls.push(box(T, DUCT_H, S, 0xffffff, a * S + T / 2, DUCT_Y, cz));
        if (!at(a + 1, b)) walls.push(box(T, DUCT_H, S, 0xffffff, (a + 1) * S - T / 2, DUCT_Y, cz));
        if (!at(a, b - 1)) walls.push(box(S, DUCT_H, T, 0xffffff, cx, DUCT_Y, b * S + T / 2));
        if (!at(a, b + 1)) walls.push(box(S, DUCT_H, T, 0xffffff, cx, DUCT_Y, (b + 1) * S - T / 2));
      }
    }
    const body = new THREE.Group();
    if (floor.length) {
      const f = new THREE.Mesh(merge(floor), this.mats.ductInside);
      f.receiveShadow = true;
      this.floorMesh = f;
      const w = new THREE.Mesh(merge(walls), this.mats.duct);
      w.castShadow = w.receiveShadow = true;
      body.add(f, w);
    }
    const lid = new THREE.Mesh(lids.length ? merge(lids) : new THREE.BufferGeometry(), this.mats.duct);
    lid.castShadow = true;
    return { body, lid };
  }

  /** Flat roofs over every building: gravel on top, a low parapet round the edge, a hatch at the ladder, a few vents and AC units. */
  private buildRoofs() {
    const roof = this.world.layers[LAYER.ROOF].kind;
    const isRoof = (x: number, z: number) => this.world.inside(x, z) && roof[z * MAP_W + x] !== TILE.EMPTY;
    const tiles: number[] = [];
    for (let i = 0; i < MAP_W * MAP_H; i++) if (roof[i] !== TILE.EMPTY) tiles.push(i);
    const gravel = new THREE.MeshStandardMaterial({ map: TEX.gravel(), roughness: 1 });
    const brickTex = TEX.brick().clone();
    brickTex.repeat.set(1, ROOF_Y - WALL_H);
    brickTex.needsUpdate = true;
    const side = new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.9 });
    const h = ROOF_Y - WALL_H;
    const slabs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, h, 1), [side, side, gravel, gravel, side, side], tiles.length);
    const m = new THREE.Matrix4();
    tiles.forEach((i, k) => slabs.setMatrixAt(k, m.makeTranslation((i % MAP_W) + 0.5, WALL_H + h / 2, Math.floor(i / MAP_W) + 0.5)));
    slabs.castShadow = slabs.receiveShadow = true;
    // Copings along the walls below: the rooms' layout shows on the roof (where am I?).
    const walls = tiles.filter((i) => {
      const k = this.world.ground.base[i];
      return k === TILE.BRICK || k === TILE.REINFORCED;
    });
    const coping = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.07, 1), new THREE.MeshStandardMaterial({ color: 0xa8a39a, roughness: 0.9 }), Math.max(1, walls.length));
    walls.forEach((i, k) => coping.setMatrixAt(k, m.makeTranslation((i % MAP_W) + 0.5, ROOF_Y + 0.035, Math.floor(i / MAP_W) + 0.5)));
    coping.count = walls.length;
    coping.receiveShadow = coping.castShadow = true;
    this.roofs.add(coping);
    const parts: Part[] = [];
    let n = 0;
    for (const i of tiles) {
      const x = i % MAP_W;
      const z = Math.floor(i / MAP_W);
      if (!isRoof(x, z - 1)) parts.push(box(1, 0.16, 0.1, 0x9a948a, x + 0.5, ROOF_Y, z + 0.05));
      if (!isRoof(x, z + 1)) parts.push(box(1, 0.16, 0.1, 0x9a948a, x + 0.5, ROOF_Y, z + 0.95));
      if (!isRoof(x - 1, z)) parts.push(box(0.1, 0.16, 1, 0x9a948a, x + 0.05, ROOF_Y, z + 0.5));
      if (!isRoof(x + 1, z)) parts.push(box(0.1, 0.16, 1, 0x9a948a, x + 0.95, ROOF_Y, z + 0.5));
      if (roof[i] === TILE.LADDER) {
        // The hatch: a raised frame, its lid propped open, the ladder's top rungs.
        parts.push(box(0.8, 0.12, 0.8, 0x5e646e, x + 0.5, ROOF_Y, z + 0.5), box(0.62, 0.02, 0.62, 0x0b0d10, x + 0.5, ROOF_Y + 0.12, z + 0.5));
        const lidPart = box(0.66, 0.05, 0.66, 0x8d949e, 0, 0, 0);
        lidPart.rotateX(-1.1);
        lidPart.translate(x + 0.5, ROOF_Y + 0.42, z + 0.15);
        parts.push(lidPart, box(0.05, 0.4, 0.05, 0x6a737e, x + 0.3, ROOF_Y, z + 0.4), box(0.05, 0.4, 0.05, 0x6a737e, x + 0.7, ROOF_Y, z + 0.4), rod(0.02, 0.4, 0xc0c8d2, x + 0.5, ROOF_Y + 0.3, z + 0.4));
        continue;
      }
      // Now and then an AC unit or a vent cap (a fixed scatter: the same roofs every game).
      const r = ((x * 73856093) ^ (z * 19349663)) >>> 0;
      const inner = isRoof(x - 1, z) && isRoof(x + 1, z) && isRoof(x, z - 1) && isRoof(x, z + 1);
      if (inner && r % 29 === 0 && n++ % 2 === 0) parts.push(box(0.7, 0.42, 0.55, 0xb9bec4, x + 0.5, ROOF_Y, z + 0.5), box(0.5, 0.03, 0.4, 0x3b4048, x + 0.5, ROOF_Y + 0.42, z + 0.5));
      else if (inner && r % 23 === 0) parts.push(box(0.22, 0.32, 0.22, 0x8d949e, x + 0.5, ROOF_Y, z + 0.5), box(0.32, 0.06, 0.32, 0x6a737e, x + 0.5, ROOF_Y + 0.32, z + 0.5));
    }
    const extras = new THREE.Mesh(merge(parts), kitMaterial);
    extras.castShadow = extras.receiveShadow = true;
    this.roofs.add(slabs, extras);
  }

  /**
   * Which layer the player is on: the duct lids come off in the vents, the roofs go on (and
   * the ducts under them away) on the roof.
   */
  setMode(layer: number) {
    if (layer === this.mode) return;
    this.mode = layer;
    this.lid.visible = layer !== LAYER.VENTS;
    this.ducts.visible = layer !== LAYER.ROOF;
    // From the ground floor the ductwork overhead is a ghost: the rooms under it stay readable.
    const duct = this.mats.duct;
    duct.opacity = layer === LAYER.GROUND ? 0.32 : 1;
    duct.depthWrite = layer !== LAYER.GROUND;
    if (this.floorMesh) this.floorMesh.visible = layer !== LAYER.GROUND;
    this.roofs.visible = layer === LAYER.ROOF;
  }

  /** Redraws the damage and the grates from the tiles and the wear (call when they change). */
  refresh(wear: Readonly<Record<number, number>>, playerBelow: boolean) {
    this.view.refreshTiles();
    for (const c of [...this.damage.children]) {
      this.damage.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    const w = this.world;
    const g = w.ground.kind;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = false) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.damage.add(mesh);
      return mesh;
    };
    const plane = (wd: number, ht: number) => new THREE.PlaneGeometry(wd, ht);
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      const k = g[i];
      const x = i % MAP_W;
      const z = Math.floor(i / MAP_W);
      if (k === TILE.HOLE) {
        // The wall's top stays as a rough lintel; rubble either side.
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 1), [this.mats.brick, this.mats.brick, this.mats.wallTop, this.mats.wallTop, this.mats.brick, this.mats.brick]);
        lintel.castShadow = lintel.receiveShadow = true;
        lintel.position.set(x + 0.5, WALL_H - 0.2, z + 0.5);
        this.damage.add(lintel);
        const rubble: Part[] = [];
        for (let r = 0; r < 7; r++) {
          const h = ((i * 31 + r * 17) % 10) / 10;
          const sz = 0.08 + h * 0.08;
          rubble.push(box(sz, sz * 0.8, sz, r % 3 ? 0x9a4a3a : 0x8f8a80, x + 0.15 + ((r * 0.37 + h) % 0.7), 0, z + 0.15 + ((r * 0.53 + h * 0.5) % 0.7)));
        }
        for (let r = 0; r < 4; r++) rubble.push(box(0.12, 0.1, 0.14, 0x9a4a3a, x + 0.12 + r * 0.25, WALL_H - 0.5 - (r % 2) * 0.06, z + 0.5));
        add(merge(rubble), this.mats.kit, true);
      } else if (k === TILE.HOLE_POSTER) {
        const ax = this.view.wallAlongX(x, z);
        for (const s of [-1, 1]) {
          const p = add(plane(0.62, 0.8), this.mats.poster);
          p.position.set(x + 0.5 + (ax ? 0 : s * 0.505), 0.72, z + 0.5 + (ax ? s * 0.505 : 0));
          p.rotation.y = ax ? (s > 0 ? 0 : Math.PI) : s > 0 ? Math.PI / 2 : -Math.PI / 2;
        }
      } else if (k === TILE.FENCE_CUT) {
        // Snipped open: stubs at either end and the cut flap curled back at the foot.
        const ax = this.view.fenceAlongX(x, z);
        const turn = ax ? 0 : Math.PI / 2;
        for (const s of [-1, 1]) {
          const stub = add(plane(0.22, 1.8), this.mats.fence);
          stub.position.set(x + 0.5 + (ax ? s * 0.39 : 0), 0.9, z + 0.5 + (ax ? 0 : s * 0.39));
          stub.rotation.y = turn;
        }
        const flap = add(plane(0.56, 0.7), this.mats.fence);
        flap.position.set(x + 0.5, 0.22, z + 0.5);
        flap.rotation.set(-1.15, turn, 0, 'YXZ');
      } else if (k === TILE.SHAFT && !(underMyDesk(w, i) && !playerBelow)) {
        // A dark hole with a rim of dug earth and the top of a rope ladder.
        const hole = add(plane(0.72, 0.72).rotateX(-Math.PI / 2), this.mats.hole);
        hole.position.set(x + 0.5, 0.012, z + 0.5);
        const rim: Part[] = [box(0.9, 0.07, 0.12, 0x7d5d3f, x + 0.5, 0, z + 0.08), box(0.9, 0.07, 0.12, 0x7d5d3f, x + 0.5, 0, z + 0.92), box(0.12, 0.07, 0.7, 0x86663f, x + 0.08, 0, z + 0.5), box(0.12, 0.07, 0.7, 0x86663f, x + 0.92, 0, z + 0.5)];
        rim.push(box(0.04, 0.18, 0.04, 0xa06a3a, x + 0.36, 0, z + 0.2), box(0.04, 0.18, 0.04, 0xa06a3a, x + 0.64, 0, z + 0.2));
        add(merge(rim), this.mats.kit, true);
      }
    }
    // Wear: cracks spreading in a wall, a patch of floor dug at, a fence half cut (nothing shows).
    for (const key in wear) {
      const n = Number(key);
      const layer = layerOfKey(n);
      const i = tileOfKey(n);
      const x = i % MAP_W;
      const z = Math.floor(i / MAP_W);
      const f = Math.min(1, wear[n] / 100);
      if (layer !== LAYER.GROUND) continue;
      if (g[i] === TILE.BRICK) {
        const ax = this.view.wallAlongX(x, z);
        const size = 0.45 + 0.55 * f;
        for (const s of [-1, 1]) {
          const c = add(plane(size, size), this.mats.cracks);
          c.position.set(x + 0.5 + (ax ? 0 : s * 0.502), 0.65, z + 0.5 + (ax ? s * 0.502 : 0));
          c.rotation.y = ax ? (s > 0 ? 0 : Math.PI) : s > 0 ? Math.PI / 2 : -Math.PI / 2;
        }
      } else if (g[i] !== TILE.FENCE && g[i] !== TILE.ELECTRIC) {
        const d = add(plane(0.3 + 0.5 * f, 0.3 + 0.5 * f).rotateX(-Math.PI / 2), this.mats.dirt);
        d.position.set(x + 0.5, 0.008, z + 0.5);
      }
    }
    this.buildGrates();
  }

  /** Under each grate a vent box with a grille (dark when unscrewed); inside the duct, the same seen from above. */
  private buildGrates() {
    const vents = this.world.layers[LAYER.VENTS].kind;
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      const k = vents[i];
      if (!isGrate(k) && k !== TILE.LADDER) continue;
      const x = i % MAP_W;
      const z = Math.floor(i / MAP_W);
      if (k === TILE.LADDER) {
        // In the duct, the ladder's top: a square opening with rungs leading up.
        const parts: Part[] = [box(0.06, 0.5, 0.06, 0x6a737e, x + 0.28, DUCT_Y, z + 0.5), box(0.06, 0.5, 0.06, 0x6a737e, x + 0.72, DUCT_Y, z + 0.5)];
        for (let r = 0; r < 2; r++) parts.push(rod(0.02, 0.44, 0xc0c8d2, x + 0.5, DUCT_Y + 0.15 + r * 0.2, z + 0.5));
        const m = new THREE.Mesh(merge(parts), kitMaterial);
        this.damage.add(m);
        continue;
      }
      const open = k === TILE.GRATE_OPEN;
      // The vent box hanging under the duct, its faces a grille or, unscrewed, dark.
      const hood = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.16, 0.66), open ? [this.mats.dark, this.mats.dark, this.mats.duct, this.mats.dark, this.mats.dark, this.mats.dark] : [this.mats.grille, this.mats.grille, this.mats.duct, this.mats.grille, this.mats.grille, this.mats.grille]);
      hood.position.set(x + 0.5, DUCT_Y - 0.08, z + 0.5);
      this.damage.add(hood);
      // Inside the duct: the grille in its floor, or the hole with the room's light coming up.
      const top = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.56).rotateX(-Math.PI / 2), open ? this.mats.glow : this.mats.grille);
      top.position.set(x + 0.5, DUCT_Y + 0.035, z + 0.5);
      this.damage.add(top);
    }
  }

  dispose() {
    for (const root of [this.group, this.roofs]) {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
      });
    }
    for (const m of Object.values(this.mats)) m.dispose();
  }
}
