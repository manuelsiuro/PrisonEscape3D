/**
 * The sea round HMP Irongate (P12, GDD §4.5): a tunnel dug under the water floods at once
 * (the whole tunnel is lost, the player washed out and carried to the infirmary), a raft is
 * launched off the end of the pier, and the supply helicopter on its pad takes a guard away
 * at night once the helipad's guards are down.
 */
import { ROUTINE } from '../../content/routine';
import type { SimContext } from '../context';
import { HURT_BY } from '../events';
import { isTunnel, TILE } from '../world/tiles';
import { LAYER, layerOfKey, MAP_H, MAP_W, tileOfKey } from '../world/World';
import { hurt } from './fights';
import { inDisguise, setTile } from './watch';

/**
 * The tunnel the player just dug into the sea floods: every tunnel tile joined to it fills
 * back in, its entrances with it (silt and water), what lay on its floor is gone, and the
 * player is washed out cold (the infirmary; the heat stays, nobody saw).
 */
export function flood(sim: SimContext, tile: number) {
  const s = sim.state;
  const w = sim.world;
  const under = w.layers[LAYER.UNDER].kind;
  const lost = new Set<number>([tile]);
  const queue = [tile];
  while (queue.length) {
    const t = queue.pop()!;
    for (const j of [t - 1, t + 1, t - MAP_W, t + MAP_W]) {
      if (j < 0 || j >= MAP_W * MAP_H || lost.has(j) || !isTunnel(under[j])) continue;
      if (Math.abs((j % MAP_W) - (t % MAP_W)) > 1) continue;
      lost.add(j);
      queue.push(j);
    }
  }
  for (const t of lost) {
    setTile(sim, LAYER.UNDER, t, TILE.SOIL);
    if (w.ground.kind[t] === TILE.SHAFT) setTile(sim, LAYER.GROUND, t, -1);
  }
  // What lay down there is lost with it.
  const it = s.items;
  const before = it.ground.length;
  it.ground = it.ground.filter(([key]) => !(layerOfKey(key) === LAYER.UNDER && lost.has(tileOfKey(key))));
  if (it.ground.length !== before) it.rev++;
  s.deskAside = false;
  sim.events.push({ type: 'flood', tile, lost: lost.size });
  hurt(sim, s.health, HURT_BY.FLOOD);
}

/** The raft pushed off the pier's end (P12): out to sea, free. */
export function launch(sim: SimContext) {
  sim.boarded = 'raft';
}

/** The supply helicopter sits on its pad through Lights Out (GDD §4.5: "board the supply helicopter at night"). */
export const helicopterIn = (sim: SimContext) => ROUTINE[sim.state.routine].id === 'lightsOut';

/** Whether every guard of the helipad is out cold (GDD §4.5: knock out the helipad guards). */
function helipadClear(sim: SimContext): boolean {
  const defs = sim.world.def.guards;
  return sim.state.guards.every((g, k) => !defs[k]?.helipad || g.ko > 0);
}

/**
 * Boarding the helicopter on its pad (GDD §4.5): only at night when it's there, only with
 * the helipad's guards out cold, and only in a guard's uniform (the pilot flies staff).
 */
export function board(sim: SimContext) {
  if (!helicopterIn(sim)) sim.events.push({ type: 'refused', why: 'noHelicopter' });
  else if (!helipadClear(sim)) sim.events.push({ type: 'refused', why: 'helipadGuards' });
  else if (!inDisguise(sim)) sim.events.push({ type: 'refused', why: 'notUniform' });
  else sim.boarded = 'helicopter';
}
