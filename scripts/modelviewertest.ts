/**
 * The 3D objects viewer (assets/models, scripts/dev/modelviewer) and the model library (model-library/):
 * - the catalog has every prop, decor piece and item of the game, each id once;
 * - every entry builds non-empty geometry and disposes (2D canvas textures on a stub: no browser here);
 * - every library blueprint passes `validateBlueprint`, merges to one geometry and exports as OBJ;
 * - the library's `box`, `cyl`, `rod`, `disc` and `merge` give what the game's `src/render/kit.ts` gives for the
 *   same arguments (segments given: the library's defaults are lower), so a model moves into the game by
 *   changing one import, as `model-library/kit.ts` says.
 *
 * Split from `mapviewertest` (2.37), which is about the map viewer only.
 */
import { existsSync } from 'node:fs';
import { DECOR } from '../src/content/decor';
import { ITEMS } from '../src/content/items';
import { PROPS } from '../src/content/props';
import * as gameKit from '../src/render/kit';
import * as libKit from '../model-library/kit';
import { MODEL_LIBRARY, compileModel, exportObj, mergedGeometry, validateBlueprint } from '../model-library';
import { computeModelStats, getCatalog } from './dev/modelviewer/catalog';

let failures = 0;
const fail = (s: string) => {
  failures++;
  console.error(`FAIL ${s}`);
};

if (!existsSync('assets/models/index.html')) fail('assets/models/index.html missing');

// Every game prop, decor piece and item in the catalog, each id once.
const catalog = getCatalog();
const ids = new Set<string>();
for (const e of catalog) {
  if (ids.has(e.id)) fail(`duplicate id ${e.id}`);
  ids.add(e.id);
}
for (const k of Object.keys(PROPS)) if (!ids.has(`prop:${k}`)) fail(`missing prop:${k}`);
for (const k of Object.keys(DECOR)) if (!ids.has(`decor:${k}`)) fail(`missing decor:${k}`);
for (const it of ITEMS) if (!ids.has(`item:${it.id}`)) fail(`missing item:${it.id}`);

// A stub for the 2D canvas textures some builders paint (the sleeper's sprite, the pastimes, the dice).
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
  gDoc.document = { createElement: () => ({ width: 64, height: 64, getContext: () => ctx2d }) };
}

// Every entry builds non-empty geometry.
const byLibrary = new Map<string, { n: number; tris: number }>();
for (const entry of catalog) {
  const variants: Record<string, string | number | boolean> = {};
  for (const v of entry.variants ?? []) variants[v.key] = v.defaultValue;
  const built = entry.build({ variants, night: 0, power: 1 });
  const stats = computeModelStats(built.root);
  if (stats.meshes <= 0 || stats.vertices <= 0 || stats.triangles <= 0)
    fail(`${entry.id} built empty geometry (${stats.meshes} meshes, ${stats.vertices} vertices)`);
  const lib = byLibrary.get(entry.library) ?? { n: 0, tris: 0 };
  lib.n++;
  lib.tris += stats.triangles;
  byLibrary.set(entry.library, lib);
  built.dispose?.();
}

// The library's blueprints: valid, one merged geometry, an OBJ.
for (const bp of MODEL_LIBRARY) {
  const errs = validateBlueprint(bp);
  if (errs.length > 0) fail(`model-library: ${bp.id} invalid: ${errs.join('; ')}`);
  const geom = mergedGeometry(bp);
  if (!geom || geom.getAttribute('position').count === 0) fail(`model-library: ${bp.id} merged to empty geometry`);
  geom.dispose();
  const compiled = compileModel(bp);
  const obj = exportObj(compiled.root, bp.id);
  if (!obj.startsWith('# Wavefront OBJ') || !obj.includes('\nv ') || !obj.includes('\nf '))
    fail(`model-library: ${bp.id} exported an invalid OBJ`);
  compiled.dispose();
}

// The two kits agree, part for part and merged (positions and baked colours).
type Kit = typeof gameKit | typeof libKit;
const sample = (k: Kit) =>
  k.merge([
    k.box(0.4, 0.9, 0.3, 0x8d949e, 0.1, 0, -0.2),
    k.cyl(0.12, 0.6, '#3b4048', -0.3, 0.2, 0.1, 10),
    k.rod(0.03, 0.8, 0xc0392b, 0, 0.7, 0, 8),
    k.disc(0.15, 0.04, 0xeef1f4, 0.2, 0.5, 0.16, 14),
  ]);
const same = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from(a).every((v, i) => Math.abs(v - b[i]) < 1e-6);
{
  const a = sample(gameKit);
  const b = sample(libKit);
  if (!same(a.getAttribute('position').array, b.getAttribute('position').array)) fail("the library kit's shapes differ from the game's");
  if (!same(a.getAttribute('color').array, b.getAttribute('color').array))
    fail("the library kit's colours or foot shade differ from the game's");
}

for (const [lib, { n, tris }] of byLibrary) console.log(`${lib}: ${n} models, ${tris} triangles`);
console.log(`model library: ${MODEL_LIBRARY.length} blueprints`);
if (failures) {
  console.error(`${failures} failed`);
  process.exit(1);
}
console.log('the objects viewer and the model library build, and the two kits agree');
