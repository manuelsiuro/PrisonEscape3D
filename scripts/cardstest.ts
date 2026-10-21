/**
 * Card sharks (P27), rule by rule:
 * - the data: every prison's court (the decor's hoop, five spots on open yard floor in sight of the
 *   rim) and its old-timer; the numbers the help and the cards say;
 * - Cheat: the deal is roll()'s (the 14 cards, five each, the table card); the stake is on the
 *   table at once and counts as one of the day's games; only legal plays and calls go through;
 *   the inmate moves after thinking, calls a claim its own cards prove false, and lays true cards
 *   when it has them; a call costs the wrong side a chip, the cards stay up, the loser leads; the
 *   last chip settles the stake; walking away folds, the sirens give it back; the tell's odds as
 *   measured over thousands of plays; how often ways of playing win (none much over half);
 * - Hoops: the power marker, the window each spot needs (the wind and the rain), a shot judged
 *   at its release; a shootout's turns, the inmate's shots, sudden death, what a win brings
 *   (sports day too); shots on one's own and the day's point of Speed; the shootout off the court;
 * - Checkers: the opening, captures forced, a jump that must go on, a man crowned at the far row
 *   (its move ends), kings both ways; his move (the same every time, quick enough at every depth),
 *   how he fares against a player moving at random at each level; the draw; a game won (Intellect,
 *   opinion, his level), resigned; the board kept between times;
 * - 2.5.1: the player's move at Cheat and their shot in a shootout on a clock; a game still on
 *   at roll call settled on the chips (a shootout off);
 * - saves: a hand of Cheat, a shootout and the board carry on the same; damaged ones are dropped.
 */
import { CALL_MAX, CARD, COURT_LEAVE, COURT_RANGE, CHIPS, DECK, DRAW_PLIES, ELDER_DEPTH, ELDER_OPINION, FALSE_TELL, GAMES_A_DAY, HAND, NEED_BASE, NEED_PER_TILE, PLAY_OPINION, PRACTICE_MAKES, REVEAL_STEPS, SHOOT_SPOTS, SHOT_CLOCK, SPORTS_WINS, STAKES, THINK_STEPS, TURN_STEPS, WIN_OPINION } from '../src/content/games';
import { ROUTINE } from '../src/content/routine';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { TRAINING } from '../src/content/prisons/training';
import { DAY_EVENTS } from '../src/content/days';
import { lineOfSight } from '../src/sim/ai/sight';
import { command, EXT, OP, TALK } from '../src/sim/command';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { callOn, type Cheat, dealRound, decide, isTrue, lay, tellOdds } from '../src/sim/systems/cards';
import { elderMove, elderOf, newBoard, PIECE, squareAt, stepsOf } from '../src/sim/systems/checkers';
import { DAY_STEPS } from '../src/sim/systems/clock';
import { courtOf, eighthOf, judge, powerAt, rimOf, shotWindow, spotDistance, windAlong } from '../src/sim/systems/hoops';
import { playedToday } from '../src/sim/systems/games';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';

const at = (day: number, hour: number, minute = 0) => (day - 1) * DAY_STEPS + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
const put = (b: { x: number; z: number }, t: number) => {
  b.x = (t % MAP_W) * UNIT + UNIT / 2;
  b.z = Math.floor(t / MAP_W) * UNIT + UNIT / 2;
};
const refusals = (seen: SimEvent[]) => seen.filter((e) => e.type === 'refused').map((e) => (e as { why: string }).why);
const pct = (a: number, b: number) => `${Math.round((a * 100) / Math.max(1, b))}%`;

/** A game kept calm (heat and lockdowns cleared each step unless asked), every day quiet unless forced. */
function game(prison = CENTER_PERKS, seed = 5, calendar: Array<[number, number, number, number?, number?]> = [[0, 0, 0]]) {
  const sim = new Sim(prison, seed);
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
  /** An inmate on a tile and the player just east of it facing it, talking (true once they are). */
  const talkTo = (who: number, tile: number) => {
    const m = sim.state.inmates[who];
    put(m.body, tile);
    put(sim.state.player, tile + 1);
    sim.state.player.facing = 9;
    m.goal = -1;
    m.path = [];
    m.doing = 0;
    step(command(0, OP.INTERACT));
    return sim.state.talk === who;
  };
  const talk = (a: number, b = 0, c = 0) => step(command(0, OP.TALK, a, b, c));
  const blind = () => {
    for (const g of sim.state.guards) g.sees = false;
  };
  return { sim, seen, step, to, talkTo, talk, blind };
}

/** An open tile of the yard with open floor east of it (the first from the middle). */
function yardTile(sim: Sim): number {
  const w = sim.world;
  const out: number[] = [];
  for (let i = MAP_W; i < MAP_W * 63; i++) {
    const x = i % MAP_W;
    const z = Math.floor(i / MAP_W);
    if (w.zoneAt(x, z) === 'yard' && w.zoneAt(x + 1, z) === 'yard' && !w.blocked(x, z) && !w.blocked(x + 1, z) && !w.blocked(x - 1, z)) out.push(i);
  }
  return out[out.length >> 1];
}

