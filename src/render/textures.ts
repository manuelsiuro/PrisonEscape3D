import * as THREE from 'three';
import { seeded } from './rand';

/**
 * Pixel-art textures drawn on small canvases (no image files): one tile each, nearest-pixel
 * filtering for the crisp Escapists look. Noise comes from a fixed seed, so the look never
 * changes between loads.
 */
type Painter = (c: CanvasRenderingContext2D, n: number, rand: () => number) => void;

const cache = new Map<string, THREE.CanvasTexture>();

function texture(name: string, n: number, paint: Painter): THREE.CanvasTexture {
  const hit = cache.get(name);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const c = canvas.getContext('2d')!;
  paint(c, n, seeded(name.length * 7919 + name.charCodeAt(0)));
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  cache.set(name, t);
  return t;
}

/** Fills with a base color and sprinkles darker and lighter pixels. */
function speckle(c: CanvasRenderingContext2D, n: number, rand: () => number, base: string, dark: string, light: string, amount = 0.12) {
  c.fillStyle = base;
  c.fillRect(0, 0, n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = rand();
      if (r < amount / 2) c.fillStyle = dark;
      else if (r < amount) c.fillStyle = light;
      else continue;
      c.fillRect(x, y, 1, 1);
    }
  }
}

/**
 * A wall's cap stone, one a tile (session 14, the picture review: the caps were one flat speckle, the largest
 * surface on screen): a lit edge to the west and south, where the sun comes from, a shaded one north and
 * east, so each cap reads raised and a run of them as coping with its joints. (The texture's top row is
 * the tile's north, its left column the west.)
 */
function capEdges(c: CanvasRenderingContext2D, n: number, lit: string, shade: string) {
  c.fillStyle = lit;
  c.fillRect(0, n - 1, n, 1);
  c.fillRect(0, 0, 1, n);
  c.fillStyle = shade;
  c.fillRect(0, 0, n, 1);
  c.fillRect(n - 1, 0, 1, n);
}

