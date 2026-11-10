import * as THREE from 'three';
import { DOING } from '../sim/systems/inmates';
import { kitMaterial, merge } from './kit';
import { type Look } from './look';
import { glowTexture } from './lights';
import { badgeTexture, type BadgeKind, koTexture, markTexture, NOTICE_LEVELS, noticeTexture, sleepTexture } from './characterSprites';
import { activityPose, type Limbs, type Moves } from './characterPose';
import { instrumentGeometry, instruments, part } from './characterParts';
import { bodyMaterial, buildFigure, ghostSkin } from './characterBody';
import {
  cutOf,
  FIDGET,
  idlePose,
  type Idle,
  type IdleExtra,
  nextFidget,
  runOf,
  strideTurn,
  type Style,
  styleFor,
  SWING,
  SWING_RUN,
} from './characterMotion';
import { GRIP, GRIP_SCALE, gripOf, POLE_ONE_HAND, POLE_TWO_HANDS } from './characterGrip';
import { hash01, seeded } from './rand';
import { itemDef } from '../content/items';

/** 2.36: the top of each haircut (characterBody.ts: short, buzz cut, bald, tall top, mohawk's shaved top, curls, ponytail), where a gang's head wrap sits. */
const WRAP_TOP: readonly number[] = [0.52, 0.47, 0.445, 0.64, 0.47, 0.6, 0.52];

/** A colour darkened (k < 1) for a knot's shadow side. */
const shade = (c: number, k: number) =>
  (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k);

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

/**
 * On the pay phone (2.42): drawn this far along its wall from where they stand (tiles), beside it rather than in front
 * (`phoneSide`), this far in toward the wall, their back to it and turned this much toward the phone (radians).
 */
const PHONE_SIDE = 0.6;
const PHONE_IN = 0.16;
const PHONE_TWIST = 0.45;

/** At the internet kiosk (P35): drawn this far back from where they stand (tiles), so the screen shows over their head and the hands come down on the keyboard. */
const KIOSK_BACK = 0.22;
/**
 * 2.42: at a kiosk on a north wall (`kioskSide`), drawn this far to one side instead (tiles) and turned this much
 * toward it (radians): from this camera, standing square in front of it, their head hid the screen.
 */
const KIOSK_SIDE = 0.34;
const KIOSK_TWIST = 0.55;

/** Scratch for a held cup kept upright (2.33), and for a held item placed (session 15). */
const UPRIGHT = new THREE.Quaternion();
const TIP = new THREE.Quaternion();
const TIP_E = new THREE.Euler();
const SWEEP_E = new THREE.Euler(0, 0, 0, 'YXZ');
const HAND_L = new THREE.Vector3();
const HAND_R = new THREE.Vector3();
const GRIP_AT = new THREE.Vector3();
/** The fist, in an arm's frame (where a held thing is gripped). */
const FIST = new THREE.Vector3(0, -0.42, 0.03);
/** A mop or broom held at the side: its head down by the feet, a little ahead (the handle back over the shoulder). */
const POLE_DOWN = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0, -Math.PI / 2));
/** A book stood on its edge in the fist: its length forward, its face to the side, its width down. */
const FLAT_SIDE = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)),
);
/** Mopping, sweeping (session 15): the handle down and ahead from the hands at this angle below level (radians). */
const POLE_SWEEP = 0.95;
/** A new thing in the hand grows into it, the last shrinks away, over this long (s). */
const HELD_SWAP = 0.14;
/**
 * A blend between poses (session 15): a fifth of a second for a small change, longer for a big one, so no limb
 * goes faster than about this (radians a second at the blend's steepest): an arm down from overhead takes half a second.
 */
