import type { PrisonDef } from '../../content/prisons/types';
import { MAP_H, MAP_W, World } from '../../sim/world/World';
import { decoSolid, decoVeils, generateDistrict, type District } from '../gen/district';
import type { CityPlan } from '../gen/plan';

/**
 * A district as the rules and the view take it (C1): the prisons' own World built from the generated
 * picture (floors, walls, doors and furniture drawn, walked and seen through as in any prison), with
 * what stands on its streets in the way. A definition with no cells, guards, jobs or zones: nothing
 * of a prison's day runs on it (the city has its own simulation, city/sim/City.ts).
 */ export { isCity } from '../id';

export function districtWorld(plan: CityPlan, d: number, district: District = generateDistrict(plan, d)): World {
  const def: PrisonDef = {
    id: `city-${district.kind}`,
    difficulty: 0,
    theme: district.kind === 'industrial' || district.kind === 'docks' ? 'industrial' : 'suburban',
    ground: district.rows.join('\n'),
    zones: [],
    cells: [],
    props: district.props,
    rollCall: [],
    spawn: district.spawn,
    reachable: [],
    guards: [],
    names: [],
    merchants: [],
    crew: [],
    jobs: [],
    escapes: [],
    // (No door here is a prison's perimeter gate: every street door opens.)
    gates: [],
  };
  const world = new World(def);
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    if (decoSolid(district.deco[i])) world.parked[i] = 1;
    if (decoVeils(district.deco[i])) world.veil[i] = 1;
  }
  world.refreshBlock();
  return world;
}