// ------------------------------------------------------------------ the data
{
  const lines: string[] = [];
  for (const p of [...PRISONS, TRAINING]) {
    const sim = new Sim(p, 1);
    const c = courtOf(sim);
    check(!!c && c.spots.length === SHOOT_SPOTS, `${p.id}: a court with ${SHOOT_SPOTS} spots`);
    if (!c) continue;
    const w = sim.world;
    const r = rimOf(c);
    // The rim over open floor, where the decor's hoop stands, turned the same way (rot 0 south, 1 east, 2 north, 3 west).
    const rot = c.face === 5 ? 0 : c.face === 1 ? 1 : c.face === 13 ? 2 : 3;
    check(!w.blocked(c.x, c.z) && (p.decor ?? []).some((d) => d.kind === 'hoop' && d.x === c.x && d.z === c.z && (d.rot ?? 0) === rot), `${p.id}: the rim over open floor, the decor's hoop there facing the court`);
    check((p.decor ?? []).filter((d) => d.kind === 'hoop').length === 1, `${p.id}: one hoop`);
    for (const q of c.spots) {
      const zone = w.zoneAt(q.x, q.z);
      check(!w.blocked(q.x, q.z) && w.propSolid[q.z * MAP_W + q.x] === 0, `${p.id}: spot ${q.x},${q.z} open floor`);
      check(!(p.decor ?? []).some((d) => q.x >= d.x && q.x < d.x + (d.w ?? 1) && q.z >= d.z && q.z < d.z + (d.d ?? 1)), `${p.id}: spot ${q.x},${q.z} clear of decor`);
      check(zone === 'yard' || zone === 'rollCall' || zone === 'sports', `${p.id}: spot ${q.x},${q.z} in the yard or on the sports ground (${zone})`);
      check(lineOfSight(w, q.x * UNIT + UNIT / 2, q.z * UNIT + UNIT / 2, r.x, r.z), `${p.id}: spot ${q.x},${q.z} in sight of the rim`);
      // (Nothing standing in the way of the shot: no bench, tree or bush between the spot and the rim.)
      let clear = true;
      for (let k = 1; k < 20; k++) {
        const x = Math.floor(q.x + 0.5 + ((r.x / UNIT - q.x - 0.5) * k) / 20);
        const z = Math.floor(q.z + 0.5 + ((r.z / UNIT - q.z - 0.5) * k) / 20);
        if ((x === q.x && z === q.z) || (x === c.x && z === c.z)) continue;
        if (w.props.some((o) => x >= o.x && x < o.x + o.w && z >= o.z && z < o.z + o.d) || (p.decor ?? []).some((d) => d.kind !== 'hoop' && x >= d.x && x < d.x + (d.w ?? 1) && z >= d.z && z < d.z + (d.d ?? 1))) clear = false;
      }
      check(clear, `${p.id}: nothing between spot ${q.x},${q.z} and the rim`);
    }
    const elder = elderOf(sim);
    check(elder >= 0, `${p.id}: an old-timer`);
    lines.push(`${p.id} ${p.names[sim.state.inmates[elder].cell - 2]}, spots ${c.spots.map((_, k) => spotDistance(c, k) / 10).join('/')}`);
  }
  check(DECK.join() === '4,4,4,2' && HAND === 5 && CHIPS === 2 && STAKES.join() === '5,10,20', 'Cheat: 14 cards (4 Kings, 4 Queens, 4 Aces, 2 Jokers), five each, two chips, stakes $5/$10/$20');
  console.log(`data: ${lines.join(' | ')}`);
}

// ------------------------------------------------------------------ Cheat in the game
{
  const { sim, seen, step, to, talkTo, talk, blind } = game();
  const s = sim.state;
  const tile = yardTile(sim);
  to(1, 10, 30);
  check(talkTo(0, tile), 'talking in the yard');
  s.inmates[0].opinion = 60;
  s.cash = 100;
  blind();
  talk(TALK.CHEAT, 1);
  const c = s.cheat!;
  check(!!c && s.cash === 90 && playedToday(s, 0) === 1 && c.mine.length === HAND && c.theirs.length === HAND && c.table >= 1 && c.table <= 3 && c.turn === 0, 'a game for $10: the stake on the table, one of the day\'s games, five cards each, the player leads');
  // The deal: the cards of one deck.
  const counts = [0, 0, 0, 0];
  for (const card of [...c.mine, ...c.theirs]) counts[card - 1]++;
  check(counts.every((n, k) => n <= DECK[k]), `the deal comes from one deck (${counts.join(',')})`);
  // Only legal plays.
  talk(TALK.LIAR);
  check(!seen.some((e) => e.type === 'cheat' && e.what === 'called'), 'nothing to call before the inmate has played');
  talk(TALK.PLAY, 0b1111);
  talk(TALK.PLAY, 0);
  talk(TALK.PLAY, 1 << 5);
  check(c.mine.length === HAND && c.by === -1, 'four cards, none, a card not in the hand: refused');
  talk(TALK.PLAY, 0b11);
  check(c.mine.length === HAND - 2 && c.by === 0 && c.turn === 1 && c.pile === 2, 'two cards laid: the inmate\'s move');
  const before = s.step;
  while (s.cheat && s.cheat.turn === 1) step();
  check(s.step - before === THINK_STEPS, `it thinks ${THINK_STEPS / 20} s`);
  // Play on to the end: true cards when there are, a call when the tell shows.
  let guard = 0;
  while (s.cheat && guard++ < 4000) {
    const g = s.cheat;
    if (g.turn !== 0) {
      step();
      continue;
    }
    const trueKs = g.mine.map((card, k) => (isTrue(card, g.table) ? k : -1)).filter((k) => k >= 0).slice(0, 3);
    if (g.by === 1 && (g.tell || !g.theirs.length)) talk(TALK.LIAR);
    else if (g.mine.length) talk(TALK.PLAY, (trueKs.length ? trueKs : [0]).reduce((m, k) => m | (1 << k), 0));
    else talk(TALK.LIAR);
  }
  const end = seen.filter((e) => e.type === 'cheat' && (e.what === 'won' || e.what === 'lost')).at(-1) as Extract<SimEvent, { type: 'cheat' }> | undefined;
  check(!!end && !s.cheat, 'the game played to its end');
  check(s.cash === (end?.what === 'won' ? 110 : 90), `the stake settled (${end?.what}: $${s.cash})`);
  const calls = seen.filter((e) => e.type === 'cheat' && e.what === 'called') as Array<Extract<SimEvent, { type: 'cheat' }>>;
  check(calls.length >= CHIPS && calls.every((e) => e.loser === (e.lie ? 1 - (e.by ?? 0) : e.by)), 'every call cost the side that was wrong a chip');
  // A call's cards stay up, then the loser leads.
  const dealt = seen.filter((e) => e.type === 'cheat' && e.what === 'dealt').length;
  check(dealt >= 2, 'a round dealt after each call that wasn\'t the last');
  // Walking away folds; the sirens give it back.
  talk(TALK.CHEAT, 0);
  check(!!s.cheat && s.cash === (end?.what === 'won' ? 105 : 85), 'a second game, $5');
  const was = s.cash;
  for (let k = 0; k < 20; k++) step(command(1));
  check(!s.cheat && s.cash === was && seen.some((e) => e.type === 'cheat' && e.what === 'folded'), 'walked away: folded, the stake lost');
  check(talkTo(0, tile), 'back at the table');
  talk(TALK.CHEAT, 2);
  const was2 = s.cash;
  s.lockdown = true;
  step(0, false);
  check(!s.cheat && s.cash === was2 + 20 && seen.some((e) => e.type === 'cheat' && e.what === 'off'), 'the sirens: the game off, the $20 back');
  s.lockdown = false;
  // Knocked out by someone else (not the player's blow): off, the stake back (another inmate, a game of their own).
  put(s.inmates[0].body, tile + 3 * MAP_W);
  check(talkTo(1, tile), 'at the table with another');
  s.inmates[1].opinion = 60;
  talk(TALK.CHEAT, 0);
  const was3 = s.cash;
  s.inmates[1].ko = 200;
  step();
  check(!s.cheat && s.cash === was3 + 5 && seen.some((e) => e.type === 'cheat' && e.what === 'off' && e.who === 1), 'the partner knocked out by someone else: off, the stake back');
  s.inmates[1].ko = 0;
  put(s.inmates[1].body, tile + 3 * MAP_W);
  check(talkTo(0, tile), 'at the table once more');
  talk(TALK.CHEAT, 0);
  check(refusals(seen).at(-1) === 'played' && playedToday(s, 0) === GAMES_A_DAY, `three games a day each (Cheat among them)`);
  console.log(`cheat in the game: the deal, ${calls.length} calls, ${end?.what}; folded walking away; off in a lockdown; three a day`);
}

