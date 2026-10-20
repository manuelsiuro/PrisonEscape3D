import { airOf } from '../sim/systems/getaway';
import { containersOf } from '../sim/world/containers';
import { LAYER } from '../sim/world/World';
import type { Sim } from '../sim/Sim';
import { lockCandidates } from '../sim/systems/combat';
import type { Station } from '../sim/systems/economy';
import { GUARD } from '../sim/systems/guards';
import { interactTarget, type Target } from '../sim/systems/items';
import type { Body } from '../sim/systems/movement';
import { climbTarget, digUpTarget, facesProp, preferClimb, STRIKES, toolTarget, type ClimbTarget, type ToolTarget } from '../sim/systems/structure';
import { strikeNoise, wouldHear } from '../sim/systems/noise';
import { canChat } from '../sim/systems/ways';
import { TOUCH } from '../ui/dom';
import { armThrow, throwAhead, throwAt } from './aim';
import type { ToolView } from '../ui/tool';
import { itemsUI, tools } from './context';
import { t } from '../i18n';
import { play } from './game';
import { togglePhone } from './smuggle';

/** What the buttons would do, worked out once per simulation step. */
export const targets: { step: number; busy: boolean; panel: boolean; rev: number; climb: ClimbTarget | null; target: Target; tool: ToolTarget | null; up: ToolTarget | null; upHeard: boolean; canLock: boolean; fighting: boolean; station: Station | null; heard: boolean } = {
  station: null,
  heard: false,
  up: null,
  upHeard: false,
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
export const press: { toolNow: ToolView | null; toolKey: number; heldOn: number; pressQueued: boolean; attackPace: number; upQueued: boolean; upKey: number } = {
  toolNow: null,
  toolKey: 0,
  heldOn: 0,
  pressQueued: false,
  attackPace: 14,
  upQueued: false,
  upKey: -1,
};

/** A new game: nothing worked out yet, no press waiting. */
export function resetButtons() {
  targets.step = -1;
  press.pressQueued = false;
  press.upQueued = false;
}

/**
 * Dig up pressed (U or its button): a strike up through the floor overhead, waiting for the
 * arm to come back from the last one; held, it strikes on (see stepSim). Underground with
 * nothing overhead to dig through, it says so.
 */
export function upPress() {
  const game = play.game;
  if (!game || game.paused) return;
  if (!targets.up) {
    tools.releaseUp();
    if (game.rec.sim.state.layer === LAYER.UNDER) itemsUI.toast(t('toast.noDigUp'));
    return;
  }
  game.pilot.stop();
  press.upQueued = true;
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
  // The burner phone's button opens its panel (P21).
  if (press.toolNow?.call) {
    tools.release();
    togglePhone(!TOUCH);
    return;
  }
  // A firecracker's button throws it (P14): aimed on touch, straight ahead on a keyboard.
  if (press.toolNow?.toss) {
    tools.release();
    // (P19: to a dog, straight there.)
    // (Greyed: the dog has had its jerky today; said, not thrown.)
    if ((press.toolNow.tossTo ?? -1) >= 0 && !press.toolNow.fits) itemsUI.toast(t('toast.dogFull', { dog: press.toolNow.what }));
    else if ((press.toolNow.tossTo ?? -1) >= 0) throwAt(press.toolNow.tossTo!);
    else if (TOUCH) armThrow();
    else throwAhead();
    return;
  }
  // A fresh press (arg 1): only a fresh press digs up, eats or puts things in place. It waits
  // for the arm to come back from the last strike (a quick tap is never lost).
  press.pressQueued = true;
  press.heldOn = press.toolKey;
  if (!press.toolNow?.repeat) tools.release();
}

/** Which guards would talk now (P15), for the action button: the sim's own rule. */
let chatSim: Sim | null = null;
const chatFn = (k: number) => !!chatSim && canChat(chatSim, k);
function chatty(sim: Sim) {
  chatSim = sim;
  return chatFn;
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
    const reach = busy ? null : interactTarget(sim.world, it, p, sim.bedtime, st.layer, peopleOf(sim), st.inmates.length, chatty(sim));
    memo.station = busy || st.layer !== LAYER.GROUND ? null : sim.station();
    const faced = reach?.kind === 'container' || reach?.kind === 'sleep' ? facesProp(p, containersOf(sim.world)[reach.index].prop) : false;
    memo.climb = busy ? null : preferClimb(climbTarget(sim.world, st.layer, p, ladderFoot, bodiesOf(sim)), faced);
    memo.target = memo.climb ? null : reach;
    memo.tool = busy || panel ? null : toolTarget(sim.world, st.layer, p, held, bodiesOf(sim), it.inv, airOf(sim), st.plots);
    // The ear on the tool button (P14): a guard awake would hear this strike (the sim's own rule).
    const tool = memo.tool;
    memo.heard = !!tool && STRIKES.has(tool.action) && tool.fits && tool.hp > 0 && wouldHear(sim, strikeNoise(st.layer, tool, held));
    // Dig up, in a tunnel: the floor overhead, whichever way the player faces.
    const up = busy || panel ? null : digUpTarget(sim.world, st.layer, p, held, bodiesOf(sim));
    memo.up = up;
    memo.upHeard = !!up && up.fits && wouldHear(sim, strikeNoise(st.layer, up, held));
    memo.canLock = !busy && st.layer === LAYER.GROUND && lockCandidates(sim.world, st, p, lockList).length > 0;
    let fighting = false;
    for (const m of st.inmates) if (m.angry > 0) fighting = true;
    for (const x of st.guards) if (x.mode === GUARD.CHASE) fighting = true;
    memo.fighting = fighting;
  }
}
