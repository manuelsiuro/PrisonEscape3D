/**
 * Gangs and turf (2.36, session 16; content/gangs.ts, PrisonDef.gangs). Two or three cliques a prison,
 * their members fixed by cell (no draw), in their colours from the start. Once the player has had a word with
 * a member (`metGangs`), from prison day 2, at dinner and in the evening's free time, each holds its turf: its
 * canteen table and its corner of the yard (inmates.ts seats them there).
 *
 * The player joins by asking a gang's boss (a merchant) once the boss thinks well enough of them: an
 * initiation favor, the gang's tribute taken from a rival boss's desk (always there: put there on taking
 * it on). A member gets the boss's goods cheaper (economy.ts `priceOf`), gang mates close by come in on
 * their side in a fight with an inmate, and nobody with a grudge jumps them with a mate that close. The
 * cost: every rival thinks less of them, and a rival gang's turf is no place to stand while it's held (told
 * to clear off, a moment to do it, then one of them squares up). On the gang war's day (the day card, from
 * 15:05) two gangs settle it at the first's corner of the yard: their members brawl there, guards are drawn
 * to it, and a member of either side who comes close is gone for by a rival once.
 *
 * A player who never speaks to a gang member changes nothing (no state, no draw, nobody seated by gang): the
 * escape bots' runs stay as they were. The war day is the deck's (its card in place of another, as earlier cards).
 */
import { GANGS, type GangDef, TRIBUTE } from '../../content/gangs';
import { itemNumber } from '../../content/items';
import { ROUTINE } from '../../content/routine';
import { BACK_REACH, BRAWL_GAP } from '../../content/crew';
import { placesOf } from '../ai/places';
import { lineOfSight } from '../ai/sight';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import {
  AMBUSH_WINDUP_STEPS,
  ANGRY_STEPS,
  FAVORS_TAKEN,
  GANG_BACKUP_RANGE,
  GANG_FROM_DAY,
  GANG_JOIN_OPINION,
  GANG_LEAVE_OPINION,
  GANG_OPINION,
  GANG_RIVAL_OPINION,
  GANG_WAR_GROUND,
  GANG_WAR_REACH,
  TRESPASS_COOLDOWN,
  STEPS_PER_MINUTE,
  TRESPASS_STEPS,
  UNIT,
} from '../tuning';
import { containersOf } from '../world/containers';
import { centerX, centerZ, tileAt } from '../world/grid';
import { LAYER, layerOfKey, MAP_W, tileOfKey, type World } from '../world/World';
import { prisonDay } from './clock';
import { crowdPlan, eventOn, planOf, today } from './calendar';
import { dist2 } from './combat';
import { type Favor, FAVOR, FAVOR_STATE, priceOf } from './economy';
import { DOING, type Inmate, inmateInCell } from './inmates';
import { HOTBAR, itemOf, slot, usesOf } from './items';
import { HOLLOW_BOOK } from './structure';
import type { Body } from './movement';
import { bodyAt } from './movement';
import { hearingToday } from './parole';
import { twist } from './twists';
import { holidayDays } from './holiday';
import { changeOpinion, endTalk, refuse } from './social';

/** The places in `state.gang` (see SimState.gang). */
export const G = { ID: 0, WARN: 1, TURF: 2, JUMPED: 3, WAR: 4, LEFT: 5, SINCE: 6, MET: 7 } as const;

/** Gangs here and now: the prison has them, and the run isn't a log from before 2.36. */
export const gangsHere = (sim: Pick<SimContext, 'rules235' | 'world'>) => !sim.rules235 && !!sim.world.def.gangs?.length;

/** The gang (its place in the prison's `gangs`) a cell's inmate belongs to, -1 none. */
export function gangOfCell(def: World['def'], cell: number): number {
  const list = def.gangs;
  if (!list) return -1;
  for (let k = 0; k < list.length; k++) if (list[k].members.includes(cell)) return k;
  return -1;
}

/** An inmate's gang (by inmate index), -1 none. */
export const gangOf = (sim: Pick<SimContext, 'world' | 'state'>, who: number) => {
  const m = sim.state.inmates[who];
  return m ? gangOfCell(sim.world.def, m.cell) : -1;
};

