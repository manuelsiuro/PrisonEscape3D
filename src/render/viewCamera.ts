import * as THREE from 'three';
import { LAYER, MAP_H, MAP_W } from '../sim/world/World';
import { pitchFraming, SCREEN_COLS, SCREEN_ROWS, ZOOM_MAX, ZOOM_MIN } from './pitchFrame';
import type { Frame } from './viewFrame';

// The camera of play (out of View.ts, v2.34.2): the classic angle on a target, the zoom and the
// picture slid clear of a panel, a match's framing, the escape camera, the jolts; screen to world.

/** From the target, up and to the south: the classic angled top-down view (tech plan §6.1). */
export const CAMERA_OFFSET = new THREE.Vector3(0, 38, 24).normalize().multiplyScalar(60);
/** The escape camera (P16): how far it turns round the player (radians) and pulls back (a share of the zoom). */
const CINEMA_TURN = (25 * Math.PI) / 180;
const CINEMA_PULL = 0.3;
/** The Intake's camera: lower than play's, nearly face on (a mugshot, not a map). */
const PREVIEW_OFFSET = new THREE.Vector3(0, 16, 24).normalize().multiplyScalar(60);
const UP = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 200);
  /** What the camera looks at, and the look-ahead added to the player while walking. */
  readonly target = new THREE.Vector3(MAP_W / 2, 0, MAP_H / 2);
  readonly ahead = new THREE.Vector3();
  zoom = 1;
  zoomGoal = 1;
  /** P29, a match: the zoom that fits the whole pitch on screen (0: none), never closer than the player's own zoom. */
  fitZoom = 0;
  /** Half the sun's shadow box (tiles): it covers what the camera sees. */
  shadowHalf = 20;
  /** The sun's shadow camera, sized with the view (set by the view once the sun is made). */
  shadow: THREE.OrthographicCamera | null = null;
  /** The camera's offset from the target this frame (the escape camera turns it, the Intake lowers it). */
  readonly offset = new THREE.Vector3();
  /** A strike's jolt (0–1), easing away. */
  private shake = 0;
  /** 2.43: how far the tipsy sway is in (0–1, View sets it each frame; 0 with the shake setting off or reduced motion). */
  sway = 0;
  /** The escape camera (P16): time in, length, turn (signed), the zoom it starts from; resolved once played (or skipped). */
  private cine: { t: number; dur: number; turn: number; zoom0: number; still: boolean; done: (() => void) | null; held: boolean } | null =
    null;
  /** Where the picture is slid to (CSS px), and where it's going: the player kept clear of an open panel. */
  private readonly shift = { x: 0, y: 0 };
  private readonly shiftGoal = { x: 0, y: 0 };
  private readonly raycaster = new THREE.Raycaster();
  private readonly floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ndc = new THREE.Vector2();
  private readonly v = new THREE.Vector3();

  /** A jolt of the camera (strikes, blows, shots, blasts): the strongest one asked for wins, and eases away. */
  jolt(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  /** The floor taps land on (the layer drawn's height). */
  setFloor(y: number) {
    this.floor.constant = -y;
  }

  /** A point of the world (tiles) on screen (CSS pixels); null off screen. */
  screenAt(x: number, y: number, z: number, out: { x: number; y: number }): { x: number; y: number } | null {
    this.v.set(x, y, z).project(this.camera);
    if (this.v.z > 1 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1) return null;
    out.x = ((this.v.x + 1) / 2) * innerWidth;
    out.y = ((1 - this.v.y) / 2) * innerHeight;
    return out;
  }

  /** The floor point under a screen point (tiles), for tap-to-walk. */
  groundAt(clientX: number, clientY: number): { x: number; z: number } | null {
    this.ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.floor, this.v);
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  /**
   * Slides the picture so the player shows in the part of the screen a panel leaves free (a
   * side panel in landscape, a bottom sheet in portrait); 0, 0 puts it back. Eased.
   */
  setShift(x: number, y: number) {
    this.shiftGoal.x = x;
    this.shiftGoal.y = y;
  }

  private easeShift(dt: number, reducedMotion: boolean) {
    const k = reducedMotion ? 1 : Math.min(1, dt * 7);
    const dx = this.shiftGoal.x - this.shift.x;
    const dy = this.shiftGoal.y - this.shift.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      if (dx || dy) {
        this.shift.x = this.shiftGoal.x;
        this.shift.y = this.shiftGoal.y;
        this.applyZoom();
      }
      return;
    }
    this.shift.x += dx * k;
    this.shift.y += dy * k;
    this.applyZoom();
  }

  /**
   * A match on (P29): both goals stay in the picture. The zoom eases out until the pitch (a tile
   * round it) fits across the screen, as on a phone held upright, and the look-ahead is bent so
   * the camera stays between the goals (following the player as far as the pitch allows). The
   * player is kept in the box too: off the pitch (up to PITCH_LEAVE tiles while the match is on),
   * the picture widens to hold both, and where it can't, the player stays on screen.
   */
  framePitch(f: Frame, dt: number, reducedMotion: boolean) {
    const p = f.team.pitch;
    if (!p || !f.team.ball || f.layer !== LAYER.GROUND) {
      this.fitZoom = 0;
      return;
    }
    const aim = pitchFraming(p, f.x, f.z, this.ahead, this.zoom, innerWidth / Math.max(1, innerHeight));
    this.fitZoom = aim.fit;
    this.ahead.lerp(this.v.set(aim.x, 0, aim.z), reducedMotion ? 1 : Math.min(1, dt * 4));
  }

  /** Multiplies the zoom (wheel, pinch), within limits; the camera eases to it. */
  zoomBy(f: number) {
    this.zoomGoal = THREE.MathUtils.clamp(this.zoomGoal * f, ZOOM_MIN, ZOOM_MAX);
  }

  /** Sets the zoom to ease to (a new game's), within limits. */
  zoomTo(z: number) {
    this.zoomGoal = THREE.MathUtils.clamp(z, ZOOM_MIN, ZOOM_MAX);
  }

  /** About SCREEN_ROWS tiles tall, never under SCREEN_COLS wide (phones in portrait see more rows instead). */
  applyZoom() {
    const aspect = innerWidth / Math.max(1, innerHeight);
    const half = Math.max(SCREEN_ROWS, SCREEN_COLS / aspect) / 2 / this.zoom;
    // The picture slides by the shift (CSS px): the frustum moves the other way.
    const sx = (-this.shift.x / Math.max(1, innerWidth)) * 2 * half * aspect;
    const sy = (this.shift.y / Math.max(1, innerHeight)) * 2 * half;
    this.camera.left = -half * aspect + sx;
    this.camera.right = half * aspect + sx;
    this.camera.top = half + sy;
    this.camera.bottom = -half + sy;
    this.camera.updateProjectionMatrix();
    // The shadow box covers what the camera sees (the view is stretched along the ground by the tilt).
    // (Turned by the escape camera, the view's corners swing out: the box covers its diagonal.)
    const reach = this.cine ? Math.hypot(half * aspect, half * 1.25) : Math.max(half * aspect, half * 1.25);
    this.shadowHalf = Math.min(34, reach + 3 + Math.max(Math.abs(sx), Math.abs(sy) * 1.25));
    const s = this.shadow;
    if (!s) return;
    s.left = s.bottom = -this.shadowHalf;
    s.right = s.top = this.shadowHalf;
    s.near = 1;
    s.far = 140;
    s.updateProjectionMatrix();
  }

  /** Puts the camera on a point at once (a new game starts on the player, not mid-pan). */
  snapTo(x: number, z: number, zoom = this.zoomGoal) {
    this.endCinema();
    this.target.set(x, 0, z);
    this.ahead.set(0, 0, 0);
    this.zoom = zoom;
    this.applyZoom();
  }

  /**
   * The escape camera (P16): a slow turn of up to 25° round the player and a pull-back, then
   * a hold; resolves when it's played (or skipped). With reduced motion: a still hold, 0.9 s.
   */
  cinema(long: boolean, still: boolean): Promise<void> {
    this.cine?.done?.();
    return new Promise((resolve) => {
      this.cine = {
        t: 0,
        dur: still ? 0.9 : long ? 3.4 : 2.6,
        turn: (Math.random() < 0.5 ? -1 : 1) * CINEMA_TURN,
        zoom0: this.zoom,
        still,
        done: resolve,
        held: false,
      };
    });
  }

  /** Cuts the escape camera short (a tap): it resolves now and holds where it got to. */
  skipCinema() {
    const c = this.cine;
    if (!c?.done) return;
    c.held = true;
    c.done();
    c.done = null;
  }

  /** The escape camera over (a new game, the title): the classic angle, and the zoom it started from. */
  endCinema() {
    const c = this.cine;
    if (!c) return;
    c.done?.();
    this.cine = null;
    this.zoomGoal = c.zoom0;
  }

  /** The frame's start: the picture's slide and the zoom eased (P29: in a match, out as far as the pitch needs; the player's zoom comes back after). */
  ease(dt: number, reducedMotion: boolean) {
    this.easeShift(dt, reducedMotion);
    const zoomTo = this.fitZoom ? Math.min(this.zoomGoal, this.fitZoom) : this.zoomGoal;
    if (Math.abs(this.zoom - zoomTo) > 1e-4) {
      this.zoom += (zoomTo - this.zoom) * Math.min(1, dt * (this.fitZoom ? 3 : 10));
      this.applyZoom();
    }
  }

  /** The camera put at its target: the Intake's angle (`preview`, 0–1), the escape camera's turn and pull, a jolt (`shakes`: the setting on, motion allowed). */
  place(dt: number, time: number, preview: number, shakes: boolean) {
    const c = this.cine;
    this.offset.copy(CAMERA_OFFSET);
    if (preview > 0.002) this.offset.lerp(PREVIEW_OFFSET, preview).setLength(60);
    if (c) {
      // Skipped: it holds where it got to.
      if (!c.held) c.t = Math.min(c.dur, c.t + dt);
      const e = c.still ? 0 : THREE.MathUtils.smootherstep(c.t / c.dur, 0, 1);
      this.offset.applyAxisAngle(UP, c.turn * e);
      if (!c.still) {
        this.zoom = this.zoomGoal = Math.max(ZOOM_MIN, c.zoom0 * (1 - CINEMA_PULL * e));
        this.applyZoom();
      }
      if (c.t >= c.dur && c.done) {
        c.done();
        c.done = null;
      }
    }
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.lookAt(this.target);
    if (this.sway > 0.001) {
      // 2.43: tipsy, the world rolls a little and drifts, slowly (View: none with the shake setting off or reduced motion).
      this.camera.position.x += Math.sin(time * 0.7) * 0.22 * this.sway;
      this.camera.position.z += Math.sin(time * 0.53 + 1) * 0.12 * this.sway;
      this.camera.lookAt(this.target);
      this.camera.rotateZ(Math.sin(time * 0.9) * 0.03 * this.sway);
    }
    if (this.shake > 0.001) {
      // A short jolt on a strike, eased away (none with the setting off or reduced motion).
      const a = shakes ? this.shake * 0.06 : 0;
      this.camera.position.x += Math.sin(time * 91) * a;
      this.camera.position.y += Math.cos(time * 77) * a;
      this.shake = Math.max(0, this.shake - dt * 5);
    }
  }
}
