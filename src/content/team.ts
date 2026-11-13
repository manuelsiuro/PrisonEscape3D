/**
 * Team & ink (P29, docs/phases/3-free-time.md): the yard's pitch (its football match went in 2.44:
 * penalties, content/penalties.ts) and the tattoo parlour (a homemade gun, a design traced for an inmate's money,
 * a friend's work on the player's own arm). Nothing here happens without the player asking, and
 * nothing draws on the state's RNG: the escape bots' runs stay as they were.
 */
import type { Pitch } from './prisons/types';
import { STEPS_PER_SECOND } from '../sim/tuning';

/** A pitch from (x, z), w across and d deep; its goals at the two ends of its longer side, in the end tiles' middle two (the nets). */
export const pitch = (x: number, z: number, w: number, d: number): Pitch => ({ x, z, w, d });

// ------------------------------------------------------------------ tattoos

/** The designs (TALK.TATTOO's and TALK.INK_ME's b): their price, the character's tattoo shape, and the path traced (a box 0–1000, y down). Never renumber: logs and saves store them. */
export interface Design {
  id: 'heart' | 'skull' | 'eagle';
  price: number;
  shape: number;
  color: number;
  path: ReadonlyArray<readonly [number, number]>;
}
export const DESIGNS: readonly Design[] = [
  {
    id: 'heart',
    price: 15,
    shape: 2,
    color: 0xc0302a,
    path: [
      [500, 850],
      [330, 700],
      [190, 540],
      [150, 400],
      [190, 270],
      [300, 200],
      [420, 220],
      [500, 320],
      [580, 220],
      [700, 200],
      [810, 270],
      [850, 400],
      [810, 540],
      [670, 700],
      [500, 850],
    ],
  },
  {
    id: 'skull',
    price: 25,
    shape: 6,
    color: 0x2b3038,
    path: [
      [500, 130],
      [690, 180],
      [810, 340],
      [790, 520],
      [680, 600],
      [670, 760],
      [600, 820],
      [570, 740],
      [535, 820],
      [500, 740],
      [465, 820],
      [430, 740],
      [400, 820],
      [330, 760],
      [320, 600],
      [210, 520],
      [190, 340],
      [310, 180],
      [500, 130],
    ],
  },
  {
    id: 'eagle',
    price: 40,
    shape: 7,
    color: 0x6a4a2a,
    path: [
      [100, 420],
      [250, 300],
      [390, 380],
      [450, 250],
      [530, 200],
      [580, 260],
      [520, 320],
      [620, 380],
      [750, 300],
      [900, 420],
      [760, 460],
      [620, 490],
      [570, 650],
      [610, 820],
      [500, 740],
      [390, 820],
      [430, 650],
      [380, 490],
      [240, 460],
      [100, 420],
    ],
  },
];
/** An inmate takes a tattoo from the player at this opinion or more (and it's one of the day's games with them); a friend inks the player's own at FRIEND_INK. */
export const INK_OPINION = 30;
/** Tattoos for inmates: one a prison day for each, INKS_A_DAY in all (a day's work for one gun). */
export const INKS_A_DAY = 3;
export const FRIEND_INK = 70;
/** Tracing as it was before 2.22 (Sim.rules221, old logs): the pen ran along the design at PEN_SPEED (box units a step) after a LEAD_IN still at its start; the needle moved at NEEDLE_SPEED the way the stick or keys pointed; the line's quality came from the needle's mean distance from the pen: within INK_SLACK perfect (100), INK_SLACK + INK_POOR or more nothing (0). */
export const PEN_SPEED = 16;
export const LEAD_IN = 30;
export const NEEDLE_SPEED = 22;
export const INK_SLACK = 12;
export const INK_POOR = 140;
/**
 * Tracing (2.22): the needle draws where the finger or the mouse takes it (NEEDLE_REACH at most a
 * step), or the way the stick or keys point (NEEDLE_KEYS a step); each step it moves it's pulled
 * INK_PULL% of the way onto the line. The line counts as traced as far as the needle has followed
 * it (within ON_LINE of it, no more than LINE_AHEAD past what's traced): the ring waits there, RING_AHEAD on.
 * The line's quality is the needle's mean distance from the design while it inks: within
 * LINE_SLACK perfect (100), LINE_SLACK + LINE_POOR or more nothing (0). Traced to within
 * LINE_END of its end, it's done; at INK_TIME it stops where it is, its quality cut to the share traced.
 */
export const NEEDLE_REACH = 70;
export const NEEDLE_KEYS = 14;
export const INK_PULL = 20;
export const ON_LINE = 60;
export const LINE_AHEAD = 90;
export const RING_AHEAD = 60;
export const LINE_SLACK = 10;
export const LINE_POOR = 60;
export const LINE_END = 30;
export const INK_TIME = 40 * STEPS_PER_SECOND;
/** What it pays: the price at 50% for the poorest line, 150% for a perfect one; opinion INK_GAIN_BASE + up to INK_GAIN more. */
export const PAY_MIN = 50;
export const PAY_SPAN = 100;
export const INK_GAIN_BASE = 2;
export const INK_GAIN = 10;
/** Given up halfway: the inmate thinks this much less of the player. */
export const INK_QUIT = 5;
/** A friend inking the player: this long (steps). The player's arms take MAX_INKED tattoos. */
export const INK_ME_STEPS = 6 * STEPS_PER_SECOND;
export const MAX_INKED = 3;
/** A guard who sees tattooing (either way round): this much heat, once a sitting. */
export const INK_HEAT = 15;
/** The client (or the friend at work) stands this close (units, centre to centre). */
export const INK_GAP = 900;
/** After a sitting, the client stays put this long (steps). */
export const INK_LINGER = 15 * STEPS_PER_SECOND;
