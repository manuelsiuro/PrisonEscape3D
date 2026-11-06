import { placesOf } from '../sim/ai/places';
import { jamsAt, VEND_PLAYER } from '../sim/systems/vending';
import { mealOn } from '../sim/systems/canteen';
import type { SimEvent } from '../sim/events';
import type { Key } from '../i18n';
import type { LessonCtx } from './kit';
import type { Sim } from '../sim/Sim';
import { ROUTINE } from '../content/routine';
import { atPhone, placeInLine } from '../sim/systems/phone';
import { jobOf } from '../sim/systems/oddjobs';
import { J, KIND, STAGE } from '../content/oddjobs';
import { CALLEE } from '../content/phone';
import { itemDef } from '../content/items';
import { STEPS_PER_MINUTE, UNIT } from '../sim/tuning';
import { MAP_W } from '../sim/world/World';
import { CENTER_PERKS } from '../content/prisons/center-perks';
import { HOLDER, jobRooms } from '../sim/systems/economy';
import { prisonDay } from '../sim/systems/calendar';
import { FEAT } from '../sim/systems/ledger';
import { onOwnSquare } from '../sim/systems/rollcall';
import { tileAt } from '../sim/world/grid';
import {
  at,
  besideProp,
  carries,
  clockTo,
  GARDENER,
  jobFail,
  jobTile,
  kioskFail,
  kioskLeft,
  lapsFail,
  type Lesson,
  loadedMachine,
  machineOn,
  MORNING,
  nearestMachine,
  nextCorner,
  onBoard,
  phoneFail,
  place,
  pockets,
  tile,
  zone,
} from './kit';

/** The vending lesson's count of buys to start from: the next comes out, the one after sticks. */
const vendLessonBuys = (salt: number) => {
  let n = 1;
  while (jamsAt(salt, n + 1) || !jamsAt(salt, n + 2)) n++;
  return n;
};
/** A meal's lesson: the meal over, or the tray gone. */
const mealFail = (c: LessonCtx): Key | null => (mealOn(c.sim) ? null : 'lesson.meals.lost');
const trayLost = (e: SimEvent): Key | null => (e.type === 'tray' && e.what !== 'take' && e.what !== 'return' ? 'lesson.meals.lost' : null);
/** Roll call's lesson: roll call over. */
const rollCallFail = (c: LessonCtx): Key | null => (ROUTINE[c.sim.state.routine].id === 'rollCall' ? null : 'lesson.rollcall.lost');
/** The warden came to their square and they weren't in the yard. */
const uncalled = (e: SimEvent): Key | null =>
  e.type === 'count' && ((e.what === 'called' && e.who < 0) || e.what === 'missed') ? 'lesson.rollcall.lost' : null;
/** Lights Out's walk home: caught out late. */
const nightFail = (c: LessonCtx): Key | null => (c.sim.state.lockdown || c.sim.state.solitary > 0 ? 'lesson.night.late' : null);
/** The bed's night offers are over at 08:00: asleep past the tuck, or simply waited out. */
const morningFail = (c: LessonCtx): Key | null => (ROUTINE[c.sim.state.routine].id === 'lightsOut' ? null : 'lesson.night.morning');
const showerFail = (c: LessonCtx): Key | null => (ROUTINE[c.sim.state.routine].id === 'showers' ? null : 'lesson.showers.lost');

/** A shower head nobody's under, and if there's one, nobody's heading for: whoever gets there first has it. */
function freeShower(sim: Sim): number | null {
  const under = (t: number) => sim.state.inmates.some((m) => !m.body.moving && tileAt(m.body.x, m.body.z) === t);
  const heads = placesOf(sim.world).showers.filter((h) => !under(h.tile));
  return (heads.find((h) => !sim.state.inmates.some((m) => m.goal === h.tile)) ?? heads[0])?.tile ?? null;
}

