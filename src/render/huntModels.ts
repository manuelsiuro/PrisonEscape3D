/** The hunt's vehicles: the helicopter, the searchers' van, and each safe point's vehicle or post. */
import * as THREE from 'three';
import type { SafeKind } from '../content/outside/types';
import { box, cyl, kitMaterial, merge, rod, type Part } from './kit';

/** A helicopter: its body, the rotor (turned about y) and the tail rotor, nose along +z. */
export function heliModel(paintC: number): { body: THREE.Mesh; rotor: THREE.Group; tail: THREE.Group } {
  const body = new THREE.Mesh(
    merge([
      box(1.0, 0.8, 2.2, paintC, 0, 0.3),
      box(0.9, 0.5, 0.7, 0x9fc4d8, 0, 0.6, 0.9),
      box(0.18, 0.18, 2.2, paintC, 0, 0.75, -2.1),
      box(0.06, 0.6, 0.4, 0xe8b828, 0, 0.8, -3.1),
      box(1.3, 0.05, 0.08, 0x2a2f36, 0, 0.05, 0.5),
      box(1.3, 0.05, 0.08, 0x2a2f36, 0, 0.05, -0.5),
      box(0.05, 0.25, 1.3, 0x2a2f36, 0.55, 0.05, 0),
      box(0.05, 0.25, 1.3, 0x2a2f36, -0.55, 0.05, 0),
    ]),
    kitMaterial,
  );
  const rotor = new THREE.Group();
  rotor.add(new THREE.Mesh(merge([box(4.2, 0.03, 0.18, 0x22262c, 0, 0), box(0.18, 0.03, 4.2, 0x22262c, 0, 0)]), kitMaterial));
  rotor.position.y = 1.25;
  const tail = new THREE.Group();
  tail.add(new THREE.Mesh(merge([box(0.03, 0.8, 0.1, 0x22262c, 0, -0.4)]), kitMaterial));
  tail.position.set(0.08, 0.85, -3.1);
  return { body, rotor, tail };
}

/** The delivery's van (the stowaway's ride): white, a cab ahead, nose along +z. */
export function vanGeometry(): THREE.BufferGeometry {
  const w = 1.2;
  const wheels = [1.0, -1.1].flatMap((z) => [-1, 1].map((sx) => rod(0.24, 0.2, 0x15171b, sx * (w / 2 - 0.08), 0.24, z, 10)));
  return merge([
    box(w, 1.3, 2.5, 0xeef0ee, 0, 0.3, -0.35),
    box(w, 0.95, 0.9, 0xeef0ee, 0, 0.3, 1.3),
    box(w - 0.1, 0.36, 0.05, 0x1c2a38, 0, 0.82, 1.76),
    box(w + 0.02, 0.12, 2.5, 0x2f6fa8, 0, 0.75, -0.35),
    box(0.3, 0.12, 0.04, 0xffe7a0, -0.4, 0.55, 1.76),
    box(0.3, 0.12, 0.04, 0xffe7a0, 0.4, 0.55, 1.76),
    ...wheels,
  ]);
}

/** The safe point's vehicle or post (nose toward +z, centered): a bus, a border barrier with its sign, a boxcar, a rig, a coach. */
export function vehicleGeometry(kind: SafeKind): THREE.BufferGeometry {
  const wheels = (w: number, zs: number[], r = 0.26) => zs.flatMap((z) => [-1, 1].map((s) => rod(r, 0.2, 0x15171b, s * (w / 2 - 0.08), r, z, 10)));
  switch (kind) {
    case 'bus':
    case 'coach': {
      const paintC = kind === 'bus' ? 0xe8b828 : 0x2f6fa8;
      const w = 1.3;
      return merge([
        box(w, 1.2, 4.6, paintC, 0, 0.25),
        box(w + 0.02, 0.36, 4.2, 0x1c2a38, 0, 0.85),
        box(w - 0.1, 0.06, 4.4, 0xf4f1ea, 0, 1.45),
        box(w - 0.2, 0.4, 0.04, 0x1c2a38, 0, 0.75, 2.31),
        ...wheels(w, [1.5, -1.5]),
      ]);
    }
    case 'truck': {
      const w = 1.3;
      return merge([
        box(w, 1.0, 1.4, 0xb03e2c, 0, 0.3, 2.2),
        box(w - 0.1, 0.34, 0.05, 0x1c2a38, 0, 0.8, 2.92),
        box(w, 1.5, 3.6, 0xdcdcd4, 0, 0.35, -0.4),
        box(0.12, 0.6, 0.12, 0x9aa1ab, 0.5, 1.3, 1.6),
        ...wheels(w, [2.2, 0.3, -1.6]),
      ]);
    }
    case 'train': {
      const w = 1.2;
      return merge([box(w, 1.3, 4.4, 0x7a3f2a, 0, 0.35), box(w + 0.02, 0.9, 1.0, 0x2a1e18, 0, 0.5, 0), box(w - 0.1, 0.06, 4.3, 0x5a2f20, 0, 1.65), ...wheels(w, [1.5, -1.5], 0.22)]);
    }
    case 'border':
    default: {
      // The barrier across the road, a striped pole on a post, the frontier's sign and flag.
      const parts: Part[] = [cyl(0.08, 1.0, 0x3a3f46, -1.1, 0), box(0.2, 0.2, 0.2, 0x3a3f46, -1.1, 0.9)];
      for (let k = 0; k < 8; k++) parts.push(box(0.28, 0.1, 0.1, k % 2 ? 0xf4f1ea : 0xd23f36, -0.95 + k * 0.28, 0.95));
      parts.push(cyl(0.04, 2.4, 0x9aa1ab, 1.4, 0), box(0.7, 0.45, 0.03, 0x2f6fa8, 1.77, 1.85), box(0.9, 0.5, 0.06, 0x2f6fa8, 1.4, 1.1, -0.2), box(0.75, 0.08, 0.07, 0xf4f1ea, 1.4, 1.3, -0.17));
      return merge(parts);
    }
  }
}
