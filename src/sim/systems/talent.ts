/**
 * Talent night (P30, docs/PLAN.md §9): a day card, 19:00–21:00, on the stage in the canteen.
 *
 * - **The acts**: two or three inmates (by roll(), each with a song, an instrument and the
 *   judges' mark) take the stage in turn, ACT_MINUTES each from 19:00, ACT_GAP apart. All a pure
 *   function of the night: worked out, never stored.
 * - **The player's act** (EXT.STAGE, b = the song, c = the instrument): once the last act is
 *   off, on the stage's boards, once a night. Bucket drums are always there; the guitar is
 *   homemade. The song's notes come down three lanes; a press (EXT.NOTE, b = the lane) is
 *   judged by its step against the note's (PERFECT, GOOD, centred LATE steps on); a press with
 *   no note near is a stray, and costs. The player keeps still meanwhile (Sim.playerMoves).
 * - **No-shows** (2.5.1): a performer not on the boards NO_SHOW minutes into his slot (knocked
 *   out, angry, asleep, busy) misses his act: no music, no mark, out of the running. One the
 *   player holds from it (talking, following, at a game with them) is taken to have played.
 * - **The verdict**, at the song's end: the mark (the points as a share of all perfect) placed
 *   among the night's acts that stood (a tie goes to the player). Prize money by place (more for a harder
 *   song); opinion with everyone in the canteen at APPLAUSE or more, twice that for first; a
 *   mark of GOODWILL or more, the warden's goodwill (heat off).
 *
 * The music drowns noise in the canteen meanwhile (calendar.ts `muffled`), as movie night's does.
 */
import { ACT_CALL, ACT_GAP, ACT_MINUTES, ACT_WALK, NO_SHOW, APPLAUSE, CHARTS, countIn, GOOD, GOOD_POINTS, GOODWILL, GOODWILL_HEAT, INSTRUMENT, LATE, PERFECT, PERFECT_POINTS, PRIZES, RIVAL_MARK, RIVAL_SPREAD, RIVALS_MIN, RIVALS_SPAN, SONG_PAY, SONGS, songSteps, STAGE_OPINION, STRAY_POINTS } from '../../content/nights';
import { EVENT_TIMES } from '../../content/days';
import type { Stage } from '../../content/prisons/types';
import { itemNumber } from '../../content/items';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import type { Refusal, SimState } from '../state';
import { UNIT } from '../tuning';
import { LAYER, MAP_W, type World } from '../world/World';
import { bodyAt, type Body } from './movement';
import { dayMinute, eventOn, prisonDay, today } from './calendar';
import { gameOn } from './games';
import { hotbarSlotOf } from './items';
import { DOING, inmateZone } from './inmates';
import { changeOpinion, endTalk, refuse } from './social';
import { stopTraining } from './training';
import { tileAt } from '../world/grid';

export const GUITAR = itemNumber('guitar');

/** The player's act under way (P30): plain data in the state. */
export interface Show {
  /** The song (SONGS place) and the instrument (INSTRUMENT). */
  song: number;
  inst: number;
  /** The step the count-in began. */
  from: number;
  /** Each note of the song as judged: 0 not yet, 1 missed, 2 good, 3 perfect. */
  hits: number[];
  /** Presses with no note near. */
  stray: number;
}

/** One of the night's other acts. */
export interface Act {
  who: number;
  song: number;
  inst: number;
  /** The judges' mark (per cent). */
  mark: number;
  /** On the stage from `at` to `until` (minutes into the prison day). */
  at: number;
  until: number;
}

/** The prison's stage, if it has one. */
export const stageOf = (w: World): Stage | null => w.def.leisure?.stage ?? null;

/** The way a face points, as tile steps (1 east, 5 south, 9 west, 13 north). */
const faceStep = (face: number): [number, number] => (face === 1 ? [1, 0] : face === 5 ? [0, 1] : face === 9 ? [-1, 0] : [0, -1]);

