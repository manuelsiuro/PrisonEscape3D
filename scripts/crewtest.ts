/**
 * Crew & specialists (P23), rule by rule:
 * - the data: every inmate has a line of work, every campaign prison has each line at least once;
 * - orders: only to a follower, only in his line (tonight's the night: anyone at 90);
 * - keep watch: he stands at his post wherever the player goes, whistles exactly when an awake
 *   guard comes within 6 tiles he can see (once per coming), and is whistled back;
 * - dig with me: ground-floor digging and chipping ×1.5 with him at the player's side, the dirt and
 *   rubble his; down a tunnel he waits beside the shaft, tunnel digging ×1.25, the dirt his;
 * - watch my back: his blows ×1.5; an ambush drawn is stopped (the RNG drawn the same);
 * - start a brawl: once a day, with the nearest inmate in reach, the two nearest guards sent to
 *   look for a minute, over after a minute; never in a lockdown, never with nobody to fight;
 * - fetch the drop: he picks it up (the guards can't seize it then), brings it to the pockets
 *   when there's room; gone before he gets there, or too far, he gives up;
 * - tonight's the night: on through Lights Out (outside the player's cell while they're in it,
 *   so its door still locks), to bed at 06:00; the others go to bed at Lights Out;
 * - the crew escape: those within 4 tiles get out too, never through a hole or in a vehicle;
 * - saves: every order carries on the same; damaged ones are dropped; dismissing, a blow from the
 *   player, a capture end them.
 */
import { BRAWL_GUARDS, BRAWL_RANGE, BRAWL_STEPS, CREW_ESCAPE_REACH, DIG_HELP, NIGHT_OPINION, SHAFT_HELP, SPECIALITIES, WATCH_RANGE } from '../src/content/crew';
import { itemDef, itemNumber } from '../src/content/items';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { ROUTINE } from '../src/content/routine';
import { placesOf } from '../src/sim/ai/places';
import { lineOfSight } from '../src/sim/ai/sight';
import { command, EXT, OP, ORDER, TALK } from '../src/sim/command';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { DAY_STEPS } from '../src/sim/systems/clock';
import { allyDamage, backedBy, brawlWith, cantOrder, carryingOf, crewEscape, crewEntry, orderOf, postOf, shaftOf, specialityOf } from '../src/sim/systems/crew';
import { damage, INMATE_DEFENSE } from '../src/sim/systems/combat';
import { awake, GUARD } from '../src/sim/systems/guards';
import { DOING } from '../src/sim/systems/inmates';
import { itemOf, slot } from '../src/sim/systems/items';
import { FEAT } from '../src/sim/systems/ledger';
import { grudges } from '../src/sim/systems/social';
import { toolTarget } from '../src/sim/systems/structure';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { TILE } from '../src/sim/world/tiles';
import { LAYER, MAP_H, MAP_W, placeKey } from '../src/sim/world/World';
import { check } from './assert';

const n = (id: string) => itemNumber(id);
/** A step count at a time: game day (from 1), hour, minute (days start at 08:00). */
const at = (day: number, hour: number, minute = 0) => (day - 1) * DAY_STEPS + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
const put = (b: { x: number; z: number }, t: number) => {
  b.x = (t % MAP_W) * UNIT + UNIT / 2;
  b.z = Math.floor(t / MAP_W) * UNIT + UNIT / 2;
};
const tileOf = (b: { x: number; z: number }) => Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);
const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const refusals = (seen: SimEvent[]) => seen.filter((e) => e.type === 'refused').map((e) => (e as { why: string }).why);
const crewNews = (seen: SimEvent[], what: string) => seen.filter((e) => e.type === 'crew' && e.what === what) as Array<Extract<SimEvent, { type: 'crew' }>>;

/** Center Perks' inmates by line of work (inmate index): the first of each. */
const CP = { digger: 0, muscle: 1, lookout: 2, smuggler: 4, digger2: 3, muscle2: 5, lookout2: 6 };

