/**
 * The paperwork escape (P36, docs/PLAN.md §11), through the real simulation:
 * - the data: every campaign guard's nickname, home town and team (A–Z, 5–7 letters, none twice
 *   in a prison); each prison's release desk (walked to at 10:00 with no key) and its doors out
 *   (the road reached through them once they're open, and only then, for the player alone);
 * - the form: in the strict guard's pockets (a new one at 08:00 once taken), forged with ink at
 *   Intellect 80; contraband, small;
 * - the tray: a forged form in hand at the desk; refused watched, hunted, after 22:00 (the records
 *   done) or with a name listed; the name on tomorrow's list, the form gone; a lockdown's day kept;
 * - the records at 22:00: passing with the heat low; found with the heat at 40 or after a
 *   lockdown that day (the sirens, the cell to be searched, the name struck);
 * - the release: called at 10:00, nothing to report before; turned away (contraband, heat: heat
 *   and the name lost); cleared (own clothes, the doors open, no alarm or trail on the way); the
 *   name not answered by 10:30; the doors holding for the player between them, shutting after;
 *   out on the road: route paperwork;
 * - saves with a name listed, from before P36, damaged numbers.
 */
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { itemDef, itemNumber } from '../src/content/items';
import { RECIPES } from '../src/content/recipes';
import { FORGE_INT, FREED_STEPS, RECORDS_HEAT, RELEASE_FAIL_HEAT } from '../src/content/paperwork';
import { command, OP, SLOT } from '../src/sim/command';
import { ESCAPES, Sim, type SimEvent } from '../src/sim/Sim';
import { loadState } from '../src/sim/state';
import { DAY_STEPS } from '../src/sim/systems/clock';
import { GUARD } from '../src/sim/systems/guards';
import { itemOf, pocketOf, slot } from '../src/sim/systems/items';
import { outOfBounds } from '../src/sim/systems/k9';
import { atRelease, atTray } from '../src/sim/systems/paperwork';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { TILE } from '../src/sim/world/tiles';
import { MAP_H, MAP_W, type World } from '../src/sim/world/World';
import { check } from './assert';

const at = (day: number, hour: number, minute = 0) => (day - 1) * DAY_STEPS + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
const of = <T extends SimEvent['type']>(seen: SimEvent[], type: T) => seen.filter((e) => e.type === type) as Array<Extract<SimEvent, { type: T }>>;
const news = (seen: SimEvent[], what: string) => of(seen, 'paper').filter((e) => e.what === what);
const refusals = (seen: SimEvent[]) => of(seen, 'refused').map((e) => e.why);
const n = itemNumber;
const put = (b: { x: number; z: number }, x: number, z: number) => {
  b.x = x * UNIT + UNIT / 2;
  b.z = z * UNIT + UNIT / 2;
};
const INTERACT = command(0, OP.INTERACT);

/** Ground tiles walkable from some tiles, as the world's doors are now. */
function reachFrom(w: World, from: number[]): Uint8Array {
  const seen = new Uint8Array(MAP_W * MAP_H);
  const queue = from.slice();
  for (const t of queue) seen[t] = 1;
  for (let k = 0; k < queue.length; k++) {
    const t = queue[k];
    const x = t % MAP_W;
    for (const [j, ok] of [
      [t - 1, x > 0],
      [t + 1, x < MAP_W - 1],
      [t - MAP_W, t >= MAP_W],
      [t + MAP_W, t < MAP_W * (MAP_H - 1)],
    ] as const)
      if (ok && !seen[j] && !w.ground.block[j]) (seen[j] = 1), queue.push(j);
  }
  return seen;
}
const roadIn = (w: World, seen: Uint8Array) => seen.some((v, i) => v && w.zoneAt(i % MAP_W, Math.floor(i / MAP_W)) === 'outside');

