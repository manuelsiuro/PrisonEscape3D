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
import { pocketOf } from '../src/sim/systems/items';
import { RECORDS_HEAT, RECORDS_MINUTE } from '../src/content/paperwork';
import { LINE_DAY } from '../src/content/phone';
import { wantsCall } from '../src/sim/systems/phone';
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
import { dayMinute, planOf, today } from '../src/sim/systems/calendar';
import { searchMinute, thorough } from '../src/sim/systems/delivery';
import { dogDef, FOR_DOGS, handlersOf, onShift, pillsDesk } from '../src/sim/systems/k9';
import { RAT_ROOMS, trapChance } from '../src/sim/systems/rats';
import { floorOf } from '../src/sim/ai/places';
import { TRAP_KITCHEN, TRAP_MINUTE, TRAP_TUNNEL } from '../src/sim/tuning';
import { containersOf } from '../src/sim/world/containers';
import { fixerOf, visitExits } from '../src/sim/systems/smuggling';
import { elderOf } from '../src/sim/systems/checkers';
import { lockAt } from '../src/sim/systems/games';
import { DICE_HEAT } from '../src/content/games';
import { Bot, n } from './bots';
import { SHIFT_FROM, SHIFT_TO } from '../src/content/getaways';
import { RECIPES } from '../src/content/recipes';
import { CATALOGUE } from '../src/content/smuggling';
import { airOf, checkpointOf, launchSpots, shiftChange } from '../src/sim/systems/getaway';
import { glideFrom } from '../src/sim/systems/structure';
import { prisonDay } from '../src/sim/systems/clock';
import { command, OP } from '../src/sim/command';
import { ESCAPES, Sim as SimOf } from '../src/sim/Sim';
import { raceNight, rivals } from '../src/sim/systems/races';
import { RACE_MINUTE } from '../src/content/long';
import { dealsOf, pinTaken } from '../src/sim/systems/oddjobs';
import { check } from './assert';

const DAY = 1440 * STEPS_PER_MINUTE;
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const has = (sim: Sim, kind: number) => Array.from(sim.world.ground.base).includes(kind);

/**
 * Today's wind carries a glider out (P24): flown for real, from a copy of the game, off the first
 * edge the ladder's roof reaches where it would (cached by the day).
 */
