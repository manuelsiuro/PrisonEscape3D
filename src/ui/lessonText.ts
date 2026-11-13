import type { Key } from '../i18n';
import { padLabels } from '../input/bindings';
import { TOUCH } from './dom';

/**
 * A lesson step's words for the controls in hand: the touch ones on a touch screen, else the keyboard's;
 * with a pad in hand (2.45), the keyboard's, which t() turns into their Pad twin where they have one.
 */
export function stepKey(s: { text: Key; touch?: Key }): Key {
  return !padLabels() && TOUCH && s.touch ? s.touch : s.text;
}
