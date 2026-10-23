import { QuizCard, StageCard } from '../ui/nights';
import { PayphoneCard } from '../ui/payphone';
import { KioskCard } from '../ui/kiosk';
import { ParoleCard } from '../ui/parole';
import * as THREE from 'three';
import { setHaptics } from '../app/haptics';
import { TIERS, tierFor } from '../app/quality';
import { Sound } from '../audio/Sound';
import { loadSettings, saveSettings } from '../game/settings';
import { migrateStorage } from '../game/storage';
import { setLang, t } from '../i18n';
import { Controls } from '../input/Controls';
import { View } from '../render/View';
import { OP } from '../sim/command';
import { Banner } from '../ui/banner';
import { CombatUI } from '../ui/combat';
import { h } from '../ui/dom';
import { Hint } from '../ui/hint';
import { Hud } from '../ui/hud';
import { icon } from '../ui/icons';
import { ItemsUI } from '../ui/items';
import { ProfilePanel } from '../ui/profile';
import { SolitaryPanel } from '../ui/solitary';
import { StowPanel } from '../ui/stow';
import { RatPanel } from '../ui/rat';
import { CrewChips, CrewPanel } from '../ui/crew';
import { PhonePanel } from '../ui/phone';
import { PickCard, WrestleCard } from '../ui/games';
import { BoardCard, CheatCard, CourtCard } from '../ui/pastimes';
import { RaceCard } from '../ui/long';
import { InkCard, MatchCard } from '../ui/team';
import { BoardPanel, TalkPanel, TrainCard, WorkChips } from '../ui/social';
import { ToolControls } from '../ui/tool';
import { AimUI } from '../ui/aim';
import { TrophyToast } from '../ui/trophyToast';
import { PaBoard } from '../ui/pa';
import { trophyHooks } from '../game/trophies';
import { play, sendOp } from './game';

/**
 * The long-lived objects every play module shares: storage first, then settings, sound, the
 * view and the controls, then the HUD and panels. Made here once, in this order, and nowhere
 * else: each appends itself to the page, and the order they're appended is the order they stack.
 * This module imports no other play module, so anything can import it without a cycle.
 */
migrateStorage();
export const settings = loadSettings();
export const sound = new Sound();
export const click = () => sound.click();

// The stencil buffer lets the player's silhouette show through walls (Character.ts).
export const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance' });
document.body.append(renderer.domElement);
export const view = new View(renderer, TIERS[tierFor(settings.quality)]);
export const controls = new Controls(renderer.domElement, (f) => view.zoomBy(f));

/** Applies every setting (on start and on each change in the settings screen). */
export function applySettings() {
  setLang(settings.lang);
  setHaptics(settings.haptics);
  sound.setVolume(settings.muted ? 0 : settings.sfxVolume);
  sound.setMusicVolume(settings.muted ? 0 : settings.musicVolume);
  view.reducedMotion = settings.reducedMotion;
  view.shakeOn = settings.shake;
  document.body.classList.toggle('reduced-motion', settings.reducedMotion);
  view.setQuality(TIERS[tierFor(settings.quality)]);
  saveSettings(settings);
}
// Before anything below is built: they read the language as they make their text.
applySettings();

/**
 * What the HUD's pause button calls, set by main.ts: pausing belongs to the session, which
 * imports this module (a late binding instead of an import cycle).
 */
export const hooks: { pause: () => void } = { pause: () => {} };

export const hud = new Hud(
  () => hooks.pause(),
  () => {
    click();
    toggleProfile();
  },
);
export const hint = new Hint();
export const banner = new Banner();
export const solitaryPanel = new SolitaryPanel();
/** Hidden in the delivery's vehicle (P18). */
export const stowPanel = new StowPanel();
export const vignette = h('div', 'alarm-vignette');
/** Solitary is a dark cell: the edges of the screen close in. */
export const darkCell = h('div', 'solitary-veil');
document.body.append(vignette, darkCell);

/** The warden's speakers (P17): the morning card and the day's announcements; the storm's flash over the screen. */
export const paBoard = new PaBoard();
paBoard.onSpeak = (chars, chime) => {
  if (chime) sound.paChime();
  // The voice after the chime (with the Voices setting; not if the game was paused or left meanwhile).
  const g = play.game;
  window.setTimeout(() => {
    if (settings.voices && play.game === g && !g?.paused) sound.paVoice(Math.min(9, 3 + Math.round(chars / 16)));
  }, chime ? 950 : 0);
};
export const lightningVeil = h('div', 'lightning');
document.body.append(lightningVeil);

