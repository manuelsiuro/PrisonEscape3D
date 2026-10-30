/**
 * The odd jobs board (P40, docs/PLAN.md §13): a cork board on a canteen wall (`PrisonDef.board`).
 *
 * - **The board** holds PINS jobs a prison day, dealt by roll() (SALT.ODDJOBS) from what the
 *   prison has (`kindsHere`): a deal never asks for something it lacks. A pin taken stays taken
 *   for the day. The story chain's next step is pinned beside them (from CHAIN_DAY, a step a day).
 * - **The fixer** (P21) offers a job of his own each prison day (SALT.FIXER_JOB): the riskier
 *   kinds, better paid, a rare item on top. Taken by talking to him (TALK.ODD_JOB).
 * - **One job at a time**, until 08:00 after its last day (taken from 18:00, its days count from
 *   the next prison day). What it hands over goes into the hotbar (the parcel, the stash, the
 *   note); what it lifts is put where it's to be found (a guard's pockets, the kitchen freezer),
 *   and counts only once it's out of there. Its work done by 08:00 (or what's to be brought in hand
 *   then), it waits to be handed in to the one who asked (TALK.JOB_IN), with no time limit: cash,
 *   maybe a rare item or a debt (he owes the player one: he joins the crew whatever he thinks of
 *   them, or hands over a tool when it's called in, TALK.CALL_IN).
 * - **Failing** (the time up, given up, seen, the wrong result, the dig found): the job goes and
 *   the one who asked thinks less of the player; a frame caught out brings heat.
 *
 * Nothing changes for anyone until the player takes a job (the escape bots never do): the deals
 * are pure, and only a lookout's digger walks anywhere he wouldn't. Never the state's RNG.
 */
import { BOARD, CAUGHT_TILES, J, JOB_LEN, R, STAGE, CHAIN_DAY, CHAIN_PIN, CHAINS, DEBT_ODDS, DEBT_TOOLS, DIG_STEPS, FAIL_OPINION, FALSE_STEPS, FIXER_JOB_OPINION, FIXER_PAY, FRAME_HEAT, FRAME_MINUTE, FROM, HIDE_STEPS, KIND, KIND_DEFS, KINDS, LATE_MINUTE, LIFT, LIFTS, PAID_OPINION, PERK, PERK_ODDS, PINS, RARE_ITEMS, WARN_TILES, WATCH_TILES } from '../../content/oddjobs';
import { ELDER_OPINION, GAME_OPINION, GAMES_A_DAY } from '../../content/games';
import { itemNumber } from '../../content/items';
import { LOOT } from '../../content/loot';
import { PARCEL_MINUTE } from '../../content/smuggling';
import { lineOfSight } from '../ai/sight';
import { isFloor, placesOf } from '../ai/places';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import type { OddJobFail, Refusal, SimState } from '../state';
import { STEPS_PER_MINUTE, UNIT } from '../tuning';
import { containersOf } from '../world/containers';
import { LAYER, MAP_W } from '../world/World';
import { dayMinute, planOf, prisonDay, TODAY, today } from './calendar';
import { DAY_STEPS } from './clock';
import { elderOf } from './checkers';
import { playedToday } from './games';
import { assign, awake, GUARD } from './guards';
import { DOING } from './inmates';
import { freeHotbar, HOTBAR, hotbarSlotOf, itemOf, pocketOf, slot } from './items';
import { bodyAt, type Body } from './movement';
import { commsOf, searcher } from './phone';
import { changeOpinion, refuse } from './social';
import { fixerOf, smugglingOf } from './smuggling';
import { addHeat } from './watch';
import { lookingAway } from './ways';
import { centerX, centerZ, tilesFrom, tileX, tileZ } from '../world/grid';

export { R } from '../../content/oddjobs';

const PARCEL = itemNumber('parcel');
const STASH = itemNumber('stash');
const NOTE = itemNumber('note');
const BIRTHDAY_CAKE = itemNumber('birthday_cake');

/** A job as dealt: who asks, who it's about (an inmate; a guard for a lift off one; -1 nobody), what it pays and ends with. */
export interface Deal {
  kind: number;
  variant: number;
  giver: number;
  target: number;
  days: number;
  pay: number;
  perk: number;
  /** PERK.ITEM: the item handed over (an item number; 0 none). */
  item: number;
}

/** The prison's board (none at the Training Block, whose rules are relaxed). */
export const boardOf = (sim: Pick<SimContext, 'world'>) => (sim.world.def.rules?.relaxed ? null : sim.world.def.board ?? null);

/** At the board: on its tile or one beside it, in its room, up and about on the ground floor. */
export function atBoard(sim: SimContext): boolean {
  const b = boardOf(sim);
  const s = sim.state;
  if (!b || s.layer !== LAYER.GROUND || sim.away || s.stowed || s.sleeping || s.ko > 0) return false;
  const x = Math.floor(s.player.x / UNIT);
  const z = Math.floor(s.player.z / UNIT);
  return Math.max(Math.abs(x - b.x), Math.abs(z - b.z)) <= 1 && sim.world.zoneAt(x, z) === sim.world.zoneAt(b.x, b.z);
}

/** The job held (null: none). */
export const jobOf = (s: Pick<SimState, 'oddjob'>) => (s.oddjob.length === JOB_LEN ? s.oddjob : null);
/** Handing this inmate this item delivers the job held's parcel (not a gift: what he thinks of the player stays). */
export function delivering(s: Pick<SimState, 'oddjob'>, who: number, item: number): boolean {
  const job = jobOf(s);
  return !!job && job[J.KIND] === KIND.DELIVER && job[J.STAGE] === STAGE.ON && job[J.TARGET] === who && item === PARCEL;
}

/** An inmate owes the player one (a debt from a job). */
export const owes = (s: Pick<SimState, 'oddjobs'>, who: number) => who >= 0 && who < 30 && !!(s.oddjobs[R.OWED] & (1 << who));

/** The inmate in a cell (-1 none). */
const inCell = (s: SimState, cell: number) => s.inmates.findIndex((m) => m.cell === cell);

