/**
 * What the guards see (GDD §5.1–5.3, §9.3): the player in a cone or on a camera, damage and
 * evidence on the floor, and what that costs in heat (up to the lockdown). Tiles changed and
 * put right go through here too, so the state and the world never disagree.
 */
import { itemDef, itemNumber } from '../../content/items';
import { ROUTINE } from '../../content/routine';
import { RESTRICTED } from '../../content/zones';
import { canSee } from '../ai/sight';
import { SLOT } from '../command';
import type { SimContext } from '../context';
import { SPOT } from '../state';
import { CHASE_HEAT, CONTRABAND_HEAT, LIGHTS_OUT_GRACE, RECOGNIZE_RANGE, RECOGNIZE_STEPS, SEARCHLIGHT_HEAT, SELF_DEFENSE_HEAT, STEPS_PER_MINUTE, STRIKE_SEEN_STEPS, UNIT } from '../tuning';
import { DAMAGE_SHOWS, TILE, TILE_INFO } from '../world/tiles';
import { LAYER, layerOfKey, MAP_W, placeKey, tileOfKey } from '../world/World';
import { clockAt } from './clock';
import { awake, GUARD, startChase } from './guards';
import { itemOf } from './items';
import { type Body, tileOfBody } from './movement';
import { cameraSeesPlayer, snipe, summon } from './power';
import { inBeam } from './security';
import { DIRT, underMyDesk, WALL_CHUNK } from './structure';

/**
 * Guards look (GDD §5.1–5.3): who sees the player, what that costs in heat, who gives
 * chase, and whether a chaser has caught them.
 */
export function watch(sim: SimContext) {
  const s = sim.state;
  const p = s.player;
  const t = tileOfBody(p);
  const here = t.z * MAP_W + t.x;
  s.seen = false;
  for (const g of s.guards) {
    g.sees = !sim.away && awake(g) && inView(sim, g.body);
    if (g.sees) {
      g.lastSeen = here;
      s.seen = true;
    }
  }
  // Damage and evidence in a guard's cone (GDD §9.3).
  const found = noticeDamage(sim);
  if (sim.away) {
    s.spotted = 0;
    s.near = 0;
    if (found) repair(sim);
    return;
  }
  const zone = sim.playerZone;
  const it = s.items;
  const disguised = itemOf(it.inv[SLOT.OUTFIT]) === GUARD_OUTFIT;
  let reason = 0;
  let heat = 0;
  // Out of the cell after Lights Out (past the walk home), or somewhere staff only: 100%.
  const sinceLightsOut = (clockAt(s.step).minuteOfDay - ROUTINE[ROUTINE.length - 1].start + 1440) % 1440;
  const late = ROUTINE[s.routine].id === 'lightsOut' && sinceLightsOut * STEPS_PER_MINUTE >= LIGHTS_OUT_GRACE;
  // Seen attacking someone (GDD §5.2), at work on a wall, a fence, a grate or the floor, damage found: 100% (§9.3).
  // Fighting back at an inmate who jumped the player: a scuffle, some heat a blow (not the alarm).
  if (s.seen && s.step - s.swingAt <= STRIKE_SEEN_STEPS) [reason, heat] = s.selfDefense ? [SPOT.indexOf('brawl'), s.step === s.swingAt ? SELF_DEFENSE_HEAT : 0] : [SPOT.indexOf('fight'), 100];
  else if (s.seen && s.step - s.struckAt <= STRIKE_SEEN_STEPS) [reason, heat] = [SPOT.indexOf('tampering'), 100];
  else if (found) [reason, heat] = [SPOT.indexOf('damage'), 100];
  else if (s.seen && !disguised && late && zone !== 'playerCell') [reason, heat] = [SPOT.indexOf('night'), 100];
  else if (s.seen && !disguised && RESTRICTED.includes(zone)) [reason, heat] = [SPOT.indexOf('restricted'), 100];
  // A camera sees what a guard would sound the alarm for (GDD §5.6).
  const filmed = cameraSeesPlayer(sim);
  if (!reason && filmed) {
    const fighting = s.step - s.swingAt <= STRIKE_SEEN_STEPS && !s.selfDefense;
    const working = s.step - s.struckAt <= STRIKE_SEEN_STEPS;
    if (fighting || working || (!disguised && ((late && zone !== 'playerCell') || RESTRICTED.includes(zone)))) [reason, heat] = [SPOT.indexOf('camera'), 100];
  }
  // A searchlight's beam at night (GDD §5.2): +35% a second in it, the alarm (guards sent) as it finds the player.
  const lit = !disguised && sim.power && ROUTINE[s.routine].id === 'lightsOut' && s.layer === LAYER.GROUND && inBeam(sim.world, p, s.step) >= 0;
  if (lit && !s.lit) summon(sim, here, 2);
  s.lit = lit;
  if (!reason && lit) [reason, heat] = [SPOT.indexOf('searchlight'), s.step % 4 === 0 ? SEARCHLIGHT_HEAT : 0];
  // A contraband tool or weapon in hand, in plain sight: +40% a second.
  const held = itemOf(it.inv[it.hand]);
  const def = held ? itemDef(held) : null;
  if (!reason && s.seen && def?.contraband && (def.cat === 'tool' || def.cat === 'weapon')) [reason, heat] = [SPOT.indexOf('contraband'), s.step % (sim.world.def.rules?.contrabandEvery ?? 1) === 0 ? CONTRABAND_HEAT : 0];
  // In a guard's uniform, but too close to a real one (who sees the player) for too long: +50% a second.
  const close = disguised && s.guards.some((g) => g.sees && (g.body.x - p.x) ** 2 + (g.body.z - p.z) ** 2 <= RECOGNIZE_RANGE ** 2);
  s.near = close ? s.near + 1 : 0;
  if (!reason && s.near > RECOGNIZE_STEPS) [reason, heat] = [SPOT.indexOf('recognized'), s.step % 2 === 0 ? 5 : 0];
  // Wanted (80%+): any guard who sees the player gives chase.
  if (!s.lockdown && s.heat >= CHASE_HEAT) {
    for (const g of s.guards) {
      if (!g.sees || g.mode === GUARD.CHASE) continue;
      if (!reason) reason = SPOT.indexOf('wanted');
      startChase(g);
    }
  }
  // Something new noticed (in a lockdown there is nothing more to notice).
  if (reason && reason !== s.spotted && !s.lockdown) sim.events.push({ type: 'spotted', reason: SPOT[reason] });
  s.spotted = reason;
  if (heat) addHeat(sim, heat);
  // Under a camera's eye, heat doesn't cool either.
  if (filmed) s.seen = true;
  // Snipers by day.
  snipe(sim);
}

