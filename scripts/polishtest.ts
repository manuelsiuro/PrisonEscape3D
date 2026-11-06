/**
 * What a polish pass tends to forget, checked so that it can't: lessons that start where a player
 * can move and that How to play leads to, pictures that can be retaken, rule changes gated for old
 * logs and written down, and docs/POLISH.md, the record of what's been done. (Everything else on
 * the list is the polish-gameplay skill's: it needs eyes.)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { TRAINING } from '../src/content/prisons/training';
import { Sim } from '../src/sim/Sim';
import { prepareReplay, RunRecorder, type RunLog } from '../src/sim/runlog';
import { MAP_W } from '../src/sim/world/World';
import { LESSONS } from '../src/tutorial/lessons';
import { ALL_TOPICS } from '../src/ui/screens/helpTopics';
import { check } from './assert';

// ------------------------------------------------------------------ the lessons
let started = 0;
LESSONS.forEach((lesson, k) => {
  // (A manhunt lesson is played outside, from its own start.)
  if (lesson.hunt) return;
  const sim = new Sim(lesson.prison ?? TRAINING, lesson.seed ?? 7 + k);
  lesson.setup(sim);
  const p = sim.state.player;
  const tile = Math.floor(p.z / 1024) * MAP_W + Math.floor(p.x / 1024);
  check(!sim.world.routeGrid(sim.state.layer)[tile], `${lesson.id}: it starts where a player can move (${tile % MAP_W},${Math.floor(tile / MAP_W)})`);
  started++;
});
console.log(`${started} lessons start on open floor`);

const taught = new Set(ALL_TOPICS.flatMap((t) => t.lessons ?? []));
const unlinked = LESSONS.filter((l) => !taught.has(l.id)).map((l) => l.id);
check(!unlinked.length, `How to play leads to every lesson (not: ${unlinked.join(', ')})`);
console.log(`${LESSONS.length} lessons, each linked from How to play`);

// ------------------------------------------------------------------ the pictures
const shots = readFileSync('scripts/dev/helpshot.ts', 'utf8');
const pictured = ALL_TOPICS.filter((t) => t.pic);
// (The manhunt's is played outside, where helpshot's scenes don't go: taken by hand, from __manhunt() in the dev build.)
const BY_HAND = new Set(['manhunt']);
const noRecipe = pictured.filter((t) => !BY_HAND.has(t.id) && !new RegExp(`^\\s+'?${t.id}'?: \\{`, 'm').test(shots)).map((t) => t.id);
check(!noRecipe.length, `every picture can be retaken: a SHOTS entry in helpshot.ts (not: ${noRecipe.join(', ')})`);
console.log(`${pictured.length} pictures, each with its recipe`);

// ------------------------------------------------------------------ rule changes
const num = (v: string) => v.split('.').reduce((sum, x) => sum * 1000 + Number(x), 0);
const flags = Object.keys(new Sim(CENTER_PERKS, 1)).filter((k) => /^rules\d+$/.test(k));
/** The plan, with its decisions and phases, and the history: each split into files (2026-11-06). */
const docs = (...dirs: string[]) => dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.md')).map((f) => readFileSync(`${d}/${f}`, 'utf8'))).join('\n');
const plan = readFileSync('docs/PLAN.md', 'utf8') + docs('docs/decisions', 'docs/phases');
/** The version a flag is named for: rules224, played under 2.24 or before; but rules250, under 2.5.0. */
const version = (flag: string) => (flag === 'rules250' ? [2, 5, 0] : [Number(flag[5]), Number(flag.slice(6)), 0]);
const log = (game: string): RunLog => ({ v: 1, prison: CENTER_PERKS.id, seed: 1, game, from: 0, steps: 0, data: '', sums: [] });
for (const flag of flags) {
  check(plan.includes(`Sim.${flag}`), `${flag}: written down in the plan (PLAN.md, docs/decisions/, docs/phases/)`);
  const [a, b, c] = version(flag);
  const set = prepareReplay(log(`${a}.${b}.${c}`), CENTER_PERKS);
  check(!!set && (set.sim as unknown as Record<string, boolean>)[flag] === true, `${flag}: a log from ${a}.${b}.${c} replays under it`);
}
const latest = [...flags].sort((a, b) => num(version(a).join('.')) - num(version(b).join('.'))).at(-1)!;
const [ma, mi] = version(latest);
const old = new RunRecorder(new Sim(CENTER_PERKS, 1), { seed: 1, game: `${ma}.${mi}.0` });
old.step(0);
check(new RunRecorder(old.sim, { log: old.toLog(), game: `${ma}.${mi + 1}.0` }).toLog().seed === -1, `a log from before ${latest}'s change isn't carried on under it`);
const now = new RunRecorder(new Sim(CENTER_PERKS, 1), { seed: 1, game: `${ma}.${mi + 1}.0` });
now.step(0);
check(prepareReplay(now.toLog(), CENTER_PERKS)!.sim[latest as 'rules224'] === false, `a log from ${ma}.${mi + 1}.0 plays by today's rules`);
console.log(`rule flags: ${flags.join(', ')}; each gated and written down`);

// ------------------------------------------------------------------ the record
check(existsSync('docs/POLISH.md'), 'docs/POLISH.md is there');
const history = docs('docs/history');
const index = readFileSync('docs/HISTORY.md', 'utf8');
const release = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
const rows = readFileSync('docs/POLISH.md', 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('|') && !l.startsWith('|---') && !l.startsWith('| Area'))
  .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
const count: Record<string, number> = {};
const areas = new Set<string>();
for (const [area, ver, state, choices] of rows) {
  check(!areas.has(area), `POLISH: ${area} is listed once`);
  areas.add(area);
  count[state] = (count[state] ?? 0) + 1;
  check(['Done', 'Partly', 'Not reviewed'].includes(state), `POLISH: ${area}'s state (${state})`);
  if (state === 'Not reviewed') {
    check(!ver && !choices, `POLISH: ${area} isn't reviewed, yet has a version or choices`);
    continue;
  }
  // (Ahead of the game only while the work waits for its release, its history entry saying so: tests go green before the version is bumped.)
  check(/^\d+\.\d+\.\d+$/.test(ver) && (num(ver) <= num(release) || history.includes(`v${ver}, not released yet`)), `POLISH: ${area}'s version (${ver}, the game's at ${release})`);
  check(history.includes(`v${ver}`) && index.includes(`v${ver}`), `POLISH: ${area}'s v${ver} is in docs/history/ and HISTORY.md's index`);
  check(!!choices, `POLISH: ${area} says what the user chose`);
}
console.log(`docs/POLISH.md: ${rows.length} areas, ${Object.entries(count).map(([k, n]) => `${n} ${k}`).join(', ')}`);
