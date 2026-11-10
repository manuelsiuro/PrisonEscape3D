import { SEARCH_REACH } from '../content/days';
import type { BankId } from '../i18n/barks/en';
import type { DayEvent } from '../i18n/barks/grammar';
import type { Sim, SimEvent } from '../sim/Sim';
import { awake, GUARD } from '../sim/systems/guards';
import { DOING } from '../sim/systems/inmates';
import { handlersOf } from '../sim/systems/k9';
import { dishNow } from '../sim/systems/menu';
import type { Body } from '../sim/systems/movement';
import { RAT } from '../sim/systems/rats';
import { wardenOf } from '../sim/systems/rollcall';
import { librarianOf } from '../sim/systems/training';
import { rivals } from '../sim/systems/races';
import { prisonDay } from '../sim/systems/clock';
import { feastNow } from '../sim/systems/calendar';
import { UNIT } from '../sim/tuning';
import type { Incident } from './mood';
import type { Style } from './types';

// What the speech bubbles' director makes of each event (out of director.ts, v2.34.2): who has a word
// to say about it, how pressing, after how long; and what it remembers (an incident, the day's news).

/** How near the librarian has to be to say anything about a book (tiles). */
const LIBRARIAN_EARSHOT = 8;
/** How near the vending machine the player has to be to catch what's said at it (tiles). */
const VEND_EARSHOT = 10;
/** 2.33: a dish worth a word at the counter: this much energy or more (good), this much or less (bad). */
const DISH_GOOD = 45;
const DISH_BAD = 20;
const dist = (a: Body, b: Body) => Math.hypot(a.x - b.x, a.z - b.z) / UNIT;

/** What `react` may do with the director (its own methods and memory, handed over as these). */
export interface Reactor {
  /** A reaction waiting for its turn: the bank, who may say it (nearest first), how pressing, its trigger (one at a time), its style, after how long, for how long. */
  queueUp(now: number, bank: BankId, speakers: number[], prio: number, trigger: string, style?: Style, delay?: number, life?: number): void;
  inmatesNear(sim: Sim, x: number, z: number, range: number, but?: number): number[];
  guardsNear(sim: Sim, x: number, z: number, range: number, but?: number): number[];
  incident(kind: Incident['kind'], x: number, z: number, now: number): void;
  noteDay(e: DayEvent): void;
  bodyOf(sim: Sim, id: number): Body | undefined;
  answerBank(e: SimEvent, sim: Sim): BankId | null;
  /** The director's own randomness (never the game's). */
  random(): number;
  /** Remembered for the moods and the lines: caught, come to, a cell searched (its inmate grumbles later), the lights out, the dog talked about. */
  caught(now: number): void;
  cameTo(who: number, now: number): void;
  searched(cell: number): void;
  grumble(cell: number, at: number): void;
  powerOut(now: number): void;
  aboutDog(dog: number): void;
}

