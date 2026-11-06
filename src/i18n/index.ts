import { en, type Strings } from './en';
import type { Barks } from './barks/en';
import { withKeys } from './keys';

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
}

export const currentLang = () => lang;

export function t(key: Key, vars: Record<string, string | number> = {}): string {
  const s = TABLES[lang]?.[key] ?? en[key];
  return withKeys(s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)));
}

/** A text mid-sentence: its first letter in lower case ("Bringing you a tube of glue"). */
export const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** A list in a sentence: "6, 8 and 4" ("6, 8 et 4"). */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return t('list.and', { a: items.slice(0, -1).join(', '), b: items[items.length - 1] });
}
