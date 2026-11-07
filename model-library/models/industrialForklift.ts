import { box, cyl, hexColor, rod } from '../kit';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const industrialForkliftBlueprint: ModelBlueprint = {
  id: 'lib:industrial_forklift',
  name: 'Warehouse Forklift (Parametric)',
  nameFr: 'Chariot élévateur d’entrepôt (paramétrique)',
  category: 'vehicles',
  subcategory: 'Industrial & Utility Vehicles',
  tags: ['kit-library', 'parametric', 'vehicle', 'industrial'],
  description: 'Code-generated warehouse forklift with adjustable mast fork height, pallet load, and body paint.',
  footprint: [2, 2],
  sourceFile: 'model-library/models/industrialForklift.ts',
  params: [
    {
      key: 'liftHeight',
      label: 'Fork Lift Height',
      kind: 'select',
      options: [
        { value: 0.12, label: 'Lowered (0.12)' },
        { value: 0.55, label: 'Mid Lift (0.55)' },
        { value: 1.05, label: 'High Lift (1.05)' },
      ],
      defaultValue: 0.55,
    },
    {
      key: 'pallet',
      label: 'Loaded Crate on Forks',
      kind: 'boolean',
      defaultValue: true,
    },
    {
      key: 'paint',
      label: 'Body Paint',
      kind: 'color',
      defaultValue: '#e8b828',
    },
  ],
  recipe: [
    'box(0.95, 0.48, 1.35, paint) // Counterweight chassis',
    'box(0.08, 1.55, 0.08, 0x3b4048) × 2 // Twin hydraulic mast rails',
    'box(0.1, 0.04, 0.75, 0x8d949e) × 2 // Steel forks at liftHeight',
    'rod(0.22, 0.18, 0x1a1c20) × 4 // Axles & tires',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const bodyC = hexColor(params.paint, 0xe8b828);
    const fy = Number(params.liftHeight ?? 0.55);
    const hasPallet = params.pallet !== false;

    const chassisParts: Part[] = [
      box(0.95, 0.48, 1.35, bodyC, 0, 0.18, -0.15),
      box(0.9, 0.35, 0.45, 0x3b4048, 0, 0.45, -0.6),
      box(0.38, 0.12, 0.36, 0x1e2228, 0, 0.68, -0.15),
      box(0.38, 0.32, 0.08, 0x1e2228, 0, 0.8, -0.31),
      cyl(0.03, 0.36, 0x2b3038, 0, 0.66, 0.25, 8),
      ...[-0.4, 0.4].flatMap((x) => [
        box(0.05, 0.95, 0.05, 0x2b3038, x, 0.66, 0.35),
        box(0.05, 0.95, 0.05, 0x2b3038, x, 0.66, -0.55),
        box(0.05, 0.05, 0.95, 0x2b3038, x, 1.58, -0.1),
      ]),
      box(0.85, 0.04, 0.95, 0x2b3038, 0, 1.6, -0.1),
      box(0.08, 1.55, 0.08, 0x3b4048, -0.28, 0.15, 0.58),
      box(0.08, 1.55, 0.08, 0x3b4048, 0.28, 0.15, 0.58),
      rod(0.22, 0.18, 0x1a1c20, -0.46, 0.22, 0.3, 12),
      rod(0.22, 0.18, 0x1a1c20, 0.46, 0.22, 0.3, 12),
      rod(0.18, 0.16, 0x1a1c20, -0.44, 0.18, -0.58, 12),
      rod(0.18, 0.16, 0x1a1c20, 0.44, 0.18, -0.58, 12),
    ];

    const forkParts: Part[] = [
      box(0.64, 0.22, 0.06, 0x59606b, 0, fy, 0.62),
      box(0.1, 0.04, 0.75, 0x8d949e, -0.2, fy, 0.98),
      box(0.1, 0.04, 0.75, 0x8d949e, 0.2, fy, 0.98),
    ];

    if (hasPallet) {
      forkParts.push(
        box(0.76, 0.08, 0.7, 0x8a5a2e, 0, fy + 0.04, 0.98),
        box(0.68, 0.52, 0.62, 0xb8874e, 0, fy + 0.12, 0.98),
        box(0.7, 0.04, 0.64, 0x8a5a2e, 0, fy + 0.36, 0.98),
      );
    }

    return [
      { id: 'chassis', label: 'Counterweight Chassis & Wheels', material: 'matte', parts: chassisParts },
      { id: 'forks', label: 'Forks Carriage & Pallet Load', material: 'matte', parts: forkParts },
    ];
  },
};
