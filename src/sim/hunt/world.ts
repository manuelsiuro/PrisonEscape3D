import type { GuardDef, PrisonDef } from '../../content/prisons/types';
import { OUTSIDE_LEGEND, type Area, type OutsideDef, type Spot } from '../../content/outside/types';
import { TILE } from '../world/tiles';
import { MAP_H, MAP_W, World } from '../world/World';

/**
 * The outside (P41) as the hunt and the view see it: the picture placed in the middle of a
 * 64 × 64 world (World: floors, walls, fences and water drawn as any prison's; sight and paths
 * as inside), plus what the hunt makes of each tile. Past the picture: woods (solid), or the
 * sea where the picture's edge is water. Built afresh for each hunt (a fence cut is the hunt's).
 */

/** What stands on a tile (drawn by the view; solid ones and cover are the hunt's rules). Never renumber. */
export const DECO = { NONE: 0, TREE: 1, CACTUS: 2, ROCK: 3, CRATES: 4, HEDGE: 5, CULVERT: 6, RAIL: 7, GRAVEL: 8, FORD: 9, WOODS: 10 } as const;

export interface OutsideWorld {
  def: OutsideDef;
  /** The prison it lies outside (its theme). */
  prison: PrisonDef;
  world: World;
  /** The picture's size, and where its top-left tile sits in the world. */
  w: number;
  h: number;
  ox: number;
  oz: number;
  /** Per world tile (z * MAP_W + x): a hiding place, loud underfoot, a ford, a wire fence cutters cut, inside the picture. */
  cover: Uint8Array;
  noisy: Uint8Array;
  ford: Uint8Array;
  wire: Uint8Array;
  inside: Uint8Array;
  /** What stands on each tile (DECO), for the view. */
  deco: Uint8Array;
  /** 1 where nobody walks (before any roadblock goes up or fence is cut). */
  base: Uint8Array;
  /** The safe point's tiles. */
  safe: Uint8Array;
}

/** What each picture character becomes: the prison legend's floor or wall, and the hunt's own. */
const KIND: Record<string, { ground: string; solid?: true; opaque?: true; deco?: number; cover?: true; noisy?: true; ford?: true; wire?: true }> = {
  '.': { ground: '.' },
  ',': { ground: ',' },
  a: { ground: 'a' },
  d: { ground: 'd' },
  g: { ground: 'd', noisy: true, deco: DECO.GRAVEL },
  r: { ground: 'd', noisy: true, deco: DECO.RAIL },
  T: { ground: '.', solid: true, opaque: true, deco: DECO.TREE },
  k: { ground: '.', solid: true, opaque: true, deco: DECO.CACTUS },
  o: { ground: '.', solid: true, opaque: true, deco: DECO.ROCK },
  c: { ground: 'a', solid: true, opaque: true, deco: DECO.CRATES },
  h: { ground: '.', cover: true, deco: DECO.HEDGE },
  u: { ground: ',', cover: true, deco: DECO.CULVERT },
  '~': { ground: '~' },
  f: { ground: '~', ford: true, deco: DECO.FORD },
  P: { ground: 'P' },
  '#': { ground: '#' },
  '@': { ground: '@' },
  F: { ground: '=', wire: true },
};

/** The picture's rows (trimmed of blank first and last lines), checked: every row as wide, every character known, at most 64 × 64. */
export function pictureRows(def: OutsideDef): string[] {
  const rows = def.map.replace(/^\n+|\n+$/g, '').split('\n');
  const w = rows[0]?.length ?? 0;
  if (!w || rows.length > MAP_H || w > MAP_W) throw new Error(`${def.prison} outside: ${w}×${rows.length}, at most ${MAP_W}×${MAP_H}`);
  rows.forEach((r, z) => {
    if (r.length !== w) throw new Error(`${def.prison} outside: row ${z} is ${r.length} wide, expected ${w}`);
    for (let x = 0; x < w; x++) if (!OUTSIDE_LEGEND.includes(r[x])) throw new Error(`${def.prison} outside: unknown character '${r[x]}' at ${x},${z}`);
  });
  return rows;
}

/** Where the picture sits in the world. */
export function offsetOf(def: OutsideDef): { w: number; h: number; ox: number; oz: number } {
  const rows = pictureRows(def);
  const w = rows[0].length;
  const h = rows.length;
  return { w, h, ox: Math.floor((MAP_W - w) / 2), oz: Math.floor((MAP_H - h) / 2) };
}

