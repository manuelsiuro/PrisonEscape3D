import { fitLog, type RunLog } from '../sim/runlog';
import type { SlotId } from './saves';
import { KEYS, readJSON, removeKey, replayBestKey, writeJSON, type StorageKey } from './storage';

/**
 * Run logs in storage (P16): each save's next to it (`pe3d.log.<slot>`, written with the save,
 * so a game loaded from a slot carries on that slot's run), the last escape's, and each
 * prison's quickest. The replay viewer (P25) plays them back.
 */
const LOG_OF: Record<SlotId, StorageKey> = { auto: KEYS.logAuto, 1: KEYS.log1, 2: KEYS.log2, 3: KEYS.log3 };

/** The longest log kept (characters of commands, about 300 KB): longer runs aren't logged, so saves keep their room. */
export const LOG_MAX = 400_000;

export const readLog = (slot: SlotId): RunLog | null => fitLog(readJSON<unknown>(LOG_OF[slot], null));
export const writeLog = (slot: SlotId, log: RunLog): boolean => writeJSON(LOG_OF[slot], log);
export const deleteLog = (slot: SlotId) => removeKey(LOG_OF[slot]);

/** An escape's log: the last one's, and the prison's quickest (`best`); none past LOG_MAX. */
export function keepReplay(log: RunLog, best: boolean) {
  if (log.data.length > LOG_MAX) return;
  writeJSON(KEYS.replayLast, log);
  if (best) writeJSON(replayBestKey(log.prison), log);
}

/** The last escape's log let go (storage full: a save comes first). */
export const dropLastReplay = () => removeKey(KEYS.replayLast);

export const readReplay = (prison?: string): RunLog | null => fitLog(readJSON<unknown>(prison ? replayBestKey(prison) : KEYS.replayLast, null));
