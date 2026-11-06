/**
 * The action button says, shows and does one thing (v2.34.2, the improvement queue's session 2).
 * What a press does is decided once, by `interactPlan` (sim/systems/interact.ts): actions.ts does
 * it; the play layer reads it through its per-step memo (reach.ts's updateTargets), says it
 * (labels.ts's actionWords and describePlan) and marks it (focus.ts). Here:
 * - in every prison, at a time in each block of the day, standing beside every prop and every
 *   person and facing them, as is and with dirt or a bed dummy in hand, an item on the floor, the
 *   nearest person out cold, seated on the nearest seat, or tired;
 * - plus what the sweep never meets: roll call answered (a bot that waits to be called), a potato
 *   in solitary, a book read on a library chair, and, from the escape bots' own runs, the vehicle's
 *   tail and getting out of it, the release desk and its tray, the checkpoint's window;
 * each different plan is pressed on that very state (`useItems`, nobody moving). It must do what
 * the plan says, or say why not (a press with no plan changes nothing); every kind but the few that
 * only ever refuse here must also succeed somewhere. Its label, as the button shows it, has the
 * kind's own verb in English and French (greyed exactly when the press is refused, at the desk's
 * tray and the window); its highlight covers what the press acts on.
 * What this can't see: the order of priorities itself (a tray chosen over a search) is the plan's,
 * and the plan is what the sim does, so a wrong order is a change in what the game does: the
 * bots' snapshots (escapetest and the rest) catch that. And a press lands a step after what's
 * drawn, after everyone has moved: a guard walking past can be out of reach by then.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { PRISONS } from '../src/content/prisons';
import { itemNumber } from '../src/content/items';
import { command, opOf, argA, OP } from '../src/sim/command';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { useItems } from '../src/sim/systems/actions';
import { servingCounter } from '../src/sim/systems/canteen';
import { personOf } from '../src/sim/systems/combat';
import { coolerProp } from '../src/sim/systems/cooler';
import { people, type Plan } from '../src/sim/systems/interact';
import { itemOf, slot } from '../src/sim/systems/items';
import { canAnswer } from '../src/sim/systems/rollcall';
import { showerOffer } from '../src/sim/systems/showers';
import { vendProp } from '../src/sim/systems/vending';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { containersOf } from '../src/sim/world/containers';
import { LAYER, MAP_H, MAP_W, placeKey, tileOfKey } from '../src/sim/world/World';
import { check } from './assert';
import { Bot } from './bots';
import { PLANS, runRoute, type Route } from './escapes';

// The words come from the play layer, which reads the screen's size as it loads: a page without one.
GlobalRegistrator.register({ url: 'http://localhost:5310/', width: 1440, height: 844 });
const { setLang, t } = await import('../src/i18n');
const { actionWords, describePlan } = await import('../src/play/labels');
const { focusNow } = await import('../src/play/focus');
const { targets, updateTargets } = await import('../src/play/reach');

/** A time in each block of the day: roll call, breakfast, free time, work, exercise, showers, dinner, the evening, its roll call, lights out. */
const TIMES = [
  8 * 60 + 20,
  9 * 60 + 20,
  11 * 60,
  13 * 60 + 30,
  15 * 60 + 20,
  16 * 60 + 20,
  17 * 60 + 20,
  20 * 60,
  22 * 60 + 20,
  23 * 60 + 30,
];

const DIRT = slot(itemNumber('dirt'));
const DUMMY = slot(itemNumber('bed_dummy'));
const LIGHTER = slot(itemNumber('lighter'));

/**
 * Each spot as it is, then changed; each change returns its undoing (null: it doesn't apply here),
 * which reads the state afresh: a press tried in between puts back a copy of it.
 */
