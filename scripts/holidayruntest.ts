/**
 * The holidays' evenings, played (P42 rules review): holidaybotstest's escape bots are out by day 2
 * at 10:17, before any holiday day's evening, so here a bot keeps the routine at Center Perks
 * through each holiday's day, playing it as a player would, by commands only: summer's ice lolly
 * and tool work on the sports ground's wall through the water fight (the soaked guards see two
 * tiles); costume night's costume, worn among the inmates from 19:00 to 21:00 (each laughs once,
 * never after); Christmas Day's present, given; and work on the cell's wall under New Year's
 * fireworks (every strike drowned, nobody sent to look). Each run's outcome is the golden output.
 */
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { HOLIDAY, TREAT, WET_SIGHT } from '../src/content/holidays';
import { command, EXT, OP, SLOT, TALK } from '../src/sim/command';
import type { SimEvent } from '../src/sim/Sim';
import { placesOf } from '../src/sim/ai/places';
import { sightOf } from '../src/sim/systems/calendar';
import { dayMinute, formatTime } from '../src/sim/systems/clock';
import { soaked } from '../src/sim/systems/holiday';
import { DOING } from '../src/sim/systems/inmates';
import { itemOf, slot } from '../src/sim/systems/items';
import { FEAT } from '../src/sim/systems/ledger';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { containersOf } from '../src/sim/world/containers';
import { TILE } from '../src/sim/world/tiles';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';
import { Bot, DIR, n } from './bots';

type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const clock = (bot: Bot) => formatTime(bot.sim.clock);

/** A bot under a holiday at Center Perks, two forks in its pockets (a plastic fork is no contraband). */
function start(holiday: number, seed: number): Bot {
  Bot.holiday = holiday;
  const bot = new Bot(CENTER_PERKS, seed);
  Bot.holiday = 0;
  bot.st.items.inv[4] = slot(n('plastic_fork'));
  bot.st.items.inv[5] = slot(n('plastic_fork'));
  return bot;
}

/** Every event of a type from now on, with the clock, the prison day's minute and the step (the bot's own log keeps only the notable ones). */
function watch<T extends SimEvent['type']>(bot: Bot, type: T, test: (e: Ev<T>) => boolean = () => true) {
  const seen: Array<{ e: Ev<T>; at: string; m: number; step: number }> = [];
  const prev = bot.step;
  bot.step = (cmd = 0) => {
    prev.call(bot, cmd);
    for (const e of bot.sim.events) if (e.type === type && test(e as Ev<T>)) seen.push({ e: e as Ev<T>, at: clock(bot), m: dayMinute(bot.st.step), step: bot.st.step });
  };
  return seen;
}

/** Opens a container from a floor tile beside it, facing it; whether it opened. */
function openBox(bot: Bot, index: number): boolean {
  const p = containersOf(bot.sim.world)[index].prop;
  const w = bot.sim.world;
  const tiles: Array<[number, number]> = [];
  for (let x = p.x; x < p.x + p.w; x++) {
    tiles.push([(p.z - 1) * MAP_W + x, DIR.SOUTH], [(p.z + p.d) * MAP_W + x, DIR.NORTH]);
  }
  for (let z = p.z; z < p.z + p.d; z++) {
    tiles.push([z * MAP_W + p.x - 1, DIR.EAST], [z * MAP_W + p.x + p.w, DIR.WEST]);
  }
  for (const [t, face] of tiles) {
    if (w.blocked(t % MAP_W, Math.floor(t / MAP_W))) continue;
    if (!bot.walkTo(t, 2000)) continue;
    bot.face(face);
    for (let k = 0; k < 3; k++) if (bot.open(index)) return true;
  }
  return false;
}

/** A treat from the furniture it's had from (the take button: EXT.HOLIDAY). */
function takeTreat(bot: Bot, table: string, what: number): boolean {
  const index = containersOf(bot.sim.world).findIndex((c) => c.table === table);
  check(openBox(bot, index), `${clock(bot)}: the ${table} opens`);
  bot.step(command(0, OP.EXT, EXT.HOLIDAY, what));
  const took = bot.sim.events.some((e) => e.type === 'holiday' && e.what === 'took');
  bot.close();
  return took;
}

