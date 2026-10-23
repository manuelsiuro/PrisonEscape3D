// Dev tool, run in the browser on the dev server (not by tsx): How to play's pictures (P37),
// public/help/<topic>.webp. Each is a moment of a real escape: an escape bot (scripts/escapes.ts)
// plays its route, the run is played again up to the moment wanted, and the game shows it,
// paused, with the HUD hidden, the camera on the player. Needs scripts/dev/shotsink.ts running
// (it writes the files). In the dev build's console:
//   const h = await import('/scripts/dev/helpshot.ts');
//   await h.all();              // every picture in SHOTS
//   await h.take('glider');     // one (it stays on screen: h.done() back to the title)
// Retake them when what they show changes; helptest checks every topic's picture is there.
// Run it in an isolated browser profile: each shot is a game started, so its escapes, stats and
// trophies land in that profile's storage.
import { PLANS, quiet, runRoute, type Route } from '../escapes';
import { Bot, DIR } from '../bots';
import { TRAINING } from '../../src/content/prisons/training';
import { WAY } from '../../src/content/smuggling';
import { CHARTS, countIn, LATE, songSteps } from '../../src/content/nights';
import { command, dirFromVector, EXT, LINE, OP, ORDER, TALK, tossArgs } from '../../src/sim/command';
import { nearestDir } from '../../src/sim/ai/path';
import { isTrue } from '../../src/sim/systems/cards';
import { drillOn } from '../../src/sim/systems/calendar';
import { squareAt } from '../../src/sim/systems/checkers';
import { dayMinute } from '../../src/sim/systems/clock';
import { jobRooms } from '../../src/sim/systems/economy';
import { fieldOf, pitchOf } from '../../src/sim/systems/football';
import { courtOf, powerAt, shotWindow } from '../../src/sim/systems/hoops';
import { questionNow } from '../../src/sim/systems/quiz';
import { cardUp, RACE_ENTER, raceCard } from '../../src/sim/systems/races';
import { tonight, turnFrom } from '../../src/sim/systems/talent';
import { penAt } from '../../src/sim/systems/tattoo';
import { CENTER_PERKS } from '../../src/content/prisons/center-perks';
import { HEARINGS } from '../../src/content/parole';
import { HOLIDAY } from '../../src/content/holidays';
import { holidayDecor } from '../../src/render/Holidays';
import { prisonDay } from '../../src/sim/systems/calendar';
import { dropTile } from '../../src/sim/systems/smuggling';
import { containersOf } from '../../src/sim/world/containers';
import { LESSONS } from '../../src/tutorial/lessons';
import { play } from '../../src/play/game';
import { endGame, startGame } from '../../src/play/session';
import * as THREE from 'three';
import type { View } from '../../src/render/View';
import { Sim } from '../../src/sim/Sim';
import { LAYER, MAP_W } from '../../src/sim/world/World';
import { UNIT } from '../../src/sim/tuning';

quiet.on = true;

/** The picture's size (the page shows it at up to 560 px wide, 2× for sharp screens). */
const W = 1040;
const H = 480;

export interface Shot {
  /** An escape bot's run (scripts/escapes.ts): its prison and route. */
  prison?: string;
  route?: Route;
  /** Or a lesson's scene, played on by these moves (as tutorialtest's bot plays it). */
  lesson?: string;
  moves?: (bot: Bot) => void;
  /** Or a run of its own (P42's holidays: a run begun under one). */
  make?: () => Bot;
  /** The moment: the first step where this holds (the run's steps, k of n). */
  when: (sim: Sim, k: number, n: number) => boolean;
  /** Steps on from there. */
  after?: number;
  /** The camera's zoom (1: play's; past the player's own limit, 1.9, for a close-up), and how far off the player it looks (tiles). */
  zoom?: number;
  dx?: number;
  dz?: number;
  /** The hour drawn (minutes from midnight), when the moment's own would be too dark to read. */
  light?: number;
  /** Seconds played on from the moment (the run's own commands), for what the view animates (a glide). */
  live?: number;
}

