/**
 * The showers (2.26): at shower time the player turns one on with the action button, lined up under
 * the head, and it runs until they step away, strike or use a tool, or the block ends. Washing gives
 * energy back, takes minor heat off and washes a dog's scent away. Being counted for the block is
 * still only a matter of staying in the room. A run logged before 2.26 (Sim.rules225) showers as it
 * did: standing still under a head is enough.
 */
import { ROUTINE } from '../../content/routine';
import { placesOf } from '../ai/places';
import { DIR_X, DIR_Z } from '../command';
import type { SimContext } from '../context';
import { UNIT } from '../tuning';
import { containersOf } from '../world/containers';
import { LAYER, MAP_W } from '../world/World';
import type { Target } from './items';

type Reader = Pick<SimContext, 'state' | 'world' | 'away' | 'rules225' | 'showerTiles'>;

const tileOf = (v: number) => Math.floor(v / UNIT);
const playerTile = (s: Reader['state']) => tileOf(s.player.z) * MAP_W + tileOf(s.player.x);

/** Everything but the press: it's shower time, and nothing has the player elsewhere. */
function canWash(sim: Reader): boolean {
  const s = sim.state;
  return !sim.away && !s.lockdown && s.layer === LAYER.GROUND && ROUTINE[s.routine].id === 'showers' && !s.stowed;
}

/** Under a running shower now (not out cold, carried off or in a lockdown). */
export function underShower(sim: Reader): boolean {
  const s = sim.state;
  if (s.player.moving || !canWash(sim) || !sim.showerTiles.has(playerTile(s))) return false;
  return sim.rules225 || s.washing;
}

/**
 * The head the action button would turn on, its tile (-1 none): the one the player stands under, else
 * the one they're facing. The first press washes, the next one searches, as at the serving counter.
 */
export function showerOffer(sim: Reader, target: Target): number {
  const s = sim.state;
  // (Not while something else has their hands: a bout, a lock, the needle, the stage.)
  if (sim.rules225 || s.washing || s.seat >= 0 || s.bout.length || s.pick.length || s.ink || s.show || !canWash(sim)) return -1;
  const here = playerTile(s);
  if (sim.showerTiles.has(here)) return here;
  if (target?.kind !== 'container') return -1;
  // (Straight ahead first: the nearest container may be the next head along.)
  const ahead = here + Math.round(DIR_X[s.player.facing] / 1024) + Math.round(DIR_Z[s.player.facing] / 1024) * MAP_W;
  if (sim.showerTiles.has(ahead) && containersOf(sim.world)[target.index].prop.kind === 'shower') return ahead;
  const prop = containersOf(sim.world)[target.index].prop;
  return prop.kind === 'shower' ? prop.z * MAP_W + prop.x : -1;
}

/** The press: lined up under the head, the water on. Someone standing there already, and the player stays as they are. */
export function startWash(sim: SimContext, tile: number) {
  const s = sim.state;
  const onIt = (b: { x: number; z: number }) => tileOf(b.z) * MAP_W + tileOf(b.x) === tile;
  if ([...s.inmates, ...s.guards].some((o) => o.ko === 0 && !o.body.moving && onIt(o.body))) {
    sim.events.push({ type: 'refused', why: 'headTaken' });
    return;
  }
  s.player.x = (tile % MAP_W) * UNIT + UNIT / 2;
  s.player.z = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
  s.player.moving = false;
  s.player.facing = placesOf(sim.world).showers.find((h) => h.tile === tile)?.wall ?? s.player.facing;
  s.washing = true;
  sim.events.push({ type: 'wash', on: true });
}

/** The water off, if it was on. */
export function stopWash(sim: SimContext) {
  if (!sim.state.washing) return;
  sim.state.washing = false;
  sim.events.push({ type: 'wash', on: false });
}

/** Each step: the water goes off once the player isn't under it any more (moved, carried off, a lockdown, the block's end). */
export function keepWashing(sim: SimContext) {
  const s = sim.state;
  if (s.washing && (s.player.moving || !canWash(sim) || !sim.showerTiles.has(playerTile(s)))) stopWash(sim);
}
