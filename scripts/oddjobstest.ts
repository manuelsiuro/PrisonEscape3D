/**
 * The odd jobs board (P40, docs/PLAN.md §13), through the real simulation:
 * - the data: every campaign prison's board (open canteen floor before a north wall, nothing
 *   else on its bit of wall, out of the two rows a wall hides, reachable); none at the Training
 *   Block; the story chains name real cells, and kinds their prison has;
 * - the deals: pure (the state's RNG untouched), three a day, never asking for what the prison
 *   lacks (a visit for the cake, the old-timer for checkers, a merchant for the errand, a desk
 *   to drop into…), over many days and seeds; the fixer's; the story's card;
 * - every kind done by a bot in every prison it's dealt in, then handed in (pay, perks, debts);
 * - each prison's story chain, step by step to its end;
 * - failing: the time up, given up, a drop seen, a frame caught out (heat), a fixed game the
 *   wrong way, the dig found; a false alarm; a debt called in, and one joining the crew;
 * - nothing changes for the inmates until a job is taken; saves mid-job, damaged numbers;
 * - the rules review's cases: the rat's plant, leftovers of earlier jobs, the hidden compartment,
 *   a job taken late, a stale count, the freezer, the deadline with the item in hand, the cake
 *   with no room, a bribed guard at the dig.
 */
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { SAN_PANCHO } from '../src/content/prisons/san-pancho';
import { STALAG_FLUCHT } from '../src/content/prisons/stalag-flucht';
import { TRAINING } from '../src/content/prisons/training';
import { DECOR } from '../src/content/decor';
import { itemDef, itemNumber } from '../src/content/items';
import { DAY_EVENTS } from '../src/content/days';
import { BOARD, CAUGHT_TILES, CHAIN_PIN, CHAINS, DIG_STEPS, FAIL_OPINION, FIXER_JOB_OPINION, FRAME_HEAT, FROM, J, KIND, KIND_DEFS, KINDS, LIFT, LIFTS, PERK, PINS, R, STAGE, WARN_TILES } from '../src/content/oddjobs';
import { CALL_STEPS, CALLEE } from '../src/content/phone';
import { STAPLES } from '../src/content/long';
import { ROUTINE } from '../src/content/routine';
import { isFloor, placesOf } from '../src/sim/ai/places';
import { command, EXT, OP, SLOT, TALK, tossArgs } from '../src/sim/command';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { loadState } from '../src/sim/state';
import { DAY_STEPS } from '../src/sim/systems/clock';
import { planOf, prisonDay, TODAY } from '../src/sim/systems/calendar';
import { endCheat } from '../src/sim/systems/cards';
import { elderOf } from '../src/sim/systems/checkers';
import { HOTBAR, itemOf, pocketOf, slot } from '../src/sim/systems/items';
import { boardOf, boardNow, boardRefusal, bringsOf, cakeComes, canWhistle, chainDeal, dealsOf, deskOf, type Deal, digFace, digOf, endsFor, fixerDeal, freezerOf, handInRefusal, jobOf, oddjobs, owes, whistleNow } from '../src/sim/systems/oddjobs';
import { stapleSlot } from '../src/sim/systems/pantry';
import { fixerOf, smugglingOf, visitPairs } from '../src/sim/systems/smuggling';
import { newRat } from '../src/sim/systems/rats';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { containersOf } from '../src/sim/world/containers';
import { MAP_W } from '../src/sim/world/World';
import { TILE } from '../src/sim/world/tiles';
import type { PrisonDef } from '../src/content/prisons/types';
import { check } from './assert';

const at = (day: number, hour: number, minute = 0) => (day - 1) * DAY_STEPS + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
const VISITING = DAY_EVENTS.indexOf('visiting');
const DELIVERY = DAY_EVENTS.indexOf('delivery');
const n = itemNumber;
const putTile = (b: { x: number; z: number }, t: number) => {
  b.x = (t % MAP_W) * UNIT + UNIT / 2;
  b.z = Math.floor(t / MAP_W) * UNIT + UNIT / 2;
};
const put = (b: { x: number; z: number }, x: number, z: number) => putTile(b, z * MAP_W + x);
const jobNews = (seen: SimEvent[], what: string) => seen.filter((e) => e.type === 'oddjob' && e.what === what) as Array<Extract<SimEvent, { type: 'oddjob' }>>;
const refusals = (seen: SimEvent[]) => seen.filter((e) => e.type === 'refused').map((e) => (e as { why: string }).why);

/** A game kept calm (heat and lockdowns cleared each step unless asked), quiet days but those forced. */
function game(prison: PrisonDef, seed = 5, calendar: Array<[number, number, number]> = [[0, 0, 0]]) {
  const sim = new Sim(prison, seed);
  sim.state.calendar = calendar;
  const seen: SimEvent[] = [];
  let calm = true;
  const step = (cmd = 0) => {
    sim.step(cmd);
    seen.push(...sim.events);
    if (calm) {
      sim.state.heat = 0;
      if (sim.state.lockdown) sim.state.lockdown = false;
    }
  };
  const jump = (day: number, hour: number, minute = 0) => {
    if (Math.floor((at(day, hour, minute) - 1) / DAY_STEPS) !== Math.floor(sim.state.step / DAY_STEPS)) sim.state.eventFlags = 0;
    sim.state.step = at(day, hour, minute) - 1;
    sim.state.attended = true;
    sim.state.excused = true;
    step();
  };
  const to = (day: number, hour: number, minute = 0) => {
    const target = at(day, hour, minute);
    while (sim.state.step < target && !sim.state.escaped) step();
  };
  const ext = (a: number, b = 0, c = 0) => step(command(0, OP.EXT, a, b, c));
  const talk = (a: number, b = 0) => step(command(0, OP.TALK, a, b));
  const toBoard = () => {
    const b = prison.board!;
    put(sim.state.player, b.x, b.z);
    sim.state.player.facing = b.face;
  };
  /** Every guard looks the other way (bribed, for the test). */
  const blind = () => {
    for (const g of sim.state.guards) g.bribed = sim.state.step + 1e7;
  };
  /** Talking to an inmate: brought to an open stretch of canteen floor beside the player, facing them. */
  const talkTo = (who: number) => {
    const m = sim.state.inmates[who];
    const [a, b] = canteenPair(sim);
    if (sim.state.talk >= 0 && sim.state.talk !== who) step(command(0, OP.CLOSE));
    // (Whoever stood there steps aside: to where this one was.)
    for (const o of sim.state.inmates) if (o !== m && [a, b].includes(Math.floor(o.body.z / UNIT) * MAP_W + Math.floor(o.body.x / UNIT))) {
      o.body.x = m.body.x;
      o.body.z = m.body.z;
      o.path = [];
    }
    putTile(m.body, b);
    putTile(sim.state.player, a);
    sim.state.player.facing = 1;
    m.path = [];
    m.angry = 0;
    m.doing = 0;
    step(command(0, OP.INTERACT));
    return sim.state.talk === who;
  };
  const setCalm = (on: boolean) => (calm = on);
  return { sim, seen, step, jump, to, ext, talk, toBoard, blind, talkTo, setCalm };
}
type Game = ReturnType<typeof game>;

/** Two open canteen tiles side by side (west, east), the first from the room's middle. */
function canteenPair(sim: Sim): [number, number] {
  const w = sim.world;
  const floor = placesOf(w).floor[w.ground.zone[sim.prison.board!.z * MAP_W + sim.prison.board!.x]];
  const mid = floor[floor.length >> 1];
  const order = [...floor].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
  for (const t of order) if (floor.includes(t + 1) && !w.props.some((p) => p.kind === 'seat' && [t, t + 1].some((u) => u % MAP_W >= p.x && u % MAP_W < p.x + p.w && Math.floor(u / MAP_W) >= p.z && Math.floor(u / MAP_W) < p.z + p.d))) return [t, t + 1];
  return [order[0], order[0] + 1];
}

