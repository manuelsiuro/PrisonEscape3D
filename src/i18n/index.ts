import { en, type Strings } from './en';
import { fr } from './fr';
import { withKeys } from './keys';

/**
 * Translations. `t('key', { n: 3 })` looks the key up in the current language (falling back
 * to English) and fills `{n}`-style holes. The language follows the browser unless the
 * player picked one.
 * Every piece of text the player reads goes through here, from the first screen on.
 */
export type Lang = 'en' | 'fr';
export type Key = keyof Strings;

const TABLES: Record<Lang, Partial<Strings>> = { en, fr };
let lang: Lang = 'en';

const detectLang = (): Lang => (navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en');

export function setLang(l: Lang | 'auto') {
  // An unknown stored value falls back to the browser's language.
  lang = l === 'en' || l === 'fr' ? l : detectLang();
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

/** A list in a sentence: "6, 8 and 4" ("6, 8 et 4"). */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return t('list.and', { a: items.slice(0, -1).join(', '), b: items[items.length - 1] });
}