/** Up to an inmate (the nearest one up and about, not one of `skip`), a step at a time; the inmate it reached, or -1. */
function reachInmate(bot: Bot, skip: (k: number) => boolean, limit: number, near = UNIT): number {
  const st = bot.st;
  let goal = -1;
  for (let k = 0; k < limit && !bot.done; k++) {
    if (k % 40 === 0 || goal < 0) {
      goal = -1;
      let best = Infinity;
      st.inmates.forEach((m, i) => {
        if (m.ko > 0 || m.doing === DOING.SLEEP || skip(i)) return;
        const d = Math.abs(m.body.x - st.player.x) + Math.abs(m.body.z - st.player.z);
        if (d < best) [best, goal] = [d, i];
      });
      if (goal < 0) return -1;
    }
    const m = st.inmates[goal];
    if (Math.max(Math.abs(m.body.x - st.player.x), Math.abs(m.body.z - st.player.z)) <= near) return goal;
    if (k % 10 === 0) bot.pilot.goTo(Math.floor(m.body.z / UNIT) * MAP_W + Math.floor(m.body.x / UNIT));
    bot.step(command(bot.pilot.dir(st.player)));
  }
  bot.pilot.stop();
  return -1;
}

const out: string[] = [];

// ------------------------------------------------------------------ summer: tool work through the water fight
{
  const bot = start(HOLIDAY.SUMMER, 61);
  const st = bot.st;
  const w = bot.sim.world;
  const spotted = watch(bot, 'spotted');
  const strikes = watch(bot, 'strike');
  const splash = watch(bot, 'holiday', (e) => e.what === 'splash');
  check(bot.routineUntil(2, 9 * 60 + 10), 'summer: to breakfast on day 2');
  const lolly = takeTreat(bot, 'canteenCounter', TREAT.LOLLY);
  check(lolly && bot.slotOf('ice_lolly') >= 0, `summer: an ice lolly from the canteen counter at ${clock(bot)}`);
  // The exercise hour: out onto the sports ground by its wall at once; there, once its guard has reached the post, along the
  // wall to a stretch 3 to 5 tiles from the guard (further than a soaked guard sees, close enough for a dry one).
  check(bot.routineUntil(2, 15 * 60 + 1), 'summer: to the exercise hour');
  const zoneOf = (t: number) => w.zoneAt(t % MAP_W, Math.floor(t / MAP_W));
  const tileOfBody = (b: { x: number; z: number }) => Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);
  const nextTo: Array<[number, number]> = [[1, DIR.EAST], [-1, DIR.WEST], [MAP_W, DIR.SOUTH], [-MAP_W, DIR.NORTH]];
  const walls = placesOf(w)
    .floor.flat()
    .filter((t) => zoneOf(t) === 'sports' && nextTo.some(([d]) => w.ground.kind[t + d] === TILE.BRICK))
    .sort((a, b) => a - b);
  const near = (t: number) => Math.abs((t % MAP_W) - (bot.tile % MAP_W)) + Math.abs(Math.floor(t / MAP_W) - Math.floor(bot.tile / MAP_W));
  const first = walls.reduce((a, b) => (near(b) < near(a) ? b : a), walls[0]);
  check(walls.length > 0 && bot.walkTo(first, 3000), `summer: on the sports ground by its wall at ${clock(bot)}`);
  const posted = () => st.guards.find((g) => zoneOf(tileOfBody(g.body)) === 'sports');
  check(bot.until(() => !!posted(), 15 * STEPS_PER_MINUTE), `summer: a guard posted on the sports ground by ${clock(bot)}`);
  const post = tileOfBody(posted()!.body);
  const off = (t: number) => Math.max(Math.abs((t % MAP_W) - (post % MAP_W)), Math.abs(Math.floor(t / MAP_W) - Math.floor(post / MAP_W)));
  const spot = walls.find((t) => off(t) > WET_SIGHT && off(t) <= WET_SIGHT + 3) ?? -1;
  check(spot >= 0, 'summer: a stretch of wall near the guard');
  const face = nextTo.find(([d]) => w.ground.kind[spot + d] === TILE.BRICK)![1];
  check(bot.walkTo(spot, 3000), `summer: at the sports ground's wall (${spot % MAP_W},${Math.floor(spot / MAP_W)}) by ${clock(bot)}`);
  check(st.feats[FEAT.waterFights] === 1 && splash.length === 1, 'summer: out on the sports ground in the water fight: splashed, once');
  bot.face(face);
  bot.hold('plastic_fork');
  const fightFrom = st.step;
  // Through the water fight: a strike a minute whenever no guard is within WET_SIGHT tiles (a soaked one sees no further); each guard out there soaked.
  let wetSeen = 0;
  let closest = Infinity;
  let wetChecked = 0;
  while (dayMinute(st.step) < 450 && !bot.done) {
    for (const g of st.guards) {
      if (['yard', 'sports'].includes(zoneOf(tileOfBody(g.body)))) {
        wetChecked++;
        if (!soaked(bot.sim, g) || sightOf(bot.sim, g) !== WET_SIGHT * UNIT) wetSeen++;
      }
    }
    const gap = Math.min(...st.guards.map((g) => Math.max(Math.abs(g.body.x - st.player.x), Math.abs(g.body.z - st.player.z))));
    if (gap > WET_SIGHT * UNIT + UNIT / 2 && st.step % STEPS_PER_MINUTE === 0) {
      closest = Math.min(closest, gap);
      bot.use();
    } else bot.step(0);
  }
  check(wetChecked > 0 && wetSeen === 0, `summer: every guard out in the yard or on the sports ground soaked, seeing ${WET_SIGHT} tiles (${wetChecked} looks)`);
  const struck = strikes.filter((s) => s.step > fightFrom);
  const caught = spotted.filter((s) => s.step > fightFrom);
  check(struck.length > 0, 'summer: tool work through the water fight');
  // (Dinner: one ice lolly a day, and none once the water fight's over.)
  check(bot.routineUntil(2, 17 * 60 + 5), 'summer: to dinner');
  const refused = watch(bot, 'refused');
  const again = takeTreat(bot, 'canteenCounter', TREAT.LOLLY);
  check(!again && st.feats[FEAT.treats] === 1 && refused.length === 0, `summer: no ice lolly offered once the water fight's over (not "one a day": ${refused.map((r) => r.e.why).join() || 'none'})`);
  check(bot.routineUntil(2, 22 * 60 + 15), 'summer: the day kept');
  out.push(
    `summer: an ice lolly at ${lolly ? 'breakfast' : '-'}; the water fight: splashed at ${splash[0].at}, ${struck.length} fork strikes on the sports ground's wall (the nearest guard ${(closest / UNIT).toFixed(1)} tiles off), spotted ${caught.length}${caught.length ? ` (${caught.map((c) => c.e.reason).join(', ')})` : ''}; no ice lolly at dinner; heat peak ${bot.heatPeak}, ${st.solitary > 0 ? 'in solitary' : 'not in solitary'} at ${clock(bot)}`,
  );
}