/** An inmate's desk (its index among the containers; -1 none). */
export function deskOf(sim: Pick<SimContext, 'world' | 'state'>, who: number): number {
  const m = sim.state.inmates[who];
  if (!m) return -1;
  const w = sim.world;
  return containersOf(w).findIndex((c) => c.prop.kind === 'desk' && w.cellOf[c.prop.z * MAP_W + c.prop.x] === m.cell);
}

/** The kitchen freezer the head cook's mug is left in (-1 none). */
export const freezerOf = (sim: Pick<SimContext, 'world'>) => containersOf(sim.world).findIndex((c) => !c.mine && c.prop.kind === 'freezer');

/**
 * The guards a whistle (or a keepsake) is lifted from: those without the shakedown duty (that one's
 * pockets are full: P36's blank forms), all of them in a prison where every guard has it.
 */
function liftGuards(sim: Pick<SimContext, 'world'>): number[] {
  const defs = sim.world.def.guards;
  const pool = defs.map((d, k) => (d.duties?.includes('shakedown') ? -1 : k)).filter((k) => k >= 0);
  return pool.length ? pool : defs.map((_, k) => k);
}

/** A visit (or the Red Cross parcel's delivery day) between the day after `day` and the job's last day: a birthday cake can come in. */
export function cakeComes(sim: Pick<SimContext, 'world' | 'prison' | 'state'>, day: number, days: number): boolean {
  const d = sim.world.def.rules?.relaxed ? undefined : sim.world.def.smuggling;
  if (!d || !(d.visits || d.parcel)) return false;
  for (let k = 1; k < days; k++) {
    const e = planOf(sim, day + k).event;
    if (d.visits ? e === 'visiting' : e === 'delivery') return true;
  }
  return false;
}

/** Whether the prison has what a kind of job asks for (the giver and the day aside). */
function kindHere(sim: SimContext, kind: number): boolean {
  const w = sim.world;
  const s = sim.state;
  if (s.inmates.length < 3) return false;
  switch (kind) {
    case KIND.LIFT:
      return s.guards.length > 0 || freezerOf(sim) >= 0;
    case KIND.CHECKERS:
      return elderOf(sim) >= 0;
    case KIND.CAKE:
      return !!smugglingOf(sim) && !!(smugglingOf(sim)!.visits || smugglingOf(sim)!.parcel);
    case KIND.TIP:
      return !!commsOf(sim);
    case KIND.ERRAND:
      return w.def.merchants.length > 0;
    case KIND.LOOKOUT:
      return true;
    default:
      return true;
  }
}

/** Who can be asked about (inmates other than the one asking, with a desk where one's needed). */
function targetsFor(sim: SimContext, kind: number, giver: number): number[] {
  const s = sim.state;
  const out: number[] = [];
  if (kind === KIND.CHECKERS) return elderOf(sim) >= 0 && elderOf(sim) !== giver ? [elderOf(sim)] : [];
  if (kind === KIND.CAKE || kind === KIND.LOOKOUT) return [-1];
  if (kind === KIND.ERRAND) {
    for (const cell of sim.world.def.merchants) {
      const k = inCell(s, cell);
      if (k >= 0 && k !== giver) out.push(k);
    }
    return out;
  }
  const desk = kind === KIND.DROP || kind === KIND.FRAME || kind === KIND.RAT;
  s.inmates.forEach((_, k) => {
    if (k === giver) return;
    if (desk && deskOf(sim, k) < 0) return;
    out.push(k);
  });
  return out;
}

/** A deal's target and variant for a kind (drawn under `salt` with the number `n` for its draws); null when it can't be dealt. */
function shape(sim: SimContext, salt: number, day: number, n: number, kind: number, giver: number): { variant: number; target: number } | null {
  const s = sim.state;
  if (kind === KIND.LIFT) {
    // (A whistle off a guard, or the cook's mug from the freezer: whichever the prison has, else by roll().)
    const both = s.guards.length > 0 && freezerOf(sim) >= 0;
    const variant = both ? rollInt(s.salt, salt, day, n + 2, 2) : s.guards.length > 0 ? LIFT.WHISTLE : LIFT.MUG;
    const pool = liftGuards(sim);
    return { variant, target: variant === LIFT.WHISTLE ? pool[rollInt(s.salt, salt, day, n + 3, pool.length)] : -1 };
  }
  if (kind === KIND.CAKE && !cakeComes(sim, day, KIND_DEFS.cake.days)) return null;
  const pool = targetsFor(sim, kind, giver);
  if (!pool.length) return null;
  const target = pool[rollInt(s.salt, salt, day, n + 3, pool.length)];
  const variant = kind === KIND.WRESTLE || kind === KIND.CHEAT || kind === KIND.CHECKERS ? rollInt(s.salt, salt, day, n + 2, 2) : 0;
  return { variant, target };
}

/** What a deal ends with besides the cash (drawn under `salt`). */
function perkOf(s: SimState, salt: number, day: number, n: number): { perk: number; item: number } {
  if (rollInt(s.salt, salt, day, n + 5, 100) >= PERK_ODDS) return { perk: PERK.NONE, item: 0 };
  if (rollInt(s.salt, salt, day, n + 6, 100) < DEBT_ODDS) return { perk: PERK.DEBT, item: 0 };
  return { perk: PERK.ITEM, item: itemNumber(RARE_ITEMS[rollInt(s.salt, salt, day, n + 7, RARE_ITEMS.length)]) };
}

/** A prison's own number for its deals' draws (the same seed deals differently in each prison). */
const keyOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7) * 64;