// ------------------------------------------------------------------ the data
{
  const lines: string[] = [];
  for (const p of PRISONS) {
    const sim = new Sim(p, 1);
    const w = sim.world;
    const b = p.board;
    check(!!b && !!boardOf(sim), `${p.id}: a board`);
    if (!b) continue;
    const onFloor = (x: number, z: number) => w.props.some((o) => x >= o.x && x < o.x + o.w && z >= o.z && z < o.z + o.d) || (p.decor ?? []).some((d) => !DECOR[d.kind].wall && x >= d.x && x < d.x + (d.w ?? 1) && z >= d.z && z < d.z + (d.d ?? 1));
    const zone = w.zoneAt(b.x, b.z);
    check(!w.blocked(b.x, b.z) && !onFloor(b.x, b.z) && zone === 'canteen', `${p.id}: the board's tile is open floor in the canteen (${zone})`);
    const behind = w.ground.kind[(b.z - 1) * MAP_W + b.x];
    check(b.face === 13 && (behind === TILE.BRICK || behind === TILE.REINFORCED), `${p.id}: it hangs on the north wall, a real wall behind it (not a door; the camera sees it)`);
    const wallDecor = (p.decor ?? []).filter((d) => DECOR[d.kind].wall && d.x <= b.x && d.x + (d.w ?? 1) > b.x && d.z <= b.z && d.z + (d.d ?? 1) > b.z);
    check(wallDecor.length === 0, `${p.id}: nothing else hangs on its bit of wall (${wallDecor.map((d) => d.kind).join(' ')})`);
    check(!w.blocked(b.x, b.z + 1) && !w.blocked(b.x, b.z + 2), `${p.id}: no wall in the two rows in front of it`);
    // (Not the phone's, the kiosk's, the release desk's or the stage's tiles.)
    const st = p.leisure?.stage;
    check(!st || Math.abs(st.x - b.x) > 1 || Math.abs(st.z - b.z) > 1, `${p.id}: clear of the stage's boards`);
    const reach = new Set<number>([Math.floor(sim.state.player.z / UNIT) * MAP_W + Math.floor(sim.state.player.x / UNIT)]);
    const queue = [...reach];
    w.setPlayerKeys(new Set([1, 2, 3, 4, 5]) as never);
    while (queue.length) {
      const t = queue.pop()!;
      for (const d of [1, -1, MAP_W, -MAP_W]) {
        const nt = t + d;
        if (reach.has(nt) || !w.inside(nt % MAP_W, Math.floor(nt / MAP_W)) || w.npcBlock[nt]) continue;
        reach.add(nt);
        queue.push(nt);
      }
    }
    check(reach.has(b.z * MAP_W + b.x), `${p.id}: the board can be walked to`);
    // The story: its teller and those it's about are real cells; its kinds are the prison's.
    const chain = CHAINS[p.id];
    check(!!chain && chain.steps.length >= 3 && chain.steps.length <= 4, `${p.id}: a story of 3–4 jobs`);
    const cells = p.cells.length;
    check(chain.who >= 2 && chain.who <= cells && chain.who !== p.smuggling?.fixer, `${p.id}: the story's teller is an inmate, not the fixer`);
    for (const s of chain.steps) {
      check(s.target === 0 || (s.target >= 2 && s.target <= cells), `${p.id}: a story step about a real cell`);
      if (s.kind === KIND.CHECKERS) check(s.target === p.leisure?.oldTimer, `${p.id}: checkers with the old-timer`);
      if (s.kind === KIND.ERRAND) check(p.merchants.includes(s.target), `${p.id}: the errand's merchant is one`);
      if (s.kind === KIND.CAKE) check(!!(p.smuggling?.visits || p.smuggling?.parcel), `${p.id}: a cake comes in somehow`);
      if (s.perk === PERK.ITEM) check(!!s.item && !!itemNumber(s.item), `${p.id}: a story's item is real`);
    }
    lines.push(`${p.id}: board ${b.x},${b.z}; story for cell ${chain.who}: ${chain.steps.map((s) => KINDS[s.kind]).join(', ')}`);
  }
  check(!TRAINING.board && !dealsOf(new Sim(TRAINING, 1)).length, 'the Training Block has none');
  check(KINDS.every((k) => KIND_DEFS[k].days >= 1 && KIND_DEFS[k].days <= 3), 'every kind runs 1–3 prison days');
  check(KINDS.length >= 11 && KINDS.length <= 13, `about a dozen kinds (${KINDS.length})`);
  console.log(lines.join('\n'));
}

// ------------------------------------------------------------------ the deals
/** Whether a deal asks only for what the prison has, on its day. */
function dealOk(sim: Sim, d: Deal, day: number): string | null {
  const s = sim.state;
  const p = sim.prison;
  if (d.giver < 0 || d.giver >= s.inmates.length) return 'no such giver';
  if (d.target === d.giver && d.kind !== KIND.CHECKERS && d.kind !== KIND.LIFT) return 'about himself';
  if (d.days < 1 || d.days > 3 || d.pay <= 0) return 'days or pay';
  switch (d.kind) {
    case KIND.LIFT:
      if (d.variant === LIFT.WHISTLE) return d.target >= 0 && d.target < s.guards.length && (!p.guards[d.target].duties?.includes('shakedown') || p.guards.every((x) => x.duties?.includes('shakedown'))) ? null : 'no such guard, or one whose pockets are full';
      return freezerOf(sim) >= 0 ? null : 'no freezer';
    case KIND.DROP:
    case KIND.FRAME:
    case KIND.RAT:
      return deskOf(sim, d.target) >= 0 ? null : 'no desk';
    case KIND.CHECKERS:
      return d.target === elderOf(sim) && d.giver !== d.target ? null : 'not the old-timer';
    case KIND.CAKE: {
      const sm = smugglingOf(sim);
      if (!sm || !(sm.visits || sm.parcel)) return 'no visits';
      for (let k = 1; k < d.days; k++) if (planOf(sim, day + k).event === (sm.visits ? 'visiting' : 'delivery')) return null;
      return 'no visit in time';
    }
    case KIND.TIP:
      return p.comms ? null : 'no phone';
    case KIND.ERRAND:
      return p.merchants.includes(s.inmates[d.target]?.cell) ? null : 'not a merchant';
    case KIND.WRESTLE:
    case KIND.CHEAT:
    case KIND.DELIVER:
      return d.target >= 0 && d.target < s.inmates.length ? null : 'nobody';
    case KIND.LOOKOUT:
      return placesOf(sim.world).bedside[s.inmates[d.giver].cell] >= 0 ? null : 'no bed';
  }
  return 'unknown kind';
}
{
  const lines: string[] = [];
  for (const p of PRISONS) {
    const counts = new Array(KINDS.length).fill(0);
    let fixer = 0;
    for (const seed of [1, 2, 3]) {
      // (The real calendar, its visiting days and all.)
      const sim = new Sim(p, seed);
      const rng = sim.state.rng;
      for (let day = 1; day <= 40; day++) {
        const deals = dealsOf(sim, day);
        check(deals.length === PINS, `${p.id} seed ${seed} day ${day}: ${PINS} pins`);
        check(new Set(deals.map((d) => d.giver)).size === deals.length && new Set(deals.map((d) => d.kind)).size === deals.length, `${p.id} day ${day}: three askers, three kinds`);
        for (const d of deals) {
          const why = dealOk(sim, d, day);
          check(!why, `${p.id} seed ${seed} day ${day}: a ${KINDS[d.kind]} deal the prison can do (${why})`);
          check(d.giver !== fixerOf(sim), `${p.id}: the fixer doesn't pin his on the board`);
          counts[d.kind]++;
        }
        const f = fixerDeal(sim, day);
        check(!!f && f.giver === fixerOf(sim) && KIND_DEFS[KINDS[f.kind]].fixer === true && !dealOk(sim, f, day) && f.perk === PERK.ITEM, `${p.id} day ${day}: the fixer's own job, one of his kinds`);
        if (f) fixer++;
        check(JSON.stringify(dealsOf(sim, day)) === JSON.stringify(deals), 'the same deals asked again');
      }
      check(sim.state.rng === rng, `${p.id}: dealing never draws on the state's RNG`);
    }
    // (Every kind comes up somewhere in 120 days.)
    for (let k = 0; k < KINDS.length; k++) check(counts[k] > 0, `${p.id}: ${KINDS[k]} dealt in 120 days`);
    lines.push(`${p.id}: ${KINDS.map((k, i) => `${k} ${counts[i]}`).join(', ')}; fixer ${fixer}`);
  }
  console.log(lines.join('\n'));
}

