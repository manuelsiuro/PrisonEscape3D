/**
 * The library's books (2.31): what a shelf offers, by subject, as data. A subject decides which
 * recipes its reader is told at each new mark of Intellect; a page is a run of key words, the
 * same for every language (the view lays each language's words over them: i18n's `book.*`).
 */
export const SUBJECTS = ['tools', 'locks', 'weapons', 'everyday'] as const;
export type Subject = (typeof SUBJECTS)[number];

const TOOLS = [
  'tool_handle', 'flimsy_shovel', 'light_shovel', 'sturdy_shovel', 'flimsy_pickaxe', 'light_pickaxe', 'sturdy_pickaxe',
  'flimsy_cutters', 'light_cutters', 'sturdy_cutters', 'multitool', 'powered_screwdriver', 'grappling_hook', 'grapnel',
  'raft', 'glider_frame', 'glider', 'sheet_rope', 'timber_brace',
];
const LOCKS = [
  'molten_plastic', 'putty', 'papier_mache', 'bed_dummy', 'poster', 'fake_vent', 'fake_wall', 'fake_fence', 'pouch', 'lockpick',
  'fake_id', 'hollow_book', 'forged_release',
];
const WEAPONS = ['sock_mace', 'super_sock_mace', 'comb_blade', 'bat', 'spiked_bat', 'nunchucks', 'razor_whip', 'cushioned_outfit', 'plated_outfit'];
const EVERYDAY = ['molten_chocolate', 'firecracker', 'alarm_clock', 'sleepy_jerky', 'rat_trap', 'pruno_bag', 'rat_track', 'tattoo_gun', 'guitar'];
const OF: Record<string, number> = Object.fromEntries([TOOLS, LOCKS, WEAPONS, EVERYDAY].flatMap((list, k) => list.map((id) => [id, k])));

/** The subject a recipe's result is taught under (an index in SUBJECTS). The molds and keys cast from them: locks. */
export const subjectOf = (result: string): number => OF[result] ?? (result.startsWith('mold_') || result.startsWith('plastic_key_') ? 1 : -1);

/** The pages of a book, cycled through: the steps from one key word to the next, each page the same length. */
export const READ_GAPS: readonly (readonly number[])[] = [
  [22, 30, 18, 34, 20, 26],
  [26, 18, 32, 22, 30, 22],
  [18, 28, 24, 20, 34, 26],
];
export const READ_KEYS = READ_GAPS[0].length;
export const READ_PAGE_STEPS = READ_GAPS[0].reduce((a, b) => a + b, 0);
/** The last key word of a page comes this many steps before its end, so that it isn't turned under a late press. */
export const READ_TAIL = 10;

/** How far into the reading (steps) a key word comes up, by its number counted from the first page's first. */
export function keyAt(k: number): number {
  const page = Math.floor(k / READ_KEYS);
  const gaps = READ_GAPS[page % READ_GAPS.length];
  let at = page * READ_PAGE_STEPS - READ_TAIL;
  for (let i = 0; i <= k % READ_KEYS; i++) at += gaps[i];
  return at;
}

/** The first key word not yet gone by, `grace` steps after it came up. */
export function keyFrom(pos: number, grace = 0): number {
  const seen = Math.max(0, pos - grace);
  let k = Math.max(0, Math.floor(seen / READ_PAGE_STEPS) - 1) * READ_KEYS;
  while (keyAt(k) < seen) k++;
  return k;
}

/** A word of a page: a key word (or phrase) in [brackets] in the text. */
export interface Token {
  text: string;
  key: boolean;
}

/** A page's words, each language's text marking READ_KEYS key words. */
export function pageTokens(text: string): Token[] {
  const out: Token[] = [];
  for (const part of text.split(/(\[[^\]]*\][^\s\[]*)/)) {
    if (part.startsWith('[')) out.push({ text: part.replace(/[[\]]/g, ''), key: true });
    else for (const w of part.split(/\s+/)) if (w) out.push({ text: w, key: false });
  }
  return out;
}