/** The moment the player has been on a layer this many steps running. */
function onLayerFor(layer: number, steps: number) {
  let since = -1;
  return (sim: Sim, k: number) => {
    if (k === 0 || sim.state.layer !== layer) since = -1;
    else if (since < 0) since = k;
    return since >= 0 && k - since >= steps;
  };
}

/** The moment a dog is this close to the player (tiles), in the open. */
const dogNear = (tiles: number, from = 0) => (sim: Sim) =>
  sim.state.layer === LAYER.GROUND &&
  sim.state.dogs.some((d) => {
    const r = Math.hypot(d.body.x - sim.state.player.x, d.body.z - sim.state.player.z) / UNIT;
    return r > from && r < tiles;
  });

/** The moment the player is within this many tiles of a tile, on the ground. */
const nearTile = (x: number, z: number, tiles: number, also: (sim: Sim) => boolean = () => true) => (sim: Sim) =>
  sim.state.layer === LAYER.GROUND && Math.hypot(sim.state.player.x / UNIT - x - 0.5, sim.state.player.z / UNIT - z - 0.5) < tiles && also(sim);

/** The moment an event of this type happens. */
const on = (type: string) => (sim: Sim) => sim.events.some((e) => e.type === type);

const tileX = (sim: Sim) => Math.floor(sim.state.player.x / UNIT);
const tileZ = (sim: Sim) => Math.floor(sim.state.player.z / UNIT);

// ------------------------------------------------------------ lesson moves (as tutorialtest's bots play them)
const tile = (x: number, z: number) => z * MAP_W + x;
/** Up to someone and talking to them. */
function talkTo(bot: Bot, body: { x: number; z: number }, limit = 1500): boolean {
  for (let k = 0; k < limit; k++) {
    const dx = body.x - bot.st.player.x;
    const dz = body.z - bot.st.player.z;
    if (Math.hypot(dx, dz) > 2 * UNIT) {
      bot.pilot.goTo(Math.floor(body.z / UNIT) * MAP_W + Math.floor(body.x / UNIT));
      bot.step(command(bot.pilot.dir(bot.st.player)));
      continue;
    }
    if (Math.hypot(dx, dz) > 1.15 * UNIT) {
      bot.step(command(dirFromVector(dx, dz)));
      continue;
    }
    bot.step(command(dirFromVector(dx, dz)));
    bot.act();
    if (bot.st.talk >= 0) return true;
  }
  return false;
}
/** Up to a prop and using it. */
function useProp(bot: Bot, prop: number) {
  const w = bot.sim.world;
  const p = w.props[prop];
  bot.pilot.goToAny((i) => {
    const x = i % MAP_W;
    const z = Math.floor(i / MAP_W);
    const side = (x === p.x - 1 || x === p.x + p.w) !== (z === p.z - 1 || z === p.z + p.d);
    return side && x >= p.x - 1 && x <= p.x + p.w && z >= p.z - 1 && z <= p.z + p.d && !w.blocked(x, z);
  });
  bot.until(() => !bot.pilot.active, 3000, () => command(bot.pilot.dir(bot.st.player)));
  bot.face(dirFromVector((p.x + p.w / 2) * UNIT - bot.st.player.x, (p.z + p.d / 2) * UNIT - bot.st.player.z));
  bot.act();
}
/** A shot at the hoop from the spot stood on, let go at the best moment. */
function shoot(bot: Bot, spot: number) {
  bot.op(OP.EXT, EXT.SHOOT, 0);
  const from = bot.st.shot[0];
  const win = shotWindow(bot.sim, spot);
  let best = 1;
  for (let j = 1; j < 48; j++) if (Math.abs(powerAt(j) - win[0]) < Math.abs(powerAt(best) - win[0])) best = j;
  while (bot.st.shot.length && bot.st.step + 1 - from < best) bot.step();
  bot.op(OP.EXT, EXT.SHOOT, 1);
}
const sparky = (bot: Bot) => talkTo(bot, bot.st.inmates[0].body);
/** A moment part way through the run (0–1). */
const at = (f: number) => (_s: Sim, k: number, n: number) => k >= n * f;

