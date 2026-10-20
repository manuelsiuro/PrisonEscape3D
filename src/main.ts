import './styles/index.css';
import { registerServiceWorker } from './app/pwa';
import { PRISONS } from './content/prisons';
import { openPrisons } from './game/campaign';
import { offerUpdate, titleFlow } from './flows/title';
import { warmIcons } from './render/itemIcons';
import { OP } from './sim/command';
import { Sim } from './sim/Sim';
import { upPress, usePress } from './play/buttons';
import { aimUI, combatUI, controls, hooks, hud, itemsUI, renderer, sound, tools, view } from './play/context';
import { armThrow, cancelThrow, onAim } from './play/aim';
import { play, sendOp } from './play/game';
import { onTap } from './play/guide';
import { openObjectives } from './play/lesson';
import { act, listenKeys } from './play/keys';
import { frame } from './play/loop';
import { pause } from './play/session';
import { pauseReplay } from './play/replay';
import { chatterStats, director } from './play/chatter';
import { firstDay } from './play/tips';
import { wireRatPanel } from './play/rat';
import { wireCrewPanel } from './play/crew';
import { wirePhone } from './play/smuggle';
import { wireGames } from './play/games';
import { wirePastimes } from './play/pastimes';

/**
 * Wiring: storage first, then the long-lived objects (play/context.ts, made as it's imported),
 * then the flows between screens. Screens are functions that resolve with the player's choice,
 * so each flow reads as a script (title → play → pause → …). The simulation runs in fixed steps;
 * the view interpolates between the last two (play/loop.ts).
 */
// (A replay, P25: the HUD's pause waits the replay.)
hooks.pause = () => (play.game?.replay ? pauseReplay() : pause());
view.onStep = (surface) => sound.step(surface);
/** Tap or click a spot: walk there, or lock on to someone. */
controls.onTap = onTap;
combatUI.onLock = () => {
  if (!play.game || play.game.paused) return;
  sendOp(OP.LOCK);
};
itemsUI.onAction = act;
tools.onPress = usePress;
tools.onUpPress = upPress;
// A lesson's bulb beside the pause button: its objectives.
hud.onLesson = openObjectives;
// Throwing (P14): the right button or a press while armed aims; Throw in the item's menu arms it.
controls.onAim = onAim;
itemsUI.onThrow = armThrow;
aimUI.onCancel = cancelThrow;
// The pet rat (P20): its panel's buttons, and the HUD's pill opening it.
wireRatPanel();
wireCrewPanel();
wirePhone();
wireGames();
wirePastimes();
listenKeys();

// The title shows the first prison drifting by.
// Behind the title: the newest prison open.
view.setWorld(new Sim(openPrisons().at(-1) ?? PRISONS[0]).world);
requestAnimationFrame(frame);

titleFlow();
// Item icons are photographed once; do it while the title is up, not at the first slot drawn.
setTimeout(() => warmIcons(), 1200);
// The game started: the boot guard in index.html stands down.
(window as { __pe3dBooted?: boolean }).__pe3dBooted = true;
registerServiceWorker(offerUpdate);
// Dev only: the running game, for probing from the browser console.
if (import.meta.env.DEV)
  Object.assign(window, {
    __game: () => play.game,
    __view: view,
    __renderer: renderer,
    __sound: sound,
    __firstDay: firstDay,
    // The speech bubbles: what has been said (lines, distinct, repeats), and the director itself.
    __chatter: () => chatterStats(),
    __director: director,
    // Throwing and noise over the picture (P14).
    __aimUI: aimUI,
    // The update offer, as a new version would show it.
    __offerUpdate: () => offerUpdate('9.9.9', () => location.reload()),
  });
