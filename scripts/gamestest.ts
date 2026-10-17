/**
 * Side games (P22), rule by rule:
 * - the data: the lockpick (wire + nail file, Intellect 40; on the phone at $35), pins by door
 *   colour, the numbers the help and the cards say; sports day dealt once a week in every
 *   campaign prison, all day long;
 * - who plays: an inmate at opinion 40 or more, in free time or the exercise hour (never in a
 *   lockdown), three games a day each, and again tomorrow; a stake the player can pay; a bout
 *   needs energy;
 * - dice: every throw is roll()'s; the stake goes on the table at once; the dice thrown again
 *   are the ones chosen; the inmate throws after, again with its lower die when behind or level; the stake changes hands by the totals; the dice
 *   still on the table when the talk ends stand; a game brings two people closer; a guard who
 *   sees it adds heat, exactly when the card warns of it;
 * - arm-wrestling: the bar moves exactly by the push and the inmate's push back (and its
 *   surges), presses must alternate; a win's opinion (the loser, everyone watching), Strength,
 *   a loss, a draw at the bell, giving up, a bout broken off;
 * - sports day: three wins earn the prize once, and only on the day;
 * - the lockpick: which doors (never a perimeter gate), the marker and the sweet spot decide,
 *   a pin set clicks (noise 2), a slip is loud (noise 6) and wears the pick until it breaks; the
 *   door opens for the player alone, until they're through it (or 15 s); a step away stops it;
 *   the player's own cell door at night; work on a door is tampering; the ear on the card is
 *   the noise's own rule;
 * - saves: a game, a bout, a lock half picked and a door picked open carry on the same; damaged
 *   ones are dropped; a save or a run log from before P22 keeps the card sports day took the
 *   place of.
 */
import { DAY_BOOKS, DAY_EVENTS, EVENT_TIMES } from '../src/content/days';
import { BAR, BOUT_ENERGY, BOUT_STEPS, CROWD_OPINION, CROWD_RANGE, DICE_HEAT, GAME_OPINION, GAMES_A_DAY, PICK_HIT_NOISE, PICK_MISS_NOISE, PICKED_STEPS, PINS, PLAY_OPINION, SPORTS_OPINION, SPORTS_PRIZE, SPORTS_WINS, STAKES, WIN_OPINION } from '../src/content/games';
import { itemDef, itemNumber, KEY_ITEM_COLORS } from '../src/content/items';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { TRAINING } from '../src/content/prisons/training';
import { RECIPES } from '../src/content/recipes';
import { ROUTINE } from '../src/content/routine';
import { CATALOGUE } from '../src/content/smuggling';
import { lineOfSight } from '../src/sim/ai/sight';
import { placesOf } from '../src/sim/ai/places';
import { command, OP, TALK } from '../src/sim/command';
import { rollInt, SALT } from '../src/sim/rng';
import { replayLog, RunRecorder } from '../src/sim/runlog';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { planOf, TODAY } from '../src/sim/systems/calendar';
import { DAY_STEPS } from '../src/sim/systems/clock';
import { drainOf, eyesOn, gamesOpen, lockAt, markerAt, pinsOf, playedToday, pushOf, sportsWins, surging, sweetSpot } from '../src/sim/systems/games';
import { DOING } from '../src/sim/systems/inmates';
import { itemOf, slot, usesOf } from '../src/sim/systems/items';
import { FEAT } from '../src/sim/systems/ledger';
import { wouldHear } from '../src/sim/systems/noise';
import { toolTarget } from '../src/sim/systems/structure';
import { STEPS_PER_MINUTE, STEPS_PER_SECOND, TIRED, UNIT } from '../src/sim/tuning';
import { KEY } from '../src/sim/world/tiles';
import { LAYER, MAP_H, MAP_W } from '../src/sim/world/World';
import { check } from './assert';

const n = (id: string) => itemNumber(id);
const LOCKPICK = n('lockpick');
const SPORTS = DAY_EVENTS.indexOf('sports');
/** A step count at a time: game day (from 1), hour, minute (days start at 08:00). */
const at = (day: number, hour: number, minute = 0) => (day - 1) * DAY_STEPS + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
const put = (b: { x: number; z: number }, t: number) => {
  b.x = (t % MAP_W) * UNIT + UNIT / 2;
  b.z = Math.floor(t / MAP_W) * UNIT + UNIT / 2;
};
const tileOf = (b: { x: number; z: number }) => Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);

/** A game kept calm (heat and lockdowns cleared each step unless asked), every day quiet unless forced. */
function game(seed = 5, calendar: Array<[number, number, number]> = [[0, 0, 0]]) {
  const sim = new Sim(CENTER_PERKS, seed);
  sim.state.calendar = calendar;
  const seen: SimEvent[] = [];
  const step = (cmd = 0, calm = true) => {
    sim.step(cmd);
    seen.push(...sim.events);
    if (calm) {
      sim.state.heat = 0;
      if (sim.state.lockdown) sim.state.lockdown = false;
    }
  };
  const to = (day: number, hour: number, minute = 0) => {
    const target = at(day, hour, minute);
    while (sim.state.step < target && !sim.state.escaped) step();
  };
  /** Nobody sees anything (every guard dozing where it stands, for the test). */
  const blind = () => {
    for (const g of sim.state.guards) g.sees = false;
  };
  /** An inmate on an open tile of the yard and the player beside it facing it, talking (true once they are). */
  const talkTo = (who: number, spot = yardSpot(sim)) => {
    const m = sim.state.inmates[who];
    put(m.body, spot);
    put(sim.state.player, spot + 1);
    sim.state.player.facing = 9;
    m.goal = -1;
    m.path = [];
    step(command(0, OP.INTERACT));
    return sim.state.talk === who;
  };
  const talk = (a: number, b = 0) => step(command(0, OP.TALK, a, b));
  return { sim, seen, step, to, blind, talkTo, talk };
}

