import { buzz } from '../app/haptics';
import { ANSWER_STEPS, APPLY_DAY, HEARING_AFTER, HEARING_FROM, HEARING_TO, LAWYER_SOONER, MEMBERS, PASS, RECORD, TOPICS } from '../content/parole';
import { t, type Key } from '../i18n';
import { EXT, OP } from '../sim/command';
import type { Sim, SimEvent } from '../sim/Sim';
import { dayMinute, prisonDay } from '../sim/systems/calendar';
import { atDesk, atRelease, atTray, calledNow } from '../sim/systems/paperwork';
import { answerLeft, ANSWERED, applyRefusal, claimTrue, hearingDue, hearingOf, topicsOf, linePoints, OUTCOME, P, recordCounts, recordScore, VOIDS, WALKED_OUT } from '../sim/systems/parole';
import { STEPS_PER_SECOND } from '../sim/tuning';
import { PLAYER } from '../talk/fill';
import type { ParoleView } from '../ui/parole';
import { banner, combatUI, paBoard, paroleCard, sound, view } from './context';
import { announcePa, dayTime } from './day';
import { play, playNow, sendOp } from './game';
import { coachOnce } from './tips';
import { releaseChip } from './paperwork';
import { boardLooks } from './smuggle';
import { sitterPortraitOf } from '../render/portrait';
import { TOUCH } from '../ui/dom';
import { LESSONS } from '../tutorial/lessons';

/**
 * The parole board on screen (P39): the card at the release desk (how the application stands,
 * the record's lines for and against, Apply), the hearing's card (the board's three members, the
 * question, three answers, the time; the member's word on each answer), the verdict held a moment;
 * the HUD's chip, the toasts, sounds and the PA's call. Everything said is the sim's own
 * (systems/parole.ts): the record, what a claim rests on, what an answer is worth.
 */

/** The verdict held on the card (ms of play time). Not state. */
const VERDICT_MS = 9000;
let verdict: { at: number; what: 'granted' | 'denied' | 'walkedOut'; score: number; lines: number[]; record: number[]; topics: number[] } | null = null;
/** The member's word on the last answer, while it's weighed. Not state. */
let react: { q: number; text: string; good: boolean } | null = null;

/** A new game (or a load): nothing to show. */
export function resetParole() {
  verdict = null;
  react = null;
}

/** Where the board sits, in a sentence's words ("the visiting room"). */
export const roomOf = (sim: Sim) => t(`parole.room.${sim.prison.id}` as Key);

/** A record line in words, with its count ("Roll calls kept: 14"). */
const lineText = (id: string, n: number) => t(`parole.line.${id}` as Key, { n });
/** Points as the card shows them ("+7", "−6"). */
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

/** A line that weighed (a record line, an answer, walking out) in words. */
function weighedText(code: number, counts: readonly number[], topics?: readonly number[]): string {
  if (code === WALKED_OUT) return t('parole.walkedOutLine');
  if (code >= ANSWERED) {
    const topic = topics?.[code - ANSWERED];
    return topic === undefined ? t('parole.answerLine', { n: code - ANSWERED + 1 }) : t('parole.answerOn', { topic: t(`parole.topic.${TOPICS[topic].id}` as Key) });
  }
  const r = RECORD[code];
  if (!r) return '';
  const pts = linePoints(counts)[code];
  return `${lineText(r.id, counts[code])} (${signed(pts)})`;
}

/** The board's three faces (the room's figures, photographed once the first hearing sits). */
let faces: string[] = [];
const boardFaces = () => (faces.length ? faces : (faces = boardLooks.map((m) => sitterPortraitOf(m.look, m.suit))));

const VIEW: ParoleView = { phase: 'desk', title: '', status: '', statusTone: 'quiet', lines: [], score: '', canApply: false, why: '', apply: '', member: '', memberK: 0, faces: [], q: 0, question: '', file: '', fileOk: true, answers: [], said: -1, react: '', reactGood: true, left: 1, secs: 0, verdict: '', verdictGood: true, weighed: [], note: '' };

