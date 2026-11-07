import { box, cyl, disc, frustum, hexColor, mirrorXZ, rod, rotBox, tubeZ } from '../kit';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const sirenTowerBlueprint: ModelBlueprint = {
  id: 'lib:siren_tower',
  name: 'Perimeter Alarm Siren & Floodlight Mast',
  nameFr: 'Mât dalarme et projecteur de périmètre',
  category: 'fixtures',
  subcategory: 'Security & Surveillance',
  tags: ['kit-library', 'parametric', 'fixture', 'security', 'alarm', 'light', 'animated', 'lit-at-night'],
  description:
    'Galvanized steel lattice warning tower with twin high-output megaphone emergency siren horns, halogen floodlight luminaire, and active rotating amber strobe beacon.',
  footprint: [1, 1],
  sourceFile: 'model-library/models/sirenTower.ts',
  params: [
    {
      key: 'towerPaint',
      label: 'Tower Paint Finish',
      kind: 'color',
      defaultValue: '#7c8896',
    },
    {
      key: 'sirenCount',
      label: 'Siren Horn Configuration',
      kind: 'select',
      options: [
        { value: 'dual', label: 'Twin Megaphone Horns (Opposed)' },
        { value: 'single', label: 'Single Directional Horn' },
      ],
      defaultValue: 'dual',
    },
    {
      key: 'alarmActive',
      label: 'Active Alarm & Flashing Beacon',
      kind: 'boolean',
      defaultValue: true,
    },
  ],
  recipe: [
    'mirrorXZ() -> rotBox() // 4-legged structural lattice mast',
    'box() // Maintenance service platform & kick rail',
    'frustum() + tubeZ() // Flared acoustic emergency megaphone horns',
    'box() + disc() // Halogen perimeter security floodlight pod',
    'beacon_rot (pivot) -> cyl() // Rotating amber warning beacon',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const towerColor = hexColor(params.towerPaint, 0x7c8896);
    const darkSteel = 0x272c33;
    const hornMetal = 0x474f5a;
    const hornInside = 0x181a1f;
    const amberBeacon = 0xffa000;
    const isDual = params.sirenCount !== 'single';
    const isAlarm = params.alarmActive !== false;

    const layers: PartLayerSpec[] = [];

    // 1. Structural Lattice Mast & Base Footplates (Strict Low-Poly)
    const mastParts: Part[] = [
      // Concrete foundation pads at 4 corners
      ...mirrorXZ(0.35, 0.35, (x, z) => box(0.16, 0.08, 0.16, 0x58606c, x, 0, z)),
      // 4 tapered structural angle-iron legs rising to platform at y = 2.1
      ...mirrorXZ(0.35, 0.35, (x, z, sx, sz) =>
        rotBox(0.035, 2.12, 0.035, towerColor, x * 0.65, 1.05, z * 0.65, -sz * 0.065, 0, sx * 0.065),
      ),
      // Horizontal cross-tie frames at 3 heights
      ...[0.6, 1.2, 1.8].flatMap((y) => {
        const span = 0.52 - y * 0.12;
        return [
          box(span, 0.025, 0.025, darkSteel, 0, y, span / 2),
          box(span, 0.025, 0.025, darkSteel, 0, y, -span / 2),
          box(0.025, 0.025, span, darkSteel, span / 2, y, 0),
          box(0.025, 0.025, span, darkSteel, -span / 2, y, 0),
        ];
      }),

      // Platform floor grating & perimeter kick rail
      box(0.48, 0.025, 0.48, darkSteel, 0, 2.1, 0),
      box(0.48, 0.16, 0.02, hornMetal, 0, 2.18, 0.23),
      box(0.48, 0.16, 0.02, hornMetal, 0, 2.18, -0.23),
      box(0.02, 0.16, 0.44, hornMetal, 0.23, 2.18, 0),
      box(0.02, 0.16, 0.44, hornMetal, -0.23, 2.18, 0),

      // Central equipment mounting stanchion pole
      cyl(0.035, 0.65, darkSteel, 0, 2.12, 0, 6),
    ];

    layers.push({
      id: 'tower',
      label: 'Lattice Mast & Service Platform',
      material: 'matte',
      parts: mastParts,
    });

    // 2. Megaphone Siren Horns & Floodlight Can (Low-Poly 6 segments)
    const equipmentParts: Part[] = [
      // Primary forward emergency siren horn (facing +Z)
      tubeZ(0.035, 0.14, hornMetal, 0, 2.48, 0.08, 6),
      frustum(0.12, 0.035, 0.18, hornMetal, 0, 2.48, 0.24, 6),
      disc(0.11, 0.01, hornInside, 0, 2.48, 0.33, 6),
      cyl(0.025, 0.05, hornMetal, 0, 2.48, 0.28, 6), // central phase plug

      // Floodlight luminaire angled downward at 45 degrees
      box(0.24, 0.16, 0.14, hornMetal, 0, 2.22, 0.24),
      rotBox(0.22, 0.14, 0.02, 0xeef2f7, 0, 2.22, 0.31, 0.35, 0, 0),
      rod(0.012, 0.28, darkSteel, 0, 2.22, 0.16, 6),
    ];

    if (isDual) {
      // Rear opposed emergency siren horn (facing -Z)
      equipmentParts.push(
        tubeZ(0.035, 0.14, hornMetal, 0, 2.48, -0.08, 6),
        frustum(0.035, 0.12, 0.18, hornMetal, 0, 2.48, -0.24, 6),
        disc(0.11, 0.01, hornInside, 0, 2.48, -0.33, 6),
        cyl(0.025, 0.05, hornMetal, 0, 2.48, -0.28, 6),
      );
    }

    layers.push({
      id: 'equipment',
      label: 'Megaphone Siren Horns & Floodlight',
      material: 'metal',
      parts: equipmentParts,
    });

    // 3. Articulated Amber Rotating Beacon (Pivots around Y axis on top pole)
    const beaconPivot: readonly [number, number, number] = [0, 2.76, 0];
    const beaconParts: Part[] = [
      // Base beacon mount flange
      cyl(0.045, 0.025, darkSteel, beaconPivot[0], beaconPivot[1] - 0.02, beaconPivot[2], 6),
      // Internal faceted parabolic reflector mirror
      box(0.01, 0.065, 0.055, 0xfafafa, beaconPivot[0] + 0.015, beaconPivot[1] + 0.035, beaconPivot[2]),
      rotBox(0.01, 0.065, 0.025, 0xfafafa, beaconPivot[0] + 0.005, beaconPivot[1] + 0.035, beaconPivot[2] + 0.028, 0, 0.6, 0),
      rotBox(0.01, 0.065, 0.025, 0xfafafa, beaconPivot[0] + 0.005, beaconPivot[1] + 0.035, beaconPivot[2] - 0.028, 0, -0.6, 0),
    ];

    layers.push({
      id: 'beacon_reflector',
      label: 'Rotating Beacon Reflector',
      material: 'metal',
      pivot: beaconPivot,
      parts: beaconParts,
    });

    // 4. Translucent Amber Beacon Dome (Glass)
    const domeParts: Part[] = [cyl(0.05, 0.09, amberBeacon, beaconPivot[0], beaconPivot[1], beaconPivot[2], 6)];

    layers.push({
      id: 'beacon_dome',
      label: 'Amber Fresnel Dome',
      material: 'glass',
      pivot: beaconPivot,
      parts: domeParts,
    });

    // 5. Emissive Halogen Bulb & Floodlight Glow
    if (isAlarm) {
      const glowParts: Part[] = [
        // Central strobe lamp bulb inside beacon
        cyl(0.014, 0.045, 0xffe066, beaconPivot[0], beaconPivot[1] + 0.02, beaconPivot[2], 6),
        // Floodlight glowing reflector face
        box(0.2, 0.12, 0.01, 0xfffee6, 0, 2.22, 0.315),
      ];
      layers.push({
        id: 'glow',
        label: 'Alarm Strobe & Luminaire Glow',
        material: 'glow',
        shade: false,
        parts: glowParts,
      });
    }

    return layers;
  },
  animate: (rigs, t, params) => {
    if (params.alarmActive === false) return;
    const beacon = rigs.beacon_reflector;
    if (beacon) {
      // Rapid rotating warning beacon sweep (4 rotations per second)
      beacon.rotation.y = t * (Math.PI * 8);
    }
  },
};
