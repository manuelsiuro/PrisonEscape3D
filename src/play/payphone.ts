import { buzz } from '../app/haptics';
import { APPEAL_HEAT, CALL_STEPS, CALLEE, COINS, codeBit, HOME_ENERGY, JOB, JOB_FEES, JOBS, LAWYER_FEES, LINE_STEPS, LINES, RETAINER_DAYS, TAP_HEAT, TIER, TIERS, TURN_STEPS } from '../content/phone';
import { t, type Key } from '../i18n';
import { HEARING_AFTER, LAWYER_SOONER } from '../content/parole';
import type { Sim, SimEvent } from '../sim/Sim';
import { traitOf } from '../sim/systems/guards';
import { atPhone, byPhone, callRefusal, commsOf, mailWaiting, nextMoneyDay, phoneBusy, phoneOpen, phrasesOf, placeInLine, PLAYER_IN_LINE } from '../sim/systems/phone';
import { smugglingOf } from '../sim/systems/smuggling';
import type { DialRow, PayphoneView } from '../ui/payphone';
import { DIAL_B } from '../ui/payphone';
import { nameOf } from '../talk/fill';
import { banner, itemsUI, payphoneCard, sound, talk, view } from './context';
import { director } from './chatter';
import { play, playNow } from './game';
import { coachOnce } from './tips';
import { refusedText } from './labels';
import { hhmm } from '../sim/systems/clock';

/**
 * The pay phone on screen (P34): its card (the dial, the queue, a call, Lou's line), filled from
 * the sim's own functions; the toasts, sounds and banners of what happens; the keys on Lou's line.
 */

/** How long a call's ending stays on the card (ms). */
const RESULT_MS = 4200;
let result: { text: string; good: boolean; at: number } | null = null;

/** A new game: nothing left over. */
export function resetPayphone() {
  result = null;
}

const view0: PayphoneView = { phase: 'dial', cash: 0, on: '', walking: false, waiting: [], place: -1, turnLeft: -1, canJoin: false, canCut: false, rows: [], mail: '', calling: '', progress: 0, line: 0, ear: '', phrases: [], known: [], result: '', good: true, secs: 0, closed: '', hint: '', second: '' };
/** The view as it starts each frame (nothing left over from the last: a turn's note under a call). */
const blank: PayphoneView = { ...view0, waiting: [], rows: [], phrases: [], known: [] };

/** Why not, in words. */
const why = (sim: Sim, k: string | null) => (k ? refusedText(sim, k) : '');

/** "14:00" for an hour. */
const hourText = (h: number) => hhmm(h * 60);

