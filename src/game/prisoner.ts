import { fitPrisoner, type Prisoner } from '../content/prisoner';
import { KEYS, readJSON, writeJSON } from './storage';

/** Your prisoner (P16), or null before the Intake: kept apart from progress (Reset progress leaves it). */
export function readPrisoner(): Prisoner | null {
  const raw = readJSON<unknown>(KEYS.prisoner, null);
  return raw && typeof raw === 'object' ? fitPrisoner(raw) : null;
}

export function writePrisoner(p: Prisoner): boolean {
  return writeJSON(KEYS.prisoner, fitPrisoner(p));
}
