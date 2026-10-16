/**
 * The prison's powered security (GDD §5.4–5.6, §12): the generator, the detector arches, the
 * cameras and their tape, the snipers by day, and the takeover once enough guards are down.
 * The geometry (beams, cones, towers) is in security.ts.
 */
import { itemDef, itemNumber } from '../../content/items';
import { ROUTINE } from '../../content/routine';
import { SLOT } from '../command';
import type { SimContext } from '../context';
import type { PowerUse } from '../../content/prisons/types';
import { HURT_BY, type SimState } from '../state';
import { DETECTOR_HEAT, POWER_OFF_STEPS, SNIPER_AIM, SNIPER_DAMAGE, SNIPER_PACE, SOLITARY_HEAT, TAKEOVER_SHARE, UNIT } from '../tuning';
import { TILE } from '../world/tiles';
import { LAYER, MAP_W, type World } from '../world/World';
import { hurt } from './fights';
import { awake, backToDuty, GUARD, sendToLook } from './guards';
import { HOTBAR, itemOf, slot, usesOf } from './items';
import { tileOfBody } from './movement';
import { cameraSees, sniperOn } from './security';
import { besideOnGround } from './structure';
import { addHeat } from './watch';
import { snipersBlind } from './calendar';

/** Time passing on the devices: the power comes back on (the maintenance guard has the generator running again, GDD §5.5), a camera's tape comes off. */
export function devices(sim: SimContext) {
  const s = sim.state;
  if (s.powerOff > 0 && --s.powerOff === 0) {
    maintenanceDone(sim, 0);
    sim.events.push({ type: 'power', on: true, by: 'guard', gen: 0 });
  }
  if (s.powerOff2 > 0 && --s.powerOff2 === 0) {
    maintenanceDone(sim, 1);
    sim.events.push({ type: 'power', on: true, by: 'guard', gen: 1 });
  }
  s.cams.forEach((until, k) => {
    if (until && s.step >= until) {
      s.cams[k] = 0;
      sim.events.push({ type: 'camera', index: k, blind: false });
    }
  });
}

/** The prison's generators (prop indexes, in map order): one, or HMP Irongate's two (P12). */
export function generatorsOf(w: World): number[] {
  const out: number[] = [];
  w.props.forEach((p, k) => p.kind === 'generator' && out.push(k));
  return out;
}

/** Which generator (0, 1) a generator prop is. */
export const genOf = (w: World, prop: number) => Math.max(0, generatorsOf(w).indexOf(prop));

/** Steps until a generator's power is back (0: running). */
export const offFor = (s: SimState, gen: number) => (gen === 1 ? s.powerOff2 : s.powerOff);

/** The generator that powers something (GDD §5.5; Irongate's split, §4.5): the prison's one, else the one the grid names. */
export function genFor(w: World, use: PowerUse): number {
  const grid = w.def.grid;
  if (!grid) return 0;
  const k = grid.findIndex((uses) => uses.includes(use));
  return k < 0 ? 0 : k;
}

/** Whether something has power now. */
export const powered = (w: World, s: SimState, use: PowerUse) => offFor(s, genFor(w, use)) === 0;

/**
 * The generator (GDD §5.5): switched off, what it powers (the electric fence, the
 * detectors, the cameras, the searchlights, the lights: all of them, or Irongate's half)
 * goes dead for 45 s, and a guard is sent to put it right; switched back on by the player,
 * sooner.
 */
export function switchPower(sim: SimContext, prop: number) {
  const s = sim.state;
  const gen = genOf(sim.world, prop);
  if (offFor(s, gen) > 0) {
    if (gen === 1) s.powerOff2 = 0;
    else s.powerOff = 0;
    maintenanceDone(sim, gen);
    sim.events.push({ type: 'power', on: true, by: 'player', gen });
    return;
  }
  cutPower(sim, gen, 'player');
}

