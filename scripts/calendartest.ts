/**
 * The day (P17): the plan for each prison day is pure and the same for every caller, day 1 is
 * always quiet and clear, every week deals each of the prison's event cards once, the weather
 * keeps to its climate, forced days win (an exact day over every day). Then each event and
 * weather does what the warden says, through the real simulation (a model prisoner keeping the
 * routine): the inspection's sharper eyes, bigger shakedown and commendation; the drill's muster
 * (made, and missed); the feast's tray; the generator's service; movie night in the canteen and
 * its soundtrack; the food fight's guards and free blows; a storm's power cuts and blind
 * snipers; fog and rain on the guards' eyes (the cones drawn are the sight); a heatwave's sun and
 * the shower that cools it. A game saved mid-event plays on the same; an old save's today is quiet.
 */
import { DAY_BOOKS, DAY_EVENTS, DRILL_HEAT, COMMENDATION, FEAST_ENERGY, MUSTER_MINUTES, WEATHERS, type DayEvent, type Weather } from '../src/content/days';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { PRISONS } from '../src/content/prisons';
import { SAN_PANCHO } from '../src/content/prisons/san-pancho';
import { STALAG_FLUCHT } from '../src/content/prisons/stalag-flucht';
import { IRONGATE } from '../src/content/prisons/irongate';
import { canSee } from '../src/sim/ai/sight';
import { floorOf, placesOf } from '../src/sim/ai/places';
import { command, OP, SLOT } from '../src/sim/command';
import { Sim, type SimEvent, type Snapshot } from '../src/sim/Sim';
import { dayMinute, dayPlan, eventOn, muffled, planOf, prisonDay, quietCalendar, sightOf, TODAY, today, weatherNow } from '../src/sim/systems/calendar';
import { maxHealth } from '../src/sim/systems/combat';
import { GUARD } from '../src/sim/systems/guards';
import { slot } from '../src/sim/systems/items';
import { snipersOnDuty } from '../src/sim/systems/power';
import { MEAL_STEPS, STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { TILE_INFO } from '../src/sim/world/tiles';
import { LAYER, MAP_W } from '../src/sim/world/World';
import { check } from './assert';
import { FEAT } from '../src/sim/systems/ledger';
import { ACHIEVEMENTS } from '../src/content/achievements';
import { Bot, n } from './bots';

const E = (id: DayEvent) => DAY_EVENTS.indexOf(id);
const W = (id: Weather) => WEATHERS.indexOf(id);
const hhmm = (dayMin: number) => {
  const m = (dayMin + 8 * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// ------------------------------------------------------------------ the plans
{
  const SALTS = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => new Sim(CENTER_PERKS, k).state.salt);
  let quietOne = true;
  let dealt = true;
  for (const p of PRISONS) {
    const book = DAY_BOOKS[p.id];
    const counts = new Array(WEATHERS.length).fill(0);
    const events = new Array(DAY_EVENTS.length).fill(0);
    let kept = 0;
    let days = 0;
    for (const salt of SALTS) {
      const one = dayPlan(p.id, salt, 1);
      if (one.event !== 'none' || one.weather !== 'clear' || one.outages.length) quietOne = false;
      let was = '';
      for (let d = 2; d <= 121; d++) {
        const plan = dayPlan(p.id, salt, d);
        counts[W(plan.weather)]++;
        events[E(plan.event)]++;
        if (plan.weather === was) kept++;
        was = plan.weather;
        days++;
        check(JSON.stringify(plan) === JSON.stringify(dayPlan(p.id, salt, d)), `${p.id} day ${d}: the same plan every time`);
        if (plan.event !== 'none') check(plan.at >= 0 && plan.until > plan.at && plan.until <= 1440, `${p.id} day ${d}: the ${plan.event} has its times`);
        check(plan.outages.length === (plan.weather === 'storm' && book ? plan.outages.length : 0) && (plan.weather !== 'storm' || !book || (plan.outages.length >= 2 && plan.outages.length <= 3)), `${p.id} day ${d}: a storm cuts the power 2–3 times (and only a storm)`);
        for (let k = 1; k < plan.outages.length; k++) check(plan.outages[k] - plan.outages[k - 1] >= 50, `${p.id} day ${d}: a storm's power cuts never overlap`);
      }
      // Each week deals the deck once.
      if (book) {
        for (let wk = 0; wk < 4; wk++) {
          const week = Array.from({ length: book.deck.length }, (_, k) => dayPlan(p.id, salt, 2 + wk * book.deck.length + k).event).sort().join();
          if (week !== [...book.deck].sort().join()) dealt = false;
        }
      }
    }
    if (!book) {
      check(counts[0] === days && events[0] === days, `${p.id}: no day book, every day quiet and clear`);
      console.log(`${p.id}: always quiet`);
      continue;
    }
    const pct = (k: number, of: number[]) => `${Math.round((100 * of[k]) / days)}%`;
    console.log(`${p.id}: ${WEATHERS.map((w, k) => (counts[k] ? `${w} ${pct(k, counts)}` : '')).filter(Boolean).join(', ')}; kept ${Math.round((100 * kept) / days)}%; ${DAY_EVENTS.map((e, k) => (events[k] ? `${e} ${pct(k, events)}` : '')).filter(Boolean).join(', ')}`);
    book.climate.weights.forEach((wt, k) => check(wt > 0 || counts[k] === 0, `${p.id}: never ${WEATHERS[k]} (not its climate)`));
  }
  check(quietOne, 'day 1 is quiet and clear everywhere (the escape bots run on it)');
  check(dealt, 'every week deals each event card once');
  // Forcing: an exact day over every day; -1 keeps what's drawn.
  const salt = SALTS[0];
  const forced = dayPlan('center-perks', salt, 3, [[0, E('feast'), W('rain')], [3, E('drill'), -1]]);
  check(forced.event === 'drill' && forced.weather === 'rain', 'a forced day: the exact day wins, -1 keeps the rest');
  check(dayPlan('center-perks', salt, 5, quietCalendar()).event === 'none' && dayPlan('center-perks', salt, 5, quietCalendar()).weather === 'clear', 'the quiet calendar: nothing on');
  check(dayPlan('center-perks', salt, 1, [[1, E('movie'), W('fog')]]).event === 'movie', 'day 1 can be forced (bots, the Daily)');
  check(dayPlan('center-perks', salt, 4, [], ['fogDays']).weather === 'fog', "the Daily's fog twist (dormant until P26)");
  // The day's clock: 08:00 to 08:00.
  check(prisonDay(0) === 1 && prisonDay(1440 * STEPS_PER_MINUTE - 1) === 1 && prisonDay(1440 * STEPS_PER_MINUTE) === 2, 'a prison day runs from 08:00 to 08:00');
  check(dayMinute(16 * 60 * STEPS_PER_MINUTE) === 960 && hhmm(960) === '00:00', 'minutes into the day count from 08:00');
}

// ------------------------------------------------------------------ helpers

/** A model prisoner on Center Perks, every day forced; the events seen from the start. */
function botFor(event: DayEvent, weather: Weather = 'clear', seed = 5, prison = CENTER_PERKS) {
  const bot = new Bot(prison, seed);
  bot.st.calendar = [[0, 0, 0], [2, E(event), W(weather)]];
  const seen: SimEvent[] = [];
  const until = (day: number, minute: number) => {
    const target = ((day - 1) * 1440 + minute - 8 * 60) * STEPS_PER_MINUTE;
    bot.keepRoutine(() => {
      seen.push(...bot.sim.events);
      return bot.st.step >= target;
    }, Math.max(0, target - bot.st.step) + 1);
  };
  /** Until a minute into prison day 2 (0 is its 08:00). */
  const into = (dayMin: number) => until(2, 8 * 60 + dayMin);
  return { bot, seen, until, into, plan: () => planOf(bot.sim, 2) };
}

const isOutdoor = (sim: Sim, t: number) => TILE_INFO[sim.world.ground.kind[t]].outdoor;
/** A free outdoor tile and a free indoor one (the canteen's). */
function tiles(sim: Sim) {
  const open = floorOf(sim.world, ['yard']).find((t) => isOutdoor(sim, t))!;
  const inside = floorOf(sim.world, ['canteen']).find((t) => !isOutdoor(sim, t))!;
  return { open, inside };
}
/** A guard's sight (tiles) standing on a tile (put back where it was after). */
function sightAt(sim: Sim, tile: number): number {
  const g = sim.state.guards[0];
  const { x, z } = g.body;
  g.body.x = (tile % MAP_W) * UNIT + UNIT / 2;
  g.body.z = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
  const r = sightOf(sim, g) / UNIT;
  g.body.x = x;
  g.body.z = z;
  return r;
}
const put = (sim: Sim, tile: number) => {
  sim.state.player.x = (tile % MAP_W) * UNIT + UNIT / 2;
  sim.state.player.z = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
};
/** Saved now and loaded into a new game: both play the same steps and end the same. */
function resumesSame(bot: Bot, steps: number): boolean {
  const twin = new Sim(bot.sim.prison, 99);
  twin.restore(JSON.parse(JSON.stringify(bot.sim.snapshot())) as Snapshot);
  for (let k = 0; k < steps; k++) {
    bot.step(0);
    twin.step(0);
  }
  return twin.hash() === bot.sim.hash();
}

// ------------------------------------------------------------------ inspection
{
  const { bot, seen, until, plan } = botFor('inspection');
  const sim = bot.sim;
  const { open, inside } = tiles(sim);
  until(2, 8 * 60 + 5);
  const shake = seen.filter((e): e is Extract<SimEvent, { type: 'shakedown' }> => e.type === 'shakedown');
  const usual = botFor('none');
  usual.until(2, 8 * 60 + 5);
  const plain = usual.seen.find((e): e is Extract<SimEvent, { type: 'shakedown' }> => e.type === 'shakedown');
  check(shake.length === 1 && shake[0].cells.length === 4 && !!plain && plain.cells.length < 4 && plain.cells.every((c, k) => shake[0].cells[k] === c), `an inspection morning's shakedown names 4 cells, the usual ones first (${plain?.cells.join(', ')} → ${shake[0]?.cells.join(', ')})`);
  const before = sightAt(sim, inside);
  until(2, 10 * 60 + 30);
  const during = [sightAt(sim, inside), sightAt(sim, open)];
  check(before === 7 && during[0] === 8 && during[1] === 8, `the inspectors in: guards see 8 tiles (before: ${before}; indoors ${during[0]}, outdoors ${during[1]})`);
  const cash = bot.st.cash;
  until(2, 16 * 60 + 1);
  const commend = seen.filter((e) => e.type === 'today' && e.phase === 'commend').length;
  const start = seen.find((e) => e.type === 'today' && e.event === 'inspection' && e.phase === 'start');
  console.log(`inspection ${hhmm(plan().at)}–${hhmm(plan().until)}: shakedown ${shake[0].cells.join(', ')}; sight 7 → ${during[0]}; the model prisoner commended: +$${bot.st.cash - cash}`);
  check(!!start && commend === 1 && bot.st.cash - cash === COMMENDATION && (bot.st.eventFlags & TODAY.COMMENDED) !== 0, 'a clean inspection day: a commendation, $25');
  check(bot.st.feats[FEAT.commended] === 1, 'the ledger counts the commendation (Teacher\'s Pet)');
  check(sightAt(sim, inside) === 7, 'the inspectors gone: 7 tiles again');
  // Contraband in sight during an inspection: twice the heat. A guard looking straight at the player.
  const b2 = botFor('inspection');
  b2.until(2, 11 * 60);
  const heatRate = (b: Bot) => {
    const st = b.st;
    const g = st.guards.find((x) => x.mode === GUARD.DUTY && x.ko <= 0 && x.doze <= 0)!;
    // The player just in front of it, holding a shiv.
    const gx = Math.floor(g.body.x / UNIT);
    const gz = Math.floor(g.body.z / UNIT);
    st.items.inv[0] = slot(n('flimsy_cutters'));
    st.items.hand = 0;
    st.items.rev++;
    let best = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const t = (gz + dz) * MAP_W + gx + dx;
      if (TILE_INFO[b.sim.world.ground.kind[t]].solid) continue;
      st.heat = 0;
      put(b.sim, t);
      b.sim.step(0);
      best = Math.max(best, st.heat);
    }
    return best;
  };
  const doubled = heatRate(b2.bot);
  const b3 = botFor('none');
  b3.until(2, 11 * 60);
  const single = heatRate(b3.bot);
  console.log(`contraband in sight: +${single} a step, +${doubled} during an inspection`);
  check(single > 0 && doubled === 2 * single, 'contraband in sight: twice the heat while the inspectors are in');
  // Seen at something: no commendation.
  const b4 = botFor('inspection');
  b4.until(2, 11 * 60);
  b4.bot.st.eventFlags |= TODAY.BLOT;
  b4.until(2, 16 * 60 + 1);
  check(!b4.seen.some((e) => e.type === 'today' && e.phase === 'commend'), 'a blot on the day: no commendation');
}

// ------------------------------------------------------------------ the fire drill
{
  const { bot, seen, until, plan } = botFor('drill', 'clear', 6);
  const at = plan().at;
  until(2, (at + 8 * 60 + 10) % 1440);
  const sim = bot.sim;
  check(sim.dutyZones.includes('rollCall'), 'the drill: roll call is where to be');
  until(2, (at + 8 * 60 + MUSTER_MINUTES) % 1440);
  const out = sim.state.inmates.filter((m) => sim.world.zoneAt(Math.floor(m.body.x / UNIT), Math.floor(m.body.z / UNIT)) === 'rollCall').length;
  until(2, (at + 8 * 60 + MUSTER_MINUTES + 1) % 1440);
  const mustered = seen.some((e) => e.type === 'today' && e.phase === 'muster');
  console.log(`fire drill at ${hhmm(at)}: ${out}/${sim.state.inmates.length} inmates out at roll call as the muster closes; the model prisoner mustered ${mustered ? 'in time' : 'late'}, heat ${bot.st.heat}%`);
  check(out === sim.state.inmates.length, 'the drill empties the buildings: everyone out at roll call');
  check(mustered && !seen.some((e) => e.type === 'today' && e.phase === 'missed') && bot.st.heat === 0, 'mustered in time: no heat');
  check(bot.st.feats[FEAT.mustered] === 1, 'the ledger counts the muster (Present and Correct)');
  until(2, (at + 8 * 60 + 21) % 1440);
  check(seen.some((e) => e.type === 'today' && e.event === 'drill' && e.phase === 'end') && !sim.dutyZones.includes('rollCall'), 'the drill over: back to the routine');
  // Staying put in the cell: +40 heat when the muster closes.
  const b2 = botFor('drill', 'clear', 6);
  b2.until(2, (at + 8 * 60 - 1) % 1440);
  const h0 = b2.bot.st.heat;
  for (let k = 0; k < (MUSTER_MINUTES + 2) * STEPS_PER_MINUTE; k++) {
    b2.bot.step(0);
    b2.seen.push(...b2.bot.sim.events);
  }
  check(b2.seen.some((e) => e.type === 'today' && e.phase === 'missed') && b2.bot.st.heat - h0 >= DRILL_HEAT - 1, `missing the drill: +${b2.bot.st.heat - h0}% heat`);
  check(b2.bot.st.feats[FEAT.drillsMissed] === 1, 'the ledger counts the drill missed (Drill Dodger)');
  // Saved mid-drill: plays on the same.
  const b3 = botFor('drill', 'clear', 6);
  b3.until(2, (at + 8 * 60 + 5) % 1440);
  check(resumesSame(b3.bot, 30 * STEPS_PER_MINUTE), 'saved and loaded mid-drill: the same game');
}

// ------------------------------------------------------------------ the feast
{
  const { bot, seen, until } = botFor('feast');
  until(2, 17 * 60 + 20);
  const sim = bot.sim;
  const places = placesOf(sim.world);
  const spot = places.seats.find((s) => !bot.st.inmates.some((m) => m.goal === s.tile))!;
  put(sim, spot.tile);
  bot.st.player.facing = spot.face;
  bot.st.energy = 20;
  bot.st.health = 30;
  bot.act();
  const e0 = bot.st.energy;
  bot.until(() => bot.st.eaten >= MEAL_STEPS, MEAL_STEPS + 2);
  const meal = bot.st.energy - e0;
  check(seen.some((e) => e.type === 'today' && e.event === 'feast' && e.phase === 'start'), 'the feast starts with dinner');
  check(meal >= FEAST_ENERGY && bot.st.health === maxHealth(bot.st.str) && (bot.st.eventFlags & TODAY.FEASTED) !== 0, `a feast's tray: +${meal} energy, health full`);
  console.log(`feast: the tray +${meal} energy, health ${bot.st.health}`);
  check(bot.st.feats[FEAT.feasts] === 1, 'the ledger counts the feast (Seconds, Please)');
}

// ------------------------------------------------------------------ the generator's service
{
  const { seen, until } = botFor('maintenance');
  until(2, 13 * 60 + 46);
  const power = seen.filter((e): e is Extract<SimEvent, { type: 'power' }> => e.type === 'power');
  const off = power.find((e) => !e.on);
  check(!!off && off.by === 'maintenance' && power.some((e) => e.on), `the service: the power off at 13:00 and back by 13:45 (${power.map((e) => `${e.on ? 'on' : 'off'} by ${e.by}`).join(', ')})`);
}

// ------------------------------------------------------------------ movie night
{
  const { bot, seen, until } = botFor('movie');
  until(2, 19 * 60 + 40);
  const sim = bot.sim;
  const inCanteen = sim.state.inmates.filter((m) => sim.world.zoneAt(Math.floor(m.body.x / UNIT), Math.floor(m.body.z / UNIT)) === 'canteen').length;
  const { open, inside } = tiles(sim);
  const muffle = muffled(sim, LAYER.GROUND, inside, 6);
  const yard = muffled(sim, LAYER.GROUND, open, 6);
  console.log(`movie night: ${inCanteen}/${sim.state.inmates.length} inmates in the canteen; a chip in there carries ${muffle} tiles (6 elsewhere: ${yard})`);
  check(eventOn(sim, 'movie') && seen.some((e) => e.type === 'today' && e.event === 'movie'), 'movie night is on');
  check(inCanteen >= Math.ceil(sim.state.inmates.length * 0.6), 'movie night: most inmates in the canteen');
  check(muffle < 6 && yard === 6, "the film's soundtrack drowns a noise in the canteen");
}

// ------------------------------------------------------------------ the food fight
{
  const { bot, seen, until, plan } = botFor('foodFight', 'clear', 7);
  const at = plan().at;
  until(2, (at + 8 * 60 + 2) % 1440);
  const sim = bot.sim;
  const mid = floorOf(sim.world, ['canteen']);
  const drawn = sim.state.guards.filter((g) => g.mode === GUARD.INVESTIGATE && mid.includes(g.target)).length;
  check(seen.some((e) => e.type === 'today' && e.event === 'foodFight' && e.phase === 'start') && drawn >= 2, `the food fight at ${hhmm(at)}: ${drawn} guards drawn into the canteen`);
  // A blow at an inmate in the canteen, right in front of a guard drawn in: no heat.
  const st = bot.st;
  const inCanteen = (b: { x: number; z: number }) => sim.world.zoneAt(Math.floor(b.x / UNIT), Math.floor(b.z / UNIT)) === 'canteen';
  bot.until(() => st.guards.some((g) => g.mode === GUARD.INVESTIGATE && inCanteen(g.body) && !g.path.length), 900);
  const b0 = st.feats[FEAT.blows];
  const g = st.guards.find((x) => x.mode === GUARD.INVESTIGATE && inCanteen(x.body) && !x.path.length);
  const free = (t: number) => !TILE_INFO[sim.world.ground.kind[t]].solid && !sim.world.propSolid[t] && sim.world.zoneAt(t % MAP_W, Math.floor(t / MAP_W)) === 'canteen';
  let heat = -1;
  let watched = 0;
  const m = st.inmates.find((x) => inCanteen(x.body) && x.ko === 0);
  if (g && m) {
    const near = st.inmates.indexOf(m);
    const gt = Math.floor(g.body.z / UNIT) * MAP_W + Math.floor(g.body.x / UNIT);
    // Two tiles from the guard (any side: it looks around), the inmate a tile further.
    const pick = [1, -1, MAP_W, -MAP_W].map((d) => [gt + 2 * d, gt + 3 * d]).find(([a, b]) => free(a) && free(b));
    if (pick) {
      put(sim, pick[0]);
      m.body.x = (pick[1] % MAP_W) * UNIT + UNIT / 2;
      m.body.z = Math.floor(pick[1] / MAP_W) * UNIT + UNIT / 2;
      st.items.inv[SLOT.WEAPON] = slot(n('sock_mace'));
      bot.op(OP.LOCK, 2 + near);
      const h0 = st.heat;
      for (let k = 0; k < 200 && !watched; k++) {
        bot.step(command(0, OP.USE, k % 20 === 0 ? 1 : 0));
        if (sim.events.some((e) => e.type === 'hit' && e.who === near) && g.sees) watched++;
      }
      heat = st.heat - h0;
    }
  }
  console.log(`food fight: ${watched ? 'a blow at an inmate under a guard\'s eyes' : 'no blow seen'}, heat +${heat}`);
  check(watched > 0, 'a guard saw the blow');
  check(heat === 0, 'blows at inmates in a food fight cost no heat');
  check(st.feats[FEAT.foodBlows] >= 1 && st.feats[FEAT.foodBlows] === st.feats[FEAT.blows] - b0, `the ledger counts blows in a food fight (${st.feats[FEAT.foodBlows]})`);
}

// ------------------------------------------------------------------ weather: fog, rain, storm
{
  const { bot, until } = botFor('none', 'fog');
  const sim = bot.sim;
  const { open, inside } = tiles(sim);
  until(2, 8 * 60 + 30);
  const morning = [sightAt(sim, open), sightAt(sim, inside), snipersOnDuty(sim) ? 1 : 0];
  until(2, 13 * 60);
  const noon = [sightAt(sim, open), snipersOnDuty(sim) ? 1 : 0];
  until(2, 20 * 60);
  const evening = sightAt(sim, open);
  console.log(`fog: outdoors ${morning[0]} tiles at 08:30, ${noon[0]} at 13:00, ${evening} at 20:00; indoors ${morning[1]}`);
  check(morning[0] === 4 && morning[1] === 7 && evening === 4 && noon[0] === 7, 'fog: guards out in it see 4 tiles while it lies thick (morning, night); indoors 7');
  check(morning[2] === 0 && noon[1] === 1, "fog: the snipers can't see through it (they're back once it lifts)");
  check(weatherNow(sim) === 'fog', 'the weather now: fog');
  // The cones drawn are the sight.
  const r = botFor('none', 'rain');
  r.until(2, 12 * 60);
  const rain = [sightAt(r.bot.sim, open), muffled(r.bot.sim, LAYER.GROUND, open, 10), muffled(r.bot.sim, LAYER.GROUND, inside, 10)];
  check(rain[0] === 6 && rain[1] === 6 && rain[2] === 10, `rain: 6 tiles of sight out in it, noise carries 60% (${rain.join(', ')})`);
  const s = botFor('none', 'storm', 8);
  s.until(2, 12 * 60);
  const storm = [sightAt(s.bot.sim, open), muffled(s.bot.sim, LAYER.GROUND, open, 10), snipersOnDuty(s.bot.sim) ? 1 : 0];
  check(storm[0] === 5 && storm[1] === 4 && storm[2] === 0, `a storm: 5 tiles of sight out in it, noise 40%, the snipers stand down (${storm.join(', ')})`);
  const cuts = s.plan().outages;
  s.until(3, 7 * 60 + 59);
  const offs = s.seen.filter((e) => e.type === 'power' && !e.on && e.by === 'storm').length;
  console.log(`storm: power cuts at ${cuts.map(hhmm).join(', ')}; ${offs} went off`);
  check(offs === cuts.length, "a storm's power cuts in the night, each when the plan says");
  check(today(s.bot.sim).day === 2 && planOf(s.bot.sim, 3).weather === 'clear', 'the storm passes with the day');
  // A storm at Irongate cuts both halves (both generators).
  const ig = botFor('none', 'storm', 4, IRONGATE);
  ig.into(ig.plan().outages[0] + 1);
  const halves = ig.seen.filter((e) => e.type === 'power' && !e.on && e.by === 'storm').map((e) => (e as { gen?: number }).gen).sort().join();
  check(halves === '0,1', `Irongate: a storm's power cut takes both generators (${halves})`);
  // The sight in fog is the rule: an outdoor guard really sees the player 3 tiles ahead and not 5 (the cone is drawn sightOf long).
  const fog = botFor('none', 'fog');
  fog.until(2, 8 * 60 + 30);
  const fs = fog.bot.sim;
  const g = fs.state.guards[0];
  const yard = floorOf(fs.world, ['yard']).filter((t) => isOutdoor(fs, t));
  let shown = '';
  for (const t of yard) {
    const x = t % MAP_W;
    const z = Math.floor(t / MAP_W);
    const row = [0, 1, 2, 3, 4, 5].every((k) => yard.includes(z * MAP_W + x + k));
    if (!row) continue;
    g.body.x = x * UNIT + UNIT / 2;
    g.body.z = z * UNIT + UNIT / 2;
    g.body.facing = 1;
    const sees = (k: number) => canSee(fs.world, g.body, { x: (x + k) * UNIT + UNIT / 2, z: z * UNIT + UNIT / 2 }, sightOf(fs, g));
    shown = `${sees(3)}/${sees(5)}`;
    break;
  }
  check(shown === 'true/false', `fog: an outdoor guard sees 3 tiles ahead and not 5 (${shown})`);
}

// ------------------------------------------------------------------ the heatwave
{
  const { bot, seen, until } = botFor('none', 'heatwave', 5, SAN_PANCHO);
  until(2, 15 * 60 + 5);
  const sim = bot.sim;
  const { open } = tiles(sim);
  put(sim, open);
  for (let k = 0; k < 62 * STEPS_PER_MINUTE && !bot.st.frozen; k++) {
    bot.step(0);
    seen.push(...sim.events);
  }
  const baked = seen.some((e) => e.type === 'cold' && e.on && e.hot);
  check(baked && bot.st.frozen, 'a heatwave: a minute out in the sun bakes the player (energy costs double)');
  check(bot.st.feats[FEAT.baked] === 1, 'the ledger counts it (Sunstroke)');
  until(2, 16 * 60 + 5);
  const head = placesOf(sim.world).showers[0];
  put(sim, head.tile);
  for (let k = 0; k < 5; k++) bot.step(0);
  check(!bot.st.frozen && bot.st.cold === 0, 'a shower cools them at once');
  console.log(`heatwave: baked at ${bot.time.slice(-5)}; cooled under a shower`);
  // Stalag Flucht's cold is as it was (never a heatwave there).
  const cold = botFor('none', 'clear', 5, STALAG_FLUCHT);
  cold.until(2, 12 * 60);
  check(!cold.bot.st.frozen || !cold.seen.some((e) => e.type === 'cold' && e.hot), "Stalag Flucht's cold is the cold");
}

// ------------------------------------------------------------------ saves
{
  // A save from before the day: today stays quiet whatever was drawn.
  const sim = new Sim(CENTER_PERKS, 3);
  for (let k = 0; k < 1440 * STEPS_PER_MINUTE + 100; k++) sim.step(0);
  const snap = JSON.parse(JSON.stringify(sim.snapshot())) as Snapshot;
  delete (snap.state as Partial<typeof snap.state>).calendar;
  delete (snap.state as Partial<typeof snap.state>).eventFlags;
  const old = new Sim(CENTER_PERKS, 1);
  old.restore(snap);
  check(old.state.calendar.length === 1 && old.state.calendar[0][0] === 2 && today(old).event === 'none' && today(old).weather === 'clear', "an old save's today is quiet");
  check(planOf(old, 3).event === planOf(sim, 3).event, 'and tomorrow is as drawn');
  // Every event saved and loaded mid-way plays on the same.
  for (const ev of ['inspection', 'maintenance', 'movie', 'foodFight'] as const) {
    const b = botFor(ev, 'storm', 4);
    const p = b.plan();
    b.until(2, (p.at + 8 * 60 + 3) % 1440);
    check(resumesSame(b.bot, 20 * STEPS_PER_MINUTE), `saved and loaded mid-${ev}: the same game`);
  }
  const night = botFor('none', 'storm', 4);
  night.into(night.plan().outages[0] + 2);
  check(resumesSame(night.bot, 50 * STEPS_PER_MINUTE), "saved and loaded in a storm's power cut: the same game");
}


// ------------------------------------------------------------------ the day's achievements
{
  const run = { prison: 'center-perks', feats: new Array(60).fill(0), days: [], str: 40, spd: 40, int: 40 };
  const esc = (weather?: string) => ACHIEVEMENTS.filter((a) => a.escape?.({ ...run, via: 'fence', day: 4, medal: null, weather })).map((a) => a.id);
  check(esc('storm').includes('stormRunner') && !esc('clear').includes('stormRunner') && !esc().includes('stormRunner'), 'Storm Runner: an escape in a storm (never from the records, which keep no weather)');
  check(esc('fog').includes('peaSouper') && !esc('rain').includes('peaSouper'), 'Pea Souper: an escape while the fog lies thick');
  const earns = (feat: string, n: number) => ACHIEVEMENTS.filter((a) => a.run?.({ ...run, feats: run.feats.map((_, k) => (k === FEAT[feat as keyof typeof FEAT] ? n : 0)) })).map((a) => a.id);
  check(earns('foodBlows', 2).every((id) => id !== 'foodFighter') && earns('foodBlows', 3).includes('foodFighter'), 'Food Fighter: three blows in a food fight');
  check(earns('commended', 1).includes('teachersPet') && earns('mustered', 1).includes('present') && earns('feasts', 1).includes('seconds') && earns('baked', 1).includes('sunstroke') && earns('drillsMissed', 1).includes('drillDodger'), 'the day\'s other achievements, each from its counter');
}

// ------------------------------------------------------------------ the review's edge cases
{
  // A block missed before the inspectors arrive (breakfast, settled at 10:00) is no blot; one missed while they're in (exercise, settled at 16:00) is.
  const idle = (b: ReturnType<typeof botFor>, minutes: number) => {
    for (let k = 0; k < minutes * STEPS_PER_MINUTE; k++) {
      b.bot.step(0);
      b.seen.push(...b.bot.sim.events);
    }
  };
  const before = botFor('inspection');
  before.until(2, 9 * 60 + 1);
  idle(before, 60);
  before.until(2, 16 * 60 + 1);
  const missedBefore = before.seen.some((e) => e.type === 'missed');
  check(missedBefore && before.seen.some((e) => e.type === 'today' && e.phase === 'commend'), 'breakfast missed before the inspection: still commended');
  const during = botFor('inspection');
  during.until(2, 15 * 60 + 1);
  idle(during, 60);
  during.until(2, 16 * 60 + 2);
  check(during.seen.some((e) => e.type === 'missed') && !during.seen.some((e) => e.type === 'today' && e.phase === 'commend'), 'exercise missed while the inspectors are in: no commendation');
  // Irongate, GEN-1 already off: the storm still cuts GEN-2.
  const ig = botFor('none', 'storm', 4, IRONGATE);
  ig.into(ig.plan().outages[0] - 1);
  ig.bot.st.powerOff = 400;
  ig.into(ig.plan().outages[0] + 1);
  check(ig.seen.some((e) => e.type === 'power' && !e.on && e.by === 'storm' && e.gen === 1), 'Irongate: GEN-1 already off, the storm cuts GEN-2');
  // Out cold for part of the drill's muster: excused, even back on one's feet before it closes.
  const ko = botFor('drill', 'clear', 6);
  const at = ko.plan().at;
  ko.until(2, (at + 8 * 60 + 2) % 1440);
  ko.bot.st.ko = 3 * STEPS_PER_MINUTE;
  const h0 = ko.bot.st.heat;
  idle(ko, MUSTER_MINUTES);
  check(!ko.seen.some((e) => e.type === 'today' && e.phase === 'missed') && ko.bot.st.heat <= h0, 'out cold during the muster: no heat for missing the drill');
}
