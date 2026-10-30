import './styles/index.css';
import { registerServiceWorker } from './app/pwa';
import { prisonById, PRISONS } from './content/prisons';
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
import { openDay } from './play/daycard';
import { act, listenKeys } from './play/keys';
import { frame } from './play/loop';
import { pauseReplay } from './play/replay';
import { chatterStats, director } from './play/chatter';
import { firstDay } from './play/tips';
import { wireRatPanel } from './play/rat';
import { wireCrewPanel } from './play/crew';
import { wirePhone } from './play/smuggle';
import { wireGames } from './play/games';
import { wirePastimes } from './play/pastimes';
import { wireOddJobs } from './play/oddjobs';
import { runHunt } from './play/hunt';
import { pause, startGame } from './play/session';
import { itemNumber } from './content/items';
import type { Carry } from './sim/hunt/state';

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
// The clock: the day's card.
hud.onDay = openDay;
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
wireOddJobs();
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
    // The manhunt (P41) straight away, from the title: __manhunt('stalag-flucht', 'wall', { minute: 1410, lou: true, crew: 1 }).
    __manhunt: (prison = 'center-perks', kind: Carry['kind'] = 'wall', more: Partial<Carry> = {}) => {
      const def = prisonById(prison) ?? PRISONS[0];
      document.querySelector('.title-screen')?.remove();
      startGame(new Sim(def, 5));
      const g = play.game!;
      g.over = true;
      const n = itemNumber;
      const carry: Carry = { prison: def.id, via: 'fence', kind, spd: 40, outfit: n('inmate_outfit'), kit: [n('light_cutters'), n('jerky'), n('pepper'), n('sleepy_jerky')], crew: 0, lou: false, headStart: 15, minute: 23 * 60 + 40, salt: 9, ...more };
      return runHunt(g, carry, { lookout: carry.crew ? { name: def.names[1] ?? 'Rocco', cell: 3 } : null });
    },
  });
