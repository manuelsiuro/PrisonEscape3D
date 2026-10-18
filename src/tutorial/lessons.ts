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
import { MAP_W } from '../sim/world/World';
import { CENTER_PERKS } from '../content/prisons/center-perks';
import { DAY_EVENTS } from '../content/days';
import { isFloor } from '../sim/ai/places';
import { lineOfSight } from '../sim/ai/sight';
import { WATCH_RANGE } from '../content/crew';
import { ORDER } from '../sim/command';
import { DAY_STEPS, planOf, prisonDay, TODAY } from '../sim/systems/calendar';
import { postOf } from '../sim/systems/crew';
import { smellsOfContraband } from '../sim/systems/k9';
import { guardTalking } from '../sim/systems/social';
import { dropTile } from '../sim/systems/smuggling';
import { gameOn, gameRefusal, gamesOpen } from '../sim/systems/games';
import { baitSlot, petOf } from '../sim/systems/rats';

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
  /** Where the floor arrows lead meanwhile (a tile), if anywhere. */
  goal?: (sim: Sim) => number | null;
  /** The game runs faster while this step waits (time to pass, nothing to do). */
  speed?: number;
  /** Seconds it shows at least before it can tick (something to read in it; the lesson's card only, not tutorialtest). */
  least?: number;
  /** Why the lesson can't go on now (it ends, to be tried again), if it can't; null while it can. */
  fail?: (c: LessonCtx) => Key | null;
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
        fail: (c) => (count(c.sim, 'firecracker') === 0 && !c.sim.state.fuses.length ? 'lesson.noise.missed' : null),
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
        fail: (c) => (c.sim.state.order.length === 3 && c.sim.state.order[2] > prisonDay(c.sim.state.step) ? 'lesson.smuggle.late' : null),
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
          return at >= 0 && !seesRound(c.sim, at, 0) ? 'lesson.crew.far' : null;
        },
      },
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

/** The chapters, in order, each its lessons (in the order LESSONS has them). */
export const CHAPTERS: ReadonlyArray<{ id: string; icon: string; lessons: readonly string[] }> = [
  { id: 'basics', icon: 'book', lessons: ['walk', 'search', 'craft', 'routine', 'heat', 'stash', 'dig', 'fight', 'noise', 'escape'] },
  { id: 'life', icon: 'chat', lessons: ['guards', 'day', 'dogs', 'rat', 'smuggle', 'games', 'crew'] },
];

/** Where a lesson (its index in LESSONS) stands: its chapter, its number in it (from 1) and how many the chapter has. */
export function chapterOf(index: number): { id: string; n: number; of: number } {
  const id = LESSONS[index]?.id;
  const c = CHAPTERS.find((x) => x.lessons.includes(id)) ?? CHAPTERS[0];
  return { id: c.id, n: c.lessons.indexOf(id) + 1, of: c.lessons.length };
}
