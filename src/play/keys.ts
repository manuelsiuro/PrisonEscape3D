import { t } from '../i18n';
import { EXT, OP } from '../sim/command';
import { upPress, usePress } from './buttons';
import { targets } from './reach';
import {
  board,
  click,
  closeSocial,
  itemsUI,
  profile,
  ratPanel,
  phonePanel,
  crewPanel,
  socialOpen,
  sound,
  tools,
  toggleProfile,
} from './context';
import { toggleRat } from './rat';
import { togglePhone } from './smuggle';
import { play, sendOp } from './game';
import { autosave, openHelp, pause } from './session';
import { pauseReplay } from './replay';
import { aiming, cancelThrow, throwAhead } from './aim';
import { toggleWait } from './day';
import { toggleCrew } from './crew';
import { openObjectives } from './lazy';
import { openDay } from './daycard';
import { pastimeKey, shootKey } from './pastimes';
import { diceKey } from './games';
import { kickKey } from './team';
import { nightsBusy, nightsKey } from './nights';
import { payphoneKey } from './payphone';
import { kioskKey } from './kiosk';
import { vendAct, vendKey } from './vending';
import { menuAct, menuKey } from './menuBoard';
import { VEND } from '../content/vending';
import { paroleBusy, paroleKey } from './parole';
import { reading } from '../sim/systems/training';
import { closeOddJobsCard, jobCardShown, oddjobKey } from './oddjobs';
import { huntKey } from './lazy';
import { keyCode, keysVersion } from '../input/bindings';

/** The action button / E: use what is in reach (or wake up). */
export function act() {
  if (!play.game) return;
  // (P30: on the stage, at the quiz's table: the action button and E do nothing.)
  // (P39: nor before the parole board.)
  if (nightsBusy(play.game.rec.sim.state) || paroleBusy(play.game.rec.sim.state)) return;
  play.game.pilot.stop();
  // (2.31: reading, the action button underlines; 2.43: training the rat, it's pressed as the rat passes the bait.)
  if (reading(play.game.rec.sim) || play.game.rec.sim.state.ratRun?.length) {
    sendOp(OP.TRAIN, 1);
    return;
  }
  // (2.32: at the vending machine's card, a thump at what's stuck, else away from it.)
  if (play.game.rec.sim.state.vendOpen) {
    vendAct(play.game.rec.sim);
    return;
  }
  // (2.33: at the menu board's card, away from it.)
  if (play.game.rec.sim.state.menuOpen) {
    menuAct();
    return;
  }
  itemsUI.closeCraft();
  profile.close();
  ratPanel.close();
  phonePanel.close();
  crewPanel.close();
  sendOp(OP.INTERACT);
}

