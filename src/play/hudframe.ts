/** The HUD each frame (play's and a replay's): the clock, the routine, heat and every pill and chip, the file's button, the lockdown's red, the music and the ambience. */
import { lyingLow } from '../sim/systems/stealth';
import { onOwnSquare, squareNeeded } from '../sim/systems/rollcall';
import type { Sim } from '../sim/Sim';
import { ROUTINE } from '../content/routine';
import { presenceNeeded } from '../sim/systems/routine';
import { t, type Key } from '../i18n';
import { jobRooms } from '../sim/systems/economy';
import { type NextWork, nextWork, workWarningAt } from '../sim/systems/jobs';
import { itemName } from '../ui/items';
import { inmateName } from '../ui/names';
import { GUARD } from '../sim/systems/guards';
import {
  COLD_STEPS,
  LAST_WARNING,
  LIGHTS_OUT_GRACE,
  LOOK_AWAY_STEPS,
  STEPS_PER_MINUTE,
  STEPS_PER_SECOND,
  TRESPASS_STEPS,
} from '../sim/tuning';
import { afterHours } from '../sim/systems/watch';
import { lookingAway } from '../sim/systems/ways';
import { clockAt, formatTime, hhmm } from '../sim/systems/clock';
import { baking, exposed } from '../sim/systems/weather';
import { dayHud } from './day';
import { TILE_INFO } from '../sim/world/tiles';
import { LAYER, MAP_W } from '../sim/world/World';
import type { HudState } from '../ui/hud';
import { hud, paBoard, profile, settings, sound, vignette, view } from './context';
import { playNow, type Game } from './game';
import { portraitOf } from '../render/portrait';
import { dogWarning } from '../sim/systems/k9';
import { markTip, seenTip } from './tips';
import { wavedLeft } from './getaway';
import { freedLeft, releaseChip } from './paperwork';
import { calledNow } from '../sim/systems/paperwork';
import { ratHud } from './rat';
import { orderHud } from './smuggle';
import { cashShown } from './games';
import { crewPill } from './crew';
import { tipsyNow } from '../sim/systems/pruno';
import { G, playerGang, warningLeft } from '../sim/systems/gangs';
import { GANGS } from '../content/gangs';
import { paroleChip } from './parole';
import { jobHud } from './oddjobs';
import { TIPSY_STEPS } from '../content/long';
import { type Look } from '../render/look';
import { guardSubject } from '../ui/names';

/** The release's chip (P36), refilled. */
const releaseHud = { icon: 'clipboard', color: '#d8b04a', text: '', time: '', soon: false, left: null, of: 1, sr: '' };
/** The parole hearing's chip (P39), refilled. */
const paroleHud = { icon: 'scale', color: '#8a6bd1', text: '', time: '', soon: false, left: null, of: 1, sr: '' };
/** When the paw last lit for a dog's nose (real ms), and how long it stays lit after. */
let pawAt = -1e9;
const PAW_HOLD_MS = 1500;
export const hudState: HudState = {
  routine: 0,
  attended: false,
  heat: 0,
  lockdown: false,
  seen: false,
  solitaryMinutes: null,
  cash: 0,
  work: null,
  powerLeft: null,
  powerKey: 'hud.powerOut',
  takeoverLeft: null,
  wavedLeft: null,
  wavedKey: 'hud.waved',
  cold: null,
  bribe: null,
  weather: { icon: '', name: '', color: '' },
  today: null,
  drill: null,
  dog: null,
  rat: null,
  order: null,
  crew: null,
  tipsy: null,
};
/** Tipsy (P28): the HUD's pill, refilled in place. */
const turfHud = { text: '', left: 0, of: TRESPASS_STEPS / STEPS_PER_SECOND };
const tipsyHud = { until: '', left: 0, of: TIPSY_STEPS / STEPS_PER_MINUTE };
const coldHud = { built: 0, left: 0, bit: false, warming: false, hot: false };
const bribeHud = { name: '', until: '', left: 0, of: LOOK_AWAY_STEPS / STEPS_PER_MINUTE };
/** The job's next step in words, as the action button will put it. */
function nextLabel(sim: Sim, n: NextWork): string {
  if (n.act === 'wait') return t('work.wait');
  if (n.act === 'sort') return t('work.sort');
  if (n.act === 'mop') return t('work.next', { verb: t('work.mop'), what: t('thing.puddle') });
  if (n.act === 'deliver') return `${t('act.deliver')} ${inmateName(sim, n.who)}`;
  return t('work.next', { verb: t(`work.${n.act}` as Key), what: itemName(n.item) });
}