/** "Game saved" for a moment in the corner (see autosave). */
export const savedMark = h('div', 'saved-mark', `${icon('save', 14)}<span></span>`);
/** Achievements earned (P16): a gold card and a fanfare each. */
export const trophyToast = new TrophyToast();
trophyToast.onShow = () => sound.fanfare();
trophyHooks.onEarned = (list) => trophyToast.show(list);
savedMark.setAttribute('role', 'status');
document.body.append(savedMark);

// ------------------------------------------------------------------ social life and work (P6)
export const talk = new TalkPanel(sendOp, click);
export const board = new BoardPanel(sendOp, click);
export const profile = new ProfilePanel(click);
export const trainCard = new TrainCard(sendOp);
export const workChips = new WorkChips();
/** Throwing and noise over the picture (P14): the aim's hint and labels, guards who heard. */
export const aimUI = new AimUI();
/** The pet rat's panel (P20). */
export const ratPanel = new RatPanel(click);
/** The burner phone's panel (P21). */
export const phonePanel = new PhonePanel(click);
/** The side games (P22): the arm-wrestle's card and the lockpick's. */
export const wrestleCard = new WrestleCard(sendOp);
export const pickCard = new PickCard();
/** Card sharks (P27): a hand of Cheat, the court's card, the old-timer's checkers board. */
export const cheatCard = new CheatCard(sendOp, click);
export const courtCard = new CourtCard();
export const boardCard = new BoardCard(sendOp, click);
/** Long games (P28): the race card at the track. */
export const raceCard = new RaceCard(sendOp, click);
/** Team & ink (P29): the match's card, the tattoo's. */
export const matchCard = new MatchCard();
export const inkCard = new InkCard(sendOp, click);
/** Stage nights (P30): talent night's card, quiz night's. */
export const stageCard = new StageCard(sendOp, click);
export const quizCard = new QuizCard(sendOp, click);
/** The pay phone's card (P34). */
export const payphoneCard = new PayphoneCard(sendOp, click);
/** The internet kiosk's card (P35). */
export const kioskCard = new KioskCard(sendOp, click);
/** The parole board's card (P39): at the release desk, and before the board. */
export const paroleCard = new ParoleCard(sendOp, click);
/** The crew (P23): their panel, and the chips over their heads. */
export const crewPanel = new CrewPanel(click);
export const crewChips = new CrewChips();
/** A social panel is up (the talk, the job board, the file, the rat's, the phone's, the crew's): the tool controls step aside. */
export const socialOpen = () => talk.open || board.isOpen || profile.isOpen || ratPanel.isOpen || phonePanel.isOpen || crewPanel.isOpen;
export function closeSocial() {
  if (play.game && play.game.rec.sim.state.talk >= 0) sendOp(OP.CLOSE);
  board.close();
  profile.close();
  ratPanel.close();
  phonePanel.close();
  crewPanel.close();
}
/** In solitary, hidden in the delivery or knocked out, the file can't come up: what the button says then (null: it can). */
export function fileAway(st: { solitary: number; stowed: unknown; ko: number }): 'hud.fileSolitary' | 'hud.fileStowed' | 'hud.fileKo' | null {
  return st.solitary > 0 ? 'hud.fileSolitary' : st.stowed ? 'hud.fileStowed' : st.ko > 0 ? 'hud.fileKo' : null;
}

export function toggleProfile() {
  const game = play.game;
  if (!game || game.paused) return;
  // The file put away meanwhile (overlay.ts): the button says why and when, rather than opening it later unasked.
  const away = fileAway(game.rec.sim.state);
  if (away) {
    profile.close();
    banner.toast(t(away), 'info', 3500);
    return;
  }
  if (!profile.isOpen) {
    itemsUI.closePanels();
    board.close();
    ratPanel.close();
    phonePanel.close();
    crewPanel.close();
    if (game.rec.sim.state.talk >= 0) sendOp(OP.CLOSE);
  }
  profile.toggle();
}

export const itemsUI = new ItemsUI(sendOp, click);
// One panel at a time: the workbench opening puts the social panels away.
itemsUI.onCraftOpen = closeSocial;
export const combatUI = new CombatUI();
export const tools = new ToolControls();
export const sleepVeil = h('div', 'sleep-veil', `<span>${''}</span>`);
document.body.append(sleepVeil);
