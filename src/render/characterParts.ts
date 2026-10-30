/** Pieces of a body built once or per look: hats, glasses, beards, tattoos, and the shared instruments and handset. */
import * as THREE from 'three';
import { box, cyl, merge, paint, type Part } from './kit';

/** A box w×h×d centered on (x, y, z), painted. */
export const part = (w: number, h: number, d: number, color: number, x: number, y: number, z: number): Part => box(w, h, d, color, x, y - h / 2, z);

/** Talent night's instruments (P30), built once and shared: two upturned buckets, a drumstick, a guitar (in the body's terms); and the pay phone's handset (P34, in the left hand's). */
let made: { buckets: THREE.BufferGeometry; stick: THREE.BufferGeometry; guitar: THREE.BufferGeometry; handset: THREE.BufferGeometry } | null = null;
export function instruments() {
  if (made) return made;
  // (Under the fists: the sticks come down on the heads, the fists a little outside the middle.)
  const bucket = (x: number, h: number) => [cyl(0.13, h, 0x3d78c4, x, 0, 0.42, 12), cyl(0.135, 0.025, 0x2c5a96, x, h - 0.02, 0.42, 12), cyl(0.12, 0.004, 0xe8eef5, x, h, 0.42, 12)];
  const g = new THREE.BoxGeometry(0.025, 0.025, 0.26);
  g.translate(0, 0, 0.11);
  // The guitar a hand's depth in front of the body (the strumming fist in front of it); the neck out to the left, the head at its end.
  const Z = 0.28;
  const along = (len: number, h: number, d: number, color: number, x0: number, y0: number, x1: number, y1: number, z: number) => {
    const b = new THREE.BoxGeometry(len, h, d);
    b.rotateZ(Math.atan2(y1 - y0, x1 - x0));
    b.translate((x0 + x1) / 2, (y0 + y1) / 2, z);
    return paint(b, color);
  };
  made = {
    buckets: merge([...bucket(-0.22, 0.3), ...bucket(0.22, 0.25)]),
    stick: merge([paint(g, 0xd9b27a)], false),
    guitar: merge(
      [
        box(0.3, 0.2, 0.07, 0xc98a4a, 0.04, 0.38, Z),
        box(0.22, 0.12, 0.08, 0xb37538, 0.0, 0.56, Z),
        box(0.09, 0.09, 0.085, 0x3a2414, 0.04, 0.44, Z),
        along(0.38, 0.05, 0.035, 0x5e3a1e, -0.1, 0.62, -0.46, 0.66, Z),
        along(0.1, 0.075, 0.045, 0x3a2414, -0.45, 0.66, -0.55, 0.67, Z),
      ],
      false,
    ),
    handset: handsetGeometry(),
  };
  return made;
}

/**
 * The pay phone's handset (P34), in the raised arm's terms (the arm up beside the head at
 * PHONE_ARM, the fist just over the ear): it lies along the side of the head, its ear cup by the fist
 * and the ear, the mouthpiece down and forward by the mouth; on the head's side of the arm.
 */
export const HANDSET_EAR = new THREE.Vector3(0.09, -0.37, 0.07);
export const HANDSET_MOUTH = new THREE.Vector3(0.09, -0.17, -0.2);
export function handsetGeometry(): THREE.BufferGeometry {
  const E = HANDSET_EAR;
  const M = HANDSET_MOUTH;
  const dir = new THREE.Vector3().subVectors(E, M);
  const len = dir.length();
  // A bar from the mouthpiece to the ear cup (along z, then turned onto the line between them), a cup at each end, a grey strip down its back.
  const piece = (w: number, h: number, d: number, color: number, at: number, out = 0) => {
    const b = new THREE.BoxGeometry(w, h, d);
    b.translate(out, 0, (at - 0.5) * len);
    b.rotateX(-Math.atan2(dir.y, dir.z));
    b.translate((E.x + M.x) / 2, (E.y + M.y) / 2, (E.z + M.z) / 2);
    return paint(b, color);
  };
  return merge([piece(0.07, 0.07, len + 0.04, 0x24272e, 0.5), piece(0.11, 0.1, 0.11, 0x24272e, 0.98, 0.02), piece(0.11, 0.1, 0.11, 0x24272e, 0.02, 0.02), piece(0.02, 0.075, len * 0.6, 0x5a6270, 0.5, -0.03)], false);
}

/** A colour a share of the way to another (stubble: skin toward the hair). */
export const mix = (a: number, b: number, k: number) => new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();

