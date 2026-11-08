/**
 * The Last of Us Style - City Model Library: Quarantine Medical Triage Tent (lib:triage_tent)
 *
 * AESTHETIC & PERFORMANCE COMPLIANCE:
 * - Low Polygon Budget: ~320 triangles.
 * - Primitives: Angular boxes, wedge canopy gables, and 6-sided tubular rods.
 * - Palette Discipline: 5 cohesive colors from PALETTE (oliveDrab, steel, white, red, woodLight).
 * - Articulation & Params: Entrance flap open vs closed, interior field cot and IV stand toggle.
 */
import { box, cyl, hexColor, rod, rotBox, wedge } from '../kit';
import { PALETTE } from '../palette';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const triageTentBlueprint: ModelBlueprint = {
  id: 'lib:triage_tent',
  name: 'Quarantine Medical Triage Tent',
  nameFr: 'Tente de triage médical de quarantaine',
  category: 'architecture',
  subcategory: 'Quarantine & Military',
  tags: ['kit-library', 'architecture', 'tlou', 'tent', 'medical', 'quarantine', 'low-poly'],
  description:
    'Olive-drab military emergency medical tent with stenciled red cross, tubular frame, rolled entry flap, and field triage cot with IV drip stand.',
  footprint: [2, 2],
  sourceFile: 'model-library/models/triageTent.ts',
  params: [
    {
      key: 'doorOpen',
      label: 'Entrance Flap State',
      kind: 'boolean',
      defaultValue: true,
    },
    {
      key: 'hasEquipment',
      label: 'Field Medical Cot & IV Stand',
      kind: 'boolean',
      defaultValue: true,
    },
    {
      key: 'canvasColor',
      label: 'Canvas Fabric Finish',
      kind: 'color',
      defaultValue: '#4a533b', // PALETTE.oliveDrab
    },
  ],
  recipe: [
    'box() + wedge() // Military canvas walls with pitched gabled roof canopy',
    'rod(6) // Tubular structural aluminum perimeter frame',
    'box() // Stenciled medical red cross emblem on front gable face',
    'box() + rod(6) // Folding field cot, folded wool blanket & saline IV drip pole',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const isDoorOpen = params.doorOpen !== false;
    const hasEquipment = params.hasEquipment !== false;
    const canvasHex = hexColor(params.canvasColor, PALETTE.oliveDrab);

    // 1. Structural Frame & Canvas Shelter Body
    const tentParts: Part[] = [
      // 4 Corner tubular structural frame legs (x: ±0.82, z: ±0.82; y: 0 -> 1.35)
      cyl(0.018, 1.35, PALETTE.steel, -0.82, 0, -0.82, 6),
      cyl(0.018, 1.35, PALETTE.steel, 0.82, 0, -0.82, 6),
      cyl(0.018, 1.35, PALETTE.steel, -0.82, 0, 0.82, 6),
      cyl(0.018, 1.35, PALETTE.steel, 0.82, 0, 0.82, 6),

      // Perimeter horizontal wall canvas (y: 0.05 -> 1.35)
      // Left wall
      box(0.02, 1.3, 1.64, canvasHex, -0.82, 0.05, 0),
      // Right wall
      box(0.02, 1.3, 1.64, canvasHex, 0.82, 0.05, 0),
      // Rear wall (z = -0.82)
      box(1.64, 1.3, 0.02, canvasHex, 0, 0.05, -0.82),

      // Pitched Gabled Roof Canopy (y: 1.35 to 1.85 ridge line along Z)
      wedge(0.84, 0.5, 1.68, canvasHex, -0.42, 1.35, 0, 'x-'),
      wedge(0.84, 0.5, 1.68, canvasHex, 0.42, 1.35, 0, 'x+'),

      // Front & Rear Gable Wall Infill Triangles
      box(1.64, 0.04, 0.02, canvasHex, 0, 1.35, 0.82),
      box(1.64, 0.04, 0.02, canvasHex, 0, 1.35, -0.82),

      // Stenciled Medical Red Cross on front gable (z = 0.85, y = 1.48)
      box(0.24, 0.06, 0.01, PALETTE.red, 0, 1.5, 0.85),
      box(0.06, 0.24, 0.01, PALETTE.red, 0, 1.5, 0.85),
    ];

    // Front Door Flap (Open rolled up vs zipped shut)
    if (isDoorOpen) {
      // Left and right door jamb flaps
      tentParts.push(
        box(0.48, 1.3, 0.02, canvasHex, -0.58, 0.05, 0.82),
        box(0.48, 1.3, 0.02, canvasHex, 0.58, 0.05, 0.82),
        // Rolled canvas flap tied above doorway
        rod(0.04, 0.68, canvasHex, 0, 1.36, 0.84, 6),
      );
    } else {
      // Full canvas door wall sealed shut
      tentParts.push(box(1.64, 1.3, 0.02, canvasHex, 0, 0.05, 0.82));
    }

    // 2. Interior Medical Field Cot & IV Drip Stand
    if (hasEquipment) {
      tentParts.push(
        // Folding canvas cot frame (placed along right wall x = 0.42, z = 0)
        box(0.65, 0.04, 1.25, PALETTE.steel, 0.42, 0.32, 0),
        // Cot folding scissor legs
        rotBox(0.03, 0.34, 0.03, PALETTE.steel, 0.15, 0.17, -0.48, 0, 0, 0.2),
        rotBox(0.03, 0.34, 0.03, PALETTE.steel, 0.69, 0.17, -0.48, 0, 0, -0.2),
        rotBox(0.03, 0.34, 0.03, PALETTE.steel, 0.15, 0.17, 0.48, 0, 0, 0.2),
        rotBox(0.03, 0.34, 0.03, PALETTE.steel, 0.69, 0.17, 0.48, 0, 0, -0.2),
        // Blue wool hospital blanket folded on cot
        box(0.58, 0.03, 0.75, PALETTE.tarpBlue, 0.42, 0.35, -0.15),
        // Pillow
        box(0.48, 0.05, 0.22, PALETTE.white, 0.42, 0.36, 0.42),

        // Chrome IV Drip Stand (x = -0.42, z = -0.32)
        cyl(0.012, 1.45, PALETTE.chrome, -0.42, 0, -0.32, 6),
        // Tripod base legs
        box(0.24, 0.02, 0.02, PALETTE.chrome, -0.42, 0.01, -0.32),
        box(0.02, 0.02, 0.24, PALETTE.chrome, -0.42, 0.01, -0.32),
        // Saline IV bag hanging from top hook
        box(0.06, 0.12, 0.03, PALETTE.white, -0.42, 1.28, -0.28),

        // Wooden medical supply crate (x = -0.45, z = 0.35)
        box(0.36, 0.28, 0.36, PALETTE.woodLight, -0.45, 0, 0.35),
        box(0.08, 0.02, 0.08, PALETTE.red, -0.45, 0.29, 0.35), // Stenciled red cross
      );
    }

    return [
      {
        id: 'triage_tent',
        label: 'Quarantine Medical Tent',
        material: 'matte',
        parts: tentParts,
      },
    ];
  },
};
