import * as THREE from 'three';

/**
 * Draw-call savers. A prison is hundreds of static pieces in a few dozen shapes; drawn one
 * InstancedMesh per shape, each shape costs a call in the picture and another in the shadow
 * pass wherever it is. A BatchedMesh draws every shape of one material in a single call
 * (a multi-draw), culling each piece on its own.
 */

/** A static piece: its shape (made once per key) and where it stands. */
export interface Piece {
  key: string;
  make: () => THREE.BufferGeometry;
  matrix: THREE.Matrix4;
}

/**
 * Every piece in one BatchedMesh of `material` (null for none). The shapes must share their
 * attributes and all be indexed or all not (kit models are merged, so never indexed).
 */
export function batched(material: THREE.Material, pieces: readonly Piece[]): THREE.BatchedMesh | null {
  if (!pieces.length) return null;
  const shapes = new Map<string, THREE.BufferGeometry>();
  for (const p of pieces) if (!shapes.has(p.key)) shapes.set(p.key, p.make());
  let vertices = 0;
  let indices = 0;
  for (const g of shapes.values()) {
    vertices += g.attributes.position.count;
    indices += g.index?.count ?? 0;
  }
  const mesh = new THREE.BatchedMesh(pieces.length, vertices, indices, material);
  const ids = new Map<string, number>();
  for (const [key, g] of shapes) {
    ids.set(key, mesh.addGeometry(g));
    // (Copied into the batch's own buffers.)
    g.dispose();
  }
  for (const p of pieces) mesh.setMatrixAt(mesh.addInstance(ids.get(p.key)!), p.matrix);
  // (No per-frame depth sort: the pieces are opaque and few overlap.)
  mesh.sortObjects = false;
  return mesh;
}

/**
 * Takes empty instanced meshes out of both passes (three still issues a call, and sets up its
 * program, for an InstancedMesh with no instances): per frame, before rendering. Layers, not
 * `visible`, so the views' own showing and hiding is left as they set it.
 */
export function skipEmpty(scene: THREE.Object3D) {
  scene.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (!m.isInstancedMesh) return;
    if (m.count === 0) {
      if (m.layers.mask !== 0) {
        m.userData.layers = m.layers.mask;
        m.layers.mask = 0;
      }
    } else if (m.layers.mask === 0) m.layers.mask = m.userData.layers ?? 1;
  });
}

/**
 * When to free what a view lets go of: `now`, or later (the View's setWorld frees the old
 * prison's after the new one's first frame, so the shaders they share are never compiled again).
 */
export type Later = (dispose: () => void) => void;
export const now: Later = (dispose) => dispose();

/**
 * Frees what an object tree holds on the GPU: geometries, the instanced and batched meshes'
 * own buffers, materials, and the maps that `owned` says belong to this tree (shared and
 * cached textures stay). `keep` lists materials shared with others.
 */
export function disposeTree(root: THREE.Object3D, owned: (t: THREE.Texture) => boolean, keep: ReadonlySet<THREE.Material> = new Set()) {
  const maps = new Set<THREE.Texture>();
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if ((o as THREE.BatchedMesh).isBatchedMesh) (o as THREE.BatchedMesh).dispose();
    else {
      m.geometry?.dispose();
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    }
    const list = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of list) if (!keep.has(mat)) mats.add(mat);
  });
  for (const mat of mats) {
    for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture && owned(v as THREE.Texture)) maps.add(v as THREE.Texture);
    mat.dispose();
  }
  for (const t of maps) t.dispose();
}
