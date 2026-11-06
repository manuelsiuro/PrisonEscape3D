import type { Carry, HuntOptions } from '../sim/hunt/Hunt';
import type { SimEvent } from '../sim/Sim';
import type { Game } from './game';
import type { HuntResult } from './hunt';
import { outsideOf } from '../content/outside';

/**
 * The parts of play in files of their own (v2.34.2, the faster first load): the manhunt (hunt.ts and
 * what only it uses), the tutorial (tutorial/part.ts: its flow, the lessons, play/lesson.ts) and the side
 * games' cards (cards.ts). The title shows without them; they're fetched once it's up (`fetchParts`), so
 * they're in before anyone can need them (the offline copy has them too). One asked for sooner is
 * fetched then; one that couldn't be fetched (offline on a first visit) is tried again when it's
 * wanted. Until a part is in, nothing of it can be running, and its calls here do nothing.
 */
type HuntPart = typeof import('./hunt');
let hunt: HuntPart | null = null;

type TutorialPart = typeof import('../tutorial/part');
let tutorial: TutorialPart | null = null;
/** The side games' cards (cards.ts). */
export type Cards = ReturnType<(typeof import('./cards'))['makeCards']>;
let cards: Cards | null = null;
const cardsWanted: Array<(c: Cards) => void> = [];

/** A part's code, fetched once (`done` with it then); a fetch that failed is tried again on the next call. */
function loader<T>(fetchIt: () => Promise<T>, done: (m: T) => void): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () =>
    (pending ??= fetchIt().then(
      (m) => {
        done(m);
        return m;
      },
      (e: unknown) => {
        pending = null;
        throw e;
      },
    ));
}

/** The manhunt's code. */
export const loadHunt = loader(
  () => import('./hunt'),
  (m) => (hunt = m),
);
/** The tutorial's code. */
export const loadTutorial = loader(
  () => import('../tutorial/part'),
  (m) => (tutorial = m),
);
/** The side games' cards: made once fetched (in their place on the page), then handed to those waiting for them. */
const loadCards = loader(
  () => import('./cards'),
  (m) => {
    if (cards) return;
    cards = inPlace('games', m.makeCards);
    for (const f of cardsWanted.splice(0)) f(cards);
  },
);
/** When the cards' fetch failed: when to try again (0: not failed). */
let cardsAgainAt = 0;
const fetchCards = () =>
  void loadCards().catch(() => {
    cardsAgainAt = performance.now() + 5000;
  });

/** Every part fetched (once the title is up). */
export function fetchParts() {
  void loadHunt().catch(() => {});
  void loadTutorial().catch(() => {});
  fetchCards();
}

// ------------------------------------------------------------------ their places on the page
/**
 * Where each part's pieces go on the page: a part makes its HUD, cards and bubbles when it's
 * fetched, after the rest; put where they were made before (the page's order is the order they stack).
 */
const places = new Map<string, Comment>();

/** Keeps a part's place at the end of the page (or of an element of it: the HUD), as it is now. */
export function holdPlace(part: string, parent: HTMLElement = document.body) {
  places.set(part, parent.appendChild(document.createComment(part)));
}

/** Makes a part's pieces (`make` appends them to its place's element) and moves them to the part's place. */
export function inPlace<T>(part: string, make: () => T): T {
  const place = places.get(part);
  const parent = place?.parentNode ?? document.body;
  const last = parent.lastChild;
  const made = make();
  if (place) {
    const added: ChildNode[] = [];
    for (let n = last ? last.nextSibling : parent.firstChild; n; n = n.nextSibling) added.push(n);
    place.replaceWith(...added);
    places.delete(part);
  }
  return made;
}

// ------------------------------------------------------------------ the manhunt (P41)
/** Whether a prison has an outside to run in. */
export const hasOutside = (prison: string) => !!outsideOf(prison);