/** An open stretch of the yard: a tile with its east neighbour and the row around them free (the first such, from the middle). */
function yardSpot(sim: Sim, skip = 0): number {
  const w = sim.world;
  const yard: number[] = [];
  for (let z = 2; z < MAP_H - 2; z++)
    for (let x = 2; x < MAP_W - 3; x++) {
      if (w.zoneAt(x, z) !== 'yard') continue;
      let ok = true;
      for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 2 && ok; dx++) ok = !w.blocked(x + dx, z + dz) && w.zoneAt(x + dx, z + dz) === 'yard';
      if (ok) yard.push(z * MAP_W + x);
    }
  return yard[(yard.length >> 1) + skip * 7];
}
/** A keyed door shut for the player (not a job room's or a cell's: those open from inside anyway), between floor on both sides inside the walls: the door, where to stand, which way to face. */
function plainDoor(w: Sim['world']): { door: number; from: number; dir: number } {
  const inside = (t: number) => !['perimeter', 'outside'].includes(w.zoneAt(t % MAP_W, Math.floor(t / MAP_W)));
  for (let i = MAP_W; i < MAP_W * (MAP_H - 1); i++) {
    if (lockAt(w, i) !== 'lock' || w.doorRoom[i] || w.doorCell[i]) continue;
    for (const [d, f] of [
      [1, 9],
      [-1, 1],
      [MAP_W, 13],
      [-MAP_W, 5],
    ] as const) {
      const a = i + d;
      const b = i - d;
      if (!w.block[a] && !w.block[b] && w.ground.kind[a] !== 14 && w.ground.kind[b] !== 14 && inside(a) && inside(b)) return { door: i, from: a, dir: f };
    }
  }
  return { door: -1, from: -1, dir: 0 };
}
const refusals = (seen: SimEvent[]) => seen.filter((e) => e.type === 'refused').map((e) => (e as { why: string }).why);
const last = <T extends SimEvent['type']>(seen: SimEvent[], type: T) => seen.filter((e) => e.type === type).at(-1) as Extract<SimEvent, { type: T }> | undefined;
const die = (salt: number, step: number, k: number) => 1 + rollInt(salt, SALT.DICE, step, k, 6);

// ------------------------------------------------------------------ the data
{
  const d = itemDef(LOCKPICK);
  check(d.cat === 'gear' && d.contraband && !!d.small && d.uses === 12 && d.thud === 1, 'the lockpick: contraband gear, small (a rat carries it), 12 uses, lands hard');
  const r = RECIPES.find((x) => x.result === 'lockpick');
  check(!!r && r.int === 40 && [...r.ingredients].sort().join() === 'nail_file,wire', 'the lockpick: wire and a nail file, Intellect 40');
  check(CATALOGUE.at(-1)?.item === 'lockpick' && CATALOGUE.at(-1)?.price === 35, 'the lockpick on the phone at $35 (appended: orders keep their numbers)');
  check(PINS[KEY.YELLOW] === 2 && PINS[KEY.CYAN] === 3 && PINS[KEY.PURPLE] === 4 && PINS[KEY.RED] === 5 && PINS[KEY.GREEN] === 6, 'pins by colour: yellow 2, cyan 3, purple 4, red 5, green 6 (as the help says)');
  check(STAKES.join() === '5,10,20' && GAME_OPINION === 40 && GAMES_A_DAY === 3 && DICE_HEAT === 10 && BOUT_ENERGY === 6 && WIN_OPINION === 6 && CROWD_OPINION === 2 && PLAY_OPINION === 2, 'the numbers the words say: $5/$10/$20, opinion 40, three a day, +10% heat, 6 energy, +6, +2 watching, +2 a game');
  check(SPORTS_WINS === 3 && SPORTS_PRIZE === 30 && SPORTS_OPINION === 3 && PICK_HIT_NOISE === 2 && PICK_MISS_NOISE === 6 && PICKED_STEPS === 15 * STEPS_PER_SECOND, 'sports day: three wins, $30, +3 everyone; a pin clicks (2), a slip carries 6 tiles; a door open 15 s');
  const t = EVENT_TIMES.sports;
  check(t.at === 120 && t.length === 720, 'sports day runs 10:00–22:00 (free time, the exercise hour, the evening)');
  check(!DAY_BOOKS[TRAINING.id], 'the Training Block has no sports day');
  for (const p of PRISONS) {
    const b = DAY_BOOKS[p.id];
    check(b.deck.length === 7 && b.deck.filter((e) => e === 'sports').length === 1 && !!b.beforeSports && b.beforeSports !== 'sports', `${p.id}: sports day once a week (in place of ${b.beforeSports})`);
  }
  console.log(`data: the lockpick (wire + nail file, Int 40, $35 on the phone, 12 uses); sports day in place of ${PRISONS.map((p) => `${p.id} ${DAY_BOOKS[p.id].beforeSports}`).join(', ')}`);
}

