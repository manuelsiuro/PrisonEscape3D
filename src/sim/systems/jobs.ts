/**
 * Jobs and cash (GDD §11, §3.1): the stations, the quota and the wage, the Work Period's start
 * and settling, the job board, a new day's vacancies, and loose change in desks and pockets.
 */
import { twist } from './twists';
import { itemDef } from '../../content/items';
import { WORK_ITEMS } from '../../content/jobs';
import { ROUTINE } from '../../content/routine';
import { zoneIndex } from '../../content/zones';
import { nearestDir as faceTo } from '../ai/path';
import { placesOf } from '../ai/places';
import type { SimContext } from '../context';
import { randomInt } from '../rng';
import { type Attr, ATTRS } from '../state';
import { ATTR_START, STEPS_PER_SECOND, UNIT, VACANCY_DAYS } from '../tuning';
import { containersOf } from '../world/containers';
import { MAP_W } from '../world/World';
import { clockAt } from './clock';
import { HOLDER, jobRooms, nearestProp, qualifies, type Station, STATION_REACH, stationTarget } from './economy';
import { HOTBAR, itemOf, pocketOf, slot, stockSlots, usesOf } from './items';
import { tileOfBody } from './movement';
import { offerFavors, refuse } from './social';
import { attr, setAttr, stopTraining } from './training';

/** What the player's job lets the action button do here (null: the usual). */
export function station(sim: SimContext): Station | null {
  const s = sim.state;
  const ws = sim.scratch.workState;
  ws.job = sim.jobActive();
  ws.onDuty = sim.onDuty;
  ws.machines = s.machines;
  ws.puddles = s.puddles;
  ws.step = s.step;
  ws.inv = s.items.inv;
  ws.hand = s.items.hand;
  ws.mail = s.mail;
  const def = ws.job >= 0 ? jobRooms(sim.world)[ws.job]?.def : undefined;
  ws.owed = def ? def.quota - s.quota : 0;
  return stationTarget(sim.world, ws, s.player);
}

/** A step of the job at a station: take, load, unload, put, sort, mop. */
export function work(sim: SimContext, st: Station) {
  const s = sim.state;
  const it = s.items;
  const room = jobRooms(sim.world)[sim.jobActive()];
  const def = room.def;
  const free = () => it.inv.slice(0, HOTBAR).indexOf(0);
  /** One of an item off the hotbar (the one in hand first). */
  const takeOne = (item: number) => {
    const k = itemOf(it.inv[it.hand]) === item ? it.hand : it.inv.slice(0, HOTBAR).findIndex((v) => itemOf(v) === item);
    if (k >= 0) it.inv[k] = 0;
    return k >= 0;
  };
  stopTraining(sim);
  const prop = sim.world.props[st.prop];
  if (prop) s.player.facing = faceTo((prop.x + prop.w / 2) * UNIT - s.player.x, (prop.z + prop.d / 2) * UNIT - s.player.z) || s.player.facing;
  switch (st.act) {
    case 'full':
      sim.events.push({ type: 'full' });
      return;
    case 'running':
      break;
    case 'take':
      it.inv[free()] = slot(st.item);
      break;
    case 'load':
      if (!takeOne(st.item)) return;
      s.machines[st.prop] = s.step + (def.cycle ?? 3) * STEPS_PER_SECOND;
      break;
    case 'sort':
      s.machines[st.prop] = s.step + (def.cycle ?? 3) * STEPS_PER_SECOND;
      break;
    case 'unload': {
      // A letter is addressed to the next inmate on today's round who has none in the bag yet.
      let v = slot(st.item);
      if (def.flow === 'mail') {
        const carried = it.inv.filter((x) => itemOf(x) === st.item).map((x) => usesOf(x) - 1);
        const to = s.mail.find((id) => !carried.includes(id));
        if (to === undefined) return;
        v = slot(st.item, to + 1);
      }
      delete s.machines[st.prop];
      it.inv[free()] = v;
      break;
    }
    case 'put':
      if (!takeOne(st.item)) return;
      quotaUp(sim);
      break;
    case 'mop':
      s.puddles.splice(s.puddles.indexOf(st.tile), 1);
      quotaUp(sim);
      break;
  }
  it.rev++;
  sim.events.push({ type: 'work', act: st.act, item: st.item, prop: st.prop });
}

