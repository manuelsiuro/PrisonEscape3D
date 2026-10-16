import { ACHIEVEMENTS, type Achievement, type Career, type EscapeView, type RunView } from '../content/achievements';
import type { Medal } from '../content/medals';
import { COSMETICS } from '../content/prisoner';
import { escapesOf, PRISONS } from '../content/prisons';
import { ESCAPES, type Sim } from '../sim/Sim';
import { FEAT, FEATS } from '../sim/systems/ledger';
import { UNIT } from '../sim/tuning';
import { LESSONS } from '../tutorial/lessons';
import { lessonsDone } from './lessons';
import { recordOf, type EscapeRecord } from './records';
import { addStats, readStats, type Stats } from './stats';
import { KEYS, readJSON, writeJSON } from './storage';

/**
 * Achievements earned on this device (P16), and the lifetime stats they read. A run is
 * followed from its start: its ledger's counts go into the stats as it goes (`syncRun`), its
 * run achievements are checked as it goes (`checkRun`), its escape's at the end. Career ones
 * follow the stats and the records (`syncCareer`), which also gives what older records earned.
 * DOM-free: the play layer shows what was earned (`onEarned`).
 */
interface Store {
  /** Achievement id → when earned (ms since 1970). */
  earned: Record<string, number>;
  /** Earned and not yet looked at on the shelf. */
  unseen: string[];
  /** The runs (their salt) whose escape is counted: a save loaded and escaped from again counts once. */
  escaped?: number[];
}

function readStore(): Store {
  const s = readJSON<Partial<Store>>(KEYS.trophies, {});
  const earned: Record<string, number> = {};
  if (s.earned && typeof s.earned === 'object') for (const [k, v] of Object.entries(s.earned)) if (typeof v === 'number' && ACHIEVEMENTS.some((a) => a.id === k)) earned[k] = v;
  const unseen = Array.isArray(s.unseen) ? s.unseen.filter((k): k is string => typeof k === 'string' && k in earned) : [];
  const escaped = Array.isArray(s.escaped) ? s.escaped.filter((k): k is number => typeof k === 'number') : [];
  return { earned, unseen, escaped };
}

export const earnedTrophies = (): Record<string, number> => readStore().earned;
export const unseenTrophies = (): string[] => readStore().unseen;

/** The shelf was looked at: nothing new any more. */
export function markTrophiesSeen() {
  const s = readStore();
  if (s.unseen.length) writeJSON(KEYS.trophies, { ...s, unseen: [] });
}

/** Called with what was just earned (a toast and a fanfare in play). */
export const trophyHooks: { onEarned: (a: Achievement[]) => void } = { onEarned: () => {} };

/** Earns achievements (once each); returns those new. */
function award(list: Achievement[], now = Date.now()): Achievement[] {
  if (!list.length) return [];
  const s = readStore();
  const fresh = list.filter((a) => !(a.id in s.earned));
  if (!fresh.length) return [];
  for (const a of fresh) s.earned[a.id] = now;
  writeJSON(KEYS.trophies, { ...s, earned: s.earned, unseen: [...s.unseen, ...fresh.map((a) => a.id)] });
  return fresh;
}

/** The cosmetics open to the player: the free ones and those their achievements gave. */
export function unlockedCosmetics(): Set<string> {
  const earned = readStore().earned;
  const gifts = new Set(ACHIEVEMENTS.filter((a) => a.gives && a.id in earned).map((a) => a.gives!));
  return new Set(COSMETICS.filter((c) => !c.locked || gifts.has(c.id)).map((c) => c.id));
}

// ------------------------------------------------------------------ the run

/** The run followed now: its numbers already added to the stats. */
let run: { sim: Sim; feats: number[]; tally: number[]; day: number } | null = null;

const viewOf = (sim: Sim): RunView => ({ prison: sim.prison.id, feats: sim.state.feats, days: sim.state.days, str: sim.state.str, spd: sim.state.spd, int: sim.state.items.int });

/** A game begins (`fresh`: a new one, not loaded) and is followed from here. */
export function startRun(sim: Sim, fresh: boolean) {
  run = { sim, feats: [...sim.state.feats], tally: [...sim.state.tally], day: sim.clock.day };
  if (fresh) addStats({ games: 1 });
}

/** The game left (to the title, or the escape screen): its last counts go in, and it's no longer followed. */
export function stopRun() {
  syncRun();
  run = null;
}

