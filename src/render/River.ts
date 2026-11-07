import * as THREE from 'three';
import { TILE } from '../sim/world/tiles';
import { MAP_H, MAP_W, type World } from '../sim/world/World';
import { disposeTree } from './batch';
import { box, cyl, kitMaterial, merge, paint, type Part } from './kit';
import { hash01 } from './rand';
import { canvasTexture } from './canvas';
import { CHUNK } from './chunks';
import { riverBeyond } from './WorldView';
import { isOutside } from '../sim/hunt/world';

/** The water's surface, just over the fields' ground (y −0.02) and under every floor (y 0): it shows where no floor is drawn. */
const WATER_Y = -0.012;
/** How fast the water runs downstream (texture units a second, a texture unit RIPPLE tiles). */
const FLOW = 0.16;
const RIPPLE = 4;
/** How fast a raft drifts away (tiles a second). */
const DRIFT = 1.3;

/**
 * The river's surface: dark peat-stained water lifting into soft green-grey ripples, a few glints of sky on them;
 * every wave whole cycles across the canvas, so it tiles without a seam.
 */
let riverMap: THREE.CanvasTexture | null = null;
/** (Made once and kept, as the lamps' glow is: shared by the prison's river and its valley's in the manhunt.) */
function riverTexture(): THREE.CanvasTexture {
  return (riverMap ??= drawRiver());
}

function drawRiver(): THREE.CanvasTexture {
  const n = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const c = canvas.getContext('2d')!;
  const img = c.createImageData(n, n);
  const deep = [62, 110, 122];
  const lift = [128, 176, 178];
  const T = Math.PI * 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n;
      const w = y / n;
      const v =
        Math.sin(T * (3 * u + w) + 1.2 * Math.sin(T * 2 * w)) * 0.45 +
        Math.sin(T * (2 * w - 4 * u) + 0.8 * Math.sin(T * 3 * u)) * 0.3 +
        Math.sin(T * (8 * u + 6 * w)) * 0.15 +
        Math.sin(T * (5 * u - 9 * w)) * 0.1;
      const t = Math.pow(Math.min(1, Math.max(0, (v + 1) / 2)), 1.8);
      const k = (y * n + x) * 4;
      for (let j = 0; j < 3; j++) img.data[k + j] = Math.round(deep[j] + (lift[j] - deep[j]) * t + (t > 0.86 ? (t - 0.86) * 260 : 0));
      img.data[k + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  // Glints, only on the crests.
  for (let k = 0; k < 40; k++) {
    const x = Math.floor(hash01(k, 31) * n);
    const y = Math.floor(hash01(k, 37) * n);
    const u = x / n;
    const w = y / n;
    if (Math.sin(T * (3 * u + w) + 1.2 * Math.sin(T * 2 * w)) < 0.5) continue;
    c.fillStyle = `rgba(226,238,236,${0.3 + hash01(k, 41) * 0.35})`;
    c.fillRect(x, y, 2 + Math.floor(hash01(k, 43) * 3), 1);
  }
  const t = canvasTexture(canvas, 'sharp');
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * The water's material: the map read twice along each point's own downstream direction (`aFlow`), half a cycle
 * apart, each faded out as it would stretch (a flow map: the river runs east along its north arm, round the bend
 * and south, with no seam); `uTime` held still with reduced motion. Lit as everything else is (night, moon, fog).
 */
function waterMaterial(map: THREE.Texture, time: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.22, metalness: 0.05 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFlow;\nvarying vec2 vFlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlow = aFlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec2 vFlow;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
        float p0 = fract(uTime * ${FLOW.toFixed(3)});
        float p1 = fract(uTime * ${FLOW.toFixed(3)} + 0.5);
        float w0 = 1.0 - abs(2.0 * p0 - 1.0);
        vec4 sa = texture2D(map, vMapUv - vFlow * p0);
        vec4 sb = texture2D(map, vMapUv - vFlow * p1 + vec2(0.37, 0.21));
        diffuseColor *= mix(sb, sa, w0);
      #endif`,
      );
  };
  m.customProgramCacheKey = () => 'river-flow';
  return m;
}