/**
 * A generator's power cut (by the player, a storm's lightning, P17's service): what it powers
 * goes dead for 45 s (a cut already under way lasts at least that), and a guard is sent to put
 * it right. It stays at the generator until the power is back (on its way there it is a guard
 * like any other). The tutorial's relaxed rules send nobody: the lesson is about the fence, not the chase.
 */
export function cutPower(sim: SimContext, gen: number, by: 'player' | 'storm' | 'maintenance', steps = POWER_OFF_STEPS) {
  const s = sim.state;
  const prop = generatorsOf(sim.world)[gen];
  if (prop === undefined) return;
  const was = offFor(s, gen);
  if (gen === 1) s.powerOff2 = Math.max(was, steps);
  else s.powerOff = Math.max(was, steps);
  if (sim.world.def.rules?.relaxed) {
    if (!was) sim.events.push({ type: 'power', on: false, by, gen });
    return;
  }
  const spot = generatorSpot(sim, prop);
  if (was > 0) {
    // A cut made longer (the service on top of the player's): whoever is there waits it out.
    if (steps > was) {
      const there = s.guards.filter((g) => g.mode === GUARD.INVESTIGATE && g.target === spot);
      for (const g of there) g.timer = Math.max(g.timer, steps);
      if (!there.length) summon(sim, spot, 1, steps);
    }
    return;
  }
  sim.events.push({ type: 'power', on: false, by, gen });
  summon(sim, spot, 1, offFor(s, gen));
}

/** Where the maintenance guard stands at the generator. */
function generatorSpot(sim: SimContext, prop: number): number {
  const p = sim.world.props[prop];
  const at = besideOnGround(sim.world, p.z * MAP_W + p.x + p.w);
  return at >= 0 ? at : p.z * MAP_W + p.x;
}

/** A generator's power is back: whoever was sent to it goes back to duty. */
function maintenanceDone(sim: SimContext, gen: number) {
  const prop = generatorsOf(sim.world)[gen];
  if (prop === undefined) return;
  const spot = generatorSpot(sim, prop);
  for (const g of sim.state.guards) if (g.mode === GUARD.INVESTIGATE && g.target === spot) backToDuty(g);
}

/** The nearest guards up and about (and not chasing) go and look at a tile. */
export function summon(sim: SimContext, tile: number, n: number, look?: number) {
  const s = sim.state;
  const tx = (tile % MAP_W) * UNIT + UNIT / 2;
  const tz = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
  const free = s.guards.filter((g) => awake(g) && g.mode !== GUARD.CHASE);
  free.sort((a, b) => (a.body.x - tx) ** 2 + (a.body.z - tz) ** 2 - ((b.body.x - tx) ** 2 + (b.body.z - tz) ** 2));
  for (const g of free.slice(0, n)) sendToLook(g, tile, look);
}

/**
 * A detector arch (GDD §5.4): stepping into one with the power on scans what the player
 * carries. Contraband trips it (+50% heat, the buzzer, the nearest guards sent to look),
 * unless a contraband pouch in the pockets shields it (a pass worn off the pouch).
 */
export function scan(sim: SimContext) {
  const s = sim.state;
  const w = sim.world;
  const t = tileOfBody(s.player);
  const tile = t.z * MAP_W + t.x;
  if (s.layer !== LAYER.GROUND || w.ground.kind[tile] !== TILE.DETECTOR) {
    s.scanned = false;
    return;
  }
  if (s.scanned) return;
  s.scanned = true;
  if (!powered(w, s, 'detectors')) return;
  const it = s.items;
  let carried = false;
  let pouch = -1;
  for (let k = 0; k <= SLOT.OUTFIT; k++) {
    const n = itemOf(it.inv[k]);
    if (!n) continue;
    if (n === POUCH && k < HOTBAR) pouch = pouch < 0 ? k : pouch;
    else if (itemDef(n).contraband) carried = true;
  }
  if (!carried) return;
  if (pouch >= 0) {
    const left = usesOf(it.inv[pouch]) - 1;
    it.inv[pouch] = left > 0 ? slot(POUCH, left) : 0;
    it.rev++;
    sim.events.push({ type: 'scanned', tripped: false, pouch: left, tile });
    if (left <= 0) sim.events.push({ type: 'broke', item: POUCH });
    return;
  }
  sim.events.push({ type: 'scanned', tripped: true, pouch: -1, tile });
  if (!s.lockdown) sim.events.push({ type: 'spotted', reason: 'detector' });
  addHeat(sim, DETECTOR_HEAT);
  summon(sim, tile, 2);
}

