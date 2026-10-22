/**
 * The paperwork escape (P36, docs/PLAN.md §11): the numbers it works by. The strict guard (the
 * morning shakedown's: a supervisor) carries blank release forms. One filled in and signed in its
 * hand (Intellect FORGE_INT, ink) and slipped unseen into the tray at the release desk puts the
 * player's name on tomorrow's release list. The records are checked at 22:00: a name with the heat
 * up, or after a lockdown that day, gets a second look and the forgery is found. In the morning the
 * PA calls the name at 10:00; cleared at the desk, the player walks out in their own clothes. How
 * it plays out is src/sim/systems/paperwork.ts.
 */
import { STEPS_PER_MINUTE } from '../sim/tuning';

/** A forged release form: a blank one and ink, this much Intellect (recipes.ts). */
export const FORGE_INT = 80;

/** The records checked: minutes into the prison day (22:00). The heat at which a name gets a second look. */
export const RECORDS_MINUTE = 14 * 60;
export const RECORDS_HEAT = 40;

/** The release: the PA calls the name at 10:00, and the player has till 10:30 to report (minutes into the prison day). */
export const RELEASE_FROM = 2 * 60;
export const RELEASE_TO = 2 * 60 + 30;
/** The desk's checks: heat under this, no lockdown, nothing contraband on them; a failed check costs this much heat (and the name). */
export const RELEASE_HEAT = 40;
export const RELEASE_FAIL_HEAT = 40;
/** Cleared, the way out stays open for the player this long (steps: 60 s). */
export const FREED_STEPS = 60 * STEPS_PER_MINUTE;
