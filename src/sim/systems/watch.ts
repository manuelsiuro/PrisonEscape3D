/**
 * What the guards see (GDD §5.1–5.3, §9.3): the player in a cone or on a camera, damage and
 * evidence on the floor, and what that costs in heat (up to the lockdown). Tiles changed and
 * put right go through here too, so the state and the world never disagree.
 */
import { trickle } from './twists';
import { itemDef, itemNumber } from '../../content/items';
import { ROUTINE } from '../../content/routine';
import { RESTRICTED } from '../../content/zones';
import { canSee } from '../ai/sight';
import { SLOT } from '../command';
import type { SimContext } from '../context';
import type { SimState } from '../state';
import { SPOT } from '../events';
import { CHASE_HEAT, CONTRABAND_HEAT, LIGHTS_OUT_GRACE, RECOGNIZE_RANGE, RECOGNIZE_STEPS, SEARCHLIGHT_HEAT, SELF_DEFENSE_HEAT, SKIP_EVERY, SKIP_GRACE, STEPS_PER_MINUTE, STRIKE_SEEN_STEPS, UNIT } from '../tuning';
import { DAMAGE_SHOWS, TILE, TILE_INFO } from '../world/tiles';
import { LAYER, layerOfKey, MAP_W, placeKey, tileOfKey } from '../world/World';
import { clockAt } from './clock';
import { awake, GUARD, startChase, type Guard } from './guards';
import { eventOn, inFoodFight, sightOf } from './calendar';
import { INSPECTION_CONTRABAND } from '../../content/days';
import { itemOf } from './items';
import { tileOfBody } from './movement';
import { cameraSeesPlayer, snipe, summon, powered } from './power';
import { inBeam } from './security';
import { DIRT, underMyDesk, WALL_CHUNK } from './structure';
import { lookingAway } from './ways';
import { tipsyNow } from './pruno';
import { underPlant } from './garden';
import { sightFor } from './football';
import { TIPSY_HEAT } from '../../content/long';
import { centerX, centerZ } from '../world/grid';
import { snooping } from './snoop';

/** A tipsy player seen again within this long (steps) is the same sighting: no more heat for it. */
const TIPSY_SEEN_GAP = 5 * 20;

/**
 * Guards look (GDD §5.1–5.3): who sees the player, what that costs in heat, who gives
 * chase, and whether a chaser has caught them.
 */
