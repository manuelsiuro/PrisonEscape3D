/**
 * Gangs and turf (2.36, session 16), in every prison, by real commands:
 * - **the data:** two or three gangs a prison (none at the Training Block), each inmate in one at most, every
 *   boss a merchant and a member; every turf tile open floor of its zone, clear of everything used (counters,
 *   machines, the vending machine and the cooler and their queues, the menu board, the phone, the stage, the
 *   pitch and the track, roll call's squares, doors and the tiles beside them), and the whole prison still
 *   walkable with every turf tile left out (nobody is ever forced across one);
 * - **meeting them:** a run that never speaks to a gang member has no gang record and seats nobody by gang
 *   (every bot's run plays as before); a first word with one starts it;
 * - **the initiation walked:** refused below 65, asked for at 65, the tribute in the rival boss's desk, walked
 *   to, taken, walked back and handed in: in, the gang thinking more of the player and every rival less, with
 *   the time it took against the free time there is;
 * - **the discount paid as shown:** at the player's own boss, what the card asks is what the till takes, less
 *   than a stranger pays;
 * - **turf held:** on day 2 at dinner the members at their own tables, in the evening at their corners;
 * - **trespass:** a member on a rival's held table is told (a warning, 6 s), walks off in time and nothing
 *   happens; stays and one of them squares up; someone in no gang is never told;
 * - **backup:** a gang mate close by goes for whoever is after the player and lands blows;
 * - **the war day:** two gangs' members brawl at its ground, guards drawn there; the player, of one side and
 *   close by, is gone for once; the deck holds the card once, and an old log or save keeps the card it replaced;
 * - **leaving and thrown out;** a lockdown holds nothing; a save and a load mid-way go on as the run did;
 * - **old rules:** a run logged before 2.36 (`Sim.rules235`) has no gangs at all.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { DAY_BOOKS, DAY_EVENTS } from '../src/content/days';
import { GANGS, TRIBUTE } from '../src/content/gangs';
import { PRISONS } from '../src/content/prisons';
import { TRAINING } from '../src/content/prisons/training';
import type { PrisonDef } from '../src/content/prisons/types';
import { ROUTINE } from '../src/content/routine';
import { itemDef } from '../src/content/items';
import { RECIPES } from '../src/content/recipes';
import { command, EXT, OP, TALK } from '../src/sim/command';
import { prepareReplay } from '../src/sim/runlog';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { dayPlan, eventOn } from '../src/sim/systems/calendar';
import { FAVOR, FAVOR_STATE } from '../src/sim/systems/economy';
import {
  askOf,
  G,
  gangOf,
  gangsHere,
  initiationGoal,
  isTribute,
  playerGang,
  rivalBoss,
  tributeDesk,
  tributeOf,
  turfAt,
  warGround,
  warningLeft,
  warring,
} from '../src/sim/systems/gangs';
import { DOING, inmateInCell } from '../src/sim/systems/inmates';
import { HOTBAR, ingredientSlots, itemOf, slot } from '../src/sim/systems/items';
import { newRat } from '../src/sim/systems/rats';
import { isFloor, placesOf } from '../src/sim/ai/places';
import { containersOf } from '../src/sim/world/containers';
import { TILE } from '../src/sim/world/tiles';
import { MAP_H, MAP_W } from '../src/sim/world/World';
import {
  ANGRY_STEPS,
  GANG_JOIN_OPINION,
  GANG_LEAVE_OPINION,
  GANG_OPINION,
  GANG_RIVAL_OPINION,
  STEPS_PER_MINUTE,
  TRESPASS_STEPS,
  UNIT,
} from '../src/sim/tuning';
import { check } from './assert';
import { Bot, DIR, n } from './bots';

GlobalRegistrator.register({ url: 'http://localhost:5310/', width: 1440, height: 844 });
const { boxTitle } = await import('../src/play/labels');
const { favorText, inmateName } = await import('../src/ui/names');

const MIN = STEPS_PER_MINUTE;
const tileOf = (b: { x: number; z: number }) => Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);
const dist = (a: number, b: number) => Math.abs((a % MAP_W) - (b % MAP_W)) + Math.abs(Math.floor(a / MAP_W) - Math.floor(b / MAP_W));
const inRect = (r: readonly number[], t: number) => {
  const x = t % MAP_W;
  const z = Math.floor(t / MAP_W);
  return x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3];
};
type GangEv = Extract<SimEvent, { type: 'gang' }>;
const gangEv = (seen: readonly SimEvent[], what: string) => seen.filter((e): e is GangEv => e.type === 'gang' && e.what === what);
const refused = (seen: readonly SimEvent[], why: string) => seen.some((e) => e.type === 'refused' && e.why === why);

/** The way to face from one tile to the next one beside it. */
function dirTo(from: number, to: number): number {
  const dx = (to % MAP_W) - (from % MAP_W);
  const dz = Math.floor(to / MAP_W) - Math.floor(from / MAP_W);
  return dx > 0 ? DIR.EAST : dx < 0 ? DIR.WEST : dz > 0 ? DIR.SOUTH : DIR.NORTH;
}
function besides(sim: Sim, t: number): number[] {
  const x = t % MAP_W;
  const z = Math.floor(t / MAP_W);
  return [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
    .map(([dx, dz]) => (z + dz) * MAP_W + x + dx)
    .filter((k) => !sim.world.blocked(k % MAP_W, Math.floor(k / MAP_W)));
}

/** Walked up to an inmate and talking (they're held still while the player gets there). */
function meet(bot: Bot, who: number): boolean {
  const s = bot.st;
  const m = s.inmates[who];
  for (let k = 0; k < 30 && s.talk !== who; k++) {
    m.path = [];
    m.goal = -1;
    m.wait = 1_000_000;
    const t = tileOf(m.body);
    const here = bot.tile;
    const sides = besides(bot.sim, t).sort((a, b) => dist(a, here) - dist(b, here));
    if (!sides.length) {
      bot.step();
      continue;
    }
    // (Someone else in the way took the press, a guard passing: let go, and from another side next time.)
    if (s.talk >= 0) bot.op(OP.CLOSE);
    const side = sides[k % sides.length];
    if (here !== side) bot.walkTo(side, 3000);
    if (bot.tile !== side) continue;
    bot.face(dirTo(side, t));
    bot.act();
  }
  return s.talk === who;
}
function say(bot: Bot, who: number, a: number, b = 0): SimEvent[] {
  if (bot.st.talk !== who) meet(bot, who);
  const from = bot.events.length;
  bot.op(OP.TALK, a, b);
  return bot.events.slice(from);
}

/** Walks to a desk, opens it and takes `item` from its drawers (whether it did). */
function fetchFromDesk(bot: Bot, i: number, item: number): boolean {
  const sim = bot.sim;
  const c = containersOf(sim.world)[i];
  const t = c.prop.z * MAP_W + c.prop.x;
  for (const side of besides(sim, t)) {
    if (!bot.walkTo(side, 4000)) continue;
    bot.face(dirTo(side, t));
    if (!bot.open(i)) continue;
    const k = bot.st.items.containers[i].findIndex((v, j) => j >= c.hidden && itemOf(v) === item);
    const free = bot.st.items.inv.slice(0, HOTBAR).indexOf(0);
    if (k < 0 || free < 0) return false;
    bot.op(OP.MOVE, 8 + k, free);
    bot.close();
    return bot.slotOf(itemDef(item).id) >= 0;
  }
  return false;
}

// ---------------------------------------------------------------- the data
function useTiles(def: PrisonDef, sim: Sim): Map<number, string> {
  const w = sim.world;
  const pl = placesOf(w);
  const use = new Map<number, string>();
  const put = (x: number, z: number, why: string) => use.set(z * MAP_W + x, why);
  const rect = (x0: number, z0: number, x1: number, z1: number, why: string) => {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) put(x, z, why);
  };
  pl.rollCall.forEach((s) => use.set(s.tile, 'a roll call square'));
  pl.counters.forEach((s) => use.set(s.tile, 'the serving counter'));
  pl.machines.forEach((s) => use.set(s.tile, 'a machine'));
  pl.showers.forEach((s) => use.set(s.tile, 'a shower'));
  pl.shelves.forEach((s) => use.set(s.tile, 'a shelf'));
  if (def.vending) [def.vending, ...def.vending.line].forEach((q) => put(q.x, q.z, 'the vending machine'));
  if (def.cooler) [def.cooler, ...def.cooler.spots].forEach((q) => put(q.x, q.z, 'the cooler'));
  if (def.menu) for (let x = def.menu.x - 1; x <= def.menu.x + def.menu.w; x++) put(x, def.menu.z, 'the menu board');
  if (def.board) put(def.board.x, def.board.z, 'the odd jobs board');
  if (def.comms) [def.comms.phone, ...def.comms.line, def.comms.kiosk].forEach((q) => put(q.x, q.z, 'the phone or kiosk'));
  const l = def.leisure;
  if (l) {
    [l.hoop, ...l.hoop.spots].forEach((q) => put(q.x, q.z, 'the hoop'));
    rect(l.garden.x, l.garden.z, l.garden.x + l.garden.w - 1, l.garden.z + l.garden.d - 1, 'the garden');
    rect(l.pitch.x, l.pitch.z, l.pitch.x + l.pitch.w - 1, l.pitch.z + l.pitch.d - 1, 'the pitch');
    if (l.track) rect(l.track.x, l.track.z, l.track.x + l.track.w - 1, l.track.z + l.track.d - 1, 'the track');
    if (l.stage) rect(l.stage.x - 1, l.stage.z - 1, l.stage.x + 1, l.stage.z + 1, 'the stage');
    l.quiz?.spots.forEach((q) => put(q.x, q.z, 'the quiz'));
  }
  for (let z = 0; z < MAP_H; z++)
    for (let x = 0; x < MAP_W; x++)
      if (w.ground.kind[z * MAP_W + x] === TILE.DOOR) {
        put(x, z, 'a door');
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ])
          if (!use.has((z + dz) * MAP_W + x + dx)) put(x + dx, z + dz, 'beside a door');
      }
  return use;
}

