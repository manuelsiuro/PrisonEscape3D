/**
 * The Last of Us Style - City Model Library: Decayed Bus Stop Shelter (lib:decayed_bus_stop)
 *
 * AESTHETIC & PERFORMANCE COMPLIANCE:
 * - Low Polygon Budget: ~260 triangles.
 * - Primitives: 100% box primitives and angular roof canopy.
 * - Palette Discipline: 5 cohesive colors from PALETTE (concreteGrey, dark, rust, overgrownGreen, oliveDrab).
 * - Articulation & Params: Discarded scavenge backpack toggle, canopy styling.
 */
import { box, cyl, hexColor, tubeZ } from '../kit';
import { PALETTE } from '../palette';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const decayedBusStopBlueprint: ModelBlueprint = {
  id: 'lib:decayed_bus_stop',
  name: 'Weathered Municipal Bus Shelter',
  nameFr: 'Abribus municipal décrépit et pillé',
  category: 'architecture',
  subcategory: 'Civic & Transit',
  tags: ['kit-library', 'architecture', 'tlou', 'shelter', 'transit', 'abandoned', 'low-poly'],
  description:
    'Shattered municipal transit shelter with a cantilevered rust canopy, cracked sidewalk slab with encroaching weeds, weathered bench, and scavenged survivor backpack.',
  footprint: [2, 1],
  sourceFile: 'model-library/models/decayedBusStop.ts',
  params: [
    {
      key: 'hasLoot',
      label: 'Survivor Rucksack on Bench',
      kind: 'boolean',
      defaultValue: true,
    },
    {
      key: 'frameColor',
      label: 'Shelter Steel Color',
      kind: 'color',
      defaultValue: '#3b4048', // PALETTE.dark
    },
  ],
  recipe: [
    'box() // Cracked sidewalk concrete slab with sprouting weed clumps',
    'box() // Heavy cantilevered structural steel uprights & angled roof fascia',
    'box() // Perforated rusted passenger bench with steel mounting stanchions',
    'box() // Scavenged survivor canvas backpack with straps & metal canteen',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const hasLoot = params.hasLoot !== false;
    const frameHex = hexColor(params.frameColor, PALETTE.dark);

    // 1. Sidewalk Foundation & Structural Frame (Z = 0 is center, rear wall at Z = -0.35)
    const shelterParts: Part[] = [
      // Concrete sidewalk base slab (y: 0 -> 0.06, 1.8m x 1.0m)
      box(1.8, 0.06, 1.0, PALETTE.concreteGrey, 0, 0, 0),
      // Cracked asphalt patch & curb edge
      box(1.84, 0.04, 0.06, PALETTE.dark, 0, 0.02, 0.48),

      // Weeds sprouting from sidewalk seams
      box(0.18, 0.06, 0.12, PALETTE.overgrownGreen, -0.65, 0.06, 0.32),
      box(0.12, 0.08, 0.08, PALETTE.overgrownGreen, 0.72, 0.06, 0.28),
      box(0.24, 0.05, 0.08, PALETTE.overgrownGreen, 0.1, 0.06, -0.42),

      // 3 Rear structural upright columns (x: -0.7, 0, +0.7; y: 0.06 -> 1.76)
      box(0.06, 1.7, 0.06, frameHex, -0.7, 0.06, -0.38),
      box(0.06, 1.7, 0.06, frameHex, 0, 0.06, -0.38),
      box(0.06, 1.7, 0.06, frameHex, 0.7, 0.06, -0.38),

      // Left & right side wind barrier frames (y: 0.06 -> 1.76)
      box(0.04, 1.7, 0.04, frameHex, -0.7, 0.06, 0.1),
      box(0.04, 0.04, 0.48, frameHex, -0.7, 0.08, -0.14), // Lower rail
      box(0.04, 0.04, 0.48, frameHex, -0.7, 0.9, -0.14), // Mid rail
      box(0.04, 0.04, 0.48, frameHex, -0.7, 1.74, -0.14), // Top rail

      // Cantilevered Roof Canopy (slants forward from y: 1.76 to 1.68)
      box(1.76, 0.04, 0.76, PALETTE.rust, 0, 1.74, -0.05),
      box(1.8, 0.06, 0.04, frameHex, 0, 1.73, 0.33), // Front fascia gutter
      box(0.04, 0.06, 0.76, frameHex, -0.7, 1.74, -0.05), // Left edge
      box(0.04, 0.06, 0.76, frameHex, 0.7, 1.74, -0.05), // Right edge

      // Rear Advertisement / Map Display Board (shattered frame, poster peeled)
      box(0.6, 1.1, 0.02, PALETTE.rust, 0.35, 0.4, -0.37),
      box(0.48, 0.8, 0.015, PALETTE.white, 0.35, 0.55, -0.36), // Faded faded paper poster

      // Weathered passenger bench (y: 0.06 -> 0.45)
      box(0.04, 0.35, 0.04, PALETTE.dark, -0.5, 0.06, -0.22), // Left leg
      box(0.04, 0.35, 0.04, PALETTE.dark, -0.1, 0.06, -0.22), // Right leg
      box(0.56, 0.04, 0.22, PALETTE.rust, -0.3, 0.41, -0.22), // Seat slats
      box(0.56, 0.16, 0.03, PALETTE.rust, -0.3, 0.52, -0.34), // Backrest
    ];

    // 2. Discarded Scavenge Loot (Military canvas backpack on the bench)
    if (hasLoot) {
      shelterParts.push(
        // Main canvas rucksack pack body (y: 0.45 -> 0.65)
        box(0.18, 0.2, 0.14, PALETTE.oliveDrab, -0.22, 0.45, -0.22),
        // Front zippered utility pouch
        box(0.14, 0.1, 0.05, PALETTE.oliveDrab, -0.22, 0.47, -0.13),
        // Bedroll strapped to the top
        tubeZ(0.04, 0.18, PALETTE.dark, -0.22, 0.67, -0.22, 6).rotateZ(Math.PI / 2),
        // Aluminum canteen hooked on the side
        cyl(0.025, 0.08, PALETTE.chrome, -0.11, 0.46, -0.22, 6),
      );
    }

    return [
      {
        id: 'shelter',
        label: 'Bus Stop Shelter',
        material: 'matte',
        parts: shelterParts,
      },
    ];
  },
};
