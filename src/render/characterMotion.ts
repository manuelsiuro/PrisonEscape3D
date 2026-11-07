import { STEPS_PER_SECOND, UNIT, WALK_SPEED } from '../sim/tuning';
import { hash01 } from './rand';
import type { Limbs } from './characterPose';

// A character's own way of moving (session 15, v2.36.0): its stride, its walk and how it stands about,
// all from a number of its own (the cast's place), never from the sim's random numbers nor Math.random:
// the same character moves the same way on every load, and drawhash and the tests stay steady.

/** The walk's pace (tiles a second): a planted foot keeps up with the ground at it. */
export const WALK_TILES = (WALK_SPEED / UNIT) * STEPS_PER_SECOND;
/** Hip to sole (the legs' pivots at 0.4, the shoe's sole a little below). */
const LEG = 0.42;
/** How far a leg swings at a walk, and how much more at a run (radians either way). */
export const SWING = 0.75;
export const SWING_RUN = 0.3;
/** Faster than the walk by this much, a run starts showing, and by this much it's a full run. */
const RUN_FROM = 1.15;
const RUN_FULL = 1.45;
/**
 * A move this much more than the quickest run could cover in the frame is a cut (put somewhere, a bed), not steps: the legs
 * fade to their own pace over as much again, rather than race it. Never more than this turn of the stride in a frame: at
 * ×16 or on a slow device the legs blur rather than strobe.
 */
const JUMP = 0.5;
const JUMP_PACE = 3;
const MOST_A_FRAME = 1;

/** How a character walks and stands, fixed for it. */
export interface Style {
  /** Where its stride starts (radians): two walking side by side aren't in step. */
  phase0: number;
  /** Its arms' swing, its bounce and its sway from foot to foot, against everyone's. */
  arms: number;
  bob: number;
  sway: number;
  /** Its lean into a walk (radians). */
  lean: number;
  /** Its time offset (s) and its breath's rate. */
  offset: number;
  breath: number;
  /** How it stands about when it has nothing to do (STANCE), and how often it fidgets (s). */
  stance: number;
  every: number;
}

/** Standing about: arms at the sides, hands behind the back, arms folded. */
export const STANCE = { SIDES: 0, BEHIND: 1, FOLDED: 2 } as const;
/** A fidget now and then, standing about: a look round, the weight shifted, a stretch, a scratch, a neck rolled, a glance at the wrist. */
export const FIDGET = { NONE: 0, LOOK: 1, SHIFT: 2, STRETCH: 3, SCRATCH: 4, NECK: 5, WATCH: 6 } as const;
/** How long each lasts (s). */
const FIDGET_FOR = [0, 2.6, 3.2, 2.2, 1.8, 1.8, 1.6];
/** Which an inmate and a guard pick from (a guard doesn't stretch or scratch on duty). */
const INMATE_FIDGETS = [FIDGET.LOOK, FIDGET.LOOK, FIDGET.SHIFT, FIDGET.SHIFT, FIDGET.STRETCH, FIDGET.SCRATCH, FIDGET.NECK];
const GUARD_FIDGETS = [FIDGET.LOOK, FIDGET.LOOK, FIDGET.SHIFT, FIDGET.NECK, FIDGET.WATCH];

/** A character's style from its number (`guard`: straighter, stiffer arms, hands behind the back more often). */
export function styleFor(seed: number, guard: boolean): Style {
  const r = (k: number) => hash01(seed + 1, k);
  const stanceRoll = r(6);
  return {
    phase0: r(1) * Math.PI * 2,
    arms: guard ? 0.62 + r(2) * 0.2 : 0.8 + r(2) * 0.3,
    bob: 0.8 + r(3) * 0.45,
    sway: guard ? r(4) * 0.02 : 0.01 + r(4) * 0.04,
    lean: guard ? 0.04 + r(5) * 0.03 : 0.05 + r(5) * 0.07,
    offset: r(7) * 10,
    breath: 1.8 + r(8) * 0.8,
    stance: guard
      ? stanceRoll < 0.55
        ? STANCE.BEHIND
        : stanceRoll < 0.75
          ? STANCE.FOLDED
          : STANCE.SIDES
      : stanceRoll < 0.3
        ? STANCE.FOLDED
        : stanceRoll < 0.42
          ? STANCE.BEHIND
          : STANCE.SIDES,
    every: 5 + r(9) * 7,
  };
}

/** The most a frame's move can be and still be steps (tiles), for a frame of `gameDt` game seconds. */
export function cutOf(gameDt: number): number {
  return JUMP + JUMP_PACE * WALK_TILES * gameDt;
}

/**
 * How far the stride turns for a frame's walk (radians): the ground covered over what a planted foot
 * covers at the swing's middle (its leg's length, the swing, the character's size), so the feet keep up
 * with the ground at any pace. Stuck against something (nothing covered), the legs keep their own pace
 * (`fallback`); past a cut (`cutOf`) they fade to it.
 */
export function strideTurn(moved: number, amp: number, size: number, fallback: number, cut: number): number {
  if (moved <= 1e-5) return Math.min(MOST_A_FRAME, fallback);
  const w = Math.max(0, Math.min(1, (moved - cut) / cut));
  return Math.min(MOST_A_FRAME, (moved / (LEG * amp * size)) * (1 - w) + fallback * w);
}

