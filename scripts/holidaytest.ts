/**
 * Holidays (P42): the date → holiday function at every window's edges and Easter by the computus
 * for 2026–2035; Settings' choice (by the date, picked, off); each holiday's days dealt in a run;
 * in the real sim, each holiday's day and what it brings: the egg hunt's eggs hidden and found
 * (eaten, sold), the yard's gone at 22:00; the water fight's soaked guards and the player's splash,
 * summer's heatwaves; costume night's costume, pumpkin, carving and laughs; Christmas Day's present
 * given and its dinner; New Year's fireworks drowning noise. A holiday kept through a save and a
 * run log. Every escape bot under each holiday: holidaybotstest.ts.
 */
import { check } from './assert';
import { easterSunday, HOLIDAY, HOLIDAY_DAY, HOLIDAY_DAYS, holidayDaysOn, holidayOn, HOLIDAYS, TREAT, WET_SIGHT, FIREWORK_NOISE, EGG_DESKS, EGG_YARD } from '../src/content/holidays';
import { runHoliday } from '../src/game/holidays';
import { DAY_BOOKS } from '../src/content/days';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { itemNumber } from '../src/content/items';
import { Sim } from '../src/sim/Sim';
import { DAY_STEPS, formatTime } from '../src/sim/systems/clock';
import { dayPlan, feastNow, muffled, sightOf } from '../src/sim/systems/calendar';
import { saleOf } from '../src/sim/systems/pantry';
import { inDisguise } from '../src/sim/systems/watch';
import { itemOf, usesOf } from '../src/sim/systems/items';
import { floorOf } from '../src/sim/ai/places';
import { FEAT } from '../src/sim/systems/ledger';
import { containersOf } from '../src/sim/world/containers';
import { LAYER, MAP_W } from '../src/sim/world/World';
import { command, EXT, OP, SLOT, TALK } from '../src/sim/command';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { RunRecorder, replayLog } from '../src/sim/runlog';
import { HolidaysView, holidayDecor } from '../src/render/Holidays';
import { TILE_INFO } from '../src/sim/world/tiles';
import { facts } from '../src/talk/gossip';

// ------------------------------------------------------------------ the date
const EASTERS = ['2026-04-05', '2027-03-28', '2028-04-16', '2029-04-01', '2030-04-21', '2031-04-13', '2032-03-28', '2033-04-17', '2034-04-09', '2035-03-25'];
const iso = (y: number, [m, d]: readonly number[]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const easters = EASTERS.map((_, k) => iso(2026 + k, easterSunday(2026 + k)));
console.log(`Easter Sundays 2026–2035: ${easters.join(', ')}`);
check(easters.join() === EASTERS.join(), 'the computus gives every Easter Sunday 2026–2035');
// (Some famous ones: the earliest and latest possible dates.)
check(iso(1818, easterSunday(1818)) === '1818-03-22' && iso(1943, easterSunday(1943)) === '1943-04-25' && iso(2285, easterSunday(2285)) === '2285-03-22', 'and the earliest and latest there have been (1818, 1943, 2285)');

const H = (y: number, m: number, d: number) => HOLIDAYS[holidayOn(y, m, d)];
const edges: Array<[number, number, number, string]> = [];
for (let k = 0; k < 10; k++) {
  const y = 2026 + k;
  const [m, d] = easterSunday(y);
  const at = (off: number) => {
    const t = new Date(Date.UTC(y, m - 1, d + off));
    return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()] as const;
  };
  edges.push([...at(-3), 'none'], [...at(-2), 'easter'], [...at(0), 'easter'], [...at(1), 'easter'], [...at(2), 'none']);
}
edges.push(
  [2026, 6, 30, 'none'], [2026, 7, 1, 'summer'], [2026, 8, 31, 'summer'], [2026, 9, 1, 'none'],
  [2026, 10, 23, 'none'], [2026, 10, 24, 'halloween'], [2026, 10, 31, 'halloween'], [2026, 11, 2, 'halloween'], [2026, 11, 3, 'none'],
  [2026, 12, 14, 'none'], [2026, 12, 15, 'christmas'], [2026, 12, 25, 'christmas'], [2026, 12, 31, 'christmas'], [2027, 1, 1, 'christmas'], [2027, 1, 6, 'christmas'], [2027, 1, 7, 'none'],
  [2027, 2, 29 - 1, 'none'], [2028, 2, 29, 'none'], [2026, 5, 1, 'none'],
);
const wrong = edges.filter(([y, m, d, want]) => H(y, m, d) !== want);
check(wrong.length === 0, `every window's edges: ${wrong.map(([y, m, d, w]) => `${y}-${m}-${d} gave ${H(y, m, d)}, not ${w}`).join('; ') || 'right'}`);
console.log(`window edges: ${edges.length} dates checked (Good Friday to Easter Monday for ten years, 1 Jul–31 Aug, 24 Oct–2 Nov, 15 Dec–6 Jan)`);

