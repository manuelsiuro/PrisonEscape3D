import { itemDef, itemNumber, type ItemDef } from '../../content/items';
import { lineOfSight } from '../ai/sight';
import { GUARD_SWING_STEPS, INMATE_SWING_STEPS, LOCK_RANGE, MELEE_REACH, RIOT_DEFENSE, UNIT } from '../tuning';
import type { World } from '../world/World';
import type { Body } from './movement';

/**
 * Combat (GDD §3.1, §10): health, the damage and swing-speed formulas, and who can be locked
 * on to. Pure functions; the simulation applies them to the player, the inmates and the
 * guards alike.
 */

/** Anyone who can be hit and knocked out: the inmates and the guards (plain data in the state). */
export interface Fighter {
  body: Body;
  /** Health left (max 50 + STR). */
  hp: number;
  /** Steps left knocked out (0: up and about). */
  ko: number;
  /** Strength (20–100): harder blows, more health. */
  str: number;
  /** The step of its last blow (blows come at its own pace). */
  swing: number;
}

/** Maximum health (GDD §3.1: 50 + Strength). */
export const maxHealth = (str: number) => 50 + str;

/**
 * One blow (GDD §10.1): a base that grows with Strength, plus the weapon's bonus, less a
 * third of the target's outfit defense; never under 1. Fists at STR 40 hit for 12; a guard's
 * baton (STR 60) hits an inmate outfit for 34.
 */
export function damage(str: number, attack: number, defense: number): number {
  return Math.max(1, 2 + Math.floor(str / 4) + attack - Math.floor(defense / 3));
}

/** Steps between the player's blows: quicker with Speed (GDD §3.2), quicker still with nunchucks. */
export function swingSteps(spd: number, weapon: ItemDef | null): number {
  const base = Math.max(8, 22 - Math.floor(spd / 5));
  return Math.max(6, Math.round(base * (1 - (weapon?.haste ?? 0))));
}

/** How far a weapon reaches (units): arm's length, further with the razor whip. */
export const reachOf = (weapon: ItemDef | null) => (weapon?.reach ? Math.round(weapon.reach * UNIT) : MELEE_REACH);

const INMATE_OUTFIT = itemNumber('inmate_outfit');
const GUARD_OUTFIT = itemNumber('guard_outfit');
export const BATON = itemNumber('baton');
/** Inmates wear the orange outfit, guards their uniform. */
export const INMATE_DEFENSE = itemDef(INMATE_OUTFIT).defense ?? 0;
export const GUARD_DEFENSE = itemDef(GUARD_OUTFIT).defense ?? 0;
export const BATON_ATTACK = itemDef(BATON).attack ?? 0;
/** A guard's defense: its uniform's, or a riot guard's plates (P12). */
export const guardDefense = (w: World, k: number) => (w.def.guards[k]?.riot ? RIOT_DEFENSE : GUARD_DEFENSE);
export { GUARD_SWING_STEPS, INMATE_SWING_STEPS };

/**
 * People, as the combat sees them: the inmates first, then the guards. A person's id is its
 * place in that list (locks, pockets and events use it).
 */
export interface Cast {
  inmates: readonly Fighter[];
  guards: readonly Fighter[];
}
export const personOf = (c: Cast, id: number): Fighter | undefined => (id < 0 ? undefined : id < c.inmates.length ? c.inmates[id] : c.guards[id - c.inmates.length]);
export const isGuard = (c: Cast, id: number) => id >= c.inmates.length;
export const peopleCount = (c: Cast) => c.inmates.length + c.guards.length;

/** Squared distance between two bodies (units²). */
export const dist2 = (a: Body, b: Body) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

/**
 * Who the player can lock on to (GDD §10.1): people up and about within LOCK_RANGE, in plain
 * view (no wall between), nearest first (ties by id, so it is the same on every machine).
 */
export function lockCandidates(w: World, c: Cast, p: Body, out: number[] = []): number[] {
  out.length = 0;
  const n = peopleCount(c);
  for (let id = 0; id < n; id++) {
    const f = personOf(c, id)!;
    if (f.ko > 0 || dist2(f.body, p) > LOCK_RANGE * LOCK_RANGE) continue;
    if (!lineOfSight(w, p.x, p.z, f.body.x, f.body.z)) continue;
    out.push(id);
  }
  out.sort((a, b) => dist2(personOf(c, a)!.body, p) - dist2(personOf(c, b)!.body, p) || a - b);
  return out;
}

/**
 * The next lock (R, the lock button): the next nearest after the current one, and past the
 * last, none (so with one person in range the button toggles).
 */
export function nextLock(w: World, c: Cast, p: Body, current: number): number {
  const list = lockCandidates(w, c, p);
  if (!list.length) return -1;
  const at = list.indexOf(current);
  if (current >= 0 && at < 0) return list[0];
  return at + 1 < list.length ? list[at + 1] : at < 0 ? list[0] : -1;
}
