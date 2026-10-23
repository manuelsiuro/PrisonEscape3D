/**
 * The Daily Escape (P26): the Daily of each day (pure, the week's rhythm, the budget, never the
 * same prison twice running, a way out always left open), each twist's rule in the real sim,
 * the static kit check (every way out a twist leaves open still has its tools), the escape
 * bots on the hardest Daily of each prison (every twist there at once, but those that close
 * the bot's way out), saves and run logs under twists, and the history (tries, the best, the
 * streak, the strip, the check code) against an in-memory localStorage.
 */
import { check } from './assert';

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
};

const { dailyDate, dailyNumber, dailyOf, RHYTHM } = await import('../src/content/daily');
const { TWISTS, TWIST_IDS, twistOf } = await import('../src/content/twists');
const { PRISONS, escapesOf } = await import('../src/content/prisons');
const { CENTER_PERKS } = await import('../src/content/prisons/center-perks');
const { STALAG_FLUCHT } = await import('../src/content/prisons/stalag-flucht');
const { ITEMS, itemNumber } = await import('../src/content/items');
const { RECIPES } = await import('../src/content/recipes');
const { Sim, ESCAPES } = await import('../src/sim/Sim');
const { sightOf, dayPlan, quietCalendar } = await import('../src/sim/systems/calendar');
const { DAY_STEPS } = await import('../src/sim/systems/clock');
const { shakedownCells } = await import('../src/sim/systems/justice');
const { thorough } = await import('../src/sim/systems/delivery');
const { stirSteps } = await import('../src/sim/systems/guards');
const { DOING } = await import('../src/sim/systems/inmates');
const { exposed } = await import('../src/sim/systems/weather');
const { wageOf } = await import('../src/sim/systems/jobs');
const { bribe } = await import('../src/sim/systems/ways');
const { talkOp } = await import('../src/sim/systems/social');
const { dogsFrom } = await import('../src/sim/systems/k9');
const { setTile } = await import('../src/sim/systems/watch');
const { itemOf } = await import('../src/sim/systems/items');
const { containersOf } = await import('../src/sim/world/containers');
const { TILE, TILE_INFO } = await import('../src/sim/world/tiles');
const { LAYER, MAP_W, placeKey } = await import('../src/sim/world/World');
const { BRIBE, TALK } = await import('../src/sim/command');
const { STEPS_PER_MINUTE, UNIT } = await import('../src/sim/tuning');
const { RunRecorder, replayLog } = await import('../src/sim/runlog');
const { CARE_CASH, coolEvery, CRACKDOWN_CELLS, EAGLE_SIGHT, trickle } = await import('../src/sim/systems/twists');
const { HEAT_DECAY_STEPS } = await import('../src/sim/tuning');
const { bestStreak, checkCode, dailyEscape, dailyRecord, dailyTry, stripOf, streakOf, STRIP_EMOJI } = await import('../src/game/daily');
const { DAY } = await import('../src/sim/systems/ledger');
const { PLANS, quiet, runRoute } = await import('./escapes');
const { Bot } = await import('./bots');