// Settings: by the date, picked, off.
const halloween = new Date(2026, 9, 31, 12);
check(runHoliday({ holidays: 'calendar', holidayPick: 'easter' }, halloween) === HOLIDAY.HALLOWEEN, 'by the calendar: 31 October is Halloween');
check(runHoliday({ holidays: 'calendar', holidayPick: 'easter' }, new Date(2026, 4, 12, 12)) === HOLIDAY.NONE, 'by the calendar: 12 May is no holiday');
check(runHoliday({ holidays: 'pick', holidayPick: 'summer' }, halloween) === HOLIDAY.SUMMER, 'picked: summer, whatever the date');
check(runHoliday({ holidays: 'off', holidayPick: 'summer' }, halloween) === HOLIDAY.NONE, 'off: none, whatever the date');

// ------------------------------------------------------------------ the days dealt
for (let h = 1; h < HOLIDAYS.length; h++) {
  const days = Array.from({ length: 17 }, (_, k) => k + 1).flatMap((d) => holidayDaysOn(h, d).map((id) => `${id} ${d}`));
  console.log(`${HOLIDAYS[h]}: ${days.join(', ')}`);
}
check(holidayDaysOn(0, 2).length === 0 && HOLIDAY_DAYS.every((id) => !holidayDaysOn(HOLIDAY_DAY[id].holiday, 1).includes(id)), 'no holiday, no day; and never on day 1 (the escape bots’ day)');

// ------------------------------------------------------------------ in the sim
/** A game under a holiday, run to a prison day's minute (0 is 08:00). */
const game = (holiday: number, def = CENTER_PERKS, seed = 7) => new Sim(def, seed, [], holiday);
const runTo = (sim: Sim, day: number, minute: number, each?: () => void) => {
  const goal = (day - 1) * DAY_STEPS + minute * STEPS_PER_MINUTE;
  while (sim.state.step < goal) {
    sim.step(0);
    each?.();
  }
};
const events = (sim: Sim, what: string) => sim.events.filter((e) => e.type === 'holiday' && e.what === what);
const holidayLog = (sim: Sim, out: string[]) => () => {
  for (const e of sim.events) if (e.type === 'holiday') out.push(`${formatTime(sim.clock)} ${e.what}${e.day ? ` ${e.day}` : ''}${e.n ? ` ${e.n}` : ''}`);
};
const at = (sim: Sim, tile: number) => {
  sim.state.player.x = (tile % MAP_W) * UNIT + UNIT / 2;
  sim.state.player.z = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
};
const containerOf = (sim: Sim, table: string) => containersOf(sim.world).findIndex((c) => c.table === table);
/** A treat taken from the open furniture (EXT.HOLIDAY), as the take button sends it. */
const takeTreat = (sim: Sim, table: string, what: number) => {
  sim.state.items.open = containerOf(sim, table);
  sim.step(command(0, OP.EXT, EXT.HOLIDAY, what));
};
const held = (sim: Sim, id: string) => sim.state.items.inv.slice(0, 6).some((v) => itemOf(v) === itemNumber(id));
const hold = (sim: Sim, id: string) => {
  const k = sim.state.items.inv.slice(0, 6).findIndex((v) => itemOf(v) === itemNumber(id));
  sim.step(command(0, OP.SELECT, k));
};
const CHOC_EGG = itemNumber('choc_egg');

