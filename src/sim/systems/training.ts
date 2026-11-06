/** Training (GDD §3.2): Strength, Speed and Intellect, the equipment and the library, a set's bar. */
import { nearestDir } from '../ai/path';
import type { SimContext } from '../context';
import { type Attr, ATTRS } from '../events';
import { ATTR_MAX, GIVE_WAY_STEPS, GYM_ENERGY, READ_FILL_EVERY, READ_HIT, READ_LEAD, READ_SETS_A_DAY, READ_WAIT, READ_WINDOW, REP_DRAIN_STEPS, REP_GAIN, SET_BEATS, STUDY_ENERGY, STUDY_TIP_EVERY, TALK_REACH, TIRED, TRAIN_GAIN, UNIT } from '../tuning';
import { keyAt, keyFrom, READ_PACE, SUBJECTS } from '../../content/books';
import { containersOf } from '../world/containers';
import { LAYER, MAP_W } from '../world/World';
import type { FixtureUse } from './items';
import { revealTip } from './recipes';
import { approach, endTalk } from './social';
import { energyCost } from './weather';
import { closeBox, fixtureUse, REACH } from './items';
import { atProp, propReach } from './rest';
import { ON_MACHINE } from '../ai/doing';
import { placesOf } from '../ai/places';
import { inmateInCell } from './inmates';
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
function refused(sim: SimContext, a: Attr): 'tired' | 'max' | 'full' | null {
  if (a === 'int' && headFull(sim) && attr(sim, a) < ATTR_MAX) return 'full';
  return sim.state.energy < TIRED ? 'tired' : attr(sim, a) >= ATTR_MAX ? 'max' : null;
}

/** The librarian (2.31), by index, -1 none. */
export const librarianOf = (sim: Pick<SimContext, 'state' | 'world'>) => inmateInCell(sim.state, sim.world.def.leisure?.librarian?.cell ?? -1);

/** The day's reading done (2.31): no more till tomorrow. */
export const headFull = (sim: Pick<SimContext, 'state' | 'rules230'>) => !sim.rules230 && sim.state.readToday >= READ_SETS_A_DAY;

/** Why a book can't be read now (shown on the shelf's panel), or null. */
export const cantRead = (sim: SimContext) => refused(sim, 'int');

/** How slowly the marker reads (books.ts READ_PACE): at 2.31's speed in a run from before 2.34. */
export const readPace = (sim: Pick<SimContext, 'rules233'>) => (sim.rules233 ? 1 : READ_PACE);

/** Reading a book now (2.31), rather than the old set at the shelf. */
export const reading = (sim: SimContext) => !sim.rules230 && sim.state.train >= 0 && sim.world.props[sim.state.train].kind === 'shelf';

/** A library shelf, for a set read on a chair (`train` names the shelf). */
const shelfIndex = (sim: SimContext) => sim.world.props.findIndex((p) => p.kind === 'shelf' && sim.world.zoneAt(p.x, p.z) === 'library');

/** With a book, on a library chair, not reading. */
export function onReadChair(sim: SimContext): boolean {
  const s = sim.state;
  if (sim.rules230 || !s.book || s.seat < 0 || s.train >= 0) return false;
  const p = sim.world.props[s.seat];
  return (p.kind === 'chair' || p.kind === 'readChair') && sim.world.zoneAt(p.x, p.z) === 'library';
}

/** And able to read: the action button opens the book (spent, or at 100, it gets them up, as anywhere). */
export const readSeated = (sim: SimContext) => onReadChair(sim) && !refused(sim, 'int');

/** Into the book in hand, from the chair the player's on. */
export function readOn(sim: SimContext) {
  const shelf = shelfIndex(sim);
  if (shelf >= 0) startTraining(sim, shelf, 'study');
}

/**
 * With a book in hand: the nearest free library chair in reach, -1 none. It comes before anyone about to talk to:
 * the arrows lead to it, and the button there is for reading (both the action and its label ask).
 */
