import * as THREE from 'three';
import { CELL_BLOCK, OPEN_AIR } from '../content/zones';
import { LAMP_LIT } from '../sim/tuning';
import { TILE_INFO } from '../sim/world/tiles';
import { MAP_H, MAP_W, type World } from '../sim/world/World';
import { lampHead, lampSees } from '../sim/ai/light';
import { LAMP_BULB_Y, lampHeads } from './props';

/** How far the cell block's lights go out at Lights Out (2.28): enough left to see by on a phone. */
const NIGHT_LIGHT = 0.8;
/** The rooms' lights in the snow, against the others' (session 14). */
const SNOW_ROOMS = 1.7;

/** A soft round glow, white in the middle and fading out: one for every prison (made once, never freed with a view). */
let glow: THREE.CanvasTexture | null = null;
export function glowTexture(): THREE.CanvasTexture {
  return (glow ??= drawGlow());
}

function drawGlow(): THREE.CanvasTexture {
  const n = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const c = canvas.getContext('2d')!;
  const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, n, n);
  return new THREE.CanvasTexture(canvas);
}

/**
 * A lamp's pool (session 14, the picture review): evenly lit to the dark rule's reach and gone soon after
 * (sim/ai/light.ts: a tile is lit within LAMP_LIT, 2.5 tiles, of the head), where the soft glow faded from
 * the middle and showed no edge where a guard's sight stops. Drawn POOL tiles across: full to 0.55 of the
 * radius, still most of it at 2.5 tiles (0.83), nothing at 3.
 */
const POOL = 6;
let pool: THREE.CanvasTexture | null = null;
function poolTexture(): THREE.CanvasTexture {
  if (pool) return pool;
  const n = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const c = canvas.getContext('2d')!;
  const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.86)');
  g.addColorStop(LAMP_LIT / 100 / (POOL / 2), 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, n, n);
  return (pool = new THREE.CanvasTexture(canvas));
}

/**
 * The tiles a lamp's pool is drawn on, with the head over each (tiles): those its circle reaches, none under
 * a wall (a door is drawn on: the rule lights it), and with `walled` (2.36) only those the head sees, as the
 * dark rule's own `lampSees` says. Pure: `stealthtest` checks the rule against it.
 */
export function poolTiles(world: World, walled: boolean): Array<{ x: number; z: number; cx: number; cz: number }> {
  const out = [];
  const r = POOL / 2;
  for (const p of world.props) {
    if (p.kind !== 'lamp') continue;
    const [hx, hz] = lampHead(p);
    const cx = hx / 100;
    const cz = hz / 100;
    for (let z = Math.floor(cz - r); z <= Math.floor(cz + r); z++)
      for (let x = Math.floor(cx - r); x <= Math.floor(cx + r); x++) {
        if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
        const nx = Math.max(x, Math.min(cx, x + 1)) - cx;
        const nz = Math.max(z, Math.min(cz, z + 1)) - cz;
        const info = TILE_INFO[world.ground.base[z * MAP_W + x]];
        if (nx * nx + nz * nz >= r * r || (info.solid && info.opaque)) continue;
        if (walled && !lampSees(world, hx, hz, x, z)) continue;
        out.push({ x, z, cx, cz });
      }
  }
  return out;
}

/**
 * Night lighting without dozens of real lights: lamp bulbs that glow, and light pools on the
 * ground (additive decals), warm sodium under the lamps, cool fluorescent in the rooms. Both
 * fade with `setNight` (0 day … 1 night).
 */
export class Lights {
  readonly group = new THREE.Group();
  private readonly bulbs: THREE.MeshBasicMaterial;
  private readonly warm: THREE.MeshBasicMaterial | null;
  private readonly cool: THREE.MeshBasicMaterial | null;
  /** The cells and the cell block's corridors (2.28): theirs go out at Lights Out, past the walk home. */
  private readonly block: THREE.MeshBasicMaterial | null;
  /** How bright the rooms' lights are drawn: more in the snow (session 14), where the moonlit ground outshone the lit rooms. */
  private readonly rooms: number;
  /** The lamps' pools stopping at walls (2.36), and lighting through them (older runs' replays; built when first wanted). */
  private walledPools: THREE.Mesh | null | undefined;
  private openPools: THREE.Mesh | null | undefined;

