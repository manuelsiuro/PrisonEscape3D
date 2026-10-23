/**
 * The pay phone (P34, docs/PLAN.md §11): a wall phone in a corridor of every campaign prison.
 * Calls home, to a lawyer, to the player's cousin Lou outside (on a tapped line: the job said in
 * three lines, each picked from three phrases), and anonymous tips. Inmates queue for it from
 * prison day 2. Nothing here draws on the state's RNG.
 */
import type { CommsDef } from './prisons/types';
import { STEPS_PER_MINUTE } from '../sim/tuning';
import { PAROLE_FEE } from './parole';

/**
 * A prison's pay phone: the tile the caller stands on (the phone hangs on the wall the caller
 * faces), the queue's tiles nearest first, the front gate's inside, Lou's car on the road; and
 * (P35) the internet kiosk, the same way: the tile in front of it, facing its wall; (P36) the
 * release: where to report, and the doors out from there.
 */
export const comms = (
  phone: [number, number, 1 | 5 | 9 | 13],
  line: Array<[number, number]>,
  gate: [number, number],
  car: [number, number, 1 | 5 | 9 | 13],
  kiosk: [number, number, 1 | 5 | 9 | 13],
  release: { at: Array<[number, number]>; gates: Array<[number, number]>; bridge?: boolean },
): CommsDef => ({
  phone: { x: phone[0], z: phone[1], face: phone[2] },
  line: line.map(([x, z]) => ({ x, z })),
  gate: { x: gate[0], z: gate[1] },
  car: { x: car[0], z: car[1], face: car[2] },
  kiosk: { x: kiosk[0], z: kiosk[1], face: kiosk[2] },
  release: { at: release.at.map(([x, z]) => ({ x, z })), gates: release.gates.map(([x, z]) => ({ x, z })), ...(release.bridge ? { bridge: true } : {}) },
});

// ------------------------------------------------------------------ who's called

/** Who the player calls (EXT.CALL's b, divided by 16; the rest is SUB). Never renumber: logs store them. */
export const CALLEE = { HOME: 0, LAWYER: 1, COUSIN: 2, TIP: 3 } as const;
export const CALLEES = ['home', 'lawyer', 'cousin', 'tip'] as const;
/** What the lawyer is asked for (EXT.CALL's b mod 16; P39: filing for parole). */
export const LAWYER = { APPEAL: 0, RETAINER: 1, PAROLE: 2 } as const;
/** Lou's jobs (EXT.CALL's b mod 16). */
export const JOB = { DIVERSION: 0, CAKE: 1, CAR: 2 } as const;
export const JOBS = ['diversion', 'cake', 'car'] as const;

/** The coins a call takes (the lawyer: his fee for what's asked, in place of coins). */
export const COINS = 2;
export const LAWYER_FEES = [30, 40, PAROLE_FEE] as const;
/** What each of Lou's jobs costs: paid when he has understood it, on top of the coins. */
export const JOB_FEES = [30, 25, 50] as const;

/** How long a call lasts (steps): home, the lawyer, a tip. Lou's call goes line by line (LINE_STEPS each). */
export const CALL_STEPS = [5 * STEPS_PER_MINUTE, 5 * STEPS_PER_MINUTE, 0, 3 * STEPS_PER_MINUTE] as const;

// ------------------------------------------------------------------ home, the lawyer, tips

/** A call home: this much energy, once a prison day. */
export const HOME_ENERGY = 15;
/** The family's money order: one every this many prison days ($MONEY_MIN + up to MONEY_SPAN − 1), paid at the next mail call. */
export const MONEY_EVERY = 7;
export const MONEY_MIN = 15;
export const MONEY_SPAN = 16;
/** Mail call: minutes into the prison day (12:00). */
export const MAIL_MINUTE = 4 * 60;

/** The lawyer's appeal: this much heat off, once a prison day; his retainer: solitary halved for this many prison days. */
export const APPEAL_HEAT = 30;
export const RETAINER_DAYS = 3;