/** One more toward the day's quota; done, the wage is paid there and then. */
export function quotaUp(sim: SimContext) {
  const s = sim.state;
  const def = jobRooms(sim.world)[sim.jobActive()].def;
  s.quota++;
  sim.events.push({ type: 'quota', n: s.quota, of: def.quota });
  if (s.quota < def.quota || s.paid) return;
  s.paid = true;
  const wage = wageOf(s, def.wage);
  s.cash += wage;
  sim.events.push({ type: 'cash', n: wage, why: 'wage' });
  s.tally[3] += wage;
}

/** What a job pays (P26: nothing on an Unpaid Labour Daily). */
export const wageOf = (s: { readonly mods: readonly string[] }, wage: number) => (twist(s, 'unpaidLabour') ? 0 : wage);

/** 12:00: the janitor's puddles appear in the corridors, the mailman's round is drawn; inmates head to work. */
export function startWork(sim: SimContext) {
  const s = sim.state;
  const w = sim.world;
  for (const m of s.inmates) m.shift = 0;
  s.puddles = [];
  s.mail = [];
  const job = sim.jobActive();
  if (job < 0) return;
  const def = jobRooms(w)[job].def;
  if (def.flow === 'mop') {
    const floor = placesOf(w).floor[zoneIndex('corridor')] ?? [];
    for (let k = 0; k < def.quota && s.puddles.length < floor.length; k++) {
      let t = floor[randomInt(s, floor.length)];
      while (s.puddles.includes(t)) t = floor[randomInt(s, floor.length)];
      s.puddles.push(t);
    }
  }
  if (def.flow === 'mail') {
    const ids = s.inmates.map((_, i) => i);
    for (let k = 0; k < def.quota && ids.length; k++) s.mail.push(ids.splice(randomInt(s, ids.length), 1)[0]);
  }
}

/** 15:00: a quota not met costs the job (GDD §2.2), and so does missing work (inmates); the job's things go back. */
export function settleWork(sim: SimContext) {
  const s = sim.state;
  const it = s.items;
  const job = sim.jobActive();
  // A lockdown (or the player out cold) excuses the block: nobody loses a job over it.
  if (job >= 0 && !s.paid && !s.excused) vacate(sim, job, HOLDER.PLAYER, 'fired');
  const work = (v: number) => !!v && WORK_ITEMS.includes(itemDef(itemOf(v)).id);
  for (let k = 0; k < HOTBAR; k++) if (work(it.inv[k])) it.inv[k] = 0;
  // Dropped ones are picked up too.
  it.ground = it.ground.filter(([, v]) => !work(v));
  it.rev++;
  s.machines = {};
  s.puddles = [];
  s.mail = [];
  // Inmates who never turned up, or were knocked out on the job, lose theirs (GDD §11: sabotage).
  s.jobs.forEach((who, j) => {
    const shift = s.inmates[who]?.shift;
    if (who >= 0 && (shift === 2 || (shift === 0 && !s.excused))) vacate(sim, j, who, 'fired');
  });
}

/** A job left open (by whoever held it). */
function vacate(sim: SimContext, job: number, who: number, change: 'fired' | 'quit') {
  const s = sim.state;
  s.jobs[job] = HOLDER.NOBODY;
  s.jobOpen[job] = sim.today;
  // The player's own work on the go goes with the job: loads in the machines, puddles, the mail round.
  if (who === HOLDER.PLAYER) {
    s.machines = {};
    s.puddles = [];
    s.mail = [];
  }
  sim.events.push({ type: 'job', job, who, change });
}

/** During the Work Period, inmates with a job check in on reaching its room. */
export function clockIn(sim: SimContext) {
  const s = sim.state;
  if (ROUTINE[s.routine].id !== 'work') return;
  const rooms = jobRooms(sim.world);
  s.jobs.forEach((who, j) => {
    const m = who >= 0 ? s.inmates[who] : undefined;
    if (!m || m.shift !== 0 || m.ko > 0) return;
    const t = tileOfBody(m.body);
    if (sim.world.ground.zone[t.z * MAP_W + t.x] === rooms[j].zone) m.shift = 1;
  });
}