type Variant = (sim: Sim, tile: number) => ((sim: Sim) => void) | null;
const VARIANTS: Variant[] = [
  () => () => {},
  (sim) => inHand(sim, DIRT),
  (sim) => inHand(sim, DUMMY),
  (sim, tile) => {
    sim.state.items.ground.push([placeKey(LAYER.GROUND, tile), LIGHTER]);
    return (now) => void now.state.items.ground.pop();
  },
  (sim) => {
    const p = sim.state.player;
    const all = people(sim);
    let best = -1;
    let near = 2.2 * UNIT;
    all.forEach((m, k) => {
      const d = Math.hypot(m.body.x - p.x, m.body.z - p.z);
      if (d < near) [near, best] = [d, k];
    });
    if (best < 0) return null;
    const was = all[best].ko;
    all[best].ko = 200;
    return (now) => void (people(now)[best].ko = was);
  },
  (sim) => {
    const p = sim.state.player;
    const seat = sim.world.props.findIndex(
      (q) => SEATS.has(q.kind) && Math.abs(q.x + 0.5 - p.x / UNIT) < 1.6 && Math.abs(q.z + 0.5 - p.z / UNIT) < 1.6,
    );
    if (seat < 0) return null;
    const was = sim.state.seat;
    sim.state.seat = seat;
    return (now) => void (now.state.seat = was);
  },
  // Tired (the water cooler only serves the thirsty).
  (sim) => {
    const was = sim.state.energy;
    sim.state.energy = 40;
    return (now) => void (now.state.energy = was);
  },
];
const SEATS = new Set(['chair', 'bench', 'stool', 'seat']);
const TIRED = VARIANTS.length - 1;
function inHand(sim: Sim, v: number) {
  const it = sim.state.items;
  const hand = it.hand;
  const was = it.inv[hand];
  it.inv[hand] = v;
  return (now: Sim) => void (now.state.items.inv[hand] = was);
}

/** What a kind of press must do (an event of these types), unless it says why not. */
const DOES: Record<string, readonly string[]> = {
  peel: ['peel'],
  answer: ['count'],
  underline: ['rep'],
  readOn: ['train'],
  getUp: ['sit'],
  climbOut: ['stow'],
  stow: ['stow'],
  report: ['paper'],
  fileForm: ['paper'],
  showId: ['bluff'],
  climb: ['layer'],
  work: ['work'],
  tray: ['tray'],
  shower: ['wash'],
  vend: ['vend'],
  cooler: ['cooler'],
  menu: ['menu'],
  pickUp: ['pickup'],
  bed: ['bedDummy'],
  sleep: ['sleep'],
  talk: ['talk'],
  pockets: ['open'],
  search: ['open'],
  flush: ['flushed'],
  'fixture:board': ['board'],
  'fixture:generator': ['power'],
  'fixture:helicopter': ['board', 'escaped'],
  'fixture:vending': ['vend'],
  'fixture:cooler': ['cooler'],
  'fixture:sit': ['sit'],
  'fixture:rest': ['sit'],
};
/** The machines: a set started, or a turn asked for. */
const MACHINE = ['train', 'askTurn'];
/** Kinds that only ever refuse in these states, each for its own reason: the helicopter comes at night with the guards away, the machine is used from its front. */
const ONLY_REFUSED = new Set(['fixture:helicopter', 'fixture:vending']);
/** The cooler as a fixture in reach but not faced: possible, never met here. */
const UNMET = new Set(['fixture:cooler']);
const REFUSED = (e: SimEvent) => e.type === 'refused' || e.type.startsWith('cant');
const kindOf = (plan: Plan | null) => (!plan ? 'nothing' : plan.do === 'fixture' ? `fixture:${plan.target.use}` : plan.do);
const keyOf = (plan: Plan | null) => {
  if (!plan) return 'nothing';
  const at =
    'target' in plan ? JSON.stringify(plan.target) : plan.do === 'climb' ? plan.climb.tile : plan.do === 'work' ? plan.station.prop : '';
  return `${kindOf(plan)}|${at}`;
};
const RAW_KEY = /^[a-z]+(\.[A-Za-z0-9-]+)+$/;

/** The verbs a kind of press may be labelled with: the label names what the press does. */
function verbsFor(plan: Plan): string[] {
  switch (plan.do) {
    case 'climb':
      return [`act.${plan.climb.action}`];
    case 'work':
      return [`work.${plan.station.act}`];
    case 'tray':
      return ['act.takeTray', 'act.returnTray'];
    case 'bed':
      return ['act.tuckIn', 'act.takeOut'];
    case 'talk':
      return ['act.talk', 'act.talkGuard', 'act.deliver'];
    case 'fixture': {
      const use = plan.target.use;
      if (use === 'generator') return ['act.powerOff', 'act.powerOn'];
      if (use === 'helicopter') return ['act.helicopter', 'act.helipad'];
      if (use === 'vending') return ['act.vending'];
      if (use === 'cooler') return ['act.drinkAt'];
      // A seat or a machine: used, asked for when taken, the one on it talked to; a book read on a library chair.
      return [`act.${use}`, 'act.askTurn', 'act.talk', 'act.read'];
    }
    default:
      return [VERB[plan.do]];
  }
}
const VERB: Record<string, string> = {
  peel: 'act.peel',
  answer: 'act.here',
  readOn: 'act.read',
  getUp: 'act.getUp',
  climbOut: 'act.climbOut',
  stow: 'act.stow',
  report: 'act.report',
  fileForm: 'act.fileForm',
  showId: 'act.showId',
  shower: 'act.shower',
  vend: 'act.vending',
  cooler: 'act.drinkAt',
  menu: 'act.readMenu',
  pickUp: 'act.pickUpVerb',
  sleep: 'act.sleep',
  pockets: 'act.searchVerb',
  flush: 'act.flush',
  search: 'act.searchVerb',
};

