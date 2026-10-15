/**
 * The weather (GDD §4.2): in a freezing prison, more than a minute out in the snow (the
 * ground floor's open air, or a roof) without a cushioned or plated outfit chills the player,
 * and everything that costs energy costs twice as much until they have warmed up again
 * indoors (all the way: four times as fast as it came).
 */
import { itemNumber } from '../../content/items';
import { SLOT } from '../command';
import type { SimContext } from '../context';
import { COLD_STEPS, WARM_RATE } from '../tuning';
import { TILE_INFO } from '../world/tiles';
import { LAYER, MAP_W } from '../world/World';
import { itemOf } from './items';
import { tileOfBody } from './movement';

/** Outfits that keep the cold out (GDD §6.4: the cushioned one is made for it; plates are as good). */
const WARM = new Set([itemNumber('cushioned_outfit'), itemNumber('plated_outfit')]);

/** Whether the player is out in the cold now (in a freezing prison, without a warm outfit). */
export function exposed(sim: SimContext): boolean {
  const s = sim.state;
  if (!sim.world.def.rules?.cold || sim.away || WARM.has(itemOf(s.items.inv[SLOT.OUTFIT]))) return false;
  if (s.layer === LAYER.ROOF) return true;
  if (s.layer !== LAYER.GROUND) return false;
  const t = tileOfBody(s.player);
  return TILE_INFO[sim.world.ground.kind[t.z * MAP_W + t.x]].outdoor;
}

/** Chilled to the bone: energy costs double, until the player has warmed up all the way (indoors too). */
export const chilled = (sim: SimContext) => sim.state.frozen;

/** What spending `n` energy costs the player now. */
export const energyCost = (sim: SimContext, n: number) => (chilled(sim) ? n * 2 : n);

/** A step of the weather: the cold builds outdoors, eases off indoors (faster), and says when it bites and lets go. */
export function chill(sim: SimContext) {
  const s = sim.state;
  s.cold = exposed(sim) ? Math.min(COLD_STEPS, s.cold + 1) : Math.max(0, s.cold - WARM_RATE);
  // It bites at the full minute and lets go only once the player is warm again.
  const now = s.cold >= COLD_STEPS || (s.frozen && s.cold > 0);
  if (now !== s.frozen) {
    s.frozen = now;
    sim.events.push({ type: 'cold', on: now });
  }
}