// ------------------------------------------------------------------ who plays, and when
{
  const { sim, seen, step, to, talkTo, talk } = game();
  const s = sim.state;
  to(1, 9, 20);
  check(talkTo(0), 'talking at breakfast');
  s.inmates[0].opinion = 70;
  s.cash = 100;
  talk(TALK.DICE, 0);
  check(refusals(seen).at(-1) === 'gamesClosed' && !s.dice.length, 'breakfast: no games');
  step(command(0, OP.CLOSE));
  const blocks: string[] = [];
  for (const [h, m] of [
    [10, 30],
    [13, 0],
    [15, 30],
    [16, 30],
    [18, 30],
  ]) {
    to(1, h, m);
    blocks.push(`${ROUTINE[s.routine].id} ${gamesOpen(sim) ? 'on' : 'off'}`);
  }
  check(blocks.join() === 'freeTime on,work off,exercise on,showers off,eveningFreeTime on', `games on in free time and the exercise hour only (${blocks.join(', ')})`);
  s.lockdown = true;
  check(!gamesOpen(sim), 'never in a lockdown');
  s.lockdown = false;
  check(talkTo(0), 'talking in the evening');
  s.inmates[0].opinion = GAME_OPINION - 1;
  talk(TALK.DICE, 0);
  check(refusals(seen).at(-1) === 'gameOpinion', 'opinion 39: they won\'t play');
  s.inmates[0].opinion = GAME_OPINION;
  for (let g = 0; g < GAMES_A_DAY; g++) {
    talk(TALK.DICE, 0);
    check(s.dice.length === 4 && playedToday(s, 0) === g + 1, `game ${g + 1} on`);
    talk(TALK.REROLL, 0);
  }
  talk(TALK.DICE, 0);
  check(refusals(seen).at(-1) === 'played' && !s.dice.length, 'a fourth game: refused');
  talk(TALK.WRESTLE);
  check(refusals(seen).at(-1) === 'played' && !s.bout.length, 'an arm-wrestle counts among the three');
  step(command(0, OP.CLOSE));
  to(2, 10, 30);
  check(playedToday(s, 0) === 0 && talkTo(0), 'the next day, nothing played yet');
  s.cash = 4;
  s.inmates[0].opinion = 60;
  talk(TALK.DICE, 0);
  check(refusals(seen).at(-1) === 'cash', 'a stake they can\'t pay: refused');
  s.energy = TIRED - 1;
  talk(TALK.WRESTLE);
  check(refusals(seen).at(-1) === 'tired', 'too tired for a bout');
  console.log(`who plays: opinion ${GAME_OPINION}+, ${blocks.join(', ')}; ${GAMES_A_DAY} games a day each`);
}

// ------------------------------------------------------------------ dice
{
  const { sim, seen, step, to, talkTo, talk, blind } = game(9);
  const s = sim.state;
  to(1, 10, 20);
  check(talkTo(2), 'talking');
  s.inmates[2].opinion = 60;
  s.cash = 200;
  let checked = 0;
  let wrong = 0;
  for (const mask of [0, 1, 2, 3, 0, 3]) {
    if (playedToday(s, 2) >= GAMES_A_DAY) s.played[2] = 0;
    blind();
    const op = s.inmates[2].opinion;
    const cash = s.cash;
    talk(TALK.DICE, 2);
    const rolled = last(seen, 'dice')!;
    const t0 = s.step;
    if (rolled.what !== 'rolled' || rolled.mine.join() !== `${die(s.salt, t0, 0)},${die(s.salt, t0, 1)}` || s.inmates[2].opinion !== Math.min(100, op + PLAY_OPINION)) wrong++;
    talk(TALK.REROLL, mask);
    const t1 = s.step;
    const mine = [mask & 1 ? die(s.salt, t1, 2) : rolled.mine[0], mask & 2 ? die(s.salt, t1, 3) : rolled.mine[1]];
    let a = die(s.salt, t1, 4);
    let b = die(s.salt, t1, 5);
    if (a + b <= mine[0] + mine[1]) {
      if (a <= b) a = die(s.salt, t1, 6);
      else b = die(s.salt, t1, 6);
    }
    const end = last(seen, 'dice')!;
    const want = mine[0] + mine[1] > a + b ? 20 : mine[0] + mine[1] < a + b ? -20 : 0;
    if (end.mine.join() !== mine.join() || end.theirs?.join() !== `${a},${b}` || s.cash !== cash + want || s.dice.length) wrong++;
    checked++;
  }
  check(wrong === 0, `${checked} games: every throw is roll()'s, only the dice chosen are thrown again, the inmate's lower die again when behind, the stake by the totals`);
  // The stake on the table: spent at once, so nothing bought meanwhile makes a loss any cheaper.
  s.played[2] = 0;
  s.cash = 20;
  talk(TALK.DICE, 2);
  check(s.cash === 0 && s.dice.length === 4, 'the stake goes on the table as the dice are thrown');
  talk(TALK.GIFT_CASH, 5);
  check(refusals(seen).at(-1) === 'cash' && s.cash === 0, 'the stake can\'t be spent meanwhile');
  talk(TALK.REROLL, 0);
  const res = last(seen, 'dice')!;
  check(s.cash === (res.what === 'won' ? 40 : res.what === 'push' ? 20 : 0), `settled: ${res.what}, $${s.cash} back`);
  // Walking up to someone else: the dice on the table stand first.
  s.played[2] = 0;
  s.cash = 50;
  talk(TALK.DICE, 0);
  const other = s.inmates.findIndex((m, k) => k !== 2 && m.ko === 0);
  check(talkTo(other, yardSpot(sim, 4)) && !s.dice.length && last(seen, 'dice')!.what !== 'rolled', 'talking to someone else: the dice stand');
  // The talk over with the dice on the table: the player stands on them.
  s.played[2] = 0;
  talk(TALK.DICE, 0);
  const left = last(seen, 'dice')!.mine;
  step(command(0, OP.CLOSE));
  const settled = last(seen, 'dice')!;
  check(s.talk < 0 && !s.dice.length && settled.what !== 'rolled' && settled.mine.join() === left.join(), 'the talk over with the dice down: they stand');
  // A guard who sees it: +10% heat, the card's warning (eyesOn) exactly when it happens.
  let warned = 0;
  let heated = 0;
  let agree = 0;
  let trials = 0;
  for (let k = 0; k < 40; k++) {
    if (!talkTo(2, yardSpot(sim, k % 6))) continue;
    trials++;
    s.played[2] = 0;
    s.cash = 200;
    s.heat = 0;
    // Now and then a guard had the player in sight at its last look; some bribed to look away (one whose bribe runs out just now).
    s.guards.forEach((g, i) => {
      g.sees = (k + i) % 4 === 0;
      g.bribed = k % 5 === 0 ? s.step + 1e6 : k % 5 === 1 ? s.step + 1 : 0;
    });
    const warn = eyesOn(s, s.step);
    sim.step(command(0, OP.TALK, TALK.DICE, 0));
    const hot = s.heat === DICE_HEAT && sim.events.some((e) => e.type === 'spotted' && e.reason === 'gambling');
    if (warn) warned++;
    if (hot) heated++;
    if (warn === hot && (hot || s.heat === 0)) agree++;
    sim.step(command(0, OP.TALK, TALK.REROLL, 0));
    s.heat = 0;
    s.lockdown = false;
  }
  check(agree === trials && trials >= 30 && warned > 5 && warned < trials - 5, `the card's warning is the rule: ${warned} warned, ${heated} cost +${DICE_HEAT}% heat (${agree}/${trials} agree)`);
  // The games' hours over with the dice down: they stand.
  check(talkTo(2), 'back to the game');
  s.cash = 200;
  s.played[2] = 0;
  talk(TALK.DICE, 0);
  to(1, 12, 0);
  check(!s.dice.length && last(seen, 'dice')!.what !== 'rolled', 'free time over: the dice stand');
  // The odds: rethrowing every die of 3 or less, against the inmate's way.
  let won = 0;
  let lost = 0;
  let push = 0;
  for (let salt = 1; salt <= 200; salt++)
    for (let st = 1000; st < 1020; st++) {
      const m = [die(salt, st, 0), die(salt, st, 1)].map((d, k) => (d <= 3 ? die(salt, st + 1, 2 + k) : d));
      let a = die(salt, st + 1, 4);
      let b = die(salt, st + 1, 5);
      if (a + b <= m[0] + m[1]) {
        if (a <= b) a = die(salt, st + 1, 6);
        else b = die(salt, st + 1, 6);
      }
      if (m[0] + m[1] > a + b) won++;
      else if (m[0] + m[1] < a + b) lost++;
      else push++;
    }
  const all = won + lost + push;
  console.log(`dice: ${checked} games as roll() throws them; dice left on the table stand; the warning agrees ${agree}/${trials}; rethrowing 1–3: won ${Math.round((won / all) * 100)}%, lost ${Math.round((lost / all) * 100)}%, tied ${Math.round((push / all) * 100)}%`);
  check(s.feats[FEAT.dice] > 0 && s.feats[FEAT.diceWon] > 0, 'the ledger counts games and wins');
}