/** The board's pins on a prison day (PINS of them, fewer only in a prison with too little), pure: roll() under SALT.ODDJOBS. */
export function dealsOf(sim: SimContext, day = prisonDay(sim.state.step)): Deal[] {
  const s = sim.state;
  if (!boardOf(sim) || s.inmates.length < 3) return [];
  const fixer = fixerOf(sim);
  const givers = s.inmates.map((_, k) => k).filter((k) => k !== fixer);
  const kinds = KINDS.map((_, k) => k).filter((k) => kindHere(sim, k));
  const out: Deal[] = [];
  const usedGiver = new Set<number>();
  const usedKind = new Set<number>();
  const key = keyOf(sim.prison.id);
  for (let pin = 0; pin < PINS; pin++) {
    const n = key + pin * 16;
    // The one who asks: drawn, the next along if he's already asked today.
    let gi = rollInt(s.salt, SALT.ODDJOBS, day, n, givers.length);
    for (let k = 0; k < givers.length && usedGiver.has(givers[gi]); k++) gi = (gi + 1) % givers.length;
    const giver = givers[gi];
    // The kind: drawn, the next along if it's pinned already or can't be dealt here today.
    let ki = rollInt(s.salt, SALT.ODDJOBS, day, n + 1, kinds.length);
    let deal: Deal | null = null;
    for (let k = 0; k < kinds.length && !deal; k++, ki = (ki + 1) % kinds.length) {
      const kind = kinds[ki];
      if (usedKind.has(kind)) continue;
      const sh = shape(sim, SALT.ODDJOBS, day, n, kind, giver);
      if (!sh) continue;
      const def = KIND_DEFS[KINDS[kind]];
      deal = { kind, ...sh, giver, days: def.days, pay: def.pay + rollInt(s.salt, SALT.ODDJOBS, day, n + 4, def.span), ...perkOf(s, SALT.ODDJOBS, day, n) };
    }
    if (!deal) continue;
    usedGiver.add(giver);
    usedKind.add(deal.kind);
    out.push(deal);
  }
  return out;
}

/** The fixer's own job on a prison day (null: no fixer, or nothing he'd ask here): his kinds, better paid, a rare item on top. */
export function fixerDeal(sim: SimContext, day = prisonDay(sim.state.step)): Deal | null {
  const s = sim.state;
  const giver = fixerOf(sim);
  if (!boardOf(sim) || giver < 0 || s.inmates.length < 3) return null;
  const kinds = KINDS.map((_, k) => k).filter((k) => KIND_DEFS[KINDS[k]].fixer && kindHere(sim, k));
  if (!kinds.length) return null;
  const n = keyOf(sim.prison.id);
  let ki = rollInt(s.salt, SALT.FIXER_JOB, day, n, kinds.length);
  for (let k = 0; k < kinds.length; k++, ki = (ki + 1) % kinds.length) {
    const sh = shape(sim, SALT.FIXER_JOB, day, n, kinds[ki], giver);
    if (!sh) continue;
    const def = KIND_DEFS[KINDS[kinds[ki]]];
    const pay = Math.round(((def.pay + rollInt(s.salt, SALT.FIXER_JOB, day, n + 4, def.span)) * FIXER_PAY) / 100);
    return { kind: kinds[ki], ...sh, giver, days: def.days, pay, perk: PERK.ITEM, item: itemNumber(RARE_ITEMS[rollInt(s.salt, SALT.FIXER_JOB, day, n + 7, RARE_ITEMS.length)]) };
  }
  return null;
}

/** The story chain's next step as a deal (null: none here, all told, not yet today, or what it needs isn't there today). */
export function chainDeal(sim: SimContext, day = prisonDay(sim.state.step)): Deal | null {
  const s = sim.state;
  const chain = CHAINS[sim.prison.id];
  // (Its step held already, from an earlier day: not pinned up a second time.)
  if (!boardOf(sim) || !chain || day < CHAIN_DAY || jobOf(s)?.[J.FROM] === FROM.CHAIN) return null;
  const k = s.oddjobs[R.CHAIN];
  const st = chain.steps[k];
  if (!st || s.oddjobs[R.CHAIN_DAY] >= day) return null;
  const giver = inCell(s, chain.who);
  if (giver < 0) return null;
  let target = st.target ? inCell(s, st.target) : -1;
  if (st.kind === KIND.CHECKERS) target = elderOf(sim);
  if (st.kind === KIND.LIFT && st.variant !== LIFT.MUG) {
    const pool = liftGuards(sim);
    target = pool.length ? pool[rollInt(s.salt, SALT.ODDJOBS, day, 900 + k, pool.length)] : -1;
  }
  if ((st.target && target < 0) || (st.kind === KIND.CAKE && !cakeComes(sim, day, KIND_DEFS.cake.days))) return null;
  return { kind: st.kind, variant: st.variant, giver, target, days: KIND_DEFS[KINDS[st.kind]].days, pay: st.pay, perk: st.perk, item: st.item ? itemNumber(st.item) : 0 };
}

/** Pin k taken today (or the story's card: CHAIN_PIN). */
export const pinTaken = (s: Pick<SimState, 'oddjobs' | 'step'>, pin: number) => s.oddjobs[R.DAY] === prisonDay(s.step) && !!(s.oddjobs[R.PINS] & (1 << pin));

/** What's on the board now: its pins (null: taken today) and the story's card. */
export function boardNow(sim: SimContext): { pins: Array<Deal | null>; chain: Deal | null } {
  const s = sim.state;
  const pins = dealsOf(sim).map((d, k) => (pinTaken(s, k) ? null : d));
  return { pins, chain: pinTaken(s, CHAIN_PIN) ? null : chainDeal(sim) };
}

/** What a job hands over as it's taken (0: nothing). */
const givesOf = (kind: number) => {
  const id = KIND_DEFS[KINDS[kind]]?.gives;
  return id ? itemNumber(id) : 0;
};
/** What a job asks to be brought (0: nothing: it's done by doing it). */
export function bringsOf(job: readonly number[]): number {
  const kind = job[J.KIND];
  if (kind === KIND.LIFT) return itemNumber(LIFTS[job[J.VAR]] ?? LIFTS[0]);
  const id = KIND_DEFS[KINDS[kind]]?.brings;
  return id ? itemNumber(id) : 0;
}

/** Whether the hotbar holds an item (its slot; -1 not). */
const carrying = (s: SimState, item: number) => hotbarSlotOf(s.items.inv, item);
/** A job whose item is to be brought, with it in hand (lifted for this job, the cake come in for it). */
const inHand = (s: SimState, job: readonly number[]) => {
  const brings = bringsOf(job);
  return !!brings && carrying(s, brings) >= 0 && (job[J.KIND] === KIND.ERRAND || job[J.PROG] > 0);
};

