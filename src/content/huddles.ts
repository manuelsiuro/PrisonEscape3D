/**
 * Free time's gatherings (2.39, docs/decisions/free-time.md): inmates in a ring for a chat, two at dice, a few at
 * cards, two shooting hoops. As data; the rules are systems/huddles.ts.
 */
import { STEPS_PER_SECOND } from '../sim/tuning';

/** What a gathering is (its kind). Never renumber: saves store them. */
export const HUDDLE = {
  CHAT: 0,
  DICE: 1,
  CARDS: 2,
  HOOPS: 3,
} as const;

/** From this prison day: the first plays as it always did (the escape bots' day, the first day's guide). */
export const HUDDLE_FROM_DAY = 2;
/** How many gatherings at once, in the morning's free time and the evening's. */
export const HUDDLE_SLOTS: readonly [number, number] = [2, 3];
/** The first of each slot's gatherings forms this many minutes into the block (from, plus up to spread): the block's first
 * minutes as they always were (the escape bots' second morning, a paperwork release at 10:00). */
export const HUDDLE_FIRST = 20;
export const HUDDLE_FIRST_SPREAD = 20;
/** How long one lasts (game minutes: from, plus up to spread), and the wait before the slot's next (likewise). */
export const HUDDLE_LENGTH = 45;
export const HUDDLE_LENGTH_SPREAD = 45;
export const HUDDLE_GAP = 8;
export const HUDDLE_GAP_SPREAD = 25;
/** None forms with less than this left of the block (minutes), and one under way breaks up this long before its end. */
export const HUDDLE_LAST = 12;
export const HUDDLE_BREAK = 3;
/** What kind each is, in 10 (out of chat, dice, cards, hoops in turn). */
export const HUDDLE_WEIGHTS: readonly number[] = [5, 2, 2, 1];
/** How many it takes, at least and at most, by kind. */
export const HUDDLE_SIZE: ReadonlyArray<readonly [number, number]> = [
  [2, 4],
  [2, 2],
  [2, 3],
  [2, 2],
];
/** Only those this near its place come (tiles, as the crow flies), the nearest first. */
export const HUDDLE_REACH = 28;
/** Someone who can't get to their place gives up after this long. */
export const HUDDLE_STALL_STEPS = 25 * STEPS_PER_SECOND;
/** Two places for a gathering are at least this far apart (tiles), and a prison has at most this many. */
export const HUDDLE_APART = 6;
export const HUDDLE_PLACES = 10;
/** A shooter's turn at the hoop (an inmates' game: one shot, then the other's), seconds. */
export const HOOPS_TURN_S = 4;