// ------------------------------------------------------------------ 2.5.1: the player's move on a clock, the roll call's bell
{
  const { sim, seen, step, to, talkTo, talk, blind } = game();
  const s = sim.state;
  const tile = yardTile(sim);
  to(1, 10, 30);
  check(talkTo(0, tile), 'at the table');
  s.inmates[0].opinion = 60;
  s.cash = 100;
  blind();
  talk(TALK.CHEAT, 1);
  const from = s.step;
  while (s.cheat && s.step - from < TURN_STEPS * 2) step();
  check(!s.cheat && s.cash === 90 && seen.some((e) => e.type === 'cheat' && e.what === 'folded') && s.step - from <= TURN_STEPS + 2, `the player's move let run out (${TURN_STEPS / 20} s): folded, the stake lost (${s.step - from} steps)`);
  // Nothing to do but call (the inmate's hand played out): the clock calls for them.
  talk(TALK.CHEAT, 0);
  const c = s.cheat!;
  Object.assign(c, { by: 1, theirs: [], last: [CARD.JOKER], turn: 0, due: s.step + 5 });
  const before = seen.length;
  for (let k = 0; k < 10 && s.cheat?.turn === 0; k++) step();
  check(seen.slice(before).some((e) => e.type === 'cheat' && e.what === 'called' && e.by === 0), 'only a call left them: the clock makes it');
  s.cheat = null;
  // A 2.5.0 replay: no clock.
  s.played = [];
  talk(TALK.CHEAT, 0);
  sim.rules250 = true;
  s.cheat!.due = s.step + 2;
  for (let k = 0; k < 100; k++) step();
  check(!!s.cheat && s.cheat.turn === 0, '(a 2.5.0 replay: the move waits, as it did, its clock long out)');
  sim.rules250 = false;
  s.cheat = null;
  // The lessons' prison: no clock (a beginner reads the lesson first).
  {
    const l = game(TRAINING);
    l.to(1, 18, 30);
    if (l.talkTo(0, yardTile(l.sim))) {
      l.sim.state.inmates[0].opinion = 60;
      l.sim.state.cash = 100;
      l.blind();
      l.talk(TALK.CHEAT, 0);
      for (let k = 0; k < TURN_STEPS * 2 && l.sim.state.cheat; k++) l.step();
      check(!!l.sim.state.cheat && l.sim.state.cheat.turn === 0 && !l.sim.state.cheat.due, 'the lessons\' prison: the move waits (no clock)');
    } else check(false, 'a game of Cheat in the lessons\' prison');
  }
  // Still at it at the evening roll call: settled on the chips there and then (the stake back when level).
  const bell = (chips: [number, number]) => {
    const g = game();
    g.to(1, 21, 58);
    g.talkTo(0, yardTile(g.sim));
    g.sim.state.inmates[0].opinion = 60;
    g.sim.state.cash = 100;
    g.blind();
    g.talk(TALK.CHEAT, 2);
    const ch = g.sim.state.cheat;
    if (!ch) return 'none';
    ch.chips = chips;
    // (A move made in time each go: the clock never runs out here.)
    while (g.sim.state.cheat && g.sim.state.step < at(1, 22, 1)) {
      if (g.sim.state.cheat.turn === 0) g.sim.state.cheat.due = 0;
      g.step();
    }
    const e = g.seen.filter((x) => x.type === 'cheat').at(-1) as Extract<SimEvent, { type: 'cheat' }>;
    return `${e.what} $${g.sim.state.cash}`;
  };
  const ahead = bell([2, 1]);
  const behind = bell([1, 2]);
  const level = bell([1, 1]);
  // (Never won at the bell: a player one chip up could stall to it for a sure profit.)
  check(ahead === 'off $100' && behind === 'lost $80' && level === 'off $100', `the roll call's bell: behind lost, ahead or level the stake back (${ahead}, ${behind}, ${level})`);
  console.log(`cheat's clock: ${TURN_STEPS} steps, then folded (or the call made); at the bell: ${ahead}, ${behind}, ${level}`);
}