// ------------------------------------------------------------------ taking a job

/** Why the player can't take the deal at a pin now (null: they can). */
export function boardRefusal(sim: SimContext, pin: number): Refusal | null {
  const s = sim.state;
  if (!boardOf(sim)) return 'noBoard';
  if (jobOf(s)) return 'haveJob';
  if (s.lockdown) return 'gamesLockdown';
  if (!atBoard(sim)) return 'notAtBoard';
  if (pinTaken(s, pin)) return 'pinTaken';
  const deal = pin === CHAIN_PIN ? chainDeal(sim) : dealsOf(sim)[pin];
  if (!deal) return 'noDeal';
  if (givesOf(deal.kind) && freeHotbar(s.items.inv) < 0) return 'room';
  if (deal.kind === KIND.LIFT && !liftSpot(sim, deal.variant, deal.target)) return 'liftFull';
  return gameGate(sim, deal);
}

/**
 * A fixed game's opponent who won't play the player in its time (null: he will, or it's no game):
 * thinks too little of them (the old-timer: less), or has had his games today with a job ending tomorrow.
 * The deal itself stays as dealt (pure); the pin waits until he thinks better of the player.
 */
export function gameGate(sim: SimContext, d: Deal): Refusal | null {
  const s = sim.state;
  const m = s.inmates[d.target];
  if (!m) return null;
  if (d.kind === KIND.CHECKERS) return m.opinion < ELDER_OPINION ? 'elderOpinion' : null;
  if (d.kind !== KIND.WRESTLE && d.kind !== KIND.CHEAT) return null;
  if (m.opinion < GAME_OPINION) return 'gameOpinion';
  const today = prisonDay(s.step);
  return prisonDay(endsFor(s.step, d.days) - 1) === today && playedToday(s, d.target) >= GAMES_A_DAY ? 'played' : null;
}

/** Why the fixer's job can't be taken from him now (null: it can; `who`: the inmate talked to). */
export function fixerJobRefusal(sim: SimContext, who: number): Refusal | null {
  const s = sim.state;
  if (who !== fixerOf(sim) || !fixerDeal(sim)) return 'noDeal';
  if (jobOf(s)) return 'haveJob';
  if (!sim.fixerOpen) return 'closed';
  if (s.inmates[who].opinion < FIXER_JOB_OPINION) return 'opinion';
  if (s.eventFlags & TODAY.FIXER_JOB) return 'fixerToday';
  const deal = fixerDeal(sim)!;
  if (givesOf(deal.kind) && freeHotbar(s.items.inv) < 0) return 'room';
  if (deal.kind === KIND.LIFT && !liftSpot(sim, deal.variant, deal.target)) return 'liftFull';
  return null;
}

/** The item a Lift it job lifts, and the container it's left in for the player to find (-1: none: no freezer, no such guard). */
function liftBox(sim: Pick<SimContext, 'world' | 'state'>, variant: number, target: number): { box: number; item: number } {
  const item = itemNumber(LIFTS[variant] ?? LIFTS[0]);
  if (variant === LIFT.MUG) return { box: freezerOf(sim), item };
  return { box: target >= 0 && target < sim.state.guards.length ? pocketOf(sim.world, sim.state.inmates.length + target) : -1, item };
}

/** Anything a Lift it job leaves (a whistle, the mug, a keepsake). */
const LIFTED = LIFTS.map((id) => itemNumber(id));

/**
 * Where a Lift it job's item is left for the player to find (null: nowhere: then it isn't offered):
 * where one already is; else the first open slot past the hidden ones; full, over something an
 * earlier job left there, else over the container's own stock (the freezer's food; never what the
 * player hid there, nor a guard's key and baton).
 */
function liftSpot(sim: Pick<SimContext, 'world' | 'state'>, variant: number, target: number): { box: number; k: number; item: number } | null {
  const { box, item } = liftBox(sim, variant, target);
  const slots = box >= 0 ? sim.state.items.containers[box] : null;
  if (!slots) return null;
  const at = slots.findIndex((v) => itemOf(v) === item);
  if (at >= 0) return { box, k: at, item };
  const list = containersOf(sim.world);
  const c = box < list.length ? list[box] : null;
  const hidden = c ? c.hidden : 0;
  const k = slots.indexOf(0, hidden);
  if (k >= 0) return { box, k, item };
  for (let j = slots.length - 1; j >= hidden; j--) if (LIFTED.includes(itemOf(slots[j]))) return { box, k: j, item };
  const t = c ? LOOT[c.table] : undefined;
  const stock = t ? [...(t.fixed ?? []), ...t.items.map(([id]) => id)].map((id) => itemNumber(id)) : [];
  for (let j = slots.length - 1; j >= hidden; j--) if (stock.includes(itemOf(slots[j]))) return { box, k: j, item };
  return null;
}

/** A Lift it job's item put where it's to be found (liftSpot). */
function plant(sim: SimContext, variant: number, target: number) {
  const at = liftSpot(sim, variant, target);
  if (!at) return;
  sim.state.items.containers[at.box][at.k] = slot(at.item);
  sim.state.items.rev++;
}

/** A Lift it job gone without its item lifted: the item taken back from where it was left (so it fills nobody's pockets for good). */
function unplant(sim: SimContext, job: readonly number[]) {
  const { box, item } = liftBox(sim, job[J.VAR], job[J.TARGET]);
  const slots = box >= 0 ? sim.state.items.containers[box] : null;
  const k = slots ? slots.findIndex((v) => itemOf(v) === item) : -1;
  if (k < 0) return;
  slots![k] = 0;
  sim.state.items.rev++;
}

/**
 * A job gone: one of what it handed over (the parcel, the stash, the note) taken back if it's still
 * the player's: in the hotbar, else in their own desk (not where it was meant to go: that's the job's).
 */
