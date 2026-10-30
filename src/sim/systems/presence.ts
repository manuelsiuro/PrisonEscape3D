/**
 * Where the player is, as the systems that wait for them see it: on the ground floor in plain
 * sight, up and about there, or at a fixture (a tile from it, in its room).
 */
import type { SimContext } from '../context';
import { UNIT } from '../tuning';
import { LAYER } from '../world/World';

/** On the ground floor in plain sight: not away (vents, roofs, tunnels, outside) nor hidden in a vehicle; asleep or knocked out all the same. */
export const playerAbout = (sim: Pick<SimContext, 'state' | 'away'>) => sim.state.layer === LAYER.GROUND && !sim.state.stowed && !sim.away;

/** Up and about on the ground floor: about, and neither asleep nor knocked out. */
export function playerUp(sim: Pick<SimContext, 'state' | 'away'>): boolean {
  const s = sim.state;
  return playerAbout(sim) && !s.sleeping && s.ko <= 0;
}

/** At a fixture on the ground floor: up and about, on its tile or one beside it, and in its room (not through its wall). */
export function atFixture(sim: Pick<SimContext, 'state' | 'away' | 'world'>, t: { x: number; z: number }): boolean {
  if (!playerUp(sim)) return false;
  const x = Math.floor(sim.state.player.x / UNIT);
  const z = Math.floor(sim.state.player.z / UNIT);
  return Math.max(Math.abs(x - t.x), Math.abs(z - t.z)) <= 1 && sim.world.zoneAt(x, z) === sim.world.zoneAt(t.x, t.z);
}
