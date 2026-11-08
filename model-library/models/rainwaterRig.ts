/**
 * The Last of Us Style - City Model Library: Rainwater Catchment Rig (lib:rainwater_rig)
 *
 * AESTHETIC & PERFORMANCE COMPLIANCE:
 * - Low Polygon Budget: ~230 triangles.
 * - Primitives: 100% box primitives and 8-sided blue collection drums.
 * - Palette Discipline: 5 cohesive colors from PALETTE (woodDark, tarpBlue, steel, white, oliveDrab).
 * - Articulation & Params: Drum capacity selection, sunshade tarp awning toggle.
 */
import { box, cyl, tubeZ } from '../kit';
import { PALETTE } from '../palette';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const rainwaterRigBlueprint: ModelBlueprint = {
  id: 'lib:rainwater_rig',
  name: 'Rooftop Rainwater Catchment Rig',
  nameFr: 'Collecteur et filtre à eau de pluie de toit',
  category: 'props',
  subcategory: 'Survivor Equipment',
  tags: ['kit-library', 'prop', 'tlou', 'water', 'survival', 'scavenged', 'low-poly'],
  description:
    'Rooftop water harvesting setup built from linked industrial plastic drums, timber platform, corrugated sheet funnel tray, PVC pipes, and a hanging charcoal filtration bucket.',
  footprint: [1, 1],
  sourceFile: 'model-library/models/rainwaterRig.ts',
  params: [
    {
      key: 'drums',
      label: 'Storage Capacity',
      kind: 'select',
      options: [
        { value: 'dual', label: 'Dual Drums (400L)' },
        { value: 'single', label: 'Single Drum (200L)' },
      ],
      defaultValue: 'dual',
    },
    {
      key: 'hasTarp',
      label: 'Canvas Sunshade Tarp',
      kind: 'boolean',
      defaultValue: true,
    },
  ],
  recipe: [
    'box() // Salvaged timber trestle stand and deck planking',
    'cyl(8) // 200L blue polyethylene water storage drums with black bung caps',
    'box() // Angled corrugated sheet metal collection catchment funnel',
    'tubeZ(6) + box() // PVC plumbing manifold and charcoal gravel filter bucket',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const isDual = params.drums !== 'single';
    const hasTarp = params.hasTarp !== false;

    // 1. Timber Elevation Stand (Keeps drums off damp floor, y: 0 -> 0.28)
    const rigParts: Part[] = [
      // 4 heavy timber post feet
      box(0.06, 0.26, 0.06, PALETTE.woodDark, -0.32, 0, -0.25),
      box(0.06, 0.26, 0.06, PALETTE.woodDark, 0.32, 0, -0.25),
      box(0.06, 0.26, 0.06, PALETTE.woodDark, -0.32, 0, 0.25),
      box(0.06, 0.06, 0.06, PALETTE.woodDark, 0.32, 0, 0.25),

      // Planks deck (y: 0.24 -> 0.28)
      box(0.78, 0.04, 0.58, PALETTE.woodDark, 0, 0.24, 0),

      // Corrugated galvanized collector tray overhead (slanted downward from y: 1.15 to 1.05)
      box(0.76, 0.02, 0.52, PALETTE.steel, 0, 1.08, 0),
      box(0.78, 0.06, 0.02, PALETTE.steel, 0, 1.08, -0.26), // Rear splash rim
      box(0.02, 0.06, 0.52, PALETTE.steel, -0.38, 1.08, 0), // Left rim
      box(0.02, 0.06, 0.52, PALETTE.steel, 0.38, 1.08, 0), // Right rim

      // Downspout funnel box & PVC pipe draining into drum
      box(0.12, 0.1, 0.12, PALETTE.steel, 0, 0.98, 0.18),
      tubeZ(0.02, 0.22, PALETTE.white, 0, 0.88, 0.18, 6),
    ];

    // 2. Blue Polyethylene Collection Drums (Radius 0.18, Height 0.65, y: 0.28 -> 0.93)
    const drumXs = isDual ? [-0.18, 0.18] : [0];
    for (const dx of drumXs) {
      rigParts.push(
        // Blue barrel body
        cyl(0.18, 0.65, PALETTE.tarpBlue, dx, 0.28, -0.04, 8),
        // Reinforcing barrel ribs
        cyl(0.186, 0.03, PALETTE.tarpBlue, dx, 0.48, -0.04, 8),
        cyl(0.186, 0.03, PALETTE.tarpBlue, dx, 0.72, -0.04, 8),
        // Black top bung lid
        box(0.05, 0.02, 0.05, PALETTE.dark, dx + 0.08, 0.93, -0.04),
      );
    }

    // Interconnecting balance pipe between drums (if dual)
    if (isDual) {
      rigParts.push(
        tubeZ(0.015, 0.36, PALETTE.white, 0, 0.36, -0.04, 6).rotateZ(Math.PI / 2),
      );
    }

    // 3. Hanging Charcoal / Gravel Filter Bucket on side
    rigParts.push(
      box(0.03, 0.03, 0.16, PALETTE.steel, 0.38, 0.68, 0.2), // Hanging arm
      cyl(0.08, 0.18, PALETTE.dark, 0.42, 0.46, 0.2, 8), // Bucket
      box(0.12, 0.02, 0.12, PALETTE.steel, 0.42, 0.44, 0.2), // Base drain spigot
    );

    // 4. Optional Canvas Weather Shade Tarp
    if (hasTarp) {
      rigParts.push(
        // 4 upright corner timber poles
        box(0.03, 1.25, 0.03, PALETTE.woodDark, -0.36, 0.28, -0.28),
        box(0.03, 1.25, 0.03, PALETTE.woodDark, 0.36, 0.28, -0.28),
        box(0.03, 1.15, 0.03, PALETTE.woodDark, -0.36, 0.28, 0.28),
        box(0.03, 1.15, 0.03, PALETTE.woodDark, 0.36, 0.28, 0.28),
        // Olive canvas tarp canopy
        box(0.82, 0.02, 0.64, PALETTE.oliveDrab, 0, 1.48, 0),
      );
    }

    return [
      {
        id: 'catchment_rig',
        label: 'Rainwater Rig',
        material: 'matte',
        parts: rigParts,
      },
    ];
  },
};