/** The nearest seat nobody's using or keeping. */
function freeSeat(sim: Sim): number | null {
  const s = sim.state;
  const x = Math.floor(s.player.x / UNIT);
  const z = Math.floor(s.player.z / UNIT);
  const apart = (t: number) => Math.abs((t % MAP_W) - x) + Math.abs(Math.floor(t / MAP_W) - z);
  const free = placesOf(sim.world).seats.filter((q) => !s.inmates.some((m) => m.goal === q.tile || m.seat === q.tile));
  return free.length ? free.reduce((a, b) => (apart(b.tile) < apart(a.tile) ? b : a)).tile : null;
}

/** Life inside, its second half (the third chapter): laps, meals, showers, roll call, the night, the gardener, the library, the vending machine, the menu board, the phone, the kiosk, an odd job. Out of lessons.ts (v2.34.2), in LESSONS' order (a lesson without a seed of its own takes its place's). */
export const DAYS: readonly Lesson[] = [
  {
    // The sports ground (P31): a lap of the running track for Speed, a set on the pull-up bar for Strength.
    id: 'laps',
    icon: 'run',
    setup: (sim) => {
      clockTo(sim, MORNING);
      place(sim, 31, 38, 1);
      sim.state.energy = 100;
    },
    steps: [
      { text: 'lesson.laps.go', done: zone('sports'), goal: () => tile(35, 39), fail: lapsFail },
      { text: 'lesson.laps.run', on: (e) => e.type === 'lap', goal: (sim) => nextCorner(sim), fail: lapsFail },
      {
        text: 'lesson.laps.pullup',
        touch: 'lesson.laps.pullupTouch',
        on: (e) => e.type === 'trained' && e.attr === 'str',
        goal: (sim) =>
          besideProp(
            sim,
            sim.world.props.findIndex((q) => q.kind === 'pullup'),
          ),
        fail: lapsFail,
      },
    ],
  },
  {
    // Meals (2.25): a breakfast at Center Perks, the tray from the counter to a table and back.
    id: 'meals',
    icon: 'utensils',
    prison: CENTER_PERKS,
    seed: 58,
    setup: (sim) => {
      clockTo(sim, at(9, 2));
      place(sim, 50, 12, 13);
      sim.state.energy = 40;
    },
    steps: [
      {
        text: 'lesson.meals.take',
        touch: 'lesson.meals.takeTouch',
        on: (e) => e.type === 'tray' && e.what === 'take',
        goal: (sim) => placesOf(sim.world).counters[2].tile,
        fail: mealFail,
      },
      {
        text: 'lesson.meals.sit',
        touch: 'lesson.meals.sitTouch',
        done: (c) => c.sim.state.seat >= 0,
        goal: freeSeat,
        fail: mealFail,
        failOn: trayLost,
      },
      { text: 'lesson.meals.eat', on: (e) => e.type === 'meal', fail: mealFail, failOn: trayLost },
      {
        text: 'lesson.meals.back',
        touch: 'lesson.meals.backTouch',
        on: (e) => e.type === 'tray' && e.what === 'return',
        goal: (sim) => placesOf(sim.world).counters[2].tile,
        fail: mealFail,
        failOn: trayLost,
      },
    ],
  },
  {
    // Showers (2.26): the block at Center Perks, the water turned on, energy and heat, walked away from.
    id: 'showers',
    icon: 'water',
    prison: CENTER_PERKS,
    seed: 59,
    setup: (sim) => {
      clockTo(sim, at(16, 2));
      place(sim, 19, 27, 13);
      sim.state.energy = 40;
      sim.state.heat = 18;
    },
    steps: [
      {
        text: 'lesson.showers.on',
        touch: 'lesson.showers.onTouch',
        on: (e) => e.type === 'wash' && e.on,
        goal: freeShower,
        fail: showerFail,
      },
      // (+25: too far for the slow climb on its own to skip this, 10 s under the water.)
      { text: 'lesson.showers.wash', done: (c) => c.sim.state.energy >= 65 || !c.sim.state.washing, fail: showerFail },
      { text: 'lesson.showers.off', on: (e) => e.type === 'wash' && !e.on },
    ],
  },
  {
    // Roll call (2.27): the morning's at Center Perks, the square, the warden's call, the badge.
    id: 'rollcall',
    icon: 'bell',
    prison: CENTER_PERKS,
    seed: 60,
    setup: (sim) => {
      clockTo(sim, at(8, 2));
      place(sim, 31, 11, 9);
      // (Still to be counted, unlike a lesson about something else; a third of the badge already there, so as not to wait the whole half hour.)
      sim.state.attended = false;
      sim.state.blocks[sim.state.routine] = 0;
      sim.state.present = 10 * STEPS_PER_MINUTE;
    },
    steps: [
      {
        text: 'lesson.rollcall.square',
        done: (c) => onOwnSquare(c.sim),
        goal: (sim) => placesOf(sim.world).rollCall[0].tile,
        fail: rollCallFail,
        failOn: uncalled,
      },
      {
        text: 'lesson.rollcall.wait',
        done: (c) => c.sim.state.calling > 0,
        goal: (sim) => placesOf(sim.world).rollCall[0].tile,
        fail: rollCallFail,
        failOn: uncalled,
      },
      {
        text: 'lesson.rollcall.answer',
        touch: 'lesson.rollcall.answerTouch',
        on: (e) => e.type === 'count' && e.what === 'answered',
        fail: rollCallFail,
        failOn: uncalled,
      },
      {
        text: 'lesson.rollcall.stay',
        done: (c) => c.sim.state.attended,
        goal: (sim) => placesOf(sim.world).rollCall[0].tile,
        fail: rollCallFail,
      },
    ],
  },
  {
    // Lights Out (2.28): home by the end of the grace, the dummy in and out of the bed at night, and to sleep.
    id: 'night',
    icon: 'moon',
    prison: CENTER_PERKS,
    seed: 64,
    setup: (sim) => {
      clockTo(sim, at(22, 50));
      place(sim, 31, 11, 9);
      pockets(sim, 'bed_dummy');
      sim.state.energy = 40;
    },
    steps: [
      {
        text: 'lesson.night.home',
        done: (c) => c.sim.playerZone === 'playerCell',
        goal: (sim) => placesOf(sim.world).bedside[1],
        fail: nightFail,
      },
      { text: 'lesson.night.bell', done: (c) => ROUTINE[c.sim.state.routine].id === 'lightsOut', speed: 3 },
      {
        text: 'lesson.night.tuck',
        touch: 'lesson.night.tuckTouch',
        on: (e) => e.type === 'bedDummy' && e.in,
        goal: (sim) => placesOf(sim.world).bedside[1],
        fail: morningFail,
      },
      { text: 'lesson.night.out', touch: 'lesson.night.outTouch', on: (e) => e.type === 'bedDummy' && !e.in, fail: morningFail },
      { text: 'lesson.night.sleep', touch: 'lesson.night.sleepTouch', done: (c) => c.sim.state.sleeping, fail: morningFail },
      { text: 'lesson.night.wake', done: (c) => !c.sim.state.sleeping },
    ],
  },
  {
    // The gardener (P31): the Work Period in the vegetable garden, seedlings into a planter, a crate of produce for the kitchen.
    id: 'gardener',
    icon: 'sprout',
    prison: CENTER_PERKS,
    seed: 62,
    setup: (sim) => {
      clockTo(sim, at(12, 1));
      sim.state.jobs = sim.state.jobs.map((h, k) => (k === GARDENER ? HOLDER.PLAYER : h === HOLDER.PLAYER ? HOLDER.NOBODY : h));
      sim.state.jobDay = 1;
      place(sim, 47, 37, 5);
    },
    steps: [
      {
        text: 'lesson.gardener.go',
        done: zone('garden'),
        goal: (sim) => besideProp(sim, jobRooms(sim.world)[GARDENER].take),
        fail: jobFail,
      },
      {
        text: 'lesson.gardener.take',
        touch: 'lesson.gardener.takeTouch',
        done: (c) => carries(c.sim, 'seedlings') || machineOn(c.sim, GARDENER) || c.sim.state.quota > 0,
        goal: (sim) => besideProp(sim, jobRooms(sim.world)[GARDENER].take),
        fail: jobFail,
      },
      {
        text: 'lesson.gardener.plant',
        touch: 'lesson.gardener.plantTouch',
        done: (c) => machineOn(c.sim, GARDENER) || carries(c.sim, 'produce') || c.sim.state.quota > 0,
        goal: (sim) => besideProp(sim, nearestMachine(sim, GARDENER)),
        fail: jobFail,
      },
      {
        text: 'lesson.gardener.crate',
        done: (c) => c.sim.state.quota > 0,
        goal: (sim) => besideProp(sim, carries(sim, 'produce') ? jobRooms(sim.world)[GARDENER].put : loadedMachine(sim, GARDENER)),
        fail: jobFail,
      },
    ],
  },
  {
    // The library (2.31): a book off the shelf, read on a chair, a set done.
    id: 'library',
    icon: 'book',
    prison: CENTER_PERKS,
    seed: 146,
    setup: (sim) => {
      clockTo(sim, at(10, 2));
      place(sim, 17, 31, 13);
      sim.state.energy = 100;
    },
    steps: [
      { text: 'lesson.library.take', touch: 'lesson.library.takeTouch', on: (e) => e.type === 'book' && e.on },
      {
        text: 'lesson.library.sit',
        touch: 'lesson.library.sitTouch',
        done: (c) => c.sim.state.train >= 0,
        fail: (c) => (c.sim.state.book ? null : 'lesson.library.left'),
      },
      {
        text: 'lesson.library.read',
        touch: 'lesson.library.readTouch',
        on: (e) => e.type === 'trained',
        fail: (c) => (c.sim.state.book ? null : 'lesson.library.left'),
      },
      { text: 'lesson.library.over', done: () => true, least: 8 },
    ],
  },
  {
    // The vending machine (2.32): a soda bought and drunk, then something that sticks and is thumped free.
    id: 'vending',
    icon: 'cart',
    prison: CENTER_PERKS,
    seed: 147,
    setup: (sim) => {
      clockTo(sim, at(10, 2));
      const m = sim.world.def.vending!;
      place(sim, m.line[0].x, m.line[0].z, 13);
      const s = sim.state;
      s.cash = 40;
      s.energy = 50;
      // (This seed's first buy comes out and its next sticks, wherever the rolls fall.)
      s.vendBought = vendLessonBuys(s.salt);
      // (The machine to themselves: nobody coming to take the turn or thump what's stuck while they read.)
      s.vend.day = prisonDay(s.step);
      s.vend.asked = [~0, ~0];
    },
    steps: [
      { text: 'lesson.vending.open', touch: 'lesson.vending.openTouch', done: (c) => c.sim.state.vendOpen },
      {
        text: 'lesson.vending.buy',
        touch: 'lesson.vending.buyTouch',
        on: (e) => e.type === 'vend' && e.what === 'got' && !!e.item && !!itemDef(e.item).food,
      },
      { text: 'lesson.vending.drink', touch: 'lesson.vending.drinkTouch', on: (e) => e.type === 'ate' },
      // (By the state, not an event: a second thing bought before drinking the first has already stuck, and been freed.)
      {
        text: 'lesson.vending.again',
        done: (c) => c.sim.state.vendBought >= vendLessonBuys(c.sim.state.salt) + 2 && c.sim.state.vend.who !== VEND_PLAYER,
      },
      { text: 'lesson.vending.thump', done: (c) => !c.sim.state.vend.jam },
      { text: 'lesson.vending.over', done: () => true, least: 8 },
    ],
  },
  {
    // The menu board and the water cooler (2.33): the day's dishes read, a scribble on the board, a cup at the cooler.
    id: 'menu',
    icon: 'utensils',
    prison: CENTER_PERKS,
    seed: 148,
    setup: (sim) => {
      clockTo(sim, at(10, 2));
      const m = sim.world.def.menu!;
      place(sim, m.x + 2, m.z + 1, 13);
      const s = sim.state;
      s.energy = 50;
      // (The cooler theirs while they read: nobody comes for a drink in the lesson's morning.)
      s.cooler.day = prisonDay(s.step);
      s.cooler.asked = [~0, ~0];
    },
    steps: [
      { text: 'lesson.menu.read', touch: 'lesson.menu.readTouch', done: (c) => c.sim.state.menuOpen },
      { text: 'lesson.menu.dishes', done: () => true, least: 7 },
      { text: 'lesson.menu.scribble', touch: 'lesson.menu.scribbleTouch', done: (c) => c.sim.state.menu.scribbled > 0 },
      {
        text: 'lesson.menu.cooler',
        touch: 'lesson.menu.coolerTouch',
        on: (e) => e.type === 'cooler' && e.what === 'drank',
        goal: (sim) => sim.world.def.cooler!.spots[1].z * 64 + sim.world.def.cooler!.spots[1].x,
      },
      { text: 'lesson.menu.over', done: () => true, least: 8 },
    ],
  },
  {
    // The pay phone (P34): someone on it, a place in line, a secret overheard while waiting, a call home, the money at mail call.
    id: 'payphone',
    icon: 'phone',
    prison: CENTER_PERKS,
    seed: 91,
    setup: (sim) => {
      clockTo(sim, at(10, 2));
      const s = sim.state;
      const c = sim.prison.comms!;
      s.cash = 10;
      // Rusty on the phone, a long call (day 1: nobody else queues).
      const on = 0;
      const m = s.inmates[on];
      m.body.x = c.phone.x * UNIT + UNIT / 2;
      m.body.z = c.phone.z * UNIT + UNIT / 2;
      m.goal = -1;
      m.path = [];
      s.booth = [on, s.step + 40 * STEPS_PER_MINUTE, 0, s.step];
      place(sim, c.line[2].x, c.line[2].z + 1, 13);
    },
    steps: [
      {
        text: 'lesson.payphone.join',
        touch: 'lesson.payphone.joinTouch',
        on: (e) => e.type === 'phone' && e.what === 'joined' && e.who === -1,
        goal: (sim) => tile(sim.prison.comms!.line[0].x, sim.prison.comms!.line[0].z),
        fail: (c) => (c.sim.state.booth[0] < 0 ? 'lesson.payphone.missed' : phoneFail(c)),
      },
      {
        text: 'lesson.payphone.listen',
        on: (e) => e.type === 'phone' && e.what === 'overheard',
        goal: (sim) => tile(sim.prison.comms!.line[0].x, sim.prison.comms!.line[0].z),
        fail: (c) => (c.sim.state.booth[0] < 0 && !c.sim.state.phoned[4] ? 'lesson.payphone.missed' : phoneFail(c)),
      },
      {
        text: 'lesson.payphone.call',
        on: (e) => e.type === 'phone' && e.what === 'home',
        goal: (sim) => tile(sim.prison.comms!.phone.x, sim.prison.comms!.phone.z),
        fail: (c) => (placeInLine(c.sim.state) < 0 && !c.sim.state.call && !atPhone(c.sim) ? 'lesson.payphone.left' : phoneFail(c)),
      },
      { text: 'lesson.payphone.mail', on: (e) => e.type === 'phone' && e.what === 'mail', speed: 8 },
    ],
  },
  {
    // Cousin Lou (P34): a cake with a file in it, asked for on a tapped line in three phrases.
    id: 'cousin',
    icon: 'route',
    prison: CENTER_PERKS,
    seed: 92,
    setup: (sim) => {
      clockTo(sim, at(10, 2));
      sim.state.cash = 60;
      const c = sim.prison.comms!;
      place(sim, c.phone.x, c.phone.z, c.phone.face);
    },
    steps: [
      {
        text: 'lesson.cousin.dial',
        on: (e) => e.type === 'phone' && e.what === 'call' && e.to === CALLEE.COUSIN,
        goal: (sim) => tile(sim.prison.comms!.phone.x, sim.prison.comms!.phone.z),
        fail: phoneFail,
      },
      {
        text: 'lesson.cousin.say',
        touch: 'lesson.cousin.sayTouch',
        on: (e) => e.type === 'phone' && e.what === 'lou' && !!e.ok && !e.blown,
        failOn: (e) =>
          e.type === 'phone'
            ? e.what === 'lou' && !e.ok
              ? 'lesson.cousin.lost'
              : e.what === 'lou' && e.blown
                ? 'lesson.cousin.blown'
                : e.what === 'silence' || e.what === 'hungUp'
                  ? 'lesson.cousin.hungUp'
                  : null
            : null,
      },
      { text: 'lesson.cousin.over', done: () => true, least: 8 },
    ],
  },
  {
    // The internet kiosk (P35): logged in at the library's terminal, a letter home, an order off the shop, a course, mail call.
    id: 'kiosk',
    icon: 'monitor',
    prison: CENTER_PERKS,
    seed: 93,
    setup: (sim) => {
      clockTo(sim, at(10, 2));
      sim.state.cash = 30;
      sim.state.energy = 80;
      const k = sim.prison.comms!.kiosk;
      place(sim, k.x, k.z + 3, 13);
    },
    steps: [
      {
        text: 'lesson.kiosk.login',
        touch: 'lesson.kiosk.loginTouch',
        on: (e) => e.type === 'kiosk' && e.what === 'login',
        goal: (sim) => tile(sim.prison.comms!.kiosk.x, sim.prison.comms!.kiosk.z),
        fail: kioskFail,
      },
      // (Done by what the day holds, not the moment: a letter, an order, a course done before their step still count.)
      {
        text: 'lesson.kiosk.write',
        touch: 'lesson.kiosk.writeTouch',
        done: (c) => c.sim.state.post[0] === prisonDay(c.sim.state.step),
        fail: kioskLeft,
      },
      {
        text: 'lesson.kiosk.order',
        touch: 'lesson.kiosk.orderTouch',
        done: (c) => c.sim.state.post[4] === prisonDay(c.sim.state.step),
        fail: kioskLeft,
      },
      {
        text: 'lesson.kiosk.course',
        touch: 'lesson.kiosk.courseTouch',
        done: (c) => c.sim.state.feats[FEAT.courses] > 0,
        // (Today's course begun and over without an end: given up, or cut short by logging out.)
        fail: (c) =>
          kioskLeft(c) ??
          (c.sim.state.post[5] === prisonDay(c.sim.state.step) && !c.sim.state.course.length && !c.sim.state.feats[FEAT.courses]
            ? 'lesson.kiosk.quit'
            : null),
      },
      { text: 'lesson.kiosk.mail', on: (e) => e.type === 'kiosk' && e.what === 'goods', speed: 8 },
      { text: 'lesson.kiosk.over', done: () => true, least: 8 },
    ],
  },
  {
    // The odd jobs board (P40): the board read, the Delivery taken (seed 94's middle pin), the parcel given, the job handed in.
    id: 'oddjob',
    icon: 'pin',
    prison: CENTER_PERKS,
    seed: 94,
    setup: (sim) => {
      clockTo(sim, at(10, 5));
      sim.state.energy = 80;
      const b = sim.prison.board!;
      place(sim, b.x, b.z + 4, 13);
    },
    steps: [
      { text: 'lesson.oddjob.board', done: (c) => onBoard(c.sim), goal: (sim) => tile(sim.prison.board!.x, sim.prison.board!.z) },
      {
        text: 'lesson.oddjob.take',
        done: (c) => jobOf(c.sim.state)?.[J.KIND] === KIND.DELIVER,
        failOn: (e) => (e.type === 'oddjob' && e.what === 'taken' && e.kind !== KIND.DELIVER ? 'lesson.oddjob.wrong' : null),
      },
      {
        text: 'lesson.oddjob.give',
        touch: 'lesson.oddjob.giveTouch',
        done: (c) => jobOf(c.sim.state)?.[J.STAGE] === STAGE.DONE,
        goal: (sim) => jobTile(sim, J.TARGET),
        fail: (c) => (jobOf(c.sim.state) ? null : 'lesson.oddjob.lost'),
      },
      {
        text: 'lesson.oddjob.back',
        on: (e) => e.type === 'oddjob' && e.what === 'paid',
        goal: (sim) => jobTile(sim, J.GIVER),
        fail: (c) => (jobOf(c.sim.state) || c.sim.state.feats[FEAT.oddJobs] ? null : 'lesson.oddjob.lost'),
      },
      { text: 'lesson.oddjob.over', done: () => true, least: 8 },
    ],
  },
  // ---------------------------------------------------------------- Ways out
];
