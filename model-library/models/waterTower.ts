import * as THREE from 'three';
import { box, cyl, hexColor, paint } from '../kit';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const waterTowerBlueprint: ModelBlueprint = {
  id: 'lib:water_tower',
  name: 'Timber & Hooped Water Tower (Parametric)',
  nameFr: 'Château d’eau en bois cerclé (paramétrique)',
  category: 'architecture',
  subcategory: 'Outpost Architecture',
  tags: ['kit-library', 'parametric', 'architecture', 'tower'],
  description: 'Procedural wooden stave water tower on cross-braced timber stilts with iron hoops and conical roof.',
  footprint: [2, 2],
  sourceFile: 'model-library/models/waterTower.ts',
  params: [
    {
      key: 'wood',
      label: 'Timber Stain',
      kind: 'color',
      defaultValue: '#8a5a36',
    },
  ],
  recipe: [
    'cyl(0.08, 1.6, 0x5e422b) × 4 // Support stilts',
    'cyl(0.72, 1.25, wood, 0, 1.65, 0, 16) // Stave barrel',
    'cyl(0.74, 0.04, 0x2b3038) × 3 // Iron tension hoops',
    'ConeGeometry(0.84, 0.5, 16) // Conical roof cap',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const wood = hexColor(params.wood, 0x8a5a36);
    const parts: Part[] = [
      ...[-0.55, 0.55].flatMap((sx) => [-0.55, 0.55].map((sz) => cyl(0.08, 1.6, 0x5e422b, sx, 0, sz, 6))),
      box(1.2, 0.07, 0.07, 0x5e422b, 0, 0.75, -0.55),
      box(1.2, 0.07, 0.07, 0x5e422b, 0, 0.75, 0.55),
      box(0.07, 0.07, 1.2, 0x5e422b, -0.55, 0.75, 0),
      box(0.07, 0.07, 1.2, 0x5e422b, 0.55, 0.75, 0),
      cyl(0.82, 0.1, 0x5e422b, 0, 1.55, 0, 14),
      cyl(0.72, 1.25, wood, 0, 1.65, 0, 16),
      ...[1.8, 2.2, 2.6].map((y) => cyl(0.74, 0.04, 0x2b3038, 0, y, 0, 16)),
      paint(new THREE.ConeGeometry(0.84, 0.5, 16).translate(0, 3.15, 0), 0x4a515c),
    ];
    return [{ id: 'tower', label: 'Timber Stilt Structure & Stave Tank', material: 'matte', parts }];
  },
};