const BLEND_RATE = 5;
const BLEND_FAR = 1;
/** Knocked out (session 15): the fall to the floor takes this long (s). */
const KO_FALL = 0.4;
/** Standing about this long (s) before settling into a stance. */
const SETTLE = 1.2;
/** At a blow or a strike, the arm takes over within this much of it, and gives back over the end. */
const BLOW_IN = 0.08;
const BLOW_OUT = 0.22;
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
  /** Session 15: how it walks and stands (from its number), its own random numbers, where it was last frame (the stride follows the ground covered). */
  private readonly style: Style;
  private readonly guard: boolean;
  /** 2.36: the top of the haircut, where a gang's head wrap sits (-1: under a hat, none). */
  private readonly wrapTop: number;
  private readonly roll: () => number;
  /** (The fidgets' own: what a glance or a blink draws never changes which fidget comes next.) */
  private readonly fidgetRoll: () => number;
  private lastX = NaN;
  private lastZ = NaN;
  /** Settled into its stance, standing about (0–1), its fidgets, and what they do to the head and the body. */
  private rest = 0;
  private readonly fidget: Idle = { kind: FIDGET.NONE, at: 0, next: 4, side: 1 };
  private readonly extra: IdleExtra = { headY: 0, headX: 0, headZ: 0, roll: 0, hip: 0 };
  /** Off its spot on the pay phone and at the kiosk (eased both ways: the step back is never a jump). */
  private phoneOff = 0;
  private kioskOff = 0;
  /** 0 standing … 1 lying in bed; and how far into the current activity. */
  private lie = 0;
  /** A knockout's fall (0 … 1 on the floor), and how far down they were when it began. */
  private koFall = 0;
  private koFrom = 0;
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
  /** 2.35: the block held (from the frame), and its forearms raised (eased); a blow's white flash (made at the first). */
  blocking = false;
  private guardUp = 0;
  private flash = 0;
  private flashSprite: THREE.Sprite | null = null;
  /** The key on a guard's belt (a bone: scaled to nothing once taken). */
  private readonly keyTag: THREE.Bone | null = null;
  /** The floor's height under the character (vents and roofs stand above the ground floor). */
  baseY = 0;
  private act = 0;
  private actKind: number = DOING.NOTHING;
  /**
   * On a change of activity (P23 review), or setting off from one (session 15): the limbs as they were (legs, left arm
   * x/z, right arm x/z, height, lean, the legs apart, the head's nod, and a fidget's look, roll of the neck, hips and
   * shoulders), blended away over a fifth of a second (longer for a bigger change).
   */
  private readonly from = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  private blend = 1;
  private blendRate = BLEND_RATE;
  private wasMoving = false;
  /** How much of a run it's going at (eased: a jogger stalling for a step doesn't snap to a walk). */
  private runNow = 0;
  /** Last frame's height, lean and nod from the activity (the blend's starting point for them). */
  private lastBob = 0;
  private lastLean = 0;
  private lastNod = 0;
  private readonly offset: number;
  /** Walking pace against the player's: legs swing faster for faster walkers (guards running). */
  gait: number;
  /** Session 15: game seconds a real second (the frame's `speed`: a replay's ×4, a knockout's time-lapse), set before `pose`. */
  timeScale = 1;
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
  /** On the pay phone (P34): the handset at the ear, in the hand on the phone's side (2.42: the right one where `phoneSide` is 1). */
  private readonly handset: THREE.Mesh;
  private readonly handsetR: THREE.Mesh;
  /** 2.42: which side of the pay phone they stand on while on it (render/Phone.ts phoneSide): -1 the left hand to the ear, 1 the right. */
  phoneSide: 1 | -1 = -1;
  /** 2.42: at a kiosk on a north wall, which side of it they're drawn on (1 or -1); 0 square in front (a side wall's). */
  kioskSide: -1 | 0 | 1 = 0;
  /** The same bones in shorts (2.26): the body drawn in place of the dressed one. Guards never wash. */
  private dressed!: THREE.SkinnedMesh;
  private washBody: THREE.SkinnedMesh | null = null;
  private washSkeleton: THREE.Skeleton | null = null;
  private readonly towelNeck: THREE.Mesh;
  private readonly towelHead: THREE.Mesh;
  /** Where this one is in hair, soap and rinse. */
  private readonly washSeed: number;
  private readonly zs: THREE.Sprite[] = [];
  private readonly stars: THREE.Sprite[] = [];
  /** The "!" or "?" over the head, its character, and how long it has shown. */
  private readonly markSprite: THREE.Sprite;
  private markShown = '';
  private markAge = 0;
  private markLevel = 0;
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
  /** The item in the right hand (its model), which item it is, how it's held (GRIP), and how far it has grown into the hand (0–1). */
  private held: THREE.Mesh | null = null;
  private heldItem = 0;
  private grip: number = GRIP.FIST;
  private heldIn = 1;
  /** The last thing held, shrinking away (session 15), and how far it has to go (1 … 0). */
  private dropping: THREE.Mesh | null = null;
  private dropLeft = 0;
  private dropScale = 1;
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

  /** `seed`: the character's own number (its place in the cast): how it walks and stands, the same every time. */
  constructor(look: Look, seed = 0) {
    this.guard = look.cap !== undefined;
    // (2.36: where a gang's head wrap sits, over the haircut; none under a hat or a cap.)
    const hatted = !!look.hat || look.cap !== undefined || !!look.riot;
    this.wrapTop = hatted ? -1 : (WRAP_TOP[look.hairStyle ?? 0] ?? 0.52);
    this.style = styleFor(seed, this.guard);
    this.roll = seeded(Math.floor(hash01(seed + 7, 3) * 4294967296));
    this.fidgetRoll = seeded(Math.floor(hash01(seed + 7, 5) * 4294967296));
    this.offset = this.style.offset;
    this.washSeed = hash01(seed + 7, 4) * 3;
    this.phase = this.style.phase0;
    this.blinkAt = 2 + this.roll() * 3.5;
    this.fidget.next = 2 + this.fidgetRoll() * this.style.every;
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
    this.handsetR = new THREE.Mesh(instruments().handset, kitMaterial);
    this.handsetR.visible = false;
    this.handsetR.scale.x = -1;
    this.armR.add(this.handsetR);
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

  /** 2.36: the gang's colours worn (a bandana tied over the head; under a hat, round the neck), their colour; 0 none. */
  private coloursOn = 0;
  private bandana: THREE.Mesh | null = null;
  private wrap: THREE.Mesh | null = null;

  /**
   * 2.36, gangs: the colours of a gang (0: none), one mesh: a bandana tied over the head (what the steep camera sees
   * best), or under a hat round the neck. In the body's own material, as the towel (the player's see-through silhouette
   * mustn't read it as a wall); made the first time, made again only when the colour changes.
   */
  colours(color: number) {
    if (color === this.coloursOn) return;
    this.coloursOn = color;
    for (const m of [this.bandana, this.wrap]) {
      m?.removeFromParent();
      m?.geometry.dispose();
    }
    this.bandana = this.wrap = null;
    if (!color) return;
    const knot = shade(color, 0.72);
    // A bandana tied over the head (what the steep camera sees best), its knot's tails at the back; under a hat, none.
    if (this.wrapTop > 0) {
      const top = this.wrapTop;
      this.wrap = new THREE.Mesh(
        merge(
          [
            part(0.5, 0.06, 0.49, color, 0, top + 0.03, -0.005),
            part(0.5, 0.1, 0.03, color, 0, top - 0.03, 0.235),
            part(0.03, 0.1, 0.49, color, -0.245, top - 0.03, -0.005),
            part(0.03, 0.1, 0.49, color, 0.245, top - 0.03, -0.005),
            part(0.14, 0.08, 0.05, knot, 0, top - 0.04, -0.26),
            part(0.05, 0.16, 0.03, knot, -0.04, top - 0.14, -0.27),
            part(0.05, 0.13, 0.03, knot, 0.04, top - 0.13, -0.27),
          ],
          false,
        ),
        this.material,
      );
      this.wrap.castShadow = true;
      this.head.add(this.wrap);
      return;
    }
    // (Under a hat: a bandana knotted round the neck instead, its point down the front.)
    this.bandana = new THREE.Mesh(
      merge(
        [
          part(0.4, 0.06, 0.3, color, 0, 0.83, 0),
          part(0.24, 0.09, 0.03, color, 0, 0.75, 0.155),
          part(0.12, 0.08, 0.03, color, 0, 0.67, 0.155),
          part(0.08, 0.06, 0.05, knot, 0, 0.84, -0.16),
        ],
        false,
      ),
      this.material,
    );
    this.bandana.castShadow = true;
    this.body.add(this.bandana);
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
   * Puts an item in the right hand (0: empty-handed), held as its model asks (characterGrip.ts: out of
   * the fist, upright, by a handle, in both hands, by its edge). Session 15: it grows into the hand, and
   * the last one shrinks away (both at once with reduced motion, `pose`).
   */
  hold(item: number, geometry: THREE.BufferGeometry | null) {
    if (item === this.heldItem) return;
    this.heldItem = item;
    if (this.dropping) this.dropping.removeFromParent();
    this.dropping = this.held;
    this.dropLeft = this.held ? 1 : 0;
    this.dropScale = this.held ? this.held.scale.x : 1;
    this.held = null;
    if (!item || !geometry) return;
    // (The player's in the body's own material, as the tray is: carried in front, the see-through silhouette would read it as a
    // wall and tint it over the belly.)
    const m = new THREE.Mesh(geometry, this.ghost ? this.material : kitMaterial);
    m.castShadow = true;
    this.grip = gripOf(itemDef(item).shape);
    // Long axis forward (+z), gripped near its back end (placed each frame, `placeHeld`).
    m.rotation.set(0, -Math.PI / 2, 0);
    m.position.set(0, -0.44, 0.16);
    m.scale.setScalar(0.001);
    this.heldIn = 0;
    this.held = m;
    this.armR.add(m);
  }

  /**
   * Shows "!" or "?" over the head ('' hides it): it pops in, bobs, and shrinks away after
   * a couple of seconds (the alert is in the cone's color from then on). A "$" (bribed, P15)
   * settles small and stays, out of the way of a doze's Z's.
   */
  mark(ch: string, dt: number, motion: boolean, fill = 0) {
    // (2.35: a "?" filling while the guard makes sure: shown as long as it fills, its disc rising.)
    const level = ch === '?' && fill > 0 ? Math.max(1, Math.ceil(fill * NOTICE_LEVELS)) : 0;
    if (ch !== this.markShown || level !== this.markLevel) {
      if (ch !== this.markShown) this.markAge = 0;
      this.markShown = ch;
      this.markLevel = level;
      if (ch) this.markSprite.material.map = level ? noticeTexture(level) : markTexture(ch);
      this.markSprite.material.needsUpdate = true;
    }
    this.markAge += dt;
    const keep = ch === '$';
    const show = !!ch && (this.markAge < 2.2 || keep || level > 0) && !(keep && this.doze > 0.3);
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
    // (A filling "?" stays as long as it fills: no shrinking away, 2.35.)
    const out = t > 1.9 && !level ? 1 - (t - 1.9) / 0.3 : 1;
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
    // (Session 15: someone trading blows isn't standing about: no stance between them.)
    this.idle = 0;
  }

  /** A blow at someone: the arm thrown forward (a weapon in hand swings it). */
  punch() {
    this.jab = 1;
    this.idle = 0;
  }

  /** Hit: a jolt back, and a white flash (2.35). */
  flinch() {
    this.recoil = 1;
    this.flash = 1;
    this.idle = 0;
    if (!this.flashSprite) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture(),
          color: 0xffffff,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      s.position.set(0, 1.05, 0.1);
      s.renderOrder = 28;
      this.root.add(s);
      this.flashSprite = s;
    }
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
    // (Session 15: knocked out, a fall: eased from where they were down to the floor over KO_FALL, not an exponential
    // drop; at once with reduced motion.)
    if (ko) {
      if (this.koFall === 0) this.koFrom = this.lie;
      this.koFall = motion ? Math.min(1, this.koFall + dt / KO_FALL) : 1;
      const e = this.koFall * this.koFall * (3 - 2 * this.koFall);
      this.lie = this.koFrom + (1 - this.koFrom) * e;
    } else {
      this.koFall = 0;
      this.lie += (((doing === DOING.SLEEP && bed) || (doing === DOING.BENCH && bed) ? 1 : 0) - this.lie) * k(5);
    }
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
    this.flash = Math.max(0, this.flash - dt * 7);
    if (this.flashSprite) {
      this.flashSprite.visible = this.flash > 0;
      this.flashSprite.material.opacity = this.flash * 0.9;
      this.flashSprite.scale.setScalar(0.9 + (1 - this.flash) * 0.5);
    }
    this.guardUp += ((this.blocking && !ko ? 1 : 0) - this.guardUp) * k(14);
    if (this.guardUp < 0.002) this.guardUp = 0;
    this.pumped = Math.max(0, this.pumped - dt * 3);
    this.at.set(x, this.baseY, z);
    let turn = facing;
    // (2.42: on the pay phone, their back to its wall, turned a little toward it.)
    if (doing === DOING.PHONE && !moving && !ko) turn += Math.PI + this.phoneSide * PHONE_TWIST;
    // (2.42: at a north wall's kiosk, drawn to its side and turned in to the screen.)
    else if (doing === DOING.KIOSK && !moving && !ko && this.kioskSide) turn -= this.kioskSide * KIOSK_TWIST;
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
    // (Session 15: the ground covered this frame, for the stride and for a run, in game time: at a replay's ×4 the
    // legs go four times as fast, nobody breaks into a run.)
    const moved = Number.isFinite(this.lastX) ? Math.hypot(x - this.lastX, z - this.lastZ) : 0;
    this.lastX = x;
    this.lastZ = z;
    const gameDt = dt * Math.max(0.05, this.timeScale);
    const cut = cutOf(gameDt);
    // (Jogging, P31: running while it goes, quicker strides, a longer swing, more bounce; session 15: anyone going
    // well over a walk, a chase or a flight, runs too.)
    const runTo = moving ? Math.max(doing === DOING.RUN ? 1 : 0, gameDt > 0 && moved < cut ? runOf(moved / gameDt) : 0) : 0;
    this.runNow += (runTo - this.runNow) * (motion ? k(8) : 1);
    if (this.runNow < 0.002) this.runNow = 0;
    const running = this.runNow;
    const amp = SWING + SWING_RUN * running;
    if (moving) {
      const before = Math.floor(this.phase / Math.PI);
      // (Session 15: the stride follows the ground covered, so the feet keep up with it at any pace.)
      this.phase += strideTurn(moved, amp, this.root.scale.x, gameDt * 11 * this.gait * (1 + 0.45 * running), cut);
      stepped = Math.floor(this.phase / Math.PI) !== before;
    }
    const sty = this.style;
    const s = Math.sin(this.phase) * amp * this.swing;
    const l = this.limbs;
    l.legL = s;
    l.legR = -s;
    // (A rat perched on the left shoulder, P20: that arm holds still while walking. Session 15: each swings its arms its own way.)
    const arms = sty.arms * (1 + 0.15 * running);
    l.armLx = this.perched ? 0 : -s * arms;
    l.armRx = s * arms;
    l.armLz = 0;
    l.armRz = 0;
    l.legZ = 0;
    l.bob =
      Math.abs(Math.cos(this.phase)) * (0.045 + 0.04 * running) * sty.bob * this.swing +
      (motion ? Math.sin(time * sty.breath + this.offset) * 0.006 * (1 - this.swing) : 0);

    // Activities fade in once the character has stopped at its spot.
    // (Session 15: setting off from one that stays the same, a jog's or a match's, eases out of it too: it used to snap.)
    const setOff = moving && !this.wasMoving && this.act > 0.05;
    this.wasMoving = moving;
    if (doing !== this.actKind || setOff) {
      this.actKind = doing;
      this.act = 0;
      // (Standing about counts from here: done with something, it's a moment before it settles. Its stance, and a
      // stretch half done, ease out with the blend: from where the limbs are, at a pace for how far they have to go.)
      this.idle = 0;
      this.rest = 0;
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
      f[8] = this.legR.rotation.z;
      f[9] = this.lastNod;
      const x = this.extra;
      f[10] = x.headY;
      f[11] = x.headZ;
      f[12] = x.hip;
      f[13] = x.roll;
      this.blend = motion ? 0 : 1;
    }
    // (Session 15: with reduced motion, there at once.)
    this.act = moving ? 0 : motion ? Math.min(1, this.act + dt * 3) : 1;
    // On the pay phone (2.42): beside it along its wall rather than in front of it (from this camera the caller hid it),
    // a little in, their back to the wall and turned out to the room: the phone, the empty hook and the stretched cord
    // in sight beside them. (Session 15: eased back as they hang up too.)
    this.phoneOff += ((doing === DOING.PHONE && !ko ? this.act : 0) - this.phoneOff) * (motion ? k(8) : 1);
    if (this.phoneOff < 0.002) this.phoneOff = 0;
    if (this.phoneOff > 0) {
      const o = PHONE_SIDE * this.phoneOff * this.phoneSide;
      const w = PHONE_IN * this.phoneOff;
      this.root.position.x += Math.cos(facing) * o + Math.sin(facing) * w;
      this.root.position.z += -Math.sin(facing) * o + Math.cos(facing) * w;
    }
    // At the kiosk (P35): drawn a step back from the wall, the screen in sight over the head.
    this.kioskOff += ((doing === DOING.KIOSK && !ko ? this.act : 0) - this.kioskOff) * (motion ? k(8) : 1);
    if (this.kioskOff < 0.002) this.kioskOff = 0;
    if (this.kioskOff > 0) {
      const r = facing;
      const o = (this.kioskSide ? KIOSK_BACK * 0.5 : KIOSK_BACK) * this.kioskOff;
      const side = KIOSK_SIDE * this.kioskSide * this.kioskOff;
      this.root.position.x += -Math.sin(r) * o + Math.cos(r) * side;
      this.root.position.z += -Math.cos(r) * o - Math.sin(r) * side;
    }
    // (Session 15: with reduced motion too, held still: a pose that says what they're doing never vanishes.)
    const a = this.act;
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
    // (2.42: on the pay phone's other side, the right hand to the ear: the pose mirrored.)
    if (doing === DOING.PHONE && this.phoneSide === 1) {
      const lx = l.armLx;
      const lz = l.armLz;
      l.armLx = l.armRx;
      l.armLz = -l.armRz;
      l.armRx = lx;
      l.armRz = -lz;
    }
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
    // Standing about (session 15): settled into its own stance after a moment, a fidget now and then
    // (a look round, the weight shifted, a stretch...); eased out the moment it has something to do.
    // None with reduced motion: they stand as they are.
    const carrying = this.held !== null && this.grip === GRIP.CARRY;
    const about =
      motion &&
      doing === DOING.NOTHING &&
      !moving &&
      this.lie === 0 &&
      this.crawl === 0 &&
      this.prone === 0 &&
      this.doze === 0 &&
      this.trayAt === TRAY_AT.NONE &&
      !carrying &&
      !this.blocking &&
      this.guardUp === 0 &&
      this.hit === 0 &&
      this.jab === 0 &&
      this.recoil === 0;
    this.idle = moving ? 0 : this.idle + dt;
    this.rest += ((about && this.idle > SETTLE ? 1 : 0) - this.rest) * (motion ? k(about ? 2.5 : 8) : 1);
    if (this.rest < 0.002) this.rest = 0;
    const armsFree = this.held === null && !this.perched;
    if (this.rest > 0) {
      const f = this.fidget;
      if (f.kind !== FIDGET.NONE) {
        f.at += dt;
        if (f.at > 3.5) f.kind = FIDGET.NONE;
      } else if (this.rest > 0.9 && (f.next -= dt) <= 0) nextFidget(f, this.style, this.guard, this.fidgetRoll, armsFree);
    } else this.fidget.kind = FIDGET.NONE;
    idlePose(l, this.extra, this.style, this.fidget, this.rest, t, armsFree);
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
    // The head's nod (the activity's: a book read, a rinse, a towel; dozing; a blow's snap), blended with the rest.
    const n = (t * 0.2) % 1;
    const sink = n < 0.85 ? n / 0.85 : 1 - (n - 0.85) / 0.15;
    const nodding = motion ? 0.3 + 0.35 * sink * sink * (3 - 2 * sink) : 0.55;
    let nod =
      doing === DOING.READ
        ? 0.3 * this.act
        : doing === DOING.SHOWER || doing === DOING.LINE_UP
          ? -0.4 * this.moves.headBack
          : doing === DOING.TOWEL
            ? 0.25 * this.act
            : nodding * dz * (1 - 0.7 * this.stir) - 0.25 * this.startle;
    nod += this.extra.headX;
    // From one activity to another: limbs, height, lean and nod ease from where they were (before a blow, which never waits).
    if (this.blend < 1) {
      if (this.blend === 0) {
        // (How far there is to go, on the first frame: a big change takes longer.)
        const f = this.from;
        const far = Math.max(
          Math.abs(l.legL - f[0]),
          Math.abs(l.legR - f[1]),
          Math.abs(l.armLx - f[2]),
          Math.abs(l.armLz - f[3]),
          Math.abs(l.armRx - f[4]),
          Math.abs(l.armRz - f[5]),
          Math.abs(lean - f[7]),
          Math.abs(l.legZ - f[8]),
          Math.abs(nod - f[9]),
        );
        this.blendRate = BLEND_RATE / Math.max(1, far / BLEND_FAR);
      }
      this.blend = Math.min(1, this.blend + dt * this.blendRate);
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
      l.legZ = f[8] + (l.legZ - f[8]) * b;
      nod = f[9] + (nod - f[9]) * b;
      const x = this.extra;
      x.headY = f[10] + (x.headY - f[10]) * b;
      x.headZ = f[11] + (x.headZ - f[11]) * b;
      x.hip = f[12] + (x.hip - f[12]) * b;
      x.roll = f[13] + (x.roll - f[13]) * b;
    }
    this.lastBob = l.bob;
    this.lastLean = lean;
    this.lastNod = nod;
    // A strike: the tool arm up and down hard.
    // (Session 15: taken over from where the arm was and given back to it at the end: it used to snap both ways.)
    if (this.hit > 0) {
      const h = this.hit;
      const w = Math.min(1, (1 - h) / BLOW_IN, h / BLOW_OUT);
      const to = h > 0.6 ? -2.6 * ((1 - h) / 0.4) : -2.6 * (h / 0.6) - 0.3 * (1 - h / 0.6);
      l.armRx += (to - l.armRx) * w;
      l.armLx = Math.min(l.armLx, -0.5 * h);
    }
    // A punch: the right arm drawn back, then thrown straight out; the left guards the face.
    // Both hands on the tray, or reaching over the counter for one (2.25): the walk's swing gives way.
    // (Session 15: a bundle, a plank or a crate carried the same way, walking or standing about.)
    const bundle = carrying && !ko && (moving || doing === DOING.NOTHING || doing === DOING.LINE_UP || doing === DOING.QUEUE);
    this.carry += ((this.trayAt === TRAY_AT.HANDS || bundle ? 1 : 0) - this.carry) * k(10);
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
      // (Session 15: home is where the arm was, the walk's swing or the fists up of a brawl, not straight down.)
      const out = Math.min(1, j * 1.6);
      const w = Math.min(1, j / BLOW_OUT);
      l.armRx += (-1.7 * out * out * (3 - 2 * out) - l.armRx) * w;
      l.armLx = Math.min(l.armLx, -1.1 * Math.min(1, j * 2));
      l.armLz += (-0.25 * j - l.armLz) * w;
    }
    // The block (2.35): both forearms up before the face.
    if (this.guardUp > 0) {
      const g = this.guardUp;
      l.armLx += (-2.1 - l.armLx) * g;
      l.armRx += (-2.1 - l.armRx) * g;
      l.armLz += (-0.55 - l.armLz) * g;
      l.armRz += (0.55 - l.armRz) * g;
    }
    this.legL.rotation.set(l.legL, 0, -l.legZ);
    this.legR.rotation.set(l.legR, 0, l.legZ);
    this.armL.rotation.set(l.armLx, 0, l.armLz);
    this.armR.rotation.set(l.armRx, 0, l.armRz);
    // (A blow or a strike swings what's in hand as a tool, a mop's handle too.)
    const blow = Math.max(
      this.hit > 0 ? Math.min(1, (1 - this.hit) / BLOW_IN, this.hit / BLOW_OUT) : 0,
      this.jab > 0 ? Math.min(1, this.jab / BLOW_OUT) : 0,
    );
    this.placeHeld(doing, dt, motion, blow);
    // A bob and a little forward lean while walking, a slow breath while standing; flat in bed.
    this.body.position.y =
      l.bob * (1 - this.lie) + this.crawl * 0.12 + 0.07 * Math.sin(this.startle * Math.PI) + this.prone * (0.08 + this.pumped * 0.14);
    // (Session 15: the weight over one foot, standing about.)
    this.body.position.x = this.extra.hip;
    // (In line for the phone, P34: a slow shift of the weight from foot to foot. Session 15: a sway from foot to
    // foot walking, each its own, and a fidget's roll.)
    const shift = doing === DOING.QUEUE && motion ? Math.sin(t * 0.55) * 0.04 * this.act : 0;
    this.body.rotation.z =
      (motion ? Math.sin(t * 0.7) * 0.06 * dz : 0) + shift + this.extra.roll + Math.sin(this.phase) * sty.sway * this.swing * (1 - running);
    this.body.rotation.x =
      (sty.lean + 0.1 * running) * this.swing -
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
    this.handset.visible = doing === DOING.PHONE && this.act > 0.3 && this.phoneSide !== 1;
    this.handsetR.visible = doing === DOING.PHONE && this.act > 0.3 && this.phoneSide === 1;
    const shorts = this.undressed && this.washBody !== null;
    this.dressed.visible = !shorts;
    if (this.washBody) this.washBody.visible = shorts;
    this.towelNeck.visible = this.towel === 1;
    // (2.36: a towel round the neck covers the bandana.)
    if (this.bandana) this.bandana.visible = this.towel !== 1;
    this.towelHead.visible = this.towel === 2;
    // (2.36: and the towel over the hair, the head wrap.)
    if (this.wrap) this.wrap.visible = this.towel !== 2;
    if (this.clipboard) this.clipboard.visible = doing === DOING.COUNT && !moving && this.act > 0.2;

    // Blink every few seconds; eyes shut in bed.
    this.blinkAt -= dt;
    // Dozing: shut, fluttering as it stirs; wide for a moment on waking with a start.
    const flutter = this.stir > 0.4 && (t * 12) % 1 < 0.3;
    const closed = this.blinkAt < 0.12 || (this.lie > 0.5 && !ko && !this.benching) || (this.doze > 0.6 && !flutter);
    if (this.blinkAt < 0) this.blinkAt = 2 + this.roll() * 3.5;
    this.eyes.scale.y = closed ? 0.15 : 1 + 0.5 * this.startle;

    // Standing still for a while: glance around now and then (not in line, nor asleep; session 15: nor standing
    // about, where the fidgets look round; the character's own random numbers, not Math.random).
    // (In line for the phone, P34, they look about as they wait.)
    const still =
      doing === DOING.CRAWL ||
      doing === DOING.LINE_UP ||
      doing === DOING.SLEEP ||
      doing === DOING.EXERCISE ||
      doing === DOING.SEARCH ||
      (doing >= DOING.WORK && doing !== DOING.QUEUE) ||
      ko;
    if (this.idle > 2.5 && motion && !still && this.rest === 0 && this.roll() < dt * 0.6)
      this.glanceGoal = (this.roll() - 0.5) * (this.perched ? PERCHED_GLANCE * 2 : 1.1);
    if (this.idle === 0 || still || this.rest > 0) this.glanceGoal = 0;
    this.glance += (this.glanceGoal - this.glance) * k(5);
    // (A fidget's look round stays clear of a perched rat too.)
    const look = this.perched ? Math.max(-PERCHED_GLANCE, Math.min(PERCHED_GLANCE, this.extra.headY)) : this.extra.headY;
    this.head.rotation.y = this.glance + look;
    // (On the phone: the head tipped toward the handset.)
    this.head.rotation.z = (doing === DOING.PHONE ? 0.16 * this.act * -this.phoneSide : 0) + this.extra.headZ;
    // Nodding off: the chin sinks for 4 s and jerks back up (still, it just hangs); a blow snaps it back (eased in and out of the nod).
    this.head.rotation.x = this.recoil > 0 ? nod + (-0.35 - nod) * Math.sin(this.recoil * Math.PI) : nod;
    return stepped;
  }

  /**
   * The held item where its grip puts it (session 15), once the arms are set: out of the fist, upright in
   * it, by the handle at the side or in both hands at work, in both hands before the belly, by its edge at
   * the side or open before the face to read. It grows into the hand; the last one shrinks away. `blow`: how far a
   * strike or a blow has the arm (a mop's handle swung out of the fist like a tool's meanwhile).
   */
  private placeHeld(doing: number, dt: number, motion: boolean, blow: number) {
    const swap = motion ? dt / HELD_SWAP : 1;
    if (this.dropping) {
      this.dropLeft = Math.max(0, this.dropLeft - swap);
      if (this.dropLeft <= 0) {
        this.dropping.removeFromParent();
        this.dropping = null;
      } else this.dropping.scale.setScalar(this.dropScale * this.dropLeft * this.dropLeft);
    }
    const m = this.held;
    if (!m) return;
    this.heldIn = Math.min(1, this.heldIn + swap);
    const g = this.grip;
    const e = this.heldIn * this.heldIn * (3 - 2 * this.heldIn);
    m.scale.setScalar(GRIP_SCALE[g] * Math.max(0.001, e));
    const reading = g === GRIP.FLAT && (doing === DOING.READ || doing === DOING.SIT_READ);
    const sweeping = g === GRIP.POLE && (doing === DOING.MOP || doing === DOING.WORK);
    const twoHands = g === GRIP.CARRY || reading || sweeping;
    const parent = twoHands ? this.body : this.armR;
    if (m.parent !== parent) parent.add(m);
    if (twoHands) {
      // Between the hands, wherever the pose has put them.
      this.armL.updateMatrix();
      this.armR.updateMatrix();
      HAND_L.copy(FIST).applyMatrix4(this.armL.matrix);
      HAND_R.copy(FIST).applyMatrix4(this.armR.matrix);
      GRIP_AT.addVectors(HAND_L, HAND_R).multiplyScalar(0.5);
      // (Hands not before the body, a jumping jack's or one out cold: nothing to hold it on, so it isn't drawn sunk into the chest.)
      m.visible = GRIP_AT.z > 0.2 && this.lie < 0.2 && this.crawl < 0.2 && this.prone < 0.2;
      if (g === GRIP.CARRY) {
        // Level on the hands, a little ahead of them.
        m.rotation.set(0, 0, 0);
        m.position.set(GRIP_AT.x, GRIP_AT.y + 0.03, GRIP_AT.z + 0.06);
      } else if (reading) {
        // Open before the chest, tipped up toward the face a little (more, and from this camera it's only an edge).
        m.rotation.set(-0.45, 0, 0);
        m.position.set(GRIP_AT.x, GRIP_AT.y + 0.08, GRIP_AT.z + 0.02);
      } else {
        // The handle down and ahead to the floor, the head swinging out the way the hands go.
        m.quaternion.setFromEuler(SWEEP_E.set(-(Math.PI / 2 - POLE_SWEEP), GRIP_AT.x * 1.6, -Math.PI / 2));
        HAND_L.set(POLE_TWO_HANDS * m.scale.x, 0, 0).applyQuaternion(m.quaternion);
        m.position.copy(GRIP_AT).sub(HAND_L);
      }
      return;
    }
    m.visible = true;
    if (g === GRIP.UPRIGHT || doing === DOING.DRINK || doing === DOING.SNACK) {
      // (2.33: a cup or a can at the mouth, or a snack, stays upright in the fist whatever the arm does, tipped toward the
      // lips for a sip; session 15: a cup, a can or a bottle carried about too, not tipped over as the arm swings.)
      UPRIGHT.copy(this.armR.quaternion).invert();
      TIP.setFromEuler(
        TIP_E.set(doing === DOING.DRINK ? -0.25 - 0.55 * this.moves.sip : doing === DOING.SNACK ? -0.2 : 0, -Math.PI / 2, 0),
      );
      m.quaternion.copy(UPRIGHT).multiply(TIP);
      m.position.set(0, -0.46, 0.03);
    } else if (g === GRIP.POLE) {
      // Upright at the side by the handle, the head by the feet, whatever the arm does.
      UPRIGHT.copy(this.armR.quaternion).invert();
      m.quaternion.copy(UPRIGHT).multiply(POLE_DOWN);
      HAND_L.set(POLE_ONE_HAND * m.scale.x, 0, 0).applyQuaternion(m.quaternion);
      m.position.copy(FIST).sub(HAND_L);
      if (blow > 0) {
        m.quaternion.slerp(TIP.setFromEuler(TIP_E.set(0, -Math.PI / 2, 0)), blow);
        m.position.lerp(HAND_L.set(0, -0.44, 0.16), blow);
      }
    } else if (g === GRIP.FLAT) {
      m.quaternion.copy(FLAT_SIDE);
      m.position.set(0, -0.5, 0.04);
    } else {
      // Anything else points forward out of the fist as the arm carries it.
      m.rotation.set(0, -Math.PI / 2, 0);
      m.position.set(0, -0.44, g === GRIP.SMALL ? 0.1 : 0.16);
    }
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
      if (o !== this.held && o !== this.dropping && !shared) m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) if (mat !== kitMaterial && mat !== bodyMaterial) mat.dispose();
    });
    // (The bones' matrices live in a small texture per character.)
    this.skeleton.dispose();
    this.washSkeleton?.dispose();
  }
}
