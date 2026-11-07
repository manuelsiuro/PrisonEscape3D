import { box, cyl, disc, hexColor } from '../kit';
import type { ModelBlueprint, Part, PartLayerSpec } from '../types';

export const arcadeCabinetBlueprint: ModelBlueprint = {
  id: 'lib:arcade_cabinet',
  name: 'Retro Recreation Arcade Cabinet (Parametric)',
  nameFr: 'Borne d’arcade rétro (paramétrique)',
  category: 'props',
  subcategory: 'Recreation & Common Room',
  tags: ['kit-library', 'parametric', 'prop', 'electric', 'lit-at-night'],
  description: 'Common-room upright arcade machine built from kit primitives with customizable cabinet color and lit marquee.',
  footprint: [1, 1],
  sourceFile: 'model-library/models/arcadeCabinet.ts',
  params: [
    {
      key: 'cabinet',
      label: 'Cabinet Side Color',
      kind: 'color',
      defaultValue: '#2b3a67',
    },
  ],
  recipe: [
    'box(0.68, 0.72, 0.62, cabinet) // Lower coin cabinet',
    'box(0.7, 0.08, 0.66, 0x1e2228) // Control deck',
    'box(0.46, 0.3, 0.045, 0x3fd4b0) // CRT screen bezel',
    'box(0.62, 0.12, 0.03, 0xffd166) // Top marquee header',
  ],
  buildParts: (params): PartLayerSpec[] => {
    const cab = hexColor(params.cabinet, 0x2b3a67);
    const bodyParts: Part[] = [
      box(0.68, 0.72, 0.62, cab, 0, 0, 0),
      box(0.68, 0.64, 0.48, cab, 0, 0.72, -0.07),
      box(0.7, 0.08, 0.66, 0x1e2228, 0, 0.68, 0.04),
      cyl(0.015, 0.08, 0x9aa2ad, -0.16, 0.76, 0.22, 6),
      disc(0.03, 0.03, 0xd23f36, -0.16, 0.83, 0.22, 8),
      cyl(0.015, 0.08, 0x9aa2ad, 0.12, 0.76, 0.22, 6),
      disc(0.03, 0.03, 0x3a8ed8, 0.12, 0.83, 0.22, 8),
      box(0.54, 0.38, 0.04, 0x101824, 0, 0.8, 0.16),
      box(0.68, 0.16, 0.56, cab, 0, 1.32, -0.03),
    ];

    const glowParts: Part[] = [box(0.46, 0.3, 0.045, 0x3fd4b0, 0, 0.84, 0.165), box(0.62, 0.12, 0.03, 0xffd166, 0, 1.34, 0.25)];

    return [
      { id: 'cabinet', label: 'Arcade Cabinet Body & Deck', material: 'matte', parts: bodyParts },
      { id: 'screen_marquee', label: 'CRT Screen & Lit Marquee', material: 'glow', shade: false, parts: glowParts },
    ];
  },
};
