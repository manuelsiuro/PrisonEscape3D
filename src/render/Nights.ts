import * as THREE from 'three';
import type { QuizPlace, Stage } from '../content/prisons/types';
import { box, cyl, kitMaterial, merge, rod } from './kit';
import { disposeTree } from './batch';

/**
 * What stage nights (P30) show: talent night's stage in the canteen (boards, a mic stand,
 * speakers, a string of bulbs on two poles) and quiz night's four buzzers in the library, each
 * lit as its contestant buzzes (right, wrong). Built once per map, shown on their nights. The
 * instruments are the performers' own (Character).
 */
export interface NightsFrame {
  /** The prison's stage and quiz places (null: none). */
  stage: Stage | null;
  quiz: QuizPlace | null;
  /** A wall all along the stage's back (the poles, speakers and bulbs stand against it; an open back, a doorway, has only the boards and the mic). */
  backed: boolean;
  /** The stage set up (talent night's evening), the buzzers out (quiz night's). */
  stageUp: boolean;
  quizUp: boolean;
  /** Each place's buzzer: 0 dark, 1 lit (buzzed), 2 right, 3 wrong. */
  lights: readonly number[];
}

/** A face (1 east, 5 south, 9 west, 13 north) as the turn that points +z that way. */
const turnOf = (face: number) => (face === 1 ? Math.PI / 2 : face === 9 ? -Math.PI / 2 : face === 13 ? Math.PI : 0);

const BULBS = [0xffd166, 0xff6fb5, 0x5fd3ff, 0x7ed957, 0xff9f43, 0xb38cff, 0xffd166, 0xff6fb5, 0x5fd3ff];
const LIGHT = [0x3a1212, 0xffe066, 0x5fe08a, 0xd23f36];
/** A bulb's height along the wire: lower towards the middle. */
const bulbY = (x: number) => 1.66 - 0.12 * (1 - (x / 1.3) ** 2);

export class NightsView {
  readonly group = new THREE.Group();
  private readonly stage = new THREE.Group();
  private readonly quiz = new THREE.Group();
  /** The string's bulbs and the buzzers' buttons: one instanced mesh each (one draw call), tinted per instance. */
  private bulbs: THREE.InstancedMesh | null = null;
  private readonly bulbAt: THREE.Matrix4[] = [];
  private buttons: THREE.InstancedMesh | null = null;
  private readonly lit: number[] = [];
  private readonly tint = new THREE.Color();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private drawnStage: Stage | null = null;
  private drawnQuiz: QuizPlace | null = null;
  private drawnBacked = false;

  constructor() {
    this.group.add(this.stage, this.quiz);
  }

  /** Lets go of what was built for the last map. */
  private clear() {
    for (const g of [this.stage, this.quiz]) disposeTree(g, () => false, new Set([kitMaterial]));
    this.stage.clear();
    this.quiz.clear();
    this.bulbs = null;
    this.bulbAt.length = 0;
    this.buttons = null;
    this.lit.length = 0;
  }