/** The card's view now (null: not at the phone, not in its line, no call). */
export function payphoneNow(sim: Sim): PayphoneView | null {
  const s = sim.state;
  const c = commsOf(sim);
  if (!c) return null;
  const v = Object.assign(view0, blank);
  v.cash = s.cash;
  const now = playNow();
  const call = s.call;
  if (call) {
    if (call.to === CALLEE.COUSIN) {
      v.phase = 'lou';
      v.line = Math.min(2, call.at);
      const ear = call.ear >= 0 ? sim.prison.guards[call.ear] : null;
      const name = ear ? t('guard.title', { name: ear.name ?? '' }) : '';
      v.ear = !ear ? t('phone.earNone') : talk.knows(`trait:${call.ear}`) ? t('phone.earTrait', { name, trait: t(`trait.${traitOf(ear)}` as Key) }) : t('phone.ear', { name });
      const ph = phrasesOf(s, call, v.line);
      v.phrases = ph.map(([tier, k]) => t(`lou.${JOBS[call.sub]}.${LINES[v.line]}.${TIERS[tier]}.${k}` as Key, { hour: hourText(call.arg) }));
      v.known = ph.map(([tier, k]) => tier === TIER.DEEP && (s.lou[0] & codeBit(call.sub, v.line, k)) !== 0);
      v.progress = Math.max(0, (call.ends - s.step) / LINE_STEPS);
      v.secs = Math.max(0, call.ends - s.step) / 20;
      v.second = t(call.sub === JOB.CAKE ? 'phone.lines.how' : 'phone.lines.where');
    } else {
      v.phase = 'call';
      v.calling = t(`phone.calling.${call.to}` as Key);
      v.progress = Math.min(1, (s.step - call.from) / Math.max(1, CALL_STEPS[call.to]));
    }
    return v;
  }
  if (result && now - result.at < RESULT_MS && byPhone(sim)) {
    v.phase = 'result';
    v.result = result.text;
    v.good = result.good;
    return v;
  }
  const place = placeInLine(s);
  if (!(atPhone(sim) || (place >= 0 && byPhone(sim)))) return null;
  // Who's on it, who waits.
  const k = s.booth[0];
  v.on = k >= 0 ? (nameOf(sim, k) ?? '') : '';
  v.walking = k >= 0 && !s.booth[1];
  v.waiting = s.line.map((x) => (x === PLAYER_IN_LINE ? t('games.you') : (nameOf(sim, x) ?? '')));
  v.place = place;
  v.turnLeft = place === 0 && s.turn ? Math.max(0, 1 - (s.step - s.turn) / TURN_STEPS) : -1;
  if (v.turnLeft >= 0) v.secs = (v.turnLeft * TURN_STEPS) / 20;
  // (The place just ahead is for sale: say so, by name.)
  if (place > 0) v.hint = t('phone.swapHint', { name: nameOf(sim, s.line[place - 1]) ?? '' });
  const open = phoneOpen(sim);
  const free = !phoneBusy(s) && (!s.line.length || place === 0);
  v.canJoin = open && place < 0 && (phoneBusy(s) || s.line.length > 0);
  v.canCut = open && place !== 0 && s.line.length > 0;
  v.phase = free || !open ? 'dial' : 'queue';
  // Off now (out of free time, a lockdown, a drill): one note, not a dial of greyed rows.
  if (!open) v.closed = t(s.lockdown ? 'refused.gamesLockdown' : 'refused.phoneClosed');
  // The dial's rows, each with the sim's own reason why not.
  const pick = payphoneCard.pick;
  const parcel = !!smugglingOf(sim)?.parcel;
  const row = (id: DialRow['id'], c: number, price: string, note: string): DialRow => {
    const b = DIAL_B[id];
    return { id, b, c, price, why: why(sim, callRefusal(sim, b >> 4, b & 15, c)), note };
  };
  v.rows = [
    row('home', 0, t('phone.price', { n: COINS }), t('phone.home.d', { n: HOME_ENERGY })),
    row('appeal', 0, t('phone.price', { n: LAWYER_FEES[0] }), t('phone.appeal.d', { n: APPEAL_HEAT })),
    row('retainer', 0, t('phone.price', { n: LAWYER_FEES[1] }), t('phone.retainer.d', { n: RETAINER_DAYS })),
    // (P39: the lawyer files for parole, the hearing a day sooner.)
    row('parole', 0, t('phone.price', { n: LAWYER_FEES[2] }), t('phone.parole.d', { n: HEARING_AFTER - LAWYER_SOONER })),
    row('diversion', pick.hour, t('phone.pricePlus', { n: COINS, m: JOB_FEES[0] }), t('phone.job.diversion.d')),
    row('cake', 0, t('phone.pricePlus', { n: COINS, m: JOB_FEES[1] }), t(parcel ? 'phone.job.cake.parcel' : 'phone.job.cake.d')),
    row('car', 0, t('phone.pricePlus', { n: COINS, m: JOB_FEES[2] }), t('phone.job.car.d')),
    row('tip', pick.cell, t('phone.price', { n: COINS }), t('phone.tip.d')),
  ];
  // The cells there are to tip off: every inmate's, by name.
  payphoneCard.cells = s.inmates.map((m) => [m.cell, sim.prison.names[m.cell - 2] ?? ''] as [number, string]).sort((a, b) => a[0] - b[0]);
  const mail = mailWaiting(s);
  const next = nextMoneyDay(s);
  v.mail = mail ? t('phone.mail', { n: mail }) : next > 0 ? t('phone.nextMoney', { n: next }) : '';
  return v;
}

/** On Lou's line, 1–3 say a phrase (taken: true, so the hotbar doesn't have them). */
export function payphoneKey(code: string): boolean {
  const g = play.game;
  if (!g || g.paused || g.replay || !g.rec.sim.state.call) return false;
  const d = /^(?:Digit|Numpad)([1-3])$/.exec(code);
  if (d) return payphoneCard.say(Number(d[1]) - 1);
  return /^(?:Digit|Numpad)[4-6]$/.test(code);
}