/** The stage's boards (tiles): the performer's and one either side across it, then the row in front. */
export function boardsOf(st: Stage): number[] {
  const [fx, fz] = faceStep(st.face);
  const [ax, az] = [-fz, fx];
  const out: number[] = [];
  for (const front of [0, 1]) for (const side of [-1, 0, 1]) out.push((st.z + fz * front + az * side) * MAP_W + st.x + fx * front + ax * side);
  return out;
}

/** Whether a point (units) is on the stage's boards. */
function onStage(st: Stage, x: number, z: number): boolean {
  return boardsOf(st).includes(tileAt(x, z));
}

const TALENT_AT = EVENT_TIMES.talent.at as number;

/** The night's other acts, in running order: a pure function of the run and the day. */
export function actsOf(s: Pick<SimState, 'salt' | 'inmates'>, day: number): Act[] {
  const n = s.inmates.length;
  const count = Math.min(n, RIVALS_MIN + rollInt(s.salt, SALT.STAGE, day, 0, RIVALS_SPAN));
  const out: Act[] = [];
  for (let j = 0; out.length < count && j < 64; j++) {
    const who = rollInt(s.salt, SALT.STAGE, day, 1 + j, n);
    if (out.some((a) => a.who === who)) continue;
    const k = out.length;
    const at = TALENT_AT + k * ACT_GAP;
    out.push({
      who,
      song: rollInt(s.salt, SALT.STAGE, day, 100 + k, SONGS.length),
      inst: rollInt(s.salt, SALT.STAGE, day, 200 + k, 2),
      mark: RIVAL_MARK + rollInt(s.salt, SALT.STAGE, day, 300 + k, RIVAL_SPREAD),
      at,
      until: at + ACT_MINUTES,
    });
  }
  return out;
}

/** When the player's turn comes (minutes into the prison day): after the last act. */
export const turnFrom = (acts: readonly Act[]) => (acts.length ? acts[acts.length - 1].until : TALENT_AT);

/** Today is a talent night here (a stage, not the Training Block), whatever the hour. */
const talentToday = (sim: SimContext) => !!stageOf(sim.world) && !sim.world.def.rules?.relaxed && today(sim).event === 'talent';
/** Talent night is on now (a day card's evening, in a prison with a stage). */
export const talentOn = (sim: SimContext) => !!stageOf(sim.world) && !sim.world.def.rules?.relaxed && eventOn(sim, 'talent');

/** Tonight's acts (worked out for today). */
export const tonight = (sim: SimContext) => actsOf(sim.state, prisonDay(sim.state.step));

/** The act whose slot it is now, a no-show's too (-1 none). */
function slotNow(sim: SimContext): number {
  if (!talentOn(sim)) return -1;
  const m = dayMinute(sim.state.step);
  return tonight(sim).findIndex((a) => m >= a.at && m < a.until);
}

/** Whether tonight's act k stood: its performer on the boards in his slot (or held from them by the player). */
export const acted = (s: Pick<SimState, 'acted' | 'step'>, k: number) => s.acted[0] === prisonDay(s.step) && ((s.acted[1] >> k) & 1) === 1;

/** Whether tonight's act k is a no-show: NO_SHOW minutes into its slot (or past it) and nobody took the boards. */
export function noShow(sim: SimContext, k: number): boolean {
  if (sim.rules250) return false;
  const a = tonight(sim)[k];
  return !!a && dayMinute(sim.state.step) >= a.at + NO_SHOW && !acted(sim.state, k);
}

/** The act on the stage now (-1 none; a no-show's slot is empty). */
export function actNow(sim: SimContext): number {
  const k = slotNow(sim);
  return k >= 0 && noShow(sim, k) ? -1 : k;
}

/**
 * The inmates busy with tonight's acts (busy for the evening): from the call before the first act
 * (stageTargets), every performer whose act isn't over and hasn't been left empty (a no-show).
 */
export function performersTonight(sim: SimContext): number[] {
  if (!talentToday(sim)) return [];
  const acts = tonight(sim);
  const m = dayMinute(sim.state.step);
  if (!acts.length || m < acts[0].at - ACT_CALL) return [];
  return acts.filter((a, k) => m < a.until && !noShow(sim, k)).map((a) => a.who);
}

