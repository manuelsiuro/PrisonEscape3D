import { SLOT } from '../sim/command';
import { itemOf } from '../sim/systems/items';
import { UNIT } from '../sim/tuning';
import { containersOf } from '../sim/world/containers';
import { TILE } from '../sim/world/tiles';
import { LAYER } from '../sim/world/World';
import { CENTER_PERKS } from '../content/prisons/center-perks';
import { FAVOR, FAVOR_STATE, HOLDER, jobRooms } from '../sim/systems/economy';
import { tileAt } from '../sim/world/grid';
import {
  apart,
  at,
  besideProp,
  carries,
  centre,
  clockTo,
  deskStand,
  deskTile,
  favorPaid,
  fill,
  jobFail,
  LAUNDRY,
  type Lesson,
  loadedMachine,
  machineOn,
  magazineFavor,
  merchantAt,
  MORNING,
  myDesk,
  n,
  near,
  outside,
  place,
  pockets,
  talkFail,
  tile,
  tradeFail,
  upInside,
  waitAt,
  zone,
} from './kit';

/** Getting by (the second chapter): talk, trade, a job, the gym, a disguise, a tunnel, the vents. Out of lessons.ts (v2.34.2), in LESSONS' order (a lesson without a seed of its own takes its place's). */
export const GET_BY: readonly Lesson[] = [
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
      {
        text: 'lesson.talk.talk',
        touch: 'lesson.talk.talkTouch',
        done: (c) => c.sim.state.talk === 0,
        goal: (sim) => tileAt(sim.state.inmates[0].body.x, sim.state.inmates[0].body.z),
      },
      { text: 'lesson.talk.gift', touch: 'lesson.talk.giftTouch', on: (e) => e.type === 'gift' },
      // (Taken on before the gift, or handed in already: the state says, whatever order it was done in.)
      {
        text: 'lesson.talk.favor',
        done: (c) => favorPaid(c.sim) || (magazineFavor(c.sim)?.state ?? FAVOR_STATE.OFFERED) !== FAVOR_STATE.OFFERED,
        fail: talkFail,
      },
      {
        text: 'lesson.talk.handIn',
        done: (c) => favorPaid(c.sim),
        fail: talkFail,
        goal: (sim) => (carries(sim, 'magazine') ? tileAt(sim.state.inmates[0].body.x, sim.state.inmates[0].body.z) : deskStand(sim)),
      },
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
      {
        text: 'lesson.trade.talk',
        touch: 'lesson.trade.talkTouch',
        done: (c) => c.sim.state.talk === merchantAt(c.sim),
        goal: (sim) => {
          const b = sim.state.inmates[merchantAt(sim)].body;
          return tileAt(b.x, b.z);
        },
        fail: tradeFail,
      },
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
      {
        text: 'lesson.job.take',
        touch: 'lesson.job.takeTouch',
        done: (c) => carries(c.sim, 'dirty_laundry') || machineOn(c.sim) || c.sim.state.quota > 0,
        goal: (sim) => besideProp(sim, jobRooms(sim.world)[LAUNDRY].take),
        fail: jobFail,
      },
      {
        text: 'lesson.job.wash',
        touch: 'lesson.job.washTouch',
        done: (c) => machineOn(c.sim) || carries(c.sim, 'clean_laundry') || c.sim.state.quota > 0,
        goal: (sim) => besideProp(sim, jobRooms(sim.world)[LAUNDRY].machines[0]),
        fail: jobFail,
      },
      // (The machine's load: back to it once it's done, then to the clean basket.)
      {
        text: 'lesson.job.deliver',
        done: (c) => c.sim.state.quota > 0,
        goal: (sim) => besideProp(sim, carries(sim, 'clean_laundry') ? jobRooms(sim.world)[LAUNDRY].put : loadedMachine(sim)),
        fail: jobFail,
      },
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
      {
        text: 'lesson.disguise.wear',
        touch: 'lesson.disguise.wearTouch',
        done: (c) => itemOf(c.sim.state.items.inv[SLOT.OUTFIT]) === n('guard_outfit'),
      },
      {
        text: 'lesson.disguise.walk',
        done: (c) =>
          c.sim.playerZone === 'gym' && c.sim.state.guards[0].sees && itemOf(c.sim.state.items.inv[SLOT.OUTFIT]) === n('guard_outfit'),
        goal: () => tile(38, 29),
      },
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
      {
        text: 'lesson.tunnel.shaft',
        touch: 'lesson.tunnel.shaftTouch',
        done: (c) => c.sim.world.ground.kind[deskTile(c.sim)] === TILE.SHAFT || c.sim.state.layer === LAYER.UNDER || outside(c.sim),
        goal: (sim) => deskStand(sim),
      },
      {
        text: 'lesson.tunnel.dirt',
        touch: 'lesson.tunnel.dirtTouch',
        done: (c) => !carries(c.sim, 'dirt') || c.sim.state.layer === LAYER.UNDER || outside(c.sim),
        goal: () => tile(22, 19),
      },
      {
        text: 'lesson.tunnel.down',
        touch: 'lesson.tunnel.downTouch',
        done: (c) => c.sim.state.layer === LAYER.UNDER || outside(c.sim),
        goal: (sim) => deskStand(sim),
      },
      // (Past the fence's line, z 12; up any sooner past it does too. Up inside it: try again.)
      {
        text: 'lesson.tunnel.dig',
        touch: 'lesson.tunnel.digTouch',
        done: (c) => (c.sim.state.layer === LAYER.UNDER && Math.floor(c.sim.state.player.z / UNIT) <= 11) || outside(c.sim),
        failOn: upInside,
      },
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
      fill(
        sim,
        containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'bed'),
        'bed_dummy',
      );
      sim.state.items.hand = 0;
      sim.state.energy = 100;
    },
    steps: [
      {
        text: 'lesson.vents.grate',
        touch: 'lesson.vents.grateTouch',
        done: (c) => c.sim.world.layers[LAYER.VENTS].kind[tile(9, 9)] === TILE.GRATE_OPEN || c.sim.state.layer !== LAYER.GROUND,
        goal: () => tile(9, 9),
      },
      { text: 'lesson.vents.up', touch: 'lesson.vents.upTouch', done: (c) => c.sim.state.layer !== LAYER.GROUND },
      {
        text: 'lesson.vents.crawl',
        done: (c) =>
          c.sim.state.layer === LAYER.ROOF || (c.sim.state.layer === LAYER.VENTS && apart(c.sim.state.player, centre(tile(13, 38))) < 1.2),
        goal: () => tile(13, 38),
        layer: LAYER.VENTS,
      },
      {
        text: 'lesson.vents.roof',
        touch: 'lesson.vents.roofTouch',
        done: (c) => c.sim.state.layer === LAYER.ROOF,
        goal: () => tile(13, 38),
        layer: LAYER.VENTS,
      },
    ],
  },
  // ---------------------------------------------------------------- Prison life
];
