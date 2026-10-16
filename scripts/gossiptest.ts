/**
 * Gossip is always true (P13; the playbook's "warnings proven never wrong"). In every prison,
 * over four seeds and three days of a model prisoner's life, every fact an inmate could tell
 * is collected every 15 game seconds and checked against the game itself:
 * - what's true now (a merchant's stock, an open job, a favor on offer, a grudge, the heat)
 *   against the state at that moment;
 * - the bed checks' times against the bed checks that actually happened;
 * - the rules' numbers by running the rules: the generator switched off until the power comes
 *   back, a tunnel dug past the bracing limit, guards knocked out until the takeover, a bed
 *   check of an empty cell with and without a bed dummy;
 * - each guard's ways (P15) by offering it a bribe; a lazy guard's naps against the naps
 *   that happened (where, from when); the next shakedown's cells against the shakedown;
 * and every phrasing of every fact, in English and French, says the fact's own numbers.
 * Zero false facts; the snapshot holds how many of each kind were checked.
 */
import { itemDef } from '../src/content/items';
import { PRISONS } from '../src/content/prisons';
import { TRAINING } from '../src/content/prisons/training';
import { ROUTINE } from '../src/content/routine';
import { enBarks, type BankId } from '../src/i18n/barks/en';
import { frBarks } from '../src/i18n/barks/fr';
import { placesOf } from '../src/sim/ai/places';
import type { Sim } from '../src/sim/Sim';
import { FAVOR_STATE, HOLDER, jobRooms } from '../src/sim/systems/economy';
import { itemOf, slot } from '../src/sim/systems/items';
import { report } from '../src/sim/systems/justice';
import { generatorsOf, switchPower, takeoverCheck } from '../src/sim/systems/power';
import { cavesIn } from '../src/sim/systems/structure';
import { traitOf } from '../src/sim/systems/guards';
import { bribe, lookAwayPrice } from '../src/sim/systems/ways';
import { BRIBE } from '../src/sim/command';
import { BRIBE_REPORT_HEAT, CAMERA_BLIND_STEPS, KO_STEPS, NAP_FROM, NAP_TO, OPINION_LOW, POTATO_STEPS, POWER_OFF_STEPS, SOLITARY_STEPS, STEPS_PER_MINUTE, STEPS_PER_SECOND, TOILET_LOADS, UNIT } from '../src/sim/tuning';
import { isGrate, isSea, TILE } from '../src/sim/world/tiles';
import { LAYER, MAP_H, MAP_W } from '../src/sim/world/World';
import { fill, type FillContext } from '../src/talk/fill';
import { facts, GOSSIP, napStop, type Fact } from '../src/talk/gossip';
import { Bot, n } from './bots';
import { check } from './assert';

const DAY = 1440 * STEPS_PER_MINUTE;
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const has = (sim: Sim, kind: number) => Array.from(sim.world.ground.base).includes(kind);

/** A fact about now holds in the state as it stands. */
function holdsNow(sim: Sim, f: Fact): boolean {
  const s = sim.state;
  switch (f.kind) {
    case 'stock': {
      const k = sim.prison.merchants.indexOf(s.inmates[f.inmate!].cell);
      return k >= 0 && s.shops[k].some((v) => v && itemDef(itemOf(v)).id === f.item);
    }
    case 'job':
      return jobRooms(sim.world).some((room, j) => room.def.zone === f.place && s.jobs[j] === HOLDER.NOBODY);
    case 'favor':
      return s.favors.some((x) => x.by === f.inmate && x.state === FAVOR_STATE.OFFERED);
    case 'grudge':
      return s.inmates[f.inmate!].opinion <= OPINION_LOW;
    case 'heat':
      return s.heat >= 50;
    case 'keyColor':
      return sim.prison.guards[f.guard!].key === f.color && !!sim.prison.guards[f.guard!].name;
    case 'steady':
    case 'strict':
    case 'corrupt':
      return traitOf(sim.prison.guards[f.guard!]) === f.kind;
    case 'lazy': {
      const g = sim.prison.guards[f.guard!];
      const at = napStop(g);
      return traitOf(g) === 'lazy' && !!at && sim.world.zoneAt(at.x, at.z) === f.place && f.t1 === NAP_FROM;
    }
    default:
      return true;
  }
}

