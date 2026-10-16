import { cosmetic, DEFAULT_PRISONER, type LookPart, type Prisoner } from '../content/prisoner';
import { INMATE_LOOK, type Look } from './Character';

/** The guards' uniform colours (Character.guardLook): worn in disguise, the cap comes with them. */
const GUARD_TROUSERS = 0x1f2c44;
const GUARD_CAP = 0x1b2638;

/**
 * The player's look (P16): your prisoner in what they wear. `outfit` is the outfit's colour
 * (null: none on, a white vest). In the guard's uniform the hat gives way to the guard cap and
 * the trim comes off (a disguise looks the part); trims show on the jumpsuit only (`jumpsuit`:
 * the inmate outfit itself, not the padded or plated ones of the same orange).
 */
export function lookFor(p: Prisoner | null, outfit: number | null, disguise: boolean, jumpsuit = outfit === INMATE_LOOK.outfit): Look {
  const pr = p ?? DEFAULT_PRISONER;
  const get = (part: LookPart) => cosmetic(pr.look[part]) ?? cosmetic(DEFAULT_PRISONER.look[part])!;
  const hat = get('hat');
  const glasses = get('glasses');
  const tattoo = get('tattoo');
  const trim = get('trim');
  return {
    ...INMATE_LOOK,
    outfit: outfit ?? 0xe8e8e2,
    skin: get('skin').color,
    hair: get('hair').color,
    hairStyle: get('style').shape,
    size: get('build').shape / 1000,
    beard: get('beard').shape,
    ...(disguise ? { cap: GUARD_CAP, trousers: GUARD_TROUSERS } : hat.shape ? { hat: hat.shape, hatColor: hat.color } : {}),
    ...(glasses.shape ? { glasses: glasses.shape, glassesColor: glasses.color } : {}),
    ...(tattoo.shape ? { tattoo: tattoo.shape, tattooColor: tattoo.color } : {}),
    ...(jumpsuit && !disguise && trim.shape ? { trim: trim.color } : {}),
  };
}
