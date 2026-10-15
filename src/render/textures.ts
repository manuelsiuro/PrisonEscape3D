import * as THREE from 'three';

/**
 * Pixel-art textures drawn on small canvases (no image files): one tile each, nearest-pixel
 * filtering for the crisp Escapists look. Noise comes from a fixed seed, so the look never
 * changes between loads.
 */
type Painter = (c: CanvasRenderingContext2D, n: number, rand: () => number) => void;

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

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

const BASE = {
  grass: () =>
    texture('grass', 16, (c, n, r) => {
      speckle(c, n, r, '#5f9e43', '#4d8a36', '#74b553', 0.35);
      c.fillStyle = '#86c463';
      for (let k = 0; k < 6; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * (n - 1)), 1, 2);
    }),
  road: () =>
    texture('road', 16, (c, n, r) => {
      speckle(c, n, r, '#55585e', '#4a4d52', '#63676d', 0.3);
    }),
  asphalt: () =>
    texture('asphalt', 16, (c, n, r) => {
      speckle(c, n, r, '#6d7178', '#62666c', '#7b7f86', 0.3);
    }),
  dirt: () =>
    texture('dirt', 16, (c, n, r) => {
      speckle(c, n, r, '#9a7650', '#866443', '#ad8a62', 0.35);
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
      for (const [x, y] of [[4, 4], [12, 4], [4, 12], [12, 12]]) c.fillRect(x, y, 1, 1);
      c.fillStyle = 'rgba(70,60,50,0.18)';
      for (let k = 0; k < 3; k++) c.fillRect(Math.floor(r() * n), 1 + Math.floor(r() * (n - 2)), 1, 3);
    }),
  wallTop: () =>
    texture('wallTop', 16, (c, n, r) => {
      speckle(c, n, r, '#5e646e', '#555b64', '#6a707a', 0.22);
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
      speckle(c, n, r, '#7d7a74', '#6c6964', '#8f8b84', 0.45);
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

/** How a prison looks (PrisonDef.theme): Center Perks' suburban green, Stalag Flucht's alpine snow, Shankton's industrial grey. */
export type Theme = 'suburban' | 'alpine' | 'industrial';
let theme: Theme = 'suburban';

/** The look the next textures are drawn in (set as a world is shown; textures already made keep theirs). */
export function setTheme(t: Theme) {
  theme = t;
}
export const currentTheme = () => theme;

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
      c.fillStyle = '#9aa3ad';
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
      speckle(c, n, r, '#f1f5fa', '#dce5f0', '#ffffff', 0.25);
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
      speckle(c, n, r, '#8d8a83', '#77746e', '#a29f98', 0.5);
      c.fillStyle = '#6a6761';
      for (let k = 0; k < 6; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 2, 1);
      c.fillStyle = '#b8b4ab';
      for (let k = 0; k < 5; k++) c.fillRect(Math.floor(r() * n), Math.floor(r() * n), 1, 1);
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

/** The textures, in the current theme's look. */
const THEMES: Record<Theme, Partial<typeof BASE>> = { suburban: {}, alpine: ALPINE, industrial: INDUSTRIAL };
export const TEX = Object.fromEntries(
  (Object.keys(BASE) as Array<keyof typeof BASE>).map((k) => [k, (...a: unknown[]) => (THEMES[theme][k] || BASE[k])(...(a as [string]))]),
) as unknown as typeof BASE;
