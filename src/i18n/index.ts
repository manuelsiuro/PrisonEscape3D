import { en, type Strings } from './en';
import type { Barks } from './barks/en';
import { setKeyNames, withKeys } from './keys';
import { keysVersion } from '../input/bindings';

/**
 * Translations. `t('key', { n: 3 })` looks the key up in the current language (falling back
 * to English) and fills `{n}`-style holes. The language follows the browser unless the
 * player picked one.
 * Every piece of text the player reads goes through here, from the first screen on.
 */
export type Lang = 'en' | 'fr';
export type Key = keyof Strings;

/** The languages' text: English always there, French once loaded (a file of its own, see loadLang). */
const TABLES: Partial<Record<Lang, Partial<Strings>>> = { en };
/** The speech bubbles' lines of a language other than English, once loaded. */
const BARKS: Partial<Record<Lang, Barks>> = {};
let lang: Lang = 'en';

const detectLang = (): Lang => (navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en');

/** The language a setting means (an unknown stored value falls back to the browser's language). */
export const langOf = (l: Lang | 'auto'): Lang => (l === 'en' || l === 'fr' ? l : detectLang());

/**
 * Loads a language's text (French: its own file, fetched once; the offline copy has it too). Never
 * fails: a language that can't be fetched leaves English in its place. Resolves true once it's there.
 */
export async function loadLang(l: Lang | 'auto'): Promise<boolean> {
  const want = langOf(l);
  if (TABLES[want]) return true;
  try {
    const m = await import('./french');
    TABLES.fr = m.fr;
    BARKS.fr = m.frBarks;
    return true;
  } catch {
    return false;
  }
}

/** The speech bubbles' lines in a language, if loaded (null: English's are used). */
export const barksOf = (l: Lang): Barks | null => BARKS[l] ?? null;

/** Sets the language (its text loaded first by loadLang; one that couldn't be, English in its place). */
export function setLang(l: Lang | 'auto') {
  const want = langOf(l);
  lang = TABLES[want] ? want : 'en';
  document.documentElement.lang = lang;
  // The game speaks French itself: the browser shouldn't translate it again. English pages
  // stay translatable for players of other languages.
  document.documentElement.setAttribute('translate', lang === 'en' ? 'yes' : 'no');
  setKeyNames({ Space: t('key.space') });
}

export const currentLang = () => lang;
/** Whether a key exists (a prison's own wording, looked for before the usual one). */
export const hasKey = (k: string): k is Key => k in en;
/** What text drawn earlier depends on: the language and the player's keys (session 9). A cache keyed on it redraws after either changes. */
export const textStamp = () => `${lang}:${keysVersion()}`;

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  const s = TABLES[lang]?.[key] ?? en[key];
  if (lang === 'fr') return withKeys(s.replace(FR_HOLE, (_, pre: string | undefined, k: string) => frFill(pre, String(vars[k] ?? `{${k}}`))));
  return withKeys(s.replace(/\{(\w+)\}/g, (_, k: string, at: number) => enFill(s, at, String(vars[k] ?? `{${k}}`))));
}

/**
 * 2.36 (The Six Hunter): a prison's name that comes with its article takes a small "the" after a word ("You broke out
 * of the Six Hunter", "On to the Six Hunter"); at a sentence's start, after a colon or a dot, it keeps its capital.
 * Only a prison's name (`articled`): nothing else that starts with "The".
 */
function enFill(s: string, at: number, v: string): string {
  if (at < 2 || !v.startsWith('The ') || !/\p{L} $/u.test(s.slice(at - 2, at)) || !articled('en').has(v)) return v;
  return `the ${v.slice(4)}`;
}

/** The prisons' names that come with their article ("The Six Hunter", « Les Six Veneurs »), per language: the only values contracted. */
const ARTICLED: Partial<Record<Lang, Set<string>>> = {};
function articled(l: Lang): Set<string> {
  const table = TABLES[l];
  if (!table) return new Set();
  return (ARTICLED[l] ??= new Set(
    Object.entries(table)
      .filter(([k, v]) => k.startsWith('prison.') && typeof v === 'string' && /^(The|Les) /.test(v))
      .map(([, v]) => v as string),
  ));
}

/** A hole, with the word before it when that's "de" or "à" (or any word: mid-sentence). */
const FR_HOLE = /(?:(\p{L}+) )?\{(\w+)\}/gu;

/**
 * 2.36 (The Six Hunter, "Les Six Veneurs" in French): a name that comes with its article contracts after "de" and
 * "à" ("évadé des Six Veneurs", "aux Six Veneurs") and is "les" mid-sentence ("Direction les Six Veneurs").
 */
function frFill(pre: string | undefined, v: string): string {
  if (!pre || !v.startsWith('Les ') || !articled('fr').has(v)) return pre ? `${pre} ${v}` : v;
  const rest = v.slice(4);
  const contracted = { de: 'des', à: 'aux', De: 'Des', À: 'Aux' }[pre];
  return contracted ? `${contracted} ${rest}` : `${pre} les ${rest}`;
}

/** A text mid-sentence: its first letter in lower case ("Bringing you a tube of glue"). */
export const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** A list in a sentence: "6, 8 and 4" ("6, 8 et 4"). */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return t('list.and', { a: items.slice(0, -1).join(', '), b: items[items.length - 1] });
}
