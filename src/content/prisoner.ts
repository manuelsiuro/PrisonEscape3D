/**
 * Your prisoner (P16): the parts the Intake editor offers and what each looks like. Some are
 * free, the rest come with an achievement (achievements.ts `gives`). Readability comes first
 * (prisonertest checks): nothing worn is the guards' navy, no hat looks like a guard's cap,
 * jumpsuit trims are in the orange family and only show on the jumpsuit.
 */
export type LookPart = 'skin' | 'hair' | 'style' | 'beard' | 'build' | 'hat' | 'glasses' | 'tattoo' | 'trim';
export const LOOK_PARTS: readonly LookPart[] = ['skin', 'hair', 'style', 'beard', 'build', 'hat', 'glasses', 'tattoo', 'trim'];

export interface Cosmetic {
  id: string;
  part: LookPart;
  /** A colour (skin, hair, trim; a hat's, glasses' or tattoo's main colour), and a shape (styles, beards, hats, glasses, tattoos; a build's size in thousandths). */
  color: number;
  shape: number;
  /** Earned with an achievement (the achievement says which); free otherwise. */
  locked?: boolean;
}

const c = (id: string, part: LookPart, color: number, shape = 0, locked = false): Cosmetic => ({ id, part, color, shape, ...(locked ? { locked } : {}) });

export const COSMETICS: readonly Cosmetic[] = [
  // Skin tones (the inmates' own).
  c('skin1', 'skin', 0xf1c6a0),
  c('skin2', 'skin', 0xe2ad84),
  c('skin3', 'skin', 0xc98d62),
  c('skin4', 'skin', 0xa86e48),
  c('skin5', 'skin', 0x7d4f33),
  c('skin6', 'skin', 0x5b3a26),
  // Hair colours.
  c('black', 'hair', 0x1d1612),
  c('brown', 'hair', 0x3a2a1e),
  c('chestnut', 'hair', 0x6b4a2b),
  c('blond', 'hair', 0xb08850),
  c('grey', 'hair', 0x8a8a8a),
  c('ginger', 'hair', 0xb5521f, 0, true),
  c('platinum', 'hair', 0xe6dcc0, 0, true),
  c('teal', 'hair', 0x2f8f8a, 0, true),
  // Hair styles (Character's hairStyle).
  c('short', 'style', 0, 0),
  c('buzz', 'style', 0, 1),
  c('bald', 'style', 0, 2),
  c('tall', 'style', 0, 3),
  c('mohawk', 'style', 0, 4, true),
  c('curls', 'style', 0, 5, true),
  c('ponytail', 'style', 0, 6, true),
  // Facial hair (in the hair's colour).
  c('shaven', 'beard', 0, 0),
  c('stubble', 'beard', 0, 1),
  c('moustache', 'beard', 0, 2),
  c('fullBeard', 'beard', 0, 3, true),
  c('goatee', 'beard', 0, 4, true),
  c('sideburns', 'beard', 0, 5, true),
  // Build: a touch slimmer or broader (±3%).
  c('slim', 'build', 0, 970),
  c('regular', 'build', 0, 1000),
  c('broad', 'build', 0, 1030),
  // Hats (never a peaked cap, never navy: a guard's look stays a guard's).
  c('noHat', 'hat', 0, 0),
  c('beanie', 'hat', 0x8c3b2a, 1),
  c('bandana', 'hat', 0xc8322b, 2, true),
  c('headband', 'hat', 0xf4f1ea, 3, true),
  c('chef', 'hat', 0xfafafa, 4, true),
  c('party', 'hat', 0xa35bd6, 5, true),
  c('crown', 'hat', 0xf4c542, 6, true),
  c('straw', 'hat', 0xd9b26a, 7, true),
  c('bucket', 'hat', 0x6f7d3a, 8, true),
  c('topHat', 'hat', 0x26232a, 9, true),
  c('propeller', 'hat', 0xe94b3c, 10, true),
  // P41: a woolly hat in forest green (a clean getaway).
  c('mhBeanie', 'hat', 0x35603d, 1, true),
  // Glasses.
  c('noGlasses', 'glasses', 0, 0),
  c('round', 'glasses', 0x2a2a30, 1),
  c('square', 'glasses', 0x6b3d24, 2, true),
  c('shades', 'glasses', 0x121216, 3, true),
  c('monocle', 'glasses', 0xd8b04a, 4, true),
  c('goggles', 'glasses', 0x7a5a32, 5, true),
  c('starShades', 'glasses', 0xff5fa2, 6, true),
  // A tattoo on the forearm.
  c('noTattoo', 'tattoo', 0, 0),
  c('anchor', 'tattoo', 0x2f4f6f, 1, true),
  c('heart', 'tattoo', 0xc0302a, 2, true),
  c('star', 'tattoo', 0x2f4f6f, 3, true),
  c('swallow', 'tattoo', 0x2f4f6f, 4, true),
  c('flame', 'tattoo', 0xe2601c, 5, true),
  // P29: the parlour's designs.
  c('skullInk', 'tattoo', 0x2b3038, 6, true),
  c('eagleInk', 'tattoo', 0x6a4a2a, 7, true),
  // Jumpsuit trims: cuffs, collar and a stripe, in the orange family.
  c('noTrim', 'trim', 0, 0),
  c('amber', 'trim', 0xffb000, 1, true),
  c('gold', 'trim', 0xffd23f, 1, true),
  c('rust', 'trim', 0xa63f12, 1, true),
  c('cream', 'trim', 0xfff0d0, 1, true),
  c('tangerine', 'trim', 0xff9a3c, 1, true),
  // v2.18 (P39): reading glasses in gold, for the reformed (out on parole).
  c('paroleSpecs', 'glasses', 0xc9a227, 2, true),
];

export const cosmetic = (id: string): Cosmetic | undefined => COSMETICS.find((x) => x.id === id);
export const cosmeticsOf = (part: LookPart): Cosmetic[] => COSMETICS.filter((x) => x.part === part);

/** Your prisoner as stored: a name and a cosmetic id per part. */
export interface Prisoner {
  name: string;
  look: Record<LookPart, string>;
}

/** The longest name (characters). */
export const NAME_MAX = 16;

/** The prisoner before the player makes one (the jumpsuit as it always was). */
export const DEFAULT_PRISONER: Prisoner = {
  name: '',
  look: { skin: 'skin2', hair: 'brown', style: 'short', beard: 'shaven', build: 'regular', hat: 'noHat', glasses: 'noGlasses', tattoo: 'noTattoo', trim: 'noTrim' },
};

/** A stored prisoner made safe: a cleaned-up name, a known cosmetic of the right part for each (the default otherwise). */
export function fitPrisoner(p: unknown): Prisoner {
  const o = (p && typeof p === 'object' ? p : {}) as Partial<Prisoner>;
  const look = { ...DEFAULT_PRISONER.look };
  for (const part of LOOK_PARTS) {
    const id = o.look?.[part];
    if (typeof id === 'string' && cosmetic(id)?.part === part) look[part] = id;
  }
  return { name: cleanName(typeof o.name === 'string' ? o.name : ''), look };
}

/** A name as typed, tidied: no control characters or markup, spaces collapsed, at most NAME_MAX characters. */
export function cleanName(s: string): string {
  // eslint-disable-next-line no-control-regex
  const flat = s.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trimStart();
  return [...flat].slice(0, NAME_MAX).join('').trimEnd();
}
