/**
 * Crew & specialists (P23). Every inmate has a line of work (PrisonDef.crew): a lookout, a
 * digger, muscle, a smuggler. A follower in the player's crew (social.ts) takes orders in his
 * line (TALK.CREW, b = ORDER), kept in `state.crew` as [who, order, place, more, night]:
 *
 * - **Keep watch here** (a lookout): he stands where he was told, wherever the player goes, and
 *   whistles when an awake guard comes within WATCH_RANGE tiles where he can see it (once each
 *   time one comes); EXT.RECALL whistles him back.
 * - **Dig with me** (a digger): at the player's side, digging and chipping on the ground floor go
 *   half as fast again, and he takes the dirt and the rubble. Down a tunnel he waits at the top
 *   of the shaft (never in the hole): tunnel digging a quarter faster, the dirt handed up to him.
 * - **Watch my back** (muscle): his blows ×1.5, and nobody jumps the player while he's close.
 * - **Start a brawl** (muscle), once a prison day: he picks a fight with another inmate close by
 *   for BRAWL_STEPS, and the BRAWL_GUARDS nearest guards awake come to look into it.
 * - **Fetch the drop** (a smuggler): he goes for what the drone dropped (the oldest drop still
 *   lying there), and brings it to the player's pockets.
 * - **Tonight's the night** (anyone at NIGHT_OPINION): he stays on through Lights Out (waiting
 *   outside the player's cell while they're in it) until 06:00.
 *
 * Nothing here draws on the RNG, and a follower given no order does just what followers always
 * did: the escape bots' followers are the same, step for step.
 */
import { ROUTINE } from '../../content/routine';
import { BACK_HELP, BACK_REACH, BRAWL_GAP, BRAWL_GUARDS, BRAWL_RANGE, BRAWL_STEPS, CREW_ESCAPE_REACH, DIG_HELP, DIG_REACH, FETCH_REACH, FETCH_STEPS, NIGHT_OPINION, NIGHT_UNTIL, SHAFT_HELP, SHAFT_REACH, WATCH_RANGE, type Speciality } from '../../content/crew';
import { lineOfSight } from '../ai/sight';
import { centerX, centerZ, tileAt } from '../ai/path';
import { placesOf } from '../ai/places';
import { ORDER } from '../command';
import type { SimContext } from '../context';
import type { EscapeRoute, Refusal } from '../state';
import { STEPS_PER_MINUTE, TALK_REACH, UNIT } from '../tuning';
import { LAYER, placeKey, tileOfKey, type World } from '../world/World';
import { TILE } from '../world/tiles';
import { jobRooms } from './economy';
import { clockAt, prisonDay } from './clock';
import { awake, GUARD, sendToLook } from './guards';
import { DOING } from './inmates';
import { HOTBAR, itemOf, pocketOf, slot } from './items';
import { bodyAt, type Body } from './movement';
import { dismiss, guardTalking, refuse } from './social';
import { besideOnGround } from './structure';

/** A crew order's entry (state.crew): [who, ORDER, place, more, night]. */
export type CrewEntry = number[];
const WHO = 0;
const ORD = 1;
const ARG = 2;
const AUX = 3;
const NIGHT = 4;

/** The line of work each order needs (FOLLOW and NIGHT: anyone's). */
export const LINE_OF: Readonly<Partial<Record<number, Speciality>>> = {
  [ORDER.WATCH]: 'lookout',
  [ORDER.DIG]: 'digger',
  [ORDER.BACK]: 'muscle',
  [ORDER.BRAWL]: 'muscle',
  [ORDER.FETCH]: 'smuggler',
};

/** The orders each line of work takes, in the talk panel's order. */
export const ORDERS_OF: Readonly<Record<Speciality, readonly number[]>> = {
  lookout: [ORDER.WATCH],
  digger: [ORDER.DIG],
  muscle: [ORDER.BACK, ORDER.BRAWL],
  smuggler: [ORDER.FETCH],
};

