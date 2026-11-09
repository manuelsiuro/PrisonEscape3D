import type { Lesson } from './kit';
import { BASICS } from './lessonsBasics';
import { GET_BY } from './lessonsGetBy';
import { LIFE } from './lessonsLife';
import { DAYS } from './lessonsDays';
import { WAYS } from './lessonsWays';
import { PRISONS_LESSONS } from './lessonsPrisons';

/**
 * The tutorial (P8+): short lessons on the Training Block, each a scene set up on a fresh game
 * and a few steps, each ticked off when the game shows it done. The same definitions drive the
 * player's lessons and the bots in `tutorialtest`, which prove every lesson can be finished.
 * The lessons themselves are in a file per chapter (the third in two): their order here is the
 * chapters', and a lesson without a seed of its own takes `7 + its place`.
 */
export const LESSONS: readonly Lesson[] = [...BASICS, ...GET_BY, ...LIFE, ...DAYS, ...WAYS, ...PRISONS_LESSONS];

/** The chapters, in order, each its lessons (in the order LESSONS has them). */
export const CHAPTERS: ReadonlyArray<{ id: string; icon: string; lessons: readonly string[] }> = [
  { id: 'basics', icon: 'book', lessons: ['walk', 'search', 'craft', 'routine', 'heat', 'stash', 'dig', 'fight', 'noise', 'escape'] },
  { id: 'getby', icon: 'coin', lessons: ['talk', 'trade', 'job', 'gym', 'disguise', 'tunnel', 'vents'] },
  {
    id: 'life',
    icon: 'chat',
    lessons: [
      'guards',
      'day',
      'dogs',
      'rat',
      'smuggle',
      'games',
      'cards',
      'hoops',
      'checkers',
      'pruno',
      'garden',
      'ratRace',
      'football',
      'tattoo',
      'talent',
      'quiz',
      'crew',
      'gangJoin',
      'gangTurf',
      'caught',
      'towers',
      'laps',
      'meals',
      'showers',
      'rollcall',
      'night',
      'gardener',
      'library',
      'vending',
      'menu',
      'payphone',
      'cousin',
      'kiosk',
      'oddjob',
    ],
  },
  {
    id: 'ways',
    icon: 'route',
    lessons: ['lockpick', 'keys', 'cams', 'stowaway', 'bluff', 'glider', 'grapnel', 'takeover', 'forgery', 'release', 'parole', 'manhunt'],
  },
  // 2.38: each prison's own, played there.
  { id: 'prisons', icon: 'map', lessons: ['hounds', 'cold', 'shell', 'mines', 'raft', 'helicopter'] },
];

/** Where a lesson (its index in LESSONS) stands: its chapter, its number in it (from 1) and how many the chapter has. */
export function chapterOf(index: number): { id: string; n: number; of: number } {
  const id = LESSONS[index]?.id;
  const c = CHAPTERS.find((x) => x.lessons.includes(id)) ?? CHAPTERS[0];
  return { id: c.id, n: c.lessons.indexOf(id) + 1, of: c.lessons.length };
}