const BASE = {
  grass: () =>
    texture('grass', 16, (c, n, r) => {
      speckle(c, n, r, '#5f9e43', '#54913b', '#6aa94b', 0.3);
      c.fillStyle = '#86c463';
      for (let k = 0; k < 6; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * (n - 1)), 1, 2);
    }),
  road: () =>
    texture('road', 16, (c, n, r) => {
      speckle(c, n, r, '#55585e', '#4e5157', '#5c5f65', 0.3);
    }),
  asphalt: () =>
    texture('asphalt', 16, (c, n, r) => {
      speckle(c, n, r, '#6d7178', '#666a70', '#74787f', 0.3);
    }),
  dirt: () =>
    texture('dirt', 16, (c, n, r) => {
      speckle(c, n, r, '#9a7650', '#866443', '#ad8a62', 0.35);
    }),
  /** Ground sown with mines (P11): the open ground's own look elsewhere (only San Pancho has any). */
  minefield: () =>
    texture('grass', 16, (c, n, r) => {
      speckle(c, n, r, '#5f9e43', '#54913b', '#6aa94b', 0.3);
      c.fillStyle = '#86c463';
      for (let k = 0; k < 6; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * (n - 1)), 1, 2);
    }),
  /** A wooden pier over the sea (P12): weathered planks across it, dark water in the gaps. */
  pier: () =>
    texture('pier', 16, (c, n, r) => {
      c.fillStyle = '#1f3442';
      c.fillRect(0, 0, n, n);
      for (let x = 0; x < n; x += 4) {
        const shade = 0.85 + r() * 0.2;
        c.fillStyle = `rgb(${Math.round(150 * shade)},${Math.round(128 * shade)},${Math.round(100 * shade)})`;
        c.fillRect(x, 0, 3, n);
        c.fillStyle = 'rgba(60,45,30,0.35)';
        for (let k = 0; k < 3; k++) c.fillRect(x + Math.floor(r() * 3), Math.floor(r() * n), 1, 3);
        c.fillStyle = 'rgba(230,236,240,0.35)';
        c.fillRect(x + 1, Math.floor(r() * n), 1, 1);
      }
      c.fillStyle = '#5b4b3a';
      c.fillRect(0, 7, n, 1);
    }),
  /** A trodden path (the map's `d`): bare dirt here, packed snow in the Alps. */
  trail: () =>
    texture('dirt', 16, (c, n, r) => {
      speckle(c, n, r, '#9a7650', '#866443', '#ad8a62', 0.35);
    }),
  concrete: () =>
    texture('concrete', 16, (c, n, r) => {
      speckle(c, n, r, '#b9b5ab', '#aaa69c', '#c7c3b9', 0.18);
      c.fillStyle = '#a19d93';
      c.fillRect(0, 0, n, 1);
      c.fillRect(0, 0, 1, n);
    }),
  tiled: () =>
    texture('tiled', 16, (c, n, r) => {
      speckle(c, n, r, '#dfe6ea', '#d3dadf', '#eaf0f3', 0.1);
      c.fillStyle = '#b7c2c9';
      c.fillRect(0, 0, n, 1);
      c.fillRect(0, 0, 1, n);
      c.fillRect(0, n / 2, n, 1);
      c.fillRect(n / 2, 0, 1, n);
    }),
  /** Planks running east–west, each its own shade, with staggered butt joints. */
  wood: () =>
    texture('wood', 16, (c, n, r) => {
      for (let y = 0; y < n; y += 4) {
        const shade = 0.92 + r() * 0.12;
        c.fillStyle = `rgb(${Math.round(176 * shade)},${Math.round(122 * shade)},${Math.round(72 * shade)})`;
        c.fillRect(0, y, n, 4);
        c.fillStyle = 'rgba(90,55,25,0.25)';
        for (let k = 0; k < 5; k++) c.fillRect(Math.floor(r() * n), y + 1 + Math.floor(r() * 2), 3, 1);
        c.fillStyle = '#7d522c';
        c.fillRect(0, y, n, 1);
        // Butt joints on every other plank only, so the floor reads as long boards, not bricks.
        if ((y / 4) % 2 === 1) c.fillRect(((y / 4) * 9 + 5) % n, y, 1, 4);
      }
    }),
  brick: () =>
    texture('brick', 16, (c, n, r) => {
      c.fillStyle = '#8f8a80';
      c.fillRect(0, 0, n, n);
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 4 : 0;
        for (let col = -1; col < 2; col++) {
          const x = col * 8 + off;
          const shade = 0.85 + r() * 0.3;
          c.fillStyle = `rgb(${Math.round(166 * shade)},${Math.round(84 * shade)},${Math.round(62 * shade)})`;
          c.fillRect(x + 1, row * 4 + 1, 7, 3);
        }
      }
    }),
  /** Reinforced concrete (GDD §4.3, `@`): poured panels, their seams and form-tie holes; no tool chips it. */
  reinforced: () =>
    texture('reinforced', 16, (c, n, r) => {
      speckle(c, n, r, '#7a8088', '#70767e', '#868c94', 0.25);
      c.fillStyle = '#5c626a';
      c.fillRect(0, 0, n, 1);
      c.fillRect(0, n / 2, n, 1);
      c.fillRect(0, 0, 1, n);
      c.fillStyle = '#474c53';
      for (const [x, y] of [
        [4, 4],
        [12, 4],
        [4, 12],
        [12, 12],
      ])
        c.fillRect(x, y, 1, 1);
      c.fillStyle = 'rgba(70,60,50,0.18)';
      for (let k = 0; k < 3; k++) c.fillRect(Math.floor(r() * n), 1 + Math.floor(r() * (n - 2)), 1, 3);
    }),
  wallTop: () =>
    texture('wallTop', 16, (c, n, r) => {
      speckle(c, n, r, '#5e646e', '#585e67', '#656b75', 0.22);
      capEdges(c, n, '#7b828d', '#43474f');
    }),
  /** Inside a wall, seen through a cut: dark rubble-grey core. */
  wallCore: () =>
    texture('wallCore', 16, (c, n, r) => {
      speckle(c, n, r, '#2b2e34', '#24272c', '#34383f', 0.3);
    }),
  /** Chain-link: a diamond mesh on transparent, a rail along the top. */
  fence: () =>
    texture('fence', 32, (c, n) => {
      c.clearRect(0, 0, n, n);
      c.fillStyle = '#c9ced6';
      for (let i = 0; i < n; i++) {
        for (let k = -n; k < n; k += 6) {
          const y = i + k;
          if (y >= 3 && y < n) c.fillRect(i, y, 1, 1);
          const y2 = -i + k + n;
          if (y2 >= 3 && y2 < n) c.fillRect(i, y2, 1, 1);
        }
      }
      c.fillStyle = '#e4e8ee';
      c.fillRect(0, 0, n, 3);
    }),
  /** A face for the head's front: eyes and a mouth. */
  face: (skin: string) =>
    texture(`face-${skin}`, 8, (c, n) => {
      c.fillStyle = skin;
      c.fillRect(0, 0, n, n);
      c.fillStyle = '#1d1d24';
      c.fillRect(2, 3, 1, 2);
      c.fillRect(5, 3, 1, 2);
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(3, 6, 2, 1);
    }),
  /** Packed earth around the tunnels (its top is tinted by the map above). */
  earth: () =>
    texture('earth', 16, (c, n, r) => {
      speckle(c, n, r, '#5b4330', '#4c3828', '#6a4f39', 0.4);
      c.fillStyle = '#7a6a5a';
      for (let k = 0; k < 4; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 2, 1);
    }),
  /** A tunnel's trodden floor. */
  tunnel: () =>
    texture('tunnel', 16, (c, n, r) => {
      speckle(c, n, r, '#7d5d3f', '#6b4f35', '#8e6c4b', 0.35);
      c.fillStyle = 'rgba(40,25,15,0.35)';
      for (let k = 0; k < 5; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 3, 1);
    }),
  /** Tar and gravel on the flat roofs. */
  gravel: () =>
    texture('gravel', 16, (c, n, r) => {
      speckle(c, n, r, '#7d7a74', '#73706a', '#88847d', 0.35);
      c.fillStyle = '#a19c93';
      for (let k = 0; k < 7; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 1, 1);
    }),
  /** Galvanised duct steel: seams across it. */
  duct: () =>
    texture('duct', 16, (c, n, r) => {
      speckle(c, n, r, '#a9b0b8', '#9ba2aa', '#b7bec6', 0.15);
      c.fillStyle = '#8a9199';
      c.fillRect(0, 0, n, 1);
      c.fillRect(0, n / 2, n, 1);
    }),
  /** A vent grille: slats on a frame. */
  grille: () =>
    texture('grille', 16, (c, n) => {
      c.fillStyle = '#2b3038';
      c.fillRect(0, 0, n, n);
      c.fillStyle = '#c3c9d0';
      c.fillRect(0, 0, n, 2);
      c.fillRect(0, n - 2, n, 2);
      c.fillRect(0, 0, 2, n);
      c.fillRect(n - 2, 0, 2, n);
      for (let y = 4; y < n - 2; y += 3) c.fillRect(2, y, n - 4, 1);
      c.fillStyle = '#e8b828';
      c.fillRect(1, 1, 1, 1);
      c.fillRect(n - 2, 1, 1, 1);
      c.fillRect(1, n - 2, 1, 1);
      c.fillRect(n - 2, n - 2, 1, 1);
    }),
  /** Cracks spreading in a wall face (transparent around them). */
  cracks: () =>
    texture('cracks', 32, (c, n, r) => {
      c.clearRect(0, 0, n, n);
      c.fillStyle = 'rgba(30,18,12,0.9)';
      for (let k = 0; k < 5; k++) {
        let x = n / 2 + (r() - 0.5) * 6;
        let y = n / 2 + (r() - 0.5) * 6;
        const dx = Math.cos(k * 1.3 + r());
        const dy = Math.sin(k * 1.3 + r());
        for (let s = 0; s < 14; s++) {
          c.fillRect(Math.floor(x), Math.floor(y), 1, 1);
          x += dx + (r() - 0.5);
          y += dy + (r() - 0.5);
        }
      }
      c.fillStyle = 'rgba(30,18,12,0.6)';
      c.fillRect(n / 2 - 2, n / 2 - 2, 4, 4);
    }),
  /** A pin-up poster: a sunset over palm trees (freedom, in colour). */
  poster: () =>
    texture('poster', 16, (c, n) => {
      c.fillStyle = '#f2d23c';
      c.fillRect(0, 0, n, n);
      c.fillStyle = '#e0574a';
      c.fillRect(1, 1, n - 2, 8);
      c.fillStyle = '#f29a3c';
      c.fillRect(1, 6, n - 2, 3);
      c.fillStyle = '#ffe9a8';
      c.fillRect(6, 4, 4, 3);
      c.fillStyle = '#2e86c1';
      c.fillRect(1, 9, n - 2, 6);
      c.fillStyle = '#1d2a5a';
      c.fillRect(3, 5, 1, 6);
      c.fillRect(2, 4, 3, 1);
      c.fillRect(12, 6, 1, 5);
      c.fillRect(11, 5, 3, 1);
      c.fillStyle = '#ffffff';
      c.fillRect(2, 13, 5, 1);
    }),
};