/**
 * 08:00, a new day: the quota starts again; attributes left untrained yesterday slip a point
 * (GDD §3.2); mines are laid again; change turns up in desks and pockets; merchants restock;
 * new favors; jobs left open long enough are taken by inmates.
 */
export function newDay(sim: SimContext) {
  const s = sim.state;
  s.quota = 0;
  s.paid = false;
  const slipped: Attr[] = [];
  ATTRS.forEach((a, k) => {
    if ((s.trained >> k) & 1 || attr(sim, a) <= ATTR_START) return;
    setAttr(sim, a, attr(sim, a) - 1);
    slipped.push(a);
  });
  s.trained = 0;
  if (slipped.length) sim.events.push({ type: 'decay', attrs: slipped });
  // Yesterday's craters have new mines in them (P11).
  s.craters = [];
  spreadCoins(sim);
  for (const shop of s.shops) stockSlots('merchant', 0, shop, s);
  offerFavors(sim);
  const today = sim.today;
  s.jobs.forEach((who, j) => {
    if (who !== HOLDER.NOBODY || today - s.jobOpen[j] < VACANCY_DAYS) return;
    const free = s.inmates.map((_, i) => i).filter((i) => !s.jobs.includes(i) && !s.followers.includes(i));
    if (!free.length) return;
    const id = free[randomInt(s, free.length)];
    s.jobs[j] = id;
    sim.events.push({ type: 'job', job: j, who: id, change: 'hired' });
  });
}

/** The job board (GDD §11): apply for an open job (a = job + 1), or quit (a = 0). Only at the board. */
export function jobOp(sim: SimContext, a: number) {
  const s = sim.state;
  const w = sim.world;
  if (nearestProp(w, s.player, (p) => p.kind === 'jobBoard', STATION_REACH + UNIT / 4) < 0) return;
  const held = sim.playerJob;
  if (a === 0) {
    if (held >= 0) vacate(sim, held, HOLDER.PLAYER, 'quit');
    return;
  }
  const job = a - 1;
  const room = jobRooms(w)[job];
  if (!room || job === held) return;
  if (s.jobs[job] !== HOLDER.NOBODY) return refuse(sim, 'taken');
  if (!qualifies(w, s.items.int, job)) return refuse(sim, 'int');
  if (held >= 0) vacate(sim, held, HOLDER.PLAYER, 'quit');
  s.jobs[job] = HOLDER.PLAYER;
  // Taken once the Work Period has begun: it counts from tomorrow.
  s.jobDay = clockAt(s.step).minuteOfDay >= ROUTINE.find((r) => r.id === 'work')!.start ? sim.today + 1 : sim.today;
  s.quota = 0;
  s.paid = false;
  sim.events.push({ type: 'job', job, who: HOLDER.PLAYER, change: 'hired' });
}

/** 08:00: small change in some inmates' desks and pockets (never the player's things). */
export function spreadCoins(sim: SimContext) {
  const s = sim.state;
  const w = sim.world;
  containersOf(w).forEach((c, i) => {
    if (c.table === 'inmateDesk' && randomInt(s, 5) < 2) s.coins[i] = (s.coins[i] ?? 0) + 1 + randomInt(s, 8);
  });
  for (let k = 0; k < s.inmates.length; k++) if (randomInt(s, 2) === 0) s.coins[pocketOf(w, k)] = (s.coins[pocketOf(w, k)] ?? 0) + 1 + randomInt(s, 6);
}

/** Opening a desk or someone's pockets: the change in it is the player's. */
export function takeCoins(sim: SimContext, index: number) {
  const s = sim.state;
  const n = s.coins[index];
  if (!n) return;
  delete s.coins[index];
  s.cash += n;
  sim.events.push({ type: 'cash', n, why: 'loot' });
  s.tally[3] += n;
}