const glideProof = new Map<string, boolean>();
let glidesFlown = 0;
function glidesOut(sim: Sim): boolean {
  const key = `${sim.prison.id}:${sim.state.salt}:${prisonDay(sim.state.step)}`;
  const known = glideProof.get(key);
  if (known !== undefined) return known;
  const snap = sim.snapshot();
  const twin = new SimOf(sim.prison, 1);
  let ok = false;
  for (const [t, facing] of launchSpots(sim.world)) {
    twin.restore(snap);
    const s = twin.state;
    const b = { x: (t % MAP_W) * UNIT + UNIT / 2, z: Math.floor(t / MAP_W) * UNIT + UNIT / 2, facing, moving: false };
    const g = glideFrom(twin.world, b, airOf(twin));
    if (!g || g.why || !g.out) continue;
    s.layer = LAYER.ROOF;
    Object.assign(s.player, b);
    s.items.inv[0] = slot(n('glider'));
    s.items.hand = 0;
    twin.step(command(0, OP.USE, 1));
    ok = s.escaped > 0 && ESCAPES[s.via] === 'glider';
    glidesFlown++;
    break;
  }
  glideProof.set(key, ok);
  return ok;
}

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
    // The day (P17): what the plan says of tomorrow, and of tonight's storm.
    case 'nextInspection':
    case 'nextDrill':
    case 'nextFoodFight':
    case 'nextDelivery':
    case 'nextVisiting':
    case 'nextSports':
    case 'nextTalent':
    case 'nextQuiz':
      return f.n === today(sim).day + 1 && planOf(sim, f.n!).event === ({ nextInspection: 'inspection', nextDrill: 'drill', nextFoodFight: 'foodFight', nextDelivery: 'delivery', nextVisiting: 'visiting', nextSports: 'sports', nextTalent: 'talent', nextQuiz: 'quiz' } as const)[f.kind];
    // Side games (P22): nobody's arm is stronger; the dice's heat is the rule's (gamestest proves it); the lockpick never opens a gate.
    case 'champ':
      return s.inmates.every((m) => m.str <= s.inmates[f.inmate!].str);
    // The crew (P23): the line of work is the inmate's own (the prison's data).
    case 'lookout':
    case 'digger':
    case 'muscle':
    case 'smuggler':
      return sim.prison.crew[s.inmates[f.inmate!].cell - 2] === f.kind;
    // Card sharks (P27): the old-timer is the prison's own.
    case 'oldTimer':
      return f.inmate === elderOf(sim);
    case 'gambling':
      return f.n === DICE_HEAT && !sim.prison.rules?.relaxed;
    case 'lockpick': {
      for (let i = 0; i < MAP_W * MAP_H; i++) if (sim.world.gate[i] && lockAt(sim.world, i) === 'lock') return false;
      return true;
    }
    // Smuggling (P21): the fixer is the one the rules sell phones from; the drone drops and the arches stand where it's said (smuggletest proves the rules).
    case 'fixer':
      return f.inmate === fixerOf(sim) && sim.prison.merchants.includes(s.inmates[f.inmate!].cell);
    case 'droneDrop': {
      const r = sim.prison.smuggling?.drop;
      return !!r && sim.world.zoneAt((r[0] + r[2]) >> 1, (r[1] + r[3]) >> 1) === f.place;
    }
    case 'visitArches': {
      const r = sim.prison.smuggling?.visits;
      return !!r && visitExits(sim.world).size > 0 && sim.world.zoneAt((r[0] + r[2]) >> 1, (r[1] + r[3]) >> 1) === f.place;
    }
    // Delivery day (P18): the search still to come, as thorough as said, by its supervisor.
    case 'searchClose':
    case 'searchQuick': {
      const p = today(sim);
      return p.event === 'delivery' && dayMinute(s.step) < searchMinute(p) && f.guard === sim.prison.delivery?.supervisor && thorough(sim, p.day) === (f.kind === 'searchClose');
    }
    case 'stormCut': {
      const p = today(sim);
      const m = (f.t1! - ROUTINE[0].start + 1440) % 1440;
      return p.weather === 'storm' && p.outages.includes(m) && m > dayMinute(s.step);
    }
    // Guard dogs (P19): today's sleeping pills, still in that inmate's desk.
    case 'pills': {
      const desk = pillsDesk(sim);
      const prop = desk >= 0 ? containersOf(sim.world)[desk].prop : null;
      return !!prop && sim.world.cellOf[prop.z * MAP_W + prop.x] === s.inmates[f.inmate!].cell && s.items.containers[desk].some((v) => itemOf(v) === n('sleeping_pills'));
    }
    // A dog's hours, by asking the rule itself at the minute either side of each end (on day 2, no lockdown).
    case 'dogShift':
    case 'dogNight': {
      const def = dogDef(sim.world, f.dog!);
      if (f.kind === 'dogShift' && handlersOf(sim.world)[f.dog!] !== f.guard) return false;
      if (f.kind === 'dogNight' && !def.night) return false;
      const was = { step: s.step, lockdown: s.lockdown };
      s.lockdown = false;
      const at = (m: number) => {
        s.step = DAY + ((m - ROUTINE[0].start + 1440) % 1440) * STEPS_PER_MINUTE;
        return onShift(sim, def);
      };
      const ok = !at(f.t1! - 1) && at(f.t1!) && at(f.t2! - 1) && !at(f.t2!);
      Object.assign(s, was);
      return ok;
    }
    // What works on a dog: there's a dog, and the item it takes (the rules themselves: k9test).
    case 'dogTreat':
      return s.dogs.length > 0 && FOR_DOGS.has(n('jerky'));
    case 'dogPepper':
      return s.dogs.length > 0 && FOR_DOGS.has(n('pepper'));
    case 'dogWash':
      return s.dogs.length > 0;
    // The pet rat (P20): traps catch at 04:00 where rats come (kitchens, canteens, storerooms; tunnels nearly always), dogs go after rats (rattest proves the rules).
    case 'ratTrap':
      return TRAP_MINUTE === 240 && TRAP_KITCHEN > 0 && floorOf(sim.world, RAT_ROOMS).some((t) => trapChance(sim.world, LAYER.GROUND, t) === TRAP_KITCHEN);
    case 'ratTunnel':
      return TRAP_TUNNEL > TRAP_KITCHEN && TRAP_TUNNEL >= 80;
    case 'ratKey':
      return !sim.prison.rules?.relaxed;
    case 'ratDogs':
      return s.dogs.length > 0;
    // Bluff & glider (P24): the gate's shift change at the minutes the rule opens and closes it; a fake ID's recipe off the phone's card; a glider that gets out today, flown.
    case 'shiftChange': {
      const at = (m: number) => shiftChange(((m - ROUTINE[0].start + 1440) % 1440) * STEPS_PER_MINUTE);
      return !!checkpointOf(sim) && f.t1 === SHIFT_FROM && f.t2 === SHIFT_TO && !at(f.t1! - 1) && at(f.t1!) && at(f.t2! - 1) && !at(f.t2!);
    }
    case 'fakeId': {
      const r = RECIPES.find((x) => x.result === 'fake_id');
      return !!checkpointOf(sim) && !!sim.prison.smuggling && !!r && [...r.ingredients].sort().join() === 'blank_id,ink,magazine' && CATALOGUE.some((c) => c.item === 'blank_id');
    }
    case 'glideDay':
      return glidesOut(sim);
    // Long games (P28): a toilet's tank and a desk's hidden drawer are never searched (justice.ts: the standard drawers and the bed), the dogs smell furniture;
    // a shaft in a planted bed never shows; the race nights at the minute the rule starts them; whose rat ate, as tonight's card has it.
    case 'pruno':
      return !sim.prison.rules?.relaxed && sim.prison.guards.some((g) => g.duties?.includes('shakedown'));
    case 'gardenHole':
      return !!sim.prison.leisure?.garden;
    case 'raceNight':
      return !!sim.prison.leisure?.race && f.t1 === RACE_MINUTE;
    case 'ratFed':
    case 'ratHungry': {
      const day = prisonDay(s.step);
      const e = rivals(s, day).find((x) => x.owner === f.inmate);
      return raceNight(day) && !!e && e.fed === (f.kind === 'ratFed') && dayMinute(s.step) < RACE_MINUTE - ROUTINE[0].start;
    }
    // The pay phone (P34): the inmate wants a call today at that minute (the queue's own draw), from LINE_DAY.
    case 'phoneCall': {
      const day = prisonDay(s.step);
      const at = (f.t1! - ROUTINE[0].start + 1440) % 1440;
      return !!sim.prison.comms && day >= LINE_DAY && s.phoned[6] > 0 && [0, 1].some((b) => wantsCall(s.salt, day, b, f.inmate!) === at);
    }
    // The paperwork escape (P36): the blank forms in that guard's pockets; the records' hour and heat as the rule has them; a guard's words its own.
    case 'releaseForms':
      return s.items.containers[pocketOf(sim.world, s.inmates.length + f.guard!)].some((v) => itemOf(v) === n('release_form')) && !!sim.prison.guards[f.guard!].duties?.includes('shakedown');
    case 'recordsCheck':
      return f.t1 === (RECORDS_MINUTE + ROUTINE[0].start) % 1440 && f.n === RECORDS_HEAT && !!sim.prison.comms;
    case 'guardNick':
    case 'guardHome':
    case 'guardTeam':
      return !!sim.prison.guards[f.guard!]?.about;
    // The odd jobs board (P40): one of today's pins still up is his.
    case 'boardJob':
      return dealsOf(sim, prisonDay(s.step)).some((d, k) => d.giver === f.inmate && !pinTaken(s, k));
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
    // (P34: in the last run the phone has been used, so inmates queue and say who rings when.)
    if (seed === 4) sim.state.phoned[6] = 1;
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
console.log(`a glider's day: flown out from a copy ${glidesFlown} times`);
check(GOSSIP.every((k) => kinds.has(k) || ['heat'].includes(k)), `every kind of gossip came up somewhere (${GOSSIP.filter((k) => !kinds.has(k)).join(', ') || 'all'})`);
