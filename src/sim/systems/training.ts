/** Training (GDD §3.2): Strength, Speed and Intellect, the equipment and the library, a set's bar. */
import { nearestDir as faceTo } from '../ai/path';
import type { SimContext } from '../context';
import { type Attr, ATTRS } from '../events';
import { ATTR_MAX, GYM_ENERGY, REP_DRAIN_STEPS, REP_GAIN, STUDY_ENERGY, STUDY_TIP_EVERY, TIRED, TRAIN_GAIN, UNIT } from '../tuning';
import { containersOf } from '../world/containers';
import { LAYER } from '../world/World';
import { closeBox } from './actions';
import type { FixtureUse } from './items';
import { revealTip } from './recipes';
import { endTalk } from './social';
import { energyCost } from './weather';

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

/** What a prop trains: the weights (and P31's pull-up bar) Strength, the treadmill Speed, a library shelf Intellect. */
export function trainsOn(sim: SimContext, prop: number): Attr | null {
  const kind = sim.world.props[prop]?.kind;
  return kind === 'weights' || kind === 'pullup' ? 'str' : kind === 'treadmill' ? 'spd' : kind === 'shelf' ? 'int' : null;
}

/** On the equipment: the set's bar starts empty. Too tired (under 10% energy), nothing doing. */
export function startTraining(sim: SimContext, prop: number, use: FixtureUse | 'study') {
  const s = sim.state;
  const a = trainsOn(sim, prop);
  if (!a) return;
  if (s.energy < TIRED) {
    sim.events.push({ type: 'cantTrain', why: 'tired' });
    return;
  }
  if (attr(sim, a) >= ATTR_MAX) {
    sim.events.push({ type: 'cantTrain', why: 'max' });
    return;
  }
  endTalk(sim);
  closeBox(sim);
  const p = sim.world.props[prop];
  s.player.moving = false;
  s.player.facing = faceTo((p.x + p.w / 2) * UNIT - s.player.x, (p.z + p.d / 2) * UNIT - s.player.z) || s.player.facing;
  s.train = prop;
  s.reps = 0;
  s.repSide = 0;
  sim.events.push({ type: 'train', on: true, use });
}

/** Studying at the library shelf whose panel is open. */
export function study(sim: SimContext) {
  const s = sim.state;
  const box = containersOf(sim.world)[s.items.open];
  if (!box || box.prop.kind !== 'shelf' || sim.world.zoneAt(box.prop.x, box.prop.z) !== 'library') return;
  startTraining(sim, sim.world.props.indexOf(box.prop), 'study');
}

/** A press: only one on the other side from the last counts. A full bar is a set: +2, and the energy it costs. */
export function rep(sim: SimContext, side: number) {
  const s = sim.state;
  if (s.train < 0 || side === s.repSide) return;
  s.repSide = side;
  s.reps = Math.min(100, s.reps + REP_GAIN);
  sim.events.push({ type: 'rep' });
  if (s.reps < 100) return;
  const a = trainsOn(sim, s.train)!;
  s.reps = 0;
  setAttr(sim, a, Math.min(ATTR_MAX, attr(sim, a) + TRAIN_GAIN));
  s.trained |= 1 << ATTRS.indexOf(a);
  s.energy = Math.max(0, s.energy - energyCost(sim, a === 'int' ? STUDY_ENERGY : GYM_ENERGY));
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

/** Each step on the equipment: the bar drains; a lockdown, a knockout or a blow ends it. */
export function keepTraining(sim: SimContext) {
  const s = sim.state;
  if (s.train < 0) return;
  if (sim.away || s.lockdown || s.sleeping || s.layer !== LAYER.GROUND) {
    stopTraining(sim);
    return;
  }
  if (s.reps > 0 && s.step % REP_DRAIN_STEPS === 0) s.reps--;
}

export function stopTraining(sim: SimContext) {
  const s = sim.state;
  if (s.train < 0) return;
  const use = sim.world.props[s.train].kind;
  s.train = -1;
  s.reps = 0;
  s.repSide = 0;
  sim.events.push({ type: 'train', on: false, use: use === 'shelf' ? 'study' : (use as FixtureUse) });
}
