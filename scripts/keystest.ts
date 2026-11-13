/**
 * Session 9 (v2.35.0): the player's keys and the interface's size. The binding table (input/bindings.ts):
 * a key moved acts as its action's default everywhere, the default it left does nothing, two actions swap,
 * the keys the game keeps are refused, stored keys are checked. The texts: every key is written as a
 * placeholder (`%KeyE%`, `%Space%`), so it shows the player's key, in both languages alike. The scale's cap
 * (game/settings.ts fitScale): the page never laid out under 300 across.
 */
import { readFileSync } from 'node:fs';
import { check } from './assert';
import { ACTIONS, boundKey, clean, keyCode, keyFor, rebind, reserved, setBindings, type Bindings } from '../src/input/bindings';
import { keyLabel, withKeys } from '../src/i18n/keys';
import { fitScale, SCALE_FLOOR, UI_SCALES } from '../src/game/settings';

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// The table: one key each, none shared, none kept by the game.
const defaults = ACTIONS.map((a) => a.key);
check(new Set(defaults).size === defaults.length, 'two actions share a default key');
check(new Set(ACTIONS.map((a) => a.id)).size === ACTIONS.length, 'two actions share an id');
for (const a of ACTIONS) check(reserved(a.key) === '', `${a.id}'s default ${a.key} is a key the game keeps`);

// The defaults: every key as itself.
setBindings({});
for (const k of [...defaults, 'Escape', 'Digit1', 'ArrowUp', 'KeyL', 'KeyK'])
  check(keyCode(k) === k, `default keys: ${k} reads as ${keyCode(k)}`);
check(withKeys('%KeyE% · %Space%') === 'E · Space', `default labels: ${withKeys('%KeyE% · %Space%')}`);

// One action moved: its new key acts as its default, the old one does nothing, the texts follow.
let b: Bindings = rebind({}, 'act', 'KeyK').bindings;
check(eq(b, { act: 'KeyK' }), `act on K: ${JSON.stringify(b)}`);
setBindings(b);
check(keyCode('KeyK') === 'KeyE', 'K pressed should act (read as E)');
check(keyCode('KeyE') === '', 'E, given away, should do nothing');
check(boundKey('KeyE') === 'KeyK' && keyFor('act') === 'KeyK', 'the action button should name K');
check(keyLabel('KeyE') === 'K', `the label for the action: ${keyLabel('KeyE')}`);
check(withKeys('%KeyE% to climb out') === 'K to climb out', `a text: ${withKeys('%KeyE% to climb out')}`);
// (The minigames' keys and the arrows are untouched.)
for (const k of ['Digit1', 'Enter', 'KeyL', 'KeyX', 'ArrowLeft', 'Escape']) check(keyCode(k) === k, `${k} should stay itself`);

// A swap: the tool's key given to the action, the tool takes E.
const sw = rebind({}, 'act', 'Space');
check(sw.swapped === 'use' && eq(sw.bindings, { act: 'Space', use: 'KeyE' }), `act on Space: ${JSON.stringify(sw)}`);
setBindings(sw.bindings);
check(keyCode('Space') === 'KeyE' && keyCode('KeyE') === 'Space', 'swapped keys should read as each other');
check(withKeys('%Space% hits, %KeyE% opens') === 'E hits, Space opens', `swapped texts: ${withKeys('%Space% hits, %KeyE% opens')}`);
// Moved back: nothing stored.
check(eq(rebind(sw.bindings, 'act', 'KeyE').bindings, {}), 'putting the keys back should store nothing');
// The walking keys move too (Controls and the training's left and right read them).
setBindings(rebind({}, 'left', 'KeyK').bindings);
check(keyCode('KeyK') === 'KeyA' && keyCode('KeyA') === '', 'walking left on K');
// (On J, the day card's: the day card takes A.)
setBindings(rebind({}, 'left', 'KeyJ').bindings);
check(keyCode('KeyJ') === 'KeyA' && keyCode('KeyA') === 'KeyJ', 'walking left on J, the day card on A');

// The keys the game keeps, and keys that aren't for playing.
for (const k of ['Escape', 'Enter', 'Tab', 'Backspace', 'ArrowUp', 'Digit1', 'Digit0', 'Numpad5', 'KeyL', 'KeyX'])
  check(reserved(k) === 'kept', `${k} should be kept by the game (${reserved(k)})`);
for (const k of ['ShiftLeft', 'ControlLeft', 'AltLeft', 'MetaLeft', 'F1', 'CapsLock'])
  check(reserved(k) === 'other', `${k} should be refused (${reserved(k)})`);
for (const k of ['KeyK', 'Space', 'Semicolon', 'Comma', 'BracketLeft', 'Quote']) check(reserved(k) === '', `${k} should be free to use`);