// ------------------------------------------------------------------ halloween: costume night among the inmates
{
  const bot = start(HOLIDAY.HALLOWEEN, 62);
  const st = bot.st;
  const laughs = watch(bot, 'holiday', (e) => e.what === 'laugh');
  check(bot.routineUntil(2, 9 * 60 + 10), 'halloween: to breakfast on day 2');
  check(takeTreat(bot, 'canteenCounter', TREAT.COSTUME) && bot.slotOf('costume') >= 0, `halloween: a costume from the canteen counter at ${clock(bot)}`);
  check(bot.routineUntil(2, 18 * 60 + 58), 'halloween: to the evening');
  bot.op(OP.EQUIP, bot.slotOf('costume'));
  check(itemOf(st.items.inv[SLOT.OUTFIT]) === n('costume'), 'halloween: in costume');
  const opinions = st.inmates.map((m) => m.opinion);
  // Among the inmates: to each one not yet laughing, in turn, until four have; then back to the cell until 21:00.
  const at = (minute: number) => (2 - 1) * 1440 * STEPS_PER_MINUTE + minute * STEPS_PER_MINUTE;
  while (st.step < at(780) && laughs.length < 4 && !bot.done) {
    // (Beside one: a step there, for the laugh.)
    reachInmate(bot, (i) => st.laughed.includes(i, 1), Math.min(400, at(780) - st.step));
    bot.step(0);
  }
  const fourth = laughs[laughs.length - 1]?.at;
  bot.walkTo(placesOf(bot.sim.world).bedside[1], 2000);
  bot.until(() => st.step >= at(780), at(780) - st.step + 1);
  const during = laughs.length;
  // Twenty minutes more after 21:00, up to those who haven't laughed: nobody does.
  const reached = new Set<number>();
  while (st.step < at(800) && !bot.done) {
    const k = reachInmate(bot, (i) => st.laughed.includes(i, 1) || reached.has(i), Math.min(400, at(800) - st.step));
    if (k >= 0) reached.add(k);
    bot.step(0);
  }
  const who = laughs.map((l) => l.e.who!);
  check(during >= 4 && laughs.length === during && reached.size > 0, `halloween: ${during} laughed during costume night; none of the ${reached.size} met after 21:00`);
  check(laughs.every((l) => l.m >= 660 && l.m < 780) && new Set(who).size === who.length, 'halloween: every laugh between 19:00 and 21:00, each inmate once');
  check(st.feats[FEAT.laughs] === during && st.inmates.every((m, k) => !who.includes(k) || m.opinion > opinions[k] || m.opinion === 100), 'halloween: each laugh counted, the inmate fonder');
  bot.op(OP.EQUIP, bot.slotOf('inmate_outfit'));
  check(bot.routineUntil(2, 22 * 60 + 15), 'halloween: the day kept');
  out.push(`halloween: a costume at breakfast; costume night: ${during} inmates laughed (${laughs[0]?.at}–${fourth}${during > 4 ? `, ${laughs[laughs.length - 1].at}` : ''}), none of the ${reached.size} met after 21:00; heat peak ${bot.heatPeak}, ${st.solitary > 0 ? 'in solitary' : 'not in solitary'} at ${clock(bot)}`);
}

