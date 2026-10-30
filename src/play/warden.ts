/** The warden's voice: who speaks over the speakers here, a line said there, and the clock as the warden says it. */
import { t, type Key } from '../i18n';
import type { Sim } from '../sim/Sim';
import { hhmm } from '../sim/systems/clock';
import { paBoard, settings } from './context';

/** "10:00" for a minute into the prison day. */
export const dayTime = (dayMin: number) => hhmm((dayMin + 8 * 60) % 1440);

/** The warden's name here. */
export const wardenOf = (sim: Sim) => t(`warden.${sim.prison.id}` as Key);

/** A line over the speakers (not with the announcements off; never in your sleep). */
export function announcePa(sim: Sim, text: string) {
  if (settings.pa === 'off' || sim.state.sleeping) return;
  paBoard.say(wardenOf(sim), text);
}