// Every prison: its day dealt, nothing from a holiday in the Training Block.
for (const p of PRISONS) {
  for (let h = 1; h < HOLIDAYS.length; h++) {
    const sim = game(h, p, 11);
    const seen: string[] = [];
    // (To the end of the holiday's last day here: day 2's at 22:00, New Year's Eve's ten minutes after midnight at the end of day 3.)
    if (h === HOLIDAY.CHRISTMAS) runTo(sim, 3, 971, holidayLog(sim, seen));
    else runTo(sim, 2, 841, holidayLog(sim, seen));
    const want = HOLIDAY_DAYS.filter((id) => HOLIDAY_DAY[id].holiday === h);
    check(want.every((id) => seen.some((l) => l.endsWith(`start ${id}`)) && seen.some((l) => l.endsWith(`end ${id}`))), `${p.id} under ${HOLIDAYS[h]}: its days begin and end (${seen.join(', ')})`);
  }
}
{
  const { TRAINING } = await import('../src/content/prisons/training');
  const sim = game(HOLIDAY.EASTER, TRAINING);
  runTo(sim, 2, 60);
  check(!DAY_BOOKS[TRAINING.id] && sim.state.items.ground.every(([, v]) => itemOf(v) !== CHOC_EGG), 'the Training Block keeps no holiday (no eggs)');
}

// Easter: the egg hunt.
{
  const sim = game(HOLIDAY.EASTER);
  const log: string[] = [];
  runTo(sim, 2, 1, holidayLog(sim, log));
  const list = containersOf(sim.world);
  const inDesks = list.flatMap((c, k) => (c.table === 'inmateDesk' ? sim.state.items.containers[k].filter((v) => itemOf(v) === CHOC_EGG) : []));
  const inYard = sim.state.items.ground.filter(([t, v]) => itemOf(v) === CHOC_EGG && sim.world.zoneAt(t % MAP_W, Math.floor(t / MAP_W)) === 'yard');
  console.log(`easter at center-perks: ${log.join(', ')}; ${inDesks.length} eggs in inmates' desks, ${inYard.length} about the yard`);
  check(inDesks.length === EGG_DESKS && inYard.length === EGG_YARD, `eggs hidden at 08:00: ${EGG_DESKS} in desks, ${EGG_YARD} in the yard`);
  check(list.every((c, k) => c.table !== 'playerDesk' || !sim.state.items.containers[k].some((v) => itemOf(v) === CHOC_EGG)), "(none in the player's own desk)");
  const again = game(HOLIDAY.EASTER);
  runTo(again, 2, 1);
  check(JSON.stringify(again.state.items) === JSON.stringify(sim.state.items), 'the same eggs in the same places for the same run');
  // The rumour (P42's gossip): whose desk hides an egg, each one true.
  const tips = facts(sim).filter((f) => f.kind === 'eggDesk');
  const deskOf = (who: number) => list.findIndex((c) => c.table === 'inmateDesk' && sim.world.cellOf[c.prop.z * MAP_W + c.prop.x] === sim.state.inmates[who].cell);
  check(tips.length === EGG_DESKS && tips.every((f) => sim.state.items.containers[deskOf(f.inmate!)].some((v) => itemOf(v) === CHOC_EGG && usesOf(v) === 1)), `the inmates tell whose desk hides an egg (${tips.length} tips, every one true)`);
  check(!facts(game(0)).some((f) => f.kind === 'eggDesk'), '(no egg hunt, no such tip)');
  // One taken from an inmate's desk (as the player would: the desk open, moved to the hotbar).
  const desk = list.findIndex((c, k) => c.table === 'inmateDesk' && sim.state.items.containers[k].some((v) => itemOf(v) === CHOC_EGG));
  const k = sim.state.items.containers[desk].findIndex((v) => itemOf(v) === CHOC_EGG);
  sim.state.items.open = desk;
  sim.step(command(0, OP.MOVE, SLOT.CONTAINER + k, 0));
  // (Found as the next step looks in the pockets.)
  sim.step(0);
  check(events(sim, 'egg').length === 1 && itemOf(sim.state.items.inv[0]) === CHOC_EGG && usesOf(sim.state.items.inv[0]) === 0 && sim.state.feats[FEAT.eggsFound] === 1, 'an egg found: in the pockets, counted once');
  sim.step(0);
  check(sim.state.feats[FEAT.eggsFound] === 1, '(and not again)');
  check(saleOf(CHOC_EGG) > 0, `a merchant buys an egg ($${saleOf(CHOC_EGG)})`);
  sim.state.energy = 50;
  sim.step(command(0, OP.SELECT, 0));
  sim.step(command(0, OP.USE, 1));
  check(sim.events.some((e) => e.type === 'ate' && e.item === CHOC_EGG) && sim.state.energy > 50, 'an egg eaten: energy back');
  runTo(sim, 2, 9 * 60 + 30);
  check(feastNow(sim), 'a lamb roast: dinner is a feast');
  runTo(sim, 2, 14 * 60 + 1);
  check(!sim.state.items.ground.some(([, v]) => itemOf(v) === CHOC_EGG && usesOf(v) === 1), '22:00: the eggs left in the yard are gone (the inmates found them)');
  const plain = game(0);
  runTo(plain, 2, 9 * 60 + 30);
  check(!feastNow(plain), '(no holiday: an ordinary dinner)');
}