// ------------------------------------------------------------------ nothing changes until a job is taken
{
  for (const p of PRISONS) {
    const a = new Sim(p, 7);
    const b = new Sim(p, 7);
    // (b's board looked at all day: its deals, the fixer's, the story's.)
    for (let k = 0; k < DAY_STEPS + 200; k++) {
      a.step(0);
      b.step(0);
      if (k % 600 === 0) {
        boardNow(b as never);
        fixerDeal(b as never);
      }
    }
    check(JSON.stringify(a.state) === JSON.stringify(b.state), `${p.id}: a day and more with the board read: the same game`);
    check(a.state.oddjob.length === 0 && a.state.oddjobs.every((x) => x === 0), `${p.id}: no job, nothing recorded`);
  }
}

// ------------------------------------------------------------------ a bot for every kind
/** Finds a day (from 2) a kind is pinned (with a visit forced the day after, for the cake); the game set there at 10:05. */
function dealt(p: PrisonDef, kind: number, variant = -1, seed = 5): { g: Game; pin: number; deal: Deal; day: number } | null {
  for (let day = 2; day < 60; day++) {
    const sm = p.smuggling;
    const cal: Array<[number, number, number]> = [[0, 0, 0]];
    if (kind === KIND.CAKE && sm) cal.push([day + 1, sm.visits ? VISITING : DELIVERY, -1]);
    const probe = new Sim(p, seed);
    probe.state.calendar = cal;
    const deals = dealsOf(probe, day);
    const pin = deals.findIndex((d) => d.kind === kind && (variant < 0 || d.variant === variant));
    if (pin < 0) continue;
    const g = game(p, seed, cal);
    g.jump(day, 10, 5);
    return { g, pin, deal: deals[pin], day };
  }
  return null;
}

/** Takes the job off its pin (at the board), checks it's held. */
function takeAt(g: Game, pin: number) {
  g.toBoard();
  g.ext(EXT.BOARD, BOARD.TAKE, pin);
  return jobOf(g.sim.state);
}

/** The hotbar slot holding an item (-1 none). */
const inHand = (sim: Sim, item: number) => sim.state.items.inv.slice(0, HOTBAR).findIndex((v) => itemOf(v) === item);

/** Opens a container where the player stands beside it (as the action button would) and moves a hotbar slot into its first open slot, or one of its items out. */
function openBox(g: Game, box: number) {
  g.sim.state.items.open = box;
  g.sim.state.items.rev++;
}
function intoBox(g: Game, box: number, from: number) {
  openBox(g, box);
  const list = containersOf(g.sim.world);
  const slots = g.sim.state.items.containers[box];
  const k = slots.indexOf(0, box < list.length ? list[box].hidden : 0);
  g.step(command(0, OP.MOVE, from, SLOT.CONTAINER + k));
  g.step(command(0, OP.CLOSE));
}
function outOfBox(g: Game, box: number, item: number) {
  openBox(g, box);
  const k = g.sim.state.items.containers[box].findIndex((v) => itemOf(v) === item);
  const free = g.sim.state.items.inv.slice(0, HOTBAR).indexOf(0);
  g.step(command(0, OP.MOVE, SLOT.CONTAINER + k, free));
  g.step(command(0, OP.CLOSE));
}
/** Standing by an inmate's desk. */
function byDesk(g: Game, who: number) {
  const cell = g.sim.state.inmates[who].cell;
  putTile(g.sim.state.player, placesOf(g.sim.world).deskside[cell]);
}

/** Does the job held the way a player would (true once its work is done, or what's to be brought is in hand). */
function work(g: Game, deal: Deal): boolean {
  const { sim } = g;
  const s = sim.state;
  const job = jobOf(s)!;
  for (const m of [deal.giver, deal.target]) if (m >= 0 && s.inmates[m] && deal.kind !== KIND.LIFT) s.inmates[m].opinion = Math.max(s.inmates[m].opinion, 60);
  s.inmates[deal.giver].opinion = Math.max(s.inmates[deal.giver].opinion, 60);
  s.energy = 100;
  switch (deal.kind) {
    case KIND.LIFT: {
      const item = bringsOf(job);
      if (deal.variant === LIFT.MUG) {
        putTile(s.player, placesOf(sim.world).floor[sim.world.ground.zone[containersOf(sim.world)[freezerOf(sim)].prop.z * MAP_W + containersOf(sim.world)[freezerOf(sim)].prop.x]][0]);
        outOfBox(g, freezerOf(sim), item);
      } else {
        // A guard knocked out, his pockets gone through.
        const gd = s.guards[deal.target];
        gd.ko = 400;
        const pk = pocketOf(sim.world, s.inmates.length + deal.target);
        outOfBox(g, pk, item);
      }
      return inHand(sim, item) >= 0;
    }
    case KIND.DROP:
    case KIND.FRAME: {
      g.blind();
      byDesk(g, deal.target);
      intoBox(g, deskOf(sim, deal.target), inHand(sim, deal.kind === KIND.DROP ? n('parcel') : n('stash')));
      if (deal.kind === KIND.DROP) return job[J.STAGE] === STAGE.DONE;
      // The tip-off at 19:00, the search: framed.
      check(jobNews(g.seen, 'planted').length > 0, `${sim.prison.id}: the stash planted`);
      const day = prisonDay(s.step);
      for (let k = 0; k < 2 * DAY_STEPS && job[J.STAGE] !== STAGE.DONE && jobOf(s); k++) g.step();
      check(jobNews(g.seen, 'tipped').length > 0 && prisonDay(s.step) <= day + 1, `${sim.prison.id}: the guards tipped off`);
      return jobOf(s)?.[J.STAGE] === STAGE.DONE;
    }
    case KIND.WRESTLE: {
      g.talkTo(deal.target);
      g.talk(TALK.WRESTLE);
      check(s.bout.length > 0, `${sim.prison.id}: a bout begun (${refusals(g.seen).slice(-2)})`);
      for (let k = 0; k < 800 && s.bout.length; k++) g.step(deal.variant ? command(0, OP.TRAIN, 1 + (k % 2)) : 0);
      return job[J.STAGE] === STAGE.DONE;
    }
    case KIND.CHEAT: {
      g.talkTo(deal.target);
      s.cash = Math.max(s.cash, 50);
      g.talk(TALK.CHEAT, 0);
      check(!!s.cheat, `${sim.prison.id}: a hand of Cheat dealt (${refusals(g.seen).slice(-2)})`);
      // (The hand played out to the result asked: its end as the rules give it, read the same step.)
      sim.events = [];
      endCheat(sim as never, deal.variant ? 'won' : 'lost');
      oddjobs(sim as never);
      return job[J.STAGE] === STAGE.DONE;
    }
    case KIND.CHECKERS: {
      g.talkTo(deal.target);
      g.talk(TALK.CHECKERS, 1);
      check(!!s.board, `${sim.prison.id}: sat at the old-timer's board`);
      if (!deal.variant) g.talk(TALK.CHECKERS, 2);
      else {
        // (A win: the game's end as the rules give it, read the same step.)
        sim.events = [{ type: 'checkers', what: 'won', who: deal.target }];
        oddjobs(sim as never);
      }
      return job[J.STAGE] === STAGE.DONE;
    }
    case KIND.RAT: {
      s.rats.unshift(newRat(false, s.player.x, s.player.z));
      s.items.hand = inHand(sim, n('note'));
      byDesk(g, deal.target);
      const desk = deskOf(sim, deal.target);
      g.step(command(0, OP.EXT, EXT.RAT_LEAVE, ...tossArgs(desk)));
      for (let k = 0; k < 2000 && job[J.STAGE] !== STAGE.DONE; k++) g.step();
      return job[J.STAGE] === STAGE.DONE;
    }
    case KIND.CAKE: {
      const sm = smugglingOf(sim)!;
      const day = prisonDay(s.step) + 1;
      if (sm.visits) {
        g.jump(day, 10, 5);
        const pair = visitPairs(sim.world)[0];
        putTile(s.player, pair.seat);
        s.player.facing = pair.facing;
        s.seat = sim.world.props.findIndex((q) => (pair.seat % MAP_W) >= q.x && (pair.seat % MAP_W) < q.x + q.w && Math.floor(pair.seat / MAP_W) >= q.z && Math.floor(pair.seat / MAP_W) < q.z + q.d);
        for (let k = 0; k < 200 && !job[J.PROG]; k++) g.step();
        s.seat = -1;
      } else {
        g.to(day, 14, 50);
        const desk = containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'desk');
        check(s.items.containers[desk].some((v) => itemOf(v) === n('birthday_cake')), `${sim.prison.id}: the cake in the Red Cross parcel, in the desk`);
        outOfBox(g, desk, n('birthday_cake'));
      }
      check(jobNews(g.seen, 'cake').length === 1, `${sim.prison.id}: the birthday cake came in`);
      return inHand(sim, n('birthday_cake')) >= 0;
    }
    case KIND.LOOKOUT: {
      const d = digOf(sim)!;
      if (!['freeTime', 'eveningFreeTime'].includes(ROUTINE[s.routine].id)) g.to(prisonDay(s.step), 18, 5);
      putTile(s.player, d.door);
      let whistles = 0;
      for (let k = 0; k < 2 * DAY_STEPS && jobOf(s) && job[J.STAGE] !== STAGE.DONE; k++) {
        // The bot: on watch at the door, a whistle as soon as a guard is coming.
        if (Math.floor(s.player.x / UNIT) !== d.door % MAP_W || Math.floor(s.player.z / UNIT) !== Math.floor(d.door / MAP_W)) putTile(s.player, d.door);
        const coming = sim.events.some((e) => e.type === 'oddjob' && e.what === 'coming');
        if (coming) {
          whistles++;
          g.ext(EXT.WHISTLE);
        } else g.step();
      }
      check(jobNews(g.seen, 'digging').length > 0, `${sim.prison.id}: the dig begun`);
      return jobOf(s)?.[J.STAGE] === STAGE.DONE && whistles >= 0;
    }
    case KIND.DELIVER:
      g.talkTo(deal.target);
      g.talk(TALK.GIFT, inHand(sim, n('parcel')));
      return job[J.STAGE] === STAGE.DONE;
    case KIND.TIP: {
      const c = sim.prison.comms!;
      put(s.player, c.phone.x, c.phone.z);
      s.player.facing = c.phone.face;
      s.cash = Math.max(s.cash, 10);
      g.ext(EXT.CALL, CALLEE.TIP * 16, s.inmates[deal.target].cell);
      for (let k = 0; k < CALL_STEPS[CALLEE.TIP] + 5; k++) g.step();
      return job[J.STAGE] === STAGE.DONE;
    }
    case KIND.ERRAND:
      g.talkTo(deal.target);
      s.cash = Math.max(s.cash, 30);
      g.talk(TALK.BUY, stapleSlot(STAPLES.indexOf('sugar')));
      return inHand(sim, n('sugar')) >= 0;
  }
  return false;
}