/** The record's lines as the card lists them: every line with something on it, its points when they aren't 0 (and the lines for at nothing, while applying, together on one line). */
function recordLines(sim: Sim, all: boolean): ParoleView['lines'] {
  const counts = recordCounts(sim.state);
  const pts = linePoints(counts);
  const lines: Array<ParoleView['lines'][number]> = RECORD.flatMap((r, k) => (counts[k] || pts[k] ? [{ text: lineText(r.id, counts[k]), pts: pts[k] ? signed(pts[k]) : '', tone: pts[k] > 0 ? 'good' : pts[k] < 0 ? 'bad' : 'quiet' } as const] : []));
  const none = all ? RECORD.filter((r, k) => r.side > 0 && !counts[k]).map((r) => t(`parole.lineName.${r.id}` as Key)) : [];
  if (none.length) lines.push({ text: t('parole.nothingYet', { lines: none.join(', ') }), pts: '', tone: 'quiet' });
  return lines;
}

/** The card now (null: none). */
export function paroleNow(sim: Sim): ParoleView | null {
  const s = sim.state;
  const h = hearingOf(sim);
  if (!h) return null;
  const v = VIEW;
  v.title = t('parole.title');
  v.answers = [];
  v.weighed = [];
  v.note = '';
  v.react = '';
  const o = s.hearing;
  if (o) {
    const counts = recordCounts(s);
    v.lines = [];
    v.score = '';
    v.status = t('parole.board');
    v.statusTone = 'quiet';
    v.faces = boardFaces();
    if (o.q < 0) {
      v.phase = 'sat';
      v.note = t('parole.sitting');
      return v;
    }
    const topic = TOPICS[o.topics[o.q]];
    v.phase = o.until ? 'weigh' : 'ask';
    v.q = o.q;
    v.memberK = o.q;
    v.member = t(`parole.member.${MEMBERS[o.q].id}` as Key);
    v.question = t(`parole.q.${topic.id}` as Key);
    // (What the file says on it: the lines the claim rests on, and whether a claim would hold, as claimTrue has it.)
    const lines = topic.lines.map((id) => lineText(id, counts[RECORD.findIndex((r) => r.id === id)])).join(' · ');
    v.fileOk = claimTrue(counts, o.topics[o.q]);
    const need = topic.need ?? 1;
    v.file = v.fileOk ? t('parole.fileHolds', { lines }) : need > 1 && topic.lines.every((id) => RECORD.find((r) => r.id === id)!.side > 0) ? t('parole.fileNeeds', { lines, n: need }) : t('parole.fileLie', { lines });
    v.answers = [t(`parole.claim.${topic.id}` as Key), t(`parole.own.${topic.id}` as Key), t(`parole.words.${topic.id}` as Key)];
    v.said = o.said[o.q];
    if (o.until && react?.q === o.q) {
      v.react = react.text;
      v.reactGood = react.good;
    }
    const left = answerLeft(s);
    v.left = o.until ? 0 : left / ANSWER_STEPS;
    v.secs = Math.ceil(left / STEPS_PER_SECOND);
    v.note = o.until ? '' : t(TOUCH ? 'parole.askTouch' : 'parole.askKeys');
    return v;
  }
  const now = playNow();
  if (verdict && now - verdict.at < VERDICT_MS) {
    v.phase = 'verdict';
    const good = verdict.what === 'granted';
    v.verdict = t(`parole.verdict.${verdict.what}` as Key);
    v.verdictGood = good;
    v.score = t('parole.scoreOf', { n: signed(verdict.score), of: PASS });
    v.weighed = verdict.lines.filter((c) => c >= 0).map((c) => weighedText(c, verdict!.record, verdict!.topics));
    // (A thin record, nothing against it: no list under the header, the reason in words.)
    v.status = good ? t('parole.weighedFor') : v.weighed.length ? t('parole.weighedAgainst') : t('parole.weighedThin');
    v.note = good ? t('parole.grantedNote', { time: dayTime(HEARING_FROM) }) : t('parole.againNote', { n: s.parole[P.AGAIN] });
    v.lines = [];
    return v;
  }
  // At the release desk (not reporting there, nor with a form for the tray: the action button has those).
  // (Not in the Daily, which has no parole board, nor in another lesson's scene at the desk: the paperwork's.)
  const lesson = play.game?.lesson;
  if (s.mods.length || (lesson && LESSONS[lesson.index]?.id !== 'parole')) return null;
  if (!atDesk(sim) || atRelease(sim) || atTray(sim) || calledNow(s)) return null;
  v.phase = 'desk';
  const p = s.parole;
  const day = prisonDay(s.step);
  const why = applyRefusal(sim);
  v.canApply = !why;
  v.why = why && why !== 'paroleOn' ? t(`refused.${why}` as Key, { n: why === 'paroleEarly' ? APPLY_DAY : p[P.AGAIN] }) : '';
  v.apply = t('parole.apply');
  v.score = '';
  v.lines = [];
  if (p[P.HEARING]) {
    v.status = p[P.HEARING] === day ? t('parole.hearingToday', { time: dayTime(HEARING_FROM), room: roomOf(sim) }) : t('parole.hearingOn', { n: p[P.HEARING], time: dayTime(HEARING_FROM), room: roomOf(sim) });
    v.statusTone = 'job';
    v.lines = recordLines(sim, true);
    v.score = t('parole.recordScore', { n: signed(recordScore(recordCounts(s))), of: PASS });
    v.note = t('parole.recordNote', { n: p[P.FROM] });
  } else if (p[P.RELEASE]) {
    v.status = t('parole.grantedStatus', { time: dayTime(HEARING_FROM) });
    v.statusTone = 'ok';
  } else if (p[P.OUTCOME] === OUTCOME.GRANTED && p[P.AGAIN] > day) {
    // (A grant that fell through at the desk: not there by 10:30, turned away, or a lockdown. Said so, with the wait.)
    v.status = t('parole.status.lost', { n: p[P.AGAIN] });
    v.statusTone = 'bad';
    v.note = t('parole.offer', { n: HEARING_AFTER, m: HEARING_AFTER - LAWYER_SOONER, time: dayTime(HEARING_FROM), d: APPLY_DAY });
    if (why === 'paroleWait') v.why = '';
  } else if (p[P.OUTCOME] === OUTCOME.DENIED || p[P.OUTCOME] === OUTCOME.MISSED || p[P.OUTCOME] === OUTCOME.VOIDED) {
    const out = p[P.OUTCOME] === OUTCOME.DENIED ? 'denied' : p[P.OUTCOME] === OUTCOME.MISSED ? 'missed' : 'voided';
    v.status = t(`parole.status.${out}` as Key, { n: p[P.AGAIN] });
    v.statusTone = 'bad';
    if (out === 'voided') v.weighed = [t(`parole.void.${VOIDS[p[P.LINE1]] ?? 'dig'}` as Key)];
    else if (out === 'denied') v.weighed = [p[P.LINE1], p[P.LINE2]].filter((c) => c >= 0).map((c) => (c >= ANSWERED || c === WALKED_OUT ? weighedText(c, []) : t(`parole.lineName.${RECORD[c]?.id ?? 'work'}` as Key)));
    v.note = t('parole.offer', { n: HEARING_AFTER, m: HEARING_AFTER - LAWYER_SOONER, time: dayTime(HEARING_FROM), d: APPLY_DAY });
    // (The status says when already.)
    if (why === 'paroleWait') v.why = '';
  } else {
    v.status = t('parole.none');
    v.statusTone = 'quiet';
    v.note = t('parole.offer', { n: HEARING_AFTER, m: HEARING_AFTER - LAWYER_SOONER, time: dayTime(HEARING_FROM), d: APPLY_DAY });
  }
  return v;
}

