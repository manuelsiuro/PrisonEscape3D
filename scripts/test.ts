/**
 * Runs the headless test scripts in parallel and prints a summary.
 *
 *   npm test               every test
 *   npm test -- level ghost  only tests whose name contains "level" or "ghost"
 *   npm test -- -v         also print the output of passing tests
 *   npm test -- -u         accept the current outputs as the new snapshots
 *
 * A test is any scripts/*test*.ts (or listed in EXTRA) that exits non-zero on failure.
 * The physics is deterministic, so each test's output is also compared with its golden
 * copy in scripts/snapshots/: any drift in trajectories, scores or timings fails the run.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const EXTRA: string[] = [];
const args = process.argv.slice(2);
const verbose = args.includes('-v');
const update = args.includes('-u');
const snapDir = join(here, 'snapshots');
const filters = args.filter((a) => !a.startsWith('-'));

const tests = readdirSync(here)
  .filter((f) => f.endsWith('.ts') && f !== 'test.ts' && (f.includes('test') || EXTRA.includes(f)))
  .filter((f) => filters.length === 0 || filters.some((q) => f.includes(q)))
  .sort();

if (tests.length === 0) {
  console.error(`No tests match ${filters.join(', ')}`);
  process.exit(1);
}

interface Result { name: string; ok: boolean; ms: number; out: string; note?: string }

/** Compares stdout with the golden copy; returns a short diff note, or undefined when it matches. */
function compareSnapshot(name: string, stdout: string): string | undefined {
  const file = join(snapDir, name.replace(/\.ts$/, '.txt'));
  if (update || !existsSync(file)) {
    mkdirSync(snapDir, { recursive: true });
    writeFileSync(file, stdout);
    return undefined;
  }
  const want = readFileSync(file, 'utf8').split('\n');
  const got = stdout.split('\n');
  for (let i = 0; i < Math.max(want.length, got.length); i++) {
    if (want[i] !== got[i]) return `output differs from snapshot at line ${i + 1}:\n  - ${want[i] ?? '(none)'}\n  + ${got[i] ?? '(none)'}\n(run \`npm test -- -u\` if the change is intended)`;
  }
  return undefined;
}

function run(name: string): Promise<Result> {
  const t0 = Date.now();
  return new Promise((done) => {
    const child = spawn(process.execPath, ['--import', 'tsx', join(here, name)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let stdout = '';
    child.stdout.on('data', (d) => {
      out += d;
      stdout += d;
    });
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => {
      const note = code === 0 ? compareSnapshot(name, stdout) : undefined;
      done({ name, ok: code === 0 && !note, ms: Date.now() - t0, out, note });
    });
  });
}

const queue = [...tests];
const results: Result[] = [];
const workers = Array.from({ length: Math.min(availableParallelism(), queue.length) }, async () => {
  for (let name = queue.shift(); name; name = queue.shift()) {
    const r = await run(name);
    results.push(r);
    console.log(`${r.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name.padEnd(18)} ${(r.ms / 1000).toFixed(1)}s`);
  }
});
await Promise.all(workers);

const failed = results.filter((r) => !r.ok);
for (const r of verbose ? results : failed) {
  const body = r.note ?? r.out.trimEnd().split('\n').slice(-60).join('\n');
  console.log(`\n\x1b[1m── ${r.name} ${r.ok ? 'output' : 'FAILED'} ──\x1b[0m\n${body}`);
  // On GitHub Actions, failures also show as annotations on the run page.
  if (!r.ok && process.env.GITHUB_ACTIONS) console.log(`::error title=${r.name} failed::${body.split('\n').slice(0, 12).join('%0A')}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed${update ? ' (snapshots updated)' : ''}`);
process.exit(failed.length ? 1 : 0);
