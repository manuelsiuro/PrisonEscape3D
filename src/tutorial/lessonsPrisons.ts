import { DAY_EVENTS, WEATHERS } from '../content/days';
import { IRONGATE } from '../content/prisons/irongate';
import { SAN_PANCHO } from '../content/prisons/san-pancho';
import { SHANKTON } from '../content/prisons/shankton';
import { SIX_HUNTER } from '../content/prisons/six-hunter';
import { STALAG_FLUCHT } from '../content/prisons/stalag-flucht';
import { placesOf } from '../sim/ai/places';
import { SLOT } from '../sim/command';
import { itemOf, slot } from '../sim/systems/items';
import { KENNEL_TRUST_CAP, POWER_OFF_STEPS, TRUST_IGNORE, UNIT } from '../sim/tuning';
import { containersOf } from '../sim/world/containers';
import { tileAt } from '../sim/world/grid';
import { TILE } from '../sim/world/tiles';
import { LAYER } from '../sim/world/World';
import {
  apart,
  at,
  carries,
  centre,
  clockTo,
  DAY_TWO,
  EVENING,
  eveningOver,
  fill,
  type Lesson,
  n,
  near,
  nearestDog,
  nearestZoneTile,
  onFloor,
  place,
  pockets,
  tile,
} from './kit';
import type { Sim } from '../sim/Sim';
import type { Key } from '../i18n';
import type { LessonCtx } from './kit';

/** A dummy asleep in the player's bed for the night's checks (the night lessons out of the cell). */
function dummyInBed(sim: Sim) {
  fill(
    sim,
    containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'bed'),
    'bed_dummy',
  );
}
/** Worn: a guard's uniform (the night lessons' disguise). */
const uniform = (sim: Sim) => (sim.state.items.inv[SLOT.OUTFIT] = slot(n('guard_outfit')));
/** Cups of molten chocolate in the pockets or lying about (a miss lands on the floor). */
const cupsLeft = (sim: Sim) =>
  sim.state.items.inv.slice(0, 6).filter((v) => itemOf(v) === n('molten_chocolate')).length +
  sim.state.items.ground.filter(([, v]) => itemOf(v) === n('molten_chocolate')).length;
/** Shankton's lesson: the sheet rope used up (down too soon, off the wrong roof) or gone. */
const ROPE_GONE = (c: LessonCtx): Key | null =>
  !c.sim.state.escaped && !carries(c.sim, 'sheet_rope') && !onFloor(c.sim, 'sheet_rope') ? 'lesson.shell.noRope' : null;
/** The dock's fence cut anywhere along the pier's three rows (Irongate's raft). */
const dockCut = (sim: Sim) => [27, 28, 29].some((z) => sim.world.ground.kind[tile(60, z)] === TILE.FENCE_CUT);
/** Irongate's two riot guards in the helipad court. */
const helipadGuards = (sim: Sim) => sim.prison.guards.flatMap((g, k) => (g.helipad ? [k] : []));

/**
 * The prisons (the fifth chapter, 2.38): what each prison past the first has of its own, played there. The Six Hunter's
 * hounds (moved here from Prison life), Stalag Flucht's cold, Shankton's concrete and gatehouse, San Pancho's mines and
 * supply road, Irongate's raft and helicopter. Each lesson has a seed of its own.
 */