/** Hands the job in to the one who asked; returns the 'paid' event. */
function handIn(g: Game, deal: Deal) {
  g.talkTo(deal.giver);
  g.talk(TALK.JOB_IN);
  return jobNews(g.seen, 'paid').at(-1);
}

{
  const lines: string[] = [];
  for (const p of PRISONS) {
    const row: string[] = [];
    for (let kind = 0; kind < KINDS.length; kind++) {
      const variants = kind === KIND.LIFT || kind === KIND.WRESTLE || kind === KIND.CHECKERS || kind === KIND.CHEAT ? [0, 1] : [0];
      for (const v of variants) {
        const found = dealt(p, kind, v);
        if (!found) {
          check(kind === KIND.LIFT && v === LIFT.MUG ? freezerOf(new Sim(p, 1)) < 0 : false, `${p.id}: ${KINDS[kind]}/${v} dealt in 60 days`);
          continue;
        }
        const { g, pin, deal } = found;
        const s = g.sim.state;
        const job = takeAt(g, pin);
        check(!!job && job[J.KIND] === kind && jobNews(g.seen, 'taken').length === 1, `${p.id}: ${KINDS[kind]} taken off pin ${pin} (${refusals(g.seen)})`);
        if (!job) continue;
        const ok = work(g, deal);
        check(ok, `${p.id}: ${KINDS[kind]}/${v} done by the bot (${refusals(g.seen).slice(-3)}; ${jobNews(g.seen, 'failed').map((e) => e.why)})`);
        if (!ok) continue;
        const cash = s.cash;
        const paid = handIn(g, deal);
        check(!!paid && s.cash === cash + deal.pay && !jobOf(s) && !!(s.eventFlags & TODAY.ODD_JOB), `${p.id}: ${KINDS[kind]} handed in: $${deal.pay} (${refusals(g.seen).slice(-2)})`);
        if (deal.perk === PERK.ITEM) check(inHand(g.sim, deal.item) >= 0, `${p.id}: and the ${itemDef(deal.item).id}`);
        if (deal.perk === PERK.DEBT) check(owes(s, deal.giver), `${p.id}: and he owes the player one`);
        row.push(`${KINDS[kind]}${variants.length > 1 ? '/' + v : ''}`);
      }
    }
    lines.push(`${p.id}: done ${row.join(' ')}`);
  }
  console.log(lines.join('\n'));
}

// ------------------------------------------------------------------ the story chains
{
  const lines: string[] = [];
  for (const p of PRISONS) {
    const chain = CHAINS[p.id];
    const sm = p.smuggling;
    // (A visit, or the Red Cross parcel, every day from 2: the story's cake comes in.)
    const cal: Array<[number, number, number]> = [[0, 0, 0]];
    for (let d = 2; d < 30; d++) if (chain.steps.some((st) => st.kind === KIND.CAKE) && sm) cal.push([d, sm.visits ? VISITING : DELIVERY, -1]);
    const g = game(p, 5, cal);
    const s = g.sim.state;
    g.jump(1, 10, 5);
    check(!chainDeal(g.sim), `${p.id}: no story on day 1`);
    const told: string[] = [];
    let day = 2;
    for (let k = 0; k < chain.steps.length; k++) {
      g.jump(day, 10, 5);
      const deal = chainDeal(g.sim);
      check(!!deal && deal.giver === s.inmates.findIndex((m) => m.cell === chain.who) && deal.kind === chain.steps[k].kind, `${p.id}: the story's step ${k + 1} on the board`);
      if (!deal) break;
      const job = takeAt(g, CHAIN_PIN);
      check(!!job && job[J.FROM] === FROM.CHAIN, `${p.id}: step ${k + 1} taken (${refusals(g.seen).slice(-2)})`);
      check(!boardNow(g.sim).chain, `${p.id}: its card off the board for the day`);
      const ok = work(g, deal);
      check(ok, `${p.id}: step ${k + 1} (${KINDS[deal.kind]}) done (${refusals(g.seen).slice(-3)}; ${jobNews(g.seen, 'failed').map((e) => e.why)})`);
      const paid = handIn(g, deal);
      const ch = jobNews(g.seen, 'chain').at(-1);
      check(!!paid && !!ch && ch.n === k && ch.more === k + 1 < chain.steps.length && s.oddjobs[R.CHAIN] === k + 1, `${p.id}: step ${k + 1} told`);
      told.push(`${KINDS[deal.kind]} $${deal.pay}`);
      // (The next step from the next prison day.)
      check(!chainDeal(g.sim), `${p.id}: one step a day`);
      day = prisonDay(s.step) + 1;
    }
    check(s.oddjobs[R.CHAIN] === chain.steps.length && !chainDeal(g.sim, day + 1), `${p.id}: the story told to its end`);
    const last = chain.steps.at(-1)!;
    if (last.perk === PERK.DEBT) check(owes(s, s.inmates.findIndex((m) => m.cell === chain.who)), `${p.id}: and he owes the player one`);
    if (last.perk === PERK.ITEM) check(inHand(g.sim, n(last.item!)) >= 0, `${p.id}: and the ${last.item}`);
    lines.push(`${p.id} story: ${told.join(', ')}; ended day ${day - 1}`);
  }
  console.log(lines.join('\n'));
}

