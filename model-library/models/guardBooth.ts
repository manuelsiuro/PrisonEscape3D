import { box, cyl, disc, hexColor } from '../kit';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const guardBoothBlueprint: ModelBlueprint = {
  id: 'lib:guard_booth_modular',
  name: 'Modular Security Booth (Parametric)',
  nameFr: 'Poste de garde modulaire (paramétrique)',
  category: 'architecture',
  subcategory: 'Security Buildings',
  tags: ['kit-library', 'parametric', 'security', 'building'],
  description: 'Parametric security gatehouse built with kit primitives: adjustable roof overhang, stripe color, and searchlight.',
  footprint: [2, 2],
  sourceFile: 'model-library/models/guardBooth.ts',
  params: [
    {
      key: 'accent',
      label: 'Stripe Color',
      kind: 'color',
      defaultValue: '#2f6fd1',
    },
    {
      key: 'searchlight',
      label: 'Roof Searchlight',
      kind: 'boolean',
      defaultValue: true,
    },
  ],
  recipe: [
    'box(1.6, 0.1, 1.6, 0x59606b) // Concrete plinth',
    'box(1.4, 1.5, 1.4, 0xd8dde3) // Cabin walls',
    'box(1.42, 0.18, 1.42, accent) // Hazard band',
    'box(1.75, 0.12, 1.75, 0x3b4048) // Overhang roof',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const accent = hexColor(params.accent, 0x2f6fd1);
    const hasLight = params.searchlight !== false;
    const parts: Part[] = [
      box(1.6, 0.1, 1.6, 0x59606b, 0, 0, 0),
      box(1.4, 1.5, 1.4, 0xd8dde3, 0, 0.1, 0),
      box(1.42, 0.18, 1.42, accent, 0, 0.55, 0),
      box(1.1, 0.5, 1.44, 0x223040, 0, 0.88, 0),
      box(1.44, 0.5, 1.1, 0x223040, 0, 0.88, 0),
      box(1.75, 0.12, 1.75, 0x3b4048, 0, 1.6, 0),
    ];
    if (hasLight) {
      parts.push(
        cyl(0.12, 0.18, 0x2b3038, 0, 1.72, 0, 10),
        cyl(0.18, 0.26, 0x8d949e, 0, 1.9, 0.05, 12),
        disc(0.16, 0.04, 0xffe066, 0, 2.02, 0.18, 12),
      );
    }
    return [{ id: 'structure', label: 'Security Gatehouse Structure', material: 'matte', parts }];
  },
};