/** How a prison looks (PrisonDef.theme): Center Perks' suburban green, Stalag Flucht's alpine snow, Shankton's industrial grey, San Pancho's desert, HMP Irongate's island, the Six Hunter's pine forest. */
export type Theme = 'suburban' | 'alpine' | 'industrial' | 'desert' | 'island' | 'forest';
let theme: Theme = 'suburban';

/** The look the next textures are drawn in (set as a world is shown; textures already made keep theirs). */
export function setTheme(t: Theme) {
  theme = t;
}

/** Snow: blue-white with a cold sparkle; the trodden paths, the road, log walls, snowy tops. */
const ALPINE: Partial<typeof BASE> = {
  grass: () =>
    texture('snow', 16, (c, n, r) => {
      speckle(c, n, r, '#eef3f9', '#dbe4ef', '#fbfdff', 0.3);
      c.fillStyle = '#c9d6e6';
      for (let k = 0; k < 5; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 2, 1);
      c.fillStyle = '#ffffff';
      for (let k = 0; k < 4; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 1, 1);
    }),
  trail: () =>
    texture('trail-snow', 16, (c, n, r) => {
      speckle(c, n, r, '#c9ced4', '#b3b8bf', '#dde2e8', 0.4);
      c.fillStyle = 'rgba(120,100,80,0.35)';
      for (let k = 0; k < 6; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 2, 1);
      c.fillStyle = '#eef3f9';
      for (let k = 0; k < 5; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 1, 1);
    }),
  road: () =>
    texture('road-snow', 16, (c, n, r) => {
      speckle(c, n, r, '#dfe5ec', '#c7cfd9', '#f4f7fb', 0.3);
      // Two wheel ruts, grey slush.
      c.fillStyle = '#b9c1ca';
      c.fillRect(0, 4, n, 2);
      c.fillRect(0, 11, n, 2);
      c.fillStyle = '#b8c0c9';
      for (let k = 0; k < 6; k++) c.fillRect(Math.floor(r() * n), 3 + Math.floor(r() * 10), 2, 1);
    }),
  /** Round logs laid flat, their ends notched at the corners: a cabin wall. */
  brick: () =>
    texture('logs', 16, (c, n, r) => {
      for (let row = 0; row < 4; row++) {
        const shade = 0.88 + r() * 0.18;
        c.fillStyle = `rgb(${Math.round(126 * shade)},${Math.round(86 * shade)},${Math.round(52 * shade)})`;
        c.fillRect(0, row * 4, n, 4);
        c.fillStyle = `rgba(255,220,170,0.18)`;
        c.fillRect(0, row * 4 + 1, n, 1);
        c.fillStyle = '#4a2f1a';
        c.fillRect(0, row * 4 + 3, n, 1);
        c.fillStyle = 'rgba(60,35,18,0.35)';
        for (let k = 0; k < 3; k++) c.fillRect(Math.floor(r() * n), row * 4 + 1 + Math.floor(r() * 2), 3, 1);
      }
    }),
  wallTop: () =>
    texture('snowTop', 16, (c, n, r) => {
      // Snow on stone coping, a shade greyer than the snow on the ground, its edges lit and shaded so the walls stand out of the white.
      speckle(c, n, r, '#ccd5e0', '#c1cbd7', '#d8e0ea', 0.3);
      c.fillStyle = '#b3bdca';
      for (let k = 0; k < 6; k++) c.fillRect(1 + Math.floor(r() * (n - 3)), 1 + Math.floor(r() * (n - 2)), 2, 1);
      capEdges(c, n, '#e6edf5', '#7d8896');
    }),
  /** Snow lying on the flat roofs. */
  gravel: () =>
    texture('snowRoof', 16, (c, n, r) => {
      speckle(c, n, r, '#e9eff6', '#d3dde9', '#fafcff', 0.35);
      c.fillStyle = '#c3cfdd';
      for (let k = 0; k < 4; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 3, 1);
    }),
};

