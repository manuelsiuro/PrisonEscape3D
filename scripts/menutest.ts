/**
 * The menu board and the water cooler (2.33): every prison's board and cooler and the places beside it, the day's
 * dishes and what a tray gives, the board read and scribbled on by real commands (seen and unseen, walked off, once a
 * day, wiped by morning, laughed at), a cup drunk (and refused), a heatwave cooled, inmates at the cooler on many
 * seeds, and old logs as they were.
 */
import { BREAKFASTS, DINNERS, HOUSE_DINNER, MEAL, MENU, SCRIBBLE_HEAT, SCRIBBLE_STEPS } from '../src/content/menu';
import { COOLER_FROM_DAY, CUP_ENERGY, THIRST_STEPS } from '../src/content/cooler';
import { DECOR } from '../src/content/decor';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { SAN_PANCHO } from '../src/content/prisons/san-pancho';
import { TRAINING } from '../src/content/prisons/training';
import { ROUTINE } from '../src/content/routine';
import { isFloor, placesOf } from '../src/sim/ai/places';
import { canSee } from '../src/sim/ai/sight';
import { EXT, OP } from '../src/sim/command';
import { replayLog, RunRecorder } from '../src/sim/runlog';
import { Sim } from '../src/sim/Sim';
import { DAY_STEPS, keepOldCards, planOf, prisonDay, today } from '../src/sim/systems/calendar';
import { DAY_BOOKS } from '../src/content/days';
import { atCooler, coolerOffer, coolerProp, drinkRefusal, twoAtCooler } from '../src/sim/systems/cooler';
import { hurt } from '../src/sim/systems/fights';
import { awake } from '../src/sim/systems/guards';
import { fixtureUse } from '../src/sim/systems/items';
import { atMenu, dishNow, dishOn, feastOn, menuOffer } from '../src/sim/systems/menu';
import { canDigFloor, reserved } from '../src/sim/systems/structure';
import { COLD_STEPS, MEAL_ENERGY, STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/World';
import { Bot, DIR, tileOf } from './bots';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const ALL = [...PRISONS, TRAINING];
const menuOp = (bot: Bot, b: number) => bot.op(OP.EXT, EXT.MENU, b);
const seen = (bot: Bot) => bot.st.guards.some((g) => awake(g) && canSee(bot.sim.world, g.body, bot.st.player));
const refusals = (bot: Bot) => bot.sim.events.filter((e) => e.type === 'refused').map((e) => (e as { why: string }).why);

// ------------------------------------------------------------------ every prison's board and cooler
{
  const lines: string[] = [];
  for (const def of ALL) {
    const sim = new Sim(def, 3);
    const w = sim.world;
    const m = def.menu!;
    const c = def.cooler!;
    check(!!m && !!c, `${def.id}: a menu board and a water cooler`);
    // The board: the decor's frame over the same tiles, floor in the canteen in front of a wall.
    const decor = (def.decor ?? []).find((d) => d.kind === 'menuBoard');
    check(
      !!decor && decor.x === m.x && decor.z === m.z && (decor.w ?? 1) === m.w && (decor.rot ?? 0) === 0 && DECOR.menuBoard.wall,
      `${def.id}: the board's frame is the decor's, over the same tiles`,
    );
    for (let x = m.x; x < m.x + m.w; x++) {
      check(
        w.zoneAt(x, m.z) === 'canteen' && !w.blocked(x, m.z) && w.blocked(x, m.z - 1),
        `${def.id}: the board's tile ${x},${m.z} is canteen floor against the wall`,
      );
    }
    // The cooler: a prop, last, solid, in the canteen; its places beside it free floor, nobody else's.
    const p = coolerProp(sim);
    check(!!p && w.props.indexOf(p!) === w.props.length - 1, `${def.id}: the cooler's prop comes last, so that no index moves`);
    check(
      w.propSolid[c.z * MAP_W + c.x] === 1 && w.zoneAt(c.x, c.z) === 'canteen' && fixtureUse(w, p!) === 'cooler',
      `${def.id}: the cooler stands solid in the canteen`,
    );
    check(!(def.decor ?? []).some((d) => (d.kind as string) === 'waterCooler'), `${def.id}: no decor cooler left under it`);
    const pl = placesOf(w);
    const stops = new Set(def.guards.flatMap((g) => g.beat.map((b) => b.z * MAP_W + b.x)));
    const vline = new Set((def.vending?.line ?? []).map((t) => t.z * MAP_W + t.x));
    const counters = new Set(pl.counters.map((s) => s.tile));
    const seats = new Set(pl.seats.map((s) => s.tile));
    check(!stops.has(c.z * MAP_W + c.x), `${def.id}: the cooler isn't on a guard's stop`);
    check(c.spots.length === 2, `${def.id}: two places to drink at`);
    for (const s of c.spots) {
      const t = s.z * MAP_W + s.x;
      check(isFloor(w, s.x, s.z) && w.zoneAt(s.x, s.z) === 'canteen', `${def.id}: drink place ${s.x},${s.z} is canteen floor`);
      check(Math.max(Math.abs(s.x - c.x), Math.abs(s.z - c.z)) === 1, `${def.id}: drink place ${s.x},${s.z} is beside the cooler`);
      // (A counter's place is the meals' only, the cooler's the free times': Stalag Flucht's corner shares one.)
      check(
        !stops.has(t) && !vline.has(t) && !seats.has(t),
        `${def.id}: drink place ${s.x},${s.z} is nobody else's (a guard's stop, the machine's line, a seat)`,
      );
      if (counters.has(t)) lines.push(`${def.id}: ${s.x},${s.z} is also a place at the counter at meals`);
      check(!(m.z === s.z && s.x >= m.x && s.x < m.x + m.w), `${def.id}: drink place ${s.x},${s.z} isn't where the board is read`);
    }
    // (Old runs: the cooler was walked through and dug beside as decor.)
    const old = new Sim(def, 3);
    old.rules232 = true;
    old.rules2331 = true;
    old.rules233 = true;
    old.rules234 = true;
    check(
      old.world.propSolid[c.z * MAP_W + c.x] === 0 && fixtureUse(old.world, old.world.props[old.world.props.length - 1]) === undefined,
      `${def.id}: before 2.33 the cooler is decoration`,
    );
    check(
      canDigFloor(old.world, c.z * MAP_W + c.x, []) === canDigFloor(new Sim(def, 3).world, c.z * MAP_W + c.x, []) ||
        !canDigFloor(sim.world, c.z * MAP_W + c.x, []),
      `${def.id}: digging under the cooler as it was`,
    );
    // (And where nobody may dig, as it was then: the chokepoints a solid cooler or machine made aren't there in an old run.)
    const was = new Sim(def, 3);
    was.rules231 = true;
    was.rules232 = true;
    was.rules2331 = true;
    was.rules233 = true;
    was.rules234 = true;
    const bare = new Sim({ ...def, props: def.props.filter((q) => q.kind !== 'vending' && q.kind !== 'cooler') }, 3);
    // (The old map: the checkpoint's booth only drawn too, as before 2.33.2.)
    bare.rules2331 = true;
    bare.rules233 = true;
    bare.rules234 = true;
    check(
      [...reserved(was.world)].sort().join() === [...reserved(bare.world)].sort().join(),
      `${def.id}: before 2.32 the tiles nobody may dig are the map's without the machine and the cooler`,
    );
    lines.push(
      `${def.id} board ${m.x}–${m.x + m.w - 1},${m.z}, cooler ${c.x},${c.z} (drink at ${c.spots.map((s) => `${s.x},${s.z}`).join(' ')})`,
    );
  }
  console.log(`places: ${lines.join('; ')}`);
}

// ------------------------------------------------------------------ the dishes
{
  const salt = new Sim(CENTER_PERKS, 3).state.salt;
  const out: string[] = [];
  for (const def of PRISONS) {
    check(
      dishOn(salt, def.id, 1, MEAL.BREAKFAST) === BREAKFASTS[0] && dishOn(salt, def.id, 1, MEAL.DINNER) === DINNERS[0],
      `${def.id}: the first day serves the plain tray`,
    );
    check(
      BREAKFASTS[0].energy === MEAL_ENERGY && DINNERS[0].energy === MEAL_ENERGY && !BREAKFASTS[0].health && !DINNERS[0].health,
      'the plain tray is the old one',
    );
    const sums = [0, 0];
    const hps = [0, 0];
    let repeats = 0;
    let house = 0;
    const DAYS = 60;
    for (let d = 2; d <= DAYS + 1; d++)
      for (const meal of [MEAL.BREAKFAST, MEAL.DINNER]) {
        const dish = dishOn(salt, def.id, d, meal);
        sums[meal] += dish.energy;
        hps[meal] += dish.health ?? 0;
        if (dishOn(salt, def.id, d - 1, meal) === dish) repeats++;
        if (dish === HOUSE_DINNER[def.id]) house++;
      }
    check(repeats === 0, `${def.id}: never the same dish two days running`);
    check(house > 0, `${def.id}: its own dinner comes up`);
    const avg = (sums[0] + sums[1]) / (DAYS * 2);
    check(avg >= 30 && avg <= 40, `${def.id}: a tray gives about what it did on average (${avg.toFixed(1)})`);
    out.push(
      `${def.id} breakfast ${(sums[0] / DAYS).toFixed(1)} energy +${(hps[0] / DAYS).toFixed(1)} health, dinner ${(sums[1] / DAYS).toFixed(1)} +${(hps[1] / DAYS).toFixed(1)}, its own ${house}/${DAYS}`,
    );
  }
  console.log(`dishes over 60 days: ${out.join('; ')}`);
  // A feast beats the dish: the day's event, a holiday's.
  let feast = '';
  for (const def of PRISONS) {
    const sim = new Sim(def, 3);
    for (let d = 2; d < 60 && !feast; d++) if (planOf(sim, d).event === 'feast') feast = `${def.id} day ${d}: ${feastOn(sim, d)}`;
  }
  check(feast.endsWith('roast'), `a feast day's dinner is the roast (${feast})`);
  const easter = new Sim(CENTER_PERKS, 3, [], 1);
  check(feastOn(easter, 2) === 'lamb' || feastOn(easter, 2) === null, "a holiday's feast is its own");
}

// ------------------------------------------------------------------ a meal gives the day's dish
{
  const bot = new Bot(CENTER_PERKS, 3);
  bot.routineUntil(2, 9 * 60 + 2);
  const dish = dishNow(bot.sim)!;
  check(!!dish && dish === dishOn(bot.st.salt, CENTER_PERKS.id, 2, MEAL.BREAKFAST), "day 2's breakfast is the board's");
  const counter = placesOf(bot.sim.world).counters[0];
  bot.st.player.x = (counter.tile % MAP_W) * UNIT + UNIT / 2;
  bot.st.player.z = Math.floor(counter.tile / MAP_W) * UNIT + UNIT / 2;
  bot.st.player.facing = counter.face;
  bot.act();
  check(bot.st.tray === 1, 'a tray taken');
  const seat = placesOf(bot.sim.world).seats.find((s) => !bot.st.inmates.some((m) => m.goal === s.tile || m.seat === s.tile))!;
  bot.st.player.x = (seat.tile % MAP_W) * UNIT + UNIT / 2;
  bot.st.player.z = Math.floor(seat.tile / MAP_W) * UNIT + UNIT / 2;
  bot.st.player.facing = seat.face;
  bot.st.energy = 20;
  bot.st.health = 10;
  bot.act();
  check(
    bot.until(() => bot.events.some((e) => e.type === 'meal'), 400),
    'eaten',
  );
  const meal = bot.events.find((e) => e.type === 'meal') as { n?: number; hp?: number; dish?: string };
  check(
    meal.dish === dish.id && meal.n === dish.energy && (meal.hp ?? 0) === (dish.health ?? 0),
    `the event says what it gave (${meal.dish} +${meal.n})`,
  );
  // (Sitting brings a little energy back too, a point every so often.)
  check(bot.st.energy >= 20 + dish.energy, `energy up by the dish's (${dish.energy}) at least`);
  console.log(`a meal on day 2 at center-perks: ${dish.id}, +${dish.energy} energy${dish.health ? `, +${dish.health} health` : ''}`);
}

// ------------------------------------------------------------------ the board read and scribbled on, walked by real commands
{
  const out: string[] = [];
  for (const def of ALL) {
    const bot = new Bot(def, 3);
    bot.routineUntil(1, 10 * 60 + 5);
    const m = def.menu!;
    // (Its middle tile, or the one beside the middle when that's a seat.)
    const tx = m.x + Math.floor((m.w - 1) / 2);
    const walked = bot.walkTo(tileOf(tx, m.z)) || bot.walkTo(tileOf(m.x + m.w - 1, m.z));
    check(walked, `${def.id}: walks to the board`);
    bot.face(DIR.NORTH);
    check(atMenu(bot.sim) && menuOffer(bot.sim), `${def.id}: faced, the board is the action button's`);
    bot.act();
    check(bot.st.menuOpen, `${def.id}: its card opens`);
    bot.face(DIR.SOUTH);
    bot.step(0);
    const stillUp = bot.st.menuOpen;
    // (Turned round on the spot: still at it. Walked off: shut.)
    bot.walkTo(tileOf(tx, m.z + 3));
    check(!bot.st.menuOpen, `${def.id}: walking off shuts it`);
    out.push(`${def.id} read at ${bot.time}${stillUp ? '' : ' (turning round shut it)'}`);
  }
  console.log(`the board: ${out.join('; ')}`);
}

/** At the board in the morning's free time, card up, guards out of the way or not. */
function atBoard(def = CENTER_PERKS, seed = 3, clear = true) {
  const bot = new Bot(def, seed);
  bot.routineUntil(2, 10 * 60 + 5);
  const m = def.menu!;
  const t = tileOf(m.x + m.w - 1, m.z);
  bot.walkTo(t);
  bot.face(DIR.NORTH);
  if (clear) for (const g of bot.st.guards) g.body.x = g.body.z = UNIT / 2;
  return bot;
}
{
  // Unseen: two seconds, then up till the morning.
  const bot = atBoard();
  check(!seen(bot), 'nobody sees the player at the board');
  menuOp(bot, MENU.SCRIBBLE);
  check(bot.st.menuOpen && bot.st.menu.until > 0, 'a scribble under way (its card open)');
  bot.until(() => bot.st.menu.scribbled > 0, SCRIBBLE_STEPS + 5);
  const day = prisonDay(bot.st.step);
  check(bot.st.menu.scribbled === day && bot.st.heat === 0, 'scribbled, in two seconds, no heat');
  menuOp(bot, MENU.SCRIBBLE);
  check(refusals(bot).includes('menuScribbled') && bot.st.menu.until === 0, 'once a day: refused, nothing begun');
  // Inmates who see it laugh, once each, liking the player.
  const before = bot.st.inmates.map((im) => im.opinion);
  bot.routineUntil(2, 17 * 60 + 30);
  const laughed = bot.st.menu.laughed.length;
  check(
    laughed > 0 && bot.st.menu.laughed.every((k) => bot.st.inmates[k].opinion >= before[k]),
    `inmates laugh at it by dinner (${laughed})`,
  );
  check(new Set(bot.st.menu.laughed).size === laughed, 'each once');
  bot.routineUntil(3, 8 * 60 + 5);
  check(bot.st.menu.scribbled === 0 && bot.st.menu.laughed.length === 0, 'wiped by the morning');
  console.log(`scribbled unseen at center-perks: done in ${SCRIBBLE_STEPS / 20} s, ${laughed} inmates laughed by 17:30, wiped by day 3`);
}
{
  // Seen: told off, a little heat, not finished. (At a meal, when a guard on its round is actually watching.)
  let caught = '';
  for (const def of PRISONS) {
    const bot = new Bot(def, 3);
    bot.routineUntil(2, 9 * 60 + 3);
    const m = def.menu!;
    bot.walkTo(tileOf(m.x + m.w - 1, m.z));
    bot.face(DIR.NORTH);
    if (!bot.until(() => seen(bot) && atMenu(bot.sim), 30 * STEPS_PER_MINUTE)) continue;
    const heat = bot.st.heat;
    menuOp(bot, MENU.SCRIBBLE);
    bot.until(() => bot.st.menu.until === 0, SCRIBBLE_STEPS + 5);
    if (!bot.events.some((e) => e.type === 'menu' && e.what === 'caught')) continue;
    check(bot.st.menu.scribbled === 0, `${def.id}: caught at it, not finished`);
    check(bot.st.heat === Math.min(heat + SCRIBBLE_HEAT, 99), `${def.id}: told off, +${SCRIBBLE_HEAT}% heat`);
    check(!bot.events.some((e) => e.type === 'spotted'), `${def.id}: told off, not spotted at anything`);
    caught = `${def.id} at ${bot.time}`;
    break;
  }
  check(!!caught, 'a guard watching catches a scribble somewhere');
  console.log(`caught scribbling: ${caught}`);
}
{
  // Walked off mid-scribble: stopped, nothing up. A blow ends it too.
  const bot = atBoard();
  menuOp(bot, MENU.SCRIBBLE);
  bot.step(0);
  bot.face(DIR.SOUTH);
  check(bot.st.menu.until === 0 && bot.st.menu.scribbled === 0, 'a step away stops it');
  const hit = atBoard();
  menuOp(hit, MENU.SCRIBBLE);
  hurt(hit.sim, 1, -1);
  check(!hit.st.menuOpen && hit.st.menu.until === 0, 'a blow shuts the card and stops the scribble');
  // Not at it: refused.
  const far = new Bot(CENTER_PERKS, 3);
  far.routineUntil(1, 10 * 60 + 5);
  menuOp(far, MENU.SCRIBBLE);
  check(refusals(far).includes('menuFar') && far.st.menu.until === 0, 'away from it: refused');
}

// ------------------------------------------------------------------ a cup at the cooler, walked by real commands
{
  const out: string[] = [];
  for (const def of ALL) {
    const bot = new Bot(def, 3);
    bot.routineUntil(1, 10 * 60 + 5);
    const c = def.cooler!;
    const s = c.spots[0];
    check(bot.walkTo(tileOf(s.x, s.z)), `${def.id}: walks to the cooler`);
    const dx = c.x - s.x;
    bot.face(dx > 0 ? DIR.EAST : dx < 0 ? DIR.WEST : c.z > s.z ? DIR.SOUTH : DIR.NORTH);
    check(atCooler(bot.sim) && coolerOffer(bot.sim), `${def.id}: faced, the cooler is the action button's`);
    bot.st.energy = 50;
    bot.act();
    check(bot.st.energy === 50 + CUP_ENERGY && bot.st.drank > 0, `${def.id}: a cup, +${CUP_ENERGY} energy`);
    const at = bot.st.drank;
    bot.act();
    check(
      bot.st.energy <= 50 + CUP_ENERGY + 1 && bot.st.drank === at && refusals(bot).includes('notThirsty'),
      `${def.id}: again at once: not thirsty, nothing counted`,
    );
    out.push(`${def.id} at ${bot.time}`);
  }
  console.log(`a cup: ${out.join('; ')}`);
  // Half an hour on, another; full and cool, refused.
  const bot = new Bot(CENTER_PERKS, 3);
  bot.routineUntil(1, 10 * 60 + 5);
  const c = CENTER_PERKS.cooler!;
  bot.walkTo(tileOf(c.spots[0].x, c.spots[0].z));
  bot.face(DIR.NORTH);
  bot.st.energy = 50;
  bot.act();
  bot.until(() => false, THIRST_STEPS);
  bot.st.energy = 60;
  const before = bot.st.drank;
  bot.act();
  check(bot.st.drank > before && bot.st.energy >= 60 + CUP_ENERGY, 'half an hour on, another cup');
  bot.until(() => false, THIRST_STEPS);
  bot.st.energy = 100;
  const at = bot.st.drank;
  bot.act();
  check(bot.st.drank === at && refusals(bot).includes('notThirsty'), 'full and cool: not thirsty, nothing counted');
  // A tray in both hands: told why (a meal's tray, so a moment's check of the rule).
  bot.until(() => false, THIRST_STEPS);
  bot.st.tray = 1;
  bot.st.energy = 50;
  check(drinkRefusal(bot.sim) === 'coolerTray', 'a tray in both hands: refused with a reason');
  bot.st.tray = 0;
}
{
  // A heatwave's heat: gone with a cup, as under a shower.
  let found: Bot | null = null;
  for (let seed = 1; seed < 40 && !found; seed++) {
    const sim = new Sim(SAN_PANCHO, seed);
    for (let d = 1; d <= 3 && !found; d++)
      if (planOf(sim, d).weather === 'heatwave') {
        const bot = new Bot(SAN_PANCHO, seed);
        bot.routineUntil(d, 13 * 60);
        if (today(bot.sim).weather === 'heatwave') found = bot;
      }
  }
  check(!!found, 'a heatwave found at San Pancho');
  if (found) {
    const bot = found;
    const c = SAN_PANCHO.cooler!;
    bot.walkTo(tileOf(c.spots[0].x, c.spots[0].z));
    bot.face(DIR.EAST);
    bot.st.cold = COLD_STEPS;
    bot.st.frozen = true;
    bot.st.energy = 100;
    bot.act();
    bot.step(0);
    check(bot.st.cold === 0 && !bot.st.frozen, 'hot, a cup cools the player at once (even at full energy)');
    console.log(`a heatwave at san-pancho on ${bot.time}: cooled by a cup`);
  }
}

// ------------------------------------------------------------------ inmates at the cooler
{
  const out: string[] = [];
  for (const def of PRISONS) {
    let drinks = 0;
    let pairs = 0;
    let firstDay = 0;
    let lockdown = 0;
    const DAYS = 4;
    for (const seed of [3, 4, 5]) {
      const bot = new Bot(def, seed);
      let wasPair = false;
      let lastThere = [0, 0];
      for (let k = 0; k < DAYS * DAY_STEPS && !bot.done; k += 20) {
        bot.keepRoutine(() => false, 20);
        const q = bot.st.cooler;
        const day = prisonDay(bot.st.step);
        if (day < COOLER_FROM_DAY && q.who.some((w) => w >= 0)) firstDay++;
        if (bot.st.lockdown && q.who.some((w) => w >= 0)) lockdown++;
        const pair = twoAtCooler(bot.sim);
        if (pair && !wasPair) pairs++;
        wasPair = pair;
        q.there.forEach((t, i) => {
          if (t && t !== lastThere[i]) drinks++;
        });
        lastThere = [...q.there];
      }
    }
    check(firstDay === 0, `${def.id}: nobody at the cooler on the first day`);
    check(lockdown === 0, `${def.id}: nobody at it in a lockdown`);
    check(drinks > 0 && pairs > 0, `${def.id}: inmates drink at it, two at once now and then`);
    out.push(`${def.id}: ${(drinks / 9).toFixed(1)} cups a day, two at once ${(pairs / 9).toFixed(1)} times a day`);
  }
  console.log(`inmates (days 2–4, seeds 3–5): ${out.join('; ')}`);
  // None at the Training Block.
  const t = new Bot(TRAINING, 3);
  t.keepRoutine(() => false, 2 * DAY_STEPS);
  check(
    t.st.cooler.who.every((k) => k < 0),
    'nobody else drinks at the Training Block',
  );
}

// ------------------------------------------------------------------ old logs as they were
{
  const was = new Sim(CENTER_PERKS, 24);
  was.rules232 = true;
  was.rules2331 = true;
  was.rules233 = true;
  was.rules234 = true;
  was.rules235 = true;
  // (Played then, with the week's cards as they were: the gang war's place held by the card it took, 2.36.)
  keepOldCards(was.state, [1, 2, 3], (d) => planOf(was, d).event, { gangWar: DAY_BOOKS['center-perks'].beforeGangs! });
  const prev = new RunRecorder(was, { seed: 24, game: '2.32.0' });
  for (let k = 0; k < 34 * 60 * STEPS_PER_MINUTE && prev.sim.state.step < DAY_STEPS + 9 * 60 * STEPS_PER_MINUTE; k++) prev.step(0);
  check(dishNow(prev.sim) === null, 'the old rules: no dish');
  const replayed = replayLog(prev.toLog(), CENTER_PERKS);
  check(!!replayed?.ok && replayed.sim.rules232 === true, 'a 2.32 log replays whole under the old rules');
  check(new RunRecorder(prev.sim, { log: prev.toLog(), game: '2.36.0' }).toLog().seed === -1, 'and is not carried on');
  const now = new RunRecorder(new Sim(CENTER_PERKS, 24), { seed: 24, game: '2.37.0' });
  for (let k = 0; k < 2 * 60 * STEPS_PER_MINUTE; k++) now.step(0);
  check(!!replayLog(now.toLog(), CENTER_PERKS)?.ok, "a log of today's replays");
  check(new RunRecorder(now.sim, { log: now.toLog(), game: '2.37.0' }).toLog().seed === 24, 'and is carried on');
  // Under the old rules, no card, no cup.
  const old = new Bot(CENTER_PERKS, 3);
  old.sim.rules232 = true;
  old.sim.rules2331 = true;
  old.sim.rules233 = true;
  old.sim.rules234 = true;
  old.routineUntil(1, 10 * 60 + 5);
  const m = CENTER_PERKS.menu!;
  old.walkTo(tileOf(m.x + 1, m.z));
  old.face(DIR.NORTH);
  old.act();
  check(!old.st.menuOpen && !menuOffer(old.sim), 'the old rules: the board does nothing');
  console.log('older runs: a 2.32 log replays as it was and is not carried on; a new one is');
}

// (Keep the routine's shape in view: the meals this all hangs on.)
check(ROUTINE.some((r) => r.id === 'breakfast') && ROUTINE.some((r) => r.id === 'dinner'), 'breakfast and dinner in the routine');

console.log(failures ? `${failures} failures` : 'all good');
if (failures) process.exit(1);
