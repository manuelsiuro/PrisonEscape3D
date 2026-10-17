/**
 * The run recorder (P16): commands kept as runs of varints round-trip; two days kept like a
 * model prisoner take a few kilobytes and replay to the very same state, every hourly
 * checksum matching; a game saved mid-run and loaded carries on its log, and two branches
 * from one save each replay whole; a log changed (a rules change, a damaged byte) is caught at
 * the next checksum; a game loaded from a save without a log starts one from its state;
 * logs live next to their saves and go with them.
 */
import { quietCalendar } from '../src/sim/systems/calendar';
import { check } from './assert';

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
};

const { decodeRuns, encodeRuns, fitLog, fromBase64, replayLog, RunRecorder, SUM_STEPS, toBase64 } = await import('../src/sim/runlog');
const { Sim } = await import('../src/sim/Sim');
const { CENTER_PERKS } = await import('../src/content/prisons/center-perks');
const { STALAG_FLUCHT } = await import('../src/content/prisons/stalag-flucht');
const { STEPS_PER_MINUTE } = await import('../src/sim/tuning');
const { Bot } = await import('./bots');
const { readLog, keepReplay, readReplay } = await import('../src/game/logs');
const { deleteSave, writeSave } = await import('../src/game/saves');
const { KEYS } = await import('../src/game/storage');

const DAY = 1440 * STEPS_PER_MINUTE;

// The codec: runs in, the same runs out; big commands, long runs, a cut-short tail refused.
const runs: Array<[number, number]> = [
  [0, 1],
  [13, 400],
  [(1 << 30) | 12345, 1],
  [0x7fffffff, 3],
  [5, 100000],
];
const bytes = encodeRuns(runs);
check(JSON.stringify(decodeRuns(bytes)) === JSON.stringify(runs), 'runs of commands round-trip');
check(JSON.stringify(decodeRuns(fromBase64(toBase64(bytes))!)) === JSON.stringify(runs), 'and through base64');
check(decodeRuns(bytes.subarray(0, bytes.length - 1)) === null, 'a log cut short is refused');
check(fromBase64('!!!') === null, 'garbage base64 is refused');
console.log(`codec: ${runs.length} runs in ${bytes.length} bytes`);

// Two days kept like a model prisoner, recorded as a game would be.
const seed = 4242;
const bot = new Bot(CENTER_PERKS, seed);
bot.routineUntil(3, 8 * 60);
const rec = new RunRecorder(new Sim(CENTER_PERKS, seed), { seed, game: 'test' });
const half = Math.floor(bot.cmds.length / 2);
let saved: ReturnType<typeof rec.toLog> | null = null;
let savedSnap: ReturnType<typeof rec.sim.snapshot> | null = null;
bot.cmds.forEach((cmd, k) => {
  rec.step(cmd);
  // A save halfway: the snapshot and its log, as storage would hold them.
  if (k === half - 1) {
    saved = JSON.parse(JSON.stringify(rec.toLog()));
    savedSnap = JSON.parse(JSON.stringify(rec.sim.snapshot()));
  }
});
check(rec.sim.hash() === bot.sim.hash(), 'the recorder steps the game as it was played');
const log = rec.toLog();
const days = bot.cmds.length / DAY;
const perDay = Math.round(rec.size / days);
const stored = JSON.stringify(log).length;
console.log(`two days: ${bot.cmds.length} steps, ${log.sums.length} checksums, ${rec.size} bytes of commands (${perDay} a day), ${stored} characters stored`);
check(log.sums.length === Math.floor(bot.cmds.length / SUM_STEPS), 'a checksum every game hour');
check(perDay < 16000, 'a day of play takes under 16 KB');
const back = replayLog(fitLog(JSON.parse(JSON.stringify(log)))!, CENTER_PERKS)!;
check(back.ok && back.verified === log.sums.at(-1)![0] && back.sim.hash() === bot.sim.hash(), 'the log replays to the very same state, every checksum matching');
check(replayLog(log, STALAG_FLUCHT) === null, 'a log only plays in its own prison');
{
  // A state field added by a later version (as every phase does) leaves the checksums as they were.
  const { sumOf } = await import('../src/sim/runlog');
  const before = sumOf(bot.sim);
  (bot.sim.state as unknown as Record<string, unknown>).later = [1, 2, 3];
  bot.sim.state.feats[0]++;
  check(sumOf(bot.sim) === before, 'a field added later (or the ledger) leaves the checksum alone');
  delete (bot.sim.state as unknown as Record<string, unknown>).later;
  bot.sim.state.feats[0]--;
}

