import type { PropPlacement } from '../../content/props';
import { MAP_H, MAP_W } from '../../sim/world/grid';
import { DECO, type District } from './district';
import { CITY_N, streamOf, type CityPlan } from './plan';

/**
 * The metro's tunnel (2.56): a tenth map under the city, walked on the metro's last night once the
 * gates are open. One long way from the foot of the station's stairs to the ladder beyond the wall:
 * runs of track three tiles wide, a turn now and then, a few maintenance rooms off it (a crate or a
 * bin in each), rubble and crates along its sides, never across it. No daylight, no street, no gate:
 * it is entered by the story and left only at its end. Pure: the same city has the same tunnel.
 */

/** The tunnel's number among the places a city has (the nine districts are 0 to 8). */
export const TUNNEL = CITY_N;
/** Every place a save may name: the districts and the tunnel. */
export const PLACES = CITY_N + 1;

export interface Tunnel {
  district: District;
  /** The tile at the foot of the stairs, the tile under the ladder, and the way between them along the track's middle. */
  start: number;
  end: number;
  way: number[];
}

const N = MAP_W * MAP_H;
/** How far in from the map's west and east sides the way begins and ends (tiles). */
const EDGE = 8;
const at = (x: number, z: number) => z * MAP_W + x;

export function generateTunnel(plan: CityPlan): Tunnel {
  const rnd = streamOf(plan.seed, 990);
  const int = (n: number) => Math.floor(rnd() * n);
  const g: string[] = new Array<string>(N).fill('#');
  const deco = new Uint8Array(N);
  const turn = new Uint8Array(N);
  const props: PropPlacement[] = [];
  const way: number[] = [];
  const open = (x: number, z: number) => {
    if (x > 0 && z > 0 && x < MAP_W - 1 && z < MAP_H - 1) g[at(x, z)] = '_';
  };
  /** The track's middle on a tile, the tile either side of it opened too (`along` 0: running east; 1: north or south). */
  const lay = (x: number, z: number, along: number) => {
    for (let k = -1; k <= 1; k++) open(along ? x + k : x, along ? z : z + k);
    if (way[way.length - 1] !== at(x, z)) way.push(at(x, z));
  };
  // (Both ends well inside the map: the lamp's light never falls off its edge.)
  let x = EDGE;
  let z = 8 + int(MAP_H - 16);
  lay(x, z, 0);
  while (x < MAP_W - 1 - EDGE) {
    // A run east, then a turn north or south (never off the map, never a turn in the last stretch).
    const run = Math.min(MAP_W - 1 - EDGE - x, 6 + int(7));
    for (let k = 0; k < run; k++) lay(++x, z, 0);
    if (x >= MAP_W - 4 - EDGE) continue;
    const room = int(2) ? Math.min(z - 5, 5 + int(8)) : -Math.min(MAP_H - 6 - z, 5 + int(8));
    if (Math.abs(room) < 4) continue;
    // (The corner: squared off, so the three tiles' width holds all the way round.)
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) open(x + dx, z + dz);
    const to = z - room;
    while (z !== to) lay(x, (z += Math.sign(to - z)), 1);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) open(x + dx, z + dz);
  }
  const start = way[0];
  const end = way[way.length - 1];
  const far = (i: number, j: number) =>
    Math.max(Math.abs((i % MAP_W) - (j % MAP_W)), Math.abs(Math.floor(i / MAP_W) - Math.floor(j / MAP_W)));
  // Maintenance rooms: three by three, off the side of a straight stretch, one tile's doorway; a crate or a bin at the back.
  for (let k = 8; k < way.length - 8; k += 9 + int(6)) {
    const i = way[k];
    const east = Math.abs(way[k + 1] - i) === 1 && Math.abs(way[k - 1] - i) === 1;
    const south = Math.abs(way[k + 1] - i) === MAP_W && Math.abs(way[k - 1] - i) === MAP_W;
    if (!east && !south) continue;
    const side = int(2) ? 1 : -1;
    const [sx, sz] = east ? [0, side] : [side, 0];
    const cx = (i % MAP_W) + sx * 4;
    const cz = Math.floor(i / MAP_W) + sz * 4;
    // (Solid rock all round where it would go, and a tile to spare.)
    let clear = cx > 2 && cz > 2 && cx < MAP_W - 3 && cz < MAP_H - 3;
    for (let dz = -2; dz <= 2 && clear; dz++)
      for (let dx = -2; dx <= 2 && clear; dx++) {
        // (The side towards the track is the track's own wall: its doorway's side.)
        if (dx * sx + dz * sz === -2) continue;
        if (g[at(cx + dx, cz + dz)] !== '#') clear = false;
      }
    if (!clear) continue;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) open(cx + dx, cz + dz);
    open((i % MAP_W) + sx * 2, Math.floor(i / MAP_W) + sz * 2);
    props.push({ kind: int(3) ? 'crate' : 'bin', x: cx + sx, z: cz + sz });
  }
  // What lies along the sides: never on the middle, never both sides of one tile, never near either end.
  const taken = new Set(props.map((p) => at(p.x, p.z)));
  let last = -9;
  for (let k = 4; k < way.length - 4; k++) {
    if (rnd() > 0.1) continue;
    // (Nor on the tile after one that has something: two abreast are always open, all the way.)
    if (k - last < 2) continue;
    const i = way[k];
    const east = Math.abs(way[k + 1] - i) === 1;
    const side = (int(2) ? 1 : -1) * (east ? MAP_W : 1);
    const j = i + side;
    if (g[j] !== '_' || taken.has(j) || far(j, start) < 4 || far(j, end) < 4) continue;
    // (Not where a room opens: its doorway is the next tile out.)
    if (g[j + side] === '_') continue;
    deco[j] = [DECO.RUBBLE, DECO.RUBBLE, DECO.CRATES, DECO.BARREL, DECO.TYRES][int(5)];
    taken.add(j);
    last = k;
  }
  const rows = Array.from({ length: MAP_H }, (_, r) => g.slice(r * MAP_W, (r + 1) * MAP_W).join(''));
  const district: District = {
    index: TUNNEL,
    kind: 'metro',
    rows,
    props,
    deco,
    turn,
    // (One place, all of it the metro's: indoors everywhere, and no street door for daylight to come in at.)
    lots: [{ use: 'metro', x0: 0, z0: 0, x1: MAP_W - 1, z1: MAP_H - 1, doors: [] }],
    lotAt: new Uint8Array(N).fill(1),
    gates: [],
    spawn: { x: start % MAP_W, z: Math.floor(start / MAP_W) },
  };
  return { district, start, end, way };
}