export function outsideWorld(def: OutsideDef, prison: PrisonDef): OutsideWorld {
  const rows = pictureRows(def);
  const { w, h, ox, oz } = offsetOf(def);
  const n = MAP_W * MAP_H;
  const cover = new Uint8Array(n);
  const noisy = new Uint8Array(n);
  const ford = new Uint8Array(n);
  const wire = new Uint8Array(n);
  const inside = new Uint8Array(n);
  const deco = new Uint8Array(n);
  const solid = new Uint8Array(n);
  const veil = new Uint8Array(n);
  const ground: string[] = [];
  for (let z = 0; z < MAP_H; z++) {
    let row = '';
    for (let x = 0; x < MAP_W; x++) {
      const i = z * MAP_W + x;
      const px = x - ox;
      const pz = z - oz;
      if (px >= 0 && pz >= 0 && px < w && pz < h) {
        const k = KIND[rows[pz][px]];
        inside[i] = 1;
        row += k.ground;
        if (k.solid) solid[i] = 1;
        if (k.opaque || k.cover) veil[i] = 1;
        if (k.cover) cover[i] = 1;
        if (k.noisy) noisy[i] = 1;
        if (k.ford) ford[i] = 1;
        if (k.wire) wire[i] = 1;
        deco[i] = k.deco ?? DECO.NONE;
        continue;
      }
      // Past the picture: an island town's is the sea all round (as the Island view draws it); elsewhere the edge's water carries on out, its roads a little way into the woods, the rest woods.
      const ex = Math.min(w - 1, Math.max(0, px));
      const ez = Math.min(h - 1, Math.max(0, pz));
      const edge = rows[ez][ex];
      const far = Math.max(ex - px, px - ex, ez - pz, pz - ez);
      if (edge === '~' || edge === 'f' || prison.theme === 'island') row += '~';
      else if ((edge === ',' || edge === 'a') && far <= 3) {
        row += ',';
        solid[i] = 1;
      } else {
        row += '.';
        solid[i] = 1;
        veil[i] = 1;
        deco[i] = DECO.WOODS;
      }
    }
    ground.push(row);
  }
  const start = def.starts.wall ?? Object.values(def.starts)[0]!;
  const synthetic: PrisonDef = {
    id: `outside-${def.prison}`,
    difficulty: 0,
    theme: prison.theme,
    ground: ground.join('\n'),
    zones: [],
    cells: [],
    props: [],
    rollCall: [],
    spawn: { x: start.x + ox, z: start.z + oz },
    reachable: [],
    // The searchers as the view casts guards (their dogs at the heel), kennels far off the map.
    guards: searcherDefs(def, ox, oz),
    names: [],
    merchants: [],
    crew: [],
    jobs: [],
    escapes: [],
  };
  const world = new World(synthetic);
  // Trees, cacti, rocks and crates stand in the way (as the delivery's vehicle would) and stop sight; so does cover (the veil: sight only).
  world.parked.set(solid);
  world.veil.set(veil);
  world.refreshBlock();
  const base = new Uint8Array(n);
  for (let i = 0; i < n; i++) base[i] = world.block[i] && !ford[i] ? 1 : 0;
  const safe = new Uint8Array(n);
  fillArea(safe, def.safe, ox, oz);
  return { def, prison, world, w, h, ox, oz, cover, noisy, ford, wire, inside, deco, base, safe };
}

/** A picture rectangle marked on a world array. */
export function fillArea(a: Uint8Array, [x0, z0, x1, z1]: Area, ox: number, oz: number, v = 1) {
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) a[(z + oz) * MAP_W + x + ox] = v;
}

/** A picture spot's world tile. */
export const spotTile = (s: Spot, ox: number, oz: number) => (s.z + oz) * MAP_W + s.x + ox;

/** The searchers (and the roadblocks' officers after them) as guard definitions: the view casts them as guards, with their dogs. */
function searcherDefs(def: OutsideDef, ox: number, oz: number): GuardDef[] {
  const out: GuardDef[] = [];
  for (const s of def.searchers)
    out.push({
      name: s.name,
      beat: s.beat.map((b) => ({ x: b.x + ox, z: b.z + oz, face: b.face })),
      key: 'yellow',
      ...(s.dog ? { dog: { name: s.dog.name, kennel: { x: -40, z: -40, face: 5 }, coat: s.dog.coat } } : {}),
    });
  def.roadblocks.forEach((r, k) => out.push({ name: `post${k}`, beat: [{ x: r.post.x + ox, z: r.post.z + oz, face: r.post.face }], key: 'yellow' }));
  return out;
}

/** The world's floor kind at a tile (for the view's footsteps). */
export const floorAt = (o: OutsideWorld, i: number) => (o.ford[i] ? TILE.WATER : o.world.ground.kind[i]);