/** Where what the press acts on stands, in tiles (null: nothing in particular, nothing to highlight). */
type Box = { x0: number; z0: number; x1: number; z1: number };
const propBox = (p: { x: number; z: number; w: number; d: number }): Box => ({ x0: p.x, z0: p.z, x1: p.x + p.w, z1: p.z + p.d });
const tileBox = (t: number): Box => ({ x0: t % MAP_W, z0: Math.floor(t / MAP_W), x1: (t % MAP_W) + 1, z1: Math.floor(t / MAP_W) + 1 });
function actedOn(sim: Sim, plan: Plan): Box | null {
  const w = sim.world;
  const box = (k: number) => propBox(containersOf(w)[k].prop);
  switch (plan.do) {
    case 'climb':
      return tileBox(plan.climb.tile);
    case 'work':
      return plan.station.prop >= 0 ? propBox(w.props[plan.station.prop]) : tileBox(plan.station.tile);
    case 'tray': {
      const k = servingCounter(sim);
      return k >= 0 ? box(k) : plan.target?.kind === 'container' ? box(plan.target.index) : null;
    }
    case 'shower':
      return tileBox(showerOffer(sim, plan.target));
    case 'vend':
      return propBox(vendProp(sim)!);
    case 'cooler':
      return propBox(coolerProp(sim)!);
    case 'menu': {
      const m = w.def.menu!;
      return { x0: m.x, z0: m.z, x1: m.x + m.w, z1: m.z + 1 };
    }
    case 'talk':
    case 'pockets': {
      const b = personOf(sim.state, plan.target.who)!.body;
      return { x0: b.x / UNIT - 0.5, z0: b.z / UNIT - 0.5, x1: b.x / UNIT + 0.5, z1: b.z / UNIT + 0.5 };
    }
    case 'pickUp':
      return tileBox(tileOfKey(sim.state.items.ground[plan.target.index][0]));
    case 'fixture':
      return propBox(w.props[plan.target.index]);
    case 'bed':
    case 'sleep':
    case 'flush':
    case 'search':
      return box(plan.target.index);
    case 'report':
    case 'fileForm':
    case 'showId': {
      const tg = plan.target;
      return !tg ? null : tg.kind === 'container' ? box(tg.index) : tg.kind === 'fixture' ? propBox(w.props[tg.index]) : null;
    }
    default:
      return null;
  }
}
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 + 0.05 && b.x0 < a.x1 + 0.05 && a.z0 < b.z1 + 0.05 && b.z0 < a.z1 + 0.05;

/** The play layer's plan for this state: its memo worked out afresh (the step hasn't moved between spots). */
function planNow(sim: Sim): Plan | null {
  targets.step = -1;
  updateTargets(sim, false, false, itemOf(sim.state.items.inv[sim.state.items.hand]));
  return targets.plan;
}

const pressed = new Map<string, number>();
const refused = new Map<string, number>();
let states = 0;
let trials = 0;
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

