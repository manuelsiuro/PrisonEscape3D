/**
 * Caught and punished (GDD §5.3, §5.6): the capture, waking up in solitary or the infirmary,
 * peeling potatoes, the morning shakedown, the night bed check and cell searches.
 */
import { retained } from './phone';
import { CRACKDOWN_CELLS, twist } from './twists';
import { washScent } from './k9';
import { itemDef, itemNumber } from '../../content/items';
import { ROUTINE } from '../../content/routine';
import { zoneIndex } from '../../content/zones';
import { findPath, nearestDir } from '../ai/path';
import { placesOf } from '../ai/places';
import { SLOT } from '../command';
import type { SimContext } from '../context';
import { randomInt, rollInt, SALT } from '../rng';
import { WAKE } from '../events';
import { today } from './calendar';
import { INSPECTION_CELLS } from '../../content/days';
import { HIDING_STEPS, KO_STEPS, PEEL_STEPS, POTATO_PRESSES, POTATO_STEPS, SHAKEDOWN_CELLS, SOLITARY_HEAT, SOLITARY_STEPS, STRICT_CELLS } from '../tuning';
import { containersOf } from '../world/containers';
import { LAYER, MAP_H, MAP_W, type World } from '../world/World';
import { clockAt } from './clock';
import { maxHealth } from './combat';
import { assign, backToDuty, type Guard, GUARD, type GuardReport } from './guards';
import { closeBox, itemOf, slot } from './items';
import { dismissAll, endTalk } from './social';
import { stopTraining } from './training';
import { addHeat, repair } from './watch';
import { centerX, centerZ } from '../world/grid';

/** Knocked down by a guard: the lockdown is over, everyone back to work, the player out cold. */
export function caught(sim: SimContext) {
  const s = sim.state;
  const solitary = s.heat >= SOLITARY_HEAT;
  s.lock = -1;
  dismissAll(sim);
  endTalk(sim);
  stopTraining(sim);
  // The score is settled: a key alarm still held back is part of it, and the trail the chase left (P19).
  s.keyAlarm = false;
  washScent(sim, true);
  for (const m of s.inmates) m.angry = 0;
  s.ko = KO_STEPS;
  s.wake = solitary ? WAKE.SOLITARY : WAKE.INFIRMARY;
  s.excused = true;
  s.player.moving = false;
  s.sleeping = false;
  s.spotted = 0;
  s.near = 0;
  closeBox(sim);
  // The guard who made the catch stands over the player until they're carried off.
  const p = s.player;
  const d2 = (g: Guard) => (g.body.x - p.x) ** 2 + (g.body.z - p.z) ** 2;
  const catcher = s.guards.filter((g) => g.mode === GUARD.CHASE).sort((a, b) => d2(a) - d2(b))[0];
  for (const g of s.guards) if (g.mode === GUARD.CHASE || g.mode === GUARD.INVESTIGATE) backToDuty(g);
  if (catcher) {
    catcher.wait = KO_STEPS;
    catcher.body.moving = false;
    if (catcher.body.x !== p.x || catcher.body.z !== p.z) catcher.body.facing = nearestDir(p.x - catcher.body.x, p.z - catcher.body.z);
  }
  sim.events.push({ type: 'caught', solitary });
  if (s.lockdown) {
    s.lockdown = false;
    sim.events.push({ type: 'lockdown', on: false });
  }
}

/**
 * Waking up after being caught (GDD §5.6): carried contraband is taken and the outfit is
 * swapped for an inmate's; in solitary the desk's standard drawers are searched too. The
 * score is settled: heat back to 0.
 */