for (const def of PRISONS) {
  const sim = new Sim(def, 1);
  const w = sim.world;
  const gangs = def.gangs ?? [];
  check(gangs.length >= 2 && gangs.length <= 3, `${def.id}: ${gangs.length} gangs`);
  const cells = def.names.map((_, k) => k + 2);
  const counted = new Map<number, number>();
  for (const g of gangs) {
    check(
      def.merchants.includes(g.boss) && g.members.includes(g.boss),
      `${def.id}: ${g.id}'s boss (cell ${g.boss}) a merchant and a member`,
    );
    for (const c of g.members) {
      check(cells.includes(c), `${def.id}: ${g.id}'s member cell ${c} has an inmate`);
      counted.set(c, (counted.get(c) ?? 0) + 1);
    }
    check(GANGS.includes(g.id), `${def.id}: ${g.id} is a gang`);
  }
  check(
    [...counted.values()].every((k) => k === 1),
    `${def.id}: nobody in two gangs`,
  );
  const use = useTiles(def, sim);
  const turf = new Set<number>();
  const trouble: string[] = [];
  for (const g of gangs)
    for (const [kind, r] of [
      ['table', g.table],
      ['corner', g.corner],
    ] as const) {
      let floor = 0;
      for (let x = r[0]; x <= r[2]; x++)
        for (let z = r[1]; z <= r[3]; z++) {
          const t = z * MAP_W + x;
          const zone = w.zoneAt(x, z);
          if (turf.has(t)) trouble.push(`${g.id}'s ${kind} ${x},${z} overlaps another`);
          turf.add(t);
          if (kind === 'table' ? zone !== 'canteen' : zone !== 'yard' && zone !== 'sports')
            trouble.push(`${g.id}'s ${kind} ${x},${z} in ${zone}`);
          if (use.has(t)) trouble.push(`${g.id}'s ${kind} ${x},${z}: ${use.get(t)}`);
          if (!w.blocked(x, z)) floor++;
        }
      if (floor < 2) trouble.push(`${g.id}'s ${kind}: ${floor} floor tiles`);
    }
  for (const g of gangs) {
    const seats = placesOf(w).seats.filter((q) => inRect(g.table, q.tile)).length;
    if (seats < 2) trouble.push(`${g.id}'s table: ${seats} seats`);
  }
  // The prison walked with every turf tile left out: nothing cut off.
  const flood = (avoid: boolean) => {
    const seen = new Uint8Array(MAP_W * MAP_H);
    const q = [def.spawn.z * MAP_W + def.spawn.x];
    seen[q[0]] = 1;
    while (q.length) {
      const i = q.pop()!;
      const tx = i % MAP_W;
      const tz = (i - tx) / MAP_W;
      for (const [nx, nz] of [
        [tx + 1, tz],
        [tx - 1, tz],
        [tx, tz + 1],
        [tx, tz - 1],
      ]) {
        if (w.blocked(nx, nz)) continue;
        const j = nz * MAP_W + nx;
        if ((avoid && turf.has(j)) || seen[j]) continue;
        seen[j] = 1;
        q.push(j);
      }
    }
    return seen;
  };
  const all = flood(false);
  const around = flood(true);
  let cut = 0;
  for (let i = 0; i < all.length; i++) if (all[i] && !around[i] && !turf.has(i)) cut++;
  check(trouble.length === 0, `${def.id}: turf on open floor, clear of what's used: ${trouble.join('; ') || 'ok'}`);
  check(cut === 0, `${def.id}: every tile reachable without crossing turf (${cut} cut off)`);
  const book = DAY_BOOKS[def.id];
  check(
    // (A prison built with the war in its deck, the Six Hunter: no card it took the place of.)
    book.deck.filter((e) => e === 'gangWar').length === 1 &&
      (def.difficulty > 5 ? !book.beforeGangs : !!book.beforeGangs && !book.deck.includes(book.beforeGangs)),
    `${def.id}: the gang war once a week, in place of ${book.beforeGangs}`,
  );
  const free = cells.filter((c) => !counted.has(c));
  console.log(
    `${def.id}: ${gangs.map((g) => `${g.id} [${g.members.join(',')}] boss ${g.boss}`).join('; ')}; no gang: ${free.join(',') || 'none'}; ${turf.size} turf tiles; the war in place of ${book.beforeGangs ?? 'nothing: built with it'}`,
  );
}
check(!TRAINING.gangs, 'the Training Block has no gangs');

