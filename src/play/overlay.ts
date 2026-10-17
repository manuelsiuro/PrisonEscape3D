import { itemDef, itemNumber } from '../content/items';
import { ROUTINE } from '../content/routine';
import { t, type Key } from '../i18n';
import { maxHealth } from '../sim/systems/combat';
import { jobRooms, nearestProp, STATION_REACH } from '../sim/systems/economy';
import { GUARD } from '../sim/systems/guards';
import type { ItemState } from '../sim/systems/items';
import { COLD_STEPS, LOOK_AWAY_STEPS, STEPS_PER_MINUTE, STEPS_PER_SECOND, UNIT } from '../sim/tuning';
import { lookingAway } from '../sim/systems/ways';
import { lineOfSight } from '../sim/ai/sight';
import { clockAt, formatTime, prisonDay } from '../sim/systems/clock';
import { guardSubject } from '../ui/social';
import { baking, exposed } from '../sim/systems/weather';
import { dayHud, stowCard, vehicleThe } from './day';
import { atTail, searchMinute } from '../sim/systems/delivery';
import { dayMinute, today } from '../sim/systems/calendar';
import { containersOf } from '../sim/world/containers';
import { TILE, TILE_INFO } from '../sim/world/tiles';
import { usableHere } from '../sim/systems/recipes';
import { LAYER, MAP_W } from '../sim/world/World';
import { DOING } from '../sim/systems/inmates';
import { TOUCH } from '../ui/dom';
import type { HudState } from '../ui/hud';
import type { ItemsView } from '../ui/items';
import { press, targets } from './buttons';
import {
  aimUI,
  board,
  combatUI,
  darkCell,
  hint,
  hud,
  itemsUI,
  paBoard,
  profile,
  ratPanel,
  phonePanel,
  settings,
  sleepVeil,
  socialOpen,
  solitaryPanel,
  sound,
  stowPanel,
  talk,
  tools,
  trainCard,
  vignette,
  view,
  workChips,
} from './context';
import { play, type Game } from './game';
import { ACTION_IDS, boxTitle, describeAttack, describeTarget, describeTool, describeToss, describeTreat, describeCall, dogName, targetInfo } from './labels';
import { DOG, dogWarning, FOR_DOGS, treatTarget } from '../sim/systems/k9';
import { updateAim } from './aim';
import { coachOnce, seenTip } from './tips';
import { FIRECRACKER } from '../sim/systems/structure';
const PEPPER = itemNumber('pepper');
const JERKY = itemNumber('jerky');
/** When the paw last lit for a dog's nose (real ms), and how long it stays lit after. */
let pawAt = -1e9;
const PAW_HOLD_MS = 1500;
const PILLS = itemNumber('sleeping_pills');
import { chatterFrame } from './chatter';
import { ratHud, ratView } from './rat';
import { orderHud, phoneView, smuggleHints } from './smuggle';
import { PHONE, smugglingOf } from '../sim/systems/smuggling';
import { CAUGHT_RAT, RAT_TRAP } from '../sim/systems/rats';

/**
 * Everything over the picture, brought up to date after each draw: the item bar and action
 * button, the tool button, the target card, the social panels, the veils, the HUD, and the
 * music and ambience that follow the game.
 */

const itemsView: ItemsView = { items: null as unknown as ItemState, boxTitle: '', boxHidden: 0, boxMine: false, carried: [], tips: [], usable: (k) => !play.game || usableHere(play.game.rec.sim.world, k), action: null, sleeping: false, deskTunnel: false, study: false };
const GET_UP = { verb: '', what: '' };
/** Delivery day (P18): into the vehicle at its tail, out of it while hidden. */
const STOW = { verb: '', what: '' };
const CLIMB_OUT = { verb: '', what: '' };
const PEEL_ACTION = { verb: '', what: '' };
const hudState: HudState = { routine: 0, attended: false, heat: 0, lockdown: false, seen: false, solitaryMinutes: null, cash: 0, work: null, powerLeft: null, powerKey: 'hud.powerOut', takeoverLeft: null, cold: null, bribe: null, weather: { icon: '', name: '', color: '' }, today: null, drill: null, dog: null, rat: null, order: null };
const coldHud = { built: 0, left: 0, bit: false, warming: false, hot: false };
const bribeHud = { name: '', until: '', left: 0, of: LOOK_AWAY_STEPS / STEPS_PER_MINUTE };
const workHud = { place: '', quota: 0, of: 0, paid: false };
/** The music's tension cue is on (see updateOverlay). */
let tense = false;

const projectAt = (x: number, y: number, z: number, out: { x: number; y: number }) => view.screenAt(x, y, z, out);