// Summer: the water fight, an ice lolly, heatwaves.
{
  const sim = game(HOLIDAY.SUMMER);
  runTo(sim, 2, 60);
  takeTreat(sim, 'canteenCounter', TREAT.LOLLY);
  check(held(sim, 'ice_lolly') && sim.state.feats[FEAT.treats] === 1, 'summer: an ice lolly from the canteen counter');
  takeTreat(sim, 'canteenCounter', TREAT.LOLLY);
  check(sim.events.some((e) => e.type === 'refused' && e.why === 'takenToday'), 'one a day');
  takeTreat(sim, 'canteenCounter', TREAT.GIFT);
  check(!held(sim, 'gift'), "(not Christmas's present)");
  runTo(sim, 2, 7 * 60 + 5);
  const yard = floorOf(sim.world, ['yard']);
  const g = sim.state.guards[0];
  const before = { x: g.body.x, z: g.body.z };
  g.body.x = (yard[0] % MAP_W) * UNIT + UNIT / 2;
  g.body.z = Math.floor(yard[0] / MAP_W) * UNIT + UNIT / 2;
  const wet = sightOf(sim, g);
  const dry = game(0);
  runTo(dry, 2, 7 * 60 + 5);
  Object.assign(dry.state.guards[0].body, { x: g.body.x, z: g.body.z });
  const normal = sightOf(dry, dry.state.guards[0]);
  console.log(`summer's water fight: a guard in the yard sees ${wet / UNIT} tiles (${normal / UNIT} without it)`);
  check(wet === WET_SIGHT * UNIT && normal > wet, 'a soaked guard in the yard sees only WET_SIGHT tiles');
  Object.assign(g.body, before);
  at(sim, yard[0]);
  sim.step(0);
  check(events(sim, 'splash').length === 1 && sim.state.feats[FEAT.waterFights] === 1, 'the player out in the yard joins the water fight');
  sim.step(0);
  check(sim.state.feats[FEAT.waterFights] === 1, '(once)');
  runTo(sim, 2, 9 * 60 + 30);
  check(feastNow(sim), 'the barbecue: dinner is a feast');
  const heat = (h: number) => PRISONS.filter((p) => DAY_BOOKS[p.id]).map((p) => Array.from({ length: 60 }, (_, k) => dayPlan(p.id, 3, k + 2, [], [], h).weather).filter((w) => w === 'heatwave').length);
  console.log(`heatwave days in 60 (center-perks, stalag-flucht, shankton, san-pancho, irongate): ${heat(0).join(', ')}; in summer ${heat(HOLIDAY.SUMMER).join(', ')}`);
  check(heat(HOLIDAY.SUMMER).every((n, k) => n >= heat(0)[k]) && heat(HOLIDAY.SUMMER).reduce((a, b) => a + b) > heat(0).reduce((a, b) => a + b), 'summer brings heatwaves more often (never where the climate has none)');
  check(heat(HOLIDAY.SUMMER)[1] === 0, '(never in the Alps)');
}