/** The player's gang (its place in the prison's `gangs`), -1 none. */
export function playerGang(sim: Pick<SimContext, 'world' | 'state'>): number {
  const g = sim.state.gang;
  if (!g || g[G.ID] <= 0) return -1;
  const id = GANGS[g[G.ID] - 1];
  return sim.world.def.gangs?.findIndex((d) => d.id === id) ?? -1;
}

/** Whether (x, z) lies in a rectangle of tiles, corners included. */
const inRect = (r: GangDef['table'], x: number, z: number, pad = 0) =>
  x >= r[0] - pad && x <= r[2] + pad && z >= r[1] - pad && z <= r[3] + pad;

/** A piece of turf: a gang's canteen table, or its corner of the yard. */
export type TurfPiece = 'table' | 'corner';

/** The gang whose turf a ground tile is (its table or its corner; one piece if given), -1 none. */
export function turfAt(def: World['def'], x: number, z: number, piece?: TurfPiece): number {
  const list = def.gangs;
  if (!list) return -1;
  for (let k = 0; k < list.length; k++)
    if ((piece !== 'corner' && inRect(list[k].table, x, z)) || (piece !== 'table' && inRect(list[k].corner, x, z))) return k;
  return -1;
}

/**
 * The gangs hold their turf now: once the player knows them (a first word with a member: `metGangs`), from
 * prison day 2 (the first day is the newcomer's), at dinner (on a film or talent night's dinner plan too) and in
 * the evening's free time; never in a lockdown. (Opt-in by meeting them: a run that never speaks to a gang
 * member, every bot's, plays as before 2.36.)
 */
export function turfHeld(sim: Pick<SimContext, 'rules235' | 'world' | 'state'>, plan: number): boolean {
  return heldPiece(sim, plan) !== null;
}

/**
 * Which piece of turf is held now (the inmates' plan: `crowdPlan`, a film or talent night's dinner too): the
 * tables at dinner, the corners in the evening's free time; null neither (the rule the talk card and How to play
 * say, and the paint shows).
 */
export function heldPiece(sim: Pick<SimContext, 'rules235' | 'world' | 'state'>, plan: number): TurfPiece | null {
  if (!gangsHere(sim) || !sim.state.gang || sim.state.lockdown || prisonDay(sim.state.step) < GANG_FROM_DAY || plan < 0) return null;
  const id = ROUTINE[plan]?.id;
  return id === 'dinner' ? 'table' : id === 'eveningFreeTime' ? 'corner' : null;
}

/** The first word with a gang member (social.ts approach): the gangs' record begins (MET: that prison day). */
export function metGangs(sim: SimContext, who: number) {
  const s = sim.state;
  if (s.gang || !gangsHere(sim) || who >= s.inmates.length || gangOf(sim, who) < 0) return;
  s.gang = [0, 0, 0, 0, 0, 0, 0, prisonDay(s.step)];
  sim.events.push({ type: 'gang', what: 'met', gang: gangOf(sim, who), who });
}

/** A merchant's boss's deal: the inmate is a member of the player's own gang (their goods cost less: economy.ts priceOf). */
export function memberDeal(sim: Pick<SimContext, 'world' | 'state' | 'rules235'>, who: number): boolean {
  if (!gangsHere(sim)) return false;
  const g = playerGang(sim);
  return g >= 0 && gangOf(sim, who) === g;
}

/** What a merchant asks the player for something worth `value`: the talk card and the till ask this. */
export const askOf = (sim: Pick<SimContext, 'world' | 'state' | 'rules235'>, who: number, value: number) =>
  priceOf(value, sim.state.inmates[who]?.opinion ?? 0, memberDeal(sim, who));

/** The gang whose boss an inmate is (by inmate index), -1 none. */
export function bossOf(sim: Pick<SimContext, 'world' | 'state'>, who: number): number {
  const m = sim.state.inmates[who];
  const list = sim.world.def.gangs;
  if (!m || !list) return -1;
  return list.findIndex((g) => g.boss === m.cell);
}

/** The rival boss a gang's initiation sends the player to (the next gang in the prison's list; its inmate index, -1 none). */
export function rivalBoss(sim: Pick<SimContext, 'world' | 'state'>, gang: number): number {
  const list = sim.world.def.gangs;
  if (!list || list.length < 2) return -1;
  return inmateInCell(sim.state, list[(gang + 1) % list.length].boss);
}

