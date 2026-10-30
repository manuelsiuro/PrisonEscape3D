import * as THREE from 'three';
import { PHOTO_WALL } from '../content/kiosk';
import { headingAngle } from '../sim/command';
import { kioskOf } from '../sim/systems/kiosk';
import { MAP_H, MAP_W, type World } from '../sim/world/World';
import { TILE_INFO } from '../sim/world/tiles';
import { now, type Later } from './batch';
import { box, cyl, disc, kitMaterial, merge, type Part } from './kit';
import { glowTexture } from './lights';
import { seeThrough } from './occlusion';
import { canvasTexture } from './canvas';
import { drawingTexture } from './kioskDrawings';

/** What the internet kiosk (P35) shows this frame. */
export interface KioskFrame {
  /** The player logged in (time paid for): the screen awake, its apps up. */
  on: boolean;
  /** The family's drawings pinned over the player's bed (indices into PHOTOS, oldest first). */
  photos: readonly number[];
}

/** A face (1 east, 5 south, 9 west, 13 north) as the turn that points +z that way. */

/**
 * On a side wall (facing east or west) the screen would show edge-on to the camera (which looks
 * north): its head is swung this far toward the camera (radians) on its arm, about its south
 * edge (as decor.ts turns a hoop). The drawings over a bed on a side wall are turned the same.
 */
const SIDE_TURN = 0.6;
/** The screen head tips back this far (radians): its face turned up a little, toward the camera and the one typing. */
const TILT = 0.2;
/** The head: its width, its foot and top (on the wall), how far it stands out. */
const HEAD_W = 0.54;
const HEAD_Y0 = 0.84;
const HEAD_Y1 = 1.38;
const HEAD_D = 0.12;
/** The screen in the head's face: its size and middle (height over the head's foot). */
const SCREEN_W = 0.44;
const SCREEN_H = 0.3;
const SCREEN_Y = 0.29;
/** The screen's picture (pixels): a small canvas, redrawn only when what it shows changes. */
const PX_W = 128;
const PX_H = 96;
/** Logged in: a line typed in every this many seconds, a pause on the full page, the cursor's blink (Hz). */
const LINE_SECS = 0.45;
const PAGE_PAUSE = 2.2;
const BLINK_HZ = 2.2;
/** Logged out: the screensaver's logo hops to its next spot every this many seconds. */
const HOP_SECS = 2.6;
/** The content's lines (widths in pixels, the first a heading). */
const LINES = [58, 96, 84, 70, 92, 46];

const STEEL = 0xa9b2bc;
const STEEL_DARK = 0x6b737c;
const BLACK = 0x1a1c20;
const TEAL = 0x1f8a7a;
const CHROME = 0xc9d0d8;

/**
 * The kiosk on its wall, in its own terms: the wall's face at z = 0, the room toward +z, the floor
 * at y = 0 (WALL_H 1.4 over it: nothing stands above the wall). A slim steel pedestal bolted to a
 * back plate, its vent and card slot; the keyboard shelf at the hands' height (the character's
 * shoulders are at 0.78), a dark keyboard on it with its rows of keys and a trackball; over it, the
 * plate up to the screen head (built apart: `headParts`).
 */
