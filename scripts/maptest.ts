/**
 * Every prison map parses, is laid out sensibly and holds the player in: the routine zones
 * can be walked to from the cell with no keys or tools, and the outside can't.
 * Prints per-prison tile and zone counts and a checksum of the picture.
 */
import { PRISONS } from '../src/content/prisons';
import { PROPS } from '../src/content/props';
import { ZONES } from '../src/content/zones';
import { fnv1a } from '../src/sim/rng';
import { reachableFrom } from '../src/sim/world/reach';
import { TILE, TILE_INFO } from '../src/sim/world/tiles';
import { MAP_H, MAP_W, World } from '../src/sim/world/World';
import { check } from './assert';

const ids = new Set<string>();
for (const def of PRISONS) {
  const w = new World(def);
  const g = w.ground;
  check(!ids.has(def.id), `prison id ${def.id} is unique`);
  ids.add(def.id);
  console.log(`== ${def.id} · picture ${fnv1a(def.ground.trim())}`);

  // Tile and zone counts (a map edit shows up here).
  const kinds = new Map<string, number>();
  const zones = new Map<string, number>();
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    const k = TILE_INFO[g.kind[i]].name;
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
    const z = ZONES[g.zone[i]];
    zones.set(z, (zones.get(z) ?? 0) + 1);
  }
  console.log('tiles:', [...kinds].sort().map(([k, n]) => `${k} ${n}`).join(', '));
  console.log('zones:', [...zones].sort().map(([k, n]) => `${k} ${n}`).join(', '));

  // The edge of the map is road: escapes end there.
  for (let i = 0; i < MAP_W; i++) {
    for (const [x, z] of [[i, 0], [i, MAP_H - 1], [0, i], [MAP_W - 1, i]]) check(g.kind[z * MAP_W + x] === TILE.ROAD, `${def.id}: edge tile ${x},${z} is road`);
  }

  // Props stand on walkable floor, inside the map, never on a door.
  for (const p of w.props) {
    for (let z = p.z; z < p.z + p.d; z++) {
      for (let x = p.x; x < p.x + p.w; x++) {
        const k = w.inside(x, z) ? g.kind[z * MAP_W + x] : TILE.EMPTY;
        check(!TILE_INFO[k].solid && k !== TILE.DOOR && k !== TILE.DETECTOR, `${def.id}: ${p.kind} at ${x},${z} stands on ${TILE_INFO[k].name}`);
      }
    }
  }
  check(Object.keys(PROPS).length > 0, 'prop kinds exist');

  // Doors and detectors sit in a wall line, with floor on both sides free of solid props.
  for (let z = 1; z < MAP_H - 1; z++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      const k = g.kind[z * MAP_W + x];
      if (k !== TILE.DOOR && k !== TILE.DETECTOR) continue;
      const free = (dx: number, dz: number) => !TILE_INFO[g.kind[(z + dz) * MAP_W + x + dx]].solid && !w.propSolid[(z + dz) * MAP_W + x + dx];
      check((free(1, 0) && free(-1, 0)) || (free(0, 1) && free(0, -1)), `${def.id}: door at ${x},${z} opens onto floor on two opposite sides`);
    }
  }

  // Every walkable indoor floor tile (doors aside) belongs to a zone.
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    const k = g.kind[i];
    if (TILE_INFO[k].solid || k === TILE.DOOR || k === TILE.DETECTOR) continue;
    check(ZONES[g.zone[i]] !== 'none', `${def.id}: floor at ${i % MAP_W},${Math.floor(i / MAP_W)} has a zone`);
  }

  // Cells: 8, the player's first, each with a bed, a desk and a toilet.
  check(def.cells.length === 8, `${def.id}: 8 cells`);
  def.cells.forEach(([x0, z0, x1, z1], k) => {
    for (const kind of ['bed', 'desk', 'toilet'] as const) {
      check(w.props.some((p) => p.kind === kind && p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1), `${def.id}: cell ${k + 1} has a ${kind}`);
    }
  });

  // Roll call: a free spot in the yard for every inmate.
  check(def.rollCall.length >= def.cells.length, `${def.id}: a roll call spot per cell`);
  for (const r of def.rollCall) check(w.zoneAt(r.x, r.z) === 'rollCall' && !w.blocked(r.x, r.z), `${def.id}: roll call spot ${r.x},${r.z} is free yard`);

  // Reachability from the spawn, as the rules are at the start of day 1.
  const { x: sx, z: sz } = def.spawn;
  check(w.zoneAt(sx, sz) === 'playerCell', `${def.id}: the player starts in their cell`);
  check(!w.blocked(sx, sz), `${def.id}: the spawn tile is free`);
  const reach = reachableFrom(w, sx, sz);
  for (const r of def.rollCall) check(reach[r.z * MAP_W + r.x] === 1, `${def.id}: roll call spot ${r.x},${r.z} can be walked to`);
  const reached = new Set<string>();
  for (let i = 0; i < MAP_W * MAP_H; i++) if (reach[i]) reached.add(ZONES[g.zone[i]]);
  for (const z of def.reachable) check(reached.has(z), `${def.id}: ${z} can be walked to from the cell`);
  for (const z of ['outside', 'perimeter'] as const) check(!reached.has(z), `${def.id}: ${z} can't be reached without keys or tools`);
  console.log('walkable from the cell:', [...reached].sort().join(', '));
}
