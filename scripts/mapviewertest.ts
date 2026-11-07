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
import { DECOR } from '../src/content/decor';
import { ITEMS } from '../src/content/items';
import { PRISONS } from '../src/content/prisons';
import { TRAINING } from '../src/content/prisons/training';
import { PROPS } from '../src/content/props';
import { MAP_H, MAP_W } from '../src/sim/world/World';
import { viewerData } from './dev/mapimage';
import { computeModelStats, getCatalog } from './dev/modelviewer/catalog';
import { MODEL_LIBRARY, compileModel, exportObj, mergedGeometry, validateBlueprint } from '../model-library';

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
  'vending',
  'menu',
  'cooler',
  // 2.36: drawn on the People picture, an overlay, the sheet.
  'gangs',
  // Drawn on the pictures, or under the cursor.
  'ground',
  'vents',
  'under',
  'zones',
  'cells',
  'props',
  'rollCall',
  'spawn',
  'guards',
  'names',
  'cameras',
  'searchlights',
  'decor',
  'gates',
  'landings',
  'drawbridge',
  'delivery',
  'smuggling',
  'checkpoint',
  'leisure',
  'comms',
  'board',
  // On the sheet or the sidebar.
  'id',
  'difficulty',
  'theme',
  'merchants',
  'crew',
  'jobs',
  'rules',
  'escapes',
  'grid',
  'map',
  // No place on a map: the zones maptest checks can be walked to.
  'reachable',
]);
const KNOWN_GUARD = new Set(['name', 'beat', 'posts', 'night', 'duties', 'key', 'riot', 'helipad', 'trait', 'dog', 'about', 'kit']);
const KNOWN_LEISURE = new Set(['hoop', 'oldTimer', 'garden', 'race', 'pitch', 'pitchWas', 'stage', 'quiz', 'track', 'librarian']);
const unknown = (where: string, o: object, known: ReadonlySet<string>) => {
  for (const key of Object.keys(o))
    if (!known.has(key))
      fail(`${where}: the viewer doesn't know "${key}" (draw it in scripts/dev/mapimage.ts or mapdata.ts, then list it here)`);
};
for (const def of [TRAINING, ...PRISONS]) {
  unknown(def.id, def, KNOWN_PRISON);
  def.guards.forEach((g, k) => unknown(`${def.id}'s guard ${k + 1}`, g, KNOWN_GUARD));
  if (def.leisure) unknown(`${def.id}'s leisure`, def.leisure, KNOWN_LEISURE);
}

// 3D Models Viewer (assets/models/index.html + scripts/dev/modelviewer/catalog.ts):
// every game prop, decor piece, item, and kit-library entry builds a valid 3D mesh.
if (!existsSync('assets/models/index.html')) fail('assets/models/index.html missing');
const catalog = getCatalog();
const catalogIds = new Set<string>();
for (const e of catalog) {
  if (catalogIds.has(e.id)) fail(`models viewer: duplicate id ${e.id}`);
  catalogIds.add(e.id);
}
for (const k of Object.keys(PROPS)) {
  if (!catalogIds.has(`prop:${k}`)) fail(`models viewer: missing prop:${k}`);
}
for (const k of Object.keys(DECOR)) {
  if (!catalogIds.has(`decor:${k}`)) fail(`models viewer: missing decor:${k}`);
}
for (const it of ITEMS) {
  if (!catalogIds.has(`item:${it.id}`)) fail(`models viewer: missing item:${it.id}`);
}
// Minimal Node canvas stub for 2D canvas textures (Character sleep sprite, Pastimes, Games).
const gDoc = globalThis as unknown as { document?: unknown };
if (!gDoc.document) {
  const noop = () => {};
  const grad = { addColorStop: noop };
  const ctx2d = new Proxy(
    {
      createLinearGradient: () => grad,
      createRadialGradient: () => grad,
      measureText: () => ({ width: 10 }),
      getImageData: () => ({ data: new Uint8ClampedArray(16) }),
    },
    { get: (t, p) => (p in t ? t[p as keyof typeof t] : noop) },
  );
  gDoc.document = {
    createElement: () => ({ width: 64, height: 64, getContext: () => ctx2d }),
  };
}
for (const entry of catalog) {
  const variants: Record<string, string | number | boolean> = {};
  for (const v of entry.variants ?? []) variants[v.key] = v.defaultValue;
  const built = entry.build({ variants, night: 0, power: 1 });
  const stats = computeModelStats(built.root);
  if (stats.meshes <= 0 || stats.vertices <= 0 || stats.triangles <= 0) {
    fail(`models viewer: ${entry.id} built empty geometry (${stats.meshes} meshes, ${stats.vertices} verts)`);
  }
  built.dispose?.();
}

// Standalone model-library blueprints: schema, merged geometry (1-draw-call), and OBJ export.
for (const bp of MODEL_LIBRARY) {
  const errs = validateBlueprint(bp);
  if (errs.length > 0) fail(`model-library: ${bp.id} invalid: ${errs.join('; ')}`);
  const geom = mergedGeometry(bp);
  if (!geom || geom.getAttribute('position').count === 0) {
    fail(`model-library: ${bp.id} mergedGeometry produced empty geometry`);
  }
  geom.dispose();
  const compiled = compileModel(bp);
  const obj = exportObj(compiled.root, bp.id);
  if (!obj.startsWith('# Wavefront OBJ') || !obj.includes('\nv ') || !obj.includes('\nf ')) {
    fail(`model-library: ${bp.id} exportObj produced invalid OBJ output`);
  }
  compiled.dispose();
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
