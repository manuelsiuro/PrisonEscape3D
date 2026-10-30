/**
 * Stage nights (P30, docs/PLAN.md §9): two day cards for the evening's free time. Talent night
 * on a stage in the canteen (a song played in time, three lanes of notes, judged by the step)
 * and quiz night in the library (eight questions against three inmates on the buzzers). Nothing
 * here happens without the player asking, and nothing draws on the state's RNG.
 */
import type { QuizPlace, Stage } from './prisons/types';
import { STEPS_PER_SECOND } from '../sim/tuning';

/** A stage at (x, z), the performer facing `face` (1 east, 5 south, 9 west, 13 north). */
export const stage = (x: number, z: number, face: 1 | 5 | 9 | 13): Stage => ({ x, z, face });
/** Quiz night's four places, in a row. */
export const quizAt = (face: 1 | 5 | 9 | 13, ...spots: Array<[number, number]>): QuizPlace => ({ face, spots: spots.map(([x, z]) => ({ x, z })) });

// ------------------------------------------------------------------ talent night

/** The instruments: bucket drums (always on the stage) and a homemade guitar (crafted, in the hotbar). */
export const INSTRUMENT = { DRUMS: 0, GUITAR: 1 } as const;

/**
 * A song: its pace (steps an eighth note lasts), its bars (eight eighths each: a lane's number,
 * or '.' for none) and each bar's chord (its root, semitones above A3), major or minor. The notes
 * the player plays, and the music the card and the speakers make of them, all come from this.
 */
export interface Song {
  id: string;
  /** 1 easy, 2, 3 hard: the prize money goes up with it (SONG_PAY). */
  level: number;
  steps: number;
  minor: boolean;
  bars: readonly string[];
  chords: readonly number[];
}

/** The bars by name, then the songs as runs of them (one chord a bar). */
const run = (parts: Record<string, string>, seq: string) => seq.split(' ').map((k) => parts[k] ?? k);

export const SONGS: readonly Song[] = [
  // A twelve-bar blues and a turnaround, crotchets: 100 a minute.
  {
    id: 'shuffle',
    level: 1,
    steps: 6,
    minor: false,
    bars: run({ a: '0.1.2.1.', b: '0.1.2...', c: '2.1.0.1.', d: '0...2...', e: '0.2.1.0.', z: '0.......' }, 'a a b d a a c d c b c d a e c z'),
    chords: [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7, 0, 5, 7, 0],
  },
  // A minor blues with quavers in it: 120 a minute.
  {
    id: 'lightsOut',
    level: 2,
    steps: 5,
    minor: true,
    bars: run({ a: '0.12.1..', b: '2.1.0.1.', c: '0.1.21.0', d: '0..1.2..', e: '21.0.12.', f: '0.0.1.2.', g: '2...0...', z: '0.......' }, 'a b a d c b a g e c a d a f c b e e c z'),
    chords: [7, 7, 7, 7, 12, 12, 7, 7, 14, 12, 7, 14, 7, 7, 12, 12, 14, 14, 7, 7],
  },
  // Rock and roll, runs of quavers: 150 a minute.
  {
    id: 'breakout',
    level: 3,
    steps: 4,
    minor: false,
    bars: run({ a: '01.21.0.', b: '0.12.10.', c: '2.10.12.', d: '0121.0..', e: '01210121', f: '2.1.0.1.', g: '0.2.1.2.', h: '0...0.2.', z: '0.......' }, 'f g f h a b a h c d c b e a e h b c d a e e d z'),
    chords: [5, 5, 10, 12, 5, 5, 10, 12, 5, 5, 10, 12, 5, 5, 10, 12, 5, 5, 10, 12, 5, 5, 10, 12],
  },
];

/** A note: when it's due (steps after the count-in), its lane (0–2), its pitch (semitones above A3). */
export type Note = readonly [number, number, number];

/** The chord's tones a lane plays: the root, the third, the fifth. */
const TONES = (minor: boolean) => [0, minor ? 3 : 4, 7];

/** Each song's notes, in order (worked out once). */
export const CHARTS: ReadonlyArray<readonly Note[]> = SONGS.map((s) => {
  const out: Note[] = [];
  const tones = TONES(s.minor);
  s.bars.forEach((bar, b) => {
    for (let i = 0; i < 8; i++) {
      const lane = '012'.indexOf(bar[i]);
      if (lane >= 0) out.push([(b * 8 + i) * s.steps, lane, s.chords[b] + tones[lane]]);
    }
  });
  return out;
});

/** How long a song lasts after its count-in (steps): its bars, and a beat to ring out. */
export const songSteps = (song: number) => SONGS[song].bars.length * 8 * SONGS[song].steps + 2 * SONGS[song].steps;

/** The count-in: four beats of the song's own pace, then its first note (steps). */
export const countIn = (song: number) => 8 * SONGS[song].steps;
/**
 * Judging a press (a step's lane, EXT.NOTE): within PERFECT steps of a note in that lane, perfect;
 * within GOOD, good; otherwise it's a stray press, and costs. A press reaches the simulation on
 * the step after it's made, so the window is centred LATE steps after the note's own.
 */
export const PERFECT = 1;
export const GOOD = 2;
export const LATE = 1;
/** Points for a perfect note and a good one, and what a stray press costs; the mark is the points as a share of every note perfect. */
export const PERFECT_POINTS = 100;
export const GOOD_POINTS = 60;
export const STRAY_POINTS = 25;

