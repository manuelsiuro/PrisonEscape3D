import * as THREE from 'three';
import { HUNT } from '../content/manhunt';
import type { Spot, StartKind } from '../content/outside/types';
import { headingAngle } from '../sim/command';
import { spotTile, type OutsideWorld } from '../sim/hunt/world';
import { TILE } from '../sim/world/tiles';
import { MAP_W } from '../sim/world/World';
import { disposeTree } from './batch';
import { wingGeometry } from './Getaway';
import { PrisonBehind } from './huntPrison';
import { buildHouses } from './huntTown';
import { box, cyl, kitMaterial, merge, paint, type Part } from './kit';
import { carParts } from './Phone';
import { pool } from './Security';
import { runOff, scenery, water, woods, type Land } from './huntLand';
import { heliModel, vanGeometry, vehicleGeometry } from './huntModels';

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

const faceAngle = (face: number | undefined) => headingAngle(face ?? 5);
/** A tile's own small number (stable between loads). */
const HELI_Y = 6.5;
const ROADBLOCK_RISE = 0.5;
/** The most searchers (and posts) given a glow after dark. */
const GLOWS = 24;

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
  /** The prison behind the wall, and the houses' windows (lit after dark). */
  private prison: PrisonBehind | null = null;
  private glass: THREE.MeshStandardMaterial | null = null;
  /** Under the prison behind the wall (world tiles, past the edge too): no woods, roads or rivers of the outside's drawn there. */
  private readonly under = (x: number, z: number) => !!this.prison?.covers(x, z);

  /** How the player got there (P41 review: the van, glider, raft and helicopter starts began on foot, nothing to show for it): the van driving on, the glider left lying, the raft beached, the helicopter lifting away. */
  private arrival: { g: THREE.Group; kind: StartKind; t: number; dx: number; dz: number; x: number; z: number; rotor: THREE.Group | null } | null = null;

  /** The outside of a hunt (`lou`: his car waits there; `kind`: how the player got out). */
  set(o: OutsideWorld, lou: boolean, kind?: StartKind) {
    this.clear();
    const theme = o.prison.theme ?? 'suburban';
    // The prison behind its wall, and nothing of the outside's drawn over it.
    this.prison = new PrisonBehind(o);
    this.group.add(this.prison.group);
    const land: Land = { group: this.group, m: this.m, under: this.under };
    const run = runOff(land, o, theme);
    scenery(land, o, theme, run);
    const wet = water(land, o, theme);
    woods(land, theme, run.covered, wet);
    const town = buildHouses(o, theme);
    this.group.add(town.group);
    this.glass = town.glass;
    o.def.lines.forEach((l, k) => this.line(o, l, k));
    o.def.roadblocks.forEach((r) => this.roadblock(o, r.area));
    this.safePoint(o);
    if (lou) this.louCar(o, o.def.lou);
    this.helicopter();
    if (kind) this.arrive(o, kind);
  }

  /** The way out's vehicle where the player got off it (render only; nobody else sees it). */
  private arrive(o: OutsideWorld, kind: StartKind) {
    const at = o.def.starts[kind];
    if (!at || kind === 'wall' || kind === 'gate') return;
    const t = spotTile(at, o.ox, o.oz);
    const a = faceAngle(at.face);
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    let x = (t % MAP_W) + 0.5;
    let z = Math.floor(t / MAP_W) + 0.5;
    // Somewhere clear beside the player, `r` tiles off or a little further (behind first, then either side, then ahead): open ground all round it (`wide` tiles), no cover, no tree.
    const clear = (r: number, wide: number): [number, number] => {
      for (const rr of [r, r + 1, r + 2])
        for (const [ax, az] of [[-dx, -dz], [-dz, dx], [dz, -dx], [dx, dz]]) {
          const cx = x + ax * rr;
          const cz = z + az * rr;
          let ok = true;
          for (let ez = -wide; ez <= wide && ok; ez++)
            for (let ex = -wide; ex <= wide && ok; ex++) {
              const i = Math.floor(cz + ez) * MAP_W + Math.floor(cx + ex);
              if (i < 0 || i >= o.base.length || o.base[i] || o.cover[i] || !o.inside[i]) ok = false;
            }
          if (ok) return [cx, cz];
        }
      return [x - dx * r, z - dz * r];
    };
    const g = new THREE.Group();
    let rotor: THREE.Group | null = null;
    if (kind === 'van') {
      // On the road beside where they dropped off (the middle of its width), facing on along it.
      const kinds = o.world.ground.kind;
      const road = (i: number) => kinds[i] === TILE.ROAD || kinds[i] === TILE.ASPHALT;
      const px = Math.round(-dz);
      const pz = Math.round(dx);
      const run: number[] = [];
      for (let k = -3; k <= 3; k++) {
        const i = t + k * px + k * pz * MAP_W;
        if (i >= 0 && i < kinds.length && road(i)) run.push(k);
        else if (run.length && k > 0) break;
      }
      if (run.length) {
        const mid = (Math.min(...run) + Math.max(...run)) / 2;
        x += mid * px;
        z += mid * pz;
      }
      x += dx * 1.6;
      z += dz * 1.6;
      g.add(new THREE.Mesh(vanGeometry(), kitMaterial));
    } else if (kind === 'glider') {
      // Down in a heap beside them: one wing on the ground, the other up.
      const wing = new THREE.Mesh(wingGeometry(), kitMaterial);
      wing.scale.setScalar(1.3);
      wing.rotation.set(0.12, 0, 0.3);
      wing.position.y = 0.35;
      g.add(wing);
      [x, z] = clear(1.4, 1);
    } else if (kind === 'sea') {
      // Beached at the water's edge behind them.
      const parts: Part[] = [];
      for (let k = 0; k < 5; k++) parts.push(paint(new THREE.CylinderGeometry(0.1, 0.1, 1.3, 7).rotateX(Math.PI / 2).translate(-0.4 + k * 0.2, 0, 0), k % 2 ? 0xd8c08a : 0xe8d2a0));
      parts.push(box(0.04, 1.1, 0.04, 0x6e4a2b, 0, 0, 0), paint(new THREE.PlaneGeometry(0.7, 0.8).translate(0.37, 0.65, 0), 0xeef1f4));
      g.add(new THREE.Mesh(merge(parts), kitMaterial));
      g.rotation.z = 0.08;
      // (At the water's edge behind them, where they came ashore: the first water that way, a little in.)
      let r = 1.2;
      for (let k = 1; k <= 8; k++) {
        const i = Math.floor(z - dz * k) * MAP_W + Math.floor(x - dx * k);
        if (i >= 0 && i < o.world.ground.kind.length && o.world.ground.kind[i] === TILE.WATER) {
          r = k + 0.2;
          break;
        }
      }
      x -= dx * r;
      z -= dz * r;
    } else {
      // The helicopter that brought them, set down beside them, about to lift away.
      const built = heliModel(0x2f4a3a);
      g.add(built.body, built.rotor, built.tail);
      rotor = built.rotor;
      [x, z] = clear(2.4, 1);
    }
    g.traverse((m) => (m.castShadow = (m as THREE.Mesh).isMesh));
    g.position.set(x, 0, z);
    g.rotation.order = 'YXZ';
    g.rotation.y = a;
    this.group.add(g);
    this.arrival = { g, kind, t: 0, dx, dz, x, z, rotor };
  }

  /** Everything let go (back to the title, a new hunt). */
  clear() {
    // (The prison's view frees its own, its map clones with it.)
    if (this.prison) {
      this.group.remove(this.prison.group);
      this.prison.dispose();
      this.prison = null;
    }
    this.glass = null;
    this.arrival = null;
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

  /** The van drives on along the road, the helicopter lifts and flies off (both gone out of sight); the raft bobs; the glider lies where it came down. */
  private arriving(dt: number, time: number, motion: boolean) {
    const r = this.arrival;
    if (!r) return;
    // (The frame after the outside is built can be long: the moment plays out from its start all the same.)
    r.t += Math.min(dt, 0.1);
    const g = r.g;
    if (r.kind === 'van') {
      // A moment for the player to get clear, then off, faster and faster.
      const go = Math.max(0, r.t - 1.2);
      const d = motion ? 0.9 * go * go + 1.2 * go : go > 2 ? 99 : 0;
      g.position.set(r.x + r.dx * d, 0, r.z + r.dz * d);
      if (d > 22) this.leave(r);
    } else if (r.kind === 'air') {
      if (r.rotor) r.rotor.rotation.y += dt * 22;
      const go = Math.max(0, r.t - 1.5);
      const up = motion ? Math.min(9, go * go * 1.2) : go > 2 ? 99 : 0;
      const away = motion ? Math.max(0, go - 1.2) ** 2 * 1.6 : 0;
      // (Nose down on its way, over the player's head and on.)
      g.position.set(r.x + r.dx * away, up, r.z + r.dz * away);
      g.rotation.x = motion ? Math.min(0.25, Math.max(0, go - 1) * 0.15) : 0;
      if ((up >= 9 && away > 30) || (!motion && up > 9)) this.leave(r);
    } else if (r.kind === 'sea') {
      g.position.y = -0.05 + (motion ? Math.sin(time * 2.2) * 0.04 : 0);
    }
  }

  /** The arrival's vehicle gone for good. */
  private leave(r: NonNullable<HuntView['arrival']>) {
    this.group.remove(r.g);
    r.g.traverse((m) => (m as THREE.Mesh).geometry?.dispose());
    this.arrival = null;
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
    this.prison?.update(dt, night);
    if (this.glass) this.glass.emissiveIntensity = night * 0.9;
    this.arriving(dt, time, motion);
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
