/**
 * The odd jobs board (P40, docs/PLAN.md §13): a cork board on a canteen wall (`PrisonDef.board`).
 *
 * - **The board** holds PINS jobs a prison day, dealt by roll() (SALT.ODDJOBS) from what the
 *   prison has (`kindsHere`): a deal never asks for something it lacks. A pin taken stays taken
 *   for the day. The story chain's next step is pinned beside them (from CHAIN_DAY, a step a day).
 * - **The fixer** (P21) offers a job of his own each prison day (SALT.FIXER_JOB): the riskier
 *   kinds, better paid, a rare item on top. Taken by talking to him (TALK.ODD_JOB).
 * - **One job at a time**, until 08:00 after its last day. What it hands over goes into the hotbar
 *   (the parcel, the stash, the note); what it lifts is put where it's to be found (a guard's
 *   pockets, the kitchen freezer). Done, it's handed in to the one who asked (TALK.JOB_IN): cash,
 *   maybe a rare item or a debt (he owes the player one: he joins the crew whatever he thinks of
 *   them, or hands over a tool when it's called in, TALK.CALL_IN).
 * - **Failing** (the time up, given up, seen, the wrong result, the dig found): the job goes and
 *   the one who asked thinks less of the player; a frame caught out brings heat.
 *
 * Nothing changes for anyone until the player takes a job (the escape bots never do): the deals
 * are pure, and only a lookout's digger walks anywhere he wouldn't. Never the state's RNG.
 */
import { BOARD, CAUGHT_TILES, J, JOB_LEN, R, STAGE, CHAIN_DAY, CHAIN_PIN, CHAINS, DEBT_ODDS, DEBT_TOOLS, DIG_STEPS, FAIL_OPINION, FALSE_STEPS, FIXER_JOB_OPINION, FIXER_PAY, FRAME_HEAT, FRAME_MINUTE, FROM, HIDE_STEPS, KIND, KIND_DEFS, KINDS, LIFT, LIFTS, PAID_OPINION, PERK, PERK_ODDS, PINS, RARE_ITEMS, WARN_TILES, WATCH_TILES } from '../../content/oddjobs';
import { itemNumber } from '../../content/items';
import { ROUTINE } from '../../content/routine';
import { PARCEL_MINUTE } from '../../content/smuggling';
import { lineOfSight } from '../ai/sight';
import { placesOf } from '../ai/places';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import type { OddJobFail, Refusal, SimState } from '../state';
import { STEPS_PER_MINUTE, UNIT } from '../tuning';
import { containersOf } from '../world/containers';
import { LAYER, MAP_W } from '../world/World';
import { dayMinute, planOf, prisonDay, TODAY, today } from './calendar';
import { DAY_STEPS } from './clock';
import { elderOf } from './checkers';
import { assign, awake, GUARD } from './guards';
import { DOING } from './inmates';
import { HOTBAR, itemOf, pocketOf, slot } from './items';
import { bodyAt, type Body } from './movement';
import { commsOf, searcher } from './phone';
import { changeOpinion, refuse } from './social';
import { fixerOf, smugglingOf } from './smuggling';
import { addHeat } from './watch';

export { J, JOB_LEN, R, STAGE } from '../../content/oddjobs';

const PARCEL = itemNumber('parcel');
const STASH = itemNumber('stash');
const NOTE = itemNumber('note');
const BIRTHDAY_CAKE = itemNumber('birthday_cake');
const SUGAR = itemNumber('sugar');

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
    return { variant, target: variant === LIFT.WHISTLE ? rollInt(s.salt, salt, day, n + 3, s.guards.length) : -1 };
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
  if (!boardOf(sim) || !chain || day < CHAIN_DAY) return null;
  const k = s.oddjobs[R.CHAIN];
  const st = chain.steps[k];
  if (!st || s.oddjobs[R.CHAIN_DAY] >= day) return null;
  const giver = inCell(s, chain.who);
  if (giver < 0) return null;
  let target = st.target ? inCell(s, st.target) : -1;
  if (st.kind === KIND.CHECKERS) target = elderOf(sim);
  if (st.kind === KIND.LIFT && st.variant !== LIFT.MUG) target = s.guards.length ? rollInt(s.salt, SALT.ODDJOBS, day, 900 + k, s.guards.length) : -1;
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
export const givesOf = (kind: number) => {
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
const carrying = (s: SimState, item: number) => s.items.inv.slice(0, HOTBAR).findIndex((v) => itemOf(v) === item);

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
  if (givesOf(deal.kind) && s.items.inv.slice(0, HOTBAR).indexOf(0) < 0) return 'room';
  return null;
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
  if (givesOf(deal.kind) && s.items.inv.slice(0, HOTBAR).indexOf(0) < 0) return 'room';
  return null;
}

/** Puts an item into a container (its first open slot past the hidden ones; full: the last), as a favor's thief gets it. */
function plant(sim: SimContext, box: number, item: number) {
  const slots = sim.state.items.containers[box];
  if (!slots) return;
  const hidden = box < containersOf(sim.world).length ? containersOf(sim.world)[box].hidden : 0;
  const k = slots.indexOf(0, hidden);
  slots[k >= 0 ? k : slots.length - 1] = slot(item);
  sim.state.items.rev++;
}

