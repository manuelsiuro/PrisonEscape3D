/**
 * The library (2.31): reading as its own game, the day's limit, subjects and what's next, readers, chairs and the
 * librarian, in every prison, walked by real commands. 2.34: the marker at half the speed, waiting at each key
 * word; slow readers measured. Old logs play as they did.
 */
import {
  keyAt,
  keyFrom,
  pageTokens,
  READ_GAPS,
  READ_KEYS,
  READ_PACE,
  READ_PAGE_STEPS,
  READ_TAIL,
  SUBJECTS,
  subjectOf,
} from '../src/content/books';
import { zoneIndex } from '../src/content/zones';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';
import { RECIPES } from '../src/content/recipes';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { DOING } from '../src/sim/ai/doing';
import { placesOf } from '../src/sim/ai/places';
import { command, OP } from '../src/sim/command';
import { replayLog, RunRecorder } from '../src/sim/runlog';
import { Sim } from '../src/sim/Sim';
import { clockAt } from '../src/sim/systems/clock';
import { interactTarget } from '../src/sim/systems/items';
import { nextTip, nextUnlock, suggestSubject, toLearn, usableHere } from '../src/sim/systems/recipes';
import { freeReadSeat, headFull, librarianOf, readSeated } from '../src/sim/systems/training';
import { canDigFloor } from '../src/sim/systems/structure';
import {
  ATTR_MAX,
  READ_FILL_EVERY,
  READ_HIT,
  READ_LEAD,
  READ_SETS_A_DAY,
  READ_WAIT,
  READ_WINDOW,
  STEPS_PER_SECOND,
  UNIT,
} from '../src/sim/tuning';
import { containersOf } from '../src/sim/world/containers';
import { MAP_W } from '../src/sim/world/World';
import { loadSave, saveFileOf, type SaveFile } from '../src/game/saves';
import { Bot } from './bots';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL: ${what}`);
  }
};
const at = (t: number) => [t % MAP_W, Math.floor(t / MAP_W)];
const shelfOf = (bot: Bot) =>
  containersOf(bot.sim.world).findIndex((b) => b.prop.kind === 'shelf' && bot.sim.world.zoneAt(b.prop.x, b.prop.z) === 'library');
const minute = (sim: Sim) => clockAt(sim.state.step).minuteOfDay;

// ---------------------------------------------------------------- the books as data
{
  const missing = RECIPES.filter((r) => subjectOf(r.result) < 0).map((r) => r.result);
  check(!missing.length, `every recipe has a subject (${missing.join(', ')})`);
  const counts = SUBJECTS.map((_, k) => RECIPES.filter((r) => subjectOf(r.result) === k).length);
  console.log(`recipes by subject: ${SUBJECTS.map((s, k) => `${s} ${counts[k]}`).join(', ')}`);
  for (const gaps of READ_GAPS)
    check(gaps.length === READ_KEYS && gaps.reduce((a, b) => a + b, 0) === READ_PAGE_STEPS, 'a page: its key words and its length');
  check(
    keyAt(0) === READ_GAPS[0][0] - READ_TAIL && keyAt(READ_KEYS) === READ_PAGE_STEPS + READ_GAPS[1][0] - READ_TAIL,
    'key words count on from page to page',
  );
  for (let k = 0; k < 40; k++)
    check(
      keyFrom(keyAt(k)) === k && keyFrom(keyAt(k) + READ_WINDOW, READ_WINDOW) === k && keyAt(k + 1) > keyAt(k),
      `key word ${k} found again`,
    );
  for (let k = 0; k < 40; k++)
    check(
      keyAt(k, READ_PACE) === keyAt(k) * READ_PACE &&
        keyFrom(keyAt(k, READ_PACE), 0, READ_PACE) === k &&
        keyFrom(keyAt(k, READ_PACE) - 1, 0, READ_PACE) === k,
      `2.34: key word ${k} at half the speed`,
    );
  // 2.34: lit from READ_LEAD before: never two lit at once, nor lit while the last is still waited on.
  for (const gaps of READ_GAPS) check(Math.min(...gaps) * READ_PACE > READ_LEAD + 1, 'key words far enough apart at the new pace');
  // The keys' gaps never fit in a window: the marker can't be near two at once.
  for (const gaps of READ_GAPS) check(Math.min(...gaps) > 2 * READ_WINDOW + 1, 'key words far enough apart to tell one from the next');
  // Every page in both languages: as many key words as the rule has.
  for (const [lang, table] of [
    ['en', en],
    ['fr', fr],
  ] as const)
    for (const s of SUBJECTS)
      for (let p = 0; p < READ_GAPS.length; p++) {
        const text = (table as Record<string, string>)[`book.${s}.p${p}`];
        const toks = text ? pageTokens(text) : [];
        check(
          toks.filter((w) => w.key).length === READ_KEYS,
          `${lang} ${s} page ${p}: ${READ_KEYS} key words (${toks.filter((w) => w.key).length})`,
        );
      }
}

// ---------------------------------------------------------------- every prison: the places, a book walked to a chair, a set
for (const def of PRISONS) {
  const bot = new Bot(def, 3);
  const w = bot.sim.world;
  const places = placesOf(w);
  const lib = def.leisure?.librarian;
  check(places.readSeats.length >= 2, `${def.id}: at least two chairs to read on (${places.readSeats.length})`);
  check(places.shelves.length >= 2, `${def.id}: shelf tiles to choose a book at (${places.shelves.length})`);
  check(
    !!lib && !def.merchants.includes(lib.cell) && def.smuggling?.fixer !== lib.cell && def.leisure?.oldTimer !== lib.cell,
    `${def.id}: the librarian is nobody else's job`,
  );
  check(!!lib && !places.readSeats.some((q) => q.tile === lib.z * MAP_W + lib.x), `${def.id}: the librarian's chair isn't one for readers`);
  const quiz = def.leisure?.quiz?.spots ?? [];
  for (const q of [...places.readSeats, ...places.shelves]) {
    const [x, z] = at(q.tile);
    check(!w.npcBlock[q.tile], `${def.id}: nothing blocks ${x},${z}`);
    check(!(def.comms?.kiosk.x === x && def.comms?.kiosk.z === z), `${def.id}: ${x},${z} isn't the kiosk's`);
  }
  check(!places.readSeats.some((q) => quiz.some((o) => o.z * MAP_W + o.x === q.tile)), `${def.id}: no chair on a quiz place`);
  // From every shelf tile, by real commands, whoever's about: its panel opens and it hands out a book.
  bot.routineUntil(1, 10 * 60 + 1);
  // (San Pancho's model prisoner is floored by 10:00 on every seed, as before 2.31: not what's being tested here.)
  bot.st.ko = 0;
  bot.st.health = 100;
  for (const m of bot.st.inmates) {
    m.angry = 0;
    m.opinion = 50;
  }
  for (const q of places.shelves) {
    const b = bot.st.player;
    bot.st.player.x = (q.tile % MAP_W) * UNIT + UNIT / 2;
    bot.st.player.z = Math.floor(q.tile / MAP_W) * UNIT + UNIT / 2;
    b.facing = q.face;
    bot.step(0);
    bot.act();
    const box = containersOf(w)[bot.st.items.open];
    check(!!box && box.prop.kind === 'shelf', `${def.id}: the shelf opens from ${at(q.tile)} (${bot.st.items.open}, talk ${bot.st.talk})`);
    if (bot.st.talk >= 0) bot.op(OP.CLOSE);
    bot.close();
  }
  // Inmates on the shelf tiles either side: the shelf the player faces, still.
  for (const q of places.shelves) {
    const others = places.shelves.filter((o) => o.tile !== q.tile);
    others.forEach((o, k) => {
      const m = bot.st.inmates[k];
      m.body.x = (o.tile % MAP_W) * UNIT + UNIT / 2;
      m.body.z = Math.floor(o.tile / MAP_W) * UNIT + UNIT / 2;
      m.goal = o.tile;
      m.doing = DOING.READ;
    });
    const b = bot.st.player;
    b.x = (q.tile % MAP_W) * UNIT + UNIT / 2;
    b.z = Math.floor(q.tile / MAP_W) * UNIT + UNIT / 2;
    b.facing = q.face;
    const t = interactTarget(w, bot.st.items, b, false, bot.st.layer, [...bot.st.inmates, ...bot.st.guards], bot.st.inmates.length);
    check(
      t?.kind === 'container' && containersOf(w)[t.index].prop.kind === 'shelf',
      `${def.id}: with readers either side, the shelf from ${at(q.tile)} (${t?.kind})`,
    );
  }
  // Walked: the shelf, a chair, a set, the book back on leaving.
  // (Someone between them and the shelf is who the button talks to, and says so: to the next tile, as anyone would.)
  for (const q of places.shelves) {
    bot.walkTo(q.tile);
    bot.face(q.face);
    if (bot.open(shelfOf(bot))) break;
    if (bot.st.talk >= 0) bot.op(OP.CLOSE);
  }
  const was = bot.st.items.int;
  const from = bot.st.step;
  bot.read(0);
  check(bot.st.book === 1, `${def.id}: a book taken`);
  check(bot.st.train >= 0, `${def.id}: reading (seat ${bot.st.seat})`);
  const sat = bot.st.seat >= 0;
  check(sat, `${def.id}: on a chair with it`);
  bot.set();
  check(bot.st.items.int === was + 2, `${def.id}: a set read (${bot.st.items.int})`);
  console.log(
    `${def.id}: shelf to a set done ${((bot.st.step - from) / STEPS_PER_SECOND).toFixed(1)} s, ${places.readSeats.length} chairs, ${places.shelves.length} shelf tiles, librarian in cell ${lib?.cell}`,
  );
  bot.op(OP.TRAIN, 3);
  check(bot.st.train < 0 && bot.st.seat >= 0 && bot.st.book === 1, `${def.id}: the book shut, still on the chair`);
  bot.act();
  check(bot.st.train >= 0, `${def.id}: the button opens it again`);
  bot.op(OP.CLOSE);
  check(bot.st.train < 0 && bot.st.seat < 0, `${def.id}: Close: up off the chair`);
  // Out of the door: the book stays.
  bot.walkTo(placesOf(w).floor[zoneIndex('corridor')][0], 2000);
  check(bot.st.book === 0, `${def.id}: the book left behind on leaving`);
}

