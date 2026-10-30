import type { GuardDef, PrisonDef } from '../../content/prisons/types';
import { OUTSIDE_LEGEND, type Area, type OutsideDef, type Spot } from '../../content/outside/types';
import { TILE } from '../world/tiles';
import { MAP_H, MAP_W, World } from '../world/World';
import { chebTiles, neighbours4 } from '../world/grid';

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

/** Where the picture (its rows) sits in the world. */
function offsetOf(rows: readonly string[]): { w: number; h: number; ox: number; oz: number } {
  const w = rows[0].length;
  const h = rows.length;
  return { w, h, ox: Math.floor((MAP_W - w) / 2), oz: Math.floor((MAP_H - h) / 2) };
}

export function outsideWorld(def: OutsideDef, prison: PrisonDef): OutsideWorld {
  const rows = pictureRows(def);
  const { w, h, ox, oz } = offsetOf(rows);
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
  // (Only open ground is safe ground: a border strip's trees are no place to stand.)
  for (let i = 0; i < n; i++) if (base[i]) safe[i] = 0;
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

const N = MAP_W * MAP_H;

/** Walking tiles outward from the tiles already queued (their distances set), over open ground. */
function flood(d: Int32Array, queue: number[], open: (i: number) => boolean) {
  for (let q = 0; q < queue.length; q++) {
    const t = queue[q];
    for (const [j, ok] of neighbours4(t))
      if (ok && d[j] < 0 && open(j)) (d[j] = d[t] + 1), queue.push(j);
  }
}

/** Walking tiles to the nearest way to safety from every tile (`lou`: Lou's car's tile, -1 none; `wire`: through the wire too). */
export function goalDistances(o: OutsideWorld, grid: Uint8Array, lou: number, wire: boolean): Int32Array {
  const d = new Int32Array(N).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < N; i++) if (o.safe[i]) (d[i] = 0), queue.push(i);
  if (lou >= 0 && d[lou] !== 0) (d[lou] = 0), queue.push(lou);
  // (The search reckons wire passable: cutters make it so; a way round it is shorter anyway where there is one.)
  const open = (i: number) => !grid[i] || (wire && o.wire[i] === 1);
  flood(d, queue, open);
  return d;
}

/** Open ground beside cover a searcher can walk to, so that every cover tile is within a tile or two of one, and a place every few tiles across the open (in the map's order: the same every run). */
export function sweepPoints(o: OutsideWorld, npcGrid: Uint8Array, start: number): number[] {
  const reach = new Int32Array(N).fill(-1);
  reach[start] = 0;
  flood(reach, [start], (i) => !npcGrid[i]);
  const stand = (i: number) => reach[i] >= 0 && !npcGrid[i];
  const done = new Uint8Array(N);
  const pts: number[] = [];
  for (let c = 0; c < N; c++) {
    if (!o.cover[c] || done[c]) continue;
    const cx = c % MAP_W;
    const cz = Math.floor(c / MAP_W);
    // The open tile beside it that reaches the most cover not yet covered (nearest first).
    let best = -1;
    let bestN = 0;
    // (Out to 4 tiles where nothing stands closer: a strip of cover against the map's edge, a thicket in the woods; the dog team casts about from there.)
    for (let r = 1; r <= 4 && best < 0; r++)
      for (let z = cz - r; z <= cz + r; z++)
        for (let x = cx - r; x <= cx + r; x++) {
          if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
          const i = z * MAP_W + x;
          if (!stand(i)) continue;
          let n = 0;
          for (let dz = -2; dz <= 2; dz++)
            for (let dx = -2; dx <= 2; dx++) {
              const j = i + dz * MAP_W + dx;
              if (dx * dx + dz * dz <= 5 && j >= 0 && j < N && o.cover[j] && !done[j]) n++;
            }
          if (n > bestN) (best = i), (bestN = n);
        }
    done[c] = 1;
    if (best < 0) continue;
    pts.push(best);
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const j = best + dz * MAP_W + dx;
        if (dx * dx + dz * dz <= 5 && j >= 0 && j < N && o.cover[j]) done[j] = 1;
      }
  }
  // And the open ground: a place every few tiles across the map (the nearest standing to each).
  const step = 8;
  for (let z = o.oz + step / 2; z < o.oz + o.h; z += step)
    for (let x = o.ox + step / 2; x < o.ox + o.w; x += step) {
      let best = -1;
      for (let r = 0; r <= 3 && best < 0; r++)
        for (let dz = -r; dz <= r && best < 0; dz++)
          for (let dx = -r; dx <= r && best < 0; dx++) {
            const i = (z + dz) * MAP_W + x + dx;
            if (stand(i)) best = i;
          }
      if (best >= 0 && !pts.some((t) => chebTiles(t, best) <= 3)) pts.push(best);
    }
  // And every pocket the grid missed (behind a building, along the picture's edge): any open ground still 5 tiles from every place.
  for (let i = 0; i < N; i++) if (stand(i) && o.inside[i] && !o.cover[i] && !pts.some((t) => chebTiles(t, i) <= 5)) pts.push(i);
  return pts;
}