/** Why the player can't ask a boss in now ('' they can): the rules the talk card shows and TALK.JOIN keeps. */
export function joinRefusal(
  sim: SimContext,
  who: number,
): '' | 'gangHere' | 'gangOpinion' | 'inGang' | 'leftToday' | 'favors' | 'favorFirst' | 'loneWolf' | 'initiating' {
  const s = sim.state;
  const k = bossOf(sim, who);
  if (!gangsHere(sim) || k < 0 || rivalBoss(sim, k) < 0) return 'gangHere';
  if (playerGang(sim) >= 0) return 'inGang';
  if (twist(s, 'loneWolf')) return 'loneWolf';
  if (s.gang && s.gang[G.LEFT] === prisonDay(s.step)) return 'leftToday';
  if (s.inmates[who].opinion < GANG_OPINION) return 'gangOpinion';
  // (One initiation at a time: proving oneself to two gangs at once would be a way to switch for free.)
  if (s.favors.some((x) => x.kind === FAVOR.INITIATION && x.by !== who)) return 'initiating';
  const f = s.favors.find((x) => x.by === who);
  if (f && f.state !== FAVOR_STATE.OFFERED) return f.kind === FAVOR.INITIATION ? 'gangHere' : 'favorFirst';
  if (s.favors.filter((x) => x.state !== FAVOR_STATE.OFFERED).length >= FAVORS_TAKEN) return 'favors';
  return '';
}

/**
 * TALK.JOIN: the player asks a boss in. The initiation favor, taken on at once (any favor he had on offer
 * gives way to it): the gang's tribute, which is put in the rival boss's desk now (the first free drawer, else
 * the last), so it's always there to take. Handed in (social.ts), the player is in.
 */
export function askToJoin(sim: SimContext, who: number) {
  const s = sim.state;
  const why = joinRefusal(sim, who);
  if (why === 'gangHere') return;
  if (why) return refuse(sim, why);
  const k = bossOf(sim, who);
  const rival = rivalBoss(sim, k);
  const item = itemNumber(TRIBUTE[sim.world.def.gangs![k].id]);
  s.favors = s.favors.filter((f) => f.by !== who);
  const f: Favor = { by: who, kind: FAVOR.INITIATION, item, target: rival, reward: 0, state: FAVOR_STATE.TAKEN };
  s.favors.push(f);
  plantTribute(sim, f);
  sim.events.push({ type: 'favor', who, kind: f.kind, state: 'taken' });
}

/** The tribute put in the rival boss's desk, if it isn't there already. */
function plantTribute(sim: SimContext, f: Favor) {
  const s = sim.state;
  const i = tributeDesk(sim, f);
  if (i < 0) return;
  const list = containersOf(sim.world);
  const want = tributeOf(f);
  // (No stray mark elsewhere: only one copy is the tribute.)
  clearTribute(sim, f, i);
  const box = s.items.containers[i];
  // (Any of the kind already in its drawers is the boss's own, so the tribute: whichever the player takes from there counts.)
  let there = false;
  for (let j = list[i].hidden; j < box.length; j++)
    if ((box[j] & 255) === f.item) {
      box[j] = want;
      there = true;
    }
  if (!there) {
    const free = box.indexOf(0, list[i].hidden);
    box[free >= 0 ? free : box.length - 1] = want;
  }
  s.items.rev++;
}

/**
 * The tribute as it lies in the rival boss's desk: the item with a mark of its own in its uses (none of the three
 * has uses), so that only it is taken for the initiation, not one bought, found or picked up elsewhere.
 */
export const TRIBUTE_MARK = 77;
export const tributeOf = (f: Pick<Favor, 'item'>) => slot(f.item, TRIBUTE_MARK);
export const isTribute = (v: number) => itemOf(v) !== HOLLOW_BOOK && usesOf(v) === TRIBUTE_MARK;
/** Whether a slot (or a hollow book in it) holds the marked tribute `want`. */
const holdsTribute = (v: number, want: number) => v === want || (itemOf(v) === HOLLOW_BOOK && usesOf(v) === want);
const unmark = (v: number, f: Pick<Favor, 'item'>) => {
  const want = tributeOf(f);
  if (v === want) return slot(f.item);
  if (itemOf(v) === HOLLOW_BOOK && usesOf(v) === want) return slot(HOLLOW_BOOK, slot(f.item));
  return v;
};