/** A game kept calm (heat and lockdowns cleared each step unless asked), every day quiet. */
function game(seed = 5) {
  const sim = new Sim(CENTER_PERKS, seed);
  sim.state.calendar = [[0, 0, 0]];
  const seen: SimEvent[] = [];
  const step = (cmd = 0, calm = true) => {
    sim.step(cmd);
    seen.push(...sim.events);
    if (calm) {
      sim.state.heat = 0;
      if (sim.state.lockdown) sim.state.lockdown = false;
    }
  };
  const steps = (k: number, cmd = 0) => {
    for (let i = 0; i < k && !sim.state.escaped; i++) step(cmd);
  };
  const to = (day: number, hour: number, minute = 0) => {
    const target = at(day, hour, minute);
    while (sim.state.step < target && !sim.state.escaped) step();
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
  /** Recruited (opinion as given), the talk still open. */
  const recruit = (who: number, opinion = 85, spot = yardSpot(sim)) => {
    sim.state.inmates[who].opinion = opinion;
    talkTo(who, spot);
    talk(TALK.RECRUIT);
    return sim.state.followers.includes(who);
  };
  const order = (who: number, o: number) => {
    if (sim.state.talk !== who) {
      const m = sim.state.inmates[who];
      const t = tileOf(m.body);
      put(sim.state.player, sim.world.blocked((t % MAP_W) + 1, Math.floor(t / MAP_W)) ? t - 1 : t + 1);
      sim.state.player.facing = sim.world.blocked((t % MAP_W) + 1, Math.floor(t / MAP_W)) ? 1 : 9;
      step(command(0, OP.INTERACT));
    }
    talk(TALK.CREW, o);
  };
  return { sim, seen, step, steps, to, talkTo, talk, recruit, order };
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

/** Everyone but a few kept out of the way (in their beds' corners): inmates in their own cells, guards parked on a tile far off. */
function clearOut(sim: Sim, keep: number[] = []) {
  const p = placesOf(sim.world);
  sim.state.inmates.forEach((m, k) => {
    if (keep.includes(k)) return;
    put(m.body, p.bedside[m.cell]);
    m.goal = -1;
    m.path = [];
    m.wait = 100000;
  });
}

// ------------------------------------------------------------------ the data
{
  for (const def of PRISONS) {
    check(def.crew.length === def.names.length, `${def.id}: a line of work for every inmate (${def.crew.length} of ${def.names.length})`);
    if (def.id !== 'training') for (const sp of SPECIALITIES) check(def.crew.includes(sp), `${def.id}: has a ${sp}`);
  }
  const sim = new Sim(CENTER_PERKS, 1);
  check(sim.state.inmates.map((m, k) => specialityOf(sim.world, k, m.cell)).join(',') === CENTER_PERKS.crew.join(','), 'an inmate\'s line of work is its cell\'s');
  check(BRAWL_STEPS === 60 * 20 && WATCH_RANGE === 6 && DIG_HELP === 6 && SHAFT_HELP === 5 && NIGHT_OPINION === 90 && CREW_ESCAPE_REACH === 4, 'the numbers the help says: a minute\'s brawl, 6 tiles, ×1.5 and ×1.25, 90, 4 tiles');
  console.log(`data: ${PRISONS.map((d) => `${d.id} ${SPECIALITIES.map((sp) => d.crew.filter((c) => c === sp).length).join('/')}`).join('; ')}`);
}

// ------------------------------------------------------------------ orders
{
  const g = game();
  const { sim, seen } = g;
  g.to(1, 9, 5);
  g.talkTo(CP.lookout);
  g.talk(TALK.CREW, ORDER.WATCH);
  check(!crewEntry(sim.state, CP.lookout) && refusals(seen).includes('opinion'), 'no orders to someone not following');
  check(g.recruit(CP.lookout), 'a lookout recruited');
  g.talk(TALK.CREW, ORDER.DIG);
  g.talk(TALK.CREW, ORDER.BACK);
  g.talk(TALK.CREW, ORDER.FETCH);
  check(orderOf(sim.state, CP.lookout) === ORDER.FOLLOW && refusals(seen).filter((r) => r === 'notHisLine').length === 3, 'orders out of his line refused');
  g.talk(TALK.CREW, ORDER.NIGHT);
  check(refusals(seen).at(-1) === 'nightOpinion' && !crewEntry(sim.state, CP.lookout), `tonight's the night needs ${NIGHT_OPINION}`);
  g.talk(TALK.CREW, ORDER.WATCH);
  const post = tileOf(sim.state.inmates[CP.lookout].body);
  check(postOf(sim.state, CP.lookout) === post && crewNews(seen, 'order').at(-1)?.order === ORDER.WATCH, 'posted where he stands');
  check(sim.state.feats[FEAT.crewOrders] === 1, 'the order counted');
  g.talk(TALK.DISMISS);
  check(!crewEntry(sim.state, CP.lookout) && !sim.state.followers.length, 'dismissed: the order goes with him');
}

// ------------------------------------------------------------------ keep watch
{
  const g = game(7);
  const { sim, seen } = g;
  g.to(1, 9, 5);
  g.recruit(CP.lookout);
  g.talk(TALK.CREW, ORDER.WATCH);
  const post = postOf(sim.state, CP.lookout);
  g.step(command(0, OP.CLOSE));
  // The player off somewhere else (the canteen): he stays at his post.
  const far = placesOf(sim.world).bedside[1];
  put(sim.state.player, far);
  g.steps(200);
  const m = sim.state.inmates[CP.lookout];
  check(tileOf(m.body) === post && m.doing === DOING.LOOKOUT && sim.state.followers.includes(CP.lookout), 'on watch at his post with the player away, looking out');
  // Every whistle, over a stretch of the guards' rounds, is a guard newly within range in his sight, and every such guard gets one.
  let whistles = 0;
  let missed = 0;
  let wrong = 0;
  let inRange = 0;
  for (let k = 0; k < 6000; k++) {
    const before = seen.length;
    g.step();
    const fresh = seen.slice(before).filter((e) => e.type === 'crew' && e.what === 'whistle') as Array<Extract<SimEvent, { type: 'crew' }>>;
    let now = 0;
    sim.state.guards.forEach((gd, j) => {
      const dx = gd.body.x - m.body.x;
      const dz = gd.body.z - m.body.z;
      if (awake(gd) && dx * dx + dz * dz <= (WATCH_RANGE * UNIT) ** 2 && lineOfSight(sim.world, m.body.x, m.body.z, gd.body.x, gd.body.z)) now |= 1 << j;
    });
    const due = now & ~inRange;
    inRange = now;
    for (const e of fresh) if (!(due & (1 << e.guard!))) wrong++;
    for (let j = 0; j < sim.state.guards.length; j++) if (due & (1 << j) && !fresh.some((e) => e.guard === j)) missed++;
    whistles += fresh.length;
  }
  check(whistles > 0 && !wrong && !missed, `a whistle exactly when a guard comes within ${WATCH_RANGE} tiles in sight (${whistles} in 5 minutes)`);
  check(sim.state.feats[FEAT.whistles] === whistles + (crewNews(seen, 'whistle').length - whistles), 'whistles counted');
  // A guard placed right by him, then behind a wall: a whistle, then none.
  const gd = sim.state.guards[0];
  const beside = post + 2;
  if (!sim.world.blocked((beside % MAP_W), Math.floor(beside / MAP_W))) {
    const was = crewNews(seen, 'whistle').length;
    for (const o of sim.state.guards) put(o.body, placesOf(sim.world).bedside[1]);
    g.step();
    put(gd.body, beside);
    gd.path = [];
    gd.wait = 50;
    g.step();
    check(crewNews(seen, 'whistle').length === was + 1 && crewNews(seen, 'whistle').at(-1)!.guard === 0, 'a guard come close: a whistle');
    g.steps(3);
    check(crewNews(seen, 'whistle').length === was + 1, 'once for each coming (still there: no more)');
  }
  // Whistled back from far away.
  g.step(command(0, OP.EXT, EXT.RECALL, CP.lookout));
  check(!crewEntry(sim.state, CP.lookout) && crewNews(seen, 'recalled').length === 1, 'whistled back: at the player\'s heels again');
  put(sim.state.player, yardSpot(sim, 2));
  g.steps(400);
  check(cheb(m.body, sim.state.player) <= 2 * UNIT, 'and back with the player');
}

// ------------------------------------------------------------------ dig with me
/** A floor tile with a wall to the east the pick can chip (inside, not a cell's). */
function chipSpot(sim: Sim): number {
  const w = sim.world;
  const pick = n('sturdy_pickaxe');
  for (let i = MAP_W * 3; i < MAP_W * (MAP_H - 3); i++) {
    const x = i % MAP_W;
    if (x < 3 || x > MAP_W - 4 || w.blocked(x, Math.floor(i / MAP_W)) || w.zoneAt(x, Math.floor(i / MAP_W)) !== 'corridor' || w.blocked(x - 1, Math.floor(i / MAP_W))) continue;
    const b = { x: x * UNIT + UNIT / 2, z: Math.floor(i / MAP_W) * UNIT + UNIT / 2, facing: 1, moving: false };
    const t = toolTarget(w, LAYER.GROUND, b, pick, [], [slot(pick)]);
    if (t?.action === 'chip' && t.fits && t.hp > 0) return i;
  }
  return -1;
}
{
  const g = game(11);
  const { sim, seen } = g;
  g.to(1, 9, 5);
  check(g.recruit(CP.digger), 'a digger recruited');
  g.talk(TALK.CREW, ORDER.DIG);
  g.step(command(0, OP.CLOSE));
  check(orderOf(sim.state, CP.digger) === ORDER.DIG, 'digging with the player');
  const spot = chipSpot(sim);
  const it = sim.state.items;
  it.inv[0] = slot(n('sturdy_pickaxe'));
  it.hand = 0;
  const strikeOnce = () => {
    sim.state.struckAt = -1000;
    sim.state.energy = 100;
    g.step(command(0, OP.USE, 1));
  };
  put(sim.state.player, spot);
  sim.state.player.facing = 1;
  const m = sim.state.inmates[CP.digger];
  put(m.body, spot - 1);
  m.path = [];
  strikeOnce();
  const key = placeKey(LAYER.GROUND, spot + 1);
  const dmg = itemDef(n('sturdy_pickaxe')).tool!.damage;
  check(sim.state.wear[key] === Math.floor((dmg * DIG_HELP) / 4), `a chip with him at hand: ${Math.floor((dmg * DIG_HELP) / 4)} (not ${dmg})`);
  for (let k = 0; k < 10 && sim.world.ground.kind[spot + 1] !== TILE.HOLE; k++) {
    put(m.body, spot - 1);
    strikeOnce();
  }
  check(sim.world.ground.kind[spot + 1] === TILE.HOLE && !it.inv.some((v) => itemOf(v) === n('wall_chunk')) && crewNews(seen, 'dirt').at(-1)?.item === n('wall_chunk'), 'the wall through: the rubble his, not the player\'s');
  // Too far off: no help (a twin game, the digger left behind).
  const h = game(11);
  h.to(1, 9, 5);
  h.recruit(CP.digger);
  h.talk(TALK.CREW, ORDER.DIG);
  h.step(command(0, OP.CLOSE));
  h.sim.state.items.inv[0] = slot(n('sturdy_pickaxe'));
  h.sim.state.items.hand = 0;
  put(h.sim.state.player, spot);
  h.sim.state.player.facing = 1;
  put(h.sim.state.inmates[CP.digger].body, placesOf(h.sim.world).bedside[1]);
  h.sim.state.struckAt = -1000;
  h.step(command(0, OP.USE, 1));
  check(h.sim.state.wear[key] === dmg, 'the digger too far away: no help');

  // Down a tunnel: dug in the yard, he waits beside the shaft, the tunnel dug a quarter faster, the dirt his.
  const y = yardSpot(sim, 1);
  it.inv[0] = slot(n('sturdy_shovel'));
  put(sim.state.player, y);
  sim.state.player.facing = 1;
  put(m.body, y - 1);
  let k = 0;
  for (; k < 10 && sim.world.ground.kind[y + 1] !== TILE.SHAFT; k++) {
    put(m.body, y - 1);
    strikeOnce();
  }
  check(sim.world.ground.kind[y + 1] === TILE.SHAFT && !it.inv.some((v) => itemOf(v) === n('dirt')), 'a shaft dug with his help: the dirt his');
  g.step(command(0, OP.INTERACT));
  check(sim.state.layer === LAYER.UNDER && shaftOf(sim.state, CP.digger) === y + 1, 'down the hole: he knows where');
  g.steps(60);
  check(cheb(m.body, { x: ((y + 1) % MAP_W) * UNIT + UNIT / 2, z: Math.floor((y + 1) / MAP_W) * UNIT + UNIT / 2 }) <= 1.5 * UNIT && sim.world.ground.kind[tileOf(m.body)] !== TILE.SHAFT, 'waiting beside the shaft (never in it)');
  sim.state.player.facing = 1;
  strikeOnce();
  const under = placeKey(LAYER.UNDER, y + 2);
  const sd = itemDef(n('sturdy_shovel')).tool!.damage;
  const soil = Math.floor((sd * SHAFT_HELP) / 4);
  check((sim.state.wear[under] ?? 0) === soil || sim.world.layers[LAYER.UNDER].kind[y + 2] === TILE.TUNNEL, `tunnel digging with him up top: ${soil} a blow (not ${sd})`);
  check(sim.world.layers[LAYER.UNDER].kind[y + 2] === TILE.TUNNEL && !it.inv.some((v) => itemOf(v) === n('dirt')), 'through in one blow, the dirt handed up');
  // Back up: at the player's side again.
  sim.state.player.facing = 9;
  put(sim.state.player, y + 1);
  g.step(command(0, OP.INTERACT));
  check(sim.state.layer === LAYER.GROUND && shaftOf(sim.state, CP.digger) === -1, 'back up: by the player\'s side again');
  console.log(`dig: a sturdy pick ${dmg} → ${Math.floor((dmg * DIG_HELP) / 4)} with a digger, a sturdy shovel underground ${sd} → ${soil}; dirt taken ${sim.state.feats[FEAT.dirtTaken]}`);
}

// ------------------------------------------------------------------ watch my back
{
  check(allyDamage({ crew: [[1, ORDER.BACK, -1, -1, 0]] }, 1, 21) === 31 && allyDamage({ crew: [] }, 1, 21) === 21, 'his blows ×1.5 (rounded down)');
  // A blow at someone coming for the player: the same fight, twice, with and without the order.
  const run = (back: boolean) => {
    const g = game(13);
    g.to(1, 9, 5);
    g.recruit(CP.muscle);
    if (back) g.talk(TALK.CREW, ORDER.BACK);
    g.step(command(0, OP.CLOSE));
    const foe = CP.digger;
    const f = g.sim.state.inmates[foe];
    put(f.body, tileOf(g.sim.state.player) + 2);
    f.angry = 400;
    for (let k = 0; k < 400 && !crewNews([], 'x').length; k++) {
      const before = g.seen.length;
      g.step();
      const hit = g.seen.slice(before).find((e) => e.type === 'allyHit') as Extract<SimEvent, { type: 'allyHit' }> | undefined;
      if (hit) return hit.dmg;
    }
    return -1;
  };
  const plain = run(false);
  const backed = run(true);
  const sim = new Sim(CENTER_PERKS, 13);
  const base = damage(sim.state.inmates[CP.muscle].str, 0, INMATE_DEFENSE);
  check(plain === base && backed === Math.floor((base * 3) / 2), `a muscle watching the player's back hits ${backed} (a follower ${plain})`);
  // An ambush drawn is stopped: the same draws either way, the grudge kept.
  const twin = (back: boolean) => {
    const g = game(17);
    g.to(1, 9, 5);
    g.recruit(CP.muscle);
    if (back) g.talk(TALK.CREW, ORDER.BACK);
    g.step(command(0, OP.CLOSE));
    return g;
  };
  const a = twin(true);
  const b = twin(false);
  const canteen = (s: Sim) => {
    for (let i = 0; i < MAP_W * MAP_H; i++) if (s.world.zoneAt(i % MAP_W, Math.floor(i / MAP_W)) === 'canteen' && !s.world.blocked(i % MAP_W, Math.floor(i / MAP_W)) && !s.world.blocked((i % MAP_W) + 1, Math.floor(i / MAP_W)) && !s.world.blocked((i % MAP_W) + 2, Math.floor(i / MAP_W))) return i;
    return -1;
  };
  const c = canteen(a.sim);
  let stopped = 0;
  let same = true;
  for (const g of [a, b]) {
    g.sim.state.routine = ROUTINE.findIndex((r) => r.id === 'breakfast');
    put(g.sim.state.player, c);
    put(g.sim.state.inmates[CP.muscle].body, c + 1);
    const foe = g.sim.state.inmates[CP.digger];
    put(foe.body, c + 2);
    foe.opinion = 10;
  }
  check(backedBy(a.sim) === CP.muscle && backedBy(b.sim) === -1, 'backed up by the muscle close by (not a plain follower)');
  for (let k = 0; k < 3000 && b.sim.state.inmates[CP.digger].angry === 0; k++) {
    a.sim.events = [];
    b.sim.events = [];
    grudges(a.sim);
    grudges(b.sim);
    if (a.sim.events.some((e) => e.type === 'crew' && e.what === 'stopped')) stopped++;
    if (a.sim.state.rng !== b.sim.state.rng) same = false;
  }
  check(b.sim.state.inmates[CP.digger].angry > 0 && a.sim.state.inmates[CP.digger].angry === 0 && stopped === 1 && same, 'the ambush drawn alike: jumped alone, stopped with him there');
  for (let k = 0; k < 4000; k++) {
    a.sim.events = [];
    grudges(a.sim);
    if (a.sim.events.some((e) => e.type === 'crew' && e.what === 'stopped')) stopped++;
  }
  check(stopped === 1 && a.sim.state.inmates[CP.digger].angry === 0, 'stopped every time, said once a block');
}

// ------------------------------------------------------------------ start a brawl
{
  const g = game(19);
  const { sim, seen } = g;
  g.to(1, 9, 5);
  const y = yardSpot(sim);
  clearOut(sim, [CP.muscle]);
  g.recruit(CP.muscle, 85, y);
  check(cantOrder(sim, CP.muscle, ORDER.BRAWL) === 'noBrawl', 'nobody to brawl with: refused');
  g.talk(TALK.CREW, ORDER.BRAWL);
  check(refusals(seen).at(-1) === 'noBrawl', 'refused for the same reason');
  // Someone close by now.
  const other = CP.digger;
  const o = sim.state.inmates[other];
  put(o.body, y + MAP_W * 3);
  o.wait = 0;
  check(brawlWith(sim, CP.muscle) === other, `the nearest within ${BRAWL_RANGE} tiles he can see`);
  // The guards it should bring: the nearest two awake.
  const near = sim.state.guards
    .map((gd, k) => ({ k, d: (gd.body.x - o.body.x) ** 2 + (gd.body.z - o.body.z) ** 2, ok: awake(gd) && gd.mode !== GUARD.CHASE }))
    .filter((x) => x.ok)
    .sort((p, q) => p.d - q.d || p.k - q.k)
    .slice(0, BRAWL_GUARDS)
    .map((x) => x.k);
  const heat = sim.state.heat;
  const t0 = sim.state.step;
  g.talk(TALK.CREW, ORDER.BRAWL);
  const b = crewNews(seen, 'brawl').at(-1);
  check(!!b && b.other === other && b.guards!.join() === near.join() && near.every((k) => sim.state.guards[k].mode === GUARD.INVESTIGATE && sim.state.guards[k].target === tileOf(o.body)), `a brawl: the ${BRAWL_GUARDS} nearest guards sent to look (${near.join(', ')})`);
  g.steps(80);
  check(sim.state.inmates[CP.muscle].doing === DOING.BRAWL && o.doing === DOING.BRAWL && cheb(sim.state.inmates[CP.muscle].body, o.body) <= 1.2 * UNIT, 'the two at it, squared up');
  check(cantOrder(sim, CP.muscle, ORDER.FOLLOW) === 'crewBusy', 'no other order mid-brawl');
  g.to(1, 9, 5 + 62);
  const over = crewNews(seen, 'brawlOver');
  check(over.length === 1 && orderOf(sim.state, CP.muscle) === ORDER.FOLLOW, 'over after a minute');
  check(seen.findIndex((e) => e.type === 'crew' && e.what === 'brawlOver') >= 0 && sim.state.step - t0 >= BRAWL_STEPS && heat === sim.state.heat, 'no heat for the player');
  check(cantOrder(sim, CP.muscle, ORDER.BRAWL) === 'brawlToday', 'once a day');
  g.to(2, 9, 5);
  if (!sim.state.followers.includes(CP.muscle)) g.recruit(CP.muscle, 85, y);
  put(o.body, tileOf(sim.state.inmates[CP.muscle].body) + 2);
  check(cantOrder(sim, CP.muscle, ORDER.BRAWL) === null, 'again the next day');
  sim.state.lockdown = true;
  check(cantOrder(sim, CP.muscle, ORDER.BRAWL) === 'crewLockdown', 'never in a lockdown');
  sim.state.lockdown = false;
  check(sim.state.feats[FEAT.brawls] === 1, 'the brawl counted');
}

// ------------------------------------------------------------------ fetch the drop
{
  const g = game(23);
  const { sim, seen } = g;
  g.to(1, 9, 5);
  const y = yardSpot(sim);
  check(g.recruit(CP.smuggler, 85, y), 'a smuggler recruited');
  check(cantOrder(sim, CP.smuggler, ORDER.FETCH) === 'noDrop', 'no drop: nothing to fetch');
  const lay = (tile: number, item: number) => {
    const key = placeKey(LAYER.GROUND, tile);
    sim.state.items.ground.push([key, slot(item)]);
    sim.state.drops.push([key, item, sim.state.step]);
    return key;
  };
  const dropAt = yardSpot(sim, 3);
  const rope = n('rope');
  lay(dropAt, rope);
  // The guards kept from seeing it (they'd seize it).
  for (const gd of sim.state.guards) {
    put(gd.body, placesOf(sim.world).bedside[1]);
    gd.wait = 100000;
  }
  g.talk(TALK.CREW, ORDER.FETCH);
  g.step(command(0, OP.CLOSE));
  // The player's pockets full: he holds on to it.
  const inv = sim.state.items.inv;
  for (let k = 0; k < 6; k++) inv[k] = slot(n('toilet_paper'));
  let fetched = false;
  for (let k = 0; k < 2000 && !fetched; k++) {
    for (const gd of sim.state.guards) put(gd.body, placesOf(sim.world).bedside[1]);
    g.step();
    fetched = crewNews(seen, 'fetched').length > 0;
  }
  check(fetched && !sim.state.drops.length && !sim.state.items.ground.some(([k]) => k === placeKey(LAYER.GROUND, dropAt)) && carryingOf(sim.state, CP.smuggler) === rope, 'picked up: off the ground, no longer a drop');
  g.steps(400);
  check(!crewNews(seen, 'handed').length && carryingOf(sim.state, CP.smuggler) === rope, 'pockets full: he holds on to it');
  inv[2] = 0;
  g.steps(20);
  check(crewNews(seen, 'handed').length === 1 && itemOf(inv[2]) === rope && !crewEntry(sim.state, CP.smuggler), 'room made: into the player\'s pockets');
  // Seized before he gets there: given up.
  lay(dropAt, rope);
  g.talkTo(CP.smuggler, y);
  g.talk(TALK.CREW, ORDER.FETCH);
  g.step(command(0, OP.CLOSE));
  sim.state.drops.length = 0;
  g.step();
  check(crewNews(seen, 'fetchFailed').at(-1)?.why === 'gone' && orderOf(sim.state, CP.smuggler) === ORDER.FOLLOW, 'the drop gone before he gets there: given up');
  check(sim.state.feats[FEAT.crewFetched] === 1, 'the fetch counted');
}

// ------------------------------------------------------------------ tonight's the night
{
  const g = game(29);
  const { sim, seen } = g;
  g.to(1, 22, 30);
  const y = yardSpot(sim);
  g.recruit(CP.lookout, 95, y);
  g.recruit(CP.digger, 85, y + 2);
  g.talkTo(CP.lookout, y);
  g.talk(TALK.CREW, ORDER.NIGHT);
  g.step(command(0, OP.CLOSE));
  check(crewNews(seen, 'order').at(-1)?.order === ORDER.NIGHT, 'tonight\'s the night: on');
  // The player in their cell for Lights Out.
  put(sim.state.player, placesOf(sim.world).bedside[1]);
  g.to(1, 23, 1);
  check(sim.state.followers.join() === String(CP.lookout), 'Lights Out: to bed, but for the one staying the night');
  g.steps(400);
  const step1 = placesOf(sim.world).doorstep[1];
  check(tileOf(sim.state.inmates[CP.lookout].body) === step1 && (sim.world.lockedCells & 2n) === 2n, 'outside the player\'s cell while they\'re in it: the door locks all the same');
  // Posted in the player's own cell and staying the night: at Lights Out he waits at the door, which locks.
  {
    const h = game(43);
    h.to(1, 22, 30);
    const bed = placesOf(h.sim.world).bedside[1];
    h.recruit(CP.lookout, 95, yardSpot(h.sim));
    h.talk(TALK.CREW, ORDER.NIGHT);
    put(h.sim.state.inmates[CP.lookout].body, bed + 1);
    h.sim.state.inmates[CP.lookout].path = [];
    put(h.sim.state.player, bed);
    h.order(CP.lookout, ORDER.WATCH);
    h.step(command(0, OP.CLOSE));
    check(h.sim.world.cellOf[postOf(h.sim.state, CP.lookout)] === 1, 'a lookout posted in the player\'s cell, staying the night');
    put(h.sim.state.player, bed);
    h.sim.state.sleeping = true;
    h.to(1, 23, 20);
    check(h.sim.state.followers.includes(CP.lookout) && tileOf(h.sim.state.inmates[CP.lookout].body) === step1 && (h.sim.world.lockedCells & 2n) === 2n, 'cells locked: he waits at the door, and it locks');
  }
  // Out of the cell (by whatever means): at the player's heels in the night.
  put(sim.state.player, yardSpot(sim, 2));
  g.steps(400);
  check(cheb(sim.state.inmates[CP.lookout].body, sim.state.player) <= 2 * UNIT, 'with the player out in the night');
  // Back to bed (before a guard sees the player out).
  put(sim.state.player, placesOf(sim.world).bedside[1]);
  sim.state.sleeping = true;
  g.to(1, 5, 59);
  check(sim.state.followers.includes(CP.lookout) && tileOf(sim.state.inmates[CP.lookout].body) === step1, 'still there at 05:59, outside the cell');
  g.to(1, 6, 1);
  check(!sim.state.followers.length && crewNews(seen, 'nightOver').length === 1, '06:00: back to bed');
  check(sim.state.feats[FEAT.nightsOut] === 1, 'the night counted');
}

// ------------------------------------------------------------------ the crew escape
{
  const g = game(31);
  const { sim, seen } = g;
  g.to(1, 9, 5);
  const y = yardSpot(sim);
  g.recruit(CP.lookout, 85, y);
  g.recruit(CP.muscle, 85, y + 2);
  g.step(command(0, OP.CLOSE));
  check(crewEscape(sim, 'tunnel').length === 0 && crewEscape(sim, 'roof').length === 0 && crewEscape(sim, 'stowaway').length === 0, 'never through a hole, down a rope or in a vehicle');
  // Out on the road, one of them close by, the other far off.
  let road = -1;
  for (let i = 0; i < MAP_W * MAP_H && road < 0; i++) {
    const x = i % MAP_W;
    const z = Math.floor(i / MAP_W);
    if (sim.world.zoneAt(x, z) === 'outside' && !sim.world.blocked(x, z) && !sim.world.blocked(x + 1, z) && sim.world.zoneAt(x + 1, z) === 'outside' && sim.world.zoneAt(x + 2, z) === 'outside') road = i;
  }
  put(sim.state.player, road);
  put(sim.state.inmates[CP.lookout].body, road + 2);
  put(sim.state.inmates[CP.muscle].body, placesOf(sim.world).bedside[1]);
  check(crewEscape(sim, 'fence').join() === String(CP.lookout), `those within ${CREW_ESCAPE_REACH} tiles get out too`);
  g.step();
  const out = seen.find((e) => e.type === 'escaped') as Extract<SimEvent, { type: 'escaped' }> | undefined;
  check(!!sim.state.escaped && out?.crew?.join() === String(CP.lookout) && sim.state.crewOut.join() === String(CP.lookout), 'out: the crew close by with the player');
}

// ------------------------------------------------------------------ the review's holes
{
  const g = game(47);
  const { sim, seen } = g;
  g.to(1, 9, 5);
  const w = sim.world;
  g.recruit(CP.lookout, 95);
  // No post in a doorway, beside the player's cell door, or inside a work room.
  const m = sim.state.inmates[CP.lookout];
  const door = w.cellDoor[1];
  put(m.body, door);
  check(cantOrder(sim, CP.lookout, ORDER.WATCH) === 'badPost', 'no post in the player\'s cell door');
  let room = -1;
  for (let i = 0; i < MAP_W * MAP_H && room < 0; i++) if (w.zoneAt(i % MAP_W, Math.floor(i / MAP_W)) === 'kitchen' && !w.blocked(i % MAP_W, Math.floor(i / MAP_W))) room = i;
  if (room >= 0) {
    put(m.body, room);
    check(cantOrder(sim, CP.lookout, ORDER.WATCH) === 'badPost', 'no post in a work room (its door would stay open)');
  }
  put(m.body, yardSpot(sim));
  check(cantOrder(sim, CP.lookout, ORDER.WATCH) === null, 'a post in the yard');
  // The night called off: said as such, nothing counted.
  g.talkTo(CP.lookout);
  g.talk(TALK.CREW, ORDER.NIGHT);
  g.talk(TALK.CREW, ORDER.NIGHT);
  check(crewNews(seen, 'nightOff').length === 1 && !crewEntry(sim.state, CP.lookout) && sim.state.feats[FEAT.nightsOut] === 0, 'tonight called off: no night out counted');
  // A plain follower recruited at Lights Out stays (as followers always did).
  const h = game(53);
  h.to(1, 23, 30);
  h.recruit(CP.digger, 85);
  h.steps(200);
  check(h.sim.state.followers.includes(CP.digger), 'a plain follower recruited in the night stays');
  // The smuggler: the drop taken from under his nose the step he gets there; carrying it, no other order.
  const f = game(59);
  f.to(1, 9, 5);
  f.recruit(CP.smuggler, 85);
  const spot = yardSpot(f.sim, 2);
  const key = placeKey(LAYER.GROUND, spot);
  f.sim.state.items.ground.push([key, slot(n('rope'))]);
  f.sim.state.drops.push([key, n('rope'), f.sim.state.step]);
  f.talk(TALK.CREW, ORDER.FETCH);
  f.step(command(0, OP.CLOSE));
  const sm = f.sim.state.inmates[CP.smuggler];
  put(sm.body, spot);
  sm.path = [];
  f.sim.state.items.ground = f.sim.state.items.ground.filter(([k]) => k !== key);
  f.step();
  check(crewNews(f.seen, 'fetchFailed').at(-1)?.why === 'gone' && !carryingOf(f.sim.state, CP.smuggler), 'picked up from under his nose: nothing doubled');
  f.sim.state.items.ground.push([key, slot(n('rope'))]);
  f.sim.state.drops.push([key, n('rope'), f.sim.state.step]);
  for (let k = 0; k < 6; k++) f.sim.state.items.inv[k] = slot(n('toilet_paper'));
  f.talkTo(CP.smuggler, yardSpot(f.sim));
  f.talk(TALK.CREW, ORDER.FETCH);
  f.step(command(0, OP.CLOSE));
  for (let k = 0; k < 1500 && !carryingOf(f.sim.state, CP.smuggler); k++) {
    for (const gd of f.sim.state.guards) put(gd.body, placesOf(f.sim.world).bedside[1]);
    f.step();
  }
  check(carryingOf(f.sim.state, CP.smuggler) === n('rope') && cantOrder(f.sim, CP.smuggler, ORDER.FOLLOW) === 'crewBusy', 'bringing the drop: no other order till it\'s handed over');
}

// ------------------------------------------------------------------ saves
{
  const g = game(37);
  const { sim } = g;
  g.to(1, 9, 5);
  const y = yardSpot(sim);
  g.recruit(CP.lookout, 95, y);
  g.talk(TALK.CREW, ORDER.WATCH);
  g.talk(TALK.CREW, ORDER.NIGHT);
  g.recruit(CP.smuggler, 85, y + 3);
  const key = placeKey(LAYER.GROUND, yardSpot(sim, 4));
  sim.state.items.ground.push([key, slot(n('rope'))]);
  sim.state.drops.push([key, n('rope'), sim.state.step]);
  g.talk(TALK.CREW, ORDER.FETCH);
  g.step(command(0, OP.CLOSE));
  g.steps(30);
  const twin = new Sim(CENTER_PERKS, 37);
  twin.restore(JSON.parse(JSON.stringify(sim.snapshot())));
  for (let k = 0; k < 1500; k++) {
    sim.step(0);
    twin.step(0);
  }
  check(sim.hash() === twin.hash(), 'a post, a fetch, a night\'s company saved: they carry on the same');
  const bad = sim.snapshot();
  (bad.state as { crew: unknown }).crew = [[99, 1, 2, 3, 0], 'x'];
  (bad.state as { brawled: unknown }).brawled = 'x';
  twin.restore(bad);
  check(Array.isArray(twin.state.crew) && twin.state.crew.length === 0 && twin.state.brawled === 0, 'damaged crew orders dropped');
  const old = sim.snapshot();
  delete (old.state as Partial<typeof old.state>).crew;
  delete (old.state as Partial<typeof old.state>).brawled;
  delete (old.state as Partial<typeof old.state>).crewOut;
  twin.restore(old);
  check(twin.state.crew.length === 0 && twin.state.followers.length === sim.state.followers.length, 'a save from before the crew: followers following');
}

// ------------------------------------------------------------------ a blow, a capture
{
  const g = game(41);
  const { sim } = g;
  g.to(1, 9, 5);
  g.recruit(CP.digger, 85);
  g.talk(TALK.CREW, ORDER.DIG);
  g.step(command(0, OP.CLOSE));
  sim.state.lock = sim.state.followers[0];
  sim.state.items.hand = 0;
  sim.state.items.inv[0] = 0;
  for (let k = 0; k < 40 && sim.state.followers.length; k++) {
    put(sim.state.inmates[CP.digger].body, tileOf(sim.state.player) + 1);
    sim.state.player.facing = 1;
    g.step(command(0, OP.USE, 1));
  }
  check(!sim.state.followers.length && !sim.state.crew.length, 'hit by the player: gone, with his order');
}
