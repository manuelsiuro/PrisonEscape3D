/**
 * Achievements and medals (P16): the data (every achievement named in both languages, a known
 * icon, one way to earn it; every locked cosmetic given by exactly one; a medal row for every
 * way out of every prison, gold before silver before bronze), the run ledger feeding the
 * lifetime stats, run, escape and career achievements earned when (and only when) they should
 * be, conduct refused to a partial run, medals never taken away, older records backfilled.
 */
import { check } from './assert';

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
};

const { ACHIEVEMENT_GROUPS, ACHIEVEMENTS } = await import('../src/content/achievements');
const { MEDAL_DAYS, MEDALS, medalFor, betterMedal } = await import('../src/content/medals');
const { COSMETICS } = await import('../src/content/prisoner');
const { escapesOf, PRISONS } = await import('../src/content/prisons');
const { en } = await import('../src/i18n/en');
const { fr } = await import('../src/i18n/fr');
const { hasIcon } = await import('../src/ui/icons');
const { FEAT, FEATS, DAY } = await import('../src/sim/systems/ledger');
const { Sim } = await import('../src/sim/Sim');
const { KEYS, migrateStorage } = await import('../src/game/storage');
const { recordEscape, recordOf } = await import('../src/game/records');
const { readStats } = await import('../src/game/stats');
const trophies = await import('../src/game/trophies');
const { Bot } = await import('./bots');
const { CENTER_PERKS } = await import('../src/content/prisons/center-perks');

const ids = ACHIEVEMENTS.map((a) => a.id);
const enT = en as Record<string, string>;
const frT = fr as Record<string, string>;

// ------------------------------------------------------------------ the data
check(new Set(ids).size === ids.length, 'achievement ids are unique');
for (const a of ACHIEVEMENTS) {
  check(ACHIEVEMENT_GROUPS.includes(a.group), `${a.id}: a known group`);
  check(hasIcon(a.icon), `${a.id}: a known icon (${a.icon})`);
  check([a.run, a.escape, a.career].filter(Boolean).length === 1, `${a.id}: earned one way (run, escape or career)`);
  check(!!enT[`ach.${a.id}`] && !!enT[`ach.${a.id}.d`] && !!frT[`ach.${a.id}`] && !!frT[`ach.${a.id}.d`], `${a.id}: named and described in English and French`);
  check(!a.hidden || a.group === 'mishaps', `${a.id}: only mishaps are hidden`);
  if (a.gives) check(!!COSMETICS.find((c) => c.id === a.gives && c.locked), `${a.id}: gives a locked cosmetic (${a.gives})`);
}
const locked = COSMETICS.filter((c) => c.locked);
for (const c of locked) check(ACHIEVEMENTS.filter((a) => a.gives === c.id).length === 1, `${c.id}: given by exactly one achievement`);
for (const g of ACHIEVEMENT_GROUPS) check(!!enT[`achGroup.${g}`] && !!frT[`achGroup.${g}`], `group ${g} named`);
const byGroup = ACHIEVEMENT_GROUPS.map((g) => `${g} ${ACHIEVEMENTS.filter((a) => a.group === g).length}`).join(', ');
console.log(`${ACHIEVEMENTS.length} achievements (${byGroup}); ${locked.length} cosmetics to earn, ${COSMETICS.length - locked.length} free`);

// Medals: a row for every way out of every prison, and nothing else; each row in order.
let rows = 0;
for (const p of PRISONS) {
  const routes = escapesOf(p);
  check(Object.keys(MEDAL_DAYS[p.id] ?? {}).sort().join() === [...routes].sort().join(), `${p.id}: a medal row for each way out`);
  for (const r of routes) {
    const [g, s, b] = MEDAL_DAYS[p.id][r];
    check(g >= 1 && g < s && s < b, `${p.id} ${r}: gold before silver before bronze`);
    check(medalFor(p.id, r, g) === 'gold' && medalFor(p.id, r, g + 1) === 'silver' && medalFor(p.id, r, s) === 'silver' && medalFor(p.id, r, s + 1) === 'bronze' && medalFor(p.id, r, b) === 'bronze' && medalFor(p.id, r, b + 1) === null, `${p.id} ${r}: the medal by day`);
    rows++;
  }
}
check(betterMedal('silver', 'gold') === 'gold' && betterMedal(null, 'bronze') === 'bronze' && betterMedal('bronze', null) === 'bronze', 'the better medal');
console.log(`${rows} medal rows: ${PRISONS.map((p) => `${p.id} ${escapesOf(p).map((r) => `${r} ${MEDAL_DAYS[p.id][r].join('/')}`).join(', ')}`).join('; ')}`);
check(MEDALS.length === 3, 'three medals');

