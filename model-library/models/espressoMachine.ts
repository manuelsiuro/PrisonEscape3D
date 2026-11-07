import { box, cyl, disc, frustum, hexColor, mirrorX, repeatLinear, rod, rotBox, wedge } from '../kit';
import type { Part, PartLayerSpec, ModelBlueprint } from '../types';

export const espressoMachineBlueprint: ModelBlueprint = {
  id: 'lib:espresso_machine',
  name: 'Commercial Twin-Group Espresso Station',
  nameFr: 'Machine à expresso professionnelle double groupe',
  category: 'props',
  subcategory: 'Appliances & Canteen',
  tags: ['kit-library', 'parametric', 'prop', 'appliance', 'canteen', 'electric', 'lit-at-night', 'animated'],
  description:
    'Twin-group commercial barista espresso machine with brushed steel boiler hood, brass brew heads, angled portafilters, pressure gauge, swiveling steam wand, warming rack cups, and optional counter pedestal.',
  footprint: [1, 1],
  sourceFile: 'model-library/models/espressoMachine.ts',
  params: [
    {
      key: 'enamelColor',
      label: 'Side Enamel Panels',
      kind: 'color',
      defaultValue: '#b8322a',
    },
    {
      key: 'showPedestal',
      label: 'Barista Counter Pedestal',
      kind: 'boolean',
      defaultValue: true,
    },
    {
      key: 'brewing',
      label: 'Active Espresso Brew & Steam',
      kind: 'boolean',
      defaultValue: true,
    },
  ],
  recipe: [
    'box() + wedge() // Brushed steel chassis & sloped group hood',
    'mirrorX(0.16) -> cyl() + rotBox() // Twin brass brew groups & portafilters',
    'disc() + ring() // Boiler pressure gauge & steam control dials',
    'frustum() + ring() // Porcelain espresso cups with dark crema',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const enamel = hexColor(params.enamelColor, 0xb8322a);
    const hasPedestal = params.showPedestal !== false;
    const brewing = params.brewing !== false;
    const y0 = hasPedestal ? 0.78 : 0;

    const steel = 0xcfd6df;
    const darkSteel = 0x454c56;
    const chrome = 0xe6ecf2;
    const brass = 0xd4a238;
    const black = 0x1d2026;
    const porcelain = 0xf4f2eb;
    const crema = 0x6e3f1d;

    const layers: PartLayerSpec[] = [];

    if (hasPedestal) {
      const counterParts: Part[] = [
        // Plinth & cabinet body
        box(0.88, 0.08, 0.68, 0x22262c, 0, 0, 0),
        box(0.84, 0.65, 0.64, 0x323842, 0, 0.08, 0),
        // Wood-slat front inlay & knock-box drawer
        ...repeatLinear(5, (i) => box(0.13, 0.42, 0.02, 0x7a5234, -0.3 + i * 0.15, 0.14, 0.325)),
        box(0.36, 0.12, 0.03, darkSteel, -0.18, 0.58, 0.325),
        rod(0.012, 0.22, chrome, -0.18, 0.64, 0.355),
        // Thick butcher-block / slate countertop overhang
        box(0.92, 0.05, 0.72, 0x5c4028, 0, 0.73, 0),
      ];
      layers.push({
        id: 'pedestal',
        label: 'Barista Counter Pedestal',
        material: 'matte',
        parts: counterParts,
      });
    }

    const bodyParts: Part[] = [
      // Rubber foot pads (clean low-poly 12 triangles each)
      ...mirrorX(0.31, (x) => [box(0.045, 0.02, 0.045, black, x, y0, -0.18), box(0.045, 0.02, 0.045, black, x, y0, 0.18)]),
      // Lower chassis & drip tray basin
      box(0.68, 0.08, 0.44, darkSteel, 0, y0 + 0.03, -0.02),
      box(0.66, 0.05, 0.16, darkSteel, 0, y0 + 0.03, 0.2),
      box(0.62, 0.012, 0.13, chrome, 0, y0 + 0.075, 0.2),
      ...repeatLinear(5, (i) => box(0.012, 0.015, 0.11, 0x2a2f37, -0.2 + i * 0.1, y0 + 0.076, 0.2)),

      // Rear boiler column & enameled side cheeks
      box(0.64, 0.38, 0.28, steel, 0, y0 + 0.11, -0.09),
      ...mirrorX(0.33, (x) => [box(0.03, 0.36, 0.36, enamel, x, y0 + 0.11, -0.04), box(0.035, 0.04, 0.38, chrome, x, y0 + 0.45, -0.04)]),

      // Upper overhanging brew head valence & sloped front fascia
      box(0.66, 0.12, 0.4, steel, 0, y0 + 0.37, -0.02),
      wedge(0.62, 0.09, 0.08, chrome, 0, y0 + 0.38, 0.19, 'z+'),
      // Back splash panel
      box(0.62, 0.25, 0.03, chrome, 0, y0 + 0.12, 0.05),

      // Top cup-warming rail surround
      box(0.62, 0.015, 0.32, chrome, 0, y0 + 0.49, -0.04),
      box(0.62, 0.015, 0.015, chrome, 0, y0 + 0.53, -0.19),
      ...mirrorX(0.3, (x) => box(0.015, 0.015, 0.3, chrome, x, y0 + 0.53, -0.04)),

      // Twin brass E61 brew group heads & brew buttons (low-poly 6 segments)
      ...mirrorX(0.16, (x) => [
        cyl(0.062, 0.055, brass, x, y0 + 0.315, 0.13, 6),
        box(0.09, 0.035, 0.09, chrome, x, y0 + 0.28, 0.13),
        box(0.11, 0.035, 0.02, black, x, y0 + 0.41, 0.185),
      ]),

      // Central pressure gauge bezel & rotary steam/water knobs (low-poly 6 segments)
      disc(0.048, 0.02, chrome, 0, y0 + 0.41, 0.185, 6),
      disc(0.052, 0.005, brass, 0, y0 + 0.41, 0.192, 6),
      ...mirrorX(0.26, (x) => [disc(0.028, 0.025, black, x, y0 + 0.42, 0.19, 6), disc(0.012, 0.03, brass, x, y0 + 0.42, 0.195, 6)]),
    ];

    layers.push({
      id: 'body',
      label: 'Boiler Housing & Brew Groups',
      material: 'metal',
      parts: bodyParts,
    });

    // Portafilters & Porcelain Cups (clean low-poly 6 segments)
    const filterAndCups: Part[] = [
      ...mirrorX(0.16, (x, sign) => [
        // Filter basket & twin spouts
        cyl(0.046, 0.032, chrome, x, y0 + 0.25, 0.13, 6),
        box(0.025, 0.02, 0.015, brass, x, y0 + 0.228, 0.13),
        // Angled portafilter stem & bakelite handle
        rotBox(0.018, 0.018, 0.09, chrome, x + sign * 0.02, y0 + 0.265, 0.19, 0.1, sign * 0.22, 0),
        rotBox(0.032, 0.032, 0.11, black, x + sign * 0.042, y0 + 0.255, 0.26, 0.12, sign * 0.22, 0),
        // Stylized low-poly hexagonal cup + saucer + dark crema
        disc(0.052, 0.008, porcelain, x, y0 + 0.088, 0.14, 6),
        frustum(0.04, 0.028, 0.062, porcelain, x, y0 + 0.09, 0.14, 6),
        disc(0.035, 0.005, crema, x, y0 + 0.15, 0.14, 6),
        rotBox(0.012, 0.032, 0.018, porcelain, x + sign * 0.04, y0 + 0.12, 0.14, 0, 0, sign * 0.25),
      ]),
      // Clean low-poly espresso cup on warming rack
      frustum(0.036, 0.026, 0.055, porcelain, 0, y0 + 0.5, -0.06, 6),
    ];

    layers.push({
      id: 'portafilters',
      label: 'Portafilters & Espresso Cups',
      material: 'matte',
      parts: filterAndCups,
    });

    // Articulated Steam Wand & Milk Frothing Pitcher
    const wandPivot: readonly [number, number, number] = [-0.27, y0 + 0.35, 0.14];
    const wandParts: Part[] = [
      cyl(0.014, 0.03, brass, wandPivot[0], wandPivot[1] - 0.015, wandPivot[2], 6),
      rotBox(0.012, 0.19, 0.012, chrome, wandPivot[0] - 0.01, wandPivot[1] - 0.1, wandPivot[2] + 0.02, 0.18, 0, -0.1),
      cyl(0.016, 0.025, chrome, wandPivot[0] - 0.02, wandPivot[1] - 0.19, wandPivot[2] + 0.036, 6),
    ];

    layers.push({
      id: 'steam_wand',
      label: 'Articulated Steam Wand',
      material: 'metal',
      pivot: wandPivot,
      parts: wandParts,
    });

    // Emissive LEDs, Backlit Gauge & Espresso Stream
    const glowParts: Part[] = [
      // Backlit pressure gauge face (low-poly 8 segments)
      disc(0.04, 0.006, 0xfff3c4, 0, y0 + 0.41, 0.193, 8),
      // Green & amber brew indicator LEDs
      ...mirrorX(0.16, (x) => [
        box(0.022, 0.014, 0.008, brewing ? 0x38e54d : 0xffb703, x - 0.028, y0 + 0.42, 0.194),
        box(0.022, 0.014, 0.008, 0xff9f1c, x + 0.028, y0 + 0.42, 0.194),
      ]),
    ];
    if (brewing) {
      for (const x of [-0.16, 0.16]) {
        glowParts.push(
          cyl(0.004, 0.075, 0x9c5221, x - 0.015, y0 + 0.152, 0.13, 6),
          cyl(0.004, 0.075, 0x9c5221, x + 0.015, y0 + 0.152, 0.13, 6),
        );
      }
    }

    layers.push({
      id: 'glow',
      label: 'Gauge Backlight & Brew LEDs',
      material: 'glow',
      shade: false,
      parts: glowParts,
    });

    return layers;
  },
  animate: (rigs, t, params) => {
    const wand = rigs.steam_wand;
    if (wand) {
      wand.rotation.z = params.brewing !== false ? Math.sin(t * 3.2) * 0.08 : 0;
    }
  },
};