/** A game kept calm (lockdowns cleared each step unless asked), quiet days. */
function game(prison = CENTER_PERKS, seed = 5) {
  const sim = new Sim(prison, seed);
  sim.state.calendar = [[0, 0, 0]];
  const seen: SimEvent[] = [];
  let calm = true;
  const step = (cmd = 0) => {
    sim.step(cmd);
    seen.push(...sim.events);
    if (calm && sim.state.lockdown) {
      sim.state.lockdown = false;
      sim.state.heat = 0;
    }
  };
  const jump = (day: number, hour: number, minute = 0) => {
    if (Math.floor((at(day, hour, minute) - 1) / DAY_STEPS) !== Math.floor(sim.state.step / DAY_STEPS)) sim.state.eventFlags = 0;
    sim.state.step = at(day, hour, minute) - 1;
    sim.state.attended = true;
    sim.state.excused = true;
    step();
  };
  const to = (day: number, hour: number, minute = 0) => {
    const target = at(day, hour, minute);
    while (sim.state.step < target && !sim.state.escaped) step();
  };
  const r = prison.comms!.release;
  /** At the desk with a forged form in hand. */
  const toDesk = (form = true) => {
    put(sim.state.player, r.at[0].x, r.at[0].z);
    if (form) {
      sim.state.items.inv[0] = slot(n('forged_release'));
      sim.state.items.hand = 0;
    }
  };
  const setCalm = (on: boolean) => (calm = on);
  return { sim, seen, step, jump, to, toDesk, setCalm };
}

// ------------------------------------------------------------------ the data
{
  const lines: string[] = [];
  for (const p of PRISONS) {
    const sim = new Sim(p, 1);
    const w = sim.world;
    const all = p.guards.flatMap((g) => (g.about ? [g.about.nick, g.about.home, g.about.team] : []));
    check(p.guards.every((g) => !!g.about), `${p.id}: every guard has a nickname, a home town and a team`);
    check(all.every((x) => /^[A-Z]{5,7}$/.test(x)) && new Set(all).size === all.length, `${p.id}: each one word, A–Z, 5 to 7 letters, none twice`);
    // The form in the strict guard's pockets.
    const strict = p.guards.findIndex((g) => g.duties?.includes('shakedown'));
    const pockets = sim.state.items.containers[pocketOf(w, sim.state.inmates.length + strict)];
    check(strict >= 0 && pockets.some((v) => itemOf(v) === n('release_form')), `${p.id}: ${p.guards[strict]?.name} carries a blank release form`);
    // The desk: walked to at 10:00 with no key.
    const r = p.comms!.release;
    while (sim.clock.minuteOfDay !== 10 * 60 + 5) sim.step(0);
    w.setLockedCells(0n);
    w.setPlayerKeys(0);
    const c1 = p.cells[0];
    const home = reachFrom(w, [((c1[1] + c1[3]) >> 1) * MAP_W + ((c1[0] + c1[2]) >> 1)]);
    check(r.at.length > 0 && r.at.every((q) => home[q.z * MAP_W + q.x] === 1), `${p.id}: the release desk is walked to at 10:00 with no key`);
    check(r.gates.every((q) => w.ground.kind[q.z * MAP_W + q.x] === TILE.DOOR && !w.doorCell[q.z * MAP_W + q.x]), `${p.id}: the way out's doors are doors (no cell's)`);
    const from = r.at.map((q) => q.z * MAP_W + q.x);
    check(!roadIn(w, reachFrom(w, from)), `${p.id}: shut, the way out keeps the player in`);
    w.setFreed(true);
    check(roadIn(w, reachFrom(w, from)), `${p.id}: open, it leads out onto the road`);
    check(r.gates.every((q) => w.npcBlock[q.z * MAP_W + q.x] === 1 || !w.doorShut[q.z * MAP_W + q.x]), `${p.id}: open for the player alone`);
    w.setFreed(false);
    lines.push(`${p.id}: forms on ${p.guards[strict].name}; the desk at ${r.at.map((q) => `${q.x},${q.z}`).join(' ')}, out through ${r.gates.length} doors${r.bridge ? ' and the drawbridge' : ''}`);
  }
  console.log(lines.join('\n'));
}

// ------------------------------------------------------------------ the form
{
  const r = RECIPES.find((x) => x.result === 'forged_release');
  check(!!r && r.int === FORGE_INT && r.ingredients.join() === 'release_form,ink', 'a forged form: a blank one and ink, Intellect 80');
  check(itemDef(n('release_form')).contraband && itemDef(n('forged_release')).contraband && !!itemDef(n('forged_release')).small, 'both forms contraband (and small)');
  check(!itemDef(n('own_clothes')).contraband && itemDef(n('own_clothes')).cat === 'outfit', 'the player\'s own clothes: an outfit, legal');
  // Taken from him, a new one at 08:00.
  const g = game();
  const s = g.sim.state;
  const pockets = s.items.containers[pocketOf(g.sim.world, s.inmates.length + 2)];
  const k = pockets.findIndex((v) => itemOf(v) === n('release_form'));
  pockets[k] = 0;
  g.to(2, 8, 1);
  check(pockets.some((v) => itemOf(v) === n('release_form')), 'a blank form taken: Dunn has a new one at 08:00');
  console.log(`form: off ${CENTER_PERKS.guards[2].name}, forged with ink at Intellect ${FORGE_INT}`);
}