/**
 * Keeps the player in sight while a panel is open: a side panel reaching past the middle (phone
 * landscape) slides the picture left, a bottom sheet (phone portrait) slides it up, into the
 * middle of the space left free. Measured a few times a second, not every frame.
 */
let shiftCheck = 0;
export function keepPlayerClear(open: boolean) {
  if (!open) {
    view.setShift(0, 0);
    shiftCheck = 0;
    return;
  }
  if (shiftCheck-- > 0) return;
  shiftCheck = 8;
  const el = document.querySelector<HTMLElement>('.item-panel:not(.hidden)');
  if (!el) return view.setShift(0, 0);
  const r = el.getBoundingClientRect();
  const w = innerWidth;
  const h = innerHeight;
  const top = 110;
  if (r.top < h * 0.45 && r.left > w * 0.2) {
    // To the side: centre the player in what's left of the width.
    view.setShift(r.left < w / 2 + 60 ? Math.round(r.left / 2 - w / 2) : 0, 0);
  } else if (r.top >= h * 0.3) {
    // A sheet from the bottom: between the HUD and its top edge.
    view.setShift(0, r.top < h / 2 + 60 ? Math.round((top + r.top) / 2 - h / 2) : 0);
  } else view.setShift(0, 0);
}

/** The UI after the draw (same arguments as buildFrame, and whether a panel is open). */
export function updateOverlay(g: Game, a: number, tile: { x: number; z: number }, busy: boolean, held: number, panel: boolean) {
  const sim = g.rec.sim;
  const p = sim.state.player;
  const clock = sim.clock;
  const st = sim.state;
  const it = st.items;
  const memo = targets;
  const climb = memo.climb;
  const target = memo.target;
  const box = containersOf(sim.world)[it.open];
  const v = itemsView;
  v.items = it;
  v.boxTitle = it.open >= 0 ? boxTitle(sim, it.open) : '';
  v.boxHidden = box?.hidden ?? 0;
  v.boxMine = !!box?.mine;
  v.carried = st.carried;
  v.tips = st.tips;
  if (st.solitary > 0) {
    PEEL_ACTION.verb = t('act.peel');
    PEEL_ACTION.what = t('act.potato');
  }
  if (st.seat >= 0) GET_UP.verb = t('act.getUp');
  // (At the vehicle's tail, the tailgate open: climbing in comes before anything else there.)
  const tail = !st.stowed && atTail(sim) && dayMinute(st.step) < searchMinute(today(sim));
  if (st.stowed) CLIMB_OUT.verb = t('act.climbOut');
  if (tail) {
    STOW.verb = t('act.stow');
    STOW.what = vehicleThe(sim);
  }
  v.action = st.ko > 0 || g.over ? null : st.solitary > 0 ? PEEL_ACTION : st.stowed ? CLIMB_OUT : st.seat >= 0 && it.open < 0 && st.talk < 0 ? GET_UP : it.open >= 0 || st.talk >= 0 || st.train >= 0 || socialOpen() ? null : tail ? STOW : describeTarget(sim, target, climb, held, memo.station);
  v.sleeping = st.sleeping;
  v.deskTunnel = !!box?.mine && box.prop.kind === 'desk' && sim.world.ground.kind[box.prop.z * MAP_W + box.prop.x] === TILE.SHAFT;
  v.study = box?.prop.kind === 'shelf' && box.table === 'libraryShelf';
  itemsUI.update(v);
  // The tool button: a blow at the locked-on target, else what a strike would hit.
  const tt = memo.tool;
  const fight = busy ? null : describeAttack(sim);
  press.toolNow = fight ?? describeTool(sim, tt, held);
  // A firecracker in hand (P14): nothing to strike, but its own button throws it.
  if (!press.toolNow && held === FIRECRACKER && !busy && st.layer === LAYER.GROUND) press.toolNow = describeToss();
  // The burner phone in hand (P21): its button opens its panel.
  if (!press.toolNow && held === PHONE && !busy && smugglingOf(sim)) press.toolNow = describeCall();
  // Jerky, pepper or sleepy jerky in hand with a dog within a throw (P19): its button throws it to the dog.
  if (!press.toolNow && FOR_DOGS.has(held) && !busy && st.layer === LAYER.GROUND) {
    const to = treatTarget(sim);
    if (to) press.toolNow = describeTreat(dogName(sim, to.dog), to.tile, held === PEPPER, held === JERKY && st.dogs[to.dog].fed === prisonDay(st.step));
  }
  // The dogs (P19): told about a dog's nose the first time one could smell the contraband, and about the trail the first time one is laid with a dog at work.
  if (!busy && hudState.dog === 'nose') coachOnce('sniffed', 'hint.sniffed');
  if (!busy && st.scent.length && st.dogs.some((d) => d.mode !== DOG.KENNEL)) coachOnce('scent', 'hint.scent');
  // Within a guard's earshot: the ear on the button (worked out once a step), told about the first time.
  if (press.toolNow) press.toolNow.heard = !fight && memo.heard;
  if (press.toolNow?.heard && !busy && !panel) coachOnce('earshot', 'hint.earshot');
  if (held === FIRECRACKER && !busy) coachOnce('firecracker', 'hint.firecracker');
  // (P19: what jerky, pepper and the pills are for, the first time one is in hand.)
  if (!busy && FOR_DOGS.has(held)) coachOnce('treatHeld', 'hint.treatHeld');
  if (!busy && held === PILLS) coachOnce('pills', 'hint.pills');
  // (P20: a rat trap and a caught rat, the first time one is in hand.)
  if (!busy && held === RAT_TRAP) coachOnce('ratTrap', 'hint.ratTrap');
  if (!busy && held === CAUGHT_RAT) coachOnce('caughtRat', 'hint.caughtRat');
  // A guard dozing close by, in plain sight (P15): what it means, the first time one is seen.
  if (!busy && st.layer === LAYER.GROUND && !seenTip('nap') && st.guards.some((x) => x.doing === DOING.DOZE && Math.abs(x.body.x - st.player.x) + Math.abs(x.body.z - st.player.z) <= 8 * UNIT && lineOfSight(sim.world, st.player.x, st.player.z, x.body.x, x.body.z))) coachOnce('nap', 'hint.nap');
  // Each new target takes a new press: a held button never digs on into the next thing.
  press.toolKey = fight ? -2 - st.lock : tt ? (ACTION_IDS.indexOf(tt.action) + 1) * 100000 + tt.layer * 10000 + tt.tile : 0;
  if (tools.held && press.toolKey !== press.heldOn) tools.release();
  const fighting = st.lock >= 0 || memo.fighting;
  const training = st.train >= 0;
  tools.update(training ? null : press.toolNow, st.energy, !!(held && itemDef(held).tool) || training, busy || panel, st.health / maxHealth(st.str), fighting);
  // The target card, and the lock button while anyone is in range (worked out once a step).
  combatUI.update(targetInfo(sim), memo.canLock && !training, busy || panel || training);
  // Social life and work (P6): the talk, the job board (closed out of its reach), the file, the training card, machines at work.
  if (board.isOpen && nearestProp(sim.world, p, (q) => q.kind === 'jobBoard', STATION_REACH + UNIT / 2) < 0) board.close();
  talk.update(sim, busy);
  board.update(sim, busy);
  profile.update(sim, busy && !st.sleeping);
  trainCard.update(sim, busy);
  workChips.update(sim, projectAt, busy || st.layer !== LAYER.GROUND);
  const veilOn = st.sleeping || st.ko > 0;
  if (st.ko > 0 && !sleepVeil.classList.contains('ko')) sleepVeil.querySelector('span')!.textContent = t('sleep.knockedOut');
  sleepVeil.classList.toggle('ko', st.ko > 0);
  sleepVeil.classList.toggle('on', veilOn);
  solitaryPanel.update(st.solitary > 0 ? Math.ceil(st.solitary / STEPS_PER_MINUTE) : null, st.peeled);
  stowPanel.update(stowCard(g));
  // The pet rat (P20): its panel and its pill.
  ratPanel.update(ratView(sim), busy);
  hudState.rat = ratHud(sim);
  // Smuggling (P21): the phone's panel, the order's pill, the visitor's wait.
  phonePanel.update(phoneView(sim), busy);
  hudState.order = orderHud(sim);
  smuggleHints(sim, busy || panel);
  darkCell.classList.toggle('on', st.solitary > 0);
  // The solitary card takes the hint's place.
  if (st.solitary > 0 && hint.visible) hint.hide();
  // First time something is in reach: how to use it.
  if (target && !hint.visible && !seenTip('interact') && seenTip('walk')) hint.show([TOUCH ? t('hint.interactTouch') : t('hint.interactKeys')], 'hand');
  vignette.classList.toggle('on', st.lockdown);
  sound.siren(st.lockdown && !g.paused);
  const zone = sim.playerZone;
  hudState.routine = st.routine;
  // At Lights Out the badge says whether the player is in the cell right now.
  hudState.attended = ROUTINE[st.routine].id === 'lightsOut' ? zone === 'playerCell' : st.attended;
  hudState.heat = st.heat;
  hudState.lockdown = st.lockdown;
  hudState.seen = st.seen;
  // (The paw held a moment: a dog pacing at the edge of its reach doesn't make it flicker.)
  const dog = dogWarning(sim);
  if (dog === 'nose') pawAt = performance.now();
  hudState.dog = dog ?? (hudState.dog === 'nose' && performance.now() - pawAt < PAW_HOLD_MS && !busy ? 'nose' : null);
  hudState.solitaryMinutes = st.solitary > 0 ? Math.ceil(st.solitary / STEPS_PER_MINUTE) : null;
  hudState.cash = st.cash;
  // During the Work Period with a job that counts today: the quota on the badge (GDD §11).
  const job = sim.jobActive();
  if (ROUTINE[st.routine].id === 'work' && job >= 0) {
    const d = jobRooms(sim.world)[job].def;
    workHud.place = t(`zone.${d.zone}` as Key);
    workHud.quota = st.quota;
    workHud.of = d.quota;
    workHud.paid = st.paid;
    hudState.work = workHud;
  } else hudState.work = null;
  // Irongate's two generators (P12): the pill says which half is dead (both: the power).
  const off = Math.max(st.powerOff, st.powerOff2);
  hudState.powerLeft = off > 0 ? (off - a) / STEPS_PER_SECOND : null;
  hudState.powerKey = !sim.world.def.grid || (st.powerOff > 0 && st.powerOff2 > 0) ? 'hud.powerOut' : st.powerOff > 0 ? 'hud.powerOutCams' : 'hud.powerOutFence';
  let wakes = Infinity;
  for (const x of st.guards) if (x.ko > 0) wakes = Math.min(wakes, x.ko);
  hudState.takeoverLeft = st.takeover && wakes < Infinity ? (wakes - a) / STEPS_PER_SECOND : null;
  // The cold (P9): shown while it has built up at all, the energy pill frosted once it bites.
  coldHud.built = st.cold / COLD_STEPS;
  coldHud.left = (COLD_STEPS - st.cold) / STEPS_PER_SECOND;
  coldHud.bit = st.frozen;
  coldHud.warming = !exposed(sim);
  // (P17: a heatwave's sun, in the same chip.)
  coldHud.hot = baking(sim);
  hudState.cold = st.cold > 0 ? coldHud : null;
  // A guard looking the other way (P15): the one whose look away ends first.
  let away = -1;
  st.guards.forEach((x, k) => {
    if (lookingAway(x, st.step) && (away < 0 || x.bribed < st.guards[away].bribed)) away = k;
  });
  if (away >= 0) {
    bribeHud.name = guardSubject(sim, away);
    bribeHud.left = Math.ceil((st.guards[away].bribed - st.step) / STEPS_PER_MINUTE);
    bribeHud.until = formatTime(clockAt(st.guards[away].bribed));
  }
  hudState.bribe = away >= 0 ? bribeHud : null;
  document.body.classList.toggle('chilled', coldHud.bit && !coldHud.hot);
  document.body.classList.toggle('baked', coldHud.bit && coldHud.hot);
  // The day (P17): the weather by the clock, the event's chip, the drill.
  dayHud(sim, hudState, a);
  hud.update(clock, zone, hudState);
  paBoard.reducedMotion = settings.reducedMotion;
  // (The warden's clock is play time: paused or over, nothing runs out and nothing new is said.)
  paBoard.frame(g.paused || g.over);
  // The music follows the danger and the hour; the ambience, where the player is.
  // Tense from 80% heat (or a chase, a lockdown) until it's back under 70%: no flapping at the line.
  const hunted = st.lockdown || st.guards.some((x) => x.mode === GUARD.CHASE);
  tense = hunted || st.heat >= 80 || (tense && st.heat >= 70);
  const chased = tense;
  const night = ROUTINE[st.routine].id === 'lightsOut' || st.sleeping;
  // Paused or reading a card, the music steps back.
  sound.duck(g.paused && !g.over);
  // Out on the road: the title theme plays over the victory screen.
  if (!g.over) sound.music(chased ? 'tension' : night || st.solitary > 0 ? 'night' : 'day');
  const outdoors = st.layer === LAYER.ROOF || (st.layer === LAYER.GROUND && !!TILE_INFO[sim.world.ground.kind[tile.z * MAP_W + tile.x]]?.outdoor);
  sound.setScene(st.layer === LAYER.UNDER ? 'under' : outdoors ? (night || clock.minuteOfDay < 8 * 60 ? 'outdoorNight' : 'outdoorDay') : 'indoor');
  // Speech bubbles (P13): over the picture, never over an open panel; none in a lesson.
  // (Hidden in the delivery's vehicle the talk goes on: the search's words are for the player in there.)
  chatterFrame(g, (busy && !(st.stowed && !g.paused && !g.over)) || panel || !!g.lesson);
  // Throwing (P14): the aim follows the pointer; a "?" over the guards on their way to look.
  updateAim(busy || panel);
  aimUI.frame(headAt, busy || st.layer !== LAYER.GROUND);
}

const headAt = (id: number, out: { x: number; y: number }) => view.screenOf(id, out, 1.95);