function onKeyDown(e: KeyboardEvent) {
  const game = play.game;
  if (!game || game.paused || game.replay || e.metaKey || e.ctrlKey || e.repeat) return;
  // (Session 9: the key as the action it's bound to: every test below names an action's default key.)
  const code = keyCode(e.code);
  // (Space given to another action, or to none: the page's own Space, pressing the button with the focus (the
  // clock's, after its card), stays off as it is when Space uses the tool; but in a panel whose buttons it presses.)
  if (
    e.code === 'Space' &&
    code !== 'Space' &&
    !(document.activeElement as HTMLElement | null)?.closest('.rat-panel, .phone-panel, .crew-panel, .talk-panel, .train-card')
  )
    e.preventDefault();
  // The manhunt (P41): its own keys (Escape, H and O as in a game, below).
  if (game.hunt && code !== 'Escape' && code !== 'KeyH' && code !== 'KeyO') {
    huntKey(code, e);
    return;
  }
  if (game.hunt) {
    if (code === 'Escape') void pause();
    else if (code === 'KeyH') void openHelp();
    else if (code === 'KeyO' && game.lesson) void openObjectives();
    return;
  }
  // Escape closes a panel first (or lets go of an aim), and pauses only when none is open.
  if (code === 'Escape') {
    if (aiming()) cancelThrow();
    else if (itemsUI.panelOpen) itemsUI.closePanels();
    else if (socialOpen()) closeSocial();
    else if (game.rec.sim.state.train >= 0 || game.rec.sim.state.ratRun?.length) sendOp(OP.TRAIN, 3);
    // (2.32: away from the vending machine's card.)
    else if (game.rec.sim.state.vendOpen) sendOp(OP.EXT, EXT.VEND, VEND.CLOSE);
    // (2.33: away from the menu board's card.)
    else if (game.rec.sim.state.menuOpen) menuAct();
    // (P22: out of an arm-wrestle, away from a lock.)
    else if (game.rec.sim.state.bout.length) sendOp(OP.TRAIN, 3);
    else if (game.rec.sim.state.pick.length) sendOp(OP.CLOSE);
    // (P29: a tattoo sitting, either chair: given up, as its card's Give up button does.)
    else if (game.rec.sim.state.ink) sendOp(OP.EXT, EXT.INK, 0);
    // (P40: the board's card, or the job's own opened from its chip or B: closed, the focus back on the chip.)
    else if (jobCardShown()) closeOddJobsCard();
    else void pause();
    return;
  }
  const g = game;
  // O: a lesson's objectives (asleep, hidden in a vehicle or knocked out too: the card is down then).
  if (code === 'KeyO' && g.lesson) {
    void openObjectives();
    return;
  }
  // J: the day's card (asleep, knocked out or hidden in a vehicle too: when does the next block start?).
  if (code === 'KeyJ') {
    void openDay();
    return;
  }
  // Asleep: only waking up (E) and the file (I) mean anything; knocked out, only I (it says the file waits).
  if ((g.rec.sim.state.ko > 0 || g.rec.sim.state.sleeping) && code === 'KeyI') {
    click();
    toggleProfile();
    return;
  }
  if (g.rec.sim.state.ko > 0) return;
  if (g.rec.sim.state.sleeping && code !== 'KeyE') return;
  if (code === 'KeyE') {
    // E again closes what it opened (a container, a talk, the board) and steps off the equipment.
    const st = g.rec.sim.state;
    // (2.31: not while reading: it underlines; X or a step closes the book.)
    if (reading(g.rec.sim) || st.ratRun?.length) sendOp(OP.TRAIN, 1);
    else if (st.items.open >= 0 || st.talk >= 0 || st.train >= 0 || st.pick.length) sendOp(OP.CLOSE);
    else if (board.isOpen) board.close();
    else act();
  }
  // Hidden in the delivery's vehicle (P18): E climbs out (above), Space waits (the clock fast until the search), H opens the help, I says the file waits; nothing else.
  if (g.rec.sim.state.stowed) {
    if (code === 'Space') {
      e.preventDefault();
      toggleWait();
    }
    if (code === 'KeyI') {
      click();
      toggleProfile();
    }
    if (code === 'KeyH') void openHelp();
    return;
  }
  // Card sharks (P27): the hand of Cheat's keys (1–5, Enter, L) come before the hotbar's; 2.40: the dice's (1, 2, Enter).
  if (pastimeKey(code) || diceKey(code)) {
    e.preventDefault();
    return;
  }
  // Stage nights (P30): the lanes' keys on the stage, the answers' (1–4) at the quiz.
  if (nightsKey(code)) {
    e.preventDefault();
    return;
  }
  // The pay phone (P34): on Lou's line, 1–3 say a phrase.
  if (payphoneKey(code)) {
    e.preventDefault();
    return;
  }
  // The kiosk (P35): in a course, 1–4 answer.
  if (kioskKey(code)) {
    e.preventDefault();
    return;
  }
  // The vending machine (2.32): at its card, 1–7 choose a row.
  if (vendKey(code)) {
    e.preventDefault();
    return;
  }
  // The menu board (2.33): at its card, X scribbles.
  if (menuKey(code)) {
    e.preventDefault();
    return;
  }
  // The parole board (P39): before it, 1–3 answer.
  if (paroleKey(code)) {
    e.preventDefault();
    return;
  }
  // B: the odd job's card (P40; on watch at a dig, the whistle).
  if (oddjobKey(code)) {
    e.preventDefault();
    return;
  }
  if (code === 'KeyC') {
    closeSocial();
    itemsUI.toggleCraft();
  }
  if (code === 'KeyI') {
    click();
    toggleProfile();
  }
  if (code === 'KeyH') void openHelp();
  // T: the pet rat's panel (P20).
  if (code === 'KeyT' && !itemsUI.panelOpen) {
    if (!ratPanel.isOpen) closeSocial();
    toggleRat(true);
  }
  // P: the burner phone's panel (P21).
  if (code === 'KeyP' && !itemsUI.panelOpen) togglePhone(true);
  // G: the crew's panel (P23).
  if (code === 'KeyG' && !itemsUI.panelOpen && g.rec.sim.state.followers.length) {
    if (!crewPanel.isOpen) closeSocial();
    toggleCrew(true);
  }
  // Training (GDD §3.2): left and right in turn fill the bar (P22: and push in an arm-wrestle).
  // (2.29: waiting for a turn too: off to a start is no way to lose it. A press now counts for nothing.)
  if (
    (g.rec.sim.state.train >= 0 || g.rec.sim.state.askTurn.length || g.rec.sim.state.bout.length) &&
    (code === 'KeyA' || code === 'ArrowLeft' || code === 'KeyD' || code === 'ArrowRight')
  ) {
    sendOp(OP.TRAIN, code === 'KeyA' || code === 'ArrowLeft' ? 1 : 2);
    return;
  }
  // R: lock on to the next nearest person (past the last, none).
  if (code === 'KeyR' && !itemsUI.panelOpen && !socialOpen()) {
    // Nobody in reach (and nobody locked): say so rather than nothing.
    if (!targets.canLock && g.rec.sim.state.lock < 0) {
      sound.sting();
      itemsUI.toast(t('toast.nobodyToLock'));
    } else sendOp(OP.LOCK);
  }
  // Space: the tool in hand (not while a panel is open: the tool controls are put away then).
  if (code === 'Space') {
    // (A button in the rat's panel with the focus: Space presses it.)
    if (ratPanel.isOpen && (document.activeElement as HTMLElement | null)?.closest('.rat-panel')) return;
    if (phonePanel.isOpen && (document.activeElement as HTMLElement | null)?.closest('.phone-panel')) return;
    if (crewPanel.isOpen && (document.activeElement as HTMLElement | null)?.closest('.crew-panel')) return;
    // (P22: a die, a bet or a game's button in the talk panel with the focus: Space presses it.)
    if ((document.activeElement as HTMLElement | null)?.closest('.talk-panel, .train-card')) return;
    e.preventDefault();
    if (itemsUI.panelOpen || socialOpen()) return;
    // (2.31: reading, Space underlines too; 2.43: the rat's training, Space is pressed as it passes the bait.)
    if (reading(g.rec.sim) || g.rec.sim.state.ratRun?.length) {
      sendOp(OP.TRAIN, 1);
      return;
    }
    // (P27: on a spot at the hoop, Space raises the ball for a shot; let go, it goes.)
    // (P29: in a match, Space held is a kick, let go it goes; before the hoop's shot, whose spots lie on some pitches.)
    if (kickKey(true)) return;
    if (shootKey(true)) return;
    tools.held = true;
    usePress();
  }
  // V: the block (2.35), held.
  if (code === 'KeyV' && !itemsUI.panelOpen && !socialOpen()) tools.holdBlock(true);
  // U: dig up, in a tunnel (held, it strikes on).
  if (code === 'KeyU' && !itemsUI.panelOpen && !socialOpen()) {
    tools.upHeld = true;
    upPress();
  }
  if (code === 'KeyQ' && g.rec.sim.state.items.inv[g.rec.sim.state.items.hand]) sendOp(OP.DROP, g.rec.sim.state.items.hand);
  // F: the item in hand thrown straight ahead (P14).
  if (code === 'KeyF' && !itemsUI.panelOpen && !socialOpen()) throwAhead();
  const digit = /^Digit([1-6])$/.exec(code);
  if (digit) sendOp(OP.SELECT, Number(digit[1]) - 1);
  // Dev builds: fast-forward the prison clock (×30) to test the routine.
  if (import.meta.env.DEV && code === 'BracketRight' && play.game) play.game.speed = play.game.speed === 1 ? 30 : 1;
}