function takeBack(sim: SimContext, job: readonly number[]) {
  const s = sim.state;
  const gives = givesOf(job[J.KIND]);
  if (!gives) return;
  const k = carrying(s, gives);
  if (k >= 0) s.items.inv[k] = 0;
  else {
    const { desk } = ownDesk(sim);
    const box = desk >= 0 ? s.items.containers[desk] : null;
    const j = box ? box.findIndex((v) => itemOf(v) === gives) : -1;
    if (j < 0) return;
    box![j] = 0;
  }
  s.items.rev++;
}

/** How many of an item a container holds (from slot `from` on). */
const countIn = (sim: Pick<SimContext, 'state'>, box: number, item: number, from = 0) => (box >= 0 ? sim.state.items.containers[box]?.slice(from).filter((v) => itemOf(v) === item).length ?? 0 : 0);
/** A frame-up's stash in a desk where a search finds it: its standard drawers (the hidden compartment is never searched). */
const stashIn = (sim: Pick<SimContext, 'state' | 'world'>, desk: number) => (desk >= 0 ? countIn(sim, desk, STASH, containersOf(sim.world)[desk].hidden) : 0);
/** What a drop or a frame-up counts in the target's desk now. */
const deskCount = (sim: Pick<SimContext, 'state' | 'world'>, job: readonly number[]) => {
  const desk = deskOf(sim, job[J.TARGET]);
  return job[J.KIND] === KIND.DROP ? countIn(sim, desk, PARCEL) : stashIn(sim, desk);
};

/** The step a job taken now runs out: 08:00 after its last prison day, counted from tomorrow when taken from 18:00 on. */
export function endsFor(step: number, days: number): number {
  const first = prisonDay(step) + (dayMinute(step) >= LATE_MINUTE ? 1 : 0);
  return (first - 1 + days) * DAY_STEPS;
}

/** A deal taken on (the refusals already passed). */
function take(sim: SimContext, d: Deal, from: number) {
  const s = sim.state;
  s.oddjob = [d.kind, d.variant, d.giver, d.target, endsFor(s.step, d.days), from, STAGE.ON, 0, 0, d.pay, d.perk, d.item, 0];
  const gives = givesOf(d.kind);
  if (gives) {
    const free = freeHotbar(s.items.inv);
    s.items.inv[free] = slot(gives);
    s.items.rev++;
  }
  // What's to be lifted is put where it's to be found.
  if (d.kind === KIND.LIFT) plant(sim, d.variant, d.target);
  // (A drop or a frame-up: what the desk holds of it already, left there by an earlier job; only one more counts.)
  if (d.kind === KIND.DROP || d.kind === KIND.FRAME) s.oddjob[J.WARN] = deskCount(sim, s.oddjob);
  // (The cake: the step it's taken, so the Red Cross parcel already in today doesn't bring it.)
  if (d.kind === KIND.CAKE) s.oddjob[J.WARN] = s.step;
  sim.events.push({ type: 'oddjob', what: 'taken', kind: d.kind, who: d.giver, from, n: d.days });
}

/** At the board (EXT.BOARD): a job taken off a pin (c), the job held given up. */
export function boardOp(sim: SimContext, b: number, c: number) {
  const s = sim.state;
  if (b === BOARD.QUIT) {
    if (!jobOf(s)) return refuse(sim, 'noJob');
    return fail(sim, 'quit');
  }
  if (b !== BOARD.TAKE) return;
  const why = boardRefusal(sim, c);
  if (why) return refuse(sim, why);
  const deal = c === CHAIN_PIN ? chainDeal(sim)! : dealsOf(sim)[c];
  markPin(s, c);
  take(sim, deal, c === CHAIN_PIN ? FROM.CHAIN : c);
}

/** A pin marked taken today (the record starts the day afresh). */
function markPin(s: SimState, pin: number) {
  const day = prisonDay(s.step);
  if (s.oddjobs[R.DAY] !== day) {
    s.oddjobs[R.DAY] = day;
    s.oddjobs[R.PINS] = 0;
  }
  s.oddjobs[R.PINS] |= 1 << pin;
}

/** Talking about odd jobs (TALK.ODD_JOB: the fixer's own taken; JOB_IN: the job handed in; CALL_IN: a debt called in). */
export function talkJob(sim: SimContext, who: number, a: 'take' | 'in' | 'call') {
  const s = sim.state;
  if (a === 'take') {
    const why = fixerJobRefusal(sim, who);
    if (why) return refuse(sim, why);
    s.eventFlags |= TODAY.FIXER_JOB;
    take(sim, fixerDeal(sim)!, FROM.FIXER);
    return;
  }
  if (a === 'call') {
    if (!owes(s, who)) return refuse(sim, 'notOwed');
    const free = freeHotbar(s.items.inv);
    if (free < 0) return refuse(sim, 'room');
    const item = debtTool(s, who);
    s.items.inv[free] = slot(item);
    s.items.rev++;
    s.oddjobs[R.OWED] &= ~(1 << who);
    sim.events.push({ type: 'oddjob', what: 'calledIn', who, item });
    return;
  }
  handIn(sim, who);
}

/** Why the job held can't be handed in to someone now (null: it can). */
export function handInRefusal(sim: SimContext, who: number): Refusal | null {
  const s = sim.state;
  const job = jobOf(s);
  if (!job) return 'noJob';
  if (job[J.GIVER] !== who) return 'notHisJob';
  const brings = bringsOf(job);
  if (brings) {
    // (What's lifted out of where it was left for this job, the cake come in for it: not one kept from before.)
    if ((job[J.KIND] === KIND.LIFT || job[J.KIND] === KIND.CAKE) && !job[J.PROG]) return 'notDone';
    if (carrying(s, brings) < 0) return 'missing';
  } else if (job[J.STAGE] !== STAGE.DONE) return 'notDone';
  // (The parcel taken back out of the desk: not delivered.)
  else if (job[J.KIND] === KIND.DROP && deskCount(sim, job) <= job[J.WARN]) return 'notDone';
  if ((paysItem(job) || owedAgain(s, job)) && s.items.inv.slice(0, HOTBAR).filter((v) => !v).length + (brings ? 1 : 0) < 1) return 'room';
  return null;
}

