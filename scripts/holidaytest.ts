/**
 * Holidays (P42): the date → holiday function at every window's edges and Easter by the computus
 * for 2026–2035; Settings' choice (by the date, picked, off); each holiday's days dealt in a run;
 * in the real sim, each holiday's day and what it brings: the egg hunt's eggs hidden and found
 * (eaten, sold), the yard's gone at 22:00; the water fight's soaked guards and the player's splash,
 * summer's heatwaves; costume night's costume, pumpkin, carving and laughs; Christmas Day's present
 * given and its dinner; New Year's fireworks drowning noise. A holiday kept through a save and a
 * run log. Every escape bot under each holiday: holidaybotstest.ts; the evenings played: holidayruntest.ts.
 */
import { check } from './assert';
import { easterSunday, HOLIDAY, HOLIDAY_DAY, HOLIDAY_DAYS, holidayDaysOn, holidayOn, HOLIDAYS, TREAT, TREATS, WET_SIGHT, FIREWORK_NOISE, EGG_DESKS, EGG_YARD } from '../src/content/holidays';
import { runHoliday } from '../src/game/holidays';
import { DAY_BOOKS } from '../src/content/days';
import { BLOCK, ROUTINE } from '../src/content/routine';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { itemNumber } from '../src/content/items';
import { Sim } from '../src/sim/Sim';
import { DAY_STEPS, formatTime } from '../src/sim/systems/clock';
import { dayPlan, feastNow, muffled, sightOf } from '../src/sim/systems/calendar';
import { saleOf } from '../src/sim/systems/pantry';
import { inDisguise } from '../src/sim/systems/watch';
import { itemOf, slot, usesOf } from '../src/sim/systems/items';
import { treatCheck } from '../src/sim/systems/holiday';
import { floorOf } from '../src/sim/ai/places';
import { FEAT } from '../src/sim/systems/ledger';
import { containersOf } from '../src/sim/world/containers';
import { LAYER, MAP_W, placeKey } from '../src/sim/world/World';
import { command, EXT, OP, SLOT, TALK } from '../src/sim/command';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { RunRecorder, replayLog } from '../src/sim/runlog';
import { HolidaysView, holidayDecor, PARASOL_GAP } from '../src/render/Holidays';
import { DECOR } from '../src/content/decor';
import { TILE, TILE_INFO } from '../src/sim/world/tiles';
import { facts } from '../src/talk/gossip';
import { inmateMood } from '../src/talk/mood';
import { dateHoliday } from '../src/game/holidays';

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
check(dateHoliday({ holidays: 'pick' }, halloween) === HOLIDAY.HALLOWEEN && dateHoliday({ holidays: 'calendar' }, halloween) === HOLIDAY.HALLOWEEN && dateHoliday({ holidays: 'off' }, halloween) === HOLIDAY.NONE, "a Daily's decor: the date's holiday, never the one picked (none with holidays off)");

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

