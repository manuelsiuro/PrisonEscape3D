/**
 * The names of keys on this player's keyboard. The game reads physical keys (`e.code`:
 * the key where W is on a QWERTY keyboard moves up everywhere), so on an AZERTY keyboard
 * that key is labelled Z. Texts write a key as `%KeyW%` (or `%Space%`) and get the label printed
 * on the key the player has bound to that action (session 9: input/bindings.ts).
 *
 * Chrome tells the layout (navigator.keyboard); elsewhere a French (France, Belgium)
 * browser is taken to mean AZERTY.
 */
import { boundKey } from '../input/bindings';

const labels = new Map<string, string>();
/** Keys named in words, in the language shown (set by setLang). */
const names = new Map<string, string>([['Space', 'Space']]);

const AZERTY: Record<string, string> = { KeyQ: 'A', KeyW: 'Z', KeyA: 'Q', KeyZ: 'W', KeyM: ',', Semicolon: 'M' };
if (/^fr(-(fr|be|lu|mc))?$/i.test(globalThis.navigator?.language ?? '')) for (const [k, v] of Object.entries(AZERTY)) labels.set(k, v);
/** A sign's key on a US keyboard, where the layout can't be read. */
const SIGNS: Record<string, string> = {
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  IntlBackslash: '<',
};

type LayoutMap = { get(code: string): string | undefined; forEach(f: (key: string, code: string) => void): void };
const keyboard = (globalThis.navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<LayoutMap> } } | undefined)?.keyboard;
// The keyboard's own labels, where the browser can tell (AZERTY and the like).
keyboard
  ?.getLayoutMap?.()
  .then((m) => {
    labels.clear();
    m.forEach((key, code) => {
      if (key.trim()) labels.set(code, key.toUpperCase());
    });
  })
  .catch(() => {});

/** The words for the keys named in words (the language's). */
export function setKeyNames(n: Record<string, string>) {
  for (const [k, v] of Object.entries(n)) names.set(k, v);
}

/** The label on a key itself ('KeyW' → 'W', or 'Z' on AZERTY). */
export const rawKeyLabel = (code: string) =>
  // (A digit by its number: an AZERTY keyboard prints & é " on them, and the game reads them as 1 2 3.)
  code.startsWith('Digit')
    ? code.slice(5)
    : (names.get(code) ?? labels.get(code) ?? (code.startsWith('Key') ? code.slice(3) : (SIGNS[code] ?? code)));

/** The label on the key the player uses for the action whose default key is this one ('KeyE' → 'E', or the key moved to). */
export const keyLabel = (code: string) => rawKeyLabel(boundKey(code));

/** Fills `%KeyW%` and `%Space%` placeholders with the player's keys, as labelled on this keyboard. */
export const withKeys = (s: string) => (s.includes('%') ? s.replace(/%(Key[A-Z]|Space)%/g, (_, c: string) => keyLabel(c)) : s);
