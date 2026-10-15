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
};

const { KEYS, SAVE_VERSION, migrateStorage, readJSON } = await import('../src/game/storage');
const { DEFAULT_SETTINGS, hasSeen, loadSettings, markSeen, saveSettings } = await import('../src/game/settings');

migrateStorage();
check(mem.get(KEYS.version) === String(SAVE_VERSION), 'version is stamped');
check(Object.keys(KEYS).every((k) => KEYS[k as keyof typeof KEYS].startsWith('pe3d.')), 'every key has the game prefix');

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
  check(recordOf('center-perks').routes.length === 0, 'no escapes yet');
  const a = recordEscape('center-perks', 'tunnel', 2, 2000);
  const b = recordEscape('center-perks', 'tunnel', 1, 900);
  const c = recordEscape('center-perks', 'roof', 3, 4000);
  check(a.newRoute && a.best && !b.newRoute && b.best && c.newRoute && !c.best, 'new routes and the quickest');
  const r = recordOf('center-perks');
  check(r.routes.join() === 'tunnel,roof' && r.bestDay === 1 && r.bestMinute === 900, 'stored');
  mem.set(KEYS.escapes, JSON.stringify({ 'center-perks': { routes: 'x', bestDay: 'y' } }));
  check(recordOf('center-perks').routes.length === 0 && recordOf('center-perks').bestDay === 0, 'a bad record falls back');
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
  check(f.day === 1 && f.minute === 8 * 60 + 3 && f.prison === 'center-perks' && f.game === 'test', 'the save says when and where');
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