  /** The stage, in its own terms: the performer's tile at the origin, the room toward +z. */
  private buildStage(st: Stage, backed: boolean) {
    // The boards: three tiles across, two deep, planks of two woods, a trim along the front (thin: feet stand on them, not in them).
    const boards = [...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => box(0.3, 0.012, 1.96, k % 2 ? 0x8a5a33 : 0x9c6a3e, -1.35 + k * 0.3, 0, 0.5)), box(3, 0.02, 0.05, 0xd9a441, 0, 0, 1.47)];
    const floor = new THREE.Mesh(merge(boards, false), kitMaterial);
    floor.receiveShadow = true;
    this.stage.add(floor);
    const parts = [
      // The mic stand, front and to one side, its head at the mouth and turned to the performer.
      cyl(0.13, 0.02, 0x2b2e34, 0.62, 0.012, 0.55, 12),
      cyl(0.016, 0.88, 0x9aa2ad, 0.62, 0.012, 0.55, 6),
      rod(0.016, 0.2, 0x9aa2ad, 0.52, 0.9, 0.5),
      cyl(0.04, 0.09, 0x2b2e34, 0.42, 0.86, 0.45, 8),
    ];
    // Against a wall: two poles at the back for the bulbs, a speaker at the foot of each, the wire between them and a drop to each bulb.
    if (backed)
      parts.push(
        cyl(0.035, 1.8, 0x3b3f46, -1.42, 0, -0.42, 8),
        cyl(0.035, 1.8, 0x3b3f46, 1.42, 0, -0.42, 8),
        box(0.34, 0.56, 0.26, 0x22252b, -1.18, 0.012, -0.32),
        box(0.34, 0.56, 0.26, 0x22252b, 1.18, 0.012, -0.32),
        box(0.2, 0.2, 0.02, 0x5a5f69, -1.18, 0.31, -0.18),
        box(0.2, 0.2, 0.02, 0x5a5f69, 1.18, 0.31, -0.18),
        rod(0.008, 2.84, 0x2b2e34, 0, 1.74, -0.42),
        ...BULBS.map((_, k) => {
          const x = -1.3 + (k * 2.6) / (BULBS.length - 1);
          const y = bulbY(x);
          return box(0.006, 1.74 - y, 0.006, 0x2b2e34, x, y, -0.42);
        }),
      );
    const m = new THREE.Mesh(merge(parts), kitMaterial);
    m.castShadow = true;
    this.stage.add(m);
    // The bulbs on their drops, lower in the middle; lit, they twinkle.
    if (backed) {
      const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), BULBS.length);
      BULBS.forEach((c, k) => {
        const x = -1.3 + (k * 2.6) / (BULBS.length - 1);
        const at = new THREE.Matrix4().makeTranslation(x, bulbY(x) - 0.04, -0.42);
        this.bulbAt.push(at);
        bulbs.setMatrixAt(k, at);
        bulbs.setColorAt(k, this.tint.setHex(c));
      });
      this.bulbs = bulbs;
      this.stage.add(bulbs);
    }
    this.stage.position.set(st.x + 0.5, 0, st.z + 0.5);
    this.stage.rotation.y = turnOf(st.face);
  }

  /** The buzzers: a little podium in front of each place, its button on top. */
  private buildQuiz(q: QuizPlace) {
    // (Waist-high: the right hand comes down on the button, a little to that side.)
    const podium = merge([box(0.44, 0.46, 0.22, 0x2f4a6d, 0, 0, 0), box(0.46, 0.04, 0.24, 0xd9a441, 0, 0.46, 0), box(0.3, 0.14, 0.01, 0xf4efe0, 0, 0.26, 0.115)]);
    // (Each podium a little in front of its place, its button on top to the right: in the podium's frame.)
    podium.translate(0, 0, 0.4);
    const button = new THREE.CylinderGeometry(0.075, 0.085, 0.06, 14).translate(0.15, 0.53, 0.4);
    const podiums = new THREE.InstancedMesh(podium, kitMaterial, q.spots.length);
    podiums.castShadow = true;
    const buttons = new THREE.InstancedMesh(button, new THREE.MeshBasicMaterial({ color: 0xffffff }), q.spots.length);
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turnOf(q.face));
    const one = new THREE.Vector3(1, 1, 1);
    const at = new THREE.Matrix4();
    q.spots.forEach((p, k) => {
      at.compose(new THREE.Vector3(p.x + 0.5, 0, p.z + 0.5), turn, one);
      podiums.setMatrixAt(k, at);
      buttons.setMatrixAt(k, at);
      buttons.setColorAt(k, this.tint.setHex(LIGHT[0]));
      this.lit.push(0);
    });
    this.buttons = buttons;
    this.quiz.add(podiums, buttons);
  }

  update(f: NightsFrame | null, time: number, motion: boolean, shown: boolean) {
    const st = f?.stage ?? null;
    const qz = f?.quiz ?? null;
    const backed = !!f?.backed;
    if (st !== this.drawnStage || qz !== this.drawnQuiz || backed !== this.drawnBacked) {
      this.clear();
      if (st) this.buildStage(st, backed);
      if (qz) this.buildQuiz(qz);
      this.drawnStage = st;
      this.drawnQuiz = qz;
      this.drawnBacked = backed;
    }
    this.stage.visible = !!f?.stageUp && shown;
    this.quiz.visible = !!f?.quizUp && shown;
    if (this.stage.visible) {
      // (The bulbs twinkle in turn; held lit with reduced motion.)
      const bulbs = this.bulbs;
      if (bulbs) {
        this.bulbAt.forEach((at, k) => bulbs.setMatrixAt(k, !motion || Math.sin(time * 2.2 + k * 1.7) > -0.6 ? at : this.hidden));
        bulbs.instanceMatrix.needsUpdate = true;
      }
    }
    const buttons = this.buttons;
    if (this.quiz.visible && f && buttons) {
      let changed = false;
      this.lit.forEach((was, k) => {
        const now = f.lights[k] ?? 0;
        if (now === was) return;
        this.lit[k] = now;
        buttons.setColorAt(k, this.tint.setHex(LIGHT[now]));
        changed = true;
      });
      if (changed) buttons.instanceColor!.needsUpdate = true;
    }
  }
}
