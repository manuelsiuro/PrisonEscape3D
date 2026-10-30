/**
 * Speech bubbles (P13): what prisoners and guards say, in the shape the phrase banks
 * (src/i18n/barks/) and the director share. Nothing here touches the DOM or the simulation's
 * state: the bubbles are presentation only, and a line said never changes the game.
 */

/** How an inmate talks: weights its own lines, how chatty it is, its murmur's pitch. */
export const INMATE_VOICES = ['jokester', 'grump', 'philosopher', 'tough', 'worrier', 'oldTimer', 'hustler', 'sweetheart', 'conspiracist', 'poet'] as const;
/** How a guard talks: a steady one as a rookie or a veteran, the others by their ways (P15: lazy, strict, corrupt). */
export const GUARD_VOICES = ['rookie', 'veteran', 'slacker', 'stickler', 'crook'] as const;
export type InmateVoice = (typeof INMATE_VOICES)[number];
export type GuardVoice = (typeof GUARD_VOICES)[number];
export type Voice = InmateVoice | GuardVoice;

/** When a line fits: every tag it lists must hold now. */
const TAGS = ['night', 'morning', 'evening', 'day1', 'newbie', 'freeTime', 'veteran', 'suburban', 'alpine', 'industrial', 'desert', 'island', 'rich', 'broke', 'heatHigh', 'hostile', 'outdoors', 'indoors'] as const;
export type Tag = (typeof TAGS)[number];

/**
 * One line: its text with {slots}, the voices that say it (none: anyone), a weight, the
 * moments it fits, said once a session at most, and for an exchange, the other's reply.
 */
export interface LineDef {
  t: string;
  v?: readonly Voice[];
  w?: number;
  when?: readonly Tag[];
  once?: true;
  r?: string;
}
export type Line = string | LineDef;

/** How a bubble looks: said, shouted, whispered (sleep-talk), or a piece of gossip. */
export type Style = 'say' | 'shout' | 'whisper' | 'gossip';