/** What the phone does on screen: toasts, sounds, the card's last word. */
export function announcePhone(sim: Sim, e: Extract<SimEvent, { type: 'phone' }>) {
  const s = sim.state;
  const end = (text: string, good: boolean) => (result = { text, good, at: playNow() });
  const name = (k: number | undefined) => (k === undefined ? '' : (nameOf(sim, k) ?? ''));
  switch (e.what) {
    case 'joined':
      if (e.who === -1) itemsUI.toast(t('toast.phone.joined', { n: (e.n ?? 0) + 1 }));
      return;
    case 'left':
      return itemsUI.toast(t('toast.phone.left'));
    case 'turn':
      sound.chime();
      buzz('attended');
      return itemsUI.toast(t('toast.phone.turn'));
    case 'lostTurn':
      return itemsUI.toast(t('toast.phone.lostTurn'));
    case 'swapped':
      return itemsUI.toast(t('toast.phone.swapped', { name: name(e.who) }));
    case 'cut':
      return itemsUI.toast(t('toast.phone.cut'));
    case 'swing':
      sound.sting();
      return banner.toast(t('toast.phone.swing', { name: name(e.who) }), 'bad', 3200);
    case 'inmateCall':
      // (Told once: an inmate on the phone can be listened in on.)
      if (byPhone(sim)) coachOnce('overhear', 'toast.phone.inmateCall', { name: name(e.who) });
      return;
    case 'call':
      sound.payphone(e.to !== CALLEE.COUSIN);
      return;
    case 'hungUp':
      sound.hangUp();
      return itemsUI.toast(t('toast.phone.hungUp'));
    case 'home':
      sound.hangUp();
      end(t('toast.phone.home', { n: e.n ?? HOME_ENERGY }), true);
      return itemsUI.toast(t('toast.phone.home', { n: e.n ?? HOME_ENERGY }));
    case 'moneyOrder':
      return banner.toast(t('toast.phone.moneyOrder', { n: e.n ?? 0 }), 'good', 3600);
    case 'mail':
      sound.coin();
      return banner.toast(t('toast.phone.mail', { n: e.n ?? 0 }), 'good', 3600);
    case 'appeal':
      sound.hangUp();
      end(t('toast.phone.appeal', { n: e.n ?? 0 }), true);
      return banner.toast(t('toast.phone.appeal', { n: e.n ?? 0 }), 'good', 3200);
    case 'retainer':
      sound.hangUp();
      end(t('toast.phone.retainer', { n: e.n ?? 0 }), true);
      return banner.toast(t('toast.phone.retainer', { n: e.n ?? 0 }), 'good', 3200);
    case 'tip':
      sound.hangUp();
      end(t('toast.phone.tip', { n: e.cell ?? 0 }), true);
      return itemsUI.toast(t('toast.phone.tip', { n: e.cell ?? 0 }));
    case 'tipFound':
      return banner.toast(t('toast.phone.tipFound', { n: e.cell ?? 0 }), 'good', 3600);
    case 'tipEmpty':
      return banner.toast(t('toast.phone.tipEmpty', { n: e.cell ?? 0 }), 'bad', 3600);
    case 'snitch':
      return banner.toast(t('toast.phone.snitch', { name: name(e.who) }), 'bad', 3600);
    case 'said':
      sound.blip();
      return;
    case 'silence':
      sound.hangUp();
      end(t('toast.phone.silence'), false);
      return itemsUI.toast(t('toast.phone.silence'));
    case 'lou': {
      sound.hangUp();
      if (!e.ok) {
        end(t('lou.lost'), false);
        return itemsUI.toast(t('lou.lost'));
      }
      const job = JOBS[e.sub ?? 0];
      const said = t(`lou.ok.${job}` as Key, { hour: hourText(dayHour(s.lou[2])) });
      if (e.blown) {
        sound.sting();
        buzz('missed');
        end(`${said} ${t('lou.blown', { n: TAP_HEAT })}`, false);
        return banner.toast(t('lou.blown', { n: TAP_HEAT }), 'bad', 4200);
      }
      sound.chime();
      end(said, true);
      return banner.toast(said, 'good', 3600);
    }
    case 'diversion':
    case 'ignored':
      sound.carAlarm();
      if (e.tile !== undefined) view.phoneAlarm(e.tile);
      return banner.toast(t(e.what === 'diversion' ? 'toast.phone.diversion' : 'toast.phone.ignored'), e.what === 'diversion' ? 'good' : 'bad', 3600);
    case 'cake':
      sound.pickup();
      return banner.toast(t(smugglingOf(sim)?.parcel ? 'toast.phone.cakeDesk' : 'toast.phone.cake'), 'good', 3600);
    case 'cakeKept':
      return itemsUI.toast(t('toast.phone.cakeKept'));
    case 'cakeSeized':
      sound.sting();
      return banner.toast(t('toast.phone.cakeSeized'), 'bad', 3600);
    case 'wheels':
      sound.engine();
      view.carAway();
      return banner.toast(t('toast.phone.wheels'), 'good', 3600);
    case 'overheard': {
      const fact = director.secret(sim, e.who ?? -1);
      if (fact) banner.show(t('phone.overheard', { name: name(e.who) }), fact, 'routine', 7000);
      return;
    }
  }
}

/** The hour of a step (0–23). */
const dayHour = (step: number) => (Math.floor(step / (20 * 60)) + 8) % 24;