// ------------------------------------------------------------------ a run: two days kept like a model prisoner
migrateStorage();
const bot = new Bot(CENTER_PERKS, 5);
trophies.startRun(bot.sim, true);
const earnedOnTheWay: string[] = [];
trophies.trophyHooks.onEarned = (list) => earnedOnTheWay.push(...list.map((a) => a.id));
let checks = 0;
bot.routineUntil(2, 12 * 60);
trophies.syncRun();
bot.routineUntil(3, 8 * 60);
trophies.checkRun();
checks++;
const f = bot.st.feats;
const stats = trophies.syncRun();
const moved = FEATS.filter((x, k) => f[k] && x !== 'walked').map((x) => `${x} ${f[FEAT[x]]}`);
console.log(`two days: ${moved.join(', ') || 'no counts'}; walked ${Math.floor(f[FEAT.walked] / 1024)} tiles; days ${bot.st.days.join('/')}`);
check(f[FEAT.partial] === 0, 'a new game keeps the whole run');
check(bot.st.days.length === 3 && bot.st.days.every((d) => (d & DAY.UNKNOWN) === 0), 'a bit set per day played');
check(stats.games === 1 && stats.days === 2, `the stats: one game, two days served (${stats.games}, ${stats.days})`);
check(stats.walked === Math.floor(f[FEAT.walked] / 1024), 'tiles walked add up across syncs');
check((stats.meals ?? 0) === f[FEAT.meals] && (stats.missed ?? 0) === f[FEAT.missed] && (stats.spotted ?? 0) === f[FEAT.spotted], 'the ledger lands in the stats');
check(trophies.syncRun().days === 2, 'a sync with nothing new adds nothing');
console.log(`run achievements on the way: ${earnedOnTheWay.join(', ') || 'none'} (${checks} check)`);

// Run achievements: met exactly when the ledger says so.
const view = (over: Partial<Record<string, number>>, extra = {}) => {
  const feats = new Array(FEATS.length).fill(0);
  for (const [k, v] of Object.entries(over)) feats[FEAT[k as keyof typeof FEAT]] = v ?? 0;
  return { prison: 'center-perks', feats, days: [0], str: 40, spd: 40, int: 40, ...extra };
};
const runOf = (id: string) => ACHIEVEMENTS.find((a) => a.id === id)!.run!;
check(!runOf('sweetTooth')(view({ chocolate: 4 })) && runOf('sweetTooth')(view({ chocolate: 5 })), 'Sweet Tooth at the fifth bar');
check(!runOf('bookworm')(view({}, { int: 99 })) && runOf('bookworm')(view({}, { int: 100 })), 'Bookworm at 100 Intellect');
check(runOf('sleepwalker')(view({ dummy: 1 })) && !runOf('sleepwalker')(view({})), 'Sleepwalker: the dummy passed a bed check');
check(runOf('shocking')(view({ shocked: 1 })), 'Shocking');

// Escape achievements, and conduct refused to a partial run.
const esc = (id: string) => ACHIEVEMENTS.find((a) => a.id === id)!.escape!;
const out = (over: Partial<Record<string, number>>, via = 'tunnel', day = 4, medal: 'gold' | null = null) => ({ ...view(over), via, day, medal });
check(esc('pacifist')(out({})) && !esc('pacifist')(out({ blows: 1 })) && !esc('pacifist')(out({ partial: 1 })), 'Pacifist: no blows, and the whole run');
check(!esc('pacifist')(out({ flung: 1 })) && !esc('pacifist')(out({ koGuards: 2 })) && !esc('pacifist')(out({ koInmates: 1 })), 'Pacifist: nothing thrown at anyone, nobody knocked out (followers included)');
check(!runOf('popular')(view({ recruits: 5, crew: 1 })) && runOf('popular')(view({ crew: 2 })), 'Popular: two followers at once (not one recruited twice)');
check(esc('ghost')(out({})) && !esc('ghost')(out({ spotted: 2 })) && !esc('ghost')(out({ partial: 1 })), 'Ghost: never spotted, the whole run');
check(esc('cleanRecord')(out({ spotted: 3 })) && !esc('cleanRecord')(out({ solitary: 1 })) && !esc('cleanRecord')(out({ caught: 1 })), 'Clean Record');
check(esc('dayOne')(out({}, 'fence', 1)) && !esc('dayOne')(out({}, 'fence', 2)), 'Day One');
check(esc('mole')(out({})) && !esc('mole')(out({}, 'roof')) && esc('castaway')(out({}, 'raft')) && esc('castaway')(out({}, 'helicopter')), 'ways out');

