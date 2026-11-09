import { hhmm, pad2 } from '../sim/systems/clock';
import { LIGHTS_OUT_GRACE, LIGHTS_OUT_GRACE_227, MEAL_ENERGY, STEPS_PER_MINUTE } from '../sim/tuning';
import { buzz } from '../app/haptics';
import { hostile } from '../sim/systems/social';
import { ROUTINE, type RoutineId } from '../content/routine';
import { type Key, listOf, t } from '../i18n';
import { itemsText } from '../ui/itemFacts';
import { freeTimeLine } from './whatsOn';
import type { Sim, SimEvent } from '../sim/Sim';
import { jobRooms } from '../sim/systems/economy';
import { traysHere } from '../sim/systems/canteen';
import { squareNeeded } from '../sim/systems/rollcall';

import { routineName, routinePlace } from '../ui/hud';
import { itemName } from '../ui/items';
import { banner, itemsUI, sleepVeil, sound } from './context';
import { play } from './game';
import { coachOnce, seenInteract, seenTip } from './tips';
import { vehicleThe } from './labels';

/** The last thing guards noticed, and when (real time): repeats are quiet for a moment. */
/** 2.35: when a guard last started noticing (its sound isn't repeated in a crowd of them). */
let lastNoticing = 0;
const lastSpotted = { reason: '', at: 0 };

/** Below this the morning after a night awake (2.28), they're told why, once. */
const NO_SLEEP_HINT = 40;
/** When the player fell asleep (minute of the day, -1 none), and whether they have since Lights Out (null: not known, a game loaded at night). */
let sleptSince = -1;
let sleptTonight: boolean | null = null;

/** A night taken out of their hands (solitary, the infirmary, a lockdown) isn't one they chose to stay up. */
export function nightNotChosen(e: SimEvent) {
  if (e.type === 'solitary' || e.type === 'infirmary' || (e.type === 'lockdown' && e.on)) sleptTonight = null;
}

/** At a meal or the showers: how they pick the player up, told the first time (GDD §2, §3.1). */
function arrivedAt(sim: Sim, id: RoutineId) {
  // (2.33: told afresh, now that what a tray gives depends on the day's dish.)
  if ((id === 'breakfast' || id === 'dinner') && sim.rules232)
    coachOnce('meal', traysHere(sim) ? 'hint.meal' : 'hint.mealTable', { n: MEAL_ENERGY });
  else if (id === 'breakfast' || id === 'dinner') coachOnce('mealMenu', traysHere(sim) ? 'hint.mealMenu' : 'hint.mealTableMenu');
  // (2.26: told afresh to those who knew the old way, standing still.)
  if (id === 'showers')
    coachOnce(sim.rules225 ? 'shower' : 'showerOn', !sim.rules225 && hostile(sim) ? 'hint.showerHostile' : 'hint.shower');
}

/** The day and the guards (out of announce.ts, v2.34.2): the routine's bells, roll call and the count, lockdowns, being spotted, caught and carried off, searches, sleep and the bed dummy. */
/** A banner's line for what a capture took: by name when the sim says (2.36), else how many. */
const takenText = (items: readonly number[] | undefined, n: number) =>
  items?.length ? t('banner.takenItems', { items: itemsText(items) }) : t('banner.taken', { n });