// ---------------------------------------------------------------- the rules, at Center Perks
const reader = (seed = 3) => {
  const bot = new Bot(CENTER_PERKS, seed);
  bot.routineUntil(1, 10 * 60 + 1);
  bot.walkTo(placesOf(bot.sim.world).shelves[0].tile);
  bot.face(13);
  bot.open(shelfOf(bot));
  return bot;
};
// A reader who presses `react` steps after each key word lights up (READ_LEAD before the marker gets there): the steps a set takes, and the words missed.
const human = (react: number, old = false) => {
  const b = reader();
  if (old) b.sim.rules233 = true;
  b.read(0);
  const pace = old ? 1 : READ_PACE;
  const was = b.st.items.int;
  const t0 = b.st.step;
  let lit = -1;
  let litAt = 0;
  let missed = 0;
  while (b.st.items.int === was && b.st.step - t0 < 2000) {
    // (What the page shows next step: the first key word not underlined, lit.)
    const pos = b.st.step + 1 - b.st.readFrom;
    const k = keyFrom(pos, 0, pace);
    const on = k >= b.st.repBeat && keyAt(k, pace) - pos <= (old ? READ_WINDOW : READ_LEAD) ? k : -1;
    if (on !== lit) {
      lit = on;
      litAt = b.st.step;
    }
    const press = lit >= 0 && b.st.step - litAt === react;
    const beat = b.st.repBeat;
    b.step(press ? command(0, OP.TRAIN, 1) : 0);
    if (!press && b.st.repBeat > beat) missed++;
  }
  return { steps: b.st.step - t0, missed };
};
{
  // Hands off: the bar fills by itself, and slowly; the marker waits at each key word, then goes on.
  const idle = reader();
  idle.read(0);
  const was = idle.st.items.int;
  const start = idle.st.step;
  let waited = 0;
  idle.until(() => {
    waited = Math.max(waited, idle.st.readWait);
    return idle.st.items.int !== was;
  }, 2000);
  const alone = idle.st.step - start;
  check(alone >= 95 * READ_FILL_EVERY && alone <= 105 * READ_FILL_EVERY, `untouched, a set still finishes, slowly (${alone} steps)`);
  check(
    waited === READ_WAIT && idle.st.repBeat >= 2,
    `untouched, the marker waits ${READ_WAIT} steps at a key word, then goes on (${waited}, ${idle.st.repBeat} passed)`,
  );
  // Kept up with: on each key word as the marker reaches it.
  const kept = reader();
  kept.read(0);
  const k0 = kept.st.step;
  kept.set();
  const fast = kept.st.step - k0;
  check(fast >= 120 && fast <= 220, `kept up with, about 8 s a set (${fast} steps)`);
  console.log(
    `a set: ${(alone / STEPS_PER_SECOND).toFixed(1)} s untouched, ${(fast / STEPS_PER_SECOND).toFixed(1)} s kept up with, a hit worth ${READ_HIT}%`,
  );
  // Slow readers: a press 0.5, 1, 2 s after each word lights all count; 4 s is too late, and a set is no slower than untouched.
  const by = [10, 20, 40, 80].map((r) => ({ r, ...human(r) }));
  console.log(
    `pressing after a word lights: ${by.map((h) => `${h.r / STEPS_PER_SECOND} s → ${(h.steps / STEPS_PER_SECOND).toFixed(1)} s a set, ${h.missed} missed`).join('; ')}`,
  );
  for (const h of by.slice(0, 3))
    check(
      h.missed === 0 && h.steps < alone * 0.8,
      `a press ${h.r / STEPS_PER_SECOND} s after a word lights counts (${h.missed} missed, ${h.steps} steps)`,
    );
  check(
    by[3].missed > 0 && by[3].steps <= alone,
    `4 s after is too late, and no slower than untouched (${by[3].missed} missed, ${by[3].steps} steps)`,
  );
  // Tapping away gains nothing.
  const mash = reader();
  mash.read(0);
  const m0 = mash.st.step;
  const mw = mash.st.items.int;
  let hits = 0;
  while (mash.st.items.int === mw && mash.st.step - m0 < 2000) {
    mash.step(command(0, OP.TRAIN, 1));
    if (mash.sim.events.some((e) => e.type === 'rep' && e.hit)) hits++;
  }
  check(
    hits <= 1 && mash.st.step - m0 >= alone * 0.85,
    `tapping every step gains nothing (${hits} hits, ${mash.st.step - m0} steps against ${alone})`,
  );
  // Pressing blind at a steady rhythm, from 0.5 s to 6 s: never quicker than reading. (A rhythm of 2.5 to 4 s, started
  // at the right moment, lands in every lit word, as the marker waits there for the press: a reader's pace, and as
  // quick as one at best. A known limit of a marker that waits.)
  const blind: string[] = [];
  let quickest = Infinity;
  for (let every = 10; every <= 120; every += 10) {
    // (Its best of four starts: the first press at once, or a quarter, half, three quarters of the way into the rhythm.)
    let best = Infinity;
    for (let phase = 0; phase < 4; phase++) {
      const lazy = reader();
      lazy.read(0);
      const l0 = lazy.st.step - Math.floor((every * phase) / 4);
      const lw = lazy.st.items.int;
      while (lazy.st.items.int === lw && lazy.st.step - l0 < 2000)
        lazy.step((lazy.st.step - l0) % every === 0 ? command(0, OP.TRAIN, 1) : 0);
      best = Math.min(best, lazy.st.step - l0 - Math.floor((every * phase) / 4));
    }
    quickest = Math.min(quickest, best);
    blind.push(`${every / STEPS_PER_SECOND} s ${(best / STEPS_PER_SECOND).toFixed(1)}`);
  }
  console.log(`pressing blind every … (the best start): ${blind.join(', ')} s a set`);
  check(quickest >= fast, `no blind rhythm quicker than reading (${quickest} steps against ${fast})`);
  // From the moment it lights to the end of the wait counts, a step before doesn't, nor once the marker's gone on.
  const arrive = (b: Bot) => b.st.readFrom + keyAt(0, READ_PACE);
  for (const [off, should] of [
    [-READ_LEAD, true],
    [0, true],
    [READ_WAIT, true],
    [-READ_LEAD - 1, false],
  ] as const) {
    const b = reader();
    b.read(0);
    const target = arrive(b) + off;
    while (b.st.step + 1 < target) b.step(0);
    b.step(command(0, OP.TRAIN, 1));
    const e = b.sim.events.find((x) => x.type === 'rep');
    check(
      !!e && e.type === 'rep' && !!e.hit === should && e.key === 0,
      `a press ${off} steps from the marker reaching a key word: ${should ? 'counts' : 'does not'}`,
    );
  }
  {
    const b = reader();
    b.read(0);
    const target = arrive(b) + READ_WAIT + 1;
    while (b.st.step + 1 < target) b.step(0);
    check(
      b.st.repBeat === 1 && b.st.readWait === 0,
      `the wait over, the word's missed and the marker goes on (${b.st.repBeat}, ${b.st.readWait})`,
    );
    b.step(command(0, OP.TRAIN, 1));
    const e = b.sim.events.find((x) => x.type === 'rep');
    check(!!e && e.type === 'rep' && !e.hit && e.key === 1, 'a press then is stray, and spends the next');
  }
  // Under the old rules, as 2.31 had it: the marker never waits, a press within READ_WINDOW, about 5 s kept up with.
  const was231 = human(READ_WINDOW, true);
  check(was231.steps >= 60 && was231.steps <= 130 && was231.missed === 0, `the old rules: about 5 s a set kept up with (${was231.steps})`);
  for (const [off, should] of [
    [-READ_WINDOW, true],
    [READ_WINDOW, true],
    [-READ_WINDOW - 1, false],
    [READ_WINDOW + 1, false],
  ] as const) {
    const b = reader();
    b.sim.rules233 = true;
    b.sim.rules234 = true;
    b.read(0);
    const target = b.st.readFrom + keyAt(0) + off;
    while (b.st.step + 1 < target) b.step(0);
    b.step(command(0, OP.TRAIN, 1));
    const e = b.sim.events.find((x) => x.type === 'rep');
    check(
      !!e && e.type === 'rep' && !!e.hit === should,
      `the old rules: a press ${off} steps off a key word: ${should ? 'counts' : 'does not'}`,
    );
    check(b.st.readWait === 0, 'the old rules: the marker never waits');
  }
}
{
  // The day's limit: six sets, the book back, the panel shut to it; tomorrow, again.
  const b = reader();
  b.read(1);
  const was = b.st.items.int;
  let sets = 0;
  while (b.st.train >= 0 && sets < 20) {
    const v = b.st.items.int;
    b.set(undefined, 700);
    if (b.st.items.int !== v) sets++;
    if (b.st.energy < 30) b.st.energy = 100;
  }
  check(
    sets === READ_SETS_A_DAY && b.st.items.int === was + READ_SETS_A_DAY * 2,
    `${READ_SETS_A_DAY} sets a day (${sets}, Intellect ${b.st.items.int})`,
  );
  check(b.st.book === 0 && b.st.train < 0, 'the head full, the book goes back');
  check(headFull(b.sim), 'and it says so');
  b.st.seat = -1;
  b.walkTo(placesOf(b.sim.world).shelves[0].tile);
  b.face(13);
  b.open(shelfOf(b));
  const told = b.events.length;
  b.op(OP.TRAIN, 0, 1);
  check(
    b.st.book === 0 && b.events.slice(told).some((e) => e.type === 'cantTrain' || e.type === 'refused'),
    'tomorrow, not today: refused at the shelf, no book',
  );
  b.close();
  const others = b.st.items.int;
  b.st.items.int += 3; // A course on top: nothing stops it (kiosk.ts adds directly).
  check(b.st.items.int === others + 3 && headFull(b.sim), 'what else teaches comes on top');
  b.routineUntil(2, 8 * 60 + 1);
  check(b.st.readToday === 0 && !headFull(b.sim), 'the next morning, a clear head');
}
{
  // Subjects: a mark tells a recipe of the subject read, and only of it while it has one to tell.
  for (let k = 0; k < SUBJECTS.length; k++) {
    const b = reader();
    b.st.items.int = 44;
    b.read(k);
    b.set();
    check(b.st.items.int === 46 && b.st.tips.length === 1, `${SUBJECTS[k]}: a mark, a recipe (${b.st.items.int}, ${b.st.tips.length})`);
    const r = RECIPES[b.st.tips[0]];
    check(!!r && subjectOf(r.result) === k, `${SUBJECTS[k]}: from the subject (${r?.result})`);
  }
  // A subject with nothing left to tell: still a recipe, no mark wasted.
  const b = reader();
  b.st.items.int = 44;
  RECIPES.forEach((r, k) => {
    if (subjectOf(r.result) === 2 && r.int <= 46) b.st.tips.push(k);
  });
  check(toLearn(b.sim, 2) === 0, 'weapons told out');
  b.read(2);
  b.set();
  check(
    b.st.tips.length > 0 && subjectOf(RECIPES[b.st.tips[b.st.tips.length - 1]].result) !== 2,
    'its next recipe comes from another shelf',
  );
  // What's next: the lowest mark above, with its job and recipes. At Center Perks from 40: 50.
  const n = reader();
  const next = nextUnlock(n.sim)!;
  check(
    next.at === 50 && next.jobs.includes('mailman') && next.wage === 55 && next.recipes > 0,
    `what's next at 40: ${JSON.stringify(next)}`,
  );
  n.st.items.int = ATTR_MAX;
  check(nextUnlock(n.sim) === null, 'at 100, nothing next');
  // What's suggested has the most to tell, and it's a real number.
  const s = reader();
  const best = suggestSubject(s.sim);
  check(best >= 0 && SUBJECTS.every((_, k) => toLearn(s.sim, k) <= toLearn(s.sim, best)), 'the librarian suggests the fullest shelf');
  check(
    toLearn(s.sim, best) ===
      RECIPES.filter(
        (r, k) =>
          subjectOf(r.result) === best &&
          r.int <= s.st.items.int &&
          !s.st.items.known.includes(k) &&
          !s.st.tips.includes(k) &&
          usableHere(s.sim.world, k) &&
          !(r.keep || r.ingredients.some((i) => i.startsWith('mold_'))),
      ).length,
    'and what it counts is what can be told',
  );
  check(nextTip(s.sim, best) >= 0, 'and something can be');
}
{
  // Someone in reach of the chair doesn't take the button from the book.
  const talky = reader();
  talky.op(OP.TRAIN, 0, 0);
  const seat = freeReadSeat(talky.sim);
  talky.walkTo(seat);
  const near = talky.st.inmates[0];
  near.body.x = talky.st.player.x + UNIT;
  near.body.z = talky.st.player.z;
  near.goal = -1;
  near.opinion = 50;
  talky.st.player.facing = 1;
  talky.act();
  check(
    talky.st.seat >= 0 && talky.st.train >= 0 && talky.st.talk < 0,
    `book in hand, someone beside the chair: it's read, not a talk (seat ${talky.st.seat}, talk ${talky.st.talk})`,
  );
  // A set costs the card's 10, less only what any standing about gives back: a chair is no way round it.
  for (const hands of [true, false]) {
    const b = reader();
    b.read(0);
    b.st.energy = 60;
    check(b.st.seat >= 0, 'on a chair');
    const was = b.st.items.int;
    if (hands) b.set();
    else b.until(() => b.st.items.int !== was, 2000);
    const lost = 60 - b.st.energy;
    console.log(`a set on a chair, energy lost: ${lost} ${hands ? 'kept up with' : 'untouched'}`);
    check(lost >= 0 && lost <= 10, `a set on a chair costs energy (${lost}, ${hands ? 'kept up with' : 'untouched'})`);
  }
  // A blow ends the reading: up, hands free. Spent or at 100: the button gets them up, it doesn't say Read.
  const hit = reader();
  hit.read(0);
  const foe = hit.st.inmates[0];
  foe.body.x = hit.st.player.x + UNIT / 2;
  foe.body.z = hit.st.player.z;
  foe.angry = 200;
  foe.windup = 0;
  const hp = hit.st.health;
  hit.until(() => hit.st.health < hp, 400);
  check(
    hit.st.health < hp && hit.st.train < 0 && hit.st.seat < 0,
    `a blow: the book shut, up off the chair (train ${hit.st.train}, seat ${hit.st.seat})`,
  );
  const spent = reader();
  spent.read(0);
  spent.op(OP.TRAIN, 3);
  spent.st.energy = 5;
  check(!readSeated(spent.sim) && spent.st.seat >= 0, 'spent: not Read');
  spent.act();
  check(spent.st.seat < 0, 'spent: the button gets them up');
  const top = reader();
  top.read(0);
  top.op(OP.TRAIN, 3);
  top.st.items.int = ATTR_MAX;
  check(!readSeated(top.sim), 'at 100: not Read');
  // A save from before 2.31 in a set at a shelf: off it, not a dead card.
  const was230 = reader();
  was230.st.train = was230.sim.world.props.findIndex((p) => p.kind === 'shelf' && was230.sim.world.zoneAt(p.x, p.z) === 'library');
  was230.st.book = 0;
  was230.step(0);
  check(was230.st.train < 0, 'a set at a shelf with no book: over');
  // Interruptions: a lockdown, a knockout and a step off put it all back.
  const lock = reader();
  lock.read(0);
  lock.st.lockdown = true;
  lock.step(0);
  check(lock.st.train < 0 && lock.st.book === 0, 'a lockdown: the book back');
  const ko = reader();
  ko.read(0);
  ko.st.ko = 100;
  ko.step(0);
  check(ko.st.train < 0 && ko.st.book === 0, 'out cold: the book back');
  const step = reader();
  step.read(0);
  step.step(command(5));
  check(step.st.train < 0, 'a step: the book shut');
  check(step.st.book === 1, 'but still in hand, in the library');
  // Tired: refused at the shelf, no book.
  const tired = reader();
  tired.st.energy = 5;
  tired.op(OP.TRAIN, 0, 0);
  check(tired.st.book === 0, 'too tired: no book');
  // No free chair: read at the shelf, standing.
  const full = reader();
  // (Nobody off to the vending machine, who'd leave their chair free.)
  full.st.vend.line = [];
  placesOf(full.sim.world).readSeats.forEach((q, k) => {
    const m = full.st.inmates[k];
    m.goal = q.tile;
    m.plan = full.st.routine;
  });
  full.op(OP.TRAIN, 0, 0);
  check(
    full.st.train >= 0 && full.st.seat < 0 && full.st.book === 1,
    `no chair free: read at the shelf (train ${full.st.train}, seat ${full.st.seat})`,
  );
}
{
  // Inmates: readers at the shelves and chairs over free time, on several seeds; the librarian at the desk.
  const lines: string[] = [];
  for (const def of PRISONS) {
    let total = 0;
    let samples = 0;
    let most = 0;
    let books = 0;
    let atDesk = 0;
    let deskSamples = 0;
    let stuck = 0;
    for (const seed of [3, 11, 19]) {
      const bot = new Bot(def, seed);
      bot.routineUntil(2, 10 * 60 + 15);
      const lib = librarianOf(bot.sim);
      const desk = def.leisure!.librarian!;
      const end = 10 * 60 + 110;
      while (minute(bot.sim) < end) {
        bot.step(0);
        if (bot.st.step % 40) continue;
        const here = bot.st.inmates.filter(
          (m) => m.ko === 0 && bot.sim.world.zoneAt(Math.floor(m.body.x / UNIT), Math.floor(m.body.z / UNIT)) === 'library',
        );
        total += here.length;
        samples++;
        most = Math.max(most, here.length);
        books += bot.st.inmates.filter((m) => m.book === 2 && (m.doing === DOING.SIT_READ || m.doing === DOING.READ)).length;
        const m = bot.st.inmates[lib];
        if (m.ko === 0) {
          deskSamples++;
          if (Math.floor(m.body.x / UNIT) === desk.x && Math.floor(m.body.z / UNIT) === desk.z) atDesk++;
        }
        if (
          here.some(
            (o) =>
              o.book === 1 &&
              o.wait === 0 &&
              !o.path.length &&
              o.goal >= 0 &&
              !o.body.moving &&
              Math.floor(o.body.x / UNIT) + Math.floor(o.body.z / UNIT) * MAP_W !== o.goal,
          )
        )
          stuck++;
      }
    }
    lines.push(
      `${def.id} ${(total / samples).toFixed(1)} in the library (most ${most}), ${(books / samples).toFixed(1)} reading, librarian at the desk ${Math.round((atDesk / deskSamples) * 100)}%`,
    );
    check(total / samples >= 1, `${def.id}: the library's used (${(total / samples).toFixed(1)})`);
    check(atDesk / deskSamples >= 0.7, `${def.id}: the librarian at the desk (${atDesk}/${deskSamples})`);
    check(stuck === 0, `${def.id}: nobody stuck on the way to a shelf (${stuck})`);
  }
  console.log(`free time: ${lines.join('; ')}`);
}
{
  // Old rules: the set at the shelf as it was, no book, no limit, the added chairs for show.
  const old = new Bot(CENTER_PERKS, 3);
  old.sim.rules230 = true;
  old.sim.rules231 = true;
  old.sim.rules232 = true;
  old.sim.rules2331 = true;
  old.sim.rules233 = true;
  old.sim.rules234 = true;
  old.routineUntil(1, 10 * 60 + 1);
  check(old.sim.world.plainBooks, 'the old rules');
  old.walkTo(placesOf(old.sim.world).shelves[0].tile);
  old.face(13);
  old.open(shelfOf(old));
  old.op(OP.TRAIN, 0);
  check(old.st.train >= 0 && old.st.book === 0, 'the old rules: a set at the shelf, no book');
  const was = old.st.items.int;
  for (let k = 0; k < 8; k++) {
    old.set(undefined, 400);
    if (old.st.energy < 30) old.st.energy = 100;
  }
  check(old.st.items.int === was + 16 && !headFull(old.sim), `the old rules: no limit (${old.st.items.int})`);
  const def = PRISONS.find((p) => p.id === 'irongate')!;
  const iron = new Bot(def, 3);
  iron.sim.rules230 = true;
  iron.sim.rules231 = true;
  iron.sim.rules232 = true;
  iron.sim.rules2331 = true;
  iron.sim.rules233 = true;
  iron.sim.rules234 = true;
  const chair = iron.sim.world.props.findIndex((p) => p.kind === 'readChair');
  iron.st.player.x = iron.sim.world.props[chair].x * UNIT + UNIT / 2;
  iron.st.player.z = iron.sim.world.props[chair].z * UNIT + UNIT / 2;
  iron.act();
  check(iron.st.seat !== chair, 'the old rules: an added chair is only decoration');
  // In old runs a spade goes through where the added chairs stand, whichever they are (dug tiles apart, as ever).
  for (const p of PRISONS) {
    const was = new Sim(p, 3);
    was.rules230 = true;
    was.rules231 = true;
    was.rules232 = true;
    was.rules2331 = true;
    was.rules233 = true;
    was.rules234 = true;
    const bare = new Sim({ ...p, props: p.props.filter((q) => q.kind !== 'readChair' && q.kind !== 'deskChair') }, 3);
    for (const q of p.props) {
      if (q.kind !== 'readChair' && q.kind !== 'deskChair') continue;
      const t = q.z * MAP_W + q.x;
      check(canDigFloor(was.world, t, []) === canDigFloor(bare.world, t, []), `${p.id}: digging at ${q.x},${q.z} as it was in old runs`);
    }
  }
  // A log from 2.30 replays under its own rules, and isn't carried on; today's is.
  const was230 = new Sim(CENTER_PERKS, 24);
  was230.rules230 = true;
  was230.rules231 = true;
  was230.rules232 = true;
  was230.rules2331 = true;
  was230.rules233 = true;
  was230.rules234 = true;
  const prev = new RunRecorder(was230, { seed: 24, game: '2.30.0' });
  for (let k = 0; k < 4800; k++) prev.step(0);
  check(!!replayLog(prev.toLog(), CENTER_PERKS)?.ok, 'a 2.30 log replays whole under the old rules');
  check(!replayLog({ ...prev.toLog(), game: '2.36.0' }, CENTER_PERKS)?.ok, 'and would not under the new ones: the test can tell');
  check(new RunRecorder(prev.sim, { log: prev.toLog(), game: '2.36.0' }).toLog().seed === -1, 'and is not carried on');
  const now = new RunRecorder(new Sim(CENTER_PERKS, 24), { seed: 24, game: '2.39.0' });
  for (let k = 0; k < 4800; k++) now.step(0);
  check(!!replayLog(now.toLog(), CENTER_PERKS)?.ok, "a log of today's replays");
  check(new RunRecorder(now.sim, { log: now.toLog(), game: '2.39.0' }).toLog().seed === 24, 'and is carried on');
  // A save with a book in hand comes back with it; a mid-page one too.
  const s = reader();
  s.read(0);
  const snap = s.sim.snapshot();
  const back = new Sim(CENTER_PERKS, 3);
  back.restore(snap);
  check(back.state.book === 1 && back.state.readFrom === s.st.readFrom && back.state.train === s.st.train, 'a save mid-page');
  // A save from before 2.34 mid-page: its place was at the old pace, so the book opens at its first page again; one from now keeps its place.
  s.set(() => s.st.repBeat >= 8);
  const file: SaveFile = saveFileOf(s.sim, 0, '2.36.0');
  const kept = loadSave(file)!;
  check(kept.state.readFrom === s.st.readFrom && kept.state.repBeat === s.st.repBeat, 'a save from 2.34 mid-page keeps its place');
  const oldSnap = JSON.parse(JSON.stringify(file.snap));
  delete oldSnap.state.readWait;
  const pre = loadSave({ ...file, snap: oldSnap })!;
  check(
    pre.state.readFrom === pre.state.step && pre.state.repBeat === 0 && pre.state.book === 1 && pre.state.train === s.st.train,
    'a save from before 2.34 mid-page opens the book at its first page',
  );
}

console.log(failures ? `${failures} failures` : 'library ok');
if (failures) process.exit(1);
