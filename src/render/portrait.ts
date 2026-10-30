import * as THREE from 'three';
import { Character } from './Character';
import { visitorColors, visitorParts } from './Smuggling';
import { type Look } from './look';

const SIZE = 112;
/** The last few faces kept (a disguise put on and off again isn't photographed twice). */
const KEEP = 6;
const shots = new Map<string, string>();
/** How high over the head's foot (0.8 up the body) the hair reaches, by haircut, and a hat's crown, by hat (Character.ts hatParts). */
const STYLE_TOP = [0.52, 0.47, 0.44, 0.64, 0.65, 0.6, 0.52];
const HAT_TOP = [0, 0.7, 0.56, 0.47, 0.8, 0.9, 0.68, 0.67, 0.64, 0.89, 0.68];
/** The picture's foot (the collar), its least height (a short cut's head with room round it in the circle) and the room over the crown. */
const FOOT = 0.69;
const LEAST = 0.84;
const OVER = 0.1;
const AWAY = 3.2;

/** How high the look's head reaches: its hair, or what's on it (a hat over a flattened top; the guard's cap). */
function crown(look: Look): number {
  if (look.cap !== undefined || look.riot) return 0.63;
  if (look.hat) return Math.max(HAT_TOP[look.hat] ?? 0.9, 0.52);
  return STYLE_TOP[look.hairStyle ?? 0] ?? 0.65;
}

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
  // Its own copies of the shared materials: a material drawn here keeps this throwaway renderer
  // (a listener on it) until it's disposed, and the shared ones never are.
  who.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !Array.isArray(m.material)) m.material = m.material.clone();
  });
  who.pose(0, 0, 0, false, 1, 0, false);
  who.root.rotation.y = -0.38;
  scene.add(who.root);
  // Head and shoulders: from the collar to over the crown (a tall hat makes the picture taller), a little from above.
  const size = look.size ?? 1;
  const height = Math.max(LEAST, 0.8 + crown(look) + OVER - FOOT) * size;
  const middle = FOOT * size + height / 2;
  const camera = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2 * Math.atan(height / 2 / AWAY)), 1, 0.5, 10);
  camera.position.set(0, middle + 0.19, AWAY);
  camera.lookAt(0, middle, 0);
  renderer.render(scene, camera);
  const url = canvas.toDataURL('image/png');
  // (Its materials, the copies, disposed with it.)
  who.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  if (shots.size >= KEEP) shots.delete(shots.keys().next().value!);
  shots.set(key, url);
  return url;
}

/** The visitor figure's head and shoulders (Smuggling.ts visitorParts, boxes standing on their y: the shoulders at 0.76, the hair's crown at 1.3), with room round them in the circle. */
const SITTER_FOOT = 0.42;
const SITTER_TOP = 1.44;
/** The faces taken (a handful of looks: the board's three), kept for the game. */
const sitters = new Map<string, string>();

/**
 * A visitor's face (P39: the parole board's members on its card): the same blocky figure and
 * colours the room shows at the table, head and shoulders, turned a little toward the light as
 * the prisoner's portrait is. Taken once a look, kept.
 */
export function sitterPortraitOf(look: number, suit?: number): string {
  const key = `${look}:${suit ?? -1}`;
  const kept = sitters.get(key);
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
  // Its own parts and materials, tinted as the room tints the instances (the vertex colours shade within each part).
  const parts = visitorParts();
  const col = visitorColors(look, suit);
  const who = new THREE.Group();
  for (const [geo, c] of [
    [parts.clothes, col.clothes],
    [parts.skin, col.skin],
    [parts.hair, col.hair],
  ] as const) who.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, color: c })));
  who.rotation.y = -0.38;
  scene.add(who);
  const height = SITTER_TOP - SITTER_FOOT;
  const middle = SITTER_FOOT + height / 2;
  const camera = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2 * Math.atan(height / 2 / AWAY)), 1, 0.5, 10);
  camera.position.set(0, middle + 0.19, AWAY);
  camera.lookAt(0, middle, 0);
  renderer.render(scene, camera);
  const url = canvas.toDataURL('image/png');
  who.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  renderer.dispose();
  renderer.forceContextLoss();
  sitters.set(key, url);
  return url;
}