/** Facial hair (P16), in the head's frame: the face's front at z 0.22, the mouth at y 0.1. */
export function beardParts(kind: number, hair: number, skin: number): Part[] {
  const moustache = part(0.16, 0.035, 0.03, hair, 0, 0.13, 0.235);
  switch (kind) {
    case 1: {
      const stub = mix(skin, hair, 0.4);
      return [part(0.08, 0.12, 0.02, stub, -0.15, 0.1, 0.222), part(0.08, 0.12, 0.02, stub, 0.15, 0.1, 0.222), part(0.24, 0.05, 0.02, stub, 0, 0.04, 0.222)];
    }
    case 2:
      return [moustache];
    case 3:
      return [moustache, part(0.47, 0.1, 0.08, hair, 0, 0.02, 0.2), part(0.05, 0.22, 0.3, hair, -0.235, 0.12, 0.06), part(0.05, 0.22, 0.3, hair, 0.235, 0.12, 0.06)];
    case 4:
      return [part(0.12, 0.03, 0.03, hair, 0, 0.135, 0.235), part(0.12, 0.08, 0.04, hair, 0, 0.04, 0.235)];
    default:
      return [part(0.04, 0.18, 0.1, hair, -0.235, 0.25, 0.12), part(0.04, 0.18, 0.1, hair, 0.235, 0.25, 0.12)];
  }
}

/** Glasses (P16) over the eyes (y 0.24, the face at z 0.22): frames leave the eyes showing; shades don't. */
export function glassesParts(kind: number, color: number): Part[] {
  const z = 0.238;
  const t = kind === 2 || kind === 6 ? 0.03 : 0.02;
  const rim = (x: number, w = 0.13, h = 0.12): Part[] => [
    part(w, t, 0.015, color, x, 0.24 + h / 2, z),
    part(w, t, 0.015, color, x, 0.24 - h / 2, z),
    part(t, h, 0.015, color, x - w / 2, 0.24, z),
    part(t, h, 0.015, color, x + w / 2, 0.24, z),
  ];
  // The arms back over the ears, and the temples that join them to the frames.
  const arms = [part(0.015, 0.02, 0.22, color, -0.235, 0.27, 0.12), part(0.015, 0.02, 0.22, color, 0.235, 0.27, 0.12), part(0.07, 0.02, 0.015, color, -0.205, 0.27, z), part(0.07, 0.02, 0.015, color, 0.205, 0.27, z)];
  const bridge = part(0.07, 0.02, 0.015, color, 0, 0.27, z);
  switch (kind) {
    case 3:
      return [part(0.15, 0.1, 0.015, color, -0.1, 0.24, z), part(0.15, 0.1, 0.015, color, 0.1, 0.24, z), bridge, ...arms];
    case 4:
      return [...rim(0.1, 0.12, 0.12), part(0.01, 0.2, 0.01, color, 0.16, 0.1, z)];
    case 5:
      return [part(0.53, 0.04, 0.53, 0x5a3d22, 0, 0.3, -0.01), ...rim(-0.1, 0.15, 0.13), ...rim(0.1, 0.15, 0.13), bridge];
    case 6:
      return [...rim(-0.1, 0.15, 0.12), ...rim(0.1, 0.15, 0.12), part(0.04, 0.04, 0.015, color, -0.19, 0.31, z), part(0.04, 0.04, 0.015, color, 0.19, 0.31, z), bridge, ...arms];
    case 7:
      // P42: summer shades, big dark lenses in bright frames.
      return [part(0.16, 0.12, 0.012, 0x121216, -0.1, 0.24, z - 0.002), part(0.16, 0.12, 0.012, 0x121216, 0.1, 0.24, z - 0.002), ...rim(-0.1, 0.17, 0.14), ...rim(0.1, 0.17, 0.14), bridge, ...arms];
    default:
      return [...rim(-0.1), ...rim(0.1), bridge, ...arms];
  }
}

