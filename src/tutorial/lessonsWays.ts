import { FORGE_INT } from '../content/paperwork';
import { calledNow, freedNow } from '../sim/systems/paperwork';
import { SLOT } from '../sim/command';
import { slot } from '../sim/systems/items';
import { containersOf } from '../sim/world/containers';
import { LAYER, MAP_W } from '../sim/world/World';
import { CENTER_PERKS } from '../content/prisons/center-perks';
import { DAY_EVENTS, WEATHERS } from '../content/days';
import { atWindow, checkpointOf } from '../sim/systems/getaway';
import { atTail } from '../sim/systems/delivery';
import { HOLDER } from '../sim/systems/economy';
import { DAY_STEPS } from '../sim/systems/calendar';
import { DAY, FEAT } from '../sim/systems/ledger';
import { RECORD } from '../content/parole';
import { OVER } from '../sim/hunt/Hunt';
import { spotTile } from '../sim/hunt/world';
import {
  apart,
  at,
  bluffFail,
  carries,
  centre,
  clockTo,
  DAY_TWO,
  fill,
  forgeryLate,
  glideFail,
  goneBy,
  hearingSeat,
  huntCaught,
  huntWalked,
  type Lesson,
  lineGoal,
  MORNING,
  n,
  paroleLost,
  pickFail,
  place,
  pockets,
  releaseShut,
  releaseTile,
  releaseTurned,
  STOW_SEED,
  stowFail,
  tailOf,
  tile,
  zone,
} from './kit';