/** Strips the initiation mark from any copy of `f.item` across the prison (except container `skipBox`). */
export function clearTribute(sim: SimContext, f: Pick<Favor, 'item'>, skipBox = -1) {
  const it = sim.state.items;
  for (let k = 0; k < it.inv.length; k++) it.inv[k] = unmark(it.inv[k], f);
  for (let c = 0; c < it.containers.length; c++) {
    if (c === skipBox) continue;
    const box = it.containers[c];
    for (let j = 0; j < box.length; j++) box[j] = unmark(box[j], f);
  }
  for (let g = 0; g < it.ground.length; g++) it.ground[g][1] = unmark(it.ground[g][1], f);
  for (const r of sim.state.rats) r.carry = unmark(r.carry, f);
  it.rev++;
}

/** The hotbar slot holding what a favor asks for (an initiation: its tribute only), -1 none. */
export function favorSlot(inv: readonly number[], f: Pick<Favor, 'kind' | 'item'>): number {
  for (let k = 0; k < HOTBAR; k++) {
    const v = inv[k];
    if (f.kind === FAVOR.INITIATION ? v === tributeOf(f) : (v & 255) === f.item && v !== 0) return k;
  }
  return -1;
}

/** The rival boss's desk (its container index), where an initiation's tribute is: -1 none (the map viewer, the arrows). */
export function tributeDesk(sim: Pick<SimContext, 'world' | 'state'>, f: Favor): number {
  const w = sim.world;
  const cell = sim.state.inmates[f.target]?.cell ?? -1;
  return containersOf(w).findIndex((c) => c.table === 'inmateDesk' && w.cellOf[c.prop.z * MAP_W + c.prop.x] === cell);
}

/** Whether an initiation's marked tribute is somewhere the player can find it (pockets, own cell, rival's desk, open box, floor, rat). */
export function hasTribute(sim: Pick<SimContext, 'world' | 'state'>, f: Favor): boolean {
  const s = sim.state;
  const want = tributeOf(f);
  if (s.items.inv.some((v) => holdsTribute(v, want))) return true;
  const desk = tributeDesk(sim, f);
  if (desk >= 0 && s.items.containers[desk].some((v) => holdsTribute(v, want))) return true;
  if (s.items.open >= 0 && s.items.containers[s.items.open]?.some((v) => holdsTribute(v, want))) return true;
  const list = containersOf(sim.world);
  if (list.some((c, i) => c.mine && s.items.containers[i].some((v) => holdsTribute(v, want)))) return true;
  if (s.items.ground.some(([, v]) => holdsTribute(v, want))) return true;
  if (s.rats.some((r) => holdsTribute(r.carry, want))) return true;
  return false;
}

/** Where the floor arrows lead for an initiation under way (null: none, or already there). */
export function initiationGoal(sim: Pick<SimContext, 'world' | 'state' | 'rules235'>): ((i: number) => boolean) | null {
  if (!gangsHere(sim)) return null;
  const s = sim.state;
  const f = s.favors.find((x) => x.kind === FAVOR.INITIATION && x.state === FAVOR_STATE.TAKEN);
  if (!f) return null;
  const w = sim.world;
  const want = tributeOf(f);
  const places = placesOf(w);
  let tile = -1;
  if (s.items.inv.some((v) => holdsTribute(v, want))) {
    const boss = s.inmates[f.by];
    if (boss) tile = tileAt(boss.body.x, boss.body.z);
  } else {
    const rat = s.rats.find((r) => holdsTribute(r.carry, want));
    if (rat) tile = tileAt(rat.x, rat.z);
    else {
      const list = containersOf(w);
      const mine = list.findIndex((c, i) => c.mine && s.items.containers[i].some((v) => holdsTribute(v, want)));
      if (mine >= 0) tile = list[mine].prop.kind === 'bed' ? places.bedside[1] : places.deskside[1];
      else {
        const ground = s.items.ground.find(([k, v]) => layerOfKey(k) === LAYER.GROUND && holdsTribute(v, want));
        if (ground) tile = tileOfKey(ground[0]);
        else {
          const desk = tributeDesk(sim, f);
          const cell = s.inmates[f.target]?.cell ?? -1;
          if (desk >= 0 && cell >= 0 && s.items.containers[desk].some((v) => holdsTribute(v, want))) tile = places.deskside[cell] ?? -1;
        }
      }
    }
  }
  if (tile < 0 || tile === tileAt(s.player.x, s.player.z)) return null;
  return (i) => i === tile;
}

