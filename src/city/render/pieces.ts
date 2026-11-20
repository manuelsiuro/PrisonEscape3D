import { box, cyl, type Part } from '../../render/kit';
import { mix32 } from '../../sim/rng';
import { PIECES } from '../content/build';

/**
 * What the player builds (2.67), drawn: each piece on its tile's middle, a wall or a door spanning x (turned by the view to stand
 * across the way it was built from), the rest facing +z. `worn` (0 whole, 1 nearly gone): darker, split, a board hanging off.
 * Render only: the rules are content/build.ts and sim/build.ts.
 */
const WOOD = 0x9a7748;
const WOOD_DARK = 0x6e5434;
const WOOD_LIGHT = 0xb08c5a;
const NAIL = 0x5a5f66;
const IRON = 0x7c8590;
const IRON_DARK = 0x5a626c;
const CLOTH = 0xb9a98a;
const STONE = 0x7a7670;

/** A board tilted about its own middle (z, radians), its middle then set at (x, y, z). */
function tilted(w: number, h: number, d: number, color: number, angle: number, x: number, y: number, z: number): Part {
  const p = box(w, h, d, color, 0, -h / 2, 0);
  p.rotateZ(angle);
  p.translate(x, y, z);
  return p;
}

/** A colour darkened by wear. */
const aged = (c: number, worn: number) => {
  const k = 1 - 0.45 * worn;
  return ((((c >> 16) & 255) * k) << 16) | ((((c >> 8) & 255) * k) << 8) | ((c & 255) * k);
};