// ------------------------------------------------------------------ arm-wrestling
{
  const { sim, seen, step, to, talkTo, talk } = game(11);
  const s = sim.state;
  to(1, 10, 30);
  check(talkTo(1), 'talking');
  const m = s.inmates[1];
  m.opinion = 50;
  s.energy = 50;
  talk(TALK.WRESTLE);
  check(s.bout.length === 4 && s.energy === 50 - BOUT_ENERGY && s.bout[0] === 1, `a bout: ${BOUT_ENERGY} energy`);
  // The bar, step by step, exactly as the rule says (presses alternate; one on the same side counts for nothing).
  let bar = s.bout[1];
  let side = 0;
  let wrong = 0;
  const presses = [1, 2, 2, 1, 0, 2, 1, 0, 0, 2, 1, 2, 1, 1, 2];
  for (const p of presses) {
    if (!s.bout.length) break;
    const counts = p !== 0 && p !== side;
    if (counts) {
      side = p;
      bar = Math.min(BAR, bar + pushOf(s.str));
    }
    step(p ? command(0, OP.TRAIN, p) : 0);
    if (!s.bout.length) break;
    const t = s.step - s.bout[3];
    bar = Math.max(0, bar - drainOf(m.str, surging(s.salt, s.bout[3], t)));
    if (s.bout[1] !== bar) wrong++;
  }
  check(wrong === 0, 'the bar moves by the push (20 + Strength/4) and their push back ((Strength + 20)/10, half again in a surge), alternate presses only');
  // Not pressing: pinned.
  const before = m.opinion;
  for (let k = 0; k < BOUT_STEPS && s.bout.length; k++) step();
  const lost = last(seen, 'bout')!;
  check(lost.what === 'lost' && m.opinion === before + PLAY_OPINION, `not pushing: lost, +${PLAY_OPINION} opinion all the same`);
  // Winning: a press every step, with two others watching close by and one far off.
  s.played[1] = 0;
  s.str = 60;
  const near = [3, 4].map((k) => {
    put(s.inmates[k].body, tileOf(s.player) + 2 * MAP_W);
    s.inmates[k].opinion = 50;
    return k;
  });
  talk(TALK.WRESTLE);
  const ops = s.inmates.map((x) => x.opinion);
  for (let k = 0; k < 400 && s.bout.length; k++) {
    // (The step before the last: who watches is worked out with everyone where they'll be.)
    step(command(0, OP.TRAIN, 1 + (k % 2)));
  }
  const won = last(seen, 'bout')!;
  const watching = s.inmates.map((x, k) => k !== 1 && x.ko === 0 && x.angry === 0 && x.doing !== DOING.SLEEP && (x.body.x - s.player.x) ** 2 + (x.body.z - s.player.z) ** 2 <= (CROWD_RANGE * UNIT) ** 2 && lineOfSight(sim.world, x.body.x, x.body.z, s.player.x, s.player.z));
  const crowdOk = s.inmates.every((x, k) => x.opinion === Math.min(100, ops[k] + (k === 1 ? WIN_OPINION : watching[k] ? CROWD_OPINION : 0)));
  check(won.what === 'won' && won.crowd === watching.filter(Boolean).length && near.every((k) => watching[k]) && crowdOk && s.str === 61 && (s.trained & 1) === 1, `a win: +${WIN_OPINION} (the loser), +${CROWD_OPINION} from each of the ${won.crowd} watching, +1 Strength (trained today)`);
  // A draw at the bell: pressing only while the bar is on their side.
  s.played[1] = 0;
  talk(TALK.WRESTLE);
  const drawFrom = m.opinion;
  for (let k = 0; k < BOUT_STEPS + 5 && s.bout.length; k++) step(s.bout[1] < BAR / 2 ? command(0, OP.TRAIN, 1 + (k % 2)) : 0);
  check(last(seen, 'bout')!.what === 'draw' && m.opinion === drawFrom + PLAY_OPINION, `the bell after ${BOUT_STEPS / STEPS_PER_SECOND} s: a draw, +${PLAY_OPINION}`);
  // Giving up (Close, or a step away), and a bout broken off.
  s.played[1] = 0;
  talk(TALK.WRESTLE);
  const quit = m.opinion;
  step(command(0, OP.TRAIN, 3));
  check(last(seen, 'bout')!.what === 'gaveUp' && m.opinion === quit && !s.bout.length, 'giving up: nothing gained');
  talk(TALK.WRESTLE);
  step(command(13));
  check(last(seen, 'bout')!.what === 'gaveUp', 'a step away gives up');
  if (talkTo(1)) {
    talk(TALK.WRESTLE);
    s.lockdown = true;
    sim.step(0);
    check(last(sim.events, 'bout')?.what === 'off' || !s.bout.length, 'the sirens break a bout off');
    s.lockdown = false;
  }
  // Both hands busy: a strike does nothing mid-bout.
  if (talkTo(1)) {
    s.played[1] = 0;
    s.energy = 100;
    talk(TALK.WRESTLE);
    const struck = s.struckAt;
    step(command(0, OP.USE, 1));
    check(s.bout.length === 4 && s.struckAt === struck, 'mid-bout, the use button does nothing');
    step(command(0, OP.TRAIN, 3));
  }
  check(s.feats[FEAT.bouts] >= 4 && s.feats[FEAT.boutsWon] === 1, 'the ledger counts bouts and wins');
  // How it goes: presses a second against an inmate's arm, with the player's Strength (each bout from the middle).
  const rows: string[] = [];
  for (const str of [40, 70]) {
    const cells: string[] = [];
    for (const rate of [5, 8, 12]) {
      const per = Math.round(STEPS_PER_SECOND / rate);
      const out: string[] = [];
      for (const them of [30, 45, 60]) {
        let b = BAR / 2;
        let t = 0;
        let res = 'draw';
        for (; t <= BOUT_STEPS; t++) {
          if (t % per === 0) b = Math.min(BAR, b + pushOf(str));
          if (b >= BAR) {
            res = `won ${(t / STEPS_PER_SECOND).toFixed(1)}s`;
            break;
          }
          b = Math.max(0, b - drainOf(them, surging(7, 100, t)));
          if (b <= 0) {
            res = 'lost';
            break;
          }
        }
        out.push(res);
      }
      cells.push(`${rate}/s ${out.join(' · ')}`);
    }
    rows.push(`Strength ${str} vs 30 · 45 · 60: ${cells.join('; ')}`);
  }
  console.log(`arm-wrestling: the bar as the rule says; a win +${WIN_OPINION} / +${CROWD_OPINION} x ${won.crowd} watching / +1 Strength; lost, drawn +${PLAY_OPINION}; given up, broken off`);
  for (const r of rows) console.log(`  ${r}`);
}