/** Crushed stone round the shell, the state highway's tar, painted cinder block inside. */
const INDUSTRIAL: Partial<typeof BASE> = {
  grass: () =>
    texture('crushedStone', 16, (c, n, r) => {
      speckle(c, n, r, '#8d8a83', '#837f78', '#98948d', 0.32);
      c.fillStyle = '#76736c';
      for (let k = 0; k < 4; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 2, 1);
      c.fillStyle = '#a7a39a';
      for (let k = 0; k < 3; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 1, 1);
    }),
  road: () =>
    texture('highway', 16, (c, n, r) => {
      speckle(c, n, r, '#43464b', '#3a3d41', '#4f5257', 0.35);
      // Tar-sealed cracks.
      c.fillStyle = '#2c2e31';
      let x = Math.floor(r() * n);
      for (let y = 0; y < n; y++) {
        c.fillRect(x, y, 1, 1);
        if (r() < 0.4) x = (x + (r() < 0.5 ? -1 : 1) + n) % n;
      }
    }),
  /** Painted cinder block: pale institutional cream (warm against the cold concrete shell), the courses staggered. */
  brick: () =>
    texture('cinder', 16, (c, n, r) => {
      c.fillStyle = '#9a9384';
      c.fillRect(0, 0, n, n);
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 4 : 0;
        for (let col = -1; col < 2; col++) {
          const shade = 0.95 + r() * 0.07;
          c.fillStyle = `rgb(${Math.round(204 * shade)},${Math.round(196 * shade)},${Math.round(176 * shade)})`;
          c.fillRect(col * 8 + off + 1, row * 4 + 1, 7, 3);
        }
      }
    }),
};

