/**
 * Wavefront OBJ export of any Three.js object: world positions, normals and vertex colours (`v x y z r g b`,
 * read by Blender, MeshLab and Godot), one `g` group per mesh, instanced meshes written once per instance.
 * Textures are not written: the kit's models are coloured by their vertices.
 */
import * as THREE from 'three';

const clean = (s: string) => s.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'part';
const f4 = (n: number) => (Math.abs(n) < 5e-5 ? '0' : n.toFixed(4));

export function exportObj(root: THREE.Object3D, name = 'model'): string {
  root.updateMatrixWorld(true);
  const lines = ['# Wavefront OBJ - Prison Escape 3D Model Library', `o ${clean(name)}`];
  let vBase = 1;
  let nBase = 1;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const world = new THREE.Matrix4();
  const instance = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    if (!pos) return;
    const nor = geo.getAttribute('normal');
    const col = geo.getAttribute('color');
    const idx = geo.getIndex();
    const inst = mesh as THREE.InstancedMesh;
    const copies = inst.isInstancedMesh ? inst.count : 1;

    for (let k = 0; k < copies; k++) {
      world.copy(mesh.matrixWorld);
      if (inst.isInstancedMesh) {
        inst.getMatrixAt(k, instance);
        world.multiply(instance);
      }
      normalMatrix.getNormalMatrix(world);
      lines.push(`g ${clean(mesh.parent?.name || mesh.name)}${copies > 1 ? `_${k + 1}` : ''}`);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(world);
        const rgb = col ? ` ${f4(col.getX(i))} ${f4(col.getY(i))} ${f4(col.getZ(i))}` : '';
        lines.push(`v ${f4(v.x)} ${f4(v.y)} ${f4(v.z)}${rgb}`);
      }
      if (nor) {
        for (let i = 0; i < nor.count; i++) {
          n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
          lines.push(`vn ${f4(n.x)} ${f4(n.y)} ${f4(n.z)}`);
        }
      }
      const count = idx ? idx.count : pos.count;
      for (let i = 0; i < count; i += 3) {
        const a = idx ? idx.getX(i) : i;
        const b = idx ? idx.getX(i + 1) : i + 1;
        const c = idx ? idx.getX(i + 2) : i + 2;
        lines.push(
          nor
            ? `f ${vBase + a}//${nBase + a} ${vBase + b}//${nBase + b} ${vBase + c}//${nBase + c}`
            : `f ${vBase + a} ${vBase + b} ${vBase + c}`,
        );
      }
      vBase += pos.count;
      if (nor) nBase += nor.count;
    }
  });
  return `${lines.join('\n')}\n`;
}
