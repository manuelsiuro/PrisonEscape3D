import { ROUTINE } from '../content/routine';
import { itemDef } from '../content/items';
import { SLOT } from '../sim/command';
import { GUARD } from '../sim/systems/guards';
import { itemOf, slot } from '../sim/systems/items';
import { NOISE_LOOK, STEPS_PER_MINUTE, UNIT } from '../sim/tuning';
import { containersOf } from '../sim/world/containers';
import { TILE } from '../sim/world/tiles';
import { at, carries, cellHole, clockTo, count, fill, holds, type Lesson, MORNING, myDesk, n, place, pockets, tile, zone } from './kit';

/** The basics (the tutorial's first chapter): walking, searching, crafting, the routine, heat, a stash, digging, a fight, noise, an escape. Out of lessons.ts (v2.34.2), in LESSONS' order (a lesson without a seed of its own takes its place's). */
export const BASICS: readonly Lesson[] = [
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
      {
        text: 'lesson.routine.yard',
        done: (c) => ROUTINE[c.sim.state.routine].id === 'eveningRollCall' && c.sim.state.attended,
        // Roll call over without the player (checked in, the step would have ticked): the next is a day away.
        fail: (c) => (ROUTINE[c.sim.state.routine].id !== 'eveningRollCall' ? 'lesson.routine.missed' : null),
      },
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
      {
        text: 'lesson.heat.hide',
        touch: 'lesson.heat.hideTouch',
        done: (c) => !itemDef(itemOf(c.sim.state.items.inv[c.sim.state.items.hand]) || n('magazine')).contraband,
      },
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
      // (Any wall of the cell will do: the poster covers a hole in any of them.)
      {
        text: 'lesson.dig.chip',
        touch: 'lesson.dig.chipTouch',
        done: (c) => cellHole(c.sim, TILE.HOLE) || cellHole(c.sim, TILE.HOLE_POSTER),
      },
      { text: 'lesson.dig.cover', touch: 'lesson.dig.coverTouch', done: (c) => cellHole(c.sim, TILE.HOLE_POSTER) },
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
    // 9. Noise (P14): a potato thrown, too quiet to carry to the gym; a firecracker that does,
    // and the guard going to look where it went off.
    id: 'noise',
    icon: 'ear',
    setup: (sim) => {
      clockTo(sim, MORNING);
      place(sim, 37, 23, 5);
      pockets(sim, 'potato', 'firecracker', 'firecracker');
    },
    steps: [
      { text: 'lesson.noise.throw', touch: 'lesson.noise.throwTouch', done: (c) => !carries(c.sim, 'potato') },
      {
        text: 'lesson.noise.bang',
        touch: 'lesson.noise.bangTouch',
        // Bell sent by a bang (a bang keeps him looking longer than a potato would).
        done: (c) => c.sim.state.guards[0].mode === GUARD.INVESTIGATE && c.sim.state.guards[0].timer > NOISE_LOOK,
        // Both gone off out of his earshot: nothing left to try with.
        // (One dropped at the player's feet can still be picked up.)
        fail: (c) =>
          count(c.sim, 'firecracker') === 0 &&
          !c.sim.state.fuses.length &&
          !c.sim.state.items.ground.some(([, v]) => itemOf(v) === n('firecracker'))
            ? 'lesson.noise.missed'
            : null,
      },
      { text: 'lesson.noise.look', done: (c) => c.sim.state.guards[0].mode !== GUARD.INVESTIGATE, speed: 2 },
    ],
  },
  {
    // 10. Getting out: the power off, the electric fence cut, out onto the road.
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
      {
        text: 'lesson.escape.fence',
        touch: 'lesson.escape.fenceTouch',
        done: (c) => c.sim.world.ground.kind.some((k) => k === TILE.FENCE_CUT),
        goal: () => tile(29, 51),
      },
      { text: 'lesson.escape.out', done: (c) => c.sim.state.escaped > 0, goal: () => tile(29, 54) },
    ],
  },
  // ---------------------------------------------------------------- Getting by
];