/** A deal taken on (the refusals already passed). */
function take(sim: SimContext, d: Deal, from: number) {
  const s = sim.state;
  const day = prisonDay(s.step);
  s.oddjob = [d.kind, d.variant, d.giver, d.target, (day - 1 + d.days) * DAY_STEPS, from, STAGE.ON, 0, 0, d.pay, d.perk, d.item, 0];
  const gives = givesOf(d.kind);
  if (gives) {
    const free = s.items.inv.slice(0, HOTBAR).indexOf(0);
    s.items.inv[free] = slot(gives);
    s.items.rev++;
  }
  // What's to be lifted is put where it's to be found.
  if (d.kind === KIND.LIFT) {
    const item = itemNumber(LIFTS[d.variant] ?? LIFTS[0]);
    if (d.variant === LIFT.MUG) plant(sim, freezerOf(sim), item);
    else if (d.target >= 0) plant(sim, pocketOf(sim.world, s.inmates.length + d.target), item);
  }
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
  const day = prisonDay(s.step);
  const deal = c === CHAIN_PIN ? chainDeal(sim)! : dealsOf(sim)[c];
  if (s.oddjobs[R.DAY] !== day) {
    s.oddjobs[R.DAY] = day;
    s.oddjobs[R.PINS] = 0;
  }
  s.oddjobs[R.PINS] |= 1 << c;
  take(sim, deal, c === CHAIN_PIN ? FROM.CHAIN : c);
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
    const free = s.items.inv.slice(0, HOTBAR).indexOf(0);
    if (free < 0) return refuse(sim, 'room');
    const item = itemNumber(DEBT_TOOLS[rollInt(s.salt, SALT.ODDJOB_PERK, prisonDay(s.step), who, DEBT_TOOLS.length)]);
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
    if (carrying(s, brings) < 0) return 'missing';
  } else if (job[J.STAGE] !== STAGE.DONE) return 'notDone';
  if (job[J.PERK] === PERK.ITEM && job[J.ITEM] && s.items.inv.slice(0, HOTBAR).filter((v) => !v).length + (brings ? 1 : 0) < 1) return 'room';
  return null;
}

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
  if (job[J.PERK] === PERK.ITEM && job[J.ITEM]) {
    s.items.inv[s.items.inv.slice(0, HOTBAR).indexOf(0)] = slot(job[J.ITEM]);
  } else if (job[J.PERK] === PERK.DEBT && who < 30) s.oddjobs[R.OWED] |= 1 << who;
  s.items.rev++;
  s.eventFlags |= TODAY.ODD_JOB;
  const from = job[J.FROM];
  sim.events.push({ type: 'oddjob', what: 'paid', kind: job[J.KIND], who, n: pay, item: job[J.PERK] === PERK.ITEM ? job[J.ITEM] : 0, perk: job[J.PERK], from });
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
export function fail(sim: SimContext, why: OddJobFail) {
  const s = sim.state;
  const job = jobOf(s);
  if (!job) return;
  s.oddjob = [];
  changeOpinion(sim, job[J.GIVER], FAIL_OPINION);
  if (why === 'caught' && job[J.KIND] === KIND.FRAME) addHeat(sim, FRAME_HEAT);
  sim.events.push({ type: 'oddjob', what: 'failed', why, kind: job[J.KIND], who: job[J.GIVER], from: job[J.FROM] });
}

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

/** The free times (the digger digs in them), outside a lockdown. */
const digHours = (sim: SimContext) => !sim.state.lockdown && (ROUTINE[sim.state.routine].id === 'freeTime' || ROUTINE[sim.state.routine].id === 'eveningFreeTime');

/** Tiles from a tile to a body (the larger way). */
const offTile = (tile: number, b: { x: number; z: number }) => Math.max(Math.abs(Math.floor(b.x / UNIT) - (tile % MAP_W)), Math.abs(Math.floor(b.z / UNIT) - Math.floor(tile / MAP_W)));

/** The player keeps watch: up and about on the ground floor, within WATCH_TILES of the digger's door. */
export function onWatch(sim: SimContext): boolean {
  const d = digOf(sim);
  const s = sim.state;
  return !!d && s.layer === LAYER.GROUND && !sim.away && !s.stowed && !s.sleeping && s.ko <= 0 && offTile(d.door, s.player) <= WATCH_TILES;
}

