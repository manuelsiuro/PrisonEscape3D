import type { GymGear, GearUse } from './GymGear';
import { Character, type BedPose } from './Character';
import { ALERT } from '../sim/systems/guards';
import { DOING } from '../sim/systems/inmates';
import { itemDef } from '../content/items';
import { itemGeometry } from './itemModels';
import { LAYER, MAP_H, MAP_W } from '../sim/world/World';
import { guardLook, inmateLook } from './look';
import type { Frame } from './viewFrame';

// Everyone but the player (out of View.ts, v2.34.2): an inmate's and a guard's character each, drawn
// where the frame has them, at what they're doing (a chair a little higher, a gym machine eased onto,
// the one arm-wrestling the player in its stance), with the marks over their heads.

/** The old-timer's hair (P27): white with age. */
const ELDER_HAIR = 0xd8d3c8;

export class Crowd {
  /** The inmates' characters (by inmate), and the guards' (by guard). */
  cast: Character[] = [];
  guardCast: Character[] = [];
  /** Where each guard sleeps (by guard). */
  private guardBeds: Array<BedPose | undefined> = [];
  /** Each cell's bed, for sleepers (by cell number). */
  beds: Array<BedPose | undefined> = [];
  /** Chair tiles (someone sitting there sits a little higher), and 1 on tiles under a shower head. */
  readonly chairs = new Set<number>();
  readonly showers = new Uint8Array(MAP_W * MAP_H);
  /** 2.29: for each inmate, how far onto its machine it's drawn, where that was, the bench it's getting up from, the rep it's at. */
  private readonly machineBlend: number[] = [];
  private readonly machineAt: Array<{ x: number; z: number; y: number }> = [];
  private readonly machineRest: Array<BedPose | null> = [];
  private readonly machineRep: number[] = [];
  /** The inmate in an arm-wrestle with the player (P22), drawn this far off its spot (eased apart again after), and the dice partner's throw seen (its fling plays once). */
  rivalWho = -1;
  readonly rivalOff = { x: 0, z: 0 };
  rivalThrew = false;

  constructor(
    private readonly add: (c: Character) => void,
    private readonly retire: (c: Character) => void,
    /** The bars and bags (a bag hit at each rep, a bench's bar pressed: `gearUses`). */
    private readonly gear: GymGear,
    private readonly gearUses: GearUse[],
    /** The tiles of the heads someone's washing under, this frame. */
    private readonly running: Set<number>,
    /** Door tiles a guard is walking through this frame (they open for guards' keys). */
    private readonly doorsOpen: Set<number>,
  ) {}

  /** The guards: one character each (its key's color on the belt, riot gear where the prison has it), and the bed each sleeps in at night (if any). */
  setGuards(beds: Array<BedPose | undefined>, keys: number[], riot: (k: number) => boolean) {
    for (const c of this.guardCast) this.retire(c);
    this.guardCast = beds.map((_, k) => new Character(guardLook(k, keys[k], riot(k))));
    this.guardBeds = beds;
    for (const c of this.guardCast) this.add(c);
  }

  /** The other inmates: one character each, looks varied by cell, legs paced by walking speed (P27: the old-timer's hair gone white). */
  setCast(cast: Array<{ cell: number; gait: number; elder?: boolean }> | 0) {
    for (const c of this.cast) this.retire(c);
    this.cast = cast
      ? cast.map(
          (c) => new Character({ ...inmateLook(c.cell), ...(c.elder ? { hair: ELDER_HAIR, hairStyle: 1, beard: 3 } : {}), gait: c.gait }),
        )
      : [];
    for (const c of this.cast) this.add(c);
  }

  /** Someone by Cast id (inmates, then guards). */
  who(id: number): Character | undefined {
    return id < this.cast.length ? this.cast[id] : this.guardCast[id - this.cast.length];
  }