/** Every phrasing of a fact, in both languages, fills and says the fact's numbers. */
function phrasings(sim: Sim, f: Fact): boolean {
  const bank = `go.${f.kind}` as BankId;
  for (const [lang, banks] of [['en', enBarks], ['fr', frBarks]] as const) {
    for (const l of banks[bank]) {
      const text = typeof l === 'string' ? l : l.t;
      const ctx: FillContext = { lang, sim, speaker: f.inmate === 0 ? 1 : 0, random: () => 0.5, recent: new Map(), fact: f, dayEvent: null };
      const out = fill(text, ctx);
      if (out === null) return false;
      if (f.n !== undefined && text.includes('{n}') && !out.includes(String(f.n))) return false;
      if (f.m !== undefined && text.includes('{m}') && !out.includes(String(f.m))) return false;
      for (const v of [f.t1, f.t2]) if (v !== undefined && /\{t[12]\}/.test(text) && !out.includes(hhmm(v))) return false;
    }
  }
  return true;
}

/** The rules behind the lasting facts, each run for real once per prison. */
function rules(prison: typeof TRAINING, list: Fact[]): string[] {
  const out: string[] = [];
  const find = (k: Fact['kind']) => list.find((f) => f.kind === k);
  // The generator off: the fence is dead for exactly as long as the fact says.
  const fence = find('fenceOff');
  if (fence) {
    const bot = new Bot(prison, 1);
    const sim = bot.sim;
    switchPower(sim, generatorsOf(sim.world)[0]);
    let steps = 0;
    while (!sim.powered('fence') && steps < 5000) {
      sim.step(0);
      steps++;
    }
    check(steps === fence.n! * STEPS_PER_SECOND, `${prison.id}: the fence is dead ${fence.n} s after the generator (${steps / STEPS_PER_SECOND} s)`);
    out.push(`fence dead ${steps / STEPS_PER_SECOND} s`);
  }
  // A tunnel: the bracing limit dug, then one more tile.
  const brace = find('brace');
  if (brace) {
    const bot = new Bot(prison, 1);
    const w = bot.sim.world;
    const under = w.layers[LAYER.UNDER].kind;
    // A row of plain earth (no boulders, no shaft above), nearest the roll call yard.
    const yard = placesOf(w).rollCall[0].tile;
    const rowAt = (start: number) => Array.from({ length: brace.n! + 1 }, (_, k) => start + k);
    const plain = (start: number) => start % MAP_W <= MAP_W - brace.n! - 2 && rowAt(start).every((i) => under[i] === TILE.SOIL && w.ground.kind[i] !== TILE.SHAFT);
    let best = -1;
    for (let i = 0; i < MAP_W * MAP_H; i++) if (plain(i) && (best < 0 || Math.abs(i - yard) < Math.abs(best - yard))) best = i;
    const row = rowAt(Math.max(0, best));
    const fits = best >= 0;
    check(fits, `${prison.id}: earth to dig a tunnel in`);
    if (fits) {
      for (let k = 0; k < brace.n!; k++) under[row[k]] = TILE.TUNNEL;
      const holds = !cavesIn(w, row[brace.n! - 1]);
      under[row[brace.n!]] = TILE.TUNNEL;
      const falls = cavesIn(w, row[brace.n!]);
      check(holds && falls, `${prison.id}: ${brace.n} tiles past a brace hold, one more caves in`);
      out.push(`tunnel holds ${brace.n} tiles`);
    }
  }
  // The takeover: guards knocked out one by one until the prison is the inmates' (every guard: "all of them").
  const take = find('takeover') ?? find('takeoverAll');
  if (take) {
    const all = take.kind === 'takeoverAll' ? take.n : take.m;
    const bot = new Bot(prison, 1);
    const s = bot.sim.state;
    let down = 0;
    while (!s.takeover && down < s.guards.length) {
      s.guards[down++].ko = 99999;
      takeoverCheck(bot.sim);
    }
    check(s.takeover && down === take.n && all === s.guards.length, `${prison.id}: the takeover comes with ${take.n} of ${all} guards out (${down})`);
    out.push(`takeover at ${down}/${s.guards.length}`);
  }
  // The bed check of an empty cell: passed with a dummy in the bed, failed without one.
  if (find('dummy')) {
    const bot = new Bot(prison, 1);
    bot.routineUntil(2, 20);
    const s = bot.sim.state;
    const yard = placesOf(bot.sim.world).rollCall[0].tile;
    s.player.x = (yard % MAP_W) * UNIT + UNIT / 2;
    s.player.z = Math.floor(yard / MAP_W) * UNIT + UNIT / 2;
    s.sleeping = false;
    const results: string[] = [];
    for (const dummy of [true, false]) {
      s.items.containers[bot.bed][0] = dummy ? slot(n('bed_dummy')) : 0;
      bot.sim.events = [];
      report(bot.sim, { kind: 'bedCheck', cell: 1 });
      const e = bot.sim.events.find((x) => x.type === 'bedCheck');
      results.push(e && e.type === 'bedCheck' ? e.result : 'none');
    }
    check(results[0] === 'pass' && results[1] === 'fail', `${prison.id}: away from the cell, a dummy passes the bed check (${results.join(', ')})`);
    out.push(`dummy ${results.join('/')}`);
  }
  // A guard's ways (P15): a bribe offered to each, as the fact says it goes.
  let bribes = 0;
  for (const f of list) {
    if (f.kind !== 'steady' && f.kind !== 'strict' && f.kind !== 'corrupt' && f.kind !== 'lazy') continue;
    const bot = new Bot(prison, 1);
    const s = bot.sim.state;
    s.cash = 500;
    bribe(bot.sim, f.guard!, BRIBE.LOOK);
    const g = s.guards[f.guard!];
    const ok =
      f.kind === 'corrupt'
        ? g.bribed > s.step && s.cash === 500 - lookAwayPrice(prison.difficulty)
        : f.kind === 'strict'
          ? s.heat === BRIBE_REPORT_HEAT && s.cash === 500 && !g.bribed
          : s.heat === 0 && s.cash === 500 && !g.bribed;
    check(ok, `${prison.id}: ${prison.guards[f.guard!].name} takes a bribe as told (${f.kind})`);
    bribes++;
  }
  if (bribes) out.push(`${bribes} bribe${bribes > 1 ? "s" : ""} as told`);
  // The rest: the numbers are the rules' own constants, the places and things are there.
  const bot = new Bot(prison, 1);
  const w = bot.sim.world;
  for (const f of list) {
    switch (f.kind) {
      case 'grate': {
        let ok = false;
        for (let i = 0; i < MAP_W * MAP_H && !ok; i++) ok = isGrate(w.layers[LAYER.VENTS].kind[i]) && w.zoneAt(i % MAP_W, Math.floor(i / MAP_W)) === f.place;
        check(ok, `${prison.id}: a grate over ${f.place}`);
        break;
      }
      case 'toilets':
        check(f.n === TOILET_LOADS, `${prison.id}: toilets take ${TOILET_LOADS} loads an hour`);
        break;
      case 'camera':
        check(f.n === CAMERA_BLIND_STEPS / STEPS_PER_SECOND && !!prison.cameras?.length, `${prison.id}: a taped camera is blind ${f.n} s`);
        break;
      case 'pouch':
        check(has(bot.sim, TILE.DETECTOR), `${prison.id}: detectors to get past`);
        break;
      case 'shell':
        check(has(bot.sim, TILE.REINFORCED), `${prison.id}: a reinforced shell`);
        break;
      case 'craters':
        check(has(bot.sim, TILE.MINE) && f.t1 === ROUTINE[0].start, `${prison.id}: mines re-laid at ${hhmm(f.t1!)}`);
        break;
      case 'flood':
        check(Array.from(w.ground.base).some((k) => isSea(k)), `${prison.id}: sea to flood a tunnel`);
        break;
      case 'heli':
        check(f.t1 === ROUTINE.find((r) => r.id === 'lightsOut')!.start && f.t2 === ROUTINE[0].start && !!prison.escapes?.includes('helicopter'), `${prison.id}: the helicopter's hours`);
        break;
      case 'solitary':
        check(f.n! * 60 * STEPS_PER_MINUTE === SOLITARY_STEPS && f.m! * STEPS_PER_MINUTE === POTATO_STEPS, `${prison.id}: solitary's hours and a potato's minutes`);
        break;
      case 'koTime':
        check(f.n! * STEPS_PER_SECOND === KO_STEPS, `${prison.id}: a knockout's seconds`);
        break;
    }
  }
  return out;
}