/** A job that ends with a rare item. */
const paysItem = (job: readonly number[]) => job[J.PERK] === PERK.ITEM && !!job[J.ITEM];
/** A debt from one who owes the player one already: he hands over a tool there and then (one owed at a time). */
const owedAgain = (s: SimState, job: readonly number[]) => job[J.PERK] === PERK.DEBT && owes(s, job[J.GIVER]);
/** The tool an inmate hands over for a debt (called in, or a second one paid at once): drawn by roll() (`n`: his number, past 32 for a second). */
const debtTool = (s: SimState, n: number) => itemNumber(DEBT_TOOLS[rollInt(s.salt, SALT.ODDJOB_PERK, prisonDay(s.step), n, DEBT_TOOLS.length)]);

/** The job handed in to the one who asked: what's brought taken, the pay, the perk; the story told on. */
function handIn(sim: SimContext, who: number) {
  const s = sim.state;
  const why = handInRefusal(sim, who);
  if (why) return refuse(sim, why);
  const job = jobOf(s)!;
  const brings = bringsOf(job);
  if (brings) s.items.inv[carrying(s, brings)] = 0;
  const pay = job[J.PAY];
  s.cash += pay;
  s.tally[3] += pay;
  sim.events.push({ type: 'cash', n: pay, why: 'oddjob' });
  changeOpinion(sim, who, PAID_OPINION);
  // (He owes the player one already: this one's paid at once, a tool, as calling it in would; the first stays owed.)
  const again = owedAgain(s, job);
  const item = again ? debtTool(s, who + 32) : paysItem(job) ? job[J.ITEM] : 0;
  if (item) s.items.inv[freeHotbar(s.items.inv)] = slot(item);
  else if (job[J.PERK] === PERK.DEBT && who < 30) s.oddjobs[R.OWED] |= 1 << who;
  s.items.rev++;
  s.eventFlags |= TODAY.ODD_JOB;
  const from = job[J.FROM];
  sim.events.push({ type: 'oddjob', what: 'paid', kind: job[J.KIND], who, n: pay, item, perk: again ? PERK.ITEM : job[J.PERK], from });
  s.oddjob = [];
  if (from === FROM.CHAIN) {
    const step = s.oddjobs[R.CHAIN];
    s.oddjobs[R.CHAIN] = step + 1;
    s.oddjobs[R.CHAIN_DAY] = prisonDay(s.step);
    const told = CHAINS[sim.prison.id]?.steps.length ?? 0;
    sim.events.push({ type: 'oddjob', what: 'chain', who, n: step, more: step + 1 < told });
  }
}

/** The job held fails (the time up, given up, seen, the wrong result, caught): gone, and what the one who asked thinks of it. */
function fail(sim: SimContext, why: OddJobFail) {
  const s = sim.state;
  const job = jobOf(s);
  if (!job) return;
  s.oddjob = [];
  if (job[J.KIND] === KIND.LIFT) unplant(sim, job);
  // (What it handed over and wasn't used: taken back, so a job given up never pays in parcels or stashes.)
  else takeBack(sim, job);
  // (A story's step given up or failed, though taken on an earlier day: its card stays down for the rest of
  // today, as a pin's would. Run out at 08:00, it's a new day's: pinned up again.)
  if (job[J.FROM] === FROM.CHAIN && why !== 'time') markPin(s, CHAIN_PIN);
  changeOpinion(sim, job[J.GIVER], FAIL_OPINION);
  if (why === 'caught' && job[J.KIND] === KIND.FRAME) addHeat(sim, FRAME_HEAT);
  sim.events.push({ type: 'oddjob', what: 'failed', why, kind: job[J.KIND], who: job[J.GIVER], from: job[J.FROM] });
}

/** An item the pet rat left in a container this step. */
const byRat = (sim: SimContext, box: number, item: number) => sim.events.some((e) => e.type === 'rat' && e.what === 'left' && e.item === item && e.container === box);

/** The job's work done: back to the one who asked. */
function done(sim: SimContext, job: number[]) {
  job[J.STAGE] = STAGE.DONE;
  sim.events.push({ type: 'oddjob', what: 'done', kind: job[J.KIND], who: job[J.GIVER] });
}

// ------------------------------------------------------------------ the lookout

/** The lookout's dig: the digger's bed tile and his cell door's outside (null: no lookout job under way). */
export function digOf(sim: Pick<SimContext, 'world' | 'state'>): { who: number; tile: number; door: number } | null {
  const s = sim.state;
  const job = jobOf(s);
  if (!job || job[J.KIND] !== KIND.LOOKOUT || job[J.STAGE] !== STAGE.ON) return null;
  const m = s.inmates[job[J.GIVER]];
  if (!m) return null;
  const pl = placesOf(sim.world);
  const tile = pl.bedside[m.cell] ?? -1;
  const door = pl.doorstep[m.cell] ?? -1;
  return tile >= 0 && door >= 0 ? { who: job[J.GIVER], tile, door } : null;
}


/** Tiles from a tile to a body (the larger way). */
const offTile = (tile: number, b: { x: number; z: number }) => tilesFrom(tileX(tile), tileZ(tile), b.x, b.z);

/** The player keeps watch: up and about on the ground floor, within WATCH_TILES of the digger's door. */
function onWatch(sim: SimContext): boolean {
  const d = digOf(sim);
  const s = sim.state;
  return !!d && s.layer === LAYER.GROUND && !sim.away && !s.stowed && !s.sleeping && s.ko <= 0 && offTile(d.door, s.player) <= WATCH_TILES;
}

/** The digger at it now: in the free time, the player on watch, not hiding from a whistle. */
function digging(sim: SimContext): boolean {
  const job = jobOf(sim.state);
  return !!job && sim.fixerOpen && onWatch(sim) && sim.state.step >= job[J.AUX] && diggerFree(sim);
}

/** The digger is up and calm. */
function diggerFree(sim: SimContext): boolean {
  const d = digOf(sim);
  const m = d ? sim.state.inmates[d.who] : null;
  return !!m && m.ko <= 0 && m.angry <= 0 && m.doing !== DOING.SLEEP;
}

