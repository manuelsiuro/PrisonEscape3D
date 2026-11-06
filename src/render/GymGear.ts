import * as THREE from 'three';
import { TILE_INFO } from '../sim/world/tiles';
import { MAP_W, type Prop, type World } from '../sim/world/World';
import { cyl, disc, kitMaterial, merge, rod } from './kit';

const METAL = 0x8d949e;
const DARK = 0x23262b;
const RED = 0xb8352f;
/** The bar's height on the bench's uprights, and how high a press takes it. */
const BAR_REST = 0.62;
const BAR_PRESS = 0.3;
/** Where a bar lies from its bench's middle (over the chest of whoever's lying there), where the bag hangs from. */
const BAR_Z = -0.25;
const BAG_TOP = 1.15;

/** How far back along a bench someone lies when there's a wall at its foot (the Training Block's): off its head rather than into the wall. The bar comes with them. */
export const benchBack = (w: World, p: Prop) => (TILE_INFO[w.ground.kind[(p.z + p.d) * MAP_W + p.x]].solid ? 0.4 : 0);

/** What a machine is doing this frame: how high the press (0–1). */
export type GearUse = { prop: number; up: number };

/**
 * The gym's moving parts (2.29): each bench's bar, on its uprights until someone lifts it, and each punching bag,
 * swinging from what hits it. The props draw the rest. Nothing here is the sim's. Reduced motion: the bar goes
 * where it's pressed to, the bag hangs still.
 */
export class GymGear {
  readonly group = new THREE.Group();
  private bars = new Map<number, THREE.Mesh>();
  /** Where each bar lies at rest, and where it's lifted (z). */
  private barZ = new Map<number, [number, number]>();
  private bags = new Map<number, { pivot: THREE.Mesh; swing: number; speed: number }>();

  /** The gear of a prison. */
  build(world: World) {
    this.clear();
    world.props.forEach((p, i) => {
      if (p.kind === 'weights') {
        const bar = new THREE.Mesh(
          merge([rod(0.025, 0.9, METAL, 0, 0, 0), disc(0.12, 0.05, DARK, -0.4, 0, 0), disc(0.12, 0.05, DARK, 0.4, 0, 0)], false),
          kitMaterial,
        );
        bar.position.set(p.x + p.w / 2, BAR_REST, p.z + p.d / 2 + BAR_Z);
        bar.castShadow = true;
        this.group.add(bar);
        this.bars.set(i, bar);
        this.barZ.set(i, [bar.position.z, bar.position.z - benchBack(world, p)]);
      } else if (p.kind === 'punchingBag') {
        const pivot = new THREE.Mesh(
          merge([cyl(0.2, 0.75, RED, 0, -0.75, 0, 12), cyl(0.21, 0.04, 0x3b4048, 0, -0.53, 0, 12)], false),
          kitMaterial,
        );
        pivot.position.set(p.x + p.w / 2, BAG_TOP, p.z + p.d / 2);
        pivot.castShadow = true;
        this.group.add(pivot);
        this.bags.set(i, { pivot, swing: 0, speed: 0 });
      }
    });
  }

  clear() {
    for (const m of [...this.bars.values(), ...[...this.bags.values()].map((b) => b.pivot)]) m.geometry.dispose();
    this.group.clear();
    this.bars.clear();
    this.barZ.clear();
    this.bags.clear();
  }

  /** A blow on a bag, from the south (who hits it stands there): it swings away north, its foot going back. */
  hit(prop: number, motion: boolean) {
    const b = this.bags.get(prop);
    if (b && motion) b.speed += 2.4;
  }

  /** Each frame: the bars where they're pressed to (a frame's `uses`, in use; all others back on the uprights), the bags swinging down to still. */
  update(dt: number, uses: readonly GearUse[], motion: boolean) {
    for (const [i, bar] of this.bars) {
      const use = uses.find((u) => u.prop === i);
      const y = BAR_REST + (use ? 0.08 + use.up * BAR_PRESS : 0);
      bar.position.y = motion ? bar.position.y + (y - bar.position.y) * Math.min(1, dt * 16) : y;
      const [rest, lifted] = this.barZ.get(i)!;
      bar.position.z = use ? lifted : rest;
    }
    for (const b of this.bags.values()) {
      b.speed += (-b.swing * 30 - b.speed * 3) * dt;
      b.swing += b.speed * dt;
      if (!motion) b.swing = b.speed = 0;
      b.pivot.rotation.x = b.swing;
    }
  }
}
