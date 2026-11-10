import * as THREE from 'three';
import { itemDef, itemNumber } from '../content/items';
import type { Prisoner } from '../content/prisoner';
import { DOING } from '../sim/systems/inmates';
import { MAP_W } from '../sim/world/World';
import { Character, type BedPose } from './Character';
import type { GymGear } from './GymGear';
import { itemGeometry } from './itemModels';
import { INMATE_LOOK, type Look } from './look';
import { lookFor } from './prisonerLook';
import { LAYER_Y } from './Structure';
import type { Crowd } from './viewCrowd';
import type { Frame } from './viewFrame';

// The player's character (out of View.ts, v2.34.2): dressed as your prisoner in what they wear, put
// where the frame has them and at what they're doing: eased onto a machine, squared up to an
// arm-wrestle or leaning in to a lock, in shorts and a towel after the showers, up from a bed.

/** How far apart two arm-wrestlers stand, centre to centre (tiles): their right hands, each reaching about half of it, meet between them. */
const BOUT_GAP = 1.0;
/** How far each steps to its own left (tiles), so the right hands (a shoulder's width off the middle) meet on the line between them. */
const BOUT_SIDE = 0.21;
/** How far the one winning leans in, and the other gives way, at the most (tiles). */
const BOUT_LEAN = 0.09;
/** Where the player stands to pick a lock: this far from the door tile's middle (the hands at its face, the pick in the keyhole). */
const PICK_STAND = 0.7;
const GUARD_OUTFIT = itemNumber('guard_outfit');
const INMATE_OUTFIT = itemNumber('inmate_outfit');
const COSTUME = itemNumber('costume');
const OWN_CLOTHES = itemNumber('own_clothes');
const GHILLIE = itemNumber('ghillie_cloak');
const OWN_JEANS = 0x4a6a96;
/** How long the player keeps the towel round their neck after washing (s). */
const PLAYER_DRY = 2.5;

export class PlayerView {
  /** The player's character (a new one each time they're dressed otherwise). */
  c = new Character(INMATE_LOOK);
  /** How the player is drawn now (the HUD's portrait follows it: portrait.ts). */
  look: Look = INMATE_LOOK;
  /** Where the player is drawn this frame (tiles: off their spot on a machine, in a bout, at a lock). */
  x = 0;
  z = 0;
  private outfit = -1;
  /** The tattoos inked in the prison the player is drawn with (P29). */
  private inkedShown: number[] = [];
  /** Your prisoner (P16): how the player looks (null: the plain jumpsuit). */
  private prisoner: Prisoner | null = null;
  /** The infirmary bed the player rested on, while they get up from it. */
  private lastRest: BedPose | null = null;
  private wasWashing = false;
  /** Seconds left with the towel, after stepping out from under the water. */
  private dryingFor = 0;
  /** Easing onto the training equipment (0 standing where the sim has them, 1 on it). */
  private trainBlend = 0;
  /** Where the side games (P22) draw the player off their spot (an arm-wrestle's stance, leaning in to a lock), eased in and out. */
  private readonly gameOff = { x: 0, z: 0 };
  private readonly trainPos = new THREE.Vector3();
  private reps = 0;
  /** The side games' taps so far (P22: a pin tried, dice thrown). */
  private taps = 0;

  constructor(
    private readonly add: (c: Character) => void,
    private readonly retire: (c: Character) => void,
    /**
     * What's shared with the rest of the view, made after the player (whose character keeps its place in
     * the order things are made: their ids break the draw order's ties): the gym's bars and bags, the
     * tiles of the heads someone's washing under this frame, everyone else.
     */
    private readonly shared: () => { gear: GymGear; running: Set<number>; crowd: Crowd },
  ) {}

  /** Your prisoner (P16): the player is dressed again as them at the next frame. */
  setPrisoner(p: Prisoner | null) {
    this.prisoner = p;
    this.outfit = -1;
  }

  /** A new game: dressed (rebuilt) afresh, nothing carried over, not even a pose; dry. */
  newWorld() {
    this.outfit = -1;
    this.wasWashing = false;
    this.dryingFor = 0;
  }

