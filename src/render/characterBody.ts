import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { kitMaterial, merge, type Part } from './kit';
import { type Look } from './look';
import { beardParts, glassesParts, hatParts, inkedParts, part, tattooParts } from './characterParts';

// A character's body (out of Character.ts, v2.34.2): its limbs' parts, skinned to its bones in one
// mesh, dressed and in shorts. Built in the order it always was (the meshes' and materials' ids
// decide the draw order of ties).

/** What people wash in (2.26). */
const SHORTS = 0x46566c;

/** The body's material (kept apart from the unskinned meshes', which share the kit's). */
export const bodyMaterial = kitMaterial.clone();
/** Their shadow-pass material, likewise kept apart from the unskinned meshes'. */
const bodyDepth = new THREE.MeshDepthMaterial();
/** Generous bounds round a character (standing, lying in bed, prone in a vent), in its own frame: the skinned body is culled by these. */
const BODY_BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 0.5, -0.2), 1.6);

/**
 * One skinned mesh from the limbs' parts (each given in its pivot's frame): every vertex
 * follows its own pivot (a bone), so the whole body is a single draw call however the limbs
 * move. Bound with the pivots as they stand now (rest), relative to `root`.
 */
export function skinned(limbs: Array<[Part[], THREE.Bone]>, root: THREE.Object3D, material: THREE.Material): THREE.SkinnedMesh {
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
export function ghostSkin(body: THREE.SkinnedMesh, material: THREE.Material): THREE.SkinnedMesh {
  const copy = new THREE.SkinnedMesh(body.geometry, material);
  copy.boundingSphere = BODY_BOUNDS.clone();
  copy.bind(body.skeleton, new THREE.Matrix4());
  return copy;
}

/** A ghillie cloak's colours (2.36): moss, olive, bracken, earth. */
const GHILLIE = [0x4f6a3a, 0x5f7a46, 0x7a6a4a, 0x3e5230, 0x6a5a3a];

/** Tufts hanging on a surface: a ring of strips round x ±`hx`, from y0 to y1, on the face at z (its side), seeded by `k`. */
function ghillieTufts(hx: number, _hz: number, y0: number, y1: number, z: number, k: number): Part[] {
  const out: Part[] = [];
  for (let i = 0; i < 9; i++) {
    const t = (i * 0.618 + k * 0.29) % 1;
    const u = (i * 0.414 + k * 0.17) % 1;
    out.push(
      part(
        0.05 + u * 0.04,
        0.12 + t * 0.1,
        0.03,
        GHILLIE[(i + k) % GHILLIE.length],
        -hx + t * hx * 2,
        y0 + u * (y1 - y0),
        z + Math.sign(z) * 0.01,
      ),
    );
  }
  return out;
}

/** A character's pivots: the bones its body's parts are skinned to. */
export interface Bones {
  body: THREE.Bone;
  head: THREE.Bone;
  eyes: THREE.Bone;
  armL: THREE.Bone;
  armR: THREE.Bone;
  legL: THREE.Bone;
  legR: THREE.Bone;
}

/**
 * The body of a look on its bones under `root`: the dressed mesh, the same in shorts for the showers
 * (2.26; guards never wash, the player's guard disguise does), and a guard's key on the belt.
 */
export function buildFigure(
  look: Look,
  b: Bones,
  root: THREE.Object3D,
  material: THREE.Material,
): { dressed: THREE.SkinnedMesh; washBody: THREE.SkinnedMesh | null; keyTag: THREE.Bone | null } {
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
  // The same limbs in shorts (2.26).
  const bare: Array<[Part[], THREE.Bone]> = [];

  // Legs: pivots at the hips.
  for (const [pivot, x] of [
    [b.legL, -0.11],
    [b.legR, 0.11],
  ] as const) {
    pivot.position.set(x, 0.4, 0);
    mesh(
      [
        part(0.19, 0.34, 0.2, trousers, 0, -0.17, 0),
        part(0.21, 0.08, 0.27, shoe, 0, -0.36, 0.03),
        ...(trim !== undefined ? [part(0.196, 0.035, 0.206, trim, 0, -0.29, 0)] : []),
      ],
      pivot,
    );
    bare.push([
      [
        part(0.19, 0.17, 0.2, SHORTS, 0, -0.085, 0),
        part(0.17, 0.17, 0.18, skin, 0, -0.255, 0),
        part(0.19, 0.06, 0.25, skin, 0, -0.37, 0.03),
      ],
      pivot,
    ]);
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
    b.body,
  );

  bare.push([[part(0.52, 0.36, 0.3, skin, 0, 0.63, 0), part(0.53, 0.09, 0.31, SHORTS, 0, 0.42, 0)], b.body]);

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
      b.body,
    );
  }

  // A ghillie cloak (2.36): tufts of burlap and net all over the body and the shoulders, a shaggy flap down the back.
  if (look.ghillie) {
    mesh(
      [
        ...ghillieTufts(0.27, 0.16, 0.42, 0.82, 0.16, 1),
        ...ghillieTufts(0.27, 0.16, 0.42, 0.82, -0.16, 2),
        part(0.5, 0.36, 0.05, GHILLIE[0], 0, 0.42, -0.18),
        ...[-0.2, -0.07, 0.07, 0.2].map((x, k) => part(0.1, 0.12, 0.04, GHILLIE[(k + 2) % GHILLIE.length], x, 0.34, -0.185)),
        part(0.6, 0.08, 0.36, GHILLIE[1], 0, 0.78, 0),
      ],
      b.body,
    );
  }

  // Arms: pivots at the shoulders; sleeves rolled up to the elbow.
  for (const [pivot, x] of [
    [b.armL, -0.34],
    [b.armR, 0.34],
  ] as const) {
    pivot.position.set(x, 0.78, 0);
    mesh(
      [
        part(0.15, 0.2, 0.16, outfit, 0, -0.1, 0),
        part(0.13, 0.15, 0.14, skin, 0, -0.27, 0),
        part(0.14, 0.09, 0.15, skin, 0, -0.38, 0),
        ...(trim !== undefined ? [part(0.156, 0.034, 0.166, trim, 0, -0.187, 0)] : []),
        ...(look.ghillie
          ? [part(0.18, 0.2, 0.19, GHILLIE[x < 0 ? 0 : 3], 0, -0.12, 0), ...ghillieTufts(0.09, 0.1, -0.25, -0.02, 0.1, x < 0 ? 3 : 4)]
          : []),
        ...(x > 0 && look.tattoo ? tattooParts(look.tattoo, look.tattooColor ?? 0x2f4f6f, skin) : []),
        // (P29: those inked inside: the left forearm's front and outer side, the right's outer side.)
        ...inkedParts(look.inked ?? [], x < 0, skin),
      ],
      pivot,
    );
    bare.push([
      [
        part(0.15, 0.2, 0.16, skin, 0, -0.1, 0),
        part(0.13, 0.15, 0.14, skin, 0, -0.27, 0),
        part(0.14, 0.09, 0.15, skin, 0, -0.38, 0),
        ...(x > 0 && look.tattoo ? tattooParts(look.tattoo, look.tattooColor ?? 0x2f4f6f, skin) : []),
        ...inkedParts(look.inked ?? [], x < 0, skin),
      ],
      pivot,
    ]);
  }

  // Head: a big block with brows, a nose, a mouth and a haircut; the eyes blink on their own.
  b.head.position.y = 0.8;
  const face: Part[] = [
    part(0.46, 0.44, 0.44, skin, 0, 0.22, 0),
    part(0.06, 0.07, 0.04, skin, 0, 0.18, 0.235),
    part(0.11, 0.025, 0.02, 0x8a4b3a, 0, 0.1, 0.222),
  ];
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
    face.push(
      part(0.47, 0.03, 0.45, hair, 0, 0.45, 0),
      part(0.47, 0.2, 0.03, hair, 0, 0.36, -0.215),
      part(0.1, 0.2, 0.46, hair, 0, 0.55, -0.01),
    );
  } else if (style === 5) {
    // Curls: a round mop over the top (a short top under a hat), down the sides and the back.
    face.push(
      covered ? part(0.48, 0.1, 0.47, hair, 0, 0.47, -0.005) : part(0.56, 0.2, 0.54, hair, 0, 0.5, -0.02),
      part(0.08, 0.2, 0.42, hair, -0.27, 0.36, -0.04),
      part(0.08, 0.2, 0.42, hair, 0.27, 0.36, -0.04),
      part(0.54, 0.3, 0.1, hair, 0, 0.32, -0.25),
    );
  }
  if (look.beard) face.push(...beardParts(look.beard, hair, skin));
  if (look.glasses) face.push(...glassesParts(look.glasses, look.glassesColor ?? 0x2a2a30));
  // A hat sits on what's under it: the short cut's top (0.52), a buzz cut's (0.465), a bald head's (0.44),
  // a hair's breadth above (no shared faces); a headband stays round the brow whatever the hair.
  if (hatted) {
    const dy = look.hat === 3 ? 0 : (style === 2 ? 0.45 : style === 1 ? 0.475 : 0.52) - 0.52;
    face.push(...hatParts(look.hat!, look.hatColor ?? 0x8c3b2a).map((g) => g.translate(0, dy, 0)));
  }
  if (look.ghillie) {
    // The cloak's hood: shaggy over the crown and down the back of the head, tufts falling over the brow.
    face.push(
      part(0.52, 0.16, 0.5, GHILLIE[0], 0, 0.46, -0.02),
      part(0.52, 0.36, 0.08, GHILLIE[1], 0, 0.14, -0.23),
      part(0.07, 0.3, 0.42, GHILLIE[2], -0.25, 0.2, -0.02),
      part(0.07, 0.3, 0.42, GHILLIE[2], 0.25, 0.2, -0.02),
      ...[-0.17, -0.06, 0.05, 0.16].map((x, k) => part(0.07, 0.09, 0.05, GHILLIE[(k + 1) % GHILLIE.length], x, 0.4, 0.23)),
    );
  } else if (look.riot) {
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
  mesh(face, b.head);
  b.eyes.position.set(0, 0.24, 0.222);
  mesh([part(0.065, 0.09, 0.02, dark, -0.1, 0, 0), part(0.065, 0.09, 0.02, dark, 0.1, 0, 0)], b.eyes);
  b.head.add(b.eyes);

  // A guard's key: a ring and a key in its color, hanging from the belt.
  let keyTag: THREE.Bone | null = null;
  if (look.key !== undefined) {
    keyTag = new THREE.Bone();
    mesh(
      [
        part(0.09, 0.09, 0.03, look.key, 0, 0.36, 0),
        part(0.035, 0.12, 0.025, look.key, 0, 0.26, 0),
        part(0.05, 0.03, 0.025, look.key, 0.03, 0.22, 0),
      ],
      keyTag,
    );
    keyTag.position.set(-0.2, 0.02, 0.16);
    b.body.add(keyTag);
  }
  b.body.add(b.legL, b.legR, b.armL, b.armR, b.head);
  root.add(b.body);
  // (Before the first skinned(): merging a list spends the geometry it's given only as far as the GPU, and nothing's been drawn.)
  const washes = !guard || look.silhouette !== undefined;
  if (washes) bare.push([face, b.head], [[part(0.065, 0.09, 0.02, dark, -0.1, 0, 0), part(0.065, 0.09, 0.02, dark, 0.1, 0, 0)], b.eyes]);
  const dressed = skinned(limbs, root, material);
  root.add(dressed);
  let washBody: THREE.SkinnedMesh | null = null;
  if (washes) {
    washBody = skinned(bare, root, material);
    washBody.visible = false;
    root.add(washBody);
  }
  return { dressed, washBody, keyTag };
}
