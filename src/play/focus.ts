/**
 * The highlight: the box drawn round what the action button acts on (v2.34.2: out of frame.ts, read
 * from the plan in interact.ts, so it marks what a press does; nothing here touches the page).
 */
import type { Sim } from '../sim/Sim';
import { servingCounter } from '../sim/systems/canteen';
import { personOf } from '../sim/systems/combat';
import { coolerProp } from '../sim/systems/cooler';
import type { Station } from '../sim/systems/economy';
import type { Plan } from '../sim/systems/interact';
import { ownerOf, type Target } from '../sim/systems/items';
import { DIR_X, DIR_Z } from '../sim/command';
import { showerOffer } from '../sim/systems/showers';
import type { ClimbTarget } from '../sim/systems/structure';
import { vendProp } from '../sim/systems/vending';
import { UNIT } from '../sim/tuning';
import { containersOf } from '../sim/world/containers';
import { MAP_W, tileOfKey } from '../sim/world/World';

/** A box on the floor, in tiles (refilled in place). */
export type FocusBox = { x0: number; z0: number; x1: number; z1: number };
const focusAt: FocusBox = { x0: 0, z0: 0, x1: 0, z1: 0 };

/** The shower the action button would turn on (2.26), as something to highlight. */
function showerHead(sim: Sim, target: Target): Target | null {
  const head = showerOffer(sim, target);
  if (head < 0) return null;
  const index = containersOf(sim.world).findIndex((c) => c.prop.kind === 'shower' && c.prop.z * MAP_W + c.prop.x === head);
  return index < 0 ? null : { kind: 'container', index };
}

/** 2.33: the menu board, the action button's (no prop): a strip along the wall it hangs on. */
function menuFocus(sim: Sim) {
  const m = sim.world.def.menu!;
  focusAt.x0 = m.x + 0.1;
  focusAt.x1 = m.x + m.w - 0.1;
  focusAt.z0 = m.z + 0.04;
  focusAt.z1 = m.z + 0.42;
  return focusAt;
}

/** The box round a target, a climb or a station. */
function focusOf(sim: Sim, target: Target, climb: ClimbTarget | null = null, station: Station | null = null) {
  if (station && !climb) {
    if (station.prop < 0) {
      focusAt.x0 = (station.tile % MAP_W) + 0.06;
      focusAt.z0 = Math.floor(station.tile / MAP_W) + 0.06;
      focusAt.x1 = focusAt.x0 + 0.88;
      focusAt.z1 = focusAt.z0 + 0.88;
      return focusAt;
    }
    const p = sim.world.props[station.prop];
    focusAt.x0 = p.x;
    focusAt.z0 = p.z;
    focusAt.x1 = p.x + p.w;
    focusAt.z1 = p.z + p.d;
    return focusAt;
  }
  if (climb) {
    focusAt.x0 = (climb.tile % MAP_W) + 0.08;
    focusAt.z0 = Math.floor(climb.tile / MAP_W) + 0.08;
    focusAt.x1 = focusAt.x0 + 0.84;
    focusAt.z1 = focusAt.z0 + 0.84;
    return focusAt;
  }
  if (!target) return null;
  if (target.kind === 'pockets') {
    // Lying where they fell, head back along the way they faced.
    const b = personOf(sim.state, target.who)!.body;
    const cx = b.x / UNIT - (DIR_X[b.facing] / 1024) * 0.62;
    const cz = b.z / UNIT - (DIR_Z[b.facing] / 1024) * 0.62;
    const along = Math.abs(DIR_X[b.facing]) > Math.abs(DIR_Z[b.facing]);
    focusAt.x0 = cx - (along ? 0.82 : 0.5);
    focusAt.x1 = cx + (along ? 0.82 : 0.5);
    focusAt.z0 = cz - (along ? 0.5 : 0.82);
    focusAt.z1 = cz + (along ? 0.5 : 0.82);
    return focusAt;
  }
  if (target.kind === 'person') {
    const b = personOf(sim.state, target.who)!.body;
    focusAt.x0 = b.x / UNIT - 0.45;
    focusAt.z0 = b.z / UNIT - 0.45;
    focusAt.x1 = focusAt.x0 + 0.9;
    focusAt.z1 = focusAt.z0 + 0.9;
    return focusAt;
  }
  if (target.kind === 'fixture') {
    const p = sim.world.props[target.index];
    focusAt.x0 = p.x;
    focusAt.z0 = p.z;
    focusAt.x1 = p.x + p.w;
    focusAt.z1 = p.z + p.d;
    return focusAt;
  }
  if (target.kind === 'ground') {
    const tile = tileOfKey(sim.state.items.ground[target.index][0]);
    focusAt.x0 = (tile % MAP_W) + 0.2;
    focusAt.z0 = Math.floor(tile / MAP_W) + 0.2;
    focusAt.x1 = focusAt.x0 + 0.6;
    focusAt.z1 = focusAt.z0 + 0.6;
    return focusAt;
  }
  const p = containersOf(sim.world)[target.index].prop;
  focusAt.x0 = p.x;
  focusAt.z0 = p.z;
  focusAt.x1 = p.x + p.w;
  focusAt.z1 = p.z + p.d;
  return focusAt;
}

/**
 * What the highlight marks now: the open container or the person talked to, else what a press
 * does (the plan); nothing while seated or training, or for a press on nothing in particular
 * (answering at roll call, getting up, the vehicle's tail).
 */
export function focusNow(sim: Sim, plan: Plan | null): FocusBox | null {
  const st = sim.state;
  const it = st.items;
  if (it.open >= 0) {
    const who = ownerOf(sim.world, it.open);
    return focusOf(sim, who >= 0 ? { kind: 'pockets', index: it.open, who } : { kind: 'container', index: it.open });
  }
  if (st.talk >= 0) return focusOf(sim, { kind: 'person', who: st.talk });
  if (st.train >= 0 || st.seat >= 0 || !plan) return null;
  switch (plan.do) {
    case 'climb':
      return focusOf(sim, null, plan.climb);
    case 'work':
      return focusOf(sim, null, null, plan.station);
    case 'menu':
      return menuFocus(sim);
    // (The counter the player faces, offering a tray: what the press means, whoever stands by.)
    case 'tray': {
      const serving = servingCounter(sim);
      return focusOf(sim, serving >= 0 ? { kind: 'container', index: serving } : plan.target);
    }
    case 'shower':
      return focusOf(sim, showerHead(sim, plan.target) ?? plan.target);
    case 'vend':
      return focusOf(sim, { kind: 'fixture', index: sim.world.props.indexOf(vendProp(sim)!), use: 'vending' });
    case 'cooler':
      return focusOf(sim, { kind: 'fixture', index: sim.world.props.indexOf(coolerProp(sim)!), use: 'cooler' });
    case 'report':
    case 'fileForm':
    case 'showId':
    case 'pickUp':
    case 'bed':
    case 'sleep':
    case 'talk':
    case 'fixture':
    case 'pockets':
    case 'flush':
    case 'search':
      return focusOf(sim, plan.target);
    default:
      return null;
  }
}
