// Dev tool: the documents' part of a release, once `npm run released` has seen it live
// (2026-11-06). Run: npm run docs:released. For the version in package.json it
//   - drops "not released yet" from its history entry (docs/history/) and its line in HISTORY.md;
//   - sets PLAN.md §8's status line to today and this version;
//   - restamps the map viewer (npm run maps: its pages carry the version);
// then lists what changed and the commit to make. It commits nothing itself.
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
const files = [...readdirSync('docs/history').map((f) => `docs/history/${f}`), 'docs/HISTORY.md'];
let marked = 0;
for (const f of files) {
  const before = readFileSync(f, 'utf8');
  const after = before.replaceAll(`v${version}, not released yet`, `v${version}`);
  if (after !== before) {
    writeFileSync(f, after);
    marked++;
  }
}
const plan = readFileSync('docs/PLAN.md', 'utf8');
const status = /\*\*Status \(\d{4}-\d{2}-\d{2}\): v[\d.]+\.\*\*/;
if (!status.test(plan)) throw new Error('PLAN.md §8: no "**Status (YYYY-MM-DD): vX.Y.Z.**" line to update');
writeFileSync('docs/PLAN.md', plan.replace(status, `**Status (${today}): v${version}.**`));
execSync('npm run maps', { stdio: 'ignore' });

const title = readFileSync('docs/HISTORY.md', 'utf8')
  .split('\n')
  .find((l) => l.startsWith('- ') && l.includes(`v${version}`))
  ?.replace(/^- /, '')
  .replace(/ \(v[\d.]+\)$/, '');
console.log(marked ? `v${version}: marked released in ${marked} file(s)` : `v${version}: no "not released yet" found (already marked?)`);
console.log(`PLAN.md §8: Status (${today}): v${version}`);
console.log(execSync('git status --short', { encoding: 'utf8' }).trim() || '(nothing changed)');
console.log(`\nThen: git add docs assets/maps && git commit -m "Docs: ${version} released${title ? ` (${title.charAt(0).toLowerCase()}${title.slice(1)})` : ''}, the map viewer at this version" && git push`);
