/**
 * Blueprint to Three.js: `compileModel` for a scene (one mesh per layer, articulated layers on their
 * pivots, an animation hook, a dispose), `mergedGeometry` for one draw call per copy (an InstancedMesh
 * with `kitMaterial`), and `validateBlueprint` for the checks a model must pass to join the library.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { kitMaterial, merge } from './kit';
import type { CompiledModel, CompiledPart, ModelBlueprint, PartLayerSpec, PartMaterialKind, ParamValues } from './types';

/** The blueprint's defaults, overridden by `overrides` (unknown keys are kept: a game may pass its own). */
export function resolveParams(bp: ModelBlueprint, overrides: ParamValues = {}): ParamValues {
  const out: ParamValues = {};
  for (const p of bp.params ?? []) out[p.key] = p.defaultValue;
  return { ...out, ...overrides };
}

function layerMaterial(kind: PartMaterialKind): THREE.Material {
  if (kind === 'metal') return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.55 });
  if (kind === 'glass')
    return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55 });
  if (kind === 'glow') return new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  return kitMaterial;
}

const shades = (s: PartLayerSpec) => s.shade ?? ((s.material ?? 'matte') === 'matte' || s.material === 'metal');

/** The lowest point of the shaded layers: the floor every layer's foot shade is measured from. */
function footOf(specs: PartLayerSpec[]): number | undefined {
  let lo = Infinity;
  for (const s of specs) {
    if (!shades(s)) continue;
    for (const p of s.parts) {
      p.computeBoundingBox();
      lo = Math.min(lo, p.boundingBox!.min.y);
    }
  }
  return Number.isFinite(lo) ? lo : undefined;
}

const trianglesOf = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** Builds the model for a scene. Throws if a layer names a parent that isn't an earlier layer. */
export function compileModel(bp: ModelBlueprint, overrides: ParamValues = {}): CompiledModel {
  const params = resolveParams(bp, overrides);
  const specs = bp.buildParts(params).filter((s) => s.parts.length > 0);
  const foot = footOf(specs);

  const root = new THREE.Group();
  root.name = bp.id;
  const rigs: Record<string, THREE.Object3D> = {};
  const pivots = new Map<string, readonly [number, number, number]>();
  const parts: CompiledPart[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  for (const spec of specs) {
    if (rigs[spec.id]) throw new Error(`${bp.id}: two layers named "${spec.id}"`);
    if (spec.parent && !rigs[spec.parent])
      throw new Error(`${bp.id}: layer "${spec.id}" rides on "${spec.parent}", which isn't an earlier layer`);
    const kind = spec.material ?? 'matte';
    const pivot = spec.pivot ?? [0, 0, 0];
    pivots.set(spec.id, pivot);

    const geometry = merge(spec.parts, shades(spec), foot);
    geometry.translate(-pivot[0], -pivot[1], -pivot[2]);
    geometries.push(geometry);
    const material = layerMaterial(kind);
    if (material !== kitMaterial) materials.push(material);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${spec.id}:mesh`;
    mesh.castShadow = mesh.receiveShadow = kind !== 'glow' && kind !== 'glass';
    const group = new THREE.Group();
    group.name = spec.id;
    group.add(mesh);
    const base = spec.parent ? pivots.get(spec.parent)! : ([0, 0, 0] as const);
    group.position.set(pivot[0] - base[0], pivot[1] - base[1], pivot[2] - base[2]);
    (spec.parent ? rigs[spec.parent] : root).add(group);
    rigs[spec.id] = group;

    parts.push({
      id: spec.id,
      label: spec.label,
      material: kind,
      parent: spec.parent,
      pivot: spec.pivot,
      triangles: trianglesOf(geometry),
      group,
      mesh,
    });
  }

  const animate = bp.animate;
  return {
    root,
    rigs,
    parts,
    params,
    animate: animate ? (t, env) => animate(rigs, t, params, env) : undefined,
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}

/**
 * The model in its rest pose as one geometry, for one draw call per copy (`new THREE.InstancedMesh(geo,
 * kitMaterial, n)`): each layer shaded as in `compileModel`, then joined. Glow and glass lose their
 * own materials here; use `compileModel` where they matter.
 */
export function mergedGeometry(bp: ModelBlueprint, overrides: ParamValues = {}): THREE.BufferGeometry {
  const specs = bp.buildParts(resolveParams(bp, overrides)).filter((s) => s.parts.length > 0);
  const foot = footOf(specs);
  const layers = specs.map((s) => merge(s.parts, shades(s), foot));
  const g = mergeGeometries(layers);
  for (const l of layers) l.dispose();
  return g;
}

/** Every value each parameter can take alone (the defaults, then one parameter changed at a time). */
export function paramVariants(bp: ModelBlueprint): ParamValues[] {
  const base = resolveParams(bp);
  const out: ParamValues[] = [base];
  for (const p of bp.params ?? []) {
    if (p.kind === 'boolean') {
      out.push({ ...base, [p.key]: !p.defaultValue });
    } else if (p.kind === 'select') {
      for (const o of p.options ?? []) {
        if (o.value !== p.defaultValue) out.push({ ...base, [p.key]: o.value });
      }
    } else if (p.kind === 'color') {
      out.push({ ...base, [p.key]: '#3a7bd5' });
    }
  }
  return out;
}

/** What a model must be to join the library; an empty list when it is. */
export function validateBlueprint(bp: ModelBlueprint): string[] {
  const errors: string[] = [];
  const fail = (s: string) => errors.push(`${bp.id}: ${s}`);
  if (!/^lib:[a-z0-9]+(_[a-z0-9]+)*$/.test(bp.id)) fail('the id is "lib:" then snake case');
  if (!bp.name.trim() || !bp.nameFr.trim()) fail('a name in English and in French');
  if (!bp.subcategory.trim() || !bp.description.trim()) fail('a subcategory and a description');
  if (!bp.recipe.length) fail('a recipe line at least');
  for (const t of bp.tags)
    if (t !== t.toLowerCase() || t.startsWith('#') || /\s/.test(t)) fail(`the tag "${t}" is lower case, without # or spaces`);
  if (!(bp.footprint[0] > 0 && bp.footprint[1] > 0)) fail('a footprint of at least one tile');
  const keys = new Set<string>();
  for (const p of bp.params ?? []) {
    if (keys.has(p.key)) fail(`two parameters "${p.key}"`);
    keys.add(p.key);
    if (p.kind === 'select' && !(p.options ?? []).some((o) => o.value === p.defaultValue))
      fail(`"${p.key}"'s default is one of its options`);
    if (p.kind === 'boolean' && typeof p.defaultValue !== 'boolean') fail(`"${p.key}"'s default is true or false`);
    if (p.kind === 'color' && !/^#[0-9a-f]{6}$/i.test(String(p.defaultValue))) fail(`"${p.key}"'s default is a '#rrggbb' colour`);
  }
  // Mandatory Low-Poly Rule: any procedural library model must stay within low-poly ceiling (max 1400 triangles).
  try {
    const compiled = compileModel(bp);
    const totalTris = compiled.parts.reduce((sum, p) => sum + p.triangles, 0);
    compiled.dispose();
    if (totalTris > 1400) {
      fail(`exceeds low-poly budget ceiling (${totalTris} triangles, maximum allowed is 1400)`);
    }
  } catch (err) {
    fail(`compile failed during validation: ${String(err)}`);
  }
  return errors;
}
