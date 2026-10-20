import { buzz } from '../app/haptics';
import { CHARTS, COUNT_IN, INSTRUMENT, QUESTION_STEPS, QUIZ_PRIZE, QUIZ_RANGE, SONGS } from '../content/nights';
import { KEY_ITEM_COLORS } from '../content/items';
import { listOf, t, type Key } from '../i18n';
import { EXT, OP } from '../sim/command';
import type { Sim, SimEvent } from '../sim/Sim';
import { dayMinute } from '../sim/systems/clock';
import { today } from '../sim/systems/calendar';
import { HOTBAR, itemOf } from '../sim/systems/items';
import { actNow, boardsOf, GUITAR, markOf, prizeOf, stageOf, stageRefusal, talentOn, tonight, turnFrom } from '../sim/systems/talent';
import { nearestPlace, questionNow, quizOf, quizOn, quizRefusal, type Choice, type Question } from '../sim/systems/quiz';
import { STEPS_PER_MINUTE, UNIT } from '../sim/tuning';
import { LAYER, MAP_W } from '../sim/world/World';
import type { NightsFrame } from '../render/Nights';
import type { QuizView, StageView } from '../ui/nights';
import { inmateName } from '../ui/social';
import { banner, combatUI, itemsUI, sound, view } from './context';
import { play, sendOp } from './game';
import { coachOnce } from './tips';
import { TOUCH } from '../ui/dom';

/**
 * Stage nights (P30) on screen: talent night's card and quiz night's, filled from the sim; the
 * lanes' keys and the answers' (1–4); the music (the song's beat and bass under the notes played,
 * an act's song heard in the canteen), the buzzers' sounds, toasts and floats; what the picture
 * shows (the stage set up, the buzzers lit). The sim's own functions decide everything shown.
 */

const nameOf = (sim: Sim, who: number) => inmateName(sim, who);
/** A clock time ("19:34") from minutes of the day. */
const formatTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** A guard by name ("Officer Pratt"), an item by its id. */
const guardLabel = (sim: Sim, k: number) => t('guard.title', { name: sim.prison.guards[k]?.name ?? '' });
const itemName = (id: string) => t(`item.${id}` as Key);

const floatPoint = { x: 0, y: 0 };
function floatUp(text: string, kind: 'cash' | 'gain' | 'taken') {
  const at = view.screenOf(-1, floatPoint);
  if (at) combatUI.float(text, at.x, at.y, kind);
}

/** The last act's verdict and the last quiz's end, held a moment for the cards (ms); the last judgement's flash; notes in a row. Not state. */
let stageResult: { at: number; mark: number; place: number; prize: number; crowd: number; heat: number; song: number; inst: number } | null = null;
let quizResult: { at: number; what: 'won' | 'tie' | 'lost'; pts: number[]; prize: number; int: number; names: string[] } | null = null;
let judged = { grade: 0, at: 0 };
let streak = 0;
const RESULT_MS = 6000;

/** A new game (or a load): nothing to show. */
export function resetNights() {
  stageResult = null;
  quizResult = null;
  judged = { grade: 0, at: 0 };
  streak = 0;
  beat.song = -1;
}

/** Why not, in words (the cards' notes). */
function refusalText(sim: Sim, why: string): string {
  switch (why) {
    case 'actsOn':
      return t('stage.after', { time: formatTime(turnFrom(tonight(sim)) + 480) });
    case 'offStage':
      return t('stage.onBoards');
    default:
      return t(`refused.${why}` as Key);
  }
}

// ------------------------------------------------------------------ talent night's card

const stageView: StageView = { phase: 'offer', acts: [], why: '', played: false, turnAt: '', hasGuitar: false, prizes: [], song: 0, inst: 0, t: 0, hits: [], mark: 0, streak: 0, judged: 0, judgedAt: 0, place: 0, of: 0, prize: 0, crowd: 0, heat: 0 };

/** Close enough to the stage for its card: on the ground floor, within a tile of its boards. */
function byStage(sim: Sim): boolean {
  const st = stageOf(sim.world);
  const s = sim.state;
  if (!st || s.layer !== LAYER.GROUND) return false;
  const px = Math.floor(s.player.x / UNIT);
  const pz = Math.floor(s.player.z / UNIT);
  return boardsOf(st).some((b) => Math.max(Math.abs((b % MAP_W) - px), Math.abs(Math.floor(b / MAP_W) - pz)) <= 1);
}

