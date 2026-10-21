import { talentOn, tonight, turnFrom } from '../sim/systems/talent';
import { quizOn } from '../sim/systems/quiz';
import { itemDef, itemNumber } from '../content/items';
import type { PrisonDef } from '../content/prisons/types';
import { ROUTINE, routineAt } from '../content/routine';
import type { Key } from '../i18n';
import { SLOT } from '../sim/command';
import type { Sim, SimEvent } from '../sim/Sim';
import { clockAt } from '../sim/systems/clock';
import { GUARD } from '../sim/systems/guards';
import { itemOf, slot, usesOf } from '../sim/systems/items';
import { NOISE_LOOK, STEPS_PER_MINUTE, TRUST_IGNORE, UNIT } from '../sim/tuning';
import { containersOf } from '../sim/world/containers';
import { TILE } from '../sim/world/tiles';
import { LAYER, MAP_W } from '../sim/world/World';
import { CENTER_PERKS } from '../content/prisons/center-perks';
import { DAY_EVENTS, SIGN_OFF_MINUTES, WEATHERS } from '../content/days';
import { SHIFT_TO } from '../content/getaways';
import { CATALOGUE, WAY } from '../content/smuggling';
import { atWindow, checkpointOf } from '../sim/systems/getaway';
import { atTail, searchMinute, vehicleIn } from '../sim/systems/delivery';
import { FAVOR, FAVOR_STATE, HOLDER, jobRooms } from '../sim/systems/economy';
import { isFloor, placesOf } from '../sim/ai/places';
import { lineOfSight } from '../sim/ai/sight';
import { WATCH_RANGE } from '../content/crew';
import { ORDER } from '../sim/command';
import { DAY_STEPS, dayMinute, planOf, prisonDay, TODAY } from '../sim/systems/calendar';
import { postOf } from '../sim/systems/crew';
import { smellsOfContraband } from '../sim/systems/k9';
import { FEAT } from '../sim/systems/ledger';
import { touchesMyCell } from '../sim/systems/structure';
import { guardTalking } from '../sim/systems/social';
import { dropTile } from '../sim/systems/smuggling';
import { gameOn, gameRefusal, gamesOpen } from '../sim/systems/games';
import { baitSlot, newRat, petOf } from '../sim/systems/rats';
import { CROP, GROWN, RACE_MINUTE } from '../content/long';
import { atTrack, cardUp } from '../sim/systems/races';
import { newBoard, PIECE, squareAt } from '../sim/systems/checkers';

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
  /** Done when this holds (checked every frame), or (`on`) once an event it waits for has happened while it's the step showing. */
  done?: (c: LessonCtx) => boolean;
  on?: (e: SimEvent, sim: Sim) => boolean;
  /** Where the floor arrows lead meanwhile (a tile), if anywhere, and on which layer (the ground floor unless it says). */
  goal?: (sim: Sim) => number | null;
  layer?: number;
  /** The game runs faster while this step waits (time to pass, nothing to do). */
  speed?: number;
  /** Seconds it shows at least before it can tick (something to read in it; the lesson's card only, not tutorialtest). */
  least?: number;
  /** Why the lesson can't go on now (it ends, to be tried again), if it can't; null while it can. */
  fail?: (c: LessonCtx) => Key | null;
  /** Or an event that ends it (while it's the step showing): why, or null. */
  failOn?: (e: SimEvent, sim: Sim) => Key | null;
}

export interface Lesson {
  id: string;
  icon: string;
  /** Where it's played (the Training Block unless it says; Center Perks, always open, for what the Training Block hasn't got). */
  prison?: PrisonDef;
  /** The game's seed (fixed: trying again plays the same scene); 7 + its place in the list otherwise. */
  seed?: number;
  /** The warden's board and the HUD's day (P17) as in a game (lessons are quiet otherwise). */
  days?: boolean;
  /** false: the routine isn't what the lesson is about (on the roof after Lights Out): the HUD's routine pill shows the block alone, no place, no PENDING. */
  routine?: false;
  /** Guards whose ways the player knows from the start (as if heard in the yard: their talk panel says so). */
  known?: ReadonlyArray<{ guard: number; kind: 'corrupt' | 'strict' | 'lazy' }>;
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
const count = (sim: Sim, id: string) => sim.state.items.inv.slice(0, 6).filter((v) => itemOf(v) === n(id)).length;
const zone = (z: string) => (c: LessonCtx) => c.sim.playerZone === z;
/** Lying on the floor somewhere (dropped, to be picked up again). */
const onFloor = (sim: Sim, id: string) => sim.state.items.ground.some(([, v]) => itemOf(v) === n(id));
/** A hole of this kind in a wall of the player's cell. */
const cellHole = (sim: Sim, kind: number) => sim.world.ground.kind.some((k, i) => k === kind && touchesMyCell(sim.world, i));

/** A quiet morning of free time: no block to keep, nothing due. */
const MORNING = at(10, 30);

/** The nearest open floor tile to (x, z), searching outwards (the tile itself if it's open). */
function near(sim: Sim, x: number, z: number): [number, number] {
  for (let r = 0; r < 6; r++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (isFloor(sim.world, x + dx, z + dz)) return [x + dx, z + dz];
      }
  return [x, z];
}
/** Someone's tile (a body in units). */
const tileOfBody = (b: { x: number; z: number }) => Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);
/** Tiles between two bodies, as the crow flies. */
const apart = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z) / UNIT;
/** An inmate stood still somewhere, waiting for the player (the fight lesson's sparring partner). */
function waitAt(sim: Sim, who: number, x: number, z: number, facing = 9) {
  const m = sim.state.inmates[who];
  m.body.x = x * UNIT + UNIT / 2;
  m.body.z = z * UNIT + UNIT / 2;
  m.goal = -1;
  m.plan = sim.state.routine;
  m.wait = 5 * 60 * STEPS_PER_MINUTE;
  m.body.facing = facing;
}
/** The other inmate's desk on the Training Block (Sparky's). */
const sparkyDesk = (sim: Sim) => containersOf(sim.world).findIndex((c) => !c.mine && c.prop.kind === 'desk');