/**
 * Whether a guard sees the player: on the ground floor, its cone and a clear line; up on a
 * roof, from the open yard (nothing on the ground is in the way); in the vents and the
 * tunnels, never.
 */
function inView(sim: SimContext, eye: Body): boolean {
  const s = sim.state;
  if (s.layer === LAYER.GROUND) return canSee(sim.world, eye, s.player);
  if (s.layer !== LAYER.ROOF) return false;
  const t = tileOfBody(eye);
  return TILE_INFO[sim.world.ground.kind[t.z * MAP_W + t.x]].outdoor && canSee(sim.world, eye, s.player, undefined, false);
}

/**
 * Guards notice damage in their cones (GDD §9.3): an open hole, a cut fence, a missing
 * grate overhead, a tunnel entrance (one under the player's desk only while the desk is
 * pushed aside, with the player below), and dirt or chunks of wall left on the floor
 * (taken away there and then). Returns whether anything new was found.
 */
function noticeDamage(sim: SimContext): boolean {
  const s = sim.state;
  const w = sim.world;
  const watchers = sim.scratch.watchers;
  watchers.length = 0;
  for (const g of s.guards) if (awake(g)) watchers.push(g);
  if (!watchers.length) return false;
  const point = sim.scratch.point;
  // The middle of the tile, or any of its four faces (a hole in a wall is seen from an angle by its face).
  const seenAt = (tile: number) => {
    const cx = (tile % MAP_W) * UNIT + UNIT / 2;
    const cz = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
    for (const [fx, fz] of FACES) {
      point.x = cx + fx;
      point.z = cz + fz;
      if (watchers.some((g) => canSee(w, g.body, point))) return true;
    }
    return false;
  };
  let any = false;
  for (const k in s.tiles) {
    const key = Number(k);
    const kind = s.tiles[key];
    const layer = layerOfKey(key);
    const tile = tileOfKey(key);
    const shows = layer === LAYER.GROUND ? DAMAGE_SHOWS.has(kind) && !(kind === TILE.SHAFT && underMyDesk(w, tile) && !s.deskAside) : layer === LAYER.VENTS && kind === TILE.GRATE_OPEN;
    if (!shows || s.found.includes(key) || !seenAt(tile)) continue;
    s.found.push(key);
    sim.events.push({ type: 'found', kind });
    any = true;
  }
  const it = s.items;
  for (let k = it.ground.length - 1; k >= 0; k--) {
    const [key, v] = it.ground[k];
    const item = itemOf(v);
    if ((item !== DIRT && item !== WALL_CHUNK) || layerOfKey(key) !== LAYER.GROUND || !seenAt(key)) continue;
    it.ground.splice(k, 1);
    it.rev++;
    sim.events.push({ type: 'found', kind: TILE.DIRT });
    any = true;
  }
  return any;
}

/** Damage the guards found is put right (concreted over, the grate screwed back): after a capture. */
export function repair(sim: SimContext) {
  const s = sim.state;
  if (!s.found.length) return;
  const n = s.found.length;
  for (const key of s.found) setTile(sim, layerOfKey(key), tileOfKey(key), -1);
  s.found = [];
  sim.events.push({ type: 'repaired', n });
}

/** Changes a tile and records it in the state (-1 puts the map's own tile back). */
export function setTile(sim: SimContext, layer: number, tile: number, kind: number) {
  const s = sim.state;
  const l = sim.world.layers[layer];
  const key = placeKey(layer, tile);
  const k = kind < 0 ? l.base[tile] : kind;
  delete s.wear[key];
  if (k === l.base[tile]) delete s.tiles[key];
  else s.tiles[key] = k;
  sim.world.setKind(layer, tile, k);
  sim.tilesRev++;
  sim.wearRev++;
}

/** Heat; at 100% the sirens go: a lockdown, every guard hunting the player (GDD §3.1). */
export function addHeat(sim: SimContext, n: number) {
  const s = sim.state;
  if (sim.away) return;
  s.heat = Math.min(100, s.heat + n);
  if (s.heat >= 100 && !s.lockdown) {
    s.lockdown = true;
    s.excused = true;
    sim.events.push({ type: 'lockdown', on: true });
  }
}

const GUARD_OUTFIT = itemNumber('guard_outfit');
/** Where a guard looks at a tile from: its middle, then its faces. */
const FACES = [
  [0, 0],
  [0, Math.round(UNIT * 0.45)],
  [0, -Math.round(UNIT * 0.45)],
  [Math.round(UNIT * 0.45), 0],
  [-Math.round(UNIT * 0.45), 0],
];