/** Why an initiation can't be handed in now ('' it can): already in a gang, or one was left today. */
export function handInRefusal(sim: SimContext): '' | 'inGang' | 'leftToday' {
  const s = sim.state;
  if (playerGang(sim) >= 0) return 'inGang';
  if (s.gang && s.gang[G.LEFT] === prisonDay(s.step)) return 'leftToday';
  return '';
}

/** The initiation handed in: the player is in. The gang thinks more of them, every rival less; any other initiation lapses. */
export function joinGang(sim: SimContext, gang: number) {
  const s = sim.state;
  s.favors = s.favors.filter((f) => f.kind !== FAVOR.INITIATION);
  const def = sim.world.def.gangs![gang];
  const day = prisonDay(s.step);
  const was = s.gang;
  s.gang = [GANGS.indexOf(def.id) + 1, 0, 0, 0, 0, was?.[G.LEFT] ?? 0, day, was?.[G.MET] ?? day];
  sim.events.push({ type: 'gang', what: 'joined', gang, who: inmateInCell(s, def.boss) });
  s.inmates.forEach((m, who) => {
    const k = gangOfCell(sim.world.def, m.cell);
    if (k === gang) changeOpinion(sim, who, GANG_JOIN_OPINION);
    else if (k >= 0) changeOpinion(sim, who, -GANG_RIVAL_OPINION);
  });
}

/** TALK.LEAVE, at the player's own boss: out of the gang (the gang thinks less of them; no joining another until tomorrow). */
export function leaveGang(sim: SimContext, who: number) {
  const g = playerGang(sim);
  if (g < 0 || bossOf(sim, who) !== g) return;
  out(sim, g, 'left', who);
}

/** For R's next lock: a member's own gang mates passed over (undefined: in no gang, nothing passed over). */
export function ownMate(sim: SimContext): ((id: number) => boolean) | undefined {
  const g = playerGang(sim);
  if (g < 0 || !gangsHere(sim)) return undefined;
  return (id) => id < sim.state.inmates.length && gangOf(sim, id) === g;
}

/** A blow at one of the player's own gang: thrown out (social.ts warns of it on the talk card, How to play says so). */
export function hitOwn(sim: SimContext, who: number) {
  const g = playerGang(sim);
  if (g >= 0 && gangOf(sim, who) === g) out(sim, g, 'kicked', who);
}

function out(sim: SimContext, gang: number, what: 'left' | 'kicked', who: number) {
  const s = sim.state;
  const g = s.gang!;
  g[G.ID] = 0;
  g[G.WARN] = 0;
  g[G.TURF] = 0;
  g[G.LEFT] = prisonDay(s.step);
  sim.events.push({ type: 'gang', what, gang, who });
  s.inmates.forEach((m, k) => {
    if (gangOfCell(sim.world.def, m.cell) === gang) changeOpinion(sim, k, -GANG_LEAVE_OPINION);
  });
}

/** Up and about to hold turf or fight: awake, calm, not following the player, not talking to them. */
const about = (sim: SimContext, m: Inmate, who: number) =>
  m.ko <= 0 && m.angry <= 0 && !sim.state.followers.includes(who) && sim.state.talk !== who;

/** The player somewhere a gang's business can reach them: on the ground floor, about, not hidden, not before the board. */
const reachable = (sim: SimContext) => {
  const s = sim.state;
  return s.layer === LAYER.GROUND && !sim.away && !s.stowed && !s.lockdown && !s.hearing && !hearingToday(s);
};

/** An inmate squares up to the player, the "!" over its head (as an ambush: a moment to fight or run). */
function squareUp(sim: SimContext, who: number) {
  const m = sim.state.inmates[who];
  m.angry = ANGRY_STEPS;
  m.windup = AMBUSH_WINDUP_STEPS;
  m.doing = DOING.NOTHING;
  m.wait = 0;
  if (sim.state.talk === who) endTalk(sim);
}