/** A Center Perks seed whose day-1 delivery search is a quick look (tutorialtest holds it to that). */
const STOW_SEED = 51;
/** Center Perks' corrupt guard (P15): Officer Pratt. */
const PRATT = 1;
/** The second prison day (P19: the dogs' first) at a step of the day (`at`). */
const DAY_TWO = DAY_STEPS;

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
      // (Any wall of the cell will do: the poster covers a hole in any of them.)
      { text: 'lesson.dig.chip', touch: 'lesson.dig.chipTouch', done: (c) => cellHole(c.sim, TILE.HOLE) || cellHole(c.sim, TILE.HOLE_POSTER) },
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
        fail: (c) => (count(c.sim, 'firecracker') === 0 && !c.sim.state.fuses.length && !c.sim.state.items.ground.some(([, v]) => itemOf(v) === n('firecracker')) ? 'lesson.noise.missed' : null),
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
      { text: 'lesson.escape.fence', touch: 'lesson.escape.fenceTouch', done: (c) => c.sim.world.ground.kind.some((k) => k === TILE.FENCE_CUT), goal: () => tile(29, 51) },
      { text: 'lesson.escape.out', done: (c) => c.sim.state.escaped > 0, goal: () => tile(29, 54) },
    ],
  },
  // ---------------------------------------------------------------- Getting by
  {
    // Talking (GDD §10.3–10.4): a gift for a friend's opinion, a favor taken on and handed in.
    id: 'talk',
    icon: 'chat',
    setup: (sim) => {
      clockTo(sim, MORNING);
      place(sim, 23, 23, 1);
      waitAt(sim, 0, 25, 23);
      pockets(sim, 'chocolate');
      sim.state.items.hand = 1;
      fill(sim, myDesk(sim), '', '', '', '', '', '', 'magazine');
      // His favor: a magazine (the player's desk has one).
      sim.state.favors = [{ by: 0, kind: FAVOR.SCAVENGE, item: n('magazine'), target: -1, reward: 25, state: FAVOR_STATE.OFFERED }];
    },
    steps: [
      { text: 'lesson.talk.talk', touch: 'lesson.talk.talkTouch', done: (c) => c.sim.state.talk === 0, goal: (sim) => tileOfBody(sim.state.inmates[0].body) },
      { text: 'lesson.talk.gift', touch: 'lesson.talk.giftTouch', on: (e) => e.type === 'gift' },
      // (Taken on before the gift, or handed in already: the state says, whatever order it was done in.)
      { text: 'lesson.talk.favor', done: (c) => favorPaid(c.sim) || (magazineFavor(c.sim)?.state ?? FAVOR_STATE.OFFERED) !== FAVOR_STATE.OFFERED, fail: talkFail },
      { text: 'lesson.talk.handIn', done: (c) => favorPaid(c.sim), fail: talkFail, goal: (sim) => (carries(sim, 'magazine') ? tileOfBody(sim.state.inmates[0].body) : deskStand(sim)) },
    ],
  },
  {
    // Merchants (GDD §10.3): open in free time, cheaper to friends.
    id: 'trade',
    icon: 'cart',
    prison: CENTER_PERKS,
    seed: 61,
    setup: (sim) => {
      clockTo(sim, MORNING);
      const m = sim.state.inmates[merchantAt(sim)];
      const [x, z] = near(sim, Math.floor(m.body.x / UNIT) + 1, Math.floor(m.body.z / UNIT));
      place(sim, x, z, 9);
      sim.state.cash = 60;
    },
    steps: [
      { text: 'lesson.trade.talk', touch: 'lesson.trade.talkTouch', done: (c) => c.sim.state.talk === merchantAt(c.sim), goal: (sim) => tileOfBody(sim.state.inmates[merchantAt(sim)].body), fail: tradeFail },
      { text: 'lesson.trade.buy', on: (e) => e.type === 'bought', fail: tradeFail },
    ],
  },
  {
    // A job (GDD §11): the Work Period at the laundry, a load through the machine for the quota.
    id: 'job',
    icon: 'briefcase',
    prison: CENTER_PERKS,
    seed: 62,
    setup: (sim) => {
      clockTo(sim, at(12, 1));
      sim.state.jobs = sim.state.jobs.map((h, k) => (k === LAUNDRY ? HOLDER.PLAYER : h === HOLDER.PLAYER ? HOLDER.NOBODY : h));
      sim.state.jobDay = 1;
      place(sim, 14, 13, 1);
    },
    steps: [
      { text: 'lesson.job.go', done: zone('laundry'), goal: (sim) => besideProp(sim, jobRooms(sim.world)[LAUNDRY].take), fail: jobFail },
      { text: 'lesson.job.take', touch: 'lesson.job.takeTouch', done: (c) => carries(c.sim, 'dirty_laundry') || machineOn(c.sim) || c.sim.state.quota > 0, goal: (sim) => besideProp(sim, jobRooms(sim.world)[LAUNDRY].take), fail: jobFail },
      { text: 'lesson.job.wash', touch: 'lesson.job.washTouch', done: (c) => machineOn(c.sim) || carries(c.sim, 'clean_laundry') || c.sim.state.quota > 0, goal: (sim) => besideProp(sim, jobRooms(sim.world)[LAUNDRY].machines[0]), fail: jobFail },
      // (The machine's load: back to it once it's done, then to the clean basket.)
      { text: 'lesson.job.deliver', done: (c) => c.sim.state.quota > 0, goal: (sim) => besideProp(sim, carries(sim, 'clean_laundry') ? jobRooms(sim.world)[LAUNDRY].put : loadedMachine(sim)), fail: jobFail },
    ],
  },
  {
    // Training (GDD §3.2): a set on the weights for Strength.
    id: 'gym',
    icon: 'dumbbell',
    setup: (sim) => {
      clockTo(sim, MORNING);
      place(sim, 35, 33, 9);
      sim.state.energy = 100;
    },
    steps: [
      { text: 'lesson.gym.start', touch: 'lesson.gym.startTouch', done: (c) => c.sim.state.train >= 0, goal: () => tile(35, 33) },
      { text: 'lesson.gym.lift', touch: 'lesson.gym.liftTouch', on: (e) => e.type === 'trained' },
    ],
  },
  {
    // The disguise (GDD §7): a guard's uniform past a guard, at night out of the cell; not too close.
    id: 'disguise',
    icon: 'shirt',
    setup: (sim) => {
      clockTo(sim, at(23, 30));
      place(sim, 36, 23, 1);
      pockets(sim, 'guard_outfit');
      sim.state.items.hand = 1;
    },
    steps: [
      { text: 'lesson.disguise.wear', touch: 'lesson.disguise.wearTouch', done: (c) => itemOf(c.sim.state.items.inv[SLOT.OUTFIT]) === n('guard_outfit') },
      { text: 'lesson.disguise.walk', done: (c) => c.sim.playerZone === 'gym' && c.sim.state.guards[0].sees && itemOf(c.sim.state.items.inv[SLOT.OUTFIT]) === n('guard_outfit'), goal: () => tile(38, 29) },
      { text: 'lesson.disguise.close', least: 6, done: () => true },
    ],
  },
  {
    // Tunnels (GDD §9.2): the entrance under the desk, its dirt down the toilet, braces every third tile, up past the fence.
    id: 'tunnel',
    icon: 'shovel',
    setup: (sim) => {
      clockTo(sim, MORNING);
      // Below the desk, facing it (the chair stands at its side).
      place(sim, 22, 18, 13);
      // (Four braces: past the fence however early the player braces; a pocket left free for the dirt.)
      pockets(sim, 'sturdy_shovel', 'timber_brace', 'timber_brace', 'timber_brace', 'timber_brace');
      sim.state.items.hand = 0;
      sim.state.energy = 100;
    },
    steps: [
      // (Down some other hole, or up outside already: on with the steps that are left.)
      { text: 'lesson.tunnel.shaft', touch: 'lesson.tunnel.shaftTouch', done: (c) => c.sim.world.ground.kind[deskTile(c.sim)] === TILE.SHAFT || c.sim.state.layer === LAYER.UNDER || outside(c.sim), goal: (sim) => deskStand(sim) },
      { text: 'lesson.tunnel.dirt', touch: 'lesson.tunnel.dirtTouch', done: (c) => !carries(c.sim, 'dirt') || c.sim.state.layer === LAYER.UNDER || outside(c.sim), goal: () => tile(22, 19) },
      { text: 'lesson.tunnel.down', touch: 'lesson.tunnel.downTouch', done: (c) => c.sim.state.layer === LAYER.UNDER || outside(c.sim), goal: (sim) => deskStand(sim) },
      // (Past the fence's line, z 12; up any sooner past it does too. Up inside it: try again.)
      { text: 'lesson.tunnel.dig', touch: 'lesson.tunnel.digTouch', done: (c) => (c.sim.state.layer === LAYER.UNDER && Math.floor(c.sim.state.player.z / UNIT) <= 11) || outside(c.sim), failOn: upInside },
      { text: 'lesson.tunnel.up', touch: 'lesson.tunnel.upTouch', done: (c) => outside(c.sim), failOn: upInside },
    ],
  },
  {
    // The vents (GDD §9.3): the cell's grate unscrewed, the ducts crawled to the ladder, up on the roof.
    id: 'vents',
    icon: 'screw',
    prison: CENTER_PERKS,
    seed: 63,
    setup: (sim) => {
      // After Lights Out, a dummy in bed: no guard sweeps the cells then to see the grate open.
      clockTo(sim, at(23, 15));
      place(sim, 9, 9, 13);
      pockets(sim, 'screwdriver');
      fill(sim, containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'bed'), 'bed_dummy');
      sim.state.items.hand = 0;
      sim.state.energy = 100;
    },
    steps: [
      { text: 'lesson.vents.grate', touch: 'lesson.vents.grateTouch', done: (c) => c.sim.world.layers[LAYER.VENTS].kind[tile(9, 9)] === TILE.GRATE_OPEN || c.sim.state.layer !== LAYER.GROUND, goal: () => tile(9, 9) },
      { text: 'lesson.vents.up', touch: 'lesson.vents.upTouch', done: (c) => c.sim.state.layer !== LAYER.GROUND },
      { text: 'lesson.vents.crawl', done: (c) => c.sim.state.layer === LAYER.ROOF || (c.sim.state.layer === LAYER.VENTS && apart(c.sim.state.player, centre(tile(13, 38))) < 1.2), goal: () => tile(13, 38), layer: LAYER.VENTS },
      { text: 'lesson.vents.roof', touch: 'lesson.vents.roofTouch', done: (c) => c.sim.state.layer === LAYER.ROOF, goal: () => tile(13, 38), layer: LAYER.VENTS },
    ],
  },
  // ---------------------------------------------------------------- Prison life
  {
    // Guard ways (P15): a corrupt guard, paid to lose the paperwork.
    id: 'guards',
    icon: 'hand',
    prison: CENTER_PERKS,
    seed: 31,
    known: [{ guard: PRATT, kind: 'corrupt' }],
    setup: (sim) => {
      clockTo(sim, MORNING);
      const g = sim.state.guards[PRATT].body;
      const [x, z] = near(sim, Math.floor(g.x / UNIT) + 2, Math.floor(g.z / UNIT));
      place(sim, x, z, 9);
      // (Enough heat that it takes a long while to cool off by itself: a few minutes of play.)
      sim.state.heat = 60;
      sim.state.cash = 45;
    },
    steps: [
      { text: 'lesson.guards.talk', touch: 'lesson.guards.talkTouch', done: (c) => guardTalking(c.sim.state) === PRATT, goal: (sim) => tileOfBody(sim.state.guards[PRATT].body), fail: guardsFail },
      { text: 'lesson.guards.pay', on: (e) => e.type === 'bribe' && e.kind === 'paper', fail: guardsFail },
    ],
  },
  {
    // The day (P17): the warden's board in the morning, a fire drill's bell, roll call in time.
    id: 'day',
    icon: 'megaphone',
    prison: CENTER_PERKS,
    seed: 32,
    days: true,
    setup: (sim) => {
      sim.state.calendar = [[1, DAY_EVENTS.indexOf('drill'), -1]];
      // Time to read the warden's morning announcement before the bell; in the cell block's corridor, a short walk from the yard's door.
      clockTo(sim, (planOf(sim, 1).at - 22) * STEPS_PER_MINUTE);
      place(sim, 14, 13, 1);
    },
    steps: [
      { text: 'lesson.day.board', on: (e) => e.type === 'today' && e.event === 'drill' && e.phase === 'start' },
      { text: 'lesson.day.muster', done: (c) => !!(c.sim.state.eventFlags & TODAY.MUSTERED), goal: (sim) => sim.prison.rollCall[0].z * MAP_W + sim.prison.rollCall[0].x, fail: (c) => (c.sim.state.eventFlags & TODAY.MISSED_DRILL ? 'lesson.day.missed' : null) },
      { text: 'lesson.day.over', speed: 4, on: (e) => e.type === 'today' && e.event === 'drill' && e.phase === 'end' },
    ],
  },
  {
    // Guard dogs (P19): Bell's dog smells contraband in the pockets; a treat a day wins him over.
    id: 'dogs',
    icon: 'paw',
    setup: (sim) => {
      clockTo(sim, DAY_TWO + MORNING);
      place(sim, 38, 30, 13);
      pockets(sim, 'light_cutters', 'jerky');
      sim.state.items.hand = 2;
      sim.state.dogs[0].trust = 40;
    },
    steps: [
      // (A treat thrown first: he trusts the player already and never sniffs. On to the last step.)
      { text: 'lesson.dogs.sniff', done: (c) => c.sim.state.dogs[0].sniffed > 0 || c.sim.state.dogs[0].trust >= TRUST_IGNORE, goal: (sim) => tileOfBody(sim.state.dogs[0].body) },
      // (A throw that misses leaves the jerky lying where it fell, to pick up and throw again: no dead end.)
      { text: 'lesson.dogs.treat', touch: 'lesson.dogs.treatTouch', done: (c) => c.sim.state.dogs[0].trust >= TRUST_IGNORE },
      { text: 'lesson.dogs.pass', least: 4, done: (c) => c.sim.state.dogs[0].trust >= TRUST_IGNORE && smellsOfContraband(c.sim) && apart(c.sim.state.player, c.sim.state.dogs[0].body) < 1.4, goal: (sim) => tileOfBody(sim.state.dogs[0].body) },
    ],
  },
  {
    // The pet rat (P20): a caught rat fed twice is tame, and fetches from furniture that isn't yours.
    id: 'rat',
    icon: 'rat',
    setup: (sim) => {
      clockTo(sim, MORNING);
      place(sim, 23, 23, 1);
      pockets(sim, 'caught_rat', 'potato', 'chocolate');
      fill(sim, sparkyDesk(sim), '', '', '', '', '', '', 'lighter');
    },
    steps: [
      { text: 'lesson.rat.feed', touch: 'lesson.rat.feedTouch', done: (c) => !!petOf(c.sim.state) || usesOf(c.sim.state.items.inv.find((v) => itemOf(v) === n('caught_rat')) ?? 0) > 0, fail: ratFail },
      { text: 'lesson.rat.tame', touch: 'lesson.rat.tameTouch', done: (c) => !!petOf(c.sim.state), fail: ratFail },
      // (Sent somewhere else, it comes back with nothing of use: the step waits for the desk.)
      { text: 'lesson.rat.send', touch: 'lesson.rat.sendTouch', on: (e, sim) => e.type === 'rat' && e.what === 'sent' && e.container === sparkyDesk(sim) },
      { text: 'lesson.rat.back', done: (c) => carries(c.sim, 'lighter') },
    ],
  },
  {
    // Smuggling (P21): an order on the burner phone, by drone, picked up in the yard before a guard sees it.
    id: 'smuggle',
    icon: 'drone',
    prison: CENTER_PERKS,
    // (A night whose drop lands at 21:21 and lies a few seconds before a guard's round comes by: tutorialtest holds it to that.)
    seed: 68,
    setup: (sim) => {
      // (A good hour to order in: the drone needs an hour's notice.)
      clockTo(sim, at(19));
      pockets(sim, 'burner_phone');
      sim.state.items.hand = 0;
      sim.state.cash = 40;
    },
    steps: [
      {
        text: 'lesson.smuggle.order',
        touch: 'lesson.smuggle.orderTouch',
        on: (e, sim) => e.type === 'smuggle' && e.what === 'ordered' && e.item === n('battery') && sim.state.order[2] === prisonDay(sim.state.step),
        // Ordered too late for tonight's drone (it needs an hour's notice): tomorrow night's is too long to wait.
        // (Or something else, or by a visitor: not what the lesson waits for.)
        fail: (c) => {
          const o = c.sim.state.order;
          if (o.length !== 3) return null;
          if (o[1] !== WAY.DRONE || CATALOGUE[o[0]]?.item !== 'battery') return 'lesson.smuggle.wrong';
          return o[2] > prisonDay(c.sim.state.step) ? 'lesson.smuggle.late' : null;
        },
      },
      { text: 'lesson.smuggle.go', touch: 'lesson.smuggle.goTouch', done: (c) => carries(c.sim, 'battery') || apart(c.sim.state.player, centre(dropTile(c.sim, prisonDay(c.sim.state.step)))) < 0.8, goal: (sim) => dropTile(sim, prisonDay(sim.state.step)), fail: (c) => smuggleFail(c.sim) },
      // (Landed, or picked up already, whatever step showed then.)
      { text: 'lesson.smuggle.wait', speed: 6, done: (c) => c.sim.state.drops.length > 0 || carries(c.sim, 'battery'), fail: (c) => smuggleFail(c.sim) },
      { text: 'lesson.smuggle.grab', touch: 'lesson.smuggle.grabTouch', done: (c) => carries(c.sim, 'battery'), goal: (sim) => dropTile(sim, prisonDay(sim.state.step)), fail: (c) => smuggleFail(c.sim) },
    ],
  },
  {
    // Side games (P22): dice for a stake, then an arm-wrestle.
    id: 'games',
    icon: 'dice',
    setup: (sim) => {
      // Evening free time: four hours of games ahead (the morning's ends at noon).
      clockTo(sim, at(18, 15));
      place(sim, 24, 31, 1);
      waitAt(sim, 0, 26, 31);
      sim.state.inmates[0].opinion = 50;
      sim.state.cash = 20;
      sim.state.energy = 100;
    },
    steps: [
      { text: 'lesson.games.dice', touch: 'lesson.games.diceTouch', on: (e) => e.type === 'dice' && e.what === 'rolled', fail: gamesFail },
      { text: 'lesson.games.reroll', on: (e) => e.type === 'dice' && (e.what === 'won' || e.what === 'lost' || e.what === 'push'), fail: gamesFail },
      {
        text: 'lesson.games.wrestle',
        touch: 'lesson.games.wrestleTouch',
        on: (e) => e.type === 'bout' && (e.what === 'won' || e.what === 'lost' || e.what === 'draw'),
        fail: (c) => gamesFail(c) ?? (!c.sim.state.bout.length && gameRefusal(c.sim, 0) === 'played' ? 'lesson.games.played' : null),
      },
    ],
  },
  {
    // Cheat (P27): a hand for $5 with Sparky, played out to its last chip.
    id: 'cards',
    icon: 'cards',
    setup: (sim) => {
      clockTo(sim, at(18, 15));
      place(sim, 24, 31, 1);
      waitAt(sim, 0, 26, 31);
      sim.state.inmates[0].opinion = 50;
      sim.state.cash = 20;
    },
    steps: [
      { text: 'lesson.cards.start', touch: 'lesson.cards.startTouch', on: (e) => e.type === 'cheat' && e.what === 'dealt' && e.round === 0, fail: gamesFail },
      { text: 'lesson.cards.lay', touch: 'lesson.cards.layTouch', on: (e) => e.type === 'cheat' && e.what === 'played' && e.by === 0, failOn: cheatOff },
      { text: 'lesson.cards.call', touch: 'lesson.cards.callTouch', on: (e) => e.type === 'cheat' && e.what === 'called', failOn: cheatOff },
      { text: 'lesson.cards.end', on: (e) => e.type === 'cheat' && (e.what === 'won' || e.what === 'lost'), failOn: cheatOff },
      // (A moment with the game's result on screen before the lesson's done.)
      { text: 'lesson.cards.over', done: () => true, least: 5 },
    ],
  },
  {
    // Hoops (P27): a basket on one's own, then a shootout with Sparky.
    id: 'hoops',
    icon: 'ball',
    setup: (sim) => {
      clockTo(sim, at(18, 15));
      const c = sim.prison.leisure!.hoop;
      place(sim, c.spots[0].x + 1, c.spots[0].z + 1, 13);
      waitAt(sim, 0, c.spots[0].x + 2, c.spots[0].z + 1);
      sim.state.inmates[0].opinion = 50;
    },
    steps: [
      { text: 'lesson.hoops.shoot', touch: 'lesson.hoops.shootTouch', on: (e) => e.type === 'hoopShot' && e.by < 0, goal: (sim) => spotOn(sim, 0) },
      { text: 'lesson.hoops.basket', touch: 'lesson.hoops.basketTouch', on: (e) => e.type === 'hoopShot' && e.by < 0 && (e.result === 'swish' || e.result === 'in') },
      { text: 'lesson.hoops.shootout', touch: 'lesson.hoops.shootoutTouch', on: (e) => e.type === 'hoops' && e.what === 'start', fail: gamesFail },
      {
        text: 'lesson.hoops.finish',
        on: (e) => e.type === 'hoops' && (e.what === 'won' || e.what === 'lost' || e.what === 'draw'),
        // (The lit spot, as the shootout goes on.)
        goal: (sim) => (sim.state.shootout ? spotOn(sim, sim.state.shootout.k % sim.prison.leisure!.hoop.spots.length) : null),
        failOn: (e) => (e.type === 'hoops' && e.what === 'off' ? 'lesson.hoops.off' : null),
      },
      { text: 'lesson.hoops.over', done: () => true, least: 5 },
    ],
  },
  {
    // Checkers (P27): the old-timer's game left set up, won with a double jump; his secret.
    id: 'checkers',
    icon: 'checkers',
    setup: (sim) => {
      clockTo(sim, at(18, 15));
      place(sim, 24, 31, 1);
      waitAt(sim, 0, 26, 31);
      sim.state.inmates[0].opinion = 50;
      // His last two men in reach of the player's: one move, two jumps.
      const b = newBoard();
      b.sq.fill(PIECE.EMPTY);
      for (const [r, c, p] of [
        [5, 2, PIECE.MAN],
        [7, 4, PIECE.MAN],
        [6, 7, PIECE.MAN],
        [4, 3, PIECE.HIS_MAN],
        [2, 5, PIECE.HIS_MAN],
      ] as const)
        b.sq[squareAt(r, c)] = p;
      b.seated = false;
      sim.state.board = b;
    },
    steps: [
      { text: 'lesson.checkers.sit', touch: 'lesson.checkers.sitTouch', on: (e) => e.type === 'checkers' && e.what === 'sat', fail: boardFail },
      {
        text: 'lesson.checkers.jump',
        touch: 'lesson.checkers.jumpTouch',
        on: (e) => e.type === 'checkers' && e.what === 'won',
        fail: boardFail,
        failOn: (e) => (e.type === 'checkers' && e.what === 'lost' ? 'lesson.checkers.resigned' : null),
      },
      { text: 'lesson.checkers.secret', touch: 'lesson.checkers.secretTouch', done: () => true, least: 6 },
    ],
  },
  {
    // Pruno (P28): a bag brewed and hidden; last night's ripe by morning, and drunk.
    id: 'pruno',
    icon: 'brew',
    setup: (sim) => {
      // Lights Out, in the cell: fruit and sugar in the pockets, and a bag hidden in the desk two nights ago.
      clockTo(sim, at(23, 5));
      place(sim, 20, 19, 1);
      pockets(sim, 'fruit', 'fruit', 'sugar');
      fill(sim, myDesk(sim), '');
      sim.state.items.containers[myDesk(sim)][0] = slot(n('pruno_bag'), 1);
      // (The tank empty: room for the new bag.)
      fill(sim, containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'toilet'), '');
    },
    steps: [
      { text: 'lesson.pruno.brew', touch: 'lesson.pruno.brewTouch', done: (c) => carries(c.sim, 'pruno_bag') || bagsHidden(c.sim) >= 2 },
      { text: 'lesson.pruno.hide', touch: 'lesson.pruno.hideTouch', done: (c) => bagsHidden(c.sim) >= 2, goal: (sim) => tile(...near(sim, 21, 20)) },
      { text: 'lesson.pruno.sleep', touch: 'lesson.pruno.sleepTouch', on: (e) => e.type === 'pruno' && e.what === 'ripe' && !!e.mine, goal: () => tile(20, 18) },
      { text: 'lesson.pruno.drink', touch: 'lesson.pruno.drinkTouch', on: (e) => e.type === 'pruno' && e.what === 'drunk', goal: () => tile(21, 18) },
      { text: 'lesson.pruno.over', done: () => true, least: 6 },
    ],
  },
  {
    // The garden (P28): a bed planted and watered, a wilted one saved, a ripe one picked; the hole under a plant.
    id: 'garden',
    icon: 'sprout',
    setup: (sim) => {
      clockTo(sim, MORNING);
      const g = sim.prison.leisure!.garden;
      place(sim, g.x, g.z + g.d, 13);
      pockets(sim, 'veg_seeds', 'plastic_cup');
      sim.state.items.hand = 0;
      // The far beds: one of fruit ripe to pick, one of vegetables wilted (a day dry).
      const beds = g.w * g.d;
      sim.state.plots = Array.from({ length: beds }, () => [CROP.NONE, 0, 0, 0]);
      sim.state.plots[g.w - 1] = [CROP.FRUIT, GROWN, 0, 0];
      sim.state.plots[beds - 1] = [CROP.VEG, 1, 1, 0];
    },
    steps: [
      { text: 'lesson.garden.plant', touch: 'lesson.garden.plantTouch', on: (e) => e.type === 'garden' && e.what === 'planted', goal: (sim) => gardenBed(sim, 0, 1) },
      { text: 'lesson.garden.water', touch: 'lesson.garden.waterTouch', done: (c) => c.sim.state.plots.some((b, k) => k !== wiltedBed(c.sim) && b[0] !== CROP.NONE && b[3] > 0 && b[1] < GROWN) },
      { text: 'lesson.garden.wilted', touch: 'lesson.garden.wiltedTouch', done: (c) => (c.sim.state.plots[wiltedBed(c.sim)]?.[3] ?? 0) > 0, goal: (sim) => gardenBed(sim, wiltedBed(sim), 1) },
      // (Picked already, whatever step showed then.)
      { text: 'lesson.garden.pick', touch: 'lesson.garden.pickTouch', done: (c) => c.sim.state.plots[c.sim.prison.leisure!.garden.w - 1]?.[0] === CROP.NONE, goal: (sim) => tile(sim.prison.leisure!.garden.x + sim.prison.leisure!.garden.w, sim.prison.leisure!.garden.z) },
      { text: 'lesson.garden.secret', done: () => true, least: 6 },
    ],
  },
  {
    // Rat racing (P28): the pet run on its track, then race night: entered, a bet, the race.
    id: 'ratRace',
    icon: 'race',
    setup: (sim) => {
      // Evening free time on a race night (day 1 is odd), in the cell, the rat on the shoulder.
      clockTo(sim, at(19, 40));
      place(sim, 20, 19, 1);
      pockets(sim, 'rat_track', 'potato');
      sim.state.items.hand = 0;
      sim.state.cash = 20;
      const pet = newRat(false, sim.state.player.x, sim.state.player.z);
      pet.speed = 60;
      sim.state.rats = [pet];
    },
    steps: [
      { text: 'lesson.ratRace.train', touch: 'lesson.ratRace.trainTouch', done: (c) => petOf(c.sim.state)?.fed === 1, fail: raceFail },
      { text: 'lesson.ratRace.go', done: (c) => atTrack(c.sim), goal: (sim) => trackStart(sim), fail: raceFail },
      { text: 'lesson.ratRace.card', speed: 8, done: (c) => cardUp(c.sim) && atTrack(c.sim), goal: (sim) => trackStart(sim), fail: raceFail },
      // (Entered and backed in either order: each step looks at the race as it stands.)
      { text: 'lesson.ratRace.enter', touch: 'lesson.ratRace.enterTouch', done: (c) => raceState(c.sim, 4) === 1, goal: (sim) => trackStart(sim), fail: (c) => (raceState(c.sim, 4) !== 1 && pastOff(c.sim) ? 'lesson.ratRace.late' : null) },
      { text: 'lesson.ratRace.bet', touch: 'lesson.ratRace.betTouch', done: (c) => raceState(c.sim, 1) >= 0, goal: (sim) => trackStart(sim), fail: raceFail },
      { text: 'lesson.ratRace.watch', speed: 6, on: (e) => e.type === 'race' && e.what === 'result', failOn: (e) => (e.type === 'race' && (e.what === 'off' || e.what === 'scratched') ? 'lesson.ratRace.off' : null) },
      { text: 'lesson.ratRace.over', done: () => true, least: 6 },
    ],
  },
  {
    // Yard football (P29): a match with Center Perks' inmates, a kick, the final whistle; the cover a match gives.
    id: 'football',
    icon: 'ball',
    prison: CENTER_PERKS,
    seed: 72,
    setup: (sim) => {
      clockTo(sim, at(10, 5));
      const p = sim.prison.leisure!.pitch;
      const cx = p.x + Math.floor(p.w / 2);
      const cz = p.z + Math.floor(p.d / 2);
      place(sim, cx, cz, 9);
      // The captain at the player's side; everyone else about the yard, two of them good friends.
      waitAt(sim, 0, cx - 1, cz);
      sim.state.inmates.forEach((m, k) => {
        m.opinion = k === 1 || k === 2 ? 75 : 60;
        if (k === 0) return;
        const [x, z] = near(sim, p.x + 1 + ((k * 2) % (p.w - 2)), p.z + p.d + 1);
        m.body.x = x * UNIT + UNIT / 2;
        m.body.z = z * UNIT + UNIT / 2;
        m.goal = -1;
        m.path = [];
      });
    },
    steps: [
      { text: 'lesson.football.talk', touch: 'lesson.football.talkTouch', on: (e) => e.type === 'football' && e.what === 'start', goal: (sim) => tileOfBody(sim.state.inmates[0].body), fail: gamesFail },
      {
        text: 'lesson.football.kick',
        touch: 'lesson.football.kickTouch',
        on: (e) => e.type === 'football' && e.what === 'kick',
        goal: (sim) => (sim.state.match ? tile(Math.floor(sim.state.match.ball[0] / UNIT), Math.floor(sim.state.match.ball[1] / UNIT)) : null),
        failOn: matchFail,
      },
      { text: 'lesson.football.play', on: (e) => e.type === 'football' && (e.what === 'won' || e.what === 'lost' || e.what === 'draw'), goal: (sim) => farNet(sim), failOn: (e) => (e.type === 'football' && (e.what === 'won' || e.what === 'lost' || e.what === 'draw') ? null : matchFail(e)) },
      { text: 'lesson.football.over', done: () => true, least: 7 },
    ],
  },
  {
    // The tattoo parlour (P29): a gun crafted, a heart traced for Sparky, a design of his on the player's arm.
    id: 'tattoo',
    icon: 'needle',
    setup: (sim) => {
      clockTo(sim, at(10, 5));
      place(sim, 36, 23, 1);
      waitAt(sim, 0, 38, 23);
      sim.state.inmates[0].opinion = 72;
      pockets(sim, 'toothbrush', 'battery', 'razor_blade', 'ink', 'ink', 'ink');
    },
    steps: [
      { text: 'lesson.tattoo.craft', touch: 'lesson.tattoo.craftTouch', done: (c) => carries(c.sim, 'tattoo_gun'), fail: inkFail },
      { text: 'lesson.tattoo.offer', touch: 'lesson.tattoo.offerTouch', on: (e) => e.type === 'tattoo' && e.what === 'start' && !e.mine, goal: (sim) => tileOfBody(sim.state.inmates[0].body), fail: (c) => gamesFail(c) ?? inkFail(c) },
      { text: 'lesson.tattoo.trace', touch: 'lesson.tattoo.traceTouch', on: (e) => e.type === 'tattoo' && e.what === 'done', failOn: inkOff },
      { text: 'lesson.tattoo.mine', touch: 'lesson.tattoo.mineTouch', on: (e) => e.type === 'tattoo' && e.what === 'inked', goal: (sim) => tileOfBody(sim.state.inmates[0].body), fail: (c) => (c.sim.state.ink ? null : (gamesFail(c) ?? inkFail(c))), failOn: inkOff },
      { text: 'lesson.tattoo.over', done: () => true, least: 6 },
    ],
  },
  {
    // Talent night (P30): the night's acts at Center Perks, then the player's song on the canteen's stage.
    id: 'talent',
    icon: 'music',
    prison: CENTER_PERKS,
    seed: 81,
    days: true,
    setup: (sim) => {
      sim.state.calendar = [[1, DAY_EVENTS.indexOf('talent'), -1]];
      // The last act on as it begins, in the canteen a few steps from the stage.
      const acts = tonight(sim);
      clockTo(sim, at(19, acts[acts.length - 1].at - 660 - 2));
      const st = sim.prison.leisure!.stage!;
      place(sim, st.x - 4, st.z, 1);
      // (The acts before it played earlier in the evening; the last one's performer already on the boards, not a no-show.)
      sim.state.acted = [prisonDay(sim.state.step), (1 << (acts.length - 1)) - 1];
      const last = sim.state.inmates[acts[acts.length - 1].who].body;
      last.x = st.x * UNIT + UNIT / 2;
      last.z = st.z * UNIT + UNIT / 2;
    },
    steps: [
      { text: 'lesson.talent.watch', done: (c) => dayMinute(c.sim.state.step) >= turnFrom(tonight(c.sim)), least: 5 },
      { text: 'lesson.talent.stage', touch: 'lesson.talent.stageTouch', on: (e) => e.type === 'stage' && e.what === 'start', goal: (sim) => stageTile(sim), fail: (c) => (talentOn(c.sim) ? null : 'lesson.talent.late') },
      { text: 'lesson.talent.play', touch: 'lesson.talent.playTouch', on: (e) => e.type === 'stage' && e.what === 'done', failOn: (e) => (e.type === 'stage' && e.what === 'off' ? 'lesson.talent.off' : null) },
      { text: 'lesson.talent.over', done: () => true, least: 7 },
    ],
  },
  {
    // Quiz night (P30): eight questions in Center Perks' library against three inmates.
    id: 'quiz',
    icon: 'brain',
    prison: CENTER_PERKS,
    seed: 84,
    days: true,
    setup: (sim) => {
      sim.state.calendar = [[1, DAY_EVENTS.indexOf('quiz'), -1]];
      clockTo(sim, at(19, 1));
      const q = sim.prison.leisure!.quiz!;
      place(sim, q.spots[0].x, q.spots[0].z + 0, q.face);
    },
    steps: [
      { text: 'lesson.quiz.join', touch: 'lesson.quiz.joinTouch', on: (e) => e.type === 'quiz' && e.what === 'start', goal: (sim) => tile(sim.prison.leisure!.quiz!.spots[0].x, sim.prison.leisure!.quiz!.spots[0].z), fail: (c) => (quizOn(c.sim) ? null : 'lesson.quiz.late') },
      // (Or the quiz played out without an answer of the player's: the others were quicker every time.)
      { text: 'lesson.quiz.answer', touch: 'lesson.quiz.answerTouch', on: (e) => e.type === 'quiz' && (((e.what === 'right' || e.what === 'wrong') && e.by === 0) || e.what === 'won' || e.what === 'tie' || e.what === 'lost'), failOn: quizFail },
      { text: 'lesson.quiz.play', on: (e) => e.type === 'quiz' && (e.what === 'won' || e.what === 'tie' || e.what === 'lost'), done: (c) => !c.sim.state.quiz && c.sim.state.quizDay > 0, failOn: quizFail },
      { text: 'lesson.quiz.over', done: () => true, least: 7 },
    ],
  },
  {
    // The crew (P23): a friend recruited and posted as lookout by the patrol hall's doorway, whistling as the guard comes by.
    id: 'crew',
    icon: 'users',
    setup: (sim) => {
      clockTo(sim, MORNING);
      place(sim, 36, 23, 1);
      // He waits right where a lookout would see Bell's round through the doorway (recruited, he stays put while the lesson lasts).
      waitAt(sim, 0, 38, 23);
      sim.state.inmates[0].opinion = 85;
    },
    steps: [
      { text: 'lesson.crew.recruit', touch: 'lesson.crew.recruitTouch', on: (e) => e.type === 'recruit' && e.on },
      { text: 'lesson.crew.post', on: (e) => e.type === 'crew' && e.what === 'order' && e.order === ORDER.WATCH },
      {
        text: 'lesson.crew.whistle',
        on: (e) => e.type === 'crew' && e.what === 'whistle',
        // Posted where he'd never see Bell's round: he'd never whistle.
        fail: (c) => {
          const at = postOf(c.sim.state, 0);
          // (Told to follow, or let go: no lookout any more.)
          if (at < 0) return 'lesson.crew.off';
          return !seesRound(c.sim, at, 0) ? 'lesson.crew.far' : null;
        },
      },
    ],
  },
  // ---------------------------------------------------------------- Ways out
  {
    // The lockpick (P22): a keyed door opened without its key, pin by pin.
    id: 'lockpick',
    icon: 'lockpick',
    setup: (sim) => {
      clockTo(sim, MORNING);
      place(sim, 42, 22, 13);
      pockets(sim, 'lockpick');
      sim.state.items.hand = 0;
    },
    steps: [
      { text: 'lesson.lockpick.start', touch: 'lesson.lockpick.startTouch', on: (e) => e.type === 'pick' && e.what === 'start', goal: () => tile(42, 22), fail: pickFail },
      { text: 'lesson.lockpick.pins', touch: 'lesson.lockpick.pinsTouch', done: (c) => c.sim.state.picked.length > 0 || zone('generator')(c), fail: pickFail },
      // (It shuts again before long: picked again, or the lockpick broken on it.)
      { text: 'lesson.lockpick.through', done: zone('generator'), goal: () => tile(43, 19), fail: pickFail },
    ],
  },
  {
    // The stowaway (P18): hidden in the delivery's truck, away with it when it leaves.
    id: 'stowaway',
    icon: 'truck',
    prison: CENTER_PERKS,
    // (A delivery day whose search is a quick look: tutorialtest holds it to that.)
    seed: STOW_SEED,
    setup: (sim) => {
      sim.state.calendar = [[1, DAY_EVENTS.indexOf('delivery'), WEATHERS.indexOf('clear')]];
      clockTo(sim, at(13));
      // (On the grass west of the drive, between the sports ground's fence and the truck's bay.)
      place(sim, 28, 52, 1);
      // No job to be at in the Work Period (the HUD would ask for the laundry's quota).
      sim.state.jobs = sim.state.jobs.map((h) => (h === HOLDER.PLAYER ? HOLDER.NOBODY : h));
    },
    steps: [
      // (Close enough to climb in: the Hide in button is there.)
      { text: 'lesson.stowaway.tail', done: (c) => atTail(c.sim) || c.sim.state.stowed, goal: tailOf, fail: stowFail },
      { text: 'lesson.stowaway.hide', touch: 'lesson.stowaway.hideTouch', done: (c) => c.sim.state.stowed || c.sim.state.escaped > 0, goal: tailOf, fail: stowFail },
      { text: 'lesson.stowaway.wait', touch: 'lesson.stowaway.waitTouch', done: (c) => c.sim.state.escaped > 0, fail: stowFail },
    ],
  },
  {
    // The bluff (P24): a guard's uniform and a fake ID at the checkpoint's window as the gatekeepers change shifts.
    id: 'bluff',
    icon: 'idCard',
    prison: CENTER_PERKS,
    seed: 41,
    setup: (sim) => {
      clockTo(sim, at(19, 34));
      // (South of the sports ground's fence, on the way to the gates.)
      place(sim, 28, 57, 1);
      pockets(sim, 'fake_id', 'plastic_key_green');
      sim.state.items.hand = 2;
      sim.state.items.inv[SLOT.OUTFIT] = slot(n('guard_outfit'));
    },
    steps: [
      { text: 'lesson.bluff.window', done: (c) => atWindow(c.sim) || c.sim.state.waved > 0, goal: (sim) => checkpointOf(sim)!.window[0].z * MAP_W + checkpointOf(sim)!.window[0].x, fail: bluffFail },
      { text: 'lesson.bluff.show', touch: 'lesson.bluff.showTouch', done: (c) => c.sim.state.waved > 0 || c.sim.state.escaped > 0, fail: bluffFail },
      { text: 'lesson.bluff.out', done: (c) => c.sim.state.escaped > 0, fail: (c) => (!c.sim.state.waved && !c.sim.state.escaped ? 'lesson.bluff.shut' : null), goal: (sim) => (checkpointOf(sim)!.gates[0].z + 1) * MAP_W + checkpointOf(sim)!.gates[0].x },
    ],
  },
  {
    // The glider (P24): off the roof's edge with the wind behind, out over the fence to the road.
    id: 'glider',
    icon: 'glider',
    prison: CENTER_PERKS,
    seed: 42,
    routine: false,
    setup: (sim) => {
      // A west wind (a tailwind going east), and the night: up on the roof after Lights Out.
      sim.state.calendar = [[1, -1, -1, 6, 1]];
      clockTo(sim, at(23, 20));
      place(sim, 52, 39, 1);
      sim.state.layer = LAYER.ROOF;
      pockets(sim, 'glider');
      sim.state.items.hand = 0;
      // A dummy asleep in the player's bed for the night's bed checks.
      fill(sim, containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'bed'), 'bed_dummy');
    },
    steps: [
      { text: 'lesson.glider.edge', done: (c) => c.sim.state.escaped > 0 || apart(c.sim.state.player, centre(tile(57, 39))) < 0.7, goal: () => tile(57, 39), layer: LAYER.ROOF, fail: glideFail },
      { text: 'lesson.glider.fly', touch: 'lesson.glider.flyTouch', done: (c) => c.sim.state.escaped > 0, fail: glideFail },
    ],
  },
];

