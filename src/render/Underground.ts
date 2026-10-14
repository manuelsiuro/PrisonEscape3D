import * as THREE from 'three';
import { isTunnel, TILE, TILE_INFO } from '../sim/world/tiles';
import { LAYER, MAP_H, MAP_W, type World } from '../sim/world/World';
import { box, kitMaterial, merge, type Part } from './kit';
import { seeThrough } from './occlusion';
import { TEX } from './textures';

/** How tall the earth stands around a tunnel (low enough to see down into it). */
const EARTH_H = 0.8;

/**
 * The tunnels (layer −1, GDD §9.2), drawn in place of the ground floor while the player is
 * down there: packed earth everywhere, its top faintly tinted by what stands above (walls
 * darker, fences rust, roads grey) so the player knows where they are under the prison;
 * dug tiles open into trenches with a trodden floor, timber braces, and a shaft of daylight
 * under each entrance. A lantern goes with the player.
 */
export class Underground {
  readonly group = new THREE.Group();
  readonly lantern = new THREE.PointLight(0xffc27a, 2.6, 7.5, 1.6);
  private readonly earth: THREE.InstancedMesh;
  private readonly floor: THREE.InstancedMesh;
  private readonly extras = new THREE.Group();
  private readonly hide = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly m = new THREE.Matrix4();
  private readonly beam: THREE.MeshBasicMaterial;

  constructor(private readonly world: World) {
    const top = seeThrough(new THREE.MeshStandardMaterial({ map: TEX.earth(), roughness: 1 }));
    const side = seeThrough(new THREE.MeshStandardMaterial({ map: TEX.earth(), roughness: 1, color: 0x8a7a6a }));
    this.earth = new THREE.InstancedMesh(new THREE.BoxGeometry(1, EARTH_H, 1), [side, side, top, top, side, side], MAP_W * MAP_H);
    this.floor = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: TEX.tunnel(), roughness: 1 }), MAP_W * MAP_H);
    const c = new THREE.Color();
    const g = world.ground.base;
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      // The map above, faintly: buildings' footprints and walls, fences, roads, grass.
      const k = g[i];
      const tint =
        k === TILE.BRICK || k === TILE.REINFORCED
          ? 0x6f6258
          : k === TILE.FENCE || k === TILE.ELECTRIC
            ? 0xa0684a
            : k === TILE.ROAD
              ? 0x8c8a86
              : k === TILE.GRASS || k === TILE.DIRT
                ? 0xb4a888
                : TILE_INFO[k].outdoor
                  ? 0xa89c88
                  : 0xc8b8a0;
      this.earth.setColorAt(i, c.set(tint));
    }
    this.earth.receiveShadow = true;
    this.floor.receiveShadow = true;
    this.beam = new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    this.group.add(this.earth, this.floor, this.extras, this.lantern);
    this.group.visible = false;
    this.refresh();
  }

  /** Rebuilds the trenches, braces and light shafts from the tunnel layer (call when it changes). */
  refresh() {
    const under = this.world.layers[LAYER.UNDER].kind;
    let n = 0;
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      const x = i % MAP_W;
      const z = Math.floor(i / MAP_W);
      if (isTunnel(under[i])) {
        this.earth.setMatrixAt(i, this.hide);
        this.floor.setMatrixAt(n++, this.m.makeTranslation(x + 0.5, 0, z + 0.5));
      } else this.earth.setMatrixAt(i, this.m.makeTranslation(x + 0.5, EARTH_H / 2, z + 0.5));
    }
    this.floor.count = n;
    this.earth.instanceMatrix.needsUpdate = true;
    this.floor.instanceMatrix.needsUpdate = true;
    for (const c of [...this.extras.children]) {
      this.extras.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    const parts: Part[] = [];
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      const x = i % MAP_W;
      const z = Math.floor(i / MAP_W);
      if (under[i] === TILE.BRACED) {
        // A timber frame: two posts and a cap beam across the tunnel.
        const ns = isTunnel(under[i - MAP_W] ?? 0) || isTunnel(under[i + MAP_W] ?? 0);
        const [ox, oz] = ns ? [0.4, 0] : [0, 0.4];
        parts.push(box(0.12, EARTH_H, 0.12, 0xb07a45, x + 0.5 - ox, 0, z + 0.5 - oz), box(0.12, EARTH_H, 0.12, 0xb07a45, x + 0.5 + ox, 0, z + 0.5 + oz));
        parts.push(box(ns ? 0.98 : 0.14, 0.12, ns ? 0.14 : 0.98, 0x8a5a2e, x + 0.5, EARTH_H - 0.06, z + 0.5));
      }
      if (this.world.ground.kind[i] === TILE.SHAFT && isTunnel(under[i])) {
        // Daylight (or lamplight) falling down the entrance, and a rope ladder up it.
        const light = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 3, 10, 1, true), this.beam);
        light.position.set(x + 0.5, 1.5, z + 0.5);
        this.extras.add(light);
        parts.push(box(0.04, 1.6, 0.04, 0xc8a86a, x + 0.36, 0, z + 0.3), box(0.04, 1.6, 0.04, 0xc8a86a, x + 0.64, 0, z + 0.3));
        for (let r = 0; r < 5; r++) parts.push(box(0.3, 0.03, 0.05, 0xa06a3a, x + 0.5, 0.2 + r * 0.3, z + 0.3));
      }
    }
    if (parts.length) {
      const mesh = new THREE.Mesh(merge(parts), kitMaterial);
      mesh.castShadow = true;
      this.extras.add(mesh);
    }
    this.floor.computeBoundingSphere();
    this.earth.computeBoundingSphere();
  }

  /** The lantern follows the player. */
  follow(x: number, z: number) {
    this.lantern.position.set(x, 1.4, z);
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) if (mat !== kitMaterial) mat.dispose();
    });
  }
}
