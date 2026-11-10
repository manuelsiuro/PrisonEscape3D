import * as THREE from 'three';
import { MAP_W, type World } from '../sim/world/World';
import { TILE } from '../sim/world/tiles';
import type { Later } from './batch';
import { now } from './batch';
import { box, disc, kitMaterial, merge } from './kit';
import { glowTexture } from './lights';
import { seeThrough } from './occlusion';
import { Character } from './Character';
import { guardLook } from './look';
import { itemDef, itemNumber } from '../content/items';
import { itemGeometry } from './itemModels';
import { DOING } from '../sim/systems/inmates';

/** What the release desk (P36) shows this frame. */
export interface ReleaseFrame {
  /** The name on today's list, called (10:00–10:30): its lamp blinks amber. */
  called: boolean;
  /** Cleared: its lamp steady green while the way out is open. */
  freed: boolean;
  /**
   * 2.42, the clerk at the desk (drawn only: nobody in the sim): 0 none, 1 leafing through tomorrow's list (the hour
   * before the records), 2 checking the one called (the morning's call, and while the way out is open); where the
   * player is, for him to look up at them when they're close.
   */
  clerk: 0 | 1 | 2;
  px: number;
  pz: number;
}

const NAVY = 0x2c4a6e;
const PAPER = 0xf4efe0;
const STEEL = 0x9aa2ad;
const STEEL_DARK = 0x6b737c;
/** 2.42: the clerk stands this far beside the podium (tiles: on its side away from the release point, the sign on its post not in front of him), and looks up at the player within this many tiles. */
const CLERK_SIDE = 0.5;
const CLERK_LOOK = 3;
/** He stays this long (seconds) once the call's over at the desk: a refusal's stamp seen. */
const CLERK_LINGER = 3;
/** His own number, for how he stands (characterMotion.ts). */
const CLERK_SEED = 3100;
const OFF = new THREE.Color(0x4a4f57);
const AMBER = new THREE.Color(0xffb84a);
const GREEN = new THREE.Color(0x5fe08a);

/**
 * The release desk, standing in its own terms (its foot at the origin, the floor at y = 0, its
 * front toward +z, the camera's side): a steel podium with a sloped top and an in-tray on it, a
 * few forms in, and a navy sign on a post over it with a sheet and an arrow (no words: the same in
 * every language), its lamp on top.
 */
export function releaseDeskParts() {
  return [
    // The podium.
    box(0.34, 0.06, 0.28, STEEL_DARK, 0, 0.03, 0),
    box(0.26, 0.82, 0.2, STEEL, 0, 0.47, 0),
    box(0.4, 0.04, 0.3, STEEL_DARK, 0, 0.9, 0.02),
    // The in-tray on it, forms in.
    box(0.32, 0.015, 0.22, STEEL, 0, 0.93, 0.03),
    box(0.32, 0.05, 0.012, STEEL, 0, 0.95, 0.135),
    box(0.012, 0.05, 0.22, STEEL, -0.155, 0.95, 0.03),
    box(0.012, 0.05, 0.22, STEEL, 0.155, 0.95, 0.03),
    box(0.24, 0.02, 0.18, PAPER, 0, 0.95, 0.03),
    // The post and the sign.
    box(0.04, 0.5, 0.04, STEEL_DARK, 0, 1.17, -0.11),
    box(0.46, 0.28, 0.025, NAVY, 0, 1.52, -0.1),
    box(0.12, 0.17, 0.006, PAPER, -0.09, 1.52, -0.085),
    ...[-0.05, 0, 0.05].map((y) => box(0.075, 0.012, 0.004, 0x9aa2ad, -0.09, 1.52 + y, -0.08)),
    box(0.11, 0.035, 0.006, PAPER, 0.06, 1.52, -0.085),
    // (Its head: two strokes at ±45°.)
    box(0.07, 0.03, 0.006, PAPER)
      .rotateZ(Math.PI / 4)
      .translate(0.12, 1.54, -0.085),
    box(0.07, 0.03, 0.006, PAPER)
      .rotateZ(-Math.PI / 4)
      .translate(0.12, 1.5, -0.085),
    // The lamp's housing.
    disc(0.07, 0.03, STEEL_DARK, 0, 1.67, -0.1, 12),
  ];
}

/**
 * Where the desk stands: on open floor beside the release point (west of its first tile, else
 * east, else north), clear of its doors; a little toward the point, and back against a wall
 * south of it where there is one (out of the walking lane: a corridor's people pass north of it).
 */
function deskSpot(world: World): { x: number; z: number } | null {
  const r = world.def.comms?.release;
  if (!r || world.def.rules?.relaxed) return null;
  const at = (x: number, z: number) => r.at.some((q) => q.x === x && q.z === z);
  const open = (x: number, z: number) =>
    !world.blocked(x, z) &&
    world.ground.kind[z * MAP_W + x] !== TILE.DOOR &&
    !at(x, z) &&
    !world.release[z * MAP_W + x] &&
    !world.propSolid[z * MAP_W + x];
  const q = r.at[0];
  const last = r.at[r.at.length - 1];
  const back = (x: number, z: number) => (world.blocked(x, z + 1) ? z + 0.8 : z + 0.5);
  if (open(q.x - 1, q.z)) return { x: q.x - 1 + 0.75, z: back(q.x - 1, q.z) };
  if (open(last.x + 1, last.z)) return { x: last.x + 1 + 0.25, z: back(last.x + 1, last.z) };
  if (open(q.x, q.z - 1)) return { x: q.x + 0.5, z: q.z - 1 + 0.6 };
  return null;
}