/** Whether a lookout posted on a tile would ever see a guard's round (any tile of it within WATCH_RANGE and in sight). */
function seesRound(sim: Sim, post: number, guard: number): boolean {
  const beat = sim.prison.guards[guard].beat;
  const from = centre(post);
  for (let k = 0; k < beat.length; k++) {
    const a = beat[k];
    const b = beat[(k + 1) % beat.length];
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z), 1);
    for (let j = 0; j <= n; j++) {
      const to = centre(Math.round(a.z + ((b.z - a.z) * j) / n) * MAP_W + Math.round(a.x + ((b.x - a.x) * j) / n));
      if (apart(from, to) <= WATCH_RANGE && lineOfSight(sim.world, from.x, from.z, to.x, to.z)) return true;
    }
  }
  return false;
}

/** A Center Perks merchant (the first in its list: an inmate whose stall opens in free time). */
function merchantAt(sim: Sim): number {
  return sim.state.inmates.findIndex((m) => m.cell === sim.prison.merchants[0]);
}
/** The talk lesson's dead end: the magazine for the favor gone (given away, dropped) with none left in the desk. */
function talkFail(c: LessonCtx): Key | null {
  const it = c.sim.state.items;
  const mag = n('magazine');
  const somewhere = it.inv.some((v) => itemOf(v) === mag) || it.containers.some((box, k) => box.some((v) => itemOf(v) === mag) && containersOf(c.sim.world)[k]?.mine) || it.ground.some(([, v]) => itemOf(v) === mag);
  if (favorPaid(c.sim)) return null;
  // (Left untaken overnight, his favor lapses: something else asked for, or nothing.)
  if (!magazineFavor(c.sim)) return 'lesson.talk.lapsed';
  return !somewhere ? 'lesson.talk.lost' : null;
}
/** Sparky's favor in the talk lesson: a magazine, while it's still on. */
const magazineFavor = (sim: Sim) => sim.state.favors.find((f) => f.by === 0 && f.item === n('magazine'));
/** A favor handed in and paid (the ledger counts them). */
const favorPaid = (sim: Sim) => sim.state.feats[FEAT.favors] > 0;
/** The trade lesson's dead end: the stalls shut (free time over). */
function tradeFail(c: LessonCtx): Key | null {
  return !c.sim.shopsOpen ? 'lesson.trade.closed' : null;
}
/** The job lesson's dead end: the Work Period over without a load done. */
/** The tunnel lesson: up on the ground outside the fence (any side of it). */
function outside(sim: Sim): boolean {
  const zone = sim.playerZone;
  return sim.state.layer === LAYER.GROUND && (zone === 'perimeter' || zone === 'outside');
}
/** The tunnel lesson: dug up inside the fence (never a hole dug down, nor climbing back out through the desk). */
function upInside(e: SimEvent, sim: Sim): Key | null {
  return e.type === 'layer' && e.how === 'digUp' && !outside(sim) ? 'lesson.tunnel.early' : null;
}
function jobFail(c: LessonCtx): Key | null {
  return ROUTINE[c.sim.state.routine].id !== 'work' && c.sim.state.quota === 0 ? 'lesson.job.late' : null;
}
/** An open floor tile beside a prop (where the player stands to use it), the first found round it. */
function besideProp(sim: Sim, prop: number): number | null {
  const p = sim.world.props[prop];
  if (!p) return null;
  for (let x = p.x; x < p.x + p.w; x++)
    for (const z of [p.z - 1, p.z + p.d]) if (isFloor(sim.world, x, z)) return z * MAP_W + x;
  for (let z = p.z; z < p.z + p.d; z++) for (const x of [p.x - 1, p.x + p.w]) if (isFloor(sim.world, x, z)) return z * MAP_W + x;
  return null;
}
/** Where the player stands to work at their desk: below it if that's open floor (the Training Block's chair is at its side), else beside it. */
function deskStand(sim: Sim): number {
  const below = deskTile(sim) + MAP_W;
  return isFloor(sim.world, below % MAP_W, Math.floor(below / MAP_W)) ? below : placesOf(sim.world).deskside[1];
}
/** The laundry machine with a load in it (the first, if none has). */
function loadedMachine(sim: Sim): number {
  const room = jobRooms(sim.world)[LAUNDRY];
  return room.machines.find((i) => sim.state.machines[i] !== undefined) ?? room.machines[0];
}
/** Center Perks' laundry job (its place in the jobs list). */
const LAUNDRY = 0;
/** A machine at work in the player's job room (a load in it). */
function machineOn(sim: Sim): boolean {
  const room = jobRooms(sim.world)[LAUNDRY];
  return !!room && room.machines.some((i) => sim.state.machines[i] !== undefined);
}
/** The player's desk's tile (where a tunnel's entrance goes, under it). */
function deskTile(sim: Sim): number {
  const p = containersOf(sim.world)[myDesk(sim)].prop;
  return p.z * MAP_W + p.x;
}
/** The delivery's vehicle's tail (where the player climbs in). */
function tailOf(sim: Sim): number {
  return sim.prison.delivery!.tail.z * MAP_W + sim.prison.delivery!.tail.x;
}
/** The stowaway lesson's dead end: the vehicle gone without the player. */
function stowFail(c: LessonCtx): Key | null {
  const s = c.sim.state;
  if (s.escaped || s.stowed) return null;
  // (From the sign-off on the supervisor stands at the tail: nobody climbs in unseen any more.)
  const p = planOf(c.sim);
  return dayMinute(s.step) >= searchMinute(p) - SIGN_OFF_MINUTES || (!vehicleIn(c.sim) && dayMinute(s.step) > p.at) ? 'lesson.stowaway.missed' : null;
}
/** The lockpick lesson's dead end: the lockpick broken before the door is open. */
function pickFail(c: LessonCtx): Key | null {
  // (Dropped, it lies there to pick up again.)
  return !carries(c.sim, 'lockpick') && !onFloor(c.sim, 'lockpick') && !c.sim.state.picked.length && c.sim.playerZone !== 'generator' ? 'lesson.lockpick.broke' : null;
}
/** The bluff lesson's dead end: the shift change over and the player not waved through. */
function bluffFail(c: LessonCtx): Key | null {
  const s = c.sim.state;
  return !s.waved && !s.escaped && clockAt(s.step).minuteOfDay >= SHIFT_TO ? 'lesson.bluff.late' : null;
}
/** The glider lesson's dead end: glided and come down inside (the glider wrecked). */
function glideFail(c: LessonCtx): Key | null {
  if (c.sim.state.escaped) return null;
  // (Dropped on the roof, it lies there to pick up again.)
  if (!carries(c.sim, 'glider') && !onFloor(c.sim, 'glider')) return 'lesson.glider.inside';
  return c.sim.state.lockdown ? 'lesson.glider.lockdown' : null;
}
/** The guards lesson's dead ends: the heat cooled off by itself (nothing left to pay off), or the money spent elsewhere. */
function guardsFail(c: LessonCtx): Key | null {
  if (c.sim.state.heat <= 0) return 'lesson.guards.cooled';
  return c.sim.state.cash < 40 ? 'lesson.guards.broke' : null;
}
/** The rat lesson's dead ends before it's tame: the caught rat gone from the pockets (thrown, dropped), or nothing left to feed it. */
function ratFail(c: LessonCtx): Key | null {
  const s = c.sim.state;
  if (petOf(s)) return null;
  if (!carries(c.sim, 'caught_rat')) return 'lesson.rat.lost';
  return baitSlot(s.items.inv) < 0 ? 'lesson.rat.hungry' : null;
}
/** The games lesson's dead end: free time over (and no game on the table) before it's through. */
/** A hand of Cheat folded (walked away from) or broken off: the lesson can't go on. */
function cheatOff(e: SimEvent): Key | null {
  return e.type === 'cheat' && (e.what === 'folded' || e.what === 'off') ? 'lesson.cards.folded' : null;
}
/** A spot on the court, as a tile. */
function spotOn(sim: Sim, k: number): number {
  const q = sim.prison.leisure!.hoop.spots[k];
  return tile(q.x, q.z);
}

