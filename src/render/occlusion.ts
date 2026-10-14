import * as THREE from 'three';

/**
 * See-through walls. Every material that can stand between the camera and the player is
 * patched so that, inside a soft ellipse around the player on screen, the pixels of things
 * in front of the player (further south, above the floor) are dithered away. Walls keep
 * their full height and their shadows (the shadow pass is not patched); a darker rim marks
 * the cut, so it reads as a window into the wall rather than a glitch. The ellipse fades in
 * and out with `strength`.
 *
 * A screen-space ordered dither (4×4 Bayer) instead of transparency: no sorting, no
 * double-blended walls, and it holds up on phones.
 */
export const occlusionUniforms = {
  /** The player's mid-body on screen, in drawing-buffer pixels (gl_FragCoord space). */
  uOccFocus: { value: new THREE.Vector2(-1e5, -1e5) },
  /** The player's world z: only geometry south of it (toward the camera) is cut. */
  uOccFocusZ: { value: -1e5 },
  /** The player's feet on screen (pixel y): nothing below them can hide the player. */
  uOccFeetY: { value: -1e5 },
  /** Pixels per world unit on screen. */
  uOccPpu: { value: 40 },
  /** Ellipse radii in pixels. */
  uOccRadius: { value: new THREE.Vector2(80, 80) },
  /** 0 = no cut, 1 = full cut. */
  uOccStrength: { value: 0 },
};

const VERTEX_DECL = /* glsl */ `
varying vec3 vOccWorld;
`;

const VERTEX_BODY = /* glsl */ `
vec4 occWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
occWorld = instanceMatrix * occWorld;
#endif
vOccWorld = (modelMatrix * occWorld).xyz;
`;

const FRAGMENT_DECL = /* glsl */ `
varying vec3 vOccWorld;
uniform vec2 uOccFocus;
uniform float uOccFocusZ;
uniform vec2 uOccRadius;
uniform float uOccFeetY;
uniform float uOccPpu;
uniform float uOccStrength;
const float OCC_BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
float occBayer(vec2 p) {
  ivec2 q = ivec2(mod(floor(p), 4.0));
  return (OCC_BAYER[q.x + q.y * 4] + 0.5) / 16.0;
}
float occCut() {
  if (uOccStrength <= 0.0 || vOccWorld.z < uOccFocusZ - 0.45 || vOccWorld.y < OCC_MIN_Y) return 0.0;
  vec2 d = (gl_FragCoord.xy - uOccFocus) / uOccRadius;
  float r = dot(d, d);
  // Full cut in the middle, a soft dithered edge, and the foot of the wall kept as a guide.
  float cut = (1.0 - smoothstep(0.45, 1.0, r)) * smoothstep(OCC_MIN_Y, OCC_MIN_Y + 0.34, vOccWorld.y);
  // Only pixels that can cover the body: none below the feet on screen.
  cut *= smoothstep(uOccFeetY - 0.35 * uOccPpu, uOccFeetY + 0.05 * uOccPpu, gl_FragCoord.y);
  return cut * uOccStrength;
}
`;

const FRAGMENT_BODY = /* glsl */ `
float occ = occCut();
if (occ > occBayer(gl_FragCoord.xy)) discard;
`;

/** Darkens the rim of the cut (applied to the final color). */
const FRAGMENT_RIM = /* glsl */ `
gl_FragColor.rgb *= 1.0 - 0.32 * smoothstep(0.0, 0.2, occ);
#include <dithering_fragment>
`;

const patched = new WeakSet<THREE.Material>();

/**
 * Makes a material see-through around the player. Below `minY` (world height) nothing is
 * cut: the foot of a wall stays as a guide, low furniture stays whole. Safe to call twice.
 */
export function seeThrough<M extends THREE.Material>(material: M, minY = 0.06): M {
  if (patched.has(material)) return material;
  patched.add(material);
  material.defines = { ...material.defines, OCC_MIN_Y: minY.toFixed(3) };
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    Object.assign(shader.uniforms, occlusionUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECL}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECL}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAGMENT_BODY}`)
      .replace('#include <dithering_fragment>', FRAGMENT_RIM);
  };
  // A different program from the unpatched material of the same type.
  material.customProgramCacheKey = () => `see-through-${minY}`;
  material.needsUpdate = true;
  return material;
}

const tmp = new THREE.Vector3();
const size = new THREE.Vector2();

/**
 * Per frame: where the player is on screen and how big the cut is. `focus` is the player's
 * feet in world space (null hides the cut, as on the title screen); `on` eases the cut in.
 */
export function updateOcclusion(renderer: THREE.WebGLRenderer, camera: THREE.OrthographicCamera, focus: THREE.Vector3 | null, dt: number) {
  const u = occlusionUniforms;
  const goal = focus ? 1 : 0;
  u.uOccStrength.value += (goal - u.uOccStrength.value) * Math.min(1, dt * 6);
  if (!focus) return;
  renderer.getDrawingBufferSize(size);
  // Mid-body (the character is about 1.25 tall), and the feet.
  tmp.set(focus.x, 0.62, focus.z).project(camera);
  u.uOccFocus.value.set((tmp.x * 0.5 + 0.5) * size.x, (tmp.y * 0.5 + 0.5) * size.y);
  tmp.set(focus.x, 0, focus.z + 0.3).project(camera);
  u.uOccFeetY.value = (tmp.y * 0.5 + 0.5) * size.y;
  u.uOccFocusZ.value = focus.z;
  // Pixels per world unit on screen (orthographic: constant).
  const ppu = size.y / ((camera.top - camera.bottom) / camera.zoom);
  u.uOccPpu.value = ppu;
  u.uOccRadius.value.set(1.2 * ppu, 1.15 * ppu);
}
