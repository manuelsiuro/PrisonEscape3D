import { TRAY_HEAT, FRESH_ENERGY, MEAL_ENERGY } from '../sim/tuning';
import { buzz } from '../app/haptics';
import { announceMeal } from './menuBoard';
import { type Key, t } from '../i18n';
import type { Sim, SimEvent } from '../sim/Sim';
import { mealOn, mealSteps, TRAY, traysHere } from '../sim/systems/canteen';
import { DOING } from '../sim/systems/inmates';
import { workPose } from './frame';
import { wardenOf } from '../sim/systems/rollcall';
import { touchWords } from '../ui/dom';
import { banner, board, closeSocial, itemsUI, profile, ratPanel, phonePanel, crewPanel, readCard, sound, trainCard } from './context';
import { play } from './game';
import { coachOnce, seenInteract } from './tips';
import { FEAST_ENERGY } from '../content/days';
import { floatAt } from './floats';
import { guardWord, inmateName, jobName } from '../ui/names';
import { nightTired } from './announceKit';

/** Sitting at a canteen table at a meal with nothing to eat, and the counter serving. */
function noTrayAtTable(sim: Sim): boolean {
  const s = sim.state;
  return (
    s.seat >= 0 &&
    traysHere(sim) &&
    mealOn(sim) &&
    s.tray === TRAY.NONE &&
    s.eaten < mealSteps(sim) &&
    sim.world.props[s.seat].kind === 'seat' &&
    sim.playerZone === 'canteen'
  );
}