/**
 * When the stage is the player's (minutes into the prison day): once the last act is over, or
 * its slot left empty (a no-show).
 */
export function stageFreeFrom(sim: SimContext): number {
  const acts = tonight(sim);
  const last = acts.length - 1;
  return last >= 0 && noShow(sim, last) ? acts[last].at + NO_SHOW : turnFrom(acts);
}

/** The acts that stood tonight (the ones the player is placed among). */
export const standing = (sim: SimContext): Act[] => tonight(sim).filter((_, k) => !noShow(sim, k));

/**
 * Each step of talent night: an act whose performer is on the boards in his slot (up and about),
 * or held from them by the player (a talk, following, a game with them), stands. Settled by
 * NO_SHOW minutes into the slot; past that, empty.
 */
export function keepActs(sim: SimContext) {
  const s = sim.state;
  if (sim.rules250) return;
  const k = slotNow(sim);
  if (k < 0) return;
  const a = tonight(sim)[k];
  const day = prisonDay(s.step);
  if (acted(s, k) || dayMinute(s.step) >= a.at + NO_SHOW) return;
  const m = s.inmates[a.who];
  const st = stageOf(sim.world)!;
  const held = s.talk === a.who || s.followers.includes(a.who) || s.match?.team.includes(a.who) || s.ink?.who === a.who || s.quiz?.who.includes(a.who) || s.shootout?.who === a.who || s.cheat?.who === a.who;
  const there = !!m && m.ko <= 0 && m.angry <= 0 && onStage(st, m.body.x, m.body.z);
  if (!held && !there) return;
  s.acted = [day, (s.acted[0] === day ? s.acted[1] : 0) | (1 << k)];
}

/** The next act's performer, walking over to the wings before its slot (-1 none; from ACT_WALK before 19:00 too). */
function actComing(sim: SimContext): number {
  if (!talentToday(sim)) return -1;
  const m = dayMinute(sim.state.step);
  const walk = sim.rules250 ? ACT_WALK : ACT_CALL;
  return tonight(sim).findIndex((a) => m >= a.at - walk && m < a.at);
}

/** The hotbar slot holding the guitar (-1 none). */
const guitarSlot = (s: Pick<SimState, 'items'>) => hotbarSlotOf(s.items.inv, GUITAR);

/** Why the player can't take the stage now (null: they can). */
export function stageRefusal(sim: SimContext, inst: number): Refusal | null {
  const s = sim.state;
  const st = stageOf(sim.world);
  if (!st || !talentOn(sim)) return 'stageClosed';
  if (s.lockdown) return 'gamesLockdown';
  if (s.stageDay === prisonDay(s.step)) return 'performed';
  if (dayMinute(s.step) < (sim.rules250 ? turnFrom(tonight(sim)) : stageFreeFrom(sim))) return 'actsOn';
  if (s.layer !== LAYER.GROUND || !onStage(st, s.player.x, s.player.z)) return 'offStage';
  if (inst === INSTRUMENT.GUITAR && guitarSlot(s) < 0) return 'noGuitar';
  return null;
}

/** The player's act (EXT.STAGE): the count-in, then the song. */
export function startShow(sim: SimContext, song: number, inst: number) {
  const s = sim.state;
  if (!SONGS[song] || (inst !== INSTRUMENT.DRUMS && inst !== INSTRUMENT.GUITAR) || gameOn(s) || s.show) return;
  const why = stageRefusal(sim, inst);
  if (why) return refuse(sim, why);
  stopTraining(sim);
  endTalk(sim);
  s.stageDay = prisonDay(s.step);
  s.show = { song, inst, from: s.step, hits: CHARTS[song].map(() => 0), stray: 0 };
  // (On the performer's own tile, facing the room: clear of the mic stand and the speakers.)
  const st = stageOf(sim.world)!;
  s.player.x = st.x * UNIT + UNIT / 2;
  s.player.z = st.z * UNIT + UNIT / 2;
  s.player.moving = false;
  s.player.facing = st.face;
  sim.events.push({ type: 'stage', what: 'start', song, inst });
}

