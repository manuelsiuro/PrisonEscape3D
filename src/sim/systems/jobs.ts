/**
 * Jobs and cash (GDD §11, §3.1): the stations, the quota and the wage, the Work Period's start
 * and settling, the job board, a new day's vacancies, and loose change in desks and pockets.
 */
import { gardenDelivered } from './grounds';
import { kennelsFed } from './k9';
import { twist } from './twists';
import { itemDef, itemNumber } from '../../content/items';
import { type JobDef, WORK_ITEMS } from '../../content/jobs';
import { BLOCK, ROUTINE } from '../../content/routine';
import { zoneIndex, type ZoneId } from '../../content/zones';
import { nearestDir } from '../ai/path';
import { placesOf } from '../ai/places';
import type { SimContext } from '../context';
import { randomInt } from '../rng';
import { type Attr, ATTRS } from '../events';
import {
  ATTR_START,
  CHASE_HEAT,
  MAIL_WARNING,
  STEPS_PER_SECOND,
  STRANGER_CAP,
  STRANGER_EVERY,
  STRANGER_GAP,
  STRANGER_GRACE,
  STRANGER_HEAT,
  UNIT,
  VACANCY_DAYS,
  WORK_WARNING,
} from '../tuning';
import { containersOf } from '../world/containers';
import { MAP_W } from '../world/World';
import { clockAt } from './clock';
import { HOLDER, jobRooms, nearestProp, qualifies, type Station, STATION_REACH, stationTarget } from './economy';
import { canTalkTo, freeHotbar, HOTBAR, hotbarSlotOf, itemOf, pocketOf, slot, stockSlots, usesOf } from './items';
import { tileOfBody } from './movement';
import { liftingMug } from './oddjobs';
import { offerFavors, refuse } from './social';
import { attr, setAttr, stopTraining } from './training';

const PUMPKIN = itemNumber('pumpkin');

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
  ws.pockets = !sim.rules229;
  return stationTarget(sim.world, ws, s.player);
}

/** 2.30: the minute of the day a job's first warning comes, while its quota isn't done. */
export const workWarningAt = (def: JobDef) => (def.flow === 'mail' ? MAIL_WARNING : WORK_WARNING);

/** 2.30: what the job wants next, on the clock (null: off it): the step, and its station (a prop, -1: wherever the puddles or the addressee are). */
export interface NextWork {
  act: 'take' | 'load' | 'unload' | 'put' | 'sort' | 'mop' | 'deliver' | 'wait';
  prop: number;
  /** The item it's about. */
  item: number;
  /** A letter's addressee (Cast id), -1 otherwise. */
  who: number;
}

/** 2.30: the job's next step for the arrows, the HUD and the chip. Reads only. */
export function nextWork(sim: SimContext): NextWork | null {
  if (!sim.onDuty) return null;
  const s = sim.state;
  const room = jobRooms(sim.world)[sim.jobActive()];
  if (!room) return null;
  const def = room.def;
  const raw = def.raw ? itemNumber(def.raw) : 0;
  const done = def.done ? itemNumber(def.done) : 0;
  const carried = s.items.inv.slice(0, HOTBAR);
  const has = (item: number) => !!item && carried.some((v) => itemOf(v) === item);
  if (def.flow === 'mop')
    return has(raw) ? { act: 'mop', prop: -1, item: raw, who: -1 } : { act: 'take', prop: room.take, item: raw, who: -1 };
  const running = room.machines.filter((i) => s.machines[i] !== undefined);
  const ready = running.find((i) => s.machines[i] <= s.step);
  if (def.flow === 'mail') {
    const letter = carried.find((v) => itemOf(v) === done && s.mail.includes(usesOf(v) - 1));
    if (ready !== undefined) return { act: 'unload', prop: ready, item: done, who: -1 };
    if (letter) return { act: 'deliver', prop: -1, item: done, who: usesOf(letter) - 1 };
    if (running.length) return { act: 'wait', prop: running[0], item: done, who: -1 };
    return { act: 'sort', prop: room.machines[0], item: done, who: -1 };
  }
  if (ready !== undefined) return { act: 'unload', prop: ready, item: done, who: -1 };
  if (has(done)) return { act: 'put', prop: room.put, item: done, who: -1 };
  const free = room.machines.find((i) => s.machines[i] === undefined);
  if (has(raw))
    return free !== undefined ? { act: 'load', prop: free, item: raw, who: -1 } : { act: 'wait', prop: running[0], item: done, who: -1 };
  // (As many on the go as it still owes: no fresh one, as the bin wouldn't give it.)
  if (running.length >= def.quota - s.quota) return running.length ? { act: 'wait', prop: running[0], item: done, who: -1 } : null;
  return { act: 'take', prop: room.take, item: raw, who: -1 };
}