const W = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ------------------------------------------------------------------ the Daily of each day
check(dailyNumber(new Date(2026, 9, 19, 0, 1)) === 0 && dailyNumber(new Date(2026, 9, 19, 23, 59)) === 0, 'Daily #1 is the whole of 19 October 2026, local time');
check(dailyNumber(new Date(2026, 9, 20, 0, 0)) === 1 && dailyNumber(new Date(2027, 0, 1, 12)) === 74, 'one a day after (#2 the next morning, #75 on New Year’s Day)');
check(dailyNumber(new Date(2027, 2, 29, 12)) - dailyNumber(new Date(2027, 2, 27, 12)) === 2, 'a clock change is still one day');
check(dailyDate(dailyNumber(new Date(2026, 11, 25, 9))).getUTCDate() === 25, 'a Daily’s date is its day');
console.log('the first four weeks:');
for (let n = 0; n < 28; n++) {
  const d = dailyOf(n);
  console.log(`  #${n + 1} ${W[d.weekday]} ${d.prison.id}: ${d.twists.join(', ')} (seed ${d.seed})`);
}
const YEARS = 3 * 365;
const tally = new Map<string, number>();
let sameTwice = 0;
let problems = 0;
for (let n = -7; n < YEARS; n++) {
  const d = dailyOf(n);
  const again = dailyOf(n);
  if (again.prison !== d.prison || again.seed !== d.seed || again.twists.join() !== d.twists.join()) problems++;
  const r = RHYTHM[d.weekday];
  const ts = d.twists.map((id) => twistOf(id)!);
  const spent = ts.reduce((a, t) => a + t.cost, 0);
  const budget = r.budget - (d.prison.difficulty >= 4 ? 1 : 0);
  const closed = new Set(ts.flatMap((t) => t.breaks ?? []));
  const ok =
    d.twists.length >= 1 &&
    d.twists.length <= r.twists &&
    d.prison.difficulty >= r.levels[0] &&
    d.prison.difficulty <= r.levels[1] &&
    spent <= budget &&
    ts.every((t) => !t.at || t.at(d.prison)) &&
    ts.every((t) => !t.not?.some((x) => d.twists.includes(x))) &&
    escapesOf(d.prison).some((route) => route !== 'parole' && !closed.has(route)) &&
    !(ts.length === 1 && ts[0].cost < 0) &&
    new Set(d.twists).size === d.twists.length &&
    d.seed > 0;
  if (!ok) {
    problems++;
    console.log(`  #${n + 1}: ${d.prison.id} ${d.twists.join(', ')} breaks the rules`);
  }
  if (dailyOf(n - 1).prison === d.prison) sameTwice++;
  if (n >= 0) {
    tally.set(d.prison.id, (tally.get(d.prison.id) ?? 0) + 1);
    for (const t of d.twists) tally.set(t, (tally.get(t) ?? 0) + 1);
    if (d.twists.length < r.twists) tally.set('short hand', (tally.get('short hand') ?? 0) + 1);
  }
}
check(problems === 0, 'every Daily is the same each time asked, keeps its weekday’s rhythm and budget, deals only twists that mean something there and never closes every way out');
check(sameTwice === 0, 'never the same prison two days running');
console.log(`over three years: ${PRISONS.map((p) => `${p.id} ${tally.get(p.id) ?? 0}`).join(', ')}`);
console.log(`  twists: ${TWIST_IDS.map((id) => `${id} ${tally.get(id) ?? 0}`).join(', ')}; days dealt fewer than their rhythm ${tally.get('short hand') ?? 0}`);
check(PRISONS.every((p) => (tally.get(p.id) ?? 0) > 50), 'every prison comes up');
check(TWIST_IDS.every((id) => (tally.get(id) ?? 0) > 20), 'every twist comes up');
check(TWISTS.length === TWIST_IDS.length && TWIST_IDS.every((id) => twistOf(id)?.id === id), 'every twist has its data');