export const SHOTS: Record<string, Shot> = {
  // ------------------------------------------------------------ prison life (P38)
  guards: { lesson: 'guards', moves: (bot) => void talkTo(bot, bot.st.guards[1].body), when: at(0.6), zoom: 1.8, dx: 2 },
  inmates: {
    lesson: 'talk',
    moves: (bot) => {
      sparky(bot);
      bot.op(OP.TALK, TALK.GIFT, bot.slotOf('chocolate'));
      bot.until(() => false, 20);
    },
    when: at(0.97),
    zoom: 2.8,
  },
  fight: {
    lesson: 'fight',
    moves: (bot) => {
      bot.op(OP.LOCK, 2);
      const m = bot.st.inmates[0];
      for (let k = 0; k < 600 && m.ko === 0; k++) {
        const dx = m.body.x - bot.st.player.x;
        const dz = m.body.z - bot.st.player.z;
        if (Math.hypot(dx, dz) > 1.1 * UNIT) bot.step(command(dirFromVector(dx, dz)));
        else bot.op(OP.USE, 1);
      }
      bot.until(() => false, 30);
    },
    when: at(0.97),
    zoom: 2.4,
  },
  day: {
    lesson: 'day',
    moves: (bot) => {
      bot.until(() => drillOn(bot.sim), 20 * 60 * 20);
      const spot = bot.sim.prison.rollCall[0];
      bot.walkTo(spot.z * MAP_W + spot.x);
      bot.until(() => false, 20 * 60 * 5);
    },
    when: at(0.99),
    zoom: 1.5,
  },
  work: {
    lesson: 'job',
    moves: (bot) => {
      bot.step();
      const room = jobRooms(bot.sim.world)[0];
      useProp(bot, room.take);
      useProp(bot, room.machines[0]);
    },
    when: at(0.99),
    zoom: 2.2,
    dx: 1,
  },
  train: {
    lesson: 'gym',
    moves: (bot) => {
      bot.act();
      for (let k = 0; k < 200; k++) bot.op(OP.TRAIN, 1 + (k % 2));
    },
    when: at(0.5),
    zoom: 2.4,
    dz: -1.5,
  },
  grounds: {
    lesson: 'laps',
    moves: (bot) => {
      bot.step();
      bot.walkTo(tile(35, 39));
      const r = bot.sim.prison.leisure!.track!;
      bot.walkTo(tile(r.x, r.z));
      bot.walkTo(tile(r.x + Math.floor(r.w / 2), r.z));
    },
    when: at(0.97),
    zoom: 1.4,
  },
  games: {
    lesson: 'games',
    moves: (bot) => {
      sparky(bot);
      bot.op(OP.TALK, TALK.DICE, 0);
      bot.op(OP.TALK, TALK.REROLL, 0);
      bot.op(OP.TALK, TALK.WRESTLE);
      for (let k = 0; k < 2000 && bot.st.bout.length; k++) bot.step(command(0, OP.TRAIN, 1 + (k % 2)));
    },
    when: (s) => s.state.bout.length > 0,
    after: 40,
    zoom: 2.6,
  },
  cheat: {
    lesson: 'cards',
    moves: (bot) => {
      sparky(bot);
      bot.op(OP.TALK, TALK.CHEAT, 0);
      for (let k = 0; k < 4000 && bot.st.cheat; k++) {
        const c = bot.st.cheat;
        if (c.turn !== 0) {
          bot.step();
          continue;
        }
        if (c.by === 1 && (c.tell || !c.theirs.length || !c.mine.length)) bot.op(OP.TALK, TALK.LIAR);
        else {
          const ks = c.mine.map((card, j) => (isTrue(card, c.table) ? j : -1)).filter((j) => j >= 0).slice(0, 3);
          bot.op(OP.TALK, TALK.PLAY, (ks.length ? ks : [0]).reduce((m, j) => m | (1 << j), 0));
        }
      }
    },
    when: (s) => !!s.state.cheat,
    after: 200,
    zoom: 3.4,
  },
  hoops: {
    lesson: 'hoops',
    moves: (bot) => {
      const c = courtOf(bot.sim)!;
      bot.walkTo(tile(c.spots[0].x, c.spots[0].z));
      shoot(bot, 0);
      bot.until(() => false, 30);
    },
    when: (s) => s.events.some((e) => e.type === 'shot'),
    after: 12,
    zoom: 2,
    dz: -1.5,
  },
  checkers: {
    lesson: 'checkers',
    moves: (bot) => {
      sparky(bot);
      bot.op(OP.TALK, TALK.CHECKERS, 1);
      bot.until(() => false, 40);
      bot.op(OP.TALK, TALK.MOVE, squareAt(5, 2), squareAt(3, 4));
      bot.until(() => false, 40);
    },
    when: at(0.98),
    zoom: 3.6,
    dz: 0.5,
  },
  football: {
    lesson: 'football',
    moves: (bot) => {
      talkTo(bot, bot.st.inmates[0].body);
      bot.op(OP.TALK, TALK.FOOTBALL);
      const f = fieldOf(pitchOf(bot.sim)!);
      let held = 0;
      bot.until(() => !bot.st.match, 4000, () => {
        const o = bot.st.match;
        if (!o) return 0;
        const [bx, bz] = o.ball;
        const gx = f.along ? f.a1 + UNIT : f.mid;
        const gz = f.along ? f.mid : f.a1 + UNIT;
        const pl = bot.st.player;
        const toGoal = nearestDir(gx - pl.x, gz - pl.z);
        if (held) return ++held > 10 ? ((held = 0), command(toGoal, OP.EXT, EXT.KICK, 1)) : command(toGoal);
        if (o.at && !o.pause && Math.hypot(bx - pl.x, bz - pl.z) < 600) {
          held = 1;
          return command(toGoal, OP.EXT, EXT.KICK, 0);
        }
        const d = Math.hypot(gx - bx, gz - bz) || 1;
        return command(nearestDir(bx - ((gx - bx) * 450) / d - pl.x, bz - ((gz - bz) * 450) / d - pl.z));
      });
    },
    when: (s) => !!s.state.match,
    after: 300,
    zoom: 1.6,
  },
  race: {
    lesson: 'ratRace',
    moves: (bot) => {
      bot.hold('rat_track');
      bot.use();
      const r = TRAINING.leisure!.race;
      bot.walkTo(tile(r.x, r.z - 1));
      bot.until(() => cardUp(bot.sim), 2 * 60 * 20 * 60);
      bot.op(OP.EXT, EXT.RACE, RACE_ENTER);
      bot.op(OP.EXT, EXT.RACE, raceCard(bot.st, prisonDay(bot.st.step)).length - 1, 0);
      bot.until(() => bot.sim.events.some((e) => e.type === 'race' && e.what === 'result'), 90 * 20 * 60);
    },
    when: (_s, k, n) => k >= n - 60,
    zoom: 2.8,
    dx: 3,
    dz: 1,
    light: 600,
  },
  talent: {
    lesson: 'talent',
    moves: (bot) => {
      bot.until(() => dayMinute(bot.st.step) >= turnFrom(tonight(bot.sim)), 60 * 20 * 60);
      const st = bot.sim.prison.leisure!.stage!;
      bot.walkTo(tile(st.x, st.z));
      bot.op(OP.EXT, EXT.STAGE, 0, 0);
      const o = bot.st.show!;
      const due = new Map(CHARTS[0].map(([t, lane]) => [o.from + countIn(o.song) + LATE + t - 1, lane] as const));
      bot.until(() => !bot.st.show, countIn(0) + songSteps(0) + 40, () => {
        const lane = due.get(bot.st.step);
        return lane === undefined ? 0 : command(0, OP.EXT, EXT.NOTE, lane);
      });
    },
    when: (s) => !!s.state.show,
    after: 200,
    zoom: 2.2,
    dx: -3,
  },
  quiz: {
    lesson: 'quiz',
    moves: (bot) => {
      bot.op(OP.EXT, EXT.QUIZ, 0);
      let asked = -1;
      let put = 0;
      bot.until(() => !bot.st.quiz, 4000, () => {
        const o = bot.st.quiz;
        const q = questionNow(bot.sim);
        if (!o || !q) return 0;
        if (o.q !== asked) {
          asked = o.q;
          put = bot.st.step;
        }
        return !o.until && o.said[0] < 0 && bot.st.step - put >= 60 ? command(0, OP.EXT, EXT.ANSWER, q.answer) : 0;
      });
    },
    when: at(0.4),
    zoom: 2.4,
    dz: -2,
  },
  garden: {
    lesson: 'garden',
    moves: (bot) => {
      bot.hold('veg_seeds');
      bot.use();
      bot.hold('plastic_cup');
      bot.use();
      // (Stepped back from the bed just planted: it, and the ripe one at the end, in view.)
      for (let k = 0; k < 5; k++) bot.step(command(DIR.SOUTH));
      bot.until(() => false, 20);
    },
    when: at(0.98),
    zoom: 2.4,
  },
  tattoo: {
    lesson: 'tattoo',
    moves: (bot) => {
      bot.op(OP.CRAFT, (1 << 0) | (1 << 1) | (1 << 2));
      sparky(bot);
      bot.op(OP.TALK, TALK.TATTOO, 0);
      const pen: [number, number] = [0, 0];
      bot.until(() => !bot.st.ink, 600, () => {
        const o = bot.st.ink;
        if (!o) return 0;
        penAt(o.design, o.k + 1, pen);
        return Math.hypot(pen[0] - o.nx, pen[1] - o.nz) < 8 ? 0 : command(nearestDir(pen[0] - o.nx, pen[1] - o.nz));
      });
    },
    when: (s) => !!s.state.ink,
    after: 100,
    zoom: 3.6,
  },
  crew: {
    lesson: 'crew',
    moves: (bot) => {
      sparky(bot);
      bot.op(OP.TALK, TALK.RECRUIT);
      bot.op(OP.TALK, TALK.CREW, ORDER.WATCH);
      bot.until(() => bot.sim.events.some((e) => e.type === 'crew' && e.what === 'whistle'), 3000);
    },
    when: (_s, k, n) => k >= n - 2,
    zoom: 1.6,
    dz: 1,
  },
  payphone: {
    lesson: 'payphone',
    moves: (bot) => {
      // (In line beside the phone till the inmate on it hangs up: the handset free, in view.)
      const c = CENTER_PERKS.comms!;
      bot.walkTo(tile(c.line[0].x, c.line[0].z));
      bot.op(OP.EXT, EXT.LINE, LINE.JOIN);
      bot.until(() => bot.st.booth[0] < 0 && bot.st.turn > 0, 20 * 60 * 20);
      bot.until(() => false, 10);
    },
    when: at(0.99),
    zoom: 2.4,
    dx: -1,
  },
  kiosk: {
    lesson: 'kiosk',
    moves: (bot) => {
      // (A tile beside the terminal, so the player doesn't hide it.)
      const k = CENTER_PERKS.comms!.kiosk;
      bot.walkTo(tile(k.x + 1, k.z + 1));
      bot.until(() => false, 60);
    },
    when: at(0.98),
    zoom: 2.8,
  },
  // P40: the odd jobs board on the canteen wall, seen from a tile aside so the player doesn't hide its cards.
  oddjobs: {
    lesson: 'oddjob',
    moves: (bot) => {
      const b = CENTER_PERKS.board!;
      bot.walkTo(tile(b.x + 1, b.z + 1));
      bot.until(() => false, 60);
    },
    when: at(0.98),
    zoom: 3.4,
    dx: -0.6,
    dz: -1.2,
  },

  // P39: before the parole board, the first question put (the parole lesson's scene: the board seated in the visiting room).
  parole: {
    lesson: 'parole',
    moves: (bot) => {
      const h = HEARINGS['center-perks'];
      bot.walkTo(tile(h.seat.x, h.seat.z));
      bot.until(() => !!bot.st.hearing && bot.st.hearing.q >= 0, 20 * 60 * 15);
      bot.until(() => false, 20);
    },
    when: at(0.99),
    zoom: 2.4,
    dz: -1,
  },

  // P42: Christmas Day in Center Perks' canteen, free time on day 2 (a run begun under Christmas): the tree standing free with its
  // presents (50.5,11.5), the player two tiles east of it facing it (beside, not in front: the camera looks from the south), the
  // lights along the north wall up and to the left (x 40–47, row 7). The camera aimed between the two, a little wider than play's.
  // (No picture yet: take it with h.take('holidays'), then give the topic its `pic`.)
  holidays: {
    make: () => {
      Bot.holiday = HOLIDAY.CHRISTMAS;
      const bot = new Bot(CENTER_PERKS, 7);
      Bot.holiday = 0;
      bot.routineUntil(2, 10 * 60 + 5);
      const t = holidayDecor(bot.sim.world, HOLIDAY.CHRISTMAS).find((d) => d.what === 'tree')!;
      bot.walkTo(tile(Math.floor(t.x) + 2, Math.floor(t.z)));
      bot.face(DIR.WEST);
      bot.until(() => false, 20);
      return bot;
    },
    when: at(0.999),
    zoom: 1.5,
    dx: -3.5,
    dz: -2,
  },

  // ------------------------------------------------------------ basics and escaping (P37)
  ways: { prison: 'center-perks', route: 'cutout', when: (_s, k, n) => k >= n - 30, zoom: 2.2, light: 600 },
  layers: { prison: 'center-perks', route: 'tunnel', when: onLayerFor(LAYER.UNDER, 100), zoom: 2.6, dz: -1.5 },
  delivery: { prison: 'center-perks', route: 'stowaway', when: (s) => s.state.stowed, after: -6, zoom: 2.1 },
  bluff: { prison: 'center-perks', route: 'bluff', when: on('bluff'), after: -4, zoom: 2.2 },
  glider: { prison: 'center-perks', route: 'glider', when: on('glide'), after: -3, zoom: 1.8, dz: -1, light: 600, live: 0.5 },
  // (Out of the tunnel onto the road, the escape camera turning on the prison behind.)
  goal: { prison: 'center-perks', route: 'tunnel', when: (_s, k, n) => k >= n - 2, zoom: 1.4, light: 600, live: 2 },
  // (Cleared, in their own clothes, out through the doors by the desk: its lamp green.)
  paperwork: { prison: 'center-perks', route: 'paperwork', when: (s) => s.state.release[1] > 0, after: 6, zoom: 2.2, dz: -1.2 },
  power: { prison: 'center-perks', route: 'cutout', when: on('power'), after: 4, zoom: 2.2, dx: -1, dz: 1.5, light: 600 },
  cams: { prison: 'center-perks', route: 'cutout', when: nearTile(7, 36, 5, (s) => s.state.powerOff === 0), zoom: 2, light: 600 },
  // (At night with the power on: Center Perks' south-east tower and its beam up the east strip.)
  towers: { prison: 'center-perks', route: 'glider', when: (_s, k, n) => k >= n - 40, zoom: 1.25, dx: 4, dz: 12 },
  dogs: { prison: 'shankton', route: 'paperwork', when: dogNear(3.5, 2), after: 7, zoom: 2.3 },
  rat: {
    lesson: 'rat',
    moves: (bot) => {
      bot.use();
      bot.use();
      const desk = containersOf(bot.sim.world).findIndex((c) => !c.mine && c.prop.kind === 'desk');
      bot.op(OP.EXT, EXT.RAT_FETCH, ...tossArgs(desk));
      bot.until(() => bot.slotOf('lighter') >= 0, 3000);
    },
    // (On its way back from the next cell, the lighter in its mouth.)
    when: (_s, k) => k >= 66,
    zoom: 3,
    dx: 1.5,
    dz: -2,
  },
  smuggling: {
    lesson: 'smuggle',
    moves: (bot) => {
      bot.op(OP.EXT, EXT.ORDER, 7, WAY.DRONE);
      bot.op(OP.SELECT, 1);
      bot.walkTo(dropTile(bot.sim, prisonDay(bot.st.step)));
      bot.until(() => bot.st.drops.length > 0, 3 * 60 * 20);
    },
    // (At night, as drones come: the drop in its claws over the yard.)
    when: (_s, k, n) => k >= n - 30,
    zoom: 1.8,
    dz: -1.5,
  },
  weather: { prison: 'stalag-flucht', route: 'tunnel', when: (_s, k, n) => k >= n - 30, zoom: 2.2, dz: -0.5 },
  shell: { prison: 'shankton', route: 'rooftop', when: (_s, k, n) => k >= n - 60, zoom: 1.5, dz: 2.5, light: 1050 },
  mines: { prison: 'san-pancho', route: 'gate', when: (_s, k, n) => k >= n - 40, zoom: 1.3, light: 1050 },
  island: { prison: 'irongate', route: 'raft', when: (_s, k, n) => k >= n - 2, live: 1.2, light: 660, zoom: 2, dx: -2 },
};

