import * as THREE from 'three';
import { DOING } from '../sim/systems/inmates';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { box, cyl, kitMaterial, merge, paint, type Part } from './kit';

export interface Look {
  outfit: number;
  skin: number;
  hair: number;
  /** 0 short, 1 buzz cut, 2 bald, 3 tall top. */
  hairStyle?: number;
  /** Overall size (1 = the player). */
  size?: number;
  /** Walking pace against the player's (legs swing slower for slower walkers). */
  gait?: number;
  /** Shown when the character is hidden behind something (the player only). */
  silhouette?: number;
  /** A guard: a peaked cap of this color, a badge and a belt instead of the number patch. */
  cap?: number;
  /** Trouser color (the outfit's otherwise). */
  trousers?: number;
  /** A guard's door key on its belt, in the key's color (GDD §10.2). */
  key?: number;
  /** An armored riot guard (P12): a helmet and visor instead of the cap, plates over the uniform. */
  riot?: boolean;
  /**
   * Your prisoner (P16, content/prisoner.ts): facial hair (0 none, 1 stubble, 2 moustache,
   * 3 full beard, 4 goatee, 5 sideburns), a hat (shape 1–13) and glasses (1–7) in a colour, a
   * tattoo on the right forearm (1–5), the jumpsuit's trim colour (cuffs, waistband, side stripes).
   */
  beard?: number;
  hat?: number;
  hatColor?: number;
  glasses?: number;
  glassesColor?: number;
  tattoo?: number;
  tattooColor?: number;
  trim?: number;
  /** P29: tattoos inked in the prison ([shape, colour] each, in order): the left forearm's front, its outer side, the right forearm's outer side. */
  inked?: ReadonlyArray<readonly [number, number]>;
}

/** The orange jumpsuit (tech plan §6.2). */
export const INMATE_LOOK: Look = { outfit: 0xf2701c, skin: 0xe2ad84, hair: 0x3a2a1e, silhouette: 0xffa64d };

const SKINS = [0xf1c6a0, 0xe2ad84, 0xc98d62, 0xa86e48, 0x7d4f33, 0x5b3a26];
const HAIRS = [0x1d1612, 0x3a2a1e, 0x6b4a2b, 0xb08850, 0x8a8a8a, 0x2a2018];

/** A guard's look: navy uniform and cap, varied by a number like inmates; its key's color on the belt. A riot guard (P12) in black, armored. */
export function guardLook(n: number, key?: number, riot = false): Look {
  const r = (k: number) => Math.abs(Math.sin(n * 7.31 + k * 41.7) * 24634.6345) % 1;
  return {
    outfit: riot ? 0x2a2f38 : 0x3a5a8c,
    trousers: riot ? 0x1a1d23 : 0x1f2c44,
    cap: 0x1b2638,
    riot,
    skin: SKINS[Math.floor(r(1) * SKINS.length)],
    hair: HAIRS[Math.floor(r(2) * HAIRS.length)],
    hairStyle: 1,
    size: 1.05 + r(4) * 0.06,
    key,
  };
}

/** A fellow inmate's look, varied by a number (the same number gives the same look). */
export function inmateLook(n: number): Look {
  const r = (k: number) => Math.abs(Math.sin(n * 12.9898 + k * 78.233) * 43758.5453) % 1;
  return {
    outfit: 0xf27a26,
    skin: SKINS[Math.floor(r(1) * SKINS.length)],
    hair: HAIRS[Math.floor(r(2) * HAIRS.length)],
    hairStyle: Math.floor(r(3) * 4),
    size: 0.94 + r(4) * 0.12,
  };
}

/** Where a sleeper lies: the middle of the bed and the way its pillow points (radians). */
export interface BedPose {
  x: number;
  z: number;
  angle: number;
}

/** The player's pixels mark the stencil, so the silhouette is drawn only where they're hidden. */
const STENCIL_MARK: Partial<THREE.MeshStandardMaterialParameters> = {
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.AlwaysStencilFunc,
  stencilZPass: THREE.ReplaceStencilOp,
};

/** How far a head turns either way glancing about with a rat on the shoulder (P20; ±0.55 otherwise): its side stays clear of the rat. */
const PERCHED_GLANCE = 0.2;

/** On the pay phone (P34): drawn this far to their right of where they stand (tiles). */
const PHONE_SHIFT = 0.27;
/** On the pay phone: the raised arm's turn (nearly straight up beside the head, the fist just over the ear). */
const PHONE_ARM = -2.75;

/** At the internet kiosk (P35): drawn this far back from where they stand (tiles), so the screen shows over their head and the hands come down on the keyboard. */
const KIOSK_BACK = 0.22;

/** Mattress height and how far the sleeper's feet sit from the bed's middle. */
const BED_TOP = 0.6;
const BED_FEET = 0.55;

/** "Z" for sleepers, drawn once and shared. */
let zTexture: THREE.CanvasTexture | null = null;
function sleepTexture(): THREE.CanvasTexture {
  if (zTexture) return zTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const draw = () => {
    g.clearRect(0, 0, 64, 64);
    g.font = '900 52px Fredoka, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(20, 30, 60, 0.85)';
    g.strokeText('Z', 32, 34);
    g.fillStyle = '#eaf2ff';
    g.fillText('Z', 32, 34);
  };
  draw();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  zTexture = tex;
  // Made before the web font arrives (the player is built at startup): drawn again once it has.
  document.fonts?.load('900 52px Fredoka').then(() => {
    draw();
    tex.needsUpdate = true;
  }, () => {});
  return tex;
}

/** A little five-pointed star (knocked out: they circle the head). */
let starTexture: THREE.CanvasTexture | null = null;
function koTexture(): THREE.CanvasTexture {
  if (starTexture) return starTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? 12 : 28;
    const a = (k * Math.PI) / 5 - Math.PI / 2;
    g.lineTo(32 + Math.cos(a) * r, 33 + Math.sin(a) * r);
  }
  g.closePath();
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(60, 40, 0, 0.8)';
  g.stroke();
  g.fillStyle = '#ffd84a';
  g.fill();
  starTexture = new THREE.CanvasTexture(c);
  starTexture.colorSpace = THREE.SRGBColorSpace;
  return starTexture;
}

/** "!" (red, spotted), "?" (orange, searching) and "$" (green, bribed: P15) over a guard's head, drawn once each. */
const markTextures = new Map<string, THREE.CanvasTexture>();
function markTexture(ch: string): THREE.CanvasTexture {
  let t = markTextures.get(ch);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = ch === '!' ? '#ff3b30' : ch === '$' ? '#0a845a' : '#ff9f1a';
  g.strokeStyle = 'rgba(30, 10, 0, 0.85)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(48, 46, 36, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.font = '900 60px Fredoka, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.fillText(ch, 48, 50);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  markTextures.set(ch, t);
  return t;
}

/**
 * Badges over inmates' heads (GDD §13.2: "!" and "$" over inmates): a favor on offer, one
 * done (hand it in), a merchant open for business, the letter the player carries for them,
 * a follower. Drawn shapes, not font glyphs, so they look the same everywhere.
 */