// Loaded from the save, two ways on: each branch's log replays whole.
{
  const branch = (turn: number) => {
    const sim = new Sim(CENTER_PERKS, 1);
    sim.restore(savedSnap!);
    const r = new RunRecorder(sim, { log: saved, game: 'test' });
    for (let k = 0; k < 3 * SUM_STEPS; k++) r.step(k % 200 < 100 ? turn : 0);
    return r;
  };
  const a = branch(1);
  const b = branch(9);
  check(a.sim.hash() !== b.sim.hash(), 'two branches went different ways');
  const ra = replayLog(a.toLog(), CENTER_PERKS)!;
  const rb = replayLog(b.toLog(), CENTER_PERKS)!;
  check(ra.ok && ra.sim.hash() === a.sim.hash() && rb.ok && rb.sim.hash() === b.sim.hash(), 'each branch from one save replays whole');
  check(a.toLog().seed === seed && a.toLog().from === 0, 'a branch keeps the run from its start');
  console.log(`two branches from a save at day ${a.toLog().from === 0 ? 2 : '?'}: both replay (${a.toLog().steps} and ${b.toLog().steps} steps)`);
}

// A log that doesn't match (a rules change, a damaged command): caught at the next checksum.
{
  const bad = JSON.parse(JSON.stringify(log)) as typeof log;
  const raw = decodeRuns(fromBase64(bad.data)!)!;
  // One command changed a little after the 30th hour.
  let at = 0;
  const k = raw.findIndex(([, n]) => (at += n) > 30 * SUM_STEPS);
  raw[k] = [raw[k][0] === 0 ? 1 : 0, raw[k][1]];
  bad.data = toBase64(encodeRuns(raw));
  // The run changed from its first step on: the hours before it still check out.
  const from = at - raw[k][1];
  const r = replayLog(bad, CENTER_PERKS)!;
  check(!r.ok && r.verified === Math.floor(from / SUM_STEPS) * SUM_STEPS, `a changed log is caught, verified up to its last good hour (${r.verified / SUM_STEPS} h)`);
  console.log(`a run of commands changed from step ${from} (hour ${Math.floor(from / SUM_STEPS)}): verified to hour ${r.verified / SUM_STEPS}`);
}

// The end of a run checked too (the escape is there, after the last hour): a change in the last minutes is caught.
{
  const tail = JSON.parse(JSON.stringify(log)) as typeof log;
  const raw = decodeRuns(fromBase64(tail.data)!)!;
  const last = raw.length - 1;
  raw[last] = [raw[last][0] === 0 ? 5 : 0, raw[last][1]];
  tail.data = toBase64(encodeRuns(raw));
  check(log.sums.at(-1)![0] === log.from + log.steps, 'the log ends on a checksum of its last step');
  check(!replayLog(tail, CENTER_PERKS)!.ok, 'a change after the last hour is caught at the end');
  const short = { ...log, steps: log.steps + 10 };
  check(!replayLog(short, CENTER_PERKS)!.ok, 'a log that says it is longer than its commands is not whole');
}

// A save without a log (made before logs): a new log from the loaded state.
{
  const sim = new Sim(CENTER_PERKS, 1);
  sim.restore(savedSnap!);
  const r = new RunRecorder(sim, { log: null, game: 'test' });
  for (let k = 0; k < SUM_STEPS + 5; k++) r.step(0);
  const l = r.toLog();
  check(l.seed === -1 && !!l.start && l.from === savedSnap!.state.step, 'a log of its own, from the loaded state');
  check(replayLog(JSON.parse(JSON.stringify(l)), CENTER_PERKS)!.sim.hash() === sim.hash(), 'and it replays');
  // A log that doesn't end where the save does isn't carried on.
  const wrong = { ...saved!, steps: saved!.steps - 1 };
  const sim2 = new Sim(CENTER_PERKS, 1);
  sim2.restore(savedSnap!);
  check(new RunRecorder(sim2, { log: wrong, game: 'test' }).toLog().seed === -1, 'a log that ends elsewhere is not carried on');
}

