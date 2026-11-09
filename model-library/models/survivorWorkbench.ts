/**
 * Model library, weathered city set: Survivor Workbench (lib:survivor_workbench)
 *
 * AESTHETIC & PERFORMANCE COMPLIANCE:
 * - Low Polygon Budget: ~240 triangles.
 * - Primitives: 100% box primitives and 6-sided cylindrical lamp tube.
 * - Palette Discipline: 5 cohesive colors from PALETTE (wood, woodDark, dark, chrome, oliveDrab).
 * - Articulation & Params: Lamp on/off illumination toggle, basic vs upgraded tool tier.
 */
import { box, cyl, hexColor, rod, rotBox } from '../kit';
import { PALETTE } from '../palette';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const survivorWorkbenchBlueprint: ModelBlueprint = {
  id: 'lib:survivor_workbench',
  name: 'Survivor Weapon Crafting Workbench',
  nameFr: 'Établi artisanal de survie pour armes',
  category: 'props',
  subcategory: 'Survivor Equipment',
  tags: ['kit-library', 'prop', 'workbench', 'crafting', 'wood', 'low-poly'],
  description:
    'Heavy timber carpentry table rigged for survival weapon upgrades, equipped with a mechanical bench vise, articulated desk lamp, scrap weapon parts, and duct tape.',
  footprint: [1, 1],
  sourceFile: 'model-library/models/survivorWorkbench.ts',
  params: [
    {
      key: 'lampOn',
      label: 'Desk Lamp Lit',
      kind: 'boolean',
      defaultValue: true,
    },
    {
      key: 'tier',
      label: 'Workbench Outfitting',
      kind: 'select',
      options: [
        { value: 'upgraded', label: 'Upgraded (Weapon Parts & Vise)' },
        { value: 'basic', label: 'Basic (Sparse Scavenged Tools)' },
      ],
      defaultValue: 'upgraded',
    },
    {
      key: 'woodColor',
      label: 'Timber Tabletop Tone',
      kind: 'color',
      defaultValue: '#9b6a3f', // PALETTE.wood
    },
  ],
  recipe: [
    'box() // Scarred timber tabletop, 4 heavy square posts & cross bracing',
    'box() // Cast iron bench vise clamp with sliding screw handle',
    'rod(6) + box() // Articulated gooseneck clamp lamp with hooded reflector',
    'box() // Scavenged supplies: duct tape roll, alcohol bottle & weapon stock',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const isLit = params.lampOn !== false;
    const isUpgraded = params.tier !== 'basic';
    const topHex = hexColor(params.woodColor, PALETTE.wood);

    // 1. Heavy Wooden Workbench Base & Tabletop (box places bottom at y)
    const tableParts: Part[] = [
      // 4 heavy square corner legs (y: 0 -> 0.72)
      box(0.06, 0.72, 0.06, PALETTE.woodDark, -0.4, 0, -0.22),
      box(0.06, 0.72, 0.06, PALETTE.woodDark, 0.4, 0, -0.22),
      box(0.06, 0.72, 0.06, PALETTE.woodDark, -0.4, 0, 0.22),
      box(0.06, 0.72, 0.06, PALETTE.woodDark, 0.4, 0, 0.22),

      // Lower shelf / foot stretcher rails (y: 0.14 -> 0.18)
      box(0.86, 0.04, 0.04, PALETTE.woodDark, 0, 0.14, -0.22),
      box(0.86, 0.04, 0.04, PALETTE.woodDark, 0, 0.14, 0.22),
      box(0.04, 0.04, 0.44, PALETTE.woodDark, -0.4, 0.14, 0),
      box(0.04, 0.04, 0.44, PALETTE.woodDark, 0.4, 0.14, 0),

      // Thick scarred butcher-block wooden tabletop (y: 0.72 -> 0.78)
      box(0.94, 0.06, 0.54, topHex, 0, 0.72, 0),

      // Rear tool backboard / shelf upright (y: 0.78 -> 1.15)
      box(0.9, 0.36, 0.02, PALETTE.woodDark, 0, 0.78, -0.25),
      box(0.86, 0.02, 0.08, PALETTE.woodDark, 0, 1.05, -0.22), // Shelf
    ];

    // 2. Cast Iron Bench Vise (Mounted on front-left table corner)
    tableParts.push(
      box(0.12, 0.03, 0.12, PALETTE.dark, -0.38, 0.78, 0.18), // Base flange
      box(0.08, 0.08, 0.1, PALETTE.dark, -0.38, 0.81, 0.18), // Fixed jaw body
      box(0.07, 0.06, 0.03, PALETTE.dark, -0.38, 0.83, 0.25), // Movable jaw
      rod(0.008, 0.14, PALETTE.chrome, -0.38, 0.84, 0.27, 6), // Screw handle bar
    );

    // 3. Articulated Clamp Lamp
    tableParts.push(
      // Tabletop clamp & lower arm angled forward
      box(0.04, 0.06, 0.04, PALETTE.dark, 0.38, 0.78, -0.2),
      rotBox(0.016, 0.24, 0.016, PALETTE.dark, 0.34, 0.94, -0.16, 0, 0, 0.4),
      // Upper arm leaning over the table center
      rotBox(0.016, 0.22, 0.016, PALETTE.dark, 0.24, 1.06, -0.1, 0, 0, -0.6),
      // Hooded green metal reflector shade
      cyl(0.05, 0.08, PALETTE.oliveDrab, 0.14, 1.05, -0.06, 8),
      // Lightbulb face (illuminated or dark)
      box(0.06, 0.01, 0.06, isLit ? PALETTE.white : PALETTE.grey, 0.14, 1.045, -0.06),
    );

    // 4. Scavenged Weapon Parts & Crafting Supplies
    if (isUpgraded) {
      tableParts.push(
        // Weapon wooden rifle stock blank being carved
        rotBox(0.28, 0.04, 0.06, PALETTE.woodDark, 0.04, 0.8, 0.04, 0, 0.25, 0),
        // Steel gun barrel & receiver tube
        rod(0.012, 0.36, PALETTE.steel, 0.02, 0.82, 0.05, 6),
        // Roll of grey duct tape (hollow ring cylinder)
        cyl(0.04, 0.03, PALETTE.grey, -0.16, 0.78, 0.14, 8),
        cyl(0.025, 0.032, PALETTE.woodDark, -0.16, 0.78, 0.14, 8), // Tape core
        // Bottle of solvent/rubbing alcohol
        cyl(0.025, 0.1, PALETTE.white, -0.18, 0.78, -0.14, 6),
        // Screwdriver on shelf
        rod(0.008, 0.12, PALETTE.chrome, 0.2, 1.07, -0.22, 6),
      );
    } else {
      // Basic sparse supplies
      tableParts.push(cyl(0.04, 0.03, PALETTE.grey, -0.1, 0.78, 0.1, 8), box(0.08, 0.03, 0.04, PALETTE.dark, 0.12, 0.78, 0.02));
    }

    return [
      {
        id: 'workbench',
        label: 'Survivor Crafting Table',
        material: 'matte',
        parts: tableParts,
      },
    ];
  },
};
