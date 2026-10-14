import { KEY } from './tiles';

/**
 * Whether a door of this color is open for inmates right now. P0: yellow doors (cells, gym,
 * showers…) stand open, every other color stays shut. The routine (cells locked at Lights
 * Out, lockdowns) and keys arrive in P1 and P5.
 */
export function doorOpen(key: number, _minuteOfDay: number): boolean {
  return key === KEY.YELLOW;
}