/** Into the manhunt (hunt.ts): at once once its code is in, else as soon as it is. */
export function runHunt(
  g: Game,
  carry: Carry,
  opts: HuntOptions & { lookout?: { name: string; cell: number } | null; lesson?: boolean } = {},
): Promise<HuntResult> {
  return hunt ? hunt.runHunt(g, carry, opts) : loadHunt().then((m) => m.runHunt(g, carry, opts));
}

/** A lesson played in the manhunt (hunt.ts): fetched by the tutorial before the lesson starts (it can't come in mid-lesson). */
export const lessonHunt = (g: Game, spec: Parameters<HuntPart['lessonHunt']>[1]) => hunt!.lessonHunt(g, spec);

/** The hunt comes down (hunt.ts); none can be under way before its code is in. */
export const stopHunt = (g: Game | null) => hunt?.stopHunt(g);

/** Keys in a hunt (hunt.ts): false while none is under way. */
export const huntKey = (code: string, e: KeyboardEvent): boolean => hunt?.huntKey(code, e) ?? false;

/** A tap on the ground in a hunt (hunt.ts). */
export const huntTap = (cx: number, cy: number) => hunt?.huntTap(cx, cy);

/** One frame of a hunt (hunt.ts): only called while one is under way (`g.hunt`, set by it). */
export const huntFrame = (g: Game, dt: number, now: number) => hunt!.huntFrame(g, dt, now);

// ------------------------------------------------------------------ the tutorial (P8+)
/** The tutorial from the title (flows/tutorial.ts): its code fetched first if it isn't in yet (not fetched: back to the title). */
export async function tutorialFlow(first: number | null = null): Promise<boolean> {
  let m: TutorialPart;
  try {
    m = await loadTutorial();
  } catch {
    return false;
  }
  return m.tutorialFlow(first);
}

/** A lesson's events (play/lesson.ts); none is under way before its code is in. */
export const lessonEvent = (g: Game, e: SimEvent) => tutorial?.lessonEvent(g, e);

/** Every frame: the lesson under way (play/lesson.ts). */
export const updateLesson = (g: Game, dt: number, hidden: boolean) => tutorial?.updateLesson(g, dt, hidden);

/** Whether a panel covers the lesson's card (play/lesson.ts). */
export const lessonHidden = (): boolean => tutorial?.lessonHidden() ?? false;

/** The lesson step's goal for the floor arrows (play/lesson.ts). */
export const lessonGoal = (g: Game): number | null => tutorial?.lessonGoal(g) ?? null;

/** In a lesson's manhunt, where the floor arrows lead (play/lesson.ts). */
export const lessonHuntGoal = (g: Game): ((i: number) => boolean) | null => tutorial?.lessonHuntGoal(g) ?? null;

/** The bulb (or O): the lesson's objectives (play/lesson.ts). */
export const openObjectives = async (): Promise<void> => tutorial?.openObjectives();

/** The lesson's card comes down (play/lesson.ts): there's none before its code is in. */
export const hideLesson = () => tutorial?.hideLesson();

/** A lesson's place in the tutorial, for the pause card (play/lesson.ts): only while one is under way. */
export const lessonPlace = (index: number): string => tutorial!.lessonPlace(index);

/** What the objectives show for the lesson under way (play/lesson.ts): only while one is. */
export const objectivesOf: TutorialPart['objectivesOf'] = (run) => tutorial!.objectivesOf(run);

// ------------------------------------------------------------------ the side games' cards (P22, P27–P30)
/** The cards, once made (null before: no side game can be on screen yet; their fetch failed, it's tried again now and then). */
export function gameCards(): Cards | null {
  if (!cards && cardsAgainAt && performance.now() >= cardsAgainAt) {
    cardsAgainAt = 0;
    fetchCards();
  }
  return cards;
}

/** Hooks on the cards (their buttons), set as soon as they're made. */
export function whenCards(f: (c: Cards) => void) {
  if (cards) f(cards);
  else cardsWanted.push(f);
}
