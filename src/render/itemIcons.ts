import * as THREE from 'three';
import { ITEMS } from '../content/items';
import { itemGeometry } from './itemModels';
import { kitMaterial } from './kit';

const SIZE = 96;
let icons: string[] | null = null;

/**
 * Inventory icons: each item's 3D model photographed once from above at a slant, with a
 * key light and a soft rim, on a transparent background (a small throwaway WebGL canvas).
 * Returns data URLs by item number (index 0 unused). Built on first use, about 100 renders.
 */
export function itemIcons(): string[] {
  if (icons) return icons;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-2, 4, 3);
  const rim = new THREE.DirectionalLight(0xbfd8ff, 1.2);
  rim.position.set(3, 2, -3);
  scene.add(key, rim);
  const camera = new THREE.OrthographicCamera(-0.33, 0.33, 0.33, -0.33, 0.1, 10);
  camera.position.set(0.9, 1.6, 1.5);
  camera.lookAt(0, 0.04, 0);
  const mesh = new THREE.Mesh(undefined, kitMaterial);
  const holder = new THREE.Group();
  holder.add(mesh);
  scene.add(holder);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  icons = [''];
  for (const d of ITEMS) {
    const g = itemGeometry(d);
    mesh.geometry = g;
    // Centered and scaled to fill the frame, turned a little so long items read as diagonals.
    g.boundingBox!.getCenter(center);
    g.boundingBox!.getSize(size);
    const s = 0.56 / Math.max(size.x * 0.9, size.z, size.y * 1.4, 0.24);
    mesh.position.copy(center).multiplyScalar(-1);
    holder.scale.setScalar(s);
    holder.rotation.y = size.x > size.z * 1.6 ? -0.6 : -0.25;
    renderer.render(scene, camera);
    icons.push(canvas.toDataURL('image/png'));
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return icons;
}
