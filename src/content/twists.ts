/**
 * The Daily Escape's twists (P26), as data: each bends one rule of the prison for the day's
 * run (the sim reads `state.mods`, src/sim/systems/twists.ts). A Daily deals one to three
 * (daily.ts), within the day's difficulty budget, at a prison where they mean something, and
 * never so that every way out is closed (`breaks`). dailytest plays every way out a twist
 * doesn't close, under all of its prison's twists at once, with the escape bots.
 * Names and descriptions: i18n `twist.<id>` and `twist.<id>.d`.
 */
import type { Source } from './items';
import type { EscapeRoute, PrisonDef } from './prisons/types';

/** Stored by id in the state (`mods`) and the run logs: never rename one. */
export const TWIST_IDS = [
  'eagleEyes',
  'shortFuse',
  'doubleShift',
  'threeDays',
  'closedShop',
  'crackdown',
  'nightOwl',
  'unpaidLabour',
  'quickFix',
  'bigFreeze',
  'badBlood',
  'carePackage',
  'bareHands',
  'fogDays',
  'storm',
  'dogDay',
  'lightSleepers',
  'straightLaced',
  'customs',
  'loneWolf',
  'truckStrike',
] as const;
export type TwistId = (typeof TWIST_IDS)[number];

export interface Twist {
  id: TwistId;
  icon: string;
  /** How much harder it makes the day (a help is negative): the Daily's budget counts it. */
  cost: number;
  /** Where it means something (default: every prison). */
  at?: (p: PrisonDef) => boolean;
  /** Ways out it closes: the Daily never deals it where nothing else is left. */
  breaks?: readonly EscapeRoute[];
  /** Twists it never comes with (the same day can't be foggy and stormy). */
  not?: readonly TwistId[];
  /** Where items can't be had from (dailytest's kit check: every way out left open still has its tools). */
  closes?: readonly Source[];
}

const dogs = (p: PrisonDef) => p.guards.some((g) => g.dog);
const ways = (p: PrisonDef) => p.guards.some((g) => g.trait === 'corrupt' || g.trait === 'lazy');

export const TWISTS: readonly Twist[] = [
  { id: 'eagleEyes', icon: 'eye', cost: 2 },
  { id: 'shortFuse', icon: 'flame', cost: 2 },
  { id: 'doubleShift', icon: 'clock', cost: 2 },
  // (Never with a twist that only changes the delivery: three days are over before it would matter.)
  { id: 'threeDays', icon: 'calendar', cost: 2, breaks: ['stowaway'], not: ['customs', 'truckStrike'] },
  // (No merchant: no grapnel, no raft.)
  { id: 'closedShop', icon: 'cart', cost: 1, at: (p) => p.merchants.length > 0, closes: ['merchant'], breaks: ['roof', 'raft', 'helicopter'] },
  { id: 'crackdown', icon: 'clipboard', cost: 1 },
  { id: 'nightOwl', icon: 'moon', cost: 1 },
  { id: 'unpaidLabour', icon: 'briefcase', cost: 1, at: (p) => p.jobs.length > 0 },
  { id: 'quickFix', icon: 'wrench', cost: 1 },
  { id: 'bigFreeze', icon: 'snow', cost: 1, at: (p) => !p.rules?.cold, not: ['storm'] },
  { id: 'badBlood', icon: 'fist', cost: 1, at: (p) => !p.rules?.hostile },
  { id: 'carePackage', icon: 'gift', cost: -1 },
  // (No weapon: no takeover, nor the molten chocolate Irongate's helipad guards need.)
  { id: 'bareHands', icon: 'hand', cost: 1, breaks: ['takeover', 'helicopter'] },
  { id: 'fogDays', icon: 'fog', cost: 1, not: ['storm'] },
  { id: 'storm', icon: 'storm', cost: 1, not: ['fogDays', 'bigFreeze'] },
  { id: 'dogDay', icon: 'paw', cost: 1, at: dogs },
  // (Never with Straight-Laced: nobody would doze to be woken.)
  { id: 'lightSleepers', icon: 'ear', cost: 1, not: ['straightLaced'] },
  { id: 'straightLaced', icon: 'shield', cost: 1, at: ways },
  { id: 'customs', icon: 'box', cost: 1, at: (p) => !!p.delivery, breaks: ['stowaway'], not: ['truckStrike'] },
  // (The strongest prisons' takeovers need the crew.)
  { id: 'loneWolf', icon: 'walk', cost: 1, breaks: ['takeover'] },
  { id: 'truckStrike', icon: 'truck', cost: 1, at: (p) => !!p.delivery, breaks: ['stowaway'] },
];

export const twistOf = (id: string): Twist | undefined => TWISTS.find((t) => t.id === id);