/** The ways out (the last chapter): a lock picked, stowed away, a bluff, a glider, forged papers, release, parole, the manhunt. Out of lessons.ts (v2.34.2), in LESSONS' order (a lesson without a seed of its own takes its place's). */
export const WAYS: readonly Lesson[] = [
  {
    // The lockpick (P22): a keyed door opened without its key, pin by pin.
    id: 'lockpick',
    icon: 'lockpick',
    // (Its seed as it was before the phone's lessons came before it in the list.)
    seed: 43,
    setup: (sim) => {
      clockTo(sim, MORNING);
      place(sim, 42, 22, 13);
      pockets(sim, 'lockpick');
      sim.state.items.hand = 0;
    },
    steps: [
      {
        text: 'lesson.lockpick.start',
        touch: 'lesson.lockpick.startTouch',
        on: (e) => e.type === 'pick' && e.what === 'start',
        goal: () => tile(42, 22),
        fail: pickFail,
      },
      {
        text: 'lesson.lockpick.pins',
        touch: 'lesson.lockpick.pinsTouch',
        done: (c) => c.sim.state.picked.length > 0 || zone('generator')(c),
        fail: pickFail,
      },
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
      {
        text: 'lesson.stowaway.hide',
        touch: 'lesson.stowaway.hideTouch',
        done: (c) => c.sim.state.stowed || c.sim.state.escaped > 0,
        goal: tailOf,
        fail: stowFail,
      },
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
      {
        text: 'lesson.bluff.window',
        done: (c) => atWindow(c.sim) || c.sim.state.waved > 0,
        goal: (sim) => checkpointOf(sim)!.window[0].z * MAP_W + checkpointOf(sim)!.window[0].x,
        fail: bluffFail,
      },
      {
        text: 'lesson.bluff.show',
        touch: 'lesson.bluff.showTouch',
        done: (c) => c.sim.state.waved > 0 || c.sim.state.escaped > 0,
        fail: bluffFail,
      },
      {
        text: 'lesson.bluff.out',
        done: (c) => c.sim.state.escaped > 0,
        fail: (c) => (!c.sim.state.waved && !c.sim.state.escaped ? 'lesson.bluff.shut' : null),
        goal: (sim) => (checkpointOf(sim)!.gates[0].z + 1) * MAP_W + checkpointOf(sim)!.gates[0].x,
      },
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
      fill(
        sim,
        containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'bed'),
        'bed_dummy',
      );
    },
    steps: [
      {
        text: 'lesson.glider.edge',
        done: (c) => c.sim.state.escaped > 0 || apart(c.sim.state.player, centre(tile(57, 39))) < 0.7,
        goal: () => tile(57, 39),
        layer: LAYER.ROOF,
        fail: glideFail,
      },
      { text: 'lesson.glider.fly', touch: 'lesson.glider.flyTouch', done: (c) => c.sim.state.escaped > 0, fail: glideFail },
    ],
  },
  {
    // The paperwork escape, part one (P36): a blank release form forged and slipped into the release desk's tray, then the records at 22:00.
    id: 'forgery',
    icon: 'clipboard',
    prison: CENTER_PERKS,
    seed: 43,
    setup: (sim) => {
      // (An hour and a half before the records at 22:00: time to read, forge, walk and file.)
      clockTo(sim, at(20, 30));
      // (In the visiting room, the release desk by its south doors.)
      place(sim, 30, 40, 5);
      pockets(sim, 'release_form', 'ink');
      sim.state.items.int = FORGE_INT;
    },
    steps: [
      {
        text: 'lesson.forgery.forge',
        touch: 'lesson.forgery.forgeTouch',
        done: (c) => carries(c.sim, 'forged_release') || c.sim.state.release[0] > 0,
        fail: forgeryLate,
      },
      {
        text: 'lesson.forgery.file',
        touch: 'lesson.forgery.fileTouch',
        done: (c) => c.sim.state.release[0] > 0,
        goal: (sim) => releaseTile(sim),
        fail: forgeryLate,
      },
      {
        text: 'lesson.forgery.records',
        speed: 4,
        on: (e) => e.type === 'paper' && e.what === 'passed',
        failOn: (e) => (e.type === 'paper' && e.what === 'found' ? 'lesson.forgery.found' : null),
      },
    ],
  },
  {
    // The paperwork escape, part two (P36): the name called at 10:00, cleared at the desk, out through the doors.
    id: 'release',
    icon: 'run',
    prison: CENTER_PERKS,
    seed: 44,
    setup: (sim) => {
      clockTo(sim, DAY_TWO + at(9, 55));
      place(sim, 30, 39, 5);
      pockets(sim);
      sim.state.release = [2, 0];
    },
    steps: [
      { text: 'lesson.release.wait', done: (c) => calledNow(c.sim.state) || freedNow(c.sim.state), goal: (sim) => releaseTile(sim) },
      {
        text: 'lesson.release.report',
        touch: 'lesson.release.reportTouch',
        done: (c) => freedNow(c.sim.state) || c.sim.state.escaped > 0,
        goal: (sim) => releaseTile(sim),
        failOn: releaseTurned,
      },
      { text: 'lesson.release.out', done: (c) => c.sim.state.escaped > 0, goal: () => tile(30, 62), fail: releaseShut },
    ],
  },
  {
    // The parole board (P39): a week's record behind the player (forced: three days' work, the routine kept, one scuffle), the hearing at 10:00 in the visiting room.
    id: 'parole',
    icon: 'scale',
    prison: CENTER_PERKS,
    // (The board asks about fights first, then work, then the heat: a lie to see through, two claims the file bears out.)
    seed: 145,
    setup: (sim) => {
      const s = sim.state;
      s.calendar = [[10, 0, 0]];
      clockTo(sim, 9 * DAY_STEPS + at(9, 50));
      // (In the canteen, the visiting room's doors to the south.)
      place(sim, 31, 36, 5);
      pockets(sim);
      // Applied on day 3; the record since, as the ledger has it.
      s.parole = [10, 3, 0, 0, 0, 0, -1, -1, 1, 0];
      s.paroleBase = RECORD.map(() => 0);
      s.feats[FEAT.wages] = 3;
      s.feats[FEAT.rollCallsKept] = 14;
      s.feats[FEAT.mealsKept] = 14;
      s.feats[FEAT.showersKept] = 7;
      s.days = new Array(9).fill(0);
      s.days[5] = DAY.FIGHT | DAY.STARTED;
    },
    steps: [
      { text: 'lesson.parole.go', done: (c) => !!c.sim.state.hearing, goal: (sim) => hearingSeat(sim), speed: 2, failOn: paroleLost },
      {
        text: 'lesson.parole.read',
        touch: 'lesson.parole.readTouch',
        least: 4,
        on: (e) => e.type === 'parole' && (e.what === 'answer' || e.what === 'silent'),
        failOn: paroleLost,
      },
      { text: 'lesson.parole.rest', on: (e) => e.type === 'parole' && e.what === 'granted', failOn: paroleLost },
      // (The verdict's card a moment, to be read.)
      { text: 'lesson.parole.over', done: () => true, least: 6 },
    ],
  },
  // P41: the manhunt, outside Center Perks: into the woods, a thicket while a searcher goes by, clothes off a line, Lou's car.
  {
    id: 'manhunt',
    icon: 'flag',
    prison: CENTER_PERKS,
    seed: 45,
    hunt: { kind: 'wall', searchers: [3], headStart: 0, minute: 23 * 60 + 30, lou: true },
    setup: () => {},
    steps: [
      { text: 'lesson.manhunt.run', done: (c) => !!c.hunt && huntWalked(c.hunt) >= 5, fail: huntCaught },
      {
        text: 'lesson.manhunt.hide',
        done: (c) => !!c.hunt && goneBy(c.hunt),
        fail: huntCaught,
        huntGoal: (h) => (i) => h.out.cover[i] === 1,
      },
      { text: 'lesson.manhunt.clothes', done: (c) => c.hunt?.state.clothes === 2, fail: huntCaught, huntGoal: lineGoal },
      {
        text: 'lesson.manhunt.lou',
        done: (c) => !!c.hunt && (c.hunt.state.over === OVER.LOU || c.hunt.state.over === OVER.SAFE),
        fail: huntCaught,
        huntGoal: (h) => {
          const lou = spotTile(h.def.lou, h.out.ox, h.out.oz);
          return (i) => i === lou;
        },
      },
    ],
  },
];