  /** Dresses the player: your prisoner in the outfit (a white vest with none on; the guard cap with the guard's uniform). */
  dress(outfit: number, inked: readonly number[] = []) {
    // (The designs compared one by one: no string a frame.)
    const same = inked.length === this.inkedShown.length && inked.every((d, k) => d === this.inkedShown[k]);
    if (outfit === this.outfit && same) return;
    this.outfit = outfit;
    this.inkedShown = inked.slice();
    const old = this.c;
    this.look = lookFor(this.prisoner, outfit ? itemDef(outfit).color : null, outfit === GUARD_OUTFIT, outfit === INMATE_OUTFIT, inked);
    // (P36: their own clothes on release: an off-white tee over jeans, nothing like a guard's navy.)
    if (outfit === OWN_CLOTHES) this.look = { ...this.look, trousers: OWN_JEANS };
    // (P42: the costume on costume night: a witch's robe and hat. It fools nobody.)
    if (outfit === COSTUME) this.look = { ...this.look, trousers: 0x2a1f36, hat: 13, hatColor: 0x2a1f36 };
    // (2.36: the ghillie cloak over the vest, earth-brown trousers, its hood instead of any hat.)
    if (outfit === GHILLIE) this.look = { ...this.look, trousers: 0x4a3e2c, hat: undefined, hatColor: undefined, ghillie: true };
    this.c = new Character(this.look);
    this.c.root.position.copy(old.root.position);
    this.c.root.rotation.copy(old.root.rotation);
    this.retire(old);
    this.add(this.c);
  }

