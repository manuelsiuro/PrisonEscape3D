/**
 * The model library's contract. A model is a `ModelBlueprint`: data about the object (names, category,
 * tags, footprint, its parameters) and a pure `buildParts` that turns parameter values into named part
 * layers. `compile.ts` turns a blueprint into a Three.js group (one mesh per layer, articulated layers
 * on their pivots) or into a single merged geometry for an `InstancedMesh`.
 *
 * MANDATORY DESIGN CRITERIA:
 * - Minimal Polygon Count: Built close to the game's original models (50–250 tris for props, 200–600 for machinery).
 * - Palette Discipline: Every model must use 2 to 5 cohesive colors from `PALETTE` (`palette.ts`).
 */
import type * as THREE from 'three';

/** One vertex-coloured primitive in model space (from `kit.ts`). */
export type Part = THREE.BufferGeometry;

/** The 3D Objects Studio's categories. */
export type LibraryCategory = 'props' | 'decor' | 'items' | 'characters' | 'animals' | 'vehicles' | 'fixtures' | 'architecture';

/** A layer's surface: `matte` is the game's `kitMaterial`; `glow` is unlit (lamps, LEDs, screens). */
export type PartMaterialKind = 'matte' | 'metal' | 'glass' | 'glow';

/** A parameter's value. Colours are `'#rrggbb'` strings. */
export type ParamValue = string | number | boolean;
export type ParamValues = Record<string, ParamValue>;

export interface ParamOption {
  value: string | number;
  label: string;
}

/** A parameter the Studio shows as a control (and any game can set). */
export interface ParamControl {
  key: string;
  label: string;
  kind: 'select' | 'boolean' | 'color';
  /** The choices of a `select`. */
  options?: ParamOption[];
  defaultValue: ParamValue;
}

/**
 * A named layer of parts: one mesh, one material.
 * - Without `pivot` it is fixed to the model.
 * - With `pivot` (a point in model space) it gets its own group on that point, so turning
 *   `rigs[id].rotation` turns it about the pivot (a hinge, a joint, a rotor).
 * - With `parent` (an earlier layer's id) it rides on that layer: an arm's boom, then its stick, then its bucket.
 * Parts are always written in model space; the compiler moves them onto the pivot.
 */
export interface PartLayerSpec {
  id: string;
  label: string;
  material?: PartMaterialKind;
  /** Bake the foot shade; true by default for `matte` and `metal`. */
  shade?: boolean;
  pivot?: readonly [number, number, number];
  parent?: string;
  parts: Part[];
}

/** What the scene tells an animation: night (0 day … 1 night) and power (0 cut … 1 on). */
export interface AnimationEnv {
  night: number;
  power: number;
}

/** A model of the library. */
export interface ModelBlueprint {
  /** Unique, `lib:` then snake case: `'lib:espresso_machine'`. */
  id: string;
  name: string;
  nameFr: string;
  category: LibraryCategory;
  subcategory: string;
  /** Lower case, no leading `#`. */
  tags: string[];
  description: string;
  /** Tiles it stands on, `[w, d]` (a tile is 1 unit). */
  footprint: [number, number];
  /** Hangs on a wall: its back against z = -0.5, the wall the Studio shows behind it. */
  wallMounted?: boolean;
  /** This file, from the repository's root (shown in the Studio, checked by `modellibrarytest`). */
  sourceFile: string;
  params?: ParamControl[];
  /** A few lines on how it is built, for the Studio's inspector. */
  recipe: string[];
  /** Pure: the same values always give the same parts (no `Math.random`, no clock). */
  buildParts: (params: ParamValues) => PartLayerSpec[];
  /** Moves the layers' groups (`rigs[layerId]`) for time `t` (seconds). Optional. */
  animate?: (rigs: Record<string, THREE.Object3D>, t: number, params: ParamValues, env: AnimationEnv) => void;
}

/** A compiled layer, with its counts for the inspector. */
export interface CompiledPart {
  id: string;
  label: string;
  material: PartMaterialKind;
  parent?: string;
  pivot?: readonly [number, number, number];
  triangles: number;
  group: THREE.Group;
  mesh: THREE.Mesh;
}

export interface CompiledModel {
  root: THREE.Group;
  rigs: Record<string, THREE.Object3D>;
  parts: CompiledPart[];
  params: ParamValues;
  animate?: (t: number, env: AnimationEnv) => void;
  /** Frees the geometries and the layer materials (the shared `kitMaterial` is kept). */
  dispose: () => void;
}
