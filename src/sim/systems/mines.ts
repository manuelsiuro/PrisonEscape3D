/**
 * The minefield (P11, GDD §4.4): a buried mine goes off under the player, stepped on or come
 * up into out of a tunnel. The blast is heard all over the prison (wanted at once) and does
 * 100 HP: out cold and carried to solitary, or, for the very strong, left standing in the
 * open for the snipers. Its crater is safe ground until the guards lay a new mine at 08:00.
 */
import type { SimContext } from '../context';
import { HURT_BY } from '../state';
import { MINE_DAMAGE, UNIT } from '../tuning';
import { TILE } from '../world/tiles';
import { LAYER, MAP_W } from '../world/World';
import { hurt } from './fights';
import { addHeat } from './watch';

/** A ground tile with a mine still under it. */
export const liveMine = (sim: SimContext, i: number) => sim.world.ground.kind[i] === TILE.MINE && !sim.state.craters.includes(i);

/** On the ground floor, a step onto a live mine sets it off. */
export function mines(sim: SimContext) {
  const s = sim.state;
  if (s.layer !== LAYER.GROUND || s.ko > 0 || sim.away) return;
  const i = Math.floor(s.player.z / UNIT) * MAP_W + Math.floor(s.player.x / UNIT);
  if (liveMine(sim, i)) blast(sim, i);
}

/** The mine at a ground tile goes off with the player on (or under) it. */
export function blast(sim: SimContext, i: number) {
  const s = sim.state;
  s.craters.push(i);
  sim.events.push({ type: 'blast', tile: i });
  addHeat(sim, 100);
  hurt(sim, MINE_DAMAGE, HURT_BY.MINE);
}