// ---------------------------------------------------------------- by real commands, every prison
const WAR = DAY_EVENTS.indexOf('gangWar');
for (const def of PRISONS) {
  const id = def.id;
  // (Day 2 is the war's, forced: one run covers the day before and the war.)
  const bot = new Bot(def, 3);
  const { sim, st } = bot;
  st.calendar = [[2, WAR, -1]];
  const war = warring(sim, 2)!;
  check(!!war, `${id}: day 2 is the gang war's (${war?.join(' vs ')})`);
  const mine = war[0];
  const g = def.gangs![mine];
  const boss = inmateInCell(st, g.boss);
  bot.routineUntil(1, 10 * 60 + 2);
  check(ROUTINE[st.routine].id === 'freeTime' && st.gang === undefined, `${id}: free time, no gang record yet`);

  // Meeting them: a first word with a member.
  const mate = g.members.map((c) => inmateInCell(st, c)).find((k) => k !== boss) ?? boss;
  check(
    meet(bot, mate) && st.gang?.[G.MET] === 1 && gangEv(bot.events, 'met').length === 1,
    `${id}: a first word with ${mate}: the gangs met`,
  );
  bot.op(OP.CLOSE);

  // Every gang's initiation walked, on copies of the run: its tribute in its rival boss's desk, fetched, handed in.
  const joins: string[] = [];
  def.gangs!.forEach((gd, k) => {
    if (k === mine) return;
    const c = new Bot(def, 3);
    c.sim.restore(sim.snapshot());
    const b = inmateInCell(c.st, gd.boss);
    c.st.inmates[b].opinion = GANG_OPINION;
    const t1 = c.st.step;
    say(c, b, TALK.JOIN);
    c.st.inmates[b].wait = 0;
    const fk = c.st.favors.find((x) => x.by === b && x.kind === FAVOR.INITIATION);
    c.op(OP.CLOSE);
    const ok = !!fk && fetchFromDesk(c, tributeDesk(c.sim, fk), fk.item) && gangEv(say(c, b, TALK.HAND_IN), 'joined').length === 1;
    check(ok && playerGang(c.sim) === k, `${id}: ${gd.id}'s initiation walked (${TRIBUTE[gd.id]} from ${rivalBoss(c.sim, k)}'s desk)`);
    joins.push(`${gd.id} ${Math.round((c.st.step - t1) / MIN)} min`);
  });

  // The initiation: refused below 65; asked for at 65; walked; handed in.
  const opinionAt = st.inmates[boss].opinion;
  st.inmates[boss].opinion = GANG_OPINION - 1;
  check(refused(say(bot, boss, TALK.JOIN), 'gangOpinion'), `${id}: at ${GANG_OPINION - 1} the boss won't have the player`);
  st.inmates[boss].opinion = GANG_OPINION;
  const t0 = st.step;
  // (Held still while it's said; let go after, as anyone would wander off.)
  say(bot, boss, TALK.JOIN);
  st.inmates[boss].wait = 0;
  const f = st.favors.find((x) => x.by === boss);
  check(f?.kind === FAVOR.INITIATION && f.state === FAVOR_STATE.TAKEN, `${id}: the initiation taken on`);
  const rival = rivalBoss(sim, mine);
  check(f?.target === rival && f.item > 0, `${id}: the tribute (${TRIBUTE[g.id]}) from the rival boss ${rival}'s desk`);
  const desk = f ? tributeDesk(sim, f) : -1;
  const there = desk >= 0 && st.items.containers[desk].some((v, j) => j >= containersOf(sim.world)[desk].hidden && itemOf(v) === f!.item);
  check(there, `${id}: the tribute is in that desk's drawers`);
  bot.op(OP.CLOSE);
  // (Review: a second initiation while one is under way, refused: two at once were a free switch.)
  {
    const other = def.gangs!.findIndex((_, k) => k !== mine);
    const ob = inmateInCell(st, def.gangs![other].boss);
    const was = st.inmates[ob].opinion;
    st.inmates[ob].opinion = GANG_OPINION;
    check(refused(say(bot, ob, TALK.JOIN), 'initiating'), `${id}: a second gang's initiation refused while one is under way`);
    st.inmates[ob].opinion = was;
    bot.op(OP.CLOSE);
  }
  // (Review: the tribute is the one from the desk: one from elsewhere isn't taken.)
  {
    const c = new Bot(def, 3);
    c.sim.restore(sim.snapshot());
    const free = c.st.items.inv.slice(0, HOTBAR).indexOf(0);
    c.st.items.inv[free] = slot(f!.item);
    check(
      refused(say(c, boss, TALK.HAND_IN), 'notTribute') && playerGang(c.sim) < 0,
      `${id}: a ${TRIBUTE[g.id]} not from the desk: not taken`,
    );
  }
  // (Polish: the quote and the desk's title name the rival boss and his cell; the arrows lead to his desk, then back to the boss;
  // a lost tribute is put back in the rival boss's desk so the initiation never locks; crafting prefers an unmarked copy; a pet rat
  // fetches the tribute ahead of dearer things, sugar included.)
  {
    const rivalCell = st.inmates[rival].cell;
    const rivalName = inmateName(sim, rival);
    check(
      favorText(sim, f!).includes(rivalName) && favorText(sim, f!).includes(String(rivalCell)),
      `${id}: the initiation quote names ${rivalName} and cell ${rivalCell}`,
    );
    check(
      boxTitle(sim, desk).includes(rivalName) && boxTitle(sim, desk).includes(String(rivalCell)),
      `${id}: the rival desk's title names ${rivalName} and cell ${rivalCell}`,
    );
    const goal0 = initiationGoal(sim);
    check(!!goal0 && goal0(placesOf(sim.world).deskside[rivalCell]), `${id}: arrows lead to ${rivalName}'s desk before fetching`);
    // Lost tribute re-planted, and fetched by a pet rat.
    const c = new Bot(def, 3);
    c.sim.restore(sim.snapshot());
    c.st.items.containers[desk].fill(0);
    c.step();
    check(c.st.items.containers[desk].includes(tributeOf(f!)), `${id}: tribute lost, put back in ${rivalName}'s desk on the next step`);
    // (2.37: only a tribute used up is put back, once a prison day; one hidden elsewhere still counts, so it can't be farmed.
    // The snapshot is taken after c's own re-plant today: each bot forgets it first, or nothing below could fail.)
    {
      const marked = (b: Bot) =>
        b.st.items.containers.reduce((t, box) => t + box.filter((v) => v === tributeOf(f!)).length, 0) +
        b.st.items.inv.filter((v) => v === tributeOf(f!)).length;
      const wipe = (b: Bot) => b.st.items.containers.forEach((box) => box.forEach((v, j) => v === tributeOf(f!) && (box[j] = 0)));
      const d = new Bot(def, 3);
      d.sim.restore(c.sim.snapshot());
      delete d.st.replant;
      const other = containersOf(d.sim.world).findIndex((k, i) => i !== desk && k.table === 'inmateDesk');
      const box = d.st.items.containers[desk];
      const at = box.indexOf(tributeOf(f!));
      d.st.items.containers[other][d.st.items.containers[other].indexOf(0)] = box[at];
      box[at] = 0;
      d.step();
      check(
        marked(d) === 1 && d.st.replant === undefined,
        `${id}: a tribute hidden in another desk is not put back again (${marked(d)} marked)`,
      );
      wipe(d);
      d.step();
      check(marked(d) === 1, `${id}: used up: put back`);
      wipe(d);
      d.step();
      check(marked(d) === 0, `${id}: used up again the same day: not put back twice a day`);
      d.st.replant = (d.st.replant ?? 1) - 1;
      d.step();
      check(marked(d) === 1, `${id}: and put back the next day`);
      // A run from 2.36.0 (Sim.rules2360): never put back, and a favor dropped leaves its mark.
      const old = new Bot(def, 3);
      old.sim.restore(c.sim.snapshot());
      delete old.st.replant;
      old.sim.rules2360 = true;
      wipe(old);
      old.step();
      check(marked(old) === 0, `${id}: a run from 2.36.0 never puts it back`);
      old.st.items.inv[0] = tributeOf(f!);
      say(old, boss, TALK.DROP);
      check(old.st.items.inv[0] === tributeOf(f!), `${id}: a run from 2.36.0 keeps the mark on a favor dropped`);
    }
    check(!isTribute(slot(n('multitool'), 77)), `${id}: a multitool worn down to 77 uses is not a tribute`);
    const hidden = containersOf(c.sim.world)[desk].hidden;
    c.st.items.containers[desk][hidden] = slot(n('lighter'));
    c.st.items.containers[desk][hidden + 1] = tributeOf(f!);
    const side = placesOf(c.sim.world).deskside[rivalCell];
    c.st.player.x = (side % MAP_W) * UNIT + UNIT / 2;
    c.st.player.z = Math.floor(side / MAP_W) * UNIT + UNIT / 2;
    c.st.rats = [newRat(false, c.st.player.x, c.st.player.z)];
    c.op(OP.EXT, EXT.RAT_FETCH, desk & 63, desk >> 6);
    c.until(() => c.st.items.inv.includes(tributeOf(f!)), 200);
    check(c.st.items.inv.includes(tributeOf(f!)), `${id}: pet rat fetches the marked ${TRIBUTE[g.id]} from ${rivalName}'s desk`);
    // Crafting prefers an unmarked copy over the marked tribute.
    const rec = RECIPES.findIndex((r) => r.ingredients.includes(TRIBUTE[g.id]));
    if (rec >= 0) {
      c.st.items.inv = [tributeOf(f!), slot(f!.item), 0, 0, 0, 0, 0, 0];
      for (const ing of RECIPES[rec].ingredients)
        if (ing !== TRIBUTE[g.id]) c.st.items.inv[c.st.items.inv.indexOf(0)] = slot(n(ing.split('|')[0]));
      const used = ingredientSlots(c.st.items, rec);
      check(!!used && used.includes(1) && !used.includes(0), `${id}: crafting ${RECIPES[rec].result} uses unmarked ${TRIBUTE[g.id]} first`);
    }
    check(!isTribute(slot(n('hollow_book'), slot(n('mold_red')))), `${id}: hollow book hiding mold_red is not mistaken for a tribute`);
    say(c, boss, TALK.DROP);
    check(
      !c.st.items.inv.some((v) => isTribute(v)) && !c.st.items.containers[desk].some((v) => isTribute(v)),
      `${id}: dropping the initiation strips the tribute mark`,
    );
  }
  const got = desk >= 0 && fetchFromDesk(bot, desk, f!.item);
  check(got, `${id}: walked to the desk, the tribute taken`);
  {
    const goal1 = initiationGoal(sim);
    check(!!goal1 && goal1(tileOf(st.inmates[boss].body)), `${id}: with the tribute in hand, arrows lead back to the boss`);
  }
  const before = st.inmates.map((m) => m.opinion);
  const paid = say(bot, boss, TALK.HAND_IN);
  const took = Math.round((st.step - t0) / MIN);
  check(playerGang(sim) === mine && gangEv(paid, 'joined').length === 1, `${id}: handed in: in ${g.id}`);
  const ok = st.inmates.every((m, k) => {
    const gk = gangOf(sim, k);
    const want =
      gk === mine ? Math.min(100, before[k] + GANG_JOIN_OPINION) : gk >= 0 ? Math.max(0, before[k] - GANG_RIVAL_OPINION) : before[k];
    // (The boss also takes the initiation's own +0: nothing more.)
    return m.opinion === want;
  });
  check(ok, `${id}: the gang thinks ${GANG_JOIN_OPINION} more of the player, every rival ${GANG_RIVAL_OPINION} less, the rest the same`);
  check(took < 120, `${id}: the initiation in ${took} game minutes, of the free time's 120`);
  check(
    refused(say(bot, boss, TALK.JOIN), 'inGang') || st.favors.every((x) => x.kind !== FAVOR.INITIATION),
    `${id}: asked again: in a gang already`,
  );
  // (Review: an initiation from before joining, handed in once in a gang: refused; joining dropped it anyway.)
  check(
    st.favors.every((x) => x.kind !== FAVOR.INITIATION),
    `${id}: joined: no other initiation left under way`,
  );
  {
    const c = new Bot(def, 3);
    c.sim.restore(sim.snapshot());
    const other = def.gangs!.findIndex((_, k) => k !== mine);
    const ob = inmateInCell(c.st, def.gangs![other].boss);
    c.st.favors.push({
      by: ob,
      kind: FAVOR.INITIATION,
      item: n(TRIBUTE[def.gangs![other].id]),
      target: boss,
      reward: 0,
      state: FAVOR_STATE.TAKEN,
    });
    const free = c.st.items.inv.slice(0, HOTBAR).indexOf(0);
    c.st.items.inv[free] = tributeOf({ item: n(TRIBUTE[def.gangs![other].id]) });
    check(
      refused(say(c, ob, TALK.HAND_IN), 'inGang') && playerGang(c.sim) === mine,
      `${id}: in a gang, another's initiation can't be handed in`,
    );
  }
  // (Review: R passes over one's own gang mates; a throw at one is a blow at one: out.)
  {
    const c = new Bot(def, 3);
    c.sim.restore(sim.snapshot());
    const mt = g.members.map((cl) => inmateInCell(c.st, cl)).find((k) => k !== boss) ?? boss;
    const at = tileOf(c.st.inmates[mt].body);
    const spot = besides(c.sim, at)[0];
    c.st.player.x = (spot % MAP_W) * UNIT + UNIT / 2;
    c.st.player.z = Math.floor(spot / MAP_W) * UNIT + UNIT / 2;
    c.st.inmates[mt].wait = 1_000_000;
    let mateLocked = false;
    for (let k = 0; k < 6; k++) {
      c.op(OP.LOCK);
      if (c.st.lock >= 0 && gangOf(c.sim, c.st.lock) === mine) mateLocked = true;
    }
    check(!mateLocked, `${id}: R never locks on to a gang mate`);
  }

  // The discount, paid as shown: what the card asks is what the till takes, less than a stranger's.
  const shop = st.shops[sim.merchantOf(boss)];
  const slotK = shop.findIndex((v) => v > 0);
  let paidLine = 'no stock';
  if (slotK >= 0) {
    const value = itemDef(itemOf(shop[slotK])).value;
    const shown = askOf(sim, boss, value);
    const stranger = Math.max(1, Math.round(value * (1 - (Math.max(0, st.inmates[boss].opinion - 50) / 50) * 0.5)));
    st.cash = 500;
    const free = st.items.inv.slice(0, HOTBAR).indexOf(0);
    if (free < 0) st.items.inv[HOTBAR - 1] = 0;
    say(bot, boss, TALK.BUY, slotK);
    check(500 - st.cash === shown && shown < stranger, `${id}: bought for $${shown} as shown (a stranger: $${stranger})`);
    paidLine = `$${shown} for a $${value} thing (a stranger $${stranger})`;
  }
  bot.op(OP.CLOSE);
  st.inmates[boss].opinion = Math.max(st.inmates[boss].opinion, opinionAt);

  // Leaving, and thrown out (on a copy of the run).
  {
    const copy = new Bot(def, 3);
    copy.sim.restore(sim.snapshot());
    const was = copy.st.inmates[boss].opinion;
    const left = say(copy, boss, TALK.LEAVE);
    check(
      gangEv(left, 'left').length === 1 &&
        playerGang(copy.sim) < 0 &&
        copy.st.inmates[boss].opinion === Math.max(0, was - GANG_LEAVE_OPINION),
      `${id}: left at the boss (−${GANG_LEAVE_OPINION} with him)`,
    );
    check(
      refused(say(copy, boss, TALK.JOIN), 'leftToday') || copy.st.inmates[boss].opinion < GANG_OPINION,
      `${id}: no joining again today`,
    );
    const k2 = new Bot(def, 3);
    k2.sim.restore(sim.snapshot());
    const m2 = mate;
    // (The mate brought beside the player: walked across the prison mid-morning, the player was out of place long enough
    // to be caught on the way in some prisons, and the case then tested nothing. 2.37.)
    const by = besides(k2.sim, k2.tile)[0];
    const mb = k2.st.inmates[m2].body;
    mb.x = (by % MAP_W) * UNIT + UNIT / 2;
    mb.z = Math.floor(by / MAP_W) * UNIT + UNIT / 2;
    meet(k2, m2);
    k2.op(OP.CLOSE);
    k2.st.lock = m2;
    k2.op(OP.USE, 1);
    for (let k = 0; k < 40 && !gangEv(k2.events, 'kicked').length; k++) k2.op(OP.USE, 1);
    check(gangEv(k2.events, 'kicked').length === 1 && playerGang(k2.sim) < 0, `${id}: a blow at a gang mate: thrown out`);
  }

  // A save and a load mid-way: it goes on as the run did.
  {
    const snap = JSON.parse(JSON.stringify(sim.snapshot()));
    const twin = new Sim(def, 1);
    twin.restore(snap);
    check(
      twin.hash() === sim.hash() && JSON.stringify(twin.state.gang) === JSON.stringify(st.gang),
      `${id}: saved and loaded, the same state`,
    );
  }

  // The war (day 2, 15:05–15:45): brawlers at the ground, guards drawn, the player gone for once.
  // (From the war's start: at the exercise hour the player may already be close to it.)
  const ev0 = bot.events.length;
  bot.routineUntil(2, 15 * 60 + 20);
  const ground = warGround(sim.world, war[0]);
  const sides = [...def.gangs![war[0]].members, ...def.gangs![war[1]].members].map((c) => inmateInCell(st, c));
  const brawling = sides.filter((k) => st.inmates[k].doing === DOING.BRAWL || dist(tileOf(st.inmates[k].body), ground) <= 4).length;
  const guards = st.guards.filter((gd) => dist(tileOf(gd.body), ground) <= 6 || gd.target === ground).length;
  check(brawling >= 2, `${id}: the war's sides at its ground (${brawling} of ${sides.length})`);
  check(guards >= 1, `${id}: guards drawn to it (${guards})`);
  // (Walked towards its ground until a rival comes: they're crowding it.)
  bot.pilot.goTo(ground);
  for (let k = 0; k < 2000 && !gangEv(bot.events.slice(ev0), 'warJump').length; k++) bot.step(command(bot.pilot.dir(st.player)));
  bot.pilot.stop();
  const jumped = gangEv(bot.events.slice(ev0), 'warJump');
  // (Once a war: perhaps already in the exercise hour, close by; the anger's long over by now then.)
  check(
    jumped.length === 1 && gangOf(sim, jumped[0].who!) === (war[0] === mine ? war[1] : war[0]),
    `${id}: at the war's ground, a rival comes for the player once`,
  );
  // (Walked away: out of the yard, the fight not followed up on.)
  bot.walkTo(placesOf(sim.world).bedside[1], 4000);
  for (const m of st.inmates) m.angry = 0;
  const warLine = `${brawling} at the ground, ${guards} guards, gone for by ${jumped[0]?.who}`;

  // Turf held at dinner (day 2): the members at their own tables.
  bot.routineUntil(2, 17 * 60 + 30);
  let seated = 0;
  let members = 0;
  def.gangs!.forEach((gd) =>
    gd.members.forEach((c) => {
      const k = inmateInCell(st, c);
      if (st.followers.includes(k) || st.inmates[k].ko > 0) return;
      members++;
      if (inRect(gd.table, st.inmates[k].seat) || inRect(gd.table, tileOf(st.inmates[k].body))) seated++;
    }),
  );
  check(seated >= Math.ceil(members / 2), `${id}: at dinner, ${seated} of ${members} members at their own gang's table`);

  // (The rest from here, each on a copy of the run as it stands at dinner.)
  const dinner = sim.snapshot();
  const copyAt = () => {
    const c = new Bot(def, 3);
    c.sim.restore(dinner);
    return c;
  };

  // Trespass: a rival's table, held; walked off in time: nothing; stayed: squared up to.
  const rivalK = war[1];
  const rivalId = GANGS.indexOf(def.gangs![rivalK].id) + 1;
  const warnedOn = (c: Bot) => !!c.st.gang && c.st.gang[G.WARN] > 0 && c.st.gang[G.TURF] === rivalId;
  const rt = def.gangs![rivalK].table;
  const spots = placesOf(sim.world).seats.filter((q) => inRect(rt, q.tile) && !st.inmates.some((m) => tileOf(m.body) === q.tile));
  let trespassLine = 'no free seat at the rival table';
  if (spots.length) {
    bot.walkTo(spots[0].tile, 3000);
    // (Told on the way, or once there: the table's holders see the player on it.)
    bot.until(() => warnedOn(bot), 60);
    const warned = warnedOn(bot);
    const e0 = bot.events.length;
    const off =
      besides(sim, spots[0].tile).find((t) => turfAt(def, t % MAP_W, Math.floor(t / MAP_W)) < 0) ?? placesOf(sim.world).bedside[1];
    const tw = st.step;
    bot.walkTo(off, 200);
    const inTime = st.step - tw;
    bot.until(() => false, 20);
    check(
      warned &&
        gangEv(bot.events.slice(e0), 'clear').length >= 1 &&
        !gangEv(bot.events.slice(e0), 'jumped').length &&
        !bot.st.gang![G.WARN],
      `${id}: on the rival's table, told; off it in ${inTime} steps of ${TRESPASS_STEPS}: nothing`,
    );
    // (On a copy from the same moment: there, and staying.)
    const stay = copyAt();
    stay.walkTo(spots[0].tile, 3000);
    const e1 = stay.events.length;
    stay.until(() => gangEv(stay.events, 'jumped').length > 0, TRESPASS_STEPS + 140);
    const sq = gangEv(stay.events, 'jumped');
    const warnedAt = gangEv(stay.events.slice(e1), 'warn').filter((e) => e.gang === rivalK).length;
    check(
      warnedAt <= 1 && sq.length === 1 && stay.st.inmates[sq[0].who!].angry > 0 && stay.st.inmates[sq[0].who!].windup > 0,
      `${id}: stayed: told once, then one of them squares up`,
    );
    trespassLine = `told, off in ${inTime} steps; stayed, squared up by ${sq[0]?.who}`;
  }

  // Backup: someone after the player, a gang mate close by: he goes for them and lands blows.
  {
    const b2 = copyAt();
    const s2 = b2.st;
    const m = inmateInCell(s2, g.members.find((c) => c !== g.boss) ?? g.boss);
    const foe = s2.inmates.findIndex((_, k) => gangOf(b2.sim, k) < 0 || gangOf(b2.sim, k) !== mine);
    // (Set up where it happens: the player beside the mate, whoever's after them a step further.)
    const mt = tileOf(s2.inmates[m].body);
    const spot = besides(b2.sim, mt)[0];
    const put = (b: { x: number; z: number }, t: number) => {
      b.x = (t % MAP_W) * UNIT + UNIT / 2;
      b.z = Math.floor(t / MAP_W) * UNIT + UNIT / 2;
    };
    put(s2.player, spot);
    const fo = s2.inmates[foe];
    put(fo.body, besides(b2.sim, spot).find((t) => t !== mt) ?? spot);
    fo.angry = ANGRY_STEPS;
    fo.windup = 0;
    s2.inmates[m].wait = 0;
    const e2 = b2.events.length;
    b2.until(
      () => b2.events.slice(e2).some((e) => e.type === 'allyHit' && e.by === m),
      200,
      () => 0,
    );
    check(
      b2.events.slice(e2).some((e) => e.type === 'allyHit' && e.by === m && e.who === foe),
      `${id}: ${foe} after the player, gang mate ${m} lands a blow on them`,
    );
  }

  // Someone in no gang on held turf: never told.
  {
    const n2 = copyAt();
    n2.st.gang![G.ID] = 0;
    const e3 = n2.events.length;
    if (spots.length) n2.walkTo(spots[0].tile, 400);
    n2.until(() => false, TRESPASS_STEPS + 40);
    check(
      !gangEv(n2.events.slice(e3), 'warn').length && !gangEv(n2.events.slice(e3), 'jumped').length,
      `${id}: in no gang on held turf: nobody minds`,
    );
  }

  // A lockdown: nothing held.
  {
    const l2 = copyAt();
    l2.st.lockdown = true;
    const e4 = l2.events.length;
    if (spots.length) l2.walkTo(spots[0].tile, 400);
    l2.until(() => false, 60);
    check(!gangEv(l2.events.slice(e4), 'warn').length, `${id}: in a lockdown, no turf held`);
  }

  // (Review: in the evening only the corners are held: on a rival's table then, nobody minds, however long.)
  {
    const c = copyAt();
    c.routineUntil(2, 19 * 60 + 5);
    const rt = def.gangs![war[1]].table;
    let t = -1;
    for (let x = rt[0]; x <= rt[2] && t < 0; x++)
      for (let z = rt[1]; z <= rt[3] && t < 0; z++) if (!c.sim.world.blocked(x, z)) t = z * MAP_W + x;
    const e5 = c.events.length;
    if (t >= 0 && c.walkTo(t, 3000)) c.until(() => false, 90 * MIN);
    check(
      t >= 0 && !c.events.slice(e5).some((e) => e.type === 'gang'),
      `${id}: in the evening, 90 minutes on a rival's table: no gang trouble`,
    );
  }
  // (Review: at dinner, a rival's corner isn't held.)
  {
    const c = copyAt();
    const rc = def.gangs![war[1]].corner;
    let t = -1;
    for (let x = rc[0]; x <= rc[2] && t < 0; x++)
      for (let z = rc[1]; z <= rc[3] && t < 0; z++) if (!c.sim.world.blocked(x, z)) t = z * MAP_W + x;
    const e6 = c.events.length;
    if (t >= 0 && c.walkTo(t, 2000) && ROUTINE[c.st.routine].id === 'dinner')
      c.until(() => ROUTINE[c.st.routine].id !== 'dinner', 60 * MIN);
    check(
      !c.events.slice(e6).some((e) => e.type === 'gang' && e.what !== 'clear'),
      `${id}: at dinner, on a rival's corner: no gang trouble`,
    );
  }
  // (Review: told off, then its holders gone (out cold here): the warning ends without a word, and nobody squares up
  // later for it, the player still standing there.)
  {
    const c = copyAt();
    if (spots.length) {
      c.walkTo(spots[0].tile, 3000);
      c.until(() => warnedOn(c), 300);
      const told = warnedOn(c);
      for (const cl of def.gangs![war[1]].members) c.st.inmates[inmateInCell(c.st, cl)].ko = 100_000;
      const e7 = c.events.length;
      c.until(() => false, TRESPASS_STEPS * 3);
      check(
        told && !c.st.gang![G.WARN] && !gangEv(c.events.slice(e7), 'jumped').length,
        `${id}: told off, its holders gone: the warning over, nobody squares up`,
      );
    }
  }
  // (2.40, the review of 2.39: told off, then its holders step off the table a moment, a few tiles away and still about
  // (a tray taken back): the countdown waits for them, never told again; back, it runs on and one squares up. A run from
  // before 2.40 (Sim.rules239): over without a word, then told afresh, the countdown from the start again.)
  if (spots.length) {
    const [x0, z0, x1, z1] = rt;
    // (A floor tile 3 to 6 off the table, out of reach of holding it (a tile around it counts), nearest the table.)
    let off = -1;
    for (let r = 3; r <= 6 && off < 0; r++)
      for (const [x, z] of [
        [x0, z1 + r],
        [x0, z0 - r],
        [x0 - r, z0],
        [x1 + r, z0],
      ])
        if (off < 0 && isFloor(sim.world, x, z) && !sim.world.block[z * MAP_W + x]) off = z * MAP_W + x;
    const lines: string[] = [];
    for (const old of [false, true]) {
      const c = copyAt();
      c.sim.rules239 = old;
      c.walkTo(spots[0].tile, 3000);
      c.until(() => warnedOn(c), 300);
      const told = warnedOn(c);
      const e8 = c.events.length;
      const left = warningLeft(c.sim);
      const holders = def.gangs![rivalK].members.map((cl) => inmateInCell(c.st, cl)).filter((k) => k >= 0);
      // (Held off the table for twice the warning's time.)
      for (let k = 0; k < TRESPASS_STEPS * 2 && off >= 0; k++) {
        for (const h of holders) {
          const b = c.st.inmates[h].body;
          b.x = (off % MAP_W) * UNIT + UNIT / 2;
          b.z = Math.floor(off / MAP_W) * UNIT + UNIT / 2;
          b.moving = false;
        }
        c.step();
      }
      const held = warningLeft(c.sim);
      // (Then let back: they come back to their table.)
      c.until(() => gangEv(c.events.slice(e8), 'jumped').length > 0 || gangEv(c.events.slice(e8), 'warn').length > 0, TRESPASS_STEPS * 3);
      const warns = gangEv(c.events.slice(e8), 'warn').length;
      const jumped = gangEv(c.events.slice(e8), 'jumped').length;
      if (!old)
        check(
          off >= 0 && told && held === left && warns === 0 && jumped === 1,
          `${id}: told off, its holders a moment off the table: the countdown waits for them (${held} of ${left} steps left), not told again; back, one squares up`,
        );
      else
        check(
          off >= 0 && told && warns === 1,
          `${id}: a run from before 2.40: the warning dropped while they were off it, told afresh once back`,
        );
      lines.push(old ? 'before 2.40, told afresh' : `waits (${held} steps left), then squared up`);
    }
    trespassLine += `; holders off a moment: ${lines.join(' / ')}`;
  }

  // The evening: the members at their corners.
  bot.routineUntil(2, 19 * 60);
  let at = 0;
  let looks = 0;
  for (let k = 0; k < 60; k++) {
    bot.routineUntil(2, 19 * 60 + k * 2);
    def.gangs!.forEach((gd) =>
      gd.members.forEach((c) => {
        const who = inmateInCell(st, c);
        looks++;
        const tl = tileOf(st.inmates[who].body);
        if (inRect([gd.corner[0] - 1, gd.corner[1] - 1, gd.corner[2] + 1, gd.corner[3] + 1], tl)) at++;
      }),
    );
  }
  check(at / looks >= 0.4, `${id}: in the evening, members at their corners ${Math.round((at / looks) * 100)}% of the time`);

  console.log(
    `${id}: joined ${g.id} (initiation ${took} min; the others' ${joins.join(', ')}); ${paidLine}; war: ${warLine}; dinner ${seated}/${members} at their tables; evening ${Math.round((at / looks) * 100)}% at their corners; trespass ${trespassLine}`,
  );
}

