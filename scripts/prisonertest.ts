/**
 * Your prisoner (P16): the Intake's parts (each with free choices and a default, every one
 * named in both languages), readability (nothing worn in the guards' navy, trims in the
 * orange family and only on the jumpsuit, never a guard's cap but in disguise), names tidied,
 * a stored prisoner made safe, and kept through Reset progress.
 */
import { check } from './assert';

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
};

const { COSMETICS, DEFAULT_PRISONER, LOOK_PARTS, NAME_MAX, cleanName, cosmeticsOf, fitPrisoner } = await import('../src/content/prisoner');
const { lookFor } = await import('../src/render/prisonerLook');
const { INMATE_LOOK } = await import('../src/render/Character');
const { itemDef, itemNumber } = await import('../src/content/items');
const { en } = await import('../src/i18n/en');
const { fr } = await import('../src/i18n/fr');
const { readPrisoner, writePrisoner } = await import('../src/game/prisoner');
const { resetProgress } = await import('../src/game/settings');

const enT = en as Record<string, string>;
const frT = fr as Record<string, string>;

check(new Set(COSMETICS.map((c) => c.id)).size === COSMETICS.length, 'cosmetic ids are unique');
for (const part of LOOK_PARTS) {
  const list = cosmeticsOf(part);
  // Tattoos and trims are all earned (none to start with).
  check(list.filter((c) => !c.locked).length >= (part === 'tattoo' || part === 'trim' ? 1 : 2), `${part}: free choices to start with`);
  check(list.some((c) => c.id === DEFAULT_PRISONER.look[part] && !c.locked), `${part}: a free default`);
  check(!!enT[`part.${part}`] && !!frT[`part.${part}`], `${part}: named`);
}
for (const c of COSMETICS) check(!!enT[`look.${c.id}`] && !!frT[`look.${c.id}`], `${c.id}: named in English and French`);
console.log(LOOK_PARTS.map((p) => `${p} ${cosmeticsOf(p).length} (${cosmeticsOf(p).filter((c) => c.locked).length} to earn)`).join(', '));

const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const hue = (c: number) => {
  const [r, g, b] = rgb(c).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return -1;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
// Readability: nothing worn in the guards' navy (a deep, saturated blue, as their uniforms and caps are).
const sat = (c: number) => {
  const v = rgb(c).map((x) => x / 255);
  const max = Math.max(...v);
  const min = Math.min(...v);
  const l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
};
const navy = (c: number) => hue(c) >= 195 && hue(c) <= 250 && sat(c) >= 0.3 && Math.max(...rgb(c)) <= 150;
for (const n of [0x1e3a5f, 0x3a5a8c, 0x1f2c44, 0x1b2638]) check(navy(n), `the guards' ${n.toString(16)} reads as navy`);
for (const c of COSMETICS) if (c.color && c.part !== 'skin' && c.part !== 'tattoo') check(!navy(c.color), `${c.id}: not the guards' navy`);
// Trims: the orange family (hue 15°–55°, not dark).
for (const c of cosmeticsOf('trim').filter((x) => x.shape)) {
  const hh = hue(c.color);
  check(hh >= 15 && hh <= 55 && Math.max(...rgb(c.color)) >= 150, `${c.id}: a trim in the orange family (hue ${Math.round(hh)}°)`);
}
check(cosmeticsOf('hat').every((c) => c.shape !== 0 || c.id === 'noHat'), 'hats are shapes of their own');

// The look: everything on, in the jumpsuit, another outfit, the guard's uniform.
const guardColor = itemDef(itemNumber('guard_outfit')).color;
const all = fitPrisoner({ name: 'Ace', look: { skin: 'skin5', hair: 'ginger', style: 'mohawk', beard: 'fullBeard', build: 'broad', hat: 'crown', glasses: 'shades', tattoo: 'anchor', trim: 'gold' } });
const jump = lookFor(all, INMATE_LOOK.outfit, false);
check(jump.hat === 6 && jump.glasses === 3 && jump.tattoo === 1 && jump.trim === 0xffd23f && jump.beard === 3 && jump.hairStyle === 4 && jump.size === 1.03 && jump.cap === undefined, 'in the jumpsuit: everything shows');
const vest = lookFor(all, null, false);
check(vest.trim === undefined && vest.outfit === 0xe8e8e2 && vest.hat === 6, 'no outfit: a white vest, no trim');
const other = lookFor(all, 0x7a8a99, false);
check(other.trim === undefined, 'a trim only on the jumpsuit');
check(lookFor(all, INMATE_LOOK.outfit, false, false).trim === undefined, 'not on a padded or plated outfit of the same orange');
const disguisedHair = lookFor(fitPrisoner({ look: { style: 'tall' } }), guardColor, true);
check(disguisedHair.cap !== undefined && disguisedHair.hairStyle === 3, 'in disguise: the cap (Character flattens tall hair under it)');
const disguise = lookFor(all, guardColor, true);
check(disguise.cap !== undefined && disguise.hat === undefined && disguise.trim === undefined && disguise.glasses === 3, 'in disguise: the guard cap instead of the hat, no trim');
check(COSMETICS.every((c) => lookFor(fitPrisoner({ look: { [c.part]: c.id } }), INMATE_LOOK.outfit, false).cap === undefined), 'no cosmetic ever makes a guard cap');
const plain = lookFor(null, INMATE_LOOK.outfit, false);
check(plain.skin === INMATE_LOOK.skin && plain.hair === INMATE_LOOK.hair && plain.hat === undefined && plain.size === 1, 'no prisoner: the jumpsuit as it always was');

// Names: tidied, capped, markup out.
check(cleanName('  Big   Al  ') === 'Big Al', 'spaces tidied');
check(cleanName('<b>Al</b>') === 'bAl/b', 'no markup');
check([...cleanName('Abcdefghijklmnopqrstuvwxyz')].length === NAME_MAX, `at most ${NAME_MAX} characters`);
check([...cleanName('🦝🦝🦝🦝🦝🦝🦝🦝🦝🦝🦝🦝🦝🦝🦝🦝🦝🦝')].length === NAME_MAX, 'emoji count as one character each');
check(cleanName('a\u0000b\nc') === 'ab c' || cleanName('a\u0000b\nc') === 'abc', 'no control characters');

// Stored: garbage made safe; kept through Reset progress.
check(fitPrisoner(null).look.hat === 'noHat' && fitPrisoner({ look: { hat: 'crown', skin: 'crown' } }).look.skin === DEFAULT_PRISONER.look.skin, 'a stored prisoner made safe (a part only takes its own)');
check(readPrisoner() === null, 'no prisoner before the Intake');
writePrisoner(all);
check(readPrisoner()?.name === 'Ace' && readPrisoner()?.look.hat === 'crown', 'a prisoner stored and read back');
resetProgress();
check(readPrisoner()?.name === 'Ace', 'Reset progress keeps your prisoner');
mem.set('pe3d.prisoner', '"nope"');
check(readPrisoner() === null, 'a broken prisoner reads as none');
console.log('prisoner ok');