// An escape through the trophies: records first (the medal), then what it earned.
{
  // Out on day 2 (the ledger of a whole run, nothing done wrong): the escape screen's moment.
  const sim = new Sim(CENTER_PERKS, 9);
  const run = new Bot(CENTER_PERKS, 9);
  run.routineUntil(2, 9 * 60);
  sim.restore(run.sim.snapshot());
  sim.state.via = 2;
  trophies.startRun(sim, true);
  const rec = recordEscape('center-perks', 'tunnel', 2, 2000);
  check(rec.medal === 'gold' && rec.newMedal && rec.routeBest && rec.newRoute, 'a day-2 tunnel at Center Perks: gold, new');
  const got = trophies.escapeRun(rec).map((a) => a.id);
  console.log(`a day-2 tunnel escape earns: ${got.join(', ')}`);
  for (const id of ['freshAir', 'mole', 'quickStep', 'goldStandard', 'pacifist', 'ghost', 'cleanRecord', 'modelPrisoner', 'calm']) check(got.includes(id), `it earns ${id}`);
  check(!got.includes('dayOne') && !got.includes('grandTour') && !got.includes('houdini'), 'and not what it didn\'t do');
  check(readStats().escapes === 1, 'the escape counted');
  // The same save escaped from again (loaded, played out the same way): still one escape.
  trophies.startRun(sim, false);
  trophies.escapeRun(recordEscape('center-perks', 'tunnel', 2, 2000));
  check(readStats().escapes === 1, 'a save escaped from twice counts one escape');
  // Later, slower: the gold stays, nothing new.
  const slow = recordEscape('center-perks', 'tunnel', 9, 13000);
  check(slow.medal === null && !slow.newMedal && !slow.routeBest && recordOf('center-perks').byRoute.tunnel.medal === 'gold', 'a slower escape never takes the medal away');
  check(trophies.unlockedCosmetics().has('goggles') && !trophies.unlockedCosmetics().has('crown'), 'cosmetics follow what was earned');
  trophies.stopRun();
}

// Career: counts reached across games.
{
  const before = Object.keys(trophies.earnedTrophies());
  for (let k = 0; k < 9; k++) trophies.rumorHeard();
  check(!(('allEars' in trophies.earnedTrophies())), 'nine rumors: not yet');
  trophies.rumorHeard();
  check('allEars' in trophies.earnedTrophies(), 'All Ears at the tenth rumor');
  const career = trophies.careerOf();
  const prog = ACHIEVEMENTS.find((a) => a.id === 'grandTour')!.progress!(career);
  check(prog[0] === 1 && prog[1] === 5, 'Grand Tour: one prison of five');
  console.log(`career so far: ${Object.keys(trophies.earnedTrophies()).filter((k) => !before.includes(k)).join(', ')} newly; ${Object.keys(trophies.earnedTrophies()).length} earned in all; ${trophies.unseenTrophies().length} unseen`);
  trophies.markTrophiesSeen();
  check(trophies.unseenTrophies().length === 0, 'the shelf looked at: nothing new');
}

// Older records (version 1): migrated, and what they earned backfilled (never conduct).
{
  mem.clear();
  mem.set(KEYS.version, '1');
  mem.set(KEYS.escapes, JSON.stringify({ 'center-perks': { routes: ['roof'], bestDay: 3, bestMinute: 5000 }, 'stalag-flucht': { routes: ['fence', 'tunnel'], bestDay: 1, bestMinute: 900 } }));
  check(migrateStorage() === 2, 'records migrated to version 2');
  const cp = recordOf('center-perks');
  check(cp.byRoute.roof?.day === 3 && cp.byRoute.roof.medal === 'gold', 'one way out: its quickest is the prison\'s, its medal earned');
  check(Object.keys(recordOf('stalag-flucht').byRoute).length === 0, 'several ways out: which was quickest isn\'t made up');
  const got = trophies.syncCareer(false).map((a) => a.id);
  console.log(`backfilled from version-1 records: ${got.join(', ')}`);
  for (const id of ['freshAir', 'overTheTop', 'snip', 'mole', 'dayOne', 'quickStep', 'goldStandard']) check(got.includes(id), `backfill earns ${id}`);
  for (const id of ['pacifist', 'ghost', 'cleanRecord', 'houdini', 'grandTour']) check(!got.includes(id), `backfill never earns ${id}`);
}

// A game saved before the ledger: loads partial, its days unknown, and plays on counting.
{
  const sim = new Sim(CENTER_PERKS, 3);
  for (let k = 0; k < 30 * 20 * 60; k++) sim.step(0);
  const snap = JSON.parse(JSON.stringify(sim.snapshot()));
  delete snap.state.feats;
  delete snap.state.days;
  delete snap.state.mods;
  const old = new Sim(CENTER_PERKS, 1);
  old.restore(snap);
  check(old.state.feats[FEAT.partial] === 1 && old.state.days.length === 2 && old.state.days.every((d) => d === DAY.UNKNOWN), 'an older save loads partial, its days unknown');
  for (let k = 0; k < 200; k++) old.step(0);
  check(old.state.feats.length === FEATS.length, 'and keeps counting');
  console.log(`older save: partial, days ${old.state.days.join('/')}`);
}
console.log('achievements ok');
