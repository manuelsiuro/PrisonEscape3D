import { MAP_H, MAP_W } from '../../sim/world/grid';
import { DISTRICTS, type LotUse } from '../content/districts';
import type { District, Lot } from '../gen/district';
import { tilesOf } from '../sim/story';

/**
 * Where a district's landmark gets its own pieces (2.50, render only): worked out from the district's
 * picture and the story's places, never written back. Everything stands where nobody walks (on the
 * tops of the landmark's walls, on the water beside the pier) or lies flat on the floor (the helipad's
 * paint, the grille over the metro's stairs), so the simulation, its paths and its saves know nothing
 * of it. Pure, no Three.js: `citylandmarktest` reads it on many cities.
 */
export interface LandmarkPlan {
  use: LotUse;
  lot: Lot;
  /** The tops of its walls: every wall tile on the rectangle's edge. */
  coping: number[];
  /** Its four corners (always walls): north-west, north-east, south-west, south-east. */
  corners: [number, number, number, number];
  /** The sign's place on the north wall: the middle (in tiles, along x) of its longest unbroken run. */
  signX: number;
  /** Wall tiles of the north row clear of the sign and the corners (their x), nearest the sign first on each side: west, then east. */
  roof: [number[], number[]];
  /** The hospital's pad: three tiles across on the clear floor nearest the tile the beacon is lit from (`wide` false: no such room, a small one on that tile). */
  pad: { tile: number; wide: boolean } | null;
  /** The boat on the water beside the pier's end, its bow pointing out to sea (dx, dz). */
  boat: { tile: number; dx: number; dz: number } | null;
  /** The grille over the metro's stairs, and the clear tile beside it that it slides onto (dx, dz). */
  grille: { tile: number; dx: number; dz: number } | null;
}

/** Where the story's ways out are, as the city's story gives them (StoryPlaces). */
export interface WayPlaces {
  wayDistrict: readonly number[];
  exits: readonly number[];
  pier: number;
}

const SIDES = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

/** How far to either side of its middle the sign keeps the wall to itself (tiles). */
export const SIGN_REACH = 2;

/** A district's landmark and its pieces' places (`solid`: the district's walls and furniture, as paths see them; `people`: the tiles survivors stand on). */
export function landmarkPlan(
  district: District,
  places: WayPlaces,
  solid: Uint8Array,
  people: readonly number[] = [],
): LandmarkPlan | null {
  const use = DISTRICTS[district.kind].landmark;
  const lot = district.lots.find((l) => l.use === use);
  if (!lot) return null;
  const ch = (x: number, z: number) => (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H ? '' : district.rows[z][x]);
  const at = (x: number, z: number) => z * MAP_W + x;
  const coping: number[] = [];
  for (let z = lot.z0; z <= lot.z1; z++)
    for (let x = lot.x0; x <= lot.x1; x++)
      if ((x === lot.x0 || x === lot.x1 || z === lot.z0 || z === lot.z1) && ch(x, z) === '#') coping.push(at(x, z));
  // The sign: over the longest stretch of the north wall no door or window breaks.
  let best = [lot.x0, lot.x0];
  for (let x = lot.x0, from = -1; x <= lot.x1 + 1; x++) {
    const wall = x <= lot.x1 && ch(x, lot.z0) === '#';
    if (wall && from < 0) from = x;
    if (!wall && from >= 0) {
      if (x - 1 - from > best[1] - best[0]) best = [from, x - 1];
      from = -1;
    }
  }
  const signX = (best[0] + best[1]) / 2 + 0.5;
  const roofAt = (x: number) => x > lot.x0 + 1 && x < lot.x1 - 1 && ch(x, lot.z0) === '#' && Math.abs(x + 0.5 - signX) >= SIGN_REACH;
  const roof: [number[], number[]] = [[], []];
  for (let x = Math.floor(signX); x > lot.x0; x--) if (roofAt(x)) roof[0].push(x);
  for (let x = Math.ceil(signX); x < lot.x1; x++) if (roofAt(x)) roof[1].push(x);
  const plan: LandmarkPlan = {
    use,
    lot,
    coping,
    corners: [at(lot.x0, lot.z0), at(lot.x1, lot.z0), at(lot.x0, lot.z1), at(lot.x1, lot.z1)],
    signX,
    roof,
    pad: null,
    boat: null,
    grille: null,
  };
  const way = places.wayDistrict.indexOf(district.index);
  const exit = way >= 0 ? places.exits[way] : -1;
  // Clear floor: of this building, a floor and no doorway, nothing solid on it, no furniture at all (a bench isn't solid), nobody standing there.
  const furnished = new Uint8Array(MAP_W * MAP_H);
  district.props.forEach((_, k) => tilesOf(district, k).forEach((t) => (furnished[t] = 1)));
  for (const t of people) furnished[t] = 1;
  const FLOORS = 'w:_';
  const clear = (i: number) =>
    i >= 0 &&
    i < MAP_W * MAP_H &&
    !solid[i] &&
    !furnished[i] &&
    district.lotAt[i] === district.lotAt[exit] &&
    FLOORS.includes(ch(i % MAP_W, Math.floor(i / MAP_W)) || '#');
  if (way === 0) {
    // The pad: the clear three-by-three of the hospital's floor nearest the tile the beacon is lit from.
    const room = (i: number) => {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!clear(i + dz * MAP_W + dx)) return false;
      return true;
    };
    let tile = -1;
    let near = Infinity;
    for (let z = lot.z0 + 2; z <= lot.z1 - 2; z++)
      for (let x = lot.x0 + 2; x <= lot.x1 - 2; x++) {
        const far = Math.abs(x - (exit % MAP_W)) + Math.abs(z - Math.floor(exit / MAP_W));
        if (far < near && room(at(x, z))) [tile, near] = [at(x, z), far];
      }
    plan.pad = tile >= 0 ? { tile, wide: true } : { tile: exit, wide: false };
  } else if (way === 1 && places.pier >= 0) {
    const px = places.pier % MAP_W;
    const pz = Math.floor(places.pier / MAP_W);
    // Out to sea: away from the plank behind the pier's end; the boat lies on the water to one side.
    const back = SIDES.find(([dx, dz]) => ch(px + dx, pz + dz) === 'P' && ch(px - dx, pz - dz) === '~');
    if (back) {
      const [ox, oz] = [-back[0], -back[1]];
      const side = SIDES.find(([dx, dz]) => dx * ox + dz * oz === 0 && ch(px + dx, pz + dz) === '~');
      if (side) plan.boat = { tile: at(px + side[0], pz + side[1]), dx: ox, dz: oz };
    }
  } else if (way === 2) {
    const side = SIDES.find(([dx, dz]) => clear(exit + dz * MAP_W + dx));
    // (No clear tile beside it: it winds down into the well, drawn as gone.)
    plan.grille = { tile: exit, dx: side?.[0] ?? 0, dz: side?.[1] ?? 0 };
  }
  return plan;
}
