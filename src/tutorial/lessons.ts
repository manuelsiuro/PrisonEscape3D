import { itemDef, itemNumber } from '../content/items';
import { ROUTINE, routineAt } from '../content/routine';
import type { Key } from '../i18n';
import { SLOT } from '../sim/command';
import type { Sim } from '../sim/Sim';
import { clockAt } from '../sim/systems/clock';
import { itemOf, slot } from '../sim/systems/items';
import { STEPS_PER_MINUTE, UNIT } from '../sim/tuning';
import { containersOf } from '../sim/world/containers';
import { TILE } from '../sim/world/tiles';
import { MAP_W } from '../sim/world/World';

/**
 * The tutorial (P8+): short lessons on the Training Block, each a scene set up on a fresh game
 * and a few steps, each ticked off when the game shows it done. The same definitions drive the
 * player's lessons and the bots in `tutorialtest`, which prove every lesson can be finished.
 */

/** What a step looks at: the game, and the bits of the screen the sim doesn't know. */
export interface LessonCtx {
  sim: Sim;
  craftOpen: boolean;
}

export interface LessonStep {
  /** The prompt (a touch variant where the controls differ). */
  text: Key;
  touch?: Key;
  /** Done when this holds (checked every frame). */
  done: (c: LessonCtx) => boolean;
  /** Where the floor arrows lead meanwhile (a tile), if anywhere. */
  goal?: (sim: Sim) => number | null;
  /** The game runs faster while this step waits (time to pass, nothing to do). */
  speed?: number;
}

export interface Lesson {
  id: string;
  icon: string;
  /** Sets the scene on a fresh game (before its first step). */
  setup: (sim: Sim) => void;
  steps: LessonStep[];
}

const tile = (x: number, z: number) => z * MAP_W + x;
const n = (id: string) => itemNumber(id);
/** The minute of day 1 as a step (the game starts at 08:00). */
const at = (hour: number, minute = 0) => ((hour - 8) * 60 + minute) * STEPS_PER_MINUTE;

/** Sets the clock (a step of day 1) and the block running then, already checked in. */
function clockTo(sim: Sim, step: number) {
  const s = sim.state;
  s.step = step;
  s.routine = routineAt(clockAt(step).minuteOfDay);
  s.attended = true;
}
/** Puts the player on a tile, facing a way (1 east, 5 south, 9 west, 13 north). */
function place(sim: Sim, x: number, z: number, facing = 5) {
  const p = sim.state.player;
  p.x = x * UNIT + UNIT / 2;
  p.z = z * UNIT + UNIT / 2;
  p.facing = facing;
}
/** The pockets, in order (the rest emptied). */
function pockets(sim: Sim, ...ids: string[]) {
  const inv = sim.state.items.inv;
  for (let k = 0; k < 6; k++) inv[k] = ids[k] ? slot(n(ids[k])) : 0;
}
/** The player's desk (container index). */
export function myDesk(sim: Sim): number {
  return containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'desk');
}
/** Empties a container, then puts items in from its first slot (hidden ones first). */
function fill(sim: Sim, box: number, ...ids: string[]) {
  const c = sim.state.items.containers[box];
  c.fill(0);
  ids.forEach((id, k) => (c[k] = id ? slot(n(id)) : 0));
}
const holds = (sim: Sim, id: string) => itemOf(sim.state.items.inv[sim.state.items.hand]) === n(id);
const carries = (sim: Sim, id: string) => sim.state.items.inv.slice(0, 6).some((v) => itemOf(v) === n(id));
const zone = (z: string) => (c: LessonCtx) => c.sim.playerZone === z;

/** A quiet morning of free time: no block to keep, nothing due. */
const MORNING = at(10, 30);