/** The plan pressed on this very state, then the state put back; its words and its highlight. */
function press(sim: Sim, where: string) {
  const plan = planNow(sim);
  const kind = kindOf(plan);
  trials++;
  const at = sim.snapshot();
  const before = JSON.stringify({ ...sim.state, items: { ...sim.state.items, rev: 0 } });
  sim.events = [];
  useItems(sim, command(0, OP.INTERACT));
  const events = sim.events;
  let no = false;
  if (!plan) {
    const after = JSON.stringify({ ...sim.state, items: { ...sim.state.items, rev: 0 } });
    check(
      events.length === 0 && after === before,
      `${where}: no plan, and the press did nothing (${events.map((e) => e.type).join(', ')})`,
    );
    bump(pressed, kind);
  } else {
    const want = DOES[kind] ?? (kind.startsWith('fixture:') ? MACHINE : []);
    const did = events.some((e) => want.includes(e.type));
    no = !did && events.some(REFUSED);
    check(want.length > 0, `${where}: what a press of "${kind}" does is known to this test`);
    check(
      did || no,
      `${where}: "${kind}" pressed: ${events.map((e) => e.type).join(', ') || 'nothing happened'} (wanted ${want.join(' or ')}, or a refusal)`,
    );
    bump(no ? refused : pressed, kind);
  }
  sim.restore(at);
  const st = sim.state;
  const held = itemOf(st.items.inv[st.items.hand]);
  // What the button says, in both languages, as it shows it (reading at a chair: the reading game has the screen).
  for (const lang of ['en', 'fr'] as const) {
    setLang(lang);
    const said = describePlan(sim, plan, held);
    const shown = actionWords(sim, plan, held, false, false);
    const busyShown = actionWords(sim, plan, held, true, false);
    if (!plan || plan.do === 'underline') check(said === null && shown === null, `${where}: no words for "${kind}" (${lang})`);
    else {
      check(
        !!said &&
          said.verb.trim() !== '' &&
          !RAW_KEY.test(said.verb) &&
          !RAW_KEY.test(said.what) &&
          !/undefined|\{/.test(said.verb + said.what),
        `${where}: "${kind}" says something in ${lang} (${said ? `${said.verb} / ${said.what}` : 'nothing'})`,
      );
      const verbs = verbsFor(plan).map((k) => t(k as Parameters<typeof t>[0]));
      check(
        !!said && verbs.includes(said.verb),
        `${where}: "${kind}" is labelled with its own verb in ${lang} ("${said?.verb}", not ${verbs.join(' / ')})`,
      );
      // Shown as said, nothing covering the screen; while busy, only in solitary and stowed away.
      const covered = st.seat >= 0 && st.train >= 0;
      check(covered ? shown === null : shown === said, `${where}: "${kind}" shown on the button (${lang})`);
      check(st.solitary > 0 || st.stowed ? busyShown === said : busyShown === null, `${where}: "${kind}" while busy (${lang})`);
      // At the desk's tray and the window, greyed exactly when the press is refused; Report never (it can be tried).
      if (plan.do === 'fileForm' || plan.do === 'showId' || plan.do === 'report')
        check(!!said?.no === (plan.do !== 'report' && no), `${where}: "${kind}" greyed ${no ? 'as' : 'only if'} refused (${lang})`);
    }
  }
  // What it highlights: the very thing the press acts on.
  const thing = plan && actedOn(sim, plan);
  if (thing) {
    const box = focusNow(sim, plan);
    check(
      !!box && overlaps(box, thing),
      `${where}: "${kind}" highlights what it acts on (${box ? `${box.x0.toFixed(1)},${box.z0.toFixed(1)}` : 'nothing'})`,
    );
  }
}

// ------------------------------------------------------------------ the sweep: every prison, a time in each block
for (const def of PRISONS) {
  const bot = new Bot(def, 3);
  const sim = bot.sim;
  for (const minute of TIMES) {
    bot.routineUntil(1, minute);
    const home = sim.snapshot();
    const tried = new Set<string>();
    // Beside every prop and every person, facing them (and where the bot stands, facing its way).
    const spots: Array<[number, number, number]> = [];
    const me = sim.state.player;
    spots.push([Math.floor(me.x / UNIT), Math.floor(me.z / UNIT), me.facing]);
    const things = [
      ...sim.world.props.map((q) => ({ x: q.x, z: q.z, w: q.w, d: q.d })),
      ...people(sim).map((m) => ({ x: Math.floor(m.body.x / UNIT), z: Math.floor(m.body.z / UNIT), w: 1, d: 1 })),
    ];
    for (const t of things)
      for (let x = t.x - 1; x <= t.x + t.w; x++)
        for (let z = t.z - 1; z <= t.z + t.d; z++) {
          const inside = x >= t.x && x < t.x + t.w && z >= t.z && z < t.z + t.d;
          const corner = (x < t.x || x >= t.x + t.w) && (z < t.z || z >= t.z + t.d);
          if (inside || corner || x < 0 || z < 0 || x >= MAP_W || z >= MAP_H || sim.world.blocked(x, z)) continue;
          spots.push([x, z, x < t.x ? 1 : x >= t.x + t.w ? 9 : z < t.z ? 5 : 13]);
        }
    for (const [x, z, facing] of spots) {
      const p = sim.state.player;
      p.x = x * UNIT + UNIT / 2;
      p.z = z * UNIT + UNIT / 2;
      p.facing = facing;
      for (const [v, variant] of VARIANTS.entries()) {
        const undo = variant(sim, z * MAP_W + x);
        if (!undo) continue;
        states++;
        // (Tired, the same plan can do otherwise: the cooler serves the thirsty.)
        const key = (v === TIRED ? 'tired|' : '') + keyOf(planNow(sim));
        if (!tried.has(key)) {
          tried.add(key);
          press(sim, `${def.id} ${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')} at ${x},${z}`);
        }
        undo(sim);
      }
    }
    sim.restore(home);
  }
}

// ------------------------------------------------------------------ what the sweep never meets
// Called at roll call, by a bot that waits to be called (Bot answers by itself unless silent).
for (const def of PRISONS) {
  const bot = new Bot(def, 3);
  bot.silent = true;
  bot.keepRoutine(() => canAnswer(bot.sim), 90 * STEPS_PER_MINUTE);
  check(canAnswer(bot.sim), `${def.id}: called at roll call`);
  press(bot.sim, `${def.id} roll call`);
  // In solitary: the potato.
  bot.sim.state.solitary = 100;
  press(bot.sim, `${def.id} solitary`);
  bot.sim.state.solitary = 0;
  // A book in hand on a library chair: opened there; then reading, the press underlines.
  const w = bot.sim.world;
  const chair = w.props.findIndex((q) => q.kind === 'chair' && w.zoneAt(q.x, q.z) === 'library');
  const shelf = w.props.findIndex((q) => q.kind === 'shelf' && w.zoneAt(q.x, q.z) === 'library');
  if (chair >= 0 && shelf >= 0) {
    const s = bot.sim.state;
    [s.player.x, s.player.z, s.seat, s.book] = [(w.props[chair].x + 0.5) * UNIT, (w.props[chair].z + 0.5) * UNIT, chair, 1];
    press(bot.sim, `${def.id} library chair`);
    bot.sim.state.train = shelf; // (the press put back a copy: the state afresh)
    press(bot.sim, `${def.id} reading`);
  }
}

// From the escape bots' own runs: the presses they make at the vehicle, the release desk, the checkpoint.
const RARE = new Set(['stow', 'climbOut', 'report', 'fileForm', 'showId']);
const ROUTES: Array<[string, Route]> = [
  ['center-perks', 'stowaway'],
  ['center-perks', 'bluff'],
  ['center-perks', 'paperwork'],
  ['irongate', 'stowaway'],
];
const caught: Array<{ prison: string; route: string; snap: ReturnType<Sim['snapshot']>; kind: string }> = [];
const proto = Bot.prototype as unknown as { step(this: Bot, cmd?: number): void };
const step = proto.step;
let route = '';
proto.step = function (this: Bot, cmd = 0) {
  const sim = this.sim;
  if (opOf(cmd) === OP.INTERACT && argA(cmd) === 0 && !sim.state.sleeping && sim.state.ko <= 0) {
    const kind = kindOf(planNow(sim));
    if (RARE.has(kind) && caught.filter((c) => c.kind === kind).length < 4)
      caught.push({ prison: sim.prison.id, route, snap: sim.snapshot(), kind });
  }
  step.call(this, cmd);
};
const log = console.log;
console.log = () => {};
for (const [id, r] of ROUTES) {
  route = `${id} ${r}`;
  runRoute(
    PLANS.find((p) => p.def.id === id)!,
    r,
  );
}
console.log = log;
proto.step = step;
for (const c of caught) {
  const sim = new Sim(
    PRISONS.find((p) => p.id === c.prison)!,
    1,
  );
  sim.restore(c.snap);
  press(sim, `${c.route} bot, its ${c.kind}`);
  // In a lockdown the tray and the window turn the player away: the button greyed, saying why.
  if (c.kind === 'fileForm' || c.kind === 'showId') {
    sim.state.lockdown = true;
    press(sim, `${c.route} bot, its ${c.kind} in a lockdown`);
  }
}

// Every kind met, and done (not only refused) somewhere, so that the coverage can't quietly shrink.
const MUST = [...Object.keys(DOES).filter((k) => !ONLY_REFUSED.has(k) && !UNMET.has(k)), 'nothing'];
for (const k of MUST) check(pressed.has(k), `"${k}" was pressed and did it somewhere`);
for (const k of ONLY_REFUSED) check(pressed.has(k) || refused.has(k), `"${k}" was pressed somewhere`);
for (const k of ['fileForm', 'showId']) check(refused.has(k), `"${k}" was refused somewhere (its greyed button checked)`);
setLang('en');
await GlobalRegistrator.unregister();

console.log(`${states} places and moments in the sweep, ${trials} different presses tried`);
const kinds = [...new Set([...pressed.keys(), ...refused.keys()])].sort();
for (const k of kinds)
  console.log(
    `  ${k}: ${pressed.get(k) ?? 0} ${k === 'nothing' ? 'did nothing' : 'did it'}${refused.has(k) ? `, ${refused.get(k)} said why not` : ''}`,
  );
console.log(
  'every press does what its plan says (or says why not), and every kind does it somewhere; a press with no plan does nothing; the button shows it in English and French with its own verb, greyed as refused, and highlights what it acts on',
);
