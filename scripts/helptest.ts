/**
 * How to play (P37): every topic's words are there in both languages, in the same shape (as many
 * steps, chips and lines in French as in English); every item, recipe, icon, lesson, prison and
 * topic it names exists; every picture is in public/help/. Prints how the guide reads: how many
 * words on each page before the fine print, against the old paragraphs.
 */
import { existsSync, statSync } from 'node:fs';
import { RECIPES } from '../src/content/recipes';
import { ITEM } from '../src/content/items';
import { PRISONS } from '../src/content/prisons';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';
import { LESSONS } from '../src/tutorial/lessons';
import { hasIcon } from '../src/ui/icons';
import { ALL_TOPICS, HELP, POCKET_SAMPLE } from '../src/ui/screens/helpTopics';

const E = en as Record<string, string>;
const F = fr as Partial<Record<string, string>>;
const problems: string[] = [];
const bad = (s: string) => problems.push(s);
const lines = (s: string | undefined) => (s ? s.split('\n').filter(Boolean) : []);

const PARTS = ['hook', 'sum', 'steps', 'sh', 'list', 'lh', 'list2', 'lh2', 'nums', 'tip', 'warn', 'more', 'meter', 'tl', 'bars', 'dh'];
const PAIRS = ['nums', 'meter', 'tl', 'bars'];
const DIAGRAM_PART: Record<string, string> = { meter: 'meter', timeline: 'tl', bars: 'bars' };

const item = (id: string, where: string) => {
  if (!ITEM[id]) bad(`${where}: no item ${id}`);
};
const iconOrItem = (name: string, where: string) =>
  name.startsWith('item:') ? item(name.slice(5), where) : name.startsWith('dot:') ? /^dot:#[0-9a-f]{6}$/.test(name) || bad(`${where}: a dot ${name}`) : hasIcon(name) || bad(`${where}: no icon ${name}`);

const ids = ALL_TOPICS.map((tp) => tp.id);
if (new Set(ids).size !== ids.length) bad('a topic is listed twice');
for (const g of Object.values(HELP).flat()) if (!E[`help.group.${g.id}`]) bad(`group ${g.id}: no name`);
for (const g of ['move', 'do', 'panels', 'games']) if (!E[`help.cg.${g}`] || !F[`help.cg.${g}`]) bad(`controls group ${g}: no name`);
for (const i of [...POCKET_SAMPLE.pockets.filter(Boolean), POCKET_SAMPLE.weapon, POCKET_SAMPLE.outfit]) item(i, 'pockets');