// ------------------------------------------------------------------ failing, refusals, debts
{
  const p = CENTER_PERKS;
  const lines: string[] = [];
  // The time up: the job goes, and what the one who asked thinks of it.
  {
    const { g, pin, deal } = dealt(p, KIND.DELIVER)!;
    const s = g.sim.state;
    takeAt(g, pin);
    const was = s.inmates[deal.giver].opinion;
    g.toBoard();
    g.ext(EXT.BOARD, BOARD.TAKE, (pin + 1) % PINS);
    check(refusals(g.seen).at(-1) === 'haveJob', 'one job at a time');
    const ends = jobOf(s)![J.ENDS];
    check(ends === prisonDay(s.step) * DAY_STEPS, 'a one-day job runs to 08:00');
    g.to(prisonDay(s.step) + 1, 8, 1);
    const f = jobNews(g.seen, 'failed').at(-1);
    check(!jobOf(s) && f?.why === 'time' && s.inmates[deal.giver].opinion <= Math.max(0, was + FAIL_OPINION) + 5, `the time up: failed, opinion ${was} → ${s.inmates[deal.giver].opinion}`);
    g.toBoard();
    g.ext(EXT.BOARD, BOARD.QUIT);
    check(refusals(g.seen).at(-1) === 'noJob', 'nothing to give up');
  }
  // Given up; the pin stays taken for the day; away from the board.
  {
    const { g, pin } = dealt(p, KIND.TIP)!;
    const s = g.sim.state;
    put(s.player, 30, 40);
    g.ext(EXT.BOARD, BOARD.TAKE, pin);
    check(refusals(g.seen).at(-1) === 'notAtBoard', 'away from the board: refused');
    takeAt(g, pin);
    g.ext(EXT.BOARD, BOARD.QUIT);
    check(!jobOf(s) && jobNews(g.seen, 'failed').at(-1)?.why === 'quit', 'given up');
    takeAt(g, pin);
    check(refusals(g.seen).at(-1) === 'pinTaken' && boardNow(g.sim).pins[pin] === null, 'a pin taken stays taken for the day');
    g.to(prisonDay(s.step) + 1, 10, 5);
    check(boardNow(g.sim).pins.every((d) => !!d), 'the next morning: three new pins');
  }
  // A drop seen: off.
  {
    const { g, pin, deal } = dealt(p, KIND.DROP)!;
    const s = g.sim.state;
    takeAt(g, pin);
    byDesk(g, deal.target);
    // (The parcel in his desk the step a guard sees the player: read as the rules read it.)
    const k = inHand(g.sim, n('parcel'));
    const desk = s.items.containers[deskOf(g.sim, deal.target)];
    desk[desk.indexOf(0, containersOf(g.sim.world)[deskOf(g.sim, deal.target)].hidden)] = s.items.inv[k];
    s.items.inv[k] = 0;
    s.seen = true;
    g.sim.events = [];
    oddjobs(g.sim as never);
    g.seen.push(...g.sim.events);
    check(!jobOf(s) && jobNews(g.seen, 'failed').at(-1)?.why === 'seen', 'the parcel dropped in a guard\'s sight: failed');
  }
  // A parcel left in the desk by an earlier job: only one more counts.
  {
    const { g, pin, deal } = dealt(p, KIND.DROP)!;
    const s = g.sim.state;
    const desk = deskOf(g.sim, deal.target);
    const box = s.items.containers[desk];
    box[box.indexOf(0, containersOf(g.sim.world)[desk].hidden)] = slot(n('parcel'));
    takeAt(g, pin);
    g.step();
    check(jobOf(s)?.[J.STAGE] === STAGE.ON, 'an old parcel already in the desk: not done by it');
    g.blind();
    byDesk(g, deal.target);
    intoBox(g, desk, inHand(g.sim, n('parcel')));
    check(jobOf(s)?.[J.STAGE] === STAGE.DONE, 'the new one dropped in: done');
  }
  // A frame caught out: heat.
  {
    const { g, pin, deal } = dealt(p, KIND.FRAME)!;
    const s = g.sim.state;
    takeAt(g, pin);
    byDesk(g, deal.target);
    const gd = s.guards[0];
    gd.body.x = s.player.x + UNIT;
    gd.body.z = s.player.z;
    gd.body.facing = 9;
    g.setCalm(false);
    s.heat = 0;
    g.step();
    intoBox(g, deskOf(g.sim, deal.target), inHand(g.sim, n('stash')));
    check(!jobOf(s) && jobNews(g.seen, 'failed').at(-1)?.why === 'caught' && s.heat >= FRAME_HEAT, `a frame caught out: failed, heat ${s.heat}`);
  }
  // A fixed game the wrong way.
  {
    const { g, pin, deal } = dealt(p, KIND.WRESTLE, 0)!;
    const s = g.sim.state;
    takeAt(g, pin);
    s.inmates[deal.target].opinion = 60;
    s.energy = 100;
    g.talkTo(deal.target);
    g.talk(TALK.WRESTLE);
    for (let k = 0; k < 800 && s.bout.length; k++) g.step(command(0, OP.TRAIN, 1 + (k % 2)));
    check(!jobOf(s) && jobNews(g.seen, 'failed').at(-1)?.why === 'fixed', 'asked to lose the arm-wrestle, won it: failed');
  }
  // The lookout: a false alarm costs dig time; a guard close who sees in finds the dig.
  {
    const { g, pin } = dealt(p, KIND.LOOKOUT)!;
    const s = g.sim.state;
    takeAt(g, pin);
    const d = digOf(g.sim)!;
    const away = () => {
      for (const gd of s.guards) put(gd.body, 2, 2);
    };
    putTile(s.player, d.door);
    for (let k = 0; k < 2000 && !jobNews(g.seen, 'digging').length; k++) {
      away();
      g.step();
    }
    for (let k = 0; k < 80; k++) {
      away();
      g.step();
    }
    const prog = jobOf(s)![J.PROG];
    away();
    g.ext(EXT.WHISTLE);
    check(jobNews(g.seen, 'falseAlarm').length === 1 && jobOf(s)![J.PROG] < prog, `a false alarm: the dig set back (${prog} → ${jobOf(s)?.[J.PROG]})`);
    for (let k = 0; k < 60; k++) {
      away();
      g.step();
    }
    // (A guard a tile or two from the digger, on the open floor of his cell, in sight of him.)
    const gd = s.guards[0];
    const w = g.sim.world;
    const near = [1, -1, MAP_W, -MAP_W, 2, -2, 2 * MAP_W, -2 * MAP_W].map((o) => d.tile + o).find((t) => !w.blocked(t % MAP_W, Math.floor(t / MAP_W)) && !w.propSolid[t])!;
    putTile(gd.body, near);
    gd.path = [];
    g.step();
    check(jobNews(g.seen, 'coming').length > 0, 'a guard coming: told');
    check(!jobOf(s) && jobNews(g.seen, 'failed').at(-1)?.why === 'found', 'no whistle, the guard there: the dig found');
    check(CAUGHT_TILES < WARN_TILES && DIG_STEPS > 0, 'warned before he can see in');
  }
  // The fixer's own job: his hours, his opinion, once a day; and a debt.
  {
    const g = game(p, 5);
    const s = g.sim.state;
    g.jump(2, 9, 0);
    const fx = fixerOf(g.sim);
    g.talkTo(fx);
    g.talk(TALK.ODD_JOB);
    check(refusals(g.seen).at(-1) === 'closed', 'the fixer deals outside the free times: refused');
    g.jump(2, 10, 5);
    s.inmates[fx].opinion = FIXER_JOB_OPINION - 1;
    g.talkTo(fx);
    g.talk(TALK.ODD_JOB);
    check(refusals(g.seen).at(-1) === 'opinion', 'not to a stranger');
    s.inmates[fx].opinion = 70;
    g.talk(TALK.ODD_JOB);
    const job = jobOf(s);
    check(!!job && job[J.FROM] === FROM.FIXER && !!(s.eventFlags & TODAY.FIXER_JOB), `the fixer's job taken: ${job ? KINDS[job[J.KIND]] : '-'}`);
    g.ext(EXT.BOARD, BOARD.QUIT);
    g.talkTo(fx);
    g.talk(TALK.ODD_JOB);
    check(refusals(g.seen).at(-1) === 'fixerToday', 'once a day');
    // A debt: he joins the crew whatever he thinks of the player, or hands over a tool.
    const who = (fx + 1) % s.inmates.length;
    s.oddjobs[R.OWED] |= 1 << who;
    s.inmates[who].opinion = 30;
    g.talkTo(who);
    g.talk(TALK.RECRUIT);
    check(s.followers.includes(who) && !owes(s, who) && jobNews(g.seen, 'owedJoin').length === 1, 'one who owes the player joins the crew on it');
    const other = (fx + 2) % s.inmates.length;
    s.oddjobs[R.OWED] |= 1 << other;
    g.talkTo(other);
    g.talk(TALK.CALL_IN);
    const call = jobNews(g.seen, 'calledIn').at(-1);
    check(!!call && !!call.item && inHand(g.sim, call.item) >= 0 && !owes(s, other), `a debt called in: ${call?.item ? itemDef(call.item).id : '-'}`);
    g.talk(TALK.CALL_IN);
    check(refusals(g.seen).at(-1) === 'notOwed', 'not twice');
    lines.push(`fixer's job: ${job ? KINDS[job[J.KIND]] : '-'}; tool: ${call?.item ? itemDef(call.item).id : '-'}`);
  }
  // Saves: mid-job, from before the board, damaged.
  {
    const { g, pin } = dealt(p, KIND.LIFT, LIFT.WHISTLE)!;
    const s = g.sim.state;
    takeAt(g, pin);
    const saved = JSON.parse(JSON.stringify(s));
    const back = new Sim(p, 5);
    back.state = loadState(back.world, p, saved);
    check(JSON.stringify(back.state.oddjob) === JSON.stringify(s.oddjob) && JSON.stringify(back.state.oddjobs) === JSON.stringify(s.oddjobs), 'a save mid-job loads with it');
    const old = JSON.parse(JSON.stringify(s));
    delete old.oddjob;
    delete old.oddjobs;
    const o = new Sim(p, 5);
    o.state = loadState(o.world, p, old);
    check(o.state.oddjob.length === 0 && o.state.oddjobs.join() === '0,0,0,0,0', 'a save from before the board: no job, nothing recorded');
    const bad = JSON.parse(JSON.stringify(s));
    bad.oddjob[J.KIND] = 99;
    bad.oddjobs = [1, -2];
    const b = new Sim(p, 5);
    b.state = loadState(b.world, p, bad);
    check(b.state.oddjob.length === 0 && b.state.oddjobs.join() === '0,0,0,0,0', 'damaged numbers: dropped');
    // (Full review: a stage, a pin or a perk that can't be.)
    for (const [k, v] of [[J.STAGE, 2], [J.FROM, 5], [J.FROM, -1], [J.PERK, 3]] as const) {
      const odd = JSON.parse(JSON.stringify(s));
      odd.oddjob[k] = v;
      const q = new Sim(p, 5);
      q.state = loadState(q.world, p, odd);
      check(q.state.oddjob.length === 0, `a job with field ${k} at ${v}: dropped`);
    }
    check(LIFTS.length === 3 && bringsOf(saved.oddjob) === n('whistle'), 'a whistle to bring');
  }
  console.log(lines.join('\n'));
}