const view = () => (window as unknown as { __view: View }).__view;
const frames = (n: number) => new Promise<void>((done) => {
  const step = (k: number) => (k ? requestAnimationFrame(() => step(k - 1)) : done());
  step(n);
});

/** A route played through once (kept: the moments are picked from it again and again). */
const runs = new Map<string, Bot>();
export function run(s: Shot): Bot {
  if (s.make) return s.make();
  if (s.lesson) {
    const k = LESSONS.findIndex((l) => l.id === s.lesson);
    const lesson = LESSONS[k];
    const bot = new Bot(lesson.prison ?? TRAINING, lesson.seed ?? 7 + k);
    lesson.setup(bot.sim);
    s.moves!(bot);
    return bot;
  }
  const { prison = '', route = 'cutout' } = s;
  const key = `${prison}/${route}`;
  let bot = runs.get(key);
  if (!bot) {
    const plan = PLANS.find((p) => p.def.id === prison);
    if (!plan) throw new Error(`no plan for ${prison}`);
    bot = runRoute(plan, route) ?? undefined;
    if (!bot) throw new Error(`${key}: no run`);
    runs.set(key, bot);
  }
  return bot;
}

/** The game at a shot's moment, on screen, paused, the HUD hidden; what it shows (for checking). */
export async function stage(id: string, over: Partial<Shot> = {}) {
  const s = { ...SHOTS[id], ...over };
  const bot = run(s);
  const n = bot.cmds.length;
  const sim = new Sim(bot.sim.prison, 1);
  sim.restore(bot.start!);
  let k = 0;
  while (k < n && !s.when(sim, k, n)) sim.step(bot.cmds[k++]);
  const end = Math.max(0, Math.min(n - 1, k + (s.after ?? 0)));
  if (end < k) {
    // (Back from the moment: played again from the start, up to that step.)
    sim.restore(bot.start!);
    k = 0;
  }
  while (k < end) sim.step(bot.cmds[k++]);
  if (play.game) endGame();
  daylight(s.light);
  offset(0, 0);
  startGame(sim, true);
  hideUi(true);
  // (Played on, the run goes on as it went: its commands, not the controls'.)
  const step = sim.step.bind(sim);
  sim.step = () => step(bot.cmds[Math.min(k++, n - 1)]);
  await frames(3);
  if (s.live) await new Promise((r) => setTimeout(r, s.live! * 1000));
  // Held still: the sim steps no more, but the game isn't paused (its markers, a glide's ring, still drawn).
  sim.step = () => {};
  // No floor arrows in the picture (the guide never looks again: its clock wound far back).
  const g = play.game!;
  g.guide = null;
  g.guideAge = -1e9;
  g.guideFrom = Math.floor(sim.state.player.z / UNIT) * 64 + Math.floor(sim.state.player.x / UNIT);
  const v = view() as unknown as { zoom: number; zoomGoal: number; applyZoom(): void };
  v.zoom = v.zoomGoal = s.zoom ?? 1.4;
  v.applyZoom();
  offset(s.dx ?? 0, s.dz ?? 0);
  await frames(40);
  return { step: k, of: n, tile: [tileX(sim), tileZ(sim)], layer: sim.state.layer, minute: sim.clock.minuteOfDay };
}