// ------------------------------------------------------------------ sports day
{
  const { sim, seen, step, to, talkTo, talk } = game(13, [
    [0, 0, 0],
    [2, SPORTS, -1],
  ]);
  const s = sim.state;
  to(1, 10, 30);
  check(talkTo(0), 'talking');
  s.str = 100;
  s.energy = 100;
  s.inmates[0].opinion = 60;
  const win = () => {
    talk(TALK.WRESTLE);
    for (let k = 0; k < 200 && s.bout.length; k++) step(command(0, OP.TRAIN, 1 + (k % 2)));
    return last(seen, 'bout')?.what === 'won';
  };
  check(win() && sportsWins(s) === 0, 'a bout won on an ordinary day: not counted');
  to(2, 10, 30);
  check(planOf(sim, 2).event === 'sports' && talkTo(0), 'sports day');
  s.energy = 100;
  s.played[0] = 0;
  check(win() && win() && sportsWins(s) === 2 && !(s.eventFlags & TODAY.SPORTS_PRIZE), 'two wins: no prize yet');
  const cash = s.cash;
  const ops = s.inmates.map((x) => x.opinion);
  check(win(), 'the third win');
  const prize = seen.some((e) => e.type === 'today' && e.event === 'sports' && e.phase === 'prize');
  check(prize && s.cash === cash + SPORTS_PRIZE && (s.eventFlags & TODAY.SPORTS_PRIZE) !== 0 && s.inmates.every((x, k) => x.opinion >= Math.min(100, ops[k] + SPORTS_OPINION)), `three wins: $${SPORTS_PRIZE} and +${SPORTS_OPINION} from everyone`);
  // A fourth win (tomorrow's games with another inmate): no second prize.
  check(talkTo(5, yardSpot(sim, 3)), 'another inmate');
  s.inmates[5].opinion = 60;
  s.energy = 100;
  const prizes = seen.filter((e) => e.type === 'today' && e.phase === 'prize').length;
  check(win() && sportsWins(s) === SPORTS_WINS && seen.filter((e) => e.type === 'today' && e.phase === 'prize').length === prizes, 'a fourth win: one prize a day');
  to(3, 8, 1);
  check(sportsWins(s) === 0 && !(s.eventFlags & TODAY.SPORTS_PRIZE) && s.feats[FEAT.champion] === 1, 'the next morning: forgotten (and the ledger has a champion)');
  console.log(`sports day: ${SPORTS_WINS} wins earn $${SPORTS_PRIZE} and +${SPORTS_OPINION} from everyone, once, only on the day`);
}

