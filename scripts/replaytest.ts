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

// ------------------------------------------------------------------ the replay viewer (P25)
{
  const { scout, scoutAll, Tape, autoSpeed, highlightOf, KEY_STEPS, FINALE_STEPS, AUTO_MAX, AUTO_MIN, AUTO_QUIET } = await import('../src/replay/scout');
  const { prepareReplay, sumOf } = await import('../src/sim/runlog');
  const { PLANS, runRoute, quiet } = await import('./escapes');
  const { replayFile, replayFileName, readReplayFile, replaysKept, FILE_MAX } = await import('../src/game/replays');
  const { DEFAULT_PRISONER } = await import('../src/content/prisoner');
  quiet.on = true;

  // An escape as the game keeps it: the bot's run from its start, its way out noted.
  const plan = PLANS.find((p) => p.def === CENTER_PERKS)!;
  const tbot = runRoute(plan, 'tunnel')!;
  const tsim = new Sim(CENTER_PERKS, 1);
  tsim.restore(tbot.start!);
  const trec = new RunRecorder(tsim, { log: null, game: '2.0.0' });
  for (const c of tbot.cmds) trec.step(c);
  const esc = { ...trec.toLog(), via: 'tunnel' };
  const end = esc.from + esc.steps;

  // The scout: whole, keyframes every half hour, the finale half an hour before the end, the escape its last highlight.
  const s = scoutAll(JSON.parse(JSON.stringify(esc)), CENTER_PERKS)!;
  check(s.ok && s.end === end && s.verified === end && s.via === 'tunnel', 'the scout checks an escape whole, to its end');
  check(s.keys[0].step === esc.from && s.keys.slice(1).every((k) => k.step % KEY_STEPS === 0 && k.step <= end), 'a keyframe at the start, then every half game hour');
  check(s.finale?.step === Math.max(esc.from, end - FINALE_STEPS), 'the finale half an hour before the escape');
  check(s.highlights.at(-1)?.kind === 'escape' && s.highlights.at(-1)?.step === end, 'the escape is the last highlight, at the end');
  check(s.highlights.some((h) => h.kind === 'tunnel') && s.highlights.some((h) => h.kind === 'through'), 'the way down and the floor broken through are highlights');
  check(s.highlights.every((h, k) => k === 0 || h.step >= s.highlights[k - 1].step), 'highlights in order');
  console.log(`tunnel escape at Center Perks: ${esc.steps} steps, ${s.keys.length} keyframes, highlights ${s.highlights.map((h) => `${h.kind}@${Math.round(h.step / STEPS_PER_MINUTE)}m`).join(' ')}`);

  // Its progress as it goes adds up to what it found (the worker posts these).
  {
    const it = scout(esc, CENTER_PERKS, 1000);
    let keys = 0;
    let marks = 0;
    let last = esc.from;
    let r = it.next();
    for (; !r.done; r = it.next()) {
      check(r.value.at >= last, 'progress only goes forward');
      last = r.value.at;
      keys += r.value.keys.length;
      marks += r.value.highlights.length;
    }
    // (What's left after the last word comes with the result: the worker sends the whole of it at the end.)
    check(keys <= s.keys.length && marks <= s.highlights.length && keys > 1, 'the scout\'s progress is part of what it found');
  }

  // Seeking: from any keyframe, the tape steps to the next one exactly (the picture never drifts after a jump).
  {
    const set = prepareReplay(esc, CENTER_PERKS)!;
    const tape = new Tape(set.runs);
    const other = prepareReplay(esc, CENTER_PERKS)!.sim;
    let checked = 0;
    for (let k = 0; k + 1 < s.keys.length; k++) {
      set.sim.restore(s.keys[k].snap);
      tape.seek(s.keys[k].step - esc.from);
      while (set.sim.state.step < s.keys[k + 1].step) set.sim.step(tape.next());
      other.restore(s.keys[k + 1].snap);
      if (set.sim.hash() === other.hash()) checked++;
    }
    check(checked === s.keys.length - 1, `from every keyframe the next is reached exactly (${checked})`);
    // The finale stepped to the end: out.
    set.sim.restore(s.finale!.snap);
    tape.seek(s.finale!.step - esc.from);
    for (let c = tape.next(); c >= 0; c = tape.next()) set.sim.step(c);
    check(set.sim.state.step === end && set.sim.state.escaped > 0 && sumOf(set.sim) === sumOf(trec.sim), 'from the finale the escape plays out as it was');
    // The tape read from anywhere gives the commands a straight read gives.
    const straight: number[] = [];
    const t2 = new Tape(set.runs);
    for (let c = t2.next(); c >= 0; c = t2.next()) straight.push(c);
    check(straight.length === esc.steps && t2.length === esc.steps, 'the tape holds every step');
    const ok = [0, 1, 17, 999, esc.steps - 1].every((at) => {
      t2.seek(at);
      return t2.next() === straight[at];
    });
    t2.seek(esc.steps);
    check(ok && t2.next() === -1, 'the tape put anywhere reads on from there (and ends)');
  }

  // Quiet times: a night asleep in bed (from 23:30) is one; no highlight is ever inside one.
  {
    const nb = new Bot(CENTER_PERKS, 77);
    nb.routineUntil(1, 23 * 60 + 30);
    const ns = new Sim(CENTER_PERKS, 1);
    ns.restore(nb.sim.snapshot());
    ns.state.sleeping = true;
    const nr = new RunRecorder(ns, { log: null, game: '2.0.0' });
    for (let k = 0; k < 10 * SUM_STEPS; k++) nr.step(0);
    const nl = nr.toLog();
    const q = scoutAll(JSON.parse(JSON.stringify(nl)), CENTER_PERKS)!;
    const night = q.quiet[0];
    check(q.ok && !!night && night[0] <= nl.from + 1 && night[1] - night[0] > 6 * 60 * STEPS_PER_MINUTE, `the night asleep is a quiet time (${q.quiet.map(([a, b]) => `${Math.round((b - a) / STEPS_PER_MINUTE)} min`).join(', ')})`);
    check(q.quiet.every(([a, b]) => b <= nl.from + nl.steps && !q.highlights.some((h) => h.step >= a && h.step < b)), 'no highlight inside a quiet time');
    check(autoSpeed(night[0] + 100 * STEPS_PER_MINUTE, q.highlights, q.quiet) === AUTO_QUIET, 'Auto runs through it fastest');
    const m = scoutAll(log, CENTER_PERKS)!;
    check(m.ok && m.highlights.length === 0 && m.via === null, 'the model prisoner\'s days: no highlights, no escape');
  }

  // A rules change: the replay plays up to the last hour that checked, and nothing after it is kept.
  {
    const bad = JSON.parse(JSON.stringify(esc)) as typeof esc;
    const at = bad.sums.findIndex(([k]) => k > esc.from + 2 * SUM_STEPS);
    bad.sums[at] = [bad.sums[at][0], 'deadbeef'];
    const b = scoutAll(bad, CENTER_PERKS)!;
    check(!b.ok && b.end === b.verified && b.verified === bad.sums[at - 1][0], `a checksum missed: plays to the hour before (${b.end / SUM_STEPS} h)`);
    check(b.keys.every((k) => k.step <= b.end) && b.highlights.every((h) => h.step <= b.end) && b.quiet.every(([, y]) => y <= b.end) && b.via === null && b.finale === null, 'nothing past it: no keyframes, highlights or escape');
    check(scoutAll(esc, STALAG_FLUCHT) === null, 'a log only scouts in its own prison');
  }

  // The director: slow at a highlight, fast between, fastest through quiet times.
  {
    const hs = [{ step: 10000, kind: 'tunnel' as const }];
    const qt: Array<[number, number]> = [[20000, 30000]];
    check(autoSpeed(10000, hs, qt) === AUTO_MIN && autoSpeed(5000, hs, qt) === AUTO_MAX && autoSpeed(25000, hs, qt) === AUTO_QUIET, 'Auto: slow at a highlight, fast between, fastest asleep');
    const ramp = [9000, 9500, 9800, 9950].map((x) => autoSpeed(x, hs, qt));
    check(ramp.every((v, k) => k === 0 || v <= ramp[k - 1]), `Auto eases down as a highlight comes (${ramp.map((v) => v.toFixed(1)).join(' ')})`);
    check(highlightOf({ type: 'lockdown', on: false }) === null && highlightOf({ type: 'escaped', via: 'tunnel' }) === 'escape', 'only what matters is a highlight');
  }

  // A Daily's escape replays under its twists.
  {
    const mods = ['carePackage', 'badBlood'];
    const dsim = new Sim(CENTER_PERKS, 99, mods);
    const drec = new RunRecorder(dsim, { seed: 99, game: '2.0.0' });
    for (let k = 0; k < 3 * SUM_STEPS; k++) drec.step(k % 300 < 150 ? 5 : 0);
    const dl = { ...drec.toLog(), daily: 3 };
    check(dl.mods?.join() === mods.join() && scoutAll(dl, CENTER_PERKS)!.ok, 'a Daily\'s log keeps its twists and scouts whole');
    check(!scoutAll({ ...dl, mods: [] }, CENTER_PERKS)!.ok, 'without them it no longer checks');
  }

  // Replay files: out and back in, a guest's (never counted); anything else refused.
  {
    const by = { ...DEFAULT_PRISONER, name: 'Rex' };
    const text = replayFile(esc, by);
    const back = readReplayFile(text);
    check(typeof back !== 'string' && back.guest && back.by?.name === 'Rex' && JSON.stringify(back.log) === JSON.stringify(esc), 'a replay file reads back as a guest\'s, with who played it');
    check(replayFileName(esc) === `prison-escape-center-perks-day${clockOf(end)}-tunnel.pe3d.json`, `a file name says what it is (${replayFileName(esc)})`);
    check(readReplayFile('not json') === 'notReplay' && readReplayFile('{"kind":"other"}') === 'notReplay' && readReplayFile(JSON.stringify({ kind: 'pe3d-replay', log: { v: 1 } })) === 'notReplay', 'anything else is not a replay');
    check(readReplayFile(replayFile({ ...log, prison: 'alcatraz' }, null)) === 'unknownPrison' && readReplayFile(replayFile({ ...esc, mods: ['moonGravity'] }, null)) === 'unknownPrison', 'a prison or twist this game lacks is refused');
    check(readReplayFile('x'.repeat(FILE_MAX + 1)) === 'tooBig', 'a file too big is refused unread');
    const odd = readReplayFile(replayFile(esc, { name: 42 } as unknown as typeof by));
    check(typeof odd !== 'string' && odd.by?.name === '', 'a strange prisoner in a file is made safe');
    // Files made to hurt: endless or impossible numbers, a length its commands don't have, a start that isn't a game, a way out that isn't one.
    const wrap = (l: unknown) => JSON.stringify({ kind: 'pe3d-replay', v: 1, log: l });
    const raw = JSON.stringify({ kind: 'pe3d-replay', v: 1, log: esc }).replace(`"steps":${esc.steps}`, '"steps":1e400');
    check(readReplayFile(raw) === 'notReplay', 'endless steps (1e400) refused');
    check([{ ...esc, steps: 1e12 }, { ...esc, steps: esc.steps + 1 }, { ...esc, from: -5 }, { ...esc, steps: 2.5 }, { ...esc, seed: Number.NaN }].every((l) => readReplayFile(wrap(l)) === 'notReplay'), 'impossible numbers and a length its commands lack refused');
    check(readReplayFile(wrap({ ...esc, start: { v: 1, prison: 'center-perks', state: null } })) === 'notReplay' && readReplayFile(wrap({ ...esc, start: { v: 1, prison: 'center-perks', state: {} } })) === 'notReplay', 'a start that is no game refused (never thrown)');
    check(readReplayFile(wrap({ ...esc, via: '../../etc' })) === 'notReplay' && readReplayFile(wrap({ ...esc, daily: -1 })) === 'notReplay', 'a way out or Daily that isn\'t one refused');
  }

  // Kept on this device with its way out: the last escape, and the prison's quickest.
  {
    keepReplay(esc, true);
    const kept = replaysKept();
    check(kept.last?.via === 'tunnel' && kept.best.some((b) => b.prison === 'center-perks' && b.log.via === 'tunnel'), 'kept escapes carry their way out');
    keepReplay({ ...esc, daily: 0 }, false);
    check(replaysKept().last?.daily === 0 && replaysKept().best.find((b) => b.prison === 'center-perks')?.log.daily === undefined, 'a Daily\'s escape is the last one, never a prison\'s quickest');
  }

  // Watching never grants anything: the viewer calls nothing that records, earns, counts or saves.
  {
    const { readFileSync } = await import('node:fs');
    const grants = ['recordEscape', 'escapeRun', 'checkRun', 'startRun', 'syncRun', 'addStats', 'dailyEscape', 'dailyTry', 'writeSave', 'writeLog', 'keepReplay', 'writeJSON', 'markLesson', 'autosave', 'localStorage'];
    const files = ['src/play/replay.ts', 'src/replay/scout.ts', 'src/replay/run.ts', 'src/replay/scout.worker.ts', 'src/ui/replayBar.ts', 'src/game/replays.ts', 'src/play/stage.ts'];
    const bad = files.flatMap((f) => grants.filter((g) => new RegExp(`\\b${g}\\b`).test(readFileSync(f, 'utf8'))).map((g) => `${f}: ${g}`));
    check(bad.length === 0, `the viewer calls nothing that grants or saves (${bad.join(', ') || 'none'})`);
  }

  // A log that runs on past its escape: the scout stops there (no endless keyframes at a step that never moves).
  {
    const stuck = { ...esc, data: toBase64(encodeRuns([...decodeRuns(fromBase64(esc.data)!)!, [0, 2 ** 34]])), steps: esc.steps + 2 ** 34 };
    const t0 = Date.now();
    const st = scoutAll(stuck, CENTER_PERKS)!;
    check(Date.now() - t0 < 5000 && st.end === end && st.keys.length === s.keys.length, 'a log running on past the escape stops at it');
    let worst = 0;
    const it = scout(esc, CENTER_PERKS, 500);
    for (let r = it.next(); !r.done; r = it.next()) worst = Math.max(worst, r.value.verified - r.value.at);
    check(worst <= 0, 'progress never vouches past where it got');
  }
  console.log('replay viewer ok');
}

function clockOf(step: number) {
  return Math.floor(step / (1440 * STEPS_PER_MINUTE)) + 1;
}
