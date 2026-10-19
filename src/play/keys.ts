import { t } from '../i18n';
import { OP } from '../sim/command';
import { targets, upPress, usePress } from './buttons';
import { board, click, closeSocial, itemsUI, profile, ratPanel, phonePanel, crewPanel, socialOpen, sound, tools, toggleProfile } from './context';
import { toggleRat } from './rat';
import { togglePhone } from './smuggle';
import { play, sendOp } from './game';
import { autosave, openHelp, pause } from './session';
import { aiming, cancelThrow, throwAhead } from './aim';
import { toggleWait } from './day';
import { toggleCrew } from './crew';
import { openObjectives } from './lesson';

/** The action button / E: use what is in reach (or wake up). */
export function act() {
  if (!play.game) return;
  play.game.pilot.stop();
  itemsUI.closeCraft();
  profile.close();
  ratPanel.close();
  phonePanel.close();
  crewPanel.close();
  sendOp(OP.INTERACT);
}

function onKeyDown(e: KeyboardEvent) {
  const game = play.game;
  if (!game || game.paused || e.metaKey || e.ctrlKey || e.repeat) return;
  // Escape closes a panel first (or lets go of an aim), and pauses only when none is open.
  if (e.code === 'Escape') {
    if (aiming()) cancelThrow();
    else if (itemsUI.panelOpen) itemsUI.closePanels();
    else if (socialOpen()) closeSocial();
    else if (game.rec.sim.state.train >= 0) sendOp(OP.TRAIN, 3);
    // (P22: out of an arm-wrestle, away from a lock.)
    else if (game.rec.sim.state.bout.length) sendOp(OP.TRAIN, 3);
    else if (game.rec.sim.state.pick.length) sendOp(OP.CLOSE);
    else pause();
    return;
  }
  const g = game;
  // O: a lesson's objectives (asleep, hidden in a vehicle or knocked out too: the card is down then).
  if (e.code === 'KeyO' && g.lesson) {
    openObjectives();
    return;
  }
  // Asleep: only waking up (E) means anything; knocked out, nothing does.
  if (g.rec.sim.state.ko > 0) return;
  if (g.rec.sim.state.sleeping && e.code !== 'KeyE') return;
  if (e.code === 'KeyE') {
    // E again closes what it opened (a container, a talk, the board) and steps off the equipment.
    const st = g.rec.sim.state;
    if (st.items.open >= 0 || st.talk >= 0 || st.train >= 0 || st.pick.length) sendOp(OP.CLOSE);
    else if (board.isOpen) board.close();
    else act();
  }
  // Hidden in the delivery's vehicle (P18): E climbs out (above), Space waits (the clock fast until the search), I and H still open the file and the help; nothing else.
  if (g.rec.sim.state.stowed) {
    if (e.code === 'Space') {
      e.preventDefault();
      toggleWait();
    }
    if (e.code === 'KeyI') {
      click();
      toggleProfile();
    }
    if (e.code === 'KeyH') openHelp();
    return;
  }
  if (e.code === 'KeyC') {
    closeSocial();
    itemsUI.toggleCraft();
  }
  if (e.code === 'KeyI') {
    click();
    toggleProfile();
  }
  if (e.code === 'KeyH') openHelp();
  // T: the pet rat's panel (P20).
  if (e.code === 'KeyT' && !itemsUI.panelOpen) {
    if (!ratPanel.isOpen) closeSocial();
    toggleRat(true);
  }
  // P: the burner phone's panel (P21).
  if (e.code === 'KeyP' && !itemsUI.panelOpen) togglePhone(true);
  // G: the crew's panel (P23).
  if (e.code === 'KeyG' && !itemsUI.panelOpen && g.rec.sim.state.followers.length) {
    if (!crewPanel.isOpen) closeSocial();
    toggleCrew(true);
  }
  // Training (GDD §3.2): left and right in turn fill the bar (P22: and push in an arm-wrestle).
  if ((g.rec.sim.state.train >= 0 || g.rec.sim.state.bout.length) && (e.code === 'KeyA' || e.code === 'ArrowLeft' || e.code === 'KeyD' || e.code === 'ArrowRight')) {
    sendOp(OP.TRAIN, e.code === 'KeyA' || e.code === 'ArrowLeft' ? 1 : 2);
    return;
  }
  // R: lock on to the next nearest person (past the last, none).
  if (e.code === 'KeyR' && !itemsUI.panelOpen && !socialOpen()) {
    // Nobody in reach (and nobody locked): say so rather than nothing.
    if (!targets.canLock && g.rec.sim.state.lock < 0) {
      sound.sting();
      itemsUI.toast(t('toast.nobodyToLock'));
    } else sendOp(OP.LOCK);
  }
  // Space: the tool in hand (not while a panel is open: the tool controls are put away then).
  if (e.code === 'Space') {
    // (A button in the rat's panel with the focus: Space presses it.)
    if (ratPanel.isOpen && (document.activeElement as HTMLElement | null)?.closest('.rat-panel')) return;
    if (phonePanel.isOpen && (document.activeElement as HTMLElement | null)?.closest('.phone-panel')) return;
    if (crewPanel.isOpen && (document.activeElement as HTMLElement | null)?.closest('.crew-panel')) return;
    // (P22: a die, a bet or a game's button in the talk panel with the focus: Space presses it.)
    if ((document.activeElement as HTMLElement | null)?.closest('.talk-panel, .train-card')) return;
    e.preventDefault();
    if (itemsUI.panelOpen || socialOpen()) return;
    tools.held = true;
    usePress();
  }
  // U: dig up, in a tunnel (held, it strikes on).
  if (e.code === 'KeyU' && !itemsUI.panelOpen && !socialOpen()) {
    tools.upHeld = true;
    upPress();
  }
  if (e.code === 'KeyQ' && g.rec.sim.state.items.inv[g.rec.sim.state.items.hand]) sendOp(OP.DROP, g.rec.sim.state.items.hand);
  // F: the item in hand thrown straight ahead (P14).
  if (e.code === 'KeyF' && !itemsUI.panelOpen && !socialOpen()) throwAhead();
  const digit = /^Digit([1-6])$/.exec(e.code);
  if (digit) sendOp(OP.SELECT, Number(digit[1]) - 1);
  // Dev builds: fast-forward the prison clock (×30) to test the routine.
  if (import.meta.env.DEV && e.code === 'BracketRight' && play.game) play.game.speed = play.game.speed === 1 ? 30 : 1;
}

/** The keyboard, and the page losing focus or going out of sight. */
export function listenKeys() {
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', (e) => {
    if (e.code === 'Space') tools.release();
    if (e.code === 'KeyU') tools.releaseUp();
  });
  // Focus gone with Space held: the keyup never comes.
  addEventListener('blur', () => tools.release());
  // A hidden page pauses the game (phones switching apps, a closed laptop).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !play.game) return;
    // Saved whatever is open (a help page, the pause card, a panel); paused if it wasn't.
    autosave(play.game);
    if (!play.game.paused) pause();
  });
  // The tab closing: one last save.
  addEventListener('pagehide', () => play.game && autosave(play.game));
}
