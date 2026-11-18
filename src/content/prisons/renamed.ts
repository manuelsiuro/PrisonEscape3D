import { hash32, hashFrom } from '../../sim/rng';

/**
 * 2.62: five prisons were renamed, and their ids with them. A few draws were seeded from a prison's id:
 * the odd jobs' board (`oddjobs.ts`, a sum of its letters), the chatter, the menus' words and the
 * voices (`talk/`, FNV-1a). Each renamed prison keeps its first id's numbers here, so every run, old
 * log and line plays as it did; the stored games carry the old ids, which `renamedId` maps on.
 * Only the numbers are kept, not the old names.
 */
const FIRST: Readonly<Record<string, readonly [fnv: number, letters: number]>> = {
  'maple-grove': [0xdc5d5f70, 461376],
  frostberg: [0x0cb23a2c, 477120],
  'gravel-point': [0x6e1d17bf, 578240],
  'sierra-seca': [0xd37b4701, 455424],
  'gull-rock': [0xa51793ac, 391232],
};

/** FNV-1a of a prison's id as it was first (`hash32` of the id itself for a prison never renamed). */
export const idHash = (id: string): number => FIRST[id]?.[0] ?? hash32(id);

/** `hash32(id + text)` for a prison's first id: the seeds `talk/` draws from. */
export const idHashWith = (id: string, text: string): number => hashFrom(idHash(id), text);

/** The odd jobs' key for a prison (its first id's letters, summed: `oddjobs.ts`). */
export function idLetters(id: string): number {
  return FIRST[id]?.[1] ?? [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7) * 64;
}

/** The new id of a renamed prison's old one, as a stored game or log may still hold it (undefined for any other text). */
export function renamedId(old: string): string | undefined {
  const h = hash32(old);
  return Object.keys(FIRST).find((id) => FIRST[id][0] === h && id !== old);
}