/** Bags of pruno in the player's own desk and toilet tank. */
function bagsHidden(sim: Sim): number {
  const list = containersOf(sim.world);
  let k = 0;
  list.forEach((c, i) => {
    if (c.mine && (c.prop.kind === 'desk' || c.prop.kind === 'toilet')) for (const v of sim.state.items.containers[i]) if (itemOf(v) === n('pruno_bag')) k++;
  });
  return k;
}
/** The garden lesson's wilted bed (the plot's last). */
const wiltedBed = (sim: Sim) => {
  const g = sim.prison.leisure!.garden;
  return g.w * g.d - 1;
};
/** A garden bed's tile, a row (dz) off it: where to stand to face it. */
function gardenBed(sim: Sim, k: number, dz: number): number {
  const g = sim.prison.leisure!.garden;
  return tile(g.x + (k % g.w), g.z + Math.floor(k / g.w) + (dz > 0 ? g.d - Math.floor(k / g.w) : -1 - Math.floor(k / g.w)));
}
/** Tonight's race as the state has it (races.ts RACE: 1 the lane bet on, 4 entered), -1 none today. */
function raceState(sim: Sim, k: number): number {
  const r = sim.state.race;
  return r[0] === prisonDay(sim.state.step) ? r[k] : -1;
}
/** Past the off (the card down for tonight). */
const pastOff = (sim: Sim) => dayMinute(sim.state.step) >= RACE_MINUTE - ROUTINE[0].start && !cardUp(sim);
/** The race lesson's dead end: past the off with no bet placed, or no cash to bet. */
function raceFail(c: LessonCtx): Key | null {
  if (raceState(c.sim, 1) >= 0) return null;
  if (pastOff(c.sim)) return 'lesson.ratRace.late';
  return c.sim.state.cash < 5 ? 'lesson.ratRace.broke' : null;
}
/** The track's first tile (the arrows). */
const trackStart = (sim: Sim) => {
  const r = sim.prison.leisure!.race;
  return tile(r.x, r.z);
};