  /** The inmates where the frame has them (`bout`: the player's arm-wrestle, P22). */
  drawInmates(f: Frame, dt: number, time: number, reduced: boolean) {
    const bout = f.games.bout;
    f.inmates.forEach((m, k) => {
      const c = this.cast[k];
      if (!c) return;
      // In the tunnels the ground floor and everyone on it are out of the picture.
      c.root.visible = f.layer !== LAYER.UNDER;
      // (2.26: the water's the head's own; a turn at the showers in shorts, a towel while waiting and after.)
      const tile = Math.floor(m.z) * MAP_W + Math.floor(m.x);
      if (m.doing === DOING.SHOWER && this.showers[tile] === 1) this.running.add(tile);
      c.undressed = m.bare;
      c.towel = m.towel;
      c.attention = m.attention;
      c.trayPose(m.trayAt, m.trayLeft);
      // (2.30: what it's carrying at work.)
      c.hold(m.held, m.held ? itemGeometry(itemDef(m.held)) : null);
      // On a chair, a little higher than on a canteen bench.
      // (2.29: on a machine, drawn on it, and at it: an arm or a body going of its own accord, slower than anyone is asked to keep time.)
      const onGear = m.prop >= 0 && m.doing !== DOING.BENCH;
      const blend = (this.machineBlend[k] =
        (this.machineBlend[k] ?? 0) + ((onGear ? 1 : 0) - (this.machineBlend[k] ?? 0)) * Math.min(1, dt * 8));
      const gearAt = (this.machineAt[k] ??= { x: m.x, z: m.z, y: 0 });
      if (onGear) Object.assign(gearAt, { x: m.at.x, z: m.at.z, y: m.at.y });
      if (m.doing === DOING.BENCH) this.machineRest[k] = m.bench;
      else if (c.lying === 0) this.machineRest[k] = null;
      if (m.prop >= 0 && !reduced) {
        const rep = Math.floor((time + k * 0.37) / (m.doing === DOING.BAG ? 0.6 : 1.2));
        if (rep !== this.machineRep[k]) {
          this.machineRep[k] = rep;
          c.pump();
          if (m.doing === DOING.BAG) this.gear.hit(m.prop, true);
        }
      }
      if (m.doing === DOING.BENCH && m.prop >= 0) this.gearUses.push({ prop: m.prop, up: c.pressed });
      const lift =
        (m.doing === DOING.SIT || m.doing === DOING.SIT_READ) && this.chairs.has(Math.floor(m.z) * MAP_W + Math.floor(m.x))
          ? 0.1
          : blend > 0.001
            ? gearAt.y * blend
            : 0;
      c.baseY += (lift - c.baseY) * Math.min(1, dt * 8);
      // The one arm-wrestling the player (P22): square on to them in its stance, straining the other way (eased back to its spot after).
      if (bout && bout.who === k) {
        c.strain = -bout.strain;
        c.shudder = bout.surge;
        c.pose(
          m.x + this.rivalOff.x,
          m.z + this.rivalOff.z,
          Math.atan2(f.x - m.x, f.z - m.z),
          false,
          dt,
          time,
          !reduced,
          DOING.WRESTLE,
          this.beds[m.cell],
        );
      } else if (f.games.dice && f.games.dice.who === k) {
        // The dice partner (P22): shaking its dice until it throws, a fling as it does.
        const threw = f.games.dice.t[2] >= 0;
        if (threw && !this.rivalThrew) c.pump();
        this.rivalThrew = threw;
        c.diceShake = !threw;
        c.pose(m.x, m.z, m.facing, m.moving, dt, time, !reduced, m.doing, this.beds[m.cell]);
      } else if (this.rivalWho === k)
        c.pose(m.x + this.rivalOff.x, m.z + this.rivalOff.z, m.facing, m.moving, dt, time, !reduced, m.doing, this.beds[m.cell]);
      else if (blend > 0.001)
        c.pose(
          m.x + (gearAt.x - m.x) * blend,
          m.z + (gearAt.z - m.z) * blend,
          onGear ? m.at.facing : m.facing,
          m.moving,
          dt,
          time,
          !reduced,
          m.doing,
          this.beds[m.cell],
        );
      else c.pose(m.x, m.z, m.facing, m.moving, dt, time, !reduced, m.doing, this.machineRest[k] ?? this.beds[m.cell]);
      c.mark(m.angry ? '!' : '', dt, !reduced);
      c.badge(f.layer === LAYER.GROUND ? m.badge : '', dt, !reduced);
    });
  }

  /** The guards where the frame has them; the doors they walk through open. */
  drawGuards(f: Frame, dt: number, time: number, reduced: boolean) {
    f.guards.forEach((g, k) => {
      const c = this.guardCast[k];
      if (!c) return;
      c.root.visible = f.layer !== LAYER.UNDER;
      c.gait = g.pace;
      c.hold(g.held, g.held ? itemGeometry(itemDef(g.held)) : null);
      c.pose(g.x, g.z, g.facing, g.moving, dt, time, !reduced, g.doing, this.guardBeds[k]);
      // "$" pops over a guard as it takes the money (and again once it's calm, still paid).
      // (Not over one floored while looking into something: a "$" already up stays, small.)
      c.mark(
        g.alert === ALERT.HOSTILE
          ? '!'
          : g.alert === ALERT.SUSPICIOUS
            ? '?'
            : g.away && (g.alert === ALERT.CALM || c.markChar === '$')
              ? '$'
              : '',
        dt,
        !reduced,
      );
      c.stir = g.stir;
      c.showKey(g.hasKey);
      // A guard's key opens the door it walks through (and the one just ahead).
      const tx = Math.floor(g.x + Math.sin(g.facing) * 0.6);
      const tz = Math.floor(g.z + Math.cos(g.facing) * 0.6);
      this.doorsOpen.add(Math.floor(g.z) * MAP_W + Math.floor(g.x));
      if (g.moving) this.doorsOpen.add(tz * MAP_W + tx);
    });
  }
}
