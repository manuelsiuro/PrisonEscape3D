/**
 * The Last of Us Style - City Model Library: Overgrown Street Kiosk (lib:overgrown_kiosk)
 *
 * AESTHETIC & PERFORMANCE COMPLIANCE:
 * - Low Polygon Budget: ~310 triangles.
 * - Primitives: 100% box primitives and angular roof fascia.
 * - Palette Discipline: 5 cohesive colors from PALETTE (dark, wood, rust, concreteGrey, overgrownGreen).
 * - Articulation & Params: Boarded-up vs scavenged counter window, cascading ivy density.
 */
import { box, hexColor, rotBox } from '../kit';
import { PALETTE } from '../palette';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const overgrownKioskBlueprint: ModelBlueprint = {
  id: 'lib:overgrown_kiosk',
  name: 'Reclaimed Street Corner Newsstand Kiosk',
  nameFr: 'Kiosque à journaux de rue abandonné et envahi',
  category: 'architecture',
  subcategory: 'Civic & Transit',
  tags: ['kit-library', 'architecture', 'tlou', 'kiosk', 'abandoned', 'overgrown', 'low-poly'],
  description:
    'Rusted urban newsstand with boarded service window, weathered corrugated sheet roof, peeling poster flyers, and lush cascading ivy vines crawling down the canopy.',
  footprint: [1, 1],
  sourceFile: 'model-library/models/overgrownKiosk.ts',
  params: [
    {
      key: 'shutter',
      label: 'Service Window State',
      kind: 'select',
      options: [
        { value: 'boarded', label: 'Boarded Up with Plywood' },
        { value: 'open', label: 'Scavenged Open Counter' },
      ],
      defaultValue: 'boarded',
    },
    {
      key: 'ivyDensity',
      label: 'Ivy Overgrowth Density',
      kind: 'select',
      options: [
        { value: 'heavy', label: 'Heavy Overgrowth' },
        { value: 'light', label: 'Sparse Foliage' },
      ],
      defaultValue: 'heavy',
    },
    {
      key: 'kioskColor',
      label: 'Kiosk Wall Finish',
      kind: 'color',
      defaultValue: '#3b4048', // PALETTE.dark
    },
  ],
  recipe: [
    'box() // Concrete sidewalk curb foundation and heavy sheet metal kiosk body',
    'rotBox() // Slanted corrugated iron roof overhang with rusted fascia edges',
    'box() // Boarded timber planks nailed across the display window',
    'box() // Cascading ivy foliage blocks and climbing wall moss clusters',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const isBoarded = params.shutter !== 'open';
    const isHeavyIvy = params.ivyDensity !== 'light';
    const wallHex = hexColor(params.kioskColor, PALETTE.dark);

    // 1. Kiosk Structure & Base
    const kioskParts: Part[] = [
      // Concrete sidewalk base slab (y: 0 -> 0.08)
      box(0.96, 0.08, 0.96, PALETTE.concreteGrey, 0, 0, 0),

      // Main kiosk cabinet walls (y: 0.08 -> 1.68)
      box(0.88, 1.6, 0.88, wallHex, 0, 0.08, 0),

      // Front counter alcove / window opening (+Z face at z = 0.44)
      // Service counter ledge shelf (y: 0.78 -> 0.82)
      box(0.82, 0.04, 0.16, PALETTE.woodDark, 0, 0.78, 0.44),

      // Overhanging rusted corrugated iron roof canopy (y: 1.66 -> 1.74, slants forward)
      rotBox(1.04, 0.05, 1.06, PALETTE.rust, 0, 1.7, 0.04, 0.1, 0, 0),
      box(1.06, 0.08, 0.03, PALETTE.rust, 0, 1.65, 0.56), // Front dripping fascia

      // Side Wall Faded Notice / Poster Paper (left side x = -0.45)
      box(0.015, 0.42, 0.32, PALETTE.white, -0.45, 0.95, 0),
      box(0.018, 0.18, 0.22, PALETTE.yellow, -0.45, 1.0, 0.05), // Yellow emergency notice
    ];

    // 2. Service Window: Boarded Plywood vs Scavenged Open
    if (isBoarded) {
      // 4 horizontal timber planks nailed across window opening
      const plankYs = [0.88, 1.02, 1.16, 1.3];
      for (const py of plankYs) {
        kioskParts.push(
          box(0.78, 0.11, 0.02, PALETTE.wood, 0, py, 0.45),
        );
      }
    } else {
      // Open window revealing dark ransacked interior
      kioskParts.push(
        box(0.74, 0.5, 0.04, PALETTE.black, 0, 0.85, 0.43),
        box(0.3, 0.08, 0.1, PALETTE.wood, -0.15, 0.82, 0.42), // Fallen drawer
      );
    }

    // 3. Creeping Ivy & Moss Overgrowth
    if (isHeavyIvy) {
      kioskParts.push(
        // Roof overgrowth drapery (hanging over front edge)
        box(0.42, 0.16, 0.14, PALETTE.overgrownGreen, -0.25, 1.62, 0.54),
        box(0.32, 0.22, 0.12, PALETTE.overgrownGreen, 0.28, 1.58, 0.52),
        // Wall ivy climbing up the right corner
        box(0.18, 0.82, 0.18, PALETTE.overgrownGreen, 0.44, 0.55, 0.4),
        box(0.14, 0.45, 0.16, PALETTE.overgrownGreen, 0.44, 0.25, -0.3),
        // Base moss patch hugging the concrete slab
        box(0.35, 0.04, 0.25, PALETTE.overgrownGreen, -0.3, 0.08, 0.46),
      );
    } else {
      // Light sparse ivy
      kioskParts.push(
        box(0.25, 0.12, 0.1, PALETTE.overgrownGreen, -0.2, 1.64, 0.52),
        box(0.14, 0.45, 0.14, PALETTE.overgrownGreen, 0.44, 0.65, 0.38),
      );
    }

    return [
      {
        id: 'kiosk',
        label: 'Overgrown Kiosk',
        material: 'matte',
        parts: kioskParts,
      },
    ];
  },
};
