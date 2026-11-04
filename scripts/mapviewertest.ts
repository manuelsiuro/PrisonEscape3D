/**
 * The map viewer (assets/maps) is in step with the game: data.js is what `npm run maps` would write
 * now, its drawn pictures come from the drawing code and content of today (each one's SVG hash), and
 * every prison has its pictures on disk. The version in data.js may lag, so a release alone never
 * fails this. It can't see the 3D photos go stale: those are retaken by hand (CLAUDE.md).
 *
 * A new field on a prison or a guard fails here too, until it's listed below as drawn, as shown on
 * the sheet, or as having no place on a map: that's how the viewer has fallen behind before.
 */
import { existsSync, readFileSync } from 'node:fs';
import { PRISONS } from '../src/content/prisons';
import { TRAINING } from '../src/content/prisons/training';
import { MAP_H, MAP_W } from '../src/sim/world/World';
import { viewerData } from './dev/mapimage';

const OUT = 'assets/maps';
let failures = 0;
const fail = (s: string) => {
  failures++;
  console.error(`FAIL ${s}`);
};

interface ViewerPrison {
  id: string;
  views: Array<{ kind: string; file: string }>;
  sheet: Array<{ title: string; rows: unknown[] }>;
  layers: Array<{ id: string; tiles: number[] }>;
  routine: unknown[];
  marks: Array<readonly [number, number, string]>;
  above: Array<readonly [number, number, string]>;
  roofs: Array<readonly [number, number, string]>;
  outside: { marks: Array<readonly [number, number, string]> } | null;
}

const win: { MAP_DATA?: { version: string; prisons: ViewerPrison[] } & Record<string, unknown> } = {};
new Function('window', readFileSync(`${OUT}/data.js`, 'utf8'))(win);
const saved = win.MAP_DATA!;
const fresh = JSON.parse(JSON.stringify(viewerData())) as typeof saved;

// Everything but the version, part by part, so that a failure says what went stale.
for (const key of Object.keys(fresh)) {
  if (key === 'version' || key === 'prisons') continue;
  if (JSON.stringify(saved[key]) !== JSON.stringify(fresh[key])) fail(`data.js: ${key} differs (npm run maps)`);
}
if (saved.prisons.length !== fresh.prisons.length) fail('data.js: a different number of prisons (npm run maps)');
fresh.prisons.forEach((p, k) => {
  const old = (saved.prisons[k] ?? {}) as unknown as Record<string, unknown>;
  for (const [field, value] of Object.entries(p)) {
    if (JSON.stringify(old[field]) !== JSON.stringify(value)) fail(`data.js: ${p.id}'s ${field} differs (npm run maps)`);
  }
  for (const v of p.views) if (!existsSync(`${OUT}/${v.file}`)) fail(`${p.id}: no picture ${v.file}`);
  // (A mark off the map stops the whole page: the viewer files them by tile.)
  const onMap = ([x, z]: readonly [number, number, string]) => x >= 0 && z >= 0 && x < MAP_W && z < MAP_H;
  const marks = [...p.marks, ...p.above, ...p.roofs, ...(p.outside?.marks ?? [])];
  if (!marks.every(onMap)) fail(`${p.id}: a mark off the map`);
  if (!p.views.some((v) => v.kind === 'game')) fail(`${p.id}: no In game photo (scripts/dev/mapshot.ts)`);
});

/** A prison's fields, by where the viewer has them. */
const KNOWN_PRISON = new Set([
  // Drawn on the pictures, or under the cursor.
  'ground', 'vents', 'under', 'zones', 'cells', 'props', 'rollCall', 'spawn', 'guards', 'names', 'cameras', 'searchlights', 'decor', 'gates', 'landings', 'drawbridge', 'delivery', 'smuggling', 'checkpoint', 'leisure', 'comms', 'board',
  // On the sheet or the sidebar.
  'id', 'difficulty', 'theme', 'merchants', 'crew', 'jobs', 'rules', 'escapes', 'grid', 'map',
  // No place on a map: the zones maptest checks can be walked to.
  'reachable',
]);
const KNOWN_GUARD = new Set(['name', 'beat', 'posts', 'night', 'duties', 'key', 'riot', 'helipad', 'trait', 'dog', 'about']);
const KNOWN_LEISURE = new Set(['hoop', 'oldTimer', 'garden', 'race', 'pitch', 'pitchWas', 'stage', 'quiz', 'track']);
const unknown = (where: string, o: object, known: ReadonlySet<string>) => {
  for (const key of Object.keys(o)) if (!known.has(key)) fail(`${where}: the viewer doesn't know "${key}" (draw it in scripts/dev/mapimage.ts or mapdata.ts, then list it here)`);
};
for (const def of [TRAINING, ...PRISONS]) {
  unknown(def.id, def, KNOWN_PRISON);
  def.guards.forEach((g, k) => unknown(`${def.id}'s guard ${k + 1}`, g, KNOWN_GUARD));
  if (def.leisure) unknown(`${def.id}'s leisure`, def.leisure, KNOWN_LEISURE);
}

// What each prison offers, so that a change to any of it shows in the snapshot.
for (const p of fresh.prisons) {
  console.log(`${p.id}: ${p.views.map((v) => v.kind).join(', ')}`);
  console.log(`  sheet: ${p.sheet.map((s) => `${s.title} (${s.rows.length})`).join('; ')}`);
  console.log(`  overlays: ${p.layers.map((l) => `${l.id} ${l.tiles.length}`).join(', ')}; ${p.routine.length} routine blocks`);
}

if (failures) {
  console.error(`${failures} failed: the map viewer is out of step with the game`);
  process.exit(1);
}
console.log('map viewer in step with the game');