/**
 * The desert (San Pancho): pale sand, the minefield's raked and darker, a sun-bleached border
 * road, the plaza's packed red earth, adobe walls of plastered mud brick, sandy concrete, clay roofs.
 */
const DESERT: Partial<typeof BASE> = {
  grass: () =>
    texture('sand', 16, (c, n, r) => {
      speckle(c, n, r, '#dcbb84', '#cba86f', '#e8cb98', 0.35);
      c.fillStyle = '#b8945e';
      for (let k = 0; k < 4; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 1, 1);
      c.fillStyle = '#f0d8aa';
      for (let k = 0; k < 4; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 2, 1);
    }),
  /** Raked sand over the mines: ridged, a shade darker, so the field reads at a glance. */
  minefield: () =>
    texture('sandRaked', 16, (c, n, r) => {
      speckle(c, n, r, '#c9a46c', '#b8925c', '#d6b47e', 0.3);
      c.fillStyle = 'rgba(120,88,48,0.2)';
      for (let y = 1; y < n; y += 4) c.fillRect(0, y, n, 1);
      c.fillStyle = 'rgba(240,214,166,0.25)';
      for (let y = 2; y < n; y += 4) c.fillRect(0, y, n, 1);
    }),
  road: () =>
    texture('borderRoad', 16, (c, n, r) => {
      speckle(c, n, r, '#8c8172', '#7f7466', '#9a8f80', 0.35);
      // Sand blown across it.
      c.fillStyle = 'rgba(220,187,132,0.55)';
      for (let k = 0; k < 7; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 3, 1);
    }),
  asphalt: () =>
    texture('asphaltSun', 16, (c, n, r) => {
      speckle(c, n, r, '#8f877b', '#83796d', '#9c9488', 0.3);
      c.fillStyle = 'rgba(220,187,132,0.45)';
      for (let k = 0; k < 4; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 2, 1);
    }),
  trail: () =>
    texture('redEarth', 16, (c, n, r) => {
      // (Session 14: a sun-faded brown, no longer the orange of the jumpsuits standing on it.)
      speckle(c, n, r, '#a98b70', '#9a7d63', '#b79a7f', 0.38);
      c.fillStyle = 'rgba(90,60,38,0.3)';
      for (let k = 0; k < 4; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 3, 1);
    }),
  /** Adobe: mud bricks under a lime-washed plaster, worn through in patches. */
  brick: () =>
    texture('adobe', 16, (c, n, r) => {
      speckle(c, n, r, '#d2ab7c', '#c49c6c', '#dcb88a', 0.3);
      for (let k = 0; k < 2; k++) {
        const x0 = Math.floor(r() * (n - 6));
        const y0 = Math.floor(r() * (n - 4));
        c.fillStyle = '#a8683f';
        c.fillRect(x0, y0, 6, 4);
        c.fillStyle = '#8a5333';
        c.fillRect(x0, y0 + 2, 6, 1);
        c.fillRect(x0 + 3, y0, 1, 2);
      }
    }),
  reinforced: () =>
    texture('sandConcrete', 16, (c, n, r) => {
      speckle(c, n, r, '#a99f8f', '#9e9484', '#b4aa9a', 0.25);
      c.fillStyle = '#8a8070';
      c.fillRect(0, 0, n, 1);
      c.fillRect(0, n / 2, n, 1);
      c.fillRect(0, 0, 1, n);
      c.fillStyle = '#6f675a';
      for (const [x, y] of [
        [4, 4],
        [12, 4],
        [4, 12],
        [12, 12],
      ])
        c.fillRect(x, y, 1, 1);
    }),
  wallTop: () =>
    texture('adobeTop', 16, (c, n, r) => {
      // Fired-clay coping, darker than the earth and sand round it (it was the plaza's own colour).
      speckle(c, n, r, '#8e5b3d', '#814f34', '#9b6747', 0.3);
      capEdges(c, n, '#b47c56', '#64402a');
    }),
  /** Flat clay roofs. */
  gravel: () =>
    texture('clayRoof', 16, (c, n, r) => {
      speckle(c, n, r, '#b98a5c', '#a87b50', '#c69a6c', 0.4);
      c.fillStyle = '#d8b07c';
      for (let k = 0; k < 5; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 2, 1);
    }),
};

/**
 * The island (HMP Irongate): wind-bitten turf over grey rock, the ferry landing's wet cobbles,
 * salt-stained tarmac, granite ashlar walls under granite caps, slate roofs, concrete streaked
 * with rust and salt.
 */