/** Talent night's card now (null: none), between steps (`a`). */
export function stageNow(sim: Sim, a: number): StageView | null {
  const s = sim.state;
  const o = s.show;
  const now = performance.now();
  const held = stageResult && now - stageResult.at < RESULT_MS ? stageResult : null;
  if (!o && !held && !(talentOn(sim) && byStage(sim))) return null;
  const v = stageView;
  const acts = tonight(sim);
  const m = dayMinute(s.step);
  const on = actNow(sim);
  v.acts = acts.map((x, k) => ({ name: nameOf(sim, x.who), inst: x.inst, song: x.song, mark: m >= x.until ? x.mark : -1, on: k === on, at: formatTime(x.at + 480) }));
  v.of = acts.length + 1;
  if (o) {
    v.phase = 'play';
    v.song = o.song;
    v.inst = o.inst;
    // (Where the song is between steps: the card's lanes run with the clock, as the picture does.)
    v.t = s.step + a - o.from - COUNT_IN;
    v.hits = o.hits;
    v.mark = markOf(o);
    v.streak = streak;
    v.judged = judged.grade;
    v.judgedAt = judged.at;
    return v;
  }
  if (held) {
    v.phase = 'result';
    Object.assign(v, { mark: held.mark, place: held.place, prize: held.prize, crowd: held.crowd, heat: held.heat, song: held.song, inst: held.inst });
    return v;
  }
  v.phase = 'offer';
  const why = stageRefusal(sim, INSTRUMENT.DRUMS);
  v.why = why ? refusalText(sim, why) : '';
  v.played = why === 'performed';
  v.turnAt = formatTime(turnFrom(acts) + 480);
  v.hasGuitar = s.items.inv.slice(0, HOTBAR).some((x) => itemOf(x) === GUITAR);
  v.prizes = SONGS.map((_, k) => prizeOf(0, k));
  return v;
}

// ------------------------------------------------------------------ quiz night's card

const quizView: QuizView = { phase: 'offer', why: '', names: [], pts: [], said: [], got: -1, q: 0, question: '', choices: [], answer: 0, left: 1, end: '', prize: 0, int: 0 };

/** A question's words and its four answers', in this language (from the running game's own names). */
export function questionText(sim: Sim, q: Question): { text: string; choices: string[] } {
  const choice = (c: Choice): string => {
    switch (c.kind) {
      case 'time':
        return formatTime(c.m);
      case 'guard':
        return guardLabel(sim, c.k);
      case 'item':
        return itemName(c.id);
      case 'n':
        return String(c.n);
      case 'colour':
        return t(`keyColor.${c.c}` as Key);
      case 'h':
        return t(`quiz.${q.id}.${c.k}` as Key);
    }
  };
  const items = (q.items ?? []).map((id) => itemName(id));
  const text = q.id === 'key' ? t('quiz.key', { name: guardLabel(sim, q.guard ?? 0) }) : q.id === 'recipe' ? t('quiz.recipe', { items: listOf(items) }) : t(`quiz.${q.id}` as Key);
  return { text, choices: q.choices.map(choice) };
}


/** Quiz night's card now (null: none). */
export function quizNow(sim: Sim): QuizView | null {
  const s = sim.state;
  const o = s.quiz;
  const now = performance.now();
  const held = quizResult && now - quizResult.at < RESULT_MS ? quizResult : null;
  if (!o && !held && !(quizOn(sim) && nearestPlace(sim) >= 0)) return null;
  const v = quizView;
  if (o) {
    v.names = [t('games.you'), ...o.who.map((k) => nameOf(sim, k))];
    v.pts = o.pts;
    v.said = o.said;
    v.got = o.got;
    const q = questionNow(sim);
    if (!q) {
      v.phase = 'gather';
      return v;
    }
    v.phase = o.until ? 'reveal' : 'ask';
    v.q = o.q;
    const words = questionText(sim, q);
    v.question = words.text;
    v.choices = words.choices;
    v.answer = q.answer;
    v.left = o.until ? 0 : 1 - (s.step - o.at) / QUESTION_STEPS;
    return v;
  }
  if (held) {
    v.phase = 'result';
    v.names = held.names;
    v.pts = held.pts;
    v.said = [-1, -1, -1, -1];
    v.got = -1;
    v.end = held.what;
    v.prize = held.prize;
    v.int = held.int;
    return v;
  }
  v.phase = 'offer';
  const why = quizRefusal(sim);
  v.why = why ? refusalText(sim, why) : '';
  v.end = '';
  return v;
}

// ------------------------------------------------------------------ the keys