export function wakeUp(sim: SimContext) {
  const s = sim.state;
  const places = placesOf(sim.world);
  const it = s.items;
  let taken = 0;
  // (P39: cutters, a shovel or the multitool (it digs) among them: caught plotting, for the parole board.)
  let plot = false;
  for (let k = 0; k <= SLOT.WEAPON; k++) {
    if (it.inv[k] && itemDef(itemOf(it.inv[k])).contraband) {
      const kind = itemDef(itemOf(it.inv[k])).tool?.kind;
      if (kind === 'dig' || kind === 'cut' || kind === 'multi') plot = true;
      it.inv[k] = 0;
      taken++;
    }
  }
  if (itemOf(it.inv[SLOT.OUTFIT]) !== INMATE_OUTFIT) {
    if (it.inv[SLOT.OUTFIT] && itemDef(itemOf(it.inv[SLOT.OUTFIT])).contraband) taken++;
    it.inv[SLOT.OUTFIT] = slot(INMATE_OUTFIT);
  }
  it.rev++;
  // Caught: the score is settled. Floored by an inmate or a cave-in: the heat stays.
  if (s.wake !== WAKE.FLOORED) s.heat = 0;
  // Patched up while out cold.
  s.health = maxHealth(s.str);
  s.lock = -1;
  // What the guards found is put right while the player is out cold (GDD §5.6).
  repair(sim);
  const lightsOut = ROUTINE[s.routine].id === 'lightsOut';
  if (s.wake === WAKE.SOLITARY && places.solitary >= 0) {
    taken += search(sim, 1);
    // (P34: the lawyer on a retainer gets the stretch halved.)
    s.solitary = retained(s) ? SOLITARY_STEPS / 2 : SOLITARY_STEPS;
    s.peeled = 0;
    place(sim, places.solitary);
    sim.events.push(plot ? { type: 'solitary', on: true, taken, plot } : { type: 'solitary', on: true, taken });
  } else {
    // The infirmary (at night, straight back to the cell).
    place(sim, lightsOut || places.infirmary < 0 ? places.bedside[1] : places.infirmary);
    sim.events.push(plot ? { type: 'infirmary', taken, plot } : { type: 'infirmary', taken });
  }
  s.wake = WAKE.NONE;
}

/** Out of solitary: into the corridor outside it (at night, back to the cell). */
export function release(sim: SimContext) {
  const s = sim.state;
  const w = sim.world;
  const places = placesOf(w);
  let to = places.bedside[1];
  if (ROUTINE[s.routine].id !== 'lightsOut') {
    const corridor = zoneIndex('corridor');
    const path = findPath(w, places.solitary, (i) => w.ground.zone[i] === corridor, -1, MAP_W * MAP_H, undefined, w.guardBlock);
    if (path?.length) to = path[path.length - 1];
  }
  s.peeled = 0;
  place(sim, to);
  sim.events.push({ type: 'solitary', on: false, taken: 0 });
}

/** A press on the potato in solitary: every few presses, 10 minutes off. */
export function peel(sim: SimContext) {
  const s = sim.state;
  // A stroke takes a moment: presses faster than that don't count.
  if (s.step - s.peelAt < PEEL_STEPS) return;
  s.peelAt = s.step;
  if (++s.peeled < POTATO_PRESSES) {
    sim.events.push({ type: 'peel', done: false });
    return;
  }
  s.peeled = 0;
  s.solitary = Math.max(1, s.solitary - POTATO_STEPS);
  sim.events.push({ type: 'peel', done: true });
}

/**
 * Out of reach through a whole lockdown: the guards call off the hunt, fix what they found,
 * and stay on the lookout (the heat stays: whoever sees the player next gives chase).
 */
export function outOfReach(sim: SimContext) {
  const s = sim.state;
  if (s.lockdown && s.layer !== LAYER.GROUND && !sim.away) {
    if (++s.hiding >= HIDING_STEPS) {
      s.lockdown = false;
      s.hiding = 0;
      for (const g of s.guards) if (g.mode === GUARD.CHASE || g.mode === GUARD.INVESTIGATE) backToDuty(g);
      repair(sim);
      sim.events.push({ type: 'lockdown', on: false }, { type: 'gaveUp' });
    }
  } else s.hiding = 0;
}

/** Puts the player on a ground floor tile (carried there, facing south). */
function place(sim: SimContext, tile: number) {
  sim.state.layer = LAYER.GROUND;
  sim.state.deskAside = false;
  const p = sim.state.player;
  p.x = centerX(tile);
  p.z = centerZ(tile);
  p.moving = false;
  p.facing = 5;
}

/** The guard who does the morning shakedown (-1: none). */
const shakedownGuard = (w: World) => w.def.guards.findIndex((g) => g.duties?.includes('shakedown'));

/**
 * The cells a day's 08:00 shakedown names (GDD §2.1): two (a strict guard's, three), drawn
 * with roll() (P15), so they are known ahead: what inmates whisper about the next one is true.
 */
export function shakedownCells(w: World, salt: number, day: number, inspection = false, crackdown = false): number[] {
  const n = w.def.cells.length;
  const k = shakedownGuard(w);
  if (k < 0 || n < 2 || w.def.rules?.relaxed) return [];
  // An inspection morning (P17): more cells (the first ones the same as any other morning's).
  // (P26: a Crackdown, more again.)
  const count = Math.min(n, (inspection ? INSPECTION_CELLS : w.def.guards[k].trait === 'strict' ? STRICT_CELLS : SHAKEDOWN_CELLS) + (crackdown ? CRACKDOWN_CELLS : 0));
  const cells: number[] = [];
  for (let j = 0; cells.length < count; j++) {
    const c = 1 + rollInt(salt, SALT.SHAKEDOWN, day, j, n);
    if (!cells.includes(c)) cells.push(c);
  }
  return cells;
}