const workHud = { place: '', quota: 0, of: 0, paid: false, late: false };
/** The music's tension cue is on (see updateOverlay). */
let tense = false;
/** A song on the stage is heard (P30): the score steps back for it. */
let songOn = false;

/** A song on the stage is heard (updateOverlay says so). */
export const setSongOn = (on: boolean) => void (songOn = on);

/**
 * The HUD for the moment shown (in play, and in a replay, P25): the clock, the routine, the
 * heat and every pill, the lockdown's red and siren, the music and the ambience.
 */
export function hudFrame(g: Game, a: number, tile: { x: number; z: number }, busy: boolean) {
  const sim = g.rec.sim;
  const st = sim.state;
  const clock = sim.clock;
  hudState.rat = ratHud(sim);
  hudState.order = orderHud(sim);
  hudState.crew = crewPill(sim);
  hudState.oddjob = jobHud(sim);
  vignette.classList.toggle('on', st.lockdown);
  sound.siren(st.lockdown && !g.paused);
  const zone = sim.playerZone;
  hudState.routine = st.routine;
  // At Lights Out the badge says whether the player is in the cell right now.
  hudState.attended = ROUTINE[st.routine].id === 'lightsOut' ? zone === 'playerCell' : st.attended;
  // (2.23: a block checked in to by staying: the minutes there so far, of how many.)
  const need = presenceNeeded(sim);
  const present = Math.floor(st.present / STEPS_PER_MINUTE);
  if (!need || st.attended) hudState.presence = null;
  else if (hudState.presence?.[0] !== present || hudState.presence[1] !== need / STEPS_PER_MINUTE)
    hudState.presence = [present, need / STEPS_PER_MINUTE];
  // (P24's glider lesson, on the roof after Lights Out: the routine pill asks nothing of the player.)
  hudState.quietRoutine = !!g.lesson && g.lesson.lesson.routine === false;
  // At roll call (2.27): where to stand till counted; on it, the morning's shakedown, until it's over.
  hudState.square =
    squareNeeded(sim) && !st.attended && !onOwnSquare(sim) ? t('routine.yourSquare') : (shakedownLine(sim) ?? homeLine(sim, g));
  hudState.heat = st.heat;
  hudState.lockdown = st.lockdown;
  hudState.seen = st.seen;
  hudState.lyingLow = lyingLow(sim);
  // (The paw held a moment: a dog pacing at the edge of its reach doesn't make it flicker.)
  const dog = dogWarning(sim);
  if (dog === 'nose') pawAt = performance.now();
  hudState.dog = dog ?? (hudState.dog === 'nose' && performance.now() - pawAt < PAW_HOLD_MS && !busy ? 'nose' : null);
  hudState.solitaryMinutes = st.solitary > 0 ? Math.ceil(st.solitary / STEPS_PER_MINUTE) : null;
  // (P22: the dice's winnings show as the dice come down.)
  hudState.cash = cashShown(st);
  // During the Work Period with a job that counts today: the quota on the badge (GDD §11).
  const job = sim.jobActive();
  if (ROUTINE[st.routine].id === 'work' && job >= 0) {
    const d = jobRooms(sim.world)[job].def;
    // (2.30: on the clock, in its room or on its round, the next step; else the room to go to.)
    const next = nextWork(sim);
    workHud.place =
      next && (sim.dutyZones.includes(sim.playerZone) || d.flow !== 'machine') ? nextLabel(sim, next) : t(`zone.${d.zone}` as Key);
    const now = sim.clock.minuteOfDay;
    workHud.late =
      !st.paid &&
      !st.lockdown &&
      !st.excused &&
      (now >= LAST_WARNING || (now >= workWarningAt(d) && (d.flow !== 'mail' || st.quota === 0)));
    workHud.quota = st.quota;
    workHud.of = d.quota;
    workHud.paid = st.paid;
    hudState.work = workHud;
  } else hudState.work = null;
  // Irongate's two generators (P12): the pill says which half is dead (both: the power).
  const off = Math.max(st.powerOff, st.powerOff2);
  hudState.powerLeft = off > 0 ? (off - a) / STEPS_PER_SECOND : null;
  hudState.powerKey =
    !sim.world.def.grid || (st.powerOff > 0 && st.powerOff2 > 0)
      ? 'hud.powerOut'
      : st.powerOff > 0
        ? 'hud.powerOutCams'
        : 'hud.powerOutFence';
  let wakes = Infinity;
  for (const x of st.guards) if (x.ko > 0) wakes = Math.min(wakes, x.ko);
  hudState.takeoverLeft = st.takeover && wakes < Infinity ? (wakes - a) / STEPS_PER_SECOND : null;
  // Waved through (P24): the checkpoint's gates open for the player, how long for.
  hudState.wavedLeft = wavedLeft(sim, a) ?? freedLeft(sim, a);
  // (P36: or cleared for release, the release's way out: the same chip, its own words.)
  hudState.wavedKey = st.waved ? 'hud.waved' : 'hud.freed';
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
  if (tipsyNow(st)) {
    tipsyHud.left = Math.ceil((st.tipsy[0] - st.step) / STEPS_PER_MINUTE);
    tipsyHud.until = formatTime(clockAt(st.tipsy[0]));
    hudState.tipsy = tipsyHud;
  } else hudState.tipsy = null;
  document.body.classList.toggle('tipsy', tipsyNow(st));
  // (2.36: the player's gang, and a warning off a rival's turf with its seconds.)
  const mine = playerGang(sim);
  hudState.gang = mine >= 0 ? (sim.prison.gangs?.[mine]?.id ?? null) : null;
  const left = warningLeft(sim);
  const whose = left >= 0 && st.gang ? GANGS[st.gang[G.TURF] - 1] : undefined;
  if (whose) {
    turfHud.text = t('hud.turf', { gang: t(`gangT.${whose}` as Key) });
    turfHud.left = Math.ceil(left / STEPS_PER_SECOND);
    hudState.turf = turfHud;
  } else hudState.turf = null;
  document.body.classList.toggle('chilled', coldHud.bit && !coldHud.hot);
  document.body.classList.toggle('baked', coldHud.bit && coldHud.hot);
  // The day (P17): the weather by the clock, the event's chip, the drill.
  dayHud(sim, hudState, a);
  // (P36: the name on tomorrow's release list, or called this morning: its chip in the day's place.)
  const rel = releaseChip(sim);
  if (rel) {
    releaseHud.text = rel;
    releaseHud.sr = rel;
    releaseHud.soon = calledNow(st);
    hudState.today = releaseHud;
  } else {
    // (P39: a parole hearing to come, or called this morning: its chip there too.)
    const hearing = paroleChip(sim);
    if (hearing) {
      paroleHud.text = hearing.text;
      paroleHud.sr = hearing.text;
      paroleHud.soon = hearing.soon;
      hudState.today = paroleHud;
    }
  }
  hud.update(clock, zone, hudState);
  fileButton(g);
  paBoard.reducedMotion = settings.reducedMotion;
  // (The warden's clock is play time: paused or over, nothing runs out and nothing new is said.)
  paBoard.frame(g.paused || g.over);
  // The music follows the danger and the hour; the ambience, where the player is.
  // Tense from 80% heat (or a chase, a lockdown) until it's back under 70%: no flapping at the line.
  const hunted = st.lockdown || st.guards.some((x) => x.mode === GUARD.CHASE);
  tense = hunted || st.heat >= 80 || (tense && st.heat >= 70);
  const chased = tense;
  const night = ROUTINE[st.routine].id === 'lightsOut' || st.sleeping;
  // (2.28: the block's lights going out, heard; the sim's own moment, so nothing to save.)
  const dark = !st.lockdown && afterHours(sim);
  if (dark && !wasDark && darkSim === sim && !st.sleeping && !g.paused && !g.replay) sound.powerDown();
  wasDark = dark;
  darkSim = sim;
  // Paused or reading a card, the music steps back.
  // (P30: and under a song on the stage.)
  sound.duck((g.paused && !g.over) || songOn);
  // Out on the road: the title theme plays over the victory screen.
  if (!g.over) sound.music(chased ? 'tension' : night || st.solitary > 0 ? 'night' : 'day');
  const outdoors =
    st.layer === LAYER.ROOF || (st.layer === LAYER.GROUND && !!TILE_INFO[sim.world.ground.kind[tile.z * MAP_W + tile.x]]?.outdoor);
  sound.setScene(
    st.layer === LAYER.UNDER ? 'under' : outdoors ? (night || clock.minuteOfDay < 8 * 60 ? 'outdoorNight' : 'outdoorDay') : 'indoor',
  );
  // (2.36: the Six Hunter's morning: the Huntmaster's horn over the valley at 06:00, far off, muffled indoors.)
  const minute = clock.minuteOfDay;
  // (A game just loaded or begun starts afresh: a save loaded at 06:05 after one left at 05:55 sounds nothing. Review of 2.36.)
  if (hornSim !== sim) {
    hornSim = sim;
    hornMinute = -1;
  }
  if (
    sim.world.def.theme === 'forest' &&
    hornMinute >= 0 &&
    hornMinute < DAWN_HORN &&
    minute >= DAWN_HORN &&
    minute < DAWN_HORN + 10 &&
    !g.paused
  )
    sound.huntHorn(outdoors ? 0.45 : 0.22);
  hornMinute = minute;
}