/** Every frame drawn at this hour (undefined: its own). */
let drawn: View['draw'] | null = null;
export function daylight(minute: number | undefined) {
  const v = view();
  if (drawn) v.draw = drawn;
  drawn = null;
  if (minute === undefined) return;
  const own = v.draw.bind(v);
  drawn = v.draw;
  // (By day the searchlights are off: none drawn.)
  v.draw = (f, dt, time) => own({ ...f, minuteOfDay: minute, security: f.security && { ...f.security, beams: null } }, dt, time);
}

/**
 * The camera aimed this far (tiles) off the player: where it eases toward each frame, or is put
 * outright in the tunnels (the view's own target, so what it works out from the camera, the
 * see-through cut, still fits).
 */
export function offset(dx: number, dz: number) {
  const target = (view() as unknown as { target: THREE.Vector3 }).target;
  delete (target as Partial<THREE.Vector3>).lerp;
  delete (target as Partial<THREE.Vector3>).set;
  if (!dx && !dz) return;
  const to = new THREE.Vector3();
  target.lerp = (v, a) => THREE.Vector3.prototype.lerp.call(target, to.set(v.x + dx, v.y, v.z + dz), a);
  // (In the tunnels the camera is put on the player outright.)
  target.set = (x, y, z = 0) => THREE.Vector3.prototype.set.call(target, x + dx, y, z + dz);
}

