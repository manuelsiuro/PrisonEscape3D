import { talentOn, tonight, turnFrom } from '../sim/systems/talent';
import { quizOn } from '../sim/systems/quiz';
import { ORDER } from '../sim/command';
import { itemOf, slot, usesOf } from '../sim/systems/items';
import { STEPS_PER_MINUTE, TRUST_IGNORE, UNIT } from '../sim/tuning';
import { containersOf } from '../sim/world/containers';
import { MAP_W } from '../sim/world/World';
import { CENTER_PERKS } from '../content/prisons/center-perks';
import { DAY_EVENTS } from '../content/days';
import { CATALOGUE, WAY } from '../content/smuggling';
import { dayMinute, planOf, prisonDay, TODAY } from '../sim/systems/calendar';
import { postOf } from '../sim/systems/crew';
import { smellsOfContraband } from '../sim/systems/k9';
import { guardTalking } from '../sim/systems/social';
import { dropTile } from '../sim/systems/smuggling';
import { gameRefusal } from '../sim/systems/games';
import { newRat, petOf } from '../sim/systems/rats';
import { CROP, GROWN } from '../content/long';
import { atTrack, cardUp } from '../sim/systems/races';
import { newBoard, PIECE, squareAt } from '../sim/systems/checkers';
import { tileAt } from '../sim/world/grid';
import {
  apart,
  at,
  bagsHidden,
  boardFail,
  carries,
  centre,
  cheatOff,
  clockTo,
  DAY_TWO,
  farNet,
  fill,
  gamesFail,
  gardenBed,
  guardsFail,
  inkFail,
  inkOff,
  type Lesson,
  matchFail,
  MORNING,
  myDesk,
  n,
  near,
  pastOff,
  place,
  pockets,
  PRATT,
  quizFail,
  raceFail,
  raceState,
  ratFail,
  seesRound,
  smuggleFail,
  sparkyDesk,
  spotOn,
  stageTile,
  tile,
  trackStart,
  waitAt,
  wiltedBed,
} from './kit';

