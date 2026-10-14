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

export const TEX = {
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
};
