/**
 * Prison Escape 3D - Model Library: Institutional Storage Locker (lib:storage_locker)
 *
 * AESTHETIC & PERFORMANCE COMPLIANCE:
 * - Low Polygon Budget: ~216 triangles total.
 * - Primitives: 100% box primitives matching props.ts and decor.ts.
 * - Palette Discipline: 4 cohesive colors from PALETTE (grey, dark, chrome, brass).
 * - Silhouette First: Clean angular contours with stamped vent louvers and hardware.
 */
import { box, hexColor, repeatLinear } from '../kit';
import { PALETTE } from '../palette';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const storageLockerBlueprint: ModelBlueprint = {
  id: 'lib:storage_locker',
  name: 'Institutional Storage Locker',
  nameFr: 'Casier de rangement institutionnel',
  category: 'props',
  subcategory: 'Storage & Furniture',
  tags: ['kit-library', 'prop', 'storage', 'locker', 'furniture', 'metal', 'low-poly'],
  description:
    'Heavy-gauge institutional sheet metal storage locker with louvered ventilation slats, recessed latch, stamped brass number plates, and padlock.',
  footprint: [1, 1],
  sourceFile: 'model-library/models/storageLocker.ts',
  params: [
    {
      key: 'lockerColor',
      label: 'Locker Paint Finish',
      kind: 'color',
      defaultValue: '#5b6470', // PALETTE.grey
    },
    {
      key: 'tier',
      label: 'Compartment Tiering',
      kind: 'select',
      options: [
        { value: 'two_tier', label: 'Two-Tier (Double Compartment)' },
        { value: 'single_tier', label: 'Single-Tier (Full Height)' },
      ],
      defaultValue: 'two_tier',
    },
    {
      key: 'hasPadlock',
      label: 'Has Padlock Attached',
      kind: 'boolean',
      defaultValue: true,
    },
  ],
  recipe: [
    'box() // Base plinth, heavy-gauge sheet metal cabinet & top rim',
    'repeatLinear() -> box() // Louvered door ventilation slats and recessed latches',
    'box() // Stamped brass locker number plate and security padlock',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const bodyHex = hexColor(params.lockerColor, PALETTE.grey);
    const isTwoTier = params.tier !== 'single_tier';
    const hasPadlock = params.hasPadlock !== false;

    // 1. Cabinet Shell & Plinth Base (box places bottom face at y)
    const cabinetParts: Part[] = [
      // Base plinth keeping locker off damp prison floor (y: 0 -> 0.08)
      box(0.44, 0.08, 0.46, PALETTE.dark, 0, 0, 0),
      // Main metal locker cabinet body (y: 0.08 -> 1.38)
      box(0.42, 1.30, 0.44, bodyHex, 0, 0.08, 0),
      // Top protective cap / trim (y: 1.38 -> 1.41)
      box(0.44, 0.03, 0.46, PALETTE.dark, 0, 1.38, 0),
    ];

    // 2. Door Assembly (Single or Two-Tier)
    const doorParts: Part[] = [];

    if (isTwoTier) {
      // Horizontal tier divider frame at y = 0.72
      cabinetParts.push(box(0.42, 0.02, 0.02, PALETTE.dark, 0, 0.72, 0.22));

      // Lower compartment (y: 0.09 -> 0.71)
      doorParts.push(
        box(0.38, 0.62, 0.012, bodyHex, 0, 0.09, 0.222),
        ...repeatLinear(3, (i) =>
          box(0.18, 0.012, 0.008, PALETTE.dark, 0, 0.65 - i * 0.025, 0.228),
        ),
        box(0.02, 0.08, 0.016, PALETTE.chrome, 0.14, 0.40, 0.23),
        box(0.06, 0.03, 0.006, PALETTE.brass, 0, 0.54, 0.228),
      );

      // Upper compartment (y: 0.75 -> 1.37)
      doorParts.push(
        box(0.38, 0.62, 0.012, bodyHex, 0, 0.75, 0.222),
        ...repeatLinear(3, (i) =>
          box(0.18, 0.012, 0.008, PALETTE.dark, 0, 1.31 - i * 0.025, 0.228),
        ),
        box(0.02, 0.08, 0.016, PALETTE.chrome, 0.14, 1.05, 0.23),
        box(0.06, 0.03, 0.006, PALETTE.brass, 0, 1.20, 0.228),
      );

      // Padlock on upper latch
      if (hasPadlock) {
        doorParts.push(
          box(0.03, 0.035, 0.014, PALETTE.brass, 0.14, 1.03, 0.245),
          box(0.02, 0.02, 0.006, PALETTE.chrome, 0.14, 1.065, 0.245),
        );
      }
    } else {
      // Single full-height door (y: 0.09 -> 1.37)
      doorParts.push(
        box(0.38, 1.28, 0.012, bodyHex, 0, 0.09, 0.222),
        ...repeatLinear(4, (i) =>
          box(0.2, 0.012, 0.008, PALETTE.dark, 0, 1.31 - i * 0.025, 0.228),
        ),
        ...repeatLinear(4, (i) =>
          box(0.2, 0.012, 0.008, PALETTE.dark, 0, 0.20 - i * 0.025, 0.228),
        ),
        box(0.02, 0.1, 0.016, PALETTE.chrome, 0.14, 0.72, 0.23),
        box(0.07, 0.035, 0.006, PALETTE.brass, 0, 1.15, 0.228),
      );

      if (hasPadlock) {
        doorParts.push(
          box(0.03, 0.035, 0.014, PALETTE.brass, 0.14, 0.70, 0.245),
          box(0.02, 0.02, 0.006, PALETTE.chrome, 0.14, 0.735, 0.245),
        );
      }
    }

    return [
      {
        id: 'cabinet',
        label: 'Cabinet & Frame',
        material: 'matte',
        parts: cabinetParts,
      },
      {
        id: 'doors',
        label: 'Louvered Doors & Hardware',
        material: 'matte',
        parts: doorParts,
      },
    ];
  },
};