/** A step of the job at a station: take, load, unload, put, sort, mop. */
export function work(sim: SimContext, st: Station) {
  const s = sim.state;
  const it = s.items;
  const room = jobRooms(sim.world)[sim.jobActive()];
  const def = room.def;
  const free = () => freeHotbar(it.inv);
  /** One of an item off the hotbar (the one in hand first). */
  const takeOne = (item: number) => {
    const k = itemOf(it.inv[it.hand]) === item ? it.hand : hotbarSlotOf(it.inv, item);
    if (k >= 0) it.inv[k] = 0;
    return k >= 0;
  };
  stopTraining(sim);
  const prop = sim.world.props[st.prop];
  if (prop)
    s.player.facing = nearestDir((prop.x + prop.w / 2) * UNIT - s.player.x, (prop.z + prop.d / 2) * UNIT - s.player.z) || s.player.facing;
  switch (st.act) {
    case 'full':
      sim.events.push({ type: 'full' });
      return;
    case 'running':
      break;
    case 'take': {
      const k = free();
      it.inv[k] = slot(st.item);
      // (2.30: and carried in the hand, where it's seen.)
      if (!sim.rules229) it.hand = k;
      break;
    }
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
      const k = free();
      it.inv[k] = v;
      if (!sim.rules229) it.hand = k;
      break;
    }
    case 'put':
      if (!takeOne(st.item)) return;
      quotaUp(sim);
      break;
    case 'mop':
      // (2.30: from the pockets into the hand.)
      if (!sim.rules229 && itemOf(it.inv[it.hand]) !== st.item) it.hand = hotbarSlotOf(it.inv, st.item);
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
  // (P31: the gardener's crates, into the kitchen.)
  if (def.id === 'gardener') gardenDelivered(sim);
  // (2.36: the kennel hand's bowls, every hound's share from the player's hands.)
  if (def.id === 'kennels') kennelsFed(sim);
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
  // (The day's card: paid, fired, or let off.)
  if (job >= 0) s.blocks[s.routine] = s.paid ? BLOCK.ATTENDED : s.excused ? BLOCK.EXCUSED : BLOCK.MISSED;
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

/**
 * 2.32: on the mail round, someone in reach with a letter in the pockets for them (their index; -1 none). They take
 * the button from whoever else stands by, or a bystander's chat is opened instead of the letter being handed over.
 */
export function letterDue(sim: SimContext): number {
  const s = sim.state;
  if (sim.rules231 || !s.mail.length || !sim.onDuty) return -1;
  const letter = itemNumber('letter');
  for (const v of s.items.inv.slice(0, HOTBAR)) {
    if (itemOf(v) !== letter) continue;
    const who = usesOf(v) - 1;
    if (s.mail.includes(who) && s.inmates[who] && canTalkTo(sim.world, s.player, s.inmates[who])) return who;
  }
  return -1;
}

/**
 * 2.30: the heat for being in a work room that isn't the player's, as a guard watches (`seen`), or -1 when it
 * isn't that. Their own room's their cover, whatever the hour they were hired. The janitor and the mailman have
 * business everywhere. The garden is open ground with the player's own beds in it, so it isn't one.
 * Told first, with time to walk out; a little heat after that, and never enough of it to start a chase.
 */
export function stranger(sim: SimContext, zone: ZoneId, seen: boolean): number {
  const s = sim.state;
  const clear = () => {
    if (s.strayed.length) s.strayed = [];
    return -1;
  };
  // (Wanted already: that's what a guard reacts to, and it says so.)
  if (sim.rules229 || sim.world.def.rules?.relaxed || s.lockdown || ROUTINE[s.routine].id !== 'work' || s.heat >= CHASE_HEAT)
    return clear();
  const rooms = jobRooms(sim.world);
  const mine = sim.playerJob >= 0 ? rooms[sim.playerJob]?.def : undefined;
  const at = zone === 'garden' ? undefined : rooms.find((r) => r.def.zone === zone);
  if (!at || mine?.zone === zone || mine?.flow === 'mop' || mine?.flow === 'mail' || errandIn(sim, zone)) return clear();
  if (!seen) return -1;
  if (!s.strayed.length || s.step - s.strayed[1] > STRANGER_GAP) {
    s.strayed = [s.step, s.step];
    // Told, not caught at anything: no more than that if they go.
    sim.events.push({ type: 'toldOff' });
    return -1;
  }
  s.strayed[1] = s.step;
  // (A word with whoever works there: the clock waits till it's over.)
  if (s.talk >= 0) s.strayed[0] = s.step;
  const on = s.step - s.strayed[0];
  if (on < STRANGER_GRACE) return -1;
  if (s.heat >= STRANGER_CAP) return 0;
  if (on === STRANGER_GRACE) return Math.min(STRANGER_HEAT, STRANGER_CAP - s.heat);
  return on % STRANGER_EVERY === 0 ? 1 : 0;
}

/** Something that's sent the player to this room for its own sake: a pumpkin to carve in the kitchen, the fixer's mug in its freezer. */
function errandIn(sim: SimContext, zone: ZoneId): boolean {
  if (zone !== 'kitchen') return false;
  if (sim.state.items.inv.slice(0, HOTBAR).some((v) => itemOf(v) === PUMPKIN)) return true;
  return liftingMug(sim);
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
  s.readToday = 0;
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
  for (let k = 0; k < s.inmates.length; k++)
    if (randomInt(s, 2) === 0) s.coins[pocketOf(w, k)] = (s.coins[pocketOf(w, k)] ?? 0) + 1 + randomInt(s, 6);
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