// ------------------------------------------------------------------ Cheat: the inmate's ways, measured
{
  const fresh = (): Cheat => ({ who: 0, stake: 0, chips: [CHIPS, CHIPS], round: 0, table: CARD.KING, mine: [], theirs: [], turn: 0, at: 0, last: [], by: -1, pile: 0, tell: false, lead: 0, laid: 0, spent: 0 });
  // A claim its own cards prove false: always called.
  let proved = 0;
  for (let k = 0; k < 200; k++) {
    const c = fresh();
    c.table = CARD.QUEEN;
    c.theirs = [CARD.QUEEN, CARD.QUEEN, CARD.QUEEN, CARD.JOKER, CARD.ACE];
    c.mine = [CARD.ACE];
    c.last = [CARD.KING, CARD.ACE, CARD.KING];
    c.by = 0;
    c.pile = 3;
    c.turn = 1;
    if (decide(c, 77, k, 0).call) proved++;
  }
  check(proved === 200, 'three Queens claimed against its three Queens and a Joker (of six true): called every time');
  // And against the true cards it laid itself this round.
  let spentCalls = 0;
  for (let k = 0; k < 200; k++) {
    const c = fresh();
    c.table = CARD.ACE;
    c.theirs = [CARD.ACE, CARD.ACE];
    c.spent = 2;
    c.laid = 2;
    c.mine = [CARD.KING, CARD.QUEEN];
    c.last = [CARD.ACE, CARD.ACE, CARD.ACE];
    c.by = 0;
    c.pile = 5;
    if (decide(c, 79, k, 0).call) spentCalls++;
  }
  check(spentCalls === 200, 'three Aces claimed when it has two and laid two: called every time');
  // A hand played out: always called.
  let out = 0;
  for (let k = 0; k < 100; k++) {
    const c = fresh();
    c.theirs = [CARD.KING, CARD.ACE];
    c.mine = [];
    c.last = [CARD.KING];
    c.by = 0;
    c.pile = 1;
    if (decide(c, 78, k, 0).call) out++;
  }
  check(out === 100, 'the player\'s hand played out: called every time');
  // The tell's odds, over many plays at two Intellects.
  const tells: string[] = [];
  for (const int of [0, 80]) {
    let lies = 0;
    let lieTells = 0;
    let truths = 0;
    let truthTells = 0;
    for (let k = 0; k < 100000; k++) {
      const c = fresh();
      dealRound(c, 1234, k, 1);
      const d = decide(c, 99, k, int);
      if (d.call) continue;
      const lie = d.ks.some((j) => !isTrue(c.theirs[j], c.table));
      if (lie) {
        lies++;
        if (d.tell) lieTells++;
      } else {
        truths++;
        if (d.tell) truthTells++;
      }
    }
    const want = tellOdds(int);
    check(Math.abs((lieTells * 100) / lies - want) < 2 && Math.abs((truthTells * 100) / truths - FALSE_TELL) < 2, `Intellect ${int}: its tell on ${want}% of lies and ${FALSE_TELL}% of truths`);
    tells.push(`Int ${int}: tell on ${pct(lieTells, lies)} of ${lies} lies, ${pct(truthTells, truths)} of ${truths} truths`);
  }
  console.log(`cheat, the tell: ${tells.join('; ')}`);
  // Ways of playing, over many games (pure: deals, plays and calls as the game makes them).
  type Way = (c: Cheat, plays: number[]) => { call: true } | { ks: number[] };
  const ways: Record<string, Way> = {
    // Lays true cards when it has them (a bluff of one when not), never calls unless it must.
    trusting: (c) => (c.by === 1 && !c.theirs.length ? { call: true } : { ks: honest(c) }),
    // Calls whenever the tell shows; else as trusting.
    readsTells: (c) => (c.by === 1 && (c.tell || !c.theirs.length) ? { call: true } : { ks: honest(c) }),
    // Counts: calls the inmate's second play of a round when its first was two cards or fewer (it held no more true ones, once).
    counts: (c, plays) => (c.by === 1 && (!c.theirs.length || (plays.length >= 2 && plays[0] <= 2)) ? { call: true } : { ks: honest(c) }),
    // Calls every play of the inmate's.
    callsAll: (c) => (c.by === 1 ? { call: true } : { ks: honest(c) }),
    // Lays two cards whatever they are (bluffs freely), calls on the tell.
    bluffer: (c) => (c.by === 1 && (c.tell || !c.theirs.length) ? { call: true } : { ks: c.mine.length > 1 ? [0, 1] : [0] }),
  };
  function honest(c: Cheat): number[] {
    const ks = c.mine.map((card, k) => (isTrue(card, c.table) ? k : -1)).filter((k) => k >= 0).slice(0, 3);
    return ks.length ? ks : [0];
  }
  const rows: string[] = [];
  for (const [name, way] of Object.entries(ways)) {
    for (const int of [10, 80]) {
      let won = 0;
      const N = 2000;
      for (let gm = 0; gm < N; gm++) {
        const c = fresh();
        let step = gm * 100000;
        let plays: number[] = [];
        dealRound(c, 4242 + gm, step, 0);
        for (let guard = 0; guard < 400; guard++) {
          step += 1;
          if (c.turn === 2) {
            if (step < c.at) continue;
            c.round++;
            plays = [];
            dealRound(c, 4242 + gm, step, c.lead);
            continue;
          }
          if (c.turn === 1) {
            if (step < c.at) continue;
            const d = decide(c, 4242 + gm, step, int);
            if (d.call) {
              const r = callOn(c, 1, step);
              if (c.chips[r.loser] <= 0) break;
            } else {
              lay(c, 1, d.ks, d.tell, step);
              plays.push(d.ks.length);
            }
            continue;
          }
          const m = way(c, plays);
          if ('call' in m) {
            const r = callOn(c, 0, step);
            if (c.chips[r.loser] <= 0) break;
          } else lay(c, 0, m.ks, false, step);
        }
        if (c.chips[1] <= 0) won++;
      }
      rows.push(`${name} (Int ${int}) ${pct(won, N)}`);
      // (No simple way of playing wins much more than half: the stake is no money machine.)
      check(won / N < 0.62, `cheat: ${name} at Intellect ${int} wins ${pct(won, N)}, under 62%`);
    }
  }
  console.log(`cheat, ways of playing (games won of 2000): ${rows.join(', ')}`);
  check(CALL_MAX < 100, 'the inmate never calls for certain on doubt alone');
}

