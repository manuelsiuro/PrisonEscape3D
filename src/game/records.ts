import { betterMedal, medalFor, MEDALS, type Medal } from '../content/medals';
import { KEYS, readJSON, writeJSON } from './storage';

/** A way out's quickest escape (day and game minute), and the best medal it has won (P16: never taken away). */
interface RouteBest {
  day: number;
  minute: number;
  medal?: Medal;
  /** P41: a clean getaway after this way out (the manhunt run to safety): a star on the shelf, never taken away. */
  clean?: true;
}

/** One prison's escapes: the routes found (ESCAPES names), the quickest (day and game minute), and each route's (P16). */
export interface PrisonRecord {
  routes: string[];
  bestDay: number;
  bestMinute: number;
  byRoute: Record<string, RouteBest>;
  /** The most of the crew ever out with the player here (P23; 0 none, or a record from before the crew). */
  crew: number;
}

type Records = Record<string, PrisonRecord>;

function fitRouteBest(v: unknown): RouteBest | null {
  const b = v as Partial<RouteBest> | null;
  if (!b || typeof b !== 'object' || typeof b.day !== 'number' || b.day < 1) return null;
  return { day: b.day, minute: typeof b.minute === 'number' ? b.minute : 0, ...(b.medal && MEDALS.includes(b.medal) ? { medal: b.medal } : {}), ...(b.clean === true ? { clean: true as const } : {}) };
}

/** Every prison's record (an empty one for a prison never escaped). */
export function recordOf(prison: string): PrisonRecord {
  const r = readJSON<Records>(KEYS.escapes, {})[prison];
  const routes = Array.isArray(r?.routes) ? r.routes.filter((x) => typeof x === 'string') : [];
  const byRoute: Record<string, RouteBest> = {};
  if (r?.byRoute && typeof r.byRoute === 'object')
    for (const route of routes) {
      const b = fitRouteBest(r.byRoute[route]);
      // A quickest from before medals (the v2 migration): the medal its day earns.
      const m = b && (b.medal ?? medalFor(prison, route, b.day));
      if (b) byRoute[route] = m ? { ...b, medal: m } : b;
    }
  return {
    routes,
    bestDay: typeof r?.bestDay === 'number' ? r.bestDay : 0,
    bestMinute: typeof r?.bestMinute === 'number' ? r.bestMinute : 0,
    byRoute,
    crew: typeof r?.crew === 'number' && r.crew > 0 ? Math.floor(r.crew) : 0,
  };
}

/** What an escape did to the records. */
export interface EscapeRecord {
  newRoute: boolean;
  /** The prison's quickest yet; this way out's quickest yet. */
  best: boolean;
  routeBest: boolean;
  /** The medal this escape earned (null: too slow), and whether it beats the route's medal so far. */
  medal: Medal | null;
  newMedal: boolean;
  record: PrisonRecord;
}

/**
 * An escape: the route joins the prison's list, the quickest is kept (the prison's and the
 * route's), and the route's medal goes up if this one is better. `minutes` counts game
 * minutes from day 1 08:00 (comparing escapes across days).
 */
export function recordEscape(prison: string, route: string, day: number, minutes: number, crew = 0): EscapeRecord {
  const all = readJSON<Records>(KEYS.escapes, {});
  const was = recordOf(prison);
  const newRoute = !was.routes.includes(route);
  const best = was.bestDay === 0 || minutes < was.bestMinute;
  const old = was.byRoute[route];
  const routeBest = !old || minutes < old.minute;
  const medal = medalFor(prison, route, day);
  const top = betterMedal(old?.medal, medal);
  const newMedal = !!medal && top === medal && medal !== old?.medal;
  const byRoute = { ...was.byRoute, [route]: { day: routeBest ? day : old.day, minute: routeBest ? minutes : old.minute, ...(top ? { medal: top } : {}), ...(old?.clean ? { clean: true as const } : {}) } };
  const record: PrisonRecord = {
    routes: newRoute ? [...was.routes, route] : was.routes,
    bestDay: best ? day : was.bestDay,
    bestMinute: best ? minutes : was.bestMinute,
    byRoute,
    crew: Math.max(was.crew, crew),
  };
  writeJSON(KEYS.escapes, { ...all, [prison]: record });
  return { newRoute, best, routeBest, medal, newMedal, record };
}

/**
 * A clean getaway (P41): the manhunt after this way out run to safety. The route's star on the
 * shelf (its escape already recorded at the wall); whether it's the first for the route.
 */
export function recordGetaway(prison: string, route: string): boolean {
  const all = readJSON<Records>(KEYS.escapes, {});
  const was = recordOf(prison);
  const b = was.byRoute[route];
  if (!b || b.clean) return false;
  writeJSON(KEYS.escapes, { ...all, [prison]: { ...was, byRoute: { ...was.byRoute, [route]: { ...b, clean: true } } } });
  return true;
}