const ISLAND: Partial<typeof BASE> = {
  grass: () =>
    texture('rockTurf', 16, (c, n, r) => {
      speckle(c, n, r, '#6f7f5a', '#66764f', '#788862', 0.3);
      c.fillStyle = '#858a84';
      for (let k = 0; k < 3; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 2, 2);
      c.fillStyle = '#a3a7a3';
      for (let k = 0; k < 4; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 1, 1);
    }),
  road: () =>
    texture('cobbles', 16, (c, n, r) => {
      c.fillStyle = '#4c5156';
      c.fillRect(0, 0, n, n);
      for (let y = 0; y < n; y += 4) {
        const off = (y / 4) % 2 ? 2 : 0;
        for (let x = -off; x < n; x += 4) {
          const shade = 0.85 + r() * 0.25;
          c.fillStyle = `rgb(${Math.round(112 * shade)},${Math.round(118 * shade)},${Math.round(122 * shade)})`;
          c.fillRect(x + 1, y + 1, 3, 3);
        }
      }
    }),
  asphalt: () =>
    texture('wetTarmac', 16, (c, n, r) => {
      speckle(c, n, r, '#555b61', '#4b5056', '#626970', 0.3);
      c.fillStyle = 'rgba(220,228,232,0.25)';
      for (let k = 0; k < 4; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 2, 1);
    }),
  /** Granite ashlar: big grey blocks, bluish, in courses. */
  brick: () =>
    texture('granite', 16, (c, n, r) => {
      c.fillStyle = '#5d636b';
      c.fillRect(0, 0, n, n);
      for (let row = 0; row < 2; row++) {
        const off = row % 2 ? 4 : 0;
        for (let col = -1; col < 2; col++) {
          const shade = 0.88 + r() * 0.2;
          c.fillStyle = `rgb(${Math.round(132 * shade)},${Math.round(138 * shade)},${Math.round(146 * shade)})`;
          c.fillRect(col * 8 + off + 1, row * 8 + 1, 7, 7);
        }
      }
      c.fillStyle = 'rgba(40,44,50,0.35)';
      for (let k = 0; k < 8; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 1, 1);
    }),
  reinforced: () =>
    texture('seaConcrete', 16, (c, n, r) => {
      speckle(c, n, r, '#727a82', '#68707a', '#7e868e', 0.25);
      c.fillStyle = '#565d65';
      c.fillRect(0, 0, n, 1);
      c.fillRect(0, n / 2, n, 1);
      c.fillRect(0, 0, 1, n);
      c.fillStyle = '#434951';
      for (const [x, y] of [
        [4, 4],
        [12, 4],
        [4, 12],
        [12, 12],
      ])
        c.fillRect(x, y, 1, 1);
      // Rust weeping from the tie holes, salt bloom.
      c.fillStyle = 'rgba(150,80,40,0.35)';
      for (const [x, y] of [
        [4, 5],
        [12, 13],
      ])
        c.fillRect(x, y, 1, 3);
      c.fillStyle = 'rgba(230,236,240,0.25)';
      for (let k = 0; k < 3; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 2, 1);
    }),
  wallTop: () =>
    texture('graniteCap', 16, (c, n, r) => {
      speckle(c, n, r, '#6b727b', '#656c75', '#737a83', 0.25);
      capEdges(c, n, '#8b929b', '#4c5259');
    }),
  /** Slate roofs: dark blue-grey tiles in overlapping rows. */
  gravel: () =>
    texture('slate', 16, (c, n, r) => {
      c.fillStyle = '#3a414b';
      c.fillRect(0, 0, n, n);
      for (let y = 0; y < n; y += 4) {
        const off = (y / 4) % 2 ? 2 : 0;
        for (let x = -off; x < n; x += 4) {
          const shade = 0.85 + r() * 0.25;
          c.fillStyle = `rgb(${Math.round(78 * shade)},${Math.round(88 * shade)},${Math.round(100 * shade)})`;
          c.fillRect(x, y, 3, 3);
        }
      }
    }),
};

/** Pine needles strewn over a texture: short rust-brown strokes, some diagonal. */
function needles(c: CanvasRenderingContext2D, n: number, rand: () => number, count: number, colors: readonly string[]) {
  for (let k = 0; k < count; k++) {
    c.fillStyle = colors[k % colors.length];
    const x = Math.floor(rand() * n);
    const y = Math.floor(rand() * n);
    const way = Math.floor(rand() * 3);
    if (way === 0) c.fillRect(x, y, 2, 1);
    else if (way === 1) c.fillRect(x, y, 1, 2);
    else {
      c.fillRect(x, y, 1, 1);
      c.fillRect((x + 1) % n, (y + 1) % n, 1, 1);
    }
  }
}