/** The keyboard, and the page losing focus or going out of sight. */
export function listenKeys() {
  addEventListener('keydown', onKeyDown);
  /** A key held while the keys change (the Keys card): its keyup reads as another, so what it held is let go. */
  let keysAt = keysVersion();
  addEventListener('keyup', (e) => {
    if (keysAt !== keysVersion()) {
      keysAt = keysVersion();
      tools.release();
      tools.releaseUp();
      tools.holdBlock(false);
      kickKey(false);
      shootKey(false);
    }
    const code = keyCode(e.code);
    if (code === 'Space') {
      shootKey(false);
      kickKey(false);
      tools.release();
    }
    if (code === 'KeyU') tools.releaseUp();
    if (code === 'KeyV') tools.holdBlock(false);
  });
  // Focus gone with Space held: the keyup never comes.
  addEventListener('blur', () => {
    tools.release();
    tools.holdBlock(false);
    kickKey(false);
    shootKey(false);
  });
  // A hidden page pauses the game (phones switching apps, a closed laptop).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !play.game) return;
    // (A replay, P25: it waits; nothing of it is saved.)
    if (play.game.replay) return pauseReplay();
    // Saved whatever is open (a help page, the pause card, a panel); paused if it wasn't.
    autosave(play.game);
    if (!play.game.paused) void pause();
  });
  // The tab closing: one last save.
  addEventListener('pagehide', () => play.game && autosave(play.game));
}
