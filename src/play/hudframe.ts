/** The HUD each frame (play's and a replay's): the clock, the routine, heat and every pill and chip, the file's button, the lockdown's red, the music and the ambience. */
import { ROUTINE } from '../content/routine';
import { t, type Key } from '../i18n';
import { jobRooms } from '../sim/systems/economy';
import { GUARD } from '../sim/systems/guards';
import { COLD_STEPS, LOOK_AWAY_STEPS, STEPS_PER_MINUTE, STEPS_PER_SECOND } from '../sim/tuning';
import { lookingAway } from '../sim/systems/ways';
import { clockAt, formatTime } from '../sim/systems/clock';
import { baking, exposed } from '../sim/systems/weather';
import { dayHud } from './day';
import { TILE_INFO } from '../sim/world/tiles';
import { LAYER, MAP_W } from '../sim/world/World';
import type { HudState } from '../ui/hud';
import { LESSONS } from '../tutorial/lessons';
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
export const hudState: HudState = { routine: 0, attended: false, heat: 0, lockdown: false, seen: false, solitaryMinutes: null, cash: 0, work: null, powerLeft: null, powerKey: 'hud.powerOut', takeoverLeft: null, wavedLeft: null, wavedKey: 'hud.waved', cold: null, bribe: null, weather: { icon: '', name: '', color: '' }, today: null, drill: null, dog: null, rat: null, order: null, crew: null, tipsy: null };
/** Tipsy (P28): the HUD's pill, refilled in place. */
const tipsyHud = { until: '', left: 0, of: TIPSY_STEPS / STEPS_PER_MINUTE };
const coldHud = { built: 0, left: 0, bit: false, warming: false, hot: false };
const bribeHud = { name: '', until: '', left: 0, of: LOOK_AWAY_STEPS / STEPS_PER_MINUTE };
const workHud = { place: '', quota: 0, of: 0, paid: false };
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
  // (P24's glider lesson, on the roof after Lights Out: the routine pill asks nothing of the player.)
  hudState.quietRoutine = !!g.lesson && LESSONS[g.lesson.index].routine === false;
  hudState.heat = st.heat;
  hudState.lockdown = st.lockdown;
  hudState.seen = st.seen;
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
  // Paused or reading a card, the music steps back.
  // (P30: and under a song on the stage.)
  sound.duck((g.paused && !g.over) || songOn);
  // Out on the road: the title theme plays over the victory screen.
  if (!g.over) sound.music(chased ? 'tension' : night || st.solitary > 0 ? 'night' : 'day');
  const outdoors = st.layer === LAYER.ROOF || (st.layer === LAYER.GROUND && !!TILE_INFO[sim.world.ground.kind[tile.z * MAP_W + tile.x]]?.outdoor);
  sound.setScene(st.layer === LAYER.UNDER ? 'under' : outdoors ? (night || clock.minuteOfDay < 8 * 60 ? 'outdoorNight' : 'outdoorDay') : 'indoor');
}

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
    else ('requestIdleCallback' in window ? requestIdleCallback(take, { timeout: 2000 }) : setTimeout(take, 16));
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