// ------------------------------------------------------------------ each twist's rule
/** A game at Center Perks (quiet days), under these twists. */
const game = (mods: string[], def = CENTER_PERKS, seed = 7) => {
  const sim = new Sim(def, seed, mods);
  sim.state.calendar = quietCalendar();
  return sim;
};
const run = (sim: InstanceType<typeof Sim>, steps: number, each?: () => void) => {
  for (let k = 0; k < steps; k++) {
    sim.step(0);
    each?.();
  }
};
{
  const a = game([]);
  const b = game(['eagleEyes']);
  const g = 0;
  // (Indoors, where no weather caps it.)
  check(sightOf(b, b.state.guards[g]) - sightOf(a, a.state.guards[g]) === EAGLE_SIGHT * UNIT, `Eagle Eyes: guards see ${EAGLE_SIGHT} tiles further`);
}
check(coolEvery({ mods: ['shortFuse'] }) === 2 * HEAT_DECAY_STEPS && coolEvery({ mods: [] }) === HEAT_DECAY_STEPS, 'Short Fuse: heat cools at half the pace');
check(trickle({ mods: ['shortFuse'] }, 2) === 3 && trickle({ mods: ['shortFuse'] }, 5) === 8 && trickle({ mods: ['shortFuse'] }, 100) === 100 && trickle({ mods: [] }, 5) === 5, 'and what a guard’s eye adds trickles in half as fast again');
{
  const sim = game(['threeDays']);
  const events: string[] = [];
  run(sim, 3 * DAY_STEPS + 50, () => {
    for (const e of sim.events) if (e.type === 'timeUp') events.push(`step ${sim.state.step}`);
  });
  check(events.length === 1 && events[0] === `step ${3 * DAY_STEPS}` && sim.timeUp && sim.state.step === 3 * DAY_STEPS, 'Three Days: the run is over as day 4 begins (once, and nothing more happens)');
  check(!game([]).timeUp, '(no time limit in the campaign)');
}
{
  const sim = game(['closedShop']);
  run(sim, (10 * 60 - 8 * 60 + 5) * STEPS_PER_MINUTE);
  check(!sim.shopsOpen && sim.fixerOpen, 'Closed Shop: free time, the merchants shut (the fixer still deals)');
}
{
  const plain = shakedownCells(game([]).world, 99, 2).length;
  const tight = shakedownCells(game(['crackdown']).world, 99, 2, false, true).length;
  check(tight === plain + CRACKDOWN_CELLS, `Crackdown: the morning shakedown searches ${CRACKDOWN_CELLS} cells more (${plain} → ${tight})`);
}
{
  const checks = (mods: string[]) => {
    const sim = game(mods);
    let n = 0;
    run(sim, DAY_STEPS, () => (n += sim.events.filter((e) => e.type === 'bedCheck' && e.result === 'start').length));
    return n;
  };
  const plain = checks([]);
  const owl = checks(['nightOwl']);
  check(owl === plain + 2, `Night Owl: two bed checks more a night (${plain} → ${owl})`);
}
check(wageOf({ mods: ['unpaidLabour'] }, 40) === 0 && wageOf({ mods: [] }, 40) === 40, 'Unpaid Labour: a job pays nothing');
{
  const sim = game(['quickFix']);
  const t = 30 * MAP_W + 30;
  setTile(sim, LAYER.GROUND, t, TILE.HOLE);
  run(sim, DAY_STEPS);
  check(sim.world.ground.kind[t] === sim.world.ground.base[t], 'Quick Fix: a hole left in plain sight is mended at 08:00');
}
{
  // (Never the shaft under the player's own desk, nor what's dug at under it or in the tunnels: covered work stays.)
  const sim = game(['quickFix']);
  const desk = sim.world.props.find((p) => p.kind === 'desk' && sim.world.cellOf[p.z * MAP_W + p.x] === 1)!;
  const under = desk.z * MAP_W + desk.x;
  setTile(sim, LAYER.GROUND, under, TILE.SHAFT);
  const wall = sim.world.ground.kind.findIndex((k) => k === TILE.WALL);
  sim.state.wear[placeKey(LAYER.GROUND, under)] = 3;
  sim.state.wear[placeKey(LAYER.UNDER, under + 1)] = 3;
  sim.state.wear[placeKey(LAYER.GROUND, wall)] = 3;
  run(sim, DAY_STEPS + 40);
  check(sim.world.ground.kind[under] === TILE.SHAFT, 'Quick Fix: the shaft under the desk stays (covered work)');
  check(sim.state.wear[placeKey(LAYER.GROUND, under)] === 3 && sim.state.wear[placeKey(LAYER.UNDER, under + 1)] === 3 && !sim.state.wear[placeKey(LAYER.GROUND, wall)], '(the floor under the desk and the tunnels’ soil keep their wear; a wall chipped at heals)');
}
{
  const hot = (mods: string[]) => PRISONS.reduce((n, p) => n + Array.from({ length: 60 }, (_, k) => dayPlan(p.id, 3, k + 1, [], mods).weather).filter((w) => w === 'heatwave' || w === 'rain').length, 0);
  check(hot([]) > 0 && hot(['bigFreeze']) === 0, 'Big Freeze: no heatwave, no rain');
}
{
  const sim = game(['bigFreeze']);
  const yard = sim.world.ground.kind.findIndex((k, i) => TILE_INFO[k].outdoor && TILE_INFO[k].walk !== false && sim.world.zoneAt(i % MAP_W, Math.floor(i / MAP_W)) === 'yard');
  sim.state.player.x = (yard % MAP_W) * UNIT + UNIT / 2;
  sim.state.player.z = Math.floor(yard / MAP_W) * UNIT + UNIT / 2;
  const plain = game([]);
  plain.state.player.x = sim.state.player.x;
  plain.state.player.z = sim.state.player.z;
  check(exposed(sim) && !exposed(plain), 'Big Freeze: out in the yard without a warm outfit, the cold bites (at Center Perks)');
}
{
  const sim = game(['badBlood']);
  check(sim.state.inmates.every((m) => m.opinion <= 40) && sim.state.inmates.some((m) => m.opinion <= 20), 'Bad Blood: grudges from day 1');
  const plain = game([]);
  check(plain.state.rng === sim.state.rng && plain.state.cash === sim.state.cash, '(and nothing else dealt differently)');
}
{
  const sim = game(['carePackage']);
  const plain = game([]);
  const desk = containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'desk');
  const box = sim.state.items.containers[desk];
  const kit = box.slice(-3).map((v) => ITEMS[itemOf(v) - 1]?.id ?? '?');
  console.log(`care package: ${kit.join(', ')}, $${sim.state.cash - plain.state.cash}`);
  check(box.slice(-3).every((v) => v) && box.slice(0, 6).every((v) => !v) && sim.state.cash - plain.state.cash === CARE_CASH, 'Care Package: three things in the desk (not its hidden compartment) and some cash');
  check(plain.state.rng === sim.state.rng, '(drawn without the RNG: everything else as it would be)');
}
{
  const plan = (mods: string[]) => Array.from({ length: 6 }, (_, k) => dayPlan(CENTER_PERKS.id, 5, k + 1, [], mods).weather).join(' ');
  check(plan(['fogDays']).startsWith('clear') && plan(['fogDays']).split(' ').slice(1).every((w) => w === 'fog'), 'Fog Days: fog every day after the first');
  check(plan(['storm']).split(' ').slice(1).every((w) => w === 'storm'), 'Storm: a storm every day after the first');
  const deliveries = (mods: string[]) => Array.from({ length: 28 }, (_, k) => dayPlan(CENTER_PERKS.id, 5, k + 1, [], mods).event).filter((e) => e === 'delivery').length;
  check(deliveries([]) === 4 && deliveries(['truckStrike']) === 0, 'Truck Strike: no delivery all month (4 as a rule)');
}
{
  const { SHANKTON } = await import('../src/content/prisons/shankton');
  check(dogsFrom({ mods: ['dogDay'] }) === 1 && dogsFrom({ mods: [] }) === 2, 'Dog Day: the dogs work from day 1');
  const sim = new Sim(SHANKTON, 3, ['dogDay']);
  const counters = containersOf(sim.world).flatMap((c, i) => (c.table === 'canteenCounter' ? [sim.state.items.containers[i]] : []));
  check(counters.some((box) => box.some((v) => itemOf(v) === itemNumber('jerky'))), '(their treats on the counters from the first morning)');
}
check(stirSteps({ mods: ['lightSleepers'] }) * 2 === stirSteps({ mods: [] }), 'Light Sleepers: a dozing guard wakes to the player at its elbow in half the time');
{
  const sim = game(['straightLaced']);
  const k = CENTER_PERKS.guards.findIndex((g) => g.trait === 'corrupt');
  sim.state.heat = 30;
  sim.state.cash = 500;
  bribe(sim, k, BRIBE.PAPER);
  check(sim.events.some((e) => e.type === 'refused' && e.why === 'honest') && sim.state.heat === 30, 'Straight-Laced: the corrupt guard turns a bribe down');
}
{
  const sim = game(['customs']);
  check(Array.from({ length: 30 }, (_, k) => thorough(sim, k + 1)).every(Boolean), 'Customs: every delivery searched thoroughly');
}
{
  const sim = game(['loneWolf']);
  const m = sim.state.inmates[0];
  m.opinion = 100;
  sim.state.player.x = m.body.x + UNIT / 2;
  sim.state.player.z = m.body.z;
  sim.state.talk = 0;
  sim.events = [];
  talkOp(sim, TALK.RECRUIT, 0);
  check(sim.events.some((e) => e.type === 'refused' && e.why === 'loneWolf') && !sim.state.followers.length, 'Lone Wolf: not even a friend signs up');
}
{
  const asleep = (mods: string[]) => {
    const sim = game(mods);
    run(sim, (24 * 60 - 8 * 60 + 60) * STEPS_PER_MINUTE);
    return sim.state.guards.filter((g) => g.doing === DOING.SLEEP).length;
  };
  const plain = asleep([]);
  check(plain > 0 && asleep(['doubleShift']) === 0, `Double Shift: at 01:00 nobody's in bed (${plain} as a rule)`);
}

