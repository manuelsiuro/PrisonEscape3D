/**
 * The picture's budget and its memory (the P23–P30 polish): every prison's static world is a
 * few dozen draw calls at most (walls two a kind, doors and furniture batched or instanced,
 * decor in two), a character is one skinned mesh, and nothing a view makes outlives it. A
 * world built and freed gives back every geometry, material and texture it made, and never
 * one it shares (the cached TEX textures, the kit material); the ground's two canvases are
 * kept for the same prison staged again (Watch again, Play again) and freed when another's
 * are drawn. A replay's Watch again restages the same World: the doors stand as the restored
 * state has them at once.
 *
 * Headless: the canvases are stand-ins (nothing is drawn), the counts are of objects, not of
 * a GPU's calls (culling and the shadow pass come on top in a browser).
 */
import * as THREE from 'three';
import { check } from './assert';

// A canvas that takes every call and draws nothing (textures are made, never uploaded here).
const context = new Proxy(
  {},
  {
    get: (_, key) => {
      if (key === 'createImageData' || key === 'getImageData')
        return (a: number | { width: number; height: number }, b?: number) => {
          const w = typeof a === 'number' ? a : a.width;
          const h = typeof a === 'number' ? b! : a.height;
          return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
        };
      if (key === 'measureText') return () => ({ width: 0 });
      return () => ({ addColorStop: () => {} });
    },
    set: () => true,
  },
);
(globalThis as { document?: unknown }).document = {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => context }),
};

const { PRISONS } = await import('../src/content/prisons');
const { TRAINING } = await import('../src/content/prisons/training');
const { Sim } = await import('../src/sim/Sim');
const { WorldView } = await import('../src/render/WorldView');
const { DecorView } = await import('../src/render/decor');
const { groundTextures } = await import('../src/render/ground');
const { kitMaterial } = await import('../src/render/kit');
const { Character, INMATE_LOOK } = await import('../src/render/Character');
const { setTheme } = await import('../src/render/textures');
const { Structure } = await import('../src/render/Structure');
const { Security } = await import('../src/render/Security');
const { Minefield } = await import('../src/render/Minefield');
const { Underground } = await import('../src/render/Underground');
const { Island } = await import('../src/render/Island');

/** The draw calls a tree asks for, culling aside (one per material group drawn; an empty instanced mesh none). */
function calls(root: THREE.Object3D): number {
  let n = 0;
  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return;
    const m = o as THREE.Mesh;
    if ((m.isMesh || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) && !((o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).count === 0))
      n += Array.isArray(m.material) ? Math.max(1, m.geometry.groups.length) : 1;
    for (const c of o.children) walk(c);
  };
  walk(root);
  return n;
}

/** Everything a tree holds: geometries, materials, the textures its materials use. */
function holdings(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geometries.add(m.geometry);
    for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
      materials.add(mat);
      for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) textures.add(v as THREE.Texture);
    }
  });
  return { geometries, materials, textures };
}

/** Which of these get freed (their dispose events) while `run` runs. */
function freedBy(things: Iterable<THREE.EventDispatcher<{ dispose: object }>>, run: () => void): Set<unknown> {
  const freed = new Set<unknown>();
  const off: Array<() => void> = [];
  for (const t of things) {
    const on = () => freed.add(t);
    t.addEventListener('dispose', on);
    off.push(() => t.removeEventListener('dispose', on));
  }
  run();
  for (const f of off) f();
  return freed;
}