/** Jobs, the gym and meals (out of announce.ts, v2.34.2): work and its quota, the job board, training, the count, washing, sitting, trays and meals, laps, reps, the library. */
export function announceJobs(e: SimEvent, sim: Sim) {
  switch (e.type) {
    case 'work':
      seenInteract();
      sound.work(e.act);
      // (2.30: hands on it for a moment, the mop swept.)
      if (e.act !== 'running' && e.act !== 'full') {
        workPose.until = performance.now() + (e.act === 'mop' ? 900 : 450);
        workPose.doing = e.act === 'mop' ? DOING.MOP : DOING.WORK;
      }
      if (e.act === 'running') itemsUI.toast(t('toast.machineBusy'));
      if (e.act === 'take' || e.act === 'unload') coachOnce('workArrows', 'hint.work');
      break;
    case 'quota': {
      const done = e.n >= e.of;
      if (!done) {
        sound.chime();
        itemsUI.toast(t('toast.quota', { n: e.n, of: e.of }));
      }
      break;
    }
    case 'delivered':
      sound.pickup();
      floatAt(e.who, '✉', 'cash');
      break;
    case 'job':
      if (e.who === -1) {
        if (e.change === 'hired') {
          sound.chime();
          buzz('attended');
          const later = sim.state.jobDay > sim.today;
          banner.toast(t(later ? 'toast.hiredTomorrow' : 'toast.hired', { job: jobName(sim, e.job) }), 'good', 5000);
        } else if (e.change === 'fired') {
          // The bell for the next block rings in the same step: a long toast, not a banner it would replace.
          sound.sting();
          buzz('missed');
          banner.toast(t('toast.fired', { job: jobName(sim, e.job) }), 'bad', 7000);
        } else banner.toast(t('toast.quit', { job: jobName(sim, e.job) }), 'info');
      } else if (e.change === 'fired')
        banner.toast(t('toast.jobOpen', { name: inmateName(sim, e.who), job: jobName(sim, e.job) }), 'info', 5000);
      break;
    case 'board':
      seenInteract();
      sound.drawer();
      itemsUI.closePanels();
      profile.close();
      ratPanel.close();
      phonePanel.close();
      crewPanel.close();
      board.show();
      break;
    case 'train':
      if (e.on) {
        seenInteract();
        sound.click();
        play.game?.pilot.stop();
        if (sim.rules230 || e.use !== 'study') coachOnce('trainBeat', touchWords() ? 'hint.trainBeatTouch' : 'hint.trainBeatKeys');
        else coachOnce('readWait', touchWords() ? 'hint.readTouch' : 'hint.readKeys');
      }
      break;
    case 'count':
      if (e.what === 'you') {
        // (Nothing in the way of the button.)
        itemsUI.closePanels();
        itemsUI.closeCraft();
        closeSocial();
        sound.whistle();
        buzz('missed');
        banner.toast(
          t('toast.countCall', { name: guardWord(sim, 'guard.title', { name: sim.prison.guards[wardenOf(sim)]?.name ?? '' }) }),
          'bad',
          5000,
        );
      } else if (e.what === 'answered') sound.pickup();
      else if (e.what === 'missed') {
        sound.sting();
        banner.toast(t('toast.countMissed', { n: e.heat ?? 0 }), 'bad', 4500);
      }
      break;
    case 'wash':
      if (e.on) sound.scrub();
      break;
    case 'sit':
      seenInteract();
      if (e.on) {
        sound.sit();
        play.game?.pilot.stop();
        if (e.use === 'rest') coachOnce('rest', 'hint.rest');
        // (P39: sat before the parole board, no "move to get up" over its question: the tip waits for an ordinary seat.)
        // (2.31: nor sat down to read: the book's own tip.)
        else if (!sim.state.hearing && !nightTired(sim) && !sim.state.book) coachOnce('sit', 'hint.sit');
        // (Sat at a table for a meal, no tray in front of them: where it's had.)
        if (e.use === 'sit' && noTrayAtTable(sim)) banner.toast(t('toast.noTray'), 'info', 3500);
      }
      break;
    case 'tray':
      if (e.what === 'take') {
        sound.tray();
        coachOnce('tray', 'hint.tray');
      } else if (e.what === 'return') sound.tray();
      else if (e.heat) {
        sound.trayDown();
        banner.toast(t('toast.trayHeat', { n: e.heat }), 'bad', 4000);
      } else {
        sound.trayDown();
        floatAt(-1, t(e.what === 'dropped' ? 'float.trayDropped' : e.what === 'left' ? 'float.trayLeft' : 'float.trayOver'), 'taken');
      }
      break;
    case 'meal':
      sound.eat();
      buzz('attended');
      // (2.33: what the day's dish gave, and its name; before, every tray the same.)
      announceMeal(e, (e.feast ? FEAST_ENERGY : MEAL_ENERGY) + (e.fresh ? FRESH_ENERGY : 0));
      if (sim.state.tray === TRAY.EMPTY) coachOnce('trayBack', 'hint.trayBack', { n: TRAY_HEAT });
      // A feast (P17): and health back to full.
      if (e.feast) banner.toast(t('toast.feast', { n: FEAST_ENERGY }), 'good', 4500);
      // (P31: the gardener's produce on the tray.)
      else if (e.fresh) banner.toast(t('toast.fresh', { n: FRESH_ENERGY }), 'good', 4500);
      break;
    case 'lap':
      sound.chime();
      buzz('attended');
      floatAt(-1, t('float.lap'), 'gain');
      break;
    case 'rep':
      if (e.hit) sound.repHit();
      else sound.rep();
      buzz('strike');
      if (e.key !== undefined) readCard.mark(e.key, !!e.hit);
      else if (e.hit !== undefined) trainCard.flash(e.hit);
      break;
    case 'askTurn':
      seenInteract();
      sound.click();
      play.game?.pilot.stop();
      // (Said here as well as aloud: a lesson has no barks, and the wait needs an answer.)
      itemsUI.toast(t('toast.turnAsked', { name: inmateName(sim, e.who) }));
      break;
    case 'trained':
      sound.levelUp();
      buzz('attended');
      floatAt(-1, `+2 ${t(`attr.${e.attr}Short` as Key)}`, 'gain');
      break;
    case 'cantTrain':
      sound.sting();
      itemsUI.toast(
        t(
          e.why === 'full'
            ? 'toast.headFull'
            : e.why === 'tired'
              ? nightTired(sim)
                ? 'toast.tiredNight'
                : 'toast.tooTiredTrain'
              : 'toast.maxed',
        ),
      );
      break;
    case 'book':
      // (2.31: taken from the shelf, to a chair with it.)
      if (e.on) {
        seenInteract();
        sound.click();
        if (e.seat) coachOnce('readSit', 'hint.readSit');
      }
      break;
    case 'decay':
      banner.toast(t('toast.decay', { attrs: e.attrs.map((a) => t(`attr.${a}Short` as Key)).join(', ') }), 'bad', 5000);
      break;
  }
}
