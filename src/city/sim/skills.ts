import { ALIVE_REV, SKILL, SKILL_AT, SKILL_GIVES, SKILL_SCALE, SKILLS } from '../content/alive';
import type { PieceDef } from '../content/build';
import type { City } from './City';

/**
 * Skills learnt by doing (C5 batch 6, 2.71), a part of the city's simulation, in a city begun from then (`state.rev` 7): four skills
 * of five levels, a point for each thing done of their kind (content/alive.ts's SKILL_POINTS), and what each level gives. Nothing is
 * drawn: a blow that spares the weapon is the city's seed and the step.
 */

/** The save's part: the points of each skill (SKILLS' places). */
export const freshSkills = () => ({ skills: [0, 0, 0, 0] as number[] });

/** A save's field made sound before the city is built from it. */
export function soundSkills(st: { skills?: unknown }) {
  const k = st.skills;
  st.skills =
    Array.isArray(k) && k.length === SKILLS.length && k.every((v) => Number.isInteger(v) && v >= 0 && v <= 1e6) ? k : [0, 0, 0, 0];
}

/** Whether the city has skills (begun from 2.71). */
export const skillsOn = (c: City) => c.state.rev >= ALIVE_REV;

/** The points a skill's level begins at. */
export const levelAt = (k: number, l: number) => SKILL_AT[l - 1] * SKILL_SCALE[k];
/** The level (1–5) a skill's points come to. */
export function levelOf(k: number, points: number): number {
  let l = 1;
  while (l < SKILL_AT.length && points >= levelAt(k, l + 1)) l++;
  return l;
}
/** A skill's level now (1 in a city without them). */
export const level = (c: City, k: number) => (skillsOn(c) ? levelOf(k, c.state.skills[k] ?? 0) : 1);
/** The levels above the first (what each gives is counted in these). */
const above = (c: City, k: number) => level(c, k) - 1;

/** Points earned: a level reached is said. */
export function skillUp(c: City, k: number, n: number) {
  if (!skillsOn(c) || n <= 0) return;
  const was = level(c, k);
  c.state.skills[k] = Math.min(1e6, c.state.skills[k] + n);
  const now = level(c, k);
  if (now > was) c.events.push({ type: 'skill', skill: k, level: now });
}

/** The points to the next level, and the level's start (for the card's bar): null at the last. */
export function nextLevel(c: City, k: number): { from: number; to: number; have: number } | null {
  const l = level(c, k);
  if (l >= SKILL_AT.length) return null;
  return { from: levelAt(k, l), to: levelAt(k, l + 1), have: c.state.skills[k] ?? 0 };
}

// ------------------------------------------------------------------ what they give

/** Scavenger: a search's steps. */
export const searchSteps = (c: City, steps: number) =>
  Math.max(1, Math.round((steps * (1000 - SKILL_GIVES.searchQuicker * above(c, SKILL.SCAVENGER))) / 1000));
/** Scavenger: of a thousand draws, so many empty. */
export const emptyDraws = (c: City, none: number) => Math.max(100, none - SKILL_GIVES.fewerEmpty * above(c, SKILL.SCAVENGER));
/** Scavenger: a draw more at the last level. */
export const moreDraws = (c: City) => (level(c, SKILL.SCAVENGER) >= SKILL_AT.length ? 1 : 0);

/** Handy: building, repairing, taking down: quicker. */
export const workSteps = (c: City, steps: number) =>
  Math.max(1, Math.round((steps * (1000 - SKILL_GIVES.workQuicker * above(c, SKILL.HANDY))) / 1000));
/** Handy: what a piece takes (from level 3, one fewer of what it takes most of, if more than one; never what it keeps whole). */
export function pieceFrom(c: City, def: PieceDef): ReadonlyArray<readonly [string, number]> {
  if (level(c, SKILL.HANDY) < SKILL_GIVES.cheaperFrom) return def.from;
  let most = -1;
  def.from.forEach(([id, n], k) => {
    if (n > 1 && id !== def.keeps && id !== 'crossbow' && (most < 0 || n > def.from[most][1])) most = k;
  });
  return most < 0 ? def.from : def.from.map(([id, n], k) => [id, k === most ? n - 1 : n] as const);
}
/** Handy: a blow of the dead's on a piece that misses (one in 8 − b of them; none at level 1). */
export const pieceSpared = (c: City, beat: number) => {
  const b = above(c, SKILL.HANDY);
  return b > 0 && beat % (8 - b) === 0;
};

/** Fighter: a blow's energy (thousandths of it). */
export const blowEnergy = (c: City) => 1000 - SKILL_GIVES.blowEnergy * above(c, SKILL.FIGHTER);
/** Fighter: a blow that doesn't wear the weapon (one in 7 − b; none at level 1). From the city's seed and the step: no draw. */
export const wearSpared = (c: City) => {
  const b = above(c, SKILL.FIGHTER);
  return b > 0 && (c.salt(60_000 + c.state.step) >>> 0) % (7 - b) === 0;
};

/** Survivalist: a state's time (game minutes): the good ones longer, queasy shorter. */
export function moodMinutes(c: City, mood: string, minutes: number): number {
  const b = above(c, SKILL.SURVIVALIST);
  if (!b) return minutes;
  const pct = mood === 'queasy' ? 100 - SKILL_GIVES.statesLonger * b : 100 + SKILL_GIVES.statesLonger * b;
  return Math.max(1, Math.round((minutes * pct) / 100));
}
