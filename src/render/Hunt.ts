import * as THREE from 'three';
import { HUNT } from '../content/manhunt';
import type { SafeKind, Spot } from '../content/outside/types';
import { DIR_X, DIR_Z } from '../sim/command';
import { DECO, spotTile, type OutsideWorld } from '../sim/hunt/world';
import { TILE } from '../sim/world/tiles';
import { MAP_H, MAP_W } from '../sim/world/World';
import { disposeTree } from './batch';
import { box, cyl, kitMaterial, merge, paint, rod, type Part } from './kit';
import { seeThrough } from './occlusion';
import { carParts } from './Phone';
import { pool } from './Security';
import { TEX } from './textures';
import { sceneryTree } from './WorldView';

/** What the outside's own pieces need each frame (P41): the helicopter (tiles), roadblocks up and washing lines used (a bit each), whether Lou waits, how it ended. */
export interface HuntFrame {
  heli: { on: boolean; x: number; z: number; lit: boolean };
  blocks: number;
  lines: number;
  lou: boolean;
  /** OVER: once safe, the vehicle pulls away. */
  over: number;
  /** Where the player is drawn (tiles): a faint glow round them after dark, so a dark uniform still reads. */
  me: { x: number; z: number };
  /** Where the searchers are drawn (tiles): the same faint glow round each after dark (their navy was lost against the woods at night). */
  searchers?: ReadonlyArray<{ x: number; z: number }>;
}

