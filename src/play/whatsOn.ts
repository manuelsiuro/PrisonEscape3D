import { listOf, t } from '../i18n';
import type { Sim } from '../sim/Sim';
import { twist } from '../sim/systems/twists';

/**
 * What free time opens here (2.39, the free time's polish): the merchants' stalls (not on a Closed Shop Daily), games
 * with inmates, the pay phone and the kiosk where the prison has them, the sports field and the garden. Said by the
 * free time's banner and on its rows in the day card, so the player knows what the block is for. (Tonight's race, quiz
 * or talent night are the day card's own pins.)
 */
export function freeTimeOpens(sim: Sim): string[] {
  const def = sim.prison;
  const has = (zone: string) => def.zones.some(([z]) => z === zone);
  const out: string[] = [];
  if (def.merchants.length && !twist(sim.state, 'closedShop')) out.push(t('open.shops'));
  out.push(t('open.games'));
  if (def.comms) out.push(t('open.phone'), t('open.kiosk'));
  if (has('sports')) out.push(t('open.field'));
  if (has('garden')) out.push(t('open.garden'));
  return out;
}

/** The same as a line: "Open: shops, games, the phone…". */
export const freeTimeLine = (sim: Sim) => t('open.line', { list: listOf(freeTimeOpens(sim)) });