function bodyParts(): Part[] {
  return [
    // The back plate, bolted to the wall at its corners.
    box(0.5, 1.26, 0.02, STEEL_DARK, 0, 0.08, 0.01),
    ...[-1, 1].flatMap((s) => [disc(0.018, 0.012, CHROME, s * 0.22, 0.14, 0.024, 8), disc(0.018, 0.012, CHROME, s * 0.22, 0.72, 0.024, 8)]),
    // The pedestal on its dark plinth, a vent low down, the card slot under the shelf.
    box(0.42, 0.04, 0.18, BLACK, 0, 0, 0.09),
    box(0.38, 0.58, 0.15, STEEL, 0, 0.04, 0.075),
    ...[0, 1, 2, 3].map((k) => box(0.22, 0.012, 0.006, 0x3a3f46, 0, 0.14 + k * 0.035, 0.152)),
    box(0.1, 0.07, 0.008, 0x3a3f46, 0.1, 0.46, 0.152),
    box(0.07, 0.01, 0.01, BLACK, 0.1, 0.49, 0.156),
    box(0.02, 0.012, 0.01, 0x3fd47a, 0.1, 0.47, 0.156),
    // The keyboard shelf (a brace under each end), the keyboard, its rows of keys, the trackball.
    box(0.54, 0.03, 0.34, STEEL_DARK, 0, 0.62, 0.17),
    box(0.02, 0.08, 0.22, STEEL_DARK, -0.25, 0.54, 0.11),
    box(0.02, 0.08, 0.22, STEEL_DARK, 0.25, 0.54, 0.11),
    box(0.4, 0.022, 0.15, 0x2a2e35, -0.03, 0.65, 0.235),
    ...[0, 1, 2, 3].map((r) => box(r === 3 ? 0.18 : 0.36, 0.008, 0.024, 0xb8c0ca, -0.03, 0.672, 0.182 + r * 0.033)),
    cyl(0.03, 0.02, 0x2a2e35, 0.21, 0.65, 0.24, 10),
    cyl(0.02, 0.02, 0x7fd0c4, 0.21, 0.665, 0.24, 10),
  ];
}

/**
 * The screen head, in its own terms: the wall at z = 0, its foot at y = 0 (HEAD_Y0 on the wall).
 * A steel housing with a dark bezel round the screen (the screen itself: its own mesh, unlit), the
 * network's teal band along the top with its light (no hood over the screen: from the camera's
 * height it would hide the screen's top).
 */
function headParts(): Part[] {
  const h = HEAD_Y1 - HEAD_Y0;
  const front = HEAD_D;
  return [
    box(HEAD_W, h, HEAD_D, STEEL, 0, 0, HEAD_D / 2),
    box(SCREEN_W + 0.05, SCREEN_H + 0.05, 0.01, BLACK, 0, SCREEN_Y - (SCREEN_H + 0.05) / 2, front + 0.004),
    box(HEAD_W + 0.02, 0.05, 0.012, TEAL, 0, h - 0.07, front + 0.004),
    box(0.16, 0.016, 0.014, 0xeaf6f4, -0.12, h - 0.053, front + 0.006),
    box(0.026, 0.026, 0.014, 0x7fffe0, 0.21, h - 0.058, front + 0.006),
    box(HEAD_W + 0.03, 0.025, HEAD_D + 0.02, STEEL_DARK, 0, h - 0.01, HEAD_D / 2 + 0.005),
  ];
}