/**
 * Each step (after the crew): a member on a rival gang's turf while it's held is told to clear off
 * (TRESPASS_STEPS to do it), then the nearest of them squares up; off it, nothing. On the war's day, a member
 * of either side close to its ground is gone for once by the nearest rival there.
 */
export function gangs(sim: SimContext) {
  const s = sim.state;
  if (!gangsHere(sim)) return;
  for (const f of s.favors) if (f.kind === FAVOR.INITIATION && f.state === FAVOR_STATE.TAKEN && !hasTribute(sim, f)) plantTribute(sim, f);
  const g = s.gang;
  if (!g) return;
  const mine = playerGang(sim);
  if (mine < 0 || !reachable(sim)) {
    if (g[G.WARN]) clearWarning(sim, false);
    return;
  }
  trespass(sim, mine);
  warJump(sim, mine);
}

function clearWarning(sim: SimContext, said: boolean) {
  const g = sim.state.gang!;
  const turf = g[G.TURF] - 1;
  g[G.WARN] = 0;
  g[G.TURF] = 0;
  if (said) sim.events.push({ type: 'gang', what: 'clear', gang: sim.world.def.gangs!.findIndex((d) => d.id === GANGS[turf]) });
}

/** Rival members holding a piece of a gang's turf now (on it or a tile off it, up and about), nearest the player first. */
function holders(sim: SimContext, gang: number, piece: TurfPiece): number[] {
  const s = sim.state;
  const def = sim.world.def.gangs![gang];
  const p = s.player;
  const out: number[] = [];
  s.inmates.forEach((m, who) => {
    if (!def.members.includes(m.cell) || !about(sim, m, who)) return;
    const x = Math.floor(m.body.x / UNIT);
    const z = Math.floor(m.body.z / UNIT);
    if (inRect(def[piece], x, z, 1)) out.push(who);
  });
  return out.sort((a, b) => dist2(s.inmates[a].body, p) - dist2(s.inmates[b].body, p) || a - b);
}

/**
 * A member on a rival's held turf (the piece held now: the table at dinner, the corner in the evening), its holders
 * there: told by one who sees them, TRESPASS_STEPS to get off, then the nearest who sees them squares up. Out of all
 * their sight the countdown waits (it never runs out unseen); the holders gone, or the player off it, it's over.
 */
function trespass(sim: SimContext, mine: number) {
  const s = sim.state;
  const g = s.gang!;
  const p = s.player;
  const x = Math.floor(p.x / UNIT);
  const z = Math.floor(p.z / UNIT);
  const piece = heldPiece(sim, crowdPlan(sim, s.routine));
  const t = piece ? turfAt(sim.world.def, x, z, piece) : -1;
  const rival = t >= 0 && t !== mine;
  const there = rival ? holders(sim, t, piece!) : [];
  if (!there.length) {
    // (Off it: said so. Still on it, its holders gone: over without a word.)
    if (g[G.WARN]) clearWarning(sim, !rival);
    return;
  }
  if (s.step - g[G.JUMPED] < TRESPASS_COOLDOWN && g[G.JUMPED] > 0) return;
  const seeing = there.filter((k) => lineOfSight(sim.world, s.inmates[k].body.x, s.inmates[k].body.z, p.x, p.z));
  const id = GANGS.indexOf(sim.world.def.gangs![t].id) + 1;
  if (!g[G.WARN] || g[G.TURF] !== id) {
    if (!seeing.length) return;
    g[G.WARN] = s.step;
    g[G.TURF] = id;
    sim.events.push({ type: 'gang', what: 'warn', gang: t, who: seeing[0] });
    return;
  }
  // (Nobody of them sees the player just now: the countdown waits.)
  if (!seeing.length) {
    g[G.WARN] = Math.min(s.step, g[G.WARN] + 1);
    return;
  }
  if (s.step - g[G.WARN] < TRESPASS_STEPS) return;
  // (Time's up: the nearest who can see the player squares up.)
  const who = seeing[0];
  squareUp(sim, who);
  g[G.WARN] = 0;
  g[G.TURF] = 0;
  g[G.JUMPED] = s.step;
  sim.events.push({ type: 'gang', what: 'jumped', gang: t, who });
}