  /** Puts the player where the frame has them, doing `doing`: true on the frame a foot lands. */
  draw(f: Frame, dt: number, time: number, doing: number, reduced: boolean): boolean {
    const { gear, running, crowd } = this.shared();
    this.c.root.visible = true;
    this.c.phoneSide = f.phone.side;
    this.c.kioskSide = f.kiosk.side;
    // (A tray takes both hands: what's in hand is out of sight while it does.)
    this.c.hold(
      f.sleeping ||
        f.knockedOut ||
        f.trayAt ||
        f.doing === DOING.SHOWER ||
        f.doing === DOING.BENCH ||
        f.doing === DOING.PULLUP ||
        f.doing === DOING.PUSHUP ||
        f.doing === DOING.BAG ||
        // (2.42: on the pay phone, a hand to the ear with the handset: what was in it is put away meanwhile.)
        f.doing === DOING.PHONE
        ? 0
        : f.held,
      f.held ? itemGeometry(itemDef(f.held)) : null,
    );
    this.c.trayPose(f.trayAt, f.trayLeft);
    // Onto the treadmill's belt and off it again, eased; a rep pumps the arms.
    this.trainBlend += ((f.trainAt ? 1 : 0) - this.trainBlend) * Math.min(1, dt * 8);
    if (f.trainAt) this.trainPos.set(f.trainAt.x, f.trainAt.y, f.trainAt.z);
    const tb = this.trainBlend > 0.001 ? this.trainBlend : 0;
    if (f.reps !== this.reps) {
      if (f.reps > this.reps) {
        this.c.pump();
        if (f.doing === DOING.BAG) gear.hit(f.trainProp, !reduced);
      }
      this.reps = f.reps;
    }
    let px = f.x + (this.trainPos.x - f.x) * tb;
    let pz = f.z + (this.trainPos.z - f.z) * tb;
    let facing = f.trainAt ? f.trainAt.facing : f.facing;
    // An arm-wrestle (P22): the two square on at arm's length, each a step to its own left so the
    // right hands meet on the line between them; the one winning leans in, the other gives way.
    // At a lock: leaning in to the door. Eased in and out (never a jump).
    if (!f.games.dice || f.games.dice.t[2] < 0) crowd.rivalThrew = false;
    const bout = f.games.bout;
    const rival = bout ? f.inmates[bout.who] : null;
    let gx = 0;
    let gz = 0;
    let rx = 0;
    let rz = 0;
    if (bout && rival) {
      const dx = rival.x - f.x;
      const dz = rival.z - f.z;
      const d = Math.hypot(dx, dz) || 1;
      const fx = dx / d;
      const fz = dz / d;
      const along = Math.max(-0.45, Math.min(0.7, (d - BOUT_GAP) / 2));
      const lean = BOUT_LEAN * bout.strain;
      // (A body's own left, the side away from the arm that grips: the player's (−fz, fx), the rival's the opposite.)
      gx = fx * (along + lean) - fz * BOUT_SIDE;
      gz = fz * (along + lean) + fx * BOUT_SIDE;
      rx = -fx * (along - lean) + fz * BOUT_SIDE;
      rz = -fz * (along - lean) - fx * BOUT_SIDE;
      facing = Math.atan2(dx, dz);
      crowd.rivalWho = bout.who;
      this.c.strain = bout.strain;
      this.c.shudder = bout.surge;
    } else if (f.doing === DOING.PICK && f.games.lock) {
      // (Up to the door, from wherever the player stopped: never through it.)
      const fx = Math.sin(f.facing);
      const fz = Math.cos(f.facing);
      const lean = Math.max(0, (f.games.lock.x - fx * PICK_STAND - f.x) * fx + (f.games.lock.z - fz * PICK_STAND - f.z) * fz);
      gx = fx * lean;
      gz = fz * lean;
    }
    const ge = Math.min(1, dt * 8);
    this.gameOff.x += (gx - this.gameOff.x) * ge;
    this.gameOff.z += (gz - this.gameOff.z) * ge;
    crowd.rivalOff.x += (rx - crowd.rivalOff.x) * ge;
    crowd.rivalOff.z += (rz - crowd.rivalOff.z) * ge;
    if (Math.abs(this.gameOff.x) + Math.abs(this.gameOff.z) < 1e-4) this.gameOff.x = this.gameOff.z = 0;
    if (!bout && Math.abs(crowd.rivalOff.x) + Math.abs(crowd.rivalOff.z) < 0.002) {
      crowd.rivalWho = -1;
      crowd.rivalOff.x = crowd.rivalOff.z = 0;
    }
    px += this.gameOff.x;
    pz += this.gameOff.z;
    if (f.games.taps !== this.taps) {
      if (f.games.taps > this.taps) this.c.pump();
      this.taps = f.games.taps;
    }
    this.c.baseY = LAYER_Y[f.layer] + this.trainPos.y * tb;
    // (2.26: in shorts, and a moment after with a towel round the neck on the way off.)
    const washing = f.doing === DOING.SHOWER;
    if (this.wasWashing && !washing && !f.knockedOut && !f.sleeping) this.dryingFor = PLAYER_DRY;
    this.wasWashing = washing;
    this.dryingFor = washing || f.knockedOut || f.sleeping ? 0 : Math.max(0, this.dryingFor - dt);
    this.c.undressed = washing || this.dryingFor > 0;
    this.c.towel = this.dryingFor > 0 ? 1 : 0;
    running.clear();
    if (washing) running.add(Math.floor(f.z) * MAP_W + Math.floor(f.x));
    // Off an infirmary bed: the body eases up from that bed (not the cell's) until it stands.
    if (f.restBed) this.lastRest = f.restBed;
    else if (this.c.lying === 0) this.lastRest = null;
    // (A pet rat on the shoulder, P20: the arm under it holds still, glances stay small.)
    let perchedRat = false;
    for (const r of f.rats) if (r.mode === 'shoulder') perchedRat = true;
    this.c.perched = perchedRat;
    this.c.blocking = f.blocking;
    // (Session 15: the strides in game time: asleep or knocked out the clock runs fast.)
    this.c.timeScale = f.speed;
    this.x = px;
    this.z = pz;
    return this.c.pose(px, pz, facing, f.moving, dt, time, !reduced, doing, f.restBed ?? this.lastRest ?? crowd.beds[1]);
  }
}
