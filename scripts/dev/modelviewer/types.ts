import type * as THREE from 'three';

/** Top-level categories in the 3D Objects Viewer. */
export type ModelCategory = 'props' | 'decor' | 'items' | 'characters' | 'animals' | 'vehicles' | 'fixtures' | 'architecture';

/** Catalog source pack: today's game models + extensible V2 procedural object libraries. */
export type CatalogLibraryId = 'all' | 'game' | 'kit-library';

export interface CatalogLibraryInfo {
  id: CatalogLibraryId;
  name: string;
  badge: string;
  description: string;
}

export interface VariantOption {
  value: string | number;
  label: string;
}

export interface ModelVariantControl {
  key: string;
  label: string;
  kind: 'select' | 'boolean' | 'number' | 'color';
  options?: VariantOption[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue: string | number | boolean;
}

export interface BuildContext {
  /** Current variant values keyed by `ModelVariantControl.key`. */
  variants: Record<string, string | number | boolean>;
  /** Whether night/glow mode is active in the stage (0 day … 1 night). */
  night: number;
  /** Power state (0 cut … 1 on). */
  power: number;
}

export interface BuiltModel {
  root: THREE.Object3D;
  /** Optional per-frame animation callback (`t` in seconds, `dt` in seconds). */
  animate?: (t: number, dt: number, ctx: BuildContext) => void;
  /** Optional cleanup for custom geometries/textures/materials. */
  dispose?: () => void;
  /** Optional procedural kit recipe summary for the inspector (V2 library & kit breakdown). */
  recipe?: string[];
}

export interface ModelEntry {
  /** Unique identifier, e.g. `prop:workbench`, `item:shovel`, `lib:guard_booth_modular`. */
  id: string;
  /** Which library this object belongs to (`game` or `kit-library`). */
  library: Exclude<CatalogLibraryId, 'all'>;
  /** Display name. */
  name: string;
  /** French display name (optional, for bilingual search/inspection). */
  nameFr?: string;
  /** Primary category. */
  category: ModelCategory;
  /** Optional subcategory grouping (e.g. `Gym`, `Workshops`, `Wall Decor`, `Tools`, `Weapons`). */
  subcategory: string;
  /** Searchable and clickable filter tags. */
  tags: string[];
  /** Source file in the repository where the procedural builder lives. */
  sourceFile: string;
  /** Builder symbol or function name. */
  builderName: string;
  /** Concise description of the model and its construction. */
  description: string;
  /** Default tile footprint `[w, d]` if tile-based. */
  footprint?: [number, number];
  /** Whether this model hangs on a north wall at `z = -d/2` or `z = 0` (auto-shows reference wall). */
  wallMounted?: boolean;
  /** Interactive variant controls shown in the right-hand inspector. */
  variants?: ModelVariantControl[];
  /** Builds a fresh Three.js Object3D hierarchy for the viewer stage. */
  build: (ctx: BuildContext) => BuiltModel;
}

export interface ModelStats {
  meshes: number;
  vertices: number;
  triangles: number;
  width: number;
  height: number;
  depth: number;
  colors: string[];
}