// Storage: a log next to each save, gone with it; an escape's log kept.
{
  const sim = new Sim(CENTER_PERKS, 1);
  sim.restore(savedSnap!);
  check(writeSave(2, sim, 'test', [], saved) && readLog(2)?.steps === saved!.steps, 'a save writes its log next to it');
  check(writeSave(2, sim, 'test') && readLog(2) === null, 'a save without a log leaves none behind');
  writeSave(3, sim, 'test', [], saved);
  deleteSave(3);
  check(readLog(3) === null, 'deleting a save deletes its log');
  keepReplay(log, true);
  check(readReplay()?.steps === log.steps && readReplay('center-perks')?.steps === log.steps, 'an escape\'s log: the last, and the prison\'s quickest');
  keepReplay({ ...log, steps: 5 }, false);
  check(readReplay()?.steps === 5 && readReplay('center-perks')?.steps === log.steps, 'a slower escape keeps the quickest');
  // Storage full: every log and replay gives way to a save.
  const { replayBestKey } = await import('../src/game/storage');
  writeSave(1, sim, 'test', [], saved);
  // As full as it gets: the save fits only once the logs are gone.
  const logsSize = [...mem.entries()].filter(([k]) => k.startsWith('pe3d.log.') || k.startsWith('pe3d.replay.')).reduce((n, [, v]) => n + v.length, 0);
  const cap = [...mem.values()].reduce((n, v) => n + v.length, 0);
  const setItem = (globalThis as unknown as { localStorage: { setItem: (k: string, v: string) => void } }).localStorage.setItem;
  (globalThis as unknown as { localStorage: { setItem: (k: string, v: string) => void } }).localStorage.setItem = (k, v) => {
    const used = [...mem.entries()].reduce((n, [kk, vv]) => n + (kk === k ? 0 : vv.length), 0);
    if (used + v.length > cap) throw new Error('QuotaExceededError');
    mem.set(k, v);
  };
  mem.set('pe3d.other.game', 'x'.repeat(Math.max(0, logsSize - 6500)));
  check(logsSize > 7000, `logs to make room with (${logsSize})`);
  check(writeSave('auto', sim, 'test', [], saved), 'storage full: the save is written');
  check(!mem.has(KEYS.log1) && !mem.has(replayBestKey('center-perks')), 'every log and replay made room for it');
  mem.delete('pe3d.other.game');
  (globalThis as unknown as { localStorage: { setItem: (k: string, v: string) => void } }).localStorage.setItem = setItem;
  mem.set(KEYS.replayLast, '{"v":1}');
  check(readReplay() === null, 'a damaged log reads as none');
  const save = mem.get(KEYS.save2)!;
  console.log(`a save: ${save.length} characters (its log apart)`);
  check(save.length < 12 * 1024, 'a save stays under 12 KB');
}
console.log('replay ok');

// ------------------------------------------------------------------ logs from before the day (P17)
{
  // A run recorded by 1.10 (no events then): it replays whole, every day quiet as it was.
  const seed = 7;
  const old = new Sim(CENTER_PERKS, seed);
  old.state.calendar = quietCalendar();
  const r = new RunRecorder(old, { seed, game: '1.10.1' });
  for (let k = 0; k < 2 * 1440 * STEPS_PER_MINUTE + 600; k++) r.step(0);
  const log = r.toLog();
  const back = replayLog(log, CENTER_PERKS);
  check(!!back?.ok && !!back?.sim.legacy, 'a log from before the day replays whole (its days quiet, its scuffles judged as they were)');
  // Carried on in 1.11: a log of its own from the game loaded (the two rules never mix in one log).
  const carried = new RunRecorder(old, { log, game: '1.11.0' });
  check(carried.toLog().seed === -1 && carried.toLog().game === '1.11.0', 'a game from before the day starts a log of its own');
  console.log('a 1.10 log: replays whole; carried on in 1.11 as a new log');
}