// ------------------------------------------------------------------ saves and logs under twists
{
  const sim = new Sim(STALAG_FLUCHT, 12, ['eagleEyes', 'nightOwl']);
  const rec = new RunRecorder(sim, { seed: 12, game: '2.0.0' });
  for (let k = 0; k < 2 * 60 * STEPS_PER_MINUTE; k++) rec.step(k % 200 < 100 ? 1 : 0);
  const log = rec.toLog();
  check(log.mods?.join() === 'eagleEyes,nightOwl', 'a Daily’s run log keeps its twists');
  const back = replayLog(log, STALAG_FLUCHT);
  check(!!back?.ok && back.sim.state.mods.join() === 'eagleEyes,nightOwl', 'and plays back under them, every checksum met');
  const loaded = new Sim(STALAG_FLUCHT, 1);
  loaded.restore(JSON.parse(JSON.stringify(sim.snapshot())));
  check(loaded.state.mods.join() === 'eagleEyes,nightOwl' && loaded.hash() === sim.hash(), 'a Daily saved and loaded keeps its twists');
}

// ------------------------------------------------------------------ the static kit check
/** What each way out can't do without (any one of each group). */
const NEEDS: Record<string, string[][]> = {
  fence: [['flimsy_cutters', 'light_cutters', 'sturdy_cutters']],
  tunnel: [['flimsy_shovel', 'light_shovel', 'sturdy_shovel']],
  roof: [['grapnel', 'grappling_hook'], ['screwdriver', 'nail_file', 'powered_screwdriver', 'multitool']],
  takeover: [],
  gate: [['plastic_key_yellow'], ['plastic_key_red'], ['plastic_key_green']],
  raft: [['raft'], ['flimsy_cutters', 'light_cutters', 'sturdy_cutters']],
  helicopter: [['grapnel', 'grappling_hook'], ['molten_chocolate']],
  stowaway: [],
  bluff: [['fake_id'], ['guard_outfit']],
  glider: [['glider']],
  paperwork: [['forged_release']],
};
const choices = (ing: string) => ing.split('|');
function obtainable(closed: readonly string[]): Set<string> {
  const have = new Set(ITEMS.filter((d) => d.from.some((f) => !closed.includes(f))).map((d) => d.id));
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of RECIPES)
      if (!have.has(r.result) && r.ingredients.every((i) => choices(i).some((c) => have.has(c)))) {
        have.add(r.result);
        changed = true;
      }
  }
  return have;
}
for (const t of TWISTS) {
  const have = obtainable(t.closes ?? []);
  for (const [route, groups] of Object.entries(NEEDS)) {
    if (t.breaks?.includes(route as never)) continue;
    check(groups.every((g) => g.some((id) => have.has(id))), `${t.id} leaves ${route} open: its tools can still be had`);
  }
}
console.log(`kit check: ${TWISTS.filter((t) => t.closes).map((t) => `${t.id} closes ${t.closes!.join(', ')}: ${ITEMS.filter((d) => !obtainable(t.closes!).has(d.id)).map((d) => d.id).join(', ')} out of reach`).join('; ')}`);