// ------------------------------------------------------------------ Hoops
{
  // The marker, and a window's numbers.
  check(powerAt(0) === 0 && powerAt(12) === 504 && powerAt(24) === 992 && powerAt(36) === 488 && powerAt(48) === 16, 'the power marker sweeps up and down');
  check(eighthOf(0, -5) === 0 && eighthOf(5, 0) === 2 && eighthOf(0, 5) === 4 && eighthOf(-5, 0) === 6 && eighthOf(5, -5) === 1 && eighthOf(-5, 5) === 5, 'directions in eighths');
  check(judge(600, 600, 60) === 'swish' && judge(640, 600, 60) === 'in' && judge(700, 600, 60) === 'rim' && judge(800, 600, 60) === 'air', 'a shot judged: swish, in, rim, airball');
  // Center Perks, a calm clear day, then a storm with a gale behind or against the top spot.
  const { sim, seen, step, to, talkTo, talk } = game(CENTER_PERKS, 5, [[0, 0, 0, -1, 0]]);
  const s = sim.state;
  const c = courtOf(sim)!;
  const win: [number, number] = [0, 0];
  const calm = c.spots.map((_, k) => {
    shotWindow(sim, k, win);
    return `${win[0]}±${win[1]}`;
  });
  check(shotWindow(sim, 2, win)[0] === NEED_BASE + Math.round((NEED_PER_TILE * spotDistance(c, 2)) / 10), 'the top spot needs its distance\'s power');
  const stormy = (wind: number) => {
    s.calendar = [[0, 0, 3, wind, 3]];
    shotWindow(sim, 2, win);
    return [win[0], win[1], windAlong(sim, c, 2)];
  };
  // The wind from straight behind the shot, and from straight ahead of it.
  const ways = [0, 1, 2, 3, 4, 5, 6, 7].map((w) => stormy(w));
  const behind = ways.reduce((a, b) => (b[2] > a[2] ? b : a));
  const against = ways.reduce((a, b) => (b[2] < a[2] ? b : a));
  s.calendar = [[0, 0, 0, -1, 0]];
  check(behind[2] > 0 && against[2] < 0 && behind[0] < against[0] && behind[1] < shotWindow(sim, 2, [0, 0])[1], `the wind: behind the shot needs less (${behind[0]}), against it more (${against[0]}); the rain narrows it (±${behind[1]})`);
  console.log(`hoops: center-perks windows (calm) ${calm.join(', ')}; a gale behind ${behind[0]}±${behind[1]}, against ${against[0]}±${against[1]}`);
  // A shot by commands, released at the best step.
  to(1, 10, 30);
  const spotTile = (k: number) => c.spots[k].z * MAP_W + c.spots[k].x;
  const shootAt = (k: number, aim: 'best' | 'worst') => {
    put(s.player, spotTile(k));
    step(command(0, OP.EXT, EXT.SHOOT, 0));
    const from = s.shot[0];
    shotWindow(sim, k, win);
    // The step to let go on: the best (or worst) the marker will be within a sweep.
    let pick = 1;
    for (let j = 1; j < 48; j++) {
      const d = Math.abs(powerAt(j) - win[0]);
      const best = Math.abs(powerAt(pick) - win[0]);
      if (aim === 'best' ? d < best : d > best) pick = j;
    }
    while (s.step + 1 - from < pick) step();
    step(command(0, OP.EXT, EXT.SHOOT, 1));
    return (seen.filter((e) => e.type === 'hoopShot').at(-1) as Extract<SimEvent, { type: 'hoopShot' }>).result;
  };
  const spd = s.spd;
  const shots = [shootAt(0, 'best'), shootAt(2, 'worst')];
  check(shots[0] === 'swish' && shots[1] === 'air', `the marker on the mark: a swish; nowhere near: an airball (${shots.join(', ')})`);
  // Practice: PRACTICE_MAKES baskets in a day, a point of Speed once.
  for (let k = 1; k < PRACTICE_MAKES + 2; k++) shootAt(k % SHOOT_SPOTS, 'best');
  check(s.spd === spd + 1, `${PRACTICE_MAKES} baskets on one's own: +1 Speed, once a day`);
  // In a lockdown, no shots (the yard's shut).
  put(s.player, spotTile(0));
  s.lockdown = true;
  step(command(0, OP.EXT, EXT.SHOOT, 0), false);
  check(!s.shot.length, 'in a lockdown: no shot');
  s.lockdown = false;
  // A step with the ball up puts it down.
  put(s.player, spotTile(1));
  step(command(0, OP.EXT, EXT.SHOOT, 0));
  step(command(1));
  check(!s.shot.length, 'a step puts the ball down');
  // A shootout: refused away from the court, then on.
  // (The far side of the yard from the rim, and somewhere well off the court.)
  const r0 = rimOf(c);
  const away = (min: number, max = 99) => {
    for (let i = MAP_W; i < MAP_W * 63; i++) {
      const x = i % MAP_W;
      const z = Math.floor(i / MAP_W);
      const d = Math.max(Math.abs(x * UNIT + UNIT / 2 - r0.x), Math.abs(z * UNIT + UNIT / 2 - r0.z)) / UNIT;
      if (d > min && d < max && !sim.world.blocked(x, z) && !sim.world.blocked(x + 1, z) && sim.world.zoneAt(x, z) !== 'outside' && sim.world.zoneAt(x, z) !== 'perimeter') return i;
    }
    return -1;
  };
  const far = away(COURT_RANGE + 0.5, COURT_LEAVE - 1);
  check(talkTo(0, far), 'talking away from the court');
  s.inmates[0].opinion = 60;
  talk(TALK.HOOPS);
  check(refusals(seen).at(-1) === 'noCourt' && !s.shootout, 'not at the court: no shootout');
  check(talkTo(0, spotTile(1) - 1), 'talking at the court');
  talk(TALK.HOOPS);
  check(!!s.shootout && playedToday(s, 0) === 1, 'a shootout on: one of the day\'s games');
  const opinion = s.inmates[0].opinion;
  let guard = 0;
  while (s.shootout && guard++ < 3000) {
    const o = s.shootout;
    if (o.turn === 0) shootAt(o.k % SHOOT_SPOTS, 'best');
    else step();
  }
  const end = seen.filter((e) => e.type === 'hoops' && e.what !== 'start').at(-1) as Extract<SimEvent, { type: 'hoops' }>;
  const theirs = seen.filter((e) => e.type === 'hoopShot' && e.by === 0).length;
  check(end?.what === 'won' && s.inmates[0].opinion >= opinion + WIN_OPINION - 1 && theirs >= SHOOT_SPOTS, `every shot a swish: won ${end?.mine}–${end?.theirs} (+${WIN_OPINION}, +1 Speed)`);
  // The court left: off.
  check(talkTo(0, spotTile(1) - 1), 'talking at the court again');
  talk(TALK.HOOPS);
  put(s.player, away(COURT_LEAVE + 1));
  step();
  check(!s.shootout && seen.some((e) => e.type === 'hoops' && e.what === 'off'), 'walked off the court: the shootout off');
  // 2.5.1: the shot clock. Left standing on their turn, the player's shot is an airball and the inmate shoots.
  s.played = [];
  check(talkTo(0, spotTile(1) - 1), 'a shootout once more');
  talk(TALK.HOOPS);
  const clockFrom = s.step;
  const airs = () => seen.filter((e) => e.type === 'hoopShot' && e.by === -1 && e.result === 'air').length;
  const air0 = airs();
  while (s.shootout && s.shootout.turn === 0 && s.step - clockFrom < SHOT_CLOCK * 2) step();
  check(!!s.shootout && s.shootout.turn === 1 && airs() === air0 + 1 && s.step - clockFrom <= SHOT_CLOCK + 2, `no shot in ${SHOT_CLOCK / 20} s: an airball, the inmate's shot (${s.step - clockFrom} steps)`);
  let n = 0;
  while (s.shootout && n++ < (SHOT_CLOCK + 60) * 12) step();
  check(!s.shootout, 'stood still on the spot: the shootout plays itself out');
  // The roll call's bell ends it.
  s.played = [];
  const day = Math.floor(s.step / DAY_STEPS) + 1;
  s.step = at(day, 21, 58);
  s.attended = s.excused = true;
  check(talkTo(0, spotTile(1) - 1), 'and once more, late in the evening');
  talk(TALK.HOOPS);
  check(!!s.shootout, 'a shootout at 21:58');
  while (s.shootout && s.step < at(day, 22, 0) + 1) {
    if (s.shootout.turn === 0) s.shootout.due = 0;
    step();
  }
  const last = seen.filter((e) => e.type === 'hoops').at(-1) as Extract<SimEvent, { type: 'hoops' }> | undefined;
  check(!s.shootout && last?.what === 'off' && ROUTINE[s.routine].id === 'eveningRollCall', 'the roll call\'s bell: off');
  console.log(`hoops: a swish on the mark, an airball off it; practice +1 Speed at ${PRACTICE_MAKES}; a shootout won ${end?.mine}–${end?.theirs}; off the court, off`);
  // Sports day: a shootout won counts as a bout won.
  const sd = game(CENTER_PERKS, 6, [[0, DAY_EVENTS.indexOf('sports'), 0]]);
  sd.to(2, 10, 30);
  const s2 = sd.sim.state;
  const c2 = courtOf(sd.sim)!;
  for (let g = 0; g < SPORTS_WINS; g++) {
    sd.talkTo(g, c2.spots[1].z * MAP_W + c2.spots[1].x - 1);
    s2.inmates[g].opinion = 60;
    sd.talk(TALK.HOOPS);
    let n = 0;
    while (s2.shootout && n++ < 3000) {
      const o = s2.shootout;
      if (o.turn === 0) {
        const k = o.k % SHOOT_SPOTS;
        put(s2.player, c2.spots[k].z * MAP_W + c2.spots[k].x);
        sd.step(command(0, OP.EXT, EXT.SHOOT, 0));
        const from = s2.shot[0];
        shotWindow(sd.sim, k, win);
        let pick = 1;
        for (let j = 1; j < 48; j++) if (Math.abs(powerAt(j) - win[0]) < Math.abs(powerAt(pick) - win[0])) pick = j;
        while (s2.step + 1 - from < pick) sd.step();
        sd.step(command(0, OP.EXT, EXT.SHOOT, 1));
      } else sd.step();
    }
  }
  check(sd.seen.some((e) => e.type === 'today' && e.event === 'sports' && e.phase === 'prize'), 'sports day: three shootouts won earn the prize');
}

