/** Training (GDD §3.2): Strength, Speed and Intellect, the equipment and the library, a set's bar. */
import { nearestDir } from '../ai/path';
import type { SimContext } from '../context';
import { type Attr, ATTRS } from '../events';
import { ATTR_MAX, GIVE_WAY_STEPS, GYM_ENERGY, REP_DRAIN_STEPS, REP_GAIN, SET_BEATS, STUDY_ENERGY, STUDY_TIP_EVERY, TALK_REACH, TIRED, TRAIN_GAIN, UNIT } from '../tuning';
import { containersOf } from '../world/containers';
import { LAYER } from '../world/World';
import type { FixtureUse } from './items';
import { revealTip } from './recipes';
import { approach, endTalk } from './social';
import { energyCost } from './weather';
import { closeBox, fixtureUse, REACH } from './items';
import { atProp } from './rest';
import { ON_MACHINE } from '../ai/doing';
import { placesOf } from '../ai/places';
import { tileAt } from '../world/grid';

export function attr(sim: SimContext, a: Attr): number {
  const s = sim.state;
  return a === 'str' ? s.str : a === 'spd' ? s.spd : s.items.int;
}

export function setAttr(sim: SimContext, a: Attr, v: number) {
  const s = sim.state;
  if (a === 'str') s.str = v;
  else if (a === 'spd') s.spd = v;
  else {
    s.items.int = v;
    s.items.rev++;
  }
}

/** What a prop trains: the weights, P31's pull-up bar and 2.29's mat Strength, the treadmill and 2.29's bag Speed, a library shelf Intellect. */
export function trainsOn(sim: Pick<SimContext, 'world'>, prop: number): Attr | null {
  const kind = sim.world.props[prop]?.kind;
  return kind === 'weights' || kind === 'pullup' || kind === 'mat' ? 'str' : kind === 'treadmill' || kind === 'punchingBag' ? 'spd' : kind === 'shelf' ? 'int' : null;
}

/** What a set costs now: as it's written, and double when chilled. */
export const setCost = (sim: SimContext, a: Attr) => energyCost(sim, a === 'int' ? STUDY_ENERGY : GYM_ENERGY);

/** A prop's pace (2.29): the shelf for anything not otherwise listed. */
export const beatOf = (kind: string) => SET_BEATS[kind as keyof typeof SET_BEATS] ?? SET_BEATS.shelf;

/** The beat a step belongs to, and how far from it the step is: the beats fall on whole multiples of `beat`, for everyone, from the start. */
export function beatAt(step: number, beat: number): { n: number; off: number } {
  const n = Math.floor((step + beat / 2) / beat);
  return { n, off: step - n * beat };
}

/** The inmate on a machine (2.29), -1 nobody: arrived and using it, not on the way. */
export function onMachine(sim: Pick<SimContext, 'state' | 'world'>, prop: number): number {
  const spot = placesOf(sim.world).machines.find((q) => q.prop === prop);
  if (!spot) return -1;
  return sim.state.inmates.findIndex((m) => m.goal === spot.tile && ON_MACHINE.includes(m.doing) && m.ko === 0 && tileAt(m.body.x, m.body.z) === spot.tile);
}

/** Whether a set can't be begun: why (shown), or null. */
function refused(sim: SimContext, a: Attr): 'tired' | 'max' | null {
  return sim.state.energy < TIRED ? 'tired' : attr(sim, a) >= ATTR_MAX ? 'max' : null;
}

/**
 * What the button does at a machine with someone on it (2.29): asks for a turn; or, with no use for the machine (too
 * tired, as good as it gets), talks to them instead, since they can't otherwise be reached. As labels.ts says.
 */
export function machineOffer(sim: SimContext, prop: number): 'ask' | 'talk' | null {
  if (sim.rules228) return null;
  const a = trainsOn(sim, prop);
  const who = onMachine(sim, prop);
  if (!a || who < 0) return null;
  if (!refused(sim, a)) return 'ask';
  // (Out of a talk's reach, across the machine: told why not, as at a free one.)
  const m = sim.state.inmates[who].body;
  return Math.max(Math.abs(m.x - sim.state.player.x), Math.abs(m.z - sim.state.player.z)) <= TALK_REACH ? 'talk' : null;
}

/** The action button at a machine: on it, or someone's on it: they're asked for a turn. Nobody's refused for that. */
export function useMachine(sim: SimContext, prop: number, use: FixtureUse | 'study') {
  const s = sim.state;
  const offer = machineOffer(sim, prop);
  if (!offer) {
    startTraining(sim, prop, use);
    return;
  }
  const who = onMachine(sim, prop);
  if (offer === 'talk') {
    approach(sim, who);
    return;
  }
  if (s.askTurn[0] === prop) return;
  endTalk(sim);
  closeBox(sim);
  s.player.moving = false;
  s.askTurn = [prop, GIVE_WAY_STEPS];
  sim.events.push({ type: 'askTurn', who });
}