/** Up from the old-timer's board with free time over: no sitting down again until the next. */
function boardFail(c: LessonCtx): Key | null {
  return !c.sim.state.board?.seated && !gamesOpen(c.sim) ? 'lesson.games.closed' : null;
}

/** Why the games can't go on (free time over, nothing under way). */
function gamesFail(c: LessonCtx): Key | null {
  return !gamesOpen(c.sim) && !gameOn(c.sim.state) ? 'lesson.games.closed' : null;
}

/** A tile's middle (units), to measure from. */
const centre = (t: number) => ({ x: (t % MAP_W) * UNIT + UNIT / 2, z: Math.floor(t / MAP_W) * UNIT + UNIT / 2 });
/** The drone's order gone wrong: turned back for tomorrow night (a guard watching where it would land), or seized where it fell. */
function smuggleFail(sim: Sim): Key | null {
  const s = sim.state;
  if (s.order.length === 3 && s.order[2] > prisonDay(s.step)) return 'lesson.smuggle.turned';
  if (!s.order.length && !s.drops.length && !carries(sim, 'battery')) return 'lesson.smuggle.seized';
  return null;
}

/** The football lesson's dead ends: the match off (gone from the pitch, the sirens), a foul, the whistle before a kick. */
/** The stage's own tile (where the performer stands). */
const stageTile = (sim: Sim) => {
  const st = sim.prison.leisure?.stage;
  return st ? tile(st.x, st.z) : null;
};
/** The quiz walked away from or given up. */
function quizFail(e: SimEvent): Key | null {
  return e.type === 'quiz' && (e.what === 'off' || e.what === 'quit') ? 'lesson.quiz.off' : null;
}
function matchFail(e: SimEvent): Key | null {
  if (e.type !== 'football') return null;
  if (e.what === 'off') return 'lesson.football.off';
  if (e.what === 'foul') return 'lesson.football.foul';
  if (e.what === 'won' || e.what === 'lost' || e.what === 'draw') return 'lesson.football.noKick';
  return null;
}
/** The net the player's side shoots at (the far end's middle tile). */
function farNet(sim: Sim): number | null {
  const p = sim.prison.leisure?.pitch;
  if (!p || !sim.state.match) return null;
  return p.w >= p.d ? tile(p.x + p.w - 1, p.z + Math.floor(p.d / 2)) : tile(p.x + Math.floor(p.w / 2), p.z + p.d - 1);
}
/** The tattoo lesson's dead ends: the makings gone (the gun not made and its parts gone; no ink left for what's still to do). */
function inkFail(c: LessonCtx): Key | null {
  const sim = c.sim;
  if (sim.state.ink) return null;
  const gun = carries(sim, 'tattoo_gun') || (carries(sim, 'toothbrush') && carries(sim, 'battery') && carries(sim, 'razor_blade'));
  if (!gun) return 'lesson.tattoo.noGun';
  if (!carries(sim, 'ink')) return 'lesson.tattoo.noInk';
  return null;
}
/** A sitting given up or broken off. */
function inkOff(e: SimEvent): Key | null {
  return e.type === 'tattoo' && (e.what === 'quit' || e.what === 'off') ? 'lesson.tattoo.off' : null;
}

