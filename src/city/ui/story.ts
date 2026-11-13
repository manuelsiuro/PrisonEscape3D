import { t, type Key } from '../../i18n';
import { MAP_W } from '../../sim/world/grid';
import type { City } from '../sim/City';
import type { Objective } from '../sim/story';

/** A line of the act's list in words (C3): what's asked, with where and how far along. */
export function objectiveText(c: City, o: Objective): string {
  const plan = c.plan;
  const P = c.story;
  if (o.id === 'radio') return t('city.obj.radio', { where: plan.names[plan.start] });
  if (o.id === 'batteries') return t('city.obj.batteries', { n: o.n ?? 0, of: o.of ?? 0 });
  if (o.id.startsWith('kit.')) {
    const what = t(`city.${o.id}` as Key);
    if (o.done || !o.at) return what.charAt(0).toUpperCase() + what.slice(1);
    const dist = c.districtOf(o.at.district);
    const lot = dist.lotAt[o.at.tile];
    return t('city.obj.kit', {
      what,
      place: t(`city.use.${lot ? dist.lots[lot - 1].use : 'none'}` as Key),
      where: plan.names[o.at.district],
    });
  }
  if (o.id.startsWith('scout')) return t(`city.obj.${o.id}` as Key, { where: plan.names[P.wayDistrict[Number(o.id.slice(5)) - 1]] });
  if (o.id === 'hold1' || o.id === 'hold3') return t(`city.obj.${o.id}` as Key, { n: o.left ?? 0 });
  return t(`city.obj.${o.id}` as Key);
}

/** A tile of a district on the city's map (pixels; `gap` between districts). */
export const mapXY = (d: number, tile: number, gap: number) => ({
  x: gap + (d % 3) * (MAP_W + gap) + (tile % MAP_W) + 0.5,
  y: gap + Math.floor(d / 3) * (MAP_W + gap) + Math.floor(tile / MAP_W) + 0.5,
});
