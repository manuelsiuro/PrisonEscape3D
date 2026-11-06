import * as THREE from 'three';
import { ITEMS } from '../content/items';
import { itemGeometry } from './itemModels';
import { kitMaterial } from './kit';

const SIZE = 96;
/** Icons per idle slice (each is a render and a PNG encode). */
const PER_SLICE = 8;

/** Data URLs by item number (index 0 unused); filled a few at a time. */
const icons: string[] = [''];

/** The photo studio: a small throwaway WebGL canvas, lights and a camera, made on first use. */
interface Studio {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  mesh: THREE.Mesh;
  holder: THREE.Group;
}
let studio: Studio | null = null;

function openStudio(): Studio {
  if (studio) return studio;
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
  return (studio = { canvas, renderer, scene, camera, mesh, holder });
}

function closeStudio() {
  if (!studio) return;
  studio.renderer.dispose();
  studio.renderer.forceContextLoss();
  studio = null;
}

const center = new THREE.Vector3();
const size = new THREE.Vector3();

/** Photographs the next item. */
function shootNext() {
  const s = openStudio();
  const d = ITEMS[icons.length - 1];
  const g = itemGeometry(d);
  s.mesh.geometry = g;
  // Centered and scaled to fill the frame, turned a little so long items read as diagonals.
  g.boundingBox!.getCenter(center);
  g.boundingBox!.getSize(size);
  s.mesh.position.copy(center).multiplyScalar(-1);
  s.holder.scale.setScalar(0.56 / Math.max(size.x * 0.9, size.z, size.y * 1.4, 0.24));
  s.holder.rotation.y = size.x > size.z * 1.6 ? -0.6 : -0.25;
  s.renderer.render(s.scene, s.camera);
  icons.push(s.canvas.toDataURL('image/png'));
  if (icons.length > ITEMS.length) closeStudio();
}

/**
 * Inventory icons: each item's 3D model photographed from above at a slant, with a key
 * light and a soft rim, on a transparent background. `warmIcons` takes them a few at a time
 * in idle moments (no long freeze on the title screen); asking for them before that's done
 * finishes the rest at once.
 */
export function itemIcons(): string[] {
  while (icons.length <= ITEMS.length) shootNext();
  return icons;
}

export function warmIcons() {
  if (icons.length > ITEMS.length) return;
  const idle = (f: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(f, { timeout: 500 }) : setTimeout(f, 16));
  idle(() => {
    for (let k = 0; k < PER_SLICE && icons.length <= ITEMS.length; k++) shootNext();
    warmIcons();
  });
}
