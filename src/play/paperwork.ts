import { buzz } from '../app/haptics';
import { FREED_STEPS, RECORDS_HEAT, RECORDS_MINUTE, RELEASE_FROM, RELEASE_TO } from '../content/paperwork';
import { t, type Key } from '../i18n';
import type { Sim, SimEvent } from '../sim/Sim';
import { prisonDay } from '../sim/systems/calendar';
import { atRelease, atTray, calledNow, freedNow, releaseRefusal, trayRefusal } from '../sim/systems/paperwork';
import { STEPS_PER_SECOND } from '../sim/tuning';
import { PLAYER } from '../talk/fill';
import { banner, itemsUI, sound } from './context';
import { coachOnce } from './tips';
import { announcePa, dayTime } from './warden';

/**
 * The paperwork escape on screen (P36): what the action button says at the release desk (slip a
 * forged form into the tray, or report there when the name is called), the chips (report by
 * 10:30; the way out open), and the toasts, sounds and the PA's call. Everything said is the
 * sim's own (paperwork.ts).
 */

const ACT = { verb: '', what: '', no: false };
const TRAY_WHY: Record<string, Key> = { watched: 'thing.trayWatched', hunted: 'thing.hunted', onList: 'thing.onList', trayLate: 'thing.trayLate' };
const DESK_WHY: Record<string, Key> = { heat: 'thing.releaseHeat', lockdown: 'thing.hunted', contraband: 'thing.releaseContraband' };

/** At the release desk: Report (the name called; said what the desk will mind, it can still be tried), or File the form (greyed, saying why, when it wouldn't go in). */
export function deskAction(sim: Sim): { verb: string; what: string; no: boolean } | null {
  if (atRelease(sim)) {
    const r = releaseRefusal(sim.state);
    ACT.verb = t('act.report');
    ACT.what = t(r ? DESK_WHY[r] : 'thing.releaseDesk');
    ACT.no = false;
    return ACT;
  }
  if (atTray(sim)) {
    const r = trayRefusal(sim);
    ACT.verb = t('act.fileForm');
    ACT.what = t(r ? TRAY_WHY[r] : 'thing.releaseTray');
    ACT.no = !!r;
    return ACT;
  }
  return null;
}

/** Seconds the release's way out stays open for the player (`a`: the frame's way into the next step), null while it's shut. */
export function freedLeft(sim: Sim, a: number): number | null {
  const s = sim.state;
  if (!freedNow(s)) return null;
  return Math.max(0, (s.release[1] - s.step - a) / STEPS_PER_SECOND);
}
const FREED_SECS = FREED_STEPS / STEPS_PER_SECOND;

/** The name on today's list still to report: the chip's words; on tomorrow's: the night ahead's ('' nothing). */
export function releaseChip(sim: Sim): string {
  const s = sim.state;
  if (freedNow(s)) return '';
  if (calledNow(s)) return t('hud.release', { time: dayTime(RELEASE_TO) });
  if (s.release[0] === prisonDay(s.step) + 1) return t('hud.listed');
  return '';
}

/** What the paperwork does on screen. */
export function announcePaper(sim: Sim, e: Extract<SimEvent, { type: 'paper' }>) {
  switch (e.what) {
    case 'filed':
      sound.stamp();
      banner.toast(t('toast.paper.filed'), 'good', 4200);
      coachOnce('records', 'hint.records', { time: dayTime(RECORDS_MINUTE), n: RECORDS_HEAT, call: dayTime(RELEASE_FROM), by: dayTime(RELEASE_TO) });
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
      sound.sting();
      buzz('missed');
      return banner.toast(t(`toast.paper.turned.${e.why ?? 'heat'}` as Key), 'bad', 4200);
    case 'cleared':
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
