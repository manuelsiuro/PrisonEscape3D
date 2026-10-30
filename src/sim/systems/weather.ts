/**
 * The weather (GDD §4.2): in a freezing prison, more than a minute out in the snow (the
 * ground floor's open air, or a roof) without a cushioned or plated outfit chills the player,
 * and everything that costs energy costs twice as much until they have warmed up again
 * indoors (all the way: four times as fast as it came). A heatwave's sun (P17, 11:00–18:00)
 * does the same to anyone out in it, whatever they wear; a shower cools them at once.
 */
import { twist } from './twists';
import { itemNumber } from '../../content/items';
import { SLOT } from '../command';
import type { SimContext } from '../context';
import { COLD_STEPS, WARM_RATE } from '../tuning';
import { TILE_INFO } from '../world/tiles';
import { LAYER, MAP_W } from '../world/World';
import { itemOf } from './items';
import { tileOfBody } from './movement';
import { sunBites, today } from './calendar';
import { underShower } from './upkeep';

/** Outfits that keep the cold out (GDD §6.4: the cushioned one is made for it; plates are as good). */
const WARM = new Set([itemNumber('cushioned_outfit'), itemNumber('plated_outfit')]);

/** Whether the player is out in the cold now (in a freezing prison, without a warm outfit), or (P17) out in a heatwave's sun. */
export function exposed(sim: SimContext): boolean {
  const s = sim.state;
  // (Hidden in the delivery's vehicle, P18: out of the wind and the sun.)
  if (sim.away || s.stowed) return false;
  // A heatwave's day (P17): only its sun counts (whatever the prison's usual cold); else the cold, without a warm outfit.
  const exposure = baking(sim) ? sunBites(sim) : freezing(sim) && !WARM.has(itemOf(s.items.inv[SLOT.OUTFIT]));
  if (!exposure) return false;
  if (s.layer === LAYER.ROOF) return true;
  if (s.layer !== LAYER.GROUND) return false;
  const t = tileOfBody(s.player);
  return TILE_INFO[sim.world.ground.kind[t.z * MAP_W + t.x]].outdoor;
}

/** The weather that bites is the sun's (P17: a heatwave's day). */
export const baking = (sim: SimContext) => today(sim).weather === 'heatwave';

/** Chilled to the bone: energy costs double, until the player has warmed up all the way (indoors too). */
export const chilled = (sim: SimContext) => sim.state.frozen;

/** What spending `n` energy costs the player now. */
export const energyCost = (sim: SimContext, n: number) => (chilled(sim) ? n * 2 : n);

/** A step of the weather: the cold builds outdoors, eases off indoors (faster), and says when it bites and lets go. */
export function chill(sim: SimContext) {
  const s = sim.state;
  s.cold = exposed(sim) ? Math.min(COLD_STEPS, s.cold + 1) : Math.max(0, s.cold - WARM_RATE);
  // A heatwave's heat washes off under a shower at once (P17).
  if (s.cold > 0 && baking(sim) && underShower(sim)) s.cold = 0;
  // It bites at the full minute and lets go only once the player is warm (or cool) again.
  const now = s.cold >= COLD_STEPS || (s.frozen && s.cold > 0);
  if (now !== s.frozen) {
    s.frozen = now;
    sim.events.push(baking(sim) ? { type: 'cold', on: now, hot: true } : { type: 'cold', on: now });
  }
}

/** A freezing prison (Stalag Flucht, GDD §4.2), or a Big Freeze Daily anywhere (P26). */
export const freezing = (sim: SimContext): boolean => !!sim.world.def.rules?.cold || twist(sim.state, 'bigFreeze');