/** What an inmate (index) is good at. */
const ANY_LINE: readonly Speciality[] = ['lookout', 'digger', 'muscle', 'smuggler'];
export function specialityOf(w: World, who: number, cell: number): Speciality {
  return w.def.crew[cell - 2] ?? ANY_LINE[who % 4];
}

export const crewEntry = (s: { crew: number[][] }, who: number): CrewEntry | undefined => s.crew.find((e) => e[WHO] === who);
/** A follower's order (FOLLOW: none, or not in the crew). */
export const orderOf = (s: { crew: number[][] }, who: number) => crewEntry(s, who)?.[ORD] ?? ORDER.FOLLOW;
/** Whether a follower stays on through tonight. */
export const nightOf = (s: { crew: number[][] }, who: number) => (crewEntry(s, who)?.[NIGHT] ?? 0) === 1;
/** Where a lookout keeps watch (ground tile), -1 when he isn't posted. */
export const postOf = (s: { crew: number[][] }, who: number) => {
  const e = crewEntry(s, who);
  return e && e[ORD] === ORDER.WATCH ? e[ARG] : -1;
};
/** What a smuggler brings the player (item), 0 none yet. */
export const carryingOf = (s: { crew: number[][] }, who: number) => {
  const e = crewEntry(s, who);
  return e && e[ORD] === ORDER.FETCH && e[ARG] < 0 ? e[AUX] : 0;
};
/** The shaft a digger waits at the top of (ground tile), -1 none. */
export const shaftOf = (s: { crew: number[][] }, who: number) => {
  const e = crewEntry(s, who);
  return e && e[ORD] === ORDER.DIG ? e[ARG] : -1;
};

const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/**
 * Why an order can't be given now (null: it can). The talk panel greys its buttons by the same
 * answers. `who` must be following the player.
 */
export function cantOrder(sim: SimContext, who: number, order: number): Refusal | null {
  const s = sim.state;
  const m = s.inmates[who];
  if (!m || !s.followers.includes(who)) return 'opinion';
  const e = crewEntry(s, who);
  // Mid-brawl, or bringing the player the drop: that comes first.
  if (e?.[ORD] === ORDER.BRAWL || (order !== ORDER.NIGHT && e?.[ORD] === ORDER.FETCH && e[ARG] < 0)) return 'crewBusy';
  if (order === ORDER.NIGHT) return e?.[NIGHT] || m.opinion >= NIGHT_OPINION ? null : 'nightOpinion';
  // (Lights Out: anyone not staying the night is off to bed; tonight's the night first.)
  if (ROUTINE[s.routine].id === 'lightsOut' && !e?.[NIGHT]) return 'crewNight';
  if (order === ORDER.FOLLOW) return null;
  const line = LINE_OF[order];
  if (!line) return 'notHisLine';
  if (specialityOf(sim.world, who, m.cell) !== line) return 'notHisLine';
  // A post: on the ground floor, not in a doorway nor a work room (someone standing there would hold its door open).
  if (order === ORDER.WATCH && !postable(sim.world, tileAt(m.body.x, m.body.z))) return 'badPost';
  if (order === ORDER.BRAWL) {
    if (s.lockdown) return 'crewLockdown';
    if (s.brawled === prisonDay(s.step)) return 'brawlToday';
    if (brawlWith(sim, who) < 0) return 'noBrawl';
  }
  if (order === ORDER.FETCH) {
    if (s.lockdown) return 'crewLockdown';
    if (e?.[ORD] === ORDER.FETCH) return 'crewBusy';
    if (!s.drops.length) return 'noDrop';
  }
  return null;
}