export function chairForBook(sim: SimContext): number {
  const s = sim.state;
  if (sim.rules230 || !s.book || s.seat >= 0 || s.train >= 0 || s.layer !== LAYER.GROUND) return -1;
  const busy = (t: number) => s.inmates.some((m) => m.ko === 0 && m.angry <= 0 && m.plan >= 0 && (m.goal === t || m.seat === t || tileAt(m.body.x, m.body.z) === t));
  let best = -1;
  let near = Infinity;
  sim.world.props.forEach((p, k) => {
    if ((p.kind !== 'chair' && p.kind !== 'readChair') || sim.world.zoneAt(p.x, p.z) !== 'library' || busy(p.z * MAP_W + p.x)) return;
    const d = propReach(p, s.player.x, s.player.z);
    if (d <= REACH && d < near) {
      near = d;
      best = k;
    }
  });
  return best;
}

/** A library chair the player could sit on now, as sitDown has it (2.31). */
export function freeReadSeat(sim: SimContext): number {
  const s = sim.state;
  const busy = (t: number) => s.inmates.some((m) => m.ko === 0 && m.angry <= 0 && m.plan >= 0 && (m.goal === t || m.seat === t || tileAt(m.body.x, m.body.z) === t));
  return placesOf(sim.world).readSeats.find((q) => !busy(q.tile))?.tile ?? -1;
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
  // (2.31: on a chair, reading, they face its table.)
  if (s.seat < 0 || sim.rules230) s.player.facing = nearestDir((p.x + p.w / 2) * UNIT - s.player.x, (p.z + p.d / 2) * UNIT - s.player.z) || s.player.facing;
  s.train = prop;
  s.readFrom = s.step;
  s.reps = 0;
  s.repSide = 0;
  s.repBeat = sim.rules230 || p.kind !== 'shelf' ? -1 : 0;
  s.readWait = 0;
  s.askTurn = [];
  sim.events.push({ type: 'train', on: true, use });
}

/**
 * At the library shelf whose panel is open. 2.31: a book of the subject is taken, to a free chair with it; with
 * none free it's read there at the shelf. (Before, the set began there.)
 */
export function study(sim: SimContext, subject = 0) {
  const s = sim.state;
  const box = containersOf(sim.world)[s.items.open];
  if (!box || box.prop.kind !== 'shelf' || sim.world.zoneAt(box.prop.x, box.prop.z) !== 'library') return;
  const shelf = sim.world.props.indexOf(box.prop);
  if (sim.rules230) return startTraining(sim, shelf, 'study');
  const why = refused(sim, 'int');
  if (why) return void sim.events.push({ type: 'cantTrain', why });
  if (subject < 0 || subject >= SUBJECTS.length) return;
  s.book = subject + 1;
  const seat = freeReadSeat(sim) >= 0;
  sim.events.push({ type: 'book', on: true, subject, seat });
  closeBox(sim);
  if (!seat) startTraining(sim, shelf, 'study');
}

/**
 * A key word underlined, as the marker reaches it (2.31). A stray press spends the next one, so that tapping away gains
 * nothing. 2.34: the word is lit from READ_LEAD steps before the marker gets there until the marker goes on from it
 * (it waits there, keepBook), and a press any time it's lit underlines it.
 */
function underline(sim: SimContext) {
  const s = sim.state;
  const pos = s.step - s.readFrom;
  const pace = readPace(sim);
  const k = sim.rules233 ? keyFrom(pos, READ_WINDOW) : keyFrom(pos, 0, pace);
  // (Gone already, underlined or spent: the press does no more harm.)
  if (k < s.repBeat) return;
  const hit = sim.rules233 ? keyAt(k) <= pos + READ_WINDOW : keyAt(k, pace) - pos <= READ_LEAD;
  s.repBeat = k + 1;
  s.readWait = 0;
  if (hit) s.reps = Math.min(100, s.reps + READ_HIT);
  sim.events.push({ type: 'rep', hit, key: k });
  if (s.reps >= 100) setDone(sim);
}

/**
 * A press: only one on the other side from the last counts, and (2.29) only the first of each beat, for much more on
 * the beat than off it, so that mashing is the slow way. A full bar is a set: +2, and the energy it costs.
 */
export function rep(sim: SimContext, side: number) {
  const s = sim.state;
  if (s.train < 0) return;
  if (reading(sim)) return underline(sim);
  if (side === s.repSide) return;
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
  if (s.reps >= 100) setDone(sim);
}