// ------------------------------------------------------------------ the tray
{
  const g = game();
  const { sim, seen } = g;
  const s = sim.state;
  g.jump(1, 18, 5);
  g.toDesk(false);
  g.step(INTERACT);
  check(!atTray(sim) && s.release[0] === 0, 'no form in hand: nothing to slip in');
  g.toDesk();
  s.guards[2].body.x = s.player.x + UNIT;
  s.guards[2].body.z = s.player.z;
  s.guards[2].body.facing = 9;
  g.step();
  if (s.seen) {
    g.step(INTERACT);
    check(refusals(seen).at(-1) === 'watched' && s.release[0] === 0, 'a guard watching: refused');
  }
  s.guards[2].body.x = 2 * UNIT;
  s.guards[2].body.z = 2 * UNIT;
  g.step();
  s.heat = 85;
  g.step(INTERACT);
  check(refusals(seen).at(-1) === 'hunted', 'wanted: refused');
  s.heat = 0;
  g.step();
  g.step(INTERACT);
  check(s.release[0] === 2 && news(seen, 'filed').at(-1)?.n === 2 && !itemOf(s.items.inv[0]), 'slipped in: the name on tomorrow\'s list, the form gone');
  g.toDesk();
  g.step(INTERACT);
  check(refusals(seen).at(-1) === 'onList', 'one name on the list is enough');
  // After 22:00 the night's records are done: the tray takes nothing till the morning (never a name the records never saw).
  const late = game();
  late.jump(1, 22, 1);
  late.toDesk();
  late.step(INTERACT);
  check(refusals(late.seen).at(-1) === 'trayLate' && late.sim.state.release[0] === 0, 'after 22:00: refused, the records already checked');
  late.jump(2, 3, 0);
  late.toDesk();
  late.step(INTERACT);
  check(refusals(late.seen).at(-1) === 'trayLate', 'and through the night');
  // A lockdown is remembered by its prison day (the records look twice at a name after one).
  late.sim.state.lockdown = true;
  late.setCalm(false);
  late.step();
  check(late.sim.state.release[2] === 2, 'a lockdown noted on its prison day (03:00 still belongs to prison day 2)');
}

// ------------------------------------------------------------------ the records at 22:00
{
  const filed = (heat: number) => {
    const g = game();
    g.jump(1, 18, 5);
    g.toDesk();
    g.step(INTERACT);
    // (Set just before the records: heat cools while nobody's looking.)
    g.to(1, 21, 59);
    g.sim.state.heat = heat;
    g.setCalm(false);
    return g;
  };
  {
    const g = filed(10);
    g.to(1, 22, 1);
    check(news(g.seen, 'passed').length === 1 && g.sim.state.release[0] === 2, 'heat low at 22:00: the form passes');
  }
  {
    const g = filed(RECORDS_HEAT);
    g.to(1, 22, 1);
    const s = g.sim.state;
    check(news(g.seen, 'found').length === 1 && s.release[0] === 0 && s.lockdown, `heat ${RECORDS_HEAT} at 22:00: the forgery found, the sirens`);
    check(s.guards.some((x) => x.tasks.includes(1) || x.resume === GUARD.SHAKEDOWN), 'the player\'s cell to be searched');
  }
  {
    const g = filed(0);
    // (A lockdown earlier that prison day, now over.)
    g.sim.state.release[2] = 1;
    g.to(1, 22, 1);
    check(news(g.seen, 'found').length === 1, 'a lockdown that day: found too');
  }
}