/** The game and the minute of the last frame (the dawn horn sounds as its clock passes 06:00), and that minute. */
let hornSim: unknown = null;
let hornMinute = -1;
const DAWN_HORN = 6 * 60;

/** The look last photographed for the file's button (render/portrait.ts: a new WebGL context and shader, so in an idle moment if one comes within 2 s). */
let faceLook: Look | null = null;
/** The game the button was last drawn for (a new one: the label may be due again, the face taken at once). */
let fileGame: Game | null = null;
/** The first run's "Your file" label under the button: from (play time, ms) and until. */
let fileTipAt = -1;
const FILE_TIP_WAIT = 1500;
const FILE_TIP_MS = 6000;

/**
 * The HUD's file button: your prisoner's face (taken again when the look changes: the
 * Intake's, a disguise, a tattoo inked; at once in a new game, so the last prisoner's face
 * never shows, in an idle moment otherwise), also at the file's head; a dot while the file
 * holds news; on the first run, its "Your file" label for a few seconds of play (gone once the
 * file is opened).
 */
function fileButton(g: Game) {
  const look = view.playerLook;
  const fresh = g !== fileGame;
  if (fresh) {
    fileGame = g;
    fileTipAt = -1;
  }
  if (look !== faceLook) {
    faceLook = look;
    const take = () => {
      if (view.playerLook !== look) return;
      const url = portraitOf(look);
      hud.setFace(url);
      profile.face = url;
    };
    if (fresh) take();
    else 'requestIdleCallback' in window ? requestIdleCallback(take, { timeout: 2000 }) : setTimeout(take, 16);
  }
  hud.setNews(!g.replay && profile.newsFor(g.rec.sim));
  const now = playNow();
  if (fileTipAt < 0 && !g.paused && !seenTip('fileButton')) fileTipAt = now + FILE_TIP_WAIT;
  if (fileTipAt > 0 && profile.isOpen) fileTipAt = 0;
  const tip = fileTipAt > 0 && !g.paused && now >= fileTipAt && now < fileTipAt + FILE_TIP_MS;
  // (Spent once it shows: a game left before then shows it next time.)
  if (tip && !seenTip('fileButton')) markTip('fileButton');
  hud.fileTip(tip);
}

