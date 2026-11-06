import * as THREE from 'three';

/** The side, in tiles, of the squares a spread-out instanced mesh is split into. */
export const CHUNK = 16;

/** An instance's place once split: its piece and its index there. */
export type Placed = [mesh: THREE.InstancedMesh, k: number];

/**
 * Instances spread over the map (the trees round a prison, a minefield's mounds), split by where they
 * stand into squares of `CHUNK` tiles, each an instanced mesh of its own. The camera skips an instanced
 * mesh only whole, and the shadow pass too, so one spread over the map was drawn whole every frame,
 * nearly all of it out of sight (session 5, the phone performance pass: San Pancho's busiest frame sent
 * 275k triangles, 105k of them the minefield's). The same geometry and material in every piece, each
 * piece's instances in their first order: the picture is the same. `make` sets up each piece (shadows,
 * culling); `placed[i]` is where instance `i` went.
 */
export function chunked(
  geo: THREE.BufferGeometry,
  mat: THREE.Material | THREE.Material[],
  matrices: readonly THREE.Matrix4[],
  make: (mesh: THREE.InstancedMesh) => void = () => {},
): { meshes: THREE.InstancedMesh[]; placed: Placed[] } {
  const squares = new Map<string, number[]>();
  matrices.forEach((m, i) => {
    const key = `${Math.floor(m.elements[12] / CHUNK)},${Math.floor(m.elements[14] / CHUNK)}`;
    let list = squares.get(key);
    if (!list) squares.set(key, (list = []));
    list.push(i);
  });
  const meshes: THREE.InstancedMesh[] = [];
  const placed: Placed[] = new Array(matrices.length);
  // (Each piece knows its set: budgettest counts a set once, the browser only the pieces in view.)
  const set = {};
  for (const list of squares.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.userData.chunkedSet = set;
    list.forEach((i, k) => {
      mesh.setMatrixAt(k, matrices[i]);
      placed[i] = [mesh, k];
    });
    make(mesh);
    mesh.computeBoundingSphere();
    meshes.push(mesh);
  }
  return { meshes, placed };
}
