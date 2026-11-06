import * as THREE from 'three';
import { DOING } from '../sim/systems/inmates';
import { kitMaterial, merge } from './kit';
import { type Look } from './look';
import { badgeTexture, type BadgeKind, koTexture, markTexture, sleepTexture } from './characterSprites';
import { activityPose, type Limbs, type Moves } from './characterPose';
import { instrumentGeometry, instruments, part } from './characterParts';
import { bodyMaterial, buildFigure, ghostSkin } from './characterBody';

/** Where a sleeper lies: the middle of the bed and the way its pillow points (radians). */
export interface BedPose {
  x: number;
  z: number;
  angle: number;
  /** A bed's unless given (2.29: a bench is lower): the height lain at, and how far the feet are from its middle. */
  top?: number;
  feet?: number;
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

/** At the internet kiosk (P35): drawn this far back from where they stand (tiles), so the screen shows over their head and the hands come down on the keyboard. */
const KIOSK_BACK = 0.22;

/** Scratch for a held cup kept upright (2.33). */
const UPRIGHT = new THREE.Quaternion();
const TIP = new THREE.Quaternion();
const TIP_E = new THREE.Euler();
/** Where a meal's tray is (2.25): nowhere, in both hands, on the table in front. */
export const TRAY_AT = { NONE: 0, HANDS: 1, TABLE: 2 } as const;
const TRAY_TABLE = new THREE.Vector3(0, 0.545, 0.74);
const TRAY_HANDS = new THREE.Vector3(0, 0.68, 0.44);
/** Where a tray comes from and goes back to: the counter's top ahead. */
const TRAY_COUNTER = new THREE.Vector3(0, 0.6, 0.86);
/** The food on a tray: size, colour, place on it. */
const TRAY_FOOD: ReadonlyArray<readonly [number, number, number, number, number, number, number]> = [
  [0.12, 0.05, 0.1, 0xe8d9a8, -0.08, 0.035, 0.02],
  [0.1, 0.04, 0.1, 0x8a5a3a, 0.09, 0.03, 0.05],
  [0.1, 0.03, 0.08, 0x6aa84f, 0.05, 0.025, -0.06],
];

/** Mattress height and how far the sleeper's feet sit from the bed's middle. */
export const BED_TOP = 0.6;
export const BED_FEET = 0.55;

/** The towels after the showers (2.26; the shorts are characterBody.ts's). */
const TOWEL = 0xf0f1ec;
const TOWEL_EDGE = 0xc9d4de;

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
  private readonly tray = new THREE.Group();
  /** Where the tray is, before a walk's bob. */
  private readonly trayBase = new THREE.Vector3();
  private readonly food: THREE.Mesh[] = [];
  private readonly spoon: THREE.Mesh;
  private trayAt: number = TRAY_AT.NONE;
  private trayLeft = 1;
  /** How far the arms are out holding a tray (0–1). */
  private carry = 0;
  /** P30: talent night's instruments: two upturned buckets and the sticks in the hands, or a guitar slung in front. */
  private readonly buckets: THREE.Mesh;
  private readonly sticks: THREE.Mesh[] = [];
  private readonly guitar: THREE.Mesh;
  /** On the pay phone (P34): the handset at the ear, in the left hand. */
  private readonly handset: THREE.Mesh;
  /** The same bones in shorts (2.26): the body drawn in place of the dressed one. Guards never wash. */
  private dressed!: THREE.SkinnedMesh;
  private washBody: THREE.SkinnedMesh | null = null;
  private washSkeleton: THREE.Skeleton | null = null;
  private readonly towelNeck: THREE.Mesh;
  private readonly towelHead: THREE.Mesh;
  /** Where this one is in hair, soap and rinse. */
  private readonly washSeed = Math.random() * 3;
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
  private pumps = 0;
  /** 2.29: 0 standing … 1 on hands and toes on a mat; on a bench, not in bed (no blanket, eyes open). */
  private prone = 0;
  private benching = false;
  /** The silhouette material (the player only). */
  private ghost: THREE.MeshBasicMaterial | null = null;
  /** Down to shorts, for the showers (2.26; only how they look: the outfit they wear doesn't change). */
  undressed = false;
  /** A towel (2.26): 0 none, 1 round the neck, 2 over the head, being rubbed dry. */
  towel = 0;
  /** Standing straight for the warden, at roll call (2.27). */
  attention = false;
  private clipboard: THREE.Mesh | null = null;
  /** The item in the right hand (its model), and which item it is. */
  private held: THREE.Mesh | null = null;
  private heldItem = 0;
  private readonly at = new THREE.Vector3();
  /** The pose being built (the walk, then the activity's, `activityPose`), and what the activity reads and keeps. */
  private readonly limbs: Limbs = { legL: 0, legR: 0, armLx: 0, armRx: 0, armLz: 0, armRz: 0, legZ: 0, bob: 0, bend: 0 };
  private readonly moves: Moves = {
    dt: 0,
    t: 0,
    a: 0,
    motion: true,
    moving: false,
    ko: false,
    act: 0,
    lie: 0,
    phase: 0,
    swing: 0,
    pumped: 0,
    pumps: 0,
    washSeed: 0,
    attention: false,
    strain: 0,
    shudder: false,
    diceShake: false,
    straight: 0,
    headBack: 0,
    strainNow: 0,
    sip: 0,
  };
  private readonly bedAt = new THREE.Vector3();