// ------------------------------------------------------------------ Checkers
{
  const b = newBoard();
  check(stepsOf(b.sq, 0).length === 7 && stepsOf(b.sq, 1).length === 7, 'the opening: seven moves each');
  // A capture is forced, and goes on.
  const sq = new Array(32).fill(PIECE.EMPTY);
  const at2 = (r: number, c: number, p: number) => (sq[squareAt(r, c)] = p);
  at2(6, 1, PIECE.MAN);
  at2(5, 2, PIECE.HIS_MAN);
  at2(3, 4, PIECE.HIS_MAN);
  at2(6, 5, PIECE.MAN);
  const first = stepsOf(sq, 0);
  check(first.length === 1 && first[0].from === squareAt(6, 1) && first[0].to === squareAt(4, 3) && first[0].cap === squareAt(5, 2), 'a capture there is: the only move');
  const more = stepsOf(sq.map((p, i) => (i === squareAt(6, 1) || i === squareAt(5, 2) ? 0 : i === squareAt(4, 3) ? PIECE.MAN : p)), 0, squareAt(4, 3));
  check(more.length === 1 && more[0].to === squareAt(2, 5), 'the jump goes on from where it landed');
  // His search: the same move every time, a capture taken.
  const his = new Array(32).fill(PIECE.EMPTY);
  his[squareAt(2, 3)] = PIECE.HIS_MAN;
  his[squareAt(3, 4)] = PIECE.MAN;
  his[squareAt(7, 0)] = PIECE.MAN;
  his[squareAt(0, 1)] = PIECE.HIS_MAN;
  const mv = elderMove(his, 9, 0, 0, 4);
  check(!!mv && mv[0].cap === squareAt(3, 4) && JSON.stringify(elderMove(his, 9, 0, 0, 4)) === JSON.stringify(mv), 'he takes the capture, the same way every time');
  // Quick enough at every depth (from the opening and a busy middle game).
  for (let lv = 0; lv < ELDER_DEPTH.length; lv++) {
    const t0 = performance.now();
    elderMove(newBoard().sq, 3, 0, 1, lv);
    const ms = performance.now() - t0;
    check(ms < 400, `depth ${ELDER_DEPTH[lv]}: a move in ${ms.toFixed(0)} ms`);
  }
  // How he fares against a player moving at random, at each level.
  const fares: string[] = [];
  for (const lv of [0, 2, 4]) {
    let w = 0;
    let l = 0;
    let d = 0;
    for (let g = 0; g < 12; g++) {
      const board = newBoard().sq;
      let side = 0;
      let quiet = 0;
      let result = 0;
      for (let ply = 0; ply < 300 && !result; ply++) {
        if (side === 0) {
          const opts = stepsOf(board, 0);
          if (!opts.length) {
            result = 2;
            break;
          }
          let st = opts[(g * 31 + ply * 7) % opts.length];
          let capped = false;
          for (;;) {
            const p = board[st.from];
            board[st.from] = 0;
            if (st.cap >= 0) {
              board[st.cap] = 0;
              capped = true;
            }
            const crown = p === PIECE.MAN && st.to < 4;
            board[st.to] = crown ? PIECE.KING : p;
            if (st.cap < 0 || crown) break;
            const nx = stepsOf(board, 0, st.to);
            if (!nx.length) break;
            st = nx[0];
          }
          quiet = capped ? 0 : quiet + 1;
        } else {
          const m = elderMove(board, 11, g, ply, lv);
          if (!m) {
            result = 1;
            break;
          }
          let capped = false;
          for (const st of m) {
            const p = board[st.from];
            board[st.from] = 0;
            if (st.cap >= 0) {
              board[st.cap] = 0;
              capped = true;
            }
            board[st.to] = p === PIECE.HIS_MAN && st.to >= 28 ? PIECE.HIS_KING : p;
          }
          quiet = capped ? 0 : quiet + 1;
        }
        side = 1 - side;
        if (quiet >= DRAW_PLIES) result = 3;
      }
      if (result === 1) w++;
      else if (result === 2) l++;
      else d++;
    }
    fares.push(`level ${lv}: the random player won ${w}, lost ${l}, drew ${d}`);
    check(lv === 0 || l >= 10, `level ${lv}: he beats a player moving at random`);
  }
  console.log(`checkers: rules (forced captures, jumps that go on); his move the same every time; ${fares.join('; ')}`);
  // In the game: the old-timer, the board, a step, his answer, getting up, resigning.
  const { sim, seen, step, to, talkTo, talk } = game(CENTER_PERKS, 8);
  const s = sim.state;
  const elder = elderOf(sim);
  to(1, 10, 30);
  check(talkTo(elder, yardTile(sim)), 'talking to the old-timer');
  s.inmates[elder].opinion = ELDER_OPINION - 1;
  talk(TALK.CHECKERS, 1);
  check(refusals(seen).at(-1) === 'elderOpinion' && !s.board, `he plays from opinion ${ELDER_OPINION}`);
  s.inmates[elder].opinion = ELDER_OPINION;
  talk(TALK.CHECKERS, 1);
  check(!!s.board && s.board.seated && s.board.turn === 0 && playedToday(s, elder) === 0, 'the board set up (not one of the day\'s games)');
  const opening = stepsOf(s.board!.sq, 0)[0];
  talk(TALK.MOVE, opening.from, opening.to + 1);
  check(s.board!.turn === 0, 'a step that isn\'t a move: refused');
  talk(TALK.MOVE, opening.from, opening.to);
  check(s.board!.turn === 1 && s.board!.sq[opening.to] === PIECE.MAN, 'a move made: his turn');
  let n = 0;
  while (s.board!.turn === 1 && n++ < 200) step();
  check(s.board!.turn === 0 && n >= 20 && n <= 61, `he answers after thinking (${(n / 20).toFixed(1)} s)`);
  talk(TALK.CHECKERS, 0);
  check(!!s.board && !s.board.seated, 'up from the board: it stays set up');
  const kept = s.board!.sq.join('');
  talk(TALK.CHECKERS, 1);
  check(s.board!.sq.join('') === kept && s.board!.seated, 'back to it: the game as it was');
  const int = s.items.int;
  talk(TALK.CHECKERS, 2);
  const op0 = s.inmates[elder].opinion;
  check(s.board!.over === 2 && s.elder[1] === 1 && s.items.int === int, 'resigned: lost, and nothing for it (no Intellect)');
  for (let k = 0; k < 10; k++) {
    talk(TALK.CHECKERS, 1);
    talk(TALK.CHECKERS, 2);
  }
  check(s.items.int === int && s.inmates[elder].opinion === op0 && s.elder[1] === 11, 'resigning over and over: no opinion, no Intellect to farm');
  // A win: set up a board he's lost, one move from the end.
  talk(TALK.CHECKERS, 1);
  const bd = s.board!;
  bd.sq.fill(PIECE.EMPTY);
  bd.sq[squareAt(5, 2)] = PIECE.MAN;
  bd.sq[squareAt(4, 3)] = PIECE.HIS_MAN;
  bd.turn = 0;
  const op = s.inmates[elder].opinion;
  talk(TALK.MOVE, squareAt(5, 2), squareAt(3, 4));
  check(bd.over === 1 && s.elder[0] === 1 && s.items.int === int + 1 && s.inmates[elder].opinion > op, 'his last man taken: won (+1 Intellect, his respect, his level up)');
  const won = seen.some((e) => e.type === 'checkers' && e.what === 'won');
  check(won, 'the win announced (the play layer\'s secret)');
  console.log('checkers in the game: the board set up, a move, his answer, kept between times, resigned, won');
}