// ------------------------------------------------------------------ the release
{
  /** A game with the name on day 2's list (it passed the records). */
  const listed = () => {
    const g = game();
    g.jump(1, 18, 5);
    g.toDesk();
    g.step(INTERACT);
    g.to(1, 22, 1);
    return g;
  };
  const r = CENTER_PERKS.comms!.release;
  {
    const g = listed();
    const { sim, seen } = g;
    const s = sim.state;
    g.jump(2, 9, 50);
    put(s.player, r.at[0].x, r.at[0].z);
    g.step();
    check(!atRelease(sim), 'nothing to report before 10:00');
    g.to(2, 10, 1);
    check(news(seen, 'called').length === 1 && atRelease(sim), '10:00: the name called, the desk open');
    s.items.inv[1] = slot(n('screwdriver'));
    g.setCalm(false);
    const heat = s.heat;
    g.step(INTERACT);
    check(news(seen, 'turnedAway').at(-1)?.why === 'contraband' && s.heat === heat + RELEASE_FAIL_HEAT && s.release[0] === 0 && !atRelease(sim), 'contraband on them: turned away, heat, the name struck');
  }
  {
    const g = listed();
    const s = g.sim.state;
    g.jump(2, 10, 1);
    put(s.player, r.at[0].x, r.at[0].z);
    s.heat = 45;
    g.setCalm(false);
    g.step(INTERACT);
    check(news(g.seen, 'turnedAway').at(-1)?.why === 'heat', 'too hot: turned away');
  }
  {
    const g = listed();
    g.to(2, 10, 31);
    check(news(g.seen, 'missed').length === 1 && g.sim.state.release[0] === 0, 'not there by 10:30: the name comes off the list');
  }
  {
    const g = listed();
    const { sim, seen } = g;
    const s = sim.state;
    g.jump(2, 10, 1);
    put(s.player, r.at[0].x, r.at[0].z);
    g.step(INTERACT);
    check(news(seen, 'cleared').length === 1 && itemOf(s.items.inv[SLOT.OUTFIT]) === n('own_clothes') && sim.world.freed && s.release[1] > s.step, 'cleared: own clothes on, the doors open for the player');
    put(s.player, 31, 50);
    g.setCalm(false);
    g.step();
    check(!s.spotted && !outOfBounds(sim), 'no alarm, no trail on the way out');
    // Standing in a doorway past the minute: the door holds; out of it, the way shuts, the release over.
    put(s.player, 30, 45);
    for (let k = 0; k < FREED_STEPS; k++) g.step();
    check(sim.world.freed, 'never shut on the player standing in a doorway');
    put(s.player, 30, 42);
    g.step();
    check(!sim.world.freed && news(seen, 'shut').length === 1 && s.release[0] === 0 && news(seen, 'missed').length === 0, 'out of it: shut again, the release over');
  }
  {
    const g = listed();
    const s = g.sim.state;
    g.jump(2, 10, 1);
    put(s.player, r.at[0].x, r.at[0].z);
    g.step(INTERACT);
    let k = 0;
    while (!s.escaped && k++ < 3000) g.step(command(5));
    check(s.escaped > 0 && ESCAPES[s.via] === 'paperwork', `out on the road: by paperwork (${ESCAPES[s.via]})`);
  }
}

// ------------------------------------------------------------------ saves
{
  const g = game();
  const { sim } = g;
  const s = sim.state;
  g.jump(1, 18, 5);
  g.toDesk();
  g.step(INTERACT);
  const saved = JSON.parse(JSON.stringify(s));
  const back = new Sim(CENTER_PERKS, 5);
  back.state = loadState(back.world, CENTER_PERKS, saved);
  check(JSON.stringify(back.state) === JSON.stringify(s) && back.state.release[0] === 2, 'a save with the name listed loads as it was');
  for (let k = 0; k < 400; k++) {
    sim.step(0);
    back.step(0);
  }
  check(sim.hash() === back.hash(), 'and plays on the same');
  const old = JSON.parse(JSON.stringify(s));
  delete old.release;
  const o = new Sim(CENTER_PERKS, 5);
  o.state = loadState(o.world, CENTER_PERKS, old);
  check(o.state.release.join() === '0,0,0', 'a save from before P36: no name listed');
  const bad = JSON.parse(JSON.stringify(s));
  bad.release = [99, 1e12];
  const b = new Sim(CENTER_PERKS, 5);
  b.state = loadState(b.world, CENTER_PERKS, bad);
  check(b.state.release.join() === '0,0,0', 'damaged numbers load as none');
}
console.log('paperwork ok');