// ---------------------------------------------------------------- a food fight's blow at a mate: free, not a betrayal
{
  const def = PRISONS[0];
  const bot = new Bot(def, 3);
  const st = bot.st;
  st.calendar = [[2, DAY_EVENTS.indexOf('foodFight'), -1]];
  // (A member from the start: joining is walked above.)
  st.gang = [GANGS.indexOf(def.gangs![0].id) + 1, 0, 0, 0, 0, 0, 1, 1];
  const mate = inmateInCell(
    st,
    def.gangs![0].members.find((c) => c !== def.gangs![0].boss)!,
  );
  const m = st.inmates[mate];
  // (In the thick of it: both in the canteen, the mate sat down.)
  bot.keepRoutine(
    () =>
      eventOn(bot.sim, 'foodFight') &&
      bot.sim.playerZone === 'canteen' &&
      bot.sim.world.zoneAt(Math.floor(m.body.x / UNIT), Math.floor(m.body.z / UNIT)) === 'canteen' &&
      !m.body.moving,
    2 * 1440 * MIN,
  );
  const at = tileOf(m.body);
  const spot = besides(bot.sim, at)[0];
  // (Half a tile from him, on the side of a free tile: within a fist's reach.)
  st.player.x = Math.round(((spot % MAP_W) * UNIT + UNIT / 2 + m.body.x) / 2);
  st.player.z = Math.round((Math.floor(spot / MAP_W) * UNIT + UNIT / 2 + m.body.z) / 2);
  m.wait = 1_000_000;
  m.path = [];
  st.lock = mate;
  const e0 = bot.events.length;
  for (let k = 0; k < 40 && !bot.events.slice(e0).some((e) => e.type === 'hit'); k++) bot.op(OP.USE, 1);
  const hit = bot.events.slice(e0).some((e) => e.type === 'hit' && e.who === mate);
  check(
    hit && playerGang(bot.sim) === 0 && !gangEv(bot.events.slice(e0), 'kicked').length,
    `${def.id}: a food fight's blow at a gang mate: still in the gang`,
  );
  console.log(`food fight: a blow at mate ${mate}, still in ${def.gangs![0].id}`);
}