// Halloween: the costume, a pumpkin carved, laughs.
{
  const sim = game(HOLIDAY.HALLOWEEN);
  runTo(sim, 2, 60);
  takeTreat(sim, 'canteenCounter', TREAT.COSTUME);
  takeTreat(sim, 'kitchenFreezer', TREAT.PUMPKIN);
  check(held(sim, 'costume') && held(sim, 'pumpkin'), 'halloween: a costume from the canteen counter, a pumpkin from the kitchen freezer');
  // (Put on for the evening: a player caught in the day wakes up back in the jumpsuit.)
  runTo(sim, 2, 11 * 60 + 5);
  sim.state.heat = 0;
  const k = sim.state.items.inv.slice(0, 6).findIndex((v) => itemOf(v) === itemNumber('costume'));
  sim.step(command(0, OP.EQUIP, k));
  check(itemOf(sim.state.items.inv[SLOT.OUTFIT]) === itemNumber('costume'), 'the costume worn');
  const m = sim.state.inmates[0];
  const was = m.opinion;
  for (let n = 0; n < 40; n++) {
    sim.state.player.x = m.body.x + UNIT / 2;
    sim.state.player.z = m.body.z;
    sim.step(0);
  }
  const laughs = sim.state.laughed.slice(1);
  console.log(`costume night: ${laughs.length} laughed, inmate 0's opinion ${was} → ${m.opinion}`);
  check(laughs.includes(0) && m.opinion === Math.min(100, was + 5) && sim.state.feats[FEAT.laughs] === laughs.length, 'costume night: an inmate close by laughs, once, and likes the player more');
  check(!inDisguise(sim), 'the costume fools nobody: no disguise');
  hold(sim, 'pumpkin');
  sim.step(command(0, OP.USE, 1));
  check(held(sim, 'pumpkin') && !held(sim, 'jack_lantern'), 'a pumpkin is carved only in the kitchen');
  at(sim, floorOf(sim.world, ['kitchen'])[0]);
  sim.step(command(0, OP.USE, 1));
  check(held(sim, 'jack_lantern') && !held(sim, 'pumpkin') && sim.state.feats[FEAT.carved] === 1, 'in the kitchen: carved into a lantern');
  check(saleOf(itemNumber('jack_lantern')) > saleOf(itemNumber('pumpkin')), 'a lantern sells for more than a pumpkin');
}

// Christmas: a present given, Christmas dinner; New Year's Eve's fireworks.
{
  const sim = game(HOLIDAY.CHRISTMAS);
  runTo(sim, 2, 60);
  takeTreat(sim, 'canteenCounter', TREAT.GIFT);
  check(held(sim, 'gift'), 'christmas: a present from under the tree (the canteen counter)');
  const m = sim.state.inmates[1];
  const was = m.opinion;
  sim.state.player.x = m.body.x + UNIT / 2;
  sim.state.player.z = m.body.z;
  sim.state.talk = 1;
  sim.step(command(0, OP.TALK, TALK.GIFT, sim.state.items.inv.slice(0, 6).findIndex((v) => itemOf(v) === itemNumber('gift'))));
  console.log(`christmas: a present given, the inmate's opinion ${was} → ${m.opinion}`);
  check(m.opinion > was && sim.state.feats[FEAT.giftsGiven] === 1, 'the gift swap: a present raises opinion, counted');
  runTo(sim, 2, 9 * 60 + 30);
  check(feastNow(sim), 'Christmas dinner is a feast');
  const tile = 30 * MAP_W + 30;
  runTo(sim, 3, 959);
  const quiet = muffled(sim, LAYER.GROUND, tile, 10);
  runTo(sim, 3, 961);
  const loud = muffled(sim, LAYER.GROUND, tile, 10);
  console.log(`new year's eve: a noise of 10 tiles carries ${quiet} before midnight, ${loud} under the fireworks`);
  check(loud === Math.floor((10 * FIREWORK_NOISE) / 10) && quiet > loud, 'the fireworks drown every noise for their ten minutes');
  runTo(sim, 3, 971);
  check(muffled(sim, LAYER.GROUND, tile, 10) === quiet, '(and stop)');
}