export const LESSONS: readonly Lesson[] = [
  {
    // 1. Walking: out of the cell, along the corridor to the store room.
    id: 'walk',
    icon: 'walk',
    setup: (sim) => {
      clockTo(sim, MORNING);
      place(sim, 20, 18);
    },
    steps: [
      { text: 'lesson.walk.out', touch: 'lesson.walk.outTouch', done: zone('corridor'), goal: () => tile(20, 23) },
      { text: 'lesson.walk.arrows', touch: 'lesson.walk.arrowsTouch', done: zone('woodshop'), goal: () => tile(33, 19) },
    ],
  },
  {
    // 2. Searching: the desk, an item into the pockets, held in hand.
    id: 'search',
    icon: 'hand',
    setup: (sim) => {
      clockTo(sim, MORNING);
      place(sim, 21, 18, 1);
      pockets(sim);
      // The hand on the last pocket: the magazine lands in the first, to be picked up in hand.
      sim.state.items.hand = 5;
      fill(sim, myDesk(sim), '', '', '', '', '', '', 'magazine');
    },
    steps: [
      { text: 'lesson.search.desk', touch: 'lesson.search.deskTouch', done: (c) => c.sim.state.items.open === myDesk(c.sim) },
      { text: 'lesson.search.take', touch: 'lesson.search.takeTouch', done: (c) => carries(c.sim, 'magazine') },
      { text: 'lesson.search.hold', touch: 'lesson.search.holdTouch', done: (c) => c.sim.state.items.open < 0 && holds(c.sim, 'magazine') },
    ],
  },
  {
    // 3. Crafting: a magazine and duct tape make a poster.
    id: 'craft',
    icon: 'hammer',
    setup: (sim) => {
      clockTo(sim, MORNING);
      place(sim, 31, 19, 13);
      pockets(sim, 'magazine', 'duct_tape');
    },
    steps: [
      { text: 'lesson.craft.open', touch: 'lesson.craft.openTouch', done: (c) => c.craftOpen || carries(c.sim, 'poster') },
      { text: 'lesson.craft.make', done: (c) => carries(c.sim, 'poster') },
    ],
  },
  {
    // 4. The routine: evening roll call, then home for Lights Out, and to bed.
    id: 'routine',
    icon: 'clock',
    setup: (sim) => {
      clockTo(sim, at(21, 58));
      place(sim, 24, 23);
    },
    steps: [
      { text: 'lesson.routine.bell', done: (c) => ROUTINE[c.sim.state.routine].id === 'eveningRollCall', speed: 4 },
      { text: 'lesson.routine.yard', done: (c) => ROUTINE[c.sim.state.routine].id === 'eveningRollCall' && c.sim.state.attended },
      { text: 'lesson.routine.wait', done: (c) => ROUTINE[c.sim.state.routine].id === 'lightsOut', speed: 12 },
      { text: 'lesson.routine.home', done: (c) => c.sim.playerZone === 'playerCell', goal: () => tile(20, 19) },
      { text: 'lesson.routine.sleep', touch: 'lesson.routine.sleepTouch', done: (c) => c.sim.state.sleeping },
    ],
  },
  {
    // 5. Heat: contraband in a guard's sight, then out of it.
    id: 'heat',
    icon: 'flame',
    setup: (sim) => {
      clockTo(sim, MORNING);
      place(sim, 37, 26);
      pockets(sim, 'light_cutters');
      // Empty-handed to start: holding the cutters is the player's own move.
      sim.state.items.hand = 1;
    },
    steps: [
      { text: 'lesson.heat.show', touch: 'lesson.heat.showTouch', done: (c) => c.sim.state.heat >= 20 },
      { text: 'lesson.heat.hide', touch: 'lesson.heat.hideTouch', done: (c) => !itemDef(itemOf(c.sim.state.items.inv[c.sim.state.items.hand]) || n('magazine')).contraband },
    ],
  },
  {
    // 6. Hiding: contraband into the desk's hidden compartment.
    id: 'stash',
    icon: 'lock',
    setup: (sim) => {
      clockTo(sim, MORNING);
      place(sim, 21, 18, 1);
      pockets(sim, 'light_cutters');
      fill(sim, myDesk(sim));
    },
    steps: [
      { text: 'lesson.stash.desk', touch: 'lesson.stash.deskTouch', done: (c) => c.sim.state.items.open === myDesk(c.sim) },
      {
        text: 'lesson.stash.hide',
        touch: 'lesson.stash.hideTouch',
        done: (c) => {
          const box = containersOf(c.sim.world)[myDesk(c.sim)];
          return c.sim.state.items.containers[myDesk(c.sim)].slice(0, box.hidden).some((v) => itemOf(v) === n('light_cutters'));
        },
      },
    ],
  },
  {
    // 7. Tools: chip through the cell's back wall, then cover the hole with a poster.
    id: 'dig',
    icon: 'pick',
    setup: (sim) => {
      clockTo(sim, MORNING);
      place(sim, 20, 17, 13);
      pockets(sim, 'light_pickaxe', 'poster');
      sim.state.energy = 100;
    },
    steps: [
      { text: 'lesson.dig.chip', touch: 'lesson.dig.chipTouch', done: (c) => c.sim.world.ground.kind[tile(20, 16)] !== TILE.BRICK },
      { text: 'lesson.dig.cover', touch: 'lesson.dig.coverTouch', done: (c) => c.sim.world.ground.kind[tile(20, 16)] === TILE.HOLE_POSTER },
    ],
  },
  {
    // 8. Fighting: lock on to the sparring partner and knock him out.
    id: 'fight',
    icon: 'fist',
    setup: (sim) => {
      clockTo(sim, MORNING);
      place(sim, 24, 31, 1);
      pockets(sim);
      sim.state.items.inv[SLOT.WEAPON] = slot(n('nunchucks'));
      const m = sim.state.inmates[0];
      m.body.x = 26 * UNIT + UNIT / 2;
      m.body.z = 31 * UNIT + UNIT / 2;
      m.goal = -1;
      // He waits for the player where he stands (his block already planned, no wandering off).
      m.plan = sim.state.routine;
      m.wait = 5 * 60 * STEPS_PER_MINUTE;
      m.body.facing = 9;
    },
    steps: [
      { text: 'lesson.fight.lock', touch: 'lesson.fight.lockTouch', done: (c) => c.sim.state.lock === 0 || c.sim.state.inmates[0].ko > 0 },
      { text: 'lesson.fight.hit', touch: 'lesson.fight.hitTouch', done: (c) => c.sim.state.inmates[0].ko > 0 },
    ],
  },
  {
    // 9. Getting out: the power off, the electric fence cut, out onto the road.
    id: 'escape',
    icon: 'route',
    setup: (sim) => {
      clockTo(sim, MORNING);
      place(sim, 42, 22, 13);
      pockets(sim, 'plastic_key_purple', 'light_cutters');
      // The cutters in hand from the start (the key opens its door from the pockets): at the
      // fence, the Cut button is there as soon as the player faces it.
      sim.state.items.hand = 1;
      sim.state.energy = 100;
    },
    steps: [
      { text: 'lesson.escape.room', done: zone('generator'), goal: () => tile(43, 19) },
      { text: 'lesson.escape.power', touch: 'lesson.escape.powerTouch', done: (c) => !c.sim.power },
      { text: 'lesson.escape.fence', touch: 'lesson.escape.fenceTouch', done: (c) => c.sim.world.ground.kind.some((k) => k === TILE.FENCE_CUT), goal: () => tile(29, 51) },
      { text: 'lesson.escape.out', done: (c) => c.sim.state.escaped > 0, goal: () => tile(29, 54) },
    ],
  },
];
