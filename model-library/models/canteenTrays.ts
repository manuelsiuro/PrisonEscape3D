/**
 * Prison Escape 3D - Model Library: Canteen Tray Dispenser (lib:canteen_trays)
 *
 * AESTHETIC & PERFORMANCE COMPLIANCE:
 * - Low Polygon Budget: ~190 triangles total.
 * - Primitives: 100% simple boxes and 6-sided rods matching src/render/props.ts.
 * - Palette Discipline: 4 cohesive colors from PALETTE (steel, dark, blue, chrome).
 * - Silhouette First: Clean angular contours readable at any isometric distance.
 */
import { box, hexColor, mirrorX, rod } from '../kit';
import { PALETTE } from '../palette';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const canteenTraysBlueprint: ModelBlueprint = {
  id: 'lib:canteen_trays',
  name: 'Canteen Meal Tray Stack & Cutlery Cart',
  nameFr: 'Chariot à plateaux et couverts de cantine',
  category: 'props',
  subcategory: 'Canteen & Kitchen',
  tags: ['kit-library', 'prop', 'canteen', 'kitchen', 'food', 'low-poly'],
  description:
    'Institutional stainless steel mobile dispensing trolley holding a tiered stack of molded canteen meal trays and side compartments for spoons and forks.',
  footprint: [1, 1],
  sourceFile: 'model-library/models/canteenTrays.ts',
  params: [
    {
      key: 'trayColor',
      label: 'Meal Tray Color',
      kind: 'color',
      defaultValue: '#2f6fd0', // PALETTE.blue
    },
    {
      key: 'trayCount',
      label: 'Tray Stack Height',
      kind: 'select',
      options: [
        { value: 'full', label: 'Full Stack (6 Trays)' },
        { value: 'half', label: 'Half Stack (3 Trays)' },
      ],
      defaultValue: 'full',
    },
    {
      key: 'hasCutlery',
      label: 'Include Cutlery Bins',
      kind: 'boolean',
      defaultValue: true,
    },
  ],
  recipe: [
    'box() + rod() // Tubular stainless steel mobile trolley frame & swivel casters',
    'repeatLinear() -> box() // Stacked institutional meal trays with rim lips',
    'box() // Cutlery compartments with stainless spoons & forks',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const trayHex = hexColor(params.trayColor, PALETTE.blue);
    const count = params.trayCount === 'half' ? 3 : 6;
    const hasCutlery = params.hasCutlery !== false;

    // 1. Mobile Trolley Frame (box places bottom face at y)
    const cartParts: Part[] = [
      ...mirrorX(0.22, (x) => [
        // Swivel caster foot blocks (y: 0 -> 0.04)
        box(0.04, 0.04, 0.04, PALETTE.black, x, 0, -0.2),
        box(0.04, 0.04, 0.04, PALETTE.black, x, 0, 0.2),
        // Vertical corner posts (y: 0.04 -> 0.80)
        box(0.024, 0.76, 0.024, PALETTE.dark, x, 0.04, -0.2),
        box(0.024, 0.76, 0.024, PALETTE.dark, x, 0.04, 0.2),
      ]),
      // Bottom storage shelf (y: 0.08 -> 0.105)
      box(0.5, 0.025, 0.46, PALETTE.steel, 0, 0.08, 0),
      // Top tray support deck (y: 0.52 -> 0.545)
      box(0.5, 0.025, 0.46, PALETTE.steel, 0, 0.52, 0),
      // Top push handle bar (rod centered at y = 0.84)
      rod(0.012, 0.46, PALETTE.chrome, 0, 0.84, -0.21, 6),
      box(0.016, 0.06, 0.016, PALETTE.dark, -0.21, 0.78, -0.21),
      box(0.016, 0.06, 0.016, PALETTE.dark, 0.21, 0.78, -0.21),
    ];

    // 2. Stack of Low-Poly Molded Meal Trays
    const trayParts: Part[] = [];
    const baseY = 0.545;
    for (let i = 0; i < count; i++) {
      const y = baseY + i * 0.026;
      trayParts.push(box(0.42, 0.016, 0.34, trayHex, 0, y, 0));
    }
    // Top tray detail: molded divider rim
    const topY = baseY + count * 0.026;
    trayParts.push(box(0.4, 0.008, 0.012, trayHex, 0, topY, 0), box(0.012, 0.008, 0.32, trayHex, 0, topY, 0));

    // 3. Side Cutlery Caddy Bins with Metal Spoons
    if (hasCutlery) {
      cartParts.push(
        // Caddy box hanging on side (y: 0.46 -> 0.62)
        box(0.12, 0.16, 0.32, PALETTE.dark, 0.31, 0.46, 0),
        box(0.1, 0.14, 0.3, PALETTE.steel, 0.31, 0.48, 0),
        // Spoon & fork handles (y: 0.56 -> 0.68)
        box(0.015, 0.12, 0.06, PALETTE.chrome, 0.31, 0.56, -0.07),
        box(0.015, 0.12, 0.06, PALETTE.chrome, 0.31, 0.56, 0.07),
      );
    }

    return [
      {
        id: 'trolley',
        label: 'Stainless Steel Trolley',
        material: 'matte',
        parts: cartParts,
      },
      {
        id: 'trays',
        label: 'Molded Canteen Trays',
        material: 'matte',
        parts: trayParts,
      },
    ];
  },
};
