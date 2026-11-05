/**
 * Lights Out and sleep (2.28): home within the grace from anywhere in every prison, energy at night only
 * asleep, the bed's button for the dummy, bed checks, the wake-up; older runs as they were.
 */
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';
import { enBarks as barksEn } from '../src/i18n/barks/en';
import { frBarks as barksFr } from '../src/i18n/barks/fr';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { TRAINING } from '../src/content/prisons/training';
import { ROUTINE } from '../src/content/routine';
import { ZONES } from '../src/content/zones';
import { placesOf } from '../src/sim/ai/places';
import { RunRecorder, replayLog } from '../src/sim/runlog';
import { Sim } from '../src/sim/Sim';
import { DOING } from '../src/sim/systems/inmates';
import { HOTBAR, interactTarget, itemOf, slot } from '../src/sim/systems/items';
import { dummyInBed } from '../src/sim/systems/justice';
import { awakeAtNight, bedOffer } from '../src/sim/systems/upkeep';
import { afterHours } from '../src/sim/systems/watch';
import { containersOf } from '../src/sim/world/containers';
import { LIGHTS_OUT_GRACE, LIGHTS_OUT_GRACE_227, NIGHT_ENERGY_FLOOR, STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { LAYER, MAP_W } from '../src/sim/world/World';
import { check } from './assert';
import { Bot, n } from './bots';

const NIGHT = 23 * 60;
const put = (bot: Bot, tile: number) => {
  const p = bot.st.player;
  p.x = (tile % MAP_W) * UNIT + UNIT / 2;
  p.z = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
  p.moving = false;
};
/** A player at home beside their bed, a few minutes into the night (day 1 by the model prisoner). */
function atBed(def = CENTER_PERKS, seed = 3, minute = NIGHT + 20) {
  const bot = new Bot(def, seed);
  check(bot.routineUntil(1, minute), `${def.id}: into the night`);
  check(bot.sim.playerZone === 'playerCell' && ROUTINE[bot.st.routine].id === 'lightsOut', `${def.id}: home at ${minute}`);
  bot.events.length = 0;
  return bot;
}
const bedIndex = (bot: Bot) => containersOf(bot.sim.world).findIndex((c) => c.mine && c.prop.kind === 'bed');
const inHand = (bot: Bot, item: string) => {
  const it = bot.st.items;
  const k = it.inv.slice(0, HOTBAR).findIndex((v) => !v);
  it.inv[k] = slot(n(item));
  it.hand = k;
  it.rev++;
};
const waitMinutes = (bot: Bot, m: number) => {
  for (let k = 0; k < m * STEPS_PER_MINUTE; k++) bot.step();
};

// ------------------------------------------------------------------ home in time, from anywhere, in every prison
for (const def of PRISONS) {
  const base = new Bot(def, 3);
  const w = base.sim.world;
  const home = placesOf(w).bedside[1];
  const far = new Map<string, number>();
  const d = (t: number) => Math.abs((t % MAP_W) - (home % MAP_W)) + Math.abs(Math.floor(t / MAP_W) - Math.floor(home / MAP_W));
  for (let t = 0; t < w.ground.zone.length; t++) {
    const z = ZONES[w.ground.zone[t]];
    if (!z || w.guardBlock[t]) continue;
    if (!far.has(z) || d(t) > d(far.get(z)!)) far.set(z, t);
  }
  let worst = 0;
  let worstZone = '';
  let rooms = 0;
  const shut: string[] = [];
  // From each room as the bell goes, as things stand then (a room shut for the night is left by the way anyone inside it can).
  const bell = new Bot(def, 3);
  bell.routineUntil(1, NIGHT - 1);
  const atBell = bell.sim.snapshot();
  for (const [z, t] of far) {
    const bot = new Bot(def, 3);
    bot.silent = true;
    bot.sim.restore(atBell);
    put(bot, t);
    const from = bot.st.step;
    // (A step first: a gate shut for the night opens for whoever is still inside. Rooms with no way out for an inmate even so aren't anywhere an honest walk home starts from.)
    bot.step();
    if (!bot.walkTo(home, 1000)) {
      shut.push(z);
      continue;
    }
    rooms++;
    const s = (bot.st.step - from) / STEPS_PER_MINUTE;
    if (s > worst) [worst, worstZone] = [s, z];
  }
  check(rooms >= 3, `${def.id}: walks home measured from ${rooms} rooms`);
  check(worst * STEPS_PER_MINUTE < LIGHTS_OUT_GRACE, `${def.id}: the longest walk home (${worstZone}, ${worst} s) is inside the grace`);
  check(worst * STEPS_PER_MINUTE >= LIGHTS_OUT_GRACE_227, `${def.id}: and it wasn't inside the old one`);
  const bot = atBed(def);
  const c = containersOf(bot.sim.world)[bedIndex(bot)];
  check(!!c, `${def.id}: the player has a bed`);
  bot.act();
  check(bot.st.sleeping, `${def.id}: the button at the bed is Sleep`);
  console.log(`${def.id}: the longest walk home ${worst.toFixed(1)} s (${worstZone}), of ${LIGHTS_OUT_GRACE / STEPS_PER_MINUTE}; from ${rooms} rooms, none from: ${shut.join(', ') || 'nowhere'}`);
}

// ------------------------------------------------------------------ the button at the bed: every tile in reach, every way they face
for (const def of PRISONS) {
  const bot = atBed(def);
  const w = bot.sim.world;
  const bed = containersOf(w)[bedIndex(bot)].prop;
  const here = placesOf(w).bedside[1];
  const target = () => interactTarget(w, bot.st.items, bot.st.player, bot.sim.bedtime, bot.st.layer, [], bot.st.inmates.length, () => false, true);
  let sits = 0;
  let sleeps = 0;
  for (const dz of [-0.45, 0, 0.45]) {
    for (const dx of [-0.45, 0, 0.45]) {
      for (let f = 0; f < 16; f++) {
        put(bot, here);
        bot.st.player.x += Math.round(dx * UNIT);
        bot.st.player.z += Math.round(dz * UNIT);
        bot.st.player.facing = f;
        const k = target()?.kind;
        if (k === 'fixture') sits++;
        if (k === 'sleep') sleeps++;
      }
    }
  }
  check(sits === 0, `${def.id}: beside the bed at night a chair never takes the button (${sits})`);
  check(sleeps > 0, `${def.id}: it says Sleep`);
  console.log(`${def.id}: beside the bed (${bed.x},${bed.z}): Sleep in ${sleeps} of ${9 * 16} positions and facings, a chair in none`);
}

// ------------------------------------------------------------------ the walk through the yard: no searchlight during the grace
{
  const walk = new Bot(PRISONS.find((d) => d.id === 'stalag-flucht')!, 3);
  check(walk.routineUntil(1, NIGHT + 20), 'stalag-flucht: the model prisoner goes home');
  check(walk.st.heat === 0 && !walk.log.some((l) => l.includes('searchlight')), `stalag-flucht: no searchlight on the walk home (heat ${walk.st.heat})`);
  console.log('searchlights: the walk home at the bell is left alone');
}

// ------------------------------------------------------------------ the grace and the bell's own moment
{
  const bot = new Bot(CENTER_PERKS, 3);
  check(bot.routineUntil(1, NIGHT + 24), 'to 23:24');
  check(!afterHours(bot.sim), 'not out late at 23:24');
  bot.routineUntil(1, NIGHT + 25);
  check(afterHours(bot.sim), 'out late from 23:25');
  const old = new Bot(CENTER_PERKS, 3);
  old.sim.rules227 = true;
  old.routineUntil(1, NIGHT + 14);
  check(!afterHours(old.sim), 'the old rules: not out late at 23:14');
  old.routineUntil(1, NIGHT + 15);
  check(afterHours(old.sim), 'the old rules: out late from 23:15');
  console.log('the grace: to 23:25; the old rules 23:15');
}

// ------------------------------------------------------------------ energy at night
{
  const up = atBed();
  up.st.energy = 50;
  waitMinutes(up, 60);
  check(up.st.energy === 50, `an hour up in the cell gains nothing (${up.st.energy})`);
  const low = atBed();
  low.st.energy = 5;
  waitMinutes(low, 60);
  check(low.st.energy === NIGHT_ENERGY_FLOOR, `up at night, energy creeps back to ${NIGHT_ENERGY_FLOOR} and stops (${low.st.energy})`);

  // On a chair at night: no faster, above the floor or below it.
  for (const from of [50, 5]) {
    const seated = atBed();
    seated.st.energy = from;
    seated.st.seat = seated.sim.world.props.findIndex((p) => p.kind === 'chair' && seated.sim.world.cellOf[p.z * MAP_W + p.x] === 1);
    check(seated.st.seat >= 0, 'a chair in the cell');
    put(seated, placesOf(seated.sim.world).deskside[1]);
    waitMinutes(seated, 10);
    check(seated.st.energy === Math.max(from, Math.min(NIGHT_ENERGY_FLOOR, from + 5)), `a chair at night from ${from}: as standing (${seated.st.energy})`);
  }
  // Training's nights as they were.
  const training = new Bot(TRAINING, 3);
  check(training.routineUntil(1, NIGHT + 20), 'Training: into the night');
  training.st.energy = 0;
  training.st.sleeping = true;
  waitMinutes(training, 60);
  check(training.st.energy === 60, `Training: an hour asleep as ever (${training.st.energy})`);

  const asleep = atBed();
  asleep.st.energy = 0;
  asleep.act();
  check(asleep.st.sleeping, 'asleep');
  waitMinutes(asleep, 60);
  check(asleep.st.energy === 30, `an hour asleep gains 30 (${asleep.st.energy})`);
  waitMinutes(asleep, 145);
  check(asleep.st.energy === 100, `a few hours fill it (${asleep.st.energy})`);

  const forced = atBed();
  forced.st.energy = 50;
  forced.st.solitary = 100 * STEPS_PER_MINUTE;
  check(!awakeAtNight(forced.sim), 'in solitary the night costs nothing');
  forced.st.solitary = 0;
  forced.st.ko = 100;
  check(!awakeAtNight(forced.sim), 'nor out cold');
  forced.st.ko = 0;
  forced.st.lockdown = true;
  check(!awakeAtNight(forced.sim), 'nor in a lockdown');
  forced.st.lockdown = false;
  check(awakeAtNight(forced.sim), 'up and free to sleep: it does');

  const day = new Bot(CENTER_PERKS, 3);
  check(!awakeAtNight(day.sim), 'by day nothing changes');
  day.st.energy = 50;
  waitMinutes(day, 20);
  check(day.st.energy === 60, `by day a point every 2 minutes (${day.st.energy})`);

  const old = atBed();
  old.sim.rules227 = true;
  old.st.energy = 50;
  waitMinutes(old, 60);
  check(old.st.energy === 80, `the old rules: up at night it comes back (${old.st.energy})`);
  console.log('energy: up at night none, past 20; asleep 30 an hour; forced awake as by day; old rules as they were');
}

// ------------------------------------------------------------------ the bed's button, in every prison
for (const def of PRISONS) {
  const bot = atBed(def);
  const bed = bedIndex(bot);
  inHand(bot, 'bed_dummy');
  check(bedOffer(bot.sim, bed) === 'tuck', `${def.id}: dummy in hand: Tuck in`);
  bot.act();
  check(dummyInBed(bot.sim) && !bot.st.sleeping, `${def.id}: tucked in, still up`);
  check(itemOf(bot.st.items.inv[bot.st.items.hand]) !== n('bed_dummy'), `${def.id}: out of their hand`);
  check(bedOffer(bot.sim, bed) === 'takeOut', `${def.id}: dummy in bed: Take out`);
  bot.act();
  check(!dummyInBed(bot.sim) && !bot.st.sleeping, `${def.id}: taken out, still up`);
  check(bot.st.items.inv.slice(0, HOTBAR).some((v) => itemOf(v) === n('bed_dummy')), `${def.id}: in their pockets`);
  check(itemOf(bot.st.items.inv[bot.st.items.hand]) !== n('bed_dummy'), `${def.id}: not in their hand`);
  check(bedOffer(bot.sim, bed) === null, `${def.id}: then Sleep`);
  bot.act();
  check(bot.st.sleeping, `${def.id}: asleep`);
}
{
  // Pockets full: it changes places with what's in hand, nothing lost, and the next press can always be Sleep.
  const full = atBed();
  const bed = bedIndex(full);
  full.st.items.containers[bed][containersOf(full.sim.world)[bed].hidden] = slot(n('bed_dummy'));
  for (let k = 0; k < HOTBAR; k++) full.st.items.inv[k] = slot(n('soap'));
  full.events.length = 0;
  full.act();
  check(!dummyInBed(full.sim) && !full.st.sleeping && itemOf(full.st.items.inv[full.st.items.hand]) === n('bed_dummy'), 'pockets full: the dummy in hand');
  check(full.st.items.containers[bed].some((v) => itemOf(v) === n('soap')), 'and what was in hand in the bed');
  check(full.events.some((e) => e.type === 'bedDummy' && e.swapped === n('soap')), 'and they are told');
  check(bedOffer(full.sim, bed) === 'tuck', 'so Tuck in');
  full.st.items.hand = (full.st.items.hand + 1) % HOTBAR;
  check(bedOffer(full.sim, bed) === null, 'another slot held, and it is Sleep: never stuck');

  // The wrong press from a full bed and full pockets: tuck (the pillow to the hand), take out (back), and sleep.
  const tucked = atBed();
  const b3 = bedIndex(tucked);
  for (let k = 0; k < HOTBAR; k++) tucked.st.items.inv[k] = slot(n('soap'));
  tucked.st.items.inv[0] = slot(n('bed_dummy'));
  tucked.st.items.hand = 0;
  const pillow = tucked.st.items.containers[b3][0];
  tucked.act();
  check(dummyInBed(tucked.sim) && tucked.st.items.inv[0] === pillow, 'full pockets, a full bed: tucked in, the pillow in hand');
  tucked.act();
  check(!dummyInBed(tucked.sim) && tucked.st.items.containers[b3][0] === pillow && itemOf(tucked.st.items.inv[0]) === n('bed_dummy'), 'taken out, the pillow back');
  tucked.st.items.hand = 1;
  tucked.act();
  check(tucked.st.sleeping, 'and they sleep');

  // A full bed (its pillow and sheet, as it starts): the dummy goes in, and what it replaces comes into the hand.
  const packed = atBed();
  const b2 = bedIndex(packed);
  const first = packed.st.items.containers[b2][0];
  check(packed.st.items.containers[b2].every((v) => v), 'a bed starts full');
  inHand(packed, 'bed_dummy');
  packed.act();
  check(dummyInBed(packed.sim) && packed.st.items.inv[packed.st.items.hand] === first, 'a full bed: swapped, nothing lost');

  // By day the bed is searched as ever, the dummy no different.
  const day = new Bot(CENTER_PERKS, 3);
  inHand(day, 'bed_dummy');
  put(day, placesOf(day.sim.world).bedside[1]);
  day.act();
  check(!day.st.sleeping && !dummyInBed(day.sim) && day.st.items.open === bedIndex(day), 'by day the bed opens');

  // The old rules: the button only sleeps.
  const old = atBed();
  old.sim.rules227 = true;
  inHand(old, 'bed_dummy');
  // (Facing the bed: by these rules a chair beside it takes the button otherwise.)
  old.st.player.facing = [1, 5, 9, 13].find((f) => interactTarget(old.sim.world, old.st.items, { ...old.st.player, facing: f }, old.sim.bedtime, old.st.layer)?.kind === 'sleep') ?? old.st.player.facing;
  old.act();
  check(old.st.sleeping && !dummyInBed(old.sim), 'the old rules: the bed only sleeps');
  console.log('the bed: Tuck in, Take out, then Sleep in all five; full pockets and a full bed swap, nothing lost and never stuck; by day and in old runs as ever');
}

// ------------------------------------------------------------------ bed checks
{
  const check1 = (bot: Bot, minutes = 180) => {
    bot.silent = true;
    for (let k = 0; k < minutes * STEPS_PER_MINUTE && !bot.events.some((e) => e.type === 'bedCheck' && e.result !== 'start'); k++) bot.step();
    return bot.events.find((e) => e.type === 'bedCheck' && e.result !== 'start');
  };
  const awake = atBed();
  const a = check1(awake);
  check(a?.type === 'bedCheck' && a.result === 'pass' && !!a.awake, 'up in the cell: there, and the guard says so');
  check(awake.st.heat === 0, 'at no cost');
  const asleep = atBed();
  asleep.act();
  const b = check1(asleep);
  check(b?.type === 'bedCheck' && b.result === 'pass' && !b.awake, 'asleep: passed, nothing said');
  const out = atBed();
  inHand(out, 'bed_dummy');
  out.act();
  check(dummyInBed(out.sim), 'the dummy tucked in at night');
  // (Away, and out of anyone's sight: down a tunnel.)
  out.st.layer = LAYER.UNDER;
  const c = check1(out);
  check(c?.type === 'bedCheck' && c.result === 'pass' && !!c.dummy, 'tucked in at night, it fools the check');
  console.log('bed checks: up in the cell passes with a word; asleep passes; a dummy tucked in at night fools them');
}

// ------------------------------------------------------------------ the whole night, inmates too
for (const def of PRISONS) {
  const late: number[] = [];
  for (const seed of [3, 11, 29, 47]) {
    const bot = new Bot(def, seed);
    check(bot.routineUntil(1, NIGHT), `${def.id}: the bell`);
    const from = bot.st.step;
    check(bot.walkTo(placesOf(bot.sim.world).bedside[1]), `${def.id} seed ${seed}: home`);
    check(bot.until(() => bot.st.inmates.every((m) => m.doing === DOING.SLEEP), 90 * STEPS_PER_MINUTE), `${def.id} seed ${seed}: everyone in bed`);
    late.push((bot.st.step - from) / STEPS_PER_MINUTE);
    bot.act();
    check(bot.st.sleeping, `${def.id} seed ${seed}: the player asleep`);
    check(bot.until(() => !bot.st.sleeping, 600 * STEPS_PER_MINUTE), `${def.id} seed ${seed}: wakes`);
    check(bot.sim.clock.minuteOfDay === 7 * 60 + 55, `${def.id} seed ${seed}: at 07:55 (${bot.time})`);
    check(bot.st.heat === 0 && !bot.st.lockdown, `${def.id} seed ${seed}: a quiet night`);
  }
  console.log(`${def.id}: every inmate in bed by ${late.map((s) => Math.ceil(s)).join(', ')} s; the player woken at 07:55`);
}

// ------------------------------------------------------------------ saves and older runs
{
  // A run that reaches the night, with something the new rules would change: the walk through Stalag's searchlights.
  const stalag = PRISONS.find((d) => d.id === 'stalag-flucht')!;
  const played = new Bot(stalag, 3);
  played.sim.rules227 = true;
  played.sim.rules228 = true;
  played.sim.rules229 = true;
  played.sim.rules230 = true;
  played.routineUntil(1, NIGHT + 20);
  check(played.st.heat > 0, 'the old rules: the searchlight on the walk home');
  const logOf = (game: string, rules227: boolean) => {
    const sim = new Sim(stalag, 3);
    sim.rules227 = rules227;
    sim.rules228 = rules227;
    sim.rules229 = rules227;
    sim.rules230 = rules227;
    const rec = new RunRecorder(sim, { seed: 3, game });
    for (const c of played.cmds) rec.step(c);
    return rec;
  };
  const prev = logOf('2.27.0', true);
  const replayed = replayLog(prev.toLog(), stalag);
  check(!!replayed?.ok && replayed.sim.rules227 === true && replayed.sim.state.heat > 0, 'a 2.27 log through the night replays whole under the old rules');
  check(!replayLog({ ...prev.toLog(), game: '2.31.0' }, stalag)?.ok, 'and would not under the new ones: the test can tell');
  check(new RunRecorder(prev.sim, { log: prev.toLog(), game: '2.31.0' }).toLog().seed === -1, 'and is not carried on');
  const now = logOf('2.31.0', false);
  const again = replayLog(now.toLog(), stalag);
  check(!!again?.ok && again.sim.rules227 === false, "a log of today's replays under today's rules");
  check(new RunRecorder(now.sim, { log: now.toLog(), game: '2.31.1' }).toLog().seed === 3, 'and is carried on');
  console.log('older runs: a 2.27 log replays as it was and is not carried on; a new one is');
}

// ------------------------------------------------------------------ the words
{
  for (const k of ['act.tuckIn', 'act.takeOut', 'routine.homeBy', 'toast.slept', 'toast.dummyIn', 'toast.dummyOut', 'toast.tiredNight', 'toast.nightWarning', 'hint.night', 'hint.noSleep'] as const) {
    check(!!en[k] && !!fr[k] && (en[k] !== fr[k] || k === 'toast.slept'), `said in both languages: ${k}`);
  }
  check(barksEn['re.bedAwake.gu'].length === barksFr['re.bedAwake.gu'].length, 'the guard has as much to say in French');
  console.log('the words: in both languages');
}
