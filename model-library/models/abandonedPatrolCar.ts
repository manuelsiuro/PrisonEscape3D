/**
 * Model library, weathered city set: Abandoned Patrol Car (lib:abandoned_patrol_car)
 *
 * AESTHETIC & PERFORMANCE COMPLIANCE:
 * - Low Polygon Budget: ~390 triangles.
 * - Primitives: Angular boxes, 8-sided wheel rims, and rotBox doors.
 * - Palette Discipline: 5 cohesive colors from PALETTE (dark, white, rust, overgrownGreen, blue).
 * - Articulation & Params: Driver door ajar, climbing ivy overgrowth toggle.
 */
import { box, cyl, hexColor, rotBox } from '../kit';
import { PALETTE } from '../palette';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const abandonedPatrolCarBlueprint: ModelBlueprint = {
  id: 'lib:abandoned_patrol_car',
  name: 'Overgrown Abandoned Patrol Car',
  nameFr: 'Voiture de patrouille abandonnée et envahie',
  category: 'vehicles',
  subcategory: 'Derelict Vehicles',
  tags: ['kit-library', 'vehicle', 'car', 'abandoned', 'overgrown', 'low-poly'],
  description:
    'Rusted city police sedan resting on deflated tires, with faded paint, lightbar, open driver door, and climbing green ivy vines along the hood and windshield.',
  footprint: [2, 1],
  sourceFile: 'model-library/models/abandonedPatrolCar.ts',
  params: [
    {
      key: 'doorAjar',
      label: 'Driver Door Ajar',
      kind: 'boolean',
      defaultValue: true,
    },
    {
      key: 'hasIvy',
      label: 'Climbing Ivy Overgrowth',
      kind: 'boolean',
      defaultValue: true,
    },
    {
      key: 'bodyColor',
      label: 'Body Paint Color',
      kind: 'color',
      defaultValue: '#eef1f4', // PALETTE.white
    },
  ],
  recipe: [
    'box() // Rusted chassis skid, dented quarter panels, hood & trunk',
    'cyl(8) // Deflated wheels and rusted steel rims resting on asphalt',
    'box() // Overhead police emergency lightbar & windshield pillars',
    'rotBox() // Driver door swung open on rusted hinge',
    'box() // Creeping ivy foliage blocks hugging the hood and bumper',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const isDoorAjar = params.doorAjar !== false;
    const hasIvy = params.hasIvy !== false;
    const bodyHex = hexColor(params.bodyColor, PALETTE.white);

    // 1. Vehicle Main Body & Chassis (Z is front/rear: front at +Z = +0.8, rear at -Z = -0.8)
    const bodyParts: Part[] = [
      // Undercarriage skid plate / frame (y: 0.04 -> 0.14)
      box(0.72, 0.1, 1.7, PALETTE.dark, 0, 0.04, 0),
      // Front rusted bumper (y: 0.08 -> 0.22, z: 0.86 -> 0.94)
      box(0.76, 0.14, 0.08, PALETTE.rust, 0, 0.08, 0.9),
      // Rear rusted bumper (z: -0.9)
      box(0.76, 0.14, 0.08, PALETTE.rust, 0, 0.08, -0.9),

      // Lower rocker panels and wheel well skirts
      box(0.74, 0.16, 0.8, PALETTE.dark, 0, 0.14, 0), // Mid body
      box(0.74, 0.18, 0.45, bodyHex, 0, 0.14, 0.65), // Front hood block
      box(0.74, 0.18, 0.45, bodyHex, 0, 0.14, -0.65), // Rear trunk deck

      // Cabin greenhouse & roof (y: 0.32 -> 0.62)
      box(0.66, 0.04, 0.72, bodyHex, 0, 0.58, -0.05), // Roof plate
      // Cabin interior shadow block (empty passenger compartment)
      box(0.62, 0.26, 0.68, PALETTE.black, 0, 0.32, -0.05),
      // Front windshield angled A-pillars
      rotBox(0.04, 0.3, 0.04, PALETTE.dark, -0.31, 0.44, 0.3, 0.45, 0, 0),
      rotBox(0.04, 0.3, 0.04, PALETTE.dark, 0.31, 0.44, 0.3, 0.45, 0, 0),
      // Rear window C-pillars
      rotBox(0.04, 0.28, 0.04, PALETTE.dark, -0.31, 0.44, -0.4, -0.35, 0, 0),
      rotBox(0.04, 0.28, 0.04, PALETTE.dark, 0.31, 0.44, -0.4, -0.35, 0, 0),

      // Roof Emergency Lightbar
      box(0.5, 0.03, 0.08, PALETTE.dark, 0, 0.62, -0.05), // Mount rack
      box(0.18, 0.04, 0.06, PALETTE.red, -0.16, 0.65, -0.05), // Left red beacon
      box(0.18, 0.04, 0.06, PALETTE.blue, 0.16, 0.65, -0.05), // Right blue beacon
      box(0.06, 0.04, 0.06, PALETTE.white, 0, 0.65, -0.05), // Center siren horn

      // Passenger Door (closed, right side X = +0.37)
      box(0.02, 0.24, 0.38, bodyHex, 0.37, 0.32, 0.12),
      box(0.02, 0.24, 0.34, bodyHex, 0.37, 0.32, -0.24),

      // 4 Deflated Wheels / Rusted Rims resting on the pavement
      cyl(0.15, 0.08, PALETTE.black, -0.38, 0, 0.6, 8).rotateZ(Math.PI / 2),
      cyl(0.15, 0.08, PALETTE.black, 0.38, 0, 0.6, 8).rotateZ(Math.PI / 2),
      cyl(0.14, 0.08, PALETTE.rust, -0.38, 0, -0.58, 8).rotateZ(Math.PI / 2), // Rusted rim
      cyl(0.15, 0.08, PALETTE.black, 0.38, 0, -0.58, 8).rotateZ(Math.PI / 2),
    ];

    // Optional Climbing Ivy & Moss Overgrowth
    if (hasIvy) {
      bodyParts.push(
        // Foliage sprawling over front right fender and bumper
        box(0.24, 0.06, 0.3, PALETTE.overgrownGreen, 0.28, 0.32, 0.72),
        box(0.16, 0.08, 0.18, PALETTE.overgrownGreen, 0.22, 0.36, 0.58),
        // Ivy creeping up windshield A-pillar
        box(0.08, 0.14, 0.1, PALETTE.overgrownGreen, 0.29, 0.48, 0.32),
        // Grille foliage burst
        box(0.3, 0.08, 0.06, PALETTE.overgrownGreen, 0.05, 0.18, 0.93),
      );
    }

    // 2. Driver Door (Hinged at A-pillar: [-0.37, 0.32, 0.30])
    const doorParts: Part[] = [];
    const doorAngle = isDoorAjar ? -0.45 : 0; // Rotates outward
    const doorLength = 0.38;

    const doorCx = -0.37 - (Math.sin(doorAngle) * doorLength) / 2;
    const doorCz = 0.3 - (Math.cos(doorAngle) * doorLength) / 2;

    doorParts.push(
      // Door outer metal shell
      rotBox(0.02, 0.24, doorLength, bodyHex, doorCx, 0.44, doorCz, 0, -doorAngle, 0),
      // Dark window frame & handle
      rotBox(0.015, 0.03, 0.06, PALETTE.dark, doorCx, 0.48, doorCz, 0, -doorAngle, 0),
    );

    return [
      {
        id: 'chassis',
        label: 'Derelict Cruiser Chassis',
        material: 'matte',
        parts: bodyParts,
      },
      {
        id: 'driver_door',
        label: 'Driver Door',
        material: 'matte',
        pivot: [-0.37, 0.32, 0.3],
        parts: doorParts,
      },
    ];
  },
};