/** Steps into the song (after the count-in): negative while it's counted in. */
const songTime = (s: Pick<SimState, 'step'>, o: Show) => s.step - o.from - countIn(o.song);

/** A press in a lane (EXT.NOTE): the nearest note not yet played in that lane, within the window, or a stray. */
export function playNote(sim: SimContext, lane: number) {
  const s = sim.state;
  const o = s.show;
  if (!o || lane < 0 || lane > 2) return;
  const k = songTime(s, o) - LATE;
  // (Pressed in the count-in, well before the first note: nothing, and nothing lost.)
  if (k < -GOOD - LATE) return;
  const chart = CHARTS[o.song];
  let best = -1;
  let bestD = GOOD + 1;
  for (let i = 0; i < chart.length; i++) {
    const [t, l] = chart[i];
    if (t - k > GOOD) break;
    if (l !== lane || o.hits[i]) continue;
    const d = Math.abs(t - k);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  }
  if (best < 0) {
    o.stray++;
    sim.events.push({ type: 'stage', what: 'stray', lane });
    return;
  }
  o.hits[best] = bestD <= PERFECT ? 3 : 2;
  sim.events.push({ type: 'stage', what: 'hit', note: best, lane, grade: o.hits[best], pitch: chart[best][2] });
}

/** The mark so far (per cent): the points as a share of every note played perfectly, less the strays. */
export function markOf(o: Show): number {
  const n = CHARTS[o.song].length;
  let pts = -o.stray * STRAY_POINTS;
  for (const h of o.hits) pts += h === 3 ? PERFECT_POINTS : h === 2 ? GOOD_POINTS : 0;
  return Math.max(0, Math.min(100, Math.floor((pts * 100) / (n * PERFECT_POINTS))));
}

/** The place a mark takes among the night's acts (0 first): a tie goes to the player. */
export const placeOf = (mark: number, acts: readonly Act[]) => acts.filter((a) => a.mark > mark).length;

/** The prize money for a place with a song (dollars). */
export const prizeOf = (place: number, song: number) => (place < PRIZES.length ? Math.floor((PRIZES[place] * SONG_PAY[SONGS[song].level - 1]) / 100) : 0);

/** The act given up (EXT.STAGE with b = STAGE_QUIT): off, the night's turn used. */
export const STAGE_QUIT = 255;
export const quitShow = (sim: SimContext) => endShow(sim, false);

/** Talent night's music is playing: an act on the stage (its performer on the boards, up and about), or the player's. */
export function musicOn(sim: SimContext): boolean {
  if (sim.state.show) return true;
  const k = actNow(sim);
  if (k < 0 || sim.rules250) return k >= 0;
  const m = sim.state.inmates[tonight(sim)[k].who];
  return !!m && m.ko <= 0 && onStage(stageOf(sim.world)!, m.body.x, m.body.z);
}

/** Each step of the act: the notes gone by unplayed missed; off when it can't go on; the verdict at the end. */
export function keepShow(sim: SimContext) {
  const s = sim.state;
  const o = s.show;
  if (!o) return;
  if (s.lockdown || sim.away || s.sleeping || s.stowed || s.ko > 0 || s.layer !== LAYER.GROUND) return endShow(sim, false);
  const k = songTime(s, o) - LATE;
  const chart = CHARTS[o.song];
  for (let i = 0; i < chart.length && chart[i][0] < k - GOOD; i++) {
    if (o.hits[i]) continue;
    o.hits[i] = 1;
    sim.events.push({ type: 'stage', what: 'miss', note: i, lane: chart[i][1] });
  }
  if (songTime(s, o) >= songSteps(o.song)) endShow(sim, true);
}