/** The chapters, in order, each its lessons (in the order LESSONS has them). */
export const CHAPTERS: ReadonlyArray<{ id: string; icon: string; lessons: readonly string[] }> = [
  { id: 'basics', icon: 'book', lessons: ['walk', 'search', 'craft', 'routine', 'heat', 'stash', 'dig', 'fight', 'noise', 'escape'] },
  { id: 'getby', icon: 'coin', lessons: ['talk', 'trade', 'job', 'gym', 'disguise', 'tunnel', 'vents'] },
  { id: 'life', icon: 'chat', lessons: ['guards', 'day', 'dogs', 'rat', 'smuggle', 'games', 'cards', 'hoops', 'checkers', 'pruno', 'garden', 'ratRace', 'football', 'tattoo', 'talent', 'quiz', 'crew'] },
  { id: 'ways', icon: 'route', lessons: ['lockpick', 'stowaway', 'bluff', 'glider'] },
];

/** Where a lesson (its index in LESSONS) stands: its chapter, its number in it (from 1) and how many the chapter has. */
export function chapterOf(index: number): { id: string; n: number; of: number } {
  const id = LESSONS[index]?.id;
  const c = CHAPTERS.find((x) => x.lessons.includes(id)) ?? CHAPTERS[0];
  return { id: c.id, n: c.lessons.indexOf(id) + 1, of: c.lessons.length };
}
