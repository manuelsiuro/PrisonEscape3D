/**
 * 2.23: going through the furniture in another inmate's cell (PLAN §2). A guard who sees it
 * minds (watch.ts asks here what it costs), and so does the cell's owner: they think less of
 * the player, and with a grudge left they fight.
 */
import { lineOfSight } from '../ai/sight';
import type { SimContext } from '../context';
import { ANGRY_STEPS, OPINION_LOW, SNOOP_EVERY, SNOOP_GAP, SNOOP_HEAT, SNOOP_OPINION, SNOOP_SIGHT, UNIT } from '../tuning';
import { containersOf } from '../world/containers';
import { MAP_W } from '../world/World';
import { DOING } from './inmates';
import { ownerOf } from './items';
import { changeOpinion, endTalk } from './social';

/** The search's fields in the state (`snoop`). */
const BOX = 0;
const SEEN = 1;
const OWNER = 2;

/** The cell (World cellOf: 2 on, another inmate's) of the furniture the player has open; 0 for none of theirs. */
function snoopedCell(sim: SimContext): number {
  const s = sim.state;
  const w = sim.world;
  const open = s.items.open;
  if (open < 0 || ownerOf(w, open) >= 0) return 0;
  const c = containersOf(w)[open];
  const cell = c ? w.cellOf[c.prop.z * MAP_W + c.prop.x] : 0;
  return cell > 1 ? cell : 0;
}

/**
 * The search this step (each step a guard could see the player): kept in the state, its owner
 * seeing it, and the heat for a guard's sight of it (`seen`: one not looking the other way) — the
 * sight's jump the first time (again once nobody has seen it for a while), then a trickle; -1
 * when nobody sees a search.
 */
export function snooping(sim: SimContext, seen: boolean): number {
  const s = sim.state;
  if (sim.rules222) return -1;
  const cell = snoopedCell(sim);
  if (!cell) {
    if (s.snoop.length) s.snoop = [];
    return -1;
  }
  if (s.snoop[BOX] !== s.items.open) s.snoop = [s.items.open, 0, 0];
  if (!s.snoop[OWNER]) ownerSees(sim, cell);
  if (!seen) return -1;
  const fresh = !s.snoop[SEEN] || s.step - s.snoop[SEEN] > SNOOP_GAP;
  s.snoop[SEEN] = s.step;
  return fresh ? SNOOP_HEAT : s.step % SNOOP_EVERY === 0 ? 1 : 0;
}

/** The cell's owner, up and about close by with a clear line to the player: once a search, they think less of them; a grudge left, they fight. */
function ownerSees(sim: SimContext, cell: number) {
  const s = sim.state;
  const who = s.inmates.findIndex((m) => m.cell === cell);
  const m = s.inmates[who];
  if (!m || m.ko > 0 || m.angry > 0 || m.doing === DOING.SLEEP || s.followers.includes(who)) return;
  const p = s.player;
  if (Math.max(Math.abs(m.body.x - p.x), Math.abs(m.body.z - p.z)) > SNOOP_SIGHT * UNIT || !lineOfSight(sim.world, m.body.x, m.body.z, p.x, p.z)) return;
  s.snoop[OWNER] = 1;
  changeOpinion(sim, who, -SNOOP_OPINION);
  const fights = m.opinion <= OPINION_LOW && !s.lockdown;
  sim.events.push({ type: 'snooped', who, fights });
  if (!fights) return;
  m.angry = ANGRY_STEPS;
  m.doing = DOING.NOTHING;
  m.wait = 0;
  if (s.talk === who) endTalk(sim);
}
