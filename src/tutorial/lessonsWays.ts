import { FORGE_INT } from '../content/paperwork';
import { calledNow, freedNow } from '../sim/systems/paperwork';
import { SLOT } from '../sim/command';
import { tileAt } from '../sim/world/grid';
import { maxHealth } from '../sim/systems/combat';
import { STEPS_PER_SECOND, UNIT } from '../sim/tuning';
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
  CANTEEN_ARCH,
  carries,
  KELLER,
  keyBack,
  keyLate,
  keyMissed,
  knockOut,
  MOSS,
  near,
  WOODSHOP_CAM,
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
  EVENING,
  eveningOver,
  MORNING,
  n,
  onFloor,
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
    // Keys (2.37): a guard out cold, his key pressed into putty and put back before he comes round; the mold cast in
    // molten plastic; the generator room's purple door opened with the copy.
    id: 'keys',
    icon: 'key',
    prison: CENTER_PERKS,
    seed: 152,
    setup: (sim) => {
      // (The evening's free time: four minutes, time enough to read and do it.)
      clockTo(sim, EVENING);
      // (Officer Keller, out cold by the generator room's door for two minutes: a blow gives thirty seconds.)
      knockOut(sim, KELLER, 13, 37, 120 * STEPS_PER_SECOND);
      place(sim, 14, 37, 9);
      pockets(sim, 'putty', 'molten_plastic');
      // (Intellect enough for both recipes: 50 for the mold, 60 for the key.)
      sim.state.items.int = Math.max(sim.state.items.int, 60);
    },
    steps: [
      {
        text: 'lesson.keys.search',
        touch: 'lesson.keys.searchTouch',
        done: (c) => carries(c.sim, 'key_purple') || carries(c.sim, 'mold_purple'),
        goal: () => tile(14, 37),
        failOn: keyMissed,
        fail: keyLate,
      },
      {
        text: 'lesson.keys.mold',
        touch: 'lesson.keys.moldTouch',
        done: (c) => carries(c.sim, 'mold_purple') || carries(c.sim, 'plastic_key_purple'),
        failOn: keyMissed,
        fail: keyLate,
      },
      {
        text: 'lesson.keys.back',
        done: (c) => keyBack(c.sim, KELLER, 'key_purple') && !carries(c.sim, 'key_purple'),
        failOn: keyMissed,
      },
      {
        text: 'lesson.keys.cast',
        done: (c) => carries(c.sim, 'plastic_key_purple'),
        failOn: keyMissed,
      },
      { text: 'lesson.keys.door', done: zone('generator'), goal: () => tile(10, 39), failOn: keyMissed },
    ],
  },
  {
    // Cameras and arches (2.37): contraband through the canteen's detector arch in a pouch; the woodshop's camera taped over.
    id: 'cams',
    icon: 'camera',
    prison: CENTER_PERKS,
    seed: 153,
    setup: (sim) => {
      // (The evening's free time: four minutes, time enough to read and do it.)
      clockTo(sim, EVENING);
      place(sim, 44, 22, 13);
      pockets(sim, 'light_cutters', 'pouch', 'duct_tape');
      // (Nothing in hand: the cutters are contraband, a guard who sees them in hand minds.)
      sim.state.items.hand = 1;
    },
    steps: [
      {
        text: 'lesson.cams.arch',
        on: (e) => e.type === 'scanned' && !e.tripped,
        failOn: (e) => (e.type === 'scanned' && e.tripped ? 'lesson.cams.tripped' : null),
        fail: (c) =>
          !carries(c.sim, 'pouch')
            ? 'lesson.cams.noPouch'
            : !carries(c.sim, 'light_cutters')
              ? 'lesson.cams.noCutters'
              : eveningOver('lesson.cams.late')(c),
        goal: () => CANTEEN_ARCH,
      },
      {
        text: 'lesson.cams.tape',
        touch: 'lesson.cams.tapeTouch',
        on: (e) => e.type === 'camera' && e.blind && e.index === WOODSHOP_CAM,
        goal: (sim) => tile(sim.prison.cameras![WOODSHOP_CAM].x, sim.prison.cameras![WOODSHOP_CAM].z),
        fail: (c) =>
          !carries(c.sim, 'duct_tape') && !c.sim.state.cams[WOODSHOP_CAM] ? 'lesson.cams.noTape' : eveningOver('lesson.cams.late')(c),
        failOn: (e) => (e.type === 'scanned' && e.tripped ? 'lesson.cams.tripped' : null),
      },
      { text: 'lesson.cams.blind', done: () => true, least: 6 },
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
    // The grapnel (2.37): from the roof's west edge after Lights Out, hooked over the fence, down the sheet rope outside.
    id: 'grapnel',
    icon: 'hook',
    prison: CENTER_PERKS,
    seed: 154,
    routine: false,
    setup: (sim) => {
      clockTo(sim, at(23, 20));
      // (Up the generator room's ladder, as the vents lesson ends.)
      place(sim, 12, 39, 9);
      sim.state.layer = LAYER.ROOF;
      pockets(sim, 'grapnel', 'sheet_rope');
      sim.state.items.hand = 0;
      fill(
        sim,
        containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'bed'),
        'bed_dummy',
      );
    },
    steps: [
      {
        text: 'lesson.grapnel.edge',
        done: (c) => c.sim.state.escaped > 0 || apart(c.sim.state.player, centre(tile(6, 39))) < 0.7,
        goal: () => tile(6, 39),
        layer: LAYER.ROOF,
      },
      {
        text: 'lesson.grapnel.throw',
        touch: 'lesson.grapnel.throwTouch',
        done: (c) => c.sim.state.escaped > 0,
        // (Dropped on the roof, it lies there to pick up again.)
        fail: (c) =>
          !c.sim.state.escaped && !carries(c.sim, 'sheet_rope') && !onFloor(c.sim, 'sheet_rope') ? 'lesson.grapnel.noRope' : null,
      },
    ],
  },
  {
    // The takeover (2.37): four of the five guards out cold, the last put down, out through the gates left open.
    id: 'takeover',
    icon: 'siren',
    prison: CENTER_PERKS,
    seed: 155,
    setup: (sim) => {
      clockTo(sim, MORNING);
      const s = sim.state;
      // (Out cold for ten minutes, as if just put down one after another: in a game, thirty seconds each.)
      s.guards.forEach((g, k) => {
        if (k !== MOSS) knockOut(sim, k, Math.floor(g.body.x / UNIT), Math.floor(g.body.z / UNIT), 600 * STEPS_PER_SECOND);
      });
      const m = s.guards[MOSS].body;
      const [x, z] = near(sim, Math.floor(m.x / UNIT) + 3, Math.floor(m.z / UNIT));
      place(sim, x, z, 9);
      // Trained, armed and armored, as a takeover takes.
      s.str = 90;
      s.spd = 90;
      s.health = maxHealth(s.str);
      pockets(sim);
      s.items.inv[SLOT.WEAPON] = slot(n('nunchucks'));
      s.items.inv[SLOT.OUTFIT] = slot(n('plated_outfit'));
    },
    steps: [
      {
        text: 'lesson.takeover.fight',
        touch: 'lesson.takeover.fightTouch',
        done: (c) => c.sim.state.takeover || c.sim.state.escaped > 0,
        goal: (sim) => tileAt(sim.state.guards[MOSS].body.x, sim.state.guards[MOSS].body.z),
        // (Too long about it: the four come round, and it's no takeover any more.)
        fail: (c) =>
          c.sim.state.ko > 0
            ? 'lesson.takeover.down'
            : !c.sim.state.takeover && c.sim.state.guards.some((g, k) => k !== MOSS && g.ko <= 0)
              ? 'lesson.takeover.over'
              : null,
      },
      {
        text: 'lesson.takeover.out',
        done: (c) => c.sim.state.escaped > 0,
        goal: () => tile(30, 62),
        fail: (c) =>
          c.sim.state.ko > 0 ? 'lesson.takeover.down' : !c.sim.state.takeover && !c.sim.state.escaped ? 'lesson.takeover.over' : null,
      },
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