export const PRISONS_LESSONS: readonly Lesson[] = [
  {
    // The Six Hunter's hounds (2.37): past the troughs' 40%, a trout thrown for trust; a drag line to pull the Hunters off.
    // (No tar soap to try: a trail is laid only out of bounds, never in a morning's free time. The last card tells it.)
    id: 'hounds',
    icon: 'bone',
    prison: SIX_HUNTER,
    seed: 157,
    setup: (sim) => {
      // (The evening's free time: four minutes, time enough to read and do it.)
      clockTo(sim, DAY_TWO + EVENING);
      // (In the yard, where the Hunters' rounds cross most.)
      const [x, z] = near(sim, 23, 26);
      place(sim, x, z, 5);
      pockets(sim, 'trout', 'drag_line');
      sim.state.items.hand = 0;
      // (A kennel hand's trust: the troughs take them no further.)
      for (const d of sim.state.dogs) d.trust = KENNEL_TRUST_CAP;
    },
    steps: [
      {
        text: 'lesson.hounds.trout',
        touch: 'lesson.hounds.troutTouch',
        done: (c) => c.sim.state.dogs.some((d) => d.trust >= TRUST_IGNORE),
        goal: (sim) => {
          const d = nearestDog(sim);
          return d ? tileAt(d.body.x, d.body.z) : null;
        },
        // (A throw that misses leaves the trout where it fell, to pick up and throw again.)
        fail: (c) =>
          eveningOver('lesson.hounds.late')(c) ??
          (!carries(c.sim, 'trout') && !onFloor(c.sim, 'trout') && c.sim.state.dogs.every((d) => d.trust < TRUST_IGNORE)
            ? 'lesson.hounds.eaten'
            : null),
      },
      {
        text: 'lesson.hounds.drag',
        touch: 'lesson.hounds.dragTouch',
        on: (e) => e.type === 'dragLine',
        fail: (c) =>
          eveningOver('lesson.hounds.late')(c) ??
          (!carries(c.sim, 'drag_line') && !onFloor(c.sim, 'drag_line') ? 'lesson.hounds.noLine' : null),
      },
      { text: 'lesson.hounds.over', done: () => true, least: 6 },
    ],
  },
  {
    // Stalag Flucht's cold (2.38): a minute out in the snow chills, indoors warms, a cushioned outfit keeps it out.
    id: 'cold',
    icon: 'snow',
    prison: STALAG_FLUCHT,
    seed: 160,
    setup: (sim) => {
      sim.state.calendar = [[1, DAY_EVENTS.indexOf('none'), WEATHERS.indexOf('clear')]];
      clockTo(sim, EVENING);
      const t = nearestZoneTile(sim, placesOf(sim.world).bedside[1], 'yard');
      place(sim, t % 64, Math.floor(t / 64), 5);
      pockets(sim, 'cushioned_outfit');
    },
    steps: [
      {
        text: 'lesson.cold.out',
        done: (c) => c.sim.state.frozen,
        fail: (c) =>
          eveningOver('lesson.cold.late')(c) ??
          (itemOf(c.sim.state.items.inv[SLOT.OUTFIT]) === n('cushioned_outfit') ? 'lesson.cold.early' : null),
      },
      {
        text: 'lesson.cold.in',
        done: (c) => !c.sim.state.frozen,
        goal: (sim) => placesOf(sim.world).bedside[1],
        fail: eveningOver('lesson.cold.late'),
      },
      {
        text: 'lesson.cold.wear',
        touch: 'lesson.cold.wearTouch',
        done: (c) => itemOf(c.sim.state.items.inv[SLOT.OUTFIT]) === n('cushioned_outfit'),
        fail: (c) =>
          eveningOver('lesson.cold.late')(c) ??
          (!carries(c.sim, 'cushioned_outfit') &&
          !onFloor(c.sim, 'cushioned_outfit') &&
          itemOf(c.sim.state.items.inv[SLOT.OUTFIT]) !== n('cushioned_outfit')
            ? 'lesson.cold.noOutfit'
            : null),
      },
      { text: 'lesson.cold.over', done: () => true, least: 6 },
    ],
  },
  {
    // Shankton's shell (2.38): concrete no tool chips; up the generator room's ladder, the grapnel across onto the
    // gatehouse roof astride both fences, down its far side on the sheet rope.
    id: 'shell',
    icon: 'shield',
    prison: SHANKTON,
    seed: 161,
    routine: false,
    setup: (sim) => {
      clockTo(sim, at(23, 20));
      place(sim, 35, 54, 5);
      pockets(sim, 'light_pickaxe', 'grapnel', 'sheet_rope');
      sim.state.items.hand = 0;
      sim.state.energy = 100;
      dummyInBed(sim);
      // (The generator room's camera taped over already: Cameras and arches.)
      const cams = sim.prison.cameras ?? [];
      cams.forEach((c, k) => {
        if (Math.abs(c.x - 35) <= 4 && Math.abs(c.z - 51) <= 4) sim.state.cams[k] = sim.state.step + 10 * 60 * 20;
      });
    },
    steps: [
      {
        text: 'lesson.shell.wall',
        touch: 'lesson.shell.wallTouch',
        on: (e) => e.type === 'cantStrike' && e.why === 'reinforced',
        done: (c) => c.sim.state.layer === LAYER.ROOF,
      },
      {
        text: 'lesson.shell.ladder',
        touch: 'lesson.shell.ladderTouch',
        done: (c) => c.sim.state.layer === LAYER.ROOF,
        goal: () => tile(38, 50),
      },
      {
        text: 'lesson.shell.edge',
        // (Or thrown from anywhere along that edge: across all the same.)
        done: (c) => apart(c.sim.state.player, centre(tile(53, 55))) < 0.7,
        on: (e) => e.type === 'layer' && e.how === 'grapnel',
        goal: () => tile(53, 55),
        layer: LAYER.ROOF,
        fail: ROPE_GONE,
      },
      {
        text: 'lesson.shell.swing',
        touch: 'lesson.shell.swingTouch',
        on: (e) => e.type === 'layer' && e.how === 'grapnel',
        done: (c) => c.sim.state.escaped > 0,
        fail: (c) => ROPE_GONE(c) ?? (!carries(c.sim, 'grapnel') && !onFloor(c.sim, 'grapnel') ? 'lesson.shell.noGrapnel' : null),
      },
      {
        text: 'lesson.shell.down',
        touch: 'lesson.shell.downTouch',
        done: (c) => c.sim.state.escaped > 0,
        goal: () => tile(53, 62),
        layer: LAYER.ROOF,
        // (Dropped on the roof, it lies there to pick up again.)
        fail: ROPE_GONE,
      },
    ],
  },
  {
    // San Pancho's mines (2.38): at night in uniform, through the inner wall, down the paved corridor between the
    // mines, out of the outer gate.
    id: 'mines',
    icon: 'mine',
    prison: SAN_PANCHO,
    seed: 162,
    routine: false,
    setup: (sim) => {
      clockTo(sim, at(23, 20));
      place(sim, 31, 54, 5);
      pockets(sim, 'plastic_key_red', 'plastic_key_green');
      uniform(sim);
      dummyInBed(sim);
    },
    steps: [
      {
        text: 'lesson.mines.road',
        done: (c) => Math.floor(c.sim.state.player.z / 1024) >= 58 || c.sim.state.escaped > 0,
        goal: () => tile(31, 58),
        fail: (c) => (!carries(c.sim, 'plastic_key_green') && !onFloor(c.sim, 'plastic_key_green') ? 'lesson.mines.noKey' : null),
        failOn: (e) => (e.type === 'blast' ? 'lesson.mines.blast' : null),
      },
      {
        text: 'lesson.mines.gate',
        done: (c) => c.sim.state.escaped > 0,
        goal: () => tile(31, 62),
        fail: (c) => (!carries(c.sim, 'plastic_key_green') && !onFloor(c.sim, 'plastic_key_green') ? 'lesson.mines.noKey' : null),
        failOn: (e) => (e.type === 'blast' ? 'lesson.mines.blast' : null),
      },
    ],
  },
  {
    // Irongate's raft (2.38): GEN-2 just switched off; the dock's dead fence cut, the raft launched off the pier's end.
    id: 'raft',
    icon: 'boat',
    prison: IRONGATE,
    seed: 163,
    routine: false,
    setup: (sim) => {
      clockTo(sim, at(23, 40));
      place(sim, 59, 28, 1);
      pockets(sim, 'sturdy_cutters', 'raft');
      sim.state.items.hand = 0;
      sim.state.energy = 100;
      uniform(sim);
      dummyInBed(sim);
      // (Just switched off at GEN-2, and run here: 45 s without power on the dock's fence.)
      sim.state.powerOff2 = POWER_OFF_STEPS;
    },
    steps: [
      {
        text: 'lesson.raft.cut',
        touch: 'lesson.raft.cutTouch',
        done: (c) => dockCut(c.sim),
        fail: (c) => (c.sim.state.powerOff2 === 0 && !dockCut(c.sim) ? 'lesson.raft.power' : null),
      },
      {
        text: 'lesson.raft.pier',
        // (The pier's end, any of its three rows.)
        done: (c) =>
          c.sim.state.escaped > 0 || (Math.floor(c.sim.state.player.x / UNIT) >= 62 && Math.abs(c.sim.state.player.z / UNIT - 28.5) <= 1.5),
        goal: () => tile(62, 28),
      },
      {
        text: 'lesson.raft.launch',
        touch: 'lesson.raft.launchTouch',
        done: (c) => c.sim.state.escaped > 0,
        fail: (c) => (!c.sim.state.escaped && !carries(c.sim, 'raft') && !onFloor(c.sim, 'raft') ? 'lesson.raft.lost' : null),
      },
    ],
  },
  {
    // Irongate's helicopter (2.38): down in the helipad court at night in uniform; its two riot guards put down with
    // molten chocolate; aboard.
    id: 'helicopter',
    icon: 'heli',
    prison: IRONGATE,
    seed: 164,
    routine: false,
    setup: (sim) => {
      clockTo(sim, at(23, 30));
      const [x, z] = near(sim, 33, 44);
      place(sim, x, z, 1);
      pockets(sim, 'molten_chocolate', 'molten_chocolate');
      sim.state.items.hand = 0;
      uniform(sim);
      dummyInBed(sim);
    },
    steps: [
      {
        text: 'lesson.helicopter.guards',
        touch: 'lesson.helicopter.guardsTouch',
        done: (c) => helipadGuards(c.sim).every((k) => c.sim.state.guards[k].ko > 0),
        goal: (sim) => {
          const k = helipadGuards(sim).find((g) => sim.state.guards[g].ko <= 0);
          return k === undefined ? null : tileAt(sim.state.guards[k].body.x, sim.state.guards[k].body.z);
        },
        fail: (c) =>
          c.sim.state.ko > 0
            ? 'lesson.helicopter.down'
            : cupsLeft(c.sim) < helipadGuards(c.sim).filter((k) => c.sim.state.guards[k].ko <= 0).length
              ? 'lesson.helicopter.noCups'
              : null,
      },
      {
        text: 'lesson.helicopter.board',
        touch: 'lesson.helicopter.boardTouch',
        done: (c) => c.sim.state.escaped > 0,
        goal: () => tile(34, 45),
        fail: (c) =>
          c.sim.state.ko > 0
            ? 'lesson.helicopter.down'
            : !c.sim.state.escaped && helipadGuards(c.sim).some((k) => c.sim.state.guards[k].ko <= 0)
              ? 'lesson.helicopter.woke'
              : null,
      },
    ],
  },
];