/** Life inside, its first half (the third chapter): the guards, the day, dogs, a rat, smuggling, the side games, the pastimes, the long games, the stage, the crew. Out of lessons.ts (v2.34.2), in LESSONS' order (a lesson without a seed of its own takes its place's). */
export const LIFE: readonly Lesson[] = [
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
      {
        text: 'lesson.guards.talk',
        touch: 'lesson.guards.talkTouch',
        done: (c) => guardTalking(c.sim.state) === PRATT,
        goal: (sim) => tileAt(sim.state.guards[PRATT].body.x, sim.state.guards[PRATT].body.z),
        fail: guardsFail,
      },
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
      {
        text: 'lesson.day.muster',
        done: (c) => !!(c.sim.state.eventFlags & TODAY.MUSTERED),
        goal: (sim) => sim.prison.rollCall[0].z * MAP_W + sim.prison.rollCall[0].x,
        fail: (c) => (c.sim.state.eventFlags & TODAY.MISSED_DRILL ? 'lesson.day.missed' : null),
      },
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
      {
        text: 'lesson.dogs.sniff',
        done: (c) => c.sim.state.dogs[0].sniffed > 0 || c.sim.state.dogs[0].trust >= TRUST_IGNORE,
        goal: (sim) => tileAt(sim.state.dogs[0].body.x, sim.state.dogs[0].body.z),
      },
      // (A throw that misses leaves the jerky lying where it fell, to pick up and throw again: no dead end.)
      { text: 'lesson.dogs.treat', touch: 'lesson.dogs.treatTouch', done: (c) => c.sim.state.dogs[0].trust >= TRUST_IGNORE },
      {
        text: 'lesson.dogs.pass',
        least: 4,
        done: (c) =>
          c.sim.state.dogs[0].trust >= TRUST_IGNORE &&
          smellsOfContraband(c.sim) &&
          apart(c.sim.state.player, c.sim.state.dogs[0].body) < 1.4,
        goal: (sim) => tileAt(sim.state.dogs[0].body.x, sim.state.dogs[0].body.z),
      },
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
      {
        text: 'lesson.rat.feed',
        touch: 'lesson.rat.feedTouch',
        done: (c) => !!petOf(c.sim.state) || usesOf(c.sim.state.items.inv.find((v) => itemOf(v) === n('caught_rat')) ?? 0) > 0,
        fail: ratFail,
      },
      { text: 'lesson.rat.tame', touch: 'lesson.rat.tameTouch', done: (c) => !!petOf(c.sim.state), fail: ratFail },
      // (Sent somewhere else, it comes back with nothing of use: the step waits for the desk.)
      {
        text: 'lesson.rat.send',
        touch: 'lesson.rat.sendTouch',
        on: (e, sim) => e.type === 'rat' && e.what === 'sent' && e.container === sparkyDesk(sim),
      },
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
        on: (e, sim) =>
          e.type === 'smuggle' && e.what === 'ordered' && e.item === n('battery') && sim.state.order[2] === prisonDay(sim.state.step),
        // Ordered too late for tonight's drone (it needs an hour's notice): tomorrow night's is too long to wait.
        // (Or something else, or by a visitor: not what the lesson waits for.)
        fail: (c) => {
          const o = c.sim.state.order;
          if (o.length !== 3) return null;
          if (o[1] !== WAY.DRONE || CATALOGUE[o[0]]?.item !== 'battery') return 'lesson.smuggle.wrong';
          return o[2] > prisonDay(c.sim.state.step) ? 'lesson.smuggle.late' : null;
        },
      },
      {
        text: 'lesson.smuggle.go',
        touch: 'lesson.smuggle.goTouch',
        done: (c) => carries(c.sim, 'battery') || apart(c.sim.state.player, centre(dropTile(c.sim, prisonDay(c.sim.state.step)))) < 0.8,
        goal: (sim) => dropTile(sim, prisonDay(sim.state.step)),
        fail: (c) => smuggleFail(c.sim),
      },
      // (Landed, or picked up already, whatever step showed then.)
      {
        text: 'lesson.smuggle.wait',
        speed: 6,
        done: (c) => c.sim.state.drops.length > 0 || carries(c.sim, 'battery'),
        fail: (c) => smuggleFail(c.sim),
      },
      {
        text: 'lesson.smuggle.grab',
        touch: 'lesson.smuggle.grabTouch',
        done: (c) => carries(c.sim, 'battery'),
        goal: (sim) => dropTile(sim, prisonDay(sim.state.step)),
        fail: (c) => smuggleFail(c.sim),
      },
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
      {
        text: 'lesson.games.reroll',
        on: (e) => e.type === 'dice' && (e.what === 'won' || e.what === 'lost' || e.what === 'push'),
        fail: gamesFail,
      },
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
      {
        text: 'lesson.cards.start',
        touch: 'lesson.cards.startTouch',
        on: (e) => e.type === 'cheat' && e.what === 'dealt' && e.round === 0,
        fail: gamesFail,
      },
      {
        text: 'lesson.cards.lay',
        touch: 'lesson.cards.layTouch',
        on: (e) => e.type === 'cheat' && e.what === 'played' && e.by === 0,
        failOn: cheatOff,
      },
      {
        text: 'lesson.cards.call',
        touch: 'lesson.cards.callTouch',
        on: (e) => e.type === 'cheat' && e.what === 'called',
        failOn: cheatOff,
      },
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
      {
        text: 'lesson.hoops.shoot',
        touch: 'lesson.hoops.shootTouch',
        on: (e) => e.type === 'hoopShot' && e.by < 0,
        goal: (sim) => spotOn(sim, 0),
      },
      {
        text: 'lesson.hoops.basket',
        touch: 'lesson.hoops.basketTouch',
        on: (e) => e.type === 'hoopShot' && e.by < 0 && (e.result === 'swish' || e.result === 'in'),
      },
      {
        text: 'lesson.hoops.shootout',
        touch: 'lesson.hoops.shootoutTouch',
        on: (e) => e.type === 'hoops' && e.what === 'start',
        fail: gamesFail,
      },
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
      {
        text: 'lesson.checkers.sit',
        touch: 'lesson.checkers.sitTouch',
        on: (e) => e.type === 'checkers' && e.what === 'sat',
        fail: boardFail,
      },
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
      fill(
        sim,
        containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'toilet'),
        '',
      );
    },
    steps: [
      { text: 'lesson.pruno.brew', touch: 'lesson.pruno.brewTouch', done: (c) => carries(c.sim, 'pruno_bag') || bagsHidden(c.sim) >= 2 },
      {
        text: 'lesson.pruno.hide',
        touch: 'lesson.pruno.hideTouch',
        done: (c) => bagsHidden(c.sim) >= 2,
        goal: (sim) => tile(...near(sim, 21, 20)),
      },
      {
        text: 'lesson.pruno.sleep',
        touch: 'lesson.pruno.sleepTouch',
        on: (e) => e.type === 'pruno' && e.what === 'ripe' && !!e.mine,
        goal: () => tile(20, 18),
      },
      {
        text: 'lesson.pruno.drink',
        touch: 'lesson.pruno.drinkTouch',
        on: (e) => e.type === 'pruno' && e.what === 'drunk',
        goal: () => tile(21, 18),
      },
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
      {
        text: 'lesson.garden.plant',
        touch: 'lesson.garden.plantTouch',
        on: (e) => e.type === 'garden' && e.what === 'planted',
        goal: (sim) => gardenBed(sim, 0, 1),
      },
      {
        text: 'lesson.garden.water',
        touch: 'lesson.garden.waterTouch',
        done: (c) => c.sim.state.plots.some((b, k) => k !== wiltedBed(c.sim) && b[0] !== CROP.NONE && b[3] > 0 && b[1] < GROWN),
      },
      {
        text: 'lesson.garden.wilted',
        touch: 'lesson.garden.wiltedTouch',
        done: (c) => (c.sim.state.plots[wiltedBed(c.sim)]?.[3] ?? 0) > 0,
        goal: (sim) => gardenBed(sim, wiltedBed(sim), 1),
      },
      // (Picked already, whatever step showed then.)
      {
        text: 'lesson.garden.pick',
        touch: 'lesson.garden.pickTouch',
        done: (c) => c.sim.state.plots[c.sim.prison.leisure!.garden.w - 1]?.[0] === CROP.NONE,
        goal: (sim) => tile(sim.prison.leisure!.garden.x + sim.prison.leisure!.garden.w, sim.prison.leisure!.garden.z),
      },
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
      {
        text: 'lesson.ratRace.card',
        speed: 8,
        done: (c) => cardUp(c.sim) && atTrack(c.sim),
        goal: (sim) => trackStart(sim),
        fail: raceFail,
      },
      // (Entered and backed in either order: each step looks at the race as it stands.)
      {
        text: 'lesson.ratRace.enter',
        touch: 'lesson.ratRace.enterTouch',
        done: (c) => raceState(c.sim, 4) === 1,
        goal: (sim) => trackStart(sim),
        fail: (c) => (raceState(c.sim, 4) !== 1 && pastOff(c.sim) ? 'lesson.ratRace.late' : null),
      },
      {
        text: 'lesson.ratRace.bet',
        touch: 'lesson.ratRace.betTouch',
        done: (c) => raceState(c.sim, 1) >= 0,
        goal: (sim) => trackStart(sim),
        fail: raceFail,
      },
      {
        text: 'lesson.ratRace.watch',
        speed: 6,
        on: (e) => e.type === 'race' && e.what === 'result',
        failOn: (e) => (e.type === 'race' && (e.what === 'off' || e.what === 'scratched') ? 'lesson.ratRace.off' : null),
      },
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
      // The captain at the player's side; everyone else by the pitch, two of them good friends (all waiting there however long the reading takes: wandered off, there'd be no match).
      waitAt(sim, 0, cx - 1, cz);
      sim.state.inmates.forEach((m, k) => {
        m.opinion = k === 1 || k === 2 ? 75 : 60;
        if (k === 0) return;
        const [x, z] = near(sim, p.x + 1 + ((k * 2) % (p.w - 2)), p.z + p.d + 1);
        waitAt(sim, k, x, z, 13);
        m.path = [];
      });
    },
    steps: [
      {
        text: 'lesson.football.talk',
        touch: 'lesson.football.talkTouch',
        on: (e) => e.type === 'football' && e.what === 'start',
        goal: (sim) => tileAt(sim.state.inmates[0].body.x, sim.state.inmates[0].body.z),
        fail: gamesFail,
      },
      {
        text: 'lesson.football.kick',
        touch: 'lesson.football.kickTouch',
        on: (e) => e.type === 'football' && e.what === 'kick',
        goal: (sim) =>
          sim.state.match ? tile(Math.floor(sim.state.match.ball[0] / UNIT), Math.floor(sim.state.match.ball[1] / UNIT)) : null,
        failOn: matchFail,
      },
      {
        text: 'lesson.football.play',
        on: (e) => e.type === 'football' && (e.what === 'won' || e.what === 'lost' || e.what === 'draw'),
        goal: (sim) => farNet(sim),
        failOn: (e) => (e.type === 'football' && (e.what === 'won' || e.what === 'lost' || e.what === 'draw') ? null : matchFail(e)),
      },
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
      {
        text: 'lesson.tattoo.offer',
        touch: 'lesson.tattoo.offerTouch',
        on: (e) => e.type === 'tattoo' && e.what === 'start' && !e.mine,
        goal: (sim) => tileAt(sim.state.inmates[0].body.x, sim.state.inmates[0].body.z),
        fail: (c) => gamesFail(c) ?? inkFail(c),
      },
      {
        text: 'lesson.tattoo.trace',
        touch: 'lesson.tattoo.traceTouch',
        on: (e) => e.type === 'tattoo' && e.what === 'done',
        failOn: inkOff,
      },
      {
        text: 'lesson.tattoo.mine',
        touch: 'lesson.tattoo.mineTouch',
        on: (e) => e.type === 'tattoo' && e.what === 'inked',
        goal: (sim) => tileAt(sim.state.inmates[0].body.x, sim.state.inmates[0].body.z),
        fail: (c) => (c.sim.state.ink ? null : (gamesFail(c) ?? inkFail(c))),
        failOn: inkOff,
      },
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
      {
        text: 'lesson.talent.stage',
        touch: 'lesson.talent.stageTouch',
        on: (e) => e.type === 'stage' && e.what === 'start',
        goal: (sim) => stageTile(sim),
        fail: (c) => (talentOn(c.sim) ? null : 'lesson.talent.late'),
      },
      {
        text: 'lesson.talent.play',
        touch: 'lesson.talent.playTouch',
        on: (e) => e.type === 'stage' && e.what === 'done',
        failOn: (e) => (e.type === 'stage' && e.what === 'off' ? 'lesson.talent.off' : null),
      },
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
      {
        text: 'lesson.quiz.join',
        touch: 'lesson.quiz.joinTouch',
        on: (e) => e.type === 'quiz' && e.what === 'start',
        goal: (sim) => tile(sim.prison.leisure!.quiz!.spots[0].x, sim.prison.leisure!.quiz!.spots[0].z),
        fail: (c) => (quizOn(c.sim) ? null : 'lesson.quiz.late'),
      },
      // (Or the quiz played out without an answer of the player's: the others were quicker every time.)
      {
        text: 'lesson.quiz.answer',
        touch: 'lesson.quiz.answerTouch',
        on: (e) =>
          e.type === 'quiz' &&
          (((e.what === 'right' || e.what === 'wrong') && e.by === 0) || e.what === 'won' || e.what === 'tie' || e.what === 'lost'),
        failOn: quizFail,
      },
      {
        text: 'lesson.quiz.play',
        on: (e) => e.type === 'quiz' && (e.what === 'won' || e.what === 'tie' || e.what === 'lost'),
        done: (c) => !c.sim.state.quiz && c.sim.state.quizDay > 0,
        failOn: quizFail,
      },
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
];
