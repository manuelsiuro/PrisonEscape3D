/**
 * A pretend gamepad in the dev build (2.45), for trying the pad's play in a browser with none plugged in:
 *
 *   const pad = await import('/scripts/dev/fakepad.ts');
 *   pad.install('xbox');             // or 'ps', 'nintendo': the labels the texts show
 *   await pad.press(pad.B.A);        // a press and its let-go
 *   pad.hold(pad.B.RT); pad.stick('right', 0, 1); await pad.wait(300); pad.stick('right', 0, 0); pad.release(pad.B.RT);
 *   pad.stick('left', 1, 0);         // walking right until set back to 0, 0
 *
 * It replaces navigator.getGamepads with one standard-mapping pad the game reads each frame (play/pad.ts).
 */
import { BTN } from '../../src/input/pad';

export const B = BTN;

const IDS = {
  xbox: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
  ps: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
  nintendo: 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)',
};

type Button = { pressed: boolean; value: number; touched: boolean };
const pad = {
  id: IDS.xbox,
  index: 0,
  connected: true,
  mapping: 'standard',
  timestamp: 0,
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, (): Button => ({ pressed: false, value: 0, touched: false })),
  rumbles: [] as { ms: number; strong: number; weak: number }[],
  vibrationActuator: {
    playEffect(_type: string, p: { duration: number; strongMagnitude: number; weakMagnitude: number }) {
      pad.rumbles.push({ ms: p.duration, strong: p.strongMagnitude, weak: p.weakMagnitude });
      return Promise.resolve('complete');
    },
  },
};

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The pretend pad plugged in, of this maker. */
export function install(kind: keyof typeof IDS = 'xbox') {
  pad.id = IDS[kind];
  pad.connected = true;
  (navigator as unknown as { getGamepads: () => unknown[] }).getGamepads = () => [pad];
}
/** Unplugged. */
export function unplug() {
  pad.connected = false;
}

export function hold(b: number) {
  pad.buttons[b].pressed = true;
  pad.buttons[b].value = 1;
}
export function release(b: number) {
  pad.buttons[b].pressed = false;
  pad.buttons[b].value = 0;
}
/** A press: held a few frames, then let go (and a few frames for the game to see it). */
export async function press(b: number, ms = 90) {
  hold(b);
  await wait(ms);
  release(b);
  await wait(140);
}
/** A stick at (x, y), -1..1 (screen up is −y), until set again. */
export function stick(which: 'left' | 'right', x: number, y: number) {
  const k = which === 'left' ? 0 : 2;
  pad.axes[k] = x;
  pad.axes[k + 1] = y;
}
/** The rumbles asked of it since the last call. */
export function rumbles() {
  return pad.rumbles.splice(0);
}