export function hideUi(on: boolean) {
  let st = document.getElementById('helpshot-style');
  if (!st) {
    st = document.createElement('style');
    st.id = 'helpshot-style';
    st.textContent = 'body.helpshot > *:not(canvas) { visibility: hidden !important; }';
    document.head.append(st);
  }
  document.body.classList.toggle('helpshot', on);
}

/** The next frame drawn, cropped to the picture's shape (the middle of the screen, `dx`/`dz` tiles off). */
function grabFrame(): Promise<HTMLCanvasElement> {
  const v = view();
  const r = v.renderer;
  const draw = r.render.bind(r);
  return new Promise((resolve) => {
    r.render = (scene, cam) => {
      draw(scene, cam);
      r.render = draw;
      const src = r.domElement;
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const scale = Math.min(src.width / W, src.height / H);
      const sw = W * scale;
      const sh = H * scale;
      out.getContext('2d')!.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, W, H);
      resolve(out);
    };
  });
}

/** A shot taken and sent to the sink (public/help/<id>.webp); its size in kB. */
export async function take(id: string, over: Partial<Shot> = {}) {
  const at = await stage(id, over);
  const c = await grabFrame();
  const blob = await new Promise<Blob>((done) => c.toBlob((b) => done(b!), 'image/webp', 0.8));
  const res = await fetch(`http://127.0.0.1:5311/?name=${id}.webp`, { method: 'POST', body: blob });
  if (!res.ok) throw new Error(`${id}: the sink said ${res.status}`);
  return { id, kB: Math.round(blob.size / 1000), ...at };
}

/** Back to the title. */
export function done() {
  if (play.game) endGame();
  daylight(undefined);
  offset(0, 0);
  hideUi(false);
}

export async function all() {
  const out = [];
  for (const id of Object.keys(SHOTS)) out.push(await take(id));
  done();
  return out;
}