/** The night's other acts: two or three inmates, each on the stage ACT_MINUTES from 19:00 + k·ACT_GAP, marked RIVAL_MARK to RIVAL_MARK + RIVAL_SPREAD − 1 (per cent, by roll()). */
export const RIVALS_MIN = 2;
export const RIVALS_SPAN = 2;
export const ACT_MINUTES = 10;
export const ACT_GAP = 12;
/** An act's performer walks over this long before its slot, and waits in the wings (the stage's side) for it. */
export const ACT_WALK = 10;
/**
 * 2.5.1: an act's performer is called this long before his slot (minutes; the next one as soon as
 * the act before him is on: a walk across the prison takes a good ten), and not on the boards
 * NO_SHOW minutes into it (knocked out, busy, lost on the way) he's a no-show, out of the running.
 */
export const ACT_CALL = 20;
export const NO_SHOW = 5;
export const RIVAL_MARK = 50;
export const RIVAL_SPREAD = 36;
/** The prize money by place (first, second, third; nothing after), times the song's share (per cent, by level). */
export const PRIZES = [30, 15, 5] as const;
export const SONG_PAY = [100, 150, 200] as const;
/** Opinion: everyone in the canteen at a mark of APPLAUSE or more (STAGE_OPINION), twice that from first place; below it, nothing (and no prize either). */
export const APPLAUSE = 50;
export const STAGE_OPINION = 1;
/** A mark of GOODWILL or more wins the warden's goodwill: this much heat off. */
export const GOODWILL = 80;
export const GOODWILL_HEAT = 20;

// ------------------------------------------------------------------ quiz night

/** Eight questions, fifteen seconds each to answer, the right answer shown a moment after; the contestants walk over first (at most QUIZ_GATHER). */
export const QUIZ_QUESTIONS = 8;
export const QUESTION_STEPS = 15 * STEPS_PER_SECOND;
/** 2.16: each question is read before the contestants' buzzers open (the player may answer while it is): READ_STEPS, READ_LONG for escape history and recipes (longer answers, a list of items). */
export const READ_STEPS = 3 * STEPS_PER_SECOND;
export const READ_LONG = 4 * STEPS_PER_SECOND;
/** Before 2.16 (Sim.rules215): ten seconds a question, no reading time, the buzzers from BUZZ_MIN_215 for BUZZ_SPAN_215 steps. */
export const QUESTION_STEPS_215 = 10 * STEPS_PER_SECOND;
export const BUZZ_MIN_215 = 50;
export const BUZZ_SPAN_215 = 150;
export const REVEAL_STEPS = 50;
export const QUIZ_GATHER = 10 * STEPS_PER_SECOND;
/** The player joins within QUIZ_RANGE tiles of a place; contestants come from up to QUIZ_CALL tiles; the quiz is off if the player strays QUIZ_LEAVE tiles. */
export const QUIZ_RANGE = 2;
export const QUIZ_CALL = 40;
export const QUIZ_LEAVE = 4;
/** Joining closes at QUIZ_LAST (minutes into the prison day: 19:30), time for the whole quiz (eight questions read and answered) before evening roll call. */
export const QUIZ_LAST = 11 * 60 + 30;
/** Before 2.16 (Sim.rules215): 20:00, the questions shorter then. */
export const QUIZ_LAST_215 = 12 * 60;
/** An inmate's wits (its Intellect, by roll() for its cell): WITS_MIN to WITS_MIN + WITS_SPAN − 1. */
export const WITS_MIN = 25;
export const WITS_SPAN = 51;
/** An inmate buzzes BUZZ_MIN to BUZZ_MIN + BUZZ_SPAN − 1 steps after the reading time (by roll()), right RIGHT_BASE + wits × RIGHT_PER / 100 times in 100. */
export const BUZZ_MIN = 20;
export const BUZZ_SPAN = 200;
export const RIGHT_BASE = 30;
export const RIGHT_PER = 70;
/** A win: QUIZ_PRIZE dollars and QUIZ_INTELLECT Intellect (a tie at the top: half of each); opinion with the contestants: QUIZ_WIN_OPINION on a win, QUIZ_OPINION for playing. */
export const QUIZ_PRIZE = 30;
export const QUIZ_INTELLECT = 2;
export const QUIZ_WIN_OPINION = 2;
export const QUIZ_OPINION = 1;
/** Of the eight, this many are on escape history (the rest about this prison). */
export const QUIZ_HISTORY = 4;

/**
 * Escape history: written facts, checked (docs/PLAN.md §9). Each has its question and four
 * answers in the text (`quiz.h.<id>`, `quiz.h.<id>.0`–`.3`), the first the right one; the
 * choices are shuffled by roll().
 */
export const HISTORY = [
  // Frank Morris and John and Clarence Anglin, the night of 11 June 1962.
  'alcatrazYear',
  // Dummy heads of soap, toilet paper and real hair, left in their beds.
  'alcatrazHeads',
  // A raft and life vests of more than fifty raincoats.
  'alcatrazRaft',
  // The vents' grilles widened with spoons from the dining hall (and a drill made from a vacuum cleaner's motor).
  'alcatrazSpoons',
  // San Francisco Bay.
  'alcatrazBay',
  // Closed as a prison in 1963.
  'alcatrazClosed',
  // Stalag Luft III (Sagan, now Żagań): Tom, Dick and Harry.
  'tunnels',
  'harry',
  'camp',
  // 24–25 March 1944: 76 men got out; three reached freedom.
  'out',
  'home',
  // The "penguins": bags of sand inside their trousers, shaken out in the compound.
  'sand',
  // Harry: about 102 metres long, about 9 metres down.
  'harryLength',
  // The Colditz Cock: a glider built in the castle's attic (1944–45), never flown.
  'colditz',
  // Henri Charrière ("Papillon"): the penal colony in French Guiana.
  'papillon',
] as const;