export type BadgeKind = '' | 'favor' | 'done' | 'shop' | 'mail' | 'ally';
const BADGE_COLORS: Record<Exclude<BadgeKind, ''>, string> = { favor: '#ffc23d', done: '#42c97a', shop: '#3fbf6f', mail: '#4aa3ff', ally: '#29b6c8' };
const badgeTextures = new Map<string, THREE.CanvasTexture>();
function badgeTexture(kind: Exclude<BadgeKind, ''>): THREE.CanvasTexture {
  let t = badgeTextures.get(kind);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d')!;
  // A rounded tag with a little point under it, like a speech bubble.
  g.fillStyle = BADGE_COLORS[kind];
  g.strokeStyle = 'rgba(10, 20, 30, 0.85)';
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect(14, 8, 68, 64, 18);
  g.moveTo(40, 72);
  g.lineTo(48, 86);
  g.lineTo(56, 72);
  g.fill();
  g.stroke();
  g.fillStyle = BADGE_COLORS[kind];
  g.fillRect(38, 62, 20, 10);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (kind === 'favor' || kind === 'shop') {
    g.font = '900 52px Fredoka, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(kind === 'favor' ? '!' : '$', 48, 42);
  } else if (kind === 'done') {
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(31, 41);
    g.lineTo(43, 53);
    g.lineTo(65, 29);
    g.stroke();
  } else if (kind === 'mail') {
    g.fillRect(26, 25, 44, 32);
    g.strokeStyle = BADGE_COLORS.mail;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(28, 27);
    g.lineTo(48, 43);
    g.lineTo(68, 27);
    g.stroke();
  } else {
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 11 : 24;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      g.lineTo(48 + Math.cos(a) * r, 42 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  badgeTextures.set(kind, t);
  return t;
}

const dropMaterial = new THREE.MeshBasicMaterial({ color: 0xc8ecff, transparent: true, opacity: 0.8, depthWrite: false });
const dropGeometry = new THREE.BoxGeometry(0.035, 0.24, 0.035);
/** The spray under a shower head: a faint cone of water. */
const sprayMaterial = new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
const sprayGeometry = new THREE.CylinderGeometry(0.09, 0.3, 1.55, 14, 1, true).translate(0, 0.8, -0.05);
const DROPS = 10;

/** A box w×h×d centered on (x, y, z), painted. */
const part = (w: number, h: number, d: number, color: number, x: number, y: number, z: number): Part => box(w, h, d, color, x, y - h / 2, z);

/** Talent night's instruments (P30), built once and shared: two upturned buckets, a drumstick, a guitar (in the body's terms); and the pay phone's handset (P34, in the left hand's). */
let made: { buckets: THREE.BufferGeometry; stick: THREE.BufferGeometry; guitar: THREE.BufferGeometry; handset: THREE.BufferGeometry } | null = null;
function instruments() {
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
const HANDSET_EAR = new THREE.Vector3(0.09, -0.37, 0.07);
const HANDSET_MOUTH = new THREE.Vector3(0.09, -0.17, -0.2);
function handsetGeometry(): THREE.BufferGeometry {
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
const mix = (a: number, b: number, k: number) => new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();

/** Facial hair (P16), in the head's frame: the face's front at z 0.22, the mouth at y 0.1. */
function beardParts(kind: number, hair: number, skin: number): Part[] {
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
function glassesParts(kind: number, color: number): Part[] {
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
function hatParts(kind: number, color: number): Part[] {
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
function tattooParts(kind: number, color: number, skin = 0xe8c8a8, z = 0.072): Part[] {
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
function inkedParts(inked: ReadonlyArray<readonly [number, number]>, left: boolean, skin: number): Part[] {
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
const bodyMaterial = kitMaterial.clone();
/** Their shadow-pass material, likewise kept apart from the unskinned meshes'. */
const bodyDepth = new THREE.MeshDepthMaterial();
/** Generous bounds round a character (standing, lying in bed, prone in a vent), in its own frame: the skinned body is culled by these. */
const BODY_BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 0.5, -0.2), 1.6);

/**
 * One skinned mesh from the limbs' parts (each given in its pivot's frame): every vertex
 * follows its own pivot (a bone), so the whole body is a single draw call however the limbs
 * move. Bound with the pivots as they stand now (rest), relative to `root`.
 */
function skinned(limbs: Array<[Part[], THREE.Bone]>, root: THREE.Object3D, material: THREE.Material): THREE.SkinnedMesh {
  // (The root unscaled at the origin: the bones' world matrices are their rest pose in its frame.)
  root.updateMatrixWorld(true);
  const bones: THREE.Bone[] = [];
  const geos = limbs.map(([parts, bone]) => {
    let b = bones.indexOf(bone);
    if (b < 0) b = bones.push(bone) - 1;
    const g = merge(parts, false).applyMatrix4(bone.matrixWorld);
    const n = g.attributes.position.count;
    const index = new Uint16Array(n * 4);
    const weight = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      index[i * 4] = b;
      weight[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
    return g;
  });
  const geo = mergeGeometries(geos);
  for (const g of geos) g.dispose();
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.castShadow = true;
  mesh.customDepthMaterial = bodyDepth;
  mesh.boundingSphere = BODY_BOUNDS.clone();
  mesh.bind(new THREE.Skeleton(bones), new THREE.Matrix4());
  return mesh;
}

/** The silhouette's copy of a skinned body: the same geometry and bones, the flat tint. */
function ghostSkin(body: THREE.SkinnedMesh, material: THREE.Material): THREE.SkinnedMesh {
  const copy = new THREE.SkinnedMesh(body.geometry, material);
  copy.boundingSphere = BODY_BOUNDS.clone();
  copy.bind(body.skeleton, new THREE.Matrix4());
  return copy;
}

/**
 * A blocky character, a 3D take on the Escapists sprites: a big head with blinking eyes,
 * a jumpsuit with a number patch and rolled sleeves, arms and legs on pivots. Faces +z at
 * rotation 0; about 1.25 tiles tall. The limbs are bones of one skinned, vertex-colored mesh
 * (one draw call a character, and one in the shadow pass). When given a silhouette color, it
 * shows through walls and furniture as a flat tint wherever something hides it
 * (stencil-masked, so it never tints itself).
 * Poses: walking, standing (with glances), and what inmates do at their spots: lining up,
 * eating, exercising, showering and sleeping in bed.
 */
export class Character {
  readonly root = new THREE.Group();
  // The pivots are bones of one skinned mesh (the whole body is one draw call, and one in the shadow pass).
  private readonly body = new THREE.Bone();
  private readonly head = new THREE.Bone();
  private readonly eyes = new THREE.Bone();
  private readonly armL = new THREE.Bone();
  private readonly armR = new THREE.Bone();
  private readonly legL = new THREE.Bone();
  private readonly legR = new THREE.Bone();
  private readonly skeleton: THREE.Skeleton;
  private readonly material: THREE.Material;
  private phase = 0;
  private swing = 0;
  private blinkAt = 2;
  private idle = 0;
  private glance = 0;
  private glanceGoal = 0;
  /** 0 standing … 1 lying in bed; and how far into the current activity. */
  private lie = 0;
  /** Lying down, or still getting up (0 standing … 1 flat). */
  get lying(): number {
    return this.lie;
  }

  /**
   * A pet rat on the left shoulder (P20), set by the view before the pose: that arm holds still
   * under it while walking, and glances stay small, so neither arm nor head goes through it.
   */
  perched = false;

  /**
   * On top of the left shoulder, in the world (P20: where the pet rat perches): on the body, so
   * nothing but the body moves it; the side away from the arm that strikes (armR), out past the
   * head's side at its widest perched glance and a full beard, just over the still arm.
   */
  shoulder(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld();
    return this.body.localToWorld(out.set(-0.36, 0.785, 0));
  }

  /** Hands busy (an activity, a strike, a punch, arms folded dozing): a perched rat ducks out of sight meanwhile (P20). */
  get armsBusy(): boolean {
    return (this.actKind !== DOING.NOTHING && this.act > 0.02) || this.hit > 0 || this.jab > 0 || this.doze > 0.02;
  }

  /** Prone in a vent (0 standing … 1 flat): a rat on the shoulder waits until they're up. */
  get crawling(): number {
    return this.crawl;
  }
  /** Prone in a vent (0–1), and a tool strike's swing (1 at the blow, easing to 0). */
  private crawl = 0;
  /** Dozing on its feet (P15), eased in slowly and out with a start; `startle` is the jolt on waking. */
  private doze = 0;
  private startle = 0;
  /** A dozing guard stirring (0–1: the player at its elbow, about to wake it), from the frame. */
  stir = 0;
  /**
   * An arm-wrestle (P22), from the frame: how it's going for this one (−1 losing badly … 1
   * winning), and whether the other one is surging (a straining shudder). Set before the pose.
   */
  strain = 0;
  shudder = false;
  /** Dice in a cupped hand, not thrown yet (P22): it shakes them. */
  diceShake = false;
  /** The strain as drawn (eased: the arms never jump). */
  private strainNow = 0;
  private hit = 0;
  /** A punch (1 at the blow, easing to 0) and a flinch from a blow taken (the same). */
  private jab = 0;
  private recoil = 0;
  /** The key on a guard's belt (a bone: scaled to nothing once taken). */
  private readonly keyTag: THREE.Bone | null = null;
  /** The floor's height under the character (vents and roofs stand above the ground floor). */
  baseY = 0;
  private act = 0;
  private actKind: number = DOING.NOTHING;
  /** On a change of activity (P23 review): the limbs as they were (legs, left arm x/z, right arm x/z), blended away over a fifth of a second. */
  private readonly from = [0, 0, 0, 0, 0, 0, 0, 0];
  private blend = 1;
  /** Last frame's height and lean from the activity (the blend's starting point for them). */
  private lastBob = 0;
  private lastLean = 0;
  private readonly offset = Math.random() * 10;
  /** Walking pace against the player's: legs swing faster for faster walkers (guards running). */
  gait: number;
  /** Props that come and go with what the character does. */
  private readonly blanket: THREE.Mesh;
  private readonly tray: THREE.Mesh;
  /** P30: talent night's instruments: two upturned buckets and the sticks in the hands, or a guitar slung in front. */
  private readonly buckets: THREE.Mesh;
  private readonly sticks: THREE.Mesh[] = [];
  private readonly guitar: THREE.Mesh;
  /** On the pay phone (P34): the handset at the ear, in the left hand. */
  private readonly handset: THREE.Mesh;
  private readonly water = new THREE.Group();
  private readonly zs: THREE.Sprite[] = [];
  private readonly stars: THREE.Sprite[] = [];
  /** The "!" or "?" over the head, its character, and how long it has shown. */
  private readonly markSprite: THREE.Sprite;
  private markShown = '';
  private markAge = 0;
  /** The badge over the head (favor, shop, mail, follower), and how long it has shown. */
  private readonly badgeSprite: THREE.Sprite;
  private badgeShown: BadgeKind = '';
  private badgeAge = 0;
  /** A training rep: the arms pump (1, easing to 0). */
  private pumped = 0;
  /** The silhouette material (the player only). */
  private ghost: THREE.MeshBasicMaterial | null = null;
  /** Standing under a shower head (water falls only there). */
  wet = false;
  /** The item in the right hand (its model), and which item it is. */
  private held: THREE.Mesh | null = null;
  private heldItem = 0;
  private readonly at = new THREE.Vector3();
  private readonly bedAt = new THREE.Vector3();

  constructor(look: Look) {
    this.material =
      look.silhouette !== undefined ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, ...STENCIL_MARK }) : bodyMaterial;
    const outfit = look.outfit;
    const outfitDark = new THREE.Color(outfit).multiplyScalar(0.78).getHex();
    const trousers = look.trousers ?? outfit;
    const guard = look.cap !== undefined;
    const trim = guard ? undefined : look.trim;
    const gold = 0xe8b828;
    const { skin, hair } = look;
    const white = 0xf2f2ee;
    const dark = 0x1b1b22;
    const shoe = 0x2a2a30;
    // Each limb's parts, in its pivot's frame: skinned to that pivot (bone) below.
    const limbs: Array<[Part[], THREE.Bone]> = [];
    const mesh = (parts: Part[], bone: THREE.Bone) => void limbs.push([parts, bone]);

    // Legs: pivots at the hips.
    for (const [pivot, x] of [
      [this.legL, -0.11],
      [this.legR, 0.11],
    ] as const) {
      pivot.position.set(x, 0.4, 0);
      mesh([part(0.19, 0.34, 0.2, trousers, 0, -0.17, 0), part(0.21, 0.08, 0.27, shoe, 0, -0.36, 0.03), ...(trim !== undefined ? [part(0.196, 0.035, 0.206, trim, 0, -0.29, 0)] : [])], pivot);
    }

    // Torso: the jumpsuit, a white collar, the number patch (a guard: a belt, a tie, a badge).
    mesh(
      guard
        ? [
            part(0.52, 0.42, 0.3, outfit, 0, 0.6, 0),
            part(0.53, 0.07, 0.31, dark, 0, 0.43, 0),
            part(0.08, 0.05, 0.02, gold, 0, 0.43, 0.157),
            part(0.06, 0.2, 0.02, trousers, 0, 0.7, 0.152),
            part(0.22, 0.05, 0.02, 0xdfe7f2, 0, 0.79, 0.152),
            part(0.08, 0.09, 0.025, gold, -0.13, 0.67, 0.153),
            part(0.05, 0.25, 0.05, dark, 0.27, 0.32, 0.06),
          ]
        : [
            part(0.52, 0.42, 0.3, outfit, 0, 0.6, 0),
            part(0.53, 0.06, 0.31, trim ?? outfitDark, 0, 0.42, 0),
            part(0.2, 0.06, 0.02, white, 0, 0.79, 0.152),
            part(0.13, 0.08, 0.02, white, 0.12, 0.66, 0.152),
            part(0.08, 0.015, 0.025, dark, 0.12, 0.665, 0.153),
            // A trim (P16): a stripe down each side.
            ...(trim !== undefined ? [part(0.012, 0.34, 0.2, trim, -0.262, 0.62, 0), part(0.012, 0.34, 0.2, trim, 0.262, 0.62, 0)] : []),
          ],
      this.body,
    );

    // A riot guard's plates: a chest plate, a back plate, shoulder guards.
    if (look.riot) {
      const plate = 0x3b4250;
      mesh(
        [
          part(0.56, 0.32, 0.06, plate, 0, 0.62, 0.16),
          part(0.56, 0.32, 0.06, plate, 0, 0.62, -0.16),
          part(0.18, 0.08, 0.34, plate, -0.3, 0.8, 0),
          part(0.18, 0.08, 0.34, plate, 0.3, 0.8, 0),
          part(0.3, 0.05, 0.02, 0xe8b828, 0, 0.7, 0.195),
        ],
        this.body,
      );
    }

    // Arms: pivots at the shoulders; sleeves rolled up to the elbow.
    for (const [pivot, x] of [
      [this.armL, -0.34],
      [this.armR, 0.34],
    ] as const) {
      pivot.position.set(x, 0.78, 0);
      mesh(
        [
          part(0.15, 0.2, 0.16, outfit, 0, -0.1, 0),
          part(0.13, 0.15, 0.14, skin, 0, -0.27, 0),
          part(0.14, 0.09, 0.15, skin, 0, -0.38, 0),
          ...(trim !== undefined ? [part(0.156, 0.034, 0.166, trim, 0, -0.187, 0)] : []),
          ...(x > 0 && look.tattoo ? tattooParts(look.tattoo, look.tattooColor ?? 0x2f4f6f, skin) : []),
          // (P29: those inked inside: the left forearm's front and outer side, the right's outer side.)
          ...inkedParts(look.inked ?? [], x < 0, skin),
        ],
        pivot,
      );
    }

    // Head: a big block with brows, a nose, a mouth and a haircut; the eyes blink on their own.
    this.head.position.y = 0.8;
    const face: Part[] = [part(0.46, 0.44, 0.44, skin, 0, 0.22, 0), part(0.06, 0.07, 0.04, skin, 0, 0.18, 0.235), part(0.11, 0.025, 0.02, 0x8a4b3a, 0, 0.1, 0.222)];
    for (const s of [-1, 1]) face.push(part(0.11, 0.035, 0.02, hair, s * 0.1, 0.32, 0.222));
    // Under a hat, hair that would stand up through it lies flat (P16).
    const hatted = !!look.hat && look.cap === undefined && !look.riot;
    const style0 = look.hairStyle ?? 0;
    // (Under a guard's cap too: a disguise's crown stays a cap.)
    const covered = hatted || look.cap !== undefined || !!look.riot;
    // Under a hat (or the cap): a tall top lies flat, a mohawk is shaved down to a buzz cut, curls keep their sides and back.
    const style = covered && style0 === 3 ? 0 : covered && style0 === 4 ? 1 : style0;
    if (style === 0 || style === 3 || style === 6) {
      const top = style === 3 ? 0.22 : 0.1;
      face.push(
        part(0.48, top, 0.47, hair, 0, 0.42 + top / 2, -0.005),
        part(0.48, 0.26, 0.08, hair, 0, 0.33, -0.21),
        part(0.05, 0.14, 0.4, hair, -0.23, 0.36, -0.02),
        part(0.05, 0.14, 0.4, hair, 0.23, 0.36, -0.02),
      );
      // A ponytail with a band (P16).
      if (style === 6) face.push(part(0.1, 0.24, 0.1, hair, 0, 0.3, -0.29), part(0.11, 0.04, 0.11, 0xff9a3c, 0, 0.42, -0.29));
    } else if (style === 1) {
      face.push(part(0.47, 0.03, 0.45, hair, 0, 0.45, 0), part(0.47, 0.2, 0.03, hair, 0, 0.36, -0.215));
    } else if (style === 4) {
      // A mohawk: shaved sides, a crest front to back.
      face.push(part(0.47, 0.03, 0.45, hair, 0, 0.45, 0), part(0.47, 0.2, 0.03, hair, 0, 0.36, -0.215), part(0.1, 0.2, 0.46, hair, 0, 0.55, -0.01));
    } else if (style === 5) {
      // Curls: a round mop over the top (a short top under a hat), down the sides and the back.
      face.push(covered ? part(0.48, 0.1, 0.47, hair, 0, 0.47, -0.005) : part(0.56, 0.2, 0.54, hair, 0, 0.5, -0.02), part(0.08, 0.2, 0.42, hair, -0.27, 0.36, -0.04), part(0.08, 0.2, 0.42, hair, 0.27, 0.36, -0.04), part(0.54, 0.3, 0.1, hair, 0, 0.32, -0.25));
    }
    if (look.beard) face.push(...beardParts(look.beard, hair, skin));
    if (look.glasses) face.push(...glassesParts(look.glasses, look.glassesColor ?? 0x2a2a30));
    // A hat sits on what's under it: the short cut's top (0.52), a buzz cut's (0.465), a bald head's (0.44),
    // a hair's breadth above (no shared faces); a headband stays round the brow whatever the hair.
    if (hatted) {
      const dy = look.hat === 3 ? 0 : (style === 2 ? 0.45 : style === 1 ? 0.475 : 0.52) - 0.52;
      face.push(...hatParts(look.hat!, look.hatColor ?? 0x8c3b2a).map((g) => g.translate(0, dy, 0)));
    }
    if (look.riot) {
      // A riot helmet: the shell over the head, its visor down over the eyes, a chin guard.
      face.push(
        part(0.54, 0.24, 0.52, 0x1d2129, 0, 0.5, -0.01),
        part(0.5, 0.2, 0.03, 0x6f8aa0, 0, 0.28, 0.25),
        part(0.4, 0.06, 0.08, 0x1d2129, 0, 0.06, 0.2),
        part(0.08, 0.05, 0.02, 0xe8b828, 0, 0.56, 0.26),
      );
    } else if (look.cap !== undefined) {
      // A peaked cap: the crown, a band, the peak over the eyes, a gold badge.
      face.push(
        part(0.5, 0.16, 0.48, look.cap, 0, 0.55, -0.01),
        part(0.51, 0.05, 0.49, 0x10161f, 0, 0.47, -0.01),
        part(0.44, 0.03, 0.16, 0x10161f, 0, 0.455, 0.29),
        part(0.08, 0.07, 0.02, gold, 0, 0.52, 0.235),
      );
    }
    mesh(face, this.head);
    this.eyes.position.set(0, 0.24, 0.222);
    mesh([part(0.065, 0.09, 0.02, dark, -0.1, 0, 0), part(0.065, 0.09, 0.02, dark, 0.1, 0, 0)], this.eyes);
    this.head.add(this.eyes);

    // A guard's key: a ring and a key in its color, hanging from the belt.
    if (look.key !== undefined) {
      this.keyTag = new THREE.Bone();
      mesh([part(0.09, 0.09, 0.03, look.key, 0, 0.36, 0), part(0.035, 0.12, 0.025, look.key, 0, 0.26, 0), part(0.05, 0.03, 0.025, look.key, 0.03, 0.22, 0)], this.keyTag);
      this.keyTag.position.set(-0.2, 0.02, 0.16);
      this.body.add(this.keyTag);
    }
    this.body.add(this.legL, this.legR, this.armL, this.armR, this.head);
    this.root.add(this.body);
    const whole = skinned(limbs, this.root, this.material);
    this.skeleton = whole.skeleton;
    this.root.add(whole);
    this.root.scale.setScalar(look.size ?? 1);
    this.gait = look.gait ?? 1;
    // The silhouette covers the body only, not the props below.
    if (look.silhouette !== undefined) this.addSilhouette(look.silhouette);

    // In bed: a blanket pulled up to the chest, and Zs floating up.
    this.blanket = new THREE.Mesh(
      merge([part(0.64, 0.08, 0.92, 0x6f8fb5, 0, 0.19, -0.42), part(0.66, 0.09, 0.14, 0xe6ebf2, 0, 0.2, -0.9)], false),
      kitMaterial,
    );
    this.blanket.castShadow = true;
    this.blanket.visible = false;
    this.root.add(this.blanket);
    for (let k = 0; k < 3; k++) {
      const z = new THREE.Sprite(new THREE.SpriteMaterial({ map: sleepTexture(), transparent: true, depthWrite: false, opacity: 0 }));
      z.visible = false;
      z.renderOrder = 5;
      this.zs.push(z);
      this.root.add(z);
    }
    // Knocked out: stars circling the head.
    for (let k = 0; k < 4; k++) {
      const st = new THREE.Sprite(new THREE.SpriteMaterial({ map: koTexture(), transparent: true, depthWrite: false }));
      st.visible = false;
      st.renderOrder = 5;
      st.scale.setScalar(0.22);
      this.stars.push(st);
      this.root.add(st);
    }
    this.markSprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
    this.markSprite.visible = false;
    this.markSprite.renderOrder = 30;
    this.markSprite.position.y = 1.85;
    this.root.add(this.markSprite);
    this.badgeSprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false }));
    this.badgeSprite.visible = false;
    this.badgeSprite.renderOrder = 29;
    this.root.add(this.badgeSprite);
    // At a meal: a tray on the table in front.
    this.tray = new THREE.Mesh(
      merge([
        part(0.38, 0.03, 0.28, 0x9aa3ad, 0, 0.545, 0.74),
        part(0.12, 0.05, 0.1, 0xe8d9a8, -0.08, 0.57, 0.72),
        part(0.1, 0.04, 0.1, 0x8a5a3a, 0.09, 0.565, 0.76),
        part(0.1, 0.03, 0.08, 0x6aa84f, 0.05, 0.565, 0.66),
      ], false),
      kitMaterial,
    );
    this.tray.visible = false;
    this.root.add(this.tray);
    // On the stage (P30): bucket drums before the knees, sticks in the fists; a guitar across the front.
    this.buckets = new THREE.Mesh(instruments().buckets, kitMaterial);
    this.buckets.visible = false;
    this.root.add(this.buckets);
    for (const arm of [this.armL, this.armR]) {
      const st = new THREE.Mesh(instruments().stick, kitMaterial);
      st.position.set(0, -0.42, 0.04);
      // (Tipped down in the fist, onto the bucket's head.)
      st.rotation.x = 0.9;
      st.visible = false;
      this.sticks.push(st);
      arm.add(st);
    }
    this.guitar = new THREE.Mesh(instruments().guitar, kitMaterial);
    this.guitar.visible = false;
    this.body.add(this.guitar);
    this.handset = new THREE.Mesh(instruments().handset, kitMaterial);
    this.handset.visible = false;
    this.armL.add(this.handset);
    // Under a shower head: falling water.
    for (let k = 0; k < DROPS; k++) {
      const d = new THREE.Mesh(dropGeometry, dropMaterial);
      d.userData.phase = Math.random();
      d.position.set((Math.random() - 0.5) * 0.4, 0, -0.05 + (Math.random() - 0.5) * 0.35);
      this.water.add(d);
    }
    const spray = new THREE.Mesh(sprayGeometry, sprayMaterial);
    spray.userData.spray = true;
    this.water.add(spray);
    this.water.visible = false;
    this.root.add(this.water);
  }

  /**
   * Puts an item in the right hand (0: empty-handed): the model sticks out of the fist,
   * pointing forward.
   */
  hold(item: number, geometry: THREE.BufferGeometry | null) {
    if (item === this.heldItem) return;
    this.heldItem = item;
    if (this.held) this.armR.remove(this.held);
    this.held = null;
    if (!item || !geometry) return;
    const m = new THREE.Mesh(geometry, kitMaterial);
    m.castShadow = true;
    m.scale.setScalar(1.05);
    // Long axis forward (+z), gripped near its back end.
    m.rotation.set(0, -Math.PI / 2, 0);
    m.position.set(0, -0.44, 0.16);
    this.held = m;
    this.armR.add(m);
  }

  /**
   * Shows "!" or "?" over the head ('' hides it): it pops in, bobs, and shrinks away after
   * a couple of seconds (the alert is in the cone's color from then on). A "$" (bribed, P15)
   * settles small and stays, out of the way of a doze's Z's.
   */
  mark(ch: string, dt: number, motion: boolean) {
    if (ch !== this.markShown) {
      this.markShown = ch;
      this.markAge = 0;
      if (ch) this.markSprite.material.map = markTexture(ch);
      this.markSprite.material.needsUpdate = true;
    }
    this.markAge += dt;
    const keep = ch === '$';
    const show = !!ch && (this.markAge < 2.2 || keep) && !(keep && this.doze > 0.3);
    this.markSprite.visible = show;
    if (!show) return;
    const t = this.markAge;
    if (keep && t > 1.9) {
      const e = Math.min(1, (t - 1.9) / 0.4);
      const s = e * e * (3 - 2 * e);
      this.markSprite.scale.setScalar(0.62 - 0.32 * s);
      this.markSprite.material.opacity = 1 - 0.15 * s;
      this.markSprite.position.y = 1.85 - 0.1 * s;
      return;
    }
    const pop = motion ? Math.min(1, t * 7) * (1 + Math.max(0, 0.35 - t) * 1.6) : 1;
    const out = t > 1.9 ? 1 - (t - 1.9) / 0.3 : 1;
    this.markSprite.scale.setScalar(0.62 * pop * out);
    this.markSprite.material.opacity = 1;
    this.markSprite.position.y = 1.85 + (motion ? Math.sin(t * 9) * 0.04 : 0);
  }

  /** The mark showing now ('' none). */
  get markChar(): string {
    return this.markShown;
  }

  /**
   * The badge over the head ('' hides it): it pops in and bobs gently; a "!" mark (alert)
   * takes its place while one shows.
   */
  badge(kind: BadgeKind, dt: number, motion: boolean) {
    if (kind !== this.badgeShown) {
      this.badgeShown = kind;
      this.badgeAge = 0;
      if (kind) this.badgeSprite.material.map = badgeTexture(kind);
      this.badgeSprite.material.needsUpdate = true;
    }
    this.badgeAge += dt;
    const show = !!kind && !this.markSprite.visible && this.lie < 0.5;
    this.badgeSprite.visible = show;
    if (!show) return;
    const t = this.badgeAge;
    const pop = motion ? Math.min(1, t * 6) * (1 + Math.max(0, 0.3 - t) * 1.4) : 1;
    this.badgeSprite.scale.setScalar(0.5 * pop);
    this.badgeSprite.position.y = 1.9 + (motion ? Math.sin(t * 3 + this.offset) * 0.05 : 0);
  }

  /** A training rep: the arms pump once. */
  pump() {
    this.pumped = 1;
  }

  /** A flat copy of every part, drawn only where something stands in front of the character. */
  private addSilhouette(color: number) {
    const ghost = (this.ghost = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      depthFunc: THREE.GreaterDepth,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
    }));
    const meshes: THREE.Mesh[] = [];
    this.root.traverse((o) => o instanceof THREE.Mesh && meshes.push(o));
    for (const m of meshes) {
      const copy = m instanceof THREE.SkinnedMesh ? ghostSkin(m, ghost) : new THREE.Mesh(m.geometry, ghost);
      copy.renderOrder = 20;
      m.add(copy);
    }
  }

  /** A tool strike: one hard swing of the arm (the next frames play it). */
  strike() {
    this.hit = 1;
  }

  /** A blow at someone: the arm thrown forward (a weapon in hand swings it). */
  punch() {
    this.jab = 1;
  }

  /** Hit: a jolt back. */
  flinch() {
    this.recoil = 1;
  }

  /** Shows or hides the key on a guard's belt. */
  showKey(on: boolean) {
    this.keyTag?.scale.setScalar(on ? 1 : 0);
  }

  /**
   * Places and animates the character. `facing` in radians (0 = +z); `moving` swings the
   * limbs; `doing` (DOING) poses it at a routine spot, `bed` is where it lies to sleep.
   * Returns true on the frame a foot lands (for footstep sounds and dust).
   */
  pose(x: number, z: number, facing: number, moving: boolean, dt: number, time: number, motion = true, doing: number = DOING.NOTHING, bed?: BedPose): boolean {
    const k = (rate: number) => Math.min(1, dt * rate);
    // Into bed and out of it: a short ease between standing beside it and lying in it.
    // Knocked out: down on the floor where they stand, quicker.
    const ko = doing === DOING.KNOCKED_OUT;
    this.lie += (((doing === DOING.SLEEP && bed) || ko ? 1 : 0) - this.lie) * k(ko ? 9 : 5);
    if (this.lie < 0.002) this.lie = 0;
    this.crawl += ((doing === DOING.CRAWL ? 1 : 0) - this.crawl) * k(8);
    if (this.crawl < 0.002) this.crawl = 0;
    const dozing = doing === DOING.DOZE && !moving;
    const wasDozing = this.doze;
    this.doze += ((dozing ? 1 : 0) - this.doze) * k(dozing ? 1.6 : 12);
    if (this.doze < 0.002) this.doze = 0;
    // Woken: a little hop, the head jerking up (felt once, as the doze falls through half).
    if (!dozing && wasDozing >= 0.5 && this.doze < 0.5 && motion && !ko) this.startle = 1;
    this.startle = Math.max(0, this.startle - dt * 4);
    this.hit = Math.max(0, this.hit - dt * 3.2);
    this.jab = Math.max(0, this.jab - dt * 4.5);
    this.recoil = Math.max(0, this.recoil - dt * 4);
    this.pumped = Math.max(0, this.pumped - dt * 3);
    this.at.set(x, this.baseY, z);
    let turn = facing;
    // A lookout on watch (P23): his whole body sweeps slowly from side to side (the head held still: a raised arm beside it).
    if (doing === DOING.LOOKOUT && !moving && !ko) turn += (motion ? Math.sin((time + this.offset) * 0.8) * 0.5 : 0) * this.act;
    if (ko) {
      // Lies along its heading, feet where it stood.
      this.bedAt.set(x - Math.sin(facing) * 0.15, this.baseY + 0.17, z - Math.cos(facing) * 0.15);
      this.at.lerp(this.bedAt, this.lie);
    } else if (bed && this.lie > 0) {
      turn = bed.angle;
      this.bedAt.set(bed.x + Math.sin(bed.angle) * BED_FEET, BED_TOP, bed.z + Math.cos(bed.angle) * BED_FEET);
      this.at.lerp(this.bedAt, this.lie);
    }
    this.root.position.copy(this.at);
    // Turn the short way round, quickly.
    let d = turn - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * k(14);
    this.swing += ((moving ? 1 : 0) - this.swing) * k(10);
    let stepped = false;
    // (Jogging, P31: running while it goes, quicker strides, a longer swing, more bounce.)
    const running = moving && doing === DOING.RUN ? 1 : 0;
    if (moving) {
      const before = Math.floor(this.phase / Math.PI);
      this.phase += dt * 11 * this.gait * (1 + 0.45 * running);
      stepped = Math.floor(this.phase / Math.PI) !== before;
    }
    const s = Math.sin(this.phase) * (0.75 + 0.3 * running) * this.swing;
    let legL = s;
    let legR = -s;
    // (A rat perched on the left shoulder, P20: that arm holds still while walking.)
    let armLx = this.perched ? 0 : -s * (0.85 + 0.25 * running);
    let armRx = s * (0.85 + 0.25 * running);
    let armLz = 0;
    let armRz = 0;
    let legZ = 0;
    let bob = Math.abs(Math.cos(this.phase)) * (0.045 + 0.04 * running) * this.swing + (motion ? Math.sin(time * 2.2 + this.offset) * 0.006 * (1 - this.swing) : 0);

    // Activities fade in once the character has stopped at its spot.
    if (doing !== this.actKind) {
      this.actKind = doing;
      this.act = 0;
      // (Not snapped: the limbs ease from where they were. Reduced motion keeps the snap.)
      const f = this.from;
      f[0] = this.legL.rotation.x;
      f[1] = this.legR.rotation.x;
      f[2] = this.armL.rotation.x;
      f[3] = this.armL.rotation.z;
      f[4] = this.armR.rotation.x;
      f[5] = this.armR.rotation.z;
      f[6] = this.lastBob;
      f[7] = this.lastLean;
      this.blend = motion ? 0 : 1;
    }
    this.act = moving ? 0 : Math.min(1, this.act + dt * 3);
    // On the pay phone (P34): drawn a little to the right (away from the raised hand's side), so the
    // empty hook and the stretched cord show beside them, the hand clear of the hood's side.
    if (doing === DOING.PHONE && !ko) {
      const r = this.root.rotation.y;
      const o = PHONE_SHIFT * this.act;
      this.root.position.x += Math.cos(r) * o;
      this.root.position.z -= Math.sin(r) * o;
    }
    // At the kiosk (P35): drawn a step back from the wall, the screen in sight over the head.
    if (doing === DOING.KIOSK && !ko) {
      const r = this.root.rotation.y;
      const o = KIOSK_BACK * this.act;
      this.root.position.x -= Math.sin(r) * o;
      this.root.position.z -= Math.cos(r) * o;
    }
    const a = this.act * (motion ? 1 : 0);
    const t = time + this.offset;
    // Seated (a canteen bench, a chair, a yard bench): legs forward, a little lower.
    const sit = doing === DOING.EAT || doing === DOING.SIT || doing === DOING.SIT_READ ? this.act : 0;
    legL -= sit * 1.45;
    legR -= sit * 1.45;
    bob -= sit * 0.06;
    if (doing === DOING.EAT) {
      // Spoon to mouth, now and then.
      const lift = Math.max(0, Math.sin(t * 2.6)) ** 2;
      armRx += (-0.6 - lift * 1.3) * a;
      armLx += -0.5 * a;
    } else if (doing === DOING.EXERCISE) {
      // Jumping jacks.
      const j = (Math.sin(t * 6) + 1) / 2;
      armLz -= j * 2.5 * a;
      armRz += j * 2.5 * a;
      legZ = j * 0.28 * a;
      bob += Math.abs(Math.sin(t * 6)) * 0.08 * a;
    } else if (doing === DOING.SEARCH) {
      // Rummaging through a desk: bent over, hands digging in turn.
      armLx += (-1.3 + Math.sin(t * 7) * 0.35) * a;
      armRx += (-1.3 + Math.cos(t * 7) * 0.35) * a;
      bob -= 0.03 * a;
    } else if (doing === DOING.DIG) {
      // Digging under the bed (P40, the odd jobs' lookout): crouched low, both hands scraping at the
      // floor in turn, a stroke down and back. (Held still with reduced motion: a crouch over the hole.)
      const s = motion ? Math.sin(t * 5.5) : 0;
      armLx += (-1.55 + s * 0.4) * a;
      armRx += (-1.55 - s * 0.4) * a;
      armLz -= 0.12 * a;
      armRz += 0.12 * a;
      legL += 0.5 * a;
      legR += 0.5 * a;
      bob -= (0.16 + (motion ? Math.abs(s) * 0.02 : 0)) * a;
    } else if (ko) {
      // Out cold: arms flung out.
      armLz -= 1.1 * this.lie;
      armRz += 1.1 * this.lie;
      legZ = 0.25 * this.lie;
    } else if (doing === DOING.CRAWL) {
      // Elbows forward in turn, knees after them.
      const c = Math.sin(this.phase * 0.7) * 0.45 * this.swing;
      armLx = -2.5 + c;
      armRx = -2.5 - c;
      armLz = -0.25;
      armRz = 0.25;
      legL = 0.15 - c * 0.6;
      legR = 0.15 + c * 0.6;
      bob = 0;
    } else if (doing === DOING.WORK) {
      // At work: hands busy at waist height, a little bent.
      armLx += (-0.9 + Math.sin(t * 5) * 0.3) * a;
      armRx += (-0.9 + Math.cos(t * 5) * 0.3) * a;
      bob -= 0.015 * a;
    } else if (doing === DOING.LIFT) {
      // Pressing a weight overhead: up on each rep, slowly down between.
      const up = this.pumped;
      armLx += (-2.2 - up * 0.7) * a;
      armRx += (-2.2 - up * 0.7) * a;
      armLz -= (0.5 - up * 0.3) * a;
      armRz += (0.5 - up * 0.3) * a;
      bob -= (1 - up) * 0.03 * a;
    } else if (doing === DOING.RUN) {
      // Running in place on the belt: quicker with each rep.
      const r = Math.sin(t * (9 + this.pumped * 5)) * 0.8 * a;
      legL += r;
      legR -= r;
      armLx -= r * 0.9;
      armRx += r * 0.9;
      bob += Math.abs(Math.cos(t * (9 + this.pumped * 5))) * 0.05 * a;
    } else if (doing === DOING.SIT) {
      // Sitting back: hands on the knees.
      armLx += -0.75 * a;
      armRx += -0.75 * a;
    } else if (doing === DOING.READ || doing === DOING.SIT_READ) {
      // A book held up in both hands; a page turns on each rep.
      armLx += -1.25 * a;
      armRx += (-1.25 - this.pumped * 0.25) * a;
      armLz -= 0.25 * a;
      armRz += 0.25 * a;
    } else if (doing === DOING.SHOWER) {
      // Scrubbing the hair.
      armLx += (-2.7 + Math.sin(t * 9) * 0.15) * a;
      armRx += (-2.7 + Math.cos(t * 9) * 0.15) * a;
      armLz -= 0.35 * a;
      armRz += 0.35 * a;
    } else if (doing === DOING.WRESTLE) {
      // An arm-wrestle (P22): right hands locked between the two at chest height, the left
      // braced on the hip; winning, the arm drives forward and the body leans into it; losing,
      // it's forced back and up, the body giving way. A shudder under the other's surge.
      // (These poses carry their meaning: with reduced motion they hold still rather than vanish.)
      const ga = this.act;
      this.strainNow += (this.strain - this.strainNow) * k(6);
      const g = this.strainNow;
      const shake = motion ? Math.sin(t * (this.shudder ? 47 : 31)) * (this.shudder ? 0.07 : 0.035) : 0;
      // (The strain is carried by the lean and the stance, View: the grip stays at one height for both.)
      armRx += (-1.42 - g * 0.08 + shake) * ga;
      armRz += (-0.32 + shake * 0.5) * ga;
      armLx += -0.35 * ga;
      armLz += 0.45 * ga;
      bob -= 0.03 * ga;
    } else if (doing === DOING.PICK) {
      // At a lock (P22): bent to it, both hands at the keyhole, the right one working the pick
      // (a twitch at each pin, `pumped`).
      const ga = this.act;
      armRx += (-1.05 - this.pumped * 0.25 + (motion ? Math.sin(t * 13) * 0.04 : 0)) * ga;
      armRz += -0.28 * ga;
      armLx += -0.95 * ga;
      armLz += 0.3 * ga;
      bob -= 0.06 * ga;
    } else if (doing === DOING.DICE) {
      // Dice (P22): crouched over them, the right hand cupped and shaking, flung out at a throw (`pumped`).
      const ga = this.act;
      const shake = motion && this.diceShake && this.pumped < 0.05 ? Math.sin(t * 24) * 0.12 : 0;
      armRx += (-0.85 - this.pumped * 0.7 + shake) * ga;
      armRz += -0.12 * ga;
      armLx += -0.55 * ga;
      legL -= 0.35 * ga;
      legR -= 0.35 * ga;
      bob -= 0.1 * ga;
    } else if (doing === DOING.CARDS) {
      // Cheat (P27): crouched over the pile, the hand of cards held up close in the left, the
      // right laying them down now and then.
      const ga = this.act;
      const lay = motion ? Math.max(0, Math.sin(t * 1.3)) ** 6 : 0;
      armLx += -1.15 * ga;
      armLz += 0.32 * ga;
      armRx += (-0.6 - lay * 0.5) * ga;
      armRz += -0.12 * ga;
      legL -= 0.35 * ga;
      legR -= 0.35 * ga;
      bob -= 0.1 * ga;
    } else if (doing === DOING.BOARD) {
      // Checkers (P27): crouched at the board, the left hand on the knee, the right hovering over the pieces.
      const ga = this.act;
      const hover = motion ? Math.sin(t * 0.9) * 0.08 : 0;
      armLx += -0.55 * ga;
      armLz += 0.12 * ga;
      armRx += (-0.75 + hover) * ga;
      armRz += -0.1 * ga;
      legL -= 0.4 * ga;
      legR -= 0.4 * ga;
      bob -= 0.11 * ga;
    } else if (doing === DOING.SHOOT) {
      // A shot at the hoop (P27): the ball up over the head in both hands, the knees bent.
      const ga = this.act;
      // (The hands in under the ball, either side of it: in toward the middle.)
      armLx += -2.75 * ga;
      armRx += -2.75 * ga;
      armLz += 0.35 * ga;
      armRz -= 0.35 * ga;
      legL -= 0.18 * ga;
      legR -= 0.18 * ga;
      bob -= 0.035 * ga;
    } else if (doing === DOING.TATTOO) {
      // At work on a tattoo (P29): the working hand low and forward, buzzing a little; the other steadying the arm.
      const ga = this.act;
      const buzz = motion ? Math.sin(t * 40) * 0.03 : 0;
      armRx += (-0.75 + buzz) * ga;
      armLx += -0.55 * ga;
      armRz -= 0.15 * ga;
      armLz += 0.15 * ga;
      bob -= 0.02 * ga;
    } else if (doing === DOING.DRUMS) {
      // Bucket drums (P30): both sticks down onto the buckets in turn, on the beat; the head nods along.
      const ga = this.act;
      const beat = motion ? Math.sin(t * 13) : 0;
      armRx += (-0.62 + beat * 0.3) * ga;
      armLx += (-0.62 - beat * 0.3) * ga;
      armRz -= 0.12 * ga;
      armLz += 0.12 * ga;
      legL -= 0.25 * ga;
      legR -= 0.25 * ga;
      bob += (motion ? Math.abs(Math.sin(t * 6.5)) * 0.02 : 0) * ga - 0.06 * ga;
    } else if (doing === DOING.GUITAR) {
      // A guitar (P30): the left hand up the neck, the right strumming across the body.
      const ga = this.act;
      const strum = motion ? Math.sin(t * 12) * 0.16 : 0;
      armLx += -1.1 * ga;
      armLz += 0.42 * ga;
      armRx += (-1.0 + strum * 0.6) * ga;
      armRz -= 0.42 * ga;
      bob += (motion ? Math.abs(Math.sin(t * 4)) * 0.015 : 0) * ga;
    } else if (doing === DOING.QUIZ) {
      // At the buzzer (P30): the right hand ready over it, the left at the side, a little forward.
      const ga = this.act;
      armRx += -1.0 * ga;
      armRz -= 0.35 * ga;
      armLx += -0.15 * ga;
    } else if (doing === DOING.FOOTBALL && !moving) {
      // A kick wound up (P29): the kicking leg back, the arms out for balance.
      const ga = this.act;
      legR += 0.75 * ga;
      legL -= 0.12 * ga;
      armLz += 0.45 * ga;
      armRz -= 0.45 * ga;
      bob -= 0.03 * ga;
    } else if (doing === DOING.PHONE) {
      // On the pay phone (P34): the left hand up at the ear with the handset (the head tipped to
      // it), the right hand talking a little at the side. Held still with reduced motion.
      const ga = this.act;
      const talk = motion ? Math.sin(t * 1.7) * 0.14 + Math.sin(t * 0.6) * 0.06 : 0;
      armLx += PHONE_ARM * ga;
      armLz += -0.1 * ga;
      armRx += (-0.42 + talk) * ga;
      armRz += -0.08 * ga;
    } else if (doing === DOING.KIOSK) {
      // At the internet kiosk (P35): both forearms forward over the keyboard on its shelf, a little in
      // toward the middle, the hands tapping in turn (a typing bob). Held still with reduced motion.
      const ga = this.act;
      const tap = motion ? Math.sin(t * 15) * 0.07 + Math.sin(t * 6.1) * 0.03 : 0;
      armLx += (-1.38 + tap) * ga;
      armRx += (-1.38 - tap) * ga;
      armLz += 0.22 * ga;
      armRz -= 0.22 * ga;
    } else if (doing === DOING.QUEUE) {
      // Waiting in line for the phone (P34): arms crossed, the weight shifting slowly from foot to foot (below).
      const ga = this.act;
      armLx += -0.95 * ga;
      armRx += -0.95 * ga;
      armLz += 0.55 * ga;
      armRz -= 0.55 * ga;
    } else if (doing === DOING.LOOKOUT) {
      // On watch (P23): a hand at the brow, clear of the head (a salute's reach: a rigid arm can't
      // get in front of the face), the other arm a little out; the whole body sweeps from side to
      // side (above), the head held still. Held still with reduced motion: it still says "on watch".
      const ga = this.act;
      armRx += -2.57 * ga;
      armRz += 0.15 * ga;
      armLx += -0.3 * ga;
      armLz += -0.15 * ga;
    } else if (doing === DOING.BRAWL) {
      // A brawl (P23): fists up, bobbing on the toes, a jab now and then from each hand in turn.
      const ga = this.act;
      const beat = (t * 1.9) % 2;
      const jabR = motion && beat < 0.35 ? Math.sin((beat / 0.35) * Math.PI) : 0;
      const jabL = motion && beat >= 1 && beat < 1.35 ? Math.sin(((beat - 1) / 0.35) * Math.PI) : 0;
      armRx += (-1.25 - jabR * 0.45) * ga;
      armRz += (-0.38 + jabR * 0.2) * ga;
      armLx += (-1.45 - jabL * 0.3) * ga;
      armLz += (0.36 - jabL * 0.2) * ga;
      legL += 0.18 * ga;
      legR -= 0.12 * ga;
      bob += (motion ? Math.abs(Math.sin(t * 7)) * 0.035 : 0) * ga - 0.02 * ga;
    }
    // Dozing on its feet (P15): arms folded across the chest, a slouch and a sway (the chin
    // sinks and jerks back up, below). Eased by its own weight so waking unfolds them.
    const dz = this.doze * this.doze * (3 - 2 * this.doze);
    if (dz > 0) {
      armLx += -0.95 * dz;
      armRx += -0.95 * dz;
      armLz += 0.55 * dz;
      armRz -= 0.55 * dz;
      bob -= 0.025 * dz;
    }
    // The activity's own lean (bent to a desk, a lock, the dice, a scrap).
    let lean =
      (doing === DOING.SEARCH ? 0.35 * this.act : 0) +
      (doing === DOING.READ ? 0.12 * this.act : 0) +
      (doing === DOING.WRESTLE ? (0.12 + this.strainNow * 0.1) * this.act : 0) +
      (doing === DOING.PICK ? 0.32 * this.act : 0) +
      (doing === DOING.DICE || doing === DOING.CARDS ? 0.12 * this.act : 0) +
      (doing === DOING.BOARD ? 0.18 * this.act : 0) +
      (doing === DOING.BRAWL ? 0.08 * this.act : 0) +
      (doing === DOING.KIOSK ? 0.05 * this.act : 0) +
      (doing === DOING.DIG ? 0.32 * this.act : 0);
    // From one activity to another: limbs, height and lean ease from where they were (before a blow, which never waits).
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt * 5);
      const b = this.blend * this.blend * (3 - 2 * this.blend);
      const f = this.from;
      legL = f[0] + (legL - f[0]) * b;
      legR = f[1] + (legR - f[1]) * b;
      armLx = f[2] + (armLx - f[2]) * b;
      armLz = f[3] + (armLz - f[3]) * b;
      armRx = f[4] + (armRx - f[4]) * b;
      armRz = f[5] + (armRz - f[5]) * b;
      bob = f[6] + (bob - f[6]) * b;
      lean = f[7] + (lean - f[7]) * b;
    }
    this.lastBob = bob;
    this.lastLean = lean;
    // A strike: the tool arm up and down hard.
    if (this.hit > 0) {
      const h = this.hit;
      armRx = h > 0.6 ? -2.6 * ((1 - h) / 0.4) : -2.6 * (h / 0.6) - 0.3 * (1 - h / 0.6);
      armLx = Math.min(armLx, -0.5 * h);
    }
    // A punch: the right arm drawn back, then thrown straight out; the left guards the face.
    if (this.jab > 0) {
      const j = this.jab;
      // Out at the blow (the event fires as it lands), held a moment, then eased home.
      const out = Math.min(1, j * 1.6);
      armRx = -1.7 * out * out * (3 - 2 * out);
      armLx = Math.min(armLx, -1.1 * Math.min(1, j * 2));
      armLz = -0.25 * j;
    }
    this.legL.rotation.set(legL, 0, -legZ);
    this.legR.rotation.set(legR, 0, legZ);
    this.armL.rotation.set(armLx, 0, armLz);
    this.armR.rotation.set(armRx, 0, armRz);
    // A bob and a little forward lean while walking, a slow breath while standing; flat in bed.
    this.body.position.y = bob * (1 - this.lie) + this.crawl * 0.12 + 0.07 * Math.sin(this.startle * Math.PI);
    // (In line for the phone, P34: a slow shift of the weight from foot to foot.)
    const shift = doing === DOING.QUEUE && motion ? Math.sin(t * 0.55) * 0.04 * this.act : 0;
    this.body.rotation.z = (motion ? Math.sin(t * 0.7) * 0.06 * dz : 0) + shift;
    this.body.rotation.x =
      0.08 * this.swing -
      (Math.PI / 2) * this.lie +
      lean +
      (Math.PI / 2) * 0.92 * this.crawl +
      0.06 * dz +
      (this.hit > 0 ? 0.18 * Math.sin(this.hit * Math.PI) : 0) +
      (this.jab > 0 ? 0.14 * Math.sin(this.jab * Math.PI) : 0) -
      (this.recoil > 0 ? 0.32 * Math.sin(this.recoil * Math.PI) : 0);
    // A blow taken: knocked back a little along the heading, and the head snaps.
    if (this.recoil > 0) {
      const r = Math.sin(this.recoil * Math.PI) * 0.12;
      this.root.position.x -= Math.sin(this.root.rotation.y) * r;
      this.root.position.z -= Math.cos(this.root.rotation.y) * r;
    }

    // In bed the blanket covers the body: no silhouette through it.
    // (P35: at the kiosk, the far hand under its screen on a side wall would show through it as an arm in the monitor.)
    if (this.ghost) this.ghost.visible = this.lie < 0.3 && doing !== DOING.KIOSK;
    // What goes with the activity: the blanket and Zs, the tray, the water.
    this.blanket.visible = this.lie > 0.6 && !ko;
    this.blanket.scale.z = THREE.MathUtils.smoothstep(this.lie, 0.6, 1);
    const nap = !ko && this.lie < 0.1 && this.doze > 0.3;
    this.zs.forEach((z, i) => {
      z.visible = (this.lie > 0.9 && !ko) || nap;
      if (!z.visible) return;
      const c = motion ? (time * 0.45 + i / 3 + this.offset) % 1 : i / 3;
      if (nap) {
        // Standing: up from over the cap, "z Z Z" growing, drifting up and right on screen
        // (the steep camera sees little of a rise: world +x and -z, turned into the root's
        // frame), fading in with the doze and out as it stirs.
        const wx = Math.sin(c * 5 + i) * 0.1 + c * 0.2;
        const wz = -c * 0.45;
        const ry = this.root.rotation.y;
        const cy = Math.cos(ry);
        const sy = Math.sin(ry);
        z.position.set(wx * cy - wz * sy, 1.5 + c * 0.7, wx * sy + wz * cy + 0.08);
        z.scale.setScalar(0.24 + c * 0.28);
        z.material.opacity = Math.sin(c * Math.PI) * 0.95 * Math.min(1, (this.doze - 0.3) / 0.4) * (1 - this.stir);
        return;
      }
      // Up from the face, drifting and growing, fading at the top.
      z.position.set(0.12 + Math.sin(c * 5 + i) * 0.12, 0.45 + c * 0.9, -1.05 - c * 0.15);
      z.scale.setScalar(0.16 + c * 0.2);
      z.material.opacity = Math.sin(c * Math.PI) * 0.95;
    });
    this.stars.forEach((st, i) => {
      st.visible = ko && this.lie > 0.7;
      if (!st.visible) return;
      // A ring over the head (the head lies back along the heading).
      const a2 = (motion ? time * 3.2 : 0) + (i * Math.PI) / 2;
      st.position.set(Math.cos(a2) * 0.32, 0.55 + Math.sin(a2 * 2) * 0.04, -0.95 + Math.sin(a2) * 0.32);
    });
    this.tray.visible = doing === DOING.EAT && this.act > 0.3;
    const drums = doing === DOING.DRUMS && this.act > 0.3;
    this.buckets.visible = drums;
    for (const st of this.sticks) st.visible = drums;
    this.guitar.visible = doing === DOING.GUITAR && this.act > 0.3;
    this.handset.visible = doing === DOING.PHONE && this.act > 0.3;
    this.water.visible = this.wet && doing === DOING.SHOWER && this.act > 0.2;
    if (this.water.visible) {
      for (const d of this.water.children) {
        if (d.userData.spray) continue;
        const c = motion ? (time * 2.6 + d.userData.phase) % 1 : d.userData.phase;
        d.position.y = 1.55 - c * 1.35;
      }
    }

    // Blink every few seconds; eyes shut in bed.
    this.blinkAt -= dt;
    // Dozing: shut, fluttering as it stirs; wide for a moment on waking with a start.
    const flutter = this.stir > 0.4 && (t * 12) % 1 < 0.3;
    const closed = this.blinkAt < 0.12 || (this.lie > 0.5 && !ko) || (this.doze > 0.6 && !flutter);
    if (this.blinkAt < 0) this.blinkAt = 2 + Math.random() * 3.5;
    this.eyes.scale.y = closed ? 0.15 : 1 + 0.5 * this.startle;

    // Standing still for a while: glance around now and then (not in line, nor asleep).
    this.idle = moving ? 0 : this.idle + dt;
    // (In line for the phone, P34, they look about as they wait.)
    const still = doing === DOING.CRAWL || doing === DOING.LINE_UP || doing === DOING.SLEEP || doing === DOING.EXERCISE || doing === DOING.SEARCH || (doing >= DOING.WORK && doing !== DOING.QUEUE) || ko;
    if (this.idle > 2.5 && motion && !still && Math.random() < dt * 0.6) this.glanceGoal = (Math.random() - 0.5) * (this.perched ? PERCHED_GLANCE * 2 : 1.1);
    if (this.idle === 0 || still) this.glanceGoal = 0;
    this.glance += (this.glanceGoal - this.glance) * k(5);
    this.head.rotation.y = this.glance;
    // (On the phone: the head tipped toward the handset.)
    this.head.rotation.z = doing === DOING.PHONE ? 0.16 * this.act : 0;
    // Nodding off: the chin sinks for 4 s and jerks back up (still, it just hangs).
    const n = (t * 0.2) % 1;
    const sink = n < 0.85 ? n / 0.85 : 1 - (n - 0.85) / 0.15;
    const nod = motion ? 0.3 + 0.35 * sink * sink * (3 - 2 * sink) : 0.55;
    this.head.rotation.x =
      this.recoil > 0 ? -0.35 * Math.sin(this.recoil * Math.PI) : doing === DOING.READ ? 0.3 * this.act : nod * dz * (1 - 0.7 * this.stir) - 0.25 * this.startle;
    return stepped;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      // Sprites and drops share their geometry with every other character.
      if (o instanceof THREE.Sprite) {
        // Textures are shared; each sprite has its own material.
        o.material.dispose();
        return;
      }
      // (P30's instruments too: one set for everyone.)
      const shared = m.geometry === dropGeometry || m.geometry === sprayGeometry || (!!made && (m.geometry === made.buckets || m.geometry === made.stick || m.geometry === made.guitar || m.geometry === made.handset));
      if (o !== this.held && !shared) m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) if (mat !== kitMaterial && mat !== bodyMaterial && mat !== dropMaterial && mat !== sprayMaterial) mat.dispose();
    });
    // (The bones' matrices live in a small texture per character.)
    this.skeleton.dispose();
  }
}
