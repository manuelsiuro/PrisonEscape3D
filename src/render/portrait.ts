import * as THREE from 'three';
import { Character, type Look } from './Character';

const SIZE = 112;
/** The last few faces kept (a disguise put on and off again isn't photographed twice). */
const KEEP = 6;
const shots = new Map<string, string>();

/**
 * Your prisoner's face (the HUD's file button and the file's head): their head and shoulders
 * photographed in a small throwaway WebGL canvas, as the item icons are (itemIcons.ts), turned
 * a little toward the light, on a transparent background. Taken again only when the look
 * changes (the Intake, a disguise, a tattoo inked): a few renders a game, none a frame.
 */
export function portraitOf(look: Look): string {
  const key = JSON.stringify(look);
  const kept = shots.get(key);
  if (kept) return kept;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.7));
  const keyLight = new THREE.DirectionalLight(0xfff2e0, 2.3);
  keyLight.position.set(-2, 3, 4);
  const rim = new THREE.DirectionalLight(0xbfd8ff, 1.1);
  rim.position.set(3, 2, -3);
  scene.add(keyLight, rim);
  // (No silhouette: it's for the player hidden behind walls.)
  const who = new Character({ ...look, silhouette: undefined });
  who.pose(0, 0, 0, false, 1, 0, false);
  who.root.rotation.y = -0.38;
  scene.add(who.root);
  // Head and shoulders: from the collar to over a hat, a little from above.
  const size = look.size ?? 1;
  const camera = new THREE.PerspectiveCamera(14, 1, 0.5, 10);
  camera.position.set(0, 1.26 * size, 3.2);
  camera.lookAt(0, 1.07 * size, 0);
  renderer.render(scene, camera);
  const url = canvas.toDataURL('image/png');
  who.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  if (shots.size >= KEEP) shots.delete(shots.keys().next().value!);
  shots.set(key, url);
  return url;
}