/** A tip that finds nothing: this much heat; the odds (in 100) that word gets round to the inmate named, and what he thinks of the player then. */
export const TIP_HEAT = 15;
export const SNITCH_ODDS = 25;
export const SNITCH_OPINION = -30;

// ------------------------------------------------------------------ the queue

/** Inmates queue from this prison day (day 1 is the escape bots', untouched). */
export const LINE_DAY = 2;
/** At most this many waiting (the caller not counted; the player always finds a place at the end). */
export const LINE_MAX = 4;
/**
 * The odds (in 100) an inmate wants a call in a free time, and within how many minutes of its
 * start (they cluster: a queue forms); how long his call lasts (game minutes, MIN + up to SPAN − 1).
 */
export const CALL_WANT = 40;
export const WANT_WITHIN = 60;
export const INMATE_CALL_MIN = 10;
export const INMATE_CALL_SPAN = 11;
/** The first in line has this long to reach the phone, else he's out of the line (steps). */
export const REACH_STEPS = 60 * STEPS_PER_MINUTE / 2;
/** The player's turn: a call must be begun within this many steps, else the place is lost. */
export const TURN_STEPS = 15 * STEPS_PER_MINUTE;
/** Within this many tiles of the phone (the larger way): at it (one), in the queue's reach (LINE_REACH). */
export const LINE_REACH = LINE_MAX + 1;
/** A place bought from the inmate ahead; cutting in: what each in the line thinks of it, and the odds (in 100) the one pushed back swings (a lawless prison: HOSTILE_SWING). */
export const SWAP_PRICE = 5;
export const CUT_OPINION = -10;
export const CUT_SWING = 25;
export const HOSTILE_SWING = 50;

/** Eavesdropping: within this many tiles of an inmate on the phone for this long (steps), a secret, once a prison day each. */
export const OVERHEAR_RANGE = 2;
export const OVERHEAR_STEPS = 8 * STEPS_PER_MINUTE;

// ------------------------------------------------------------------ the tapped line

/** Each line of Lou's call: this long to pick a phrase (steps) before he hangs up. */
export const LINE_STEPS = 30 * STEPS_PER_MINUTE;
/** The lines of a job (said in this order) and the phrases' kinds. */
export const LINES = ['what', 'how', 'when'] as const;
export const TIERS = ['plain', 'coded', 'deep'] as const;
export const TIER = { PLAIN: 0, CODED: 1, DEEP: 2 } as const;
/** Phrases of each kind for each line of each job (text `lou.<job>.<line>.<tier>.<n>`). */
export const VARIANTS = 3;
/** What a phrase says to Lou and to whoever listens: plain, coded, a deep code (one Lou has learned: LEARNED). */
export const CLARITY = [2, 1, 0] as const;
export const RISK = [2, 1, 0] as const;
export const LEARNED_CLARITY = 2;
/** Lou understands a call whose clarity adds up to this. */
export const CLEAR_NEED = 3;
/** A listener catches a call whose risk adds up to this, by their way: the strict first. */
export const CATCH = { strict: 3, steady: 4, lazy: 5, corrupt: 5 } as const;
/** A call caught: this much heat, and the job is blown. */
export const TAP_HEAT = 40;

/** The bit of a deep code learned (job, line, variant) in `lou[0]`. */
export const codeBit = (job: number, line: number, v: number) => 1 << (job * LINES.length * VARIANTS + line * VARIANTS + v);

// ------------------------------------------------------------------ Lou's jobs

/** The diversion: at least this long ahead (game minutes); this many guards go and look at the gate for this long (steps). */
export const DIVERT_AHEAD = 60;
export const DIVERT_GUARDS = 3;
export const DIVERT_LOOK = 10 * STEPS_PER_MINUTE;
/** The getaway car waits from 23:00 to 05:00 (minutes into the prison day). */
export const CAR_FROM = 15 * 60;
export const CAR_TO = 21 * 60;
/** The cake: this much energy, and the metal file inside. */
export const CAKE_ENERGY = 25;
