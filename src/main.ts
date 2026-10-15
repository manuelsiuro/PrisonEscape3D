import './styles/index.css';
import { registerServiceWorker } from './app/pwa';
import { PRISONS } from './content/prisons';
import { offerUpdate, titleFlow } from './flows/title';
import { warmIcons } from './render/itemIcons';
import { OP } from './sim/command';
import { Sim } from './sim/Sim';
import { usePress } from './play/buttons';
import { combatUI, controls, hooks, itemsUI, renderer, sound, tools, view } from './play/context';
import { play, sendOp } from './play/game';
import { onTap } from './play/guide';
import { act, listenKeys } from './play/keys';
import { frame } from './play/loop';
import { pause } from './play/session';
import { firstDay } from './play/tips';

/**
 * Wiring: storage first, then the long-lived objects (play/context.ts, made as it's imported),
 * then the flows between screens. Screens are functions that resolve with the player's choice,
 * so each flow reads as a script (title → play → pause → …). The simulation runs in fixed steps;
 * the view interpolates between the last two (play/loop.ts).
 */
hooks.pause = () => pause();
view.onStep = (surface) => sound.step(surface);
/** Tap or click a spot: walk there, or lock on to someone. */
controls.onTap = onTap;
combatUI.onLock = () => {
  if (!play.game || play.game.paused) return;
  sendOp(OP.LOCK);
};
itemsUI.onAction = act;
tools.onPress = usePress;
listenKeys();

// The title shows the first prison drifting by.
view.setWorld(new Sim(PRISONS[0]).world);
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
    // The update offer, as a new version would show it.
    __offerUpdate: () => offerUpdate('9.9.9', () => location.reload()),
  });
