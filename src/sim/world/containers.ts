import { CONTAINER_SLOTS, lootTableFor } from '../../content/loot';
import { MAP_W, type Prop, type World } from './World';

/** A piece of furniture that holds items. Its contents live in the sim state, by index. */
export interface ContainerInfo {
  prop: Prop;
  slots: number;
  /** The first `hidden` slots are hidden compartments (safe from shakedowns, P3). */
  hidden: number;
  /** LOOT table name. */
  table: string;
  /** In the player's cell: nobody restocks it. */
  mine: boolean;
}

const cache = new WeakMap<World, ContainerInfo[]>();

/** The prison's containers, in prop order (their indices are stable for a map). */
export function containersOf(w: World): ContainerInfo[] {
  let list = cache.get(w);
  if (list) return list;
  list = [];
  for (const prop of w.props) {
    const size = CONTAINER_SLOTS[prop.kind];
    if (!size) continue;
    const zone = w.zoneAt(prop.x, prop.z);
    const mine = w.cellOf[prop.z * MAP_W + prop.x] === 1;
    const table = lootTableFor(prop.kind, zone, mine);
    if (table) list.push({ prop, slots: size.slots, hidden: size.hidden, table, mine });
  }
  cache.set(w, list);
  return list;
}

const desks = new WeakMap<World, number>();

/** The player's own desk (a container index; -1 none). */
export function playerDesk(w: World): number {
  let k = desks.get(w);
  if (k === undefined) desks.set(w, (k = containersOf(w).findIndex((c) => c.mine && c.prop.kind === 'desk')));
  return k;
}

/** The player's desk (-1 none) and its first open drawer past the hidden ones (-1 full): where something is put for them. */
export function deskRoom(w: World, containers: readonly (readonly number[])[]): { desk: number; free: number } {
  const desk = playerDesk(w);
  const box = desk >= 0 ? containers[desk] : null;
  return { desk, free: box ? box.indexOf(0, containersOf(w)[desk].hidden) : -1 };
}