/** The lanes' keys on the stage (A or ←, S or ↓ / W or ↑, D or →) and the answers' (1–4): sent, and taken (true) so nothing else has them. */
export function nightsKey(code: string): boolean {
  const g = play.game;
  if (!g || g.paused || g.replay) return false;
  const s = g.rec.sim.state;
  if (s.show) {
    const lane = code === 'KeyA' || code === 'ArrowLeft' ? 0 : code === 'KeyS' || code === 'ArrowDown' || code === 'KeyW' || code === 'ArrowUp' ? 1 : code === 'KeyD' || code === 'ArrowRight' ? 2 : -1;
    if (lane < 0) return false;
    lanePress(lane);
    return true;
  }
  if (s.quiz && s.quiz.q >= 0 && !s.quiz.until && s.quiz.said[0] < 0) {
    const d = /^(?:Digit|Numpad)([1-4])$/.exec(code);
    if (!d) return false;
    sendOp(OP.EXT, EXT.ANSWER, Number(d[1]) - 1);
    return true;
  }
  return false;
}

/** A lane played (a key, a pad). */
export function lanePress(lane: number) {
  sendOp(OP.EXT, EXT.NOTE, lane);
  onLane(lane);
}
/** The card's pad lit, set by the overlay. */
export let onLane: (lane: number) => void = () => {};
export const setLaneFlash = (f: (lane: number) => void) => (onLane = f);

// ------------------------------------------------------------------ the events

export function announceNights(sim: Sim, e: SimEvent) {
  const g = play.game;
  switch (e.type) {
    case 'stage': {
      if (e.what === 'start') {
        streak = 0;
        judged = { grade: 0, at: 0 };
        coachOnce('talent', TOUCH ? 'hint.talentTouch' : 'hint.talent');
      } else if (e.what === 'hit') {
        streak++;
        judged = { grade: e.grade ?? 2, at: performance.now() };
        const o = sim.state.show;
        if (o?.inst === INSTRUMENT.GUITAR) sound.strum(e.pitch ?? 0, e.grade === 3 ? 1 : 0.75);
        else sound.drum(e.lane ?? 0, e.grade === 3 ? 1 : 0.75);
      } else if (e.what === 'miss' || e.what === 'stray') {
        streak = 0;
        judged = { grade: 1, at: performance.now() };
        sound.dud();
      } else if (e.what === 'done') {
        stageResult = { at: performance.now(), mark: e.mark ?? 0, place: e.place ?? 0, prize: e.prize ?? 0, crowd: e.crowd ?? 0, heat: e.heat ?? 0, song: e.song ?? 0, inst: e.inst ?? 0 };
        window.setTimeout(() => {
          if (play.game !== g) return;
          if ((e.mark ?? 0) >= 50) sound.cheer();
          if (e.place === 0) {
            sound.levelUp();
            buzz('attended');
          }
          if (e.prize) floatUp(`+$${e.prize}`, 'cash');
          if (e.heat) banner.toast(t('toast.goodwill', { n: e.heat }), 'good', 4200);
        }, 300);
      } else if (e.what === 'off' && !sim.state.escaped) itemsUI.toast(t('toast.stageOff'));
      break;
    }
    case 'quiz': {
      if (e.what === 'start') coachOnce('quiz', TOUCH ? 'hint.quizTouch' : 'hint.quiz');
      else if (e.what === 'question') sound.blip();
      else if (e.what === 'right') {
        sound.chime();
        if (e.by === 0) floatUp('+1', 'gain');
      } else if (e.what === 'wrong') sound.buzzer();
      else if (e.what === 'won' || e.what === 'tie' || e.what === 'lost') {
        const o = { names: [t('games.you'), ...(sim.state.quiz?.who ?? lastWho).map((k) => nameOf(sim, k))] };
        quizResult = { at: performance.now(), what: e.what, pts: e.pts ?? [0, 0, 0, 0], prize: e.prize ?? 0, int: e.int ?? 0, names: o.names };
        if (e.what === 'won') {
          sound.levelUp();
          buzz('attended');
          floatUp(`+$${e.prize ?? QUIZ_PRIZE}`, 'cash');
        } else if (e.what === 'tie') sound.coin();
        else sound.sting();
      } else if (e.what === 'off' && !sim.state.escaped) itemsUI.toast(t('toast.quizOff'));
      if (e.who) lastWho = e.who;
      break;
    }
  }
}
/** The last quiz's contestants (the end's event comes after the quiz is cleared). */
let lastWho: number[] = [];

// ------------------------------------------------------------------ the music

/** Where the backing has got to: the song, the step it's counted from, the last eighth sounded. */
const beat = { song: -1, from: 0, eighth: -99, act: -1 };