/** An order to a follower (TALK.CREW). */
export function crewOrder(sim: SimContext, who: number, order: number) {
  const s = sim.state;
  const why = cantOrder(sim, who, order);
  if (why) return refuse(sim, why);
  let e = crewEntry(s, who);
  // ("Follow me" to someone just following: nothing to it.)
  if (!e && order === ORDER.FOLLOW) return;
  if (!e) {
    e = [who, ORDER.FOLLOW, -1, -1, 0];
    s.crew.push(e);
  }
  if (order === ORDER.NIGHT) {
    e[NIGHT] = e[NIGHT] ? 0 : 1;
    sim.events.push(e[NIGHT] ? { type: 'crew', what: 'order', who, order: ORDER.NIGHT } : { type: 'crew', what: 'nightOff', who });
    // (Called off once Lights Out has begun: off to bed now.)
    if (!e[NIGHT] && ROUTINE[s.routine].id === 'lightsOut') dismiss(sim, who);
    tidy(s);
    return;
  }
  // (Told to do what he's doing already: nothing new.)
  if (e[ORD] === order && order !== ORDER.WATCH) return;
  // Taken off an errand with the drop in hand: he keeps it for the player.
  if (e[ORD] === ORDER.FETCH && e[ARG] < 0 && order !== ORDER.FETCH) giveBack(sim, e);
  const m = s.inmates[who];
  // (Posted again: the guards he has in sight already are no news.)
  const seen = e[ORD] === ORDER.WATCH ? e[AUX] : 0;
  e[ORD] = order;
  e[ARG] = -1;
  e[AUX] = -1;
  switch (order) {
    case ORDER.WATCH:
      // Where he stands now; the guards in sight there already he's seen (he whistles for the next to come).
      e[ARG] = tileAt(m.body.x, m.body.z);
      e[AUX] = seen | inSight(sim, m);
      break;
    case ORDER.BACK:
      // (The ambushes called off this block, by inmate bit, and the block: each told once.)
      e[ARG] = s.routine;
      e[AUX] = 0;
      break;
    case ORDER.BRAWL: {
      const other = brawlWith(sim, who);
      e[ARG] = s.step + BRAWL_STEPS;
      e[AUX] = other;
      s.brawled = prisonDay(s.step);
      const at = s.inmates[other].body;
      const sent = nearestGuards(sim, at, BRAWL_GUARDS);
      for (const k of sent) sendToLook(s.guards[k], tileAt(at.x, at.z), BRAWL_STEPS);
      sim.events.push({ type: 'crew', what: 'order', who, order }, { type: 'crew', what: 'brawl', who, other, guards: sent });
      return;
    }
    case ORDER.FETCH:
      e[ARG] = s.drops[0][0];
      e[AUX] = s.step + FETCH_STEPS;
      break;
  }
  sim.events.push({ type: 'crew', what: 'order', who, order });
  tidy(s);
}

/** Whistled back (EXT.RECALL): someone with an order is at the player's heels again (not mid-brawl; a drop in hand comes anyway). */
export function recall(sim: SimContext, who: number) {
  const s = sim.state;
  const e = crewEntry(s, who);
  if (!e || e[ORD] === ORDER.FOLLOW || e[ORD] === ORDER.BRAWL || (e[ORD] === ORDER.FETCH && e[ARG] < 0)) return;
  e[ORD] = ORDER.FOLLOW;
  e[ARG] = e[AUX] = -1;
  sim.events.push({ type: 'crew', what: 'recalled', who });
  tidy(s);
}

/** A follower gone (dismissed, hit, sent to bed): his order with him; a drop he was bringing stays in his pockets. */
export function dropCrew(sim: SimContext, who: number) {
  const s = sim.state;
  const e = crewEntry(s, who);
  if (!e) return;
  if (e[ORD] === ORDER.FETCH && e[ARG] < 0) giveBack(sim, e);
  s.crew.splice(s.crew.indexOf(e), 1);
}

/** The drop he was bringing, into his own pockets, else at his feet (lost to the player, never to the game). */
function giveBack(sim: SimContext, e: CrewEntry) {
  const s = sim.state;
  const pockets = s.items.containers[pocketOf(sim.world, e[WHO])];
  const k = pockets?.indexOf(0) ?? -1;
  if (pockets && k >= 0) pockets[k] = slot(e[AUX]);
  else {
    const b = s.inmates[e[WHO]].body;
    s.items.ground.push([placeKey(LAYER.GROUND, tileAt(b.x, b.z)), slot(e[AUX])]);
  }
  s.items.rev++;
  e[ARG] = e[AUX] = -1;
}