// Easter, the rules review: what wasn't found by 22:00 is gone from the inmates' desks too (else, week after week, the eggs fill the desks and leave no room for their loot); an egg carried off out of the yard stays where it lies.
{
  const desksOf = (sim: Sim) => containersOf(sim.world).map((c, k) => ({ c, k })).filter(({ c }) => c.table === 'inmateDesk');
  const hiddenIn = (sim: Sim) => desksOf(sim).reduce((n, { k }) => n + sim.state.items.containers[k].filter((v) => itemOf(v) === CHOC_EGG && usesOf(v) === 1).length, 0);
  const runs = [0, HOLIDAY.EASTER].map((h) => {
    const sim = game(h);
    const loot: string[] = [];
    const left: number[] = [];
    for (let d = 2; d <= 58; d++) {
      // Each morning, just after the eggs are hidden: the inmates' desks looted of all but the eggs (as a player would, every day).
      runTo(sim, d, 0);
      sim.step(0);
      let got = 0;
      for (const { c, k } of desksOf(sim)) {
        const box = sim.state.items.containers[k];
        for (let j = c.hidden; j < box.length; j++) {
          if (!box[j] || itemOf(box[j]) === CHOC_EGG) continue;
          got++;
          box[j] = 0;
        }
      }
      loot.push(`${got}`);
      if (h && (d - 2) % 7 === 0) {
        runTo(sim, d, 14 * 60 + 1);
        left.push(hiddenIn(sim));
      }
    }
    return { loot: loot.join(','), left };
  });
  check(runs[1].left.length === 9 && runs[1].left.every((n) => n === 0), `22:00 on every egg hunt in 8 weeks: no egg left hidden in an inmate's desk (${runs[1].left.join(',')})`);
  check(runs[1].loot === runs[0].loot, `the inmates' desks give as much loot over 8 weeks of Easter as without it (${runs[1].loot} / ${runs[0].loot})`);
  console.log(`easter over 8 weeks: the inmates' desks' loot as without a holiday (${runs[0].loot.split(',').reduce((a, b) => a + Number(b), 0)} items in 57 mornings), no egg left in a desk after 22:00`);
  // An egg carried out of the yard (a rat's, dropped at the player's feet indoors) and one up on the roof over the yard: still there at 22:00.
  const sim = game(HOLIDAY.EASTER);
  runTo(sim, 2, 13 * 60);
  const yard = floorOf(sim.world, ['yard'])[0];
  const canteen = floorOf(sim.world, ['canteen'])[0];
  sim.state.items.ground.push([canteen, slot(CHOC_EGG, 1)], [placeKey(LAYER.ROOF, yard), slot(CHOC_EGG, 1)]);
  runTo(sim, 2, 14 * 60 + 1);
  const still = sim.state.items.ground.filter(([, v]) => itemOf(v) === CHOC_EGG && usesOf(v) === 1).map(([key]) => key);
  check(still.length === 2 && still.includes(canteen) && still.includes(placeKey(LAYER.ROOF, yard)), `22:00: only the yard's eggs are gone; one carried indoors and one on a roof stay (${still.join(',')})`);
}

