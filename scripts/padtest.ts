/**
 * Gamepads (2.45): the pad read (input/pad.ts): which pad is followed, presses and let-goes as edges,
 * a button held when a pad is chosen never sent, the sticks' dead zone, a stick as an arrow with give,
 * the makers' labels, and the D-pad's choice of the next button on a card.
 */
import { check } from './assert';
import { padLabels, padLabelsShown, setPadLabels, setPadPick } from '../src/input/bindings';
import { withKeys } from '../src/i18n/keys';
import {
  BTN,
  btnLabel,
  nextBox,
  PAD_KINDS,
  PadReader,
  padKind,
  stick,
  stickArrow,
  STICK_DEAD,
  type Box,
  type PadLike,
} from '../src/input/pad';

const lines: string[] = [];
const say = (s: string) => lines.push(s);

/** A pad with these buttons down and these axes. */
function pad(id: string, down: number[] = [], axes: number[] = [0, 0, 0, 0], mapping = 'standard', connected = true): PadLike {
  return {
    id,
    connected,
    mapping,
    axes,
    buttons: Array.from({ length: 17 }, (_, b) => {
      const on = down.includes(b);
      return { pressed: on, value: on ? 1 : 0 };
    }),
  };
}

// ------------------------------------------------------------------ makers
const ids: [string, string][] = [
  ['Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', 'xbox'],
  ['DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', 'ps'],
  ['054c-09cc-Wireless Controller', 'ps'],
  ['Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)', 'nintendo'],
  ['Logitech Gamepad F310 (STANDARD GAMEPAD Vendor: 046d Product: c21d)', 'xbox'],
  // (A generic pad calling itself "Wireless Controller", not Sony's: Xbox's labels, the usual ones.)
  // (8BitDo by name or vendor, 2dc8: its Super Nintendo-style labels; a generic "Wireless Controller", Xbox's.)
  ['8BitDo SF30 Pro (STANDARD GAMEPAD Vendor: 2dc8 Product: 6100)', '8bitdo'],
  ['2dc8-6100-8BitDo SF30 Pro', '8bitdo'],
  ['Wireless Controller (STANDARD GAMEPAD Vendor: 1234 Product: 3106)', 'xbox'],
];
for (const [id, kind] of ids) check(padKind(id) === kind, `${id}: ${padKind(id)}, not ${kind}`);
say(`makers: ${ids.map(([id]) => padKind(id)).join(' ')}`);
say(
  `the bottom button: ${PAD_KINDS.map((k) => btnLabel(k, BTN.A)).join(' ')}; the right: ${PAD_KINDS.map((k) => btnLabel(k, BTN.B)).join(' ')}`,
);

// ------------------------------------------------------------------ presses
const r = new PadReader();
const xbox = 'Xbox Wireless Controller (STANDARD GAMEPAD)';
check(r.read([]) === null && !r.connected, 'no pad: nothing');
check(r.read([pad('odd', [0], undefined, '')]) === null, 'a pad without the standard mapping is left out');
// A held when the pad is first seen: not a press, and its let-go isn't either.
let f = r.read([pad(xbox, [BTN.A])])!;
check(f.down.length === 0 && !f.held[BTN.A], `a button held as the pad is found should be ignored: ${f.down}`);
f = r.read([pad(xbox)])!;
check(f.up.length === 0, 'its let-go should not be sent');
f = r.read([pad(xbox, [BTN.A, BTN.UP])])!;
check(f.down.join() === `${BTN.A},${BTN.UP}` && f.touched, `presses: ${f.down}`);
f = r.read([pad(xbox, [BTN.A, BTN.UP])])!;
check(f.down.length === 0 && f.held[BTN.A], 'held is not pressed again');
f = r.read([pad(xbox, [BTN.UP])])!;
check(f.up.join() === `${BTN.A}`, `let go: ${f.up}`);
// A trigger counts past half its travel.
const lt = pad(xbox);
(lt.buttons as { pressed: boolean; value: number }[])[BTN.LT] = { pressed: true, value: 0.3 };
f = r.read([lt])!;
check(!f.held[BTN.LT], 'a trigger touched lightly is not pressed');
// A second pad: followed once touched; what chose it isn't sent.
const ps = 'DualSense Wireless Controller (054c)';
f = r.read([pad(xbox), pad(ps, [BTN.X])])!;
check(f.kind === 'ps' && f.down.length === 0 && f.touched, `the second pad touched is followed, its press not sent: ${f.kind} ${f.down}`);
f = r.read([pad(xbox, [], [0.9, 0, 0, 0]), pad(ps)])!;
check(f.kind === 'xbox', 'a stick pushed on the first one takes it back');
// A second pad's stick drifting (0.3, past the dead zone): it never takes over.
f = r.read([pad(xbox), pad(ps, [], [0.3, 0.1, 0, 0])])!;
check(f.kind === 'xbox', 'a drifting stick on the other pad takes nothing over');
// Unplugged: the other one.
f = r.read([null, pad(ps)])!;
check(f.kind === 'ps', 'the pad left after one is unplugged is followed');
// The page hidden and back with a button held: not a press.
r.reset();
f = r.read([null, pad(ps, [BTN.B])])!;
check(f.down.length === 0, 'a button held as the page comes back is ignored');
say('presses: edges only; a pad found or chosen, or the page back: what is held waits to be let go; a drifting pad never takes over');