/** Reads one event of the step just run (called for each, in order). */
export function react(d: Reactor, e: SimEvent, sim: Sim, now: number) {
  const s = sim.state;
  const n = s.inmates.length;
  const px = s.player.x / UNIT;
  const pz = s.player.z / UNIT;
  const at = (id: number) => {
    const b = d.bodyOf(sim, id);
    return b ? { x: b.x / UNIT, z: b.z / UNIT } : { x: px, z: pz };
  };
  switch (e.type) {
    case 'toldOff': {
      const seeing = s.guards
        .map((g, k) => ({ id: n + k, g }))
        .filter((o) => o.g.sees && o.g.ko <= 0)
        .sort((a, b) => dist(a.g.body, s.player) - dist(b.g.body, s.player))
        .map((o) => o.id);
      d.queueUp(now, 're.spotted.stranger', seeing, 5, 'spotted:stranger', 'shout');
      break;
    }
    case 'spotted': {
      if (e.reason === 'none') break;
      const seeing = s.guards
        .map((g, k) => ({ id: n + k, g }))
        .filter((o) => o.g.sees && o.g.ko <= 0)
        .sort((a, b) => dist(a.g.body, s.player) - dist(b.g.body, s.player))
        .map((o) => o.id);
      const own = [
        'night',
        'restricted',
        'contraband',
        'recognized',
        'wanted',
        'damage',
        'tampering',
        'fight',
        'gambling',
        'skipping',
        'stranger',
        'snooping',
      ] as const;
      const bank = ((own as readonly string[]).includes(e.reason) ? `re.spotted.${e.reason}` : 're.spotted.other') as BankId;
      d.queueUp(now, bank, seeing, 5, `spotted:${e.reason}`, 'shout');
      break;
    }
    case 'caught':
      d.caught(now);
      d.queueUp(now, 're.caught.gu', d.guardsNear(sim, px, pz, 4), 5, 'caught');
      d.queueUp(now, 're.caught.in', d.inmatesNear(sim, px, pz, 9), 3, 'caughtIn', undefined, 1.2);
      break;
    case 'cantTrain':
    case 'book': {
      // (2.31: the librarian, in earshot: a nod for a book taken, a word when the head is full.)
      const said = e.type === 'book' ? (e.on ? 're.library.book' : null) : e.why === 'full' ? 're.library.full' : null;
      const who = librarianOf(sim);
      if (said && who >= 0 && !sim.rules230 && s.inmates[who].ko <= 0 && dist(s.inmates[who].body, s.player) <= LIBRARIAN_EARSHOT)
        d.queueUp(now, said, [who], 3, said);
      break;
    }
    case 'menu': {
      // (2.33: at the menu board, within earshot: a guard who caught the player at it, those laughing at what's on it.)
      const mb = sim.world.def.menu;
      if (!mb || Math.hypot(px - mb.x, pz - mb.z) > VEND_EARSHOT) break;
      if (e.what === 'caught') d.queueUp(now, 're.menu.guard', d.guardsNear(sim, px, pz, 12), 5, 'menuGuard', 'shout');
      else if (e.what === 'laugh' && e.who !== undefined) d.queueUp(now, 're.menu.laugh', [e.who], 3, 'menuLaugh', undefined, 0.3);
      break;
    }
    case 'vend': {
      // (2.32: at the machine, within earshot: a curse at a jam, what was bought, someone pushed past.)
      const vm = sim.world.def.vending;
      if (!vm || Math.hypot(px - vm.x, pz - vm.z) > VEND_EARSHOT) break;
      if (e.what === 'toldOff') d.queueUp(now, 're.vend.guard', d.guardsNear(sim, px, pz, 10), 5, 'vendGuard');
      else if (e.what === 'cut' && e.who !== undefined) d.queueUp(now, 're.vend.cut', [e.who], 5, 'vendCut');
      else if (e.who === undefined) break;
      else if (e.what === 'inmateJam' || e.what === 'inmateThump') d.queueUp(now, 're.vend.jam', [e.who], 3, 'vendJam');
      else if (e.what === 'gaveUp') d.queueUp(now, 're.vend.gaveUp', [e.who], 3, 'vendGaveUp');
      else if (e.what === 'empty') d.queueUp(now, 're.vend.empty', [e.who], 3, 'vendEmpty');
      else if (e.what === 'inmateGot' && e.who % 3 === 0) d.queueUp(now, 're.vend.got', [e.who], 1, 'vendGot');
      break;
    }
    case 'askTurn':
      // (2.29: asked for the machine: they finish up, and say so.)
      d.queueUp(now, 're.giveWay.in', [e.who], 4, 'giveWay');
      break;
    case 'bedCheck':
      if (e.result === 'start') {
        const k = s.guards.findIndex((_, i) => sim.prison.guards[i].duties?.includes('bedCheck'));
        if (k >= 0) d.queueUp(now, 'gu.bedCheck', [n + k], 2, 'bedCheck', undefined, 0, 12);
      } else if (e.awake) {
        // (2.28: up in their cell as the guard looks in: there all the same, and told so.)
        const k = s.guards.findIndex((_, i) => sim.prison.guards[i].duties?.includes('bedCheck'));
        if (k >= 0) d.queueUp(now, 're.bedAwake.gu', [n + k], 4, 'bedAwake');
      } else if (e.result === 'fail') d.queueUp(now, 're.bedFail.gu', d.guardsNear(sim, px, pz, 30), 5, 'bedFail', 'shout');
      break;
    case 'scanned':
      if (e.tripped) {
        d.incident('alarm', px, pz, now);
        d.noteDay('detector');
        d.queueUp(now, 're.detector.in', d.inmatesNear(sim, px, pz, 7), 3, 'detector');
      }
      break;
    // A lazy guard woken from its doze (P15): it insists it never slept.
    case 'nap':
      // (Not under the sirens or in a chase: "Night shift, right" would ring false.)
      if (!e.on && !sim.state.lockdown && sim.state.guards[e.guard]?.mode !== GUARD.CHASE)
        d.queueUp(now, 're.napWoke.gu', [n + e.guard], 4, 'napWoke', undefined, 0.3);
      break;
    case 'cameTo':
      d.cameTo(e.who, now);
      d.queueUp(now, e.who >= n ? 're.cameTo.gu' : 're.cameTo.in', [e.who], 4, 'cameTo', undefined, 0.4);
      break;
    case 'hit': {
      const p = at(e.who);
      d.incident(e.ko ? 'ko' : 'fight', p.x, p.z, now);
      d.noteDay('fight');
      if (e.ko) {
        d.queueUp(now, 're.ko.in', d.inmatesNear(sim, p.x, p.z, 8, e.who), 3, 'ko', undefined, 0.5);
        if (e.who >= n) d.queueUp(now, 're.ko.gu', d.guardsNear(sim, p.x, p.z, 9, e.who), 4, 'koGuard', 'shout', 0.3);
      } else d.queueUp(now, 're.fight.in', d.inmatesNear(sim, p.x, p.z, 7, e.who), 3, 'fight', 'shout', 0.3);
      break;
    }
    case 'allyHit': {
      const p = at(e.who);
      d.incident(e.ko ? 'ko' : 'fight', p.x, p.z, now);
      d.queueUp(now, 're.fight.in', d.inmatesNear(sim, p.x, p.z, 7, e.who), 3, 'fight', 'shout', 0.3);
      // A follower's brawl: the guards nearby want it over.
      d.queueUp(now, 're.fight.gu', d.guardsNear(sim, p.x, p.z, 8, e.who), 2, 'fightGu', 'shout', 0.8);
      break;
    }
    case 'hurt':
      if (e.by >= 0 && e.by < n) d.queueUp(now, 're.taunt.in', [e.by], 4, 'taunt', 'shout');
      break;
    case 'ambush':
      d.queueUp(now, 're.ambush.in', [e.who], 5, 'ambush', 'shout');
      break;
    // 2.36: gang business: a member's word on meeting the player, the boss's welcome, a turf's warning and its
    // end, the gang turning on someone who hit one of their own, the war's rival.
    case 'gang': {
      const who = e.who ?? -1;
      if (who < 0 || who >= n) break;
      const bank =
        e.what === 'met'
          ? 're.gang.met'
          : e.what === 'joined'
            ? 're.gang.joined'
            : e.what === 'warn'
              ? 're.gang.warn'
              : e.what === 'jumped' || e.what === 'warJump'
                ? 're.gang.jumped'
                : e.what === 'kicked'
                  ? 're.gang.out'
                  : null;
      if (bank && who !== s.talk)
        d.queueUp(
          now,
          bank,
          [who],
          e.what === 'met' ? 3 : 5,
          `gang:${e.what}`,
          e.what === 'met' || e.what === 'joined' ? undefined : 'shout',
        );
      break;
    }
    case 'snooped':
      d.queueUp(now, 're.snooped.in', [e.who], 5, 'snooped', 'shout');
      break;
    case 'tray': {
      // (2.33: a tray taken of a dish worth a word, good or bad: someone near says so.)
      const dish = e.what === 'take' && !feastNow(sim) ? dishNow(sim) : null;
      if (dish && (dish.energy >= DISH_GOOD || dish.energy <= DISH_BAD))
        d.queueUp(
          now,
          dish.energy >= DISH_GOOD ? 're.menu.good' : 're.menu.bad',
          d.inmatesNear(sim, px, pz, 5),
          2,
          'menuDish',
          undefined,
          1.5,
        );
      // (Not brought back: the nearest guard says so.)
      if (!e.heat) break;
      d.queueUp(now, 're.tray.gu', d.guardsNear(sim, px, pz, 12), 4, 'tray', 'shout');
      break;
    }
    case 'thrown': {
      const p = at(e.who);
      d.incident('fight', p.x, p.z, now);
      d.queueUp(now, 're.thrown.in', d.inmatesNear(sim, p.x, p.z, 8, e.who), 3, 'thrown', undefined, 0.4);
      break;
    }
    case 'lockdown':
      if (e.on) {
        d.incident('alarm', px, pz, now);
        d.noteDay('lockdown');
        d.queueUp(now, 're.lockdown.gu', d.guardsNear(sim, px, pz, 40), 4, 'lockdown', 'shout', 0.6);
        d.queueUp(now, 're.lockdown.in', d.inmatesNear(sim, px, pz, 40), 3, 'lockdownIn', undefined, 1.6);
      } else d.queueUp(now, 're.lockdownOff.in', d.inmatesNear(sim, px, pz, 40), 2, 'lockdownOff', undefined, 1);
      break;
    case 'count': {
      // The warden's call, and the answer from the line.
      const warden = sim.state.inmates.length + wardenOf(sim);
      // (Each its own trigger: a shared one's wait would swallow all but the first.)
      if (e.what === 'called') d.queueUp(now, 're.count.gu', [warden], 3, 'count', 'shout');
      else if (e.what === 'you') d.queueUp(now, 're.countYou.gu', [warden], 5, 'countYou', 'shout');
      else if (e.what === 'missed') d.queueUp(now, 're.countMiss.gu', [warden], 5, 'countMiss', 'shout');
      if (e.what === 'called' && e.who >= 0) d.queueUp(now, 're.count.in', [e.who], 3, 'countIn', undefined, 0.5);
      break;
    }
    case 'shakedown':
      d.noteDay('shakedown');
      if (wardenOf(sim) >= 0) d.queueUp(now, 're.shakedown.gu', [sim.state.inmates.length + wardenOf(sim)], 4, 'shakedownGu', 'shout');
      d.queueUp(now, 're.shakedown.in', d.inmatesNear(sim, px, pz, 30), 2, 'shakedown', undefined, 1.5, 6);
      break;
    case 'searched': {
      d.searched(e.cell);
      // Its inmate grumbles about it the next time it's on screen (a minute or so).
      d.grumble(e.cell, now + 90);
      break;
    }
    case 'power':
      // Irongate's GEN-1 runs only the detectors and cameras: nobody notices a blackout that isn't one.
      if (!e.on && !sim.powered('lights')) {
        d.powerOut(now);
        d.noteDay('power');
        // P17: lightning has its own cries; the generator's service was announced (inmates still notice the dark).
        const storm = e.by === 'storm' && sim.prison.theme !== 'alpine';
        d.queueUp(now, storm ? 're.storm.in' : 're.power.in', d.inmatesNear(sim, px, pz, 30), 3, 'power', undefined, 0.5);
        if (e.by !== 'maintenance')
          d.queueUp(now, storm ? 're.storm.gu' : 're.power.gu', d.guardsNear(sim, px, pz, 30), 3, 'powerGu', 'shout', 1.4);
      }
      break;
    // The day (P17): the drill's bell, a food fight breaking out.
    case 'today':
      if (e.phase === 'start' && e.event === 'drill')
        d.queueUp(now, 're.drill.in', d.inmatesNear(sim, px, pz, 30), 3, 'drill', undefined, 0.6);
      if (e.phase === 'start' && e.event === 'foodFight')
        d.queueUp(now, 're.foodFight.in', d.inmatesNear(sim, px, pz, 20), 3, 'foodFight', 'shout', 0.2);
      // Sports day (P22): everyone limbering up; the champion cheered.
      if (e.phase === 'start' && e.event === 'sports')
        d.queueUp(now, 're.sports.in', d.inmatesNear(sim, px, pz, 24), 3, 'sports', undefined, 1.2);
      if (e.phase === 'prize' && e.event === 'sports')
        d.queueUp(now, 're.champion.in', d.inmatesNear(sim, px, pz, 16), 3, 'champion', 'shout', 1.6);
      // Visiting day (P21): the inmates about the visiting room, looking forward to it.
      if (e.event === 'visiting' && e.phase === 'start' && sim.prison.smuggling?.visits) {
        const r = sim.prison.smuggling.visits;
        d.queueUp(now, 're.visiting.in', d.inmatesNear(sim, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2, 24), 3, 'visiting', undefined, 1);
      }
      // Delivery day (P18): the inmates by its bay see it come in; its supervisor at the tail, searching.
      if (e.event === 'delivery' && sim.prison.delivery) {
        const tx = sim.prison.delivery.tail.x + 0.5;
        const tz = sim.prison.delivery.tail.z + 0.5;
        if (e.phase === 'start') d.queueUp(now, 're.delivery.in', d.inmatesNear(sim, tx, tz, 18), 2, 'delivery', undefined, 1.2);
        if (e.phase === 'search')
          d.queueUp(
            now,
            e.thorough ? 're.searchClose.gu' : 're.searchQuick.gu',
            d.guardsNear(sim, tx, tz, SEARCH_REACH + 1),
            4,
            'search',
            undefined,
            0.2,
          );
      }
      break;
    case 'stow':
      if (e.found) d.queueUp(now, 're.stowFound.in', d.inmatesNear(sim, px, pz, 12), 3, 'stowFound', undefined, 1.6);
      break;
    // The parole board (P39): inmates by the desk have a word for an application; a guard for one voided.
    case 'parole':
      if (e.what === 'applied' && !e.lawyer) d.queueUp(now, 're.parole.in', d.inmatesNear(sim, px, pz, 6), 2, 'parole', undefined, 1);
      else if (e.what === 'voided') d.queueUp(now, 're.paroleVoid.gu', d.guardsNear(sim, px, pz, 10), 4, 'paroleVoid', undefined, 0.6);
      else if (e.what === 'granted')
        d.queueUp(now, 're.paroleGranted.in', d.inmatesNear(sim, px, pz, 8), 2, 'paroleGranted', undefined, 1.4);
      break;
    // Holidays (P42): a laugh at the costume, the water fight, the fireworks, the eggs hidden.
    case 'holiday':
      if (e.what === 'laugh' && e.who !== undefined) d.queueUp(now, 're.hol.laugh.in', [e.who], 4, 'holLaugh', 'shout', 0.1);
      else if (e.what === 'start' && e.day === 'waterFight')
        d.queueUp(now, 're.hol.water.in', d.inmatesNear(sim, px, pz, 24), 3, 'holWater', 'shout', 0.4);
      else if (e.what === 'start' && e.day === 'newYearsEve')
        d.queueUp(now, 're.hol.fireworks.in', d.inmatesNear(sim, px, pz, 30), 3, 'holFireworks', 'shout', 0.6);
      else if (e.what === 'hidden') d.queueUp(now, 're.hol.eggs.in', d.inmatesNear(sim, px, pz, 30), 2, 'holEggs', undefined, 2, 5);
      break;
    // A glide (P24) that came down inside: whoever is near where the player landed has a word for it.
    case 'glide':
      if (!s.escaped) {
        d.queueUp(now, 're.glide.gu', d.guardsNear(sim, px, pz, 10), 4, 'glide', 'shout', 0.3);
        d.queueUp(now, 're.glide.in', d.inmatesNear(sim, px, pz, 12), 3, 'glideIn', undefined, 0.9);
      }
      break;
    // Guard dogs (P19): its handler has something to say about what it did; inmates about a dog fed.
    case 'dog': {
      const dog = s.dogs[e.dog];
      const h = handlersOf(sim.world)[e.dog];
      if (!dog || h === undefined) break;
      d.aboutDog(e.dog);
      const handler = s.guards[h] && awake(s.guards[h]) ? [n + h] : [];
      const bank = (
        {
          sniff: 're.dogSniff.gu',
          track: 're.dogTrack.gu',
          lost: 're.dogLost.gu',
          dug: 're.dogDug.gu',
          dazed: 're.dogDazed.gu',
          asleep: 're.dogAsleep.gu',
        } as Partial<Record<string, BankId>>
      )[e.what];
      if (bank)
        d.queueUp(
          now,
          bank,
          handler,
          e.what === 'dug' || e.what === 'sniff' ? 5 : 4,
          `dog:${e.what}`,
          e.what === 'sniff' || e.what === 'dug' ? 'shout' : undefined,
          0.3,
        );
      if (e.what === 'fed' || e.what === 'friend')
        d.queueUp(now, 're.dogFed.in', d.inmatesNear(sim, dog.body.x / UNIT, dog.body.z / UNIT, 8), 2, 'dogFed', undefined, 0.8);
      break;
    }
    // The pet rat (P20): a panic's shrieks and grumbles, a guard missing his key, a rat on the player's shoulder noticed.
    case 'rat': {
      const r = e.what === 'loose' ? (s.rats.find((x) => x.mode === RAT.LOOSE && x.wild === !!e.wild) ?? null) : null;
      if (r) {
        d.queueUp(now, 're.ratPanic.in', d.inmatesNear(sim, r.x / UNIT, r.z / UNIT, 7), 4, 'ratPanic', 'shout', 0.2);
        d.queueUp(now, 're.ratPanic.gu', d.guardsNear(sim, r.x / UNIT, r.z / UNIT, 9), 4, 'ratPanicGu', undefined, 1.1);
      }
      if (e.what === 'tamed' || (e.what === 'home' && d.random() < 0.3))
        d.queueUp(now, 're.ratShoulder.in', d.inmatesNear(sim, px, pz, 5), 2, 'ratShoulder', undefined, 0.9);
      break;
    }
    case 'keyless':
      if (s.guards[e.guard]) d.queueUp(now, 're.keyless.gu', [n + e.guard], 5, 'keyless', 'shout', 0.2);
      break;
    // Smuggling (P21): the drone overhead (guards and inmates near where it drops), a guard taking what it dropped, the player's visitor.
    case 'smuggle': {
      if (e.what === 'dropped' && e.tile !== undefined) {
        const x = (e.tile % 64) + 0.5;
        const z = Math.floor(e.tile / 64) + 0.5;
        d.queueUp(now, 're.drone.gu', d.guardsNear(sim, x, z, 12), 2, 'drone', 'shout', 0.4);
        d.queueUp(now, 're.drone.in', d.inmatesNear(sim, x, z, 10), 2, 'droneIn', undefined, 0.9);
      }
      if (e.what === 'seized' && e.guard !== undefined && s.guards[e.guard])
        d.queueUp(now, 're.seized.gu', [n + e.guard], 5, 'seized', undefined, 0.3);
      if (e.what === 'visit') d.queueUp(now, 're.visit.in', d.inmatesNear(sim, px, pz, 6), 2, 'visit', undefined, 1.4);
      break;
    }
    // Side games (P22): the dice partner when the dice are down (a sore loser, a gloating winner), the crowd at a bout, sports day.
    case 'dice':
      if (e.what === 'won' || e.what === 'lost')
        d.queueUp(
          now,
          e.what === 'won' ? 're.diceWon.in' : 're.diceLost.in',
          [e.who],
          4,
          `dice:${e.what}`,
          undefined,
          e.theirs && sim.events.some((x) => x.type === 'dice' && x.what === 'rerolled') ? 2.1 : 1.5,
        );
      break;
    case 'bout':
      if (e.what === 'start')
        d.queueUp(
          now,
          're.bout.in',
          d.inmatesNear(sim, px, pz, 6).filter((k) => k !== e.who),
          2,
          'bout',
          'shout',
          0.6,
        );
      if (e.what === 'won') {
        d.queueUp(
          now,
          're.boutWon.in',
          d.inmatesNear(sim, px, pz, 6).filter((k) => k !== e.who),
          3,
          'boutWon',
          'shout',
          0.3,
        );
        d.queueUp(now, 're.boutLoser.in', [e.who], 3, 'boutLoser', undefined, 1.4);
      }
      if (e.what === 'lost') {
        d.queueUp(now, 're.boutWinner.in', [e.who], 3, 'boutWinner', undefined, 0.5);
        // (2.40: those who came to watch groan with the player.)
        d.queueUp(now, 're.watchLost.in', sim.state.watch ?? [], 3, 'watchLost', undefined, 1.2);
      }
      break;
    // 2.41: the race's end: the winning rat's owner crows, the others' grumble, the crowd talks it over.
    case 'race':
      if (e.what === 'result' && sim.state.watch?.length) {
        const day = prisonDay(s.step);
        const card = rivals(s, day);
        const owner = card[e.order?.[0] ?? -1]?.owner ?? -1;
        const w = sim.state.watch;
        const owners = card.map((x) => x.owner).filter((k) => w.includes(k));
        if (owner >= 0 && w.includes(owner)) d.queueUp(now, 're.raceWin.in', [owner], 3, 'raceWin', 'shout', 0.3);
        d.queueUp(
          now,
          're.raceLost.in',
          owners.filter((k) => k !== owner),
          3,
          'raceLost',
          undefined,
          1.1,
        );
        d.queueUp(
          now,
          're.raceEnd.in',
          w.filter((k) => !owners.includes(k)),
          2,
          'raceEnd',
          undefined,
          1.8,
        );
      }
      break;
    // 2.41: quiz night's crowd: a cheer as the player wins it, a groan for them if not.
    case 'quiz':
      if (e.what === 'won') d.queueUp(now, 're.watchWin.in', sim.state.watch ?? [], 3, 'watchWin', 'shout', 1.6);
      else if (e.what === 'lost') d.queueUp(now, 're.watchLost.in', sim.state.watch ?? [], 3, 'watchLost', undefined, 1.8);
      break;
    // 2.40: the crowd at the player's game: a cheer or a groan as a hand of Cheat, a shootout or the old-timer's board ends.
    case 'cheat':
    case 'hoops':
    case 'checkers':
      if (e.what === 'won') d.queueUp(now, 're.watchWin.in', sim.state.watch ?? [], 3, 'watchWin', 'shout', 0.4);
      else if (e.what === 'lost') d.queueUp(now, 're.watchLost.in', sim.state.watch ?? [], 3, 'watchLost', undefined, 0.6);
      break;
    case 'shot':
      d.incident('shot', px, pz, now);
      d.noteDay('shot');
      d.queueUp(now, 're.shot.in', d.inmatesNear(sim, px, pz, 12), 3, 'shot', 'shout', 0.3);
      break;
    case 'blast': {
      const x = e.tile % 64;
      const z = Math.floor(e.tile / 64);
      d.incident('blast', x, z, now);
      d.noteDay('blast');
      d.queueUp(now, 're.blast.in', d.inmatesNear(sim, x, z, 16), 3, 'blast', 'shout', 0.4);
      break;
    }
    case 'shocked':
      d.queueUp(now, 're.shocked.in', d.inmatesNear(sim, px, pz, 9), 3, 'shocked', undefined, 0.6);
      break;
    case 'takeover':
      if (e.on) {
        d.noteDay('takeover');
        d.queueUp(now, 're.takeover.in', d.inmatesNear(sim, px, pz, 40), 4, 'takeover', 'shout', 0.4);
        d.queueUp(now, 're.takeover.gu', d.guardsNear(sim, px, pz, 40), 4, 'takeoverGu', 'shout', 1.4);
      }
      break;
    // Said to the player across the talk panel: the panel shows it (see answer()); a bubble otherwise.
    case 'gift':
    case 'opinion':
    case 'favor':
    case 'recruit':
    case 'oddjob':
    case 'tip': {
      const bank = d.answerBank(e, sim);
      const who = e.who ?? -1;
      if (bank && who >= 0 && who !== s.talk) d.queueUp(now, bank, [who], 3, bank);
      break;
    }
    // The crew (P23): an order taken (in the talk panel, or a bubble), a lookout's whistle, a brawl and its crowd, a drop handed over, an ambush called off.
    case 'crew':
      switch (e.what) {
        case 'order': {
          const bank = d.answerBank(e, sim);
          if (bank && e.who !== s.talk) d.queueUp(now, bank, [e.who], 3, bank);
          break;
        }
        case 'whistle':
          d.queueUp(now, 're.whistle.in', [e.who], 5, `whistle:${e.who}`, 'shout', 0, 2);
          break;
        case 'recalled':
          d.queueUp(now, 're.recalled.in', [e.who], 3, 'recalled', undefined, 0.4);
          break;
        case 'brawl': {
          const other = e.other ?? -1;
          const c = at(other);
          d.queueUp(now, 're.brawl.in', [e.who], 5, 'brawl', 'shout');
          if (other >= 0) d.queueUp(now, 're.brawled.in', [other], 5, 'brawled', 'shout', 1.3);
          d.queueUp(
            now,
            're.brawlCrowd.in',
            d.inmatesNear(sim, c.x, c.z, 8).filter((k) => k !== e.who && k !== other),
            3,
            'brawlCrowd',
            'shout',
            2.4,
          );
          break;
        }
        case 'handed':
          d.queueUp(now, 're.handed.in', [e.who], 3, 'handed', 'whisper');
          break;
        case 'stopped':
          d.queueUp(now, 're.stopped.in', [e.who], 4, 'stopped');
          break;
      }
      break;
    case 'routine':
      if (d.random() < 0.5) d.queueUp(now, 're.bell.in', d.inmatesNear(sim, px, pz, 14), 2, 'bell', undefined, 1);
      break;
    // Noise (P14): the guards sent to look say so, those close by wonder; a bang wakes the
    // sleepers within earshot; an inmate hit by something thrown complains.
    case 'noise': {
      const x = e.tile % 64;
      const z = Math.floor(e.tile / 64);
      const sent = e.sent.map((k) => n + k);
      if (e.kind === 'bang') {
        d.incident('blast', x, z, now);
        d.noteDay('firecracker');
        d.queueUp(now, 're.bang.gu', sent, 4, 'bangGu', 'shout', 0.3);
        d.queueUp(now, 're.bang.in', d.inmatesNear(sim, x, z, 10), 3, 'bang', 'shout', 0.6);
        const woken = s.inmates
          .map((m, k) =>
            m.doing === DOING.SLEEP && m.ko <= 0 && e.tiles.includes(Math.floor(m.body.z / UNIT) * 64 + Math.floor(m.body.x / UNIT))
              ? k
              : -1,
          )
          .filter((k) => k >= 0);
        d.queueUp(now, 're.woken.in', woken, 3, 'woken', undefined, 1.2);
      } else if (e.kind === 'ring') {
        d.noteDay('alarmClock');
        d.queueUp(now, 're.ring.gu', sent, 3, 'ringGu', 'shout', 0.3);
        d.queueUp(now, 're.ring.in', d.inmatesNear(sim, x, z, 7), 2, 'ring', undefined, 0.8);
      } else {
        d.queueUp(now, 're.noise.gu', sent, 3, 'noiseGu', undefined, 0.3);
        if (e.kind === 'thud' || sent.length) d.queueUp(now, 're.noise.in', d.inmatesNear(sim, x, z, 5), 1, 'noiseIn', undefined, 0.8);
      }
      break;
    }
    case 'tossed':
      if (e.hit >= 0) d.queueUp(now, 're.tossHit.in', [e.hit], 4, 'tossHit', 'shout', 0.2);
      break;
  }
}