/**
 * Cameras (GDD §5.6): whether one that is working (power on, no tape) sees the player on
 * the ground floor now. They catch what sets off the alarm: work on the structure, a fight,
 * a restricted room or the night out of the cell (a guard's uniform passes).
 */
export function cameraSeesPlayer(sim: SimContext): boolean {
  const s = sim.state;
  const cams = sim.world.def.cameras;
  if (!cams || !powered(sim.world, s, 'cameras') || s.layer !== LAYER.GROUND) return false;
  for (let k = 0; k < cams.length; k++) if (!s.cams[k] && cameraSees(sim.world, cams[k], k, s.step, s.player)) return true;
  return false;
}

/** The towers' snipers are on duty: by day, or round the clock where the prison says so. */
export function snipersOnDuty(sim: SimContext): boolean {
  // P17: nobody shoots what the fog or a storm hides.
  if (snipersBlind(sim)) return false;
  return ROUTINE[sim.state.routine].id !== 'lightsOut' || sim.world.def.rules?.snipers === 'always';
}

/**
 * Snipers by day (GDD §5.6): a tower with the player in its sights while they're wanted
 * (90%+) takes aim, fires a warning shot, then shoots to bring them down. Off duty at night
 * (the searchlights take over), unless the prison keeps them on round the clock.
 */
export function snipe(sim: SimContext) {
  const s = sim.state;
  const tower = !snipersOnDuty(sim) || sim.away ? -1 : sniperOn(sim.world, s.player, s.layer);
  if (tower < 0 || s.heat < SOLITARY_HEAT) {
    s.sniperAt = 0;
    s.shots = 0;
    return;
  }
  if (!s.sniperAt) {
    s.sniperAt = s.step + SNIPER_AIM;
    sim.events.push({ type: 'aim', tower });
    return;
  }
  if (s.step < s.sniperAt) return;
  s.sniperAt = s.step + SNIPER_PACE;
  const hit = s.shots++ > 0;
  const defense = itemDef(itemOf(s.items.inv[SLOT.OUTFIT]))?.defense ?? 0;
  const dmg = hit ? Math.max(10, SNIPER_DAMAGE - Math.floor(defense / 3)) : 0;
  sim.events.push({ type: 'shot', tower, hit, dmg });
  if (hit) hurt(sim, dmg, HURT_BY.SNIPER);
}

/** Enough guards out cold at once (GDD §12: 85%): every door and gate opens; it holds while they're down. */
export function takeoverCheck(sim: SimContext) {
  const s = sim.state;
  // A prison whose ways out leave the takeover off the list (the Training Block) never falls.
  const routes = sim.world.def.escapes;
  if (routes && !routes.includes('takeover')) return;
  const n = s.guards.length;
  let down = 0;
  for (const g of s.guards) if (g.ko > 0) down++;
  const on = n > 0 && down >= Math.ceil(n * TAKEOVER_SHARE);
  // Doors close again only once the player is clear of them.
  const t = tileOfBody(s.player);
  const inDoor = s.layer === LAYER.GROUND && sim.world.ground.kind[t.z * MAP_W + t.x] === TILE.DOOR;
  if (on !== s.takeover && (on || !inDoor)) {
    s.takeover = on;
    sim.events.push({ type: 'takeover', on });
  }
  sim.world.setRiot(s.takeover);
}

const POUCH = itemNumber('pouch');