/** Where a lookout can be posted: open ground-floor floor, not a doorway (nor beside the player's cell door), not inside a work room. */
export function postable(w: World, tile: number): boolean {
  if (tile < 0 || w.ground.kind[tile] === TILE.DOOR || w.doorRoom[tile] || tile === w.cellDoor[1]) return false;
  const zone = w.ground.zone[tile];
  return !jobRooms(w).some((r) => r.zone === zone);
}

/** Entries with nothing left in them (following, not staying the night) go. */
function tidy(s: { crew: number[][] }) {
  for (let k = s.crew.length - 1; k >= 0; k--) if (s.crew[k][ORD] === ORDER.FOLLOW && !s.crew[k][NIGHT]) s.crew.splice(k, 1);
}

/** The inmate a muscle would brawl with: the nearest within BRAWL_RANGE he can see, up and about, not in the crew (-1 none). */
export function brawlWith(sim: SimContext, who: number): number {
  const s = sim.state;
  const m = s.inmates[who];
  if (!m || m.ko > 0 || s.layer !== LAYER.GROUND || sim.away) return -1;
  let best = -1;
  let bestD = (BRAWL_RANGE * UNIT) ** 2 + 1;
  s.inmates.forEach((o, k) => {
    if (k === who || s.followers.includes(k) || o.ko > 0 || o.angry > 0 || o.doing === DOING.SLEEP || s.talk === k) return;
    if (s.dice[0] === k || s.bout[0] === k) return;
    const d = (o.body.x - m.body.x) ** 2 + (o.body.z - m.body.z) ** 2;
    if (d >= bestD || !lineOfSight(sim.world, m.body.x, m.body.z, o.body.x, o.body.z)) return;
    bestD = d;
    best = k;
  });
  return best;
}

/** The guards a brawl draws: the nearest awake (straight line; ties, the lower index), not chasing the player, not talking with them. */
function nearestGuards(sim: SimContext, at: Body, n: number): number[] {
  const s = sim.state;
  const talking = guardTalking(s);
  const list: Array<[number, number]> = [];
  s.guards.forEach((g, k) => {
    if (!awake(g) || g.mode === GUARD.CHASE || k === talking) return;
    list.push([k, (g.body.x - at.x) ** 2 + (g.body.z - at.z) ** 2]);
  });
  list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return list.slice(0, n).map(([k]) => k);
}

/** Spots the crew are sent to this step (tile middles), one per follower slot, reused. Not state. */
const marks: Body[] = [bodyAt(0, 0), bodyAt(0, 0), bodyAt(0, 0), bodyAt(0, 0)];
function mark(k: number, tile: number): Body {
  const b = marks[k % marks.length];
  b.x = centerX(tile);
  b.z = centerZ(tile);
  return b;
}

/**
 * Where the crew's orders send them this step (socialNow, before the player's own followers):
 * a lookout to his post, a smuggler to the drop, a digger to the top of the shaft, brawlers at
 * each other; and while cells are locked, anyone who'd be in the player's cell to its door instead
 * (someone else in it would keep it from locking). Returns a mask of the followers (by place in `followers`) placed here.
 */
