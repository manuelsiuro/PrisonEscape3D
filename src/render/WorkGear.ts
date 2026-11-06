import * as THREE from 'three';
import { JOBS } from '../content/jobs';
import { zoneIndex } from '../content/zones';
import { MAP_W, type Prop, type World } from '../sim/world/World';
import { box, cyl, disc, kitMaterial, merge } from './kit';

const WHITE = 0xf2f2ee;
const ORANGE = 0xf2701c;
const GREY = 0x8f97a1;
const WOOD = 0xb07a45;
const WOOD_DARK = 0x8a5a2e;
const METAL = 0xa8b0ba;
const PLATE = 0xf2d23c;

/** What lies in a job's bin, by the item it holds: on top of the bin's rim (0.5 up), so that one bin's told from the other. */
const PILES: Partial<Record<string, () => THREE.BufferGeometry[]>> = {
  dirty_laundry: () => [
    box(0.42, 0.14, 0.34, ORANGE, -0.06, 0.5, -0.04),
    box(0.3, 0.14, 0.3, GREY, 0.1, 0.56, 0.08),
    box(0.2, 0.1, 0.22, 0xc9c2a6, -0.1, 0.64, 0.02),
  ],
  clean_laundry: () => [
    box(0.42, 0.06, 0.36, WHITE, 0, 0.5, 0),
    box(0.42, 0.06, 0.36, 0xdfe4e8, 0, 0.56, 0),
    box(0.42, 0.06, 0.36, ORANGE, 0, 0.62, 0),
  ],
  timber: () => [
    box(0.5, 0.06, 0.12, WOOD, 0, 0.5, -0.12),
    box(0.5, 0.06, 0.12, WOOD_DARK, 0, 0.5, 0.12),
    box(0.5, 0.06, 0.12, WOOD, 0, 0.56, 0),
  ],
  furniture: () => [
    box(0.3, 0.05, 0.3, WOOD, 0, 0.72, 0),
    box(0.05, 0.22, 0.05, WOOD_DARK, -0.1, 0.5, -0.1),
    box(0.05, 0.22, 0.05, WOOD_DARK, 0.1, 0.5, -0.1),
    box(0.05, 0.22, 0.05, WOOD_DARK, -0.1, 0.5, 0.1),
    box(0.05, 0.22, 0.05, WOOD_DARK, 0.1, 0.5, 0.1),
  ],
  sheet_metal: () => [
    box(0.5, 0.03, 0.4, METAL, 0, 0.5, 0),
    box(0.5, 0.03, 0.4, 0xc4cbd3, 0.02, 0.53, 0.02),
    box(0.5, 0.03, 0.4, METAL, -0.02, 0.56, -0.02),
  ],
  license_plate: () => [
    box(0.36, 0.03, 0.2, PLATE, 0, 0.5, -0.08),
    box(0.36, 0.03, 0.2, PLATE, 0.02, 0.53, 0.08),
    box(0.36, 0.03, 0.2, 0xe8c52e, -0.02, 0.56, 0),
  ],
};

/** One machine's moving part. */
interface Mover {
  kind: string;
  node: THREE.Object3D;
  /** Where it rests (y for a ram, x for a letter). */
  rest: number;
}

/**
 * The work rooms (2.30): what lies in the job's bins, there all day, and the machines' moving parts, seen only
 * while one runs: the washer's drum going round, the oven's window lit, the press's ram stamping, a stool coming
 * together on the bench, the letters being sorted. The props draw the rest; the planters are Grounds'. Nothing
 * here is the sim's. Reduced motion: the window lit, the drum and ram still, the work simply there.
 */
export class WorkGear {
  readonly group = new THREE.Group();
  private readonly movers = new Map<number, Mover>();
  private readonly owned: THREE.BufferGeometry[] = [];
  private readonly lit: THREE.Material[] = [];

  /** The gear of a prison. */
  build(world: World) {
    this.clear();
    for (const { id } of world.def.jobs) {
      const def = JOBS[id];
      const zone = zoneIndex(def.zone);
      const here = world.props.map((p, i) => ({ p, i })).filter(({ p }) => world.ground.zone[p.z * MAP_W + p.x] === zone);
      const takes = here.filter(({ p }) => p.kind === def.take);
      const puts = here.filter(({ p }) => p.kind === def.put);
      this.pile(takes[0]?.p, def.raw);
      this.pile(puts[puts.length - 1]?.p, def.done);
      for (const { p, i } of here.filter(({ p }) => p.kind === def.machine)) this.mover(p, i);
    }
  }

  private place(node: THREE.Object3D, p: Prop) {
    node.position.set(p.x + p.w / 2, 0, p.z + p.d / 2);
    node.rotation.y = (p.rot * Math.PI) / 2;
    this.group.add(node);
  }