/**
 * The gangs at war on a prison day (today by default; their places in the prison's `gangs`): the first holds
 * the ground. Drawn from the day alone (no draw from the state's RNG), so the forecast names them. Null: no war
 * that day, no gangs here, or summer's water fight that day (a truce).
 */
export function warring(
  sim: Pick<SimContext, 'world' | 'state' | 'prison' | 'rules235'>,
  day = prisonDay(sim.state.step),
): [number, number] | null {
  const list = sim.world.def.gangs;
  if (!gangsHere(sim) || !list || list.length < 2) return null;
  if ((day === prisonDay(sim.state.step) ? today(sim) : planOf(sim, day)).event !== 'gangWar') return null;
  // (Summer's water fight, the same hour out on the sports ground with its guard posted: a truce, the gangs keep the peace.)
  if (holidayDays(sim, day).includes('waterFight')) return null;
  const pairs: Array<[number, number]> = [];
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) pairs.push([a, b]);
  return pairs[rollInt(sim.state.salt, SALT.GANG_WAR, day, 0, pairs.length)];
}

/** The war's ground: the floor tile nearest the middle of the first gang's corner. */
export function warGround(w: World, gang: number): number {
  const c = w.def.gangs![gang].corner;
  const mx = Math.floor((c[0] + c[2]) / 2);
  const mz = Math.floor((c[1] + c[3]) / 2);
  let best = mz * MAP_W + mx;
  let bestD = Infinity;
  for (let x = c[0]; x <= c[2]; x++)
    for (let z = c[1]; z <= c[3]; z++) {
      if (w.blocked(x, z)) continue;
      const d = (x - mx) ** 2 + (z - mz) ** 2;
      if (d < bestD) {
        bestD = d;
        best = z * MAP_W + x;
      }
    }
  return best;
}

/** The war is on now (from its start to its end, the day card's hours). */
export const warOn = (sim: SimContext) => !!warring(sim) && eventOn(sim, 'gangWar');

function warJump(sim: SimContext, mine: number) {
  const s = sim.state;
  const g = s.gang!;
  const war = warOn(sim) ? warring(sim) : null;
  if (!war || !war.includes(mine) || g[G.WAR] === prisonDay(s.step)) return;
  const ground = warGround(sim.world, war[0]);
  const p = s.player;
  const reach = GANG_WAR_REACH * UNIT;
  if ((centerX(ground) - p.x) ** 2 + (centerZ(ground) - p.z) ** 2 > reach * reach) return;
  const rival = war[0] === mine ? war[1] : war[0];
  const def = sim.world.def.gangs![rival];
  let best = -1;
  let bestD = reach * reach;
  s.inmates.forEach((m, who) => {
    if (!def.members.includes(m.cell) || m.ko > 0 || s.followers.includes(who)) return;
    const d = dist2(m.body, p);
    if (d > bestD || !lineOfSight(sim.world, m.body.x, m.body.z, p.x, p.z)) return;
    bestD = d;
    best = who;
  });
  if (best < 0) return;
  squareUp(sim, best);
  g[G.WAR] = prisonDay(s.step);
  sim.events.push({ type: 'gang', what: 'warJump', gang: rival, who: best });
}

/** The war's start (calendar.ts): the guards nearest its ground are drawn there for as long as it lasts. */
export function warStarts(sim: SimContext, minutes: number, guards: number, summon: (tile: number, n: number, look: number) => void) {
  const war = warring(sim);
  if (!war) return;
  summon(warGround(sim.world, war[0]), guards, minutes * STEPS_PER_MINUTE);
}

/** Spots the war's brawlers head for this step (tile middles), reused. Not state. */
const marks: Body[] = Array.from({ length: 24 }, () => bodyAt(0, 0));

/**
 * Where gang business sends inmates this step (socialNow, after the crew and the followers): on the war's
 * day, the two sides to its ground and at each other there (a brawl, as the crew's: nobody's hurt); a member's
 * gang mates close by (GANG_BACKUP_RANGE, in sight) at whoever is after the player. Returns the gang mates
 * backing the player (inmate indexes), whose blows fights.ts lands.
 */