// ------------------------------------------------------------------ saves
{
  const twin = (a: Sim, cmds: number[]) => {
    const b = new Sim(CENTER_PERKS, 1);
    b.restore(JSON.parse(JSON.stringify(a.snapshot())));
    for (const c of cmds) {
      a.step(c);
      b.step(c);
      a.state.heat = b.state.heat = 0;
    }
    return a.hash() === b.hash();
  };
  const { sim, to, talkTo, talk, blind } = game(CENTER_PERKS, 21);
  const s = sim.state;
  to(1, 10, 30);
  talkTo(0, yardTile(sim));
  s.inmates[0].opinion = 70;
  s.cash = 50;
  blind();
  talk(TALK.CHEAT, 1);
  check(!!s.cheat && twin(sim, [command(0, OP.TALK, TALK.PLAY, 1), ...Array.from({ length: 50 }, () => 0), command(0, OP.TALK, TALK.LIAR), ...Array.from({ length: REVEAL_STEPS + 40 }, () => 0)]), 'saved mid-hand of Cheat: the same hand');
  // The shootout and the board.
  const c = courtOf(sim)!;
  s.cheat = null;
  s.played = [];
  talkTo(1, c.spots[1].z * MAP_W + c.spots[1].x - 1);
  s.inmates[1].opinion = 70;
  talk(TALK.HOOPS);
  put(s.player, c.spots[0].z * MAP_W + c.spots[0].x);
  check(!!s.shootout && twin(sim, [command(0, OP.EXT, EXT.SHOOT, 0), 0, 0, 0, 0, 0, 0, 0, 0, 0, command(0, OP.EXT, EXT.SHOOT, 1), ...Array.from({ length: 60 }, () => 0)]), 'saved mid-shootout: the same shootout');
  const elder = elderOf(sim);
  // (Away from the others: talking goes to whoever's nearest.)
  for (const m of s.inmates) put(m.body, yardTile(sim) + 2 * MAP_W);
  check(talkTo(elder, yardTile(sim)), 'talking to the old-timer');
  talk(TALK.CHECKERS, 1);
  const st = stepsOf(s.board!.sq, 0)[2];
  check(!!s.board && twin(sim, [command(0, OP.TALK, TALK.MOVE, st.from, st.to), ...Array.from({ length: 80 }, () => 0)]), 'saved at the board: the same game');
  // Damaged ones dropped.
  const bad = sim.snapshot();
  Object.assign(bad.state, { cheat: { who: 99 }, shootout: { who: -4 }, shot: [1, 99], practice: 'x', board: { sq: [9] }, elder: [1] });
  const fixed = new Sim(CENTER_PERKS, 1);
  fixed.restore(bad);
  for (let k = 0; k < 20; k++) fixed.step(0);
  check(!fixed.state.cheat && !fixed.state.shootout && !fixed.state.shot.length && fixed.state.practice === 0 && !fixed.state.board && fixed.state.elder.join() === '0,0,0,0', 'a damaged save: the broken games are gone');
  // A save from before P27: none of it.
  const old = sim.snapshot();
  const o = old.state as unknown as Record<string, unknown>;
  for (const k of ['cheat', 'shootout', 'shot', 'practice', 'board', 'elder']) delete o[k];
  const loaded = new Sim(CENTER_PERKS, 1);
  loaded.restore(old);
  check(loaded.state.cheat === null && loaded.state.board === null && loaded.state.elder.length === 4, 'a save from before P27: no games under way');
  console.log(`saves: a hand of Cheat, a shootout and the board carry on; damaged ones dropped; old saves load`);
}
