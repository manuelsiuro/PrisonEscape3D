/** Canvas-drawn textures (labels, drawings, cards, screens, painted ground). */
import * as THREE from 'three';

/**
 * A canvas as a colour texture (sRGB). `sharp`: filtered at a slant too (anisotropy 4), for
 * pictures seen across the floor; `live`: no mipmaps, for a canvas redrawn while on screen or
 * blurred on purpose (never shrunk enough to need them).
 */
export function canvasTexture(canvas: HTMLCanvasElement, look: 'plain' | 'sharp' | 'live' = 'plain'): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (look === 'sharp') tex.anisotropy = 4;
  else if (look === 'live') {
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
  }
  return tex;
}