// ---------------------------------------------------------------- never met: as before; old rules
for (const def of PRISONS) {
  const bot = new Bot(def, 3);
  bot.routineUntil(2, 17 * 60 + 30);
  check(bot.st.gang === undefined, `${def.id}: never a word with a gang member: no gang record by day 2's dinner`);
  const old = new Bot(def, 3);
  old.sim.rules235 = true;
  old.routineUntil(1, 10 * 60 + 2);
  const boss = inmateInCell(old.st, def.gangs![0].boss);
  meet(old, boss);
  old.st.inmates[boss].opinion = 90;
  old.op(OP.TALK, TALK.JOIN);
  check(
    !gangsHere(old.sim) && old.st.gang === undefined && old.st.favors.every((f) => f.kind !== FAVOR.INITIATION),
    `${def.id}: a run from before 2.36: no gangs`,
  );
}

// ---------------------------------------------------------------- the deck: old logs and saves keep the card replaced
{
  const def = PRISONS[0];
  const plain = new Sim(def, 7);
  plain.state.calendar = [];
  let day = 2;
  while (dayPlan(def.id, plain.state.salt, day).event !== 'gangWar' && day < 40) day++;
  const was = DAY_BOOKS[def.id].beforeGangs!;
  const log = {
    v: 1 as const,
    prison: def.id,
    seed: 7,
    game: '2.35.0',
    from: 0,
    steps: (day + 1) * 1440 * MIN,
    data: '',
    sums: [] as Array<[number, string]>,
  };
  const set = prepareReplay(log, def);
  const now = prepareReplay({ ...log, game: '2.36.0' }, def);
  const evOf = (s: Sim) => dayPlan(def.id, s.state.salt, day, s.state.calendar).event;
  check(!!set && evOf(set.sim) === was && set.sim.rules235, `a 2.35 log replays day ${day}'s ${was}, not the gang war`);
  check(!!now && evOf(now.sim) === 'gangWar', `a 2.36 log: the gang war stands on day ${day}`);
  const later = prepareReplay({ ...log, game: '2.36.1' }, def);
  check(
    !!now && now.sim.rules2360 && !!later && !later.sim.rules2360,
    'a 2.36.0 log plays the tribute as it was (Sim.rules2360), a 2.36.1 log does not',
  );
  console.log(`deck: ${def.id}'s day ${day} is the gang war's (a 2.35 log: ${was})`);
}