const faceAngle = (face: number | undefined) => Math.atan2(DIR_X[face ?? 5] ?? 0, DIR_Z[face ?? 5] ?? 1);
/** A tile's own small number (stable between loads). */
const hash = (i: number, k: number) => {
  let h = Math.imul(i ^ (k * 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const HELI_Y = 6.5;
const ROADBLOCK_RISE = 0.5;
/** How far the picture's roads, tracks and railway lines run on past its edge (tiles), and how far the woods go round past the world's. */
const RUN_OFF = 44;
/** The most searchers (and posts) given a glow after dark. */
const GLOWS = 24;
/** A tile anywhere, past the world's edge too, as one number. */
const key = (x: number, z: number) => (z + 256) * 1024 + (x + 256);

/** What runs on off the picture's edge (runOff): the tiles it covers, and the rails and gravel on them. */
interface RunOff {
  covered: Set<number>;
  rails: Array<[number, number, boolean]>;
  gravel: Array<[number, number]>;
}

/**
 * The manhunt's outside in the picture (P41, render only): what the World's floors and walls
 * don't draw. Trees, cacti, rocks and crates where the map has them (and the woods past its
 * edge), hedges and culverts (cover), railway lines and gravel, rivers and fords, the washing
 * lines (their clothes gone once taken), the roadblocks (raised as they go up), the safe point's
 * vehicle or post with a ring round it, Lou's car, and the helicopter with its searchlight.
 * Built once per hunt; reads the frame, never the simulation.
 */
export class HuntView {
  readonly group = new THREE.Group();
  private readonly owned = new Set<THREE.Texture>();
  private heli: THREE.Group | null = null;
  private rotor = new THREE.Group();
  private tail = new THREE.Group();
  private beam: THREE.Mesh | null = null;
  private poolMesh: THREE.Mesh | null = null;
  private poolMat: THREE.MeshBasicMaterial | null = null;
  private beamMat: THREE.MeshBasicMaterial | null = null;
  private readonly heliAt = new THREE.Vector3();
  private heliShown = 0;
  private lines: THREE.Group[] = [];
  private blocks: Array<{ g: THREE.Group; up: number }> = [];
  private car: THREE.Group | null = null;
  private vehicle: THREE.Group | null = null;
  private vehicleFace = 0;
  private gone = 0;
  private ring: THREE.Mesh | null = null;
  private glow: THREE.Mesh | null = null;
  private glowMat: THREE.MeshBasicMaterial | null = null;
  private glows: THREE.InstancedMesh | null = null;
  private ringMat: THREE.MeshBasicMaterial | null = null;
  private readonly m = new THREE.Matrix4();

  /** The outside of a hunt (`lou`: his car waits there). */
  set(o: OutsideWorld, lou: boolean) {
    this.clear();
    const theme = o.prison.theme ?? 'suburban';
    const run = this.runOff(o, theme);
    this.scenery(o, theme, run);
    const wet = this.water(o, theme);
    this.woods(theme, run.covered, wet);
    o.def.lines.forEach((l, k) => this.line(o, l, k));
    o.def.roadblocks.forEach((r) => this.roadblock(o, r.area));
    this.safePoint(o);
    if (lou) this.louCar(o, o.def.lou);
    this.helicopter();
  }

  /** Everything let go (back to the title, a new hunt). */
  clear() {
    disposeTree(this.group, (t) => this.owned.has(t), new Set([kitMaterial]));
    this.group.clear();
    this.owned.clear();
    this.heli = null;
    this.beam = null;
    this.poolMesh = null;
    this.lines = [];
    this.blocks = [];
    this.car = null;
    this.vehicle = null;
    this.ring = null;
    this.glow = null;
    this.glows = null;
    this.glowMat = null;
    this.gone = 0;
    this.heliShown = 0;
    // (The next hunt's helicopter comes in from where it is, not from where the last one's left off.)
    this.heliAt.set(0, 0, 0);
  }

  /**
   * The picture's roads, dirt tracks and railway lines run on off its edge (P41 review: they
   * stopped square there): straight out from each edge tile of them, over the woods round the
   * picture and on past the world's edge, RUN_OFF tiles; the woods keep off them (an island
   * town's sea all round: none).
   */
  private runOff(o: OutsideWorld, theme: string): RunOff {
    const out: RunOff = { covered: new Set(), rails: [], gravel: [] };
    if (theme === 'island') return out;
    const { w, h, ox, oz } = o;
    const kinds = o.world.ground.kind;
    const byTex = new Map<'road' | 'trail', number[]>();
    const sides: Array<[number, number, number, number]> = [];
    for (let px = 0; px < w; px++) sides.push([px, 0, 0, -1], [px, h - 1, 0, 1]);
    for (let pz = 0; pz < h; pz++) sides.push([0, pz, -1, 0], [w - 1, pz, 1, 0]);
    for (const [px, pz, dx, dz] of sides) {
      const x0 = px + ox;
      const z0 = pz + oz;
      const i0 = z0 * MAP_W + x0;
      const k = kinds[i0];
      const tex = k === TILE.ROAD ? 'road' : k === TILE.DIRT ? 'trail' : null;
      if (!tex) continue;
      for (let s = 1; s <= RUN_OFF; s++) {
        const x = x0 + dx * s;
        const z = z0 + dz * s;
        out.covered.add(key(x, z));
        // (Where the world's band round the picture has it already: a road's first tiles out.)
        if (x >= 0 && z >= 0 && x < MAP_W && z < MAP_H && kinds[z * MAP_W + x] === k) continue;
        let list = byTex.get(tex);
        if (!list) byTex.set(tex, (list = []));
        list.push(x, z);
        if (o.deco[i0] === DECO.RAIL) out.rails.push([x, z, dx !== 0]);
        else if (o.deco[i0] === DECO.GRAVEL) out.gravel.push([x, z]);
      }
    }
    // (Laid as the floors are: a tile of the same texture each, a faint shade; over the band's grass, and on past the edge over the fields.)
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const color = new THREE.Color();
    for (const [tex, cells] of byTex) {
      const mat = new THREE.MeshStandardMaterial({ map: TEX[tex](), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const mesh = new THREE.InstancedMesh(geo, mat, cells.length / 2);
      for (let k = 0; k < cells.length / 2; k++) {
        const x = cells[k * 2];
        const z = cells[k * 2 + 1];
        mesh.setMatrixAt(k, this.m.makeTranslation(x + 0.5, 0.001, z + 0.5));
        mesh.setColorAt(k, color.setScalar(0.95 + ((((x * 73856093) ^ (z * 19349663)) >>> 0) % 1000) / 1000 * 0.07));
      }
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    return out;
  }

  /** The woods round past the world's edge (the prison's view leaves the manhunt's to this one): a seeded scatter, clear of the roads and rivers running out. */
  private woods(theme: string, ...keepOff: ReadonlyArray<ReadonlySet<number>>) {
    if (theme === 'island') return;
    let s = 12345;
    const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const spots: Array<[number, number, number]> = [];
    const clear = (x: number, z: number) => {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (keepOff.some((k) => k.has(key(Math.floor(x) + dx, Math.floor(z) + dz)))) return false;
      return true;
    };
    for (let k = 0; k < 1500 && spots.length < 280; k++) {
      const x = -24 + rand() * (MAP_W + 48);
      const z = -24 + rand() * (MAP_H + 48);
      if (x > -2 && x < MAP_W + 2 && z > -2 && z < MAP_H + 2) continue;
      if (!clear(x, z) || spots.some(([a, b]) => (a - x) ** 2 + (b - z) ** 2 < 2.2)) continue;
      spots.push([x, z, 0.8 + rand() * 0.9]);
    }
    if (!spots.length) return;
    const trees = new THREE.InstancedMesh(sceneryTree(theme), kitMaterial, spots.length);
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    spots.forEach(([x, z, k], i) => trees.setMatrixAt(i, this.m.compose(v.set(x, 0, z), q.setFromAxisAngle(up, rand() * Math.PI), sc.set(k, k * (0.9 + rand() * 0.3), k))));
    trees.castShadow = true;
    this.group.add(trees);
  }

  // ---------------------------------------------------------------- built once
  private scenery(o: OutsideWorld, theme: string, run: RunOff) {
    const tall = seeThrough(kitMaterial.clone(), 0.3);
    const low = kitMaterial;
    const at: Record<number, number[]> = {};
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      const d = o.deco[i];
      if (!d) continue;
      // The woods past the map's edge: a tree on most tiles, not all (fewer to draw); none on a road running on out.
      if (d === DECO.WOODS && (hash(i, 7) < 0.45 || run.covered.has(key(i % MAP_W, Math.floor(i / MAP_W))))) continue;
      (at[d] ??= []).push(i);
    }
    const instanced = (geo: THREE.BufferGeometry, tiles: number[] | undefined, mat: THREE.Material, place: (i: number, k: number, m: THREE.Matrix4) => void, shadow = true) => {
      if (!tiles?.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, tiles.length);
      const m = new THREE.Matrix4();
      tiles.forEach((t, k) => {
        place(t, k, m);
        mesh.setMatrixAt(k, m);
      });
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const put = (m: THREE.Matrix4, t: number, jitter: number, scale: number, turn: number) => {
      const x = (t % MAP_W) + 0.5 + (hash(t, 1) - 0.5) * jitter;
      const z = Math.floor(t / MAP_W) + 0.5 + (hash(t, 2) - 0.5) * jitter;
      q.setFromAxisAngle(up, turn);
      m.compose(v.set(x, 0, z), q, sc.set(scale, scale * (0.9 + hash(t, 4) * 0.25), scale));
    };
    // Trees (an island town's are the suburbs' leafy ones), the woods past the edge bigger and looser.
    const tree = sceneryTree(theme === 'island' ? 'suburban' : theme);
    const trees = [...(at[DECO.TREE] ?? []), ...(at[DECO.WOODS] ?? [])];
    instanced(tree, trees, tall, (t, _k, m) => put(m, t, o.inside[t] ? 0.25 : 0.7, (o.inside[t] ? 0.82 : 1.05) + hash(t, 3) * 0.3, hash(t, 5) * Math.PI * 2));
    instanced(sceneryTree('desert'), at[DECO.CACTUS], tall, (t, _k, m) => put(m, t, 0.2, 0.8 + hash(t, 3) * 0.3, hash(t, 5) * Math.PI * 2));
    // Rocks: a boulder or two, grey (sandstone in the desert, snow-capped in the Alps).
    const rockColor = theme === 'desert' ? 0xb48a62 : theme === 'industrial' ? 0x7c7a72 : 0x8d9096;
    const rock = merge([
      paint(new THREE.DodecahedronGeometry(0.42, 0).scale(1.1, 0.75, 1).translate(0, 0.28, 0), rockColor),
      paint(new THREE.DodecahedronGeometry(0.24, 0).translate(0.3, 0.16, 0.18), rockColor),
      ...(theme === 'alpine' ? [paint(new THREE.DodecahedronGeometry(0.3, 0).scale(1.1, 0.35, 1).translate(0, 0.55, 0), 0xf2f6fb)] : []),
    ]);
    instanced(rock, at[DECO.ROCK], tall, (t, _k, m) => put(m, t, 0.2, 0.9 + hash(t, 3) * 0.3, hash(t, 5) * Math.PI * 2));
    // Crates and containers stacked in the yards (a rusty wreck or a wagon reads the same from up here).
    const crate = merge([box(0.92, 0.9, 0.92, 0x8a6a42), box(0.94, 0.06, 0.94, 0x6a5232, 0, 0.45), box(0.7, 0.62, 0.7, 0x9a7a4e, 0.05, 0.9, 0.04)]);
    const container = merge([box(0.96, 1.1, 0.96, 0x9c3b2e), ...[-0.3, 0, 0.3].map((x) => box(0.04, 1.0, 0.98, 0x7e2f25, x, 0.05))]);
    const crates = at[DECO.CRATES] ?? [];
    instanced(crate, crates.filter((t) => hash(t, 9) < 0.5), tall, (t, _k, m) => put(m, t, 0.06, 1, Math.floor(hash(t, 5) * 4) * (Math.PI / 2)));
    instanced(container, crates.filter((t) => hash(t, 9) >= 0.5), tall, (t, _k, m) => put(m, t, 0, 1, 0));
    // Hedges and thickets (cover): dense low bushes filling the tile.
    const leaf = theme === 'alpine' ? 0x3d6650 : theme === 'desert' ? 0x8a8a4e : theme === 'industrial' ? 0x5f6b45 : 0x3f7a3a;
    const leaf2 = theme === 'alpine' ? 0xe8eef4 : theme === 'desert' ? 0x9c9a5a : theme === 'industrial' ? 0x6e7a50 : 0x4f8f45;
    const hedge = merge([cyl(0.5, 0.62, leaf, 0, 0, 0, 7), cyl(0.36, 0.3, leaf2, 0.1, 0.55, -0.05, 7), cyl(0.3, 0.25, leaf, -0.18, 0.52, 0.16, 6)]);
    instanced(hedge, at[DECO.HEDGE], tall, (t, _k, m) => put(m, t, 0.1, 0.95 + hash(t, 3) * 0.15, hash(t, 5) * Math.PI * 2));
    // Culverts: under the road, a concrete headwall and the pipe's dark mouth at each edge of it.
    const mouth = merge([box(0.96, 0.3, 0.14, 0x9a9890, 0, -0.04, 0), paint(new THREE.CircleGeometry(0.26, 12, 0, Math.PI).translate(0, -0.02, 0.075), 0x14171c), box(0.62, 0.05, 0.16, 0x7e7c75, 0, 0.26, 0)]);
    const mouths: number[] = [];
    const mouthTurn: number[] = [];
    for (const t of at[DECO.CULVERT] ?? []) {
      // The road runs along x (its neighbours east or west are road): the pipe runs across it, along z; its mouths face north and south where the road ends.
      const roadAlongX = o.world.ground.kind[t - 1] === TILE.ROAD || o.world.ground.kind[t + 1] === TILE.ROAD;
      for (const [d, turn] of roadAlongX ? ([[-MAP_W, Math.PI], [MAP_W, 0]] as const) : ([[-1, -Math.PI / 2], [1, Math.PI / 2]] as const)) {
        const n = t + d;
        if (o.deco[n] === DECO.CULVERT || o.world.ground.kind[n] === TILE.ROAD) continue;
        mouths.push(t);
        mouthTurn.push(turn);
      }
    }
    instanced(mouth, mouths, low, (t, k, m) => {
      const turn = mouthTurn[k];
      q.setFromAxisAngle(up, turn);
      m.compose(v.set((t % MAP_W) + 0.5 + Math.sin(turn) * 0.5, 0, Math.floor(t / MAP_W) + 0.5 + Math.cos(turn) * 0.5), q, sc.set(1, 1, 1));
    }, false);
    // Railway lines: two rails on sleepers, along the line's run.
    const rails = merge([box(1.0, 0.05, 0.14, 0x5a4634, 0, 0, -0.32), box(1.0, 0.05, 0.14, 0x5a4634, 0, 0, 0.32), box(0.16, 0.05, 0.86, 0x5a4634, -0.3, 0), box(0.16, 0.05, 0.86, 0x5a4634, 0.2, 0), box(1.0, 0.07, 0.05, 0xa4a8ae, 0, 0.05, -0.2), box(1.0, 0.07, 0.05, 0xa4a8ae, 0, 0.05, 0.2)], false);
    instanced(rails, at[DECO.RAIL], low, (t, _k, m) => {
      const alongX = o.deco[t - 1] === DECO.RAIL || o.deco[t + 1] === DECO.RAIL;
      q.setFromAxisAngle(up, alongX ? 0 : Math.PI / 2);
      m.compose(v.set((t % MAP_W) + 0.5, 0.005, Math.floor(t / MAP_W) + 0.5), q, sc.set(1, 1, 1));
    }, false);
    // (And on off the picture's edge, along the line's run.)
    const railsOut = run.rails.map(([x, z]) => z * MAP_W + x);
    if (railsOut.length) instanced(rails.clone(), railsOut, low, (_t, k, m) => {
      const [x, z, alongX] = run.rails[k];
      q.setFromAxisAngle(up, alongX ? 0 : Math.PI / 2);
      m.compose(v.set(x + 0.5, 0.005, z + 0.5), q, sc.set(1, 1, 1));
    }, false);
    // Gravel: a scatter of grey stones over the tile.
    const stones: Part[] = [];
    for (let k = 0; k < 7; k++) stones.push(paint(new THREE.DodecahedronGeometry(0.05 + hash(k, 11) * 0.04, 0).translate(hash(k, 12) - 0.5, 0.02, hash(k, 13) - 0.5), 0x8c8a84));
    const pebbles = merge(stones, false);
    instanced(pebbles, at[DECO.GRAVEL], low, (t, _k, m) => put(m, t, 0, 1, hash(t, 5) * Math.PI * 2), false);
    if (run.gravel.length) instanced(pebbles.clone(), run.gravel.map(([x, z]) => z * MAP_W + x), low, (_t, k, m) => {
      const [x, z] = run.gravel[k];
      q.setFromAxisAngle(up, hash(key(x, z), 5) * Math.PI * 2);
      m.compose(v.set(x + 0.5, 0, z + 0.5), q, sc.set(1, 1, 1));
    }, false);
  }

  /** Rivers and fords (an island's sea is the Island view's): water where the floor isn't drawn, shallows a little paler; a river running off the world's edge carries on out of sight. The tiles it carries on over, past the edge (keyed). */
  private water(o: OutsideWorld, theme: string): Set<number> {
    const wet = new Set<number>();
    const deep: Array<[number, number]> = [];
    const ford: Array<[number, number]> = [];
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      if (o.world.ground.kind[i] !== TILE.WATER) continue;
      const x = i % MAP_W;
      const z = Math.floor(i / MAP_W);
      if (o.ford[i]) ford.push([x, z]);
      else if (theme !== 'island') {
        deep.push([x, z]);
        // (At the world's edge: on out, never ending square.)
        const [dx, dz] = x === 0 ? [-1, 0] : x === MAP_W - 1 ? [1, 0] : z === 0 ? [0, -1] : z === MAP_H - 1 ? [0, 1] : [0, 0];
        if (dx || dz) for (let k = 1; k <= RUN_OFF; k++) {
          deep.push([x + dx * k, z + dz * k]);
          wet.add(key(x + dx * k, z + dz * k));
        }
      }
    }
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const lay = (tiles: Array<[number, number]>, color: number, y: number, opacity: number) => {
      if (!tiles.length) return;
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.1, transparent: opacity < 1, opacity });
      const mesh = new THREE.InstancedMesh(geo, mat, tiles.length);
      const m = new THREE.Matrix4();
      tiles.forEach(([x, z], k) => mesh.setMatrixAt(k, m.makeTranslation(x + 0.5, y, z + 0.5)));
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    // (Over the ground round the map, which lies a touch lower.)
    lay(deep, theme === 'alpine' ? 0x35607e : 0x3e7090, -0.008, 1);
    // A ford: the stream bed showing through.
    lay(ford, theme === 'alpine' ? 0x7fa8bf : 0x7aa4b4, 0.004, 0.85);
    return wet;
  }

  /** A washing line: two posts, the line between them, clothes pegged on it (gone once taken). */
  private line(o: OutsideWorld, l: Spot, k: number) {
    const g = new THREE.Group();
    const posts = merge([cyl(0.04, 1.3, 0x7a5a3a, -0.75, 0), cyl(0.04, 1.3, 0x7a5a3a, 0.75, 0), box(1.5, 0.015, 0.015, 0xe8e2d4, 0, 1.22)]);
    g.add(new THREE.Mesh(posts, kitMaterial));
    const clothes = new THREE.Mesh(merge([box(0.34, 0.42, 0.03, 0x4a6a96, -0.4, 0.8), box(0.3, 0.5, 0.03, 0xc8a24a, 0.02, 0.72), box(0.3, 0.34, 0.03, 0xe2ddd0, 0.42, 0.88)]), kitMaterial);
    clothes.name = 'clothes';
    clothes.castShadow = true;
    g.add(clothes);
    // Beside the tile the player stands on, running the way it says (1: along x; 5: along z).
    const along = l.face === 5 ? 'z' : 'x';
    const t = spotTile(l, o.ox, o.oz);
    g.position.set((t % MAP_W) + 0.5 + (along === 'z' ? 0.6 : 0), 0, Math.floor(t / MAP_W) + 0.5 - (along === 'x' ? 0.6 : 0));
    g.rotation.y = along === 'z' ? Math.PI / 2 : 0;
    g.userData.k = k;
    this.lines.push(g);
    this.group.add(g);
  }

  /** A roadblock's barrier across its tiles: red and white boards on trestles, a cone at each end (down until it goes up). */
  private roadblock(o: OutsideWorld, [x0, z0, x1, z1]: readonly [number, number, number, number]) {
    const w = x1 - x0 + 1;
    const d = z1 - z0 + 1;
    const across = Math.max(w, d);
    const parts: Part[] = [];
    for (let k = 0; k < across * 3; k++) parts.push(box(1 / 3, 0.16, 0.08, k % 2 ? 0xf4f1ea : 0xd23f36, -across / 2 + (k + 0.5) / 3, 0.62));
    for (const s of [-1, 1]) parts.push(box(0.06, 0.62, 0.3, 0x3a3f46, s * (across / 2 - 0.15), 0), paint(new THREE.ConeGeometry(0.16, 0.42, 8).translate(s * (across / 2 + 0.3), 0.21, 0.3), 0xff7a1a));
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(merge(parts), kitMaterial);
    mesh.castShadow = true;
    g.add(mesh);
    g.position.set(x0 + o.ox + w / 2, 0, z0 + o.oz + d / 2);
    if (d > w) g.rotation.y = Math.PI / 2;
    g.visible = false;
    this.blocks.push({ g, up: 0 });
    this.group.add(g);
  }

  /** The safe point: its vehicle or post where the def says, and a ring of light round its tiles. */
  private safePoint(o: OutsideWorld) {
    const def = o.def;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(vehicleGeometry(def.safeKind), kitMaterial));
    g.children[0].castShadow = true;
    const t = spotTile(def.safeAt, o.ox, o.oz);
    g.position.set((t % MAP_W) + 0.5, 0, Math.floor(t / MAP_W) + 0.5);
    this.vehicleFace = faceAngle(def.safeAt.face);
    g.rotation.y = this.vehicleFace;
    this.vehicle = g;
    this.group.add(g);
    const [x0, z0, x1, z1] = def.safe;
    const r = Math.min(4, (def.safeKind === 'border' ? z1 - z0 + 1 : Math.max(x1 - x0 + 1, z1 - z0 + 1)) / 2 + 0.3);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0.6, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 48).rotateX(-Math.PI / 2), this.ringMat);
    // (A border, a strip across the map: the ring by the post's road, in the middle of the safe ground beyond the wire.)
    const cx = def.safeKind === 'border' ? (t % MAP_W) + 0.5 : x0 + o.ox + (x1 - x0 + 1) / 2;
    const cz = z0 + o.oz + (z1 - z0 + 1) / 2;
    this.ring.position.set(cx, 0.05, cz);
    this.ring.renderOrder = 6;
    this.group.add(this.ring);
  }

  private louCar(o: OutsideWorld, at: Spot) {
    const { body, glass, lamps } = carParts();
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(merge([...body, ...glass, ...lamps]), kitMaterial);
    mesh.castShadow = true;
    g.add(mesh);
    const t = spotTile(at, o.ox, o.oz);
    // On the spot itself (open road, a tile either way along its length: manhunttest checks), its nose the way it faces.
    const a = faceAngle(at.face);
    g.position.set((t % MAP_W) + 0.5, 0, Math.floor(t / MAP_W) + 0.5);
    g.rotation.y = a;
    this.car = g;
    this.group.add(g);
  }

  private helicopter() {
    const g = new THREE.Group();
    const body = merge([
      box(1.0, 0.8, 2.2, 0x1e3a5f, 0, 0),
      box(0.9, 0.5, 0.7, 0x9fc4d8, 0, 0.3, 0.9),
      box(0.18, 0.18, 2.2, 0x1e3a5f, 0, 0.45, -2.1),
      box(0.06, 0.6, 0.4, 0xe8b828, 0, 0.5, -3.1),
      box(1.3, 0.05, 0.08, 0x2a2f36, 0, -0.25, 0.5),
      box(1.3, 0.05, 0.08, 0x2a2f36, 0, -0.25, -0.5),
      box(0.05, 0.25, 1.3, 0x2a2f36, 0.55, -0.25, 0),
      box(0.05, 0.25, 1.3, 0x2a2f36, -0.55, -0.25, 0),
    ]);
    g.add(new THREE.Mesh(body, kitMaterial));
    g.children[0].castShadow = true;
    const blade = merge([box(4.2, 0.03, 0.18, 0x22262c, 0, 0), box(0.18, 0.03, 4.2, 0x22262c, 0, 0)]);
    this.rotor = new THREE.Group();
    this.rotor.add(new THREE.Mesh(blade, kitMaterial));
    this.rotor.position.y = 0.95;
    this.tail = new THREE.Group();
    this.tail.add(new THREE.Mesh(merge([box(0.03, 0.8, 0.1, 0x22262c, 0, -0.4)]), kitMaterial));
    this.tail.position.set(0.08, 0.55, -3.1);
    g.add(this.rotor, this.tail);
    g.visible = false;
    this.heli = g;
    this.group.add(g);
    // Its searchlight: a pale cone down to the ground, the pool where it lands.
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(HUNT.heliLight, HELI_Y, 24, 1, true).translate(0, HELI_Y / 2, 0), this.beamMat);
    this.beam.visible = false;
    this.poolMat = new THREE.MeshBasicMaterial({ map: pool(), color: 0xfff1c8, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    this.poolMesh = new THREE.Mesh(new THREE.PlaneGeometry(HUNT.heliLight * 2.2, HUNT.heliLight * 2.2).rotateX(-Math.PI / 2), this.poolMat);
    this.poolMesh.renderOrder = 7;
    this.poolMesh.visible = false;
    this.group.add(this.beam, this.poolMesh);
  }

  // ---------------------------------------------------------------- every frame
  update(f: HuntFrame, dt: number, time: number, night: number, motion: boolean) {
    // A faint glow at the player's feet after dark (their outline reads against the ground, in any clothes).
    if (!this.glow) {
      this.glowMat = new THREE.MeshBasicMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      this.glow = new THREE.Mesh(new THREE.CircleGeometry(0.62, 28).rotateX(-Math.PI / 2), this.glowMat);
      this.glow.renderOrder = 5;
      this.group.add(this.glow);
    }
    this.glow.position.set(f.me.x, 0.05, f.me.z);
    this.glowMat!.opacity = 0.16 * night;
    this.glow.visible = night > 0;
    // The same round each searcher (their navy against the dark woods), the same material.
    if (!this.glows) {
      this.glows = new THREE.InstancedMesh(this.glow.geometry, this.glowMat!, GLOWS);
      this.glows.count = 0;
      this.glows.renderOrder = 5;
      this.glows.frustumCulled = false;
      this.group.add(this.glows);
    }
    const others = night > 0 ? (f.searchers ?? []) : [];
    this.glows.count = Math.min(GLOWS, others.length);
    for (let k = 0; k < this.glows.count; k++) this.glows.setMatrixAt(k, this.m.makeTranslation(others[k].x, 0.05, others[k].z));
    this.glows.instanceMatrix.needsUpdate = true;
    // The helicopter: in from the edge as it comes up, the rotor turning, its light on the ground (brighter after dark, white on the player when it holds them).
    const h = f.heli;
    this.heliShown += ((h.on ? 1 : 0) - this.heliShown) * Math.min(1, dt * 1.5);
    if (this.heli && this.beam && this.poolMesh && this.poolMat && this.beamMat) {
      const on = this.heliShown > 0.01;
      this.heli.visible = this.beam.visible = this.poolMesh.visible = on;
      if (on) {
        const k = Math.min(1, dt * 6);
        if (this.heliAt.lengthSq() === 0) this.heliAt.set(h.x, 0, h.z);
        const dx = h.x - this.heliAt.x;
        const dz = h.z - this.heliAt.z;
        this.heliAt.x += dx * k;
        this.heliAt.z += dz * k;
        const y = HELI_Y + (1 - this.heliShown) * 6;
        this.heli.position.set(this.heliAt.x, y + (motion ? Math.sin(time * 1.3) * 0.08 : 0), this.heliAt.z - 0.8);
        if (Math.abs(dx) + Math.abs(dz) > 0.002) this.heli.rotation.y = Math.atan2(dx, dz);
        this.heli.rotation.x = motion ? 0.12 : 0;
        this.rotor.rotation.y += motion ? dt * 26 : 0;
        this.tail.rotation.x += motion ? dt * 30 : 0;
        this.beam.position.set(this.heliAt.x, 0, this.heliAt.z);
        this.beam.scale.set(1, y / HELI_Y, 1);
        this.poolMesh.position.set(this.heliAt.x, 0.06, this.heliAt.z);
        this.poolMat.opacity = (0.22 + night * 0.5 + (h.lit ? 0.2 : 0)) * this.heliShown;
        this.poolMat.color.setHex(h.lit ? 0xffffff : 0xfff1c8);
        this.beamMat.opacity = (0.04 + night * 0.12) * this.heliShown;
      }
    }
    // Washing lines: the clothes gone once taken.
    for (const g of this.lines) {
      const c = g.getObjectByName('clothes');
      if (c) c.visible = !(f.lines & (1 << g.userData.k));
    }
    // Roadblocks: raised as they go up.
    this.blocks.forEach((b, k) => {
      const up = (f.blocks & (1 << k)) !== 0;
      if (up) b.up = Math.min(1, b.up + dt / ROADBLOCK_RISE);
      b.g.visible = b.up > 0;
      b.g.scale.y = motion ? Math.max(0.05, b.up) : up ? 1 : 0.05;
    });
    if (this.car) this.car.visible = f.lou;
    // Safe: the ring glows; away, the vehicle pulls out along its facing.
    if (this.ring && this.ringMat) {
      this.ringMat.opacity = f.over ? 0 : 0.35 + (motion ? (Math.sin(time * 3) + 1) * 0.2 : 0.2);
      this.ring.scale.setScalar(motion ? 1 + Math.sin(time * 3) * 0.04 : 1);
    }
    if (f.over === 1 && this.vehicle) {
      this.gone = Math.min(6, this.gone + dt * (0.6 + this.gone));
      this.vehicle.position.x += Math.sin(this.vehicleFace) * dt * this.gone * (motion ? 1 : 0);
      this.vehicle.position.z += Math.cos(this.vehicleFace) * dt * this.gone * (motion ? 1 : 0);
    }
    if (f.over === 2 && this.car) {
      this.gone = Math.min(6, this.gone + dt * (0.6 + this.gone));
      const a = this.car.rotation.y;
      this.car.position.x += Math.sin(a) * dt * this.gone * (motion ? 1 : 0);
      this.car.position.z += Math.cos(a) * dt * this.gone * (motion ? 1 : 0);
    }
  }

  /** The safe point's vehicle and Lou's car, where the player would get in (hidden in it once away: the view hides the player). */
  get away(): boolean {
    return this.gone > 0.3;
  }
}

/** The safe point's vehicle or post (nose toward +z, centered): a bus, a border barrier with its sign, a boxcar, a rig, a coach. */
function vehicleGeometry(kind: SafeKind): THREE.BufferGeometry {
  const wheels = (w: number, zs: number[], r = 0.26) => zs.flatMap((z) => [-1, 1].map((s) => rod(r, 0.2, 0x15171b, s * (w / 2 - 0.08), r, z, 10)));
  switch (kind) {
    case 'bus':
    case 'coach': {
      const paintC = kind === 'bus' ? 0xe8b828 : 0x2f6fa8;
      const w = 1.3;
      return merge([
        box(w, 1.2, 4.6, paintC, 0, 0.25),
        box(w + 0.02, 0.36, 4.2, 0x1c2a38, 0, 0.85),
        box(w - 0.1, 0.06, 4.4, 0xf4f1ea, 0, 1.45),
        box(w - 0.2, 0.4, 0.04, 0x1c2a38, 0, 0.75, 2.31),
        ...wheels(w, [1.5, -1.5]),
      ]);
    }
    case 'truck': {
      const w = 1.3;
      return merge([
        box(w, 1.0, 1.4, 0xb03e2c, 0, 0.3, 2.2),
        box(w - 0.1, 0.34, 0.05, 0x1c2a38, 0, 0.8, 2.92),
        box(w, 1.5, 3.6, 0xdcdcd4, 0, 0.35, -0.4),
        box(0.12, 0.6, 0.12, 0x9aa1ab, 0.5, 1.3, 1.6),
        ...wheels(w, [2.2, 0.3, -1.6]),
      ]);
    }
    case 'train': {
      const w = 1.2;
      return merge([box(w, 1.3, 4.4, 0x7a3f2a, 0, 0.35), box(w + 0.02, 0.9, 1.0, 0x2a1e18, 0, 0.5, 0), box(w - 0.1, 0.06, 4.3, 0x5a2f20, 0, 1.65), ...wheels(w, [1.5, -1.5], 0.22)]);
    }
    case 'border':
    default: {
      // The barrier across the road, a striped pole on a post, the frontier's sign and flag.
      const parts: Part[] = [cyl(0.08, 1.0, 0x3a3f46, -1.1, 0), box(0.2, 0.2, 0.2, 0x3a3f46, -1.1, 0.9)];
      for (let k = 0; k < 8; k++) parts.push(box(0.28, 0.1, 0.1, k % 2 ? 0xf4f1ea : 0xd23f36, -0.95 + k * 0.28, 0.95));
      parts.push(cyl(0.04, 2.4, 0x9aa1ab, 1.4, 0), box(0.7, 0.45, 0.03, 0x2f6fa8, 1.77, 1.85), box(0.9, 0.5, 0.06, 0x2f6fa8, 1.4, 1.1, -0.2), box(0.75, 0.08, 0.07, 0xf4f1ea, 1.4, 1.3, -0.17));
      return merge(parts);
    }
  }
}