let shaped = 0;
let pics = 0;
let oldWords = 0;
let pageWords = 0;
const words = (s: string) => (s ? s.replace(/\|/g, ' ').split(/\s+/).filter(Boolean).length : 0);
const rows: string[] = [];
for (const tp of ALL_TOPICS) {
  const k = (p: string) => `help.${tp.id}.${p}`;
  if (!E[`help.${tp.id}.t`]) bad(`${tp.id}: no title`);
  if (!E[k('hook')]) bad(`${tp.id}: no tile line`);
  if (!hasIcon(tp.icon)) bad(`${tp.id}: no icon ${tp.icon}`);
  if (tp.prison && !PRISONS.some((p) => p.id === tp.prison)) bad(`${tp.id}: no prison ${tp.prison}`);
  for (const l of tp.lessons ?? []) if (!LESSONS.some((x) => x.id === l)) bad(`${tp.id}: no lesson ${l}`);
  for (const s of tp.see ?? []) if (!ids.includes(s) || s === tp.id) bad(`${tp.id}: sees ${s}`);
  for (const r of tp.recipes ?? []) if (!RECIPES.some((x) => x.result === r)) bad(`${tp.id}: no recipe for ${r}`);
  for (const i of tp.stepIcons ?? []) iconOrItem(i, tp.id);
  for (const i of tp.listIcons ?? []) iconOrItem(i, tp.id);
  for (const i of tp.list2Icons ?? []) iconOrItem(i, tp.id);
  // Its parts: in French too, with as many lines; pairs as "value|what".
  for (const p of PARTS) {
    const e = E[k(p)];
    const f = F[k(p)];
    if (e === undefined) continue;
    if (f === undefined) bad(`${k(p)}: not in French`);
    else if (lines(e).length !== lines(f).length) bad(`${k(p)}: ${lines(e).length} lines in English, ${lines(f).length} in French`);
    if (PAIRS.includes(p)) for (const l of [...lines(e), ...lines(f)]) if (l.split('|').length !== 2 || l.split('|').some((x) => !x.trim())) bad(`${k(p)}: "${l}" isn't "value|what"`);
  }
  for (const p of ['bars']) for (const l of lines(E[k(p)])) if (!/^\d+$/.test(l.split('|')[0])) bad(`${k(p)}: "${l}" needs a whole number`);
  for (const l of lines(E[k('meter')])) if (!/^\d+%$/.test(l.split('|')[0])) bad(`${k('meter')}: "${l}" needs a percentage`);
  if (tp.diagram && DIAGRAM_PART[tp.diagram] && !E[k(DIAGRAM_PART[tp.diagram])]) bad(`${tp.id}: its ${tp.diagram} has no lines`);
  if (tp.stepIcons && tp.stepIcons.length !== lines(E[k('steps')]).length) bad(`${tp.id}: ${tp.stepIcons.length} step icons for ${lines(E[k('steps')]).length} steps`);
  if (tp.listIcons && tp.listIcons.length !== lines(E[k('list')]).length) bad(`${tp.id}: ${tp.listIcons.length} list icons for ${lines(E[k('list')]).length} lines`);
  if (E[k('list2')] && !E[k('lh2')]) bad(`${tp.id}: a second list with no heading`);
  if (tp.list2Icons && tp.list2Icons.length !== lines(E[k('list2')]).length) bad(`${tp.id}: ${tp.list2Icons.length} icons for ${lines(E[k('list2')]).length} lines of its second list`);
  if (tp.pic) {
    const f = `public/help/${tp.id}.webp`;
    if (!existsSync(f)) bad(`${tp.id}: no picture ${f}`);
    else if (statSync(f).size > 120_000) bad(`${f}: ${Math.round(statSync(f).size / 1000)} kB, over 120`);
    pics++;
  }
  const isShaped = !!E[k('sum')];
  if (isShaped) {
    shaped++;
    if (E[`help.${tp.id}`] !== undefined) bad(`${tp.id}: the old paragraph is still there`);
    const shown = ['sum', 'steps', 'list', 'list2', 'nums', 'tip', 'warn'].reduce((n, p) => n + words(E[k(p)] ?? ''), 0);
    pageWords += shown;
    rows.push(`  ${tp.id.padEnd(10)} ${String(shown).padStart(3)} words on the page, ${String(words(E[k('more')] ?? '')).padStart(3)} folded; ${lines(E[k('steps')]).length} steps, ${lines(E[k('nums')]).length} chips${tp.diagram ? `, ${tp.diagram}` : ''}${tp.recipes ? `, ${tp.recipes.length} recipes` : ''}${tp.lessons ? `, ${tp.lessons.length} lessons` : ''}`);
  } else if (!E[`help.${tp.id}`]) bad(`${tp.id}: neither a summary nor a paragraph`);
  else oldWords += words(E[`help.${tp.id}`]);
}
// No words left over for a topic that isn't there.
for (const key of Object.keys(E)) {
  const m = /^help\.(\w+)\.(\w+)$/.exec(key);
  if (m && PARTS.includes(m[2]) && !ids.includes(m[1])) bad(`${key}: no such topic`);
}
if (problems.length) throw new Error(problems.join('\n'));
console.log(`${ALL_TOPICS.length} topics in ${Object.values(HELP).flat().length} groups: ${shaped} laid out as pages (${pageWords} words before the fine print), ${ALL_TOPICS.length - shaped} still a paragraph (${oldWords} words); ${pics} pictures`);
console.log('every part in French with as many lines; every item, recipe, icon, lesson, prison and picture there');
console.log(rows.join('\n'));
