import { KEYS, readJSON, writeJSON } from './storage';

/** The tutorial's lessons done on this device (by id). */
export function lessonsDone(): string[] {
  const v = readJSON<unknown>(KEYS.lessons, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** A lesson finished: remembered (once). */
export function markLessonDone(id: string) {
  const done = lessonsDone();
  if (!done.includes(id)) writeJSON(KEYS.lessons, [...done, id]);
}