let lastGround: readonly THREE.Texture[] = [];
for (const def of [...PRISONS, TRAINING]) {
  const world = new Sim(def).world;
  setTheme(def.theme ?? 'suburban');
  // Another prison's ground: the last one's canvases are freed as these are drawn.
  const before = lastGround;
  let a!: InstanceType<typeof WorldView>;
  const freedOld = freedBy(before, () => (a = new WorldView(world)));
  check(before.every((t) => freedOld.has(t)), `${def.id}: the last prison's ground canvases are freed when its are drawn`);
  const ground = groundTextures();
  check(ground.length === 2, `${def.id}: the ground's two canvases are cached`);
  // The same prison again (Watch again, Play again): the same canvases, nothing redrawn.
  const b = new WorldView(new Sim(def).world);
  check(groundTextures().every((t, k) => t === ground[k]), `${def.id}: the same prison staged again reuses its ground canvases`);

  const ha = holdings(a.group);
  const hb = holdings(b.group);
  const shared = new Set([...ha.textures].filter((t) => hb.textures.has(t)));
  const own = [...ha.textures].filter((t) => !shared.has(t));
  const things = [...ha.geometries, ...ha.materials, ...ha.textures] as Array<THREE.EventDispatcher<{ dispose: object }>>;
  const freed = freedBy(things, () => a.dispose());
  check([...ha.geometries].every((g) => freed.has(g)), `${def.id}: every geometry of a world is freed with it`);
  check([...ha.materials].every((m) => freed.has(m) === (m !== kitMaterial)), `${def.id}: every material of a world is freed with it (the kit material stays)`);
  check(own.every((t) => freed.has(t)), `${def.id}: every texture a world made is freed with it (${own.filter((t) => !freed.has(t)).length} kept)`);
  check([...shared].every((t) => !freed.has(t)), `${def.id}: no shared texture is freed with a world (cached TEX, the ground's canvases)`);
  check(ground.every((t) => shared.has(t) && !freed.has(t)), `${def.id}: the ground's canvases outlive the view (the cache's)`);

  // The static world's draw calls.
  const decor = new DecorView(def.decor ?? []);
  const wv = calls(b.group);
  const dc = calls(decor.group);
  check(wv <= 64, `${def.id}: the static world is at most 64 draw calls (${wv})`);
  check(dc <= 2, `${def.id}: the decor is at most two draw calls (${dc})`);
  console.log(`${def.id}: world ${wv} calls, decor ${dc}; freed ${freed.size} of ${things.length} (${own.length} own textures, ${shared.size} shared)`);

  // Watch again: the doors stand as the restored state has them, at once (no slide from the end's).
  const doors = (b as unknown as { doors: Array<{ index: number; open: number }> }).doors;
  if (doors.length) {
    const d = doors[0];
    const shut = b.world.doorShut[d.index];
    b.world.doorShut[d.index] = shut ? 0 : 1;
    b.reset();
    check(d.open === (shut ? 1 : 0), `${def.id}: a restaged world's doors stand as the state has them at once`);
    b.world.doorShut[d.index] = shut;
  }
  decor.dispose();

  // The rest of a prison's views: what each makes is freed with it, what they share is not.
  const parts: Array<[string, () => { roots: THREE.Object3D[]; dispose: () => void }]> = [
    ['structure', () => { const s = new Structure(world, b); s.refresh(false); return { roots: [s.group, s.roofs], dispose: () => s.dispose() }; }],
    ['security', () => { const s = new Security(world); return { roots: [s.group], dispose: () => s.dispose() }; }],
    ['minefield', () => { const s = new Minefield(world); return { roots: [s.group], dispose: () => s.dispose() }; }],
    ['underground', () => { const s = new Underground(world); s.refresh(); return { roots: [s.group], dispose: () => s.dispose() }; }],
    ['decor', () => { const s = new DecorView(def.decor ?? []); return { roots: [s.group], dispose: () => s.dispose() }; }],
  ];
  if (def.theme === 'island') parts.push(['island', () => { const s = new Island(world); return { roots: [s.group], dispose: () => s.dispose() }; }]);
  const kept: string[] = [];
  for (const [name, make] of parts) {
    const k = leaks(make);
    if (k) kept.push(`${name} ${k}`);
  }
  check(!kept.length, `${def.id}: every view frees what it made (${kept.join(', ')})`);
  b.dispose();
  lastGround = ground;
}

/** Makes a view twice: frees the first, and says what it made but kept ('' when nothing). */
function leaks(make: () => { roots: THREE.Object3D[]; dispose: () => void }): string {
  const a = make();
  const b = make();
  const of = (roots: THREE.Object3D[]) => {
    const all = roots.map(holdings);
    return { geometries: all.flatMap((h) => [...h.geometries]), materials: all.flatMap((h) => [...h.materials]), textures: all.flatMap((h) => [...h.textures]) };
  };
  const ha = of(a.roots);
  const hb = of(b.roots);
  const theirs = new Set<unknown>([...hb.geometries, ...hb.materials, ...hb.textures]);
  const mine = [...new Set<THREE.EventDispatcher<{ dispose: object }>>([...ha.geometries, ...ha.materials, ...ha.textures] as Array<THREE.EventDispatcher<{ dispose: object }>>)];
  const freed = freedBy(mine, () => a.dispose());
  b.dispose();
  const own = mine.filter((t) => !theirs.has(t));
  const lost = own.filter((t) => !freed.has(t)).length;
  const wrong = mine.filter((t) => theirs.has(t) && freed.has(t) && t !== (kitMaterial as unknown)).length;
  return lost || wrong ? `${lost} kept, ${wrong} shared freed` : '';
}

// A character: one skinned body, however its limbs move (and its shadow one more).
{
  const c = new Character({ ...INMATE_LOOK, silhouette: undefined });
  const n = calls(c.root);
  check(n === 1, `a character is one draw call standing (${n})`);
  const ghosted = new Character({ ...INMATE_LOOK, silhouette: 0xffffff });
  const g = calls(ghosted.root);
  check(g === 2, `with its silhouette, two (${g})`);
  console.log(`a character: ${n} call, ${g} with its silhouette`);
  for (const look of [INMATE_LOOK, { ...INMATE_LOOK, silhouette: undefined, key: 0xffd34a }]) {
    const k = leaks(() => {
      const ch = new Character(look);
      return { roots: [ch.root], dispose: () => ch.dispose() };
    });
    check(!k, `a character frees what it made (${k})`);
  }
  c.dispose();
  ghosted.dispose();
}
