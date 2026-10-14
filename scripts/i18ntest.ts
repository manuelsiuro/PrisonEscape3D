/** Translations: French covers every English key with the same {holes}; every zone, routine block, item and prison has a name. */
import { PRISONS } from '../src/content/prisons';
import { ZONES } from '../src/content/zones';
import { ROUTINE } from '../src/content/routine';
import { ITEMS } from '../src/content/items';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const keys = Object.keys(en) as (keyof typeof en)[];
const missing = keys.filter((k) => fr[k] === undefined);
const badHoles = keys.filter((k) => fr[k] !== undefined && holes(fr[k]!) !== holes(en[k]));
const extra = Object.keys(fr).filter((k) => !(k in en));
const names = [...ZONES.map((z) => `zone.${z}`), ...ROUTINE.map((r) => `routine.${r.id}`), ...ITEMS.map((d) => `item.${d.id}`), ...PRISONS.map((p) => `prison.${p.id}`)].filter((k) => !(k in en));
const problems = [
  missing.length ? `missing in fr: ${missing.join(', ')}` : '',
  badHoles.length ? `holes differ: ${badHoles.join(', ')}` : '',
  extra.length ? `unknown keys in fr: ${extra.join(', ')}` : '',
  names.length ? `names without a key: ${names.join(', ')}` : '',
].filter(Boolean);
if (problems.length) throw new Error(problems.join('\n'));
console.log(`${keys.length} keys, all in French with the same holes`);
console.log(`${ZONES.length} zones, ${ROUTINE.length} routine blocks, ${ITEMS.length} items and ${PRISONS.length} prisons named`);