/** Hats (P16) on top of the hair (its top at y 0.52): never a peaked cap, so a guard's look stays theirs. */
export function hatParts(kind: number, color: number): Part[] {
  const dark = mix(color, 0x000000, 0.25);
  switch (kind) {
    case 1:
      return [part(0.5, 0.16, 0.48, color, 0, 0.55, -0.01), part(0.52, 0.06, 0.5, dark, 0, 0.46, -0.01), part(0.1, 0.08, 0.1, mix(color, 0xffffff, 0.35), 0, 0.66, -0.01)];
    case 2:
      // (Its front ahead of the hair and the face, its back behind the back hair; the knot's tails behind it.)
      return [part(0.5, 0.08, 0.52, color, 0, 0.44, -0.01), part(0.49, 0.08, 0.48, color, 0, 0.52, -0.01), part(0.07, 0.13, 0.04, color, 0.07, 0.36, -0.29), part(0.07, 0.11, 0.04, dark, -0.03, 0.37, -0.29), part(0.04, 0.02, 0.02, 0xffffff, 0.1, 0.5, 0.245)];
    case 3:
      // (Round the hair, not in it: wider than the side hair, deeper than the back hair.)
      return [part(0.53, 0.06, 0.53, color, 0, 0.41, -0.01), part(0.535, 0.02, 0.535, 0xd63c2e, 0, 0.41, -0.01)];
    case 4:
      return [part(0.52, 0.08, 0.5, color, 0, 0.48, -0.01), part(0.58, 0.24, 0.54, color, 0, 0.64, -0.01), part(0.3, 0.06, 0.3, mix(color, 0xc8c8c8, 0.3), 0, 0.77, -0.01)];
    case 5:
      return [part(0.24, 0.08, 0.24, color, 0.04, 0.55, 0), part(0.18, 0.08, 0.18, 0xffd23f, 0.04, 0.63, 0), part(0.12, 0.08, 0.12, color, 0.04, 0.71, 0), part(0.06, 0.08, 0.06, 0xffd23f, 0.04, 0.79, 0), part(0.09, 0.07, 0.09, 0xf2f2ee, 0.04, 0.86, 0)];
    case 6: {
      const pts: Part[] = [part(0.5, 0.1, 0.48, color, 0, 0.54, -0.01), part(0.06, 0.05, 0.02, 0xd63c2e, 0, 0.54, 0.236)];
      for (const x of [-0.19, 0, 0.19]) pts.push(part(0.07, 0.09, 0.03, color, x, 0.63, 0.22), part(0.07, 0.09, 0.03, color, x, 0.63, -0.24));
      for (const zz of [-0.12, 0.08]) pts.push(part(0.03, 0.09, 0.07, color, -0.24, 0.63, zz), part(0.03, 0.09, 0.07, color, 0.24, 0.63, zz));
      return pts;
    }
    case 7:
      // (The crown's foot covers the hair under the brim.)
      return [part(0.82, 0.03, 0.78, color, 0, 0.5, 0), part(0.5, 0.04, 0.49, color, 0, 0.53, -0.01), part(0.44, 0.14, 0.42, color, 0, 0.6, 0), part(0.45, 0.04, 0.43, 0x8a4b2a, 0, 0.56, 0)];
    case 8:
      return [part(0.62, 0.04, 0.6, dark, 0, 0.47, 0), part(0.5, 0.16, 0.5, color, 0, 0.56, -0.01)];
    case 9:
      return [part(0.66, 0.03, 0.62, color, 0, 0.5, 0), part(0.5, 0.04, 0.49, color, 0, 0.53, -0.01), part(0.42, 0.36, 0.4, color, 0, 0.71, 0), part(0.43, 0.05, 0.41, 0xa3262a, 0, 0.57, 0)];
    case 11:
      // P42: bunny ears on a band, pink inside.
      return [part(0.5, 0.04, 0.08, color, 0, 0.53, 0), ...[-0.1, 0.1].flatMap((x) => [part(0.08, 0.32, 0.04, color, x, 0.7, 0), part(0.04, 0.24, 0.012, 0xf7a8c8, x, 0.7, 0.024)])];
    case 12:
      // P42: a Santa hat: its white brim, a red cone tipped back, a pompom at its point.
      return [
        part(0.52, 0.08, 0.5, 0xfafafa, 0, 0.5, -0.01),
        paint(new THREE.ConeGeometry(0.24, 0.42, 12).translate(0, 0.21, 0).rotateX(-0.6).translate(0, 0.5, -0.03), color),
        paint(new THREE.SphereGeometry(0.065, 8, 6).translate(0, 0.5 + 0.42 * Math.cos(0.6), -0.03 - 0.42 * Math.sin(0.6)), 0xfafafa),
      ];
    case 13:
      // P42: a witch's hat, a brim a little wider than the head, a purple band, its point bent back; the whole hat
      // tipped back on the head, its brim's front raised, so the game's camera, looking down, still sees the face and the hair under it.
      return [part(0.62, 0.03, 0.58, color, 0, 0.5, 0), part(0.46, 0.06, 0.44, 0x8e4fc4, 0, 0.55, 0), part(0.42, 0.14, 0.4, color, 0, 0.64, 0), part(0.3, 0.14, 0.28, color, 0.01, 0.78, -0.03), part(0.18, 0.12, 0.16, color, 0.03, 0.9, -0.07), part(0.08, 0.1, 0.08, color, 0.06, 1.0, -0.12)].map((g) =>
        g.translate(0, -0.5, 0).rotateX(-0.28).translate(0, 0.52, -0.04),
      );
    default:
      return [
        part(0.25, 0.12, 0.24, color, -0.125, 0.53, 0.115),
        part(0.25, 0.12, 0.24, 0xffd23f, 0.125, 0.53, 0.115),
        part(0.25, 0.12, 0.24, 0x2f9be0, -0.125, 0.53, -0.125),
        part(0.25, 0.12, 0.24, 0x3fb950, 0.125, 0.53, -0.125),
        part(0.03, 0.08, 0.03, 0x333338, 0, 0.62, 0),
        part(0.5, 0.02, 0.06, 0xffd23f, 0, 0.66, 0),
      ];
  }
}

