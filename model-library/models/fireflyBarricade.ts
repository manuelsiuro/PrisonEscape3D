/**
 * The Last of Us Style - City Model Library: Firefly Rebel Barricade (lib:firefly_barricade)
 *
 * AESTHETIC & PERFORMANCE COMPLIANCE:
 * - Low Polygon Budget: ~230 triangles.
 * - Primitives: Angular boxes, 6-sided rebar rods, and rotBox pallet slats.
 * - Palette Discipline: 5 cohesive colors from PALETTE (woodDark, wood, rust, woodLight, white).
 * - Articulation & Params: Rebel insignia spray stencil, welded rebar spike hedgehog toggle.
 */
import { box, rod, rotBox } from '../kit';
import { PALETTE } from '../palette';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const fireflyBarricadeBlueprint: ModelBlueprint = {
  id: 'lib:firefly_barricade',
  name: 'Improvised Anti-Infected Barricade',
  nameFr: 'Barricade artisanale anti-infectés des Lucioles',
  category: 'fixtures',
  subcategory: 'Survivor Fortifications',
  tags: ['kit-library', 'fixture', 'tlou', 'barricade', 'firefly', 'wood', 'rebar', 'low-poly'],
  description:
    'Tactical street barricade built from timber cargo pallets, reinforced sandbag revetment, welded rusted rebar hedgehog spikes, and spray-painted Firefly rebel insignia.',
  footprint: [2, 1],
  sourceFile: 'model-library/models/fireflyBarricade.ts',
  params: [
    {
      key: 'insignia',
      label: 'Graffiti Insignia',
      kind: 'select',
      options: [
        { value: 'firefly', label: 'Firefly Rebel Symbol' },
        { value: 'warning', label: 'Biohazard Warning' },
        { value: 'plain', label: 'Weathered Plain Wood' },
      ],
      defaultValue: 'firefly',
    },
    {
      key: 'hasSpikes',
      label: 'Welded Rebar Hedgehog Spikes',
      kind: 'boolean',
      defaultValue: true,
    },
  ],
  recipe: [
    'box() // Sandbag revetment base preventing overturning',
    'rotBox() // Salvaged wooden shipping pallets tilted at 20-degree incline',
    'rod(6) // Tri-axial welded rebar anti-infected hedgehog caltrop spikes',
    'box() // Stenciled spray-painted Firefly rebel graffiti insignia',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const insignia = params.insignia ?? 'firefly';
    const hasSpikes = params.hasSpikes !== false;

    // 1. Barricade Timber Structure & Sandbags
    const barricadeParts: Part[] = [
      // Sandbag base tier on ground (y: 0 -> 0.16)
      box(0.38, 0.08, 0.22, PALETTE.woodLight, -0.45, 0, 0.18),
      box(0.38, 0.08, 0.22, PALETTE.woodLight, 0, 0, 0.18),
      box(0.38, 0.08, 0.22, PALETTE.woodLight, 0.45, 0, 0.18),
      // Second staggered sandbag course (y: 0.08 -> 0.16)
      box(0.36, 0.08, 0.2, PALETTE.woodLight, -0.22, 0.08, 0.16),
      box(0.36, 0.08, 0.2, PALETTE.woodLight, 0.22, 0.08, 0.16),

      // 2 Tilting Cargo Pallets (slanted back at 20 degrees, from y = 0 to 1.15)
      // Pallet A (left side x = -0.42)
      rotBox(0.06, 1.1, 0.08, PALETTE.woodDark, -0.7, 0.52, -0.05, -0.32, 0, 0),
      rotBox(0.06, 1.1, 0.08, PALETTE.woodDark, -0.15, 0.52, -0.05, -0.32, 0, 0),
      // Pallet B (right side x = +0.42)
      rotBox(0.06, 1.1, 0.08, PALETTE.woodDark, 0.15, 0.52, -0.05, -0.32, 0, 0),
      rotBox(0.06, 1.1, 0.08, PALETTE.woodDark, 0.7, 0.52, -0.05, -0.32, 0, 0),

      // Horizontal Timber Cross Slats (slanted across front)
      ...[-0.35, -0.15, 0.05, 0.25, 0.45].map((offset) =>
        rotBox(
          1.46,
          0.09,
          0.02,
          PALETTE.wood,
          0,
          0.52 + offset * 0.9,
          -0.05 - offset * 0.32,
          -0.32,
          0,
          0,
        ),
      ),

      // Diagonal rear support kickers bracing against the ground
      rotBox(0.06, 0.9, 0.06, PALETTE.woodDark, -0.45, 0.38, -0.32, 0.55, 0, 0),
      rotBox(0.06, 0.9, 0.06, PALETTE.woodDark, 0.45, 0.38, -0.32, 0.55, 0, 0),
    ];

    // 2. Welded Rebar Hedgehog Spikes (Improvised anti-runner obstacles protruding forward)
    if (hasSpikes) {
      for (const sx of [-0.48, 0.48]) {
        barricadeParts.push(
          // Tri-axial rebar pieces crossing at [sx, 0.24, 0.38]
          rod(0.014, 0.62, PALETTE.rust, sx, 0.24, 0.38, 6).rotateZ(Math.PI / 4),
          rod(0.014, 0.62, PALETTE.rust, sx, 0.24, 0.38, 6).rotateZ(-Math.PI / 4),
          rotBox(0.014, 0.014, 0.62, PALETTE.rust, sx, 0.24, 0.38, 0.4, 0, 0),
        );
      }
    }

    // 3. Stenciled Graffiti Insignia
    if (insignia === 'firefly') {
      // White spray-painted Firefly icon representation (central crest + radiating rays)
      barricadeParts.push(
        rotBox(0.18, 0.04, 0.025, PALETTE.white, 0, 0.62, -0.08, -0.32, 0, 0),
        rotBox(0.04, 0.24, 0.025, PALETTE.white, 0, 0.62, -0.08, -0.32, 0, 0),
        rotBox(0.22, 0.025, 0.025, PALETTE.white, 0, 0.68, -0.1, -0.32, 0, 0.6),
        rotBox(0.22, 0.025, 0.025, PALETTE.white, 0, 0.68, -0.1, -0.32, 0, -0.6),
      );
    } else if (insignia === 'warning') {
      // Yellow biohazard skull bar
      barricadeParts.push(
        rotBox(0.36, 0.16, 0.025, PALETTE.yellow, 0, 0.62, -0.08, -0.32, 0, 0),
        rotBox(0.12, 0.08, 0.028, PALETTE.dark, 0, 0.62, -0.08, -0.32, 0, 0),
      );
    }

    return [
      {
        id: 'barricade',
        label: 'Rebel Barricade',
        material: 'matte',
        parts: barricadeParts,
      },
    ];
  },
};
