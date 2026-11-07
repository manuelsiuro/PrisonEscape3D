import { box, cyl, disc, hexColor, mirrorX, repeatRadial, ring, rod, rotBox, tubeZ, wedge } from '../kit';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const surveillanceCameraBlueprint: ModelBlueprint = {
  id: 'lib:surveillance_camera',
  name: 'Motorized PTZ Surveillance Camera',
  nameFr: 'Caméra de surveillance motorisée PTZ',
  category: 'fixtures',
  subcategory: 'Security & Surveillance',
  tags: ['kit-library', 'parametric', 'fixture', 'security', 'camera', 'wall-mounted', 'animated', 'electric', 'lit-at-night'],
  description:
    'High-resolution outdoor pan-tilt-zoom security camera on articulated swivel arm with sun visor shield, IR night-vision LED array, optical lens element, and flashing status beacon.',
  footprint: [1, 1],
  wallMounted: true,
  sourceFile: 'model-library/models/surveillanceCamera.ts',
  params: [
    {
      key: 'casingColor',
      label: 'Enclosure Paint',
      kind: 'color',
      defaultValue: '#e2e6eb',
    },
    {
      key: 'infrared',
      label: 'Infrared Night Vision LEDs',
      kind: 'boolean',
      defaultValue: true,
    },
    {
      key: 'statusLed',
      label: 'Record Status Indicator',
      kind: 'select',
      options: [
        { value: 'red', label: 'Blinking Red (Recording)' },
        { value: 'green', label: 'Steady Green (Standby)' },
        { value: 'off', label: 'Dark / Stealth' },
      ],
      defaultValue: 'red',
    },
    {
      key: 'sweeping',
      label: 'Auto Sweep Pan & Tilt',
      kind: 'boolean',
      defaultValue: true,
    },
  ],
  recipe: [
    'box() + cyl() // Wall mounting flange & cable conduit',
    'gimbal_pan (pivot) -> cyl() + rod() // Azimuth pan yoke',
    'gimbal_tilt (pivot, child of pan) -> cyl() + wedge() // Camera barrel & sun hood',
    'repeatRadial(8) -> cyl() // Infrared night illuminator ring',
    'disc() // Anti-reflective coated optical glass lens',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const casing = hexColor(params.casingColor, 0xe2e6eb);
    const darkCasing = 0x2e333b;
    const bracketMetal = 0x5a626e;
    const chrome = 0xcad2dc;
    const lensRing = 0x181a1f;
    const glassColor = 0x1b2838;
    const hasIR = params.infrared !== false;
    const statusMode = String(params.statusLed ?? 'red');

    const wallZ = -0.5; // flush against north wall
    const pivotPan: readonly [number, number, number] = [0, 1.42, wallZ + 0.28];
    const pivotTilt: readonly [number, number, number] = [0, 1.34, wallZ + 0.35];

    const layers: PartLayerSpec[] = [];

    // 1. Static Wall Mount & Conduit Arm
    const mountParts: Part[] = [
      // Wall plate & corner mounting bolt heads (low-poly 6 segments)
      box(0.24, 0.28, 0.04, bracketMetal, 0, 1.38, wallZ + 0.02),
      ...mirrorX(0.08, (x) => [
        cyl(0.012, 0.02, 0x88909c, x, 1.28, wallZ + 0.045, 6),
        cyl(0.012, 0.02, 0x88909c, x, 1.48, wallZ + 0.045, 6),
      ]),
      // Conduit cable gland & curved arm bracket extending out from wall
      tubeZ(0.024, 0.14, bracketMetal, 0, 1.38, wallZ + 0.09, 6),
      rotBox(0.06, 0.06, 0.16, casing, 0, 1.39, wallZ + 0.18, -0.22, 0, 0),
      cyl(0.05, 0.08, darkCasing, 0, 1.42, wallZ + 0.28, 8),
    ];

    layers.push({
      id: 'wall_mount',
      label: 'Wall Plate & Bracket Arm',
      material: 'matte',
      parts: mountParts,
    });

    // 2. Articulated Pan Head (Rotates horizontally around Y axis at pivotPan)
    const panParts: Part[] = [
      cyl(0.054, 0.05, casing, pivotPan[0], pivotPan[1] - 0.03, pivotPan[2], 8),
      // Left and right fork yoke holding the camera tilt trunnions
      rotBox(0.035, 0.12, 0.05, casing, pivotPan[0] - 0.1, pivotPan[1] - 0.08, pivotPan[2] + 0.07, 0, 0, 0.15),
      rotBox(0.035, 0.12, 0.05, casing, pivotPan[0] + 0.1, pivotPan[1] - 0.08, pivotPan[2] + 0.07, 0, 0, -0.15),
      rod(0.024, 0.22, darkCasing, pivotPan[0], pivotTilt[1], pivotTilt[2], 6),
    ];

    layers.push({
      id: 'gimbal_pan',
      label: 'Pan Turret Yoke',
      material: 'matte',
      pivot: pivotPan,
      parts: panParts,
    });

    // 3. Articulated Tilt Camera Body (Child of Pan Yoke, tilts vertically around X axis at pivotTilt)
    const tiltParts: Part[] = [
      // Central cylindrical camera body oriented along Z axis (low-poly 8 segments)
      tubeZ(0.082, 0.32, casing, pivotTilt[0], pivotTilt[1], pivotTilt[2] + 0.08, 8),
      // Tapered rear endcap with cable gland
      tubeZ(0.07, 0.06, darkCasing, pivotTilt[0], pivotTilt[1], pivotTilt[2] - 0.09, 8),
      cyl(0.018, 0.04, 0x1f2228, pivotTilt[0], pivotTilt[1] - 0.06, pivotTilt[2] - 0.09, 6),

      // Protective sunshield / weather visor hood overhanging top and front
      box(0.19, 0.025, 0.36, casing, pivotTilt[0], pivotTilt[1] + 0.095, pivotTilt[2] + 0.12),
      wedge(0.19, 0.045, 0.09, casing, pivotTilt[0], pivotTilt[1] + 0.075, pivotTilt[2] + 0.32, 'z+'),

      // Stepped front bezel ring (low-poly 8 segments)
      tubeZ(0.086, 0.03, darkCasing, pivotTilt[0], pivotTilt[1], pivotTilt[2] + 0.24, 8),
      tubeZ(0.076, 0.02, chrome, pivotTilt[0], pivotTilt[1], pivotTilt[2] + 0.255, 8),
      tubeZ(0.065, 0.025, lensRing, pivotTilt[0], pivotTilt[1], pivotTilt[2] + 0.265, 8),
    ];

    layers.push({
      id: 'gimbal_tilt',
      label: 'Camera Barrel & Sun Hood',
      material: 'matte',
      parent: 'gimbal_pan',
      pivot: pivotTilt,
      parts: tiltParts,
    });

    // 4. Optical Front Glass Element (low-poly 8 segments)
    const glassParts: Part[] = [
      disc(0.05, 0.015, glassColor, pivotTilt[0], pivotTilt[1], pivotTilt[2] + 0.27, 8),
      ring(0.032, 0.005, 0x4a7a9e, pivotTilt[0], pivotTilt[1], pivotTilt[2] + 0.276, 'z', 8),
    ];

    layers.push({
      id: 'lens_glass',
      label: 'Coated Optical Lens',
      material: 'glass',
      parent: 'gimbal_tilt',
      pivot: pivotTilt,
      parts: glassParts,
    });

    // 5. Emissive Elements: Infrared LEDs & Status Indicator
    const glowParts: Part[] = [];
    if (hasIR) {
      // Ring of 8 infrared LED emitters (diamond 4-facet crystals for crisp low-poly glow)
      const irLeds = repeatRadial(8, pivotTilt[0], pivotTilt[2] + 0.266, (_i, angle) => {
        const radius = 0.058;
        const lx = Math.cos(angle) * radius;
        const ly = Math.sin(angle) * radius;
        return disc(0.007, 0.008, 0xeb3b3b, lx, pivotTilt[1] + ly, 0, 4);
      });
      glowParts.push(...irLeds);
    }

    if (statusMode === 'red') {
      glowParts.push(disc(0.01, 0.01, 0xff2222, pivotTilt[0], pivotTilt[1] - 0.065, pivotTilt[2] + 0.265, 6));
    } else if (statusMode === 'green') {
      glowParts.push(disc(0.01, 0.01, 0x33ee55, pivotTilt[0], pivotTilt[1] - 0.065, pivotTilt[2] + 0.265, 6));
    }

    layers.push({
      id: 'glow',
      label: 'IR Night Illuminators & Status Beacon',
      material: 'glow',
      shade: false,
      parent: 'gimbal_tilt',
      pivot: pivotTilt,
      parts: glowParts,
    });

    return layers;
  },
  animate: (rigs, t, params) => {
    if (params.sweeping === false) return;
    const pan = rigs.gimbal_pan;
    const tilt = rigs.gimbal_tilt;
    if (pan) {
      // Smooth back-and-forth sweep across ~75 degrees (±0.65 rad)
      pan.rotation.y = Math.sin(t * 0.45) * 0.65;
    }
    if (tilt) {
      // Natural pitch dip: looks slightly lower at the edges of the sweep
      tilt.rotation.x = -0.18 + Math.cos(t * 0.9) * 0.08;
    }
  },
};