/** The HUD's chip: the hearing to come, today's call, the walk out tomorrow ('' none). */
export function paroleChip(sim: Sim): { text: string; soon: boolean } | null {
  const s = sim.state;
  const p = s.parole;
  if (!p[P.HEARING] || s.hearing) return null;
  const day = prisonDay(s.step);
  const m = dayMinute(s.step);
  if (p[P.HEARING] === day && m >= HEARING_FROM && m < HEARING_TO) return { text: t('hud.hearingNow', { room: roomOf(sim), time: dayTime(HEARING_TO) }), soon: true };
  if (p[P.HEARING] === day && m < HEARING_FROM) return { text: t('hud.hearingToday', { time: dayTime(HEARING_FROM) }), soon: false };
  if (p[P.HEARING] > day) return { text: t('hud.hearingDay', { n: p[P.HEARING] }), soon: false };
  return null;
}

/** The answers' keys (1–3) while a question is put: sent, and taken (true) so the hotbar doesn't have them. */
export function paroleKey(code: string): boolean {
  const g = play.game;
  if (!g || g.paused || g.replay) return false;
  const o = g.rec.sim.state.hearing;
  if (!o) return false;
  const d = /^(?:Digit|Numpad)([1-3])$/.exec(code);
  if (d && o.q >= 0 && !o.until && o.said[o.q] === -1) {
    paroleCard.flash(Number(d[1]) - 1);
    sendOp(OP.EXT, EXT.PAROLE, 1, Number(d[1]) - 1);
  }
  return /^(?:Digit|Numpad)[1-6]$/.test(code) || /^(?:KeyE|Space|KeyF|KeyQ|KeyU|KeyR)$/.test(code);
}