/** The run's counts since the last sync go into the lifetime stats. */
export function syncRun(): Stats {
  if (!run) return readStats();
  const st = run.sim.state;
  const delta: Stats = {};
  FEATS.forEach((f, k) => {
    if (f === 'partial') return;
    if (f === 'maxHeat') delta.maxHeat = st.feats[k];
    else if (f === 'walked') {
      // Tiles, from the ledger's UNIT steps (the remainder waits for the next sync).
      const tiles = Math.floor(st.feats[k] / UNIT) - Math.floor(run!.feats[k] / UNIT);
      if (tiles > 0) delta.walked = tiles;
    } else if (st.feats[k] > run!.feats[k]) delta[f] = st.feats[k] - run!.feats[k];
  });
  // Walls chipped, tunnel dug, cash earned (the victory tally).
  (['walls', 'dug', 'koTally', 'cash'] as const).forEach((name, k) => {
    if (name !== 'koTally' && st.tally[k] > run!.tally[k]) delta[name] = st.tally[k] - run!.tally[k];
  });
  const day = run.sim.clock.day;
  if (day > run.day) delta.days = day - run.day;
  run.feats = [...st.feats];
  run.tally = [...st.tally];
  run.day = day;
  return addStats(delta);
}

/** Checks since the stats last caught up (they do every CAREER_EVERY checks, about half a minute). */
let sinceSync = 0;
const CAREER_EVERY = 30;

/** The run's own achievements reached by now; now and then the stats catch up, and the career ones they complete. */
export function checkRun(): Achievement[] {
  if (!run) return [];
  const r = viewOf(run.sim);
  const got = award(ACHIEVEMENTS.filter((a) => a.run?.(r)));
  if (++sinceSync >= CAREER_EVERY) {
    sinceSync = 0;
    syncRun();
    got.push(...syncCareer(false));
  }
  if (got.length) trophyHooks.onEarned(got);
  return got;
}

/** Out (the records already updated): the escape's achievements, the run's, the career's. Returned for the victory card (no toasts). */
export function escapeRun(rec: EscapeRecord): Achievement[] {
  if (!run) return [];
  const sim = run.sim;
  // Once a run (by its salt): the same save escaped from twice is one escape.
  const store = readStore();
  if (!store.escaped!.includes(sim.state.salt)) {
    writeJSON(KEYS.trophies, { ...store, escaped: [...store.escaped!, sim.state.salt].slice(-200) });
    addStats({ escapes: 1 });
  }
  syncRun();
  const e: EscapeView = { ...viewOf(sim), via: ESCAPES[sim.state.via], day: sim.clock.day, medal: rec.medal };
  const got = award(ACHIEVEMENTS.filter((a) => a.escape?.(e) || a.run?.(e)));
  return [...got, ...syncCareer(false)];
}

/** A rumor heard (P13 gossip): counted for the stats and All Ears. */
export function rumorHeard() {
  addStats({ rumors: 1 });
  syncCareer();
}

// ------------------------------------------------------------------ the career

/** The career as the checks see it. */
export function careerOf(stats = readStats()): Career {
  return {
    stats,
    prisons: PRISONS.map((p) => {
      const r = recordOf(p.id);
      return { id: p.id, routes: r.routes, of: escapesOf(p).length, medals: Object.values(r.byRoute).flatMap((b) => (b.medal ? [b.medal] : [])) };
    }),
    lessons: lessonsDone().filter((id) => LESSONS.some((l) => l.id === id)).length,
    lessonsOf: LESSONS.length,
  };
}

/**
 * The career's achievements, and what the records already earned (escapes from before
 * achievements: each way out found, its quickest day and medal; never conduct, which needs
 * the whole run). `toast`: tell the play layer.
 */
export function syncCareer(toast = true): Achievement[] {
  const c = careerOf();
  const views: EscapeView[] = [];
  const none = new Array(FEATS.length).fill(0);
  none[FEAT.partial] = 1;
  for (const p of PRISONS) {
    const r = recordOf(p.id);
    const base = { prison: p.id, feats: none, days: [], str: 0, spd: 0, int: 0 };
    for (const via of r.routes) {
      const b = r.byRoute[via];
      views.push({ ...base, via, day: b?.day ?? Infinity, medal: (b?.medal ?? null) as Medal | null });
    }
    if (r.bestDay > 0) views.push({ ...base, via: '', day: r.bestDay, medal: null });
  }
  const got = award(ACHIEVEMENTS.filter((a) => a.career?.(c) || (a.escape && views.some((v) => a.escape!(v)))));
  if (got.length && toast) trophyHooks.onEarned(got);
  return got;
}