/**
 * The song's backing, every frame: the beat (a kick on one and three, a snare on two and four, a
 * hat on every eighth) and the bass on the chord's root, from the count-in on, under the notes the
 * player plays (those sound as they're played). An act on the stage plays its own song through,
 * its notes as its mark would have them, heard in the canteen (fainter further off). The prison's
 * score steps back meanwhile (true: it should).
 */
export function nightsSounds(sim: Sim, a: number, paused: boolean): boolean {
  const s = sim.state;
  const o = s.show;
  let song = -1;
  let from = 0;
  let gain = 1;
  let act = -1;
  if (o) {
    song = o.song;
    from = o.from + COUNT_IN;
  } else {
    const k = actNow(sim);
    const st = stageOf(sim.world);
    if (k >= 0 && st && s.layer === LAYER.GROUND) {
      const x = tonight(sim)[k];
      const d = Math.hypot(s.player.x / UNIT - st.x, s.player.z / UNIT - st.z);
      gain = Math.max(0, 1 - d / 16);
      song = x.song;
      // (The act's song from the first step of its minute.)
      from = s.step - (dayMinute(s.step) - x.at) * STEPS_PER_MINUTE - (s.step % STEPS_PER_MINUTE);
      act = k;
    }
  }
  const playing = song >= 0 && gain > 0.2;
  if (song < 0 || paused || gain <= 0.02) {
    beat.song = -1;
    return playing;
  }
  const sg = SONGS[song];
  const now = s.step + a - from;
  const eighth = Math.floor(now / sg.steps);
  if (beat.song !== song || beat.from !== from || beat.act !== act) {
    beat.song = song;
    beat.from = from;
    beat.act = act;
    beat.eighth = eighth - 1;
  }
  // (A frame late after a hitch: only the latest eighth, never a burst.)
  if (eighth <= beat.eighth) return playing;
  beat.eighth = eighth;
  const bars = sg.bars.length;
  const bar = Math.floor(eighth / 8);
  const i = ((eighth % 8) + 8) % 8;
  if (eighth < 0) {
    // The count-in: a click on each beat.
    if (i % 2 === 0) sound.click();
    return playing;
  }
  if (bar >= bars) return playing;
  if (i === 0 || i === 4) sound.beat('kick', gain);
  if (i === 2 || i === 6) sound.beat('snare', gain);
  sound.beat('hat', gain * 0.6);
  if (i === 0 || i === 4) sound.bass(sg.chords[bar], gain);
  // An act: its own notes, as it plays them (some go astray, as its mark has it).
  if (act >= 0) {
    const x = tonight(sim)[act];
    const c = CHARTS[song];
    for (let n = 0; n < c.length; n++) {
      if (c[n][0] !== eighth * sg.steps) continue;
      const missed = ((n * 2654435761) >>> 0) % 100 >= x.mark;
      if (missed) sound.dud(gain * 0.5);
      else if (x.inst === INSTRUMENT.GUITAR) sound.strum(c[n][2], gain * 0.8);
      else sound.drum(c[n][1], gain * 0.8);
    }
  }
  return playing;
}

// ------------------------------------------------------------------ the picture

const frame: NightsFrame = { stage: null, quiz: null, stageUp: false, quizUp: false, lights: [0, 0, 0, 0] };
const lights = [0, 0, 0, 0];

/** What the 3D shows of P30 this frame: the stage set up on talent night's evening, the buzzers on quiz night's, lit as they buzz. */
export function nightsFrameOf(sim: Sim): NightsFrame {
  const s = sim.state;
  frame.stage = stageOf(sim.world);
  frame.quiz = quizOf(sim.world);
  const ev = sim.world.def.rules?.relaxed ? 'none' : today(sim).event;
  const m = dayMinute(s.step);
  // (Set up from the evening's free time, 18:00, to evening roll call, 22:00.)
  const evening = m >= 600 && m < 840;
  frame.stageUp = !!frame.stage && ((ev === 'talent' && evening) || !!s.show);
  frame.quizUp = !!frame.quiz && ((ev === 'quiz' && evening) || !!s.quiz);
  lights.fill(0);
  const o = s.quiz;
  if (o)
    o.seats.forEach((place, j) => {
      const said = o.said[j];
      if (said < 0) return;
      lights[place] = o.got === j ? 2 : 3;
    });
  frame.lights = lights;
  return frame;
}

/** The key colours' names (quiz questions), for the i18n test. */
export const COLOURS = KEY_ITEM_COLORS.map(([c]) => c);
export { QUIZ_RANGE };
