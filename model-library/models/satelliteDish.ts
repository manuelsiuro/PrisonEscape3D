import { box, cyl, disc, frustum, hexColor, rod, rotBox, tubeZ } from '../kit';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const satelliteDishBlueprint: ModelBlueprint = {
  id: 'lib:satellite_dish',
  name: 'Rooftop Satellite Uplink Dish',
  nameFr: 'Antenne parabolique de liaison montante',
  category: 'fixtures',
  subcategory: 'Communications & Signals',
  tags: ['kit-library', 'parametric', 'fixture', 'comms', 'antenna', 'satellite', 'animated', 'electric'],
  description:
    'Rooftop parabolic telecommunications uplink antenna on ballasted non-penetrating tripod mount with elevation tilt yoke, feedhorn subreflector, and active azimuth satellite tracking.',
  footprint: [1, 1],
  sourceFile: 'model-library/models/satelliteDish.ts',
  params: [
    {
      key: 'dishColor',
      label: 'Reflector Dish Coating',
      kind: 'color',
      defaultValue: '#d9dee4',
    },
    {
      key: 'elevationAngle',
      label: 'Dish Elevation Pitch',
      kind: 'select',
      options: [
        { value: 'low', label: '35° (Geostationary Low Arc)' },
        { value: 'mid', label: '50° (Standard Uplink)' },
        { value: 'high', label: '70° (High Latitude Zenith)' },
      ],
      defaultValue: 'mid',
    },
    {
      key: 'tracking',
      label: 'Active Satellite Orbit Tracking',
      kind: 'boolean',
      defaultValue: true,
    },
  ],
  recipe: [
    'rotBox() + box() // Tripod non-penetrating rooftop ballast mount',
    'gimbal_azimuth (pivot) -> cyl() // Azimuth rotational kingpost mast',
    'gimbal_elevation (pivot, child of azimuth) -> frustum() // 8-faceted parabolic dish',
    'rotBox() + cyl() // Tripod feedhorn struts & LNB microwave receiver',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const dishReflector = hexColor(params.dishColor, 0xd9dee4);
    const darkSteel = 0x2e343d;
    const galvanised = 0x5a6370;
    const ballastConcrete = 0x6e7580;
    const lnbMetal = 0x1f2329;
    const brass = 0xcfa33b;

    const layers: PartLayerSpec[] = [];

    // 1. Static Ballast Base Frame (Strict Low-Poly)
    const baseParts: Part[] = [
      // Central tripod hub ring
      cyl(0.08, 0.05, galvanised, 0, 0.04, 0, 6),
      // 3 radial base legs extending out at 120-degree angles
      ...[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].flatMap((angle) => {
        const dist = 0.42;
        const bx = Math.sin(angle) * dist;
        const bz = Math.cos(angle) * dist;
        return [
          // Angle-iron ground strut
          rotBox(0.04, 0.03, dist, galvanised, bx * 0.5, 0.03, bz * 0.5, 0, angle, 0),
          // Inclined diagonal bracing strut up to mast collar
          rotBox(0.03, 0.48, 0.03, galvanised, bx * 0.45, 0.22, bz * 0.45, 0.48 * Math.cos(angle), 0, -0.48 * Math.sin(angle)),
          // Concrete ballast weight blocks
          box(0.24, 0.09, 0.16, ballastConcrete, bx, 0.045, bz),
        ];
      }),
      // Vertical central kingpost collar
      tubeZ(0.045, 0.42, galvanised, 0, 0.22, 0, 6),
    ];

    layers.push({
      id: 'base_mount',
      label: 'Ballast Tripod Mount',
      material: 'matte',
      parts: baseParts,
    });

    // 2. Articulated Azimuth Kingpost (Pivots around Y axis at [0, 0.42, 0])
    const azimuthPivot: readonly [number, number, number] = [0, 0.42, 0];
    const azimuthParts: Part[] = [
      // Slewing ring drive & vertical extension tube
      cyl(0.052, 0.08, darkSteel, azimuthPivot[0], azimuthPivot[1], azimuthPivot[2], 6),
      cyl(0.04, 0.35, galvanised, azimuthPivot[0], azimuthPivot[1] + 0.18, azimuthPivot[2], 6),
      // Elevation trunnion fork yoke at top of mast
      box(0.18, 0.04, 0.08, darkSteel, azimuthPivot[0], azimuthPivot[1] + 0.36, azimuthPivot[2]),
      rotBox(0.035, 0.12, 0.06, darkSteel, azimuthPivot[0] - 0.08, azimuthPivot[1] + 0.42, azimuthPivot[2]),
      rotBox(0.035, 0.12, 0.06, darkSteel, azimuthPivot[0] + 0.08, azimuthPivot[1] + 0.42, azimuthPivot[2]),
      rod(0.02, 0.18, darkSteel, azimuthPivot[0], azimuthPivot[1] + 0.45, azimuthPivot[2], 6),
    ];

    layers.push({
      id: 'gimbal_azimuth',
      label: 'Azimuth Turret Yoke',
      material: 'matte',
      pivot: azimuthPivot,
      parts: azimuthParts,
    });

    // 3. Articulated Elevation Dish Reflector (Child of Azimuth, pivots around X axis at [0, 0.87, 0])
    const elevationPivot: readonly [number, number, number] = [0, 0.87, 0];
    const dishParts: Part[] = [
      // Backing rib hub
      cyl(0.12, 0.05, darkSteel, elevationPivot[0], elevationPivot[1], elevationPivot[2] - 0.05, 8),
      // 8-faceted parabolic dish reflector (tapered frustum with recessed interior face)
      frustum(0.48, 0.14, 0.16, dishReflector, elevationPivot[0], elevationPivot[1], elevationPivot[2] + 0.02, 8),
      frustum(0.12, 0.44, 0.14, dishReflector, elevationPivot[0], elevationPivot[1], elevationPivot[2] + 0.04, 8),
      // Center mounting horn cap
      disc(0.08, 0.02, darkSteel, elevationPivot[0], elevationPivot[1], elevationPivot[2] + 0.06, 8),

      // Tripod feedhorn support struts extending forward to the LNB focal point
      ...[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((angle) => {
        const sx = Math.sin(angle) * 0.32;
        const sy = Math.cos(angle) * 0.32;
        return rotBox(0.015, 0.015, 0.44, galvanised, sx * 0.5, elevationPivot[1] + sy * 0.5, elevationPivot[2] + 0.22, 0, 0, angle);
      }),

      // Focal point LNB (Low-Noise Block Downconverter) receiver & feed horn
      cyl(0.032, 0.08, lnbMetal, elevationPivot[0], elevationPivot[1], elevationPivot[2] + 0.42, 6),
      cyl(0.045, 0.04, brass, elevationPivot[0], elevationPivot[1], elevationPivot[2] + 0.46, 6),
      disc(0.042, 0.01, 0x111111, elevationPivot[0], elevationPivot[1], elevationPivot[2] + 0.48, 6),
    ];

    layers.push({
      id: 'gimbal_elevation',
      label: 'Parabolic Dish & Feedhorn',
      material: 'metal',
      parent: 'gimbal_azimuth',
      pivot: elevationPivot,
      parts: dishParts,
    });

    return layers;
  },
  animate: (rigs, t, params) => {
    const pitchMode = String(params.elevationAngle ?? 'mid');
    const pitchBase = pitchMode === 'low' ? -0.55 : pitchMode === 'high' ? -1.15 : -0.85;
    const azimuth = rigs.gimbal_azimuth;
    const elevation = rigs.gimbal_elevation;

    if (elevation) {
      elevation.rotation.x = pitchBase + (params.tracking !== false ? Math.cos(t * 0.4) * 0.08 : 0);
    }
    if (azimuth) {
      // Slow realistic satellite search sweep across 90 degrees
      azimuth.rotation.y = params.tracking !== false ? Math.sin(t * 0.2) * 0.78 : 0;
    }
  },
};
