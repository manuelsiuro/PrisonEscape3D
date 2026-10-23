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
import { sceneryTree } from './WorldView';

/** What the outside's own pieces need each frame (P41): the helicopter (tiles), roadblocks up and washing lines used (a bit each), whether Lou waits, how it ended. */
export interface HuntFrame {
  heli: { on: boolean; x: number; z: number; lit: boolean };
  blocks: number;
  lines: number;
  lou: boolean;
  /** OVER: once safe, the vehicle pulls away. */
  over: number;
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
  private ringMat: THREE.MeshBasicMaterial | null = null;

  /** The outside of a hunt (`lou`: his car waits there). */
  set(o: OutsideWorld, lou: boolean) {
    this.clear();
    const theme = o.prison.theme ?? 'suburban';
    this.scenery(o, theme);
    this.water(o, theme);
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
    this.gone = 0;
    this.heliShown = 0;
  }

  // ---------------------------------------------------------------- built once
  private scenery(o: OutsideWorld, theme: string) {
    const tall = seeThrough(kitMaterial.clone(), 0.3);
    const low = kitMaterial;
    const at: Record<number, number[]> = {};
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      const d = o.deco[i];
      if (!d) continue;
      // The woods past the map's edge: a tree on most tiles, not all (fewer to draw).
      if (d === DECO.WOODS && hash(i, 7) < 0.45) continue;
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
    instanced(tree, trees, tall, (t, _k, m) => put(m, t, o.inside[t] ? 0.25 : 0.7, (o.inside[t] ? 1.05 : 1.2) + hash(t, 3) * 0.4, hash(t, 5) * Math.PI * 2));
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
    // Culverts: a concrete pipe's mouth under the road, dark inside.
    const pipe = merge([rod(0.42, 1.0, 0x9a9890, 0, 0.0, 0, 10), rod(0.3, 1.02, 0x22262c, 0, 0.0, 0, 10)]);
    instanced(pipe, at[DECO.CULVERT], low, (t, _k, m) => {
      const x = t % MAP_W;
      const roadAlongX = o.world.ground.kind[t - 1] === TILE.ROAD || o.world.ground.kind[t + 1] === TILE.ROAD;
      q.setFromAxisAngle(up, roadAlongX ? Math.PI / 2 : 0);
      m.compose(v.set(x + 0.5, -0.12, Math.floor(t / MAP_W) + 0.5), q, sc.set(1, 1, 1));
    }, false);
    // Railway lines: two rails on sleepers, along the line's run.
    const rails = merge([box(1.0, 0.05, 0.14, 0x5a4634, 0, 0, -0.32), box(1.0, 0.05, 0.14, 0x5a4634, 0, 0, 0.32), box(0.16, 0.05, 0.86, 0x5a4634, -0.3, 0), box(0.16, 0.05, 0.86, 0x5a4634, 0.2, 0), box(1.0, 0.07, 0.05, 0xa4a8ae, 0, 0.05, -0.2), box(1.0, 0.07, 0.05, 0xa4a8ae, 0, 0.05, 0.2)], false);
    instanced(rails, at[DECO.RAIL], low, (t, _k, m) => {
      const alongX = o.deco[t - 1] === DECO.RAIL || o.deco[t + 1] === DECO.RAIL;
      q.setFromAxisAngle(up, alongX ? 0 : Math.PI / 2);
      m.compose(v.set((t % MAP_W) + 0.5, 0.005, Math.floor(t / MAP_W) + 0.5), q, sc.set(1, 1, 1));
    }, false);
    // Gravel: a scatter of grey stones over the tile.
    const stones: Part[] = [];
    for (let k = 0; k < 7; k++) stones.push(paint(new THREE.DodecahedronGeometry(0.05 + hash(k, 11) * 0.04, 0).translate(hash(k, 12) - 0.5, 0.02, hash(k, 13) - 0.5), 0x8c8a84));
    instanced(merge(stones, false), at[DECO.GRAVEL], low, (t, _k, m) => put(m, t, 0, 1, hash(t, 5) * Math.PI * 2), false);
  }

  /** Rivers and fords (an island's sea is the Island view's): water where the floor isn't drawn, shallows a little paler. */
  private water(o: OutsideWorld, theme: string) {
    const deep: number[] = [];
    const ford: number[] = [];
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      if (o.world.ground.kind[i] !== TILE.WATER) continue;
      if (o.ford[i]) ford.push(i);
      else if (theme !== 'island') deep.push(i);
    }
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const lay = (tiles: number[], color: number, y: number, opacity: number) => {
      if (!tiles.length) return;
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.1, transparent: opacity < 1, opacity });
      const mesh = new THREE.InstancedMesh(geo, mat, tiles.length);
      const m = new THREE.Matrix4();
      tiles.forEach((t, k) => mesh.setMatrixAt(k, m.makeTranslation((t % MAP_W) + 0.5, y, Math.floor(t / MAP_W) + 0.5)));
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    lay(deep, theme === 'alpine' ? 0x3f6f8e : 0x3e7090, -0.06, 1);
    // A ford: the stream bed showing through.
    lay(ford, theme === 'alpine' ? 0x7fa8bf : 0x7aa4b4, 0.0, 0.85);
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
    const r = Math.min(4, Math.max(x1 - x0 + 1, z1 - z0 + 1) / 2 + 0.3);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0.6, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 48).rotateX(-Math.PI / 2), this.ringMat);
    // (A border: the ring at the post, where the wire is crossed by the road.)
    const cx = def.safeKind === 'border' ? (t % MAP_W) + 0.5 : x0 + o.ox + (x1 - x0 + 1) / 2;
    const cz = def.safeKind === 'border' ? Math.floor(t / MAP_W) - 0.5 : z0 + o.oz + (z1 - z0 + 1) / 2;
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
    // Pulled over beside the spot (the player gets in from it), its nose the way it faces.
    const a = faceAngle(at.face);
    g.position.set((t % MAP_W) + 0.5 + Math.cos(a) * 0.9, 0, Math.floor(t / MAP_W) + 0.5 - Math.sin(a) * 0.9);
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
