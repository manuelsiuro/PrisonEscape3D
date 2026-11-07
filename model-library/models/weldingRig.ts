import { box, cyl, disc, hexColor, mirrorX, rod, rotBox, tubeZ } from '../kit';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const weldingRigBlueprint: ModelBlueprint = {
  id: 'lib:welding_rig',
  name: 'Mobile Oxy-Acetylene Welding Rig',
  nameFr: 'Poste de soudure oxyacétylénique mobile',
  category: 'props',
  subcategory: 'Workshop & Maintenance',
  tags: ['kit-library', 'parametric', 'prop', 'workshop', 'industrial', 'tool', 'mobile'],
  description:
    'Two-wheeled steel workshop hand cart carrying dual high-pressure oxygen and acetylene gas cylinders, manifold regulators, coiled twin gas hose, and brass cutting torch.',
  footprint: [1, 1],
  sourceFile: 'model-library/models/weldingRig.ts',
  params: [
    {
      key: 'tankColor',
      label: 'Acetylene Tank Color',
      kind: 'color',
      defaultValue: '#8a2b2b',
    },
    {
      key: 'hasRegulators',
      label: 'Dual Pressure Regulators',
      kind: 'boolean',
      defaultValue: true,
    },
    {
      key: 'torchFlame',
      label: 'Ignited Cutting Torch Flame',
      kind: 'boolean',
      defaultValue: false,
    },
  ],
  recipe: [
    'box() + rod() // Tubular hand truck chassis & axle',
    'mirrorX() -> cyl() // Solid rubber heavy-duty cart wheels',
    'cyl() + frustum() // High-pressure oxygen (green) & fuel (maroon) cylinders',
    'disc() + rod() // Brass dual-stage pressure gauges & manifold',
    'rotBox() // Brass welding & cutting torch on side holster',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const fuelColor = hexColor(params.tankColor, 0x8a2b2b);
    const oxygenColor = 0x245b3a; // industrial oxygen green
    const steelCart = 0x363d47;
    const darkSteel = 0x22262d;
    const brass = 0xd4a238;
    const rubber = 0x181a1d;
    const chrome = 0xcfd6df;
    const hoseBlue = 0x26558c;
    const hoseRed = 0xa3322d;
    const hasRegs = params.hasRegulators !== false;
    const flame = params.torchFlame === true;

    const layers: PartLayerSpec[] = [];

    // 1. Hand Truck Cart Chassis & Wheels (Strict Low-Poly)
    const cartParts: Part[] = [
      // Base plate toe & bottom cradle tray
      box(0.52, 0.03, 0.36, steelCart, 0, 0.08, 0),
      box(0.52, 0.12, 0.03, steelCart, 0, 0.08, -0.165),
      // Upright back spine & push handle
      ...mirrorX(0.22, (x) => [
        tubeZ(0.016, 0.02, steelCart, x, 0.5, -0.165, 6),
        rotBox(0.025, 0.95, 0.025, steelCart, x, 0.56, -0.165, 0.08, 0, 0),
      ]),
      rod(0.016, 0.48, steelCart, 0, 1.02, -0.21, 6),
      // Wheel axle & 2 solid rubber wheels with steel hubcaps (6 segments)
      rod(0.012, 0.58, darkSteel, 0, 0.09, -0.14, 6),
      ...mirrorX(0.28, (x) => [disc(0.09, 0.035, rubber, x, 0.09, -0.14, 6), disc(0.045, 0.04, chrome, x, 0.09, -0.14, 6)]),
      // Cylinder retaining safety chain bar
      box(0.54, 0.03, 0.02, darkSteel, 0, 0.52, 0.12),
    ];

    layers.push({
      id: 'cart',
      label: 'Steel Hand Truck & Wheels',
      material: 'matte',
      parts: cartParts,
    });

    // 2. Dual Gas Cylinders (Low-Poly 8 segments)
    const tankParts: Part[] = [
      // Left: Oxygen cylinder (tall, green)
      cyl(0.095, 0.68, oxygenColor, -0.12, 0.1, 0, 8),
      cyl(0.08, 0.08, oxygenColor, -0.12, 0.78, 0, 8),
      cyl(0.03, 0.06, brass, -0.12, 0.86, 0, 6),

      // Right: Acetylene cylinder (shorter, stout, fuel maroon)
      cyl(0.105, 0.52, fuelColor, 0.12, 0.1, 0, 8),
      cyl(0.09, 0.07, fuelColor, 0.12, 0.62, 0, 8),
      cyl(0.03, 0.06, brass, 0.12, 0.69, 0, 6),

      // Coiled twin-line gas hose bundle looped on side hanger
      box(0.04, 0.28, 0.16, hoseBlue, -0.27, 0.52, -0.06),
      box(0.03, 0.26, 0.15, hoseRed, -0.29, 0.52, -0.06),
      // Brass cutting & welding torch hanging on front holster
      rotBox(0.016, 0.32, 0.02, brass, 0.27, 0.55, 0.02, 0.25, 0, 0.1),
      rotBox(0.012, 0.08, 0.012, brass, 0.27, 0.71, 0.06, 0.7, 0, 0.1),
    ];

    // Regulators with analog high/low gauges
    if (hasRegs) {
      tankParts.push(
        // Oxygen regulators
        rod(0.012, 0.08, brass, -0.12, 0.9, 0, 6),
        disc(0.025, 0.01, chrome, -0.16, 0.93, 0.02, 6),
        disc(0.025, 0.01, chrome, -0.08, 0.93, 0.02, 6),
        // Acetylene regulators
        rod(0.012, 0.08, brass, 0.12, 0.73, 0, 6),
        disc(0.025, 0.01, chrome, 0.08, 0.76, 0.02, 6),
        disc(0.025, 0.01, chrome, 0.16, 0.76, 0.02, 6),
      );
    }

    layers.push({
      id: 'tanks',
      label: 'Gas Cylinders & Torch',
      material: 'metal',
      parts: tankParts,
    });

    // 3. Optional Torch Flame Glow
    if (flame) {
      const flameParts: Part[] = [cyl(0.008, 0.08, 0x33b5e5, 0.27, 0.75, 0.1, 6), cyl(0.004, 0.05, 0xffffff, 0.27, 0.73, 0.09, 6)];
      layers.push({
        id: 'glow',
        label: 'Torch Flame',
        material: 'glow',
        shade: false,
        parts: flameParts,
      });
    }

    return layers;
  },
};