export function gangTargets(
  sim: SimContext,
  so: { follow: Array<Body | null>; gap: number[]; doing: number[] },
  allyFoe: number[],
  backers: number[],
) {
  backers.length = 0;
  if (!gangsHere(sim)) return;
  const s = sim.state;
  const war = warOn(sim) ? warring(sim) : null;
  if (war) {
    const ground = warGround(sim.world, war[0]);
    const gx = centerX(ground);
    const gz = centerZ(ground);
    const near = GANG_WAR_GROUND * UNIT;
    const c = sim.world.def.gangs![war[0]].corner;
    const floor: number[] = [];
    for (let z = c[1]; z <= c[3]; z++) for (let x = c[0]; x <= c[2]; x++) if (!sim.world.blocked(x, z)) floor.push(z * MAP_W + x);
    const side = (k: number) =>
      sim.world.def
        .gangs![k].members.map((c) => inmateInCell(s, c))
        .filter((who) => who >= 0 && so.follow[who] === null && about(sim, s.inmates[who], who));
    const a = side(war[0]);
    const b = side(war[1]);
    const there = (who: number) => (s.inmates[who].body.x - gx) ** 2 + (s.inmates[who].body.z - gz) ** 2 <= near * near;
    const send = (who: number, foe: number, n: number) => {
      // (To the ground first; there, at the one across from them who's there too.)
      if (foe >= 0 && there(who) && there(foe)) {
        so.follow[who] = s.inmates[foe].body;
        so.gap[who] = BRAWL_GAP;
        so.doing[who] = DOING.BRAWL;
        return;
      }
      const mk = marks[n % marks.length];
      // (Spread over the corner's floor, by cell: not all on one tile.)
      const t = floor[s.inmates[who].cell % floor.length] ?? ground;
      mk.x = centerX(t);
      mk.z = centerZ(t);
      so.follow[who] = mk;
      so.gap[who] = 0;
      so.doing[who] = DOING.NOTHING;
    };
    if (a.length && b.length) {
      a.forEach((who, k) => send(who, b[k % b.length], k));
      b.forEach((who, k) => send(who, a[k % a.length], a.length + k));
    }
  }
  // Backup: the player's gang mates close by, at whoever is after them.
  const mine = playerGang(sim);
  if (mine < 0 || s.layer !== LAYER.GROUND || sim.away) return;
  const p = s.player;
  const range = GANG_BACKUP_RANGE * UNIT;
  let foe = -1;
  let foeD = Infinity;
  s.inmates.forEach((o, id) => {
    if (o.angry <= 0 || o.ko > 0 || o.windup > 0 || gangOf(sim, id) === mine || s.followers.includes(id)) return;
    const d = dist2(o.body, p);
    if (d < foeD) {
      foeD = d;
      foe = id;
    }
  });
  if (foe < 0) return;
  const f = s.inmates[foe];
  for (const c of sim.world.def.gangs![mine].members) {
    const who = inmateInCell(s, c);
    if (who < 0 || !about(sim, s.inmates[who], who) || so.follow[who] !== null) continue;
    const m = s.inmates[who];
    if (dist2(m.body, f.body) > range * range || !lineOfSight(sim.world, m.body.x, m.body.z, f.body.x, f.body.z)) continue;
    so.follow[who] = f.body;
    so.gap[who] = 820;
    so.doing[who] = DOING.NOTHING;
    allyFoe[who] = foe;
    if (!backers.includes(who)) {
      backers.push(who);
    }
  }
}

/** A gang mate of the player's this close (BACK_REACH, a muscle's reach), up and about: nobody with a grudge jumps them (social.ts grudges). */
export function mateClose(sim: SimContext): boolean {
  const mine = playerGang(sim);
  if (mine < 0 || !gangsHere(sim)) return false;
  const s = sim.state;
  const r = BACK_REACH * UNIT;
  return sim.world.def.gangs![mine].members.some((c) => {
    const who = inmateInCell(s, c);
    const m = who >= 0 ? s.inmates[who] : null;
    return !!m && m.ko <= 0 && m.angry <= 0 && dist2(m.body, s.player) <= r * r;
  });
}

/** What's left of a warning off a rival's turf (steps; the HUD's countdown), -1 none. */
export function warningLeft(sim: Pick<SimContext, 'state'>): number {
  const g = sim.state.gang;
  if (!g || !g[G.WARN]) return -1;
  return Math.max(0, TRESPASS_STEPS - (sim.state.step - g[G.WARN]));
}