/** The screen's picture: the screensaver (logged out) or the kiosk's apps (logged in). */
function drawScreen(c: CanvasRenderingContext2D, on: boolean, lines: number, cursor: boolean, spot: number) {
  if (!on) {
    // A dim navy screen, the network's globe drifting from spot to spot, "touch to begin" under it.
    c.fillStyle = '#07111d';
    c.fillRect(0, 0, PX_W, PX_H);
    const x = [36, 88, 70, 46][spot % 4];
    const y = [34, 40, 58, 62][spot % 4];
    c.strokeStyle = '#2bb3a0';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(x, y, 12, 0, Math.PI * 2);
    c.moveTo(x - 12, y);
    c.lineTo(x + 12, y);
    c.stroke();
    c.beginPath();
    c.ellipse(x, y, 5, 12, 0, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = 'rgba(43,179,160,0.55)';
    c.fillRect(x - 14, y + 18, 28, 3);
    return;
  }
  // The title bar (the network's dots, a title, the time paid for), the four apps' tabs, the page.
  c.fillStyle = '#eef4f8';
  c.fillRect(0, 0, PX_W, PX_H);
  c.fillStyle = '#1f8a7a';
  c.fillRect(0, 0, PX_W, 13);
  c.fillStyle = '#ffffff';
  for (let k = 0; k < 3; k++) c.fillRect(4 + k * 5, 5, 3, 3);
  c.fillRect(24, 5, 40, 3);
  c.fillStyle = '#f2c94c';
  c.fillRect(108, 3, 16, 7);
  for (let k = 0; k < 4; k++) {
    const x = 2 + k * 31;
    c.fillStyle = k === 0 ? '#ffffff' : '#c6d6e2';
    c.fillRect(x, 15, 29, 11);
    c.strokeStyle = k === 0 ? '#1f8a7a' : '#5b7385';
    c.fillStyle = c.strokeStyle;
    c.lineWidth = 1.5;
    c.beginPath();
    const ix = x + 9;
    if (k === 0) {
      // Mail: an envelope.
      c.rect(ix, 17.5, 11, 7);
      c.moveTo(ix, 17.5);
      c.lineTo(ix + 5.5, 21.5);
      c.lineTo(ix + 11, 17.5);
    } else if (k === 1) {
      // The shop: a cart.
      c.moveTo(ix - 1, 17.5);
      c.lineTo(ix + 1, 17.5);
      c.lineTo(ix + 3, 22.5);
      c.lineTo(ix + 10, 22.5);
      c.lineTo(ix + 11, 19);
      c.lineTo(ix + 2, 19);
    } else if (k === 2) {
      // The news: a paper's columns.
      c.rect(ix, 17.5, 11, 7);
      c.moveTo(ix + 2, 20);
      c.lineTo(ix + 9, 20);
      c.moveTo(ix + 2, 22.5);
      c.lineTo(ix + 9, 22.5);
    } else {
      // Courses: a mortarboard.
      c.moveTo(ix - 1, 20);
      c.lineTo(ix + 5.5, 17);
      c.lineTo(ix + 12, 20);
      c.lineTo(ix + 5.5, 23);
      c.closePath();
    }
    c.stroke();
  }
  c.fillStyle = '#ffffff';
  c.fillRect(2, 27, 124, 67);
  let end = 0;
  let endY = 0;
  for (let k = 0; k < lines; k++) {
    const y = 33 + k * 9;
    c.fillStyle = k === 0 ? '#2b3a4a' : '#8fa0ae';
    c.fillRect(7, y, LINES[k], k === 0 ? 4 : 3);
    end = 7 + LINES[k];
    endY = y;
  }
  if (cursor) {
    c.fillStyle = '#1f8a7a';
    c.fillRect(end + 2, endY - 2, 3, 7);
  }
  // (Send: a teal button at the foot of the page.)
  c.fillStyle = '#1f8a7a';
  c.fillRect(96, 84, 26, 7);
}

// ------------------------------------------------------------------ the family's drawings

/** A drawing's paper (tiles; the canvas the same shape). */
const PAPER_W = 0.34;
const PAPER_H = 0.26;
/** The drawings over the bed: how far apart, how high on the wall (their middles), a little crooked each. */
const PAPER_GAP = 0.365;
const PAPER_Y = [0.96, 1.03, 0.95];
const PAPER_TILT = [-0.09, 0.05, -0.03];
/** The pins (red, blue, yellow) and the tape. */
const PIN = [0xd23b2e, 0x2f6fd1, 0xe8b828];
const TAPE = 0xe8dcb4;
/** Where the drawings go over a bed: the middle of the row on the wall's face, and the turn that faces them out from it. */
interface PhotoWall {
  x: number;
  z: number;
  angle: number;
}

/**
 * The wall the drawings are pinned to over the player's bed: the one its head is against if the
 * camera sees it (a north wall), else the nearest north wall over the bed, else the side wall at
 * its head (turned toward the camera, SIDE_TURN); a south wall the camera only sees the back of:
 * none.
 */
function photoWall(world: World): PhotoWall | null {
  const bed = world.cellBed[1];
  if (!bed) return null;
  const base = world.ground.base;
  const wall = (x: number, z: number) => x >= 0 && x < MAP_W && z >= 0 && z < MAP_H && TILE_INFO[base[z * MAP_W + x]].solid && TILE_INFO[base[z * MAP_W + x]].opaque;
  const cx = bed.x + bed.w / 2;
  const cz = bed.z + bed.d / 2;
  // (The pillow at the bed's -z end, turned by its rot: 0 north, 1 west, 2 south, 3 east.)
  const head = [13, 9, 5, 1][bed.rot & 3];
  // The north wall over the bed's tiles (the head's end first, when the head is north).
  for (let x = bed.x; x < bed.x + bed.w; x++) if (head === 13 && wall(x, bed.z - 1)) return { x: cx, z: bed.z, angle: 0 };
  for (let x = bed.x; x < bed.x + bed.w; x++) if (wall(x, bed.z - 1)) return { x: x + 0.5, z: bed.z, angle: 0 };
  // A side wall at the head, beside the pillow.
  if (head === 9 && wall(bed.x - 1, Math.floor(cz))) return { x: bed.x, z: cz, angle: Math.PI / 2 - SIDE_TURN };
  if (head === 1 && wall(bed.x + bed.w, Math.floor(cz))) return { x: bed.x + bed.w, z: cz, angle: -Math.PI / 2 + SIDE_TURN };
  return null;
}

/**
 * The internet kiosk (P35) in the picture: the terminal on its library wall (the screensaver
 * drifting while nobody's logged in; logged in, the apps up, a line typed in now and then, the
 * cursor blinking; glowing a little after dark) and the family's drawings pinned over the
 * player's bed. Built once per map from `def.comms` (none at the Training Block: no kiosk) and
 * the player's cell.
 */
export class KioskView {
  readonly group = new THREE.Group();
  private kiosk: THREE.Group | null = null;
  /**
   * The kiosk: its own see-through kit material. Hung on a side wall, it stands beside the player
   * at it, half of it south of them: cut only by a player more than 0.4 north of it (one behind the
   * wall, or a tile up along it), never by one at it.
   */
  private readonly kioskMat = seeThrough(kitMaterial.clone(), 0.6, -0.4);
  /** The screen: unlit, its picture a small canvas. */
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly screenTex: THREE.CanvasTexture;
  private readonly screenMat: THREE.MeshBasicMaterial;
  /** What the screen shows (redrawn only when this changes). */
  private shownKey = -1;
  /** A soft glow on the wall round the screen and a pool on the floor before it, after dark. */
  private readonly haloMat = seeThrough(new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x8fe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), 0.6, -0.4);
  private readonly poolMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x8fe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  /** The drawings over the bed: a sheet each (its picture swapped in), a pin or tape, the row on its wall. */
  private readonly photos = new THREE.Group();
  private readonly sheets: THREE.Mesh[] = [];
  private readonly sheetMats: THREE.MeshStandardMaterial[] = [];
  private readonly shownPhotos: number[] = [];
  /** The world the drawings hang in, and the wall tiles behind them (watched for a hole). */
  private photoWorld: World | null = null;
  private readonly photoTiles: number[] = [];
  private readonly paperGeo = new THREE.PlaneGeometry(PAPER_W, PAPER_H);

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = PX_W;
    this.canvas.height = PX_H;
    this.ctx = this.canvas.getContext('2d')!;
    // Redrawn a few times a second while logged in: no mipmaps to rebuild each time.
    const tex = (this.screenTex = canvasTexture(this.canvas, 'live'));
    this.screenMat = seeThrough(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), 0.6, -0.4);
    // The drawings: three sheets, each a pin (or a strip of tape) at its top; the sheets' material a plain lit paper, cut with the wall it's on.
    const pinMat = seeThrough(kitMaterial.clone());
    for (let k = 0; k < PHOTO_WALL; k++) {
      const mat = seeThrough(new THREE.MeshStandardMaterial({ roughness: 0.92, map: drawingTexture(0) }));
      const sheet = new THREE.Mesh(this.paperGeo, mat);
      sheet.receiveShadow = true;
      // (Tape across the top on the middle one, a pin in the others.)
      const fix = new THREE.Mesh(
        merge(k === 1 ? [box(0.1, 0.035, 0.004, TAPE, 0, PAPER_H / 2 - 0.022, 0.002)] : [disc(0.016, 0.012, PIN[k], 0, PAPER_H / 2 - 0.022, 0.008, 10)], false),
        pinMat,
      );
      sheet.add(fix);
      sheet.visible = false;
      this.sheets.push(sheet);
      this.sheetMats.push(mat);
      this.photos.add(sheet);
    }
    this.photos.visible = false;
    this.group.add(this.photos);
  }

  /** A prison: its kiosk on the library wall, the drawings' wall over the player's bed (none without a kiosk). */
  setWorld(world: World, later: Later = now) {
    const old = this.kiosk;
    if (old) {
      this.group.remove(old);
      later(() => old.traverse((m) => (m as THREE.Mesh).geometry?.dispose()));
    }
    this.kiosk = null;
    this.shownKey = -1;
    this.shownPhotos.length = 0;
    for (const s of this.sheets) s.visible = false;
    const k = kioskOf({ world });
    const at = k ? photoWall(world) : null;
    this.photos.visible = !!at;
    this.photoWorld = at ? world : null;
    this.photoTiles.length = 0;
    if (at) {
      this.photos.position.set(at.x, 0, at.z);
      this.photos.rotation.y = at.angle;
      // The wall tiles behind the row (a hole dug there, or the poster over one, takes them down).
      if (at.angle === 0) for (let x = Math.floor(at.x - 0.5); x <= Math.floor(at.x + 0.49); x++) this.photoTiles.push((at.z - 1) * MAP_W + x);
      else this.photoTiles.push(Math.floor(at.z) * MAP_W + (at.angle > 0 ? Math.round(at.x) - 1 : Math.round(at.x)));
    }
    if (!k) return;
    const g = new THREE.Group();
    const body = new THREE.Mesh(merge(bodyParts()), this.kioskMat);
    body.castShadow = true;
    body.receiveShadow = true;
    // The head: swung toward the camera about its south edge on a side wall, tipped back about its middle
    // (its top edge into the wall, out of sight: the screen's foot comes out less than about the top).
    const a = headingAngle(k.face);
    const side = k.face === 9 ? -1 : k.face === 1 ? 1 : 0;
    const swing = new THREE.Group();
    swing.position.set((side * HEAD_W) / 2, HEAD_Y0, 0);
    swing.rotation.y = side * SIDE_TURN;
    const tilt = new THREE.Group();
    tilt.position.set((-side * HEAD_W) / 2, (HEAD_Y1 - HEAD_Y0) / 2, 0);
    tilt.rotation.x = -TILT;
    const head = new THREE.Mesh(merge(headParts(), false), this.kioskMat);
    head.castShadow = true;
    head.position.y = -(HEAD_Y1 - HEAD_Y0) / 2;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), this.screenMat);
    screen.position.set(0, SCREEN_Y, HEAD_D + 0.011);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.8), this.haloMat);
    halo.position.set(0, SCREEN_Y, HEAD_D + 0.016);
    halo.renderOrder = 0.35;
    head.add(screen, halo);
    tilt.add(head);
    swing.add(tilt);
    // (The gap the tip opens under the head, between it and the wall: a steel block behind its lower half, up into it.)
    const backing = new THREE.Mesh(merge([box(HEAD_W - 0.04, (HEAD_Y1 - HEAD_Y0) / 2, 0.06, STEEL_DARK, 0, HEAD_Y0 + 0.01, 0.03)]), this.kioskMat);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.1).rotateX(-Math.PI / 2).translate(0, 0.012, 0.6), this.poolMat);
    pool.renderOrder = 0.33;
    g.add(body, backing, swing, pool);
    // On the wall the player faces: half a tile from their tile's middle that way, its front turned back to them.
    g.position.set(k.x + 0.5 + Math.sin(a) * 0.5, 0, k.z + 0.5 + Math.cos(a) * 0.5);
    g.rotation.y = a + Math.PI;
    this.kiosk = g;
    this.group.add(g);
  }

  /**
   * Per frame: the screen (logged in or the screensaver; still with reduced motion), its glow after
   * dark (`night` 0 day … 1 night; `power` the lights' level: a cut dims the screen to a ghost),
   * the drawings over the bed. `shown`: on a floor that sees them (not the tunnels).
   */
  update(f: KioskFrame | null, time: number, motion: boolean, night: number, power: number, shown: boolean) {
    this.group.visible = shown;
    this.setPhotos(f?.photos ?? null);
    // (Not on a wall dug through: a hole, its poster or a fake wall over it.)
    const w = this.photoWorld;
    if (w) {
      let whole = true;
      for (const i of this.photoTiles) if (w.ground.kind[i] !== w.ground.base[i]) whole = false;
      this.photos.visible = whole;
    }
    if (!this.kiosk) return;
    const on = !!f?.on;
    // Logged in: a line typed in at a time down the page, the cursor blinking after it, a pause on
    // the full page and again; logged out: the logo hopping round the screensaver.
    let key: number;
    if (on) {
      const page = LINES.length * LINE_SECS + PAGE_PAUSE;
      const lines = motion ? Math.min(LINES.length, 1 + Math.floor((time % page) / LINE_SECS)) : LINES.length;
      const cursor = !motion || (time * BLINK_HZ) % 1 < 0.55;
      key = 100 + lines * 2 + (cursor ? 1 : 0);
      if (key !== this.shownKey) drawScreen(this.ctx, true, lines, cursor, 0);
    } else {
      const spot = motion ? Math.floor(time / HOP_SECS) % 4 : 0;
      key = spot;
      if (key !== this.shownKey) drawScreen(this.ctx, false, 0, false, spot);
    }
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.screenTex.needsUpdate = true;
    }
    const lit = 0.15 + 0.85 * power;
    this.screenMat.color.setScalar((on ? 1 : 0.6) * lit);
    // After dark: a soft glow round it, brighter logged in (a pale wash by day only while logged in).
    this.haloMat.opacity = ((on ? 0.5 : 0.18) * night + (on ? 0.06 : 0)) * power;
    this.poolMat.opacity = (on ? 0.32 : 0.12) * night * power;
    this.haloMat.visible = this.haloMat.opacity > 0.005;
    this.poolMat.visible = this.poolMat.opacity > 0.005;
  }

  /** The drawings on the wall: a sheet for each (oldest on the left), the row centered over the bed (only when they change). */
  private setPhotos(list: readonly number[] | null) {
    const n = list ? Math.min(PHOTO_WALL, list.length) : 0;
    const from = list ? list.length - n : 0;
    const was = this.shownPhotos;
    let same = was.length === n;
    for (let k = 0; same && k < n; k++) same = was[k] === list![from + k];
    if (same) return;
    was.length = 0;
    for (let k = 0; k < PHOTO_WALL; k++) {
      const sheet = this.sheets[k];
      sheet.visible = k < n;
      if (k >= n) continue;
      const id = list![from + k];
      was.push(id);
      this.sheetMats[k].map = drawingTexture(id);
      // (Just off the wall's face, a little crooked, at their own heights.)
      sheet.position.set((k - (n - 1) / 2) * PAPER_GAP, PAPER_Y[k], 0.006);
      sheet.rotation.z = PAPER_TILT[k];
    }
  }
}