const kinds = new Map<string, number>();
for (const prison of [...PRISONS, TRAINING]) {
  const counted = new Map<string, number>();
  let wrong = 0;
  let badWords = 0;
  const lasting = facts(new Bot(prison, 1).sim);
  let naps = 0;
  let shakedowns = 0;
  for (const seed of [1, 2, 3, 4]) {
    const bot = new Bot(prison, seed);
    const sim = bot.sim;
    const checks: number[] = [];
    const end = 3 * DAY;
    const worded = new Set<string>();
    /** The cells the next shakedown was said to name, by its day. */
    const promised = new Map<number, Set<number>>();
    bot.keepRoutine(() => {
      for (const e of sim.events) {
        if (e.type === 'bedCheck' && e.result === 'start') checks.push(sim.clock.minuteOfDay);
        // A nap (P15): only a lazy guard, at its nap stop as told, between the hours told.
        if (e.type === 'nap' && e.on) {
          const g = sim.state.guards[e.guard];
          const fact = lasting.find((f) => f.kind === 'lazy' && f.guard === e.guard);
          const zone = sim.world.zoneAt(Math.floor(g.body.x / UNIT), Math.floor(g.body.z / UNIT));
          const m = sim.clock.minuteOfDay;
          if (!fact || zone !== fact.place || m < NAP_FROM || m >= NAP_TO) {
            wrong++;
            console.error(`FALSE NAP: ${prison.id} seed ${seed} guard ${e.guard} at ${hhmm(m)} in ${zone}`);
          }
          naps++;
        }
        // The shakedown names exactly the cells gossip said it would.
        if (e.type === 'shakedown') {
          const said = promised.get(sim.clock.day);
          if (said && [...said].sort().join() !== [...e.cells].sort().join()) {
            wrong++;
            console.error(`FALSE SHAKEDOWN: ${prison.id} seed ${seed} day ${sim.clock.day}: said ${[...said]}, searched ${e.cells}`);
          }
          if (said) shakedowns++;
        }
      }
      if (sim.state.step % 300 === 0) {
        for (const f of facts(sim)) {
          counted.set(f.kind, (counted.get(f.kind) ?? 0) + 1);
          if (f.kind === 'shakedown' || f.kind === 'shakedownYou') {
            const set = promised.get(f.n!) ?? new Set<number>();
            set.add(f.kind === 'shakedownYou' ? 1 : sim.state.inmates[f.inmate!].cell);
            promised.set(f.n!, set);
          }
          if (!holdsNow(sim, f)) {
            wrong++;
            if (wrong < 4) console.error(`FALSE: ${prison.id} seed ${seed} day ${sim.clock.day} ${hhmm(sim.clock.minuteOfDay)} ${JSON.stringify(f)}`);
          }
          if (!worded.has(f.key)) {
            worded.add(f.key);
            if (!phrasings(sim, f)) {
              badWords++;
              if (badWords < 4) console.error(`WORDS: ${prison.id} ${JSON.stringify(f)}`);
            }
          }
        }
      }
      return sim.state.step >= end;
    }, end + 10);
    const told = lasting.find((f) => f.kind === 'bedChecks');
    const seen = [...new Set(checks)].sort((a, b) => a - b);
    check(told ? seen.join() === [told.t1, told.t2].join() : seen.length === 0, `${prison.id} seed ${seed}: bed checks as told (${seen.map(hhmm).join(', ') || 'none'})`);
  }
  check(wrong === 0, `${prison.id}: every fact holds when it could be told (${wrong} false)`);
  check(badWords === 0, `${prison.id}: every phrasing says its fact (${badWords} wrong)`);
  const ran = rules(prison, lasting);
  for (const [k, v] of counted) kinds.set(k, (kinds.get(k) ?? 0) + v);
  console.log(`${prison.id}: ${lasting.length} lasting facts (${[...new Set(lasting.map((f) => f.kind))].join(', ')}); ${ran.join('; ') || 'no rules to run'}`);
  console.log(`  checked: ${[...counted].sort().map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  naps as told: ${naps}; shakedowns as told: ${shakedowns}`);
  if (lasting.some((f) => f.kind === 'lazy')) check(naps > 0, `${prison.id}: the lazy guard naps as told`);
}
check(GOSSIP.every((k) => kinds.has(k) || ['heat'].includes(k)), `every kind of gossip came up somewhere (${GOSSIP.filter((k) => !kinds.has(k)).join(', ') || 'all'})`);
