import { containersOf } from '../sim/world/containers';
import { LAYER } from '../sim/world/World';
import type { Sim } from '../sim/Sim';
import { lockCandidates } from '../sim/systems/combat';
import type { Station } from '../sim/systems/economy';
import { GUARD } from '../sim/systems/guards';
import { interactTarget, type Target } from '../sim/systems/items';
import type { Body } from '../sim/systems/movement';
import { climbTarget, facesProp, preferClimb, toolTarget, type ClimbTarget, type ToolTarget } from '../sim/systems/structure';
import type { ToolView } from '../ui/tool';
import { tools } from './context';
import { play } from './game';

/** What the buttons would do, worked out once per simulation step. */
export const targets: { step: number; busy: boolean; panel: boolean; rev: number; climb: ClimbTarget | null; target: Target; tool: ToolTarget | null; canLock: boolean; fighting: boolean; station: Station | null } = {
  station: null,
  step: -1,
  busy: false,
  panel: false,
  rev: -1,
  climb: null,
  target: null,
  tool: null,
  canLock: false,
  fighting: false,
};

/** Who can be locked on to (Cast ids), refilled. */
export const lockList: number[] = [];

/**
 * The tool button: what it does right now (worked out each frame) and whether holding it
 * repeats; the key of what the held button is working on (when it changes, the earth gave way
 * or a cave-in, the hold ends) and of what it was pressed on; a fresh press waiting for the next
 * step; the steps between the player's blows now (the press waits for it, as the sim does).
 */
export const press: { toolNow: ToolView | null; toolKey: number; heldOn: number; pressQueued: boolean; attackPace: number } = {
  toolNow: null,
  toolKey: 0,
  heldOn: 0,
  pressQueued: false,
  attackPace: 14,
};

/** A new game: nothing worked out yet, no press waiting. */
export function resetButtons() {
  targets.step = -1;
  press.pressQueued = false;
}

/**
 * The tool button or Space pressed: strikes repeat while it's held (sent with each step, see
 * frame()); eating happens once. With no tool target, a plain USE still lets the sim say why
 * nothing happens (a sock against a wall).
 */
export function usePress() {
  const game = play.game;
  if (!game || game.paused) return;
  game.pilot.stop();
  // A fresh press (arg 1): only a fresh press digs up, eats or puts things in place. It waits
  // for the arm to come back from the last strike (a quick tap is never lost).
  press.pressQueued = true;
  press.heldOn = press.toolKey;
  if (!press.toolNow?.repeat) tools.release();
}

/** Who stands on the ground floor besides the player (nobody digs under them). */
const others: Body[] = [];
function bodiesOf(sim: Sim): Body[] {
  others.length = 0;
  for (const m of sim.state.inmates) others.push(m.body);
  for (const g of sim.state.guards) others.push(g.body);
  return others;
}

/** Everyone who can be looted, by Cast id (inmates, then guards); one array, refilled. */
const lootable: Array<{ body: Body; ko: number; angry?: number }> = [];
function peopleOf(sim: Sim) {
  lootable.length = 0;
  for (const m of sim.state.inmates) lootable.push(m);
  for (const g of sim.state.guards) lootable.push(g);
  return lootable;
}

/**
 * The action button: the structure first (climbing, covers coming off), as the sim decides it.
 * Worked out once per simulation step (nothing it depends on changes between steps).
 */
export function updateTargets(sim: Sim, ladderFoot: number, busy: boolean, panel: boolean, held: number) {
  const st = sim.state;
  const it = st.items;
  const p = st.player;
  const memo = targets;
  if (memo.step !== st.step || memo.busy !== busy || memo.panel !== panel || memo.rev !== it.rev) {
    memo.step = st.step;
    memo.busy = busy;
    memo.panel = panel;
    memo.rev = it.rev;
    const reach = busy ? null : interactTarget(sim.world, it, p, sim.bedtime, st.layer, peopleOf(sim), st.inmates.length);
    memo.station = busy || st.layer !== LAYER.GROUND ? null : sim.station();
    const faced = reach?.kind === 'container' || reach?.kind === 'sleep' ? facesProp(p, containersOf(sim.world)[reach.index].prop) : false;
    memo.climb = busy ? null : preferClimb(climbTarget(sim.world, st.layer, p, ladderFoot, bodiesOf(sim)), faced);
    memo.target = memo.climb ? null : reach;
    memo.tool = busy || panel ? null : toolTarget(sim.world, st.layer, p, held, bodiesOf(sim), it.inv);
    memo.canLock = !busy && st.layer === LAYER.GROUND && lockCandidates(sim.world, st, p, lockList).length > 0;
    let fighting = false;
    for (const m of st.inmates) if (m.angry > 0) fighting = true;
    for (const x of st.guards) if (x.mode === GUARD.CHASE) fighting = true;
    memo.fighting = fighting;
  }
}
