import * as THREE from 'three';
import { DIR_X, DIR_Z } from '../sim/command';
import { boardOf } from '../sim/systems/oddjobs';
import type { World } from '../sim/world/World';
import { now, type Later } from './batch';
import { box, disc, kitMaterial, merge, type Part } from './kit';
import { seeThrough } from './occlusion';

/** What the odd jobs board (P40) shows this frame. */
export interface OddJobsFrame {
  /** The three job cards still pinned up today (a pin taken: its card gone, the pin left in the cork). */
  pins: boolean[];
  /** The story's card still up today. */
  chain: boolean;
  /** The player holds a job: a red tag pinned to the header. */
  mine: boolean;
}

/** A face (1 east, 5 south, 9 west, 13 north) as the turn that points +z that way. */
const faceAngle = (face: number) => Math.atan2(DIR_X[face] ?? 0, DIR_Z[face] ?? 1);

const WOOD_DARK = 0x5e3d22;
const CORK = 0xb98a55;
const HEADER = 0x2e5e3a;
const CREAM = 0xf2e6c9;
const INK = 0x3a3f4a;
const PIN_RED = 0xd23b2e;
const PIN_BLUE = 0x3a6fd8;
const PIN_YELLOW = 0xf2c94c;
const MANILA = 0xe8c77a;
const TAG = 0xc8322b;

/** The board's size and height (tiles): its frame's middle about 1.3 up the wall. */
const W = 1.1;
const H = 0.8;
const Y0 = 0.9;
/** The cork's front (off the wall), where the cards lie. */
const CORK_Z = 0.06;

/** The cards: the three jobs across the left, the story's (manila, bigger) on the right; middle, height, tilt, paper colour, pin colour. */
const CARDS: ReadonlyArray<{ x: number; y: number; w: number; h: number; tilt: number; paper: number; pin: number }> = [
  { x: -0.37, y: 1.25, w: 0.2, h: 0.26, tilt: 0.06, paper: 0xf6f3ea, pin: PIN_RED },
  { x: -0.13, y: 1.22, w: 0.2, h: 0.26, tilt: -0.04, paper: 0xf6e9a0, pin: PIN_BLUE },
  { x: 0.11, y: 1.26, w: 0.2, h: 0.26, tilt: 0.03, paper: 0xd9ecf4, pin: PIN_YELLOW },
  { x: 0.34, y: 1.22, w: 0.22, h: 0.3, tilt: -0.07, paper: MANILA, pin: PIN_RED },
];

/** A card at the origin (facing +z): the paper, a heading and a few lines of writing. */
function cardParts(c: (typeof CARDS)[number]): Part[] {
  const parts: Part[] = [box(c.w, c.h, 0.004, c.paper, 0, -c.h / 2, 0)];
  parts.push(box(c.w * 0.62, 0.022, 0.002, INK, 0, c.h / 2 - 0.075, 0.003));
  for (let k = 0; k < 4; k++) parts.push(box(c.w * (k === 3 ? 0.4 : 0.72), 0.01, 0.002, INK, k === 3 ? -c.w * 0.16 : 0, c.h / 2 - 0.12 - k * 0.035, 0.003));
  return parts;
}

/** The board on its wall, in its own terms: the wall's face at z = 0, the room toward +z, the floor at y = 0. */
function boardParts(): Part[] {
  const parts: Part[] = [
    // The frame and the cork in it.
    box(W, H, 0.04, WOOD_DARK, 0, Y0, 0.02),
    box(W - 0.1, H - 0.18, 0.02, CORK, 0, Y0 + 0.05, CORK_Z - 0.01),
    // The header strip across the top, a cream line painted on it.
    box(W - 0.1, 0.09, 0.022, HEADER, 0, Y0 + H - 0.13, CORK_Z - 0.008),
    box(0.46, 0.022, 0.004, CREAM, 0, Y0 + H - 0.096, CORK_Z + 0.006),
  ];
  // The pins stay in the cork when a card is taken down.
  for (const c of CARDS) parts.push(disc(0.018, 0.014, c.pin, c.x, c.y + c.h / 2 - 0.028, CORK_Z + 0.014, 10));
  return parts;
}

/** The red tag a job held hangs from the header's right end. */
function tagParts(): Part[] {
  return [box(0.07, 0.1, 0.004, TAG, W / 2 - 0.12, Y0 + H - 0.24, CORK_Z + 0.004), disc(0.014, 0.012, CREAM, W / 2 - 0.12, Y0 + H - 0.15, CORK_Z + 0.012, 8)];
}

/**
 * The odd jobs board (P40): a cork board in a dark wood frame on a canteen wall (`PrisonDef.board`),
 * its green header strip, the day's job cards pinned to it (one gone as its pin is taken, the pin
 * left behind), the story's manila card beside them, and a red tag while the player holds a job.
 */
export class OddJobsView {
  readonly group = new THREE.Group();
  /** Hung on the wall the player faces at it: cut only by a player well north of it (behind the wall). */
  private readonly mat = seeThrough(kitMaterial.clone(), 0.6, -0.05);
  private board: THREE.Group | null = null;
  private cards: THREE.Mesh[] = [];
  private tag: THREE.Mesh | null = null;

  /** A prison: its board on the canteen wall (none without one). */
  setWorld(world: World, later: Later = now) {
    const old = this.board;
    if (old) {
      this.group.remove(old);
      later(() => old.traverse((m) => (m as THREE.Mesh).geometry?.dispose()));
    }
    this.board = null;
    this.cards = [];
    this.tag = null;
    const b = boardOf({ world });
    if (!b) return;
    const g = new THREE.Group();
    const body = new THREE.Mesh(merge(boardParts()), this.mat);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    for (const c of CARDS) {
      const card = new THREE.Mesh(merge(cardParts(c), false), this.mat);
      card.position.set(c.x, c.y, CORK_Z + 0.004);
      card.rotation.z = c.tilt;
      card.receiveShadow = true;
      g.add(card);
      this.cards.push(card);
    }
    this.tag = new THREE.Mesh(merge(tagParts(), false), this.mat);
    this.tag.visible = false;
    g.add(this.tag);
    // On the wall the player faces: half a tile from their tile's middle that way, its front turned back to them.
    const a = faceAngle(b.face);
    g.position.set(b.x + 0.5 + Math.sin(a) * 0.5, 0, b.z + 0.5 + Math.cos(a) * 0.5);
    g.rotation.y = a + Math.PI;
    this.board = g;
    this.group.add(g);
  }

  /** Per frame: the cards still up, the tag. `shown`: on a floor that sees it (not the tunnels). Null (the title screen): all cards up. */
  update(f: OddJobsFrame | null, shown: boolean) {
    this.group.visible = shown;
    if (!this.board) return;
    for (let k = 0; k < this.cards.length; k++) this.cards[k].visible = f ? (k < 3 ? !!f.pins[k] : f.chain) : true;
    if (this.tag) this.tag.visible = !!f?.mine;
  }
}
