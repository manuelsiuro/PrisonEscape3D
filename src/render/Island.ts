import * as THREE from 'three';
import { isSea, TILE } from '../sim/world/tiles';
import { MAP_H, MAP_W, type World } from '../sim/world/World';
import { box, cyl, kitMaterial, merge, paint, type Part } from './kit';
import { TEX } from './textures';

/** A tile's own small number (stable between loads). */
const hash = (i: number, k: number) => {
  let h = Math.imul(i ^ (k * 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** The sea's surface: deep water with lighter swells and flecks of white. */
function waveTexture(): THREE.CanvasTexture {
  const n = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#2a5a78';
  c.fillRect(0, 0, n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = Math.sin((x / n) * Math.PI * 4 + Math.sin((y / n) * Math.PI * 2) * 1.6) + Math.sin((y / n) * Math.PI * 6 + (x / n) * 2);
      if (v > 1.3) c.fillStyle = 'rgba(120,176,204,0.55)';
      else if (v < -1.2) c.fillStyle = 'rgba(18,52,74,0.5)';
      else continue;
      c.fillRect(x, y, 1, 1);
    }
  }
  c.fillStyle = 'rgba(235,245,250,0.7)';
  for (let k = 0; k < 18; k++) c.fillRect(Math.floor(hash(k, 3) * n), Math.floor(hash(k, 5) * n), 2, 1);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Foam: broken white on clear, for the surf against the rocks. */
function foamTexture(): THREE.CanvasTexture {
  const n = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const c = canvas.getContext('2d')!;
  c.clearRect(0, 0, n, n);
  for (let k = 0; k < 140; k++) {
    const a = hash(k, 11);
    c.fillStyle = `rgba(240,248,252,${0.35 + a * 0.5})`;
    c.fillRect(Math.floor(hash(k, 7) * n), Math.floor(hash(k, 9) * n), 1 + Math.floor(a * 3), 1);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** Sea level under the map's ground (y 0): the water shows where no floor is drawn. */
const SEA_Y = -0.42;

/**
 * HMP Irongate's sea and shore (P12, render only): the ocean to the horizon, swells drifting
 * across it, surf against the rocks, the island's rocky skirt down into the water, sea stacks,
 * the pier's posts, the ferry drawbridge (up until a takeover lowers it), the moored patrol
 * boat and ferry, and the supply helicopter on the court's pad at night (it comes in at 23:00
 * and leaves at 08:00, rotor turning). A departure (the raft, the helicopter) plays out here
 * while the escape screen comes up.
 */
export class Island {
  readonly group = new THREE.Group();
  private readonly waves: THREE.CanvasTexture;
  private readonly foamMat: THREE.MeshBasicMaterial;
  private readonly bridge: THREE.Group | null = null;
  private bridgeAngle = 1;
  private readonly heli: THREE.Group | null = null;
  private readonly rotor = new THREE.Group();
  private readonly tailRotor = new THREE.Group();
  private readonly beacon: THREE.MeshBasicMaterial;
  private readonly pad = new THREE.Vector3();
  private rotorTurn = 0;
  /** A departure under way: what, since when (seconds), from where. */
  private leaving: { kind: 'raft' | 'helicopter'; t: number; x: number; z: number } | null = null;
  private raft: THREE.Mesh | null = null;

  constructor(world: World) {
    const g = world.ground.base;
    const sea = (x: number, z: number) => !world.inside(x, z) || isSea(g[z * MAP_W + x]);
    // The ocean, far past the map's edges.
    this.waves = waveTexture();
    this.waves.repeat.set(70, 70);
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(320, 320).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: this.waves, color: 0x9fc4d8, roughness: 0.32, metalness: 0.12 }));
    ocean.position.set(MAP_W / 2, SEA_Y, MAP_H / 2);
    ocean.receiveShadow = true;
    this.group.add(ocean);

    // The island's rocky skirt: every land tile on the shore goes down into the water as rock.
    const skirt: Part[] = [];
    const shallow: number[] = [];
    const foam: number[] = [];
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = z * MAP_W + x;
        const land = !sea(x, z);
        let near = false;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && sea(x + dx, z + dz) !== !land) near = true;
        if (land && near) {
          const h = hash(i, 1);
          const shade = [0x5b6168, 0x666c73, 0x50565c][Math.floor(h * 3)];
          skirt.push(box(1.0, 0.88, 1.0, shade, x + 0.5, SEA_Y - 0.5, z + 0.5));
          // Rocks tumbled into the water at its foot.
          if (h < 0.5) for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (sea(x + dx, z + dz) && g[i] !== TILE.PIER) {
            const r = 0.28 + hash(i, 2 + dx * 3 + dz) * 0.3;
            skirt.push(paint(new THREE.DodecahedronGeometry(r, 0).scale(1, 0.7, 1).rotateY(h * 6).translate(x + 0.5 + dx * 0.62, SEA_Y + 0.05, z + 0.5 + dz * 0.62), 0x5f656c));
            break;
          }
        }
        if (!land && world.bridge[i] === 0) {
          if (near) foam.push(x, z);
          let d = 99;
          for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (!sea(x + dx, z + dz)) d = Math.min(d, Math.max(Math.abs(dx), Math.abs(dz)));
          if (d <= 2) shallow.push(x, z);
        }
      }
    }
    // Sea stacks and rocks off the island, beyond the map's edge too.
    let s = 7741;
    const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let k = 0, made = 0; k < 600 && made < 46; k++) {
      const x = -30 + rand() * (MAP_W + 60);
      const z = -30 + rand() * (MAP_H + 60);
      const xi = Math.floor(x);
      const zi = Math.floor(z);
      let clear = true;
      for (let dz = -3; dz <= 3 && clear; dz++) for (let dx = -3; dx <= 3; dx++) if (!sea(xi + dx, zi + dz)) clear = false;
      if (!clear) continue;
      // Off the ferry's way in and the pier's.
      if (Math.abs(x - 31) < 6 && z > 55) continue;
      if (Math.abs(z - 28) < 6 && x > 58) continue;
      const r = 0.6 + rand() * 1.6;
      const tall = rand() < 0.3 ? 1.6 + rand() * 2 : 0.5 + rand() * 0.5;
      skirt.push(paint(new THREE.DodecahedronGeometry(r, 0).scale(1, tall, 0.9).rotateY(rand() * 6).translate(x, SEA_Y + r * tall * 0.4, z), [0x585e65, 0x646a71, 0x4e545a][made % 3]));
      if (tall > 1) skirt.push(paint(new THREE.DodecahedronGeometry(r * 0.6, 0).scale(1, 0.4, 1).translate(x, SEA_Y + r * tall * 0.95, z), 0xe8ecef));
      made++;
    }
    // The pier's posts down into the water, the drawbridge's piers.
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        if (g[z * MAP_W + x] !== TILE.PIER) continue;
        for (const [dx, dz] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]) skirt.push(cyl(0.07, 0.9, 0x4a3a2a, x + dx, SEA_Y - 0.6, z + dz, 6));
        // Its edge where it meets the sea: a beam along the side.
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (sea(x + dx, z + dz) && g[(z + dz) * MAP_W + x + dx] !== TILE.PIER) skirt.push(box(dx ? 0.1 : 1, 0.16, dz ? 0.1 : 1, 0x5b4632, x + 0.5 + dx * 0.47, -0.16, z + 0.5 + dz * 0.47));
      }
    }
    // The ferry at the landing, a patrol boat moored off the dock.
    const boat = (x: number, z: number, len: number, wide: number, hull: number, cabin: number, along: boolean) => {
      const parts: Part[] = [
        box(len, 0.5, wide, hull, 0, -0.35, 0),
        box(len - 0.3, 0.12, wide - 0.2, 0xd8dde3, 0, 0.15, 0),
        box(len * 0.35, 0.55, wide * 0.7, cabin, -len * 0.12, 0.27, 0),
        box(len * 0.3, 0.16, wide * 0.72, 0x223040, -len * 0.12, 0.6, 0),
        box(0.1, 0.06, wide * 0.9, 0xd23f36, len * 0.35, 0.27, 0),
      ];
      const model = merge(parts.map((p) => (along ? p : p.rotateY(Math.PI / 2))));
      model.translate(x, SEA_Y + 0.2, z);
      return model;
    };
    const boats = new THREE.Mesh(merge([boat(31, 62.7, 7, 2, 0x2b4a6b, 0xeef1f4, true), boat(62.2, 32.4, 3, 1.1, 0x3b4048, 0xc8ccd2, false)]), kitMaterial);
    boats.castShadow = true;
    this.group.add(boats);
    const rock = new THREE.Mesh(merge(skirt), kitMaterial);
    rock.castShadow = rock.receiveShadow = true;
    this.group.add(rock);
    // Shallows over the rock shelf (a lighter, greener sea), and the surf.
    const shallowMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5fb3b8, transparent: true, opacity: 0.32, depthWrite: false }), Math.max(1, shallow.length / 2));
    const m = new THREE.Matrix4();
    for (let k = 0; k < shallow.length / 2; k++) shallowMesh.setMatrixAt(k, m.makeTranslation(shallow[k * 2] + 0.5, SEA_Y + 0.02, shallow[k * 2 + 1] + 0.5));
    shallowMesh.count = shallow.length / 2;
    shallowMesh.renderOrder = 1;
    this.group.add(shallowMesh);
    this.foamMat = new THREE.MeshBasicMaterial({ map: foamTexture(), transparent: true, opacity: 0.8, depthWrite: false });
    const foamMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.15, 1.15).rotateX(-Math.PI / 2), this.foamMat, Math.max(1, foam.length / 2));
    for (let k = 0; k < foam.length / 2; k++) foamMesh.setMatrixAt(k, m.makeRotationY(hash(k, 4) * 6).setPosition(foam[k * 2] + 0.5, SEA_Y + 0.04, foam[k * 2 + 1] + 0.5));
    foamMesh.count = foam.length / 2;
    foamMesh.renderOrder = 2;
    this.group.add(foamMesh);

    // The drawbridge: a timber deck hinged at the gate, chained up until a takeover lowers it.
    const rect = world.def.drawbridge;
    if (rect) {
      const [x0, z0, x1, z1] = rect;
      const w = x1 - x0 + 1;
      const d = z1 - z0 + 1;
      const deckTex = TEX.pier().clone();
      deckTex.needsUpdate = true;
      deckTex.repeat.set(w, d);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, d).translate(0, -0.08, d / 2), new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.9 }));
      deck.castShadow = deck.receiveShadow = true;
      const rails = new THREE.Mesh(merge([box(0.08, 0.3, d, 0x3b4048, -w / 2 + 0.04, 0, d / 2), box(0.08, 0.3, d, 0x3b4048, w / 2 - 0.04, 0, d / 2), box(w, 0.1, 0.1, 0x2b3038, 0, 0, d - 0.05)]), kitMaterial);
      rails.castShadow = true;
      this.bridge = new THREE.Group();
      this.bridge.add(deck, rails);
      this.bridge.position.set(x0 + w / 2, 0, z0);
      this.group.add(this.bridge);
      // Its stone piers either side, where the chains run up.
      const piers = new THREE.Mesh(merge([box(0.4, 2.2, 0.4, 0x5d636b, x0 - 0.2, -0.4, z0 + 0.1), box(0.4, 2.2, 0.4, 0x5d636b, x1 + 1.2, -0.4, z0 + 0.1)]), kitMaterial);
      piers.castShadow = true;
      this.group.add(piers);
    }

    // The supply helicopter, on its pad by night.
    this.beacon = new THREE.MeshBasicMaterial({ color: 0xff3a2a, toneMapped: false });
    const padProp = world.props.find((p) => p.kind === 'helipad');
    if (padProp) {
      this.pad.set(padProp.x + padProp.w / 2, 0, padProp.z + padProp.d / 2);
      const heli = new THREE.Group();
      const body = new THREE.Mesh(
        merge([
          box(1.1, 0.8, 2.0, 0x2f4a3a, 0, 0.35, 0),
          box(0.9, 0.5, 0.7, 0x2f4a3a, 0, 0.45, 1.0),
          box(0.86, 0.42, 0.5, 0x8fc3e0, 0, 0.55, 1.2),
          box(0.3, 0.3, 2.2, 0x2f4a3a, 0, 0.7, -1.9),
          box(0.08, 0.6, 0.4, 0x2f4a3a, 0, 0.85, -2.9),
          box(1.2, 0.04, 0.04, 0xeef1f4, 0, 1.18, -0.3),
          box(0.08, 0.06, 2.4, 0x1d2026, -0.55, 0, 0.1),
          box(0.08, 0.06, 2.4, 0x1d2026, 0.55, 0, 0.1),
          box(0.06, 0.32, 0.06, 0x1d2026, -0.5, 0.02, 0.6),
          box(0.06, 0.32, 0.06, 0x1d2026, 0.5, 0.02, 0.6),
          box(0.06, 0.32, 0.06, 0x1d2026, -0.5, 0.02, -0.5),
          box(0.06, 0.32, 0.06, 0x1d2026, 0.5, 0.02, -0.5),
          cyl(0.12, 0.2, 0x3b4048, 0, 1.15, 0, 8),
        ]),
        kitMaterial,
      );
      body.castShadow = true;
      const blade = merge([box(3.6, 0.03, 0.2, 0x1d2026, 0, 0, 0), box(0.2, 0.03, 3.6, 0x1d2026, 0, 0, 0)]);
      this.rotor.add(new THREE.Mesh(blade, kitMaterial));
      this.rotor.position.y = 1.36;
      this.tailRotor.add(new THREE.Mesh(merge([box(0.03, 0.7, 0.08, 0x1d2026, 0, -0.35, 0), box(0.03, 0.08, 0.7, 0x1d2026, 0, 0, -0.35)]), kitMaterial));
      this.tailRotor.position.set(0.1, 1.0, -2.95);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), this.beacon);
      light.position.set(0, 1.26, -0.6);
      heli.add(body, this.rotor, this.tailRotor, light);
      heli.rotation.y = Math.PI / 5;
      heli.position.copy(this.pad);
      heli.visible = false;
      this.heli = heli;
      this.group.add(heli);
    }
  }

  /**
   * Per frame: the swell drifting, the surf breathing, the drawbridge easing up or down, the
   * helicopter in at night (setting down at 23:00, lifting off at 08:00), a departure playing out.
   */
  update(dt: number, time: number, minuteOfDay: number, takeover: boolean, motion: boolean) {
    if (motion) {
      this.waves.offset.set((time * 0.006) % 1, (time * 0.011) % 1);
      this.foamMat.opacity = 0.55 + Math.sin(time * 1.3) * 0.25;
    }
    if (this.bridge) {
      const want = takeover ? 0 : 1;
      this.bridgeAngle += Math.sign(want - this.bridgeAngle) * Math.min(Math.abs(want - this.bridgeAngle), dt * 0.6);
      // Up: hinged at the gate and stood nearly upright.
      this.bridge.rotation.x = -this.bridgeAngle * 1.35;
    }
    if (this.heli) {
      // In from 23:00 (descending over four minutes), out at 08:00 (climbing away over four).
      const m = minuteOfDay;
      let y = 0;
      let spin = 0;
      let shown = m >= 1380 || m < 484;
      if (m >= 1380 && m < 1384) {
        y = (1384 - m) * 3.5;
        spin = 1;
      } else if (m >= 1384 && m < 1387) spin = (1387 - m) / 3;
      else if (m >= 476 && m < 480) spin = (m - 476) / 4;
      else if (m >= 480 && m < 484) {
        y = (m - 480) * 3.5;
        spin = 1;
      }
      // Leaving with the player aboard.
      if (this.leaving?.kind === 'helicopter') {
        const t = this.leaving.t;
        shown = true;
        spin = 1;
        y = Math.max(0, t - 0.6) ** 1.6 * 1.8;
        this.heli.position.z = this.pad.z - Math.max(0, t - 1.2) * 2.5;
      }
      this.heli.visible = shown;
      this.heli.position.y = y;
      if (motion) {
        this.rotorTurn += dt * spin * 26;
        this.rotor.rotation.y = this.rotorTurn;
        this.tailRotor.rotation.x = this.rotorTurn * 1.7;
      }
      this.beacon.color.setHex(Math.sin(time * 5) > 0.6 ? 0xff3a2a : 0x3a0a08);
    }
    if (this.leaving) this.leaving.t += dt;
    if (this.raft && this.leaving?.kind === 'raft') {
      const t = this.leaving.t;
      this.raft.position.set(this.leaving.x + t * 1.4, SEA_Y + 0.05 + (motion ? Math.sin(time * 2.4) * 0.05 : 0), this.leaving.z);
      this.raft.rotation.z = motion ? Math.sin(time * 1.7) * 0.06 : 0;
    }
  }

  /** The escape's last moment (P12): off on the raft from (x, z), or the helicopter lifting away. */
  depart(kind: 'raft' | 'helicopter', x: number, z: number) {
    this.leaving = { kind, t: 0, x, z };
    if (kind === 'raft' && !this.raft) {
      const parts: Part[] = [];
      for (let k = 0; k < 5; k++) parts.push(paint(new THREE.CylinderGeometry(0.1, 0.1, 1.3, 7).rotateX(Math.PI / 2).translate(-0.4 + k * 0.2, 0, 0), k % 2 ? 0xd8c08a : 0xe8d2a0));
      parts.push(box(0.04, 1.1, 0.04, 0x6e4a2b, 0, 0, 0), paint(new THREE.PlaneGeometry(0.7, 0.8).translate(0.37, 0.65, 0), 0xeef1f4));
      this.raft = new THREE.Mesh(merge(parts), kitMaterial);
      this.raft.castShadow = true;
      this.group.add(this.raft);
    }
  }

  /** Where the departing player is now (tiles; y up), or null when nobody is leaving. */
  carry(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.leaving) return null;
    if (this.leaving.kind === 'raft' && this.raft) return out.set(this.raft.position.x, this.raft.position.y + 0.12, this.raft.position.z);
    return null;
  }

  /** Whether the player is aboard the helicopter (out of sight). */
  get aboard(): boolean {
    return this.leaving?.kind === 'helicopter';
  }

  dispose() {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const mat of mats) if (mat !== kitMaterial) mat.dispose();
    });
  }
}