export function watch(sim: SimContext) {
  const s = sim.state;
  const p = s.player;
  const t = tileOfBody(p);
  const here = t.z * MAP_W + t.x;
  // Seen by any guard (a fight, tools at work: none overlooks those), and by one who isn't
  // looking the other way (P15: one bribed lets the player be out late, somewhere staff only,
  // with contraband, in a uniform it should see through; under its eyes alone heat still cools).
  let seen = false;
  let eyes = false;
  // (Hidden in the delivery's vehicle, P18: nobody sees the player at all.)
  const hidden = sim.away || s.stowed;
  for (const g of s.guards) {
    g.sees = !hidden && awake(g) && inView(sim, g);
    if (g.sees) {
      g.lastSeen = here;
      seen = true;
      if (!lookingAway(g, s.step)) eyes = true;
    }
  }
  s.seen = eyes;
  // Damage and evidence in a guard's cone (GDD §9.3).
  const found = noticeDamage(sim);
  if (hidden) {
    s.spotted = 0;
    s.near = 0;
    if (found && sim.away) repair(sim);
    // Hidden in the delivery's vehicle (P18), the player is still the one the damage points to: the alarm goes up all the same.
    if (found && s.stowed && !sim.away) {
      s.spotted = SPOT.indexOf('damage');
      if (!s.lockdown) sim.events.push({ type: 'spotted', reason: 'damage' });
      addHeat(sim, 100);
    }
    return;
  }
  const zone = sim.playerZone;
  const it = s.items;
  const disguised = inDisguise(sim);
  // (P36: cleared for release, out through staff rooms with the guards' blessing.)
  const cleared = disguised || s.release[1] > 0;
  let reason = 0;
  let heat = 0;
  // Out of the cell after Lights Out (past the walk home), or somewhere staff only: 100%.
  const late = afterHours(s);
  // Seen attacking someone (GDD §5.2), at work on a wall, a fence, a grate or the floor, damage found: 100% (§9.3).
  // Fighting back at an inmate who jumped the player: a scuffle, some heat a blow (not the alarm).
  // A scuffle (hitting back, or P17's food fight) never hides tools at work or damage found; a food fight's blows at inmates in the canteen are noticed not at all.
  const swung = seen && s.step - s.swingAt <= STRIKE_SEEN_STEPS;
  const tampered = seen && s.step - s.struckAt <= STRIKE_SEEN_STEPS;
  // (A run logged before 1.11 replays as it was played: a scuffle came first then.)
  if (sim.legacy && swung) [reason, heat] = s.selfDefense ? [SPOT.indexOf('brawl'), s.step === s.swingAt ? SELF_DEFENSE_HEAT : 0] : [SPOT.indexOf('fight'), 100];
  else if (swung && !s.selfDefense) [reason, heat] = [SPOT.indexOf('fight'), 100];
  else if (tampered) [reason, heat] = [SPOT.indexOf('tampering'), 100];
  else if (found) [reason, heat] = [SPOT.indexOf('damage'), 100];
  else if (swung && !inFoodFight(sim)) [reason, heat] = [SPOT.indexOf('brawl'), s.step === s.swingAt ? SELF_DEFENSE_HEAT : 0];
  else if (eyes && !cleared && late && zone !== 'playerCell') [reason, heat] = [SPOT.indexOf('night'), 100];
  else if (eyes && !cleared && RESTRICTED.includes(zone)) [reason, heat] = [SPOT.indexOf('restricted'), 100];
  // A camera sees what a guard would sound the alarm for (GDD §5.6).
  const filmed = cameraSeesPlayer(sim);
  if (!reason && filmed) {
    const fighting = s.step - s.swingAt <= STRIKE_SEEN_STEPS && !s.selfDefense;
    const working = s.step - s.struckAt <= STRIKE_SEEN_STEPS;
    if (fighting || working || (!cleared && ((late && zone !== 'playerCell') || RESTRICTED.includes(zone)))) [reason, heat] = [SPOT.indexOf('camera'), 100];
  }
  // A searchlight's beam at night (GDD §5.2): +35% a second in it, the alarm (guards sent) as it finds the player.
  const lit = !cleared && powered(sim.world, s, 'searchlights') && ROUTINE[s.routine].id === 'lightsOut' && s.layer === LAYER.GROUND && inBeam(sim.world, p, s.step) >= 0;
  if (lit && !s.lit) summon(sim, here, 2);
  s.lit = lit;
  if (!reason && lit) [reason, heat] = [SPOT.indexOf('searchlight'), s.step % 4 === 0 ? SEARCHLIGHT_HEAT : 0];
  // A contraband tool or weapon in hand, in plain sight: +40% a second (P21: and a burner phone, as plain to see).
  const held = itemOf(it.inv[it.hand]);
  const def = held ? itemDef(held) : null;
  // (P17: the inspectors in, twice that.)
  if (!reason && eyes && def?.contraband && (def.cat === 'tool' || def.cat === 'weapon' || def.obvious)) [reason, heat] = [SPOT.indexOf('contraband'), s.step % (sim.world.def.rules?.contrabandEvery ?? 1) === 0 ? CONTRABAND_HEAT * (eventOn(sim, 'inspection') ? INSPECTION_CONTRABAND : 1) : 0];
  // Tipsy (P28): a guard who catches sight of it, TIPSY_HEAT (once a sighting: not again while seen in the last few seconds).
  if (!reason && eyes && tipsyNow(s)) {
    const fresh = s.step - (s.tipsy[1] ?? 0) > TIPSY_SEEN_GAP;
    s.tipsy[1] = s.step;
    [reason, heat] = [SPOT.indexOf('tipsy'), fresh ? TIPSY_HEAT : 0];
  }
  // 2.23: going through the things in another inmate's cell, in a guard's sight (a guard's uniform: a shakedown, as far as they can tell).
  const snooped = snooping(sim, eyes && !disguised);
  if (!reason && snooped >= 0) [reason, heat] = [SPOT.indexOf('snooping'), snooped];
  // 2.23: away from a block's zones before checking in, past the walk there: +2% a second.
  if (!reason && eyes && !cleared && skipping(sim, zone)) [reason, heat] = [SPOT.indexOf('skipping'), s.step % SKIP_EVERY === 0 ? 1 : 0];
  // In a guard's uniform, but too close to a real one (who sees the player) for too long: +50% a second.
  const close = disguised && s.guards.some((g) => g.sees && !lookingAway(g, s.step) && (g.body.x - p.x) ** 2 + (g.body.z - p.z) ** 2 <= RECOGNIZE_RANGE ** 2);
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
  // (P26: Short Fuse, half as much again while it trickles in.)
  if (heat) addHeat(sim, trickle(s, heat));
  // Under a camera's eye, heat doesn't cool either.
  if (filmed) s.seen = true;
  // Snipers by day.
  snipe(sim);
}