// The treats, the rules review: on offer only until their holiday day is over (the lolly until 15:30, the costume and the pumpkin until 21:00, the present until 22:00).
{
  const hours: Array<[number, string, number[]]> = [
    [HOLIDAY.SUMMER, 'waterFight', [TREAT.LOLLY]],
    [HOLIDAY.HALLOWEEN, 'costumeNight', [TREAT.COSTUME, TREAT.PUMPKIN]],
    [HOLIDAY.CHRISTMAS, 'christmasDay', [TREAT.GIFT]],
  ];
  const rows: string[] = [];
  for (const [h, id, treats] of hours) {
    const sim = game(h);
    const d = HOLIDAY_DAY[id as keyof typeof HOLIDAY_DAY];
    const end = d.at + d.length;
    runTo(sim, 2, end - 1);
    const open = (what: number) => {
      sim.state.items.open = containerOf(sim, TREATS[what].table);
      return treatCheck(sim, what);
    };
    check(treats.every((w) => open(w) === null), `${HOLIDAYS[h]}: the treats still on offer at ${formatTime(sim.clock)}`);
    runTo(sim, 2, end);
    check(treats.every((w) => open(w) === 'notHere'), `${HOLIDAYS[h]}: and gone at ${formatTime(sim.clock)}`);
    for (const w of treats) takeTreat(sim, TREATS[w].table, w);
    check(treats.every((w) => !held(sim, TREATS[w].item)) && sim.state.feats[FEAT.treats] === 0, `${HOLIDAYS[h]}: none taken after hours`);
    rows.push(`${treats.map((w) => TREATS[w].item).join(' and ')} until ${formatTime(sim.clock)}`);
  }
  console.log(`the treats on offer: ${rows.join('; ')}`);
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
  // The water fight is on the sports ground, where the exercise hour is (never the courtyard: routine.ts zonesOf).
  const sports = floorOf(sim.world, ['sports']);
  const g = sim.state.guards[0];
  const before = { x: g.body.x, z: g.body.z };
  g.body.x = (sports[0] % MAP_W) * UNIT + UNIT / 2;
  g.body.z = Math.floor(sports[0] / MAP_W) * UNIT + UNIT / 2;
  const wet = sightOf(sim, g);
  const dry = game(0);
  runTo(dry, 2, 7 * 60 + 5);
  Object.assign(dry.state.guards[0].body, { x: g.body.x, z: g.body.z });
  const normal = sightOf(dry, dry.state.guards[0]);
  const yard = floorOf(sim.world, ['yard']);
  g.body.x = (yard[0] % MAP_W) * UNIT + UNIT / 2;
  g.body.z = Math.floor(yard[0] / MAP_W) * UNIT + UNIT / 2;
  const courtyard = sightOf(sim, g);
  console.log(`summer's water fight: a guard on the sports ground sees ${wet / UNIT} tiles (${normal / UNIT} without it; ${courtyard / UNIT} in the courtyard, where there's none)`);
  check(wet === WET_SIGHT * UNIT && normal > wet && courtyard === normal, 'a soaked guard on the sports ground sees only WET_SIGHT tiles (none soaked in the courtyard)');
  Object.assign(g.body, before);
  at(sim, yard[0]);
  sim.step(0);
  check(events(sim, 'splash').length === 0, '(the courtyard: no water fight there)');
  at(sim, sports[0]);
  sim.step(0);
  const exercise = ROUTINE.findIndex((r) => r.id === 'exercise');
  check(events(sim, 'splash').length === 1 && sim.state.feats[FEAT.waterFights] === 1, 'the player out on the sports ground joins the water fight');
  check(sim.state.routine === exercise && sim.state.blocks[exercise] === BLOCK.ATTENDED, `and is present for Exercise (block ${sim.state.blocks[exercise]})`);
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

// The inmates' holiday talk (the rules review): the day's own talk only on the holiday's days, never "water fight at three" on day 5.
{
  const recent = { now: 0, incidents: [], searched: new Set<number>(), caughtAt: -1e9, cameTo: new Map<number, number>(), bumped: new Map<number, number>(), powerOutAt: -1e9 };
  const talk = (sim: Sim, day: number) => {
    const banks = new Set<string>();
    for (let m = 60; m < 15 * 60; m += 30) {
      runTo(sim, day, m);
      sim.state.inmates.forEach((_, id) => {
        const mood = inmateMood(sim, id, recent);
        if (mood) for (const b of [mood.bank, ...(mood.alt ?? [])]) if (b.startsWith('in.hol.')) banks.add(b);
      });
    }
    return [...banks].sort().join(',') || 'none';
  };
  const rows: string[] = [];
  for (const [h, def] of [[HOLIDAY.SUMMER, CENTER_PERKS], [HOLIDAY.CHRISTMAS, PRISONS.find((p) => p.id === 'stalag-flucht')!]] as const) {
    const sim = game(h, def, 5);
    const on = talk(sim, 2);
    const off = talk(sim, 5);
    rows.push(`${HOLIDAYS[h]} at ${def.id}: day 2 ${on}; day 5 ${off}`);
    check(on !== 'none' && !off.split(',').some((b) => ['in.hol.summer', 'in.hol.christmas', 'in.hol.newYear', 'in.hol.easter', 'in.hol.halloween'].includes(b)), `${HOLIDAYS[h]}: the day's talk on its day only (${on} / ${off})`);
  }
  console.log(`holiday talk: ${rows.join('; ')}`);
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
  const near = (a: number, b: number) => Math.max(Math.abs((a % MAP_W) - (b % MAP_W)), Math.abs(Math.floor(a / MAP_W) - Math.floor(b / MAP_W)));
  for (const p of PRISONS) {
    const w = new Sim(p).world;
    // What's there already (counted here from the prison's data, not by the decor's own planner): furniture, the floor decor, the pastimes' grounds; the doorways; what hangs on the canteen's north wall.
    const there = new Map<number, string>();
    const mark = (what: string, x: number, z: number, wd = 1, d = 1) => {
      for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + wd; xx++) there.set(zz * MAP_W + xx, what);
    };
    for (const q of w.props) mark(q.kind, q.x, q.z, q.w, q.d);
    for (const d of p.decor ?? []) if (!DECOR[d.kind].wall) mark(d.kind, d.x, d.z, d.w, d.d);
    const l = p.leisure!;
    mark('pitch', l.pitch.x, l.pitch.z, l.pitch.w, l.pitch.d);
    if (l.track) mark('track', l.track.x, l.track.z, l.track.w, l.track.d);
    mark('hoop', l.hoop.x, l.hoop.z);
    for (const sp of l.hoop.spots) mark('court', sp.x, sp.z);
    mark('garden', l.garden.x, l.garden.z, l.garden.w, l.garden.d);
    const doors: number[] = [];
    for (let t = 0; t < w.ground.kind.length; t++) if (w.ground.kind[t] === TILE.DOOR || w.ground.kind[t] === TILE.DETECTOR) doors.push(t);
    const hung = new Set<number>();
    for (const d of p.decor ?? []) if (DECOR[d.kind].wall && (d.rot ?? 0) === 0) for (let x = d.x; x < d.x + (d.w ?? 1); x++) hung.add(d.z * MAP_W + x);
    const view = new HolidaysView();
    view.setWorld(w);
    const counts: string[] = [];
    for (let h = 1; h < HOLIDAYS.length; h++) {
      const plan = holidayDecor(w, h);
      // Every piece on open floor (a garland along the canteen's north wall, the rest standing on a floor tile: a table's top for those on one).
      for (const d of plan) {
        const tx = Math.floor(d.x);
        const tz = Math.floor(d.z);
        const t = tz * MAP_W + tx;
        const kind = w.ground.kind[t];
        const floor = !TILE_INFO[kind].solid;
        const zone = w.zoneAt(tx, tz);
        const summer = d.what === 'parasol' || d.what === 'barbecue' || d.what === 'hose';
        const where = d.what === 'garland' || d.what === 'tree' || d.y ? 'canteen' : summer ? 'sports' : 'yard';
        check(floor && (zone === where || (where === 'yard' && zone === 'sports')), `${p.id} ${HOLIDAYS[h]}: the ${d.what} at ${d.x},${d.z} stands on the ${where}'s floor (${zone}, ${floor ? 'floor' : 'solid'})`);
        if (d.what === 'garland') {
          check(TILE_INFO[w.ground.kind[(tz - 1) * MAP_W + tx]].solid, `${p.id}: a garland hangs on a wall`);
          const over = Array.from({ length: d.x1! - d.x }, (_, k) => tz * MAP_W + d.x + k).filter((u) => hung.has(u));
          check(!over.length, `${p.id} ${HOLIDAYS[h]}: the garland ${d.x}–${d.x1} at ${tz} crosses nothing hung on the wall (${over.map((u) => u % MAP_W).join(',')})`);
        } else if (!d.y) {
          // Out on the floor: on nothing that's there already, and clear of the doorways.
          check(!there.has(t), `${p.id} ${HOLIDAYS[h]}: the ${d.what} at ${tx},${tz} stands on no ${there.get(t)}`);
          const gap = d.what === 'tree' ? 2 : 1;
          check(!doors.some((u) => near(u, t) <= gap), `${p.id} ${HOLIDAYS[h]}: the ${d.what} at ${tx},${tz} is clear of the doors (${gap} tiles)`);
        }
      }
      const parasols = plan.filter((d) => d.what === 'parasol').map((d) => Math.floor(d.z) * MAP_W + Math.floor(d.x));
      check(parasols.every((a, k) => parasols.every((b, j) => j === k || near(a, b) >= PARASOL_GAP)), `${p.id} ${HOLIDAYS[h]}: the parasols ${PARASOL_GAP} tiles apart at least`);
      const n = (what: string) => plan.filter((d) => d.what === what).length;
      check(n('garland') > 0, `${p.id} ${HOLIDAYS[h]}: the canteen dressed`);
      if (h === HOLIDAY.CHRISTMAS) check(n('tree') === 1 && n('snowman') === 1, `${p.id}: a Christmas tree and a snowman`);
      if (h === HOLIDAY.SUMMER) check(n('parasol') >= 2 && n('barbecue') === 1 && n('hose') === 2, `${p.id}: parasols, the barbecue, two hoses on the sports ground`);
      view.dress(h);
      check(view.group.children.length >= 3, `${p.id} ${HOLIDAYS[h]}: the decor built`);
      counts.push(`${HOLIDAYS[h]} ${[...new Set(plan.map((d) => d.what))].map((k) => `${k} ${n(k)}`).join(' ')}`);
    }
    view.dress(0);
    check(view.group.children.length === 2, `${p.id}: no holiday, no decor (only the sprays' and the sparks' empty meshes)`);
    view.dispose();
    rows.push(`  ${p.id}: ${counts.join('; ')}`);
  }
  console.log(`the decor (on nothing, clear of doors, parasols apart, garlands round what hangs on the wall):\n${rows.join('\n')}`);
}

// (The escape bots under each holiday: holidaybotstest.ts; the evenings played by a bot: holidayruntest.ts. Both run beside this one.)
