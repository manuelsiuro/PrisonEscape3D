/**
 * The open country round the prison for the hunt: the run-off and its cover, the scenery, the
 * water, and the woods, built into the view's group (`under`: a tile the prison stands on).
 */
import * as THREE from 'three';
import { DECO, type OutsideWorld } from '../sim/hunt/world';
import { TILE } from '../sim/world/tiles';
import { MAP_H, MAP_W } from '../sim/world/World';
import { box, cyl, kitMaterial, merge, paint, type Part } from './kit';
import { seeThrough } from './occlusion';
import { TEX } from './textures';
import { sceneryTree } from './WorldView';
import { hash01, seeded } from './rand';

/** How far the picture's roads, tracks and railway lines run on past its edge (tiles), and how far the woods go round past the world's. */
const RUN_OFF = 44;
/** A tile anywhere, past the world's edge too, as one number. */
const key = (x: number, z: number) => (z + 256) * 1024 + (x + 256);

/** What runs on off the picture's edge (runOff): the tiles it covers, and the rails and gravel on them. */
export interface RunOff {
  covered: Set<number>;
  rails: Array<[number, number, boolean]>;
  gravel: Array<[number, number]>;
}

/** Where the land is built, and the prison's footprint to keep clear. */
export interface Land {
  group: THREE.Group;
  m: THREE.Matrix4;
  under: (x: number, z: number) => boolean;
}

/**
 * The picture's roads, dirt tracks and railway lines run on off its edge (P41 review: they
 * stopped square there): straight out from each edge tile of them, over the woods round the
 * picture and on past the world's edge, RUN_OFF tiles; the woods keep off them (an island
 * town's sea all round: none).
 */
export function runOff(land: Land, o: OutsideWorld, theme: string): RunOff {
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
      if (land.under(x, z)) break;
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
      mesh.setMatrixAt(k, land.m.makeTranslation(x + 0.5, 0.001, z + 0.5));
      mesh.setColorAt(k, color.setScalar(0.95 + ((((x * 73856093) ^ (z * 19349663)) >>> 0) % 1000) / 1000 * 0.07));
    }
    mesh.receiveShadow = true;
    land.group.add(mesh);
  }
  return out;
}

/** The woods round past the world's edge (the prison's view leaves the manhunt's to this one): a seeded scatter, clear of the roads and rivers running out. */
export function woods(land: Land, theme: string, ...keepOff: ReadonlyArray<ReadonlySet<number>>) {
  if (theme === 'island') return;
  const rand = seeded(12345);
  const spots: Array<[number, number, number]> = [];
  const clear = (x: number, z: number) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (keepOff.some((k) => k.has(key(Math.floor(x) + dx, Math.floor(z) + dz)))) return false;
    return true;
  };
  for (let k = 0; k < 1500 && spots.length < 280; k++) {
    const x = -24 + rand() * (MAP_W + 48);
    const z = -24 + rand() * (MAP_H + 48);
    if (x > -2 && x < MAP_W + 2 && z > -2 && z < MAP_H + 2) continue;
    if (land.under(Math.floor(x), Math.floor(z)) || land.under(Math.floor(x + 0.9), Math.floor(z + 0.9)) || land.under(Math.floor(x - 0.9), Math.floor(z - 0.9))) continue;
    if (!clear(x, z) || spots.some(([a, b]) => (a - x) ** 2 + (b - z) ** 2 < 2.2)) continue;
    spots.push([x, z, 0.8 + rand() * 0.9]);
  }
  if (!spots.length) return;
  const trees = new THREE.InstancedMesh(sceneryTree(theme), kitMaterial, spots.length);
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  spots.forEach(([x, z, k], i) => trees.setMatrixAt(i, land.m.compose(v.set(x, 0, z), q.setFromAxisAngle(up, rand() * Math.PI), sc.set(k, k * (0.9 + rand() * 0.3), k))));
  trees.castShadow = true;
  land.group.add(trees);
}