  constructor(private readonly world: World) {
    this.rooms = world.def.theme === 'alpine' ? SNOW_ROOMS : 1;
    const tex = glowTexture();
    const lamps = world.props.filter((p) => p.kind === 'lamp');
    // Bulbs.
    this.bulbs = new THREE.MeshBasicMaterial({ color: 0x555555 });
    // (One under each head, turned with its arm: 2.34.1.)
    const heads = lamps.flatMap((p) =>
      lampHeads(p.aim, p.heads).map((h) => ({ x: p.x + 0.5 + h.dx, z: p.z + 0.5 + h.dz, angle: h.angle })),
    );
    const bulbs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.05, 0.22), this.bulbs, Math.max(1, heads.length));
    const m = new THREE.Matrix4();
    heads.forEach((h, i) => bulbs.setMatrixAt(i, m.makeRotationY(h.angle).setPosition(h.x, LAMP_BULB_Y - 0.03, h.z)));
    bulbs.count = heads.length;
    this.group.add(bulbs);

    // Warm pools under the lamps: one under the head, or round the pole of a lamp with two.
    this.warm = lamps.length
      ? new THREE.MeshBasicMaterial({
          map: poolTexture(),
          color: 0xffb35c,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      : null;
    this.lampPools(true);

    // Cool pools in every room, about one per 5×5 tiles, only on walkable indoor floor.
    const spots: Array<[number, number, number]> = [];
    const block: Array<[number, number, number]> = [];
    for (const [id, x0, z0, x1, z1] of world.def.zones) {
      if (OPEN_AIR.has(id)) continue;
      const to = CELL_BLOCK.has(id) ? block : spots;
      const nx = Math.max(1, Math.round((x1 - x0 + 1) / 5));
      const nz = Math.max(1, Math.round((z1 - z0 + 1) / 5));
      for (let a = 0; a < nx; a++) {
        for (let b = 0; b < nz; b++) {
          const x = x0 + ((a + 0.5) * (x1 - x0 + 1)) / nx;
          const z = z0 + ((b + 0.5) * (z1 - z0 + 1)) / nz;
          // (2.35: nor out in the open, a walkway or a minefield: ceiling lights belong indoors, and the dark's rule says so.)
          const info = TILE_INFO[world.ground.kind[Math.floor(z) * MAP_W + Math.floor(x)]];
          if (info.solid || info.outdoor) continue;
          to.push([x, z, Math.min(6, Math.max(3.5, Math.min(x1 - x0 + 1, z1 - z0 + 1) * 1.1))]);
        }
      }
    }
    for (const [x0, z0, x1, z1] of world.def.cells) block.push([(x0 + x1 + 1) / 2, (z0 + z1 + 1) / 2, 3.6]);
    this.cool = this.addPools(spots, 0xcfe6ff, tex);
    this.block = this.addPools(block, 0xcfe6ff, tex);
  }

  /** The lamps' pools as drawn: through walls too in a replay of an older run (built the first time one asks). */
  private lampPools(walled: boolean): THREE.Mesh | null {
    const have = walled ? this.walledPools : this.openPools;
    if (have !== undefined || !this.warm) return have ?? null;
    const pos: number[] = [];
    const uv: number[] = [];
    for (const { x, z, cx, cz } of poolTiles(this.world, walled)) {
      for (const [dx, dz] of [
        [0, 0],
        [0, 1],
        [1, 1],
        [0, 0],
        [1, 1],
        [1, 0],
      ]) {
        pos.push(x + dx, 0.008, z + dz);
        uv.push((x + dx - cx) / POOL + 0.5, (z + dz - cz) / POOL + 0.5);
      }
    }
    let mesh: THREE.Mesh | null = null;
    if (pos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      mesh = new THREE.Mesh(geo, this.warm);
      mesh.renderOrder = 0.32;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    if (walled) this.walledPools = mesh;
    else this.openPools = mesh;
    return mesh;
  }

  private addPools(spots: Array<[number, number, number]>, color: number, map: THREE.Texture): THREE.MeshBasicMaterial | null {
    if (!spots.length) return null;
    const mat = new THREE.MeshBasicMaterial({
      map,
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, z, size], i) => mesh.setMatrixAt(i, m.makeScale(size, 1, size).setPosition(x, 0.008, z)));
    mesh.renderOrder = 0.32;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mat;
  }

  /** 0 in daylight, 1 at night; `power` 0–1 (the generator off: every lamp and room light goes dark, GDD §5.5); `dark` 0–1: the cell block's lights out, but for a night light. */
  setNight(night: number, power = 1, dark = 0, walled = true) {
    // (Session 14: an older run's replay lights through walls, as its rule does.)
    const pools = this.lampPools(walled);
    if (this.walledPools && this.walledPools !== pools) this.walledPools.visible = false;
    if (this.openPools && this.openPools !== pools) this.openPools.visible = false;
    if (pools) pools.visible = true;
    const lit = night * power;
    this.bulbs.color.setRGB(0.33 + lit * 0.67, 0.33 + lit * 0.55, 0.33 + lit * 0.2);
    night = lit;
    for (const [mat, peak] of [
      [this.warm, 0.42],
      [this.cool, 0.3 * this.rooms],
      [this.block, 0.3 * this.rooms * (1 - dark * NIGHT_LIGHT)],
    ] as const) {
      if (!mat) continue;
      mat.opacity = night * peak;
      mat.visible = night > 0.01;
    }
  }
}
