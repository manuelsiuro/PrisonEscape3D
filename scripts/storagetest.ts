/** Crash-safe storage and settings, against an in-memory localStorage. */
import { check } from './assert';

const mem = new Map<string, string>();
let blocked = false;
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => {
    if (blocked) throw new Error('SecurityError');
    return mem.get(k) ?? null;
  },
  setItem: (k: string, v: string) => {
    if (blocked) throw new Error('QuotaExceededError');
    mem.set(k, String(v));
  },
  removeItem: (k: string) => void mem.delete(k),
  get length() {
    return mem.size;
  },
  key: (k: number) => [...mem.keys()][k] ?? null,
};

const { KEYS, SAVE_VERSION, migrateStorage, readJSON } = await import('../src/game/storage');
const { DEFAULT_SETTINGS, hasSeen, loadSettings, markSeen, saveSettings } = await import('../src/game/settings');

migrateStorage();
check(mem.get(KEYS.version) === String(SAVE_VERSION), 'version is stamped');
check(
  Object.keys(KEYS).every((k) => KEYS[k as keyof typeof KEYS].startsWith('pe3d.')),
  'every key has the game prefix',
);

// Settings: saved and read back; a bad field falls back to its default.
saveSettings({ ...DEFAULT_SETTINGS, sfxVolume: 0.3, lang: 'fr' });
check(loadSettings().sfxVolume === 0.3 && loadSettings().lang === 'fr', 'settings round trip');
mem.set(KEYS.settings, JSON.stringify({ sfxVolume: 'loud', lang: 'xx', muted: true }));
const s = loadSettings();
check(s.sfxVolume === DEFAULT_SETTINGS.sfxVolume && s.lang === 'auto' && s.muted === true, 'bad fields get defaults, good ones stay');

// Blocked storage: nothing throws, reads fall back.
blocked = true;
check(readJSON(KEYS.settings, { ok: true }).ok === true, 'blocked storage falls back');
saveSettings(DEFAULT_SETTINGS);
blocked = false;
// Garbage in storage falls back to the right shape.
mem.set(KEYS.settings, '[1,2,3]');
check(loadSettings().sfxVolume === DEFAULT_SETTINGS.sfxVolume, 'a wrong shape falls back to the defaults');
// Quality falls back from an unknown value.
mem.set(KEYS.settings, JSON.stringify({ quality: 'ultra' }));
check(loadSettings().quality === 'auto', 'an unknown quality falls back to auto');

// One-time hints: remembered once seen.
check(!hasSeen('walk'), 'a fresh device has seen nothing');
markSeen('walk');
markSeen('walk');
check(hasSeen('walk') && JSON.parse(mem.get(KEYS.seen)!).length === 1, 'seen once, stored once');
console.log('storage ok, version', SAVE_VERSION);

// Escape records: routes collected once each, the quickest kept; garbage falls back.
{
  const { recordEscape, recordOf } = await import('../src/game/records');
  check(recordOf('maple-grove').routes.length === 0, 'no escapes yet');
  const a = recordEscape('maple-grove', 'tunnel', 2, 2000);
  const b = recordEscape('maple-grove', 'tunnel', 1, 900);
  const c = recordEscape('maple-grove', 'roof', 3, 4000);
  check(a.newRoute && a.best && !b.newRoute && b.best && c.newRoute && !c.best, 'new routes and the quickest');
  const r = recordOf('maple-grove');
  check(r.routes.join() === 'tunnel,roof' && r.bestDay === 1 && r.bestMinute === 900, 'stored');
  mem.set(KEYS.escapes, JSON.stringify({ 'maple-grove': { routes: 'x', bestDay: 'y' } }));
  check(recordOf('maple-grove').routes.length === 0 && recordOf('maple-grove').bestDay === 0, 'a bad record falls back');
  console.log('escape records ok');
}

// Saved games: written, listed, loaded into a game that plays on; garbage, other prisons and
// blocked storage read as empty; Reset progress wipes them.
{
  const { deleteSave, loadSave, readSave, writeSave } = await import('../src/game/saves');
  const { resetProgress } = await import('../src/game/settings');
  const { Sim } = await import('../src/sim/Sim');
  const { PRISONS } = await import('../src/content/prisons');
  const sim = new Sim(PRISONS[0], 42);
  for (let k = 0; k < 20 * 3; k++) sim.step(0);
  check(readSave('auto') === null, 'no save yet');
  check(writeSave('auto', sim, 'test') && writeSave(2, sim, 'test'), 'saved');
  const f = readSave(2)!;
  check(f.day === 1 && f.minute === 8 * 60 + 3 && f.prison === 'maple-grove' && f.game === 'test', 'the save says when and where');
  const back = loadSave(f)!;
  check(back.hash() === sim.hash(), 'loaded, the same game');
  for (let k = 0; k < 400; k++) {
    sim.step(0);
    back.step(0);
  }
  check(back.hash() === sim.hash(), 'and it plays on the same');
  mem.set(KEYS.save1, JSON.stringify({ v: 1, day: 'x' }));
  check(readSave(1) === null, 'a broken save reads as empty');
  mem.set(KEYS.save1, JSON.stringify({ ...f, prison: 'alcatraz' }));
  check(readSave(1) === null, 'a save of an unknown prison reads as empty');
  mem.set(KEYS.save1, JSON.stringify({ ...f, snap: { ...f.snap, prison: 'alcatraz' } }));
  check(readSave(1) !== null && loadSave(readSave(1)!) === null, 'a save that fails to load gives no game');
  deleteSave(2);
  check(readSave(2) === null && readSave('auto') !== null, 'one slot deleted');
  blocked = true;
  check(!writeSave(3, sim, 'test') && readSave('auto') === null, 'blocked storage: not saved, nothing read');
  blocked = false;
  resetProgress();
  check(readSave('auto') === null && readSave(1) === null, 'reset progress wipes the saves');
  console.log('saves ok,', JSON.stringify(f).length < 12000 ? 'under 12 KB' : 'OVER 12 KB');
}