/** 08:00: the cells named for the shakedown guard to search (GDD §2.1). */
export function shakedown(sim: SimContext) {
  const s = sim.state;
  const n = sim.world.def.cells.length;
  const k = shakedownGuard(sim.world);
  if (k < 0 || n < 2) return;
  // The draws the cells once came from, still made (P15): every later draw stays as it was.
  randomInt(s, n);
  randomInt(s, n - 1);
  const cells = shakedownCells(sim.world, s.salt, clockAt(s.step).day, today(sim).event === 'inspection', twist(s, 'crackdown'));
  assign(s.guards[k], GUARD.SHAKEDOWN, cells);
  sim.events.push({ type: 'shakedown', cells: [...cells] });
}

/**
 * The bed check: the night guard looks into every cell, from the east-most on, each time the
 * nearest left (a wing done before the next: Shankton's two wings are a long walk apart).
 */
export function bedCheck(sim: SimContext) {
  const s = sim.state;
  const k = s.guards.findIndex((_, i) => sim.world.def.guards[i].duties?.includes('bedCheck'));
  if (k < 0) return;
  const steps = placesOf(sim.world).doorstep;
  const left = steps.map((_, c) => c).filter((c) => c > 0 && steps[c] >= 0);
  left.sort((a, b) => (steps[b] % MAP_W) - (steps[a] % MAP_W) || steps[a] - steps[b]);
  const cells: number[] = [];
  const far = (a: number, b: number) => Math.abs((steps[a] % MAP_W) - (steps[b] % MAP_W)) + Math.abs(Math.floor(steps[a] / MAP_W) - Math.floor(steps[b] / MAP_W));
  for (let at = left.shift(); at !== undefined; ) {
    cells.push(at);
    let best = -1;
    for (let j = 0; j < left.length; j++) if (best < 0 || far(at, left[j]) < far(at, left[best])) best = j;
    at = best < 0 ? undefined : left.splice(best, 1)[0];
  }
  assign(s.guards[k], GUARD.BED_CHECK, cells);
  sim.events.push({ type: 'bedCheck', result: 'start' });
}

/** A guard looked into a cell or searched one. */
export function report(sim: SimContext, r: GuardReport) {
  const s = sim.state;
  if (r.kind === 'nap') {
    sim.events.push({ type: 'nap', guard: r.guard, on: r.on });
    return;
  }
  if (r.kind === 'search') {
    const taken = search(sim, r.cell);
    sim.events.push({ type: 'searched', cell: r.cell, taken });
    return;
  }
  if (r.cell !== 1 || ROUTINE[s.routine].id !== 'lightsOut') return;
  // In the cell, asleep, or a bed dummy under the blanket: all present (GDD §5.3).
  const there = sim.playerZone === 'playerCell' || s.sleeping || s.solitary > 0 || s.ko > 0;
  const ok = there || dummyInBed(sim);
  // (The dummy did it: P16's ledger counts that.)
  sim.events.push({ type: 'bedCheck', result: ok ? 'pass' : 'fail', ...(ok && !there ? { dummy: true } : {}) });
  if (!ok && !s.lockdown) {
    sim.events.push({ type: 'spotted', reason: 'bedCheck' });
    addHeat(sim, 100);
  }
}

/** Whether the player's bed holds a bed dummy. */
export function dummyInBed(sim: SimContext): boolean {
  const list = containersOf(sim.world);
  const k = list.findIndex((c) => c.mine && c.prop.kind === 'bed');
  return k >= 0 && sim.state.items.containers[k].some((v) => itemOf(v) === BED_DUMMY);
}

/**
 * Searches a cell: contraband in the desk's standard drawers and in the bed goes (the
 * hidden compartment is never found, GDD §6.2). Returns how many items were taken.
 */
function search(sim: SimContext, cell: number): number {
  const it = sim.state.items;
  let taken = 0;
  containersOf(sim.world).forEach((c, i) => {
    if (sim.world.cellOf[c.prop.z * MAP_W + c.prop.x] !== cell || (c.prop.kind !== 'desk' && c.prop.kind !== 'bed')) return;
    const box = it.containers[i];
    for (let k = c.hidden; k < box.length; k++) {
      if (box[k] && itemDef(itemOf(box[k])).contraband) {
        box[k] = 0;
        taken++;
      }
    }
  });
  if (taken) it.rev++;
  return taken;
}

const INMATE_OUTFIT = itemNumber('inmate_outfit');
const BED_DUMMY = itemNumber('bed_dummy');
