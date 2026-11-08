/**
 * Prison Escape 3D - Model Library: Security Barrier Turnstile (lib:security_turnstile)
 *
 * AESTHETIC & PERFORMANCE COMPLIANCE:
 * - Low Polygon Budget: ~180 triangles total.
 * - Primitives: Angular boxes, 6-sided vertical cylinders, and tubeZ rails matching props.ts.
 * - Palette Discipline: 4 cohesive colors from PALETTE (steel, dark, chrome, green/red).
 * - Articulation: Rotating 3-arm barrier rotor around a horizontal axle pivot.
 */
import { box, cyl, hexColor, rotBox, tubeZ } from '../kit';
import { PALETTE } from '../palette';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const securityTurnstileBlueprint: ModelBlueprint = {
  id: 'lib:security_turnstile',
  name: 'Security Checkpoint Turnstile',
  nameFr: 'Tourniquet de sécurité de contrôle',
  category: 'fixtures',
  subcategory: 'Security & Checkpoints',
  tags: ['kit-library', 'fixture', 'security', 'checkpoint', 'gate', 'low-poly'],
  description:
    'Institutional waist-high checkpoint turnstile with stainless steel cabinet, card swipe scanner, status LED indicator, and tri-arm barrier rotor.',
  footprint: [1, 1],
  sourceFile: 'model-library/models/securityTurnstile.ts',
  params: [
    {
      key: 'status',
      label: 'Access Status',
      kind: 'select',
      options: [
        { value: 'granted', label: 'Access Granted (Green)' },
        { value: 'denied', label: 'Access Denied (Red)' },
      ],
      defaultValue: 'granted',
    },
    {
      key: 'hasSideRail',
      label: 'Include Guide Barrier Rail',
      kind: 'boolean',
      defaultValue: true,
    },
    {
      key: 'armColor',
      label: 'Barrier Arm Color',
      kind: 'color',
      defaultValue: '#cfd6df', // PALETTE.chrome
    },
  ],
  recipe: [
    'box() // Stainless steel cabinet body, floor mounting plate & card reader',
    'tubeZ(6) + rotBox() // 3-arm stainless steel barrier rotor revolving at 120°',
    'cyl(6) + tubeZ(6) // Guide stanchion barrier rail and directional indicator LED',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const isGranted = params.status !== 'denied';
    const statusLed = isGranted ? PALETTE.green : PALETTE.red;
    const armHex = hexColor(params.armColor, PALETTE.chrome);
    const hasSideRail = params.hasSideRail !== false;

    // 1. Fixed Turnstile Cabinet Body
    const cabinetParts: Part[] = [
      // Floor mounting base plate (y: 0 -> 0.03)
      box(0.28, 0.03, 0.78, PALETTE.dark, -0.15, 0, 0),
      // Main brushed stainless housing (y: 0.03 -> 0.89)
      box(0.26, 0.86, 0.74, PALETTE.steel, -0.15, 0.03, 0),
      // Top chamfered cap / cover (y: 0.89 -> 0.92)
      box(0.28, 0.03, 0.76, PALETTE.dark, -0.15, 0.89, 0),
      // Card scanner / fingerprint sensor pad on top (y: 0.92 -> 0.935)
      box(0.16, 0.015, 0.22, PALETTE.black, -0.15, 0.92, -0.18),
      // Directional LED status light on front face (+Z)
      box(0.10, 0.04, 0.02, PALETTE.dark, -0.15, 0.70, 0.37),
      box(0.06, 0.02, 0.01, statusLed, -0.15, 0.71, 0.385),
    ];

    // Optional Side Guide Rail (flanks the opposite side of the walkway at X = +0.38)
    if (hasSideRail) {
      cabinetParts.push(
        // Outer vertical posts (y: 0 -> 0.88)
        cyl(0.018, 0.88, PALETTE.dark, 0.38, 0, -0.32, 6),
        cyl(0.018, 0.88, PALETTE.dark, 0.38, 0, 0.32, 6),
        // Horizontal guide crossbars running along Z axis
        tubeZ(0.018, 0.64, PALETTE.chrome, 0.38, 0.86, 0, 6),
        tubeZ(0.014, 0.64, PALETTE.chrome, 0.38, 0.46, 0, 6),
      );
    }

    // 2. Rotating 3-Arm Rotor Mechanism (Pivot at axle: [0.02, 0.66, 0])
    const rotorPivot: readonly [number, number, number] = [0.02, 0.66, 0];
    const hubParts: Part[] = [
      // Central rotor hub drum (6-sided cylinder running along Z)
      tubeZ(0.045, 0.08, PALETTE.dark, 0.02, 0.66, 0, 6),
    ];

    // 3 arms radiating at 120-degree intervals in X/Y plane
    const armLen = 0.36;
    for (let i = 0; i < 3; i++) {
      const angle = (i * 2 * Math.PI) / 3;
      const dist = armLen / 2 + 0.04;
      const cx = 0.02 + Math.cos(angle) * dist;
      const cy = 0.66 + Math.sin(angle) * dist;
      hubParts.push(rotBox(armLen, 0.026, 0.026, armHex, cx, cy, 0, 0, 0, angle));
    }

    return [
      {
        id: 'cabinet',
        label: 'Cabinet & Scanner',
        material: 'matte',
        parts: cabinetParts,
      },
      {
        id: 'rotor',
        label: 'Tri-Arm Barrier Rotor',
        material: 'matte',
        pivot: rotorPivot,
        parts: hubParts,
      },
    ];
  },
  animate: (rigs, t) => {
    // Subtle idle tension rocking
    const rotor = rigs.rotor;
    if (rotor) {
      rotor.rotation.z = Math.sin(t * 1.5) * 0.08;
    }
  },
};