// P16: Reset progress wipes the achievements, the stats, the run logs and every replay; your prisoner stays.
{
  const { resetProgress } = await import('../src/game/settings');
  const { replayBestKey, PROGRESS_KEYS } = await import('../src/game/storage');
  for (const k of [KEYS.stats, KEYS.trophies, KEYS.logAuto, KEYS.log2, KEYS.replayLast, replayBestKey('gull-rock'), KEYS.prisoner])
    mem.set(k, '{}');
  resetProgress();
  check(
    [KEYS.stats, KEYS.trophies, KEYS.logAuto, KEYS.log2, KEYS.replayLast, replayBestKey('gull-rock')].every((k) => !mem.has(k)),
    'reset progress wipes achievements, stats, logs and replays',
  );
  check(mem.has(KEYS.prisoner) && !PROGRESS_KEYS.includes(KEYS.prisoner), 'your prisoner stays');
  check(replayBestKey('gravel-point').startsWith('pe3d.'), 'replay keys have the game prefix');
  console.log('progress keys ok');
}

// 2.62: five prisons renamed. A device's old ids (in a save and its log, the escape records, a best replay's key)
// come back as the new ones; other values and the other prisons' ids stay as they were.
{
  const { renamedId } = await import('../src/content/prisons/renamed');
  const { replayBestKey } = await import('../src/game/storage');
  // The old ids as letter codes: the names themselves are no longer written anywhere.
  const OLD = [
    [99, 101, 110, 116, 101, 114, 45, 112, 101, 114, 107, 115],
    [115, 116, 97, 108, 97, 103, 45, 102, 108, 117, 99, 104, 116],
    [115, 104, 97, 110, 107, 116, 111, 110],
    [115, 97, 110, 45, 112, 97, 110, 99, 104, 111],
    [105, 114, 111, 110, 103, 97, 116, 101],
  ].map((c) => String.fromCharCode(...c));
  const NEW = ['maple-grove', 'frostberg', 'gravel-point', 'sierra-seca', 'gull-rock'];
  check(
    OLD.every((o, k) => renamedId(o) === NEW[k]),
    'each old id names its new one',
  );
  check(
    [...NEW, 'six-hunter', 'training', 'roof', ''].every((s) => renamedId(s) === undefined),
    'nothing else is renamed',
  );
  mem.clear();
  mem.set(KEYS.version, '2');
  mem.set(KEYS.escapes, JSON.stringify({ [OLD[4]]: { routes: ['raft'], bestDay: 9 }, 'six-hunter': { routes: ['glider'] } }));
  mem.set(KEYS.save1, JSON.stringify({ v: 1, prison: OLD[1], snap: { v: 1, prison: OLD[1], state: { step: 7 } }, zone: 'yard' }));
  mem.set(KEYS.log1, JSON.stringify({ v: 1, prison: OLD[1], seed: 3, game: '2.61.0' }));
  mem.set(replayBestKey(OLD[2]), JSON.stringify({ v: 1, prison: OLD[2], seed: 5 }));
  mem.set(KEYS.settings, JSON.stringify({ lang: 'fr' }));
  check(migrateStorage() === 3, 'a version-2 device migrated to version 3');
  const esc = JSON.parse(mem.get(KEYS.escapes)!);
  check(Object.keys(esc).join() === 'gull-rock,six-hunter' && esc['gull-rock'].bestDay === 9, 'the escape records under the new ids');
  const save = JSON.parse(mem.get(KEYS.save1)!);
  check(
    save.prison === 'frostberg' && save.snap.prison === 'frostberg' && save.zone === 'yard' && save.snap.state.step === 7,
    'a save and its game',
  );
  check(JSON.parse(mem.get(KEYS.log1)!).prison === 'frostberg', 'its run log');
  check(
    !mem.has(replayBestKey(OLD[2])) && JSON.parse(mem.get(replayBestKey('gravel-point'))!).prison === 'gravel-point',
    'a best replay, moved to its new key',
  );
  check(mem.get(KEYS.settings) === JSON.stringify({ lang: 'fr' }), 'the rest untouched');
  console.log('renamed prisons migrated');
}