// ------------------------------------------------------------------ sticks
const s0 = stick(STICK_DEAD * 0.9, 0);
check(s0.x === 0 && s0.y === 0, 'inside the dead zone: at rest');
const s1 = stick(1, 0);
check(Math.abs(s1.x - 1) < 1e-9, `full throw: ${s1.x}`);
const s2 = stick(0, -(STICK_DEAD + (1 - STICK_DEAD) / 2));
check(Math.abs(s2.y + 0.5) < 1e-9, `half way past the dead zone is half: ${s2.y}`);
check(stickArrow(0.7, 0.1, '') === 'right' && stickArrow(0.3, 0, '') === '', 'a stick pushed past 0.6 is an arrow, not before');
check(stickArrow(0.45, 0.1, 'right') === 'right' && stickArrow(0.35, 0, 'right') === '', 'held, it lets go below 0.4');
check(stickArrow(0.5, 0.5, 'right') === 'right' && stickArrow(0.1, 0.7, 'right') === 'down', 'held, it turns only past 60°');
say('sticks: dead zone 0.25, an arrow past 0.6, let go under 0.4');

// ------------------------------------------------------------------ the D-pad on a card
const bx = (left: number, top: number, w = 80, h = 30): Box => ({ left, top, right: left + w, bottom: top + h });
// Two rows: three small buttons, then Back and Go.
const card = [bx(0, 0), bx(100, 0), bx(200, 0), bx(0, 60, 130), bx(150, 60, 130)];
const walk = (from: number, way: 'up' | 'down' | 'left' | 'right') => nextBox(card[from], card, way);
check(walk(0, 'right') === 1 && walk(1, 'right') === 2 && walk(2, 'right') === -1, 'along a row, and none past its end');
check(walk(1, 'left') === 0, 'back along it');
check(walk(0, 'down') === 3 && walk(2, 'down') === 4, `down to what is under: ${walk(0, 'down')} ${walk(2, 'down')}`);
check(walk(1, 'down') === 3 || walk(1, 'down') === 4, 'down from the middle: one under it');
check(walk(4, 'up') === 2 && walk(3, 'up') === 0, `up to what is over it: ${walk(4, 'up')} ${walk(3, 'up')}`);
check(walk(3, 'right') === 4, 'along the second row');
// A column with a button far off to the side and a nearer one lower down in line: in line wins.
const col = [bx(0, 0), bx(300, 40), bx(0, 200)];
check(nextBox(col[0], col, 'down') === 2, 'down: in line beats nearer off to the side');
say('the D-pad: rows walked along, down and up to what is in line');

// ------------------------------------------------------------------ the texts name the pad's buttons
const text = '%KeyE% %Space% %KeyR% %KeyV% %KeyF% %KeyQ% %KeyU% %KeyC% %KeyW% %Escape% %PadLB% %PadRT%';
// (The keyboard's labels follow its layout, AZERTY or not: only keys the same on both are checked.)
check(withKeys('%KeyE% %Space% %Escape%') === 'E Space Esc', `the keyboard's: ${withKeys('%KeyE% %Space% %Escape%')}`);
const labelled: string[] = [];
for (const kind of PAD_KINDS) {
  setPadLabels(kind);
  labelled.push(`${kind}: ${withKeys(text)}`);
  check(withKeys('%KeyE% %Escape%', true) === 'E Esc', 'the keyboard asked for (the Keys list): its keys');
}
setPadLabels(null);
check(withKeys('%KeyE%') === 'E', 'put down: the keys again');
// The player's pick (Settings, Gamepad buttons): an 8BitDo in X-input mode passes for an Xbox pad.
setPadPick('8bitdo');
check(padLabels() === null && padLabelsShown() === '8bitdo', 'picked, with no pad in hand: the keys in texts, the pick in How to play');
setPadLabels('xbox');
check(padLabels() === '8bitdo' && withKeys('%KeyE% %KeyF%') === 'B R2', `picked over what the pad says: ${withKeys('%KeyE% %KeyF%')}`);
setPadPick(null);
check(padLabels() === 'xbox', 'Auto: as the pad says');
setPadLabels(null);
say('the pick (Settings, Gamepad buttons) wins over what the pad says; How to play shows it with no pad in hand');
say(`texts (${text.replace(/%/g, '')}):`);
for (const l of labelled) say(`  ${l}`);

console.log(lines.join('\n'));
