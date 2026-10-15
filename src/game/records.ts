import { KEYS, readJSON, writeJSON } from './storage';

/** One prison's escapes: the routes found (ESCAPES names), and the quickest (day and game minute). */
export interface PrisonRecord {
  routes: string[];
  bestDay: number;
  bestMinute: number;
}

type Records = Record<string, PrisonRecord>;

/** Every prison's record (an empty one for a prison never escaped). */
export function recordOf(prison: string): PrisonRecord {
  const r = readJSON<Records>(KEYS.escapes, {})[prison];
  return {
    routes: Array.isArray(r?.routes) ? r.routes.filter((x) => typeof x === 'string') : [],
    bestDay: typeof r?.bestDay === 'number' ? r.bestDay : 0,
    bestMinute: typeof r?.bestMinute === 'number' ? r.bestMinute : 0,
  };
}

/**
 * An escape: the route joins the prison's list, and the quickest is kept. Says whether the
 * route is new and whether this was the quickest yet. `minutes` counts game minutes from
 * day 1 08:00 (comparing escapes across days).
 */
export function recordEscape(prison: string, route: string, day: number, minutes: number): { newRoute: boolean; best: boolean; record: PrisonRecord } {
  const all = readJSON<Records>(KEYS.escapes, {});
  const was = recordOf(prison);
  const newRoute = !was.routes.includes(route);
  const best = was.bestDay === 0 || minutes < was.bestMinute;
  const record: PrisonRecord = {
    routes: newRoute ? [...was.routes, route] : was.routes,
    bestDay: best ? day : was.bestDay,
    bestMinute: best ? minutes : was.bestMinute,
  };
  writeJSON(KEYS.escapes, { ...all, [prison]: record });
  return { newRoute, best, record };
}