export function crewTargets(sim: SimContext, so: { follow: Array<Body | null>; gap: number[]; doing: number[] }): number {
  const s = sim.state;
  const w = sim.world;
  let placed = 0;
  // Cells locked (Lights Out, a lockdown): nobody of the crew stands in the player's cell (someone else in
  // it keeps its door from locking); they wait at its door instead.
  const locked = ROUTINE[s.routine].id === 'lightsOut' || s.lockdown;
  const doorstep = placesOf(w).doorstep[1];
  const inMine = s.layer === LAYER.GROUND && !sim.away && w.cellOf[tileAt(s.player.x, s.player.z)] === 1;
  s.followers.forEach((who, k) => {
    const m = s.inmates[who];
    if (!m || m.ko > 0) return;
    const e = crewEntry(s, who);
    if (!e) return;
    let to: Body | null = null;
    let gap = 0;
    let doing: number = DOING.NOTHING;
    switch (e[ORD]) {
      case ORDER.WATCH:
        to = mark(k, e[ARG]);
        doing = DOING.LOOKOUT;
        break;
      case ORDER.FETCH:
        if (e[ARG] >= 0) to = mark(k, tileOfKey(e[ARG]));
        break;
      case ORDER.DIG:
        if (e[ARG] >= 0 && e[AUX] >= 0) to = mark(k, e[AUX]);
        break;
      case ORDER.BRAWL: {
        const o = s.inmates[e[AUX]];
        if (o) {
          to = o.body;
          gap = BRAWL_GAP;
          doing = DOING.BRAWL;
          // (The one he scraps with squares up to him.)
          so.follow[e[AUX]] = m.body;
          so.gap[e[AUX]] = BRAWL_GAP;
          so.doing[e[AUX]] = DOING.BRAWL;
        }
        break;
      }
    }
    // Staying the night with the player off the ground floor (the vents, a tunnel): he holds where he is, never back to bed.
    if (!to && e[NIGHT] && ROUTINE[s.routine].id === 'lightsOut' && (s.layer !== LAYER.GROUND || sim.away)) to = mark(k, tileAt(m.body.x, m.body.z));
    // (Only the crew with orders: a plain follower does as followers always did, old run logs and all.)
    if (e && locked && doorstep >= 0 && (to ? w.cellOf[tileAt(to.x, to.z)] === 1 || tileAt(to.x, to.z) === w.cellDoor[1] : inMine)) {
      to = mark(k, doorstep);
      gap = 0;
      doing = DOING.NOTHING;
    }
    if (!to) return;
    so.follow[who] = to;
    so.gap[who] = gap;
    so.doing[who] = doing;
    placed |= 1 << k;
  });
  return placed;
}

/**
 * The crew, each step (after the side games): lookouts whistle, a brawl runs its course, a
 * smuggler picks up the drop and hands it over, a digger learns where the player went down,
 * Lights Out sends to bed whoever isn't staying the night, and 06:00 those who did.
 */
export function crew(sim: SimContext) {
  const s = sim.state;
  if (!s.followers.length) return;
  const w = sim.world;
  const lightsOut = ROUTINE[s.routine].id === 'lightsOut';
  // 06:00: the night's company goes back to bed; at Lights Out, nobody else is up with the player.
  const dawn = s.step % STEPS_PER_MINUTE === 0 && clockAt(s.step).minuteOfDay === NIGHT_UNTIL;
  for (const who of [...s.followers]) {
    const night = nightOf(s, who);
    if (dawn && night) {
      sim.events.push({ type: 'crew', what: 'nightOver', who });
      dismiss(sim, who);
    } else if (lightsOut && !night && crewEntry(s, who)) dismiss(sim, who);
  }
  for (const e of [...s.crew]) {
    const m = s.inmates[e[WHO]];
    if (!m || !s.crew.includes(e)) continue;
    switch (e[ORD]) {
      case ORDER.WATCH:
        // (His post walled up, dug through or blocked since: he comes back to the player.)
        if (w.npcBlock[e[ARG]]) {
          e[ORD] = ORDER.FOLLOW;
          e[ARG] = e[AUX] = -1;
          sim.events.push({ type: 'crew', what: 'recalled', who: e[WHO] });
        } else whistles(sim, e);
        break;
      case ORDER.BRAWL:
        if (s.step >= e[ARG] || m.ko > 0 || (s.inmates[e[AUX]]?.ko ?? 1) > 0 || s.lockdown) {
          sim.events.push({ type: 'crew', what: 'brawlOver', who: e[WHO], other: e[AUX] });
          e[ORD] = ORDER.FOLLOW;
          e[ARG] = e[AUX] = -1;
        }
        break;
      case ORDER.FETCH:
        fetch(sim, e);
        break;
      case ORDER.DIG:
        // (Back up, or the shaft filled in: at the player's side again.)
        if (s.layer === LAYER.GROUND || (e[ARG] >= 0 && w.ground.kind[e[ARG]] !== TILE.SHAFT)) e[ARG] = e[AUX] = -1;
        else if (s.layer === LAYER.UNDER && sim.movedBy === 'climbDown' && m.ko <= 0) {
          // Down the hole: he saw where, if he was at the player's side; he waits beside it.
          const t = tileAt(s.player.x, s.player.z);
          if (cheb(m.body, { x: centerX(t), z: centerZ(t) }) <= (DIG_REACH + 1) * UNIT) {
            e[ARG] = t;
            e[AUX] = besideOnGround(w, t, [], false);
          }
        }
        break;
    }
  }
  tidy(s);
}

