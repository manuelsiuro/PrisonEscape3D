/** Translations: French covers every English key with the same {holes}; every zone, routine block, item and prison has a name. */
import { PRISONS } from '../src/content/prisons';
import { ZONES } from '../src/content/zones';
import { ROUTINE } from '../src/content/routine';
import { ITEMS } from '../src/content/items';
import { JOBS } from '../src/content/jobs';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const keys = Object.keys(en) as (keyof typeof en)[];
const missing = keys.filter((k) => fr[k] === undefined);
const badHoles = keys.filter((k) => fr[k] !== undefined && holes(fr[k]!) !== holes(en[k]));
const extra = Object.keys(fr).filter((k) => !(k in en));
const names = [...ZONES.map((z) => `zone.${z}`), ...ROUTINE.map((r) => `routine.${r.id}`), ...ITEMS.map((d) => `item.${d.id}`), ...PRISONS.map((p) => `prison.${p.id}`), ...Object.keys(JOBS).flatMap((j) => [`job.${j}`, `jobTask.${j}`])].filter((k) => !(k in en));
// Achievement names are unique in each language (two trophies must never read alike).
const achNames = (dict: Partial<Record<string, string>>) => {
  const seen = new Map<string, string>();
  const dup: string[] = [];
  for (const [k, v] of Object.entries(dict)) {
    if (!/^ach\.\w+$/.test(k) || v === undefined) continue;
    const other = seen.get(v);
    if (other) dup.push(`${other} = ${k} (${v})`);
    else seen.set(v, k);
  }
  return dup;
};
const dupAch = [...achNames(en).map((d) => `en ${d}`), ...achNames(fr).map((d) => `fr ${d}`)];
// A lesson step naming a key (%KeyX%) has a *Touch twin for phones.
const keyNoTouch = keys.filter((k) => k.startsWith('lesson.') && /%\w+%/.test(en[k]) && !(`${k}Touch` in en));
const problems = [
  missing.length ? `missing in fr: ${missing.join(', ')}` : '',
  badHoles.length ? `holes differ: ${badHoles.join(', ')}` : '',
  extra.length ? `unknown keys in fr: ${extra.join(', ')}` : '',
  names.length ? `names without a key: ${names.join(', ')}` : '',
  dupAch.length ? `achievements sharing a name: ${dupAch.join('; ')}` : '',
  keyNoTouch.length ? `lesson steps with a key and no Touch twin: ${keyNoTouch.join(', ')}` : '',
].filter(Boolean);
if (problems.length) throw new Error(problems.join('\n'));
console.log(`${keys.length} keys, all in French with the same holes`);
console.log('achievement names unique in each language; every lesson step with a key has a touch twin');
console.log(`${ZONES.length} zones, ${ROUTINE.length} routine blocks, ${ITEMS.length} items, ${Object.keys(JOBS).length} jobs and ${PRISONS.length} prisons named`);
