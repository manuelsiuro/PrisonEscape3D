/**
 * The keys of the main actions, which the player may change (session 9, v2.34.3). The game reads
 * physical keys (`e.code`) and every handler still tests an action's default key ('KeyE' acts):
 * `keyCode` turns the key pressed into the default of the action it's bound to, once, where a key
 * comes in. So two actions swapped swap everywhere, and a default key given away does nothing.
 *
 * Kept as they are: the arrows (they always move, and steer the help, the trophies, a replay), Escape,
 * the digits (the hotbar's 1–6, the answers' 1–4), Enter, and the two letters a card of its own keeps
 * (L calls "Liar!" at the cards, X scribbles on the menu board). Texts write a key as its default
 * (`%KeyE%`, `%Space%`) and get the one bound to it (i18n/keys.ts).
 */

/** The actions, by their default key, in the order the Keys card lists them. */
export const ACTIONS = [
  { id: 'up', key: 'KeyW', group: 'move' },
  { id: 'left', key: 'KeyA', group: 'move' },
  { id: 'down', key: 'KeyS', group: 'move' },
  { id: 'right', key: 'KeyD', group: 'move' },
  { id: 'act', key: 'KeyE', group: 'do' },
  { id: 'use', key: 'Space', group: 'do' },
  { id: 'lock', key: 'KeyR', group: 'do' },
  { id: 'drop', key: 'KeyQ', group: 'do' },
  { id: 'throwAhead', key: 'KeyF', group: 'do' },
  { id: 'digUp', key: 'KeyU', group: 'do' },
  { id: 'craft', key: 'KeyC', group: 'panels' },
  { id: 'file', key: 'KeyI', group: 'panels' },
  { id: 'day', key: 'KeyJ', group: 'panels' },
  { id: 'job', key: 'KeyB', group: 'panels' },
  { id: 'rat', key: 'KeyT', group: 'panels' },
  { id: 'phone', key: 'KeyP', group: 'panels' },
  { id: 'crew', key: 'KeyG', group: 'panels' },
  { id: 'objectives', key: 'KeyO', group: 'panels' },
  { id: 'help', key: 'KeyH', group: 'panels' },
] as const;
export type Action = (typeof ACTIONS)[number]['id'];
/** The player's keys: only the actions moved off their default, by action. */
export type Bindings = Partial<Record<Action, string>>;

const DEFAULT = new Map<string, string>(ACTIONS.map((a) => [a.id, a.key]));

/** Why a key can't be given to an action ('' when it can): kept by the game, or not a key to play with. */
export function reserved(code: string): '' | 'kept' | 'other' {
  if (/^(?:Escape|Enter|NumpadEnter|Tab|Backspace|Arrow\w+|Digit\d|Numpad\w+|KeyL|KeyX|BracketRight)$/.test(code)) return 'kept';
  // Letters, the space bar and the signs beside the letters; not Shift, Ctrl, Alt, the function keys.
  if (/^(?:Key[A-Z]|Space|Semicolon|Quote|Comma|Period|Slash|BracketLeft|Backslash|Minus|Equal|Backquote|IntlBackslash)$/.test(code))
    return '';
  return 'other';
}

let keyOf = new Map(DEFAULT);
/** A key bound now → its action's default key. */
let toDefault = new Map<string, string>();
/** Default keys bound to nothing now (their action moved): they do nothing. */
let freed = new Set<string>();

/** Stored keys, checked: an unknown action or a kept key is dropped; two actions on one key put every key back. */
export function clean(raw: unknown): Bindings {
  const out: Bindings = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, code] of Object.entries(raw as Record<string, unknown>))
    if (DEFAULT.has(id) && typeof code === 'string' && !reserved(code) && code !== DEFAULT.get(id)) out[id as Action] = code;
  const used = ACTIONS.map((a) => out[a.id] ?? a.key);
  return new Set(used).size === used.length ? out : {};
}

let version = 0;
/** Counts the changes of keys: text drawn with a key's label redraws when it moves (i18n's textStamp). */
export const keysVersion = () => version;

/** The keys in play from now on. */
export function setBindings(b: Bindings) {
  const ok = clean(b);
  const before = [...keyOf.values()].join();
  keyOf = new Map(ACTIONS.map((a) => [a.id, ok[a.id] ?? a.key]));
  toDefault = new Map(ACTIONS.map((a) => [keyOf.get(a.id)!, a.key]));
  freed = new Set(ACTIONS.map((a) => a.key).filter((k) => !toDefault.has(k)));
  if ([...keyOf.values()].join() !== before) version++;
}

/** The key pressed, as the handlers know it: an action's default key, '' for a key given away, else itself. */
export function keyCode(code: string): string {
  return toDefault.get(code) ?? (freed.has(code) ? '' : code);
}

/** The key bound to the action whose default key is this one (any other key: itself). */
export function boundKey(code: string): string {
  const a = ACTIONS.find((x) => x.key === code);
  return a ? keyOf.get(a.id)! : code;
}

/** The action's key now. */
export const keyFor = (id: Action) => keyOf.get(id)!;

/**
 * The action given this key: the action that had it takes this one's old key (a swap, so no
 * action is left without one). Returns the new bindings and the action swapped with, if any.
 */
export function rebind(b: Bindings, id: Action, code: string): { bindings: Bindings; swapped?: Action } {
  const now = new Map(ACTIONS.map((a) => [a.id as Action, clean(b)[a.id] ?? a.key]));
  const old = now.get(id)!;
  const other = [...now].find(([a, k]) => a !== id && k === code)?.[0];
  now.set(id, code);
  if (other) now.set(other, old);
  const out: Bindings = {};
  for (const a of ACTIONS) if (now.get(a.id) !== a.key) out[a.id] = now.get(a.id);
  return { bindings: out, swapped: other };
}

setBindings({});