const floatPoint = { x: 0, y: 0 };
function floatUp(text: string, kind: 'cash' | 'gain' | 'taken') {
  const at = view.screenOf(-1, floatPoint);
  if (at) combatUI.float(text, at.x, at.y, kind);
}

/** What the parole board does on screen. */
export function announceParole(sim: Sim, e: Extract<SimEvent, { type: 'parole' }>) {
  const s = sim.state;
  switch (e.what) {
    case 'applied':
      sound.stamp();
      buzz('attended');
      banner.toast(t(e.lawyer ? 'toast.parole.lawyer' : 'toast.parole.applied', { n: e.n ?? 0, time: dayTime(HEARING_FROM), room: roomOf(sim) }), 'good', 4800);
      coachOnce('parole', 'hint.parole', { n: e.n ?? 0, room: roomOf(sim) });
      return;
    case 'called':
      // (Seated already, the moment it's called: nothing to send them to.)
      if (s.hearing) return;
      announcePa(sim, t('pa.hearing', { name: PLAYER.name || t('pa.releaseNumber'), room: roomOf(sim) }));
      // (The HUD's chip says the same words from now on: no toast piled on it, unless the release's chip has its place.)
      if (releaseChip(sim)) banner.toast(t('toast.parole.called', { room: roomOf(sim), time: dayTime(HEARING_TO) }), 'good', 4200);
      return;
    case 'sat':
      // (The call to the room, still to be said or being said, has been answered.)
      paBoard.drop(t('pa.hearing', { name: PLAYER.name || t('pa.releaseNumber'), room: roomOf(sim) }));
      sound.chime();
      react = null;
      return;
    case 'question':
      sound.blip();
      react = null;
      return;
    case 'answer': {
      const q = e.q ?? 0;
      const worth = e.worth ?? 0;
      const id = MEMBERS[q]?.id ?? 'chair';
      // (The member's word: a claim borne out or a lie caught, owning up, fine words weighed by how they landed.)
      const choice = e.choice ?? 0;
      const kind = choice === 0 ? (e.lie ? 'lie' : 'claim') : choice === 1 ? 'own' : worth >= 2 ? 'words' : 'wordsWeak';
      react = { q, text: t(`parole.react.${kind}.${id}` as Key), good: worth > 0 };
      if (e.lie) {
        sound.buzzer();
        buzz('missed');
      } else if (worth > 0) sound.chime();
      else sound.dud();
      floatUp(signed(worth), worth > 0 ? 'gain' : 'taken');
      return;
    }
    case 'silent':
      react = { q: e.q ?? 0, text: t('parole.react.silent'), good: false };
      sound.dud();
      return;
    case 'granted':
    case 'denied':
    case 'walkedOut':
      verdict = { at: playNow(), what: e.what, score: e.score ?? 0, lines: e.lines ?? (e.what === 'walkedOut' ? [WALKED_OUT] : []), record: recordCounts(s), topics: topicsOf(s.salt, prisonDay(s.step)) };
      react = null;
      if (e.what === 'granted') {
        sound.levelUp();
        buzz('attended');
        banner.show(t('banner.parole'), t('banner.paroleSub', { time: dayTime(HEARING_FROM) }), 'routine', 4800);
      } else {
        sound.sting();
        buzz('missed');
        banner.toast(t(e.what === 'walkedOut' ? 'toast.parole.walkedOut' : 'toast.parole.denied', { n: e.n ?? 0 }), 'bad', 4800);
      }
      return;
    case 'postponed':
      return banner.toast(t('toast.parole.postponed', { n: e.n ?? 0 }), 'bad', 4200);
    case 'missed':
      return banner.toast(t('toast.parole.missed', { time: dayTime(HEARING_TO), n: e.n ?? 0 }), 'bad', 4200);
    case 'voided':
      sound.sting();
      buzz('missed');
      return banner.toast(t(`toast.parole.void.${e.why ?? 'dig'}` as Key, { n: e.n ?? 0 }), 'bad', 5200);
  }
}

/** The board in its places (the 3D, play/smuggle.ts): the hearing called, sitting, or its word just given. */
export function boardShown(sim: Sim): boolean {
  const s = sim.state;
  return !!s.hearing || (hearingDue(s) && !s.lockdown) || (!!verdict && playNow() - verdict.at < VERDICT_MS);
}

/** The hearing under way (the other actions wait; the answer keys are the board's). */
export const paroleBusy = (s: { hearing: unknown }) => !!s.hearing;