// The holiday kept: a save, a run log.
{
  const sim = game(HOLIDAY.HALLOWEEN);
  const rec = new RunRecorder(sim, { seed: 7, game: '2.21.0' });
  for (let k = 0; k < DAY_STEPS + 12 * 60 * STEPS_PER_MINUTE; k++) rec.step(k % 300 < 150 ? 1 : 0);
  const log = rec.toLog();
  check(log.holiday === HOLIDAY.HALLOWEEN, "a run log keeps the run's holiday");
  const back = replayLog(log, CENTER_PERKS);
  check(!!back?.ok && back.sim.state.holiday === HOLIDAY.HALLOWEEN && back.sim.hash() === sim.hash(), 'and plays back under it, every checksum met, to the same state');
  const loaded = new Sim(CENTER_PERKS, 1);
  loaded.restore(JSON.parse(JSON.stringify(sim.snapshot())));
  check(loaded.state.holiday === HOLIDAY.HALLOWEEN && loaded.hash() === sim.hash(), 'a game saved and loaded keeps its holiday');
  const none = new RunRecorder(game(0), { seed: 7, game: '2.21.0' });
  none.step(0);
  check(none.toLog().holiday === undefined, '(a run without one says nothing of it)');
  const old = new Sim(CENTER_PERKS, 1);
  const st = JSON.parse(JSON.stringify(game(0).snapshot()));
  delete st.state.holiday;
  delete st.state.hol;
  delete st.state.laughed;
  old.restore(st);
  check(old.state.holiday === 0 && old.state.hol.join() === '0,0' && old.state.laughed.length === 0, 'a save from before holidays loads with none');
}

// ------------------------------------------------------------------ the decor (render only)
{
  const rows: string[] = [];
  for (const p of PRISONS) {
    const w = new Sim(p).world;
    const view = new HolidaysView();
    view.setWorld(w);
    const counts: string[] = [];
    for (let h = 1; h < HOLIDAYS.length; h++) {
      const plan = holidayDecor(w, h);
      // Every piece on open floor (a garland along the canteen's north wall, the rest standing on a floor tile: a table's top for those on one).
      for (const d of plan) {
        const tx = Math.floor(d.x);
        const tz = Math.floor(d.z);
        const kind = w.ground.kind[tz * MAP_W + tx];
        const floor = !TILE_INFO[kind].solid;
        const zone = w.zoneAt(tx, tz);
        const where = d.what === 'garland' || d.what === 'tree' || d.y ? 'canteen' : 'yard';
        check(floor && (zone === where || (where === 'yard' && zone === 'sports')), `${p.id} ${HOLIDAYS[h]}: the ${d.what} at ${d.x},${d.z} stands on the ${where}'s floor (${zone}, ${floor ? 'floor' : 'solid'})`);
        if (d.what === 'tree') check(!w.props.some((q) => tx >= q.x && tx < q.x + q.w && tz >= q.z && tz < q.z + q.d), `${p.id}: the tree stands clear of the furniture`);
        if (d.what === 'garland') check(TILE_INFO[w.ground.kind[(tz - 1) * MAP_W + tx]].solid, `${p.id}: a garland hangs on a wall`);
      }
      const n = (what: string) => plan.filter((d) => d.what === what).length;
      check(n('garland') > 0, `${p.id} ${HOLIDAYS[h]}: the canteen dressed`);
      if (h === HOLIDAY.CHRISTMAS) check(n('tree') === 1 && n('snowman') === 1, `${p.id}: a Christmas tree and a snowman`);
      if (h === HOLIDAY.SUMMER) check(n('parasol') === 3 && n('barbecue') === 1 && n('hose') === 2, `${p.id}: parasols, the barbecue, two hoses`);
      view.dress(h);
      check(view.group.children.length >= 3, `${p.id} ${HOLIDAYS[h]}: the decor built`);
      counts.push(`${HOLIDAYS[h]} ${[...new Set(plan.map((d) => d.what))].map((k) => `${k} ${n(k)}`).join(' ')}`);
    }
    view.dress(0);
    check(view.group.children.length === 2, `${p.id}: no holiday, no decor (only the sprays' and the sparks' empty meshes)`);
    view.dispose();
    rows.push(`  ${p.id}: ${counts.join('; ')}`);
  }
  console.log(`the decor:\n${rows.join('\n')}`);
}

// (The escape bots under each holiday: holidaybotstest.ts, run beside this one.)