/** The guards coming at the dig (a bit each: awake, within WARN_TILES of it). */
function coming(sim: SimContext, tile: number): number {
  let bits = 0;
  sim.state.guards.forEach((g, k) => {
    if (k < 30 && awake(g) && offTile(tile, g.body) <= WARN_TILES) bits |= 1 << k;
  });
  return bits;
}

/** The whistle can be blown: on watch in the dig's hours, the digger up and at it (or hiding from a whistle). */
export function canWhistle(sim: SimContext): boolean {
  return onWatch(sim) && sim.fixerOpen && diggerFree(sim);
}

/** B or the job's chip whistle now (a guard coming at the dig); otherwise they open the job's card. */
export function whistleNow(sim: SimContext): boolean {
  const job = jobOf(sim.state);
  return !!job && job[J.KIND] === KIND.LOOKOUT && job[J.WARN] > 0 && canWhistle(sim);
}

/** The lookout's whistle (EXT.WHISTLE): the dig hides (a guard coming), or it's a false alarm and time is lost. Not outside the dig's hours. */
export function whistle(sim: SimContext) {
  const s = sim.state;
  const job = jobOf(s);
  const d = digOf(sim);
  if (!job || !d || !canWhistle(sim)) return refuse(sim, 'notLookout');
  job[J.AUX] = s.step + HIDE_STEPS;
  if (job[J.WARN]) sim.events.push({ type: 'oddjob', what: 'whistled', who: d.who });
  else {
    job[J.PROG] = Math.max(0, job[J.PROG] - FALSE_STEPS);
    sim.events.push({ type: 'oddjob', what: 'falseAlarm', who: d.who });
  }
}

function lookout(sim: SimContext, job: number[]) {
  const s = sim.state;
  const d = digOf(sim);
  // (Nobody digging, or the player off watch: no guard is "coming" for them to whistle at.)
  if (!d || !sim.fixerOpen || !diggerFree(sim) || !onWatch(sim)) {
    job[J.WARN] = 0;
    return;
  }
  const bits = coming(sim, d.tile);
  const fresh = bits & ~job[J.WARN];
  job[J.WARN] = bits;
  for (let k = 0; k < s.guards.length; k++) if (fresh & (1 << k)) sim.events.push({ type: 'oddjob', what: 'coming', who: d.who, guard: k });
  // Hiding: while one is near, and HIDE_STEPS at least after the whistle.
  if (s.step < job[J.AUX]) {
    if (bits) job[J.AUX] = Math.max(job[J.AUX], s.step + 1);
    return;
  }
  // At it: a guard close enough to see in finds him; else the dig goes on.
  const m = s.inmates[d.who];
  const cx = centerX(d.tile);
  const cz = centerZ(d.tile);
  const there = offTile(d.tile, m.body) <= 0;
  if (there) {
    for (const g of s.guards) {
      if (!awake(g) || lookingAway(g, s.step) || offTile(d.tile, g.body) > CAUGHT_TILES || !lineOfSight(sim.world, g.body.x, g.body.z, cx, cz)) continue;
      return fail(sim, 'found');
    }
  }
  if (!there) return;
  if (job[J.PROG] === 0) sim.events.push({ type: 'oddjob', what: 'digging', who: d.who });
  if (++job[J.PROG] >= DIG_STEPS) done(sim, job);
}

/** The digger where the dig wants him (socialNow): at his bed in the free times, digging (DOING.DIG) unless hiding. */
export function oddjobTargets(sim: SimContext, so: { follow: Array<Body | null>; gap: number[]; doing: number[]; face: number[] }) {
  const d = digOf(sim);
  if (!d || !sim.fixerOpen || !diggerFree(sim)) return;
  const m = sim.state.inmates[d.who];
  m.wait = 0;
  mark.x = centerX(d.tile);
  mark.z = centerZ(d.tile);
  so.follow[d.who] = mark;
  so.gap[d.who] = 0;
  so.doing[d.who] = digging(sim) ? DOING.DIG : DOING.NOTHING;
  so.face[d.who] = digFace(sim.world, d.tile);
}

/** The way a digger faces at his bed: toward the most open floor beside it (never the bed nor a wall), east first on a tie. */
export function digFace(w: SimContext['world'], tile: number): number {
  const x = tile % MAP_W;
  const z = Math.floor(tile / MAP_W);
  let best = 1;
  let most = -1;
  for (const [face, dx, dz] of [[1, 1, 0], [5, 0, 1], [9, -1, 0], [13, 0, -1]] as const) {
    let open = 0;
    while (open < 2 && isFloor(w, x + dx * (open + 1), z + dz * (open + 1))) open++;
    if (open > most) {
      most = open;
      best = face;
    }
  }
  return best;
}
const mark: Body = bodyAt(0, 0);

// ------------------------------------------------------------------ the birthday cake

/** The player's own desk (-1 none) and its first open drawer past the hidden compartment (-1 full). */
function ownDesk(sim: SimContext): { desk: number; free: number } {
  const list = containersOf(sim.world);
  const desk = list.findIndex((c) => c.mine && c.prop.kind === 'desk');
  const box = desk >= 0 ? sim.state.items.containers[desk] : null;
  return { desk, free: box ? box.indexOf(0, list[desk].hidden) : -1 };
}

/**
 * The birthday cake comes in: at a visit into the hotbar, else (no room) the desk; in the Red Cross
 * parcel (`parcel`) into the desk, else the hotbar. Neither has room: it waits (once a day told why).
 */
function cakeIn(sim: SimContext, job: number[], parcel: boolean) {
  const s = sim.state;
  const hot = freeHotbar(s.items.inv);
  const own = ownDesk(sim);
  const toDesk = own.free >= 0 && (parcel || hot < 0);
  if (!toDesk && hot < 0) {
    const day = prisonDay(s.step);
    if (job[J.AUX] !== day) {
      job[J.AUX] = day;
      sim.events.push({ type: 'oddjob', what: 'cakeKept', n: parcel ? 1 : 0 });
    }
    return;
  }
  if (toDesk) s.items.containers[own.desk][own.free] = slot(BIRTHDAY_CAKE);
  else s.items.inv[hot] = slot(BIRTHDAY_CAKE);
  s.items.rev++;
  job[J.PROG] = 1;
  // (n: 1 in the desk from the parcel, 2 in the desk from a visit for want of room in the hotbar, 3 in the hotbar from the parcel for want of room in the desk.)
  sim.events.push({ type: 'oddjob', what: 'cake', who: job[J.GIVER], ...(parcel ? { n: toDesk ? 1 : 3 } : toDesk ? { n: 2 } : {}) });
}

