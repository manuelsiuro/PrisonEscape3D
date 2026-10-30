/**
 * The parole board (P39, docs/PLAN.md §13): the numbers it works by. A second, slower way out
 * for the model prisoner: apply at the release desk (or through the lawyer, by phone), keep a
 * good record for a week, face the board at its hearing, and walk out through the front door the
 * morning after (route `parole`). Plotting voids it. How it plays out is
 * src/sim/systems/parole.ts; the record is a pure function of the run's ledger.
 */
import type { ZoneId } from './zones';
import { STEPS_PER_SECOND } from '../sim/tuning';

/** Applying: from this prison day; the hearing this many prison days after (the lawyer's a day sooner); denied or voided, again after this many. */
export const APPLY_DAY = 3;
export const HEARING_AFTER = 7;
export const LAWYER_SOONER = 1;
export const APPLY_AGAIN = 3;
/** What the lawyer charges to file it by phone (content/phone.ts LAWYER_FEES has it as the third fee). */
export const PAROLE_FEE = 60;

/** The hearing: from 10:00, and the player has till 10:30 to come (minutes into the prison day). */
export const HEARING_FROM = 2 * 60;
export const HEARING_TO = 2 * 60 + 30;
/** Each member asks one question: this long to answer (steps), then the answer weighed this long. */
export const ANSWER_STEPS = 25 * STEPS_PER_SECOND;
export const WEIGH_STEPS = 4 * STEPS_PER_SECOND;
/** A moment between the player's arrival and the first question (they sit down). */
export const SIT_STEPS = 3 * STEPS_PER_SECOND;
/** The board grants parole from this score (the record and the three answers together). */
export const PASS = 16;

/**
 * The board: three members, each asking one question. What an answer is worth to each: a claim
 * the record bears out, one it doesn't (a lie caught), owning up, and fine words (this many points
 * at Intellect 100, in proportion below). Silence costs SILENT.
 */
export const MEMBERS = [
  { id: 'chair', claim: 4, lie: -5, own: 1, words: 4 },
  { id: 'doctor', claim: 2, lie: -6, own: 3, words: 3 },
  { id: 'deputy', claim: 5, lie: -4, own: 0, words: 3 },
] as const;
export const SILENT = -2;
/** The answers, in the card's order. Never renumber: logs store them. */
export const ANSWER = { CLAIM: 0, OWN: 1, WORDS: 2 } as const;

/**
 * The record (from the day of applying): lines for and against, each counted from the ledger
 * (systems/parole.ts recordCounts) and worth `w` points per `each` counted, at most `cap`.
 * `side` +1 for, -1 against. Never reorder: a denial's lines are stored by their place.
 */
export interface RecordLine {
  id: string;
  side: 1 | -1;
  w: number;
  each: number;
  cap: number;
}
export const RECORD: readonly RecordLine[] = [
  // For: days worked with the quota met, courses passed at the kiosk, roll calls, meals and showers kept, calls home, favours done, the garden.
  { id: 'work', side: 1, w: 3, each: 1, cap: 12 },
  { id: 'courses', side: 1, w: 4, each: 1, cap: 8 },
  { id: 'rollCalls', side: 1, w: 1, each: 2, cap: 7 },
  { id: 'meals', side: 1, w: 1, each: 3, cap: 4 },
  { id: 'showers', side: 1, w: 1, each: 2, cap: 3 },
  { id: 'family', side: 1, w: 2, each: 1, cap: 4 },
  { id: 'favors', side: 1, w: 2, each: 1, cap: 6 },
  { id: 'garden', side: 1, w: 1, each: 1, cap: 4 },
  // Against: days with a fight, knockouts, solitary, contraband found on the player or in their desk, the heat each evening (its sum, a point a ten), blocks missed, a dog's alert.
  { id: 'fights', side: -1, w: 4, each: 1, cap: 16 },
  { id: 'kos', side: -1, w: 5, each: 1, cap: 15 },
  { id: 'solitary', side: -1, w: 6, each: 1, cap: 18 },
  { id: 'contraband', side: -1, w: 5, each: 1, cap: 15 },
  { id: 'heat', side: -1, w: 1, each: 10, cap: 15 },
  { id: 'missed', side: -1, w: 2, each: 1, cap: 14 },
  { id: 'dogs', side: -1, w: 3, each: 1, cap: 9 },
];

/**
 * What the board asks about: the record's lines a claim rests on. A claim ("I've worked every day
 * I could") is true when each of its lines is clean: a line for at `need` (default 1) or more, a
 * line against at nothing. The card says under each question whether a claim would hold (and the
 * need), so a lie is a choice, not a trap. Never reorder (the hearing keeps its topics by their place).
 */
export const TOPICS: ReadonlyArray<{ id: string; lines: readonly string[]; need?: number }> = [
  { id: 'work', lines: ['work'], need: 3 },
  { id: 'study', lines: ['courses'], need: 1 },
  { id: 'family', lines: ['family'], need: 1 },
  { id: 'favors', lines: ['favors'] },
  { id: 'routine', lines: ['missed'] },
  { id: 'fights', lines: ['fights', 'kos'] },
  { id: 'contraband', lines: ['contraband', 'dogs'] },
  { id: 'solitary', lines: ['solitary'] },
  { id: 'heat', lines: ['heat'] },
];

/**
 * Where the board sits in each campaign prison: the room the hearing is held in (the visiting
 * room; at Stalag Flucht, where nobody visits, the mess hut), the three members' places (seats
 * across a table or counter, facing the camera: the way, 0–15 as DIR, they face), and the seat
 * the player is shown to across from them. Drawn only: nothing on the map changes.
 */
export interface HearingPlace {
  zone: ZoneId;
  board: ReadonlyArray<{ x: number; z: number }>;
  face: number;
  seat: { x: number; z: number };
}
export const HEARINGS: Record<string, HearingPlace> = {
  // The visiting room's east booths: the board on the visitors' side of the counter.
  'center-perks': { zone: 'visitation', board: [{ x: 33, z: 40 }, { x: 34, z: 40 }, { x: 35, z: 40 }], face: 5, seat: { x: 34, z: 42 } },
  // The mess hut's west table, its north bench.
  'stalag-flucht': { zone: 'canteen', board: [{ x: 6, z: 30 }, { x: 7, z: 30 }, { x: 8, z: 30 }], face: 5, seat: { x: 7, z: 32 } },
  // The canteen (where visitors sit): the north-west table.
  shankton: { zone: 'canteen', board: [{ x: 26, z: 15 }, { x: 27, z: 15 }, { x: 28, z: 15 }], face: 5, seat: { x: 27, z: 17 } },
  // The canteen's two north tables.
  'san-pancho': { zone: 'canteen', board: [{ x: 19, z: 32 }, { x: 20, z: 32 }, { x: 22, z: 32 }], face: 5, seat: { x: 20, z: 34 } },
  irongate: { zone: 'canteen', board: [{ x: 30, z: 29 }, { x: 31, z: 29 }, { x: 33, z: 29 }], face: 5, seat: { x: 31, z: 31 } },
};
