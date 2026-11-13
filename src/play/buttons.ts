/**
 * The tool and dig-up presses (what the buttons would do is worked out in reach.ts).
 */
import { LAYER } from '../sim/world/World';
import { TOUCH, touchWords } from '../ui/dom';
import { armThrow, throwAhead, throwAt } from './aim';
import { itemsUI, tools } from './context';
import { t } from '../i18n';
import { play } from './game';
import { togglePhone } from './smuggle';
import { armDrink, disarmDrink, drinkArmed, press, targets } from './reach';

/**
 * Dig up pressed (U or its button): a strike up through the floor overhead, waiting for the
 * arm to come back from the last one; held, it strikes on (see stepSim). Underground with
 * nothing overhead to dig through, it says so.
 */
export function upPress() {
  const game = play.game;
  if (!game || game.paused) return;
  if (!targets.up) {
    tools.releaseUp();
    if (game.rec.sim.state.layer === LAYER.UNDER) itemsUI.toast(t('toast.noDigUp'));
    return;
  }
  game.pilot.stop();
  press.upQueued = true;
}

/**
 * The tool button or Space pressed: strikes repeat while it's held (sent with each step, see
 * frame()); eating happens once. With no tool target, a plain USE still lets the sim say why
 * nothing happens (a sock against a wall).
 */
export function usePress() {
  const game = play.game;
  if (!game || game.paused) return;
  game.pilot.stop();
  // The burner phone's button opens its panel (P21).
  if (press.toolNow?.call) {
    tools.release();
    togglePhone(!TOUCH);
    return;
  }
  // A firecracker's button throws it (P14): aimed on touch, straight ahead on a keyboard.
  if (press.toolNow?.toss) {
    tools.release();
    // (P19: to a dog, straight there.)
    // (Greyed: the dog has had its jerky today; said, not thrown.)
    if ((press.toolNow.tossTo ?? -1) >= 0 && !press.toolNow.fits) itemsUI.toast(t('toast.dogFull', { dog: press.toolNow.what }));
    else if ((press.toolNow.tossTo ?? -1) >= 0) throwAt(press.toolNow.tossTo!);
    else if (TOUCH) armThrow();
    else throwAhead();
    return;
  }
  // Pruno in hand (P28): the first press arms Drink ("Drink it?"), the second within DRINK_CONFIRM_MS drinks.
  if (press.toolNow?.confirm) {
    if (!drinkArmed()) {
      armDrink();
      tools.release();
      itemsUI.toast(t(touchWords() ? 'toast.drinkAgainTouch' : 'toast.drinkAgain'));
      return;
    }
    disarmDrink();
  }
  // A fresh press (arg 1): only a fresh press digs up, eats or puts things in place. It waits
  // for the arm to come back from the last strike (a quick tap is never lost).
  press.pressQueued = true;
  press.heldOn = press.toolKey;
  if (!press.toolNow?.repeat) tools.release();
}
