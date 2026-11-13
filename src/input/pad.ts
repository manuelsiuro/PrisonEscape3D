/**
 * A gamepad, read (2.45): the browser's standard mapping turned into what the game wants, with no DOM
 * here (the play layer, `play/pad.ts`, drives the page with it). One pad at a time: the one last touched.
 *
 * The standard mapping (w3.org/TR/gamepad): buttons by their place, not their label. The bottom face
 * button is 0 on every pad; an Xbox pad calls it A, a PlayStation one ✕, a Nintendo one B. So the
 * layout is fixed by place, and only the labels follow the pad (`padKind`).
 */

/** The buttons, by their place in the standard mapping (named as on an Xbox pad). */
export const BTN = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8,
  MENU: 9,
  L3: 10,
  R3: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;
export type Btn = (typeof BTN)[keyof typeof BTN];
const BUTTONS = 16;

/** Whose labels the pad wears. */
export type PadKind = 'xbox' | 'ps' | 'nintendo' | '8bitdo';
/** The kinds, in the settings' order (2.45: the player may pick the labels, `Settings.padButtons`). */
export const PAD_KINDS: readonly PadKind[] = ['xbox', 'ps', 'nintendo', '8bitdo'];

/** The maker, from the pad's id (the browser gives the name and, often, the USB vendor: Sony 054c, Nintendo 057e). */
export function padKind(id: string): PadKind {
  // (8BitDo's own name or USB vendor, 2dc8, first: its Super Nintendo-style pads say so in D-input; in X-input
  // they pass for an Xbox pad, and in Switch mode for a Pro Controller, so the settings can pick the labels.)
  if (/8bitdo|2dc8/i.test(id)) return '8bitdo';
  // (Microsoft's first: its pads are called "Xbox Wireless Controller", Sony's "Wireless Controller".)
  if (/xbox|045e/i.test(id)) return 'xbox';
  if (/054c|playstation|dualsense|dualshock/i.test(id)) return 'ps';
  if (/057e|nintendo|pro controller|joy-con/i.test(id)) return 'nintendo';
  return 'xbox';
}

/** Each button's label, by place, on each kind of pad. */
const LABELS: Record<PadKind, readonly string[]> = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', '↑', '↓', '←', '→'],
  ps: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', '↑', '↓', '←', '→'],
  // (A Nintendo pad's face buttons, by place: B at the bottom, A on the right, Y on the left, X on top.)
  nintendo: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'LS', 'RS', '↑', '↓', '←', '→'],
  // (8BitDo's Super Nintendo layout, as on the SF30 Pro: B at the bottom, A on the right; its shoulders L2 and R2.)
  '8bitdo': ['B', 'A', 'Y', 'X', 'L', 'R', 'L2', 'R2', 'Select', 'Start', 'LS', 'RS', '↑', '↓', '←', '→'],
};
export const btnLabel = (kind: PadKind, b: Btn) => LABELS[kind][b];

/** A stick inside this (of its full throw) is at rest; past it, what's left is spread over 0–1. */
export const STICK_DEAD = 0.25;
/** A trigger counts as pressed past this. */
const TRIGGER_ON = 0.5;
/** A stick pushed this far (after the dead zone) is a press of the arrow it points to (menus, minigames). */
export const STICK_PRESS = 0.6;
/** ... and let go of below this (so a stick held on the line doesn't flicker). */
const STICK_RELEASE = 0.4;

/** A stick's position with the dead zone taken off: (0, 0) at rest, length up to 1. */
export function stick(x: number, y: number): { x: number; y: number } {
  const len = Math.hypot(x, y);
  if (!(len > STICK_DEAD)) return { x: 0, y: 0 };
  const k = Math.min(1, (len - STICK_DEAD) / (1 - STICK_DEAD)) / len;
  return { x: x * k, y: y * k };
}

/** The arrow a stick points to, as a press with a little give ('' at rest or between). */
export function stickArrow(x: number, y: number, held: '' | 'up' | 'down' | 'left' | 'right'): '' | 'up' | 'down' | 'left' | 'right' {
  const len = Math.hypot(x, y);
  if (held && len >= STICK_RELEASE) {
    // Held: kept while the stick stays roughly that way (within 60° of it).
    const [hx, hy] = held === 'up' ? [0, -1] : held === 'down' ? [0, 1] : held === 'left' ? [-1, 0] : [1, 0];
    if ((x * hx + y * hy) / len > 0.5) return held;
  }
  if (len < STICK_PRESS) return '';
  return Math.abs(x) > Math.abs(y) ? (x < 0 ? 'left' : 'right') : y < 0 ? 'up' : 'down';
}

/** What the pad says this frame: the buttons held, those pressed and let go since the last, the sticks. */
export interface PadFrame {
  kind: PadKind;
  held: boolean[];
  down: Btn[];
  up: Btn[];
  /** Sticks, the dead zone taken off (screen up is −y). */
  left: { x: number; y: number };
  right: { x: number; y: number };
  /** Anything pressed or pushed this frame (the pad is the device in use). */
  touched: boolean;
}

