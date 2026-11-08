/**
 * The Last of Us Style - City Model Library: Cordyceps Fungal Growth (lib:cordyceps_growth)
 *
 * AESTHETIC & PERFORMANCE COMPLIANCE:
 * - Low Polygon Budget: ~190 triangles.
 * - Primitives: Angular boxes, 8-sided fungal shelf discs, and bulbous spore pods.
 * - Palette Discipline: 5 cohesive colors from PALETTE (dark, concreteGrey, rust, amberGlow, woodLight).
 * - Articulation & Params: Spore emission bioluminescence toggle, colony scale.
 */
import { box, cyl, rotBox } from '../kit';
import { PALETTE } from '../palette';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const cordycepsGrowthBlueprint: ModelBlueprint = {
  id: 'lib:cordyceps_growth',
  name: 'Cordyceps Fungal Wall Colony',
  nameFr: 'Colonie murale de champignon Cordyceps',
  category: 'props',
  subcategory: 'Environmental Hazard',
  tags: ['kit-library', 'prop', 'tlou', 'cordyceps', 'fungus', 'infection', 'hazard', 'low-poly'],
  description:
    'Eerie biomorphic fungal growth encrusting a decayed wall and metal vent, with tiered bracket shelf mushrooms, spore tendrils, and bioluminescent amber spore pods.',
  footprint: [1, 1],
  wallMounted: true,
  sourceFile: 'model-library/models/cordycepsGrowth.ts',
  params: [
    {
      key: 'sporeState',
      label: 'Spore Glow Activity',
      kind: 'select',
      options: [
        { value: 'glowing', label: 'Bioluminescent Spores' },
        { value: 'dormant', label: 'Dormant Desiccated' },
      ],
      defaultValue: 'glowing',
    },
    {
      key: 'colonyDensity',
      label: 'Fungal Growth Density',
      kind: 'select',
      options: [
        { value: 'dense', label: 'Dense Wall Cluster' },
        { value: 'sparse', label: 'Emerging Infection' },
      ],
      defaultValue: 'dense',
    },
  ],
  recipe: [
    'box() // Crumbling masonry wall pillar and rusted ventilation duct',
    'box() // Fibrous dark brown mycelium mat encrusting the structural corner',
    'disc(8) // Tiered horizontal bracket fungi / shelf mushroom ledges',
    'cyl(8) + box() // Bulbous amber spore pustules and desiccated root tendrils',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const isGlowing = params.sporeState !== 'dormant';
    const isDense = params.colonyDensity !== 'sparse';
    const sporeColor = isGlowing ? PALETTE.amberGlow : PALETTE.rust;

    // 1. Decayed Wall & Vent Host Structure
    const hostParts: Part[] = [
      // Crumbled concrete back wall segment (y: 0 -> 1.5, z = -0.32)
      box(0.88, 1.5, 0.16, PALETTE.concreteGrey, 0, 0, -0.32),
      // Rusted metal ventilation conduit running vertically (x = -0.22)
      box(0.24, 1.5, 0.2, PALETTE.rust, -0.22, 0, -0.16),

      // Fibrous dark mycelium crust coating the host surfaces
      box(0.68, 1.1, 0.06, PALETTE.dark, 0.05, 0.25, -0.22),
      box(0.3, 0.85, 0.08, PALETTE.dark, -0.22, 0.35, -0.04),
    ];

    // 2. Fungal Bracket Shelves (Horizontal mushroom plates protruding forward)
    const fungalParts: Part[] = [];

    // Main central tiered shelf mushrooms (discs & rotBoxes)
    fungalParts.push(
      // Lower large shelf (y = 0.52, z = -0.1)
      rotBox(0.34, 0.04, 0.26, PALETTE.woodLight, 0.08, 0.52, -0.1, 0.08, 0, 0.1),
      box(0.28, 0.02, 0.22, sporeColor, 0.08, 0.54, -0.1),

      // Mid-height fan shelf (y = 0.82)
      rotBox(0.28, 0.035, 0.22, PALETTE.woodLight, -0.06, 0.82, -0.06, -0.05, 0, -0.15),
      box(0.22, 0.02, 0.18, sporeColor, -0.06, 0.84, -0.06),

      // High shelf protruding from rusted vent (y = 1.12)
      rotBox(0.22, 0.03, 0.18, PALETTE.woodLight, -0.18, 1.12, 0.02, 0.12, 0.1, 0),
    );

    // 3. Bulbous Spore Pustules & Pod Clusters
    fungalParts.push(
      // Cluster of 3 amber spore pods on the mid shelf
      cyl(0.04, 0.07, sporeColor, 0.14, 0.55, -0.08, 6),
      cyl(0.03, 0.05, sporeColor, 0.05, 0.55, -0.04, 6),
      cyl(0.035, 0.06, sporeColor, 0.12, 0.55, -0.14, 6),

      // Spore pods clinging to the metal duct
      cyl(0.045, 0.08, sporeColor, -0.22, 0.72, 0.05, 6),
      cyl(0.03, 0.05, sporeColor, -0.26, 0.95, 0.05, 6),
    );

    // Extra density details if dense colony
    if (isDense) {
      fungalParts.push(
        // Extra low shelf near base floor
        rotBox(0.38, 0.04, 0.24, PALETTE.woodLight, 0.16, 0.22, -0.14, -0.1, 0, 0.1),
        cyl(0.05, 0.09, sporeColor, 0.22, 0.25, -0.12, 6),
        // Creeping tendril roots across concrete
        rotBox(0.03, 0.42, 0.02, PALETTE.dark, 0.28, 0.78, -0.22, 0, 0, 0.35),
        rotBox(0.025, 0.36, 0.02, PALETTE.dark, -0.08, 1.25, -0.22, 0, 0, -0.4),
      );
    }

    return [
      {
        id: 'host_wall',
        label: 'Decayed Wall & Duct',
        material: 'matte',
        parts: hostParts,
      },
      {
        id: 'cordyceps',
        label: 'Cordyceps Fungal Colony',
        material: isGlowing ? 'metal' : 'matte',
        parts: fungalParts,
      },
    ];
  },
  animate: (rigs, t) => {
    // Subtle pulsating breathing motion on the fungal cluster
    const cordyceps = rigs.cordyceps;
    if (cordyceps) {
      const pulse = 1.0 + Math.sin(t * 2.0) * 0.02;
      cordyceps.scale.set(pulse, pulse, pulse);
    }
  },
};