/** The birthday cake at a visit (smuggling.ts visit). */
export function birthdayAtVisit(sim: SimContext) {
  const job = jobOf(sim.state);
  if (!job || job[J.KIND] !== KIND.CAKE || job[J.PROG] || job[J.STAGE] !== STAGE.ON) return;
  cakeIn(sim, job, false);
}

/** Stalag Flucht's: in the Red Cross parcel on delivery day (from PARCEL_MINUTE), the first delivery after it's taken. */
function birthdayParcel(sim: SimContext, job: number[]) {
  const d = smugglingOf(sim);
  const s = sim.state;
  if (job[J.PROG] || !d?.parcel || dayMinute(s.step) < PARCEL_MINUTE || today(sim).event !== 'delivery') return;
  // (Taken once today's parcel was in: it comes with the next one.)
  if (prisonDay(job[J.WARN]) === prisonDay(s.step) && dayMinute(job[J.WARN]) >= PARCEL_MINUTE) return;
  cakeIn(sim, job, true);
}

// ------------------------------------------------------------------ each step

/** Each step: the job's time, and what's been done toward it (from the step's events and the state). */
export function oddjobs(sim: SimContext) {
  const s = sim.state;
  const job = jobOf(s);
  if (!job) return;
  // 08:00 after its last day: the work not done (nor what's to be brought in hand), it's gone; done, it waits to be handed in.
  if (job[J.STAGE] === STAGE.ON && s.step >= job[J.ENDS]) {
    if (!inHand(s, job)) return fail(sim, 'time');
    job[J.STAGE] = STAGE.DONE;
  }
  const kind = job[J.KIND];
  const target = job[J.TARGET];
  if (job[J.STAGE] !== STAGE.ON) {
    // (A parcel dropped, then taken back out of the desk: not delivered any more.)
    if (kind === KIND.DROP && deskCount(sim, job) <= job[J.WARN]) job[J.STAGE] = STAGE.ON;
    return;
  }
  switch (kind) {
    case KIND.LIFT: {
      // Lifted: out of where it was left for this job (one kept from an earlier job doesn't count).
      const { box, item } = liftBox(sim, job[J.VAR], target);
      if (!job[J.PROG] && countIn(sim, box, item) === 0) job[J.PROG] = 1;
      return;
    }
    case KIND.DROP: {
      // Into the desk: seen doing it by hand, it's off (the rat's doing is nobody's sight of the player).
      const n = deskCount(sim, job);
      job[J.WARN] = Math.min(job[J.WARN], n);
      if (n > job[J.WARN]) return s.seen && !byRat(sim, deskOf(sim, target), PARCEL) ? fail(sim, 'seen') : done(sim, job);
      return;
    }
    case KIND.FRAME: {
      const desk = deskOf(sim, target);
      // (Not yet planted: an old stash searched out lowers what's already there.)
      const n = stashIn(sim, desk);
      if (!job[J.PROG]) job[J.WARN] = Math.min(job[J.WARN], n);
      const planted = n > job[J.WARN];
      if (planted && !job[J.PROG]) {
        if (s.seen && !byRat(sim, desk, STASH)) return fail(sim, 'caught');
        job[J.PROG] = 1;
        sim.events.push({ type: 'oddjob', what: 'planted', who: job[J.GIVER] });
      } else if (!planted && job[J.PROG]) {
        // Searched and found: framed. (Taken back out: not planted any more.)
        const cell = s.inmates[target]?.cell;
        if (sim.events.some((e) => e.type === 'searched' && e.cell === cell)) return done(sim, job);
        job[J.PROG] = 0;
      }
      // 19:00: the one who asked tips the guards off (once a day, the stash in place).
      const day = prisonDay(s.step);
      if (job[J.PROG] && s.step % STEPS_PER_MINUTE === 0 && dayMinute(s.step) === FRAME_MINUTE && job[J.AUX] !== day) {
        const k = searcher(sim);
        if (k >= 0) {
          job[J.AUX] = day;
          assign(s.guards[k], GUARD.SHAKEDOWN, [s.inmates[target].cell]);
          sim.events.push({ type: 'oddjob', what: 'tipped', who: job[J.GIVER], guard: k });
        }
      }
      return;
    }
    case KIND.WRESTLE:
    case KIND.CHEAT:
    case KIND.CHECKERS: {
      const type = kind === KIND.WRESTLE ? 'bout' : kind === KIND.CHEAT ? 'cheat' : 'checkers';
      const want = job[J.VAR] ? 'won' : 'lost';
      const other = job[J.VAR] ? 'lost' : 'won';
      for (const e of sim.events) {
        if (e.type !== type || e.who !== target) continue;
        if (e.what === want) return done(sim, job);
        if (e.what === other) return fail(sim, 'fixed');
      }
      return;
    }
    case KIND.RAT: {
      const desk = deskOf(sim, target);
      if (sim.events.some((e) => e.type === 'rat' && e.what === 'left' && e.item === NOTE && e.container === desk)) done(sim, job);
      return;
    }
    case KIND.DELIVER:
      if (sim.events.some((e) => e.type === 'gift' && e.who === target && e.item === PARCEL)) done(sim, job);
      return;
    case KIND.TIP: {
      const cell = s.inmates[target]?.cell;
      if (sim.events.some((e) => e.type === 'phone' && e.what === 'tip' && e.cell === cell)) done(sim, job);
      return;
    }
    case KIND.CAKE:
      if (s.step % STEPS_PER_MINUTE === 0) birthdayParcel(sim, job);
      return;
    case KIND.LOOKOUT:
      return lookout(sim, job);
  }
}