export function announceDay(e: SimEvent, sim: Sim) {
  switch (e.type) {
    case 'routine': {
      if (squareNeeded(sim)) coachOnce('rollCallSquare', 'hint.rollCall');
      // (2.28: the night's rules told once; and the morning after one with no sleep, once, when it shows.)
      if (ROUTINE[e.routine].id === 'lightsOut') {
        // (Not forced to be up: told what they can do about it, or not told at all.)
        const free = !sim.state.lockdown && sim.state.solitary <= 0 && sim.state.ko <= 0;
        sleptTonight = free ? false : null;
        if (free && !sim.world.def.rules?.relaxed) coachOnce('night', 'hint.night');
      } else if (ROUTINE[e.routine].id === 'rollCall') {
        if (
          sleptTonight === false &&
          !sim.state.lockdown &&
          sim.state.solitary <= 0 &&
          sim.state.ko <= 0 &&
          sim.state.energy < NO_SLEEP_HINT
        )
          coachOnce('noSleep', 'hint.noSleep', { n: sim.state.energy });
        sleptTonight = null;
      }
      if (sim.state.lockdown) break;
      sound.bell();
      buzz('bell');
      const r = ROUTINE[e.routine];
      // The Work Period with a job: to its room; without one, more free time.
      const job = r.id === 'work' ? sim.jobActive() : -1;
      const sub =
        r.id === 'lightsOut'
          ? t('banner.lightsOut', { time: hhmm(r.start + (sim.rules227 ? LIGHTS_OUT_GRACE_227 : LIGHTS_OUT_GRACE) / STEPS_PER_MINUTE) })
          : job >= 0
            ? t('banner.toWork', { place: t(`zone.${jobRooms(sim.world)[job].def.zone}` as Key), n: jobRooms(sim.world)[job].def.quota })
            : r.zones.length
              ? t('banner.goTo', { place: routinePlace(e.routine) })
              : // (2.39: free time says what it opens.)
                r.id === 'freeTime' || r.id === 'eveningFreeTime'
                ? freeTimeLine(sim)
                : t('banner.free');
      banner.show(routineName(e.routine), sub);
      break;
    }
    case 'arrived': {
      // (2.23: checking in takes a while: told once, the first time; then the meal's and the showers' own.)
      const r = ROUTINE[e.routine];
      if (!seenTip('stay')) coachOnce('stay', 'hint.stay', { n: r.stay ?? 0 });
      else arrivedAt(sim, r.id);
      break;
    }
    case 'attended': {
      const id = ROUTINE[e.routine].id;
      if (id === 'lightsOut') break;
      sound.chime();
      buzz('attended');
      // (Before 2.23, checked in on arrival: the hints as the player gets there.)
      if (sim.rules222) arrivedAt(sim, id);
      break;
    }
    case 'missed':
      sound.sting();
      buzz('missed');
      if (e.heat < 100)
        banner.toast(
          t(e.offSquare ? 'toast.offSquare' : e.early ? 'toast.leftEarly' : 'toast.missed', { routine: routineName(e.routine), n: e.heat }),
          'bad',
        );
      break;
    case 'lockdown':
      // The siren and the red glow follow the state every frame (see frame()).
      if (e.on) {
        buzz('lockdown');
        const missed = sim.events.find((m) => m.type === 'missed' && m.heat >= 100);
        const seen = sim.events.find((m) => m.type === 'spotted');
        const why =
          missed?.type === 'missed'
            ? t('banner.lockdownSub', { routine: routineName(missed.routine) })
            : seen?.type === 'spotted'
              ? t(`spotted.${seen.reason}` as Key)
              : t('banner.lockdownHeat');
        banner.show(t('banner.lockdown'), why, 'alarm', 5000);
      }
      break;
    case 'toldOff': {
      // (The heat a few seconds on, if they stay, says nothing more: it's been said.)
      lastSpotted.reason = 'stranger';
      lastSpotted.at = performance.now();
      sound.whistle();
      banner.toast(t('spotted.stranger'), 'info');
      coachOnce('workRoom', 'hint.workRoom');
      break;
    }
    case 'spotted': {
      // The same thing noticed again within a few seconds (a guard glancing away and back): say it once.
      const now = performance.now();
      if (e.reason === lastSpotted.reason && now - lastSpotted.at < 6000) break;
      lastSpotted.reason = e.reason;
      lastSpotted.at = now;
      sound.whistle();
      buzz('missed');
      // A lockdown in the same step says it in its banner.
      if (!sim.events.some((m) => m.type === 'lockdown')) banner.toast(t(`spotted.${e.reason}` as Key), 'bad');
      if (e.reason === 'searchlight') coachOnce('searchlight', 'hint.searchlight');
      break;
    }
    // 2.35: a guard making sure of what it saw (its "?" filling): a "hm?", not more than every couple of seconds.
    case 'noticing': {
      const now = performance.now();
      if (now - lastNoticing > 2000) sound.huh();
      lastNoticing = now;
      coachOnce('noticing', 'hint.noticing');
      break;
    }
    case 'caught':
      sound.thud();
      buzz('lockdown');
      itemsUI.closePanels();
      play.game?.pilot.stop();
      // (Pulled out of the delivery's vehicle, P18: the banner says where they were found.)
      if (sim.events.some((x) => x.type === 'stow' && x.found))
        banner.show(t('banner.found'), t('banner.foundSub', { vehicle: vehicleThe(sim) }), 'alarm', 3600);
      else banner.show(t('banner.caught'), e.solitary ? t('banner.caughtSolitary') : t('banner.caughtInfirmary'), 'alarm', 3000);
      break;
    case 'solitary':
      if (e.on) {
        sound.lockClank();
        banner.show(t('banner.solitary'), e.taken ? takenText(e.items, e.taken) : t('banner.nothingTaken'), 'alarm', 4500);
      } else {
        sound.chime();
        banner.toast(t('toast.released'), 'good');
      }
      break;
    case 'infirmary':
      sound.chime();
      banner.show(t('banner.infirmary'), e.taken ? takenText(e.items, e.taken) : t('banner.nothingTaken'), 'routine', 4500);
      break;
    case 'peel':
      seenInteract();
      sound.peel(e.done);
      if (e.done) {
        buzz('bell');
        itemsUI.toast(t('toast.peeled'));
      }
      break;
    case 'shakedown':
      if (e.cells.includes(1)) {
        sound.sting();
        banner.toast(t('toast.shakedownYou'), 'bad', 5000);
      } else banner.toast(t('toast.shakedown', { cells: listOf(e.cells.map(String)) }), 'info', 4500);
      break;
    case 'searched':
      if (e.cell !== 1) break;
      if (e.taken) {
        sound.sting();
        // (2.36: what they took, by name.)
        banner.toast(
          e.items?.length ? t('toast.searchedItems', { items: itemsText(e.items) }) : t('toast.searchedYou', { n: e.taken }),
          'bad',
          5500,
        );
      } else banner.toast(t('toast.searchedClean'), 'good');
      break;
    case 'bedCheck':
      // Asleep, the night runs fast: no need to hear about it.
      if (sim.state.sleeping) break;
      if (e.result === 'start') banner.toast(t('toast.bedCheck'), 'info');
      else if (e.result === 'pass' && sim.playerZone !== 'playerCell') banner.toast(t('toast.bedCheckPass'), 'good');
      break;
    case 'sleep':
      sound.click();
      if (e.on) {
        sleepVeil.querySelector('span')!.textContent = t('sleep.asleep');
        sleptSince = sim.clock.minuteOfDay;
        sleptTonight = true;
      } else if (sleptSince >= 0 && !sim.state.lockdown && sim.state.ko <= 0) {
        // What the night did for them (2.28), for anything over a nap.
        const slept = (sim.clock.minuteOfDay - sleptSince + 1440) % 1440;
        if (slept >= 60)
          banner.toast(t('toast.slept', { h: Math.floor(slept / 60), m: pad2(slept % 60), n: sim.state.energy }), 'good', 4500);
        sleptSince = -1;
      }
      break;
    case 'bedDummy':
      sound.pickup();
      banner.toast(
        e.swapped ? t('toast.dummySwapped', { item: itemName(e.swapped) }) : t(e.in ? 'toast.dummyIn' : 'toast.dummyOut'),
        'info',
        4500,
      );
      break;
    case 'cells':
      if (e.locked) sound.lockClank();
      if (e.locked && !sim.state.lockdown) banner.toast(t('toast.cellsLocked'), 'info');
      break;
  }
}