// ------------------------------------------------------------------ the rules review (P40)
{
  const p = CENTER_PERKS;
  const lines: string[] = [];
  const pockets = (g: Game, k: number) => g.sim.state.items.containers[pocketOf(g.sim.world, g.sim.state.inmates.length + k)];
  /** The hand-in asked of the one who asked (his opinion high enough to talk): what it refuses, or 'paid'. */
  const tryHandIn = (g: Game, giver: number) => {
    g.sim.state.inmates[giver].opinion = Math.max(g.sim.state.inmates[giver].opinion, 60);
    const paid = jobNews(g.seen, 'paid').length;
    g.talkTo(giver);
    g.talk(TALK.JOB_IN);
    return jobNews(g.seen, 'paid').length > paid ? 'paid' : refusals(g.seen).at(-1);
  };
  // 1. The pet rat plants the stash while a guard looks at the player: planted, not caught.
  {
    const { g, pin, deal } = dealt(p, KIND.FRAME)!;
    const s = g.sim.state;
    takeAt(g, pin);
    g.setCalm(false);
    s.heat = 0;
    s.rats.unshift(newRat(false, s.player.x, s.player.z));
    s.items.hand = inHand(g.sim, n('stash'));
    byDesk(g, deal.target);
    const gd = s.guards[0];
    const stare = () => {
      gd.body.x = s.player.x + UNIT;
      gd.body.z = s.player.z;
      gd.body.facing = 9;
      gd.path = [];
    };
    stare();
    g.step(command(0, OP.EXT, EXT.RAT_LEAVE, ...tossArgs(deskOf(g.sim, deal.target))));
    let sawPlayer = false;
    for (let k = 0; k < 400 && jobOf(s) && !jobNews(g.seen, 'planted').length; k++) {
      g.step();
      sawPlayer ||= s.seen;
      stare();
    }
    check(sawPlayer && jobNews(g.seen, 'planted').length === 1 && !jobNews(g.seen, 'failed').length && s.heat < FRAME_HEAT, `the rat's plant while a guard watches the player: planted, not caught (seen ${sawPlayer}, heat ${s.heat})`);
  }
  // 2. A lift job given up takes its item back; a leftover is planted over; no room at all: not offered.
  {
    const g = game(p, 5);
    const s = g.sim.state;
    g.jump(3, 10, 5);
    s.oddjobs[R.CHAIN] = 1;
    const cd = chainDeal(g.sim)!;
    check(cd.kind === KIND.LIFT && cd.variant === LIFT.KEEPSAKE, 'Center Perks: the story\'s second step is the keepsake');
    takeAt(g, CHAIN_PIN);
    check(pockets(g, cd.target).some((v) => itemOf(v) === n('pocket_watch')), 'the keepsake planted in his pockets');
    g.ext(EXT.BOARD, BOARD.QUIT);
    check(!pockets(g, cd.target).some((v) => itemOf(v) === n('pocket_watch')), 'given up: the keepsake out of his pockets again');
  }
  {
    const { g, pin, deal } = dealt(p, KIND.LIFT, LIFT.WHISTLE)!;
    const pk = pockets(g, deal.target);
    const free = pk.indexOf(0);
    pk[free] = slot(n('pocket_watch'));
    takeAt(g, pin);
    check(!!jobOf(g.sim.state) && itemOf(pk[free]) === n('whistle'), 'a keepsake left in his pockets (an old save): the whistle planted over it');
    g.ext(EXT.BOARD, BOARD.QUIT);
    check(!pk.some((v) => itemOf(v) === n('whistle')), 'the whistle job given up: the whistle gone from his pockets');
    const again = dealt(p, KIND.LIFT, LIFT.WHISTLE)!;
    const pk2 = pockets(again.g, again.deal.target);
    pk2[pk2.indexOf(0)] = slot(n('soap'));
    takeAt(again.g, again.pin);
    check(!jobOf(again.g.sim.state) && refusals(again.g.seen).at(-1) === 'liftFull' && boardRefusal(again.g.sim as never, again.pin) === 'liftFull', 'his pockets full of something else: the whistle job not offered');
  }
  // 3 + 6. A frame-up's stash: in the hidden compartment it isn't planted; an old stash searched out doesn't make it impossible.
  {
    const { g, pin, deal } = dealt(p, KIND.FRAME)!;
    const s = g.sim.state;
    takeAt(g, pin);
    g.blind();
    byDesk(g, deal.target);
    const desk = deskOf(g.sim, deal.target);
    openBox(g, desk);
    g.step(command(0, OP.MOVE, inHand(g.sim, n('stash')), SLOT.CONTAINER + 0));
    g.step(command(0, OP.CLOSE));
    check(itemOf(s.items.containers[desk][0]) === n('stash') && !jobNews(g.seen, 'planted').length && jobOf(s)?.[J.PROG] === 0, 'the stash in the hidden compartment (never searched): not planted');
  }
  {
    const { g, pin, deal } = dealt(p, KIND.FRAME)!;
    const s = g.sim.state;
    const desk = deskOf(g.sim, deal.target);
    const box = s.items.containers[desk];
    const hid = containersOf(g.sim.world)[desk].hidden;
    box[box.indexOf(0, hid)] = slot(n('stash'));
    takeAt(g, pin);
    check(jobOf(s)?.[J.WARN] === 1, 'an old stash in the drawers as it\'s taken: counted');
    // (A search takes the old one.)
    for (let k = hid; k < box.length; k++) if (itemOf(box[k]) === n('stash')) box[k] = 0;
    g.step();
    g.blind();
    byDesk(g, deal.target);
    intoBox(g, desk, inHand(g.sim, n('stash')));
    check(jobNews(g.seen, 'planted').length === 1 && jobOf(s)?.[J.PROG] === 1, 'the old one searched out, the new one planted: it counts');
  }
  // 4. A job taken from 18:00 counts its days from the next prison day.
  {
    check(endsFor(at(4, 10, 5), 1) === 4 * DAY_STEPS && endsFor(at(4, 17, 59), 1) === 4 * DAY_STEPS, 'a one-day job taken before 18:00: until 08:00 the next morning');
    check(endsFor(at(4, 18, 0), 1) === 5 * DAY_STEPS && endsFor(at(4, 21, 30), 2) === 6 * DAY_STEPS, 'taken from 18:00: counted from tomorrow');
    const { g, pin, deal } = dealt(p, KIND.DELIVER)!;
    const s = g.sim.state;
    const day = prisonDay(s.step);
    g.jump(day, 21, 30);
    takeAt(g, pin);
    check(jobOf(s)?.[J.ENDS] === (day + 1) * DAY_STEPS, 'a delivery taken at 21:30: until 08:00 the day after tomorrow');
    g.jump(day + 1, 10, 5);
    check(work(g, deal) && tryHandIn(g, deal.giver) === 'paid', 'done and paid the next day');
  }
  // 5. Leftovers don't finish later jobs: a whistle kept, a parcel taken back out, a cake kept; the mug left in the freezer goes.
  {
    const { g, pin, deal } = dealt(p, KIND.LIFT, LIFT.WHISTLE)!;
    const s = g.sim.state;
    takeAt(g, pin);
    s.items.inv[s.items.inv.slice(0, HOTBAR).indexOf(0)] = slot(n('whistle'));
    check(tryHandIn(g, deal.giver) === 'notDone', 'a whistle kept from an earlier job: not this job\'s');
    s.guards[deal.target].ko = 400;
    outOfBox(g, pocketOf(g.sim.world, s.inmates.length + deal.target), n('whistle'));
    check(tryHandIn(g, deal.giver) === 'paid', 'lifted off the guard: handed in');
  }
  {
    const { g, pin, deal } = dealt(p, KIND.DROP)!;
    const s = g.sim.state;
    takeAt(g, pin);
    g.blind();
    byDesk(g, deal.target);
    const desk = deskOf(g.sim, deal.target);
    intoBox(g, desk, inHand(g.sim, n('parcel')));
    check(jobOf(s)?.[J.STAGE] === STAGE.DONE, 'the parcel dropped: done');
    byDesk(g, deal.target);
    outOfBox(g, desk, n('parcel'));
    check(jobOf(s)?.[J.STAGE] === STAGE.ON && tryHandIn(g, deal.giver) === 'notDone', 'taken back out: not done, no pay');
    byDesk(g, deal.target);
    intoBox(g, desk, inHand(g.sim, n('parcel')));
    check(jobOf(s)?.[J.STAGE] === STAGE.DONE && tryHandIn(g, deal.giver) === 'paid', 'dropped again: paid');
  }
  {
    const { g, pin, deal } = dealt(SAN_PANCHO, KIND.CAKE)!;
    const s = g.sim.state;
    takeAt(g, pin);
    s.items.inv[s.items.inv.slice(0, HOTBAR).indexOf(0)] = slot(n('birthday_cake'));
    check(tryHandIn(g, deal.giver) === 'notDone', 'a cake kept from an earlier job: not this job\'s');
  }
  {
    const { g, pin } = dealt(p, KIND.LIFT, LIFT.MUG)!;
    const f = freezerOf(g.sim);
    takeAt(g, pin);
    check(g.sim.state.items.containers[f].some((v) => itemOf(v) === n('mug')), 'the mug in the freezer');
    g.ext(EXT.BOARD, BOARD.QUIT);
    check(!g.sim.state.items.containers[f].some((v) => itemOf(v) === n('mug')), 'given up: the mug gone from the freezer');
  }
  // 7. The mug over the freezer's food, never over what the player hid there.
  {
    const { g, pin } = dealt(p, KIND.LIFT, LIFT.MUG)!;
    const box = g.sim.state.items.containers[freezerOf(g.sim)];
    box.fill(0);
    box[0] = slot(n('potato'));
    box[1] = slot(n('soap'));
    box[2] = slot(n('sock'));
    box[3] = slot(n('soap'));
    takeAt(g, pin);
    check(!!jobOf(g.sim.state) && box.map((v) => itemDef(itemOf(v)).id).join() === 'mug,soap,sock,soap', `a full freezer: the mug over its food (${box.map((v) => itemDef(itemOf(v)).id)})`);
  }
  {
    const { g, pin } = dealt(p, KIND.LIFT, LIFT.MUG)!;
    const box = g.sim.state.items.containers[freezerOf(g.sim)];
    box.fill(slot(n('soap')));
    takeAt(g, pin);
    check(!jobOf(g.sim.state) && refusals(g.seen).at(-1) === 'liftFull' && box.every((v) => itemOf(v) === n('soap')), 'the freezer full of the player\'s things: not offered, nothing overwritten');
  }
  // 8. The time up with what's to be brought in hand: done, it waits to be handed in.
  {
    const { g, pin, deal } = dealt(p, KIND.LIFT, LIFT.WHISTLE)!;
    const s = g.sim.state;
    takeAt(g, pin);
    s.guards[deal.target].ko = 400;
    outOfBox(g, pocketOf(g.sim.world, s.inmates.length + deal.target), n('whistle'));
    const end = jobOf(s)![J.ENDS];
    g.jump(prisonDay(end), 8, 5);
    check(jobOf(s)?.[J.STAGE] === STAGE.DONE && !jobNews(g.seen, 'failed').length, 'the whistle in hand at 08:00: the job waits, done');
    g.jump(prisonDay(end) + 2, 10, 5);
    check(tryHandIn(g, deal.giver) === 'paid', 'handed in days later');
  }
  {
    const { g, pin } = dealt(p, KIND.LIFT, LIFT.WHISTLE)!;
    const s = g.sim.state;
    takeAt(g, pin);
    s.items.inv[s.items.inv.slice(0, HOTBAR).indexOf(0)] = slot(n('whistle'));
    g.jump(prisonDay(jobOf(s)![J.ENDS]), 8, 5);
    check(!jobOf(s) && jobNews(g.seen, 'failed').at(-1)?.why === 'time', 'only an old whistle in hand at 08:00: out of time');
  }
  // 9. The cake with no room: the hotbar full at the visit, into the desk; the desk full for the parcel, into the hotbar; both, told.
  {
    const { g, pin, deal } = dealt(SAN_PANCHO, KIND.CAKE)!;
    const s = g.sim.state;
    takeAt(g, pin);
    for (let k = 0; k < HOTBAR; k++) if (!s.items.inv[k]) s.items.inv[k] = slot(n('soap'));
    g.jump(prisonDay(s.step) + 1, 10, 5);
    const pair = visitPairs(g.sim.world)[0];
    putTile(s.player, pair.seat);
    s.player.facing = pair.facing;
    s.seat = g.sim.world.props.findIndex((q) => pair.seat % MAP_W >= q.x && pair.seat % MAP_W < q.x + q.w && Math.floor(pair.seat / MAP_W) >= q.z && Math.floor(pair.seat / MAP_W) < q.z + q.d);
    for (let k = 0; k < 200 && !jobOf(s)![J.PROG]; k++) g.step();
    s.seat = -1;
    const mine = containersOf(g.sim.world).findIndex((c) => c.mine && c.prop.kind === 'desk');
    check(jobNews(g.seen, 'cake').at(-1)?.n === 2 && s.items.containers[mine].some((v) => itemOf(v) === n('birthday_cake')), 'the hotbar full at the visit: the cake in the desk');
    s.items.inv[0] = 0;
    outOfBox(g, mine, n('birthday_cake'));
    check(tryHandIn(g, deal.giver) === 'paid', 'and handed in');
  }
  {
    const { g, pin } = dealt(STALAG_FLUCHT, KIND.CAKE)!;
    const s = g.sim.state;
    takeAt(g, pin);
    const mine = containersOf(g.sim.world).findIndex((c) => c.mine && c.prop.kind === 'desk');
    const box = s.items.containers[mine];
    for (let k = containersOf(g.sim.world)[mine].hidden; k < box.length; k++) if (!box[k]) box[k] = slot(n('soap'));
    const free = [];
    for (let k = 0; k < HOTBAR; k++) if (!s.items.inv[k]) {
      s.items.inv[k] = slot(n('sock'));
      free.push(k);
    }
    const day = prisonDay(s.step) + 1;
    g.to(day, 14, 50);
    check(jobNews(g.seen, 'cakeKept').length === 1 && jobNews(g.seen, 'cakeKept')[0].n === 1 && !jobOf(s)![J.PROG], 'the desk and the hotbar full on the parcel\'s day: told once, the cake waits');
    s.items.inv[free[0]] = 0;
    g.to(day, 14, 52);
    check(jobNews(g.seen, 'cake').at(-1)?.n === 3 && inHand(g.sim, n('birthday_cake')) >= 0, 'room made in the hotbar: the cake comes in there');
  }
  // 10. A guard bribed to look away doesn't find the dig.
  {
    const { g, pin } = dealt(p, KIND.LOOKOUT)!;
    const s = g.sim.state;
    takeAt(g, pin);
    const d = digOf(g.sim)!;
    const away = () => {
      for (const gd of s.guards) put(gd.body, 2, 2);
    };
    putTile(s.player, d.door);
    for (let k = 0; k < 2000 && !jobNews(g.seen, 'digging').length; k++) {
      away();
      g.step();
    }
    const w = g.sim.world;
    const near = [1, -1, MAP_W, -MAP_W, 2, -2, 2 * MAP_W, -2 * MAP_W].map((o) => d.tile + o).find((t) => !w.blocked(t % MAP_W, Math.floor(t / MAP_W)) && !w.propSolid[t])!;
    away();
    const gd = s.guards[0];
    gd.bribed = s.step + 1e6;
    putTile(gd.body, near);
    gd.path = [];
    const prog = jobOf(s)![J.PROG];
    for (let k = 0; k < 5; k++) {
      putTile(gd.body, near);
      g.step();
    }
    check(!!jobOf(s) && !jobNews(g.seen, 'failed').length && jobOf(s)![J.PROG] > prog, 'a bribed guard by the dig: it goes on');
  }
  // 11. A rat's job says it needs a pet rat (the card: play/oddjobs.ts metaOf, `oddjob.needsRat`).
  lines.push('rules review: the rat\'s plant, leftovers, the hidden compartment, late jobs, the freezer, the deadline, the cake, a bribed guard: checked');
  console.log(lines.join('\n'));
}

