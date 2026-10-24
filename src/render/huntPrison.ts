import * as THREE from 'three';
import type { OutsideWorld } from '../sim/hunt/world';
import { LAYER, MAP_H, MAP_W, parseRows, World } from '../sim/world/World';
import { seeThrough } from './occlusion';
import { Island } from './Island';
import { Structure } from './Structure';
import { TEX } from './textures';
import { WALL_H, wallBlock, WorldView } from './WorldView';

/** Over the outside's floors (the same height would flicker), under anyone's feet. */
const LIFT = 0.012;

/**
 * The prison itself behind the manhunt's wall (P41 review: there were only woods past it): the
 * run's own prison as the game draws it, roofs on, seen from outside. Turned round so its front
 * gate faces the outside, the gate in line with the opening in the outside's wall, the road along
 * its front just behind that wall. Irongate's island lies out across the water from the town's
 * quays. Render only, built once a hunt; nobody walks there (the outside's tiles past its wall are
 * solid woods to the hunt, as before).
 */
export class PrisonBehind {
  readonly group = new THREE.Group();
  /** The prison itself, turned and placed (the group holds it and the outer wall carried on past the picture). */
  private readonly inner = new THREE.Group();
  /** The outer wall's tiles carried on past the picture, along the prison's front (world x), and the row. */
  private readonly wallOn: number[] = [];
  private wallRow = -1;
  private readonly own: Array<THREE.Texture | THREE.Material | THREE.BufferGeometry> = [];
  private readonly view: WorldView;
  private readonly structure: Structure;
  /** Irongate's shore (rock, shallows, surf) and drawbridge round the island. */
  private readonly island: Island | null = null;
  /** The prison's corners in the outside's world (tiles): x0, z0, x1, z1 (exclusive). */
  readonly box: readonly [number, number, number, number];

  constructor(o: OutsideWorld) {
    const world = new World(o.prison);
    this.view = new WorldView(world, null, true);
    this.structure = new Structure(world, this.view);
    this.structure.setMode(LAYER.ROOF);
    this.inner.add(this.view.group, this.structure.group, this.structure.roofs);
    this.group.add(this.inner);
    const wallRow = o.oz + o.h - 1;
    if (o.prison.theme === 'island') {
      // Out across the water past the town's quays, as it lies (the island's north shore toward the town), its shore with it.
      this.island = new Island(world, true);
      this.inner.add(this.island.group);
      this.inner.position.set(0, LIFT, wallRow - 1);
      this.box = [0, wallRow - 1, MAP_W, wallRow - 1 + MAP_H];
    } else {
      // Turned round (its front, the south side, toward the outside), the front gate in the outside wall's opening.
      const rows = parseRows(o.prison.ground);
      let gz = MAP_H - 1;
      while (gz > 0 && !rows[gz].includes('g')) gz--;
      const gateMax = rows[gz].lastIndexOf('g');
      const last = (o.def.map.replace(/^\n+|\n+$/g, '').split('\n')[o.h - 1] ?? '').split('');
      let open = last.findIndex((c) => c !== '@');
      if (open < 0) open = Math.floor(o.w / 2);
      // Tile (x, z) of the prison lands on (tx - 1 - x, tz - 1 - z): its last row just behind the wall, its gate's east tile on the opening's west one.
      const tx = o.ox + open + gateMax + 1;
      const tz = wallRow + 1 + MAP_H;
      this.inner.rotation.y = Math.PI;
      this.inner.position.set(tx, LIFT, tz);
      this.box = [tx - MAP_W, tz - MAP_H, tx, tz];
      // The outer wall carried on along the prison's front past the picture's edge (it stopped in the woods).
      this.wallRow = wallRow;
      for (let x = tx - MAP_W; x < tx; x++) if (x < o.ox || x >= o.ox + o.w) this.wallOn.push(x);
      if (this.wallOn.length) {
        const map = TEX.reinforced().clone();
        map.repeat.set(1, WALL_H);
        map.needsUpdate = true;
        const side = seeThrough(new THREE.MeshStandardMaterial({ map, roughness: 0.95 }));
        const top = seeThrough(new THREE.MeshStandardMaterial({ map: TEX.reinforced(), color: 0xc4c4c4, roughness: 0.95 }));
        const geo = wallBlock();
        const mesh = new THREE.InstancedMesh(geo, [side, top], this.wallOn.length);
        const m = new THREE.Matrix4();
        this.wallOn.forEach((x, k) => mesh.setMatrixAt(k, m.makeTranslation(x + 0.5, WALL_H / 2, wallRow + 0.5)));
        mesh.castShadow = mesh.receiveShadow = true;
        this.group.add(mesh);
        this.own.push(map, side, top, geo);
      }
    }
  }

  /** Whether a world tile (anywhere, past the edge too) lies under the prison. */
  covers(x: number, z: number): boolean {
    const [x0, z0, x1, z1] = this.box;
    if (z === this.wallRow && this.wallOn.includes(x)) return true;
    return x >= x0 && x < x1 && z >= z0 && z < z1;
  }

  /** Its lamps and lit windows after dark. */
  update(dt: number, night: number) {
    this.view.update(dt, night);
  }

  dispose() {
    for (const t of this.own) t.dispose();
    this.island?.dispose();
    this.structure.dispose();
    this.view.dispose();
  }
}