/**
 * A river's surface (2.36; the Six Hunter's Hollowrun, and its valley's river in the manhunt): a quad a tile, at each
 * corner how much of the four tiles round it is bank (the shallows' tint) and the flow (the mean of the water tiles'
 * round it), so neighbouring tiles agree and nothing shows a seam. One draw call; `time` runs it.
 */
export function flowingWater(
  tiles: ReadonlyArray<readonly [number, number]>,
  wet: (x: number, z: number) => boolean,
  flowTile: (x: number, z: number) => readonly [number, number],
  time: { value: number },
  y = WATER_Y,
): THREE.Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const flow: number[] = [];
  const idx: number[] = [];
  const deep = new THREE.Color(0xd2e2e8);
  const shallow = new THREE.Color(0xe8e8cc);
  const c = new THREE.Color();
  for (const [x, z] of tiles) {
    const v0 = pos.length / 3;
    for (const [dx, dz] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]) {
      const cx = x + dx;
      const cz = z + dz;
      let land = 0;
      let fx = 0;
      let fz = 0;
      for (const [ox, oz] of [
        [-1, -1],
        [0, -1],
        [-1, 0],
        [0, 0],
      ]) {
        if (!wet(cx + ox, cz + oz)) land++;
        else {
          const [a, b] = flowTile(cx + ox, cz + oz);
          fx += a;
          fz += b;
        }
      }
      const l = Math.hypot(fx, fz) || 1;
      pos.push(cx, y, cz);
      uv.push(cx / RIPPLE, cz / RIPPLE);
      c.copy(deep).lerp(shallow, Math.min(1, land / 2));
      col.push(c.r, c.g, c.b);
      flow.push(fx / l, fz / l);
    }
    idx.push(v0, v0 + 3, v0 + 2, v0, v0 + 2, v0 + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const normals = new Float32Array(pos.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
  geo.setIndex(idx);
  const water = new THREE.Mesh(geo, waterMaterial(riverTexture(), time));
  water.receiveShadow = true;
  // (Under the floor decals and the fog veil, like the ground.)
  water.renderOrder = -0.1;
  return water;
}

/** Downstream along the longer run of water through a tile (east or south), both at a bend: `wet` says where water is. */
export function flowAlongRuns(wet: (x: number, z: number) => boolean): (x: number, z: number) => [number, number] {
  const run = (x: number, z: number, dx: number, dz: number) => {
    let n = 0;
    for (let k = 1; k < 8 && wet(x + dx * k, z + dz * k); k++) n++;
    for (let k = 1; k < 8 && wet(x - dx * k, z - dz * k); k++) n++;
    return n;
  };
  return (x, z) => {
    const ax = run(x, z, 1, 0);
    const az = run(x, z, 0, 1);
    return ax > az + 1 ? [1, 0] : az > ax + 1 ? [0, 1] : [Math.SQRT1_2, Math.SQRT1_2];
  };
}

/**
 * The river by night (review of 2.36: under the moon's blue it was the most saturated thing on screen): its colour eased
 * toward a dark peat grey, so the water reads darker than the banks, not bright teal.
 */
const PEAT = new THREE.Color(0x6e675c);
export function nightWater(mat: THREE.MeshStandardMaterial, night: number) {
  mat.color.setRGB(1, 1, 1).lerp(PEAT, night);
}

/** Banks gathered by the squares of `CHUNK` tiles they lie in, a mesh a square: the camera skips those out of sight; no shadows (a lip, a reed). */
export class Banks {
  private readonly squares = new Map<string, Part[]>();
  add(x: number, z: number, dx: number, dz: number, i: number) {
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let list = this.squares.get(key);
    if (!list) this.squares.set(key, (list = []));
    bankParts(list, x, z, dx, dz, i);
  }
  /** Extra parts (a ford's stones) in the square of (x, z). */
  push(x: number, z: number, ...parts: Part[]) {
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let list = this.squares.get(key);
    if (!list) this.squares.set(key, (list = []));
    list.push(...parts);
  }
  meshes(): THREE.Mesh[] {
    return [...this.squares.values()].map((list) => {
      const mesh = new THREE.Mesh(merge(list), kitMaterial);
      mesh.receiveShadow = true;
      return mesh;
    });
  }
}

/** The bank on land tile (x, z)'s edge facing (dx, dz) onto water: a lip of mud, now and then a stone and a clump of reeds (`i`: its own number). */
export function bankParts(parts: Part[], x: number, z: number, dx: number, dz: number, i: number) {
  const MUD = [0x5a4632, 0x4e3d2b, 0x65503a];
  const REED = [0x7f8a4a, 0x8f9a56, 0x6f7a3e, 0xa69a62];
  // The edge's middle, on the water's side of the land tile (x, z), facing (dx, dz).
  const ex = x + 0.5 + dx * 0.5;
  const ez = z + 0.5 + dz * 0.5;
  const along = dz !== 0;
  parts.push(box(along ? 1.02 : 0.24, 0.05, along ? 0.24 : 1.02, MUD[Math.floor(hash01(i, 1) * 3)], ex + dx * 0.04, -0.03, ez + dz * 0.04));
  if (hash01(i, 2) < 0.45) {
    const r = 0.09 + hash01(i, 3) * 0.12;
    const s = (hash01(i, 4) - 0.5) * 0.8;
    parts.push(
      paint(
        new THREE.DodecahedronGeometry(r, 0)
          .scale(1, 0.55, 1)
          .rotateY(hash01(i, 5) * 6)
          .translate(ex + dx * 0.12 + (along ? s : 0), WATER_Y + r * 0.2, ez + dz * 0.12 + (along ? 0 : s)),
        [0x7d7a72, 0x8e8a80, 0x6c6a64][Math.floor(hash01(i, 6) * 3)],
      ),
    );
  }
  if (hash01(i, 7) < 0.3) {
    const s = (hash01(i, 8) - 0.5) * 0.7;
    const rx = ex + dx * 0.22 + (along ? s : 0);
    const rz = ez + dz * 0.22 + (along ? 0 : s);
    for (let k = 0; k < 5; k++) {
      const h = 0.28 + hash01(i * 7 + k, 9) * 0.3;
      parts.push(
        paint(
          new THREE.ConeGeometry(0.025, h, 3)
            .rotateZ((hash01(i * 7 + k, 10) - 0.5) * 0.5)
            .rotateX((hash01(i * 7 + k, 11) - 0.5) * 0.5)
            .translate(rx + (hash01(i * 7 + k, 12) - 0.5) * 0.2, h / 2 + WATER_Y, rz + (hash01(i * 7 + k, 13) - 0.5) * 0.2),
          REED[(i + k) % REED.length],
        ),
      );
    }
    // A bulrush's brown head on the tallest.
    parts.push(cyl(0.03, 0.09, 0x5a3a22, rx, 0.42 + WATER_Y, rz, 5));
  }
}

/**
 * A river through a prison's grounds (2.36, the Six Hunter's Hollowrun; render only: the water tiles are the sim's):
 * the water running downstream over every water tile, and on past the map's edge under the road's timber bridges;
 * shallows paler at the banks; the banks a lip of mud with stones and reeds; the jetty's piles and a rowing boat tied
 * off it. A raft launched off the jetty drifts away downstream.
 */
export class River {
  readonly group = new THREE.Group();
  private readonly time = { value: 0 };
  private readonly flowAt: Float32Array;
  private readonly beyond: Array<[number, number, number, number]>;
  private leaving: { t: number; x: number; z: number } | null = null;
  private raft: THREE.Mesh | null = null;
  private readonly water: THREE.Mesh;

  constructor(world: World) {
    const base = world.ground.base;
    this.beyond = riverBeyond(world);
    const inRect = (x: number, z: number) => this.beyond.some(([x0, z0, x1, z1]) => x >= x0 && x < x1 && z >= z0 && z < z1);
    const tile = (x: number, z: number) => (world.inside(x, z) ? base[z * MAP_W + x] : -1);
    const wet = (x: number, z: number) => {
      const k = tile(x, z);
      return k === TILE.WATER || k === TILE.PIER || inRect(x, z);
    };
    // Each water tile's downstream direction: along the longer run of water through it (east or south, the way the
    // Hollowrun goes), both at a bend.
    this.flowAt = new Float32Array(MAP_W * MAP_H * 2);
    const flowOf = flowAlongRuns(wet);
    for (let z = 0; z < MAP_H; z++)
      for (let x = 0; x < MAP_W; x++) {
        if (!wet(x, z)) continue;
        const [fx, fz] = flowOf(x, z);
        this.flowAt[(z * MAP_W + x) * 2] = fx;
        this.flowAt[(z * MAP_W + x) * 2 + 1] = fz;
      }
    const flowTile = (x: number, z: number): [number, number] => {
      if (world.inside(x, z)) {
        const i = (z * MAP_W + x) * 2;
        if (this.flowAt[i] || this.flowAt[i + 1]) return [this.flowAt[i], this.flowAt[i + 1]];
      }
      const r = this.beyond.find(([x0, z0, x1, z1]) => x >= x0 && x < x1 && z >= z0 && z < z1);
      return r && r[2] - r[0] < r[3] - r[1] ? [0, 1] : [1, 0];
    };

    const tiles: Array<[number, number]> = [];
    for (let z = 0; z < MAP_H; z++)
      for (let x = 0; x < MAP_W; x++) if (tile(x, z) === TILE.WATER || tile(x, z) === TILE.PIER) tiles.push([x, z]);
    for (const [x0, z0, x1, z1] of this.beyond)
      for (let z = Math.floor(z0); z < z1; z++)
        for (let x = Math.floor(x0); x < x1; x++) if (!world.inside(x, z) || tile(x, z) !== TILE.WATER) tiles.push([x, z]);
    this.water = flowingWater(tiles, wet, flowTile, this.time);
    this.group.add(this.water);

    // The banks: a lip of mud along every edge where land meets the water, stones at its foot, reeds in the shallows
    // (in squares the camera skips out of sight, casting no shadow: review of 2.36, they were drawn whole in both passes).
    const banks = new Banks();
    const bank = (x: number, z: number, dx: number, dz: number, i: number) => banks.add(x, z, dx, dz, i);
    const parts: Part[] = [];
    const N: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    // (A dozen tiles past the edge: the camera, held over the map, sees no further.)
    const M = 12;
    for (let z = -M; z < MAP_H + M; z++)
      for (let x = -M; x < MAP_W + M; x++) {
        if (wet(x, z)) continue;
        const k = tile(x, z);
        // (Not the jetty, nor where the road crosses: the bridge's own; land beyond the map has the fields' bank.)
        if (k === TILE.PIER || (k === TILE.ROAD && inRect(x, z))) continue;
        for (const [dx, dz] of N)
          if (wet(x + dx, z + dz) && tile(x + dx, z + dz) !== TILE.PIER) bank(x, z, dx, dz, (z + M) * 997 + x + M + dx * 3 + dz * 5);
      }

    // The bridges where the road crosses the river on beyond the map: a plank deck over the road, a rail along each of
    // its sides (the road's way, across the river), a post at each end.
    for (const [x0, z0, x1, z1] of this.beyond) {
      const road: Array<[number, number]> = [];
      for (let z = Math.max(0, Math.floor(z0)); z < Math.min(MAP_H, z1); z++)
        for (let x = Math.max(0, Math.floor(x0)); x < Math.min(MAP_W, x1); x++) if (tile(x, z) === TILE.ROAD) road.push([x, z]);
      if (!road.length) continue;
      for (const [x, z] of road) {
        parts.push(box(1.0, 0.05, 1.0, [0x7a5c40, 0x86684a][(x + z) % 2], x + 0.5, 0, z + 0.5));
        for (let k = 0; k < 4; k++)
          parts.push(
            x1 - x0 > z1 - z0
              ? box(0.02, 0.006, 0.98, 0x4a3828, x + 0.125 + k * 0.25, 0.05, z + 0.5)
              : box(0.98, 0.006, 0.02, 0x4a3828, x + 0.5, 0.05, z + 0.125 + k * 0.25),
          );
      }
      const rx0 = Math.min(...road.map(([x]) => x));
      const rx1 = Math.max(...road.map(([x]) => x)) + 1;
      const rz0 = Math.min(...road.map(([, z]) => z));
      const rz1 = Math.max(...road.map(([, z]) => z)) + 1;
      const RAIL = 0x5e4630;
      const POST = 0x4f3a28;
      if (x1 - x0 > z1 - z0) {
        // The river runs along x: the road crosses north–south, its rails along z on its west and east sides.
        for (const x of [rx0 + 0.05, rx1 - 0.05]) {
          parts.push(
            box(0.08, 0.08, rz1 - rz0 + 0.3, RAIL, x, 0.5, (rz0 + rz1) / 2),
            box(0.06, 0.06, rz1 - rz0 + 0.3, RAIL, x, 0.26, (rz0 + rz1) / 2),
          );
          for (const z of [rz0 - 0.1, (rz0 + rz1) / 2, rz1 + 0.1]) parts.push(box(0.11, 0.6, 0.11, POST, x, 0, z));
        }
      } else {
        for (const z of [rz0 + 0.05, rz1 - 0.05]) {
          parts.push(
            box(rx1 - rx0 + 0.3, 0.08, 0.08, RAIL, (rx0 + rx1) / 2, 0.5, z),
            box(rx1 - rx0 + 0.3, 0.06, 0.06, RAIL, (rx0 + rx1) / 2, 0.26, z),
          );
          for (const x of [rx0 - 0.1, (rx0 + rx1) / 2, rx1 + 0.1]) parts.push(box(0.11, 0.6, 0.11, POST, x, 0, z));
        }
      }
    }

    // The jetty: its piles standing up at the corners and down the sides, a beam along each side; a rowing boat tied off it.
    let boat: [number, number] | null = null;
    for (let z = 0; z < MAP_H; z++)
      for (let x = 0; x < MAP_W; x++) {
        if (tile(x, z) !== TILE.PIER) continue;
        for (const [dx, dz] of N) {
          if (!wet(x + dx, z + dz) || tile(x + dx, z + dz) === TILE.PIER) continue;
          parts.push(box(dx ? 0.1 : 1, 0.12, dz ? 0.1 : 1, 0x5b4632, x + 0.5 + dx * 0.47, -0.1, z + 0.5 + dz * 0.47));
          for (const s of [-0.42, 0.42])
            parts.push(
              cyl(0.07, 0.42, 0x4a3a2a, x + 0.5 + dx * 0.47 + (dz ? s : 0), WATER_Y - 0.05, z + 0.5 + dz * 0.47 + (dx ? s : 0), 6),
            );
          if (dx === -1 && !boat) boat = [x - 0.75, z + 0.5];
        }
      }
    if (boat) {
      const [bx, bz] = boat;
      parts.push(
        ...[
          box(0.62, 0.18, 1.5, 0x3f5a4a, 0, 0, 0),
          box(0.5, 0.06, 1.3, 0x6e5238, 0, 0.12, 0),
          box(0.56, 0.04, 0.12, 0x8a6a48, 0, 0.18, -0.2),
          box(0.56, 0.04, 0.12, 0x8a6a48, 0, 0.18, 0.35),
          box(0.05, 0.03, 1.0, 0xc8b88a, 0.16, 0.22, 0.1),
          box(0.05, 0.03, 1.0, 0xc8b88a, -0.16, 0.22, 0.1),
          box(0.42, 0.18, 0.3, 0x3f5a4a, 0, 0, -0.82).scale(0.7, 1, 1),
        ].map((p) => p.translate(bx, WATER_Y - 0.06, bz)),
        // The painter: a rope from its bow to the jetty's pile.
        box(0.03, 0.02, 0.45, 0xc8b88a, bx + 0.35, 0.06, bz - 0.55).rotateY(0),
      );
    }
    if (parts.length) {
      const built = new THREE.Mesh(merge(parts), kitMaterial);
      built.castShadow = built.receiveShadow = true;
      this.group.add(built);
    }
    const lips = banks.meshes();
    if (lips.length) this.group.add(...lips);
  }

  /** Per frame: the water running (held still with reduced motion), dark peat by night (`night` 0–1), a raft drifting downstream. */
  update(dt: number, time: number, motion: boolean, night = 0) {
    if (motion) this.time.value = time;
    nightWater(this.water.material as THREE.MeshStandardMaterial, night);
    if (this.leaving && this.raft) {
      this.leaving.t += dt;
      const xi = Math.floor(this.leaving.x);
      const zi = Math.floor(this.leaving.z);
      let fx = 1;
      let fz = 0;
      if (
        xi >= 0 &&
        zi >= 0 &&
        xi < MAP_W &&
        zi < MAP_H &&
        (this.flowAt[(zi * MAP_W + xi) * 2] || this.flowAt[(zi * MAP_W + xi) * 2 + 1])
      ) {
        fx = this.flowAt[(zi * MAP_W + xi) * 2];
        fz = this.flowAt[(zi * MAP_W + xi) * 2 + 1];
      }
      // (Pushed off the jetty's end first, then away with the current.)
      const push = Math.max(0, 1 - this.leaving.t * 2);
      this.leaving.x += (fx * DRIFT + 0) * dt;
      this.leaving.z += (fz * DRIFT - push * 0.8) * dt;
      this.raft.position.set(this.leaving.x, WATER_Y + 0.08 + (motion ? Math.sin(time * 2.2) * 0.03 : 0), this.leaving.z);
      this.raft.rotation.z = motion ? Math.sin(time * 1.6) * 0.04 : 0;
      this.raft.rotation.y = Math.atan2(fx, fz);
    }
  }

  /** The raft pushed off from (x, z): away down the river. */
  depart(x: number, z: number) {
    this.leaving = { t: 0, x, z };
    if (!this.raft) {
      const parts: Part[] = [];
      for (let k = 0; k < 5; k++)
        parts.push(
          paint(
            new THREE.CylinderGeometry(0.1, 0.1, 1.3, 7).rotateX(Math.PI / 2).translate(-0.4 + k * 0.2, 0, 0),
            k % 2 ? 0x9a7a52 : 0xb08c5e,
          ),
        );
      parts.push(box(0.04, 1.1, 0.04, 0x6e4a2b, 0, 0, 0), paint(new THREE.PlaneGeometry(0.7, 0.8).translate(0.37, 0.65, 0), 0xe8e2d0));
      this.raft = new THREE.Mesh(merge(parts), kitMaterial);
      this.raft.castShadow = true;
      this.group.add(this.raft);
    }
  }

  /** Where the departing player is now (tiles; y up), or null when nobody is leaving. */
  carry(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.leaving || !this.raft) return null;
    return out.set(this.raft.position.x, this.raft.position.y + 0.12, this.raft.position.z);
  }

  /** Frees it all but the water's shared texture. */
  dispose() {
    disposeTree(this.group, (t) => t !== riverMap, new Set([kitMaterial]));
  }
}

/** Whether a prison has a river of its own to draw (water on its ground floor, not round an island, not the manhunt's outside). */
export function hasRiver(world: World): boolean {
  if (world.def.theme === 'island' || isOutside(world.def)) return false;
  for (let i = 0; i < MAP_W * MAP_H; i++) if (world.ground.base[i] === TILE.WATER) return true;
  return false;
}