let wasDark = false;
/** Whose: a game started or loaded after dark doesn't hear them go out on its first frame. */
let darkSim: Sim | null = null;
/** The walk home, while the bell's grace lasts (2.28), for the routine pill; null else. */
function homeLine(sim: Sim, g: Game): string | null {
  const st = sim.state;
  // (A lesson about something else, set up at night, has its own place to send them.)
  if (
    (g.lesson && g.lesson.lesson.id !== 'night') ||
    sim.rules227 ||
    st.lockdown ||
    ROUTINE[st.routine].id !== 'lightsOut' ||
    afterHours(sim) ||
    sim.playerZone === 'playerCell' ||
    sim.world.def.rules?.relaxed
  )
    return null;
  return t('routine.homeBy', { time: hhmm(ROUTINE[st.routine].start + LIGHTS_OUT_GRACE / STEPS_PER_MINUTE) });
}

/** The shakedown's cells while it's on and the morning roll call lasts (2.27), for the routine pill; null else. */
function shakedownLine(sim: Sim): string | null {
  const st = sim.state;
  if (ROUTINE[st.routine].id !== 'rollCall') return null;
  const g = st.guards.find((o) => o.mode === GUARD.SHAKEDOWN || o.resume === GUARD.SHAKEDOWN);
  if (!g || !g.tasks.length) return null;
  return g.tasks.includes(1) ? t('routine.shakedownYou') : t('routine.shakedown', { cells: g.tasks.join(', ') });
}
