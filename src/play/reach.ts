/**
 * What the buttons would do, worked out once per step, and the presses waiting (v2.34.2: out of
 * buttons.ts, which handles the presses). Nothing here draws or touches the page, so the tests can
 * read what the action button says and highlights against what a press does (buttontest).
 */
import { airOf } from '../sim/systems/getaway';
import { LAYER } from '../sim/world/World';
import type { Sim } from '../sim/Sim';
import { lockCandidates } from '../sim/systems/combat';
import { GUARD } from '../sim/systems/guards';
import { interactPlan, type Plan } from '../sim/systems/interact';
import type { Body } from '../sim/systems/movement';
import { digUpTarget, STRIKES, toolTarget, type ToolTarget } from '../sim/systems/structure';
import { strikeNoise, wouldHear } from '../sim/systems/noise';
import type { ToolView } from '../ui/tool';
import { hiddenIn } from '../sim/systems/kiosk';

/** What the buttons would do, worked out once per simulation step. */
export const targets: {
  step: number;
  busy: boolean;
  panel: boolean;
  rev: number;
  /** What a press of the action button does now (the sim's own plan; null: nothing, or the button's hidden). */
  plan: Plan | null;
  tool: ToolTarget | null;
  up: ToolTarget | null;
  upHeard: boolean;
  canLock: boolean;
  fighting: boolean;
  heard: boolean;
} = {
  plan: null,
  heard: false,
  up: null,
  upHeard: false,
  step: -1,
  busy: false,
  panel: false,
  rev: -1,
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
export const press: {
  toolNow: ToolView | null;
  toolKey: number;
  heldOn: number;
  pressQueued: boolean;
  attackPace: number;
  upQueued: boolean;
  upKey: number;
  onGear: boolean;
  gearHeld: boolean;
} = {
  onGear: false,
  gearHeld: false,
  toolNow: null,
  toolKey: 0,
  heldOn: 0,
  pressQueued: false,
  attackPace: 14,
  upQueued: false,
  upKey: -1,
};

/** P28: how long a first press on Drink stays armed, waiting for the second (real time: it's the player's hand, not the prison's clock). */
const DRINK_CONFIRM_MS = 2500;
/** When the armed Drink lapses (performance.now()), 0: not armed. */
let drinkUntil = 0;

/** The pruno's first press made: Drink armed, waiting for the second. */
export function armDrink() {
  drinkUntil = performance.now() + DRINK_CONFIRM_MS;
}

/** The pruno's first press made and still waiting for the second. */
export const drinkArmed = () => drinkUntil > 0 && performance.now() < drinkUntil;

/** The armed Drink let go (the target changed: another item in hand, a new game). */
export function disarmDrink() {
  drinkUntil = 0;
}

/** A new game: nothing worked out yet, no press waiting. */
export function resetButtons() {
  targets.step = -1;
  press.pressQueued = false;
  press.upQueued = false;
  drinkUntil = 0;
}

/** Who stands on the ground floor besides the player (nobody digs under them). */
const others: Body[] = [];
function bodiesOf(sim: Sim): Body[] {
  others.length = 0;
  for (const m of sim.state.inmates) others.push(m.body);
  for (const g of sim.state.guards) others.push(g.body);
  return others;
}

/**
 * What the buttons would do: the action button's plan (the sim's), the tool button's target, digging
 * up, locking on. Worked out once per simulation step (nothing it depends on changes between steps).
 */
export function updateTargets(sim: Sim, busy: boolean, panel: boolean, held: number) {
  const st = sim.state;
  const it = st.items;
  const p = st.player;
  const memo = targets;
  if (memo.step !== st.step || memo.busy !== busy || memo.panel !== panel || memo.rev !== it.rev) {
    memo.step = st.step;
    memo.busy = busy;
    memo.panel = panel;
    memo.rev = it.rev;
    // The action button: what a press does, as the sim decides it (interact.ts); while busy, only the label
    // shows it, and only in solitary and stowed away (a potato, climbing out; labels.ts's actionWords). (2.44: in a penalty
    // shootout, the action button is the kick: never a talk with the inmate in goal or at the spot.)
    const plan = interactPlan(sim);
    memo.plan = st.pens && st.pens.who >= 0 ? null : plan;
    memo.tool =
      busy || panel
        ? null
        : toolTarget(sim.world, st.layer, p, held, bodiesOf(sim), it.inv, airOf(sim), st.plots, hiddenIn(it.inv[it.hand]), st.gardenBy);
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