export function pieceParts(kind: number, worn: number, seed: number): Part[] {
  const id = PIECES[kind]?.id;
  const w = (c: number) => aged(c, worn);
  const h = mix32(seed);
  const out: Part[] = [];
  switch (id) {
    case 'barricade': {
      // Two planks crossed, one along the top, on short legs: waist high.
      const a = tilted(1.1, 0.14, 0.07, w(WOOD), 0.5, 0, 0.45, 0);
      const b = tilted(1.1, 0.14, 0.07, w(WOOD_DARK), -0.5, 0, 0.45, 0.04);
      out.push(
        a,
        b,
        box(1.0, 0.13, 0.08, w(WOOD_LIGHT), 0, 0.74, -0.03),
        box(0.08, 0.86, 0.08, w(WOOD_DARK), -0.44, 0, 0),
        box(0.08, 0.86, 0.08, w(WOOD_DARK), 0.44, 0, 0),
      );
      break;
    }
    case 'plankWall': {
      // Upright planks side by side, two battens across, a nail head at each crossing.
      for (let k = 0; k < 5; k++) {
        const tone = [WOOD, WOOD_LIGHT, WOOD_DARK, WOOD, WOOD_LIGHT][(k + h) % 5];
        const tall = 1.5 - (worn > 0.5 && k === (h & 3) ? 0.45 : 0) - ((h >> (k * 3)) & 3) * 0.03;
        out.push(box(0.19, tall, 0.3, w(tone), -0.4 + k * 0.2, 0, 0));
      }
      out.push(box(1.0, 0.12, 0.06, w(WOOD_DARK), 0, 0.32, 0.18), box(1.0, 0.12, 0.06, w(WOOD_DARK), 0, 1.08, 0.18));
      for (const y of [0.38, 1.14]) for (let k = 0; k < 5; k++) out.push(box(0.03, 0.03, 0.02, NAIL, -0.4 + k * 0.2, y, 0.215));
      break;
    }
    case 'metalWall': {
      // Sheets of scrap overlapping on two posts, a band of rust low down.
      out.push(
        box(0.14, 1.6, 0.3, w(IRON_DARK), -0.44, 0, 0),
        box(0.14, 1.6, 0.3, w(IRON_DARK), 0.44, 0, 0),
        box(1.0, 0.07, 0.3, w(IRON_DARK), 0, 1.53, 0),
      );
      for (let k = 0; k < 4; k++) {
        const tone = [IRON, 0x8a9198, IRON_DARK, 0x9a8a78][(k + h) % 4];
        out.push(box(0.27, 1.42, 0.04, w(tone), -0.36 + k * 0.24, 0.06 + (k % 2) * 0.04, 0.06 - (k % 2) * 0.02));
      }
      out.push(box(1.0, 0.18, 0.05, w(0x8a5a3a), 0, 0.08, 0.09));
      break;
    }
    case 'door': {
      // A frame of posts and a lintel, a leaf of planks with a Z brace and a handle.
      out.push(
        box(0.12, 1.6, 0.3, w(WOOD_DARK), -0.45, 0, 0),
        box(0.12, 1.6, 0.3, w(WOOD_DARK), 0.45, 0, 0),
        box(1.02, 0.12, 0.3, w(WOOD_DARK), 0, 1.5, 0),
      );
      for (let k = 0; k < 4; k++) out.push(box(0.2, 1.42, 0.12, w(k % 2 ? WOOD_LIGHT : WOOD), -0.3 + k * 0.2, 0.04, 0));
      const brace = tilted(0.95, 0.1, 0.04, w(WOOD_DARK), 0.9, 0, 0.75, 0.05);
      out.push(brace, box(0.8, 0.1, 0.04, w(WOOD_DARK), 0, 0.22, 0.05), box(0.8, 0.1, 0.04, w(WOOD_DARK), 0, 1.22, 0.05));
      out.push(box(0.05, 0.12, 0.06, NAIL, 0.3, 0.7, 0.07));
      break;
    }
    case 'chest':
      out.push(
        box(0.8, 0.46, 0.54, w(WOOD), 0, 0, 0),
        box(0.84, 0.1, 0.58, w(WOOD_DARK), 0, 0.46, 0),
        box(0.06, 0.58, 0.6, IRON_DARK, -0.28, 0, 0),
        box(0.06, 0.58, 0.6, IRON_DARK, 0.28, 0, 0),
        box(0.12, 0.12, 0.04, IRON, 0, 0.36, 0.3),
      );
      break;
    case 'cot':
      // A camp bed: a frame on legs, a folded blanket, a rolled pillow.
      out.push(
        box(0.66, 0.08, 0.92, w(WOOD_DARK), 0, 0.22, 0),
        ...[-0.28, 0.28].flatMap((x) => [-0.4, 0.4].map((z) => box(0.06, 0.22, 0.06, w(WOOD_DARK), x, 0, z))),
        box(0.6, 0.07, 0.86, w(CLOTH), 0, 0.3, 0),
        box(0.6, 0.06, 0.4, w([0x5f7f4c, 0x3f6a8c, 0xa8443c][h % 3]), 0, 0.37, 0.18),
        box(0.42, 0.1, 0.16, 0xe8e2d0, 0, 0.37, -0.32),
      );
      break;
    case 'workbench':
      out.push(
        box(0.94, 0.08, 0.6, w(WOOD_LIGHT), 0, 0.7, 0),
        ...[-0.4, 0.4].flatMap((x) => [-0.24, 0.24].map((z) => box(0.08, 0.7, 0.08, w(WOOD_DARK), x, 0, z))),
        box(0.86, 0.06, 0.5, w(WOOD), 0, 0.22, 0),
        box(0.16, 0.12, 0.14, IRON_DARK, 0.34, 0.78, 0.2),
        box(0.24, 0.03, 0.05, NAIL, -0.2, 0.78, -0.1),
      );
      break;
    case 'campfire': {
      // A ring of stones, logs crossed in it (the flame is the light's).
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        out.push(box(0.16, 0.1 + ((h >> k) & 1) * 0.04, 0.14, STONE, Math.cos(a) * 0.36, 0, Math.sin(a) * 0.36));
      }
      for (let k = 0; k < 3; k++) {
        const log = box(0.62, 0.09, 0.09, w(WOOD_DARK), 0, 0.06 + k * 0.03, 0);
        log.rotateY((k * Math.PI) / 3);
        out.push(log);
      }
      out.push(cyl(0.2, 0.03, 0x2a2420, 0, 0.01, 0, 10));
      break;
    }
    case 'table':
      out.push(
        box(0.84, 0.07, 0.64, w(WOOD), 0, 0.62, 0),
        ...[-0.36, 0.36].flatMap((x) => [-0.26, 0.26].map((z) => box(0.07, 0.62, 0.07, w(WOOD_DARK), x, 0, z))),
      );
      break;
    case 'chair':
      out.push(
        box(0.42, 0.06, 0.42, w(WOOD), 0, 0.38, 0),
        ...[-0.17, 0.17].flatMap((x) => [-0.17, 0.17].map((z) => box(0.05, 0.38, 0.05, w(WOOD_DARK), x, 0, z))),
        box(0.42, 0.42, 0.05, w(WOOD_DARK), 0, 0.44, -0.19),
      );
      break;
    case 'rug':
      out.push(
        box(0.9, 0.02, 0.7, w([0x8a3a32, 0x3f5a7c, 0x6a5a3a][h % 3]), 0, 0, 0),
        box(0.7, 0.022, 0.08, w(0xd8c8a0), 0, 0, 0.18),
        box(0.7, 0.022, 0.08, w(0xd8c8a0), 0, 0, -0.18),
      );
      break;
  }
  // (Worn past half: a split, darker gap, as the dead's blows leave it.)
  if (worn > 0.5 && (id === 'plankWall' || id === 'barricade' || id === 'door' || id === 'metalWall'))
    out.push(box(0.05, 0.5, 0.14, 0x1a1612, -0.1 + ((h & 7) - 3.5) * 0.05, 0.5, 0.02));
  return out;
}