/** The digger at it now: in the free time, the player on watch, not hiding from a whistle. */
export function digging(sim: SimContext): boolean {
  const job = jobOf(sim.state);
  return !!job && digHours(sim) && onWatch(sim) && sim.state.step >= job[J.AUX] && diggerFree(sim);
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

/** The lookout's whistle (EXT.WHISTLE): the dig hides (a guard coming), or it's a false alarm and time is lost. */
export function whistle(sim: SimContext) {
  const s = sim.state;
  const job = jobOf(s);
  const d = digOf(sim);
  if (!job || !d || !onWatch(sim)) return refuse(sim, 'notLookout');
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
  if (!d || !digHours(sim) || !diggerFree(sim)) {
    job[J.WARN] = 0;
    return;
  }
  const bits = coming(sim, d.tile);
  const fresh = bits & ~job[J.WARN];
  job[J.WARN] = bits;
  for (let k = 0; k < s.guards.length; k++) if (fresh & (1 << k)) sim.events.push({ type: 'oddjob', what: 'coming', who: d.who, guard: k });
  if (!onWatch(sim)) return;
  // Hiding: while one is near, and HIDE_STEPS at least after the whistle.
  if (s.step < job[J.AUX]) {
    if (bits) job[J.AUX] = Math.max(job[J.AUX], s.step + 1);
    return;
  }
  // At it: a guard close enough to see in finds him; else the dig goes on.
  const m = s.inmates[d.who];
  const cx = (d.tile % MAP_W) * UNIT + UNIT / 2;
  const cz = Math.floor(d.tile / MAP_W) * UNIT + UNIT / 2;
  const there = offTile(d.tile, m.body) <= 0;
  if (there) {
    for (const g of s.guards) {
      if (!awake(g) || offTile(d.tile, g.body) > CAUGHT_TILES || !lineOfSight(sim.world, g.body.x, g.body.z, cx, cz)) continue;
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
  if (!d || !digHours(sim) || !diggerFree(sim)) return;
  const m = sim.state.inmates[d.who];
  m.wait = 0;
  mark.x = (d.tile % MAP_W) * UNIT + UNIT / 2;
  mark.z = Math.floor(d.tile / MAP_W) * UNIT + UNIT / 2;
  so.follow[d.who] = mark;
  so.gap[d.who] = 0;
  so.doing[d.who] = digging(sim) ? DOING.DIG : DOING.NOTHING;
  so.face[d.who] = 0;
}
const mark: Body = bodyAt(0, 0);

// ------------------------------------------------------------------ the birthday cake

/** The birthday cake at a visit (smuggling.ts visit): into the hotbar (no room: the next visit). */
export function birthdayAtVisit(sim: SimContext) {
  const s = sim.state;
  const job = jobOf(s);
  if (!job || job[J.KIND] !== KIND.CAKE || job[J.PROG]) return;
  const free = s.items.inv.slice(0, HOTBAR).indexOf(0);
  if (free < 0) return void sim.events.push({ type: 'oddjob', what: 'cakeKept' });
  s.items.inv[free] = slot(BIRTHDAY_CAKE);
  s.items.rev++;
  job[J.PROG] = 1;
  sim.events.push({ type: 'oddjob', what: 'cake', who: job[J.GIVER] });
}

/** Stalag Flucht's: in the Red Cross parcel on delivery day (from PARCEL_MINUTE), into the desk's open drawers. */
function birthdayParcel(sim: SimContext, job: number[]) {
  const d = smugglingOf(sim);
  if (job[J.PROG] || !d?.parcel || dayMinute(sim.state.step) < PARCEL_MINUTE || today(sim).event !== 'delivery') return;
  const w = sim.world;
  const desk = containersOf(w).findIndex((c) => c.mine && c.prop.kind === 'desk');
  const box = desk >= 0 ? sim.state.items.containers[desk] : null;
  const free = box ? box.indexOf(0, containersOf(w)[desk].hidden) : -1;
  if (!box || free < 0) return;
  box[free] = slot(BIRTHDAY_CAKE);
  sim.state.items.rev++;
  job[J.PROG] = 1;
  sim.events.push({ type: 'oddjob', what: 'cake', who: job[J.GIVER], n: 1 });
}

// ------------------------------------------------------------------ each step

/** Whether a container holds an item. */
const holds = (sim: SimContext, box: number, item: number) => box >= 0 && !!sim.state.items.containers[box]?.some((v) => itemOf(v) === item);

/** Each step: the job's time, and what's been done toward it (from the step's events and the state). */
export function oddjobs(sim: SimContext) {
  const s = sim.state;
  const job = jobOf(s);
  if (!job) return;
  if (job[J.STAGE] === STAGE.ON && s.step >= job[J.ENDS]) return fail(sim, 'time');
  if (job[J.STAGE] !== STAGE.ON) return;
  const kind = job[J.KIND];
  const target = job[J.TARGET];
  switch (kind) {
    case KIND.DROP:
      // Into the desk: seen doing it, it's off.
      if (holds(sim, deskOf(sim, target), PARCEL)) return s.seen ? fail(sim, 'seen') : done(sim, job);
      return;
    case KIND.FRAME: {
      const desk = deskOf(sim, target);
      const planted = holds(sim, desk, STASH);
      if (planted && !job[J.PROG]) {
        if (s.seen) return fail(sim, 'caught');
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

/** The step a job runs out (for the card: 08:00 after its last day). */
export const endsOf = (job: readonly number[]) => job[J.ENDS];
/** The errand's sugar (for the card's "bring" line). */
export { SUGAR };