/** The subset of the browser's Gamepad the game reads (tests feed their own). */
export interface PadLike {
  readonly id: string;
  readonly connected: boolean;
  readonly mapping: string;
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
  readonly axes: readonly number[];
}

const pressedOf = (p: PadLike, b: number) => {
  const x = p.buttons[b];
  if (!x) return false;
  return b === BTN.LT || b === BTN.RT ? x.pressed && x.value > TRIGGER_ON : x.pressed || x.value > TRIGGER_ON;
};
/** Touched enough to be followed: a button, or a stick pushed well past drift (a pad left on the desk with a worn stick never takes over). */
const TAKE_OVER = 0.5;
const busy = (p: PadLike) => {
  for (let b = 0; b < BUTTONS; b++) if (pressedOf(p, b)) return true;
  return Math.hypot(p.axes[0] ?? 0, p.axes[1] ?? 0) > TAKE_OVER || Math.hypot(p.axes[2] ?? 0, p.axes[3] ?? 0) > TAKE_OVER;
};

/**
 * Reads the pads each frame. One pad is followed: the last one touched (a second pad left on the
 * desk with a drifting stick doesn't steal the game). Pads without the standard mapping are left
 * out: their buttons mean nothing known.
 */
export class PadReader {
  private index = -1;
  private held: boolean[] = new Array<boolean>(BUTTONS).fill(false);
  /** The next read takes what's held as it is, with no presses: a pad just chosen, or the page back in sight. */
  private fresh = true;

  /** Whether a usable pad is plugged in. */
  connected = false;

  read(pads: readonly (PadLike | null)[]): PadFrame | null {
    const ok = (p: PadLike | null | undefined): p is PadLike => !!p && p.connected && p.mapping === 'standard';
    let chosen = false;
    // The pad touched now, if it isn't the one followed.
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (i !== this.index && ok(p) && busy(p)) {
        this.index = i;
        this.fresh = true;
        chosen = true;
        break;
      }
    }
    let pad = pads[this.index];
    if (!ok(pad)) {
      this.index = pads.findIndex(ok);
      this.fresh = true;
      pad = pads[this.index];
    }
    this.connected = ok(pad);
    if (!ok(pad)) return null;
    const now: boolean[] = [];
    for (let b = 0; b < BUTTONS; b++) now.push(pressedOf(pad, b));
    if (this.fresh) {
      // (The pad just chosen, or the page back: a button down now was pressed before; it's ignored until let go.)
      this.ignore = now.slice();
      this.held.fill(false);
      this.fresh = false;
    }
    const down: Btn[] = [];
    const up: Btn[] = [];
    for (let b = 0; b < BUTTONS; b++) {
      if (this.ignore[b]) {
        if (now[b]) now[b] = false;
        else this.ignore[b] = false;
      }
      if (now[b] && !this.held[b]) down.push(b as Btn);
      if (!now[b] && this.held[b]) up.push(b as Btn);
    }
    this.held = now;
    const left = stick(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    const right = stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
    const moved = left.x !== 0 || left.y !== 0 || right.x !== 0 || right.y !== 0;
    return { kind: padKind(pad.id), held: now, down, up, left, right, touched: chosen || down.length > 0 || moved };
  }

  /** Buttons held when the pad was chosen (or the page came back): not seen until let go. */
  private ignore: boolean[] = new Array<boolean>(BUTTONS).fill(false);

  /** Forget what's held (the page hidden): a button still down then is ignored until let go. */
  reset() {
    this.fresh = true;
  }
}

// ------------------------------------------------------------------ choosing with the D-pad

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export type Way = 'up' | 'down' | 'left' | 'right';

/**
 * The box to move to from `from`, going `way` (-1: none that way). The nearest one ahead wins, and a
 * box in line with this one (sharing some of its width going up or down, its height going sideways)
 * beats one off to the side: a row of buttons is walked along, not jumped out of.
 */
export function nextBox(from: Box, boxes: readonly Box[], way: Way): number {
  const cx = (from.left + from.right) / 2;
  const cy = (from.top + from.bottom) / 2;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b === from) continue;
    const bx = (b.left + b.right) / 2;
    const by = (b.top + b.bottom) / 2;
    // Ahead: its centre past this one's (a pixel's give), and not behind its own edge.
    let ahead: number;
    let side: number;
    let inLine: boolean;
    if (way === 'up' || way === 'down') {
      ahead = way === 'up' ? cy - by : by - cy;
      if (ahead <= 1) continue;
      side = Math.abs(bx - cx);
      inLine = b.left < from.right && b.right > from.left;
    } else {
      ahead = way === 'left' ? cx - bx : bx - cx;
      if (ahead <= 1) continue;
      side = Math.abs(by - cy);
      inLine = b.top < from.bottom && b.bottom > from.top;
    }
    const score = (inLine ? 0 : 100000) + ahead + 2 * side;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}