// ------------------------------------------------------------------ the hardest Daily of each prison
/** The bots' names for the routes. */
const VIA: Record<string, string> = { cutout: 'fence', rooftop: 'roof' };
console.log('the escape bots, every twist of their prison at once (but those closing their way out):');
quiet.on = true;
for (const p of PLANS) {
  for (const r of p.routes ?? (['cutout', 'tunnel', 'rooftop', 'takeover'] as const)) {
    const via = VIA[r] ?? r;
    const mods = TWISTS.filter((t) => (!t.at || t.at(p.def)) && !t.breaks?.includes(via as never)).map((t) => t.id);
    Bot.mods = mods;
    // (A dog about on the first day would smell the stowaway's kit: in a pouch, as a player would carry it.)
    const plan = mods.includes('dogDay') && p.stowKit && !p.stowKit.includes('pouch') ? { ...p, stowKit: [...p.stowKit, 'pouch'] } : p;
    const log = console.log;
    const err = console.error;
    console.log = () => {};
    console.error = () => {};
    const bot = runRoute(plan, r);
    console.log = log;
    console.error = err;
    const out = !!bot?.done && ESCAPES[bot.st.via] === via;
    console.log(`  ${p.def.id} ${via}: ${out ? `out ${bot!.time}` : 'STILL INSIDE'} under ${mods.length} twists${((left) => (left ? ` (all but ${left})` : ' (all there are)'))(TWISTS.filter((t) => (!t.at || t.at(p.def)) && !mods.includes(t.id)).map((t) => t.id).join(', '))}`);
    check(out, `${p.def.id}: the ${via} still wins on its hardest Daily`);
  }
}
Bot.mods = [];
quiet.on = false;

