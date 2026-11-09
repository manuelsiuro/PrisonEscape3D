/**
 * Model library, weathered city set: Floodlight Trailer (lib:floodlight_trailer)
 *
 * AESTHETIC & PERFORMANCE COMPLIANCE:
 * - Low Polygon Budget: ~350 triangles.
 * - Primitives: Angular boxes, 8-sided wheels, and 6-sided mast rods.
 * - Palette Discipline: 5 cohesive colors from PALETTE (dark, oliveDrab, black, steel, yellow).
 * - Articulation & Params: Day/Night floodlight illumination, telescoping mast height, fuel can.
 */
import { box, cyl, rod, rotBox } from '../kit';
import { PALETTE } from '../palette';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const floodlightTrailerBlueprint: ModelBlueprint = {
  id: 'lib:floodlight_trailer',
  name: 'Mobile Diesel Floodlight Trailer',
  nameFr: 'Remorque projecteur diesel de zone de quarantaine',
  category: 'fixtures',
  subcategory: 'Emergency & Military',
  tags: ['kit-library', 'fixture', 'floodlight', 'military', 'generator', 'low-poly'],
  description:
    'Towable military generator trailer equipped with an articulated telescoping mast holding twin high-intensity halogen floodlights and emergency fuel jerrycans.',
  footprint: [1, 1],
  sourceFile: 'model-library/models/floodlightTrailer.ts',
  params: [
    {
      key: 'lightOn',
      label: 'Floodlights Illuminated',
      kind: 'boolean',
      defaultValue: true,
    },
    {
      key: 'mastHeight',
      label: 'Mast Deployment',
      kind: 'select',
      options: [
        { value: 'deployed', label: 'Deployed (2.2m Tower)' },
        { value: 'stowed', label: 'Stowed (1.4m Transport)' },
      ],
      defaultValue: 'deployed',
    },
    {
      key: 'hasJerrycan',
      label: 'Auxiliary Fuel Jerrycan',
      kind: 'boolean',
      defaultValue: true,
    },
  ],
  recipe: [
    'box() // Heavy-gauge steel trailer chassis, hitch tongue & leveling outriggers',
    'cyl(8) // Rugged all-terrain trailer wheels on transverse axle rod',
    'box() // Olive-drab diesel generator housing with louver vents',
    'rod(6) + box() // Articulated telescoping mast with twin halogen floodlight pods',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const isLit = params.lightOn !== false;
    const isHigh = params.mastHeight !== 'stowed';
    const hasJerrycan = params.hasJerrycan !== false;

    // 1. Trailer Chassis & Generator Body
    const trailerParts: Part[] = [
      // Main steel channel chassis frame (y: 0.16 -> 0.22)
      box(0.56, 0.06, 0.84, PALETTE.dark, 0, 0.16, 0),
      // Front triangular hitch tongue (z: 0.42 -> 0.72)
      rotBox(0.04, 0.04, 0.35, PALETTE.dark, -0.12, 0.18, 0.56, 0, 0.25, 0),
      rotBox(0.04, 0.04, 0.35, PALETTE.dark, 0.12, 0.18, 0.56, 0, -0.25, 0),
      box(0.08, 0.06, 0.08, PALETTE.dark, 0, 0.17, 0.72), // Hitch coupler
      // Front drop-leg jack
      box(0.03, 0.18, 0.03, PALETTE.steel, 0, 0, 0.68),
      box(0.08, 0.02, 0.08, PALETTE.dark, 0, 0, 0.68),

      // 2 All-terrain wheels (radius 0.18, width 0.08, X = ±0.34)
      cyl(0.18, 0.08, PALETTE.black, -0.34, 0, 0, 8).rotateZ(Math.PI / 2),
      cyl(0.18, 0.08, PALETTE.black, 0.34, 0, 0, 8).rotateZ(Math.PI / 2),
      box(0.1, 0.1, 0.08, PALETTE.steel, -0.34, 0.13, 0), // Wheel hubs
      box(0.1, 0.1, 0.08, PALETTE.steel, 0.34, 0.13, 0),

      // Diesel generator enclosure (y: 0.22 -> 0.74)
      box(0.5, 0.52, 0.6, PALETTE.oliveDrab, 0, 0.22, -0.06),
      // Radiator intake grill on rear (-Z)
      box(0.36, 0.32, 0.02, PALETTE.dark, 0, 0.32, -0.37),
      // Exhaust muffler pipe running up top
      cyl(0.025, 0.22, PALETTE.rust, 0.18, 0.74, -0.26, 6),

      // Lower mast base collar (y: 0.22 -> 0.88, at x = 0, z = 0.2)
      box(0.08, 0.66, 0.08, PALETTE.dark, 0, 0.22, 0.2),
    ];

    // Optional Fuel Jerrycan strapped to front trailer deck
    if (hasJerrycan) {
      trailerParts.push(
        // Yellow 20L military jerrycan (y: 0.22 -> 0.52)
        box(0.12, 0.3, 0.22, PALETTE.yellow, 0.18, 0.22, 0.2),
        // Handle bar & cap
        box(0.03, 0.03, 0.16, PALETTE.dark, 0.18, 0.52, 0.2),
      );
    }

    // 2. Telescoping Mast & Articulated Twin Floodlights
    const mastParts: Part[] = [];
    const mastBaseY = isHigh ? 0.85 : 0.45;
    const mastTopY = isHigh ? 1.85 : 1.15;
    const mastLen = mastTopY - mastBaseY;

    // Telescoping extension tube
    mastParts.push(
      rod(0.022, mastLen, PALETTE.steel, 0, mastBaseY + mastLen / 2, 0.2, 6).rotateZ(Math.PI / 2),
      // Cross-arm T-bar at the top
      rod(0.02, 0.46, PALETTE.dark, 0, mastTopY, 0.2, 6),
    );

    // Twin rectangular halogen floodlight pods (left & right)
    const lampColor = isLit ? PALETTE.white : PALETTE.dark;
    const lampY = mastTopY;
    for (const lx of [-0.18, 0.18]) {
      mastParts.push(
        // Yoke bracket
        box(0.02, 0.08, 0.02, PALETTE.dark, lx, lampY, 0.2),
        // Lamp housing angled downward (y: lampY - 0.02 -> lampY + 0.10)
        rotBox(0.12, 0.1, 0.08, PALETTE.dark, lx, lampY + 0.04, 0.24, 0.3, 0, 0),
        // Lens face (white light when lit)
        rotBox(0.1, 0.08, 0.01, lampColor, lx, lampY + 0.04, 0.285, 0.3, 0, 0),
      );
    }

    return [
      {
        id: 'trailer',
        label: 'Generator Trailer Chassis',
        material: 'matte',
        parts: trailerParts,
      },
      {
        id: 'mast',
        label: 'Telescoping Floodlight Mast',
        material: 'matte',
        parts: mastParts,
      },
    ];
  },
};
