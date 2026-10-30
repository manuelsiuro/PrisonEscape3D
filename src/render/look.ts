/** What a body looks like: an outfit, skin, hair and silhouette colour; guards' and inmates' drawn from their number. */

export interface Look {
  outfit: number;
  skin: number;
  hair: number;
  /** 0 short, 1 buzz cut, 2 bald, 3 tall top. */
  hairStyle?: number;
  /** Overall size (1 = the player). */
  size?: number;
  /** Walking pace against the player's (legs swing slower for slower walkers). */
  gait?: number;
  /** Shown when the character is hidden behind something (the player only). */
  silhouette?: number;
  /** A guard: a peaked cap of this color, a badge and a belt instead of the number patch. */
  cap?: number;
  /** Trouser color (the outfit's otherwise). */
  trousers?: number;
  /** A guard's door key on its belt, in the key's color (GDD §10.2). */
  key?: number;
  /** An armored riot guard (P12): a helmet and visor instead of the cap, plates over the uniform. */
  riot?: boolean;
  /**
   * Your prisoner (P16, content/prisoner.ts): facial hair (0 none, 1 stubble, 2 moustache,
   * 3 full beard, 4 goatee, 5 sideburns), a hat (shape 1–13) and glasses (1–7) in a colour, a
   * tattoo on the right forearm (1–5), the jumpsuit's trim colour (cuffs, waistband, side stripes).
   */
  beard?: number;
  hat?: number;
  hatColor?: number;
  glasses?: number;
  glassesColor?: number;
  tattoo?: number;
  tattooColor?: number;
  trim?: number;
  /** P29: tattoos inked in the prison ([shape, colour] each, in order): the left forearm's front, its outer side, the right forearm's outer side. */
  inked?: ReadonlyArray<readonly [number, number]>;
}

/** The orange jumpsuit (tech plan §6.2). */
export const INMATE_LOOK: Look = { outfit: 0xf2701c, skin: 0xe2ad84, hair: 0x3a2a1e, silhouette: 0xffa64d };

const SKINS = [0xf1c6a0, 0xe2ad84, 0xc98d62, 0xa86e48, 0x7d4f33, 0x5b3a26];
const HAIRS = [0x1d1612, 0x3a2a1e, 0x6b4a2b, 0xb08850, 0x8a8a8a, 0x2a2018];

/** A guard's look: navy uniform and cap, varied by a number like inmates; its key's color on the belt. A riot guard (P12) in black, armored. */
export function guardLook(n: number, key?: number, riot = false): Look {
  const r = (k: number) => Math.abs(Math.sin(n * 7.31 + k * 41.7) * 24634.6345) % 1;
  return {
    outfit: riot ? 0x2a2f38 : 0x3a5a8c,
    trousers: riot ? 0x1a1d23 : 0x1f2c44,
    cap: 0x1b2638,
    riot,
    skin: SKINS[Math.floor(r(1) * SKINS.length)],
    hair: HAIRS[Math.floor(r(2) * HAIRS.length)],
    hairStyle: 1,
    size: 1.05 + r(4) * 0.06,
    key,
  };
}

/** A fellow inmate's look, varied by a number (the same number gives the same look). */
export function inmateLook(n: number): Look {
  const r = (k: number) => Math.abs(Math.sin(n * 12.9898 + k * 78.233) * 43758.5453) % 1;
  return {
    outfit: 0xf27a26,
    skin: SKINS[Math.floor(r(1) * SKINS.length)],
    hair: HAIRS[Math.floor(r(2) * HAIRS.length)],
    hairStyle: Math.floor(r(3) * 4),
    size: 0.94 + r(4) * 0.12,
  };
}