/**
 * 2.23: a block the player should be at (one missing costs something) and hasn't checked in to,
 * past the walk there, with the player away from its zones: neither let off (a lockdown, out cold)
 * nor in a prison where the routine is relaxed.
 */
function skipping(sim: SimContext, zone: string): boolean {
  const s = sim.state;
  const r = ROUTINE[s.routine];
  if (sim.rules222 || !r.miss || s.attended || s.excused || s.lockdown || sim.world.def.rules?.relaxed) return false;
  return clockAt(s.step).minuteOfDay - r.start >= SKIP_GRACE && !sim.dutyZones.includes(zone);
}

/** Lights Out, past the walk home: out of the cell now is out late. */
export function afterHours(s: SimState): boolean {
  const sinceLightsOut = (clockAt(s.step).minuteOfDay - ROUTINE[ROUTINE.length - 1].start + 1440) % 1440;
  return ROUTINE[s.routine].id === 'lightsOut' && sinceLightsOut * STEPS_PER_MINUTE >= LIGHTS_OUT_GRACE;
}

/**
 * Whether a guard sees the player: on the ground floor, its cone and a clear line; up on a
 * roof, from the open yard (nothing on the ground is in the way); in the vents and the
 * tunnels, never. As far as it sees today (P17: the weather, the inspectors).
 */
function inView(sim: SimContext, g: Guard): boolean {
  const s = sim.state;
  const eye = g.body;
  // (P29: a guard watching a match sees what's off the pitch at half his range.)
  if (s.layer === LAYER.GROUND) return canSee(sim.world, eye, s.player, sightFor(sim, g, s.player.x, s.player.z));
  if (s.layer !== LAYER.ROOF) return false;
  const t = tileOfBody(eye);
  return TILE_INFO[sim.world.ground.kind[t.z * MAP_W + t.x]].outdoor && canSee(sim.world, eye, s.player, sightOf(sim, g), false);
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
    const cx = centerX(tile);
    const cz = centerZ(tile);
    for (const [fx, fz] of FACES) {
      point.x = cx + fx;
      point.z = cz + fz;
      if (watchers.some((g) => canSee(w, g.body, point, sightFor(sim, g, point.x, point.z)))) return true;
    }
    return false;
  };
  let any = false;
  for (const k in s.tiles) {
    const key = Number(k);
    const kind = s.tiles[key];
    const tile = tileOfKey(key);
    if (!damageShows(sim, key) || s.found.includes(key) || !seenAt(tile)) continue;
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

/** Whether a changed tile is damage a guard could see: a hole, a cut, an open grate, a shaft (not the one under the player's desk, unless the desk is pushed aside). */
export function damageShows(sim: SimContext, key: number): boolean {
  const s = sim.state;
  const kind = s.tiles[key];
  const layer = layerOfKey(key);
  if (layer === LAYER.VENTS) return kind === TILE.GRATE_OPEN;
  // (P28: nor a shaft dug through a planted garden bed: out of sight under the plant.)
  return layer === LAYER.GROUND && DAMAGE_SHOWS.has(kind) && !(kind === TILE.SHAFT && ((underMyDesk(sim.world, tileOfKey(key)) && !s.deskAside) || underPlant(sim, tileOfKey(key))));
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
/** The player in a guard's uniform. */
export const inDisguise = (sim: SimContext) => itemOf(sim.state.items.inv[SLOT.OUTFIT]) === GUARD_OUTFIT;
/** Where a guard looks at a tile from: its middle, then its faces. */
const FACES = [
  [0, 0],
  [0, Math.round(UNIT * 0.45)],
  [0, -Math.round(UNIT * 0.45)],
  [Math.round(UNIT * 0.45), 0],
  [-Math.round(UNIT * 0.45), 0],
];