/** Rounded fieldstones laid in dark mortar (the forest's walls no tool chips, and their caps). */
function fieldstones(c: CanvasRenderingContext2D, n: number, rand: () => number, mortar: string) {
  c.fillStyle = mortar;
  c.fillRect(0, 0, n, n);
  const tones = [
    [138, 132, 120],
    [154, 146, 132],
    [122, 117, 108],
    [143, 128, 104],
    [112, 116, 112],
  ];
  // Three courses of stones of uneven length, each stone's corners knocked off, lit on top.
  for (const [y0, h] of [
    [0, 5],
    [5, 6],
    [11, 5],
  ]) {
    let x = -Math.floor(rand() * 4);
    while (x < n) {
      const w = 4 + Math.floor(rand() * 4);
      const [r, g, b] = tones[Math.floor(rand() * tones.length)];
      const shade = 0.9 + rand() * 0.18;
      c.fillStyle = `rgb(${Math.round(r * shade)},${Math.round(g * shade)},${Math.round(b * shade)})`;
      c.fillRect(x + 1, y0 + 1, w - 1, h - 1);
      c.fillStyle = mortar;
      c.fillRect(x + 1, y0 + 1, 1, 1);
      c.fillRect(x + w - 1, y0 + 1, 1, 1);
      c.fillRect(x + 1, y0 + h - 1, 1, 1);
      c.fillRect(x + w - 1, y0 + h - 1, 1, 1);
      c.fillStyle = 'rgba(255,248,230,0.22)';
      c.fillRect(x + 2, y0 + 1, w - 3, 1);
      c.fillStyle = 'rgba(30,26,20,0.25)';
      c.fillRect(x + 2, y0 + h - 2, w - 3, 1);
      // (A stone off the canvas's east edge wraps onto its west, so the tiles meet without a seam.)
      if (x + w > n) {
        c.fillStyle = `rgb(${Math.round(r * shade)},${Math.round(g * shade)},${Math.round(b * shade)})`;
        c.fillRect(0, y0 + 1, x + w - n - 1, h - 1);
      }
      x += w;
    }
  }
  // Lichen, here and there.
  c.fillStyle = 'rgba(170,180,120,0.45)';
  for (let k = 0; k < 4; k++) c.fillRect(Math.floor(rand() * n), Math.floor(rand() * n), 2, 1);
}

/**
 * The pine forest (2.36, The Six Hunter): pine-needle loam and moss underfoot, packed earth with needles in it, a muddy
 * track with its ruts and puddles, the lodge's board-and-batten timber under a cedar plate, fieldstone for the walls no
 * tool chips, flagstone floors, cedar-shake roofs, a deer fence of graduated woven wire.
 */
