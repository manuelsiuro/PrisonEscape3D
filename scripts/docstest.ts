/**
 * The documents kept in shape (2026-11-06, the user's request after the split): what a rule in the
 * `docs-upkeep` skill asks, checked here, since a rule alone gets skipped.
 * - Every relative link resolves (the docs, the README, CLAUDE.md, the skills).
 * - Every file in docs/decisions/, docs/phases/ and docs/history/ is listed where it's looked for.
 * - HISTORY.md's index has one line per entry of docs/history/, in order, with its title; the
 *   latest file is the range of the game's version (v2.40-v2.49.md from 2.40).
 * - No "not released yet" left behind once its version is out.
 * - Each file within its size, so that one question means one small read; entries written from
 *   2.35 on wrapped (no line over 300 characters), a POLISH row from 2.35 on short.
 * - The counts written in PLAN.md §8, FEATURES.md and the README are the game's.
 * - BACKLOG.md's areas not polished yet are POLISH.md's.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { PRISONS, escapesOf } from '../src/content/prisons';
import { ITEMS } from '../src/content/items';
import { RECIPES } from '../src/content/recipes';
import { ACHIEVEMENTS } from '../src/content/achievements';
import { COSMETICS } from '../src/content/prisoner';
import { CHAPTERS } from '../src/tutorial/lessons';
import { en } from '../src/i18n/en';
import { ALL_TOPICS } from '../src/ui/screens/helpTopics';
import { check } from './assert';

const read = (f: string) => readFileSync(f, 'utf8');
const mdIn = (dir: string): string[] =>
  readdirSync(dir)
    .sort()
    .flatMap((f) => (statSync(join(dir, f)).isDirectory() ? mdIn(join(dir, f)) : f.endsWith('.md') ? [join(dir, f)] : []));
const version = JSON.parse(read('package.json')).version as string;
const num = (v: string) => v.split('.').reduce((sum, x) => sum * 1000 + Number(x), 0);

// ------------------------------------------------------------------ links
const pages = [...mdIn('docs'), 'README.md', 'CLAUDE.md', ...mdIn('.claude/skills')];
let links = 0;
for (const f of pages) {
  for (const m of read(f).matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
    if (/^(https?:|mailto:)/.test(m[1])) continue;
    links++;
    check(existsSync(normalize(join(dirname(f), m[1]))), `${f}: the link to ${m[1]} leads somewhere`);
  }
}
console.log(links > 0 ? 'every link in the docs, the README, CLAUDE.md and the skills leads somewhere' : 'no links read');

// ------------------------------------------------------------------ every file listed
const plan = read('docs/PLAN.md');
const index = read('docs/HISTORY.md');
for (const f of mdIn('docs/decisions')) check(plan.includes(`(${f.slice(5)})`), `${f} is listed in PLAN.md §2`);
for (const f of mdIn('docs/phases')) check(plan.includes(`(${f.slice(5)})`), `${f} is listed in PLAN.md §4`);
const ranges = mdIn('docs/history');
for (const f of ranges) check(index.includes(`(${f.slice(5)})`), `${f} is listed in HISTORY.md`);

// ------------------------------------------------------------------ the history and its index
const entries = ranges.flatMap((f) =>
  read(f)
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => ({ f, l })),
);
const lines = index.split('\n').filter((l) => l.startsWith('- '));
check(entries.length === lines.length, `HISTORY.md: a line for each of the ${entries.length} entries (${lines.length})`);
const titleOf = (l: string) => l.match(/^- \*\*(.+?)\*\*/)?.[1] ?? l.slice(2);
entries.forEach((e, k) => {
  const t = titleOf(e.l);
  const want = t.length <= 110 ? t : t.slice(0, 107);
  check(!!lines[k] && lines[k].startsWith(`- ${want}`), `HISTORY.md line ${k + 1} is "${want.slice(0, 50)}" (${e.f})`);
});
// The game's version in the latest range: a file per ten minor versions, per five from 2.35 (when
// v2.30-v2.39 reached its 80 KB and was split in two).
const [maj, min] = version.split('.').map(Number);
const span = maj > 2 || min >= 35 ? 5 : 10;
const lo = Math.floor(min / span) * span;
const latest = `docs/history/v${maj}.${lo}-v${maj}.${lo + span - 1}.md`;
check(ranges.at(-1) === latest || ranges.includes(latest), `the history of ${version} goes in ${latest}`);
// A "not released yet" may stand only for the version being released.
for (const f of [...ranges, 'docs/HISTORY.md', 'docs/POLISH.md']) {
  for (const m of read(f).matchAll(/v(\d+\.\d+\.\d+), not released yet/g)) {
    check(num(m[1]) >= num(version), `${f}: v${m[1]} is out (the game is at ${version}), yet "not released yet"`);
  }
}
console.log('every history entry has its line in HISTORY.md, in order; the version in its range; no release left "not released yet"');

