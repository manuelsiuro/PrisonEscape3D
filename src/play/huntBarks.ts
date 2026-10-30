/** What the searchers say during the hunt: a line of their bank in a bubble over them, murmured; a shout read out. */
import type { Line } from '../talk/types';
import { currentLang } from '../i18n';
import { enBarks, type BankId } from '../i18n/barks/en';
import { frBarks } from '../i18n/barks/fr';
import { typo } from '../talk/fill';
import type { Bubbles } from '../ui/bubbles';
import { settings, sound, view } from './context';
import type { HuntRun } from './hunt';

/** The hunt's bubbles (made by play/hunt.ts, in its place among the page's layers). */
let huntBubbles: Bubbles;

/** The bubbles off: the hunt over, or left. */
export const hideBarks = () => huntBubbles.hide();

const last = new Map<string, number>();
/** A searcher says something (a line of the bank not said just before). */
export function say(run: HuntRun, who: number, bank: BankId, style: 'say' | 'shout') {
  if (settings.chatter === 'off' || who < 0) return;
  if (settings.chatter === 'some' && style === 'say' && Math.random() < 0.5) return;
  const lang = currentLang();
  const all = (lang === 'fr' ? frBarks : enBarks)[bank] ?? enBarks[bank];
  // (A line for the dark only after dark: torches, a warm bed.)
  const night = run.hunt.night;
  const fits = ((all ?? []) as readonly Line[]).map((l, k) => [l, k] as const).filter(([l]) => typeof l === 'string' || !l.when?.includes('night') || night);
  if (!fits.length) return;
  let j = Math.floor(Math.random() * fits.length);
  if (fits[j][1] === last.get(bank) && fits.length > 1) j = (j + 1) % fits.length;
  const [l, k] = fits[j];
  last.set(bank, k);
  const text = typo(lang, typeof l === 'string' ? l : l.t);
  const now = performance.now() / 1000;
  // One bubble a speaker: a new line replaces theirs.
  const speaker = (run.lookout ? 1 : 0) + who;
  run.said = run.said.filter((b) => b.speaker !== speaker);
  run.said.push({ speaker, guard: true, text, style, start: now, until: now + (style === 'shout' ? 2.6 : 3.2), pitch: 130 + (who % 5) * 14, line: k, bank, reaction: true });
}

const head = (id: number, out: { x: number; y: number }, height: number) => view.screenOf(id, out, height);
export function barks(run: HuntRun, quiet: boolean) {
  const now = performance.now() / 1000;
  run.said = run.said.filter((b) => b.until > now);
  if (quiet || settings.chatter === 'off') {
    huntBubbles.hide();
    return;
  }
  huntBubbles.update(run.said, head, false, !settings.reducedMotion);
}
let murmurAt = 0;
/** The bubbles to speak through: a bubble shown is murmured in its voice, a shout read out. */
export function barksIn(bubbles: Bubbles) {
  huntBubbles = bubbles;
  bubbles.onShow = (b) => {
    const now = performance.now() / 1000;
    if (!settings.voices || now - murmurAt < 0.4) return;
    murmurAt = now;
    sound.murmur(b.pitch, Math.min(6, 2 + Math.round(b.text.length / 18)), b.style === 'shout' ? 1.2 : 0.9);
    if (b.style === 'shout') bubbles.announce(b.text);
  };
}