/** A full bar: a set done. */
function setDone(sim: SimContext) {
  const s = sim.state;
  const a = trainsOn(sim, s.train)!;
  const read = reading(sim);
  s.reps = 0;
  setAttr(sim, a, Math.min(ATTR_MAX, attr(sim, a) + TRAIN_GAIN));
  s.trained |= 1 << ATTRS.indexOf(a);
  s.energy = Math.max(0, s.energy - setCost(sim, a));
  sim.events.push({ type: 'trained', attr: a, value: attr(sim, a) });
  // Studying to a new mark (every STUDY_TIP_EVERY points, never the same one twice): a recipe in the books (P8+).
  const mark = Math.floor(attr(sim, a) / STUDY_TIP_EVERY);
  if (a === 'int' && mark > s.studied) {
    s.studied = mark;
    // (2.31: from the book's subject.)
    revealTip(sim, -1, read ? s.book - 1 : -1);
  }
  // (2.31: the day's reading done: the book goes back.)
  if (read) {
    s.readToday++;
    if (headFull(sim) && attr(sim, a) < ATTR_MAX) {
      sim.events.push({ type: 'cantTrain', why: 'full' });
      stopTraining(sim);
      putBack(sim);
      return;
    }
  }
  // Spent, or as good as it gets: off the equipment.
  if (s.energy < TIRED || attr(sim, a) >= ATTR_MAX) {
    sim.events.push({ type: 'cantTrain', why: s.energy < TIRED ? 'tired' : 'max' });
    stopTraining(sim);
  }
}

/** The book back on the shelf (2.31). */
function putBack(sim: SimContext) {
  const s = sim.state;
  if (!s.book) return;
  const subject = s.book - 1;
  s.book = 0;
  sim.events.push({ type: 'book', on: false, subject, seat: false });
}

/** Each step with a book: only the library's, only while up and about; each step reading, the bar fills by itself. */
function keepBook(sim: SimContext) {
  const s = sim.state;
  const p = s.player;
  // (In the library, or at one of its shelves from the far side of a doorway.)
  const here = sim.world.zoneAt(Math.floor(p.x / UNIT), Math.floor(p.z / UNIT)) === 'library' || sim.world.props.some((q, k) => q.kind === 'shelf' && sim.world.zoneAt(q.x, q.z) === 'library' && atProp(sim.world, k, p, REACH + UNIT / 4));
  if (!here || sim.away || s.lockdown || s.sleeping || s.ko > 0 || s.solitary > 0 || s.layer !== LAYER.GROUND) {
    stopTraining(sim);
    putBack(sim);
    return;
  }
  if (s.train < 0 || !reading(sim)) return;
  // (Up off the chair, by whatever got them up, or away from the shelf.)
  if (s.seat < 0 && !atProp(sim.world, s.train, p, REACH + UNIT / 4)) {
    stopTraining(sim);
    return;
  }
  if (sim.rules233) {
    if ((s.step - s.readFrom) % READ_FILL_EVERY === 0 && ++s.reps >= 100) setDone(sim);
    return;
  }
  // 2.34: the marker stops at a key word still to be underlined, up to READ_WAIT steps (its place held by moving the
  // start on), then goes on and the word's missed. The bar fills by the clock, as the place no longer does.
  const pos = s.step - s.readFrom;
  const k = keyFrom(pos, 0, READ_PACE);
  if (keyAt(k, READ_PACE) === pos && k >= s.repBeat) {
    if (s.readWait < READ_WAIT) {
      s.readWait++;
      s.readFrom++;
    } else {
      s.repBeat = k + 1;
      s.readWait = 0;
    }
  } else s.readWait = 0;
  if (s.step % READ_FILL_EVERY === 0 && ++s.reps >= 100) setDone(sim);
}

/** Each step on the equipment: a lockdown, a knockout or a blow ends it; before 2.29, the bar drains. */
export function keepTraining(sim: SimContext) {
  const s = sim.state;
  if (s.book) keepBook(sim);
  if (s.train < 0) return;
  // (A save from before 2.31 in a set at a shelf: no book to read it in.)
  if (!s.book && reading(sim)) {
    stopTraining(sim);
    return;
  }
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