// ---------------------------------------------------------------- built once
export function scenery(land: Land, o: OutsideWorld, theme: string, run: RunOff) {
  const tall = seeThrough(kitMaterial.clone(), 0.3);
  const low = kitMaterial;
  const at: Record<number, number[]> = {};
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    const d = o.deco[i];
    if (!d) continue;
    // The woods past the map's edge: a tree on most tiles, not all (fewer to draw); none on a road running on out.
    if (d === DECO.WOODS && (hash01(i, 7) < 0.45 || run.covered.has(key(i % MAP_W, Math.floor(i / MAP_W))) || land.under(i % MAP_W, Math.floor(i / MAP_W)))) continue;
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
    land.group.add(mesh);
  };
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const put = (m: THREE.Matrix4, t: number, jitter: number, scale: number, turn: number) => {
    const x = (t % MAP_W) + 0.5 + (hash01(t, 1) - 0.5) * jitter;
    const z = Math.floor(t / MAP_W) + 0.5 + (hash01(t, 2) - 0.5) * jitter;
    q.setFromAxisAngle(up, turn);
    m.compose(v.set(x, 0, z), q, sc.set(scale, scale * (0.9 + hash01(t, 4) * 0.25), scale));
  };
  // Trees (an island town's are the suburbs' leafy ones), the woods past the edge bigger and looser.
  const tree = sceneryTree(theme === 'island' ? 'suburban' : theme);
  const trees = [...(at[DECO.TREE] ?? []), ...(at[DECO.WOODS] ?? [])];
  instanced(tree, trees, tall, (t, _k, m) => put(m, t, o.inside[t] ? 0.25 : 0.7, (o.inside[t] ? 0.82 : 1.05) + hash01(t, 3) * 0.3, hash01(t, 5) * Math.PI * 2));
  instanced(sceneryTree('desert'), at[DECO.CACTUS], tall, (t, _k, m) => put(m, t, 0.2, 0.8 + hash01(t, 3) * 0.3, hash01(t, 5) * Math.PI * 2));
  // Rocks: a boulder or two, grey (sandstone in the desert, snow-capped in the Alps).
  const rockColor = theme === 'desert' ? 0xb48a62 : theme === 'industrial' ? 0x7c7a72 : 0x8d9096;
  const rock = merge([
    paint(new THREE.DodecahedronGeometry(0.42, 0).scale(1.1, 0.75, 1).translate(0, 0.28, 0), rockColor),
    paint(new THREE.DodecahedronGeometry(0.24, 0).translate(0.3, 0.16, 0.18), rockColor),
    ...(theme === 'alpine' ? [paint(new THREE.DodecahedronGeometry(0.3, 0).scale(1.1, 0.35, 1).translate(0, 0.55, 0), 0xf2f6fb)] : []),
  ]);
  instanced(rock, at[DECO.ROCK], tall, (t, _k, m) => put(m, t, 0.2, 0.9 + hash01(t, 3) * 0.3, hash01(t, 5) * Math.PI * 2));
  // Crates and containers stacked in the yards (a rusty wreck or a wagon reads the same from up here).
  const crate = merge([box(0.92, 0.9, 0.92, 0x8a6a42), box(0.94, 0.06, 0.94, 0x6a5232, 0, 0.45), box(0.7, 0.62, 0.7, 0x9a7a4e, 0.05, 0.9, 0.04)]);
  const container = merge([box(0.96, 1.1, 0.96, 0x9c3b2e), ...[-0.3, 0, 0.3].map((x) => box(0.04, 1.0, 0.98, 0x7e2f25, x, 0.05))]);
  const crates = at[DECO.CRATES] ?? [];
  instanced(crate, crates.filter((t) => hash01(t, 9) < 0.5), tall, (t, _k, m) => put(m, t, 0.06, 1, Math.floor(hash01(t, 5) * 4) * (Math.PI / 2)));
  instanced(container, crates.filter((t) => hash01(t, 9) >= 0.5), tall, (t, _k, m) => put(m, t, 0, 1, 0));
  // Hedges and thickets (cover): dense low bushes filling the tile.
  const leaf = theme === 'alpine' ? 0x3d6650 : theme === 'desert' ? 0x8a8a4e : theme === 'industrial' ? 0x5f6b45 : 0x3f7a3a;
  const leaf2 = theme === 'alpine' ? 0xe8eef4 : theme === 'desert' ? 0x9c9a5a : theme === 'industrial' ? 0x6e7a50 : 0x4f8f45;
  const hedge = merge([cyl(0.5, 0.62, leaf, 0, 0, 0, 7), cyl(0.36, 0.3, leaf2, 0.1, 0.55, -0.05, 7), cyl(0.3, 0.25, leaf, -0.18, 0.52, 0.16, 6)]);
  instanced(hedge, at[DECO.HEDGE], tall, (t, _k, m) => put(m, t, 0.1, 0.95 + hash01(t, 3) * 0.15, hash01(t, 5) * Math.PI * 2));
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
  for (let k = 0; k < 7; k++) stones.push(paint(new THREE.DodecahedronGeometry(0.05 + hash01(k, 11) * 0.04, 0).translate(hash01(k, 12) - 0.5, 0.02, hash01(k, 13) - 0.5), 0x8c8a84));
  const pebbles = merge(stones, false);
  instanced(pebbles, at[DECO.GRAVEL], low, (t, _k, m) => put(m, t, 0, 1, hash01(t, 5) * Math.PI * 2), false);
  if (run.gravel.length) instanced(pebbles.clone(), run.gravel.map(([x, z]) => z * MAP_W + x), low, (_t, k, m) => {
    const [x, z] = run.gravel[k];
    q.setFromAxisAngle(up, hash01(key(x, z), 5) * Math.PI * 2);
    m.compose(v.set(x + 0.5, 0, z + 0.5), q, sc.set(1, 1, 1));
  }, false);
}

/** Rivers and fords (an island's sea is the Island view's): water where the floor isn't drawn, shallows a little paler; a river running off the world's edge carries on out of sight. The tiles it carries on over, past the edge (keyed). */
export function water(land: Land, o: OutsideWorld, theme: string): Set<number> {
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
      if (dx || dz) for (let k = 1; k <= RUN_OFF && !land.under(x + dx * k, z + dz * k); k++) {
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
    land.group.add(mesh);
  };
  // (Over the ground round the map, which lies a touch lower.)
  lay(deep, theme === 'alpine' ? 0x35607e : 0x3e7090, -0.008, 1);
  // A ford: the stream bed showing through.
  lay(ford, theme === 'alpine' ? 0x7fa8bf : 0x7aa4b4, 0.004, 0.85);
  return wet;
}