  private mesh(parts: THREE.BufferGeometry[], material: THREE.Material = kitMaterial) {
    const g = merge(parts, false);
    this.owned.push(g);
    const m = new THREE.Mesh(g, material);
    m.castShadow = material === kitMaterial;
    return m;
  }

  /** What's in a bin, for a job that has one (the freezer, the counter and the shed show for themselves). */
  private pile(p: Prop | undefined, item: string | undefined) {
    const parts = item ? PILES[item] : undefined;
    if (!p || p.kind !== 'bin' || !parts) return;
    this.place(this.mesh(parts()), p);
  }

  private mover(p: Prop, i: number) {
    const root = new THREE.Group();
    let rest = 0;
    switch (p.kind) {
      case 'washer': {
        // A drum seen through the door, a load going round in it.
        const drum = this.mesh([
          disc(0.2, 0.02, 0x59636f, 0, 0, 0),
          box(0.14, 0.09, 0.02, ORANGE, -0.05, -0.1, 0.012),
          box(0.11, 0.08, 0.02, WHITE, 0.07, 0.02, 0.012),
        ]);
        drum.position.set(0, 0.42, 0.35);
        root.add(drum);
        // (Some stand with their door to the wall, away from the camera: a dial on top turning too, seen from anywhere.)
        const dial = this.mesh([cyl(0.13, 0.02, 0x59636f, 0, 0, 0, 12), box(0.2, 0.024, 0.05, ORANGE, 0, 0, 0)]);
        dial.position.set(0, 0.8, -0.05);
        root.add(dial);
        break;
      }
      case 'oven': {
        // The window lit from inside.
        const glow = new THREE.Mesh(
          new THREE.PlaneGeometry(0.56, 0.26),
          new THREE.MeshBasicMaterial({ color: 0xff9a2e, transparent: true, opacity: 0.85 }),
        );
        this.owned.push(glow.geometry);
        this.lit.push(glow.material);
        glow.position.set(0, 0.45, 0.375);
        root.add(glow);
        // (Every oven's window is to the wall: the hob on top glowing too, seen from anywhere.)
        const top = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.5), glow.material);
        this.owned.push(top.geometry);
        top.rotation.x = -Math.PI / 2;
        top.position.set(0, 0.42, -0.4);
        glow.add(top);
        break;
      }
      case 'press': {
        // The ram, stamping down onto the bed.
        const ram = this.mesh([box(p.w - 0.46, 0.1, p.d - 0.46, 0xe8c52e, 0, 0, 0)]);
        rest = 0.9;
        ram.position.set(0, rest, 0);
        root.add(ram);
        break;
      }
      case 'workbench': {
        // The stool coming together on the bench.
        const stool = this.mesh(PILES.furniture!());
        stool.position.set(0.1, 0.15, 0);
        stool.scale.set(0.8, 0.8, 0.8);
        root.add(stool);
        break;
      }
      case 'sortingDesk': {
        // A letter going along the desk into its pigeonhole.
        const letter = this.mesh([box(0.2, 0.02, 0.14, 0xf4efe0, 0, 0.56, 0), box(0.05, 0.022, 0.05, 0xd23f36, 0, 0.56, 0)]);
        root.add(letter);
        break;
      }
      default:
        return;
    }
    root.visible = false;
    this.place(root, p);
    this.movers.set(i, { kind: p.kind, node: root.children[0], rest });
  }

  /** Each frame: `running`, the machines going and how far through (0–1). */
  update(time: number, running: ReadonlyMap<number, number>, motion: boolean) {
    for (const [i, m] of this.movers) {
      const done = running.get(i);
      const root = m.node.parent!;
      root.visible = done !== undefined;
      if (done === undefined) continue;
      switch (m.kind) {
        case 'washer':
          m.node.rotation.z = motion ? -time * 9 : 0;
          m.node.parent!.children[1].rotation.y = motion ? -time * 5 : 0;
          break;
        case 'oven':
          (m.node as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = motion
            ? 0.72 + Math.sin(time * 7 + i) * 0.13
            : 0.85;
          break;
        case 'press':
          // Down fast, back up slowly, once a second and a bit.
          m.node.position.y = motion ? m.rest - 0.38 * Math.max(0, 1 - ((time * 0.8 + i * 0.3) % 1) * 3) : m.rest - 0.2;
          break;
        case 'workbench':
          m.node.scale.y = 0.8 * (motion ? Math.max(0.15, done) : 1);
          break;
        case 'sortingDesk':
          m.node.position.x = motion ? Math.sin(time * 2.4 + i) * 0.3 : 0;
          break;
      }
    }
  }

  clear() {
    for (const g of this.owned) g.dispose();
    this.owned.length = 0;
    for (const m of this.lit) m.dispose();
    this.lit.length = 0;
    this.group.clear();
    this.movers.clear();
  }
}