// ------------------------------------------------------------------ sizes and shape
const KB = 1024;
const BUDGET: Array<[RegExp, number]> = [
  [/^CLAUDE\.md$/, 10 * KB],
  [/^docs\/README\.md$/, 8 * KB],
  [/^docs\/HISTORY\.md$/, 24 * KB],
  [/^docs\/PLAN\.md$/, 30 * KB],
  [/^docs\/POLISH\.md$/, 40 * KB],
  [/^docs\/decisions\//, 40 * KB],
  [/^docs\/history\//, 80 * KB],
  [/^docs\/phases\//, 60 * KB],
];
for (const f of mdIn('docs').concat('CLAUDE.md')) {
  const budget = BUDGET.find(([re]) => re.test(f))?.[1];
  if (!budget) continue;
  const size = Buffer.byteLength(read(f));
  check(size <= budget, `${f}: ${Math.round(size / KB)} KB, over its ${budget / KB} KB (split it, or say less: the docs-upkeep skill)`);
}
// From 2.35 on: entries wrapped, POLISH rows short (the detail lives in the history).
const SINCE = num('2.35.0');
for (const f of ranges) {
  let current = '0.0.0';
  for (const l of read(f).split('\n')) {
    if (l.startsWith('- ')) current = l.match(/v(\d+\.\d+\.\d+)/)?.[1] ?? '0.0.0';
    if (num(current) >= SINCE) check(l.length <= 300, `${f}: a line of v${current} is ${l.length} characters (wrap at 300)`);
  }
}
for (const l of read('docs/POLISH.md')
  .split('\n')
  .filter((r) => r.startsWith('| ') && !r.startsWith('| Area'))) {
  const cells = l.split('|').map((c) => c.trim());
  if (/^\d+\.\d+\.\d+$/.test(cells[2]) && num(cells[2]) >= SINCE) {
    check(
      l.length <= 1500,
      `POLISH.md: ${cells[1]}'s row is ${l.length} characters (1,500 at most: choices and limits, the rest in the history)`,
    );
  }
}
console.log('every file within its size; entries from 2.35 on wrapped');

// ------------------------------------------------------------------ the counts written down
const leaves = (o: unknown): number => (typeof o === 'object' && o ? Object.values(o).reduce((n: number, v) => n + leaves(v), 0) : 1);
const tests = readdirSync('scripts').filter((f) => f.endsWith('.ts') && f.includes('test') && f !== 'test.ts').length;
const COUNT = {
  'ways out': PRISONS.reduce((n, p) => n + escapesOf(p).length, 0),
  items: ITEMS.length,
  recipes: RECIPES.length,
  achievements: ACHIEVEMENTS.length,
  cosmetics: COSMETICS.length,
  lessons: CHAPTERS.reduce((n, c) => n + c.lessons.length, 0),
  chapters: CHAPTERS.length,
  'help topics': ALL_TOPICS.length,
  'text keys': leaves(en),
  'test scripts': tests,
};
const WRITTEN: Array<[string, RegExp, keyof typeof COUNT]> = [
  ['docs/PLAN.md', /(\d+) ways out/, 'ways out'],
  ['docs/PLAN.md', /(\d+) items/, 'items'],
  ['docs/PLAN.md', /(\d+) recipes/, 'recipes'],
  ['docs/PLAN.md', /(\d+) achievements/, 'achievements'],
  ['docs/PLAN.md', /(\d+) lessons in \d+ chapters/, 'lessons'],
  ['docs/PLAN.md', /\d+ lessons in (\d+) chapters/, 'chapters'],
  ['docs/PLAN.md', /(\d+) help topics/, 'help topics'],
  ['docs/PLAN.md', /([\d,]+) text keys/, 'text keys'],
  ['docs/PLAN.md', /(\d+) test scripts/, 'test scripts'],
  ['docs/FEATURES.md', /(\d+) playable lessons/, 'lessons'],
  ['docs/FEATURES.md', /lessons in (\d+) chapters/, 'chapters'],
  ['docs/FEATURES.md', /(\d+) How to play topics/, 'help topics'],
  ['docs/FEATURES.md', /(\d+) achievements/, 'achievements'],
  ['docs/FEATURES.md', /(\d+) cosmetics/, 'cosmetics'],
  ['docs/FEATURES.md', /\(([\d,]+) text keys\)/, 'text keys'],
  ['README.md', /### (\d+) ways out/, 'ways out'],
  ['README.md', /(\d+) items to find/, 'items'],
  ['README.md', /<b>(\d+) achievements<\/b>/, 'achievements'],
  ['README.md', /The (\d+) lessons/, 'lessons'],
  ['docs/FEATURES.md', /(\d+) automated test scripts/, 'test scripts'],
  ['README.md', /(\d+) test scripts/, 'test scripts'],
];
for (const [f, re, what] of WRITTEN) {
  const m = read(f).match(re);
  check(!!m, `${f} gives the number of ${what}`);
  if (m) check(Number(m[1].replace(/,/g, '')) === COUNT[what], `${f}: ${m[1]} ${what}, the game has ${COUNT[what]}`);
}
console.log("the counts in PLAN.md, FEATURES.md and the README are the game's");

// The code's size, as FEATURES.md and the README give it: a rough figure, so within a twentieth of the real one
// (it isn't bumped every commit, only when it drifts that far).
const tsFiles = (dir: string) =>
  (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).map((f) => join(dir, f));
const linesIn = (files: string[]) => files.reduce((n, f) => n + (readFileSync(f, 'utf8').match(/\n/g)?.length ?? 0), 0);
const SIZE: Array<[string, RegExp, number]> = [
  ['docs/FEATURES.md', /About ([\d,]+) lines of TypeScript/, linesIn(tsFiles('src'))],
  ['README.md', /About ([\d,]+) lines of TypeScript/, linesIn(tsFiles('src'))],
  ['README.md', /in (\d+) files \(formatted/, tsFiles('src').length],
  ['README.md', /and ([\d,]+) more in the tests and tools/, linesIn(tsFiles('scripts'))],
];
for (const [f, re, real] of SIZE) {
  const m = read(f).match(re);
  check(!!m, `${f} gives the code's size (${re.source})`);
  if (m) {
    const said = Number(m[1].replace(/,/g, ''));
    check(Math.abs(said - real) <= real / 20, `${f}: ${m[1]} (${re.source}), the code has ${real}`);
  }
}
console.log("the code's size in FEATURES.md and the README within a twentieth of the real one");

// ------------------------------------------------------------------ the backlog
// Its first table is POLISH.md's areas not done (Not reviewed, Partly): one list, kept in step.
const notDone = read('docs/POLISH.md')
  .split('\n')
  .filter((l) => l.startsWith('| ') && !l.startsWith('| Area'))
  .map((l) => l.split('|').map((c) => c.trim()))
  .filter((c) => c[3] === 'Not reviewed' || c[3] === 'Partly')
  .map((c) => `${c[1]} | ${c[3]}`)
  .sort();
const backlog = read('docs/BACKLOG.md');
const first = backlog.slice(backlog.indexOf('## 1.'), backlog.indexOf('## 2.'));
const listed = first
  .split('\n')
  .filter((l) => l.startsWith('| ') && !l.startsWith('| Area'))
  .map((l) => l.split('|').map((c) => c.trim()))
  .map((c) => `${c[1]} | ${c[2]}`)
  .sort();
for (const a of notDone) check(listed.includes(a), `BACKLOG.md §1 lists ${a} (POLISH.md)`);
for (const a of listed) check(notDone.includes(a), `BACKLOG.md §1's ${a} is still open in POLISH.md`);
check(Buffer.byteLength(backlog) <= 16 * KB, `docs/BACKLOG.md within 16 KB`);
console.log("BACKLOG.md's areas are POLISH.md's open ones");