/** The awake guards within WATCH_RANGE of someone, in his sight (bit k = guard k). */
function inSight(sim: SimContext, m: { body: Body; ko: number }): number {
  let now = 0;
  if (m.ko <= 0)
    sim.state.guards.forEach((g, k) => {
      if (!awake(g)) return;
      const dx = g.body.x - m.body.x;
      const dz = g.body.z - m.body.z;
      if (dx * dx + dz * dz > (WATCH_RANGE * UNIT) ** 2 || !lineOfSight(sim.world, m.body.x, m.body.z, g.body.x, g.body.z)) return;
      now |= 1 << k;
    });
  return now;
}

/** A lookout on watch: a whistle for each awake guard newly within WATCH_RANGE of him, in his sight. */
function whistles(sim: SimContext, e: CrewEntry) {
  const s = sim.state;
  const now = inSight(sim, s.inmates[e[WHO]]);
  const fresh = now & ~e[AUX];
  e[AUX] = now;
  for (let k = 0; k < s.guards.length; k++) if (fresh & (1 << k)) sim.events.push({ type: 'crew', what: 'whistle', who: e[WHO], guard: k });
}

/** A smuggler's errand: to the drop (gone, or too long getting there: given up), then back to the player's pockets. */
function fetch(sim: SimContext, e: CrewEntry) {
  const s = sim.state;
  const m = s.inmates[e[WHO]];
  if (e[ARG] >= 0) {
    const key = e[ARG];
    const d = s.drops.findIndex((x) => x[0] === key);
    const why = d < 0 ? 'gone' : s.step >= e[AUX] || s.lockdown ? 'far' : null;
    if (why) {
      sim.events.push({ type: 'crew', what: 'fetchFailed', who: e[WHO], why });
      e[ORD] = ORDER.FOLLOW;
      e[ARG] = e[AUX] = -1;
      return;
    }
    const t = tileOfKey(key);
    if (m.ko > 0 || cheb(m.body, { x: centerX(t), z: centerZ(t) }) > FETCH_REACH) return;
    // There: picked up (off the ground, no longer a drop for the guards to seize).
    const item = s.drops[d][1];
    const g = s.items.ground.findIndex(([k, v]) => k === key && itemOf(v) === item);
    // (Picked up by someone else this very step: gone.)
    if (g < 0) {
      sim.events.push({ type: 'crew', what: 'fetchFailed', who: e[WHO], why: 'gone' });
      e[ORD] = ORDER.FOLLOW;
      e[ARG] = e[AUX] = -1;
      return;
    }
    s.items.ground.splice(g, 1);
    s.items.rev++;
    s.drops.splice(d, 1);
    e[ARG] = -1;
    e[AUX] = item;
    sim.events.push({ type: 'crew', what: 'fetched', who: e[WHO], item });
    return;
  }
  // Back with it: into the player's hotbar once he's at their side and there's room.
  if (m.ko > 0 || s.layer !== LAYER.GROUND || sim.away || s.stowed || cheb(m.body, s.player) > TALK_REACH + UNIT / 4) return;
  const inv = s.items.inv;
  const free = inv.slice(0, HOTBAR).indexOf(0);
  if (free < 0) return;
  inv[free] = slot(e[AUX]);
  s.items.rev++;
  sim.events.push({ type: 'crew', what: 'handed', who: e[WHO], item: e[AUX] });
  e[ORD] = ORDER.FOLLOW;
  e[ARG] = e[AUX] = -1;
}