  constructor(look: Look) {
    this.material =
      look.silhouette !== undefined
        ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, ...STENCIL_MARK })
        : bodyMaterial;
    const fig = buildFigure(
      look,
      { body: this.body, head: this.head, eyes: this.eyes, armL: this.armL, armR: this.armR, legL: this.legL, legR: this.legR },
      this.root,
      this.material,
    );
    this.dressed = fig.dressed;
    this.skeleton = fig.dressed.skeleton;
    this.washBody = fig.washBody;
    this.washSkeleton = fig.washBody?.skeleton ?? null;
    this.keyTag = fig.keyTag;
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
    // A meal's tray (2.25): carried in both hands, or on the table in front; its food goes bite by bite.
    // (Of the body's own material: the player's silhouette mustn't read it as a wall in front of them.)
    const trayBoard = new THREE.Mesh(
      merge([part(0.38, 0.03, 0.28, 0x9aa3ad, 0, 0, 0), part(0.2, 0.012, 0.17, 0xe6e8ea, -0.06, 0.02, 0.01)], false),
      this.material,
    );
    trayBoard.castShadow = true;
    this.tray.add(trayBoard);
    for (const [w, h, d, color, x, y, z] of TRAY_FOOD) {
      const food = new THREE.Mesh(merge([part(w, h, d, color, 0, 0, 0)], false), this.material);
      food.position.set(x, y, z);
      this.food.push(food);
      this.tray.add(food);
    }
    this.tray.visible = false;
    this.root.add(this.tray);
    // A spoon in the right fist over the tray.
    this.spoon = new THREE.Mesh(
      merge([part(0.022, 0.018, 0.2, 0xc9ced4, 0, 0, 0.08), part(0.05, 0.022, 0.06, 0xc9ced4, 0, 0, 0.2)], false),
      this.material,
    );
    this.spoon.position.set(0, -0.44, 0.04);
    this.spoon.visible = false;
    this.armR.add(this.spoon);
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
    // A towel (2.26), in the body's own material like the tray: round the neck with its ends down the front, or over the hair.
    this.towelNeck = new THREE.Mesh(
      merge(
        [
          part(0.56, 0.07, 0.34, TOWEL, 0, 0.82, 0),
          part(0.11, 0.3, 0.03, TOWEL, -0.14, 0.66, 0.165),
          part(0.11, 0.3, 0.03, TOWEL, 0.14, 0.66, 0.165),
          part(0.11, 0.03, 0.035, TOWEL_EDGE, -0.14, 0.53, 0.165),
          part(0.11, 0.03, 0.035, TOWEL_EDGE, 0.14, 0.53, 0.165),
        ],
        false,
      ),
      this.material,
    );
    this.towelNeck.castShadow = true;
    this.towelNeck.visible = false;
    this.body.add(this.towelNeck);
    this.towelHead = new THREE.Mesh(
      merge(
        [
          part(0.56, 0.13, 0.54, TOWEL, 0, 0.5, -0.01),
          part(0.56, 0.24, 0.1, TOWEL, 0, 0.32, -0.25),
          part(0.07, 0.24, 0.4, TOWEL, -0.27, 0.34, -0.03),
          part(0.07, 0.24, 0.4, TOWEL, 0.27, 0.34, -0.03),
        ],
        false,
      ),
      this.material,
    );
    this.towelHead.castShadow = true;
    // A guard's clipboard, for the count (2.27).
    if (look.cap !== undefined) {
      this.clipboard = new THREE.Mesh(
        merge(
          [
            part(0.24, 0.3, 0.025, 0x8a5a2b, 0, 0, 0),
            part(0.2, 0.25, 0.012, 0xf2f2ee, 0, -0.01, 0.018),
            part(0.08, 0.03, 0.03, 0x3a3f47, 0, 0.14, 0.018),
          ],
          false,
        ),
        this.material,
      );
      this.clipboard.position.set(-0.08, 0.66, 0.26);
      this.clipboard.rotation.x = -0.5;
      this.clipboard.castShadow = true;
      this.clipboard.visible = false;
      this.body.add(this.clipboard);
    }
    this.towelHead.visible = false;
    this.head.add(this.towelHead);
  }

  /** Where this meal's tray is (TRAY_AT), and how much food is left on it (0–1): set before `pose`. */
  trayPose(at: number, left: number) {
    this.trayAt = at;
    if (left === this.trayLeft) return;
    this.trayLeft = left;
    for (const f of this.food) {
      f.visible = left > 0.02;
      f.scale.setScalar(Math.max(0.02, left));
    }
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

  /** A training rep: the arms pump once (2.29: at the bag, the other fist each time). */
  pump() {
    this.pumped = 1;
    this.pumps++;
  }

  /** How far through a rep the arms are, 1 at its height (2.29: the bar goes with them). */
  get pressed(): number {
    return this.pumped;
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
  pose(
    x: number,
    z: number,
    facing: number,
    moving: boolean,
    dt: number,
    time: number,
    motion = true,
    doing: number = DOING.NOTHING,
    bed?: BedPose,
  ): boolean {
    const k = (rate: number) => Math.min(1, dt * rate);
    // Into bed and out of it: a short ease between standing beside it and lying in it.
    // Knocked out: down on the floor where they stand, quicker.
    const ko = doing === DOING.KNOCKED_OUT;
    this.lie += (((doing === DOING.SLEEP && bed) || (doing === DOING.BENCH && bed) || ko ? 1 : 0) - this.lie) * k(ko ? 9 : 5);
    // (2.29: on a mat, on hands and toes.)
    this.prone += ((doing === DOING.PUSHUP ? 1 : 0) - this.prone) * k(8);
    if (this.prone < 0.002) this.prone = 0;
    this.benching = doing === DOING.BENCH;
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
      const feet = bed.feet ?? BED_FEET;
      this.bedAt.set(bed.x + Math.sin(bed.angle) * feet, bed.top ?? BED_TOP, bed.z + Math.cos(bed.angle) * feet);
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
    const l = this.limbs;
    l.legL = s;
    l.legR = -s;
    // (A rat perched on the left shoulder, P20: that arm holds still while walking.)
    l.armLx = this.perched ? 0 : -s * (0.85 + 0.25 * running);
    l.armRx = s * (0.85 + 0.25 * running);
    l.armLz = 0;
    l.armRz = 0;
    l.legZ = 0;
    l.bob =
      Math.abs(Math.cos(this.phase)) * (0.045 + 0.04 * running) * this.swing +
      (motion ? Math.sin(time * 2.2 + this.offset) * 0.006 * (1 - this.swing) : 0);

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
    l.legL -= sit * 1.45;
    l.legR -= sit * 1.45;
    l.bob -= sit * 0.06;
    l.bend = 0;
    const m = this.moves;
    m.dt = dt;
    m.t = t;
    m.a = a;
    m.motion = motion;
    m.moving = moving;
    m.ko = ko;
    m.act = this.act;
    m.lie = this.lie;
    m.phase = this.phase;
    m.swing = this.swing;
    m.pumped = this.pumped;
    m.pumps = this.pumps;
    m.washSeed = this.washSeed;
    m.attention = this.attention;
    m.strain = this.strain;
    m.shudder = this.shudder;
    m.diceShake = this.diceShake;
    activityPose(doing, l, m);
    // Dozing on its feet (P15): arms folded across the chest, a slouch and a sway (the chin
    // sinks and jerks back up, below). Eased by its own weight so waking unfolds them.
    const dz = this.doze * this.doze * (3 - 2 * this.doze);
    if (dz > 0) {
      l.armLx += -0.95 * dz;
      l.armRx += -0.95 * dz;
      l.armLz += 0.55 * dz;
      l.armRz -= 0.55 * dz;
      l.bob -= 0.025 * dz;
    }
    // The activity's own lean (bent to a desk, a lock, the dice, a scrap).
    let lean =
      l.bend +
      (doing === DOING.SEARCH ? 0.35 * this.act : 0) +
      (doing === DOING.READ ? 0.12 * this.act : 0) +
      (doing === DOING.WRESTLE ? (0.12 + this.moves.strainNow * 0.1) * this.act : 0) +
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
      l.legL = f[0] + (l.legL - f[0]) * b;
      l.legR = f[1] + (l.legR - f[1]) * b;
      l.armLx = f[2] + (l.armLx - f[2]) * b;
      l.armLz = f[3] + (l.armLz - f[3]) * b;
      l.armRx = f[4] + (l.armRx - f[4]) * b;
      l.armRz = f[5] + (l.armRz - f[5]) * b;
      l.bob = f[6] + (l.bob - f[6]) * b;
      lean = f[7] + (lean - f[7]) * b;
    }
    this.lastBob = l.bob;
    this.lastLean = lean;
    // A strike: the tool arm up and down hard.
    if (this.hit > 0) {
      const h = this.hit;
      l.armRx = h > 0.6 ? -2.6 * ((1 - h) / 0.4) : -2.6 * (h / 0.6) - 0.3 * (1 - h / 0.6);
      l.armLx = Math.min(l.armLx, -0.5 * h);
    }
    // A punch: the right arm drawn back, then thrown straight out; the left guards the face.
    // Both hands on the tray, or reaching over the counter for one (2.25): the walk's swing gives way.
    this.carry += ((this.trayAt === TRAY_AT.HANDS ? 1 : 0) - this.carry) * k(10);
    const reach = Math.max(this.carry, doing === DOING.SERVE ? this.act : 0);
    if (reach > 0.01 && !ko) {
      l.armLx += (-1.2 - l.armLx) * reach;
      l.armRx += (-1.2 - l.armRx) * reach;
      l.armLz += (0.26 - l.armLz) * reach;
      l.armRz += (-0.26 - l.armRz) * reach;
    }
    if (this.jab > 0) {
      const j = this.jab;
      // Out at the blow (the event fires as it lands), held a moment, then eased home.
      const out = Math.min(1, j * 1.6);
      l.armRx = -1.7 * out * out * (3 - 2 * out);
      l.armLx = Math.min(l.armLx, -1.1 * Math.min(1, j * 2));
      l.armLz = -0.25 * j;
    }
    this.legL.rotation.set(l.legL, 0, -l.legZ);
    this.legR.rotation.set(l.legR, 0, l.legZ);
    this.armL.rotation.set(l.armLx, 0, l.armLz);
    this.armR.rotation.set(l.armRx, 0, l.armRz);
    // (2.33: a cup or a can at the mouth, or a snack, stays upright in the fist whatever the arm does, tipped toward the
    // lips for a sip; anything else points forward out of the fist as the arm carries it.)
    if (this.held) {
      if (doing === DOING.DRINK || doing === DOING.SNACK) {
        UPRIGHT.copy(this.armR.quaternion).invert();
        TIP.setFromEuler(TIP_E.set(doing === DOING.DRINK ? -0.25 - 0.55 * this.moves.sip : -0.2, -Math.PI / 2, 0));
        this.held.quaternion.copy(UPRIGHT).multiply(TIP);
        this.held.position.set(0, -0.46, 0.03);
      } else {
        this.held.rotation.set(0, -Math.PI / 2, 0);
        this.held.position.set(0, -0.44, 0.16);
      }
    }
    // A bob and a little forward lean while walking, a slow breath while standing; flat in bed.
    this.body.position.y =
      l.bob * (1 - this.lie) + this.crawl * 0.12 + 0.07 * Math.sin(this.startle * Math.PI) + this.prone * (0.08 + this.pumped * 0.14);
    // (In line for the phone, P34: a slow shift of the weight from foot to foot.)
    const shift = doing === DOING.QUEUE && motion ? Math.sin(t * 0.55) * 0.04 * this.act : 0;
    this.body.rotation.z = (motion ? Math.sin(t * 0.7) * 0.06 * dz : 0) + shift;
    this.body.rotation.x =
      0.08 * this.swing -
      (Math.PI / 2) * this.lie +
      lean +
      (Math.PI / 2) * 0.92 * this.crawl +
      (Math.PI / 2) * 0.86 * this.prone +
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
    this.blanket.visible = this.lie > 0.6 && !ko && !this.benching;
    this.blanket.scale.z = THREE.MathUtils.smoothstep(this.lie, 0.6, 1);
    const nap = !ko && this.lie < 0.1 && this.doze > 0.3;
    this.zs.forEach((z, i) => {
      z.visible = (this.lie > 0.9 && !ko && !this.benching) || nap;
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
    // The tray: lifted off the counter into the hands, eased onto the table and back, and handed over the counter again.
    const handsTray = this.trayAt === TRAY_AT.HANDS;
    if (this.trayAt !== TRAY_AT.NONE) {
      if (this.tray.visible) this.trayBase.lerp(handsTray ? TRAY_HANDS : TRAY_TABLE, motion ? k(10) : 1);
      else if (handsTray) this.trayBase.copy(motion ? TRAY_COUNTER : TRAY_HANDS);
      else this.trayBase.copy(TRAY_TABLE);
      this.tray.visible = handsTray || this.tray.visible || this.act > 0.3;
    } else if (this.tray.visible) {
      this.trayBase.lerp(TRAY_COUNTER, motion ? k(14) : 1);
      if (this.trayBase.distanceToSquared(TRAY_COUNTER) < 0.004) this.tray.visible = false;
    }
    this.tray.position.copy(this.trayBase);
    if (handsTray) this.tray.position.y += l.bob * 0.5;
    this.spoon.visible = doing === DOING.EAT && this.act > 0.3;
    const drums = doing === DOING.DRUMS && this.act > 0.3;
    this.buckets.visible = drums;
    for (const st of this.sticks) st.visible = drums;
    this.guitar.visible = doing === DOING.GUITAR && this.act > 0.3;
    this.handset.visible = doing === DOING.PHONE && this.act > 0.3;
    const shorts = this.undressed && this.washBody !== null;
    this.dressed.visible = !shorts;
    if (this.washBody) this.washBody.visible = shorts;
    this.towelNeck.visible = this.towel === 1;
    this.towelHead.visible = this.towel === 2;
    if (this.clipboard) this.clipboard.visible = doing === DOING.COUNT && !moving && this.act > 0.2;

    // Blink every few seconds; eyes shut in bed.
    this.blinkAt -= dt;
    // Dozing: shut, fluttering as it stirs; wide for a moment on waking with a start.
    const flutter = this.stir > 0.4 && (t * 12) % 1 < 0.3;
    const closed = this.blinkAt < 0.12 || (this.lie > 0.5 && !ko && !this.benching) || (this.doze > 0.6 && !flutter);
    if (this.blinkAt < 0) this.blinkAt = 2 + Math.random() * 3.5;
    this.eyes.scale.y = closed ? 0.15 : 1 + 0.5 * this.startle;

    // Standing still for a while: glance around now and then (not in line, nor asleep).
    this.idle = moving ? 0 : this.idle + dt;
    // (In line for the phone, P34, they look about as they wait.)
    const still =
      doing === DOING.CRAWL ||
      doing === DOING.LINE_UP ||
      doing === DOING.SLEEP ||
      doing === DOING.EXERCISE ||
      doing === DOING.SEARCH ||
      (doing >= DOING.WORK && doing !== DOING.QUEUE) ||
      ko;
    if (this.idle > 2.5 && motion && !still && Math.random() < dt * 0.6)
      this.glanceGoal = (Math.random() - 0.5) * (this.perched ? PERCHED_GLANCE * 2 : 1.1);
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
      this.recoil > 0
        ? -0.35 * Math.sin(this.recoil * Math.PI)
        : doing === DOING.READ
          ? 0.3 * this.act
          : doing === DOING.SHOWER || doing === DOING.LINE_UP
            ? -0.4 * this.moves.headBack
            : doing === DOING.TOWEL
              ? 0.25 * this.act
              : nod * dz * (1 - 0.7 * this.stir) - 0.25 * this.startle;
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
      const shared = instrumentGeometry(m.geometry);
      if (o !== this.held && !shared) m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) if (mat !== kitMaterial && mat !== bodyMaterial) mat.dispose();
    });
    // (The bones' matrices live in a small texture per character.)
    this.skeleton.dispose();
    this.washSkeleton?.dispose();
  }
}