/** A tattoo (P16) on the front of the right forearm (the forearm spans y −0.345…−0.195, its front at z 0.07). */
export function tattooParts(kind: number, color: number, skin = 0xe8c8a8, z = 0.072): Part[] {
  const d = 0.006;
  switch (kind) {
    case 1:
      return [part(0.016, 0.08, d, color, 0, -0.27, z), part(0.05, 0.012, d, color, 0, -0.245, z), part(0.06, 0.016, d, color, 0, -0.305, z)];
    case 2:
      return [part(0.064, 0.026, d, color, 0, -0.258, z), part(0.042, 0.02, d, color, 0, -0.279, z), part(0.018, 0.016, d, color, 0, -0.295, z)];
    case 3:
      return [part(0.066, 0.016, d, color, 0, -0.27, z), part(0.016, 0.066, d, color, 0, -0.27, z)];
    case 4:
      return [part(0.03, 0.014, d, color, -0.02, -0.262, z), part(0.03, 0.014, d, color, 0.02, -0.262, z), part(0.016, 0.04, d, color, 0, -0.285, z)];
    case 6:
      // A skull (P29): the cranium, the jaw, two eyes in skin.
      return [part(0.052, 0.036, d, color, 0, -0.252, z), part(0.032, 0.02, d, color, 0, -0.284, z), part(0.012, 0.012, d + 0.002, skin, -0.012, -0.262, z), part(0.012, 0.012, d + 0.002, skin, 0.012, -0.262, z)];
    case 7:
      // An eagle (P29): the wings spread, the body and head between them.
      return [part(0.07, 0.014, d, color, 0, -0.258, z), part(0.022, 0.012, d, color, -0.036, -0.248, z), part(0.022, 0.012, d, color, 0.036, -0.248, z), part(0.016, 0.044, d, color, 0, -0.272, z), part(0.012, 0.012, d, 0xe8b828, 0, -0.243, z)];
    default:
      return [part(0.042, 0.05, d, 0xe2601c, 0, -0.29, z), part(0.026, 0.03, d, 0xf2a03c, 0, -0.255, z), part(0.012, 0.02, d, 0xffd23f, 0, -0.232, z)];
  }
}

/** The tattoos inked in the prison (P29) on one arm: on the left, the forearm's front and its outer side; on the right, its outer side (the front is the Intake's). */
export function inkedParts(inked: ReadonlyArray<readonly [number, number]>, left: boolean, skin: number): Part[] {
  const out: Part[] = [];
  const places = left ? [0, 1] : [2];
  for (const k of places) {
    const t = inked[k];
    if (!t) continue;
    // (The front face is 0.14 deep, the sides 0.13 wide: each on its own face.)
    const parts = tattooParts(t[0], t[1], skin, k > 0 ? 0.067 : 0.072);
    // (The outer side: turned a quarter about the arm, away from the body.)
    if (k > 0) for (const p of parts) p.rotateY(left ? -Math.PI / 2 : Math.PI / 2);
    out.push(...parts);
  }
  return out;
}

/**
 * Characters' own copy of the kit material: every body is a skinned mesh, so they never share
 * a material (and shader) with the unskinned furniture (no program switch between them).
 */

/** One of the instruments' shared geometries (never freed with a character). */
export const instrumentGeometry = (g: THREE.BufferGeometry | undefined) => !!made && (g === made.buckets || g === made.stick || g === made.guitar || g === made.handset);