/** The release desk (P36): its podium, tray, sign and lamp beside the release point; the lamp says when the name is called and while the way out is open. */
export class ReleaseView {
  readonly group = new THREE.Group();
  private desk: THREE.Group | null = null;
  /** Cut away as the phone is (a player behind it is never hidden by its sign). */
  private readonly mat = seeThrough(kitMaterial.clone(), 0.6, -0.05);
  private readonly lampMat = seeThrough(new THREE.MeshBasicMaterial({ color: OFF.clone(), toneMapped: false }), 0.6, -0.05);
  /** The lamp's glow: a sprite (it faces the camera, so the camera's tilt never flattens it). */
  private readonly glowMat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: 0xffb84a,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  /** 2.42: the clerk (made with the first desk, hidden till he's needed), and the stamps he's to make. */
  private clerk: Character | null = null;
  private stamps = 0;
  /** 2.42: when he was last at the desk for a call (the clock's seconds), so a refusal's stamp is seen before he goes. */
  private calledAt = -1e9;
  private readonly clerkAt = { x: 0, z: 0 };

  /** 2.42: the clerk stamps the papers (cleared, or turned away). */
  stamp() {
    this.stamps++;
  }

  /** A prison: its desk on its wall (none without one). */
  setWorld(world: World, later: Later = now) {
    const old = this.desk;
    if (old) {
      this.group.remove(old);
      later(() => old.traverse((m) => (m as THREE.Mesh).geometry?.dispose()));
    }
    this.desk = null;
    const at = deskSpot(world);
    if (!at) return;
    const g = new THREE.Group();
    const body = new THREE.Mesh(merge(releaseDeskParts()), this.mat);
    body.castShadow = true;
    body.receiveShadow = true;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.065, 14, 10), this.lampMat);
    lamp.position.set(0, 1.74, -0.1);
    const glow = new THREE.Sprite(this.glowMat);
    glow.scale.setScalar(1.1);
    glow.position.set(0, 1.74, -0.05);
    g.add(body, lamp, glow);
    g.position.set(at.x, 0, at.z);
    this.group.add(g);
    this.desk = g;
    const r = world.def.comms!.release.at[0];
    const away = r.x + 0.5 >= at.x ? -1 : 1;
    this.clerkAt.x = at.x + away * CLERK_SIDE;
    this.clerkAt.z = at.z - 0.45;
    // (2.42: the clerk, a guard in glasses with a clipboard, made once, hidden until the list or the call.)
    if (!this.clerk) {
      const c = new Character({ ...guardLook(11), glasses: 2, glassesColor: 0x2a2a2e }, CLERK_SEED);
      const clipboard = itemNumber('magazine');
      c.hold(clipboard, itemGeometry(itemDef(clipboard)));
      c.root.visible = false;
      this.clerk = c;
      this.group.add(c.root);
    }
  }

  /** The lamp: off, blinking amber while the name is called, steady green while the way out is open (`shown` false: not from the tunnels). */
  update(f: ReleaseFrame | null, time: number, motion: boolean, shown = true, dt = 0) {
    this.group.visible = !!this.desk && !!f && shown;
    this.clerkFrame(f, time, motion, dt);
    if (!f) return;
    const on = f.freed || (f.called && (!motion || Math.floor(time * 2) % 2 === 0));
    this.lampMat.color.copy(f.freed ? GREEN : on ? AMBER : OFF);
    this.glowMat.color.copy(f.freed ? GREEN : AMBER);
    this.glowMat.opacity = on ? 0.55 : 0;
  }

  /**
   * 2.42, the clerk: behind the podium facing out, leafing through the list (head down over the clipboard), or for the
   * morning's call looking up at the player as they come; a stamp at a time (an arm's pump) as they're cleared or not.
   */
  private clerkFrame(f: ReleaseFrame | null, time: number, motion: boolean, dt: number) {
    const c = this.clerk;
    const d = this.desk;
    if (!c) return;
    if (f?.clerk === 2) this.calledAt = time;
    // (A player turned away takes the name off the list at once: he stays a moment, stamping it, before he goes.)
    const lingering = time - this.calledAt < CLERK_LINGER;
    const on = !!f && !!d && (f.clerk > 0 || lingering);
    c.root.visible = on;
    if (!on) {
      this.stamps = 0;
      return;
    }
    const { x, z } = this.clerkAt;
    const near = (f.clerk === 2 || lingering) && Math.hypot(f.px - x, f.pz - z) < CLERK_LOOK;
    const facing = near ? Math.atan2(f.px - x, f.pz - z) : 0;
    while (this.stamps > 0) {
      this.stamps--;
      c.pump();
    }
    c.pose(x, z, facing, false, dt, time, motion, near ? DOING.NOTHING : DOING.READ);
  }
}