/** The act over: the verdict (played to the end), or off. */
function endShow(sim: SimContext, done: boolean) {
  const s = sim.state;
  const o = s.show;
  if (!o) return;
  s.show = null;
  if (!done) return void sim.events.push({ type: 'stage', what: 'off', song: o.song, inst: o.inst });
  const mark = markOf(o);
  // (2.5.1: among the acts that stood; a no-show's mark counts for nothing.)
  const acts = sim.rules250 ? tonight(sim) : standing(sim);
  const place = placeOf(mark, acts);
  // (No prize for a poor act, whatever the field: a mark of APPLAUSE or more.)
  const prize = mark >= APPLAUSE ? prizeOf(place, o.song) : 0;
  if (prize) {
    s.cash += prize;
    s.tally[3] += prize;
    sim.events.push({ type: 'cash', n: prize, why: 'stage' });
  }
  // The room's applause: everyone in the canteen who's awake and about.
  let crowd = 0;
  if (mark >= APPLAUSE)
    s.inmates.forEach((m, k) => {
      if (m.ko > 0 || m.angry > 0 || m.doing === DOING.SLEEP || inmateZone(sim.world, m) !== 'canteen') return;
      changeOpinion(sim, k, place === 0 ? STAGE_OPINION * 2 : STAGE_OPINION);
      crowd++;
    });
  // The warden's goodwill.
  const heat = mark >= GOODWILL ? Math.min(s.heat, GOODWILL_HEAT) : 0;
  s.heat -= heat;
  sim.events.push({ type: 'stage', what: 'done', song: o.song, inst: o.inst, mark, place, prize, crowd, heat });
}

/**
 * Each act's performer (socialNow): in the wings before its slot, then on the stage, facing the
 * room, playing. 2.5.1: every performer still to come is called ACT_CALL before the first act
 * (whatever he was lingering over): the next one to the wings, the rest close by them.
 */
export function stageTargets(sim: SimContext, so: { follow: Array<Body | null>; gap: number[]; doing: number[]; face: number[] }) {
  const s = sim.state;
  if (s.lockdown) return;
  const st = stageOf(sim.world);
  if (!st) return;
  const [fx, fz] = faceStep(st.face);
  const on = actNow(sim);
  const acts = tonight(sim);
  const lead = (k: number, mark: Body, wings: boolean, gap: number) => {
    const a = acts[k];
    const m = s.inmates[a.who];
    if (!m || m.ko > 0 || m.angry > 0 || m.doing === DOING.SLEEP || s.talk === a.who) return;
    // (Busy with the player at something else: the act's a no-show.)
    if (s.followers.includes(a.who) || s.match?.team.includes(a.who) || s.ink?.who === a.who || s.quiz?.who.includes(a.who)) return;
    // (2.5.1: called now, whatever he was lingering over.)
    if (!sim.rules250) m.wait = 0;
    // (The wings: the boards' tile to the performer's left.)
    const x = wings ? st.x - fz : st.x;
    const z = wings ? st.z + fx : st.z;
    mark.x = x * UNIT + UNIT / 2;
    mark.z = z * UNIT + UNIT / 2;
    so.follow[a.who] = mark;
    so.gap[a.who] = gap;
    so.doing[a.who] = wings ? DOING.NOTHING : a.inst === INSTRUMENT.GUITAR ? DOING.GUITAR : DOING.DRUMS;
    so.face[a.who] = st.face;
  };
  if (on >= 0) lead(on, spot, false, 0);
  if (sim.rules250) {
    const coming = actComing(sim);
    if (coming >= 0) lead(coming, wingsAt[0], true, 0);
    return;
  }
  if (sim.world.def.rules?.relaxed || today(sim).event !== 'talent' || !acts.length) return;
  const m = dayMinute(s.step);
  let j = 0;
  for (let k = 0; k < acts.length; k++) {
    if (m < acts[0].at - ACT_CALL || m >= acts[k].at) continue;
    // (The next up in the wings; those after him a step or two off them.)
    lead(k, wingsAt[Math.min(j, wingsAt.length - 1)], true, j ? Math.floor(UNIT / 2) + j * UNIT : 0);
    j++;
  }
}
const spot: Body = bodyAt(0, 0);
const wingsAt: Body[] = [0, 1, 2, 3].map(() => bodyAt(0, 0));
