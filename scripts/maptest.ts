/**
 * Every prison map parses, is laid out sensibly and holds the player in: the routine zones
 * can be walked to from the cell with no keys or tools, and the outside can't.
 * Prints per-prison tile and zone counts and a checksum of the picture.
 */
import { PRISONS } from '../src/content/prisons';
import { TRAINING } from '../src/content/prisons/training';
import { PROPS } from '../src/content/props';
import { DECOR } from '../src/content/decor';

/** A wall a decor piece can hang on (brick or concrete; holes and covers count, they look like wall). */
const isWallTile = (k: number) => k === TILE.BRICK || k === TILE.REINFORCED;
import { ZONES } from '../src/content/zones';
import { findPath } from '../src/sim/ai/path';
import { isFloor, placesOf } from '../src/sim/ai/places';
import { fnv1a } from '../src/sim/rng';
import { reachableFrom } from '../src/sim/world/reach';
import { TILE, TILE_INFO } from '../src/sim/world/tiles';
import { LAYER, MAP_H, MAP_W, World } from '../src/sim/world/World';
import { ladderFootOf } from '../src/sim/systems/structure';
import { check } from './assert';

const ids = new Set<string>();
// Zones and cells are stored per tile in bytes (the job-room and cell masks are bigints, any size).
check(ZONES.length <= 256, `zones fit in a byte (${ZONES.length})`);
// Every campaign prison, and the tutorial's Training Block.
for (const def of [...PRISONS, TRAINING]) {
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

  // The edge of the map is road (escapes end there), or the sea round an island (Irongate's ways out cross it).
  for (let i = 0; i < MAP_W; i++) {
    for (const [x, z] of [[i, 0], [i, MAP_H - 1], [0, i], [MAP_W - 1, i]]) {
      const k = g.kind[z * MAP_W + x];
      check(k === TILE.ROAD || (def.theme === 'island' && k === TILE.WATER), `${def.id}: edge tile ${x},${z} is road${def.theme === 'island' ? ' or sea' : ''}`);
    }
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

  // Decor (render only): floor pieces on free floor (on furniture when lifted), wall pieces on
  // floor in front of a wall along their whole width, nothing on a door or a detector.
  let decorCount = 0;
  for (const p of def.decor ?? []) {
    decorCount++;
    const w0 = p.w ?? 1;
    const d0 = p.d ?? 1;
    for (let z = p.z; z < p.z + d0; z++) {
      for (let x = p.x; x < p.x + w0; x++) {
        const i = z * MAP_W + x;
        const k = w.inside(x, z) ? g.kind[i] : TILE.EMPTY;
        const where = `${def.id}: decor ${p.kind} at ${x},${z}`;
        check(!TILE_INFO[k].solid && k !== TILE.DOOR && k !== TILE.DETECTOR, `${where} stands on ${TILE_INFO[k].name}`);
        if (p.y) check(w.propSolid[i] === 1, `${where} is lifted onto furniture that isn't there`);
        else if (!DECOR[p.kind].wall) check(!w.propSolid[i], `${where} stands inside furniture`);
        if (DECOR[p.kind].wall) {
          const r = p.rot ?? 0;
          const [bx, bz] = r === 0 ? [x, p.z - 1] : r === 1 ? [p.x - 1, z] : r === 2 ? [x, p.z + d0] : [p.x + w0, z];
          check(isWallTile(g.kind[bz * MAP_W + bx]), `${where} hangs on ${TILE_INFO[g.kind[bz * MAP_W + bx]].name}, not a wall`);
        }
      }
    }
  }

  console.log(`decor: ${decorCount} pieces`);

  // Doors and detectors sit in a wall line, with floor on both sides free of solid props (a drawbridge counts: it comes down onto it).
  for (let z = 1; z < MAP_H - 1; z++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      const k = g.kind[z * MAP_W + x];
      if (k !== TILE.DOOR && k !== TILE.DETECTOR) continue;
      const free = (dx: number, dz: number) => {
        const j = (z + dz) * MAP_W + x + dx;
        return (!TILE_INFO[g.kind[j]].solid || w.bridge[j] === 1) && !w.propSolid[j];
      };
      check((free(1, 0) && free(-1, 0)) || (free(0, 1) && free(0, -1)), `${def.id}: door at ${x},${z} opens onto floor on two opposite sides`);
    }
  }

  // Every walkable indoor floor tile (doors aside) belongs to a zone.
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    const k = g.kind[i];
    if (TILE_INFO[k].solid || k === TILE.DOOR || k === TILE.DETECTOR) continue;
    check(ZONES[g.zone[i]] !== 'none', `${def.id}: floor at ${i % MAP_W},${Math.floor(i / MAP_W)} has a zone`);
  }

  // Cells: the player's first, then one per named inmate, each with a bed, a desk and a toilet.
  check(def.cells.length < 256, `${def.id}: cells fit in a byte (${def.cells.length})`);
  check(def.cells.length >= 1 && def.names.length === def.cells.length - 1, `${def.id}: a cell for the player and one per inmate (${def.cells.length})`);
  def.cells.forEach(([x0, z0, x1, z1], k) => {
    for (const kind of ['bed', 'desk', 'toilet'] as const) {
      check(w.props.some((p) => p.kind === kind && p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1), `${def.id}: cell ${k + 1} has a ${kind}`);
    }
  });

  // Each cell has exactly one door (the one that locks at Lights Out), shared with no other cell.
  def.cells.forEach((_, k) => {
    let doors = 0;
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      if (g.kind[i] !== TILE.DOOR) continue;
      const near = [i - 1, i + 1, i - MAP_W, i + MAP_W].map((j) => w.cellOf[j]).filter((c) => c);
      if (near.includes(k + 1)) {
        doors++;
        check(near.every((c) => c === k + 1), `${def.id}: the door of cell ${k + 1} leads into no other cell`);
      }
    }
    check(doors === 1, `${def.id}: cell ${k + 1} has one door (${doors})`);
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

  // Guards: every stop and post is free floor, all of them reachable from each other with a
  // guard's keys; beds for the night shift's sleepers; somewhere for solitary and the infirmary.
  const places = placesOf(w);
  const stops = def.guards.flatMap((d) => [...d.beat, ...(d.night ?? []), ...Object.values(d.posts ?? {})]);
  const first = stops[0];
  for (const p of stops) {
    check(isFloor(w, p.x, p.z), `${def.id}: guard stop ${p.x},${p.z} is free floor`);
    check(findPath(w, first.z * MAP_W + first.x, (i) => i === p.z * MAP_W + p.x, p.z * MAP_W + p.x, MAP_W * MAP_H, undefined, w.guardBlock) !== null, `${def.id}: guard stop ${p.x},${p.z} can be reached`);
  }
  // A post stands where it watches (a shower watch in the showers, a meal watch in the canteen).
  const WATCHES: Record<string, readonly string[]> = { showers: ['showers'], breakfast: ['canteen'], lunch: ['canteen'], dinner: ['canteen'], exercise: ['yard', 'gym'], rollCall: ['rollCall', 'yard'], eveningRollCall: ['rollCall', 'yard'] };
  for (const d of def.guards) {
    for (const [block, p] of Object.entries(d.posts ?? {})) {
      const want = WATCHES[block];
      if (want) check(want.includes(w.zoneAt(p.x, p.z)), `${def.id}: the ${block} post ${p.x},${p.z} stands in the ${want.join(' or ')} (${w.zoneAt(p.x, p.z)})`);
    }
  }
  const sleepers = def.guards.filter((d) => !d.night).length;
  check(places.guardBeds.filter((b) => b.tile >= 0).length >= sleepers, `${def.id}: a guard-quarters bed for each guard off at night`);
  // A prison proper has its bed checks, its shakedown, solitary and an infirmary; the
  // tutorial's relaxed rules have none of them.
  if (!def.rules?.relaxed) {
    check(def.guards.filter((d) => d.duties?.includes('bedCheck') && d.night).length === 1, `${def.id}: one night guard does the bed checks`);
    check(def.guards.filter((d) => d.duties?.includes('shakedown')).length === 1, `${def.id}: one guard does the shakedown`);
    check(places.solitary >= 0 && places.infirmary >= 0, `${def.id}: a solitary cell and an infirmary bed`);
  }
  check(places.doorstep.slice(1).every((t) => t >= 0) && places.deskside.slice(1).every((t) => t >= 0), `${def.id}: every cell can be looked into and its desk searched`);
  // Names (P13: the speech bubbles call people by them): every guard has one, nobody shares one.
  check(def.guards.every((d) => !!d.name), `${def.id}: every guard has a name`);
  const people = [...def.names, ...def.guards.map((d) => d.name ?? '')];
  check(new Set(people).size === people.length, `${def.id}: names are unique (${people.join(', ')})`);
  console.log(`guards: ${def.guards.length}, ${stops.length} stops, ${sleepers} asleep at night`);

  // A roof over the perimeter is a grapnel's landing (structure.ts): only a gatehouse
  // standing on the fence line may have one.
  {
    const roofKind = w.layers[LAYER.ROOF].kind;
    const onWire = new Uint8Array(MAP_W * MAP_H);
    let perimeterRoofs = 0;
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      if (roofKind[i] === TILE.EMPTY || ZONES[g.zone[i]] !== 'perimeter') continue;
      perimeterRoofs++;
      onWire[i] = 1;
    }
    // Each building of such roofs touches a fence.
    const seen = new Uint8Array(MAP_W * MAP_H);
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      if (!onWire[i] || seen[i]) continue;
      let fence = false;
      const queue = [i];
      seen[i] = 1;
      while (queue.length) {
        const j = queue.pop()!;
        for (const n of [j - 1, j + 1, j - MAP_W, j + MAP_W]) {
          if (n < 0 || n >= MAP_W * MAP_H) continue;
          const k = g.kind[n];
          if (k === TILE.FENCE || k === TILE.ELECTRIC) fence = true;
          if (onWire[n] && !seen[n]) {
            seen[n] = 1;
            queue.push(n);
          }
        }
      }
      check(fence, `${def.id}: the roof over the perimeter at ${i % MAP_W},${Math.floor(i / MAP_W)} stands on the fence line (a grapnel lands there)`);
    }
    if (perimeterRoofs) console.log(`perimeter roofs (grapnel landings): ${perimeterRoofs} tiles`);
  }

  // Vents (layer +1): grates over free floor, one duct network, the ladder against a wall with
  // a free foot and a roof hatch above it; the player's cell has a way up.
  const vents = w.layers[LAYER.VENTS];
  const ducts: number[] = [];
  let ladders = 0;
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    const k = vents.kind[i];
    if (k === TILE.EMPTY) continue;
    ducts.push(i);
    const x = i % MAP_W;
    const z = Math.floor(i / MAP_W);
    if (k === TILE.GRATE) check(isFloor(w, x, z), `${def.id}: grate ${x},${z} is over free floor`);
    if (k === TILE.LADDER) {
      ladders++;
      check(w.props.some((p) => p.kind === 'ladder' && p.x === x && p.z === z), `${def.id}: the ladder at ${x},${z} stands on the ground floor`);
      check(w.layers[LAYER.ROOF].kind[i] === TILE.LADDER, `${def.id}: the ladder at ${x},${z} reaches a roof hatch`);
    }
  }
  if (ducts.length) {
    const seen = new Set([ducts[0]]);
    const queue = [ducts[0]];
    while (queue.length) {
      const i = queue.pop()!;
      for (const j of [i - 1, i + 1, i - MAP_W, i + MAP_W]) if (j >= 0 && j < MAP_W * MAP_H && !vents.block[j] && !seen.has(j)) (seen.add(j), queue.push(j));
    }
    check(seen.size === ducts.length, `${def.id}: the ducts are one network`);
    check(ladders >= 1 && ladderFootOf(w) >= 0, `${def.id}: a ladder, with a free foot`);
    // Vents with grates are a way out of the cell (Stalag Flucht's log cabins have none: its ladder stands in the generator hut).
    if (ducts.some((i) => vents.kind[i] === TILE.GRATE)) check(ducts.some((i) => vents.kind[i] === TILE.GRATE && w.cellOf[i] === 1), `${def.id}: a grate in the player's cell`);
  }
  console.log(`vents: ${ducts.length} duct tiles, ${ducts.filter((i) => vents.kind[i] === TILE.GRATE).length} grates, ${ladders} ladder; roof tiles ${Array.from(w.layers[LAYER.ROOF].kind).filter((k) => k !== TILE.EMPTY).length}`);
}