/**
 * What a digger's help makes of a strike (out of 4: 4 none): on the ground floor, chipping or
 * digging with him at the player's side; down a tunnel, digging with him at the top of the shaft.
 * The digger helping (inmate index) in `out[0]`, -1 none.
 */
export function digHelp(sim: SimContext, action: string, layer: number, out: number[]): number {
  const s = sim.state;
  out[0] = -1;
  const ground = s.layer === LAYER.GROUND && layer === LAYER.GROUND && (action === 'chip' || action === 'dig');
  const under = s.layer === LAYER.UNDER && (action === 'dig' || action === 'digUp');
  if (!ground && !under) return 4;
  for (const e of s.crew) {
    if (e[ORD] !== ORDER.DIG) continue;
    const m = s.inmates[e[WHO]];
    if (!m || m.ko > 0) continue;
    if (ground && e[ARG] < 0 && cheb(m.body, s.player) <= DIG_REACH * UNIT && lineOfSight(sim.world, m.body.x, m.body.z, s.player.x, s.player.z)) {
      out[0] = e[WHO];
      return DIG_HELP;
    }
    if (under && e[ARG] >= 0 && sim.world.ground.kind[e[ARG]] === TILE.SHAFT && cheb(m.body, { x: centerX(e[ARG]), z: centerZ(e[ARG]) }) <= SHAFT_REACH * UNIT) {
      out[0] = e[WHO];
      return SHAFT_HELP;
    }
  }
  return 4;
}

/**
 * An ambush drawn (social.ts grudges): stopped by a muscle watching the player's back close by,
 * said once a block for each would-be attacker (the draw goes on every step). Whether it's stopped.
 */
export function stopAmbush(sim: SimContext, who: number): boolean {
  const s = sim.state;
  const back = backedBy(sim);
  if (back < 0) return false;
  const e = crewEntry(s, back)!;
  if (e[ARG] !== s.routine) {
    e[ARG] = s.routine;
    e[AUX] = 0;
  }
  if (!(e[AUX] & (1 << who))) {
    e[AUX] |= 1 << who;
    sim.events.push({ type: 'crew', what: 'stopped', who: back, other: who });
  }
  return true;
}

/** A muscle watching the player's back close by them, up and about (inmate index, -1 none). */
export function backedBy(sim: SimContext): number {
  const s = sim.state;
  for (const e of s.crew) {
    if (e[ORD] !== ORDER.BACK) continue;
    const m = s.inmates[e[WHO]];
    if (m && m.ko <= 0 && m.angry <= 0 && cheb(m.body, s.player) <= BACK_REACH * UNIT) return e[WHO];
  }
  return -1;
}

/** A follower's blow, with a muscle watching the player's back half as hard again. */
export const allyDamage = (s: { crew: number[][] }, who: number, dmg: number) => (orderOf(s, who) === ORDER.BACK ? Math.floor((dmg * BACK_HELP) / 2) : dmg);

/** The ways out the crew can come along on (never through a hole, down a rope, or hidden in a vehicle). */
export const CREW_ROUTES: ReadonlySet<EscapeRoute> = new Set(['fence', 'gate', 'takeover', 'raft', 'helicopter']);

/** Who slips out with the player (inmate indexes): the crew up and about within CREW_ESCAPE_REACH of them, on a way out they can take. */
export function crewEscape(sim: SimContext, via: EscapeRoute): number[] {
  const s = sim.state;
  if (!CREW_ROUTES.has(via)) return [];
  return s.followers.filter((who) => {
    const m = s.inmates[who];
    return !!m && m.ko <= 0 && cheb(m.body, s.player) <= CREW_ESCAPE_REACH * UNIT && lineOfSight(sim.world, m.body.x, m.body.z, s.player.x, s.player.z);
  });
}