/** How much of a run (0–1) a pace (tiles a second) is. */
export function runOf(speed: number): number {
  const x = Math.max(0, Math.min(1, (speed / WALK_TILES - RUN_FROM) / (RUN_FULL - RUN_FROM)));
  return x * x * (3 - 2 * x);
}

/** A fidget's own state: which, how far through (s), when the next comes (s of standing about). */
export interface Idle {
  kind: number;
  at: number;
  next: number;
  /** Which side a look or a shift goes (±1). */
  side: number;
}

/** The next fidget: its kind and side drawn from the character's own numbers (`roll`: a fresh one each time). */
export function nextFidget(idle: Idle, style: Style, guard: boolean, roll: () => number, armsFree: boolean) {
  const list = guard ? GUARD_FIDGETS : INMATE_FIDGETS;
  let kind: number = list[Math.floor(roll() * list.length)];
  // (Something in hand: no stretch, no scratch, no glance at the wrist with it: a look round instead.)
  if (!armsFree && (kind === FIDGET.STRETCH || kind === FIDGET.SCRATCH || kind === FIDGET.WATCH)) kind = FIDGET.LOOK;
  idle.kind = kind;
  idle.at = 0;
  idle.side = roll() < 0.5 ? -1 : 1;
  idle.next = style.every * (0.7 + roll() * 0.6);
}

/** A bump that rises and falls over a fidget (0 → 1 → 0), held at the top for its middle. */
function envelope(u: number): number {
  const e = Math.min(1, u / 0.22, (1 - u) / 0.22);
  return e <= 0 ? 0 : e * e * (3 - 2 * e);
}

/** What a fidget does to the head and the body, beside the limbs. */
export interface IdleExtra {
  headY: number;
  headX: number;
  headZ: number;
  roll: number;
  /** Sideways (tiles, the body's own x): the weight over one foot. */
  hip: number;
}

/**
 * Standing about (`rest`: 0 busy … 1 settled): the stance's arms, a fidget's moves on top, and the
 * breath; `armsFree`: nothing in hand, no rat on the shoulder (the arms are the stance's to use).
 */
export function idlePose(l: Limbs, out: IdleExtra, style: Style, idle: Idle, rest: number, t: number, armsFree: boolean) {
  out.headY = out.headX = out.headZ = out.roll = out.hip = 0;
  if (rest <= 0) return;
  const stance = armsFree ? style.stance : STANCE.SIDES;
  if (stance === STANCE.BEHIND) {
    l.armLx += 0.42 * rest;
    l.armRx += 0.42 * rest;
    l.armLz += 0.3 * rest;
    l.armRz -= 0.3 * rest;
  } else if (stance === STANCE.FOLDED) {
    l.armLx -= 1.15 * rest;
    l.armRx -= 1.15 * rest;
    l.armLz += 0.6 * rest;
    l.armRz -= 0.6 * rest;
  }
  // (Breathing: the arms out a hair and back.)
  const breath = Math.sin(t * style.breath);
  l.armLz -= 0.02 * breath * rest;
  l.armRz += 0.02 * breath * rest;
  const dur = FIDGET_FOR[idle.kind] ?? 0;
  if (!idle.kind || !dur) return;
  const u = Math.min(1, idle.at / dur);
  const e = envelope(u) * rest;
  if (e <= 0) return;
  const s = idle.side;
  switch (idle.kind) {
    case FIDGET.LOOK: {
      // Over one shoulder, then the other, then back.
      const sweep = Math.sin(u * Math.PI * 2) * (u < 0.5 ? 1 : 0.8);
      out.headY = sweep * 0.65 * s * envelope(u) * rest;
      break;
    }
    case FIDGET.SHIFT:
      // The weight over one foot: the other knee eased, the hips out, the shoulders the other way.
      out.hip = 0.035 * s * e;
      out.roll = -0.06 * s * e;
      if (s > 0) l.legL -= 0.18 * e;
      else l.legR -= 0.18 * e;
      break;
    case FIDGET.STRETCH:
      // Both arms up over the head, the head back, up on the toes.
      l.armLx += (-2.9 - l.armLx) * e;
      l.armRx += (-2.9 - l.armRx) * e;
      l.armLz += (-0.22 - l.armLz) * e;
      l.armRz += (0.22 - l.armRz) * e;
      out.headX = -0.3 * e;
      l.bob += 0.03 * e;
      break;
    case FIDGET.SCRATCH: {
      // A hand up to the back of the head, scratching: up past the ear and a little behind, just clear of the head's side.
      const rub = Math.sin(t * 14) * 0.08;
      if (s > 0) {
        l.armLx += (-2.85 + rub - l.armLx) * e;
        l.armLz += (0.1 - l.armLz) * e;
      } else {
        l.armRx += (-2.85 + rub - l.armRx) * e;
        l.armRz += (-0.1 - l.armRz) * e;
      }
      out.headX = 0.12 * e;
      break;
    }
    case FIDGET.NECK:
      // The neck rolled one way and the other.
      out.headZ = Math.sin(u * Math.PI * 2) * 0.22 * e;
      out.headX = 0.08 * e;
      break;
    case FIDGET.WATCH:
      // A look at the wrist: the left forearm up before the chest, the head down to it.
      l.armLx += (-1.45 - l.armLx) * e;
      l.armLz += (0.55 - l.armLz) * e;
      out.headX = 0.32 * e;
      out.headY = -0.2 * e;
      break;
  }
}
