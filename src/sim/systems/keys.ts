/**
 * Guards' keys and kit (GDD §10.2): the keys the player carries and wears down, a guard who
 * finds his key gone (a spare, and the alarm when it can be raised), and the kit drawn anew at 08:00.
 */
import { itemDef } from '../../content/items';
import { tileAt } from '../world/grid';
import type { SimContext } from '../context';
import { SPOT } from '../events';
import { TILE } from '../world/tiles';
import { LAYER, MAP_W } from '../world/World';
import { type Guard } from './guards';
import { DOING } from './inmates';
import { guardKit, HOTBAR, itemOf, pocketOf, slot, usesOf } from './items';
import { type Body, tileOfBody } from './movement';
import { addHeat } from './watch';

/** Bit k: the player carries a key (real or plastic) for door color k (keys work from the hotbar). */
export function keysCarried(sim: SimContext): number {
  const it = sim.state.items;
  let mask = 0;
  for (let k = 0; k < HOTBAR; k++) {
    const v = it.inv[k];
    const d = v ? itemDef(itemOf(v)) : null;
    if (d?.cat === 'key' && d.key) mask |= 1 << d.key;
  }
  return mask;
}

/**
 * A plastic key wears a little at each door it opens (GDD §7.3: 15 uses); a real key never
 * does. Counted once a door, as the player steps out of it (the door stays open to them
 * while they're in it, so the last use still gets them through). A two-wide door is one door.
 */
export function wearKeys(sim: SimContext) {
  const s = sim.state;
  const w = sim.world;
  const t = tileOfBody(s.player);
  const i = t.z * MAP_W + t.x;
  const inDoor = s.layer === LAYER.GROUND && w.ground.kind[i] === TILE.DOOR && w.doorShut[i] === 1;
  const was = s.doorAt;
  if (inDoor) {
    s.doorAt = i;
    return;
  }
  if (was < 0) return;
  s.doorAt = -1;
  wearKey(sim, w.ground.key[was]);
}

/** One use off a plastic key of a color (none if the player holds the real one). */
function wearKey(sim: SimContext, color: number) {
  const it = sim.state.items;
  let plastic = -1;
  for (let k = 0; k < HOTBAR; k++) {
    const v = it.inv[k];
    const d = v ? itemDef(itemOf(v)) : null;
    if (d?.cat !== 'key' || d.key !== color) continue;
    if (!d.uses) return;
    if (plastic < 0) plastic = k;
  }
  if (plastic < 0) return;
  const item = itemOf(it.inv[plastic]);
  const left = usesOf(it.inv[plastic]) - 1;
  it.inv[plastic] = left > 0 ? slot(item, left) : 0;
  it.rev++;
  if (left <= 0) sim.events.push({ type: 'broke', item });
}

/** The guards asleep (in bed, or dozing at a nap stop) and not out cold, a bit each (P20: those who wake without their key). */
export function sleepingGuards(s: { guards: readonly Guard[] }): number {
  let mask = 0;
  s.guards.forEach((g, k) => {
    if (g.ko <= 0 && (g.doing === DOING.SLEEP || g.doze > 0)) mask |= 1 << k;
  });
  return mask;
}

/**
 * Guards asleep as the step began (`was`) and awake now (P20): one whose key is gone (a rat
 * took it from his pockets) radios it in, as one coming round does: a spare key, and the alarm.
 */
export function wokeKeyless(sim: SimContext, was: number) {
  if (!was || sim.noRats) return;
  const s = sim.state;
  const w = sim.world;
  s.guards.forEach((g, k) => {
    if (!(was & (1 << k)) || g.ko > 0 || g.doing === DOING.SLEEP || g.doze > 0) return;
    const pockets = s.items.containers[pocketOf(w, s.inmates.length + k)];
    const key = guardKit(w, k)[0];
    if (pockets.some((v) => itemOf(v) === key)) return;
    // (Pockets stuffed full: the last thing that isn't his kit goes on the floor for the spare, so he misses his key once, not every morning.)
    const free = roomFor(sim, k, pockets, g.body);
    if (free >= 0) pockets[free] = slot(key);
    s.items.rev++;
    s.keyAlarm = true;
    sim.events.push({ type: 'keyless', guard: k });
  });
  raiseKeyAlarm(sim);
}

/** A free slot in a guard's pockets for a spare key: an empty one, else the last that isn't his kit, its item dropped at his feet (-1: all kit). */
export function roomFor(sim: SimContext, k: number, pockets: number[], b: Body): number {
  const free = pockets.indexOf(0);
  if (free >= 0) return free;
  const kit = guardKit(sim.world, k);
  for (let j = pockets.length - 1; j >= 0; j--)
    if (!kit.includes(itemOf(pockets[j]))) {
      sim.state.items.ground.push([tileAt(b.x, b.z), pockets[j]]);
      pockets[j] = 0;
      return j;
    }
  return -1;
}

/**
 * A missing key raises the alarm (GDD §10.2) as soon as it can: not during a lockdown
 * (already on), nor while the player is out cold or in solitary (it waits for them).
 */
export function raiseKeyAlarm(sim: SimContext) {
  const s = sim.state;
  if (!s.keyAlarm || s.lockdown || sim.away) return;
  s.keyAlarm = false;
  sim.events.push({ type: 'spotted', reason: 'keyMissing' });
  s.spotted = SPOT.indexOf('keyMissing');
  addHeat(sim, 100);
}

/** 08:00: guards draw a new baton or uniform from the quarters if theirs were taken (never more than one each). */
export function reissueKit(sim: SimContext) {
  const s = sim.state;
  const w = sim.world;
  s.guards.forEach((_, k) => {
    const pockets = s.items.containers[pocketOf(w, s.inmates.length + k)];
    for (const n of guardKit(w, k).slice(1)) {
      if (pockets.some((v) => itemOf(v) === n)) continue;
      const free = pockets.indexOf(0);
      if (free >= 0) pockets[free] = slot(n);
    }
  });
}
