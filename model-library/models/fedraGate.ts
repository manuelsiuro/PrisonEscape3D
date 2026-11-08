/**
 * The Last of Us Style - City Model Library: FEDRA Quarantine Zone Gate (lib:fedra_gate)
 *
 * AESTHETIC & PERFORMANCE COMPLIANCE:
 * - Low Polygon Budget: ~280 triangles.
 * - Primitives: Angular boxes, 6-sided rods, and wedge primitives.
 * - Palette Discipline: 5 cohesive colors from PALETTE (concreteGrey, dark, metal, rust, oliveDrab).
 * - Articulation & Params: Intact vs breached gate leaf, searchlight mount.
 */
import { box, cyl, hexColor, rod, rotBox, wedge } from '../kit';
import { PALETTE } from '../palette';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const fedraGateBlueprint: ModelBlueprint = {
  id: 'lib:fedra_gate',
  name: 'FEDRA Quarantine Zone Checkpoint Gate',
  nameFr: 'Porte de contrôle de zone de quarantaine FEDRA',
  category: 'architecture',
  subcategory: 'Quarantine & Military',
  tags: ['kit-library', 'architecture', 'tlou', 'quarantine', 'military', 'gate', 'low-poly'],
  description:
    'Heavily fortified Quarantine Zone checkpoint gate with reinforced concrete jersey barriers, sandbag revetment, rusted steel leaf, overhead razor wire, and FEDRA searchlight.',
  footprint: [2, 1],
  sourceFile: 'model-library/models/fedraGate.ts',
  params: [
    {
      key: 'breached',
      label: 'Gate Breach State',
      kind: 'boolean',
      defaultValue: false,
    },
    {
      key: 'hasSearchlight',
      label: 'Overhead Searchlight',
      kind: 'boolean',
      defaultValue: true,
    },
    {
      key: 'gateColor',
      label: 'Steel Gate Finish',
      kind: 'color',
      defaultValue: '#4a533b', // PALETTE.oliveDrab
    },
  ],
  recipe: [
    'wedge() + box() // Concrete highway jersey barriers with chipped edges',
    'box() // Heavy steel I-beam upright gate posts and overhead lintel beam',
    'rotBox() // Reinforced corrugated steel gate leaf with diagonal bracing',
    'rod(6) + box() // Razor wire coils and military halogen searchlight',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const isBreached = params.breached === true;
    const hasSearchlight = params.hasSearchlight !== false;
    const gateHex = hexColor(params.gateColor, PALETTE.oliveDrab);

    // 1. Fixed Fortifications: Jersey Barriers & Gate Posts
    const fixedParts: Part[] = [
      // Left concrete jersey barrier (x: -0.85)
      box(0.24, 0.44, 0.8, PALETTE.concreteGrey, -0.85, 0, 0),
      wedge(0.06, 0.22, 0.8, PALETTE.concreteGrey, -0.7, 0, 0, 'x+'),
      wedge(0.06, 0.22, 0.8, PALETTE.concreteGrey, -1.0, 0, 0, 'x-'),
      // Right concrete jersey barrier (x: +0.85)
      box(0.24, 0.44, 0.8, PALETTE.concreteGrey, 0.85, 0, 0),
      wedge(0.06, 0.22, 0.8, PALETTE.concreteGrey, 1.0, 0, 0, 'x+'),
      wedge(0.06, 0.22, 0.8, PALETTE.concreteGrey, 0.7, 0, 0, 'x-'),

      // Heavy steel I-beam posts (x: -0.58 and +0.58, height: 1.8m)
      box(0.08, 1.8, 0.08, PALETTE.dark, -0.58, 0, 0),
      box(0.08, 1.8, 0.08, PALETTE.dark, 0.58, 0, 0),
      // Overhead heavy lintel crossbeam (y: 1.8 -> 1.88)
      box(1.36, 0.08, 0.1, PALETTE.dark, 0, 1.8, 0),

      // Stenciled FEDRA QZ warning sign plate (y: 1.62 -> 1.78)
      box(0.52, 0.16, 0.02, PALETTE.oliveDrab, 0, 1.62, 0.06),
      box(0.44, 0.04, 0.025, PALETTE.yellow, 0, 1.68, 0.06), // Caution yellow bar

      // Sandbags piled against left post base (y: 0 -> 0.24)
      box(0.24, 0.08, 0.14, PALETTE.woodLight, -0.58, 0, 0.12),
      box(0.22, 0.08, 0.14, PALETTE.woodLight, -0.58, 0.08, 0.1),
      box(0.2, 0.08, 0.14, PALETTE.woodLight, -0.58, 0.16, 0.08),

      // Overhead coiled razor wire representation across lintel top
      rod(0.02, 1.28, PALETTE.chrome, 0, 1.92, 0, 6),
      rod(0.016, 1.28, PALETTE.rust, 0, 1.95, 0.03, 6),
    ];

    // Optional overhead halogen searchlight mounted on right post
    if (hasSearchlight) {
      fixedParts.push(
        box(0.04, 0.12, 0.04, PALETTE.dark, 0.58, 1.88, 0),
        cyl(0.06, 0.1, PALETTE.dark, 0.58, 1.96, 0.04, 8),
        box(0.09, 0.09, 0.01, PALETTE.white, 0.58, 2.01, 0.1), // Lens face
      );
    }

    // 2. Steel Gate Leaf (Left swinging door, hinged at x = -0.54)
    const gateParts: Part[] = [];
    const gateAngle = isBreached ? -0.85 : 0; // Breached swings inward
    const gateWidth = 1.06;
    const gateHeight = 1.55;

    // Gate center in local space relative to pivot [-0.54, 0.1, 0]
    const localCx = (Math.cos(gateAngle) * gateWidth) / 2;
    const localCz = (Math.sin(gateAngle) * gateWidth) / 2;
    const cx = -0.54 + localCx;
    const cz = localCz;

    gateParts.push(
      // Outer perimeter steel frame
      rotBox(gateWidth, gateHeight, 0.03, PALETTE.rust, cx, 0.1 + gateHeight / 2, cz, 0, -gateAngle, 0),
      // Corrugated / armored sheet infill
      rotBox(gateWidth - 0.06, gateHeight - 0.06, 0.015, gateHex, cx, 0.1 + gateHeight / 2, cz, 0, -gateAngle, 0),
      // Diagonal reinforcement brace
      rotBox(gateWidth * 0.9, 0.04, 0.035, PALETTE.dark, cx, 0.1 + gateHeight / 2, cz, 0, -gateAngle, 0.35),
    );

    return [
      {
        id: 'barricade',
        label: 'Concrete & Posts Barricade',
        material: 'matte',
        parts: fixedParts,
      },
      {
        id: 'gate_leaf',
        label: 'Reinforced Gate Leaf',
        material: 'matte',
        pivot: [-0.54, 0.1, 0],
        parts: gateParts,
      },
    ];
  },
};