const FOREST: Partial<typeof BASE> = {
  grass: () =>
    texture('forestFloor', 16, (c, n, r) => {
      speckle(c, n, r, '#58703f', '#4c6336', '#647d48', 0.34);
      // Moss cushions, then the needles over them.
      c.fillStyle = '#6f8c4c';
      for (let k = 0; k < 3; k++) c.fillRect(Math.floor(r() * (n - 2)), Math.floor(r() * (n - 2)), 2, 2);
      needles(c, n, r, 16, ['#7a5a36', '#8a663c', '#6a4c2e', '#94744a']);
    }),
  trail: () =>
    texture('forestTrail', 16, (c, n, r) => {
      speckle(c, n, r, '#8c7254', '#7b6248', '#9c8262', 0.36);
      needles(c, n, r, 8, ['#6a4c2e', '#a07c4e']);
      c.fillStyle = 'rgba(70,52,34,0.35)';
      for (let k = 0; k < 3; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 2, 1);
    }),
  road: () =>
    texture('forestTrack', 16, (c, n, r) => {
      // (No ruts: the ring turns corners and a texture doesn't turn with it.) Wet mud in blotches, gravel, a puddle's glint.
      speckle(c, n, r, '#66533f', '#5a4834', '#725e48', 0.36);
      c.fillStyle = '#4c3c2c';
      for (let k = 0; k < 4; k++) c.fillRect(Math.floor(r() * (n - 3)), Math.floor(r() * (n - 2)), 3, 2);
      c.fillStyle = '#8a8478';
      for (let k = 0; k < 5; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 1, 1);
      c.fillStyle = 'rgba(170,192,204,0.4)';
      c.fillRect(Math.floor(r() * (n - 3)), Math.floor(r() * n), 2, 1);
    }),
  /** Flagstones: big worn slabs of grey-brown stone, their joints a shade darker, not a grid of bricks. */
  concrete: () =>
    texture('flagstones', 16, (c, n, r) => {
      c.fillStyle = '#7a746a';
      c.fillRect(0, 0, n, n);
      for (const [x, y, w, h] of [
        [0, 0, 10, 7],
        [10, 0, 6, 7],
        [0, 7, 6, 9],
        [6, 7, 10, 9],
      ]) {
        const shade = 0.94 + r() * 0.1;
        c.fillStyle = `rgb(${Math.round(156 * shade)},${Math.round(150 * shade)},${Math.round(138 * shade)})`;
        c.fillRect(x + 1, y + 1, w - 1, h - 1);
      }
      speckle(c, n, () => (r() < 0.75 ? 1 : r()), 'rgba(0,0,0,0)', 'rgba(90,84,74,0.35)', 'rgba(232,226,212,0.3)', 0.25);
    }),
  /** Board-and-batten: dark-stained vertical boards, a lighter batten over each joint, the grain running up. */
  brick: () =>
    texture('battens', 16, (c, n, r) => {
      for (let x = 0; x < n; x += 4) {
        const shade = 0.9 + r() * 0.14;
        c.fillStyle = `rgb(${Math.round(112 * shade)},${Math.round(76 * shade)},${Math.round(50 * shade)})`;
        c.fillRect(x, 0, 4, n);
        c.fillStyle = 'rgba(50,30,16,0.35)';
        for (let k = 0; k < 3; k++) c.fillRect(x + 1 + Math.floor(r() * 2), Math.floor(r() * n), 1, 3);
      }
      for (let x = 0; x < n; x += 4) {
        c.fillStyle = '#8a6040';
        c.fillRect(x, 0, 1, n);
        c.fillStyle = '#3c2616';
        c.fillRect(x + 1, 0, 1, n);
      }
    }),
  reinforced: () => texture('fieldstone', 16, (c, n, r) => fieldstones(c, n, r, '#4a463e')),
  /** The lodge walls' cap: a cedar plate weathered dark, a plate a tile (dark against the floors and the moss, as the caps are elsewhere). */
  wallTop: () =>
    texture('lodgeCap', 16, (c, n, r) => {
      speckle(c, n, r, '#4f463d', '#473f37', '#585046', 0.26);
      c.fillStyle = 'rgba(30,24,18,0.3)';
      for (let k = 0; k < 4; k++) c.fillRect(1 + Math.floor(r() * (n - 3)), 1 + Math.floor(r() * (n - 2)), 2, 1);
      capEdges(c, n, '#71655a', '#2a221b');
    }),
  /** Cedar shakes: split shingles in staggered rows, silvered by the weather, each row's shadow under it. */
  gravel: () =>
    texture('shakes', 16, (c, n, r) => {
      c.fillStyle = '#3e3328';
      c.fillRect(0, 0, n, n);
      for (let y = 0; y < n; y += 4) {
        const off = (y / 4) % 2 ? 2 : 0;
        for (let x = -off; x < n; x += 3 + ((x + y) % 2)) {
          const shade = 0.85 + r() * 0.25;
          c.fillStyle = `rgb(${Math.round(132 * shade)},${Math.round(110 * shade)},${Math.round(88 * shade)})`;
          c.fillRect(x, y, 3, 3);
        }
        c.fillStyle = 'rgba(30,22,14,0.4)';
        c.fillRect(0, y + 3, n, 1);
      }
    }),
  /** A deer fence: galvanised woven wire, its rows closer near the ground, a tension wire along the top. */
  fence: () =>
    texture('deerFence', 32, (c, n) => {
      c.clearRect(0, 0, n, n);
      c.fillStyle = '#c4cad0';
      for (let x = 0; x < n; x += 4) c.fillRect(x, 3, 1, n - 3);
      for (const y of [3, 9, 14, 18, 22, 25, 28, 30]) c.fillRect(0, y, n, 1);
      c.fillStyle = '#dde2e6';
      c.fillRect(0, 0, n, 1);
    }),
};

/** The fieldstone wall's cap (the forest's walls no tool chips, from above): stones in mortar, lit and shaded like every cap. */
export function stoneCap(): THREE.CanvasTexture {
  return texture('fieldstoneCap', 16, (c, n, r) => {
    fieldstones(c, n, r, '#56514a');
    capEdges(c, n, '#b4ad9e', '#3a362f');
  });
}

/** The look textures are being drawn in now (render-only choices that follow the theme: the forest's lamps, trees, towers). */
export function currentTheme(): Theme {
  return theme;
}

/** The textures, in the current theme's look. */
const THEMES: Record<Theme, Partial<typeof BASE>> = {
  suburban: {},
  alpine: ALPINE,
  industrial: INDUSTRIAL,
  desert: DESERT,
  island: ISLAND,
  forest: FOREST,
};
export const TEX = Object.fromEntries(
  (Object.keys(BASE) as Array<keyof typeof BASE>).map((k) => [k, (...a: unknown[]) => (THEMES[theme][k] || BASE[k])(...(a as [string]))]),
) as unknown as typeof BASE;