/** Each step, waiting for a turn: given it when they've finished up (or gone, whatever took them); a step away, an arrest or the like calls it off. */
export function keepTurn(sim: SimContext) {
  const s = sim.state;
  if (!s.askTurn.length) return;
  const [prop, left] = s.askTurn;
  if (sim.away || s.lockdown || s.sleeping || s.ko > 0 || s.solitary > 0 || s.layer !== LAYER.GROUND || !atProp(sim.world, prop, s.player, REACH + UNIT / 4)) {
    s.askTurn = [];
    return;
  }
  if (left > 1 && onMachine(sim, prop) >= 0) {
    s.askTurn[1] = left - 1;
    return;
  }
  s.askTurn = [];
  startTraining(sim, prop, fixtureUse(sim.world, sim.world.props[prop]) as FixtureUse);
}

/** On the equipment: the set's bar starts empty. Too tired (under 10% energy), nothing doing. */
export function startTraining(sim: SimContext, prop: number, use: FixtureUse | 'study') {
  const s = sim.state;
  const a = trainsOn(sim, prop);
  if (!a) return;
  const why = refused(sim, a);
  if (why) {
    sim.events.push({ type: 'cantTrain', why });
    return;
  }
  endTalk(sim);
  closeBox(sim);
  const p = sim.world.props[prop];
  s.player.moving = false;
  s.player.facing = nearestDir((p.x + p.w / 2) * UNIT - s.player.x, (p.z + p.d / 2) * UNIT - s.player.z) || s.player.facing;
  s.train = prop;
  s.reps = 0;
  s.repSide = 0;
  s.repBeat = -1;
  s.askTurn = [];
  sim.events.push({ type: 'train', on: true, use });
}

/** Studying at the library shelf whose panel is open. */
export function study(sim: SimContext) {
  const s = sim.state;
  const box = containersOf(sim.world)[s.items.open];
  if (!box || box.prop.kind !== 'shelf' || sim.world.zoneAt(box.prop.x, box.prop.z) !== 'library') return;
  startTraining(sim, sim.world.props.indexOf(box.prop), 'study');
}

/**
 * A press: only one on the other side from the last counts, and (2.29) only the first of each beat, for much more on
 * the beat than off it, so that mashing is the slow way. A full bar is a set: +2, and the energy it costs.
 */
export function rep(sim: SimContext, side: number) {
  const s = sim.state;
  if (s.train < 0 || side === s.repSide) return;
  if (sim.rules228) {
    s.repSide = side;
    s.reps = Math.min(100, s.reps + REP_GAIN);
    sim.events.push({ type: 'rep' });
  } else {
    const set = beatOf(sim.world.props[s.train].kind);
    const { n, off } = beatAt(s.step, set.beat);
    if (n === s.repBeat) return;
    s.repBeat = n;
    s.repSide = side;
    const hit = Math.abs(off) <= set.window;
    s.reps = Math.min(100, s.reps + (hit ? set.hit : set.miss));
    sim.events.push({ type: 'rep', hit });
  }
  if (s.reps < 100) return;
  const a = trainsOn(sim, s.train)!;
  s.reps = 0;
  setAttr(sim, a, Math.min(ATTR_MAX, attr(sim, a) + TRAIN_GAIN));
  s.trained |= 1 << ATTRS.indexOf(a);
  s.energy = Math.max(0, s.energy - setCost(sim, a));
  sim.events.push({ type: 'trained', attr: a, value: attr(sim, a) });
  // Studying to a new mark (every STUDY_TIP_EVERY points, never the same one twice): a recipe in the books (P8+).
  const mark = Math.floor(attr(sim, a) / STUDY_TIP_EVERY);
  if (a === 'int' && mark > s.studied) {
    s.studied = mark;
    revealTip(sim);
  }
  // Spent, or as good as it gets: off the equipment.
  if (s.energy < TIRED || attr(sim, a) >= ATTR_MAX) {
    sim.events.push({ type: 'cantTrain', why: s.energy < TIRED ? 'tired' : 'max' });
    stopTraining(sim);
  }
}

/** Each step on the equipment: a lockdown, a knockout or a blow ends it; before 2.29, the bar drains. */
export function keepTraining(sim: SimContext) {
  const s = sim.state;
  if (s.train < 0) return;
  if (sim.away || s.lockdown || s.sleeping || s.layer !== LAYER.GROUND) {
    stopTraining(sim);
    return;
  }
  if (sim.rules228 && s.reps > 0 && s.step % REP_DRAIN_STEPS === 0) s.reps--;
}

export function stopTraining(sim: SimContext) {
  const s = sim.state;
  // (Waiting for a turn, whatever calls off a set calls that off too.)
  s.askTurn = [];
  if (s.train < 0) return;
  const use = sim.world.props[s.train].kind;
  s.train = -1;
  s.reps = 0;
  s.repSide = 0;
  sim.events.push({ type: 'train', on: false, use: use === 'shelf' ? 'study' : (use as FixtureUse) });
}