// ------------------------------------------------------------------ the UI review (P40)
{
  const lines: string[] = [];
  // The whistle only in the dig's hours: outside them, at the door, B opens the card and a whistle is refused (no false alarm).
  {
    const { g, pin } = dealt(CENTER_PERKS, KIND.LOOKOUT)!;
    const s = g.sim.state;
    takeAt(g, pin);
    const d = digOf(g.sim)!;
    const day = prisonDay(s.step);
    g.jump(day, 13, 0);
    putTile(s.player, d.door);
    g.step();
    const prog = jobOf(s)![J.PROG];
    check(!canWhistle(g.sim as never) && !whistleNow(g.sim as never), 'at work, by the door: no whistle (B opens the card)');
    g.ext(EXT.WHISTLE);
    check(refusals(g.seen).at(-1) === 'notLookout' && !jobNews(g.seen, 'falseAlarm').length && jobOf(s)![J.PROG] === prog, 'a whistle outside the dig\'s hours: refused, the dig untouched');
    g.jump(day, 18, 5);
    const away = () => {
      for (const gd of s.guards) put(gd.body, 2, 2);
    };
    putTile(s.player, d.door);
    for (let k = 0; k < 2000 && !jobNews(g.seen, 'digging').length; k++) {
      away();
      g.step();
    }
    away();
    g.step();
    check(canWhistle(g.sim as never) && !whistleNow(g.sim as never), 'digging, nobody coming: the card\'s whistle there, B opens the card');
    // (A guard coming: within WARN_TILES, not yet close enough to see in.)
    const gd = s.guards[0];
    putTile(gd.body, d.tile + 4);
    gd.path = [];
    g.step();
    putTile(gd.body, d.tile + 4);
    check(whistleNow(g.sim as never), 'a guard coming: B and the chip whistle');
  }
  // Off watch (away from the door) in the dig's hours: no guard "coming", nothing to whistle at.
  {
    const { g, pin } = dealt(CENTER_PERKS, KIND.LOOKOUT)!;
    const s = g.sim.state;
    takeAt(g, pin);
    const d = digOf(g.sim)!;
    g.jump(prisonDay(s.step), 18, 5);
    const gd = s.guards[0];
    const seen = g.seen.length;
    for (let k = 0; k < 40; k++) {
      put(s.player, 2, 2);
      putTile(gd.body, d.tile + 4);
      gd.path = [];
      g.step();
    }
    check(!g.seen.slice(seen).some((e) => e.type === 'oddjob' && e.what === 'coming') && jobOf(s)![J.WARN] === 0 && !whistleNow(g.sim as never), 'off watch, a guard near the dig: no "coming" toast');
  }
  // A delivery's parcel handed over isn't a gift: what he thinks of the player stays.
  {
    const { g, pin, deal } = dealt(CENTER_PERKS, KIND.DELIVER)!;
    const s = g.sim.state;
    takeAt(g, pin);
    s.inmates[deal.target].opinion = 60;
    g.talkTo(deal.target);
    const was = s.inmates[deal.target].opinion;
    g.talk(TALK.GIFT, inHand(g.sim, n('parcel')));
    check(jobOf(s)?.[J.STAGE] === STAGE.DONE && s.inmates[deal.target].opinion === was, `the parcel delivered: done, his opinion unchanged (${was} → ${s.inmates[deal.target].opinion})`);
  }
  // The digger faces open floor at his bed, in every prison, whoever digs.
  for (const p of PRISONS) {
    const sim = new Sim(p, 1);
    const pl = placesOf(sim.world);
    let n = 0;
    for (const m of sim.state.inmates) {
      const tile = pl.bedside[m.cell] ?? -1;
      if (tile < 0) continue;
      const f = digFace(sim.world, tile);
      const step = f === 1 ? 1 : f === 5 ? MAP_W : f === 9 ? -1 : -MAP_W;
      check(isFloor(sim.world, (tile + step) % MAP_W, Math.floor((tile + step) / MAP_W)), `${p.id}: cell ${m.cell}'s digger faces open floor`);
      n++;
    }
    lines.push(`${p.id}: ${n} dig spots face open floor`);
  }
  console.log(lines.join('\n'));
}
