/**
 * The action button says, shows and does one thing (v2.34.2, the improvement queue's session 2).
 * What a press does is decided once, by `interactPlan` (sim/systems/interact.ts): actions.ts does
 * it, the label (labels.ts's describePlan) says it, the highlight (focus.ts) marks it. Here, in every
 * prison, at a time in each block of the day, standing beside every prop and every person and facing
 * them, as is and with dirt or a bed dummy in hand, an item on the floor, the nearest person out
 * cold, seated on the nearest seat:
 * - each different plan is pressed on that very state (`useItems`, nobody moving): it does what the
 *   plan says, or says why not (a refusal), and a press with no plan does nothing at all;
 * - its label has words in English and in French, and the highlight is drawn, within reach.
 * (The press itself lands a step later, after everyone has moved: a guard walking past can be out of
 * reach by then. That's the step between what's drawn and what's done, the same for any input.)
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { PRISONS } from '../src/content/prisons';
import { itemNumber } from '../src/content/items';
import { command, OP } from '../src/sim/command';
import type { Sim, SimEvent } from '../src/sim/Sim';
import { useItems } from '../src/sim/systems/actions';
import { interactPlan, people, type Plan } from '../src/sim/systems/interact';
import { itemOf, slot } from '../src/sim/systems/items';
import { UNIT } from '../src/sim/tuning';
import { LAYER, MAP_H, MAP_W, placeKey } from '../src/sim/world/World';
import { check } from './assert';
import { Bot } from './bots';

// The words come from the play layer, which reads the screen's size as it loads: a page without one.
GlobalRegistrator.register({ url: 'http://localhost:5310/', width: 1440, height: 844 });
const { setLang, t } = await import('../src/i18n');
const { describePlan } = await import('../src/play/labels');
const { focusNow } = await import('../src/play/focus');

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
];
const SEATS = new Set(['chair', 'bench', 'stool', 'seat']);
function inHand(sim: Sim, v: number) {
  const it = sim.state.items;
  const hand = it.hand;
  const was = it.inv[hand];
  it.inv[hand] = v;
  return (now: Sim) => void (now.state.items.inv[hand] = was);
}

/** What a kind of press must do (an event of these types), unless it says why not. */
const DOES: Record<string, readonly string[]> = {
  answer: ['count'],
  climb: ['layer'],
  cooler: ['cooler'],
  vend: ['vend'],
  menu: ['menu'],
  tray: ['tray'],
  shower: ['wash'],
  work: ['work'],
  pickUp: ['pickup'],
  bed: ['bedDummy'],
  sleep: ['sleep'],
  talk: ['talk'],
  pockets: ['open'],
  search: ['open'],
  flush: ['flushed'],
  getUp: ['sit'],
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

const pressed = new Map<string, number>();
const refused = new Map<string, number>();
let states = 0;
let trials = 0;
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
      for (const variant of VARIANTS) {
        const undo = variant(sim, z * MAP_W + x);
        if (!undo) continue;
        states++;
        const plan = interactPlan(sim);
        const key = keyOf(plan);
        if (!tried.has(key)) {
          tried.add(key);
          trials++;
          press(sim, plan, `${def.id} ${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')} at ${x},${z}`);
        }
        undo(sim);
      }
    }
    sim.restore(home);
  }
}

/** The plan pressed on this very state, then the state put back; its words and its highlight. */
function press(sim: Sim, plan: Plan | null, where: string) {
  const kind = kindOf(plan);
  const at = sim.snapshot();
  const before = JSON.stringify({ ...sim.state, items: { ...sim.state.items, rev: 0 } });
  sim.events = [];
  useItems(sim, command(0, OP.INTERACT));
  const events = sim.events;
  if (!plan) {
    const after = JSON.stringify({ ...sim.state, items: { ...sim.state.items, rev: 0 } });
    check(
      events.length === 0 && after === before,
      `${where}: no plan, and the press did nothing (${events.map((e) => e.type).join(', ')})`,
    );
    pressed.set(kind, (pressed.get(kind) ?? 0) + 1);
  } else {
    const want = DOES[kind] ?? (kind.startsWith('fixture:') ? MACHINE : []);
    const did = events.some((e) => want.includes(e.type));
    const no = !did && events.some(REFUSED);
    check(want.length > 0, `${where}: what a press of "${kind}" does is known to this test`);
    check(
      did || no,
      `${where}: "${kind}" pressed: ${events.map((e) => e.type).join(', ') || 'nothing happened'} (wanted ${want.join(' or ')}, or a refusal)`,
    );
    (no ? refused : pressed).set(kind, ((no ? refused : pressed).get(kind) ?? 0) + 1);
  }
  sim.restore(at);
  const held = itemOf(sim.state.items.inv[sim.state.items.hand]);
  // What the button says, in both languages (reading at a chair: the reading game has the screen).
  for (const lang of ['en', 'fr'] as const) {
    setLang(lang);
    const words = describePlan(sim, plan, held);
    if (!plan || plan.do === 'underline') check(words === null, `${where}: no words for "${kind}" (${lang})`);
    else
      check(
        !!words &&
          words.verb.trim() !== '' &&
          !RAW_KEY.test(words.verb) &&
          !RAW_KEY.test(words.what) &&
          !/undefined|\{/.test(words.verb + words.what),
        `${where}: "${kind}" says something in ${lang} (${words ? `${words.verb} / ${words.what}` : 'nothing'})`,
      );
    if (plan && words) {
      const verbs = verbsFor(plan).map((k) => t(k as Parameters<typeof t>[0]));
      check(
        verbs.includes(words.verb),
        `${where}: "${kind}" is labelled with its own verb in ${lang} ("${words.verb}", not ${verbs.join(' / ')})`,
      );
    }
  }
  // What it highlights: something within reach of the player whenever the press acts on a thing.
  const box = focusNow(sim, plan);
  if (
    plan &&
    ('target' in plan
      ? !!plan.target
      : plan.do === 'climb' || plan.do === 'work' || plan.do === 'vend' || plan.do === 'cooler' || plan.do === 'menu')
  ) {
    const pl = sim.state.player;
    const near =
      !!box && Math.hypot(clamp(pl.x / UNIT, box.x0, box.x1) - pl.x / UNIT, clamp(pl.z / UNIT, box.z0, box.z1) - pl.z / UNIT) <= 2.5;
    check(near, `${where}: "${kind}" highlighted within reach (${box ? `${box.x0.toFixed(1)},${box.z0.toFixed(1)}` : 'nothing'})`);
  }
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// Every kind seen at least once, so that the coverage can't quietly shrink.
const MUST = [
  'nothing',
  'climb',
  'cooler',
  'vend',
  'menu',
  'tray',
  'shower',
  'work',
  'pickUp',
  'bed',
  'sleep',
  'talk',
  'pockets',
  'search',
  'flush',
  'getUp',
];
for (const k of MUST) check(pressed.has(k) || refused.has(k), `"${k}" was pressed somewhere`);
setLang('en');
await GlobalRegistrator.unregister();

console.log(`${states} places and moments, ${trials} different presses tried`);
const kinds = [...new Set([...pressed.keys(), ...refused.keys()])].sort();
for (const k of kinds)
  console.log(
    `  ${k}: ${pressed.get(k) ?? 0} ${k === 'nothing' ? 'did nothing' : 'did it'}${refused.has(k) ? `, ${refused.get(k)} said why not` : ''}`,
  );
console.log(
  'every press does what its plan says (or says why not); a press with no plan does nothing; each says it in English and French, and its highlight is in reach',
);
