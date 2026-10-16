import type { PrisonDef } from '../content/prisons/types';
import { INMATE_VOICES, type GuardVoice, type InmateVoice, type Voice } from './types';

/** FNV-1a: a small hash that is the same on every device (voices, menus, seeds). */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** How often a voice speaks up, against the others (1: average). */
export const CHATTY: Record<Voice, number> = {
  jokester: 1.4,
  grump: 0.6,
  philosopher: 1,
  tough: 0.7,
  worrier: 1.2,
  oldTimer: 1.1,
  hustler: 1.3,
  sweetheart: 1.2,
  conspiracist: 1.2,
  poet: 0.9,
  rookie: 1.1,
  veteran: 0.8,
  slacker: 0.7,
  stickler: 1.2,
  crook: 1.1,
};

/** Seconds a speaker waits between two lines of its own (reactions aside). */
export const PAUSE: Record<Voice, number> = {
  jokester: 14,
  grump: 30,
  philosopher: 20,
  tough: 26,
  worrier: 16,
  oldTimer: 18,
  hustler: 15,
  sweetheart: 16,
  conspiracist: 17,
  poet: 22,
  rookie: 18,
  veteran: 26,
  slacker: 28,
  stickler: 16,
  crook: 18,
};

/** The murmur's pitch (Hz) under each bubble: a voice of its own. */
export const PITCH: Record<Voice, number> = {
  jokester: 260,
  grump: 120,
  philosopher: 170,
  tough: 110,
  worrier: 240,
  oldTimer: 140,
  hustler: 210,
  sweetheart: 280,
  conspiracist: 200,
  poet: 190,
  rookie: 230,
  veteran: 130,
  slacker: 115,
  stickler: 200,
  crook: 165,
};

/** The voices an inmate may have (merchants are hustlers). */
const ORDINARY = INMATE_VOICES.filter((v) => v !== 'hustler');

/**
 * An inmate's voice: merchants hustle; the others take the prison's own order of the
 * ordinary voices in turn, so a prison's inmates are as varied as they can be.
 */
export function inmateVoice(prison: PrisonDef, cell: number): InmateVoice {
  if (prison.merchants.includes(cell)) return 'hustler';
  const order = [...ORDINARY].sort((a, b) => hashStr(`${prison.id}:${a}`) - hashStr(`${prison.id}:${b}`));
  return order[(cell - 2 + order.length) % order.length];
}

/** A guard's voice: its ways' own (P15), or for a steady one a rookie's or a veteran's. */
export function guardVoice(prison: PrisonDef, k: number): GuardVoice {
  const trait = prison.guards[k]?.trait ?? 'steady';
  if (trait === 'lazy') return 'slacker';
  if (trait === 'strict') return 'stickler';
  if (trait === 'corrupt') return 'crook';
  return STEADY_VOICES[hashStr(`${prison.id}#${k}`) % STEADY_VOICES.length];
}

const STEADY_VOICES: readonly GuardVoice[] = ['rookie', 'veteran'];
