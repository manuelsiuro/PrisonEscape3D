import { buzz } from '../app/haptics';
import { FORGE_INT, FREED_STEPS, RECORDS_HEAT, RECORDS_MINUTE, RELEASE_FROM, RELEASE_TO } from '../content/paperwork';
import { itemNumber } from '../content/items';
import { dayMinute } from '../sim/systems/calendar';
import { itemOf } from '../sim/systems/items';
import { t, type Key } from '../i18n';
import type { Sim, SimEvent } from '../sim/Sim';
import { prisonDay } from '../sim/systems/calendar';
import { calledNow, freedNow } from '../sim/systems/paperwork';
import { STEPS_PER_SECOND } from '../sim/tuning';
import { PLAYER } from '../talk/fill';
import { banner, itemsUI, sound, view } from './context';
import { coachOnce } from './tips';
import { announcePa, dayTime } from './warden';

/**
 * The paperwork escape on screen (P36): the chips (report by 10:30; the way out open), the toasts,
 * sounds and the PA's call (the action button's words at the desk: labels.ts). Everything said is
 * the sim's own (paperwork.ts).
 */

/** Seconds the release's way out stays open for the player (`a`: the frame's way into the next step), null while it's shut. */
export function freedLeft(sim: Sim, a: number): number | null {
  const s = sim.state;
  if (!freedNow(s)) return null;
  return Math.max(0, (s.release[1] - s.step - a) / STEPS_PER_SECOND);
}
const FREED_SECS = FREED_STEPS / STEPS_PER_SECOND;

/**
 * The name on today's list still to report: the chip's words; on tomorrow's by parole: the night ahead's ('' nothing).
 * (2.42: a forged form's listing has the paperwork's pill instead, which says what to mind before the records.)
 */
export function releaseChip(sim: Sim): string {
  const s = sim.state;
  if (freedNow(s)) return '';
  if (calledNow(s)) return t('hud.release', { time: dayTime(RELEASE_TO) });
  if (s.release[0] === prisonDay(s.step) + 1 && s.parole[9] === s.release[0]) return t('hud.listed');
  return '';
}

const BLANK = itemNumber('release_form');
const FORGED = itemNumber('forged_release');

/** 2.42, the paperwork's pill on the HUD: the step the player is at, what's next, whether it's at risk. */
export interface PaperStep {
  text: string;
  tail: string;
  urgent: boolean;
}
const step: PaperStep = { text: '', tail: '', urgent: false };

/**
 * Where the paperwork escape stands (null: not under way, or the day's chip says it: called, cleared): a blank form
 * on them (forge it), a forged one (into the tray by 22:00), on tomorrow's list (the records tonight: the heat), the
 * records passed (report in the morning). Everything from the sim's own state.
 */
export function paperStep(sim: Sim): PaperStep | null {
  const s = sim.state;
  if (freedNow(s) || calledNow(s)) return null;
  const day = prisonDay(s.step);
  const m = dayMinute(s.step);
  const listed = s.release[0];
  // (A parole listing has nothing forged to look at, and the tray takes no form meanwhile: the day's chip says it.)
  if (listed && s.parole[9] === listed) return null;
  if (listed) {
    if (listed === day + 1 && m < RECORDS_MINUTE) {
      // (The records look twice with the heat up, or after a lockdown today: either, and the pill turns red.)
      const lockedToday = s.lockdown || s.release[2] === day;
      step.text = t('hud.paper.listed');
      step.urgent = lockedToday || s.heat >= RECORDS_HEAT;
      step.tail = t(lockedToday ? 'hud.paper.locked' : step.urgent ? 'hud.paper.hot' : 'hud.paper.records', {
        time: dayTime(RECORDS_MINUTE),
        n: RECORDS_HEAT,
      });
      return step;
    }
    // (Past the records with the name still on the list: they passed it; the morning's call to come.)
    step.text = t('hud.paper.passed');
    step.tail = t('hud.paper.report', { from: dayTime(RELEASE_FROM), to: dayTime(RELEASE_TO) });
    step.urgent = false;
    return step;
  }
  const inv = s.items.inv;
  const has = (item: number) => inv.some((v) => itemOf(v) === item);
  if (has(FORGED)) {
    step.text = t('hud.paper.forged');
    step.tail = t(m >= RECORDS_MINUTE ? 'hud.paper.trayTomorrow' : 'hud.paper.tray', { time: dayTime(RECORDS_MINUTE) });
    step.urgent = false;
    return step;
  }
  if (has(BLANK)) {
    step.text = t('hud.paper.blank');
    step.tail = s.items.int >= FORGE_INT ? t('hud.paper.forge') : t('hud.paper.forgeInt', { n: s.items.int, of: FORGE_INT });
    step.urgent = false;
    return step;
  }
  return null;
}

/** What the paperwork does on screen. */
export function announcePaper(sim: Sim, e: Extract<SimEvent, { type: 'paper' }>) {
  switch (e.what) {
    case 'filed':
      sound.stamp();
      banner.toast(t('toast.paper.filed'), 'good', 4200);
      coachOnce('records', 'hint.records', {
        time: dayTime(RECORDS_MINUTE),
        n: RECORDS_HEAT,
        call: dayTime(RELEASE_FROM),
        by: dayTime(RELEASE_TO),
      });
      return;
    case 'passed':
      // (A banner, queued after the filing's: the two never sit on top of each other.)
      return banner.toast(t('toast.paper.passed'), 'good', 3600);
    case 'found':
      // (The sirens are the lockdown's: they sound with it.)
      sound.sting();
      return banner.toast(t('toast.paper.found'), 'bad', 4800);
    case 'called':
      announcePa(sim, t('pa.release', { name: PLAYER.name || t('pa.releaseNumber') }));
      banner.toast(t('toast.paper.called', { time: dayTime(RELEASE_TO) }), 'good', 4200);
      return;
    case 'turnedAway':
      view.releaseStamp();
      sound.sting();
      buzz('missed');
      return banner.toast(t(`toast.paper.turned.${e.why ?? 'heat'}` as Key), 'bad', 4200);
    case 'cleared':
      view.releaseStamp();
      sound.stamp();
      sound.unlock();
      buzz('attended');
      return banner.toast(t('toast.paper.cleared', { n: Math.round(FREED_SECS) }), 'good', 4200);
    case 'missed':
      return banner.toast(t('toast.paper.missed', { time: dayTime(RELEASE_TO) }), 'bad', 3600);
    case 'shut':
      if (sim.state.escaped) return;
      sound.gateShut();
      return itemsUI.toast(t('toast.paper.shut'));
  }
}
