import { box, cyl, disc, frame, hexColor, mirrorX, repeatLinear, repeatRadial, ring, rod, rotBox, tubeZ, wedge } from '../kit';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const dieselGeneratorBlueprint: ModelBlueprint = {
  id: 'lib:diesel_generator',
  name: 'Heavy Duty Diesel Backup Generator',
  nameFr: 'Groupe électrogène diesel industriel',
  category: 'fixtures',
  subcategory: 'Power & Utilities',
  tags: ['kit-library', 'parametric', 'fixture', 'utility', 'power', 'generator', 'electric', 'animated', 'industrial'],
  description:
    'Skid-mounted industrial diesel generator with sound-attenuated acoustic canopy, radiator cooling fan, control panel with analog voltage meters, and exhaust muffler with active counterweighted rain flap.',
  footprint: [2, 1],
  sourceFile: 'model-library/models/dieselGenerator.ts',
  params: [
    {
      key: 'enclosureColor',
      label: 'Canopy Enclosure Paint',
      kind: 'color',
      defaultValue: '#e69500',
    },
    {
      key: 'running',
      label: 'Generator Running',
      kind: 'boolean',
      defaultValue: true,
    },
    {
      key: 'serviceDoors',
      label: 'Maintenance Inspection Hatches',
      kind: 'boolean',
      defaultValue: true,
    },
  ],
  recipe: [
    'box() // Channel steel skid base with forklift pockets',
    'box() + wedge() // Sound-attenuated acoustic weather canopy',
    'fan (pivot) -> repeatRadial(6) -> rotBox() // Engine cooling fan',
    'exhaust_flap (pivot) -> disc() + rod() // Counterweighted rain cap',
    'disc() + ring() // Analog AC voltage & frequency meters',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const canopyColor = hexColor(params.enclosureColor, 0xe69500);
    const skidMetal = 0x242830;
    const darkSteel = 0x3d434d;
    const chrome = 0xcfd6df;
    const black = 0x181a1f;
    const exhaustRust = 0x4f4541;
    const isRunning = params.running !== false;
    const hasDoors = params.serviceDoors !== false;

    const layers: PartLayerSpec[] = [];

    // 1. Skid Frame, Fuel Tank Plinth & Main Acoustic Canopy
    const bodyParts: Part[] = [
      // Twin longitudinal C-channel steel skids with forklift lift slots
      box(1.68, 0.09, 0.1, skidMetal, 0, 0, -0.34),
      box(1.68, 0.09, 0.1, skidMetal, 0, 0, 0.34),
      box(1.62, 0.05, 0.62, skidMetal, 0, 0.09, 0),
      // Forklift pockets through skid frame
      ...mirrorX(0.42, (x) => [box(0.18, 0.06, 0.8, 0x121417, x, 0.02, 0)]),

      // Main acoustic canopy housing
      box(1.5, 0.72, 0.68, canopyColor, 0, 0.14, 0),
      // Angled roof chamfer edges shedding rain
      wedge(1.5, 0.06, 0.08, canopyColor, 0, 0.86, 0.3, 'z+'),
      wedge(1.5, 0.06, 0.08, canopyColor, 0, 0.86, -0.3, 'z-'),
      box(1.5, 0.03, 0.54, canopyColor, 0, 0.86, 0),

      // Radiator end air-intake housing (at -X)
      box(0.12, 0.68, 0.64, darkSteel, -0.74, 0.15, 0),
      ...frame(0.6, 0.52, 0.04, 0.04, black, -0.81, 0.22, 0),
      // Louvered air-intake slats on front face (low-poly 5 slats)
      ...repeatLinear(5, (_i, t) => {
        const y = 0.28 + t * 0.38;
        return rotBox(0.02, 0.03, 0.52, darkSteel, -0.81, y, 0, 0, 0, 0.35);
      }),

      // Control panel recess (at +X front)
      box(0.04, 0.45, 0.48, black, 0.76, 0.32, 0),
      // Analog meter bezels & dials (low-poly 6 segments)
      disc(0.045, 0.015, chrome, 0.785, 0.62, -0.12, 6),
      disc(0.045, 0.015, chrome, 0.785, 0.62, 0.12, 6),
      disc(0.038, 0.018, 0xf6f6ef, 0.785, 0.62, -0.12, 6),
      disc(0.038, 0.018, 0xf6f6ef, 0.785, 0.62, 0.12, 6),
      // Key switch & Emergency Stop mushroom push-button (low-poly 6 segments)
      cyl(0.018, 0.025, 0xe02d2d, 0.785, 0.45, -0.12, 6),
      ring(0.024, 0.005, 0xffd23f, 0.785, 0.45, -0.12, 'x', 6),
      box(0.03, 0.03, 0.02, black, 0.785, 0.45, 0.12),

      // Roof lifting eye lugs (low-poly 6 segments)
      ...mirrorX(0.48, (x) => [ring(0.045, 0.012, chrome, x, 0.94, 0, 'z', 6)]),

      // Exhaust pipe riser & cylindrical silencer muffler (low-poly 8 segments)
      cyl(0.04, 0.18, exhaustRust, 0.35, 0.88, 0.14, 8),
      cyl(0.09, 0.38, exhaustRust, 0.35, 1.04, 0.14, 8),
      tubeZ(0.045, 0.18, exhaustRust, 0.35, 1.44, 0.19, 8),
    ];

    if (hasDoors) {
      // Side maintenance access panels with recessed latches on both sides
      for (const sz of [-1, 1] as const) {
        const z = sz * 0.345;
        bodyParts.push(
          ...mirrorX(0.28, (x) => [
            box(0.44, 0.58, 0.015, canopyColor, x, 0.2, z),
            box(0.08, 0.05, 0.02, darkSteel, x + 0.14, 0.48, z),
            rod(0.008, 0.06, chrome, x + 0.14, 0.48, z + sz * 0.01),
          ]),
        );
      }
    }

    layers.push({
      id: 'canopy',
      label: 'Skid Frame & Acoustic Enclosure',
      material: 'matte',
      parts: bodyParts,
    });

    // 2. Articulated Cooling Fan (Spins around X axis at radiator face, low-poly 6 segments)
    const fanPivot: readonly [number, number, number] = [-0.75, 0.48, 0];
    const fanParts: Part[] = [
      rod(0.045, 0.035, darkSteel, fanPivot[0], fanPivot[1], fanPivot[2], 6),
      // 6 aerofoil fan blades angled radially
      ...repeatRadial(6, fanPivot[0] + 0.01, fanPivot[2], (_i, _a) => {
        return rotBox(0.01, 0.16, 0.05, 0x1f232b, 0, fanPivot[1] + 0.1, 0, 0, 0.42, 0);
      }),
    ];

    layers.push({
      id: 'radiator_fan',
      label: 'Engine Radiator Fan',
      material: 'metal',
      pivot: fanPivot,
      parts: fanParts,
    });

    // 3. Articulated Exhaust Rain Cap Flap (Pivots open on hinge at top of muffler, low-poly 6 segments)
    const flapPivot: readonly [number, number, number] = [0.35, 1.48, 0.28];
    const flapParts: Part[] = [
      disc(0.052, 0.012, exhaustRust, flapPivot[0], flapPivot[1], flapPivot[2], 6),
      // Counterweight arm behind hinge
      box(0.012, 0.05, 0.015, exhaustRust, flapPivot[0], flapPivot[1] + 0.02, flapPivot[2] - 0.02),
      cyl(0.02, 0.03, exhaustRust, flapPivot[0], flapPivot[1] + 0.04, flapPivot[2] - 0.03, 6),
    ];

    layers.push({
      id: 'exhaust_flap',
      label: 'Exhaust Rain Cap Flap',
      material: 'metal',
      pivot: flapPivot,
      parts: flapParts,
    });

    // 4. Glow Indicators & Power Status Lights
    const glowParts: Part[] = [
      // Control panel status lights (run green, fault amber)
      disc(0.012, 0.01, isRunning ? 0x22ee44 : 0x555555, 0.785, 0.38, -0.06, 8),
      disc(0.012, 0.01, 0xee9922, 0.785, 0.38, 0, 8),
      disc(0.012, 0.01, 0xee2222, 0.785, 0.38, 0.06, 8),
    ];

    layers.push({
      id: 'glow',
      label: 'Status Beacon & Gauge LEDs',
      material: 'glow',
      shade: false,
      parts: glowParts,
    });

    return layers;
  },
  animate: (rigs, t, params) => {
    const isRunning = params.running !== false;
    const fan = rigs.radiator_fan;
    const flap = rigs.exhaust_flap;
    const canopy = rigs.canopy;

    if (fan) {
      fan.rotation.x = isRunning ? t * 18 : 0;
    }
    if (flap) {
      // When running, the exhaust puff causes the hinged rain cap to bounce open
      flap.rotation.x = isRunning ? 0.38 + Math.abs(Math.sin(t * 14)) * 0.22 : 0;
    }
    if (canopy) {
      // Subtle diesel engine mechanical vibration
      canopy.position.y = isRunning ? Math.sin(t * 42) * 0.0015 : 0;
    }
  },
};