// ------------------------------------------------------------------ the lockpick
{
  // Which doors, in every prison: keyed doors shut for the player; never a perimeter gate.
  const doors: string[] = [];
  for (const p of [...PRISONS, TRAINING]) {
    const sim = new Sim(p, 1);
    const w = sim.world;
    const by: Record<string, number> = {};
    let gates = 0;
    let wrong = 0;
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      const lock = lockAt(w, i);
      if (w.gate[i] && lock === 'lock') wrong++;
      if (lock === 'gate') gates++;
      if (lock !== 'lock') continue;
      const c = KEY_ITEM_COLORS[w.ground.key[i] - 1][0];
      by[c] = (by[c] ?? 0) + 1;
      if (pinsOf(w, i) !== PINS[w.ground.key[i]]) wrong++;
    }
    check(wrong === 0, `${p.id}: no gate pickable, pins by colour`);
    doors.push(`${p.id} ${Object.entries(by).map(([c, k]) => `${c} ${k}`).join(', ')}${gates ? `; ${gates} gates` : ''}`);
  }
  console.log(`lockpick doors: ${doors.join(' | ')}`);

  const { sim, seen, step, to } = game(17);
  const s = sim.state;
  const w = sim.world;
  to(1, 10, 30);
  // A keyed door (not a job room's or a cell's: those open from inside anyway) with floor on both sides along one axis.
  let door = -1;
  let from = -1;
  let dir = 0;
  for (let i = 0; i < MAP_W * MAP_H && door < 0; i++) {
    if (lockAt(w, i) !== 'lock' || w.doorRoom[i] || w.doorCell[i]) continue;
    for (const [d, f] of [
      [1, 9],
      [-1, 1],
      [MAP_W, 13],
      [-MAP_W, 5],
    ] as const) {
      const a = i + d;
      const b = i - d;
      const inside = (t: number) => !['perimeter', 'outside'].includes(w.zoneAt(t % MAP_W, Math.floor(t / MAP_W)));
      if (!w.block[a] && !w.block[b] && w.ground.kind[a] !== 14 && w.ground.kind[b] !== 14 && inside(a) && inside(b)) {
        door = i;
        from = a;
        dir = f;
        break;
      }
    }
  }
  check(door >= 0, 'a keyed door to pick');
  const pins = PINS[w.ground.key[door]];
  const colour = KEY_ITEM_COLORS[w.ground.key[door] - 1][0];
  const stand = () => {
    put(s.player, from);
    s.player.facing = dir;
  };
  stand();
  s.items.inv[0] = slot(LOCKPICK);
  s.items.hand = 0;
  const tt = toolTarget(w, LAYER.GROUND, s.player, LOCKPICK, []);
  check(tt?.action === 'pick' && tt.tile === door && tt.fits && tt.hp === pins, `the tool button: pick the ${colour} door (${pins} pins)`);
  step(command(0, OP.USE, 1));
  check(s.pick.length === 3 && s.pick[0] === door && s.pick[1] === 0 && last(seen, 'pick')?.what === 'start', 'picking starts');
  const spot: [number, number] = [0, 0];
  /** The next step's marker (the press lands then; the step before counts too). */
  const inZone = (k: number) => {
    sweetSpot(s.salt, door, s.pick[1], s.items.int, spot);
    const m = markerAt(k);
    return m >= spot[0] && m <= spot[1];
  };
  // A slip: pressed with the marker out of the green now and a step ago.
  for (let g = 0; g < 200 && s.pick.length && (inZone(s.step + 1 - s.pick[2]) || inZone(s.step - s.pick[2])); g++) step();
  const uses = usesOf(s.items.inv[0]);
  const ear = wouldHear(sim, { layer: LAYER.GROUND, tile: door, reach: PICK_MISS_NOISE });
  step(command(0, OP.USE, 1));
  const slip = last(seen, 'pick')!;
  const scrape = last(seen, 'noise')!;
  check(slip.what === 'slip' && s.pick[1] === 0 && usesOf(s.items.inv[0]) === uses - 1 && scrape.reach === PICK_MISS_NOISE && s.struckAt === s.step, `a slip: a scrape heard ${PICK_MISS_NOISE} tiles off, the pick worn, work on a door (tampering if seen)`);
  check(ear === scrape.heard.length > 0 || wouldHear(sim, { layer: LAYER.GROUND, tile: door, reach: PICK_MISS_NOISE }) === scrape.heard.length > 0, 'the card\'s ear is the noise\'s own rule');
  // Each pin set in the green: a click.
  for (let pin = 0; pin < pins && s.pick.length; pin++) {
    for (let g = 0; g < 200 && s.pick.length && !inZone(s.step + 1 - s.pick[2]); g++) step();
    step(command(0, OP.USE, 1));
    const e = last(seen, 'pick')!;
    if (pin < pins - 1) check(e.what === 'set' && e.pin === pin + 1 && last(seen, 'noise')!.reach === PICK_HIT_NOISE, `pin ${pin + 1} set: a click (${PICK_HIT_NOISE})`);
  }
  check(last(seen, 'pick')?.what === 'open' && s.picked[0] === door && !s.pick.length, 'the last pin: open');
  check(w.block[door] === 0 && w.npcBlock[door] === 1, 'open for the player, still shut for the inmates');
  // Through it and off the far side: locked again.
  const beyond = door + (door - from);
  let k = 0;
  while (tileOf(s.player) !== beyond && k++ < 200) step(command(dir === 9 ? 9 : dir === 1 ? 1 : dir === 13 ? 13 : 5));
  for (let j = 0; j < 30; j++) step(command(dir));
  check(!s.picked.length && w.block[door] === 1 && s.feats[FEAT.locksPicked] === 1, 'through it: it locks behind the player');
  // Picked and left: locked after 15 s.
  stand();
  s.player.x = (from % MAP_W) * UNIT + UNIT / 2;
  s.player.z = Math.floor(from / MAP_W) * UNIT + UNIT / 2;
  s.items.inv[0] = slot(LOCKPICK);
  step(command(0, OP.USE, 1));
  for (let pin = 0; pin < pins && s.pick.length; pin++) {
    for (let g = 0; g < 200 && s.pick.length && !inZone(s.step + 1 - s.pick[2]); g++) step();
    step(command(0, OP.USE, 1));
  }
  const opened = s.step;
  for (let g = 0; g < PICKED_STEPS + 10 && s.picked.length; g++) step();
  check(s.step === opened + PICKED_STEPS && w.block[door] === 1, `never gone through: locked again after ${PICKED_STEPS / STEPS_PER_SECOND} s`);
  // A step away stops the picking.
  step(command(0, OP.USE, 1));
  check(s.pick.length === 3 && s.pick[1] === 0, 'at it again');
  step(command(dir === 9 ? 1 : 9));
  check(!s.pick.length && last(seen, 'pick')?.what === 'stop', 'a step away: stopped');
  // Slips until the pick breaks.
  stand();
  s.items.inv[0] = slot(LOCKPICK, 2);
  step(command(0, OP.USE, 1));
  for (let j = 0; j < 2 && s.pick.length; j++) {
    for (let g = 0; g < 200 && s.pick.length && (inZone(s.step + 1 - s.pick[2]) || inZone(s.step - s.pick[2])); g++) step();
    step(command(0, OP.USE, 1));
  }
  check(itemOf(s.items.inv[0]) === 0 && !s.pick.length && seen.some((e) => e.type === 'broke' && e.item === LOCKPICK), 'worn out: the pick breaks');
  // A perimeter gate: no lock to pick.
  let gate = -1;
  for (let i = 0; i < MAP_W * MAP_H && gate < 0; i++) if (lockAt(w, i) === 'gate') gate = i;
  if (gate >= 0) {
    for (const [d, f] of [
      [1, 9],
      [-1, 1],
      [MAP_W, 13],
      [-MAP_W, 5],
    ] as const) {
      // (From the inside: a step onto the road would be out.)
      if (w.block[gate + d] || w.zoneAt((gate + d) % MAP_W, Math.floor((gate + d) / MAP_W)) === 'outside') continue;
      put(s.player, gate + d);
      s.player.facing = f;
      break;
    }
    s.items.inv[0] = slot(LOCKPICK);
    const g = toolTarget(w, LAYER.GROUND, s.player, LOCKPICK, []);
    step(command(0, OP.USE, 1));
    check(g?.action === 'pick' && !g.fits && !s.pick.length && seen.some((e) => e.type === 'cantStrike' && e.why === 'gate'), 'a perimeter gate: no lock to pick');
    check(!s.escaped, 'still inside');
  }
  // The player's own cell door at night, from inside.
  to(1, 23, 30);
  const cellDoor = w.cellDoor[1];
  // In bed's corner of the cell: the door locks behind the player.
  put(s.player, placesOf(w).bedside[1]);
  step();
  check(lockAt(w, cellDoor) === 'lock' && w.ground.key[cellDoor] === KEY.YELLOW, 'the cell door locked at night');
  let inside = -1;
  let face = 0;
  for (const [d, f] of [
    [1, 9],
    [-1, 1],
    [MAP_W, 13],
    [-MAP_W, 5],
  ] as const)
    if (w.cellOf[cellDoor + d] === 1) {
      inside = cellDoor + d;
      face = f;
    }
  put(s.player, inside);
  s.player.facing = face;
  s.sleeping = false;
  s.items.inv[0] = slot(LOCKPICK);
  s.items.hand = 0;
  step(command(0, OP.USE, 1));
  for (let pin = 0; pin < 2 && s.pick.length; pin++) {
    sweetSpot(s.salt, cellDoor, s.pick[1], s.items.int, spot);
    let guard = 0;
    while (guard++ < 200) {
      const m = markerAt(s.step + 1 - s.pick[2]);
      if (m >= spot[0] && m <= spot[1]) break;
      step();
    }
    step(command(0, OP.USE, 1));
  }
  check(s.picked[0] === cellDoor && w.block[cellDoor] === 0, 'the own cell door picked from inside at night');
  console.log(`lockpick: start, a slip (${PICK_MISS_NOISE}, worn), pins set (${PICK_HIT_NOISE}), open for the player alone until through or ${PICKED_STEPS / STEPS_PER_SECOND} s, a step stops it, it breaks, never a gate, the cell door at night`);
}