// ------------------------------------------------------------------ the history
check(dailyRecord(3).tries === 0 && streakOf(3) === 0, 'nothing played yet');
dailyTry(3);
dailyTry(3);
const strip = stripOf([0, DAY.SPOTTED, DAY.WANTED | DAY.SPOTTED, DAY.CAUGHT, DAY.ESCAPED | DAY.SPOTTED]);
check(strip.join() === '0,1,2,3,4', 'the day strip: quiet, spotted, hot, caught, out');
console.log(`a day strip: ${strip.map((k) => STRIP_EMOJI[k]).join('')}`);
const code = checkCode(3, 'tunnel', 1500, 2, 'abcd1234');
check(/^[0-9A-F]{6}$/.test(code) && code === checkCode(3, 'tunnel', 1500, 2, 'abcd1234') && code !== checkCode(3, 'tunnel', 1501, 2, 'abcd1234'), `a check code (${code}): short, the same for the same escape, another for another`);
let e = dailyEscape(3, { prison: 'center-perks', day: 2, minutes: 1500, via: 'tunnel', strip, code });
check(e.best && e.medal === 'gold' && e.record.best?.tries === 2, 'the first escape is the best (on the second try: gold)');
e = dailyEscape(3, { prison: 'center-perks', day: 4, minutes: 4000, via: 'fence', strip, code });
check(!e.best && dailyRecord(3).best?.minutes === 1500, 'a slower one keeps the best');
check(streakOf(3) === 1 && streakOf(4) === 1 && streakOf(5) === 0, 'the streak: one, still one the day after (today’s still to play), gone the day after that');
dailyTry(4);
dailyEscape(4, { prison: 'shankton', day: 5, minutes: 6500, via: 'fence', strip, code });
dailyTry(6);
dailyEscape(6, { prison: 'irongate', day: 3, minutes: 3000, via: 'bluff', strip, code });
check(streakOf(6) === 1 && streakOf(4) === 2 && bestStreak() === 2, 'a day missed starts the streak again; the best is kept');
mem.set('pe3d.daily', JSON.stringify({ x: 1, 7: { tries: 'lots', best: { day: 'one' } }, 8: null }));
check(dailyRecord(7).tries === 0 && !dailyRecord(7).best && streakOf(8) === 0, 'a damaged history reads as nothing played');