// ------------------------------------------------------------------ christmas: a present given; work under the New Year's fireworks
{
  const bot = start(HOLIDAY.CHRISTMAS, 63);
  const st = bot.st;
  const w = bot.sim.world;
  const gifts = watch(bot, 'gift');
  const noises = watch(bot, 'noise', (e) => e.kind === 'strike');
  const spotted = watch(bot, 'spotted');
  check(bot.routineUntil(2, 9 * 60 + 10), 'christmas: to breakfast on day 2');
  check(takeTreat(bot, 'canteenCounter', TREAT.GIFT) && bot.slotOf('gift') >= 0, `christmas: a present from under the tree at ${clock(bot)}`);
  check(bot.routineUntil(2, 10 * 60 + 5), 'christmas: to free time');
  let to = -1;
  for (let tries = 0; tries < 20 && st.talk < 0; tries++) {
    const k = reachInmate(bot, () => false, 600);
    if (k < 0) continue;
    bot.act();
    to = st.talk;
  }
  check(to >= 0 && to === st.talk, `christmas: talking to an inmate at ${clock(bot)}`);
  const was = st.inmates[to].opinion;
  bot.op(OP.TALK, TALK.GIFT, bot.slotOf('gift'));
  check(gifts.length === 1 && bot.slotOf('gift') < 0 && st.inmates[to].opinion > was && st.feats[FEAT.giftsGiven] === 1, `christmas: the present given (opinion ${was} → ${st.inmates[to].opinion})`);
  bot.op(OP.CLOSE);
  // Day 3, Lights Out: in the cell, a strike a minute on its wall while New Year's fireworks go off (00:00–00:10).
  check(bot.routineUntil(3, 23 * 60 + 50), 'christmas: to Lights Out on day 3');
  const places = placesOf(w);
  check(bot.walkTo(places.bedside[1], 400), 'christmas: in the cell');
  const nextTo: Array<[number, number]> = [[1, DIR.EAST], [-1, DIR.WEST], [MAP_W, DIR.SOUTH], [-MAP_W, DIR.NORTH]];
  const wall = nextTo.find(([d]) => w.ground.kind[bot.tile + d] === TILE.BRICK);
  check(!!wall, 'christmas: beside the cell wall');
  bot.face(wall![1]);
  bot.hold('plastic_fork');
  const from = st.step;
  const until = (3 - 1) * 1440 * STEPS_PER_MINUTE + 970 * STEPS_PER_MINUTE;
  while (st.step < until && !bot.done) {
    const m = dayMinute(st.step);
    if (st.step % STEPS_PER_MINUTE === 0 && m >= 960) bot.use();
    else bot.step(0);
  }
  const hits = noises.filter((x) => x.step > from);
  check(hits.length === 10 && hits.every((x) => x.e.reach === 1 && x.e.sent.length === 0), `christmas: ${hits.length} strikes under the fireworks, each heard 1 tile off, nobody sent (${hits.map((x) => `${x.e.reach}/${x.e.sent.length}`).join(' ')})`);
  check(st.feats[FEAT.fireworkWork] === hits.length, `christmas: each counted as work under the fireworks (${st.feats[FEAT.fireworkWork]})`);
  const caught = spotted.filter((x) => x.step > from);
  check(caught.length === 0, `christmas: nobody saw the work (${caught.map((c) => c.e.reason).join(', ')})`);
  check(bot.routineUntil(4, 9 * 60), 'christmas: the morning after');
  out.push(`christmas: a present at breakfast, given at ${gifts[0].at} (opinion ${was} → ${st.inmates[to].opinion}); new year: ${hits.length} fork strikes on the cell wall under the fireworks, heard 1 tile off, nobody sent, spotted ${caught.length}; heat peak ${bot.heatPeak}, ${st.solitary > 0 ? 'in solitary' : 'not in solitary'} at ${clock(bot)}`);
}

console.log(out.join('\n'));