// ------------------------------------------------------------------ saves
{
  const twin = (a: Sim, cmds: number[]) => {
    const b = new Sim(CENTER_PERKS, 1);
    b.restore(JSON.parse(JSON.stringify(a.snapshot())));
    for (const c of cmds) {
      a.step(c);
      b.step(c);
    }
    return a.hash() === b.hash();
  };
  const { sim, to, talkTo, talk } = game(21);
  const s = sim.state;
  to(1, 10, 30);
  talkTo(0);
  s.inmates[0].opinion = 70;
  s.cash = 50;
  talk(TALK.DICE, 1);
  check(s.dice.length === 4 && twin(sim, [command(0, OP.TALK, TALK.REROLL, 3), 0, 0]), 'saved with the dice on the table: the same game');
  talk(TALK.WRESTLE);
  check(s.bout.length === 4 && twin(sim, Array.from({ length: 60 }, (_, k) => (k % 3 ? 0 : command(0, OP.TRAIN, 1 + ((k / 3) % 2))))), 'saved mid-bout: the same bout');
  // Damaged: dice that aren't dice, a bout with nobody, a lock that isn't a door.
  const bad = sim.snapshot();
  Object.assign(bad.state, { dice: [0, 9, 7, 1], bout: [99, 500, 0, 1], pick: [5, 0, 1], picked: [5, 9, 0], played: ['x'] });
  const fixed = new Sim(CENTER_PERKS, 1);
  fixed.restore(bad);
  for (let k = 0; k < 40; k++) fixed.step(0);
  check(!fixed.state.dice.length && !fixed.state.bout.length && !fixed.state.pick.length && !fixed.state.picked.length && fixed.state.played.length === 0, 'a damaged save: the broken games are gone');
  // A save from before P22 on a sports day: today and tomorrow keep the card it took the place of.
  const fresh = new Sim(CENTER_PERKS, 4);
  let day = 2;
  while (planOf(fresh, day).event !== 'sports') day++;
  const snap = fresh.snapshot();
  snap.state.step = (day - 1) * DAY_STEPS + 100;
  const old = snap.state as unknown as Record<string, unknown>;
  for (const k of ['played', 'dice', 'bout', 'pick', 'picked']) delete old[k];
  const loaded = new Sim(CENTER_PERKS, 1);
  loaded.restore(snap);
  const before = DAY_BOOKS['center-perks'].beforeSports;
  check(planOf(loaded, day).event === before, `an old save on sports day ${day}: it keeps its ${before}`);
  // Run logs: before 1.16 they replay with the old card, and a game carried on starts a log of its own.
  const rec = new RunRecorder(new Sim(CENTER_PERKS, 4), { seed: 4, game: '1.15.1' });
  const replay = replayLog({ ...rec.toLog(), from: 0, steps: day * DAY_STEPS, sums: [] }, CENTER_PERKS);
  check(!!replay && planOf(replay.sim, day).event === before, 'a run logged before P22 replays with the old card');
  const now = replayLog({ ...new RunRecorder(new Sim(CENTER_PERKS, 4), { seed: 4, game: '1.16.0' }).toLog(), from: 0, steps: day * DAY_STEPS, sums: [] }, CENTER_PERKS);
  check(!!now && planOf(now.sim, day).event === 'sports', 'one logged since deals sports day');
  const carried = new RunRecorder(new Sim(CENTER_PERKS, 4), { log: rec.toLog(), game: '1.16.0' }).toLog();
  check(carried.seed === -1 && !!carried.start, 'an old log isn\'t carried on: the game starts its own');
  console.log(`saves: dice and a bout carry on; damaged games dropped; an old save on sports day ${day} keeps its ${before}`);
}
{
  // A lock half picked, and a door picked open, saved and loaded.
  const sim = new Sim(CENTER_PERKS, 23);
  sim.state.calendar = [[0, 0, 0]];
  while (sim.state.step < at(1, 10, 30)) sim.step(0);
  const s = sim.state;
  const w = sim.world;
  const { door, from, dir: face } = plainDoor(w);
  check(door >= 0, 'a door to pick');
  put(s.player, from);
  s.player.facing = face;
  s.items.inv[0] = slot(LOCKPICK);
  s.items.hand = 0;
  sim.step(command(0, OP.USE, 1));
  const half = new Sim(CENTER_PERKS, 1);
  half.restore(JSON.parse(JSON.stringify(sim.snapshot())));
  const presses = Array.from({ length: 200 }, (_, k) => (k % 9 === 4 ? command(0, OP.USE, 1) : 0));
  for (const c of presses) {
    sim.step(c);
    half.step(c);
    sim.state.heat = half.state.heat = 0;
    sim.state.lockdown = half.state.lockdown = false;
  }
  check(half.hash() === sim.hash(), 'saved with a lock half picked: the same picking');
  s.picked = [door, s.step + PICKED_STEPS, 0];
  const open = new Sim(CENTER_PERKS, 1);
  open.restore(JSON.parse(JSON.stringify(sim.snapshot())));
  check(open.world.block[door] === 0 && open.world.pickedDoor === door, 'saved with a door picked open: it\'s open when loaded');
  console.log('saves: a lock half picked and a door picked open carry on');
}
