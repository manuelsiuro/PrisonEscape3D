/**
 * Stealth and heat (2.35, the user's picks; `Sim.rules234` plays older logs as they were):
 * - **Noticing.** A guard who sees the player at something it would sound the alarm for (a blow at someone
 *   calm, tools at work, out after hours, somewhere staff only) takes a moment to be sure: a "?" fills over
 *   it, NOTICE_NEAR steps close up to NOTICE_FAR at the edge of its sight. Once it's full the rule is as it
 *   was (100%, the lockdown); out of its view first, it comes to look where it last saw them, at no cost.
 * - **The dark.** At night a guard sees the player DARK_SIGHT tiles off, further only along lit tiles
 *   (`ai/light.ts`).
 * - **Lying low.** Where the routine wants the player, heat cools LOW_COOL times as fast, in a guard's
 *   sight too (never under a camera's eye, nor in a lockdown).
 */
import { nightAt, type Dark } from '../ai/light';
import { isqrt } from '../hunt/common';
import type { SimContext } from '../context';
import { CHASE_HEAT, NOTICE_CLOSE, NOTICE_FAR, NOTICE_NEAR, UNIT } from '../tuning';
import { LAYER } from '../world/World';
import { clockAt } from './clock';
import { sightFor } from './football';
import { awake, GUARD, sendToLook, type Guard } from './guards';
import { cameraSeesPlayer, powered } from './power';
import { lookingAway } from './ways';
import { afterHours } from './watch';

/** What the lamps and room lights do now; null by day, or under the old rules (everything lit). */
export function darkNow(sim: SimContext): Dark | null {
  const s = sim.state;
  if (sim.rules234 || !nightAt(clockAt(s.step).minuteOfDay)) return null;
  // (2.36: a lamp's pool stops at walls; Sim.rules235 plays older runs with it lighting through them.)
  return { power: powered(sim.world, s, 'lights'), blockDark: !s.lockdown && afterHours(sim), walls: !sim.rules235 };
}

/** What the player is doing that a guard would sound the alarm for, if sure. */
export interface Offence {
  /** A blow at someone calm, recently (NOTICE_HOLD). */
  fight: boolean;
  /** Tools at work on the structure, recently. */
  work: boolean;
  /** Out of the cell past the walk home (a bribed guard lets it pass). */
  late: boolean;
  /** Somewhere staff only (likewise). */
  restricted: boolean;
}

/** How long a guard takes to be sure (steps): NOTICE_NEAR within NOTICE_CLOSE tiles, NOTICE_FAR at the edge of its sight. */
export function noticeSteps(sim: SimContext, g: Guard): number {
  const p = sim.state.player;
  const d = isqrt((g.body.x - p.x) ** 2 + (g.body.z - p.z) ** 2);
  const near = Math.round(NOTICE_CLOSE * UNIT);
  const far = Math.max(near + 1, sightFor(sim, g, p.x, p.z));
  const k = Math.min(far - near, Math.max(0, d - near));
  return NOTICE_NEAR + Math.floor(((NOTICE_FAR - NOTICE_NEAR) * k) / (far - near));
}

/**
 * Each guard's "?" (`Guard.notice`): it fills while the guard sees the player at an offence, and empties
 * once it doesn't (the guard sent to look where it last saw them, unless there's a chase or a lockdown on).
 * Returns the offences some guard is sure of now.
 */
export function notice(sim: SimContext, off: Offence): Offence {
  const s = sim.state;
  const sure: Offence = { fight: false, work: false, late: false, restricted: false };
  const any = off.fight || off.work || off.late || off.restricted;
  s.guards.forEach((g, k) => {
    const away = lookingAway(g, s.step);
    // (A fight or tools at work, none overlooks; the hour and staff rooms, a bribed guard lets pass.)
    const sees = g.sees && any && !s.lockdown && (off.fight || off.work || (!away && (off.late || off.restricted)));
    if (!sees) {
      if (g.notice) {
        // Not sure, but it saw something: it comes to look (a chase, a lockdown and wanted come first).
        if (!s.lockdown && s.heat < CHASE_HEAT && awake(g) && g.mode !== GUARD.CHASE) sendToLook(g, g.lastSeen);
        g.notice = 0;
      }
      return;
    }
    if (!g.notice) sim.events.push({ type: 'noticing', guard: k });
    g.notice = (g.notice ?? 0) + 1;
    g.noticeNeed = noticeSteps(sim, g);
    if (g.notice < g.noticeNeed) return;
    sure.fight ||= off.fight;
    sure.work ||= off.work;
    if (away) return;
    sure.late ||= off.late;
    sure.restricted ||= off.restricted;
  });
  return sure;
}

/** A guard the player hits knows at once who it was (its "?" full). */
export function sureOf(sim: SimContext, g: Guard) {
  if (sim.rules234) return;
  g.notice = NOTICE_FAR;
  g.noticeNeed = NOTICE_NEAR;
}

/** Where the routine wants the player, there now: heat cools LOW_COOL times as fast (not under a camera, not in a lockdown). */
export function lyingLow(sim: SimContext): boolean {
  const s = sim.state;
  if (sim.rules234 || s.lockdown || s.heat <= 0 || s.ko > 0 || s.layer !== LAYER.GROUND || sim.away || s.stowed) return false;
  const zones = sim.dutyZones;
  return zones.length > 0 && zones.includes(sim.playerZone) && !cameraSeesPlayer(sim);
}