// Stored keys, checked (a hand-edited or old save).
check(eq(clean(null), {}) && eq(clean([]), {}) && eq(clean('x'), {}), 'junk should load as no changes');
check(
  eq(clean({ act: 'KeyK', nope: 'KeyZ', lock: 'Escape', drop: 7 }), { act: 'KeyK' }),
  'unknown actions, kept keys and non-strings dropped',
);
check(eq(clean({ act: 'KeyK', lock: 'KeyK' }), {}), 'two actions on one key should put every key back');
check(eq(clean({ act: 'KeyW' }), {}), 'an action on another default (W, still walking up) should put every key back');
check(eq(clean({ act: 'KeyE' }), {}), 'an action on its own default stores nothing');
// (2.35: a set stored before the block, with V given to dropping: the block takes Q, dropping's default, nothing lost.)
check(
  eq(clean({ drop: 'KeyV', throwAhead: 'KeyK' }), { drop: 'KeyV', throwAhead: 'KeyK', block: 'KeyQ' }),
  `a key stored before the block, on V: ${JSON.stringify(clean({ drop: 'KeyV', throwAhead: 'KeyK' }))}`,
);
setBindings({});

// The texts: no key written in words (it would not follow the player's keys), the same keys in both languages.
const table = (file: string) => {
  const out = new Map<string, string>();
  for (const m of readFileSync(file, 'utf8').matchAll(/^ {2}"([^"]+)": "((?:[^"\\]|\\.)*)",?$/gm)) out.set(m[1], m[2]);
  return out;
};
const en = table('src/i18n/en.ts');
const fr = table('src/i18n/fr.ts');
// (The key's own name, the Keys card's words, and a replay's controls, which are fixed.)
const NAMING = /^(key\.space|keys\.|settings\.scale|help\.replay\.)/;
let placeholders = 0;
for (const [lang, t, word] of [
  ['en', en, /(?<![%\w])Space\b/],
  ['fr', fr, /(?<![%\w])Espace\b/],
] as const)
  for (const [k, v] of t) {
    if (NAMING.test(k)) continue;
    check(!word.test(v), `${lang} ${k} writes the space bar in words: "${v.slice(0, 80)}"`);
    for (const m of v.matchAll(/%([A-Za-z0-9]+)%/g))
      check(
        // (2.45: Escape too, and a pad's own buttons in the words written for a pad: Pad twins, the gamepad's topic.)
        /^(Key[A-Z]|Space|Escape)$/.test(m[1]) ||
          ((k.endsWith('Pad') || k.startsWith('help.gamepad.')) && /^Pad(A|B|X|Y|LB|RB|LT|RT|VIEW|MENU|L3|R3)$/.test(m[1])),
        `${lang} ${k}: unknown key %${m[1]}%`,
      );
  }
for (const [k, v] of en) {
  const keys = (s: string) => [...s.matchAll(/%(Key[A-Z]|Space|Escape|Pad[A-Z0-9]+)%/g)].map((m) => m[1]).sort();
  placeholders += keys(v).length;
  const f = fr.get(k);
  if (f !== undefined) check(eq(keys(v), keys(f)), `${k}: English names ${keys(v).join(' ')}, French ${keys(f).join(' ')}`);
}

// The interface's size: the pick on a big enough screen, capped by the short side, never under 100%.
const fits: Array<[number, number, number, number]> = [
  [1.3, 412, 915, 1.3],
  [1.3, 915, 412, 1.3],
  [1.3, 360, 641, 1.2],
  [1.15, 360, 641, 1.15],
  [1.3, 780, 360, 1.2],
  [1.3, 697, 274, 1],
  [1.3, 1366, 1024, 1.3],
  [1, 412, 915, 1],
  // (The window times a single-precision scale: 360 read as 359.99998 must not drop a step.)
  [1.3, 359.99998, 780.0001, 1.2],
];
for (const [want, w, h, got] of fits)
  check(fitScale(want, w, h) === got, `${Math.round(want * 100)}% at ${w}×${h}: ${fitScale(want, w, h)}, not ${got}`);
for (const s of UI_SCALES)
  for (const [w, h] of [
    [320, 568],
    [360, 640],
    [412, 915],
    [640, 360],
    [780, 360],
  ]) {
    const f = fitScale(s, w, h);
    check(f >= 1 && f <= s && Math.min(w, h) / f >= SCALE_FLOOR - 0.01, `${s} at ${w}×${h} lays out under ${SCALE_FLOOR}: ${f}`);
  }

console.log(`${ACTIONS.length} actions with a key of their own (${ACTIONS.filter((a) => a.group === 'move').length} to walk)`);
// (Not the texts' count: every new line of text would move the snapshot.)
console.log(
  `keys in the texts: every one the player's (${placeholders > 100 ? 'over 100' : placeholders}), the same in English and French`,
);
console.log(`interface sizes ${UI_SCALES.map((s) => `${Math.round(s * 100)}%`).join(', ')}, never laid out under ${SCALE_FLOOR} across`);
